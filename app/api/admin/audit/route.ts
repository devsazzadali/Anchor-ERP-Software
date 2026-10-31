import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// GET /api/admin/audit — admin-only audit bundle for the security
// audit page: activity_logs (100, with operator profile embed),
// branch_audit_trail (100) and fraud-flagged payment_requests (20,
// with applicant profile embed) — the three streams the page read
// browser-direct before. Branch trail rows are shaped to the page's
// expected embed form (branches.name / profiles.full_name /
// old_values / new_values) from the model's branch_name /
// performed_by_name / old_value / new_value columns.
export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })

    const [actRows, trailRows, fraudRows] = await Promise.all([
      prisma.activityLog.findMany({ orderBy: { created_at: 'desc' }, take: 100 }),
      prisma.branchAuditTrail.findMany({ orderBy: { created_at: 'desc' }, take: 100 }),
      prisma.paymentRequest.findMany({
        where: { status: 'fraud_flagged' },
        orderBy: { created_at: 'desc' },
        take: 20,
      }),
    ])

    const profileIds = [...new Set([
      ...actRows.map((r) => r.user_id).filter(Boolean) as string[],
      ...fraudRows.map((r) => r.user_id).filter(Boolean),
    ])]
    const profs = profileIds.length
      ? await prisma.profile.findMany({
          where: { id: { in: profileIds } },
          select: { id: true, full_name: true, role: true },
        })
      : []
    const profById = new Map(profs.map((p) => [p.id, p]))

    const branchIds = [...new Set(trailRows.map((r) => r.branch_id).filter(Boolean) as string[])]
    const branches = branchIds.length
      ? await prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
      : []
    const branchById = new Map(branches.map((b) => [b.id, b.name]))

    const activityLogs = actRows.map((r) => {
      const p: any = r.user_id ? profById.get(r.user_id) : null
      return { ...r, profiles: p ? { full_name: p.full_name, role: p.role } : null }
    })

    const branchTrail = trailRows.map((r: any) => ({
      ...r,
      branches: { name: r.branch_name || (r.branch_id ? branchById.get(r.branch_id) : null) || null },
      profiles: { full_name: r.performed_by_name || null },
      old_values: r.old_value ?? null,
      new_values: r.new_value ?? null,
      user_agent: null,
    }))

    const fraudData = fraudRows.map((f) => {
      const p: any = profById.get(f.user_id)
      return { ...f, profiles: p ? { full_name: p.full_name } : null }
    })

    return NextResponse.json(toPlain({ activityLogs, branchTrail, fraudData }))
  } catch (err: any) {
    console.error('[GET /api/admin/audit] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch audit data' }, { status: 500 })
  }
}
