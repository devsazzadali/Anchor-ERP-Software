import { NextResponse } from 'next/server'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit } from '@/lib/server/audit'
import { revokeAllUserSessions } from '@/lib/server/session-registry'

// POST /api/admin/sessions/revoke-all { userId } — S2 (R2 Security
// Round): force-logout EVERY session of a user. Two moves, both
// needed: (1) stamp revoked_at on all the user's unrevoked registry
// rows, and (2) bump profiles.session_epoch — the epoch bump is
// what also kills the user's LEGACY (pre-registry) tokens, whose
// epoch claim is 0, at their next request.
// FIX2 F-01: the two moves now live in the shared
// revokeAllUserSessions helper (lib/server/session-registry.ts),
// which the credential-change paths (change-password,
// complete-reset) use as well.
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

    const result = await revokeAllUserSessions(userId, 'admin_revoke_all')
    if (!result) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    await logAudit({
      caller,
      req,
      action: 'session.revoke_all',
      eventType: 'session',
      entityTable: 'profiles',
      entityId: userId,
      fieldChanges: [
        { field: 'session_epoch', old: result.oldEpoch, new: result.newEpoch },
      ],
      newValue: { target_user_id: userId, revoked_sessions: result.revokedCount, reason: 'admin_revoke_all' },
    })

    return NextResponse.json({ success: true, revokedSessions: result.revokedCount })
  } catch (err: any) {
    console.error('[POST /api/admin/sessions/revoke-all] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
