import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// GET /api/branch-accounts/performance-reports
// Stored monthly branch performance reports for the Branch
// Performance page (app/dashboard/branch-performance — linked in
// the partner and head-office navigations, so non-admin surfaces
// genuinely consume this endpoint).
// FR-1.5 (audit G4): the response is SCOPED. Admins see every
// branch's reports; a non-admin caller sees ONLY their own
// branch's reports (branch_id = the caller's resolved branch);
// a non-admin with no branch assigned gets an empty list (fail
// closed — previously every approved caller received ALL
// branches' reports). The old realtime channel stays replaced by
// client-side refetch-on-focus / polling.
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!callerIsAdmin(caller) && !caller.branch_id) {
      return NextResponse.json({ reports: [] })
    }

    const reports = await prisma.branchPerformanceReport.findMany({
      where: callerIsAdmin(caller) ? {} : { branch_id: caller.branch_id! },
      orderBy: { report_month: 'desc' },
    })

    return NextResponse.json({ reports: toPlain(reports) })
  } catch (err: any) {
    console.error('[GET /api/branch-accounts/performance-reports] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
