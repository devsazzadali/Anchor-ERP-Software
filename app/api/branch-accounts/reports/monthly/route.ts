import { NextRequest, NextResponse } from 'next/server'
import { dhakaToday, dhakaMonthWindow, addDays } from '@/lib/dhaka-time'
import { sumMoney } from '@/lib/money'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { branchStreamAmount, branchCashExpenseStream } from '@/lib/expense-streams'

// GET /api/branch-accounts/reports/monthly?year=2026&month=9&branch_id=xxx
// Automatically aggregates verified daily cash ledgers, bank deposits, and expenses.
// When branch_id is omitted or 'all', aggregates across all branches and returns both branch-wise and global summaries.
//
// caller via the single role-resolution
// function (partners refused — audit Part D §3). Fetched rows are
// passed through toPlain() FIRST, so the aggregation code below runs
// on exactly the shapes PostgREST used to return (date strings,
// numbers) and is unchanged from the fixed copy. Fetches are complete
// (no 1,000-row cap — B26).
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const profile = caller

    const isAdmin = callerIsAdmin(profile)
    const isManager = profile.is_branch_manager === true

    // Partners previously counted as admin-equivalent here and could
    // read EVERY branch's ledgers, deposits (incl. bank account names/
    // numbers and transaction ids) and expenses (audit Part D §3).
    // Branch financial reports are an admin/manager surface; partners
    // have their own payout/statement pages.
    if (!isAdmin && !isManager) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const [dhakaYear, dhakaMonth] = dhakaToday().split('-').map(Number)
    const year = parseInt(searchParams.get('year') || String(dhakaYear), 10)
    const month = parseInt(searchParams.get('month') || String(dhakaMonth), 10)

    // B33: half-open Dhaka month window — the old toDate
    // (new Date(year, month, 0).toISOString()) excluded the LAST day
    // of every month from ledgers, deposits and expenses alike, so
    // monthly statements systematically missed month-end.
    const { start: fromDate, endExclusive } = dhakaMonthWindow(year, month)
    const toDate = addDays(endExclusive, -1) // last day, for display

    const reqBranchId = searchParams.get('branch_id')
    const branchId = isAdmin
      ? (reqBranchId && reqBranchId !== 'all' ? reqBranchId : null)
      : profile.branch_id

    const fromDt = new Date(`${fromDate}T00:00:00.000Z`)
    const endDt = new Date(`${endExclusive}T00:00:00.000Z`)
    const dateWindow = { gte: fromDt, lt: endDt }

    // Execute all 4 queries concurrently in parallel. B26: these
    // fetches feed network-wide totals and are COMPLETE in the app.
    const [branchesResult, ledgerRaw, depositRaw, expenseRaw] = await Promise.all([
      branchId
        ? prisma.branch.findFirst({ where: { id: branchId }, select: { id: true, name: true } })
        : prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.branchCashLedger.findMany({
        where: { ledger_date: dateWindow, ...(branchId ? { branch_id: branchId } : {}) },
        select: {
          branch_id: true, ledger_date: true, opening_cash: true, cash_sales: true, bkash_sales: true,
          nagad_sales: true, rocket_sales: true, card_sales: true, bank_transfer_sales: true,
          other_cash_in: true, cash_expenses: true, bank_deposits_out: true, actual_cash: true,
          expected_closing_cash: true, cash_difference: true, difference_status: true, is_closed: true,
        },
        orderBy: [{ ledger_date: 'desc' }, { id: 'asc' }],
      }),
      prisma.branchBankDeposit.findMany({
        where: { deposit_date: dateWindow, ...(branchId ? { branch_id: branchId } : {}) },
        select: {
          id: true, branch_id: true, deposit_date: true, sales_from_date: true, sales_to_date: true,
          amount: true, status: true, is_reversed: true, bank_account_name: true, bank_account_number: true,
          deposit_slip_number: true, bank_transaction_id: true, slip_attachment_url: true,
          daily_breakdown: true, notes: true, created_at: true,
        },
        orderBy: { id: 'asc' },
      }),
      prisma.branchCashExpense.findMany({
        where: { expense_date: dateWindow, ...(branchId ? { branch_id: branchId } : {}) },
        select: {
          id: true, branch_id: true, expense_date: true, amount: true, category: true,
          description: true, receipt_url: true,
          // Stream links: this report's expense figures are BRANCH
          // stream only (owner's account-overview rule).
          salary_payment_id: true, expense_request_id: true, ledger_head_id: true,
        },
        orderBy: { id: 'asc' },
      }),
    ])

    const ledgerRows: any[] = toPlain(ledgerRaw)
    const depositRows: any[] = toPlain(depositRaw)
    const expenseRows: any[] = toPlain(expenseRaw)

    let branchesList: { id: string; name: string }[] = []
    if (branchId) {
      const bData = branchesResult as { id: string; name: string } | null
      if (bData) branchesList = [bData]
      else branchesList = [{ id: branchId, name: profile.branch || 'Branch' }]
    } else {
      branchesList = (branchesResult as { id: string; name: string }[]) || []
    }

    // Bank-wise breakdown calculation helper
    const computeBankBreakdown = (deps: any[]) => {
      const breakdown: Record<string, { bankName: string; totalAmount: number; depositCount: number }> = {}
      for (const d of deps) {
        if (d.status === 'approved' && !d.is_reversed) {
          const bName = d.bank_account_name || 'Anchor Main Account'
          if (!breakdown[bName]) {
            breakdown[bName] = { bankName: bName, totalAmount: 0, depositCount: 0 }
          }
          breakdown[bName].totalAmount += Number(d.amount || 0)
          breakdown[bName].depositCount += 1
        }
      }
      return Object.values(breakdown).sort((a, b) => b.totalAmount - a.totalAmount)
    }

    // Branch-wise aggregation
    const monthStr = `${year}-${String(month).padStart(2, '0')}`
    const monthDateStr = `${monthStr}-01`

    const branchSummaries = branchesList.map((b) => {
      const bLedger = (ledgerRows ?? []).filter((r) => r.branch_id === b.id)
      const bDeposits = (depositRows ?? []).filter((d) => d.branch_id === b.id)
      const bExpenses = (expenseRows ?? []).filter((e) => e.branch_id === b.id)

      const cashSales = bLedger.reduce((s, r) => s + Number(r.cash_sales ?? 0), 0)
      const otherCashIn = bLedger.reduce((s, r) => s + Number(r.other_cash_in ?? 0), 0)
      const bkashSales = bLedger.reduce((s, r) => s + Number(r.bkash_sales ?? 0), 0)
      const nagadSales = bLedger.reduce((s, r) => s + Number(r.nagad_sales ?? 0), 0)
      const rocketSales = bLedger.reduce((s, r) => s + Number(r.rocket_sales ?? 0), 0)
      const cardSales = bLedger.reduce((s, r) => s + Number(r.card_sales ?? 0), 0)
      const bankTransferSales = bLedger.reduce((s, r) => s + Number(r.bank_transfer_sales ?? 0), 0)
      const digitalSales = bkashSales + nagadSales + rocketSales + cardSales + bankTransferSales
      const totalSales = cashSales + digitalSales
      const grossCashInflow = cashSales + otherCashIn

      // B34: the itemised expense rows are the primary records (the
      // ledger column is derived from them by sync). The old code
      // took Math.max(rows, ledger column) — whichever source had
      // drifted UP won and the drift itself was hidden. Now the rows
      // are the total, and any disagreement is reported as expenseDrift
      // so it can be investigated instead of papered over.
      // Stream rule (2026-10-31): the rows counted are the BRANCH
      // stream only — ledger-head rows (rent, bills) and salary
      // copies recorded against the branch are not branch operating
      // expenses (B36's note below has always claimed exactly this;
      // the sum now matches it). Drift compares like with like: the
      // ledger column is maintained from the same stream.
      const expSum = sumMoney(bExpenses.map((r) => branchStreamAmount(r as any)))
      const ledgerExpSum = sumMoney(bLedger.map((r) => r.cash_expenses))
      const totalExpenses = expSum
      const expenseDrift = sumMoney([ledgerExpSum, -expSum])

      const approvedDeposits = sumMoney(bDeposits.filter((d) => d.status === 'approved' && !d.is_reversed).map((d) => d.amount))
      // B35: the pending total must exclude reversed deposits, exactly
      // like the approved total beside it does.
      const pendingDeposits = sumMoney(bDeposits.filter((d) => ['submitted', 'pending_approval'].includes(d.status) && !d.is_reversed).map((d) => d.amount))

      const netOperating = totalSales - totalExpenses
      const operatingProfit = Math.max(0, netOperating)
      const operatingLoss = Math.max(0, -netOperating)
      const profitMargin = totalSales > 0 ? Number(((netOperating / totalSales) * 100).toFixed(1)) : 0

      // Calculate true physical closing cash retained in drawer for the branch
      const closedDaysWithCash = bLedger.filter((r) => r.is_closed && r.actual_cash !== null && r.actual_cash !== undefined)
      const sortedLedger = [...bLedger].sort((a, b) => String(b.ledger_date).localeCompare(String(a.ledger_date)))
      const latestEntry = sortedLedger[0]

      let netCash = 0
      if (closedDaysWithCash.length > 0) {
        const latestClosed = [...closedDaysWithCash].sort((a, b) => String(b.ledger_date).localeCompare(String(a.ledger_date)))[0]
        netCash = Number(latestClosed.actual_cash ?? 0)
      } else if (latestEntry && latestEntry.expected_closing_cash !== null && latestEntry.expected_closing_cash !== undefined) {
        netCash = Math.max(0, Number(latestEntry.expected_closing_cash ?? 0))
      }

      const daysClosed = bLedger.filter((r) => r.is_closed).length
      const daysTracked = bLedger.length
      const daysWithShortage = bLedger.filter((r) => r.difference_status === 'shortage').length
      const totalCashDifference = bLedger.reduce((s, r) => s + Number(r.cash_difference ?? 0), 0)
      const branchBankBreakdown = computeBankBreakdown(bDeposits)

      return {
        branchId: b.id,
        branchName: b.name,
        reportMonth: monthStr,
        cashSales,
        bkashSales,
        nagadSales,
        rocketSales,
        cardSales,
        bankTransferSales,
        digitalSales,
        totalSales,
        otherCashIn,
        grossCashInflow,
        totalExpenses,
        expenseDrift,
        operatingProfit,
        operatingLoss,
        profitMargin,
        approvedDeposits,
        pendingDeposits,
        netCash,
        daysClosed,
        daysTracked,
        daysWithShortage,
        totalCashDifference,
        bankBreakdown: branchBankBreakdown,
      }
    })

    // Overall global summary
    const totalCashSales = branchSummaries.reduce((s, b) => s + b.cashSales, 0)
    const totalDigitalSales = branchSummaries.reduce((s, b) => s + b.digitalSales, 0)
    const totalSales = totalCashSales + totalDigitalSales
    const totalOtherCashIn = branchSummaries.reduce((s, b) => s + b.otherCashIn, 0)
    const grossCashInflow = totalCashSales + totalOtherCashIn
    const totalExpenses = branchSummaries.reduce((s, b) => s + b.totalExpenses, 0)
    const totalApprovedDeposits = branchSummaries.reduce((s, b) => s + b.approvedDeposits, 0)
    const totalPendingDeposits = branchSummaries.reduce((s, b) => s + b.pendingDeposits, 0)
    const netCash = branchSummaries.reduce((s, b) => s + b.netCash, 0)
    const totalOperatingProfit = branchSummaries.reduce((s, b) => s + b.operatingProfit, 0)
    const totalOperatingLoss = branchSummaries.reduce((s, b) => s + b.operatingLoss, 0)
    const overallProfitMargin = totalSales > 0 ? Number((((totalOperatingProfit - totalOperatingLoss) / totalSales) * 100).toFixed(1)) : 0
    const globalBankBreakdown = computeBankBreakdown(depositRows || [])

    // Background asynchronous sync to branch_financial_reports and branch_performance_reports.
    // B38/L4: this used select-then-insert with .maybeSingle(). Once a
    // duplicate row existed, maybeSingle errored, the code read that as
    // "not found" and inserted ANOTHER copy — one branch-month reached
    // 141 rows. Both syncs are true UPSERTs on (branch_id,
    // report_month) in the app (the unique constraints are part of
    // the app's schema; the batch-2 dedupe logic applies to the
    // LOADED data at load time). Sync errors are
    // logged, not swallowed.
    // NOTE (B36): "operating profit" here means branch sales minus
    // BRANCH CASH expenses only — salaries, rent and COGS booked
    // elsewhere are not included; the stored notes say so explicitly.
    if (isAdmin) {
      ;(async () => {
        try {
          for (const bs of branchSummaries) {
            if (bs.totalSales > 0 || bs.totalExpenses > 0) {
              await prisma.branchFinancialReport
                .upsert({
                  where: { branch_id_report_month: { branch_id: bs.branchId, report_month: monthStr } },
                  create: {
                    branch_id: bs.branchId,
                    report_month: monthStr,
                    amount: bs.totalSales,
                    notes: `Auto-synced from daily cash ledgers: Cash ৳${bs.cashSales.toLocaleString('en-BD')}, Digital ৳${bs.digitalSales.toLocaleString('en-BD')}, Exp ৳${bs.totalExpenses.toLocaleString('en-BD')}`,
                    created_by_name: 'System Automated',
                    updated_at: new Date(),
                  },
                  update: {
                    amount: bs.totalSales,
                    notes: `Auto-synced from daily cash ledgers: Cash ৳${bs.cashSales.toLocaleString('en-BD')}, Digital ৳${bs.digitalSales.toLocaleString('en-BD')}, Exp ৳${bs.totalExpenses.toLocaleString('en-BD')}`,
                    created_by_name: 'System Automated',
                    updated_at: new Date(),
                  },
                })
                .catch((e: any) => console.error('[MonthlyReport] financial sync failed:', e.message))

              await prisma.branchPerformanceReport
                .upsert({
                  where: { branch_id_report_month: { branch_id: bs.branchId, report_month: new Date(`${monthDateStr}T00:00:00.000Z`) } },
                  create: {
                    branch_id: bs.branchId,
                    branch_name: bs.branchName,
                    report_month: new Date(`${monthDateStr}T00:00:00.000Z`),
                    total_sales: bs.totalSales,
                    total_profit: bs.operatingProfit,
                    total_loss: bs.operatingLoss,
                    notes: `Auto-synced: Branch operating surplus (sales − branch cash expenses only; excludes salaries/rent/COGS) — Margin ${bs.profitMargin}%, Expenses ৳${bs.totalExpenses.toLocaleString('en-BD')}`,
                    created_by_name: 'System Automated',
                    updated_at: new Date(),
                  },
                  update: {
                    branch_name: bs.branchName,
                    total_sales: bs.totalSales,
                    total_profit: bs.operatingProfit,
                    total_loss: bs.operatingLoss,
                    notes: `Auto-synced: Branch operating surplus (sales − branch cash expenses only; excludes salaries/rent/COGS) — Margin ${bs.profitMargin}%, Expenses ৳${bs.totalExpenses.toLocaleString('en-BD')}`,
                    created_by_name: 'System Automated',
                    updated_at: new Date(),
                  },
                })
                .catch((e: any) => console.error('[MonthlyReport] performance sync failed:', e.message))
            }
          }
        } catch (syncErr) {
          console.error('[MonthlyReport] background sync failed:', syncErr)
        }
      })()
    }

    return NextResponse.json({
      year,
      month,
      fromDate,
      toDate,
      branchId: branchId || 'all',
      branchName: branchId ? (branchesList[0]?.name || profile.branch || 'Branch') : 'All Branches',
      summary: {
        totalCashSales,
        totalDigitalSales,
        totalSales,
        totalOtherCashIn,
        grossCashInflow,
        totalExpenses,
        totalApprovedDeposits,
        totalPendingDeposits,
        netCash,
        totalOperatingProfit,
        totalOperatingLoss,
        overallProfitMargin,
        daysTracked: (ledgerRows ?? []).length,
        daysClosed: (ledgerRows ?? []).filter((r) => r.is_closed).length,
        daysWithShortage: (ledgerRows ?? []).filter((r) => r.difference_status === 'shortage').length,
        daysWithExcess: (ledgerRows ?? []).filter((r) => r.difference_status === 'excess').length,
        totalCashDifference: (ledgerRows ?? []).reduce((s, r) => s + Number(r.cash_difference ?? 0), 0),
        bankBreakdown: globalBankBreakdown,
      },
      branches: branchSummaries,
      deposits: depositRows ?? [],
      // The itemised list is the branch-stream register for the month
      // (the same rows the totals count) — head/salary rows live in
      // their own stream presentations, not in the branch report.
      expenses: (expenseRows ?? []).filter((e) => branchCashExpenseStream(e as any) === 'branch'),
      dailyLedger: ledgerRows ?? [],
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
