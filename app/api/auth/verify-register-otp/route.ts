import { NextResponse } from 'next/server'
import { verifyOtpCode } from '@/lib/otp-hash'
import { prisma } from '@/lib/db'
import {
  REG_VERIFIED_COOKIE,
  REG_VERIFIED_TTL_SECONDS,
  purposeCookieHeader,
  signPurposeToken,
} from '@/lib/server/session'

// registration_otps via Prisma; attempt
// lockout, expiry and single-use behaviour unchanged (BUG-004).

export async function POST(request: Request) {
  try {
    const { email, otpCode } = await request.json()

    if (!email || !otpCode) {
      return NextResponse.json({ error: 'Email and OTP code are required' }, { status: 400 })
    }

    const requestRecord = await prisma.registrationOtp.findFirst({ where: { email } })

    if (!requestRecord) {
      return NextResponse.json({ error: 'No pending registration found for this email' }, { status: 404 })
    }

    // BUG-004 FIX: Check attempt counter BEFORE comparing OTP
    const currentAttempts = requestRecord.attempts || 0
    if (currentAttempts >= 3) {
      // Already locked — delete and force a fresh OTP request
      await prisma.registrationOtp.deleteMany({ where: { email } })
      return NextResponse.json(
        {
          error: 'Too many failed attempts. Please request a new OTP.',
        },
        { status: 400 }
      )
    }

    // Check Expiration first
    if (requestRecord.expires_at && new Date(requestRecord.expires_at as any) < new Date()) {
      await prisma.registrationOtp.deleteMany({ where: { email } })
      return NextResponse.json({ error: 'OTP has expired. Please request a new one.' }, { status: 401 })
    }

    // Check OTP (digest comparison; legacy plaintext rows accepted
    // during the short transition — see lib/otp-hash.ts)
    if (!(await verifyOtpCode(requestRecord.otp_code, otpCode))) {
      const newAttempts = currentAttempts + 1
      if (newAttempts >= 3) {
        // Lock out — delete the OTP record entirely
        await prisma.registrationOtp.deleteMany({ where: { email } })
        return NextResponse.json(
          {
            error: 'Too many failed attempts. OTP invalidated. Please request a new one.',
          },
          { status: 400 }
        )
      }
      // Increment attempt counter
      await prisma.registrationOtp.updateMany({
        where: { email },
        data: { attempts: newAttempts },
      })
      return NextResponse.json(
        {
          error: `Incorrect OTP code. You have ${3 - newAttempts} attempt(s) left.`,
        },
        { status: 401 }
      )
    }

    // OTP is correct — delete the record to prevent reuse
    await prisma.registrationOtp
      .deleteMany({ where: { email } })
      .catch((deleteError) => console.error('Failed to delete used OTP:', deleteError))

    // Registration is gated on a SERVER-verified OTP.
    // Mint a short-lived, email-bound proof cookie; /api/auth/register
    // requires it. (The old flow let the client proceed to signUp on
    // its own claim that verification had happened.)
    const proof = await signPurposeToken('reg', email, REG_VERIFIED_TTL_SECONDS)
    const res = NextResponse.json({ message: 'Email verified successfully' }, { status: 200 })
    res.headers.append('Set-Cookie', purposeCookieHeader(REG_VERIFIED_COOKIE, proof, REG_VERIFIED_TTL_SECONDS))
    return res
  } catch (err: any) {
    console.error('Unexpected error in verify-register-otp:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
