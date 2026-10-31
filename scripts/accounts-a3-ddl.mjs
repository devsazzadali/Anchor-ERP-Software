/**
 * Accounts A3 — targeted DDL for period close & lock, FY rollover
 * and the posting-exceptions record.
 *
 * Additive only, idempotent (IF NOT EXISTS everywhere) so it is
 * safe to re-run. NEVER a full `prisma db push`: the
 * branch_cash_ledger.expected_closing_cash generated column must
 * not be touched.
 *
 * Run:  node --env-file=.env.local scripts/accounts-a3-ddl.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const STATEMENTS = [
  // ── Posting exceptions (A3 → read by the A9 exceptions inbox) ──
  // One durable row per (source_table, source_id, event_type) whose
  // journal posting was refused because its period is closed/locked.
  // The source write itself always stands (fail-soft law); this row
  // is how the blocked posting stays visible until it is resolved.
  `CREATE TABLE IF NOT EXISTS posting_exceptions (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     source_table text NOT NULL,
     source_id uuid NOT NULL,
     event_type text NOT NULL,
     entry_date date NOT NULL,
     period_month text NOT NULL,
     reason text NOT NULL,
     detail jsonb,
     status text NOT NULL DEFAULT 'open',
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     resolved_at timestamptz
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS posting_exceptions_source_key
     ON posting_exceptions (source_table, source_id, event_type)`,
  `CREATE INDEX IF NOT EXISTS posting_exceptions_status_idx
     ON posting_exceptions (status)`,

  // ── Fiscal-year close state (FY rollover, A3) ──────────────────
  `ALTER TABLE fiscal_years ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open'`,
  `ALTER TABLE fiscal_years ADD COLUMN IF NOT EXISTS closed_by uuid`,
  `ALTER TABLE fiscal_years ADD COLUMN IF NOT EXISTS closed_at timestamptz`,

  // ── Period lock / break-glass reopen metadata (A3) ─────────────
  `ALTER TABLE accounting_periods ADD COLUMN IF NOT EXISTS locked_by uuid`,
  `ALTER TABLE accounting_periods ADD COLUMN IF NOT EXISTS locked_at timestamptz`,
  `ALTER TABLE accounting_periods ADD COLUMN IF NOT EXISTS reopened_by uuid`,
  `ALTER TABLE accounting_periods ADD COLUMN IF NOT EXISTS reopened_at timestamptz`,
  `ALTER TABLE accounting_periods ADD COLUMN IF NOT EXISTS reopen_reason text`,
]

for (const sql of STATEMENTS) {
  await prisma.$executeRawUnsafe(sql)
  console.log('ok:', sql.split('\n')[0].slice(0, 90))
}

// Verify the generated column survived (paranoia — these statements
// never touch branch_cash_ledger, but the gate is cheap).
const gen = await prisma.$queryRawUnsafe(
  `SELECT is_generated FROM information_schema.columns
    WHERE table_name = 'branch_cash_ledger' AND column_name = 'expected_closing_cash'`
)
console.log('expected_closing_cash is_generated:', JSON.stringify(gen))
await prisma.$disconnect()
