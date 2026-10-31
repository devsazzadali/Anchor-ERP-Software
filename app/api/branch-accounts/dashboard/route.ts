import { NextRequest, NextResponse } from 'next/server'
import { dhakaToday, currentDhakaMonthWindow } from '@/lib/dhaka-time'
import { sumMoney } from '@/lib/money'
import { prisma } from '@/lib/db'
import { LEDGER_DEPOSITS_DEFINITION } from '@/lib/deposit-figures'
import { branchStreamAmount } from '@/lib/expense-streams'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
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

    const isAdmin = callerIsAdmin(profile)
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

      // Fetch today's ledger, this month's PENDING deposits (a
      // deposits-table concept — money awaiting approval, not a
      // deposits total), monthly ledgers, and this month's branch
      // cash expense rows in parallel.
      const [ledgerRaw, depositsRaw, monthlyLedgersRaw, monthExpensesRaw] = await Promise.all([
        prisma.branchCashLedger.findFirst({ where: { branch_id: branchId, ledger_date: todayDt } }),
        prisma.branchBankDeposit.findMany({
          where: {
            branch_id: branchId,
            deposit_date: { gte: monthStartDt, lt: monthEndDt },
            status: { in: ['submitted', 'pending_approval'] },
            ...notReversed,
          },
          select: { amount: true, status: true, deposit_date: true },
        }),
        prisma.branchCashLedger.findMany({
          where: { branch_id: branchId, ledger_date: { gte: monthStartDt, lt: monthEndDt } },
        }),
        prisma.branchCashExpense.findMany({
          where: { branch_id: branchId, expense_date: { gte: monthStartDt, lt: monthEndDt } },
          select: { amount: true, salary_payment_id: true, expense_request_id: true, ledger_head_id: true, expense_date: true },
        }),
      ])

      const ledger: any = toPlain(ledgerRaw)
      const deposits: any[] = toPlain(depositsRaw)
      const monthlyLedgers: any[] = toPlain(monthlyLedgersRaw)
      const monthExpenses: any[] = toPlain(monthExpensesRaw)

      const pendingDeposits = sumMoney(deposits.map((d) => d.amount))
      const pendingCount = deposits.length

      // §D5 #5 (supersedes the old B13 dual definition): there is
      // ONE deposits figure — the LEDGER figure, Σ bank_deposits_out
      // over this month's ledger days. The response used to carry
      // two differently-defined "approved deposits" numbers (lump
      // by deposit_date as the headline, breakdown slices inside
      // netCashInflow); both are now this same ledger sum, so the
      // headline and the net-inflow subtraction can never diverge.
      const approvedDeposits = sumMoney(monthlyLedgers.map((r) => r.bank_deposits_out))

      const monthlyCashSales = sumMoney(monthlyLedgers.map((r) => r.cash_sales))
      const monthlyDigitalSales = sumMoney(monthlyLedgers.flatMap((r) => [r.bkash_sales, r.nagad_sales, r.rocket_sales, r.card_sales, r.bank_transfer_sales]))
      const monthlyOtherCashIn = sumMoney(monthlyLedgers.map((r) => r.other_cash_in))
      // FR-10/X4: expenses are RECOMPUTED from the branch cash
      // expense rows through the one stream rule (branchStreamAmount)
      // — the same computation the Account Overview and the financial
      // summary use — instead of the stored ledger cash_expenses sum.
      // On synced data the two are identical; if a ledger sync is
      // ever missed, this surface still shows the true figure.
      const monthlyExpenses = sumMoney(monthExpenses.map((r) => branchStreamAmount(r)))
      const todayExpensesRecomputed = sumMoney(
        monthExpenses.filter((r) => String(r.expense_date).slice(0, 10) === today).map((r) => branchStreamAmount(r))
      )
      const monthlyTotalSales = monthlyCashSales + monthlyDigitalSales
      const monthlyNetCashInflow = monthlyCashSales + monthlyOtherCashIn - monthlyExpenses - approvedDeposits
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
          // FR-10/X4: today's expenses from the same recomputation.
          cashExpenses: todayExpensesRecomputed,
          bankDepositsOut: ledger?.bank_deposits_out ?? 0,
          expectedClosingCash: ledger?.expected_closing_cash ?? 0,
          actualCash: ledger?.actual_cash ?? null,
          cashDifference: ledger?.cash_difference ?? null,
          differenceStatus: ledger?.difference_status ?? null,
          isClosed: ledger?.is_closed ?? false,
        },
        monthly: {
          approvedDeposits,
          depositsDefinition: LEDGER_DEPOSITS_DEFINITION,
          depositsWindow: { start: monthStart, endExclusive: monthEndExclusive },
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
    const [summary, pendingApprovals, todayLedgersRaw, allMonthlyDepositsRaw, monthlyLedgersAllRaw, todayExpensesRaw] = await Promise.all([
      getBranchAccountsSummary(),
      prisma.branchBankDeposit.count({
        where: { status: { in: ['submitted', 'pending_approval'] }, ...notReversed },
      }),
      prisma.branchCashLedger.findMany({ where: { ledger_date: todayDt } }),
      // Pending sums only — a deposits-table concept (money awaiting
      // approval), not the deposits total.
      prisma.branchBankDeposit.findMany({
        where: {
          deposit_date: { gte: monthStartDt, lt: monthEndDt },
          status: { in: ['submitted', 'pending_approval'] },
          ...notReversed,
        },
        select: { amount: true, status: true },
      }),
      // §D5 #5: the admin monthly deposits figure is the same single
      // LEDGER figure as the manager's — Σ bank_deposits_out over
      // this month's ledger days, all branches.
      prisma.branchCashLedger.findMany({
        where: { ledger_date: { gte: monthStartDt, lt: monthEndDt } },
        select: { bank_deposits_out: true },
      }),
      // FR-10/X4: today's branch cash expense rows (all branches)
      // for the recomputed expense figure below.
      prisma.branchCashExpense.findMany({
        where: { expense_date: todayDt },
        select: { amount: true, salary_payment_id: true, expense_request_id: true, ledger_head_id: true },
      }),
    ])

    const todayLedgers: any[] = toPlain(todayLedgersRaw)
    const allMonthlyDeposits: any[] = toPlain(allMonthlyDepositsRaw)
    const monthlyLedgersAll: any[] = toPlain(monthlyLedgersAllRaw)

    const todayCashSales = todayLedgers.reduce((s, r) => s + Number(r.cash_sales ?? 0), 0)
    const todayBkashSales = todayLedgers.reduce((s, r) => s + Number(r.bkash_sales ?? 0), 0)
    const todayNagadSales = todayLedgers.reduce((s, r) => s + Number(r.nagad_sales ?? 0), 0)
    const todayRocketSales = todayLedgers.reduce((s, r) => s + Number(r.rocket_sales ?? 0), 0)
    const todayCardSales = todayLedgers.reduce((s, r) => s + Number(r.card_sales ?? 0), 0)
    const todayBankTransferSales = todayLedgers.reduce((s, r) => s + Number(r.bank_transfer_sales ?? 0), 0)
    const todayOtherCashIn = todayLedgers.reduce((s, r) => s + Number(r.other_cash_in ?? 0), 0)
    // FR-10/X4: today's expenses recomputed from the expense rows
    // via branchStreamAmount (same rule as the manager view and the
    // Account Overview), not the stored ledger cash_expenses sum.
    const todayExpenses = sumMoney((toPlain(todayExpensesRaw) as any[]).map((r) => branchStreamAmount(r)))
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

    const adminApprovedDeposits = monthlyLedgersAll
      .reduce((s: number, r: any) => s + Number(r.bank_deposits_out ?? 0), 0)

    const adminPendingDeposits = allMonthlyDeposits
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
        depositsDefinition: LEDGER_DEPOSITS_DEFINITION,
        depositsWindow: { start: monthStart, endExclusive: monthEndExclusive },
        pendingDeposits: adminPendingDeposits,
        pendingCount: pendingApprovals ?? 0,
      },
    })
  } catch (err: any) {
    console.error('Dashboard API error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
