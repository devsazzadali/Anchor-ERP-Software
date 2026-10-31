import { NextResponse } from 'next/server'
import { send2FAOTP } from '@/lib/email-service'
import { hashOtpCode } from '@/lib/otp-hash'
import { prisma } from '@/lib/db'
import { sessionTokenFromRequest, verifySessionToken } from '@/lib/server/session'

// the caller check that used the
// The session cookie now verifies this app's own session
// (lib/server/session.ts) — the user must be signed in (password
// step done) and may only request a 2FA code for THEMSELVES.
// user_2fa_otps via Prisma; digest-at-rest unchanged.

export async function POST(request: Request) {
  try {
    const { userId, email, fullName } = await request.json()

    if (!userId || !email) {
      return NextResponse.json({ error: 'User ID and Email are required' }, { status: 400 })
    }

    const sessionUserId = await verifySessionToken(sessionTokenFromRequest(request))
    if (!sessionUserId || sessionUserId !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 1. Generate OTP securely
    const randomArray = new Uint32Array(1)
    crypto.getRandomValues(randomArray)
    const otpCode = (100000 + (randomArray[0] % 900000)).toString()
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000) // 2 minutes expiration

    // 2. Store OTP in DB
    // First, delete any existing OTPs for this user
    await prisma.user2faOtp.deleteMany({ where: { user_id: userId } })

    try {
      await prisma.user2faOtp.create({
        data: {
          user_id: userId,
          otp_code: await hashOtpCode(otpCode), // D: store the digest, never the code
          expires_at: expiresAt,
        },
      })
    } catch (insertError) {
      console.error('Failed to insert 2FA OTP:', insertError)
      return NextResponse.json({ error: 'Failed to create OTP request' }, { status: 500 })
    }

    // 3. Send Email directly via service
    await send2FAOTP(email, fullName || 'User', otpCode).catch((e) =>
      console.error('Failed to send 2FA OTP email:', e)
    )

    return NextResponse.json(
      {
        message: '2FA OTP sent to email successfully',
        expires_at: expiresAt.toISOString(),
      },
      { status: 200 }
    )
  } catch (err: any) {
    console.error('Unexpected error in send-2fa-otp:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
