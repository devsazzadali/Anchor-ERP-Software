import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  clearSessionCookieHeader,
  clearCookieHeader,
  parseSessionToken,
  sessionTokenFromRequest,
} from '@/lib/server/session'
import { logAudit } from '@/lib/server/audit'

// POST /api/auth/logout — clears the app session (and any 2FA
// verification cookie, mirroring the old sign-out behaviour).
// S2 (R2 Security Round): when the presented token is a v2 registry
// token, its user_sessions row is revoked (reason 'logout') so the
// token dies server-side too, not just in the browser. Legacy
// tokens have no row — clearing the cookie is all that exists for
// them (documented transition). Revocation is fail-soft: logout
// always succeeds from the client's point of view.
export async function POST(req: Request) {
  try {
    const parsed = await parseSessionToken(sessionTokenFromRequest(req))
    if (parsed?.jti) {
      await prisma.userSession
        .updateMany({
          where: { id: parsed.jti, user_id: parsed.userId, revoked_at: null },
          data: { revoked_at: new Date(), revoke_reason: 'logout' },
        })
        .catch((err) => console.error('[logout] session revoke failed (fail-soft):', err))
      await logAudit({
        caller: null,
        req,
        actorId: parsed.userId,
        actorName: null,
        actorRole: null,
        action: 'auth.logout',
        eventType: 'auth',
        entityTable: 'user_sessions',
        entityId: parsed.jti,
      })
    }
  } catch (err) {
    console.error('[logout] registry handling failed (fail-soft):', err)
  }

  const res = NextResponse.json({ success: true })
  res.headers.append('Set-Cookie', clearSessionCookieHeader())
  res.headers.append('Set-Cookie', clearCookieHeader('2fa_verified'))
  return res
}
