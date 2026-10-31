import { NextRequest, NextResponse } from 'next/server'
import { dhakaToday, currentDhakaMonthWindow } from '@/lib/dhaka-time'
import { sumMoney } from '@/lib/money'
import { parseDailyBreakdown } from '@/lib/branch-deposit-utils'
import { prisma } from '@/lib/db'
import { getCallerProfile, isAdminRole } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { getBranchAccountsSummary } from '@/lib/server/summary'

// GET /api/branch-accounts/dashboard
// Returns Manager dashboard KPIs scoped to their branch.
// For Admins: returns all-branch summary.
//
// caller via the single role-resolution
// function; the branch_accounts_summary VIEW is rebuilt in code
// (lib/server/summary.ts, batch-1 fixed definition). Fetches are
// complete (no 1,000-row cap — B26).
export async function GET(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)
    if (!profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isAdmin = isAdminRole(profile.role)
    const isManager = profile.is_branch_manager === true

    if (!isAdmin && !isManager) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // B9/B10: "today" and the month window are Asia/Dhaka, and the
    // window is half-open [start, endExclusive). The old code used the
    // UTC date (yesterday for Dhaka 00:00–05:59) and an end-of-month
    // built via toISOString() that silently dropped the month's last
    // day.
    const today = dhakaToday()
    const { start: monthStart, endExclusive: monthEndExclusive } = currentDhakaMonthWindow()
    const todayDt = new Date(`${today}T00:00:00.000Z`)
    const monthStartDt = new Date(`${monthStart}T00:00:00.000Z`)
    const monthEndDt = new Date(`${monthEndExclusive}T00:00:00.000Z`)
    // Original semantics: .neq('is_reversed', true). is_reversed is
    // NOT NULL (default false) in both the source DB and this clone's
    // Prisma model, so "not true" is exactly "false" — the old
    // OR-with-null branch was invalid Prisma for a required field
    // ("Argument is_reversed is missing") and 500'd this route.
    const notReversed = { is_reversed: false }

    if (isManager) {
      const branchId = profile.branch_id
      if (!branchId) {
        return NextResponse.json({ error: 'No branch assigned to this manager' }, { status: 400 })
      }

      // Fetch today's ledger, deposits, and monthly ledgers in parallel
      const [ledgerRaw, depositsRaw, monthlyLedgersRaw] = await Promise.all([
        prisma.branchCashLedger.findFirst({ where: { branch_id: branchId, ledger_date: todayDt } }),
        prisma.branchBankDeposit.findMany({
          where: {
            branch_id: branchId,
            AND: [
              {
                OR: [
                  { deposit_date: { gte: monthStartDt, lt: monthEndDt } },
                  { sales_from_date: { lt: monthEndDt }, sales_to_date: { gte: monthStartDt } },
                ],
              },
              notReversed,
            ],
          },
          select: { amount: true, status: true, deposit_date: true, daily_breakdown: true, notes: true },
        }),
        prisma.branchCashLedger.findMany({
          where: { branch_id: branchId, ledger_date: { gte: monthStartDt, lt: monthEndDt } },
        }),
      ])

      const ledger: any = toPlain(ledgerRaw)
      const deposits: any[] = toPlain(depositsRaw)
      const monthlyLedgers: any[] = toPlain(monthlyLedgersRaw)

      const inMonth = (dateStr: string) => dateStr >= monthStart && dateStr < monthEndExclusive
      const madeThisMonth = deposits.filter((d) => inMonth(d.deposit_date))
      const approvedDeposits = sumMoney(madeThisMonth.filter((d) => d.status === 'approved').map((d) => d.amount))
      const pendingDeposits = sumMoney(madeThisMonth.filter((d) => ['submitted', 'pending_approval'].includes(d.status)).map((d) => d.amount))
      const pendingCount = madeThisMonth.filter((d) => ['submitted', 'pending_approval'].includes(d.status)).length

      // B13: netCashInflow compares against THIS month's sales, so the
      // deposits subtracted must be the ones belonging to this month's
      // SALES — breakdown slices falling inside the window (a deposit
      // banked next month for this month's last days still counts
      // here; its deposit-month headline figure is approvedDeposits).
      const approvedDepositsForSalesMonth = sumMoney(
        deposits
          .filter((d) => d.status === 'approved')
          .map((d) => {
            const breakdown = parseDailyBreakdown(d)
            if (breakdown) {
              return sumMoney(Object.entries(breakdown).filter(([date]) => inMonth(date)).map(([, amt]) => amt))
            }
            return inMonth(d.deposit_date) ? Number(d.amount) : 0
          })
      )

      const monthlyCashSales = sumMoney(monthlyLedgers.map((r) => r.cash_sales))
      const monthlyDigitalSales = sumMoney(monthlyLedgers.flatMap((r) => [r.bkash_sales, r.nagad_sales, r.rocket_sales, r.card_sales, r.bank_transfer_sales]))
      const monthlyOtherCashIn = sumMoney(monthlyLedgers.map((r) => r.other_cash_in))
      const monthlyExpenses = sumMoney(monthlyLedgers.map((r) => r.cash_expenses))
      const monthlyTotalSales = monthlyCashSales + monthlyDigitalSales
      const monthlyNetCashInflow = monthlyCashSales + monthlyOtherCashIn - monthlyExpenses - approvedDepositsForSalesMonth
      // B12: monthly figures include days not yet closed/verified.
      // Surface how many so the UI can mark the totals provisional
      // instead of presenting them as final.
      const provisionalDays = monthlyLedgers.filter((r) => !r.is_closed).length

      return NextResponse.json({
        type: 'manager',
        branchId,
        branchName: profile.branch,
        managerName: profile.full_name,
        today: {
          openingCash: ledger?.opening_cash ?? 0,
          cashSales: ledger?.cash_sales ?? 0,
          bkashSales: ledger?.bkash_sales ?? 0,
          nagadSales: ledger?.nagad_sales ?? 0,
          rocketSales: ledger?.rocket_sales ?? 0,
          cardSales: ledger?.card_sales ?? 0,
          bankTransferSales: ledger?.bank_transfer_sales ?? 0,
          otherCashIn: ledger?.other_cash_in ?? 0,
          cashExpenses: ledger?.cash_expenses ?? 0,
          bankDepositsOut: ledger?.bank_deposits_out ?? 0,
          expectedClosingCash: ledger?.expected_closing_cash ?? 0,
          actualCash: ledger?.actual_cash ?? null,
          cashDifference: ledger?.cash_difference ?? null,
          differenceStatus: ledger?.difference_status ?? null,
          isClosed: ledger?.is_closed ?? false,
        },
        monthly: {
          approvedDeposits,
          pendingDeposits,
          pendingCount,
          totalSales: monthlyTotalSales,
          cashSales: monthlyCashSales,
          digitalSales: monthlyDigitalSales,
          expenses: monthlyExpenses,
          netCashInflow: monthlyNetCashInflow,
          provisionalDays,
        },
      })
    }

    // Admin: all-branch summary, pending approvals, today's ledgers
    // and monthly deposits in parallel. The summary view is rebuilt
    // in code (lib/server/summary.ts — batch-1 fixed definition).
    const [summary, pendingApprovals, todayLedgersRaw, allMonthlyDepositsRaw] = await Promise.all([
      getBranchAccountsSummary(),
      prisma.branchBankDeposit.count({
        where: { status: { in: ['submitted', 'pending_approval'] }, ...notReversed },
      }),
      prisma.branchCashLedger.findMany({ where: { ledger_date: todayDt } }),
      prisma.branchBankDeposit.findMany({
        where: { deposit_date: { gte: monthStartDt, lt: monthEndDt }, ...notReversed },
        select: { amount: true, status: true },
      }),
    ])

    const todayLedgers: any[] = toPlain(todayLedgersRaw)
    const allMonthlyDeposits: any[] = toPlain(allMonthlyDepositsRaw)

    const todayCashSales = todayLedgers.reduce((s, r) => s + Number(r.cash_sales ?? 0), 0)
    const todayBkashSales = todayLedgers.reduce((s, r) => s + Number(r.bkash_sales ?? 0), 0)
    const todayNagadSales = todayLedgers.reduce((s, r) => s + Number(r.nagad_sales ?? 0), 0)
    const todayRocketSales = todayLedgers.reduce((s, r) => s + Number(r.rocket_sales ?? 0), 0)
    const todayCardSales = todayLedgers.reduce((s, r) => s + Number(r.card_sales ?? 0), 0)
    const todayBankTransferSales = todayLedgers.reduce((s, r) => s + Number(r.bank_transfer_sales ?? 0), 0)
    const todayOtherCashIn = todayLedgers.reduce((s, r) => s + Number(r.other_cash_in ?? 0), 0)
    const todayExpenses = todayLedgers.reduce((s, r) => s + Number(r.cash_expenses ?? 0), 0)
    const todayDepositsOut = todayLedgers.reduce((s, r) => s + Number(r.bank_deposits_out ?? 0), 0)
    // B14: the cross-branch difference is only meaningful for branches
    // that actually COUNTED cash today. The old code summed actual
    // (NULL -> 0) and expected across ALL branches, so one branch's
    // excess cancelled another's shortage and uncounted branches
    // dragged the figure. Now both sides cover only counted rows.
    const countedToday = todayLedgers.filter((r) => r.actual_cash !== null && r.actual_cash !== undefined)
    const todayExpClosing = countedToday.reduce((s, r) => s + Number(r.expected_closing_cash ?? 0), 0)
    const todayActualCash = countedToday.reduce((s, r) => s + Number(r.actual_cash ?? 0), 0)
    const todayDifference = countedToday.length > 0 ? todayActualCash - todayExpClosing : null

    const adminApprovedDeposits = allMonthlyDeposits
      .filter((d: any) => d.status === 'approved')
      .reduce((s: number, d: any) => s + Number(d.amount), 0)

    const adminPendingDeposits = allMonthlyDeposits
      .filter((d: any) => ['submitted', 'pending_approval'].includes(d.status))
      .reduce((s: number, d: any) => s + Number(d.amount), 0)

    return NextResponse.json({
      type: 'admin',
      branches: summary ?? [],
      pendingApprovals: pendingApprovals ?? 0,
      today: {
        openingCash: todayLedgers.reduce((s, r) => s + Number(r.opening_cash ?? 0), 0),
        cashSales: todayCashSales,
        bkashSales: todayBkashSales,
        nagadSales: todayNagadSales,
        rocketSales: todayRocketSales,
        cardSales: todayCardSales,
        bankTransferSales: todayBankTransferSales,
        otherCashIn: todayOtherCashIn,
        cashExpenses: todayExpenses,
        bankDepositsOut: todayDepositsOut,
        expectedClosingCash: todayExpClosing,
        actualCash: todayActualCash,
        cashDifference: todayDifference,
        differenceStatus: todayDifference === null ? null : todayDifference === 0 ? 'matched' : todayDifference < 0 ? 'shortage' : 'excess',
        // B15: "today is closed" must mean EVERY branch with a ledger
        // today has closed — .some() reported closed when a single
        // branch out of many had closed.
        isClosed: todayLedgers.length > 0 && todayLedgers.every((l) => l.is_closed),
      },
      monthly: {
        approvedDeposits: adminApprovedDeposits,
        pendingDeposits: adminPendingDeposits,
        pendingCount: pendingApprovals ?? 0,
      },
    })
  } catch (err: any) {
    console.error('Dashboard API error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
