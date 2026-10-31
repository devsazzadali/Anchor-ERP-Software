import { NextResponse } from 'next/server'
import { signTwoFactorToken } from '@/lib/two-factor-cookie'
import { verifyOtpCode } from '@/lib/otp-hash'
import { prisma } from '@/lib/db'
import { sessionTokenFromRequest, verifySessionToken } from '@/lib/server/session'

// caller = the app's own session;
// user_2fa_otps via Prisma; the signed 2fa_verified cookie is
// unchanged (lib/two-factor-cookie.ts, SEC-09 1-hour maxAge).

export async function POST(request: Request) {
  try {
    const { userId, otpCode } = await request.json()

    if (!userId || !otpCode) {
      return NextResponse.json({ error: 'User ID and OTP Code are required' }, { status: 400 })
    }

    const sessionUserId = await verifySessionToken(sessionTokenFromRequest(request))
    if (!sessionUserId || sessionUserId !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 1. Fetch OTP for this user
    const otpRecord = await prisma.user2faOtp.findFirst({ where: { user_id: userId } })

    if (!otpRecord) {
      return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 400 })
    }

    // 2. Check expiration
    if (new Date() > new Date(otpRecord.expires_at as any)) {
      await prisma.user2faOtp.delete({ where: { id: otpRecord.id } })
      return NextResponse.json({ error: 'OTP has expired. Please request a new one.' }, { status: 400 })
    }

    // 3. Verify the OTP code (digest comparison — lib/otp-hash.ts)
    if (!(await verifyOtpCode(otpRecord.otp_code, otpCode))) {
      const newAttempts = (otpRecord.attempts || 0) + 1

      if (newAttempts >= 3) {
        // Delete after 3 failed attempts
        await prisma.user2faOtp.delete({ where: { id: otpRecord.id } })
        return NextResponse.json(
          { error: 'Too many failed attempts. OTP invalidated. Please request a new one.' },
          { status: 400 }
        )
      } else {
        await prisma.user2faOtp.update({ where: { id: otpRecord.id }, data: { attempts: newAttempts } })
        return NextResponse.json(
          { error: 'Invalid OTP. You have ' + (3 - newAttempts) + ' attempt(s) left.' },
          { status: 400 }
        )
      }
    }

    // 5. OTP is valid! Delete it so it can't be reused.
    await prisma.user2faOtp.delete({ where: { id: otpRecord.id } })

    // 6. Set secure 2FA verification cookie — an HMAC-signed token
    // bound to this user. (It previously held the raw userId, which is
    // not a secret; see lib/two-factor-cookie.ts.)
    const response = NextResponse.json({ success: true, message: '2FA verified successfully' }, { status: 200 })
    response.cookies.set('2fa_verified', await signTwoFactorToken(userId), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      // SEC-09 FIX: Added maxAge (1 hour) to force 2FA re-verification on shared/public computers.
      // Without this, the cookie persisted until browser close — indefinite on kept-open browsers.
      maxAge: 60 * 60, // 1 hour in seconds
    })

    return response
  } catch (err: any) {
    console.error('Unexpected error in verify-2fa-otp:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
