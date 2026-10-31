import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { dhakaRangeUtcWindow } from '@/lib/dhaka-time'
import { LEDGER_DEPOSITS_DEFINITION, BANKED_BY_DEPOSIT_DATE_LABEL } from '@/lib/deposit-figures'

export const dynamic = 'force-dynamic'

// raw sources for the admin Financial
// Summary. The page keeps the owner's three-stream classification
// in the browser (lib/expense-streams — the single classifier);
// this route only fetches, with EXACTLY the fixed page's filters:
//  - deposits: THE single deposits definition (§D5 #5) — the
//    LEDGER figure, Σ branch_cash_ledger.bank_deposits_out over the
//    ledger days in [start, end], returned in `deposits` as one
//    {amount, ledger_date, branch_id} entry per ledger day so the
//    page's sum IS the ledger figure. The deposits table's own cut
//    (approved + not reversed, attributed to deposit_date) is a
//    DIFFERENT number; it is returned separately as
//    `bankedDeposits` + `depositFigures` so the gap between the
//    two cuts stays visible and labelled instead of being absorbed
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

    const [branches, ledgerHeads, bankedDeposits, cashExpenses, salesLedgers, salaries, payouts, companyExpenses] =
      await Promise.all([
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.ledgerHead.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        // The deposits-table cut (labelled secondary figure only —
        // see the header comment and `depositFigures` below).
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
            bank_deposits_out: true, ledger_date: true,
          },
        }),
        // Salaries: payment_date is timestamptz, so it uses the
        // identical Dhaka tsWindow as payouts and company expenses
        // below (FR-5/X2) — the bare date bounds dropped the whole
        // last day of the window (lte = midnight at its start).
        allBranches
          ? prisma.salaryPayment.findMany({
              where: { payment_date: tsWindow, status: { not: 'voided' } }, // FR-14.1: voided payments never count
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

    // §D5 #5: `deposits` is the LEDGER figure — one entry per ledger
    // day in the window carrying that day's bank_deposits_out, so
    // Σ deposits.amount === Σ branch_cash_ledger.bank_deposits_out
    // for exactly this window, the same figure the branch-accounts
    // header and the branch dashboard show for the same window.
    const ledgerDeposits = (toPlain(salesLedgers) || [])
      .filter((l: any) => Number(l.bank_deposits_out || 0) !== 0)
      .map((l: any) => ({ amount: l.bank_deposits_out, ledger_date: l.ledger_date, branch_id: l.branch_id }))
    const ledgerDepositsTotal = ledgerDeposits.reduce((s: number, d: any) => s + Number(d.amount || 0), 0)
    const bankedTotal = (toPlain(bankedDeposits) || []).reduce((s: number, d: any) => s + Number(d.amount || 0), 0)

    return NextResponse.json({
      branches: toPlain(branches) || [],
      ledgerHeads: toPlain(ledgerHeads) || [],
      deposits: ledgerDeposits,
      bankedDeposits: toPlain(bankedDeposits) || [],
      // The two cuts, labelled, with the gap kept visible: the
      // banked-by-deposit_date total attributes each deposit to its
      // deposit_date and counts amounts even when a slice never
      // reached the ledger, so it can differ from the ledger figure
      // for the same window. The gap is disclosed, never absorbed.
      depositFigures: {
        definition: LEDGER_DEPOSITS_DEFINITION,
        window: { start: startDate, end: endDate },
        ledgerTotal: ledgerDepositsTotal,
        bankedByDepositDate: {
          label: BANKED_BY_DEPOSIT_DATE_LABEL,
          total: bankedTotal,
        },
        gapBankedMinusLedger: bankedTotal - ledgerDepositsTotal,
      },
      cashExpenses: toPlain(cashExpenses) || [],
      salesLedgers: toPlain(salesLedgers) || [],
      salaries: toPlain(salaries) || [],
      payouts: toPlain(payouts) || [],
      companyExpenses: toPlain(companyExpenses) || [],
    })
  } catch (err: any) {
    console.error('[api] app/api/admin/financial-summary/route.ts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
