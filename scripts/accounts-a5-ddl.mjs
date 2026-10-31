/**
 * Accounts A5 — targeted DDL for counterparties, the payables /
 * receivables register and settlements.
 *
 * Additive only, idempotent (IF NOT EXISTS everywhere) so it is
 * safe to re-run. NEVER a full `prisma db push`: the
 * branch_cash_ledger.expected_closing_cash generated column must
 * not be touched. The register tables themselves (counterparties,
 * payables_receivables) were created EMPTY by the A1 DDL; A5 adds
 * the source link on counterparties and the settlement ledger.
 *
 * Run:  node --env-file=.env.local scripts/accounts-a5-ddl.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const STATEMENTS = [
  // ── Counterparty source link (A5) ──────────────────────────────
  // Counterparties are DERIVED from existing records (an employee,
  // a landlord account, a partner profile…). The link records
  // which source row a counterparty was derived from so the
  // derivation is idempotent and the register can point back at
  // the record it came from.
  `ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS source_table text`,
  `ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS source_id uuid`,
  `CREATE UNIQUE INDEX IF NOT EXISTS counterparties_source_key
     ON counterparties (source_table, source_id)
     WHERE source_id IS NOT NULL`,
  // Set by the admin parties API when a human edits name/contact:
  // derivation refreshes source facts but never clobbers a
  // human-edited counterparty.
  `ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS edited_manually boolean NOT NULL DEFAULT false`,

  // ── Settlement ledger (A5) ─────────────────────────────────────
  // One row per settlement recorded against a register item,
  // whichever path wrote it:
  //   journal      — posted through the A1 engine (Dr AP / Cr the
  //                  paid-via account); journal_entry_id set.
  //   source_state — the company-expense module's own paid_amount
  //                  change, posted by hookCompanyPaidChange;
  //                  journal_entry_id set. Recorded here so the
  //                  hook's settled-amount arithmetic can see ALL
  //                  settlements (its journal entries carry a
  //                  state-derived source_id the scan cannot find
  //                  by expense id alone — see hooks.ts).
  //   external     — settled outside the module (cash handed over,
  //                  paid from another system): NO journal entry;
  //                  a note is mandatory. Register-only truth for
  //                  classes whose source module owns the pay path.
  `CREATE TABLE IF NOT EXISTS payable_settlements (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     payable_id uuid NOT NULL,
     amount numeric(15,2) NOT NULL,
     paid_via text,
     settlement_date date NOT NULL,
     mode text NOT NULL DEFAULT 'journal',
     note text,
     journal_entry_id uuid,
     created_by uuid,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS payable_settlements_payable_idx
     ON payable_settlements (payable_id)`,

  // ── Register lookup indexes (A5) ───────────────────────────────
  `CREATE INDEX IF NOT EXISTS payables_receivables_counterparty_idx
     ON payables_receivables (counterparty_id)`,
  `CREATE INDEX IF NOT EXISTS payables_receivables_status_idx
     ON payables_receivables (status)`,
]

for (const sql of STATEMENTS) {
  await prisma.$executeRawUnsafe(sql)
  console.log('ok:', sql.split('\n')[0].slice(0, 90))
}

// The generated-column invariant the whole Accounts program
// depends on — verify the DDL did not disturb it.
const gen = await prisma.$queryRawUnsafe(
  `SELECT is_generated FROM information_schema.columns
    WHERE table_name = 'branch_cash_ledger' AND column_name = 'expected_closing_cash'`
)
console.log('expected_closing_cash is_generated:', gen[0]?.is_generated)
await prisma.$disconnect()
console.log('A5 DDL complete.')
