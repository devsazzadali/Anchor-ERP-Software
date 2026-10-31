import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sessionTokenFromRequest, verifySessionToken } from '@/lib/server/session'
import { toPlain } from '@/lib/server/respond'

// Session-only caller resolution (see /api/kyc/status for why KYC
// routes cannot use the A4-gated getCallerProfile).
async function resolveKycCaller(req: Request) {
  const userId = await verifySessionToken(sessionTokenFromRequest(req))
  if (!userId) return null
  const profile = await prisma.profile.findUnique({ where: { id: userId } })
  if (!profile) return null
  if ((profile as { is_banned?: boolean | null }).is_banned === true) return null
  return { userId, profile }
}

// the role-selection page's profile
// update, as a server action with a strict whitelist (A1):
// the caller may set ONLY their own profile_type, and only to
// one of the three KYC classifications. (profile_type is
// user-writable during KYC by design — it is never admin proof.)
const ALLOWED_ROLES = ['employee', 'partner', 'head_office']

export async function POST(req: Request) {
  try {
    const resolved = await resolveKycCaller(req)
    if (!resolved) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    if (!ALLOWED_ROLES.includes(body.profile_type)) {
      return NextResponse.json({ error: 'Invalid profile type' }, { status: 400 })
    }

    const updated = await prisma.profile.update({
      where: { id: resolved.userId },
      data: { profile_type: body.profile_type },
    })
    return NextResponse.json({ profile: toPlain(updated) })
  } catch (err: any) {
    console.error('[POST /api/kyc/select-role] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
