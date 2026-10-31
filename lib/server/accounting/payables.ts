/**
 * Accounts A5 — counterparties, the payables/receivables register,
 * ageing and settlements (lib/server/accounting/payables.ts).
 *
 * The register is a MIRROR of obligations the source modules
 * already record — derived, never re-entered (blueprint §B, stage
 * A5; A1 decision: existing dues are mirrored by sync, not typed
 * in again). Sync is idempotent: register rows upsert on
 * (source_table, source_id, direction), counterparties on their
 * source link.
 *
 * Which classes the data genuinely supports (probe 2026-10-31):
 *  - company_expenses      — 4 rows carry due_amount > 0,
 *    Σ ৳14,461.01, EXACTLY the journal's Accounts Payable (2000)
 *    balance. This is the one JOURNAL-BACKED class: its creation
 *    posting credited AP, so its settlements post Dr 2000 /
 *    Cr paid-via through the A1 engine and update the source
 *    row's paid/due — the same state the module's own pay path
 *    maintains (hookCompanyPaidChange reads the settlement
 *    registry, so the two paths can never double-post; proven in
 *    the A5 harness).
 *  - employee_expense_requests — approved-but-unpaid requests are
 *    obligations, but the module owns their pay path (approval →
 *    pay posts P6 and books the branch mirror). An A5 settlement
 *    here is therefore EXTERNAL only: mandatory note, no journal
 *    entry, the source row is stamped in admin_notes — never a
 *    second money path. (Today: zero approved-unpaid rows exist.)
 *  - payment_requests (partner payouts) — same external-only rule;
 *    the payouts module owns completion (P9). (Today: the table
 *    is empty.)
 *  - branch_cash_expenses — rows with due_amount > 0 (excluding
 *    salary/request mirrors, which are not obligations). The
 *    P2/P3 posting settles the full amount centrally at record
 *    time, so a due here is a memorandum item: external settle
 *    updates the source row's own paid/due fields — the module's
 *    own state — with no journal entry. (Today: zero rows.)
 *  - salary_payments — payments are born 'paid'; no unpaid or
 *    partial salary is recorded anywhere, so the class derives
 *    ZERO items (A6's payroll runs are its future source). Staff
 *    counterparties still derive from salary recipients.
 *  - receivables — no advances or credit sales are recorded in
 *    any source table (probe: zero advance rows anywhere), so
 *    the register's receivable side is an honest empty state.
 *
 * Ageing uses the source date as the due date — no source table
 * records a contractual due date (blueprint: "due date (or
 * source date)").
 */
import { randomUUID } from 'crypto'
import { dhakaDateOf, dhakaToday } from '../../dhaka-time'
import { isPeriodBlockedError, postEvent, poishaToDecimalString, uuidFromString, type Db } from './post'
import { ACCT } from './events'
import { toPoishaExact, taka } from './reports'
import { recordPostingException } from './exceptions'
import { effectiveTax, computeTaxPoisha, registerLineData } from './tax'

export class PayableError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'PayableError'
    this.status = status
  }
}

const dec = (poisha: number): string => poishaToDecimalString(poisha)
const dateOf = (d: Date): string => d.toISOString().slice(0, 10)

export const CLASS_META: Record<string, { label: string; journal_backed: boolean; note: string }> = {
  company_expenses: {
    label: 'Company expenses',
    journal_backed: true,
    note: 'Due balances credited to Accounts Payable (2000) at record time — settlements post to the journal.',
  },
  employee_expense_requests: {
    label: 'Expense requests (approved, unpaid)',
    journal_backed: false,
    note: 'The module owns the pay path (P6) — Accounts records external settlements only, with a mandatory note.',
  },
  payment_requests: {
    label: 'Partner payout requests',
    journal_backed: false,
    note: 'The payouts module owns completion (P9) — Accounts records external settlements only, with a mandatory note.',
  },
  branch_cash_expenses: {
    label: 'Branch expenses — rent & bills due',
    journal_backed: false,
    note: 'Booked in full centrally at record time (P2/P3) — dues are memorandum items settled against the source row.',
  },
  salary_payments: {
    label: 'Salary payable',
    journal_backed: false,
    note: 'Salary payments are recorded when paid — no unpaid salary exists in the data (A6 payroll will feed this class).',
  },
}

// ── Counterparties ────────────────────────────────────────────────

const UNRECORDED_PARTY_NAME = 'Unrecorded payee (company expenses)'

async function upsertParty(
  db: Db,
  args: {
    source_table: string | null
    source_id: string | null
    name: string
    type: string
    phone?: string | null
    is_active?: boolean
  }
): Promise<any> {
  const existing = args.source_id
    ? await db.counterparty.findFirst({
        where: { source_table: args.source_table, source_id: args.source_id },
      })
    : await db.counterparty.findFirst({ where: { name: args.name, type: args.type, source_id: null } })
  if (existing) {
    if (!existing.edited_manually) {
      const patch: Record<string, unknown> = {}
      if (existing.name !== args.name) patch.name = args.name
      if (args.phone && existing.phone !== args.phone) patch.phone = args.phone
      if (Object.keys(patch).length) {
        return db.counterparty.update({ where: { id: existing.id }, data: patch })
      }
    }
    return existing
  }
  return db.counterparty.create({
    data: {
      name: args.name,
      type: args.type,
      phone: args.phone ?? null,
      source_table: args.source_table,
      source_id: args.source_id,
      is_active: args.is_active ?? true,
    },
  })
}

/** The party for a profile id (employee / requester / partner). */
export async function ensureProfileParty(db: Db, profileId: string, fallbackName?: string | null): Promise<any> {
  const profile = await db.profile.findUnique({ where: { id: profileId } })
  return upsertParty(db, {
    source_table: 'profiles',
    source_id: profileId,
    name: profile?.full_name ?? fallbackName ?? 'Unknown (profile removed)',
    type: profile?.profile_type === 'partner' ? 'partner' : 'staff',
    phone: profile?.phone_number ?? null,
  })
}

/** The single party company-expense dues hang on — the source rows
 * record no payee (purposes are fragments), so inventing vendor
 * names would fabricate data. */
export async function ensureUnrecordedParty(db: Db): Promise<any> {
  return upsertParty(db, {
    source_table: null,
    source_id: null,
    name: UNRECORDED_PARTY_NAME,
    type: 'other',
  })
}

export async function syncCounterparties(db: Db): Promise<{ total: number; by_type: Record<string, number> }> {
  // Staff + partners: salary recipients ∪ expense requesters ∪
  // partner-type profiles.
  const salaryEmps = await db.salaryPayment.findMany({ select: { employee_id: true }, distinct: ['employee_id'] })
  const requests = await db.employeeExpenseRequest.findMany({ select: { employee_id: true, employee_name: true } })
  const nameOf = new Map<string, string>()
  for (const r of requests) if (r.employee_name) nameOf.set(r.employee_id, r.employee_name)
  const partnerProfiles = await db.profile.findMany({ where: { profile_type: 'partner' }, select: { id: true } })
  const ids = new Set<string>([
    ...salaryEmps.map((r: any) => r.employee_id),
    ...requests.map((r: any) => r.employee_id),
    ...partnerProfiles.map((r: any) => r.id),
  ])
  for (const id of ids) await ensureProfileParty(db, id, nameOf.get(id) ?? null)

  // Landlords: the house-rent account master (account_name is the
  // landlord's account name; the branch's landlord).
  const rents = await db.houseRentAccount.findMany()
  for (const r of rents) {
    await upsertParty(db, {
      source_table: 'house_rent_accounts',
      source_id: r.id,
      name: r.account_name || 'Landlord (name not recorded)',
      type: 'landlord',
      phone: r.mobile_banking_number ?? null,
      is_active: r.is_active ?? true,
    })
  }

  await ensureUnrecordedParty(db)

  const all = await db.counterparty.findMany({ select: { type: true } })
  const by_type: Record<string, number> = {}
  for (const p of all) by_type[p.type] = (by_type[p.type] ?? 0) + 1
  return { total: all.length, by_type }
}

// ── Register derivation ───────────────────────────────────────────

interface ItemData {
  counterparty_id: string | null
  description: string
  amount_p: number
  paid_p: number
  due_date: string
  branch_id: string | null
}

function statusOf(amount_p: number, paid_p: number): string {
  if (amount_p > 0 && paid_p >= amount_p) return 'settled'
  if (paid_p > 0) return 'partial'
  return 'open'
}

async function findItem(db: Db, source_table: string, source_id: string): Promise<any | null> {
  return db.payableReceivable.findFirst({
    where: { source_table, source_id, direction: 'payable' },
  })
}

async function settlementsSum(db: Db, itemId: string, modes: string[]): Promise<number> {
  const rows = await db.payableSettlement.findMany({
    where: { payable_id: itemId, mode: { in: modes } },
    select: { amount: true },
  })
  return rows.reduce((a: number, r: any) => a + toPoishaExact(r.amount), 0)
}

async function upsertItem(db: Db, source_table: string, source_id: string, data: ItemData): Promise<any> {
  const base = {
    counterparty_id: data.counterparty_id,
    description: data.description,
    amount: dec(data.amount_p),
    paid_amount: dec(Math.min(data.paid_p, data.amount_p)),
    due_date: new Date(`${data.due_date}T00:00:00Z`),
    status: statusOf(data.amount_p, data.paid_p),
    branch_id: data.branch_id,
  }
  const existing = await findItem(db, source_table, source_id)
  if (existing) {
    return db.payableReceivable.update({ where: { id: existing.id }, data: base })
  }
  return db.payableReceivable.create({
    data: { direction: 'payable', source_table, source_id, ...base },
  })
}

/** Remove a mirror whose source left its class — only when no
 * settlement history hangs on it (history is never deleted). */
async function dropItemIfOrphaned(db: Db, source_table: string, source_id: string): Promise<void> {
  const existing = await findItem(db, source_table, source_id)
  if (!existing) return
  const count = await db.payableSettlement.count({ where: { payable_id: existing.id } })
  if (count === 0) await db.payableReceivable.delete({ where: { id: existing.id } })
}

async function deriveCeItem(db: Db, row: any): Promise<any | null> {
  const existing = await findItem(db, 'company_expenses', row.id)
  const due_p = toPoishaExact(row.due_amount)
  if (due_p <= 0 && !existing) return null
  const party = await ensureUnrecordedParty(db)
  return upsertItem(db, 'company_expenses', row.id, {
    counterparty_id: party.id,
    description: `Company expense — ${String(row.purpose ?? '').trim() || 'purpose not recorded'}`,
    amount_p: toPoishaExact(row.total_amount),
    paid_p: toPoishaExact(row.paid_amount),
    due_date: dhakaDateOf(row.created_at),
    branch_id: row.branch_id ?? null,
  })
}

async function deriveErItem(db: Db, row: any): Promise<any | null> {
  const existing = await findItem(db, 'employee_expense_requests', row.id)
  if (row.status !== 'approved' && !existing) return null
  if (row.status !== 'approved' && row.status !== 'paid') {
    // Pending/rejected: not (or no longer) an obligation.
    await dropItemIfOrphaned(db, 'employee_expense_requests', row.id)
    return null
  }
  const amount_p = toPoishaExact(row.amount)
  const paid_p =
    row.status === 'paid' ? amount_p : existing ? await settlementsSum(db, existing.id, ['external']) : 0
  const party = await ensureProfileParty(db, row.employee_id, row.employee_name)
  return upsertItem(db, 'employee_expense_requests', row.id, {
    counterparty_id: party.id,
    description: `Expense request — ${row.title}`,
    amount_p,
    paid_p,
    due_date: dhakaDateOf(row.created_at),
    branch_id: row.branch_id ?? null,
  })
}

async function derivePrItem(db: Db, row: any): Promise<any | null> {
  const existing = await findItem(db, 'payment_requests', row.id)
  const open = row.status === 'pending' || row.status === 'approved'
  if (!open && !existing) return null
  if (!open && row.status !== 'completed') {
    await dropItemIfOrphaned(db, 'payment_requests', row.id)
    return null
  }
  const amount_p = toPoishaExact(row.amount)
  const paid_p =
    row.status === 'completed' ? amount_p : existing ? await settlementsSum(db, existing.id, ['external']) : 0
  const party = await ensureProfileParty(db, row.user_id)
  return upsertItem(db, 'payment_requests', row.id, {
    counterparty_id: party.id,
    description: `Partner payout — ${row.invoice_title}`,
    amount_p,
    paid_p,
    due_date: dhakaDateOf(row.created_at),
    branch_id: null,
  })
}

async function deriveBceItem(db: Db, row: any): Promise<any | null> {
  const existing = await findItem(db, 'branch_cash_expenses', row.id)
  const due_p = toPoishaExact(row.due_amount)
  // Mirror rows (salary / expense-request copies) are not
  // obligations of their own — their sources carry them.
  const qualifies = due_p > 0 && !row.salary_payment_id && !row.expense_request_id
  if (!qualifies && !existing) return null
  if (!qualifies) {
    await dropItemIfOrphaned(db, 'branch_cash_expenses', row.id)
    return null
  }
  const party = row.manager_id ? await ensureProfileParty(db, row.manager_id, row.manager_name) : null
  return upsertItem(db, 'branch_cash_expenses', row.id, {
    counterparty_id: party?.id ?? null,
    description: String(row.description ?? 'Branch expense'),
    amount_p: toPoishaExact(row.amount),
    paid_p: toPoishaExact(row.paid_amount),
    due_date: dateOf(row.expense_date),
    branch_id: row.branch_id ?? null,
  })
}

const DERIVERS: Record<string, (db: Db, row: any) => Promise<any | null>> = {
  company_expenses: deriveCeItem,
  employee_expense_requests: deriveErItem,
  payment_requests: derivePrItem,
  branch_cash_expenses: deriveBceItem,
}

const FETCHERS: Record<string, (db: Db, id: string) => Promise<any>> = {
  company_expenses: (db, id) => db.companyExpense.findUnique({ where: { id } }),
  employee_expense_requests: (db, id) => db.employeeExpenseRequest.findUnique({ where: { id } }),
  payment_requests: (db, id) => db.paymentRequest.findUnique({ where: { id } }),
  branch_cash_expenses: (db, id) => db.branchCashExpense.findUnique({ where: { id } }),
  salary_payments: (db, id) => db.salaryPayment.findUnique({ where: { id } }),
}

/** Re-derive ONE source record's register row (+ its counterparty).
 * The live-sync entry point the route hooks call. */
export async function syncPayableItemForSource(db: Db, sourceTable: string, sourceId: string): Promise<any | null> {
  const fetcher = FETCHERS[sourceTable]
  if (!fetcher) return null
  const row = await fetcher(db, sourceId)
  if (!row) {
    await dropItemIfOrphaned(db, sourceTable, sourceId)
    return null
  }
  if (sourceTable === 'salary_payments') {
    // No register item (payments are born paid) — but the
    // recipient joins the counterparty register.
    return ensureProfileParty(db, row.employee_id)
  }
  const deriver = DERIVERS[sourceTable]
  return deriver ? deriver(db, row) : null
}

/** Full derivation — the backfill and the admin Sync action. */
export async function syncPayablesRegister(db: Db): Promise<{
  counterparties: { total: number; by_type: Record<string, number> }
  items: Record<string, number>
  open_total: string
}> {
  const counterparties = await syncCounterparties(db)
  const items: Record<string, number> = {}
  const loops: Array<[string, () => Promise<any[]>]> = [
    ['company_expenses', () => db.companyExpense.findMany({ where: { total_amount: { gt: 0 } } })],
    ['employee_expense_requests', () => db.employeeExpenseRequest.findMany()],
    ['payment_requests', () => db.paymentRequest.findMany()],
    ['branch_cash_expenses', () => db.branchCashExpense.findMany()],
  ]
  for (const [table, fetch] of loops) {
    const rows = await fetch()
    let count = 0
    for (const row of rows) {
      const item = await DERIVERS[table](db, row)
      if (item) count++
    }
    items[table] = count
  }
  const open = await db.payableReceivable.findMany({
    where: { direction: 'payable', status: { in: ['open', 'partial'] } },
    select: { amount: true, paid_amount: true },
  })
  const openP = open.reduce(
    (a: number, r: any) => a + toPoishaExact(r.amount) - toPoishaExact(r.paid_amount),
    0
  )
  return { counterparties, items, open_total: taka(openP) }
}

// ── Read models ───────────────────────────────────────────────────

export function displayStatus(item: any, today: string): { status: string; overdue: boolean } {
  const settled = item.status === 'settled'
  const overdue = !settled && item.due_date && dateOf(item.due_date) < today
  return { status: settled ? 'settled' : overdue ? 'overdue' : item.status, overdue }
}

export async function listParties(db: Db): Promise<any[]> {
  const parties = await db.counterparty.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] })
  const items = await db.payableReceivable.findMany({
    select: { counterparty_id: true, direction: true, amount: true, paid_amount: true, status: true },
  })
  const bal = new Map<string, { payable_p: number; receivable_p: number; items: number }>()
  for (const it of items) {
    if (!it.counterparty_id) continue
    const cur = bal.get(it.counterparty_id) ?? { payable_p: 0, receivable_p: 0, items: 0 }
    const open = toPoishaExact(it.amount) - toPoishaExact(it.paid_amount)
    if (it.direction === 'payable') cur.payable_p += open
    else cur.receivable_p += open
    cur.items++
    bal.set(it.counterparty_id, cur)
  }
  return parties.map((p: any) => ({
    ...p,
    created_at: undefined,
    updated_at: undefined,
    open_payable: taka(bal.get(p.id)?.payable_p ?? 0),
    open_receivable: taka(bal.get(p.id)?.receivable_p ?? 0),
    register_items: bal.get(p.id)?.items ?? 0,
  }))
}

export async function listRegister(db: Db): Promise<any[]> {
  const today = dhakaToday()
  const parties = await db.counterparty.findMany({ select: { id: true, name: true, type: true } })
  const nameOfParty = new Map<string, any>(parties.map((p: any) => [p.id, p]))
  const rows = await db.payableReceivable.findMany({
    orderBy: [{ status: 'asc' }, { due_date: 'asc' }, { created_at: 'asc' }],
  })
  return rows.map((r: any) => {
    const ds = displayStatus(r, today)
    return {
      id: r.id,
      counterparty_id: r.counterparty_id,
      counterparty_name: r.counterparty_id ? (nameOfParty.get(r.counterparty_id)?.name ?? null) : null,
      counterparty_type: r.counterparty_id ? (nameOfParty.get(r.counterparty_id)?.type ?? null) : null,
      direction: r.direction,
      source_table: r.source_table,
      source_id: r.source_id,
      class_label: CLASS_META[r.source_table ?? '']?.label ?? r.source_table,
      journal_backed: CLASS_META[r.source_table ?? '']?.journal_backed ?? false,
      description: r.description,
      amount: taka(toPoishaExact(r.amount)),
      paid_amount: taka(toPoishaExact(r.paid_amount)),
      open_amount: taka(toPoishaExact(r.amount) - toPoishaExact(r.paid_amount)),
      due_date: r.due_date ? dateOf(r.due_date) : null,
      status: ds.status,
      stored_status: r.status,
      overdue: ds.overdue,
      branch_id: r.branch_id,
    }
  })
}

/** Per-class tie-out: the register's open total against an
 * independent sum over the source table. */
export async function registerTieOut(db: Db): Promise<any[]> {
  const items = await db.payableReceivable.findMany()
  const byClass = new Map<string, any[]>()
  for (const it of items) {
    const key = it.source_table ?? '—'
    byClass.set(key, [...(byClass.get(key) ?? []), it])
  }
  const openOf = (rows: any[]) =>
    rows.reduce((a: number, r: any) => a + toPoishaExact(r.amount) - toPoishaExact(r.paid_amount), 0)

  const out: any[] = []

  // company_expenses — source truth is the due_amount column.
  const ceRows = await db.companyExpense.findMany({ where: { due_amount: { gt: 0 } } })
  const ceSource = ceRows.reduce((a: number, r: any) => a + toPoishaExact(r.due_amount), 0)
  const ceItems = byClass.get('company_expenses') ?? []
  out.push({
    key: 'company_expenses',
    label: CLASS_META.company_expenses.label,
    journal_backed: true,
    items: ceItems.length,
    register_open: taka(openOf(ceItems)),
    source_open: taka(ceSource),
    match: openOf(ceItems) === ceSource,
    note: 'Source: Σ due_amount over company_expenses.',
  })

  // employee_expense_requests — approved obligations, net of the
  // external settlements the register recorded against them.
  const erRows = await db.employeeExpenseRequest.findMany()
  const erApproved = erRows
    .filter((r: any) => r.status === 'approved')
    .reduce((a: number, r: any) => a + toPoishaExact(r.amount), 0)
  const erItems = byClass.get('employee_expense_requests') ?? []
  const erStatusById = new Map(erRows.map((r: any) => [r.id, r.status]))
  let erExternal = 0
  for (const it of erItems) {
    if (erStatusById.get(it.source_id) === 'approved') erExternal += await settlementsSum(db, it.id, ['external'])
  }
  const erPending = erRows.filter((r: any) => r.status === 'pending').length
  out.push({
    key: 'employee_expense_requests',
    label: CLASS_META.employee_expense_requests.label,
    journal_backed: false,
    items: erItems.length,
    register_open: taka(openOf(erItems)),
    source_open: taka(erApproved - erExternal),
    match: openOf(erItems) === erApproved - erExternal,
    note: `Source: Σ amount over approved requests, net of external settlements. ${erPending} pending request(s) are not obligations yet and are excluded.`,
  })

  // payment_requests — pending/approved payout obligations.
  const prRows = await db.paymentRequest.findMany()
  const prOpen = prRows
    .filter((r: any) => r.status === 'pending' || r.status === 'approved')
    .reduce((a: number, r: any) => a + toPoishaExact(r.amount), 0)
  const prItems = byClass.get('payment_requests') ?? []
  const prStatusById = new Map(prRows.map((r: any) => [r.id, r.status]))
  let prExternal = 0
  for (const it of prItems) {
    const st = prStatusById.get(it.source_id)
    if (st === 'pending' || st === 'approved') prExternal += await settlementsSum(db, it.id, ['external'])
  }
  out.push({
    key: 'payment_requests',
    label: CLASS_META.payment_requests.label,
    journal_backed: false,
    items: prItems.length,
    register_open: taka(openOf(prItems)),
    source_open: taka(prOpen - prExternal),
    match: openOf(prItems) === prOpen - prExternal,
    note: 'Source: Σ amount over pending/approved payout requests, net of external settlements.',
  })

  // branch_cash_expenses — due rows that are not mirror copies.
  const bceRows = await db.branchCashExpense.findMany()
  const bceSource = bceRows
    .filter((r: any) => toPoishaExact(r.due_amount) > 0 && !r.salary_payment_id && !r.expense_request_id)
    .reduce((a: number, r: any) => a + toPoishaExact(r.due_amount), 0)
  const bceItems = byClass.get('branch_cash_expenses') ?? []
  out.push({
    key: 'branch_cash_expenses',
    label: CLASS_META.branch_cash_expenses.label,
    journal_backed: false,
    items: bceItems.length,
    register_open: taka(openOf(bceItems)),
    source_open: taka(bceSource),
    match: openOf(bceItems) === bceSource,
    note: 'Source: Σ due_amount over non-mirror branch cash expenses.',
  })

  // salary_payments — structurally empty (see module header).
  const salItems = byClass.get('salary_payments') ?? []
  out.push({
    key: 'salary_payments',
    label: CLASS_META.salary_payments.label,
    journal_backed: false,
    items: salItems.length,
    register_open: taka(openOf(salItems)),
    source_open: taka(0),
    match: openOf(salItems) === 0,
    note: 'No unpaid/partial salary is recorded — the class is empty by data, not by omission.',
  })

  return out
}

// ── Ageing ────────────────────────────────────────────────────────

export const AGEING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const
export type AgeingBucket = (typeof AGEING_BUCKETS)[number]

function bucketOf(dueDate: string, today: string): AgeingBucket {
  const days = Math.floor((Date.parse(today) - Date.parse(dueDate)) / 86400000)
  if (days <= 0) return 'current'
  if (days <= 30) return 'd1_30'
  if (days <= 60) return 'd31_60'
  if (days <= 90) return 'd61_90'
  return 'd90_plus'
}

export async function ageingReport(db: Db): Promise<any> {
  const today = dhakaToday()
  const parties = await db.counterparty.findMany({ select: { id: true, name: true, type: true } })
  const partyOf = new Map<string, any>(parties.map((p: any) => [p.id, p]))
  const items = await db.payableReceivable.findMany({ where: { status: { in: ['open', 'partial'] } } })
  const empty = () => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 })
  const totals: Record<'payable' | 'receivable', ReturnType<typeof empty>> = {
    payable: empty(),
    receivable: empty(),
  }
  const perParty = new Map<string, any>()
  for (const it of items) {
    const open = toPoishaExact(it.amount) - toPoishaExact(it.paid_amount)
    if (open <= 0) continue
    const due = it.due_date ? dateOf(it.due_date) : dateOf(it.created_at)
    const bucket = bucketOf(due, today)
    const dir = it.direction === 'receivable' ? 'receivable' : 'payable'
    totals[dir][bucket] += open
    totals[dir].total += open
    const key = it.counterparty_id ?? 'none'
    const cur =
      perParty.get(key) ??
      {
        counterparty_id: it.counterparty_id,
        counterparty_name: it.counterparty_id
          ? (partyOf.get(it.counterparty_id)?.name ?? null)
          : 'No counterparty recorded',
        counterparty_type: it.counterparty_id ? (partyOf.get(it.counterparty_id)?.type ?? null) : null,
        payable: empty(),
        receivable: empty(),
      }
    cur[dir][bucket] += open
    cur[dir].total += open
    perParty.set(key, cur)
  }
  const money = (b: ReturnType<typeof empty>) => ({
    current: taka(b.current),
    d1_30: taka(b.d1_30),
    d31_60: taka(b.d31_60),
    d61_90: taka(b.d61_90),
    d90_plus: taka(b.d90_plus),
    total: taka(b.total),
  })
  return {
    as_of: today,
    basis: 'Ageing runs from the source date — no source table records a contractual due date.',
    totals: { payable: money(totals.payable), receivable: money(totals.receivable) },
    by_counterparty: [...perParty.values()]
      .map((r) => ({ ...r, payable: money(r.payable), receivable: money(r.receivable) }))
      .sort((a, b) => Number(b.payable.total) - Number(a.payable.total)),
  }
}

// ── Settlements ───────────────────────────────────────────────────

export async function paidViaOptions(db: Db): Promise<Array<{ code: string; label: string }>> {
  const base: Array<{ code: string; label: string }> = [
    { code: ACCT.cashHeadOffice, label: 'Cash — Head Office' },
    { code: ACCT.cashBranch, label: "Cash — Branch (the item's branch)" },
    { code: ACCT.mfsClearing, label: 'MFS Clearing (bKash / Nagad / Rocket)' },
  ]
  const banks = await db.bankAccount.findMany({ where: { is_active: true, chart_account_id: { not: null } } })
  const charts = await db.chartAccount.findMany({
    where: { id: { in: banks.map((b: any) => b.chart_account_id) } },
    select: { id: true, code: true },
  })
  const codeOf = new Map<string, string>(charts.map((c: any) => [c.id, c.code]))
  for (const b of banks) {
    const code = codeOf.get(b.chart_account_id)
    if (code) base.push({ code, label: `Bank — ${b.bank_name} (${b.label})` })
  }
  return base
}

export async function listSettlements(db: Db, itemId: string): Promise<any[]> {
  const rows = await db.payableSettlement.findMany({
    where: { payable_id: itemId },
    orderBy: { created_at: 'asc' },
  })
  return rows.map((r: any) => ({
    id: r.id,
    amount: taka(toPoishaExact(r.amount)),
    paid_via: r.paid_via,
    settlement_date: dateOf(r.settlement_date),
    mode: r.mode,
    note: r.note,
    journal_entry_id: r.journal_entry_id,
    created_at: r.created_at,
  }))
}

/**
 * Record a settlement against a register item. See the module
 * header for the per-class design; the guarantees enforced here:
 *  - amount > 0 and ≤ the open balance (over-settlement → 409);
 *  - a period-blocked journal settlement writes NOTHING (source
 *    row, register and registry all untouched) and records a
 *    posting exception before answering 409;
 *  - external settlements demand a note.
 */
export async function settlePayable(
  db: Db,
  input: {
    item_id: string
    amount: unknown
    paid_via?: string | null
    settlement_date?: string | null
    note?: string | null
    created_by?: string | null
    /** Accounts A7: withhold the configured TDS_PAYMENT rate from
     * this settlement (journal-backed class only). The obligation
     * settles in full — paid-via receives the NET, the withheld
     * part credits TDS Payable, and a register line is written. */
    withhold_tds?: boolean
  }
): Promise<{
  settlement_id: string
  journal_entry_id: string | null
  mode: string
  item: any
  tds: { rate_percent: string; amount: string } | null
}> {
  const item = await db.payableReceivable.findUnique({ where: { id: input.item_id } })
  if (!item) throw new PayableError(404, 'Register item not found')
  if (item.direction !== 'payable') {
    throw new PayableError(400, 'Settlements are recorded against payables; receivables are collected through their source module.')
  }
  const amount_p = toPoishaExact(input.amount)
  if (amount_p <= 0) throw new PayableError(400, 'Settlement amount must be greater than zero')
  const open_p = toPoishaExact(item.amount) - toPoishaExact(item.paid_amount)
  if (open_p <= 0) throw new PayableError(409, 'This item is already settled')
  if (amount_p > open_p) {
    throw new PayableError(409, `Over-settlement refused: open balance is ৳${taka(open_p)}`)
  }
  const date = (input.settlement_date ?? '').trim() || dhakaToday()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new PayableError(400, 'settlement_date must be YYYY-MM-DD')
  const meta = CLASS_META[item.source_table ?? '']
  const settlementId = randomUUID()

  if (meta?.journal_backed) {
    const paidVia = (input.paid_via ?? '').trim()
    if (!paidVia) throw new PayableError(400, 'paid_via is required for a journal settlement')
    const options = await paidViaOptions(db)
    if (!options.some((o) => o.code === paidVia)) {
      throw new PayableError(400, `paid_via ${paidVia} is not a recognised payment account`)
    }
    if (paidVia === ACCT.cashBranch && !item.branch_id) {
      throw new PayableError(400, 'Branch cash needs a branch — this item carries none; pay from Head Office or a bank account')
    }
    // Accounts A7 — TDS withholding on this settlement, only when
    // the admin asked for it AND the type is configured. A
    // requested-but-unconfigured deduction refuses BEFORE anything
    // is written (no silent full payment, no invented rate).
    let tdsP = 0
    let tdsRate: string | null = null
    let tdsPayableCode: string | null = null
    if (input.withhold_tds) {
      const cfg = await effectiveTax(db, 'TDS_PAYMENT', date)
      if (!cfg) {
        throw new PayableError(
          400,
          'TDS deduction was requested, but TDS on payments is not enabled with a rate effective on the settlement date — ' +
            'configure it under Accounts → VAT & TDS first. Nothing was written.'
        )
      }
      tdsP = computeTaxPoisha(amount_p, cfg.rate_units)
      if (tdsP <= 0) throw new PayableError(400, 'The configured TDS rate produces a zero deduction on this amount — settle without TDS.')
      if (tdsP >= amount_p) throw new PayableError(400, 'The configured TDS rate would consume the whole settlement — check the rate in Accounts → VAT & TDS.')
      tdsRate = cfg.rate_percent
      tdsPayableCode = cfg.payable_code
    }
    let entry: { entry_id: string }
    try {
      entry = await postEvent(db, {
        source_table: 'payable_settlements',
        source_id: settlementId,
        event_type: 'payable_settlement',
        entry_date: date,
        memo: `Payable settlement — ${item.description}`,
        created_by: input.created_by ?? null,
        lines: [
          {
            account_code: ACCT.accountsPayable,
            counterparty_id: item.counterparty_id ?? null,
            debit: amount_p / 100,
            memo: item.description,
          },
          {
            account_code: paidVia,
            branch_id: paidVia === ACCT.cashBranch ? item.branch_id : null,
            credit: (amount_p - tdsP) / 100,
            memo:
              tdsP > 0
                ? `Settlement of ${item.description} (net of TDS ৳${taka(tdsP)} @ ${tdsRate}%)`
                : `Settlement of ${item.description}`,
          },
          ...(tdsP > 0
            ? [
                {
                  account_code: tdsPayableCode!,
                  credit: tdsP / 100,
                  memo: `TDS withheld @ ${tdsRate}% — ${item.description}`,
                },
              ]
            : []),
        ],
      })
    } catch (err: any) {
      if (isPeriodBlockedError(err)) {
        await recordPostingException(db, err, {
          source_table: 'payables_receivables',
          source_id: item.id,
          event_type: 'payable_settlement',
        })
        throw new PayableError(
          409,
          `Settlement blocked: period ${err.month} is ${err.status}. Nothing was written — the payable, the source row and the journal are unchanged. The block is recorded as a posting exception.`
        )
      }
      throw err
    }
    await db.$transaction(async (tx: Db) => {
      const src = await tx.companyExpense.findUnique({ where: { id: item.source_id } })
      if (!src) throw new PayableError(404, 'Source company expense no longer exists')
      const newPaid = toPoishaExact(src.paid_amount) + amount_p
      const total = toPoishaExact(src.total_amount)
      await tx.companyExpense.update({
        where: { id: src.id },
        data: {
          paid_amount: dec(newPaid),
          due_amount: dec(Math.max(0, total - newPaid)),
        },
      })
      await tx.payableSettlement.create({
        data: {
          id: settlementId,
          payable_id: item.id,
          amount: dec(amount_p),
          paid_via: paidVia,
          settlement_date: new Date(`${date}T00:00:00Z`),
          mode: 'journal',
          note: input.note ?? null,
          journal_entry_id: entry.entry_id,
          created_by: input.created_by ?? null,
        },
      })
      if (tdsP > 0) {
        // Accounts A7: the withholding joins the VAT/TDS register,
        // linked to this settlement + its journal entry.
        await tx.taxRegisterLine.create({
          data: registerLineData({
            period: date.slice(0, 7),
            kind: 'tds_payment',
            source_table: 'payable_settlements',
            source_id: settlementId,
            base_p: amount_p,
            rate_percent: tdsRate!,
            tax_p: tdsP,
            counterparty_id: item.counterparty_id ?? null,
            journal_entry_id: entry.entry_id,
          }),
        })
      }
    })
    const fresh = await syncPayableItemForSource(db, 'company_expenses', item.source_id)
    return {
      settlement_id: settlementId,
      journal_entry_id: entry.entry_id,
      mode: 'journal',
      item: fresh,
      tds: tdsP > 0 ? { rate_percent: tdsRate!, amount: taka(tdsP) } : null,
    }
  }

  // External settlement — memorandum classes only.
  if (input.withhold_tds) {
    throw new PayableError(
      400,
      'TDS can only be withheld on a journal settlement — this class settles outside the books, so no tax is recorded for it.'
    )
  }
  const note = (input.note ?? '').trim()
  if (note.length < 3) {
    throw new PayableError(
      400,
      'A note is mandatory for an external settlement: who was paid, how, and the reference — this class is settled outside its module, so the note is the audit trail.'
    )
  }
  await db.$transaction(async (tx: Db) => {
    await tx.payableSettlement.create({
      data: {
        id: settlementId,
        payable_id: item.id,
        amount: dec(amount_p),
        paid_via: null,
        settlement_date: new Date(`${date}T00:00:00Z`),
        mode: 'external',
        note,
        journal_entry_id: null,
        created_by: input.created_by ?? null,
      },
    })
    if (item.source_table === 'branch_cash_expenses') {
      // The BCE module's own state carries paid/due — update it
      // exactly as the module's edit path would.
      const src = await tx.branchCashExpense.findUnique({ where: { id: item.source_id } })
      if (src) {
        const newPaid = toPoishaExact(src.paid_amount) + amount_p
        await tx.branchCashExpense.update({
          where: { id: src.id },
          data: {
            paid_amount: dec(newPaid),
            due_amount: dec(Math.max(0, toPoishaExact(src.amount) - newPaid)),
          },
        })
      }
    } else if (item.source_table === 'employee_expense_requests' || item.source_table === 'payment_requests') {
      // The money fields and status belong to the module's pay
      // path — touch nothing but the notes, so the settlement is
      // visible where the module's own admins work.
      const model = item.source_table === 'employee_expense_requests' ? tx.employeeExpenseRequest : tx.paymentRequest
      const src = await model.findUnique({ where: { id: item.source_id } })
      if (src) {
        const stamp = `[Accounts] Settled externally ৳${taka(amount_p)} on ${date} — ${note}`
        await model.update({
          where: { id: src.id },
          data: { admin_notes: src.admin_notes ? `${src.admin_notes}\n${stamp}` : stamp },
        })
      }
    }
  })
  const fresh = await syncPayableItemForSource(db, item.source_table, item.source_id)
  return { settlement_id: settlementId, journal_entry_id: null, mode: 'external', item: fresh, tds: null }
}

// ── Counterparty administration ───────────────────────────────────

export async function updateParty(
  db: Db,
  id: string,
  patch: { name?: string; phone?: string | null; address?: string | null }
): Promise<{ before: any; after: any }> {
  const before = await db.counterparty.findUnique({ where: { id } })
  if (!before) throw new PayableError(404, 'Counterparty not found')
  const data: Record<string, unknown> = { edited_manually: true }
  if (patch.name !== undefined) {
    const name = String(patch.name).trim()
    if (!name) throw new PayableError(400, 'Name cannot be empty')
    data.name = name
  }
  if (patch.phone !== undefined) data.phone = patch.phone ? String(patch.phone).trim() : null
  if (patch.address !== undefined) data.address = patch.address ? String(patch.address).trim() : null
  const after = await db.counterparty.update({ where: { id }, data })
  return { before, after }
}

export async function setPartyActive(db: Db, id: string, isActive: boolean): Promise<{ before: any; after: any }> {
  const before = await db.counterparty.findUnique({ where: { id } })
  if (!before) throw new PayableError(404, 'Counterparty not found')
  const after = await db.counterparty.update({ where: { id }, data: { is_active: isActive } })
  return { before, after }
}

export async function deleteParty(db: Db, id: string): Promise<void> {
  const before = await db.counterparty.findUnique({ where: { id } })
  if (!before) throw new PayableError(404, 'Counterparty not found')
  const registerRows = await db.payableReceivable.count({ where: { counterparty_id: id } })
  const journalLines = await db.journalLine.count({ where: { counterparty_id: id } })
  if (registerRows > 0 || journalLines > 0) {
    throw new PayableError(
      409,
      `Cannot delete: this counterparty carries ${registerRows} register item(s) and ${journalLines} journal line(s). Deactivate it instead — history is never deleted.`
    )
  }
  await db.counterparty.delete({ where: { id } })
}

/** Deterministic id for ad-hoc fixture/registry use. */
export const settlementKey = (key: string): string => uuidFromString(key)
