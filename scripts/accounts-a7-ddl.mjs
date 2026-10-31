/**
 * Accounts A7 — targeted DDL for the VAT/TDS register.
 *
 * Additive only, idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING
 * everywhere) so it is safe to re-run. NEVER a full `prisma db push`:
 * the branch_cash_ledger.expected_closing_cash generated column must
 * not be touched.
 *
 * What this does:
 *  - creates `tax_settings` — the config table for the four tax
 *    types (VAT_OUTPUT, VAT_INPUT, TDS_SALARY, TDS_PAYMENT) — and
 *    seeds one row per type, ALL DISABLED with NO rate and NO
 *    effective date (the dormant state: with the shipped config the
 *    module records no tax anywhere). Rates are entered by the
 *    owner/CA in the Accounts → VAT & TDS screen; no statutory rate
 *    is seeded or hard-coded anywhere (blueprint decision D4).
 *    The payable legs point at the CoA's existing tax accounts
 *    (2030 VAT Payable, 2040 TDS Payable — seeded in A1); the
 *    VAT-output offset points at 4000 Sales Revenue (the VAT part
 *    of recorded sales is not revenue). Both links stay editable
 *    in the settings screen.
 *  - extends `tax_register_lines` (created EMPTY in A1) with the
 *    journal-entry link A7's lines must carry and a status column
 *    ('active' | 'reversed') so a reversed tax posting leaves an
 *    honest trace instead of a deleted row, plus a partial UNIQUE
 *    index keeping at most one ACTIVE line per (source, kind) —
 *    the register-side idempotency twin of the journal's unique
 *    (source_table, source_id, event_type) key.
 *  - adds `company_expenses.vat_bearing` (default false) — the
 *    admin-set flag that makes an expense's VAT claimable as input
 *    VAT. Nothing is auto-flagged: historical rows all read false.
 *
 * Run:  node --env-file=.env.local scripts/accounts-a7-ddl.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const STATEMENTS = [
  // ── Tax settings (A7) ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS tax_settings (
     id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     tax_type           text NOT NULL UNIQUE,
     label              text NOT NULL,
     rate_percent       numeric(7,4),
     effective_from     date,
     is_enabled         boolean NOT NULL DEFAULT false,
     payable_account_id uuid REFERENCES chart_accounts(id),
     offset_account_id  uuid REFERENCES chart_accounts(id),
     notes              text,
     created_at         timestamptz NOT NULL DEFAULT now(),
     updated_at         timestamptz NOT NULL DEFAULT now()
   )`,
  `INSERT INTO tax_settings (tax_type, label, payable_account_id, offset_account_id)
   SELECT 'VAT_OUTPUT', 'VAT — Output (on chalan sales)',
          (SELECT id FROM chart_accounts WHERE code = '2030'),
          (SELECT id FROM chart_accounts WHERE code = '4000')
   ON CONFLICT (tax_type) DO NOTHING`,
  `INSERT INTO tax_settings (tax_type, label, payable_account_id, offset_account_id)
   SELECT 'VAT_INPUT', 'VAT — Input (on VAT-bearing company expenses)',
          (SELECT id FROM chart_accounts WHERE code = '2030'),
          NULL
   ON CONFLICT (tax_type) DO NOTHING`,
  `INSERT INTO tax_settings (tax_type, label, payable_account_id, offset_account_id)
   SELECT 'TDS_SALARY', 'TDS — Salary (withheld at issue)',
          (SELECT id FROM chart_accounts WHERE code = '2040'),
          NULL
   ON CONFLICT (tax_type) DO NOTHING`,
  `INSERT INTO tax_settings (tax_type, label, payable_account_id, offset_account_id)
   SELECT 'TDS_PAYMENT', 'TDS — Payments (withheld on settlements)',
          (SELECT id FROM chart_accounts WHERE code = '2040'),
          NULL
   ON CONFLICT (tax_type) DO NOTHING`,

  // ── Register line extensions (A7) ────────────────────────────
  `ALTER TABLE tax_register_lines ADD COLUMN IF NOT EXISTS journal_entry_id uuid`,
  `ALTER TABLE tax_register_lines ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`,
  `CREATE INDEX IF NOT EXISTS tax_register_lines_period_idx
     ON tax_register_lines (period, kind)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tax_register_lines_active_source_key
     ON tax_register_lines (source_table, source_id, kind)
     WHERE status = 'active'`,

  // ── Company-expense VAT flag (A7) ────────────────────────────
  `ALTER TABLE company_expenses ADD COLUMN IF NOT EXISTS vat_bearing boolean NOT NULL DEFAULT false`,
]

try {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT tax_type, is_enabled, rate_percent::text AS rate, effective_from::text AS eff
       FROM tax_settings ORDER BY tax_type`
  )
  console.log(`A7 DDL applied (${STATEMENTS.length} statements). tax_settings:`)
  for (const r of rows) {
    console.log(`  ${r.tax_type}: enabled=${r.is_enabled} rate=${r.rate} effective_from=${r.eff}`)
  }
} finally {
  await prisma.$disconnect()
}
