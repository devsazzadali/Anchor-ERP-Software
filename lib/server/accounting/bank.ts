/**
 * Accounts A4 — bank master service (lib/server/accounting/bank.ts).
 *
 * Bank accounts are the bridge between the operational deposit
 * module and the journal: every bank account row links to exactly
 * one chart account under 1010 (Bank Accounts), created with the
 * seed.ts seedBankCandidates pattern — next free code ≥ 1011,
 * name `Bank — <bank_name>`, is_system true.
 *
 * Laws:
 *  - A bank account row NEVER gets a second chart account: update
 *    links one only when chart_account_id is NULL.
 *  - New accounts are born DRAFT with opening_balance NULL; the
 *    opening balance becomes real only via confirmBankOpening
 *    (owner-confirmed figure + the date it is stated at).
 *  - Errors carry an HTTP-ish `status` for the route to surface
 *    (the PeriodsError pattern).
 */
import { type Db } from './post'

export class BankError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'BankError'
    this.status = status
  }
}

const dateStr = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null
const moneyStr = (v: unknown): string | null =>
  v == null ? null : (v as any).toString()

export interface BankAccountListItem {
  id: string
  label: string
  bank_name: string
  account_name: string
  account_number: string | null
  account_type: string
  chart_account_id: string | null
  chart_code: string | null
  opening_balance: string | null
  opening_balance_date: string | null
  derived_hint: string | null
  is_draft: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export function bankAccountShape(row: any, chartCode: string | null): BankAccountListItem {
  return {
    id: row.id,
    label: row.label,
    bank_name: row.bank_name,
    account_name: row.account_name,
    account_number: row.account_number ?? null,
    account_type: row.account_type,
    chart_account_id: row.chart_account_id ?? null,
    chart_code: chartCode,
    opening_balance: moneyStr(row.opening_balance),
    opening_balance_date: dateStr(row.opening_balance_date),
    derived_hint: moneyStr(row.derived_hint),
    is_draft: !!row.is_draft,
    is_active: !!row.is_active,
    created_at: row.created_at?.toISOString?.() ?? String(row.created_at),
    updated_at: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  }
}

export async function loadBankAccount(db: Db, id: string): Promise<any> {
  const row = await db.bankAccount.findUnique({ where: { id } })
  if (!row) throw new BankError(404, 'Bank account not found')
  return row
}

export async function listBankAccounts(db: Db): Promise<BankAccountListItem[]> {
  const rows = await db.bankAccount.findMany({ orderBy: { created_at: 'asc' } })
  const chartIds = rows.map((r: any) => r.chart_account_id).filter(Boolean)
  const charts = chartIds.length
    ? await db.chartAccount.findMany({ where: { id: { in: chartIds } }, select: { id: true, code: true } })
    : []
  const codeOf = new Map<string, string>(charts.map((c: any) => [c.id, c.code]))
  return rows.map((r: any) => bankAccountShape(r, r.chart_account_id ? codeOf.get(r.chart_account_id) ?? null : null))
}

/**
 * Create the chart account for a bank under parent 1010 — the
 * seed.ts pattern: next free code ≥ 1011 scanning ALL used codes,
 * name `Bank — <bank_name>`, type asset, is_system true.
 */
export async function createBankChartAccount(db: Db, bankName: string): Promise<any> {
  const parent = await db.chartAccount.findUnique({ where: { code: '1010' } })
  const usedCodes = new Set(
    (await db.chartAccount.findMany({ select: { code: true } })).map((a: any) => a.code)
  )
  let nextCode = 1011
  while (usedCodes.has(String(nextCode))) nextCode++
  return db.chartAccount.create({
    data: {
      code: String(nextCode),
      name: `Bank — ${bankName}`,
      type: 'asset',
      parent_id: parent?.id ?? null,
      is_system: true,
      is_active: true,
    },
  })
}

export interface CreateBankAccountInput {
  bank_name: string
  account_name: string
  account_number?: string | null
  account_type?: string | null
  label?: string | null
}

export async function createBankAccount(db: Db, input: CreateBankAccountInput) {
  const bankName = String(input.bank_name ?? '').trim()
  const accountName = String(input.account_name ?? '').trim()
  if (!bankName) throw new BankError(400, 'bank_name is required')
  if (!accountName) throw new BankError(400, 'account_name is required')
  const chart = await createBankChartAccount(db, bankName)
  const row = await db.bankAccount.create({
    data: {
      label: String(input.label ?? '').trim() || `${bankName} · ${accountName}`,
      bank_name: bankName,
      account_name: accountName,
      account_number: input.account_number ? String(input.account_number).trim() : null,
      account_type: input.account_type ? String(input.account_type).trim() : 'bank',
      chart_account_id: chart.id,
      opening_balance: null,
      is_draft: true,
      is_active: true,
    },
  })
  return row
}

export interface UpdateBankAccountInput {
  label?: string | null
  bank_name?: string | null
  account_name?: string | null
  account_number?: string | null
  account_type?: string | null
  is_active?: boolean | null
}

/**
 * Edit the descriptive fields. If the row has no chart account yet,
 * create + link one (the seed pattern); if it already has one, it is
 * NEVER given another — re-saves cannot duplicate chart accounts.
 */
export async function updateBankAccount(db: Db, id: string, fields: UpdateBankAccountInput) {
  const before = await loadBankAccount(db, id)
  const data: Record<string, unknown> = {}
  if (fields.label !== undefined) data.label = fields.label == null ? before.label : String(fields.label).trim() || before.label
  if (fields.bank_name !== undefined && fields.bank_name != null) {
    const v = String(fields.bank_name).trim()
    if (!v) throw new BankError(400, 'bank_name cannot be empty')
    data.bank_name = v
  }
  if (fields.account_name !== undefined && fields.account_name != null) {
    const v = String(fields.account_name).trim()
    if (!v) throw new BankError(400, 'account_name cannot be empty')
    data.account_name = v
  }
  if (fields.account_number !== undefined) {
    data.account_number = fields.account_number == null ? null : String(fields.account_number).trim() || null
  }
  if (fields.account_type !== undefined && fields.account_type != null) {
    data.account_type = String(fields.account_type).trim() || before.account_type
  }
  if (fields.is_active !== undefined && fields.is_active != null) data.is_active = !!fields.is_active
  if (!before.chart_account_id) {
    const chart = await createBankChartAccount(db, (data.bank_name as string) ?? before.bank_name)
    data.chart_account_id = chart.id
  }
  data.updated_at = new Date()
  const after = await db.bankAccount.update({ where: { id }, data })
  return { before, after }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Owner confirmation of the opening balance: draft → confirmed. */
export async function confirmBankOpening(
  db: Db,
  id: string,
  input: { opening_balance: unknown; opening_balance_date: unknown }
) {
  const before = await loadBankAccount(db, id)
  const balStr = input.opening_balance == null ? '' : String(input.opening_balance).trim()
  if (!balStr || !/^-?\d+(\.\d{1,2})?$/.test(balStr)) {
    throw new BankError(400, 'opening_balance must be a valid amount')
  }
  const bal = Number(balStr)
  if (!Number.isFinite(bal) || bal < 0) {
    throw new BankError(400, 'opening_balance must be ≥ 0')
  }
  const date = String(input.opening_balance_date ?? '').trim()
  if (!isRealDate(date)) {
    throw new BankError(400, 'opening_balance_date must be a real date (YYYY-MM-DD)')
  }
  const after = await db.bankAccount.update({
    where: { id },
    data: {
      opening_balance: bal.toFixed(2),
      opening_balance_date: new Date(`${date}T00:00:00Z`),
      is_draft: false,
      updated_at: new Date(),
    },
  })
  return { before, after }
}
