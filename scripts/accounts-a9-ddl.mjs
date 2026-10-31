/**
 * Accounts A9 — targeted DDL for the exceptions inbox workflow.
 *
 * Additive only, idempotent (IF NOT EXISTS everywhere) so it is
 * safe to re-run. NEVER a full `prisma db push`: the
 * branch_cash_ledger.expected_closing_cash generated column must
 * not be touched.
 *
 * `posting_exceptions` (A3) already carries status / resolved_at.
 * The A9 inbox adds the human workflow around it:
 *  - `acknowledged_at` / `acknowledged_by` — an admin has seen the
 *    blocked posting and taken ownership of it (status moves
 *    'open' → 'acknowledged').
 *  - `resolved_by` / `resolution_note` — who closed it and the
 *    mandatory explanation of HOW it was resolved (reopen +
 *    re-fire, correction entry, …). Resolution never deletes the
 *    row and never posts anything by itself.
 * Status vocabulary extends to: open | acknowledged | resolved.
 *
 * No other table changes: every other inbox source is derived at
 * read time from the owning module's rows (the A3/A8 pattern) and
 * stores nothing.
 *
 * Run:  node --env-file=.env.local scripts/accounts-a9-ddl.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const STATEMENTS = [
  `ALTER TABLE posting_exceptions ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz`,
  `ALTER TABLE posting_exceptions ADD COLUMN IF NOT EXISTS acknowledged_by uuid`,
  `ALTER TABLE posting_exceptions ADD COLUMN IF NOT EXISTS resolved_by uuid`,
  `ALTER TABLE posting_exceptions ADD COLUMN IF NOT EXISTS resolution_note text`,
]

try {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'posting_exceptions' ORDER BY ordinal_position`
  )
  const count = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM posting_exceptions`)
  console.log(`A9 DDL applied (${STATEMENTS.length} statements).`)
  console.log('  posting_exceptions columns:', rows.map((r) => r.column_name).join(','))
  console.log('  posting_exceptions rows:', count[0].n)
} finally {
  await prisma.$disconnect()
}
