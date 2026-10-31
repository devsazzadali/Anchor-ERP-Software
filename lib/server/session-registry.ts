/**
 * S2/S3 (R2 Security Round) — session-registry enforcement helpers.
 *
 * The resolver (lib/server/auth.ts getCallerProfile) is THE
 * enforcement point for registry state; /api/auth/me runs the same
 * check so the proxy gate treats revoked/idle/epoch-stale sessions
 * as signed out. proxy.ts itself only verifies the HMAC (edge-safe)
 * and defers to /api/auth/me.
 *
 * Rules enforced here, per authenticated request:
 *  - EPOCH: the token's epoch claim must equal profiles.session_epoch.
 *    Applies to legacy tokens too (their epoch is 0), so an admin
 *    "revoke all" — which bumps the epoch — kills every token the
 *    user holds, registered or not.
 *  - REGISTRY (v2 tokens only): the user_sessions row named by the
 *    token's jti must exist, belong to the token's user, and not be
 *    revoked.
 *  - IDLE (v2 tokens only): now - last_seen_at must be within the
 *    role's idle window. Legacy tokens carry no registry row, so no
 *    idle check can apply to them — they live until natural expiry
 *    or an epoch bump (documented S2 transition).
 *  - TOUCH: last_seen_at is refreshed at most once per 60 s per
 *    session (throttled write, errors swallowed).
 *
 * Idle windows come from system_settings keys
 * `idle_timeout_hours_<role>` when set, else the S3 defaults:
 * admin/super_admin 2h, branch manager 8h, employee 12h, partner 8h.
 * Settings are cached in module scope for 60 s so the resolver does
 * not add a settings query to every request.
 */
import { prisma } from '@/lib/db'
import type { ParsedSessionToken } from './session'

export type IdleRole = 'admin' | 'manager' | 'employee' | 'partner'

export const IDLE_DEFAULT_HOURS: Record<IdleRole, number> = {
  admin: 2,
  manager: 8,
  employee: 12,
  partner: 8,
}

const SETTINGS_KEYS: Record<IdleRole, string> = {
  admin: 'idle_timeout_hours_admin',
  manager: 'idle_timeout_hours_manager',
  employee: 'idle_timeout_hours_employee',
  partner: 'idle_timeout_hours_partner',
}

interface SettingsCache {
  loadedAt: number
  idleHours: Record<IdleRole, number>
  requireAdmin2fa: boolean
}

let cache: SettingsCache | null = null
const CACHE_TTL_MS = 60_000

/** Module-scope 60 s-cached read of the security settings keys
 *  (idle windows + the REQUIRE_ADMIN_2FA flag). Fail-soft: any read
 *  error falls back to the defaults with the flag OFF. */
export async function getSecuritySettings(): Promise<SettingsCache> {
  const now = Date.now()
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache
  const idleHours = { ...IDLE_DEFAULT_HOURS }
  let requireAdmin2fa = false
  try {
    const rows = await prisma.systemSetting.findMany({
      where: {
        key: { in: [...Object.values(SETTINGS_KEYS), 'require_admin_2fa'] },
      },
      select: { key: true, value: true },
    })
    for (const row of rows) {
      if (row.key === 'require_admin_2fa') {
        requireAdmin2fa = row.value.trim().toLowerCase() === 'true'
        continue
      }
      const role = (Object.keys(SETTINGS_KEYS) as IdleRole[]).find(
        (r) => SETTINGS_KEYS[r] === row.key
      )
      if (role) {
        const parsed = Number(row.value)
        if (Number.isFinite(parsed) && parsed > 0) idleHours[role] = parsed
      }
    }
  } catch (err) {
    console.error('[session-registry] settings read failed (defaults used):', err)
  }
  cache = { loadedAt: now, idleHours, requireAdmin2fa }
  return cache
}

/** Test/ops hook: drop the cached settings (e.g. after a settings write). */
export function clearSecuritySettingsCache(): void {
  cache = null
}

export interface SessionFacts {
  /** profiles.session_epoch (current value from the DB row). */
  sessionEpoch: number
  isAdmin: boolean
  isPartner: boolean
  isBranchManager: boolean
}

export function idleRoleFor(facts: SessionFacts): IdleRole {
  if (facts.isAdmin) return 'admin'
  if (facts.isPartner) return 'partner'
  if (facts.isBranchManager) return 'manager'
  return 'employee'
}

/**
 * The registry check shared by the resolver and /api/auth/me.
 * Returns true when the session may proceed. Never throws.
 */
export async function checkSessionRegistry(
  userId: string,
  parsed: ParsedSessionToken,
  facts: SessionFacts,
  now: Date = new Date()
): Promise<boolean> {
  try {
    // Epoch check — applies to legacy AND v2 tokens.
    if (parsed.epoch !== facts.sessionEpoch) return false

    // Legacy token: no registry row exists; epoch + natural expiry
    // are the only controls (documented transition).
    if (!parsed.jti) return true

    const row = await prisma.userSession.findUnique({ where: { id: parsed.jti } })
    if (!row || row.user_id !== userId) return false
    if (row.revoked_at) return false

    const settings = await getSecuritySettings()
    const idleMs = settings.idleHours[idleRoleFor(facts)] * 60 * 60 * 1000
    const lastSeenMs = new Date(row.last_seen_at).getTime()
    if (now.getTime() - lastSeenMs > idleMs) return false

    // Throttled touch: refresh last_seen_at at most once per minute.
    if (now.getTime() - lastSeenMs > 60_000) {
      await prisma.userSession
        .update({ where: { id: row.id }, data: { last_seen_at: now } })
        .catch(() => {})
    }
    return true
  } catch (err) {
    console.error('[session-registry] check failed (fail-closed):', err)
    return false
  }
}
