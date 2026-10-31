/**
 * S3 (R2 Security Round) — generic DB-backed rate-limit counters.
 *
 * Backed by the `rate_limit_counters` table (targeted DDL,
 * ddl_s2s3.cjs) so counters survive restarts — a settings row or an
 * in-memory map would not. One row per (bucket, key); the helper is
 * deliberately generic so later rounds reuse it for OTP-send and
 * upload caps (Writer C) with their own bucket names and thresholds.
 *
 * Semantics:
 *  - A bucket/key has a sliding window anchored at window_start.
 *    Failures older than the window no longer count: the first
 *    failure after the window restarts the count at 1.
 *  - When the count reaches maxFailures inside the window, the key
 *    locks until now + lockMs. `justLocked` is true ONLY on that
 *    transition call, so callers can fire an alert exactly once.
 *  - While locked, further failures are reported as locked but do
 *    NOT extend the lock and do NOT re-fire the transition.
 *  - resetBucket clears count + lock (e.g. on a successful login).
 *
 * All functions are fail-soft in the caller's favour decision: they
 * throw on DB errors and the LOGIN route catches — a counter outage
 * must never take login down with it (the route logs and proceeds).
 */
import { prisma } from '@/lib/db'

export interface RateLimitState {
  count: number
  windowStart: Date
  lockedUntil: Date | null
  locked: boolean
}

export interface RecordFailureResult extends RateLimitState {
  /** true only on the call that transitions the key into lock. */
  justLocked: boolean
}

export async function getRateLimitState(
  bucket: string,
  key: string,
  now: Date = new Date()
): Promise<RateLimitState | null> {
  const row = await prisma.rateLimitCounter.findUnique({
    where: { bucket_key: { bucket, key } },
  })
  if (!row) return null
  return {
    count: row.count,
    windowStart: row.window_start,
    lockedUntil: row.locked_until,
    locked: !!row.locked_until && row.locked_until.getTime() > now.getTime(),
  }
}

/** True when the (bucket, key) is currently inside a lock window. */
export async function isRateLimited(
  bucket: string,
  key: string,
  now: Date = new Date()
): Promise<boolean> {
  const state = await getRateLimitState(bucket, key, now)
  return state?.locked === true
}

/**
 * Record one failed attempt. windowMs anchors the sliding window;
 * reaching maxFailures within it locks for lockMs.
 */
export async function recordRateLimitFailure(
  bucket: string,
  key: string,
  opts: { windowMs: number; maxFailures: number; lockMs: number },
  now: Date = new Date()
): Promise<RecordFailureResult> {
  const existing = await prisma.rateLimitCounter.findUnique({
    where: { bucket_key: { bucket, key } },
  })

  // Already locked: report, never extend, never re-fire.
  if (existing?.locked_until && existing.locked_until.getTime() > now.getTime()) {
    return {
      count: existing.count,
      windowStart: existing.window_start,
      lockedUntil: existing.locked_until,
      locked: true,
      justLocked: false,
    }
  }

  const windowExpired =
    !existing || now.getTime() - existing.window_start.getTime() > opts.windowMs
  const count = windowExpired ? 1 : existing.count + 1
  const windowStart = windowExpired ? now : existing.window_start
  const justLocked = count >= opts.maxFailures
  const lockedUntil = justLocked ? new Date(now.getTime() + opts.lockMs) : null

  const row = await prisma.rateLimitCounter.upsert({
    where: { bucket_key: { bucket, key } },
    create: { bucket, key, count, window_start: windowStart, locked_until: lockedUntil, updated_at: now },
    update: { count, window_start: windowStart, locked_until: lockedUntil, updated_at: now },
  })
  return {
    count: row.count,
    windowStart: row.window_start,
    lockedUntil: row.locked_until,
    locked: !!row.locked_until && row.locked_until.getTime() > now.getTime(),
    justLocked,
  }
}

export interface SendCapResult {
  allowed: boolean
  count: number
  windowStart: Date
  /** ms until the current window ends (0 when allowed). */
  retryAfterMs: number
}

/**
 * S5 (R2 Security Round, Writer C) — additive send-cap primitive for
 * OTP-send and upload caps. Unlike the failure counters above, EVERY
 * call counts (a send is not a failure): the first `max` calls inside
 * the window are allowed, later calls in the same window are refused
 * with retryAfterMs = time until the window rolls. The window is
 * anchored at window_start exactly like the failure counters, and the
 * row's locked_until is stamped to the window end once the cap is hit
 * so getRateLimitState() reports the key as limited. Buckets used:
 * 'otp_send_register' / 'otp_send_2fa' / 'otp_send_reset' /
 * 'file_upload'. Throws on DB errors — callers fail soft.
 */
export async function checkAndRecordSend(
  bucket: string,
  key: string,
  opts: { windowMs: number; max: number },
  now: Date = new Date()
): Promise<SendCapResult> {
  const existing = await prisma.rateLimitCounter.findUnique({
    where: { bucket_key: { bucket, key } },
  })
  const windowExpired =
    !existing || now.getTime() - existing.window_start.getTime() > opts.windowMs
  const count = windowExpired ? 1 : existing.count + 1
  const windowStart = windowExpired ? now : existing.window_start
  const allowed = count <= opts.max
  const windowEnd = windowStart.getTime() + opts.windowMs
  const lockedUntil = allowed ? null : new Date(windowEnd)

  const row = await prisma.rateLimitCounter.upsert({
    where: { bucket_key: { bucket, key } },
    create: { bucket, key, count, window_start: windowStart, locked_until: lockedUntil, updated_at: now },
    update: { count, window_start: windowStart, locked_until: lockedUntil, updated_at: now },
  })
  return {
    allowed,
    count: row.count,
    windowStart: row.window_start,
    retryAfterMs: allowed ? 0 : Math.max(0, windowEnd - now.getTime()),
  }
}

/** Default OTP-send cap (S5): max 3 sends / 10 min. */
export const OTP_SEND_CAP = { windowMs: 10 * 60 * 1000, max: 3 }

/**
 * S5 convenience wrapper: records one send against BOTH the per-email
 * and the per-IP key of a bucket and reports whether either cap is now
 * exceeded. Fail-soft by design (a counter outage logs and returns
 * false) so a rate-limit table problem can never take OTP sends down.
 */
export async function isSendCapped(
  bucket: string,
  email: string,
  ip: string | null,
  opts: { windowMs: number; max: number } = OTP_SEND_CAP
): Promise<boolean> {
  try {
    const byEmail = await checkAndRecordSend(bucket, `email:${email.trim().toLowerCase()}`, opts)
    if (!byEmail.allowed) return true
    if (ip) {
      const byIp = await checkAndRecordSend(bucket, `ip:${ip}`, opts)
      if (!byIp.allowed) return true
    }
    return false
  } catch (e) {
    console.error(`[otp-send-cap:${bucket}] counter error (fail-soft):`, e)
    return false
  }
}

/** Clear a (bucket, key): count 0, no lock, fresh window anchor. */
export async function resetRateLimit(
  bucket: string,
  key: string,
  now: Date = new Date()
): Promise<void> {
  await prisma.rateLimitCounter.upsert({
    where: { bucket_key: { bucket, key } },
    create: { bucket, key, count: 0, window_start: now, locked_until: null, updated_at: now },
    update: { count: 0, locked_until: null, window_start: now, updated_at: now },
  })
}
