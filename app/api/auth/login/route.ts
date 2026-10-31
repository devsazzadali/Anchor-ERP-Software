import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyPassword, rehashData } from '@/lib/server/passwords'
import { signSessionToken, sessionCookieHeader } from '@/lib/server/session'
import { toPlain } from '@/lib/server/respond'

// POST /api/auth/login — the app's sign-in.
// Verifies the password against auth_users: the native bcrypt hash,
// or a carried-over legacy bcrypt hash with a TRANSPARENT REHASH
// on success (the legacy hash is replaced and cleared — the user
// never notices). Sets the erp_session cookie and returns the same
// { user, profile } facts the login page used to assemble from
// the legacy auth service (role, verification_status, full_name,
// profile_type, is_2fa_enabled).
export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }
    const normalizedEmail = String(email).trim().toLowerCase()

    const authUser = await prisma.authUser.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, email: true, password_hash: true, legacy_bcrypt_hash: true },
    })

    if (!authUser) {
      return NextResponse.json({ error: 'Invalid login credentials' }, { status: 401 })
    }

    const check = await verifyPassword(String(password), authUser)
    if (!check.ok) {
      return NextResponse.json({ error: 'Invalid login credentials' }, { status: 401 })
    }

    // Transparent rehash: first successful login on a carried-over
    // hash upgrades the account to the native scheme.
    if (check.usedLegacy) {
      const data = await rehashData(String(password))
      await prisma.authUser
        .update({ where: { id: authUser.id }, data })
        .catch((e) => console.error('[login] transparent rehash failed:', e))
    }

    await prisma.authUser
      .update({ where: { id: authUser.id }, data: { last_sign_in_at: new Date() } })
      .catch(() => {})

    const profile = await prisma.profile.findFirst({
      where: { id: authUser.id },
      select: {
        role: true, verification_status: true, full_name: true, profile_type: true,
        is_2fa_enabled: true, is_banned: true, branch_id: true, is_branch_manager: true,
      },
    })

    if ((profile as any)?.is_banned === true) {
      return NextResponse.json({ error: 'This account has been banned. Please contact administration.' }, { status: 403 })
    }

    const token = await signSessionToken(authUser.id)
    const res = NextResponse.json({
      user: { id: authUser.id, email: authUser.email },
      profile: profile ? toPlain(profile) : null,
    })
    res.headers.append('Set-Cookie', sessionCookieHeader(token))
    return res
  } catch (err: any) {
    console.error('[POST /api/auth/login] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
