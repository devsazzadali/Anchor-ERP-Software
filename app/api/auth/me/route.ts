import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sessionTokenFromRequest, verifySessionToken } from '@/lib/server/session'
import { toPlain } from '@/lib/server/respond'

// GET /api/auth/me — identity surface for the client (AuthContext
// and the proxy gate). Deliberately LIGHTER than the data routes'
// caller resolution: it returns the session user's profile as-is
// (including verification_status / is_banned) so the UI can gate
// and route; enforcement lives on the data routes themselves
// (lib/server/auth.ts, A4).
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
    // definition the proxy gate and the data routes use.
    const is_admin =
      profile?.role === 'admin' || profile?.role === 'super_admin' || !!adminRow

    return NextResponse.json({
      user: { id: authUser.id, email: authUser.email },
      profile: profile ? toPlain(profile) : null,
      is_admin,
    })
  } catch (err: any) {
    console.error('[GET /api/auth/me] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
