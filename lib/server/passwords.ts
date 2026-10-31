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
