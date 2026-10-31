/**
 * Accounts A1 — seeds: fiscal year + periods, the starter Chart of
 * Accounts (blueprint decision D2), and DRAFT bank-account
 * candidates derived from deposit history (decision D3).
 *
 * Everything here is idempotent and conservative: existing rows are
 * never overwritten (an admin may have renamed an account), seeds
 * only fill gaps. Bank candidates are born DRAFT with
 * opening_balance NULL — the derived figure is a hint from deposit
 * history, never a confirmed balance.
 */
import { type Db } from './post'

const n = (v: unknown): number => (v == null ? 0 : Number((v as any).toString()))

interface SeedAccount {
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  parent_code?: string
  branch_dimension?: boolean
  ledger_head_id?: string | null
}

const BASE_ACCOUNTS: SeedAccount[] = [
  // Assets
  { code: '1000', name: 'Cash in Hand — Branches', type: 'asset', branch_dimension: true },
  { code: '1005', name: 'Cash — Head Office', type: 'asset' },
  { code: '1010', name: 'Bank Accounts', type: 'asset' },
  { code: '1019', name: 'Bank — Unallocated (to confirm)', type: 'asset', parent_code: '1010' },
  { code: '1020', name: 'MFS & Card Clearing', type: 'asset' },
  { code: '1030', name: 'Cash in Transit', type: 'asset' },
  { code: '1040', name: 'Inventory', type: 'asset', branch_dimension: true },
  { code: '1050', name: 'Accounts Receivable', type: 'asset' },
  { code: '1060', name: 'Advances & Prepayments', type: 'asset' },
  { code: '1070', name: 'Fixed Assets', type: 'asset' },
  { code: '1080', name: 'Accumulated Depreciation', type: 'asset' },
  // Liabilities
  { code: '2000', name: 'Accounts Payable', type: 'liability' },
  { code: '2010', name: 'Salary Payable', type: 'liability' },
  { code: '2020', name: 'Rent & Utilities Payable', type: 'liability' },
  { code: '2030', name: 'VAT Payable', type: 'liability' },
  { code: '2040', name: 'TDS Payable', type: 'liability' },
  // Equity
  { code: '3000', name: 'Owner Capital', type: 'equity' },
  { code: '3010', name: 'Retained Earnings', type: 'equity' },
  { code: '3020', name: 'Partner Capital', type: 'equity' },
  { code: '3030', name: 'Partner Drawings', type: 'equity' },
  // Income
  { code: '4000', name: 'Sales Revenue', type: 'income', branch_dimension: true },
  { code: '4010', name: 'Other Income', type: 'income' },
  // Expenses (non-head)
  { code: '5000', name: 'Cost of Goods Sold', type: 'expense' },
  { code: '5200', name: 'Company Operating Expenses', type: 'expense' },
  { code: '5210', name: 'Company Setup & Pre-opening Expenses', type: 'expense' },
  { code: '5300', name: 'Branch Operating Expenses', type: 'expense', branch_dimension: true },
  { code: '5350', name: 'Employee Expense Requests', type: 'expense' },
  { code: '5400', name: 'Cash Shortage', type: 'expense', branch_dimension: true },
]

/** FY2026-27 (Bangladesh tax year, decision D1) + its 12 periods. */
export async function seedFiscal(db: Db): Promise<{ fy: string; periods: number }> {
  let fy = await db.fiscalYear.findUnique({ where: { label: 'FY2026-27' } })
  if (!fy) {
    fy = await db.fiscalYear.create({
      data: {
        label: 'FY2026-27',
        start_date: new Date('2026-07-01T00:00:00Z'),
        end_date: new Date('2027-06-30T00:00:00Z'),
        is_current: true,
      },
    })
  }
  let periods = 0
  for (let m = 0; m < 12; m++) {
    const start = new Date(Date.UTC(2026, 6 + m, 1)) // Jul 2026 .. Jun 2027
    const end = new Date(Date.UTC(2026, 6 + m + 1, 0))
    const month = start.toISOString().slice(0, 7)
    const existing = await db.accountingPeriod.findUnique({ where: { month } })
    if (!existing) {
      await db.accountingPeriod.create({
        data: { fiscal_year_id: fy.id, month, start_date: start, end_date: end, status: 'open' },
      })
      periods++
    }
  }
  return { fy: fy.label, periods }
}

/**
 * Starter CoA: the base set + one expense account per existing
 * ledger head (27), linked via ledger_head_id for the P3 leg. The
 * Salary - Basic head maps to 5010 (the P5 account).
 */
export async function seedChartOfAccounts(db: Db): Promise<{ created: string[]; existing: number }> {
  const heads = await db.ledgerHead.findMany({ orderBy: { code_number: 'asc' } })
  const accounts: SeedAccount[] = [...BASE_ACCOUNTS]
  for (const h of heads) {
    const isSalaryBasic = /salary\s*-\s*basic/i.test(h.name)
    accounts.push({
      code: isSalaryBasic ? '5010' : String(5100 + h.code_number),
      name: h.name,
      type: 'expense',
      branch_dimension: true,
      ledger_head_id: h.id,
    })
  }
  const created: string[] = []
  let existing = 0
  const idByCode = new Map<string, string>()
  // Parents first so parent_id resolves in one pass.
  const sorted = [...accounts].sort((a, b) => (a.parent_code ? 1 : 0) - (b.parent_code ? 1 : 0))
  for (const a of sorted) {
    const found = await db.chartAccount.findUnique({ where: { code: a.code } })
    if (found) {
      existing++
      idByCode.set(a.code, found.id)
      continue
    }
    const row = await db.chartAccount.create({
      data: {
        code: a.code,
        name: a.name,
        type: a.type,
        parent_id: a.parent_code ? idByCode.get(a.parent_code) ?? null : null,
        branch_dimension: !!a.branch_dimension,
        ledger_head_id: a.ledger_head_id ?? null,
        is_system: true,
        is_active: true,
      },
    })
    idByCode.set(a.code, row.id)
    created.push(`${a.code} ${a.name}`)
  }
  return { created, existing }
}

/**
 * DRAFT bank candidates from approved-deposit history: one per
 * distinct bank_account_name on approved deposits, each with its
 * own chart account under 1010 and derived_hint = Σ approved
 * deposits to it. opening_balance stays NULL (owner confirms).
 */
export async function seedBankCandidates(db: Db): Promise<{ created: string[]; existing: number }> {
  const deposits = await db.branchBankDeposit.findMany({
    where: { status: 'approved' },
    select: { bank_account_name: true, bank_account_number: true, amount: true },
  })
  const groups = new Map<string, { sum: number; count: number; number: string | null }>()
  for (const d of deposits) {
    const key = d.bank_account_name
    const g = groups.get(key) ?? { sum: 0, count: 0, number: d.bank_account_number ?? null }
    g.sum += n(d.amount)
    g.count++
    groups.set(key, g)
  }
  const parent = await db.chartAccount.findUnique({ where: { code: '1010' } })
  const created: string[] = []
  let existing = 0
  let nextCode = 1011
  const usedCodes = new Set(
    (await db.chartAccount.findMany({ select: { code: true } })).map((a: any) => a.code)
  )
  for (const [rawName, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sep = rawName.indexOf(' — ')
    const accountName = sep >= 0 ? rawName.slice(0, sep).trim() : rawName.trim()
    const bankName = sep >= 0 ? rawName.slice(sep + 3).trim() : rawName.trim()
    const found = await db.bankAccount.findFirst({
      where: { bank_name: bankName, account_name: accountName },
    })
    if (found) {
      existing++
      continue
    }
    while (usedCodes.has(String(nextCode))) nextCode++
    const code = String(nextCode++)
    usedCodes.add(code)
    const chart = await db.chartAccount.create({
      data: {
        code,
        name: `Bank — ${bankName}`,
        type: 'asset',
        parent_id: parent?.id ?? null,
        is_system: true,
        is_active: true,
      },
    })
    await db.bankAccount.create({
      data: {
        label: `${bankName} · ${accountName}`,
        bank_name: bankName,
        account_name: accountName,
        account_number: g.number,
        account_type: 'bank',
        chart_account_id: chart.id,
        opening_balance: null,
        derived_hint: g.sum.toFixed(2),
        is_draft: true,
        is_active: true,
      },
    })
    created.push(`${code} ${bankName} (hint ৳${g.sum.toFixed(2)} from ${g.count} approved deposits)`)
  }
  return { created, existing }
}
