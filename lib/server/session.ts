/**
 * Session cookie for this app — replaces the legacy auth sessions.
 *
 * legacy JWT sessions do NOT transfer to this app;
 * every user signs in once and receives this cookie instead. The
 * cookie carries `userId.expiresAtUnix.signature` (legacy) or, since
 * S2, `userId.expiresAtUnix.jti.epoch.signature` (v2), where the
 * signature is HMAC-SHA256 over the payload, keyed by a server-only
 * secret — the same construction the fix program used for the 2FA
 * cookie (lib/two-factor-cookie.ts). It can only be minted by the
 * app's login route after a successful password verification
 * (native hash, or a carried-over bcrypt hash — lib/server/passwords.ts).
 *
 * The secret comes from SESSION_SECRET. There is deliberately NO
 * fallback to any legacy key: this app has no legacy keys.
 */

export const SESSION_COOKIE = 'erp_session'

/** Session lifetime: 7 days. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not configured')
  return secret
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((b) => { binary += String.fromCharCode(b) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hmac(payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return new Uint8Array(signature)
}

/**
 * S2 (R2 Security Round) — token format v2.
 *
 * LEGACY payload: `userId.expires` (2 parts) + `.sig`.
 * V2 payload:     `userId.expires.jti.epoch` (4 parts) + `.sig`,
 * where `jti` is the user_sessions row id created at login and
 * `epoch` is the profiles.session_epoch the token was minted at.
 * The signature is HMAC-SHA256 over the whole payload string in
 * both formats, compared timing-safe.
 *
 * Legacy tokens stay valid until their natural 7-day expiry (the
 * registry cannot enumerate them — documented transition), BUT the
 * resolver's epoch check applies to them with epoch = 0, so an
 * admin "revoke all sessions" (which bumps session_epoch) kills
 * legacy tokens too.
 */
export interface ParsedSessionToken {
  userId: string
  /** Unix seconds at which the token expires (absolute 7-day cap). */
  expires: number
  /** user_sessions row id; null for legacy tokens. */
  jti: string | null
  /** profiles.session_epoch at mint time; 0 for legacy tokens. */
  epoch: number
  /** true when the token predates the registry (no jti claim). */
  legacy: boolean
}

/** Mint a session token for a freshly authenticated user. Pass
 *  { jti, epoch } (login route, S2) to mint a v2 registry token;
 *  called without options it mints the legacy format (register). */
export async function signSessionToken(
  userId: string,
  opts: { jti?: string; epoch?: number; now?: Date } = {}
): Promise<string> {
  const now = opts.now ?? new Date()
  const expires = Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS
  const payload =
    opts.jti != null
      ? `${userId}.${expires}.${opts.jti}.${opts.epoch ?? 0}`
      : `${userId}.${expires}`
  return `${payload}.${toBase64Url(await hmac(payload))}`
}

/**
 * Parse + verify a session token (signature timing-safe, expiry
 * checked). Returns the claims, or null for anything malformed,
 * forged or expired. Payload shapes: 2 parts = legacy, 4 parts =
 * v2; anything else is rejected.
 */
export async function parseSessionToken(
  token: string | undefined,
  now: Date = new Date()
): Promise<ParsedSessionToken | null> {
  if (!token) return null
  const lastDot = token.lastIndexOf('.')
  if (lastDot <= 0) return null
  const payload = token.slice(0, lastDot)
  const parts = payload.split('.')
  if (parts.length !== 2 && parts.length !== 4) return null
  const userId = parts[0]
  const expires = Number(parts[1])
  if (!userId || !Number.isFinite(expires)) return null
  let jti: string | null = null
  let epoch = 0
  if (parts.length === 4) {
    jti = parts[2] || null
    epoch = Number(parts[3])
    if (!jti || !Number.isInteger(epoch) || epoch < 0) return null
  }
  if (expires < Math.floor(now.getTime() / 1000)) return null
  let presented: Uint8Array
  try {
    presented = fromBase64Url(token.slice(lastDot + 1))
  } catch {
    return null
  }
  const expected = await hmac(payload)
  if (presented.length !== expected.length) return null
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= presented[i] ^ expected[i]
  if (diff !== 0) return null
  return { userId, expires, jti, epoch, legacy: parts.length === 2 }
}

/**
 * Verify a session token. Returns the user id when the signature is
 * valid and the token has not expired; null otherwise. (Signature
 * unchanged for proxy.ts — registry/epoch enforcement lives in the
 * resolver, lib/server/auth.ts.)
 */
export async function verifySessionToken(token: string | undefined, now: Date = new Date()): Promise<string | null> {
  const parsed = await parseSessionToken(token, now)
  return parsed ? parsed.userId : null
}

/** Read the session cookie value out of a request's Cookie header. */
export function sessionTokenFromRequest(req: { headers: Headers }): string | undefined {
  const header = req.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return undefined
}

/** Set-Cookie header value for a session token. */
export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

/** Set-Cookie header value that clears the session. */
export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

// ---------------------------------------------------------------------------
// Purpose tokens — the same HMAC construction, scoped to one purpose
// and one subject. Used for the registration gate:
// verify-register-otp mints `reg:<email>` after a successful OTP
// check; /api/auth/register requires a valid one for the same email,
// so an account can only be created for an email whose OTP was
// actually verified server-side (the old flow trusted the client's
// word that the verify call had succeeded).
// ---------------------------------------------------------------------------

export const REG_VERIFIED_COOKIE = 'erp_reg_verified'
export const REG_VERIFIED_TTL_SECONDS = 15 * 60

export async function signPurposeToken(
  purpose: string,
  subject: string,
  ttlSeconds: number,
  now: Date = new Date()
): Promise<string> {
  const expires = Math.floor(now.getTime() / 1000) + ttlSeconds
  const payload = `${purpose}:${subject}.${expires}`
  return `${payload}.${toBase64Url(await hmac(payload))}`
}

export async function verifyPurposeToken(
  token: string | undefined,
  purpose: string,
  subject: string,
  now: Date = new Date()
): Promise<boolean> {
  if (!token) return false
  const lastDot = token.lastIndexOf('.')
  if (lastDot <= 0) return false
  const payload = token.slice(0, lastDot)
  const expectedPrefix = `${purpose}:${subject}.`
  if (!payload.startsWith(expectedPrefix)) return false
  const expires = Number(payload.slice(expectedPrefix.length))
  if (!Number.isFinite(expires)) return false
  if (expires < Math.floor(now.getTime() / 1000)) return false
  let presented: Uint8Array
  try {
    presented = fromBase64Url(token.slice(lastDot + 1))
  } catch {
    return false
  }
  const expected = await hmac(payload)
  if (presented.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= presented[i] ^ expected[i]
  return diff === 0
}

/** Read an arbitrary cookie value out of a request's Cookie header. */
export function cookieFromRequest(req: { headers: Headers }, name: string): string | undefined {
  const header = req.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return undefined
}

export function purposeCookieHeader(name: string, token: string, ttlSeconds: number): string {
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

export function clearCookieHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}
