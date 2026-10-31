/**
 * Accounts A4 — targeted DDL for bank accounts, statement import
 * and bank reconciliation.
 *
 * Additive only, idempotent (IF NOT EXISTS everywhere) so it is
 * safe to re-run. NEVER a full `prisma db push`: the
 * branch_cash_ledger.expected_closing_cash generated column must
 * not be touched.
 *
 * Run:  node --env-file=.env.local scripts/accounts-a4-ddl.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const STATEMENTS = [
  // ── Bank opening-balance date (A4) ─────────────────────────────
  // The date the confirmed opening_balance is stated at; statement
  // balances derived as opening + lines are summed from this date.
  `ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS opening_balance_date date`,

  // ── Statement import batches (A4) ──────────────────────────────
  // One row per CSV import: counts + the full per-row error report
  // so a partial import is auditable, never silent.
  `CREATE TABLE IF NOT EXISTS bank_import_batches (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     bank_account_id uuid NOT NULL,
     file_name text,
     total_rows int NOT NULL DEFAULT 0,
     imported_rows int NOT NULL DEFAULT 0,
     error_rows int NOT NULL DEFAULT 0,
     error_report jsonb,
     created_by uuid,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  // ── Bank statement lines (A4) ──────────────────────────────────
  // External evidence lines imported from a bank statement (or
  // keyed in by hand). They NEVER write journal entries; they are
  // matched 1:1 against journal lines on the account's chart
  // account (the partial unique index enforces the 1:1).
  `CREATE TABLE IF NOT EXISTS bank_statement_lines (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     bank_account_id uuid NOT NULL,
     statement_date date NOT NULL,
     description text NOT NULL,
     reference text,
     debit numeric(15,2) NOT NULL DEFAULT 0,
     credit numeric(15,2) NOT NULL DEFAULT 0,
     balance numeric(15,2),
     import_batch_id uuid,
     match_status text NOT NULL DEFAULT 'unmatched',
     matched_journal_line_id uuid,
     matched_entry_id uuid,
     matched_deposit_id uuid,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_lines_journal_line_key
     ON bank_statement_lines (matched_journal_line_id)
     WHERE matched_journal_line_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS bank_statement_lines_account_idx
     ON bank_statement_lines (bank_account_id, statement_date)`,
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
