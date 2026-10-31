import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { dhakaRangeUtcWindow } from '@/lib/dhaka-time'

export const dynamic = 'force-dynamic'

// raw sources for the admin Financial
// Summary. The page keeps the owner's three-stream classification
// in the browser (lib/expense-streams — the single classifier);
// this route only fetches, with EXACTLY the fixed page's filters:
//  - deposits: approved + not reversed, deposit_date in [start, end]
//    (B39: deposits are transfers, reported separately — the page
//    never counts them as income);
//  - branch cash expenses WITH the C20 link columns
//    (salary_payment_id / expense_request_id) the classifier needs;
//  - salaries / partner payouts / company expenses are GLOBAL
//    (head-office) sources — returned only in the all-branches
//    view, as the page always fetched them;
//  - timestamptz windows (payouts, company expenses) use the Dhaka
//    day's true UTC window (B40/B41); company rows carry
//    expense_kind for the setup/operating split.
// Admin-gated: the old page read all of this from the browser.

// GET /api/admin/financial-summary?branch=all|<uuid>&start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const branch = searchParams.get('branch') || 'all'
    const startDate = searchParams.get('start')
    const endDate = searchParams.get('end')
    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'start and end are required' }, { status: 400 })
    }
    const allBranches = branch === 'all'
    const branchFilter = allBranches ? {} : { branch_id: branch }

    const startDt = new Date(`${startDate}T00:00:00.000Z`)
    const endDt = new Date(`${endDate}T00:00:00.000Z`)
    const dateWindow = { gte: startDt, lte: endDt }
    // B40/B41: the Dhaka range's true UTC window for timestamptz.
    const { startIso: rangeStartIso, endIso: rangeEndIso } = dhakaRangeUtcWindow(startDate, endDate)
    const tsWindow = { gte: new Date(rangeStartIso), lt: new Date(rangeEndIso) }

    const [branches, ledgerHeads, deposits, cashExpenses, salesLedgers, salaries, payouts, companyExpenses] =
      await Promise.all([
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.ledgerHead.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.branchBankDeposit.findMany({
          where: { status: 'approved', is_reversed: false, deposit_date: dateWindow, ...branchFilter },
          select: { amount: true, status: true, is_reversed: true, deposit_date: true, branch_id: true },
        }),
        prisma.branchCashExpense.findMany({
          where: { expense_date: dateWindow, ...branchFilter },
          select: {
            amount: true, expense_date: true, ledger_head_id: true, category: true,
            branch_id: true, branch_name: true, salary_payment_id: true, expense_request_id: true,
          },
        }),
        prisma.branchCashLedger.findMany({
          where: { ledger_date: dateWindow, ...branchFilter },
          select: {
            cash_sales: true, bkash_sales: true, nagad_sales: true, rocket_sales: true,
            card_sales: true, bank_transfer_sales: true, branch_id: true,
          },
        }),
        // Salaries: the fixed page filtered payment_date (timestamptz)
        // with the bare date bounds — replicated as the same UTC
        // instants PostgREST compared against.
        allBranches
          ? prisma.salaryPayment.findMany({
              where: { payment_date: { gte: startDt, lte: endDt } },
              select: { amount: true, payment_date: true },
            })
          : Promise.resolve([]),
        allBranches
          ? prisma.paymentRequest.findMany({
              where: { status: 'completed', completed_at: tsWindow },
              select: { amount: true, completed_at: true },
            })
          : Promise.resolve([]),
        allBranches
          ? prisma.companyExpense.findMany({
              where: { created_at: tsWindow },
              select: { total_amount: true, created_at: true, purpose: true, branch_id: true, expense_kind: true },
            })
          : Promise.resolve([]),
      ])

    return NextResponse.json({
      branches: toPlain(branches) || [],
      ledgerHeads: toPlain(ledgerHeads) || [],
      deposits: toPlain(deposits) || [],
      cashExpenses: toPlain(cashExpenses) || [],
      salesLedgers: toPlain(salesLedgers) || [],
      salaries: toPlain(salaries) || [],
      payouts: toPlain(payouts) || [],
      companyExpenses: toPlain(companyExpenses) || [],
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
