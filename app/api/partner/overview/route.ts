import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// the partner dashboard's two read-only
// aggregate panels (dashboard/page.tsx). Partner gate is enforced
// server-side (profile_type 'partner' on the session-resolved
// caller — BUG-R01's rule); only the aggregate input columns leave
// the server, and the page computes the totals exactly as before
// (BUG-023 comments on the page are the behaviour spec).
export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (caller.profile_type !== 'partner') {
      return NextResponse.json({ error: 'Forbidden: not a partner' }, { status: 403 })
    }

    const [expenseRequests, performanceReports] = await Promise.all([
      // FR-9: the partner's OWN expense requests only. The previous
      // company-wide return fed every employee's payout totals into
      // any partner's dashboard stats. Performance reports below
      // stay company-wide — branch network performance is a
      // partner's legitimate view (FR-2b fixed its stale values at
      // the source).
      prisma.employeeExpenseRequest.findMany({
        where: { employee_id: caller.id },
        select: { amount: true, status: true, branch_id: true },
      }),
      prisma.branchPerformanceReport.findMany({
        select: { total_sales: true, total_profit: true, total_loss: true, report_month: true },
        orderBy: { report_month: 'desc' },
      }),
    ])

    return NextResponse.json({
      expenseRequests: toPlain(expenseRequests),
      performanceReports: toPlain(performanceReports),
    })
  } catch (err: any) {
    console.error('[GET /api/partner/overview] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
