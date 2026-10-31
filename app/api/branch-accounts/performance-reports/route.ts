import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// GET /api/branch-accounts/performance-reports
// Stored monthly branch performance reports for the partner
// Branch Performance page.
// replaces the browser-direct
// the legacy performance-report list read
// .order('report_month', desc) read, preserving the visible
// behaviour (all branches' reports, newest month first). The old
// realtime channel becomes client-side refetch-on-focus / polling.
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const reports = await prisma.branchPerformanceReport.findMany({
      orderBy: { report_month: 'desc' },
    })

    return NextResponse.json({ reports: toPlain(reports) })
  } catch (err: any) {
    console.error('[GET /api/branch-accounts/performance-reports] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
