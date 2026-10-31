/**
 * branch_accounts_summary — the summary view, rebuilt in code.
 * This implements the fixed definition:
 *  - today's figures from the ledger row of the Asia/Dhaka date;
 *  - monthly deposit aggregates over the half-open Dhaka month
 *    window [month start, next month start);
 *  - pending totals EXCLUDE reversed deposits (the B8 fix);
 *  - manager = the branch's ACTIVE assignment's profile.
 * Output keys are the view's column names, unchanged.
 */
import { prisma } from '@/lib/db'
import { dhakaToday, currentDhakaMonthWindow } from '@/lib/dhaka-time'
import { sumMoney } from '@/lib/money'

export interface BranchAccountsSummaryRow {
  branch_id: string
  branch_name: string
  manager_name: string | null
  manager_id: string | null
  today_cash_sales: number
  today_cash_expenses: number
  expected_cash: number
  actual_cash: number
  cash_difference: number
  difference_status: string | null
  today_closed: boolean | null
  monthly_approved_deposits: number
  monthly_pending_deposits: number
  pending_deposit_count: number
}

export async function getBranchAccountsSummary(): Promise<BranchAccountsSummaryRow[]> {
  const today = dhakaToday()
  const { start: monthStart, endExclusive: monthEnd } = currentDhakaMonthWindow()
  const todayDt = new Date(`${today}T00:00:00.000Z`)
  const monthStartDt = new Date(`${monthStart}T00:00:00.000Z`)
  const monthEndDt = new Date(`${monthEnd}T00:00:00.000Z`)

  const [branches, assignments, todayLedgers, monthDeposits] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, name: true } }),
    prisma.branchManagerAssignment.findMany({
      where: { is_active: true },
      select: { branch_id: true, employee_id: true },
    }),
    prisma.branchCashLedger.findMany({
      where: { ledger_date: todayDt },
      select: {
        branch_id: true, cash_sales: true, cash_expenses: true,
        expected_closing_cash: true, actual_cash: true, cash_difference: true,
        difference_status: true, is_closed: true,
      },
    }),
    prisma.branchBankDeposit.findMany({
      where: { deposit_date: { gte: monthStartDt, lt: monthEndDt } },
      select: { branch_id: true, amount: true, status: true, is_reversed: true },
    }),
  ])

  const managerIds = [...new Set(assignments.map((a) => a.employee_id))]
  const managers = managerIds.length
    ? await prisma.profile.findMany({
        where: { id: { in: managerIds } },
        select: { id: true, full_name: true },
      })
    : []
  const managerNameById = new Map(managers.map((m) => [m.id, m.full_name]))
  const managerByBranch = new Map(assignments.map((a) => [a.branch_id, a.employee_id]))
  const ledgerByBranch = new Map(todayLedgers.map((l) => [l.branch_id, l]))

  return branches.map((b) => {
    const managerId = managerByBranch.get(b.id) ?? null
    const l = ledgerByBranch.get(b.id)
    const deps = monthDeposits.filter((d) => d.branch_id === b.id)
    const approved = deps.filter((d) => d.status === 'approved' && d.is_reversed !== true)
    const pending = deps.filter(
      (d) => ['submitted', 'pending_approval'].includes(d.status) && d.is_reversed !== true
    )
    return {
      branch_id: b.id,
      branch_name: b.name,
      manager_name: managerId ? managerNameById.get(managerId) ?? null : null,
      manager_id: managerId,
      today_cash_sales: l ? Number(l.cash_sales ?? 0) : 0,
      today_cash_expenses: l ? Number(l.cash_expenses ?? 0) : 0,
      expected_cash: l ? Number(l.expected_closing_cash ?? 0) : 0,
      actual_cash: l ? Number(l.actual_cash ?? 0) : 0,
      cash_difference: l ? Number(l.cash_difference ?? 0) : 0,
      difference_status: l?.difference_status ?? null,
      today_closed: l ? l.is_closed ?? null : null,
      monthly_approved_deposits: sumMoney(approved.map((d) => Number(d.amount))),
      monthly_pending_deposits: sumMoney(pending.map((d) => Number(d.amount))),
      pending_deposit_count: pending.length,
    }
  })
}
