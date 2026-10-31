import { NextResponse } from 'next/server'
import { sendRegistrationOTP } from '@/lib/email-service'
import { hashOtpCode } from '@/lib/otp-hash'
import { prisma } from '@/lib/db'

// registration_otps via Prisma; the OTP
// security behaviour is unchanged (CSPRNG code, digest at rest,
// 60-second resend rate limit — SEC-11).

export async function POST(request: Request) {
  try {
    const { email, fullName } = await request.json()

    if (!email || !fullName) {
      return NextResponse.json({ error: 'Email and Name are required' }, { status: 400 })
    }

    // 1. Check if user already exists
    const existingProfile = await prisma.profile.findFirst({
      where: { email },
      select: { id: true },
    })

    if (existingProfile) {
      return NextResponse.json({ error: 'User already exists with this email' }, { status: 400 })
    }

    // 2. Generate OTP — use crypto.getRandomValues() (CSPRNG), not Math.random()
    const randomArray = new Uint32Array(1)
    crypto.getRandomValues(randomArray)
    const otpCode = (100000 + (randomArray[0] % 900000)).toString()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // 3. SEC-11 FIX: Rate limit — check if an OTP was sent for this email in the last 60 seconds.
    // This prevents email bombing attacks (spamming the OTP endpoint).
    const recentOtp = await prisma.registrationOtp.findFirst({
      where: { email },
      select: { created_at: true },
    })

    if (recentOtp) {
      const createdAt = new Date(recentOtp.created_at as any).getTime()
      const secondsSinceLast = (Date.now() - createdAt) / 1000
      if (secondsSinceLast < 60) {
        const waitSeconds = Math.ceil(60 - secondsSinceLast)
        return NextResponse.json(
          { error: `Please wait ${waitSeconds} second(s) before requesting another OTP.` },
          { status: 429 }
        )
      }
      // Older than 60 seconds — delete it and allow a fresh send
      await prisma.registrationOtp.deleteMany({ where: { email } })
    }

    try {
      await prisma.registrationOtp.create({
        data: {
          email,
          otp_code: await hashOtpCode(otpCode), // D: store the digest, never the code
          expires_at: expiresAt,
          attempts: 0,
        },
      })
    } catch (insertError) {
      // SEC-12 FIX: Log full error server-side but return a generic message to the client.
      // Raw DB errors can reveal table names, column names, and schema structure.
      console.error('Failed to insert registration OTP:', insertError)
      return NextResponse.json({ error: 'Failed to create OTP request. Please try again.' }, { status: 500 })
    }

    // 4. Send Email directly via service
    await sendRegistrationOTP(email, fullName, otpCode).catch((e) =>
      console.error('Failed to send OTP email:', e)
    )

    return NextResponse.json({ message: 'OTP sent to email successfully' }, { status: 200 })
  } catch (err: any) {
    console.error('Unexpected error in send-register-otp:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
