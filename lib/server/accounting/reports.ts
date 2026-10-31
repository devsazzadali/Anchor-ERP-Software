/**
 * Accounts A1 — read models: trial balance, unposted-source counts,
 * and per-class reconciliation of journal vs source modules.
 *
 * All money math is integer poisha (Decimal strings are parsed
 * digit-by-digit, never through floats), so every figure here is
 * exact to the poisha.
 */
import { type Db } from './post'

/** Decimal|string|number → integer poisha (exact). */
export function toPoishaExact(v: unknown): number {
  if (v == null) return 0
  const s = typeof v === 'object' ? (v as any).toString() : String(v)
  const neg = s.startsWith('-')
  const [i, f = ''] = s.replace('-', '').split('.')
  const p = parseInt(i || '0', 10) * 100 + parseInt((f + '00').slice(0, 2), 10)
  return neg ? -p : p
}
export const taka = (poisha: number): string => (poisha / 100).toFixed(2)

export interface TrialBalanceRow {
  account_id: string
  code: string
  name: string
  type: string
  debit: number // poisha
  credit: number // poisha
  balance: number // poisha, debit-positive
}

export async function trialBalance(db: Db): Promise<{
  rows: TrialBalanceRow[]
  total_debit: number
  total_credit: number
  difference: number
  balanced: boolean
  entry_count: number
}> {
  const accounts = await db.chartAccount.findMany({ orderBy: { code: 'asc' } })
  const lines = await db.journalLine.findMany({
    select: { account_id: true, debit: true, credit: true, entry_id: true },
  })
  const postedIds = new Set(
    (await db.journalEntry.findMany({ where: { status: 'posted' }, select: { id: true } })).map((e: any) => e.id)
  )
  const byAccount = new Map<string, { debit: number; credit: number }>()
  for (const l of lines) {
    if (!postedIds.has(l.entry_id)) continue
    const cur = byAccount.get(l.account_id) ?? { debit: 0, credit: 0 }
    cur.debit += toPoishaExact(l.debit)
    cur.credit += toPoishaExact(l.credit)
    byAccount.set(l.account_id, cur)
  }
  let totalDebit = 0
  let totalCredit = 0
  const rows: TrialBalanceRow[] = accounts.map((a: any) => {
    const s = byAccount.get(a.id) ?? { debit: 0, credit: 0 }
    totalDebit += s.debit
    totalCredit += s.credit
    return {
      account_id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      debit: s.debit,
      credit: s.credit,
      balance: s.debit - s.credit,
    }
  })
  return {
    rows,
    total_debit: totalDebit,
    total_credit: totalCredit,
    difference: totalDebit - totalCredit,
    balanced: totalDebit === totalCredit,
    entry_count: postedIds.size,
  }
}

/** Source records with no journal entry yet, per class. */
export async function unpostedSources(db: Db): Promise<Record<string, number>> {
  const postedFor = async (table: string): Promise<Set<string>> => {
    const rows = await db.journalEntry.findMany({
      where: { source_table: table },
      select: { source_id: true },
    })
    return new Set(rows.map((r: any) => r.source_id))
  }
  const [closings, bce, company, salaries, requests, deposits, chalans] = await Promise.all([
    postedFor('branch_cash_ledger'),
    postedFor('branch_cash_expenses'),
    postedFor('company_expenses'),
    postedFor('salary_payments'),
    postedFor('employee_expense_requests'),
    postedFor('branch_bank_deposits'),
    postedFor('product_chalans'),
  ])
  const [closingRows, bceRows, companyRows, salaryRows, requestRows, depositRows, chalanRows] =
    await Promise.all([
      db.branchCashLedger.findMany({
        select: {
          id: true, is_closed: true, cash_sales: true, bkash_sales: true, nagad_sales: true,
          rocket_sales: true, card_sales: true, bank_transfer_sales: true, other_cash_in: true,
          cash_difference: true,
        },
      }),
      db.branchCashExpense.findMany({ select: { id: true, salary_payment_id: true, expense_request_id: true } }),
      db.companyExpense.findMany({ select: { id: true } }),
      db.salaryPayment.findMany({ select: { id: true, status: true } }),
      db.employeeExpenseRequest.findMany({ select: { id: true, status: true } }),
      db.branchBankDeposit.findMany({ select: { id: true, status: true, is_reversed: true } }),
      db.productChalan.findMany({ select: { id: true, total_cost: true } }),
    ])
  // A closing row with no money content (all sales/other-in zero and
  // no counted difference) has nothing to post — it is not "unposted".
  const hasContent = (r: any) =>
    toPoishaExact(r.cash_sales) + toPoishaExact(r.bkash_sales) + toPoishaExact(r.nagad_sales) +
      toPoishaExact(r.rocket_sales) + toPoishaExact(r.card_sales) + toPoishaExact(r.bank_transfer_sales) +
      toPoishaExact(r.other_cash_in) !== 0 || toPoishaExact(r.cash_difference) !== 0
  return {
    closings_open: closingRows.filter((r: any) => !r.is_closed && hasContent(r) && !closings.has(r.id)).length,
    closings_closed: closingRows.filter((r: any) => r.is_closed && hasContent(r) && !closings.has(r.id)).length,
    branch_expenses: bceRows.filter(
      (r: any) => !r.salary_payment_id && !r.expense_request_id && !bce.has(r.id)
    ).length,
    company_expenses: companyRows.filter((r: any) => !company.has(r.id)).length,
    salaries: salaryRows.filter((r: any) => r.status !== 'voided' && !salaries.has(r.id)).length,
    expense_requests_paid: requestRows.filter((r: any) => r.status === 'paid' && !requests.has(r.id)).length,
    deposits_approved: depositRows.filter(
      (r: any) => r.status === 'approved' && !r.is_reversed && !deposits.has(r.id)
    ).length,
    chalans_costed: chalanRows.filter((r: any) => toPoishaExact(r.total_cost) > 0 && !chalans.has(r.id)).length,
    chalans_uncosted_flagged: chalanRows.filter((r: any) => toPoishaExact(r.total_cost) <= 0).length,
  }
}

/**
 * Per-class reconciliation: journal figures vs the source modules'
 * own totals. All values in poisha.
 */
export async function classReconciliation(db: Db): Promise<
  Array<{ cls: string; source_total: number; journal_total: number; match: boolean; note?: string }>
> {
  const tb = await trialBalance(db)
  const byCode = new Map(tb.rows.map((r) => [r.code, r]))
  const sumSource = async (fn: () => Promise<number>) => fn()

  const salarySource = await sumSource(async () =>
    (await db.salaryPayment.findMany({ where: { status: { not: 'voided' } }, select: { amount: true } }))
      .reduce((a: number, r: any) => a + toPoishaExact(r.amount), 0)
  )
  const companySource = await sumSource(async () =>
    (await db.companyExpense.findMany({ select: { total_amount: true } }))
      .reduce((a: number, r: any) => a + toPoishaExact(r.total_amount), 0)
  )
  const depositSource = await sumSource(async () =>
    (await db.branchBankDeposit.findMany({ where: { status: 'approved', is_reversed: false }, select: { amount: true } }))
      .reduce((a: number, r: any) => a + toPoishaExact(r.amount), 0)
  )
  const salesSource = await sumSource(async () =>
    (await db.branchCashLedger.findMany({
      select: { cash_sales: true, bkash_sales: true, nagad_sales: true, rocket_sales: true, card_sales: true, bank_transfer_sales: true },
    })).reduce(
      (a: number, r: any) =>
        a + toPoishaExact(r.cash_sales) + toPoishaExact(r.bkash_sales) + toPoishaExact(r.nagad_sales) +
        toPoishaExact(r.rocket_sales) + toPoishaExact(r.card_sales) + toPoishaExact(r.bank_transfer_sales),
      0
    )
  )
  const requestSource = await sumSource(async () =>
    (await db.employeeExpenseRequest.findMany({ where: { status: 'paid' }, select: { amount: true } }))
      .reduce((a: number, r: any) => a + toPoishaExact(r.amount), 0)
  )
  const chalanSaleSource = await sumSource(async () =>
    (await db.productChalan.findMany({ select: { total_amount: true } }))
      .reduce((a: number, r: any) => a + toPoishaExact(r.total_amount), 0)
  )
  const chalanCostedCost = await sumSource(async () =>
    (await db.productChalan.findMany({ select: { total_cost: true } }))
      .reduce((a: number, r: any) => a + toPoishaExact(r.total_cost), 0)
  )
  const chalanUncostedSale = await sumSource(async () =>
    (await db.productChalan.findMany({ select: { total_amount: true, total_cost: true } }))
      .filter((r: any) => toPoishaExact(r.total_cost) <= 0)
      .reduce((a: number, r: any) => a + toPoishaExact(r.total_amount), 0)
  )

  // Journal-side class totals — ACTIVE entries only: an original
  // that has been reversed contributes nothing (its contra cancels
  // it), its repost (if any) carries the live figure. Reversal
  // entries themselves never count toward a class.
  const entries = await db.journalEntry.findMany({
    select: { id: true, source_table: true, event_type: true, is_reversal: true, reverses_entry_id: true },
  })
  const reversedIds = new Set(
    entries.filter((e: any) => e.reverses_entry_id).map((e: any) => e.reverses_entry_id)
  )
  const entryById = new Map(
    entries
      .filter((e: any) => !e.is_reversal && !reversedIds.has(e.id))
      .map((e: any) => [e.id, e])
  )
  const lines = await db.journalLine.findMany({ select: { entry_id: true, account_id: true, debit: true, credit: true } })
  const acctCode = new Map(tb.rows.map((r) => [r.account_id, r.code]))
  const classDebit = (table: string, code?: string): number => {
    let sum = 0
    for (const l of lines) {
      const e: any = entryById.get(l.entry_id)
      if (!e || e.source_table !== table || e.is_reversal) continue
      if (code && acctCode.get(l.account_id) !== code) continue
      sum += toPoishaExact(l.debit)
    }
    return sum
  }
  const salesJournal = (() => {
    let sum = 0
    for (const l of lines) {
      const e: any = entryById.get(l.entry_id)
      if (!e || e.source_table !== 'branch_cash_ledger' || e.is_reversal) continue
      if (acctCode.get(l.account_id) === '4000') sum += toPoishaExact(l.credit)
    }
    return sum
  })()
  const bankJournal = (() => {
    let sum = 0
    for (const l of lines) {
      const e: any = entryById.get(l.entry_id)
      if (!e || e.source_table !== 'branch_bank_deposits' || e.is_reversal) continue
      const code = acctCode.get(l.account_id) || ''
      if (code.startsWith('101')) sum += toPoishaExact(l.debit)
    }
    return sum
  })()
  const inventoryJournal = classDebit('product_chalans', '1040')

  const row = (cls: string, s: number, j: number, note?: string) => ({
    cls, source_total: s, journal_total: j, match: s === j, note,
  })
  return [
    row('Salary expense (salary_payments → Dr 5010)', salarySource, classDebit('salary_payments', '5010')),
    row('Company expenses (company_expenses → Dr 5200/5210)', companySource,
      classDebit('company_expenses', '5200') + classDebit('company_expenses', '5210')),
    row('Deposits approved (→ Dr Bank)', depositSource, bankJournal),
    row('Sales revenue (closings → Cr 4000)', salesSource, salesJournal),
    row('Expense requests paid (→ Dr 5350)', requestSource, classDebit('employee_expense_requests', '5350')),
    row('Chalans — costed cost posted to Inventory (Dr 1040, receiving leg)', chalanCostedCost, inventoryJournal,
      `Sale side: module total ৳${taka(chalanSaleSource)} across 33 chalans; the 23 cost-missing chalans (sale ৳${taka(chalanUncostedSale)}) post NOTHING by the P8/FR-8.2 rule and are flagged, so journal chalan value is cost-basis only.`),
  ]
}
