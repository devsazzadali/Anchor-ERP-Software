/**
 * Round 2 Step 6 (D7) — the branch manager's read-only window
 * ("আমার শাখার হিসাব"). Everything here is a pure read over the
 * same sources the admin surfaces use: the journal (branch cash
 * on account 1000 + this month's branch P&L) and the payables
 * register (rows carrying this branch_id). No writes, ever.
 */
import { type Db } from './post'
import { toPoishaExact, taka } from './reports'
import { resolveScopeFor, profitAndLoss } from './statements'
import { dhakaToday } from '../../dhaka-time'

export async function branchAccountsView(db: Db, branchId: string) {
  const branch = await db.branch.findUnique({
    where: { id: branchId },
    select: { id: true, name: true },
  })
  if (!branch) return null

  // ── Branch cash position: posted journal lines on 1000
  // (Cash in Hand — Branches) carrying this branch_id.
  let cashP = 0
  const acct1000 = await db.chartAccount.findUnique({
    where: { code: '1000' },
    select: { id: true },
  })
  if (acct1000) {
    const postedIds = new Set(
      (await db.journalEntry.findMany({ where: { status: 'posted' }, select: { id: true } })).map((e: any) => e.id)
    )
    const lines = await db.journalLine.findMany({
      where: { account_id: acct1000.id, branch_id: branchId },
      select: { entry_id: true, debit: true, credit: true },
    })
    for (const l of lines) {
      if (!postedIds.has(l.entry_id)) continue
      cashP += toPoishaExact(l.debit) - toPoishaExact(l.credit)
    }
  }

  // ── This month's result for the branch (Dhaka month).
  const today = dhakaToday()
  const month = today.slice(0, 7)
  const scope = await resolveScopeFor(db, month, 'period')
  const pl = scope ? await profitAndLoss(db, scope, branchId) : null

  // ── Own-branch payables still outstanding.
  const rows = await db.payableReceivable.findMany({
    where: { direction: 'payable', status: { not: 'settled' }, branch_id: branchId },
    orderBy: [{ due_date: 'asc' }, { created_at: 'asc' }],
  })
  const cpIds = [...new Set(rows.map((r: any) => r.counterparty_id).filter(Boolean))]
  const cps = cpIds.length
    ? await db.counterparty.findMany({ where: { id: { in: cpIds } }, select: { id: true, name: true } })
    : []
  const cpName = new Map(cps.map((c: any) => [c.id, c.name]))
  let totalP = 0
  const payables = rows.map((r: any) => {
    const open = Math.round((Number(r.amount) - Number(r.paid_amount)) * 100)
    totalP += open
    const due = r.due_date ? r.due_date.toISOString().slice(0, 10) : null
    return {
      id: r.id,
      counterparty_name: r.counterparty_id ? (cpName.get(r.counterparty_id) ?? null) : null,
      description: r.description,
      amount_open: taka(open),
      due_date: due,
      status: r.status,
      overdue: r.status === 'overdue' || (due !== null && due < today && r.status !== 'settled'),
    }
  })

  return {
    branch: { id: branch.id, name: branch.name },
    as_of: today,
    month,
    cash: taka(cashP),
    pl: pl
      ? {
          income: taka(pl.total_income),
          expenses: taka(pl.total_expenses),
          net: taka(pl.net),
        }
      : null,
    payables,
    payables_total: taka(totalP),
  }
}
