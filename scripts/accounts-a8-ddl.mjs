/**
 * Accounts A8 — targeted DDL for the cheque register.
 *
 * Additive only, idempotent (IF NOT EXISTS everywhere) so it is
 * safe to re-run. NEVER a full `prisma db push`: the
 * branch_cash_ledger.expected_closing_cash generated column must
 * not be touched.
 *
 * The `cheque_register` table itself was created EMPTY in A1
 * (blueprint §B.1) with the full lifecycle shape. A8 needs only:
 *  - `note` — a free-text column for the record/bounce/cancel
 *    reason an admin enters at a transition (the S1 audit trail
 *    carries the structured history; this is the human note that
 *    travels with the row and renders on the register screen).
 *  - an index on (status, due_date) backing the PDC due list +
 *    the Accounts overview's derived CHEQUE_PDC_DUE flag.
 *  - an index on (bank_account_id, cheque_no) backing the
 *    duplicate-cheque-number guard (service-enforced, the A6
 *    duplicate-month pattern: the invariant lives in the service
 *    and is proven by the stage harness).
 *
 * No rows are seeded and nothing is derived into the register:
 * no source module records cheque instruments, so the register
 * honestly starts EMPTY (no invented cheques).
 *
 * Run:  node --env-file=.env.local scripts/accounts-a8-ddl.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const STATEMENTS = [
  `ALTER TABLE cheque_register ADD COLUMN IF NOT EXISTS note text`,
  `CREATE INDEX IF NOT EXISTS cheque_register_status_due_idx
     ON cheque_register (status, due_date)`,
  `CREATE INDEX IF NOT EXISTS cheque_register_bank_no_idx
     ON cheque_register (bank_account_id, cheque_no)`,
]

try {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'cheque_register' ORDER BY ordinal_position`
  )
  const count = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM cheque_register`)
  console.log(`A8 DDL applied (${STATEMENTS.length} statements).`)
  console.log('  cheque_register columns:', rows.map((r) => r.column_name).join(','))
  console.log('  cheque_register rows:', count[0].n)
} finally {
  await prisma.$disconnect()
}
