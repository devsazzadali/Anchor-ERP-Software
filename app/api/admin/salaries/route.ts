import { NextResponse } from 'next/server'
import { dhakaMonthWindow, dhakaRangeUtcWindow, addDays } from '@/lib/dhaka-time'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

export const dynamic = 'force-dynamic'

// admin = the unified callerIsAdmin definition (FR-1.2: role
// column OR admin_users membership, minus the FR-1.1 partner
// boundary; A1 — profile_type is user-writable during KYC and
// is never admin proof). Fetches are complete (no 1,000-row cap — C38). The
// profiles embed is attached manually (LEFT-join semantics: no
// salary disbursement is dropped for a missing profile).
export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const month = searchParams.get('month') || 'all'

    // Fetch branches for reliable branch name mapping
    const branchesData = await prisma.branch.findMany({ select: { id: true, name: true } })

    const branchMap = new Map<string, string>()
    ;(branchesData || []).forEach((b) => {
      branchMap.set(b.id, b.name)
    })

    // C23: the month window is the DHAKA month expressed as UTC
    // instants (payment_date is timestamptz). The old code built the
    // window from server-local Date math, so boundary payments fell
    // in or out depending on the server's timezone — and disagreed
    // with the page's own fallback path.
    // C38: complete fetch — an unbounded select truncated at 1,000 rows.
    let monthWindow: { startIso: string; endIso: string } | null = null
    if (month !== 'all') {
      const [yearNum, monthNum] = month.split('-').map(Number)
      const { start, endExclusive } = dhakaMonthWindow(yearNum, monthNum)
      monthWindow = dhakaRangeUtcWindow(start, addDays(endExclusive, -1))
    }
    const paymentWindow = monthWindow
      ? { payment_date: { gte: new Date(monthWindow.startIso), lt: new Date(monthWindow.endIso) } }
      : {}

    const paymentsRaw = await prisma.salaryPayment.findMany({
      where: paymentWindow,
      orderBy: [{ payment_date: 'desc' }, { id: 'asc' }],
    })

    // Attach the employee profile (LEFT join — never drop a payment)
    const employeeIds = [...new Set(paymentsRaw.map((p) => p.employee_id).filter(Boolean))]
    const empProfiles = employeeIds.length
      ? await prisma.profile.findMany({
          where: { id: { in: employeeIds } },
          select: {
            id: true, full_name: true, branch: true, branch_id: true,
            bank_info: true, profile_type: true, created_at: true, salary: true,
          },
        })
      : []
    const empById = new Map(empProfiles.map((p) => [p.id, p]))

    // Enrich payments with branch names
    const enrichedPayments = toPlain(
      paymentsRaw.map((p) => {
        const prof: any = empById.get(p.employee_id) ?? null
        const branchName =
          prof?.branch || branchMap.get(p.branch_id as string) || (prof?.branch_id && branchMap.get(prof.branch_id)) || 'HQ'
        const { id: _drop, ...profFields } = prof ?? {}
        return {
          ...p,
          profiles: prof
            ? { ...profFields, branch: branchName }
            : { full_name: 'Unknown Employee', branch: branchName },
        }
      })
    )

    // 2. Fetch active employees for Unpaid tab (complete, C38)
    const profilesData = await prisma.profile.findMany({
      where: { profile_type: { in: ['employee', 'head_office', 'branch_manager'] } },
      select: {
        id: true, full_name: true, email: true, role: true, profile_type: true,
        branch: true, branch_id: true, salary: true, created_at: true, is_banned: true,
      },
      orderBy: { id: 'asc' },
    })

    // Filter out banned employees in JS and enrich branch
    const activeProfiles = toPlain(
      profilesData
        .filter((p) => !p.is_banned)
        .map((p) => ({
          ...p,
          branch: p.branch || (p.branch_id && branchMap.get(p.branch_id)) || 'HQ',
        }))
    )

    // 3. Compute Paid IDs for the targeted time period.
    // C22: for month='all' the paid set must ALSO be all-time. The
    // old code computed paidIds for the CURRENT month only, so the
    // "Unpaid" tab silently meant "unpaid this month" beside an
    // all-time payments list.
    const periodPays = await prisma.salaryPayment.findMany({
      where: { ...paymentWindow, status: { not: 'voided' } }, // FR-14.1: a voided payment no longer marks the employee paid
      select: { employee_id: true },
      orderBy: { id: 'asc' },
    })
    const paidIds = new Set(periodPays.map((p) => p.employee_id))

    const unpaid = activeProfiles.filter((p: any) => !paidIds.has(p.id))

    return NextResponse.json({
      payments: enrichedPayments,
      unpaid,
    })
  } catch (error: any) {
    console.error('[GET /api/admin/salaries] Error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to fetch salaries' }, { status: 500 })
  }
}
