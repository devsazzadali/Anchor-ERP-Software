/**
 * Password carry-over.
 *
 * The legacy auth store kept bcrypt hashes in its users table.
 * Those hashes are imported VERBATIM into auth_users.legacy_bcrypt_hash
 * at load time (identical user ids, §3A), so every existing password
 * keeps working. The app's native scheme is bcryptjs (cost 12)
 * stored in auth_users.password_hash.
 *
 * Verify order:
 *  1. password_hash (native) — bcrypt compare.
 *  2. legacy_bcrypt_hash — bcrypt compare; on success the caller
 *     transparently rehashes: password_hash := bcrypt(plain, 12),
 *     legacy_bcrypt_hash := NULL. The user never notices; the legacy
 *     hash disappears account by account.
 *
 * bcryptjs verifies $2a$/$2b$ hashes (the format the legacy store writes); a $2y$
 * prefix is normalised to $2a$ (same algorithm, different label).
 */
import bcrypt from 'bcryptjs'

const NATIVE_COST = 12

function normalise(hash: string): string {
  return hash.startsWith('$2y$') ? '$2a$' + hash.slice(4) : hash
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, NATIVE_COST)
}

export interface PasswordCheck {
  ok: boolean
  /** true when the match was against the legacy hash and the caller
   *  should persist a transparent rehash. */
  usedLegacy: boolean
}

export async function verifyPassword(
  plain: string,
  user: { password_hash: string | null; legacy_bcrypt_hash: string | null }
): Promise<PasswordCheck> {
  if (user.password_hash) {
    const ok = await bcrypt.compare(plain, normalise(user.password_hash))
    return { ok, usedLegacy: false }
  }
  if (user.legacy_bcrypt_hash) {
    const ok = await bcrypt.compare(plain, normalise(user.legacy_bcrypt_hash))
    return { ok, usedLegacy: ok }
  }
  return { ok: false, usedLegacy: false }
}

/** Persist the transparent rehash after a legacy-hash login. */
export async function rehashData(plain: string): Promise<{
  password_hash: string
  legacy_bcrypt_hash: null
}> {
  return { password_hash: await hashPassword(plain), legacy_bcrypt_hash: null }
}

// ---------------------------------------------------------------------------
// S3 (R2 Security Round) — password policy for NEW passwords.
//
// Enforced ONLY at set paths (register, complete-reset,
// change-password, admin-set). Existing passwords are NEVER checked
// against it — login does not call this, so nobody with an old weak
// password is locked out; the policy bites the next time they set one.
// ---------------------------------------------------------------------------

/** Common / trivially-guessed passwords (matched case-insensitively,
 *  exact match after trim). Includes the obvious local ones. */
export const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '1234567890',
  '12345678', '123456789', 'qwerty123', 'qwertyuiop', '1111111111',
  'iloveyou', 'admin12345', 'administrator', 'letmein123', 'welcome123',
  'changeme123', 'abc1234567', '12345abcde', 'p@ssw0rd123', 'secret1234',
  'anchor123', 'anchor1234', 'anchorerp', 'anchorerp1', 'anchor2024',
  'anchor2025', 'anchor2026', 'fashion123', 'rangpur123', 'bangladesh',
  'dhaka12345', 'sazzad1234', 'teamkhata1', 'silixen123',
])

export interface PasswordPolicyResult {
  ok: boolean
  /** Clear, user-presentable reason when ok is false. */
  error: string | null
}

/**
 * Policy: minimum 10 characters; characters from at least 2 of
 * {lowercase, uppercase, digit, symbol}; not on the common-password
 * blocklist.
 */
export function validatePasswordPolicy(plain: string): PasswordPolicyResult {
  const pw = String(plain ?? '')
  if (pw.length < 10) {
    return { ok: false, error: 'Password must be at least 10 characters long.' }
  }
  if (COMMON_PASSWORDS.has(pw.trim().toLowerCase())) {
    return { ok: false, error: 'This password is too common. Please choose a less predictable password.' }
  }
  let classes = 0
  if (/[a-z]/.test(pw)) classes++
  if (/[A-Z]/.test(pw)) classes++
  if (/[0-9]/.test(pw)) classes++
  if (/[^A-Za-z0-9]/.test(pw)) classes++
  if (classes < 2) {
    return {
      ok: false,
      error: 'Password must mix at least two kinds of characters (lowercase, uppercase, numbers, symbols).',
    }
  }
  return { ok: true, error: null }
}
