import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyPassword, rehashData } from '@/lib/server/passwords'
import { signSessionToken, sessionCookieHeader } from '@/lib/server/session'
import { toPlain } from '@/lib/server/respond'
import { logAudit, requestMeta } from '@/lib/server/audit'
import { isPartnerAccount } from '@/lib/server/auth'
import {
  isRateLimited,
  recordRateLimitFailure,
  resetRateLimit,
} from '@/lib/server/rate-limit'
import { getAdminEmails, sendAccountLockoutAlertToAdmins } from '@/lib/email-service'

// POST /api/auth/login — the app's sign-in.
// Verifies the password against auth_users: the native bcrypt hash,
// or a carried-over legacy bcrypt hash with a TRANSPARENT REHASH
// on success (the legacy hash is replaced and cleared — the user
// never notices). Sets the erp_session cookie and returns the same
// { user, profile } facts the login page used to assemble from
// the legacy auth service (role, verification_status, full_name,
// profile_type, is_2fa_enabled).
//
// S2 (R2 Security Round): a successful login creates a user_sessions
// registry row and mints a v2 token (jti = row id, epoch = the
// profile's current session_epoch). See lib/server/session.ts.
//
// S3 (R2 Security Round): failed-attempt lockout. Two counters in
// rate_limit_counters — 'login_account' (key = lowercased email)
// and 'login_ip' (key = client IP): 5 failures inside a 15-minute
// window lock the key for 15 minutes. The lock is checked BEFORE
// password verification and the response stays the generic
// 'Invalid login credentials' — lock state is never revealed in
// the body. On success the ACCOUNT counter resets; the IP counter
// is left to decay by its window (one shared office IP must not be
// permanently punished, and a success proves nothing about other
// accounts being attacked from the same IP). On the lock
// transition, admins get an in-app notification + a fail-soft
// email alert, and a login.lockout audit row is written.

const FAILURE_WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000
const MAX_FAILURES = 5
const GENERIC_ERROR = 'Invalid login credentials'

/** Lockout side-effects: admin notifications + email + audit.
 *  Every step is fail-soft — alerts must never break login. */
async function fireLockoutAlert(args: {
  req: Request
  email: string
  ip: string | null
  scope: 'account' | 'ip'
  lockedUntil: Date | null
  actorId: string | null
  actorName: string | null
}) {
  const { req, email, ip, scope, lockedUntil, actorId, actorName } = args
  const untilText = lockedUntil ? lockedUntil.toISOString() : 'unknown'
  const title = 'Security Alert: Login Lockout'
  const message =
    scope === 'account'
      ? `Account ${email} was locked for 15 minutes after ${MAX_FAILURES} failed login attempts (source IP: ${ip ?? 'unknown'}). Locked until ${untilText}.`
      : `Source IP ${ip ?? 'unknown'} was locked for 15 minutes after ${MAX_FAILURES} failed login attempts across accounts (latest account tried: ${email}). Locked until ${untilText}.`

  // (a) In-app notifications to admins — mirrors the broadcast
  // pattern of app/api/admin/notify + app/api/email: recipients are
  // profiles with role admin/super_admin OR an admin_users row,
  // EXCLUDING partner accounts (FR-1.1: profile_type 'partner' with
  // no admin_users row is never an admin recipient).
  try {
    const [roleAdmins, adminRows] = await Promise.all([
      prisma.profile.findMany({
        where: { role: { in: ['admin', 'super_admin'] } },
        select: { id: true, profile_type: true },
      }),
      prisma.adminUser.findMany({ select: { id: true } }),
    ])
    const adminRowIds = new Set(adminRows.map((a) => a.id))
    const recipientIds = new Set<string>()
    for (const p of roleAdmins) {
      if (!isPartnerAccount(p.profile_type, adminRowIds.has(p.id))) recipientIds.add(p.id)
    }
    for (const id of adminRowIds) {
      const prof = await prisma.profile
        .findUnique({ where: { id }, select: { profile_type: true } })
        .catch(() => null)
      if (prof && !isPartnerAccount(prof.profile_type, true)) recipientIds.add(id)
    }
    if (recipientIds.size > 0) {
      await prisma.notification.createMany({
        data: [...recipientIds].map((userId) => ({
          user_id: userId,
          title,
          message,
          type: 'security',
          read: false,
          is_admin_only: true,
        })),
      })
    }
  } catch (err) {
    console.error('[login] lockout admin notification failed (fail-soft):', err)
  }

  // (b) Email alert — fail-soft (mail cannot send until the owner's
  // Resend key / sender email land; that is fine and expected).
  try {
    const adminEmails = await getAdminEmails()
    if (adminEmails.length > 0) {
      await sendAccountLockoutAlertToAdmins(adminEmails, email, ip ?? 'unknown', untilText)
    }
  } catch (err) {
    console.error('[login] lockout email alert failed (fail-soft):', err)
  }

  // (c) Audit row.
  await logAudit({
    caller: null,
    req,
    actorId,
    actorName,
    actorRole: null,
    action: 'login.lockout',
    eventType: 'auth',
    entityTable: 'auth_users',
    entityId: actorId,
    newValue: { email, ip, scope, locked_until: untilText },
  })
}

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }
    const normalizedEmail = String(email).trim().toLowerCase()
    const { ip } = requestMeta(req)
    const ipKey = ip ?? 'unknown'

    const authUser = await prisma.authUser.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, email: true, password_hash: true, legacy_bcrypt_hash: true },
    })

    // S3: lock check BEFORE password verification. Generic body —
    // the caller cannot tell a lock from a wrong password.
    let lockedNow = false
    try {
      lockedNow =
        (await isRateLimited('login_account', normalizedEmail)) ||
        (await isRateLimited('login_ip', ipKey))
    } catch (err) {
      console.error('[login] rate-limit check failed (proceeding):', err)
    }
    if (lockedNow) {
      await logAudit({
        caller: null,
        req,
        actorId: authUser?.id ?? null,
        actorName: null,
        actorRole: null,
        action: 'login.failure',
        eventType: 'auth',
        entityTable: 'auth_users',
        entityId: authUser?.id ?? null,
        newValue: { email: normalizedEmail, reason: 'locked' },
      })
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
    }

    const check = authUser
      ? await verifyPassword(String(password), authUser)
      : { ok: false, usedLegacy: false }

    if (!check.ok) {
      // S3: count the failure on both buckets (unknown emails count
      // against the submitted email string + the IP). A lock
      // transition on either bucket fires the admin alert once.
      try {
        const accountResult = await recordRateLimitFailure(
          'login_account',
          normalizedEmail,
          { windowMs: FAILURE_WINDOW_MS, maxFailures: MAX_FAILURES, lockMs: LOCK_MS }
        )
        const ipResult = await recordRateLimitFailure('login_ip', ipKey, {
          windowMs: FAILURE_WINDOW_MS,
          maxFailures: MAX_FAILURES,
          lockMs: LOCK_MS,
        })
        if (accountResult.justLocked || ipResult.justLocked) {
          const profileForActor = authUser
            ? await prisma.profile
                .findFirst({ where: { id: authUser.id }, select: { full_name: true } })
                .catch(() => null)
            : null
          if (accountResult.justLocked) {
            await fireLockoutAlert({
              req,
              email: normalizedEmail,
              ip,
              scope: 'account',
              lockedUntil: accountResult.lockedUntil,
              actorId: authUser?.id ?? null,
              actorName: profileForActor?.full_name ?? null,
            })
          }
          if (ipResult.justLocked) {
            await fireLockoutAlert({
              req,
              email: normalizedEmail,
              ip,
              scope: 'ip',
              lockedUntil: ipResult.lockedUntil,
              actorId: authUser?.id ?? null,
              actorName: profileForActor?.full_name ?? null,
            })
          }
        }
      } catch (err) {
        console.error('[login] rate-limit record failed (fail-soft):', err)
      }

      await logAudit({
        caller: null,
        req,
        actorId: authUser?.id ?? null,
        actorName: null,
        actorRole: null,
        action: 'login.failure',
        eventType: 'auth',
        entityTable: 'auth_users',
        entityId: authUser?.id ?? null,
        newValue: { email: normalizedEmail, reason: 'invalid_credentials' },
      })
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
    }

    // Success implies authUser exists (check.ok is only true then).
    const user = authUser!

    // S3: a successful login resets the ACCOUNT counter. The IP
    // counter is deliberately left to decay by its window.
    await resetRateLimit('login_account', normalizedEmail).catch((err) =>
      console.error('[login] rate-limit reset failed (fail-soft):', err)
    )

    // Transparent rehash: first successful login on a carried-over
    // hash upgrades the account to the native scheme.
    if (check.usedLegacy) {
      const data = await rehashData(String(password))
      await prisma.authUser
        .update({ where: { id: user.id }, data })
        .catch((e) => console.error('[login] transparent rehash failed:', e))
    }

    await prisma.authUser
      .update({ where: { id: user.id }, data: { last_sign_in_at: new Date() } })
      .catch(() => {})

    const profile = await prisma.profile.findFirst({
      where: { id: user.id },
      select: {
        role: true, verification_status: true, full_name: true, profile_type: true,
        is_2fa_enabled: true, is_banned: true, branch_id: true, is_branch_manager: true,
        session_epoch: true,
      },
    })

    if ((profile as any)?.is_banned === true) {
      return NextResponse.json({ error: 'This account has been banned. Please contact administration.' }, { status: 403 })
    }

    // S2: registry row first — its id becomes the token's jti.
    const { userAgent } = requestMeta(req)
    const sessionId = randomUUID()
    await prisma.userSession.create({
      data: {
        id: sessionId,
        user_id: user.id,
        ip_address: ip,
        user_agent: userAgent,
      },
    })

    const token = await signSessionToken(user.id, {
      jti: sessionId,
      epoch: (profile as any)?.session_epoch ?? 0,
    })

    await logAudit({
      caller: null,
      req,
      actorId: user.id,
      actorName: (profile as any)?.full_name ?? null,
      actorRole: (profile as any)?.role ?? null,
      action: 'login.success',
      eventType: 'auth',
      entityTable: 'auth_users',
      entityId: user.id,
      branchId: (profile as any)?.branch_id ?? null,
      newValue: { email: normalizedEmail, session_id: sessionId },
    })

    // session_epoch is an internal security counter — never returned.
    const { session_epoch: _epoch, ...profileForResponse } = (profile ?? {}) as any
    const res = NextResponse.json({
      user: { id: user.id, email: user.email },
      profile: profile ? toPlain(profileForResponse) : null,
    })
    res.headers.append('Set-Cookie', sessionCookieHeader(token))
    return res
  } catch (err: any) {
    console.error('[POST /api/auth/login] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
