import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// /api/admin/password-reset-requests — admin-only.
// GET: every password_reset_requests row (newest first) with the
// requester's profile (full_name/role/profile_type) attached, the
// shape the admin password-requests page merged client-side before.
// PATCH { id, status }: approve/reject a request.
async function requireAdmin(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!callerIsAdmin(caller)) return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  return { caller }
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const rows = await prisma.passwordResetRequest.findMany({
      select: { id: true, user_id: true, status: true, created_at: true },
      orderBy: { created_at: 'desc' },
    })
    const userIds = [...new Set(rows.map((r) => r.user_id))]
    const profs = userIds.length
      ? await prisma.profile.findMany({
          where: { id: { in: userIds } },
          select: { id: true, full_name: true, role: true, profile_type: true },
        })
      : []
    const byId = new Map(profs.map((p) => [p.id, p]))

    const requests = rows.map((r) => {
      const p: any = byId.get(r.user_id)
      return {
        ...r,
        profiles: p
          ? { full_name: p.full_name, role: p.role, profile_type: p.profile_type }
          : { full_name: 'Unknown', role: 'Unknown', profile_type: 'Unknown' },
      }
    })

    return NextResponse.json({ requests: toPlain(requests) })
  } catch (err: any) {
    console.error('[GET /api/admin/password-reset-requests] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch password reset requests' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const { id, status } = await req.json()
    if (!id || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'id and a valid status are required' }, { status: 400 })
    }

    await prisma.passwordResetRequest.update({
      where: { id },
      data: { status, updated_at: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[PATCH /api/admin/password-reset-requests] Error:', err)
    return NextResponse.json({ error: 'Failed to update request status' }, { status: 500 })
  }
}
