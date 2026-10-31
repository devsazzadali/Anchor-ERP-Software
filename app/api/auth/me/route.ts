import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { parseSessionToken, sessionTokenFromRequest, verifySessionToken } from '@/lib/server/session'
import { isPartnerAccount } from '@/lib/server/auth'
import { checkSessionRegistry, getSecuritySettings } from '@/lib/server/session-registry'
import { toPlain } from '@/lib/server/respond'

// GET /api/auth/me — identity surface for the client (AuthContext
// and the proxy gate). Deliberately LIGHTER than the data routes'
// caller resolution: it returns the session user's profile as-is
// (including verification_status / is_banned) so the UI can gate
// and route; enforcement lives on the data routes themselves
// (lib/server/auth.ts, A4). FR-1.3: the security_answer digest is
// stripped even here — no client consumer needs it.
export async function GET(req: Request) {
  try {
    const userId = await verifySessionToken(sessionTokenFromRequest(req))
    if (!userId) return NextResponse.json({ user: null, profile: null }, { status: 401 })

    const [authUser, profile, adminRow] = await Promise.all([
      prisma.authUser.findFirst({ where: { id: userId }, select: { id: true, email: true } }),
      prisma.profile.findFirst({ where: { id: userId } }),
      prisma.adminUser.findFirst({ where: { id: userId }, select: { id: true } }),
    ])
    if (!authUser) return NextResponse.json({ user: null, profile: null }, { status: 401 })

    // Admin = role column OR admin_users membership (A1) — the same
    // definition the proxy gate and the data routes use, WITH the
    // FR-1.1 partner boundary: a partner account (profile_type
    // 'partner', no admin_users row) is NOT admin even when its
    // role column says 'admin'. isPartnerAccount is the resolver's
    // shared predicate (lib/server/auth.ts).
    const is_partner = profile ? isPartnerAccount(profile.profile_type, !!adminRow) : false
    const is_admin =
      !is_partner &&
      (profile?.role === 'admin' || profile?.role === 'super_admin' || !!adminRow)

    // S2/S3 (R2 Security Round): this route is the proxy gate's
    // enforcement carrier — proxy.ts defers to /api/auth/me, so the
    // session-registry check (epoch / revoked / idle, the same
    // helper the resolver enforces) runs here too. A revoked,
    // epoch-stale or idle-expired session answers 401 and the proxy
    // treats the user as signed out. NOTE: contrary to the S2 brief's
    // assumption, this route did NOT use getCallerProfile before —
    // it resolved identity directly; the registry check is therefore
    // applied explicitly here rather than via the resolver, so the
    // lighter profile payload (pending/banned states the UI gates
    // on) is preserved.
    if (profile) {
      const parsed = await parseSessionToken(sessionTokenFromRequest(req))
      if (!parsed || parsed.userId !== userId) {
        return NextResponse.json({ user: null, profile: null }, { status: 401 })
      }
      const registryOk = await checkSessionRegistry(userId, parsed, {
        sessionEpoch: (profile as any).session_epoch ?? 0,
        isAdmin: is_admin,
        isPartner: is_partner,
        isBranchManager:
          (profile as any).is_branch_manager === true || profile.profile_type === 'branch_manager',
      })
      if (!registryOk) {
        return NextResponse.json({ user: null, profile: null }, { status: 401 })
      }
    }

    const { security_answer: _stripped, session_epoch: _epoch, ...safeProfile } = (profile ?? {}) as any

    // S3: REQUIRE_ADMIN_2FA flag surface for proxy.ts (the setting
    // itself lives in system_settings; DEFAULT OFF — absent = off).
    const { requireAdmin2fa } = await getSecuritySettings()

    return NextResponse.json({
      user: { id: authUser.id, email: authUser.email },
      profile: profile ? toPlain(safeProfile) : null,
      is_admin,
      is_partner,
      require_admin_2fa: requireAdmin2fa,
    })
  } catch (err: any) {
    console.error('[GET /api/auth/me] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
