import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { hashPassword } from '@/lib/server/passwords'
import {
  REG_VERIFIED_COOKIE,
  clearCookieHeader,
  cookieFromRequest,
  sessionCookieHeader,
  signSessionToken,
  verifyPurposeToken,
} from '@/lib/server/session'

// POST /api/auth/register — the app's sign-up.
// Requires the server-verified registration proof cookie minted by
// /api/auth/verify-register-otp for THIS email (the old flow trusted
// the client's claim). Creates the auth user (native bcrypt hash)
// and the profile the old handle_new_user trigger used to create
// (role 'user', profile_type 'employee', verification_status
// 'pending'), then signs the new user in.
export async function POST(req: Request) {
  try {
    const { email, password, fullName, phoneNumber } = await req.json()
    if (!email || !password || !fullName) {
      return NextResponse.json({ error: 'Email, password and full name are required' }, { status: 400 })
    }
    const normalizedEmail = String(email).trim().toLowerCase()

    // §3C gate: a valid, unexpired OTP-verification proof for this email.
    const proof = cookieFromRequest(req, REG_VERIFIED_COOKIE)
    const verified = await verifyPurposeToken(proof, 'reg', normalizedEmail)
    if (!verified) {
      return NextResponse.json(
        { error: 'Email verification required. Please verify the OTP sent to your email first.' },
        { status: 403 }
      )
    }

    if (String(password).length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const existing = await prisma.profile.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ error: 'User already exists with this email' }, { status: 400 })
    }

    const userId = randomUUID()
    const passwordHash = await hashPassword(String(password))

    await prisma.$transaction(async (tx) => {
      await tx.authUser.create({
        data: {
          id: userId,
          email: normalizedEmail,
          password_hash: passwordHash,
          email_confirmed_at: new Date(),
          raw_user_meta_data: { full_name: fullName, phone_number: phoneNumber ?? null } as any,
        },
      })
      await tx.profile.create({
        data: {
          id: userId,
          email: normalizedEmail,
          full_name: fullName,
          phone_number: phoneNumber ?? null,
          role: 'user',
          profile_type: 'employee',
          verification_status: 'pending',
        },
      })
    })

    const token = await signSessionToken(userId)
    const res = NextResponse.json({
      user: { id: userId, email: normalizedEmail },
      profile: { role: 'user', verification_status: 'pending', profile_type: 'employee' },
    })
    res.headers.append('Set-Cookie', sessionCookieHeader(token))
    res.headers.append('Set-Cookie', clearCookieHeader(REG_VERIFIED_COOKIE))
    return res
  } catch (err: any) {
    console.error('[POST /api/auth/register] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
