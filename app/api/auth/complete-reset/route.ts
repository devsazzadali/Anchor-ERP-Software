import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hashPassword } from '@/lib/server/passwords'

// the atomic token consume is an
// updateMany guarded on status='approved' (count 1 = consumed —
// same race protection as the original conditional UPDATE). The
// password write sets the native bcrypt hash on auth_users and
// clears any legacy hash.

export async function POST(request: Request) {
  try {
    const { reqId, newPassword } = await request.json()
    if (!reqId || !newPassword) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // BUG-005 FIX: Enforce the same password policy as registration (8 chars + complexity).
    // Previously this only required 6 characters, allowing weaker reset passwords than sign-up.
    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    const passwordStrength = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/
    if (!passwordStrength.test(newPassword)) {
      return NextResponse.json(
        {
          error: 'Password must contain uppercase, lowercase, a number, and a special character',
        },
        { status: 400 }
      )
    }

    // Fetch the request
    const resetReq = await prisma.passwordResetRequest.findFirst({ where: { id: reqId } })

    if (!resetReq) {
      return NextResponse.json({ error: 'Invalid or expired request' }, { status: 404 })
    }

    if (resetReq.status !== 'approved') {
      return NextResponse.json({ error: 'This request has not been approved by an admin yet.' }, { status: 403 })
    }

    // SEC-07 FIX: Rate limit — block if more than 5 password-update attempts on this request.
    // Even though reqId is a UUID, this adds defence-in-depth against automated attacks.
    const attempts = resetReq.attempts || 0
    if (attempts >= 5) {
      await prisma.passwordResetRequest.update({
        where: { id: reqId },
        data: { status: 'invalidated' },
      })
      return NextResponse.json(
        { error: 'Too many attempts. This reset request has been invalidated for security. Please request a new one.' },
        { status: 429 }
      )
    }

    // SEC-04 FIX: Check that the approved token hasn't expired (24-hour window).
    // Approved tokens without updated_at are treated as expired for safety.
    const approvedAt = resetReq.updated_at ? new Date(resetReq.updated_at as any) : null
    if (!approvedAt || Date.now() - approvedAt.getTime() > 24 * 60 * 60 * 1000) {
      await prisma.passwordResetRequest.update({
        where: { id: reqId },
        data: { status: 'invalidated' },
      })
      return NextResponse.json({ error: 'This reset link has expired. Please request a new one.' }, { status: 403 })
    }

    // SEC-04 FIX: Atomically mark the token as 'completed' before updating the password.
    // This prevents race conditions where two concurrent requests both see status='approved'.
    const consumed = await prisma.passwordResetRequest.updateMany({
      where: { id: reqId, status: 'approved' },
      data: { status: 'completed', updated_at: new Date() },
    })

    if (consumed.count !== 1) {
      // Another request already consumed this token (race condition blocked)
      return NextResponse.json({ error: 'This reset link has already been used. Please request a new one.' }, { status: 409 })
    }

    // Token atomically consumed — now safe to update password
    try {
      const passwordHash = await hashPassword(newPassword)
      await prisma.authUser.update({
        where: { id: resetReq.user_id },
        data: { password_hash: passwordHash, legacy_bcrypt_hash: null },
      })
    } catch (updateError) {
      // Password update failed — revert token status so the user can try again
      console.error('Error updating user password:', updateError)
      await prisma.passwordResetRequest.update({
        where: { id: reqId },
        data: { status: 'approved' },
      })
      return NextResponse.json({ error: 'Failed to update password. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Password updated successfully' }, { status: 200 })
  } catch (err) {
    console.error('Unexpected error in complete-reset route:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
