import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// /api/profile/me — the signed-in user's OWN profile.
// GET: own profile row (same payload as /api/auth/me's profile).
// PATCH: self-update with the A1 column whitelist — only the
// self-service fields the settings pages edit. Role-bearing columns
// (role, profile_type, is_branch_manager, branch_id,
// verification_status, security_*) are NEVER client-writable here;
// that is the prevent_profile_privilege_escalation job, in code.
const SELF_WRITABLE = [
  'full_name', 'phone_number', 'country', 'address',
  'profile_photo_url', 'is_2fa_enabled', 'whatsapp_number',
] as const

export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await prisma.profile.findUnique({ where: { id: caller.id } })
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    return NextResponse.json({ profile: toPlain(profile) })
  } catch (err: any) {
    console.error('[GET /api/profile/me] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const data: any = {}
    for (const f of SELF_WRITABLE) if (body[f] !== undefined) data[f] = body[f]
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided for update' }, { status: 400 })
    }

    const profile = await prisma.profile.update({ where: { id: caller.id }, data })
    return NextResponse.json({ profile: toPlain(profile) })
  } catch (err: any) {
    console.error('[PATCH /api/profile/me] Error:', err)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
