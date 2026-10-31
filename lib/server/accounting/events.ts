/**
 * Accounts A1 — posting map builders (blueprint §B.2, P1–P10).
 *
 * Each builder reads ONE source row and returns the balanced lines
 * for its journal entry, or null when the event posts nothing
 * (salary/expense-request mirror copies, uncosted chalans, unpaid /
 * rejected / voided sources). Amounts are always the source row's
 * own figures. Builders never write anything except
 * ensurePartnerDrawingsAccount (creates a partner's drawings account
 * on first payout — a CoA row, not money).
 *
 * The db-parameter style matches post.ts so backfill/proof scripts
 * run the SAME code the routes run.
 */
import { branchCashExpenseStream } from '../../expense-streams'
import { dhakaDateOf } from '../../dhaka-time'
import { getPeriodForDate, postEvent, reverseEntry, type Db, type PostEventInput, type PostResult } from './post'

// ── Chart-of-accounts codes (seeded by seed.ts) ─────────────────────
export const ACCT = {
  cashBranch: '1000',
  cashHeadOffice: '1005',
  bankParent: '1010',
  bankUnallocated: '1019',
  mfsClearing: '1020',
  cashInTransit: '1030',
  inventory: '1040',
  accountsReceivable: '1050',
  accountsPayable: '2000',
  vatPayable: '2030',
  tdsPayable: '2040',
  salesRevenue: '4000',
  otherIncome: '4010',
  salaryBasic: '5010',
  companyOperating: '5200',
  companySetup: '5210',
  branchOperating: '5300',
  expenseRequests: '5350',
  cashShortage: '5400',
} as const

const n = (v: unknown): number => (v == null ? 0 : Number((v as any).toString()))
const dateStr = (d: Date): string => d.toISOString().slice(0, 10)

async function branchName(db: Db, branchId: string | null | undefined): Promise<string> {
  if (!branchId) return ''
  const b = await db.branch.findUnique({ where: { id: branchId }, select: { name: true } })
  return b?.name ?? ''
}

async function headAccountCode(db: Db, ledgerHeadId: string): Promise<string> {
  const acct = await db.chartAccount.findFirst({
    where: { ledger_head_id: ledgerHeadId },
    select: { code: true },
  })
  if (!acct) throw new Error(`ACCOUNTS: no chart account mapped for ledger head ${ledgerHeadId}`)
  return acct.code
}

async function bankAccountForDeposit(db: Db, deposit: any): Promise<{ code: string; label: string }> {
  const candidates = await db.bankAccount.findMany({ where: { is_active: true } })
  const withCharts = await db.chartAccount.findMany({
    where: { id: { in: candidates.map((c: any) => c.chart_account_id).filter(Boolean) } },
    select: { id: true, code: true },
  })
  const codeById = new Map<string, string>(withCharts.map((a: any) => [a.id, a.code]))
  const hay = String(deposit.bank_account_name || '')
  for (const c of candidates) {
    if (c.chart_account_id && hay.includes(c.bank_name)) {
      return { code: codeById.get(c.chart_account_id)!, label: c.label }
    }
  }
  return { code: ACCT.bankUnallocated, label: 'Bank — Unallocated (to confirm)' }
}

// ── P1 — daily closing ──────────────────────────────────────────────
export function buildClosingLines(row: any): PostEventInput['lines'] {
  const branch = row.branch_id
  const lines: PostEventInput['lines'] = []
  const cash = n(row.cash_sales)
  const digital =
    n(row.bkash_sales) + n(row.nagad_sales) + n(row.rocket_sales) + n(row.card_sales) + n(row.bank_transfer_sales)
  const otherIn = n(row.other_cash_in)
  const diff = row.cash_difference == null ? 0 : n(row.cash_difference)
  if (cash > 0) {
    lines.push({ account_code: ACCT.cashBranch, branch_id: branch, debit: cash })
    lines.push({ account_code: ACCT.salesRevenue, branch_id: branch, credit: cash })
  }
  if (digital > 0) {
    lines.push({ account_code: ACCT.mfsClearing, branch_id: branch, debit: digital, memo: 'Digital-channel sales (bKash/Nagad/Rocket/Card/Bank)' })
    lines.push({ account_code: ACCT.salesRevenue, branch_id: branch, credit: digital })
  }
  if (otherIn > 0) {
    lines.push({ account_code: ACCT.cashBranch, branch_id: branch, debit: otherIn })
    lines.push({ account_code: ACCT.otherIncome, branch_id: branch, credit: otherIn, memo: 'Other cash in' })
  }
  if (diff > 0) {
    lines.push({ account_code: ACCT.cashBranch, branch_id: branch, debit: diff, memo: 'Counted excess' })
    lines.push({ account_code: ACCT.otherIncome, branch_id: branch, credit: diff, memo: 'Counted excess' })
  } else if (diff < 0) {
    lines.push({ account_code: ACCT.cashShortage, branch_id: branch, debit: -diff, memo: 'Counted shortage' })
    lines.push({ account_code: ACCT.cashBranch, branch_id: branch, credit: -diff, memo: 'Counted shortage' })
  }
  return lines
}

// ── P2/P3 — branch cash expenses (classifier-driven) ───────────────
export async function buildBceInput(db: Db, row: any): Promise<PostEventInput | null> {
  // Mirror copies post NOTHING here — they post from their source
  // (salary → P5, expense request → P6). The FR-2 lesson, encoded.
  if (row.salary_payment_id) return null
  if (row.expense_request_id) return null
  const stream = branchCashExpenseStream(row)
  const amount = n(row.amount)
  if (amount <= 0) return null
  const isHead = stream === 'ledger-head' && !!row.ledger_head_id
  const debitCode = isHead ? await headAccountCode(db, row.ledger_head_id) : ACCT.branchOperating
  // Credit leg follows the ledger-sync law (lib/server/ledger-sync):
  // ONLY branch-stream rows move the branch DRAWER. Ledger-head rows
  // (rent, bills…) are recorded against the branch but settled
  // centrally — they credit Head Office cash, never the drawer.
  return {
    source_table: 'branch_cash_expenses',
    source_id: row.id,
    event_type: 'branch_expense',
    entry_date: dateStr(row.expense_date),
    memo: row.description,
    lines: [
      { account_code: debitCode, branch_id: row.branch_id, debit: amount },
      isHead
        ? { account_code: ACCT.cashHeadOffice, credit: amount, memo: 'Settled centrally (ledger-head stream)' }
        : { account_code: ACCT.cashBranch, branch_id: row.branch_id, credit: amount },
    ],
  }
}

// ── P4 — company expenses ───────────────────────────────────────────
export function buildCompanyExpenseInput(row: any): PostEventInput | null {
  const total = n(row.total_amount)
  if (total <= 0) return null
  const paid = n(row.paid_amount)
  const due = n(row.due_amount)
  const lines: PostEventInput['lines'] = [
    {
      account_code: row.expense_kind === 'setup' ? ACCT.companySetup : ACCT.companyOperating,
      branch_id: row.branch_id ?? null,
      debit: total,
    },
  ]
  if (due > 0) lines.push({ account_code: ACCT.accountsPayable, credit: due, memo: 'Unpaid balance' })
  if (paid > 0) lines.push({ account_code: ACCT.cashHeadOffice, credit: paid, memo: 'Settled at record time' })
  if (lines.length < 2) return null
  return {
    source_table: 'company_expenses',
    source_id: row.id,
    event_type: 'company_expense',
    entry_date: dhakaDateOf(row.created_at),
    memo: row.purpose,
    lines,
  }
}

// ── P5 — salary issued ──────────────────────────────────────────────
export async function buildSalaryInput(db: Db, row: any): Promise<PostEventInput | null> {
  if (row.status === 'voided') return null
  const amount = n(row.amount)
  if (amount <= 0) return null
  const emp = await db.profile.findUnique({
    where: { id: row.employee_id },
    select: { full_name: true },
  })
  const extras: string[] = []
  if (n(row.overtime_amount) > 0) extras.push(`OT ${n(row.overtime_amount)}`)
  if (n(row.bonus_amount) > 0) extras.push(`Bonus ${n(row.bonus_amount)}`)
  if (n(row.sales_commission) > 0) extras.push(`Commission ${n(row.sales_commission)}`)
  if (n(row.tiffin_bill) > 0) extras.push(`Tiffin ${n(row.tiffin_bill)}`)
  // The debit follows the financial summary's verified mapping —
  // every salary payment lands on Salary - Basic (the summary's
  // 146,186.86 head figure is built exactly this way), regardless of
  // the inconsistent ledger_head_id stored on 6 historical payments.
  // The credit leg follows the ledger-sync law: a salary row does
  // NOT move the branch drawer (branchStreamAmount = 0 for salary
  // copies — the drawer's cash_expenses is branch-stream only), so
  // salaries settle centrally: Cr Cash — Head Office. The BCE mirror
  // posts nothing (P2 exclusion above).
  return {
    source_table: 'salary_payments',
    source_id: row.id,
    event_type: 'salary',
    entry_date: dhakaDateOf(row.payment_date),
    memo: `Salary — ${emp?.full_name ?? row.employee_id}${extras.length ? ` (${extras.join(', ')})` : ''}`,
    lines: [
      { account_code: ACCT.salaryBasic, branch_id: row.branch_id ?? null, debit: amount },
      { account_code: ACCT.cashHeadOffice, credit: amount, memo: 'Settled centrally' },
    ],
  }
}

// ── P6 — expense request paid ───────────────────────────────────────
export async function buildRequestPaidInput(db: Db, row: any): Promise<PostEventInput | null> {
  if (row.status !== 'paid') return null
  const amount = n(row.amount)
  if (amount <= 0) return null
  const isCash = String(row.payment_method || '').toLowerCase() === 'cash'
  // The credit leg follows the system's own booking: when a pay
  // flow created a branch-cash mirror for this request, the money
  // was booked out of the branch drawer (the mirror + ledger sync),
  // so the journal credits the drawer. With no mirror (the
  // historical set), the leg follows the payment method: cash →
  // drawer, bKash/other → MFS clearing.
  const mirror = await db.branchCashExpense.findFirst({
    where: { expense_request_id: row.id },
    select: { id: true },
  })
  const fromDrawer = !!mirror || isCash
  return {
    source_table: 'employee_expense_requests',
    source_id: row.id,
    event_type: 'request_paid',
    entry_date: dhakaDateOf(row.paid_at ?? row.updated_at),
    memo: `Expense request — ${row.title}`,
    lines: [
      { account_code: ACCT.expenseRequests, branch_id: row.branch_id ?? null, debit: amount },
      {
        account_code: fromDrawer ? ACCT.cashBranch : ACCT.mfsClearing,
        branch_id: row.branch_id ?? null,
        credit: amount,
        memo: mirror ? 'Booked from branch cash (pay-flow mirror)' : isCash ? 'Paid from branch cash' : `Paid via ${row.payment_method}`,
      },
    ],
  }
}

// ── P7 — deposit approved ───────────────────────────────────────────
export async function buildDepositInput(db: Db, row: any): Promise<PostEventInput | null> {
  if (row.status !== 'approved' || row.is_reversed) return null
  const amount = n(row.amount)
  if (amount <= 0) return null
  const bank = await bankAccountForDeposit(db, row)
  const name = row.branch_name || (await branchName(db, row.branch_id))
  return {
    source_table: 'branch_bank_deposits',
    source_id: row.id,
    event_type: 'deposit',
    entry_date: dateStr(row.deposit_date),
    memo: `Bank deposit — ${name} → ${bank.label}`,
    lines: [
      { account_code: bank.code, debit: amount, memo: row.bank_account_name },
      { account_code: ACCT.cashBranch, branch_id: row.branch_id, credit: amount },
    ],
  }
}

// ── P8 — chalan (costed only) ───────────────────────────────────────
export function buildChalanInput(row: any): PostEventInput | null {
  const cost = n(row.total_cost)
  if (cost <= 0) return null // cost-missing: posts nothing, flagged (FR-8.2 rule)
  return {
    source_table: 'product_chalans',
    source_id: row.id,
    event_type: 'chalan',
    entry_date: dhakaDateOf(row.created_at),
    memo: `Chalan ${row.chalan_ref ?? ''} — goods to ${row.branch_name} (at cost)`,
    lines: [
      { account_code: ACCT.inventory, branch_id: row.branch_id ?? null, debit: cost, memo: 'Stock received at branch' },
      { account_code: ACCT.inventory, branch_id: null, credit: cost, memo: 'Stock dispatched from head-office pool' },
    ],
  }
}

// ── P9 — partner payout completed ───────────────────────────────────
export async function ensurePartnerDrawingsAccount(db: Db, userId: string, name: string): Promise<string> {
  const code = `3030-${userId.slice(0, 8)}`
  const existing = await db.chartAccount.findUnique({ where: { code } })
  if (existing) return code
  const parent = await db.chartAccount.findUnique({ where: { code: '3030' } })
  await db.chartAccount.create({
    data: {
      code,
      name: `Partner Drawings — ${name}`,
      type: 'equity',
      parent_id: parent?.id ?? null,
      is_system: true,
      is_active: true,
    },
  })
  return code
}

export async function buildPayoutInput(db: Db, row: any): Promise<PostEventInput | null> {
  if (row.status !== 'completed') return null
  const amount = n(row.amount)
  if (amount <= 0) return null
  const user = await db.profile.findUnique({ where: { id: row.user_id }, select: { full_name: true } })
  const drawings = await ensurePartnerDrawingsAccount(db, row.user_id, user?.full_name ?? 'Partner')
  const method = String(row.payment_method || '').toLowerCase()
  const creditCode = /bkash|nagad|rocket/.test(method)
    ? ACCT.mfsClearing
    : /cash/.test(method)
      ? ACCT.cashHeadOffice
      : ACCT.bankUnallocated
  return {
    source_table: 'payment_requests',
    source_id: row.id,
    event_type: 'payout',
    entry_date: dhakaDateOf(row.completed_at ?? row.updated_at),
    memo: `Partner payout — ${row.invoice_title}`,
    lines: [
      { account_code: drawings, debit: amount },
      { account_code: creditCode, credit: amount, memo: `Paid via ${row.payment_method}` },
    ],
  }
}

// ── P10 — bundle (change) requisition completed ─────────────────────
export function buildBundleInput(row: any): PostEventInput | null {
  if (row.status !== 'completed') return null
  const total = n(row.total_amount)
  if (total <= 0) return null
  return {
    source_table: 'branch_bundle_requests',
    source_id: row.id,
    event_type: 'bundle',
    entry_date: dhakaDateOf(row.completed_at ?? row.updated_at),
    memo: 'Change requisition — cash in transit',
    lines: [
      { account_code: ACCT.cashInTransit, branch_id: row.branch_id, debit: total },
      { account_code: ACCT.cashBranch, branch_id: row.branch_id, credit: total },
    ],
  }
}

// ── Facade: build + post for one source row ─────────────────────────
const FETCHERS: Record<string, (db: Db, id: string) => Promise<any>> = {
  branch_cash_expenses: (db, id) => db.branchCashExpense.findUnique({ where: { id } }),
  company_expenses: (db, id) => db.companyExpense.findUnique({ where: { id } }),
  salary_payments: (db, id) => db.salaryPayment.findUnique({ where: { id } }),
  employee_expense_requests: (db, id) => db.employeeExpenseRequest.findUnique({ where: { id } }),
  branch_bank_deposits: (db, id) => db.branchBankDeposit.findUnique({ where: { id } }),
  product_chalans: (db, id) => db.productChalan.findUnique({ where: { id } }),
  payment_requests: (db, id) => db.paymentRequest.findUnique({ where: { id } }),
  branch_bundle_requests: (db, id) => db.branchBundleRequest.findUnique({ where: { id } }),
}

async function buildInput(db: Db, sourceTable: string, row: any): Promise<PostEventInput | null> {
  switch (sourceTable) {
    case 'branch_cash_expenses': return buildBceInput(db, row)
    case 'company_expenses': return buildCompanyExpenseInput(row)
    case 'salary_payments': return buildSalaryInput(db, row)
    case 'employee_expense_requests': return buildRequestPaidInput(db, row)
    case 'branch_bank_deposits': return buildDepositInput(db, row)
    case 'product_chalans': return buildChalanInput(row)
    case 'payment_requests': return buildPayoutInput(db, row)
    case 'branch_bundle_requests': return buildBundleInput(row)
    default: throw new Error(`ACCOUNTS: no posting builder for ${sourceTable}`)
  }
}

/**
 * Build (but do not post) the journal input for one source record.
 * Used by the edit-resync hook to compare desired vs posted lines.
 */
export async function buildInputForResync(
  db: Db,
  sourceTable: string,
  sourceId: string
): Promise<PostEventInput | null> {
  const fetcher = FETCHERS[sourceTable]
  if (!fetcher) throw new Error(`ACCOUNTS: unknown source table ${sourceTable}`)
  const row = await fetcher(db, sourceId)
  if (!row) return null
  return buildInput(db, sourceTable, row)
}

/**
 * Post the journal entry for one source record (reads the row
 * fresh). Returns null when the event posts nothing by design.
 */
export async function postForSource(
  db: Db,
  sourceTable: string,
  sourceId: string,
  opts?: {
    created_by?: string | null
    /**
     * A3 controlled-correction path: when the source event's own
     * period is closed/locked and its previous entry has just been
     * reversed, the repost lands in an OPEN period instead —
     * pass the open period's date here and a memo suffix explaining
     * the move. Never used for first-time postings: those are
     * refused by the engine and recorded as posting exceptions.
     */
    entry_date_override?: string
    memo_suffix?: string
  }
): Promise<PostResult | null> {
  const fetcher = FETCHERS[sourceTable]
  if (!fetcher) throw new Error(`ACCOUNTS: unknown source table ${sourceTable}`)
  const row = await fetcher(db, sourceId)
  if (!row) return null
  let input = await buildInput(db, sourceTable, row)
  if (!input) return null
  if (opts?.entry_date_override) {
    input = {
      ...input,
      entry_date: opts.entry_date_override,
      memo: `${input.memo ?? ''}${opts.memo_suffix ?? ''}`.trim() || input.memo,
    }
  }
  // Repost-after-reversal: if an earlier entry for this source was
  // reversed (a correction), the base event_type is occupied by a
  // dead entry — post the live one under a suffixed type. If an
  // ACTIVE entry already exists, postEvent's own idempotency (or
  // the suffix lookup here) returns it without duplicating.
  const prior = await db.journalEntry.findMany({
    where: { source_table: sourceTable, source_id: sourceId },
    select: { id: true, event_type: true },
  })
  const family = prior.filter(
    (e: any) => e.event_type === input.event_type || e.event_type.startsWith(`${input.event_type}_r`)
  )
  for (const e of family) {
    const reversed = await db.journalEntry.findFirst({
      where: { reverses_entry_id: e.id },
      select: { id: true },
    })
    if (!reversed) {
      return postEvent(db, { ...input, event_type: e.event_type, created_by: opts?.created_by ?? null })
    }
  }
  const eventType = family.length ? `${input.event_type}_r${family.length}` : input.event_type
  return postEvent(db, { ...input, event_type: eventType, created_by: opts?.created_by ?? input.created_by ?? null })
}

/**
 * Reverse the active journal entry for one source record (salary
 * void, deposit reversal). No-op when nothing was posted or the
 * entry is already reversed.
 */
export async function reverseForSource(
  db: Db,
  sourceTable: string,
  sourceId: string,
  opts: { entry_date: string; memo?: string | null; created_by?: string | null }
): Promise<PostResult | null> {
  const entries = await db.journalEntry.findMany({
    where: {
      source_table: sourceTable,
      source_id: sourceId,
      is_reversal: false,
      // Accounts A7: tax legs (event_type tax_*) are a SEPARATE
      // family living on the same source record. They are reversed
      // through the VAT/TDS register (tax.ts reverseTaxForSource),
      // never by this base path — otherwise reversing a source
      // would consume its newest tax leg and leave the base entry
      // standing.
      event_type: { not: { startsWith: 'tax_' } },
    },
    orderBy: { created_at: 'desc' },
  })
  for (const e of entries) {
    const reversed = await db.journalEntry.findFirst({
      where: { reverses_entry_id: e.id },
      select: { id: true },
    })
    if (!reversed) {
      return reverseEntry(db, e.id, opts)
    }
  }
  return null
}

// ── P1 live sync: closings post when finalised ──────────────────────
function linesSignature(lines: Array<{ account_id: string; branch_id: string | null; debit: any; credit: any }>): string {
  return lines
    .map((l) => `${l.account_id}|${l.branch_id ?? ''}|${n(l.debit)}|${n(l.credit)}`)
    .sort()
    .join(';')
}

async function desiredSignature(db: Db, input: PostEventInput): Promise<string> {
  const codes = [...new Set(input.lines.map((l) => l.account_code))]
  const rows = await db.chartAccount.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } })
  const idOf = new Map<string, string>(rows.map((r: any) => [r.code, r.id]))
  return input.lines
    .map((l) => `${idOf.get(l.account_code)}|${l.branch_id ?? ''}|${n(l.debit)}|${n(l.credit)}`)
    .sort()
    .join(';')
}

/**
 * Keep the journal in step with a closing row's lifecycle:
 *  - open row → nothing posted (any earlier posting is reversed);
 *  - closed row → exactly one active entry carrying the row's
 *    current figures (edited-after-post rows are reversed and
 *    re-posted; the journal itself stays append-only).
 */
export async function syncClosingEntry(
  db: Db,
  row: any,
  opts: { today: string; created_by?: string | null }
): Promise<{ action: string }> {
  const prior = await db.journalEntry.findMany({
    where: {
      source_table: 'branch_cash_ledger',
      source_id: row.id,
      is_reversal: false,
    },
    orderBy: { created_at: 'asc' },
  })
  let active: any = null
  for (const e of prior) {
    const reversed = await db.journalEntry.findFirst({
      where: { reverses_entry_id: e.id },
      select: { id: true },
    })
    if (!reversed) active = e
  }

  if (!row.is_closed) {
    if (active) {
      await reverseEntry(db, active.id, {
        entry_date: opts.today,
        memo: `Closing reopened — entry reversed (${dateStr(row.ledger_date)})`,
        created_by: opts.created_by ?? null,
      })
      return { action: 'reversed' }
    }
    return { action: 'noop' }
  }

  const lines = buildClosingLines(row)
  if (lines.length === 0) return { action: active ? 'kept' : 'noop' }
  const input: PostEventInput = {
    source_table: 'branch_cash_ledger',
    source_id: row.id,
    event_type: 'closing',
    entry_date: dateStr(row.ledger_date),
    memo: `Daily closing — ${dateStr(row.ledger_date)}`,
    created_by: opts.created_by ?? null,
    lines,
  }
  const desired = await desiredSignature(db, input)
  if (active) {
    const existingLines = await db.journalLine.findMany({ where: { entry_id: active.id } })
    if (linesSignature(existingLines) === desired) return { action: 'noop' }
    await reverseEntry(db, active.id, {
      entry_date: opts.today,
      memo: `Closing corrected — entry reversed (${dateStr(row.ledger_date)})`,
      created_by: opts.created_by ?? null,
    })
    // A3 controlled-correction path: if the closing's own period
    // has since been closed/locked, the repost cannot land there —
    // it posts into the current open period (today) with the move
    // stated on the entry. The original entry is never edited.
    const ownPeriod = await getPeriodForDate(db, input.entry_date)
    const redirected = !!ownPeriod && ownPeriod.status !== 'open'
    const repost = await postEvent(db, {
      ...input,
      event_type: `closing_r${prior.length}`,
      entry_date: redirected ? opts.today : input.entry_date,
      memo: redirected
        ? `Daily closing (correction re-posted into open period ${opts.today.slice(0, 7)} — original period ${input.entry_date.slice(0, 7)} is ${ownPeriod.status}) — ${dateStr(row.ledger_date)}`
        : `Daily closing (re-posted after correction) — ${dateStr(row.ledger_date)}`,
    })
    return { action: repost.created ? 'reposted' : 'noop' }
  }
  const posted = await postEvent(db, input)
  return { action: posted.created ? 'posted' : 'noop' }
}
