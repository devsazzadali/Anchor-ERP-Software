/**
 * Accounts A1 — targeted DDL for the Accounts module foundation.
 *
 * Creates ONLY the additive Accounts tables (blueprint §B.1 + the
 * opening-position store). Idempotent (IF NOT EXISTS everywhere) so
 * it is safe to re-run. NEVER a full `prisma db push`: the
 * branch_cash_ledger.expected_closing_cash generated column must not
 * be touched.
 *
 * Run:  node --env-file=.env.local scripts/accounts-a1-ddl.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS chart_accounts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     code text NOT NULL UNIQUE,
     name text NOT NULL,
     name_bn text,
     type text NOT NULL,
     parent_id uuid REFERENCES chart_accounts(id),
     branch_dimension boolean NOT NULL DEFAULT false,
     ledger_head_id uuid,
     is_system boolean NOT NULL DEFAULT false,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS fiscal_years (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     label text NOT NULL UNIQUE,
     start_date date NOT NULL,
     end_date date NOT NULL,
     is_current boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS accounting_periods (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     fiscal_year_id uuid NOT NULL REFERENCES fiscal_years(id),
     month text NOT NULL UNIQUE,
     start_date date NOT NULL,
     end_date date NOT NULL,
     status text NOT NULL DEFAULT 'open',
     closed_by uuid,
     closed_at timestamptz,
     lock_note text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS journal_entries (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     entry_date date NOT NULL,
     period_id uuid NOT NULL REFERENCES accounting_periods(id),
     source_table text,
     source_id uuid,
     event_type text NOT NULL,
     memo text,
     status text NOT NULL DEFAULT 'posted',
     is_reversal boolean NOT NULL DEFAULT false,
     reverses_entry_id uuid REFERENCES journal_entries(id),
     created_by uuid,
     posted_by uuid,
     posted_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (source_table, source_id, event_type)
   )`,
  `CREATE INDEX IF NOT EXISTS journal_entries_entry_date_idx ON journal_entries (entry_date)`,
  `CREATE INDEX IF NOT EXISTS journal_entries_period_id_idx ON journal_entries (period_id)`,
  `CREATE TABLE IF NOT EXISTS journal_lines (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     entry_id uuid NOT NULL REFERENCES journal_entries(id),
     account_id uuid NOT NULL REFERENCES chart_accounts(id),
     branch_id uuid,
     counterparty_id uuid,
     debit numeric(15,2) NOT NULL DEFAULT 0,
     credit numeric(15,2) NOT NULL DEFAULT 0,
     memo text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS journal_lines_entry_id_idx ON journal_lines (entry_id)`,
  `CREATE INDEX IF NOT EXISTS journal_lines_account_id_idx ON journal_lines (account_id)`,
  `CREATE TABLE IF NOT EXISTS bank_accounts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     label text NOT NULL,
     bank_name text NOT NULL,
     account_name text NOT NULL,
     account_number text,
     account_type text NOT NULL DEFAULT 'bank',
     chart_account_id uuid REFERENCES chart_accounts(id),
     opening_balance numeric(15,2),
     derived_hint numeric(15,2),
     is_draft boolean NOT NULL DEFAULT true,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS counterparties (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name text NOT NULL,
     type text NOT NULL DEFAULT 'other',
     phone text,
     address text,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS payables_receivables (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     counterparty_id uuid REFERENCES counterparties(id),
     direction text NOT NULL,
     source_table text,
     source_id uuid,
     description text NOT NULL,
     amount numeric(15,2) NOT NULL,
     paid_amount numeric(15,2) NOT NULL DEFAULT 0,
     due_date date,
     status text NOT NULL DEFAULT 'open',
     branch_id uuid,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (source_table, source_id, direction)
   )`,
  `CREATE TABLE IF NOT EXISTS tax_register_lines (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     period text NOT NULL,
     kind text NOT NULL,
     source_table text,
     source_id uuid,
     base_amount numeric(15,2) NOT NULL,
     rate numeric(7,4) NOT NULL,
     tax_amount numeric(15,2) NOT NULL,
     counterparty_id uuid REFERENCES counterparties(id),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS cheque_register (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     direction text NOT NULL,
     cheque_no text NOT NULL,
     bank_account_id uuid REFERENCES bank_accounts(id),
     counterparty_id uuid REFERENCES counterparties(id),
     amount numeric(15,2) NOT NULL,
     issue_date date,
     due_date date,
     status text NOT NULL DEFAULT 'pending',
     cleared_at timestamptz,
     source_table text,
     source_id uuid,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS opening_positions (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     label text NOT NULL,
     as_of_date date NOT NULL,
     status text NOT NULL DEFAULT 'draft',
     computed_at timestamptz NOT NULL DEFAULT now(),
     confirmed_by uuid,
     confirmed_at timestamptz,
     notes text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS opening_position_lines (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     position_id uuid NOT NULL REFERENCES opening_positions(id),
     component text NOT NULL,
     label text NOT NULL,
     amount numeric(15,2) NOT NULL,
     side text NOT NULL,
     branch_id uuid,
     bank_account_id uuid,
     source_note text,
     detail jsonb,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS opening_position_lines_position_id_idx ON opening_position_lines (position_id)`,
]

const TABLES = [
  'chart_accounts', 'fiscal_years', 'accounting_periods', 'journal_entries',
  'journal_lines', 'bank_accounts', 'counterparties', 'payables_receivables',
  'tax_register_lines', 'cheque_register', 'opening_positions',
  'opening_position_lines',
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
  }
  console.log(`DDL applied: ${STATEMENTS.length} statements`)
  for (const t of TABLES) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM ${t}`
    )
    console.log(`  ${t}: exists, ${rows[0].n} rows`)
  }
  // Invariant spot-check: the generated column is untouched.
  const gen = await prisma.$queryRawUnsafe(
    `SELECT is_generated FROM information_schema.columns
      WHERE table_name = 'branch_cash_ledger' AND column_name = 'expected_closing_cash'`
  )
  console.log(`  branch_cash_ledger.expected_closing_cash is_generated = ${gen[0]?.is_generated}`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
