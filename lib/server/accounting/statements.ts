/**
 * Accounts A2 — financial statements over the A1 journal.
 *
 * Statements read ONLY journal_lines of posted journal_entries
 * (plus chart/period/branch masters for labels and the opening
 * position for its status). No figure is ever taken from an
 * operational module table — the single exception is the P&L
 * COGS-coverage note, which counts uncosted chalans as a coverage
 * warning and is labelled as such (blueprint §B.5 stage A2).
 *
 * All money math is integer poisha (see reports.ts), so statement
 * totals tie to the trial balance to the poisha.
 *
 * Scopes:
 *  - 'period' — one accounting period (month).
 *  - 'fytd'   — fiscal-year start through the selected period's end.
 *  - balance sheet — cumulative from the first journal entry
 *    through an as-of date (a balance sheet is a position, not a
 *    flow, so it never uses a single-period scope).
 *
 * Honesty rules (task law):
 *  - The balance sheet is PROVISIONAL while the latest opening
 *    position is unconfirmed (status 'draft'): the payload carries
 *    `provisional: true` and the screen renders a banner. Head
 *    Office cash (1005) carries a large credit balance because the
 *    historical funding of head office exists in no source module —
 *    that funding is the opening position's unconfirmed equity
 *    balancing figure, and the statements say so rather than
 *    hiding the shape.
 *  - The P&L follows the JOURNAL (salary expense is account 5010's
 *    net ৳146,186.86 — payments + their ledger-head BCE rows — not
 *    the salary module's own ৳111,186.86 sum).
 *  - No COGS is posted by the current posting map (chalan postings
 *    move inventory at cost between branches, Dr/Cr 1040); the P&L
 *    carries the coverage note instead of an invented gross profit.
 */
import { type Db } from './post'
import { toPoishaExact } from './reports'

const isoDate = (d: unknown): string => {
  if (d == null) return ''
  if (typeof d === 'string') return d.slice(0, 10)
  return (d as Date).toISOString().slice(0, 10)
}

export interface PeriodInfo {
  month: string
  fy_label: string
  status: string
  start: string
  end: string
}

export interface ScopeInfo {
  kind: 'period' | 'fytd'
  from: string
  to: string
  period_month: string
  label: string
}

export interface StatementMeta {
  periods: PeriodInfo[]
  branches: Array<{ id: string; name: string }>
  opening: {
    status: string
    label: string
    as_of: string
    equity_draft: number | null // poisha — the unconfirmed balancing figure
  } | null
  journal_coverage: { first_entry: string | null; last_entry: string | null; entries: number }
  default_period: string
}

async function loadPeriods(db: Db): Promise<PeriodInfo[]> {
  const [periods, years] = await Promise.all([
    db.accountingPeriod.findMany({ orderBy: { month: 'asc' } }),
    db.fiscalYear.findMany({}),
  ])
  const fyById = new Map<string, any>(years.map((y: any) => [y.id, y]))
  return periods.map((p: any) => ({
    month: p.month,
    fy_label: fyById.get(p.fiscal_year_id)?.label ?? '',
    fy_start: isoDate(fyById.get(p.fiscal_year_id)?.start_date),
    status: p.status,
    start: isoDate(p.start_date),
    end: isoDate(p.end_date),
  }))
}

export async function statementMeta(db: Db): Promise<StatementMeta> {
  const [periods, branches, position, coverage] = await Promise.all([
    loadPeriods(db),
    db.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.openingPosition.findFirst({ orderBy: { created_at: 'desc' } }),
    db.journalEntry.aggregate({
      where: { status: 'posted' },
      _min: { entry_date: true },
      _max: { entry_date: true },
      _count: true,
    }),
  ])
  let equityDraft: number | null = null
  if (position) {
    const lines = await db.openingPositionLine.findMany({
      where: { position_id: position.id, component: 'equity' },
      select: { amount: true },
    })
    if (lines.length) equityDraft = lines.reduce((a: number, l: any) => a + toPoishaExact(l.amount), 0)
  }
  const lastEntry = isoDate(coverage._max.entry_date) || null
  const defaultPeriod =
    periods.filter((p) => lastEntry && p.start <= lastEntry && lastEntry <= p.end).at(-1)?.month ??
    periods.at(-1)?.month ??
    ''
  return {
    periods: periods.map(({ month, fy_label, status, start, end }) => ({ month, fy_label, status, start, end })),
    branches: branches.map((b: any) => ({ id: b.id, name: b.name })),
    opening: position
      ? {
          status: position.status,
          label: position.label,
          as_of: isoDate(position.as_of_date),
          equity_draft: equityDraft,
        }
      : null,
    journal_coverage: {
      first_entry: isoDate(coverage._min.entry_date) || null,
      last_entry: lastEntry,
      entries: coverage._count,
    },
    default_period: defaultPeriod,
  }
}

/** Resolve a period + scope kind into an inclusive date range. Returns null for an unknown period. */
export function resolveScope(periods: Array<PeriodInfo & { fy_start?: string }>, periodMonth: string, kind: 'period' | 'fytd'): ScopeInfo | null {
  const p: any = periods.find((x) => x.month === periodMonth)
  if (!p) return null
  if (kind === 'fytd') {
    return {
      kind,
      from: p.fy_start ?? p.start,
      to: p.end,
      period_month: p.month,
      label: `${p.fy_label} to date (through ${p.month})`,
    }
  }
  return { kind, from: p.start, to: p.end, period_month: p.month, label: `Period ${p.month}` }
}

export async function resolveScopeFor(db: Db, periodMonth: string, kind: 'period' | 'fytd'): Promise<ScopeInfo | null> {
  const periods = await loadPeriods(db)
  return resolveScope(periods as any, periodMonth, kind)
}

interface AccountAgg {
  account_id: string
  code: string
  name: string
  type: string
  debit: number
  credit: number
}

/**
 * Aggregate posted journal lines in an inclusive entry_date range
 * (from/to may be null = unbounded). Optional branch filter applies
 * to the LINES (branch P&L). Returns per-account poisha totals and
 * the number of distinct posted entries touched.
 */
async function aggregate(
  db: Db,
  opts: { from?: string | null; to?: string | null; branch_id?: string | null }
): Promise<{ byAccount: Map<string, AccountAgg>; accounts: any[]; entry_count: number }> {
  const accounts = await db.chartAccount.findMany({ orderBy: { code: 'asc' } })
  const entries = await db.journalEntry.findMany({
    where: { status: 'posted' },
    select: { id: true, entry_date: true },
  })
  const inRange = entries.filter((e: any) => {
    const d = isoDate(e.entry_date)
    if (opts.from && d < opts.from) return false
    if (opts.to && d > opts.to) return false
    return true
  })
  const ids = new Set(inRange.map((e: any) => e.id))
  const lines = await db.journalLine.findMany({
    select: { entry_id: true, account_id: true, branch_id: true, debit: true, credit: true },
  })
  const byAccount = new Map<string, AccountAgg>()
  const acctById = new Map(accounts.map((a: any) => [a.id, a]))
  const touched = new Set<string>()
  for (const l of lines) {
    if (!ids.has(l.entry_id)) continue
    if (opts.branch_id && l.branch_id !== opts.branch_id) continue
    const a: any = acctById.get(l.account_id)
    if (!a) continue
    touched.add(l.entry_id)
    const cur = byAccount.get(l.account_id) ?? {
      account_id: l.account_id, code: a.code, name: a.name, type: a.type, debit: 0, credit: 0,
    }
    cur.debit += toPoishaExact(l.debit)
    cur.credit += toPoishaExact(l.credit)
    byAccount.set(l.account_id, cur)
  }
  return { byAccount, accounts, entry_count: touched.size }
}

export interface StatementRow {
  code: string
  name: string
  type: string
  debit: number
  credit: number
  balance: number // poisha, debit-positive
}

/** Trial balance for a scope — same presentation semantics as the A1 trial balance, date-scoped. */
export async function trialBalanceStatement(db: Db, scope: ScopeInfo) {
  const { byAccount, accounts, entry_count } = await aggregate(db, { from: scope.from, to: scope.to })
  let totalDebit = 0
  let totalCredit = 0
  const rows: StatementRow[] = accounts.map((a: any) => {
    const s = byAccount.get(a.id) ?? { debit: 0, credit: 0 }
    totalDebit += s.debit
    totalCredit += s.credit
    return { code: a.code, name: a.name, type: a.type, debit: s.debit, credit: s.credit, balance: s.debit - s.credit }
  })
  return {
    rows,
    total_debit: totalDebit,
    total_credit: totalCredit,
    difference: totalDebit - totalCredit,
    balanced: totalDebit === totalCredit,
    entry_count,
  }
}

export interface PlRow {
  code: string
  name: string
  amount: number // poisha, natural side positive (income: credit-net; expense: debit-net)
}

export interface ProfitAndLoss {
  income: PlRow[]
  expenses: PlRow[]
  total_income: number
  total_expenses: number
  net: number // income − expenses (poisha); negative = loss
  entry_count: number
  branch_id: string | null
  by_branch: Array<{ branch_id: string; branch_name: string; income: number; expenses: number; net: number }> | null
  notes: {
    journal_from: string | null
    journal_to: string | null
    opening_status: string | null
    opening_equity_draft: number | null
    uncosted_chalans: number
    uncosted_chalan_sale: number // poisha — coverage note only, NOT a statement figure
    total_chalans: number
  }
}

export async function profitAndLoss(db: Db, scope: ScopeInfo, branchId?: string | null): Promise<ProfitAndLoss> {
  const meta = await statementMeta(db)
  const { byAccount, entry_count } = await aggregate(db, {
    from: scope.from,
    to: scope.to,
    branch_id: branchId || null,
  })
  const income: PlRow[] = []
  const expenses: PlRow[] = []
  for (const s of byAccount.values()) {
    if (s.type === 'income') income.push({ code: s.code, name: s.name, amount: s.credit - s.debit })
    else if (s.type === 'expense') expenses.push({ code: s.code, name: s.name, amount: s.debit - s.credit })
  }
  income.sort((a, b) => a.code.localeCompare(b.code))
  expenses.sort((a, b) => a.code.localeCompare(b.code))
  const totalIncome = income.reduce((a, r) => a + r.amount, 0)
  const totalExpenses = expenses.reduce((a, r) => a + r.amount, 0)

  // Per-branch breakdown (company view only). Every income/expense
  // line carries branch_id, so the branch rows sum to the company
  // totals exactly — the payload keeps both so the screen (and the
  // A2 proof) can show the tie.
  let byBranch: ProfitAndLoss['by_branch'] = null
  if (!branchId) {
    const branchTotals = new Map<string, { income: number; expenses: number }>()
    const all = await aggregate(db, { from: scope.from, to: scope.to })
    const lines = await db.journalLine.findMany({
      select: { entry_id: true, account_id: true, branch_id: true, debit: true, credit: true },
    })
    const entries = await db.journalEntry.findMany({ where: { status: 'posted' }, select: { id: true, entry_date: true } })
    const ids = new Set(
      entries.filter((e: any) => { const d = isoDate(e.entry_date); return d >= scope.from && d <= scope.to }).map((e: any) => e.id)
    )
    const typeById = new Map(all.accounts.map((a: any) => [a.id, a.type]))
    const nameById = new Map(meta.branches.map((b) => [b.id, b.name]))
    for (const l of lines) {
      if (!ids.has(l.entry_id) || !l.branch_id) continue
      const t = typeById.get(l.account_id)
      if (t !== 'income' && t !== 'expense') continue
      const cur = branchTotals.get(l.branch_id) ?? { income: 0, expenses: 0 }
      if (t === 'income') cur.income += toPoishaExact(l.credit) - toPoishaExact(l.debit)
      else cur.expenses += toPoishaExact(l.debit) - toPoishaExact(l.credit)
      branchTotals.set(l.branch_id, cur)
    }
    byBranch = [...branchTotals.entries()]
      .map(([bid, v]) => ({
        branch_id: bid,
        branch_name: nameById.get(bid) ?? bid,
        income: v.income,
        expenses: v.expenses,
        net: v.income - v.expenses,
      }))
      .sort((a, b) => a.branch_name.localeCompare(b.branch_name))
  }

  // COGS-coverage note (blueprint §B.5 A2): chalans whose cost was
  // never recorded post nothing (P8 rule). The COUNT and their sale
  // value are a coverage warning, not statement figures.
  const chalanRows = await db.productChalan.findMany({ select: { total_amount: true, total_cost: true } })
  const uncosted = chalanRows.filter((r: any) => toPoishaExact(r.total_cost) <= 0)

  return {
    income,
    expenses,
    total_income: totalIncome,
    total_expenses: totalExpenses,
    net: totalIncome - totalExpenses,
    entry_count,
    branch_id: branchId || null,
    by_branch: byBranch,
    notes: {
      journal_from: meta.journal_coverage.first_entry,
      journal_to: meta.journal_coverage.last_entry,
      opening_status: meta.opening?.status ?? null,
      opening_equity_draft: meta.opening?.equity_draft ?? null,
      uncosted_chalans: uncosted.length,
      uncosted_chalan_sale: uncosted.reduce((a: number, r: any) => a + toPoishaExact(r.total_amount), 0),
      total_chalans: chalanRows.length,
    },
  }
}

export interface BalanceSheet {
  as_of: string
  assets: PlRow[] // amount = debit-net (may be negative — shown as recorded)
  liabilities: PlRow[] // amount = credit-net
  equity: PlRow[] // amount = credit-net (equity accounts only)
  total_assets: number
  total_liabilities: number
  total_equity: number // equity accounts only
  current_result: number // cumulative income − expenses through as_of (poisha; negative = accumulated loss)
  total_liabilities_equity: number // liabilities + equity + current_result
  balanced: boolean
  entry_count: number
  provisional: boolean
  opening_status: string | null
}

export async function balanceSheet(db: Db, asOf: string): Promise<BalanceSheet> {
  const meta = await statementMeta(db)
  const { byAccount, entry_count } = await aggregate(db, { from: null, to: asOf })
  const assets: PlRow[] = []
  const liabilities: PlRow[] = []
  const equity: PlRow[] = []
  let incomeNet = 0
  let expenseNet = 0
  for (const s of byAccount.values()) {
    const drNet = s.debit - s.credit
    if (s.type === 'asset') assets.push({ code: s.code, name: s.name, amount: drNet })
    else if (s.type === 'liability') liabilities.push({ code: s.code, name: s.name, amount: -drNet })
    else if (s.type === 'equity') equity.push({ code: s.code, name: s.name, amount: -drNet })
    else if (s.type === 'income') incomeNet += -drNet
    else if (s.type === 'expense') expenseNet += drNet
  }
  const byCode = (a: PlRow, b: PlRow) => a.code.localeCompare(b.code)
  assets.sort(byCode); liabilities.sort(byCode); equity.sort(byCode)
  const totalAssets = assets.reduce((a, r) => a + r.amount, 0)
  const totalLiabilities = liabilities.reduce((a, r) => a + r.amount, 0)
  const totalEquity = equity.reduce((a, r) => a + r.amount, 0)
  const currentResult = incomeNet - expenseNet
  const totalLE = totalLiabilities + totalEquity + currentResult
  const openingStatus = meta.opening?.status ?? null
  return {
    as_of: asOf,
    assets: assets.filter((r) => r.amount !== 0),
    liabilities: liabilities.filter((r) => r.amount !== 0),
    equity: equity.filter((r) => r.amount !== 0),
    total_assets: totalAssets,
    total_liabilities: totalLiabilities,
    total_equity: totalEquity,
    current_result: currentResult,
    total_liabilities_equity: totalLE,
    balanced: totalAssets === totalLE,
    entry_count,
    provisional: openingStatus !== 'confirmed',
    opening_status: openingStatus,
  }
}
