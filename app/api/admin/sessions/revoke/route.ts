import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit } from '@/lib/server/audit'

// POST /api/admin/sessions/revoke { sessionId } — S2 (R2 Security
// Round): force-logout ONE session. The row is stamped revoked_at
// and the resolver rejects that token at its next request (401).
// No account is special-cased: any admin may revoke any session,
// including their own (their next request will 401 — the UI warns).
export async function POST(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const { sessionId } = await req.json().catch(() => ({}))
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const row = await prisma.userSession.findUnique({ where: { id: sessionId } })
    if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    if (!row.revoked_at) {
      await prisma.userSession.update({
        where: { id: sessionId },
        data: { revoked_at: new Date(), revoke_reason: 'admin_revoke' },
      })
    }

    await logAudit({
      caller,
      req,
      action: 'session.revoke',
      eventType: 'session',
      entityTable: 'user_sessions',
      entityId: sessionId,
      newValue: { target_user_id: row.user_id, reason: 'admin_revoke' },
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[POST /api/admin/sessions/revoke] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
