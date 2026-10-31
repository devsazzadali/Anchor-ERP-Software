import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sessionTokenFromRequest, verifySessionToken } from '@/lib/server/session'
import { toPlain } from '@/lib/server/respond'

// KYC status surface for the kyc,
// kyc/pending and payout-prefill flows. Deliberately resolved
// from the SESSION ONLY (like /api/auth/me), NOT via
// getCallerProfile: KYC users are by definition not yet approved,
// and the A4 gate in the role-resolution function would lock
// them out of their own verification flow. A banned account is
// still refused. Returns the caller's own profile + their latest
// verification request (full row — the payout page pre-fills its
// bank fields from it).
async function resolveKycCaller(req: Request) {
  const userId = await verifySessionToken(sessionTokenFromRequest(req))
  if (!userId) return null
  const profile = await prisma.profile.findUnique({ where: { id: userId } })
  if (!profile) return null
  if ((profile as { is_banned?: boolean | null }).is_banned === true) return null
  return { userId, profile }
}

export async function GET(req: Request) {
  try {
    const resolved = await resolveKycCaller(req)
    if (!resolved) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const latestRequest = await prisma.verificationRequest.findFirst({
      where: { user_id: resolved.userId },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({
      user: { id: resolved.userId, email: resolved.profile.email ?? null },
      profile: toPlain(resolved.profile),
      latestRequest: latestRequest ? toPlain(latestRequest) : null,
    })
  } catch (err: any) {
    console.error('[GET /api/kyc/status] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
