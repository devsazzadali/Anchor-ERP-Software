import { NextResponse } from 'next/server'
import { sendPasswordResetOTP } from '@/lib/email-service'
import { hashOtpCode } from '@/lib/otp-hash'
import { verifySecurityAnswer } from '@/lib/security-answer'
import { prisma } from '@/lib/db'
import { isSendCapped } from '@/lib/server/rate-limit'
import { requestMeta } from '@/lib/server/audit'

// profiles / auth_users / system_settings
// / password_reset_requests via Prisma. The auth.admin fallbacks
// become auth_users lookups. Both flows (email OTP primary, legacy
// security-answer) and their rate limits are unchanged.

// D: per-instance attempt lockout for the legacy security-answer
// flow (5 failures -> 15 minutes). Serverless instances do not share
// this map, so it is a speed-bump layered on the existing 1.5s
// delay — the durable protections are the hashed answer storage
// and the A2/A5 policy lockdown.
const answerAttempts = new Map<string, { fails: number; lockedUntil: number }>()

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, userId, answer } = body

    // ── Direct Email OTP Reset Flow (Primary & Modern) ───────────────────
    if (email) {
      const normalizedEmail = String(email).trim().toLowerCase()
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(normalizedEmail)) {
        return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
      }

      // S5 (R2 Security Round) — send cap: max 3 sends / 10 min per
      // email AND per IP → generic 429 (fail-soft inside isSendCapped).
      if (await isSendCapped('otp_send_reset', normalizedEmail, requestMeta(request).ip)) {
        return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
      }

      // 1. Find user in profiles (case-insensitive)
      const profile = await prisma.profile.findFirst({
        where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
        select: { id: true, full_name: true, email: true },
      })

      let targetUserId = profile?.id
      let targetName = profile?.full_name || 'Valued User'
      let targetEmail = profile?.email || normalizedEmail

      // Fallback: check auth users directly if profile was missing or email differed slightly
      if (!targetUserId) {
        try {
          const authUsers = await prisma.authUser.findMany({
            select: { id: true, email: true, raw_user_meta_data: true },
          })
          const found = authUsers?.find((u) => u.email?.toLowerCase() === normalizedEmail)
          if (found) {
            targetUserId = found.id
            targetName = ((found.raw_user_meta_data as any)?.full_name as string) || 'Valued User'
            targetEmail = found.email || normalizedEmail
          }
        } catch (e) {
          console.warn('Auth user search fallback encountered:', e)
        }
      }

      if (!targetUserId) {
        return NextResponse.json(
          { error: 'No account found with this email address. Please verify your registered email.' },
          { status: 404 }
        )
      }

      // 2. Generate secure 6-digit OTP using CSPRNG
      const randArr = new Uint32Array(1)
      crypto.getRandomValues(randArr)
      const otpCode = (100000 + (randArr[0] % 900000)).toString()
      const otpCodeStored = await hashOtpCode(otpCode) // D: never store plaintext codes
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes valid

      // 3. Upsert / Refresh in password_reset_requests
      const existingRequests = await prisma.passwordResetRequest.findMany({
        where: { user_id: targetUserId, status: { in: ['otp_pending', 'pending'] } },
        select: { id: true, status: true, updated_at: true, created_at: true },
      })

      let reqId: string

      if (existingRequests && existingRequests.length > 0) {
        const existing = existingRequests[0]

        // Rate limit: prevent spamming resend within 20 seconds
        const lastAction = new Date((existing.updated_at || existing.created_at) as any).getTime()
        const diffSeconds = (Date.now() - lastAction) / 1000
        if (diffSeconds < 20) {
          return NextResponse.json(
            { error: 'Please wait ' + Math.ceil(20 - diffSeconds) + ' seconds before requesting a new code.' },
            { status: 429 }
          )
        }

        try {
          await prisma.passwordResetRequest.update({
            where: { id: existing.id },
            data: {
              status: 'otp_pending',
              otp_code: otpCodeStored,
              otp_expires_at: expiresAt,
              attempts: 0,
              updated_at: new Date(),
            },
          })
        } catch (updateError) {
          console.error('Error updating existing reset request:', updateError)
          return NextResponse.json({ error: 'Failed to update reset request.' }, { status: 500 })
        }
        reqId = existing.id
      } else {
        // Clean up any stale records
        await prisma.passwordResetRequest.deleteMany({
          where: { user_id: targetUserId, status: { in: ['invalidated', 'completed'] } },
        })

        try {
          const newRequest = await prisma.passwordResetRequest.create({
            data: {
              user_id: targetUserId,
              status: 'otp_pending',
              otp_code: otpCodeStored,
              otp_expires_at: expiresAt,
              attempts: 0,
            },
          })
          reqId = newRequest.id
        } catch (insertError: any) {
          console.error('Insert reset request error:', insertError)
          return NextResponse.json({ error: 'Failed to create OTP request.' }, { status: 500 })
        }
      }

      // 4. Dispatch Email with 6-digit OTP
      const emailResult = await sendPasswordResetOTP(targetEmail, targetName, otpCode)
      if (!emailResult.success) {
        console.error('Failed to send OTP email:', emailResult.error)
        return NextResponse.json(
          {
            error: 'Failed to send verification email. Please verify system email settings or try again later.',
          },
          { status: 500 }
        )
      }

      return NextResponse.json(
        {
          success: true,
          message: 'A 6-digit verification code has been sent to ' + targetEmail + '.',
          status: 'otp_pending',
          reqId,
          email: targetEmail,
        },
        { status: 200 }
      )
    }

    // ── Legacy Flow: Security Answer (UserId & Answer) ───────────────────
    if (!userId || !answer) {
      return NextResponse.json({ error: 'Email address is required to reset password.' }, { status: 400 })
    }

    const profile = await prisma.profile.findFirst({
      where: { id: userId },
      select: { security_answer: true, full_name: true, email: true },
    })

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    if (!profile.security_answer) {
      return NextResponse.json({ error: 'No security answer set' }, { status: 400 })
    }

    // Anti-brute-force delay
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const attemptState = answerAttempts.get(userId)
    if (attemptState && attemptState.lockedUntil > Date.now()) {
      return NextResponse.json(
        { error: 'Too many incorrect attempts. Please try again later or use the email verification code.' },
        { status: 429 }
      )
    }

    if (!(await verifySecurityAnswer(profile.security_answer, answer))) {
      const fails = (attemptState?.fails || 0) + 1
      answerAttempts.set(userId, {
        fails,
        lockedUntil: fails >= 5 ? Date.now() + 15 * 60 * 1000 : 0,
      })
      return NextResponse.json({ error: 'Incorrect security answer' }, { status: 401 })
    }
    answerAttempts.delete(userId)

    // Check System Settings for Password Reset Mode
    const modeSetting = await prisma.systemSetting.findFirst({
      where: { key: 'password_reset_mode' },
      select: { value: true },
    })

    const resetMode = modeSetting?.value || 'otp'

    const existingRequests = await prisma.passwordResetRequest.findMany({
      where: { user_id: userId, status: { in: ['pending', 'approved', 'otp_pending'] } },
    })

    if (existingRequests && existingRequests.length > 0) {
      const existing = existingRequests[0]

      if (resetMode === 'otp' && existing.status === 'otp_pending') {
        const _randResend = new Uint32Array(1)
        crypto.getRandomValues(_randResend)
        const otpCode = (100000 + (_randResend[0] % 900000)).toString()
        const otpCodeStored = await hashOtpCode(otpCode)
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

        await prisma.passwordResetRequest.update({
          where: { id: existing.id },
          data: {
            otp_code: otpCodeStored,
            otp_expires_at: expiresAt,
            attempts: 0,
            updated_at: new Date(),
          },
        })

        const authUser = await prisma.authUser.findFirst({
          where: { id: userId },
          select: { email: true },
        })
        const targetEmail = authUser?.email || profile.email
        if (targetEmail) {
          await sendPasswordResetOTP(targetEmail, profile.full_name || 'User', otpCode).catch((e) =>
            console.error('Failed to send OTP email', e)
          )
        }

        return NextResponse.json(
          {
            message: 'OTP resent',
            status: existing.status,
            reqId: existing.id,
          },
          { status: 200 }
        )
      }

      if (resetMode === 'manual' && existing.status === 'pending') {
        return NextResponse.json(
          {
            message: 'Existing request found',
            status: existing.status,
            reqId: existing.id,
          },
          { status: 200 }
        )
      }

      if (existing.status === 'approved') {
        return NextResponse.json(
          {
            message: 'Existing request found',
            status: existing.status,
            reqId: existing.id,
          },
          { status: 200 }
        )
      }

      await prisma.passwordResetRequest.delete({ where: { id: existing.id } })
    }

    if (resetMode === 'otp') {
      const _rand = new Uint32Array(1)
      crypto.getRandomValues(_rand)
      const otpCode = (100000 + (_rand[0] % 900000)).toString()
      const otpCodeStored = await hashOtpCode(otpCode)
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

      let newRequest: any
      try {
        newRequest = await prisma.passwordResetRequest.create({
          data: {
            user_id: userId,
            status: 'otp_pending',
            otp_code: otpCodeStored,
            otp_expires_at: expiresAt,
            attempts: 0,
          },
        })
      } catch (insertError: any) {
        console.error('Insert reset request error:', insertError)
        return NextResponse.json({ error: 'Failed to create OTP request.' }, { status: 500 })
      }

      const authUser = await prisma.authUser.findFirst({
        where: { id: userId },
        select: { email: true },
      })
      const targetEmail = authUser?.email || profile.email
      if (targetEmail) {
        await sendPasswordResetOTP(targetEmail, profile.full_name || 'User', otpCode).catch((e) =>
          console.error('Failed to send OTP email', e)
        )
      }

      return NextResponse.json(
        {
          message: 'OTP sent successfully',
          status: newRequest.status,
          reqId: newRequest.id,
        },
        { status: 200 }
      )
    } else {
      let newRequest: any
      try {
        newRequest = await prisma.passwordResetRequest.create({
          data: {
            user_id: userId,
            status: 'pending',
          },
        })
      } catch (insertError: any) {
        console.error('Insert reset request error:', insertError)
        return NextResponse.json({ error: 'Failed to create request.' }, { status: 500 })
      }

      return NextResponse.json(
        {
          message: 'Password reset request submitted successfully',
          status: newRequest.status,
          reqId: newRequest.id,
        },
        { status: 200 }
      )
    }
  } catch (err) {
    console.error('Unexpected error in request-reset route:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
