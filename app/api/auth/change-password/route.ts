import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { hashPassword, validatePasswordPolicy, verifyPassword } from '@/lib/server/passwords'
import { logAudit } from '@/lib/server/audit'
import { revokeAllUserSessions } from '@/lib/server/session-registry'
import {
  isRateLimited,
  recordRateLimitFailure,
  resetRateLimit,
} from '@/lib/server/rate-limit'
import { changePasswordBodySchema, validateBody } from '@/lib/server/schemas'

// POST /api/auth/change-password { currentPassword, newPassword }
// — the signed-in user changes their OWN password (the replacement
// for the legacy auth update call). The new hash replaces BOTH
// hash fields so exactly one credential is valid.
//
// FIX2 F-01 (Audit 2): the old handler took only the new password —
// it never verified the CURRENT password, and it left every
// existing session alive, so a hijacked session could lock the
// real owner out and survive the owner's own password change. Now:
//  1. the current password is required and verified against the
//     stored credential (native or legacy hash, via the shared
//     verifyPassword); wrong guesses are rate-limited on the
//     'change_password' bucket (5 in 15 min → 15 min lock), keyed
//     by the caller's own id;
//  2. on success EVERY session of the user is revoked via
//     revokeAllUserSessions (registry rows stamped + session_epoch
//     bumped, which also kills legacy tokens). The epoch is
//     per-user, so the session making this very request dies too —
//     forced re-login everywhere, the standard pattern for a
//     credential change and the only one that leaves no token
//     alive. The settings pages handle `relogin: true` by sending
//     the user back to the sign-in page.
const FAILURE_WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000
const MAX_FAILURES = 5

export async function POST(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const valid = validateBody(changePasswordBodySchema, body)
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 })
    const currentPassword = String(body.currentPassword)
    const newPassword = String(body.newPassword ?? body.password ?? '')

    // Lock check BEFORE verification (same discipline as login).
    let lockedNow = false
    try {
      lockedNow = await isRateLimited('change_password', caller.id)
    } catch (err) {
      console.error('[change-password] rate-limit check failed (proceeding):', err)
    }
    if (lockedNow) {
      return NextResponse.json(
        { error: 'Too many incorrect attempts. Please wait 15 minutes and try again.' },
        { status: 429 }
      )
    }

    const authUser = await prisma.authUser.findUnique({
      where: { id: caller.id },
      select: { password_hash: true, legacy_bcrypt_hash: true },
    })
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const check = await verifyPassword(currentPassword, authUser)
    if (!check.ok) {
      try {
        await recordRateLimitFailure('change_password', caller.id, {
          windowMs: FAILURE_WINDOW_MS,
          maxFailures: MAX_FAILURES,
          lockMs: LOCK_MS,
        })
      } catch (err) {
        console.error('[change-password] rate-limit record failed (fail-soft):', err)
      }
      await logAudit({
        caller,
        req,
        action: 'password.change_failed',
        eventType: 'auth',
        entityTable: 'auth_users',
        entityId: caller.id,
        branchId: caller.branch_id,
        newValue: { reason: 'invalid_current_password' } as any,
      })
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 403 })
    }

    // S3 (R2 Security Round): the shared password policy replaces
    // the old 6-characters-only check (min 10 + mixed classes +
    // common-password blocklist).
    const policy = validatePasswordPolicy(newPassword)
    if (!policy.ok) {
      return NextResponse.json(
        { error: policy.error ?? 'Password is required.' },
        { status: 400 }
      )
    }

    const passwordHash = await hashPassword(newPassword)
    await prisma.authUser.update({
      where: { id: caller.id },
      data: { password_hash: passwordHash, legacy_bcrypt_hash: null },
    })

    await resetRateLimit('change_password', caller.id).catch((err) =>
      console.error('[change-password] rate-limit reset failed (fail-soft):', err)
    )

    // F-01: revoke every session (this one included — see header).
    const revocation = await revokeAllUserSessions(caller.id, 'password_change')

    // S3: unified audit event (S1 helper; value never recorded).
    await logAudit({
      caller,
      req,
      action: 'password.change',
      eventType: 'auth',
      entityTable: 'auth_users',
      entityId: caller.id,
      branchId: caller.branch_id,
      fieldChanges: [{ field: 'password', old: '[redacted]', new: '[redacted]' }],
      newValue: {
        sessions_revoked: revocation?.revokedCount ?? null,
        session_epoch: revocation ? { old: revocation.oldEpoch, new: revocation.newEpoch } : null,
      } as any,
    })

    return NextResponse.json({ success: true, relogin: true })
  } catch (err: any) {
    console.error('[POST /api/auth/change-password] Error:', err)
    return NextResponse.json({ error: 'Failed to update password' }, { status: 500 })
  }
}
