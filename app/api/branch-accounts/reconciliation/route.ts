import { NextRequest, NextResponse } from 'next/server'
import { dhakaToday, monthWindowOf } from '@/lib/dhaka-time'
import { sumMoney } from '@/lib/money'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { attachDepositBranch } from '@/lib/server/attach'
import { branchStreamAmount } from '@/lib/expense-streams'

// GET /api/branch-accounts/reconciliation?from=YYYY-MM-DD&to=YYYY-MM-DD
// Admin only — Returns branch-wise reconciliation summary
//
// caller resolution is the single shared
// function (lib/server/auth.ts) — partners are refused (audit Part
// D §3), managers are scoped to their RESOLVED branch (profile or
// active assignment; the old route scoped by profile.branch_id alone
// and left an assignment-only manager unscoped — deliberately
// tightened). All aggregation logic (B28–B32) is
// unchanged and runs over complete result sets (no 1,000-row cap).
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isAdmin = caller.is_admin
    const isManager = caller.is_branch_manager === true

    if (!isAdmin && !isManager) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from') || monthWindowOf(dhakaToday()).start
    const to = searchParams.get('to') || dhakaToday()
    const scopedBranchId = isManager ? caller.branch_id : (searchParams.get('branch_id') || undefined)

    const fromDate = new Date(`${from}T00:00:00.000Z`)
    const toDate = new Date(`${to}T00:00:00.000Z`)

    // B26: arbitrary date ranges across all branches are complete —
    // Prisma returns every matching row. B32: no is_reversed=false
    // filter in the query — the JS aggregation below applies one
    // consistent rule everywhere: reversed === true is out, anything
    // else (false or NULL) is in.
    const [branches, depositsData, ledgerRows, expenseRows] = await Promise.all([
      prisma.branch.findMany({
        where: scopedBranchId ? { id: scopedBranchId } : {},
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.branchBankDeposit.findMany({
        where: { deposit_date: { gte: fromDate, lte: toDate } },
        select: { branch_id: true, amount: true, status: true, is_reversed: true },
        orderBy: { id: 'asc' },
      }),
      prisma.branchCashLedger.findMany({
        where: { ledger_date: { gte: fromDate, lte: toDate } },
        select: {
          branch_id: true, ledger_date: true, opening_cash: true, cash_sales: true,
          other_cash_in: true, cash_expenses: true, actual_cash: true,
          expected_closing_cash: true, is_closed: true,
        },
        orderBy: { id: 'asc' },
      }),
      prisma.branchCashExpense.findMany({
        where: { expense_date: { gte: fromDate, lte: toDate } },
        // Stream links selected: only BRANCH-stream rows are drawer
        // expenses (owner's account-overview rule) — ledger-head rows
        // and salary copies recorded against a branch never enter
        // total_cash_expenses or net_cash_collected here.
        select: { branch_id: true, amount: true, salary_payment_id: true, expense_request_id: true, ledger_head_id: true },
        orderBy: { id: 'asc' },
      }),
    ])

    const summary = (branches || []).map((b) => {
      const branchDeposits = depositsData.filter((d) => d.branch_id === b.id && d.is_reversed !== true)
      const branchLedgers = ledgerRows.filter((l) => l.branch_id === b.id)
      const branchExpenses = expenseRows.filter((e) => e.branch_id === b.id)

      // B28: "cash sales" is cash_sales ONLY. Other cash in is real
      // drawer inflow but it is not sales — it is reported separately
      // and included in net collected, not in the sales figure.
      const total_cash_sales = sumMoney(branchLedgers.map((l) => (l.cash_sales != null ? Number(l.cash_sales) : null)))
      const total_other_cash_in = sumMoney(branchLedgers.map((l) => (l.other_cash_in != null ? Number(l.other_cash_in) : null)))
      // B29: ONE expense source for every branch — the itemised
      // expense rows. The old code switched source per branch (rows if
      // any existed, else the ledger column), so identical reality
      // reported differently across branches. The ledger column is
      // still compared and any drift is exposed, not hidden.
      // Stream rule (2026-10-31): of those rows, only the BRANCH
      // stream counts — branchStreamAmount zeroes ledger-head rows
      // and salary copies, matching what the ledger sync maintains in
      // the column, so drift stays a true integrity signal.
      const total_cash_expenses = sumMoney(branchExpenses.map((e) => branchStreamAmount(e as any)))
      const expense_drift = sumMoney([sumMoney(branchLedgers.map((l) => (l.cash_expenses != null ? Number(l.cash_expenses) : null))), -total_cash_expenses])

      // B30: signed. A branch whose expenses exceed collections is
      // OVERSPENT — reporting 0 made the over-spend vanish.
      const net_cash_collected = sumMoney([total_cash_sales, total_other_cash_in, -total_cash_expenses])
      const total_approved = sumMoney(branchDeposits.filter((d) => d.status === 'approved').map((d) => Number(d.amount)))
      const total_pending = sumMoney(branchDeposits.filter((d) => ['submitted', 'pending_approval'].includes(d.status)).map((d) => Number(d.amount)))
      const total_rejected = sumMoney(branchDeposits.filter((d) => d.status === 'rejected').map((d) => Number(d.amount)))
      const deposit_count = branchDeposits.filter((d) => d.status === 'approved').length
      const pending_count = branchDeposits.filter((d) => ['submitted', 'pending_approval'].includes(d.status)).length

      // B31: signed. Negative means MORE was banked than collected
      // (excess banked) — the old Math.max(0, ...) made that state
      // impossible to return, leaving the UI's excess-banked branches
      // dead and audit_status unable to flag it.
      const unbanked_cash_variance = sumMoney([net_cash_collected, -total_approved])
      let audit_status = 'balanced'
      if (pending_count > 0) {
        audit_status = 'pending_review'
      } else if (unbanked_cash_variance > 500) {
        audit_status = 'unbanked_cash'
      } else if (unbanked_cash_variance < -500) {
        audit_status = 'excess_banked'
      } else {
        audit_status = 'balanced'
      }

      return {
        branch_id: b.id,
        branch_name: b.name,
        total_cash_sales,
        total_other_cash_in,
        total_cash_expenses,
        expense_drift,
        net_cash_collected,
        total_erp_deposits: total_approved,
        total_approved,
        total_pending,
        total_rejected,
        deposit_count,
        pending_count,
        unbanked_cash_variance,
        audit_status,
      }
    })

    // ── Individual deposits — join branch name to guarantee it's never null ──
    const depositRecords = await prisma.branchBankDeposit.findMany({
      where: {
        deposit_date: { gte: fromDate, lte: toDate },
        ...(scopedBranchId ? { branch_id: scopedBranchId } : {}),
      },
      select: {
        id: true, branch_id: true, branch_name: true, manager_name: true, deposit_date: true,
        amount: true, status: true, bank_account_name: true, deposit_slip_number: true,
        bank_transaction_id: true, is_reversed: true,
      },
      orderBy: [{ deposit_date: 'desc' }, { id: 'asc' }],
    })
    const withBranch = await attachDepositBranch(depositRecords as any)

    // Normalise branch_name from join if the denormalized column is null
    const deposits = withBranch.map((d: any) => ({
      ...toPlain(d),
      branch_name: d.branch?.name || d.branch_name || 'Branch',
    }))

    return NextResponse.json({
      from,
      to,
      summary: summary ?? [],
      deposits,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
