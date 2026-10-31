import { NextResponse } from 'next/server'
import { verifyOtpCode } from '@/lib/otp-hash'
import { prisma } from '@/lib/db'

// password_reset_requests via Prisma;
// attempt lockout + expiry behaviour unchanged (BUG-004).

export async function POST(request: Request) {
  try {
    const { reqId, otpCode } = await request.json()
    if (!reqId || !otpCode) {
      return NextResponse.json({ error: 'Missing reqId or OTP code' }, { status: 400 })
    }

    const requestRecord = await prisma.passwordResetRequest.findFirst({ where: { id: reqId } })

    if (!requestRecord) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 404 })
    }

    if (requestRecord.status !== 'otp_pending') {
      return NextResponse.json({ error: 'This request is not pending an OTP verification' }, { status: 400 })
    }

    // BUG-004 FIX: Check attempt counter — lock out after 3 failures
    const currentAttempts = requestRecord.attempts || 0
    if (currentAttempts >= 3) {
      // Invalidate the request entirely on lockout
      await prisma.passwordResetRequest.update({
        where: { id: reqId },
        data: { status: 'invalidated' },
      })
      return NextResponse.json(
        {
          error: 'Too many failed attempts. This reset request has been invalidated. Please start over.',
        },
        { status: 400 }
      )
    }

    // Check Expiration BEFORE comparing OTP
    if (requestRecord.otp_expires_at && new Date(requestRecord.otp_expires_at as any) < new Date()) {
      return NextResponse.json({ error: 'OTP has expired. Please request a new one.' }, { status: 401 })
    }

    // FR-6 #20: no code on file (otp_code cleared/never issued) is a
    // 400, never a digest comparison against null.
    if (requestRecord.otp_code == null) {
      return NextResponse.json({ error: 'No OTP code on file for this request. Please start over.' }, { status: 400 })
    }

    // Check OTP (digest comparison — lib/otp-hash.ts)
    if (!(await verifyOtpCode(requestRecord.otp_code, otpCode))) {
      const newAttempts = currentAttempts + 1
      if (newAttempts >= 3) {
        await prisma.passwordResetRequest.update({
          where: { id: reqId },
          data: { status: 'invalidated', attempts: newAttempts },
        })
        return NextResponse.json(
          {
            error: 'Too many failed attempts. This reset request has been invalidated. Please start over.',
          },
          { status: 400 }
        )
      }
      await prisma.passwordResetRequest.update({
        where: { id: reqId },
        data: { attempts: newAttempts },
      })
      return NextResponse.json(
        {
          error: 'Incorrect OTP code. You have ' + (3 - newAttempts) + ' attempt(s) left.',
        },
        { status: 401 }
      )
    }

    // If OTP is correct, approve the request and clear the OTP
    try {
      await prisma.passwordResetRequest.update({
        where: { id: reqId },
        data: {
          status: 'approved',
          otp_code: null, // Clear it for security
          updated_at: new Date(),
        },
      })
    } catch (updateError) {
      console.error('Failed to approve OTP request:', updateError)
      return NextResponse.json({ error: 'Failed to verify OTP' }, { status: 500 })
    }

    return NextResponse.json({ message: 'OTP verified successfully' }, { status: 200 })
  } catch (err) {
    console.error('Unexpected error in verify-reset-otp route:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
