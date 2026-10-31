import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit } from '@/lib/server/audit'

// POST /api/admin/sessions/revoke-all { userId } — S2 (R2 Security
// Round): force-logout EVERY session of a user. Two moves, both
// needed: (1) stamp revoked_at on all the user's unrevoked registry
// rows, and (2) bump profiles.session_epoch — the epoch bump is
// what also kills the user's LEGACY (pre-registry) tokens, whose
// epoch claim is 0, at their next request.
// No account is special-cased in code: any admin may revoke-all any
// user, including themselves (their own next request 401s — the UI
// confirms first). A deliberate admin action, never a stealth one.
export async function POST(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const { userId } = await req.json().catch(() => ({}))
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true, session_epoch: true },
    })
    if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const revoked = await prisma.userSession.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date(), revoke_reason: 'admin_revoke_all' },
    })
    await prisma.profile.update({
      where: { id: userId },
      data: { session_epoch: { increment: 1 } },
    })

    await logAudit({
      caller,
      req,
      action: 'session.revoke_all',
      eventType: 'session',
      entityTable: 'profiles',
      entityId: userId,
      fieldChanges: [
        { field: 'session_epoch', old: profile.session_epoch, new: profile.session_epoch + 1 },
      ],
      newValue: { target_user_id: userId, revoked_sessions: revoked.count, reason: 'admin_revoke_all' },
    })

    return NextResponse.json({ success: true, revokedSessions: revoked.count })
  } catch (err: any) {
    console.error('[POST /api/admin/sessions/revoke-all] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
