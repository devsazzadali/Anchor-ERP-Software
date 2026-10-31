/**
 * Accounts A6 — targeted DDL for the payroll cycle.
 *
 * Additive only, idempotent (IF NOT EXISTS everywhere) so it is
 * safe to re-run. NEVER a full `prisma db push`: the
 * branch_cash_ledger.expected_closing_cash generated column must
 * not be touched.
 *
 * What this does:
 *  - creates `payroll_runs` (the monthly cycle header the system
 *    has never had — blueprint §B.1);
 *  - extends the DORMANT `payroll_sheets` (0 rows) with the run
 *    link + component columns the blueprint §B.1 prescribes, so
 *    per-employee run lines REUSE the dormant model instead of
 *    duplicating it;
 *  - drops the legacy UNIQUE(user_id, month_year) on
 *    payroll_sheets: it predates runs entirely and would make a
 *    second run for the same employee+month (e.g. after a voided
 *    run, or a run that also reviews an already-issued payment)
 *    impossible to record. The table is empty, so no data is at
 *    risk; the constraint is replaced by plain indexes. The run
 *    service enforces the real invariants (one blocking issued
 *    run per month) in code.
 *
 * Run:  node --env-file=.env.local scripts/accounts-a6-ddl.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const STATEMENTS = [
  // ── Payroll runs (A6) ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS payroll_runs (
     id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     month            text NOT NULL,
     status           text NOT NULL DEFAULT 'draft',
     total_gross      numeric(15,2) NOT NULL DEFAULT 0,
     total_deductions numeric(15,2) NOT NULL DEFAULT 0,
     total_net        numeric(15,2) NOT NULL DEFAULT 0,
     notes            text,
     created_by       uuid,
     approved_by      uuid,
     approved_at      timestamptz,
     issued_by        uuid,
     issued_at        timestamptz,
     voided_by        uuid,
     voided_at        timestamptz,
     void_reason      text,
     created_at       timestamptz NOT NULL DEFAULT now(),
     updated_at       timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS payroll_runs_month_idx ON payroll_runs (month)`,
  `CREATE INDEX IF NOT EXISTS payroll_runs_status_idx ON payroll_runs (status)`,

  // ── Payroll sheets: run link + components (A6) ───────────────
  `ALTER TABLE payroll_sheets ADD COLUMN IF NOT EXISTS payroll_run_id uuid`,
  `ALTER TABLE payroll_sheets ADD COLUMN IF NOT EXISTS employee_name text`,
  `ALTER TABLE payroll_sheets ADD COLUMN IF NOT EXISTS branch_id uuid`,
  `ALTER TABLE payroll_sheets ADD COLUMN IF NOT EXISTS basic numeric(15,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE payroll_sheets ADD COLUMN IF NOT EXISTS allowances numeric(15,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE payroll_sheets ADD COLUMN IF NOT EXISTS overtime numeric(15,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE payroll_sheets ADD COLUMN IF NOT EXISTS bonus numeric(15,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE payroll_sheets ADD COLUMN IF NOT EXISTS commission numeric(15,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE payroll_sheets ADD COLUMN IF NOT EXISTS tiffin numeric(15,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE payroll_sheets ADD COLUMN IF NOT EXISTS deduction_breakdown jsonb`,
  `ALTER TABLE payroll_sheets ADD COLUMN IF NOT EXISTS salary_payment_id uuid`,
  `ALTER TABLE payroll_sheets ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'run'`,
  `CREATE INDEX IF NOT EXISTS payroll_sheets_run_idx ON payroll_sheets (payroll_run_id)`,
  `CREATE INDEX IF NOT EXISTS payroll_sheets_payment_idx ON payroll_sheets (salary_payment_id)`,
  // The legacy pre-runs uniqueness (see header): replaced by a
  // plain lookup index.
  `DROP INDEX IF EXISTS payroll_sheets_user_id_month_year_key`,
  `CREATE INDEX IF NOT EXISTS payroll_sheets_user_month_idx ON payroll_sheets (user_id, month_year)`,
]

for (const sql of STATEMENTS) {
  await prisma.$executeRawUnsafe(sql)
  console.log('ok:', sql.split('\n')[0].slice(0, 90))
}
await prisma.$disconnect()
console.log('A6 DDL applied.')
