/**
 * S1 — Unified audit log writer (lib/server/audit.ts).
 *
 * THE shared helper for the unified `audit_logs` stream (the dormant
 * AuditLog model, activated in Security Round R2/S1). Every non-auth
 * write route records its mutations here; the NEXT writer adds the
 * auth events (login/logout/password/2FA) with the same helper.
 *
 * Usage from a route handler:
 *
 *   import { logAudit, diffFields, requestMeta } from '@/lib/server/audit'
 *
 *   const before = await prisma.profile.findUnique({ where: { id } })
 *   const updated = await prisma.profile.update({ ... })
 *   await logAudit({
 *     caller,                       // CallerProfile from getCallerProfile()
 *     req,                          // the Request (for IP / user-agent)
 *     action: 'user.update',        // dotted, specific action label
 *     eventType: 'update',          // one of AUDIT_EVENT_TYPES
 *     entityTable: 'profiles',
 *     entityId: id,
 *     branchId: updated.branch_id,  // optional
 *     fieldChanges: diffFields(before, updated, ['role', 'phone_number']),
 *   })
 *
 * For system events (no caller) pass `caller: null` and explicit
 * actorId/actorName/actorRole (all nullable).
 *
 * Guarantees:
 *  - FAIL-SOFT: logAudit NEVER throws into the request path. Any
 *    failure is console.error'd and swallowed — auditing must never
 *    break a money or user operation.
 *  - Secrets are never written: field names on the denylist render
 *    as '[redacted]' in field_changes AND in the mirrored
 *    old_value/new_value snapshots.
 *  - Legacy columns are mirrored so older readers keep working:
 *    table_name := entity_table, record_id := entity_id when it
 *    parses as a UUID (else null), old_value/new_value := compact
 *    objects built from field_changes (unless explicit snapshots
 *    are passed in).
 */
import { prisma } from '@/lib/db'
import type { CallerProfile } from './auth'

/**
 * Event taxonomy — `event_type` is the coarse class the audit viewer
 * filters on; `action` is the specific dotted label
 * (e.g. event_type='approve', action='deposit.approve').
 *
 *  auth          login/logout/2FA/session events (next writer)
 *  create        a record was created
 *  update        a record was edited (field_changes carries old→new)
 *  delete        a record was deleted
 *  approve       an approval decision (KYC, deposit, request, …)
 *  reject        a rejection decision
 *  reverse       a reversal (deposit reverse)
 *  void          a void (salary payment void)
 *  export        a server-side export (CSV/Excel) was produced
 *  download      a stored file was downloaded via /api/files
 *  settings      a system/branch settings change
 *  role_change   a user's role/profile_type/verification changed
 *  verification  a KYC submission or verification-status event
 *  session       session lifecycle events (next writer)
 */
export const AUDIT_EVENT_TYPES = [
  'auth',
  'create',
  'update',
  'delete',
  'approve',
  'reject',
  'reverse',
  'void',
  'export',
  'download',
  'settings',
  'role_change',
  'verification',
  'session',
] as const
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number]

/** Field names whose VALUES must never be written to the audit log. */
export const AUDIT_REDACT_FIELDS = new Set([
  'password',
  'password_hash',
  'legacy_bcrypt_hash',
  'security_answer',
  'token',
  'secret',
  'face_descriptor',
])

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export interface FieldChange {
  field: string
  old: unknown
  new: unknown
}

function isDecimalLike(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function' &&
    typeof (value as { toFixed?: unknown }).toFixed === 'function' &&
    's' in value &&
    'e' in value &&
    'd' in value
  )
}

/**
 * Normalise a value for audit storage/comparison: Date → ISO string,
 * Prisma Decimal → string, null stays null, objects → JSON string
 * truncated at ~500 chars, long strings truncated at ~500 chars.
 * Denylisted fields render as '[redacted]'.
 */
export function normalizeAuditValue(field: string, value: unknown): unknown {
  if (AUDIT_REDACT_FIELDS.has(field)) return '[redacted]'
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (isDecimalLike(value)) return String(value)
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'object') {
    const s = JSON.stringify(value)
    return s.length > 500 ? `${s.slice(0, 500)}…` : s
  }
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value
  }
  return value
}

/**
 * diffFields(before, after, fields) → [{field, old, new}] for the
 * fields whose normalised values actually changed. Pass plain row
 * objects (Prisma rows are fine — Decimals/Dates are normalised).
 */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields: readonly string[]
): FieldChange[] {
  const out: FieldChange[] = []
  for (const field of fields) {
    const oldV = normalizeAuditValue(field, before?.[field])
    const newV = normalizeAuditValue(field, after?.[field])
    if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
      out.push({ field, old: oldV, new: newV })
    }
  }
  return out
}

/** Extract { ip, userAgent } from request headers (x-forwarded-for
 *  first entry, fallback x-real-ip — the branch-trail convention). */
export function requestMeta(req: {
  headers: Headers | { get(name: string): string | null }
}): { ip: string | null; userAgent: string | null } {
  try {
    const fwd = req.headers.get('x-forwarded-for')
    const first = fwd ? fwd.split(',')[0]?.trim() : null
    const ip = first || req.headers.get('x-real-ip') || null
    return { ip, userAgent: req.headers.get('user-agent') || null }
  } catch {
    return { ip: null, userAgent: null }
  }
}

export interface LogAuditEntry {
  /** CallerProfile from getCallerProfile(); null for system events. */
  caller?: CallerProfile | null
  actorId?: string | null
  actorName?: string | null
  actorRole?: string | null
  /** Specific dotted action label, e.g. 'user.update'. */
  action: string
  eventType: AuditEventType | string
  entityTable: string
  entityId?: string | null
  branchId?: string | null
  fieldChanges?: FieldChange[] | null
  /** Explicit snapshots; when omitted they are built from fieldChanges. */
  oldValue?: Record<string, unknown> | null
  newValue?: Record<string, unknown> | null
  ip?: string | null
  userAgent?: string | null
  /** Pass the request to auto-fill ip/userAgent via requestMeta(). */
  req?: { headers: Headers | { get(name: string): string | null } }
}

function compactFromChanges(
  changes: FieldChange[],
  side: 'old' | 'new'
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const c of changes) out[c.field] = side === 'old' ? c.old : c.new
  return out
}

/**
 * Write one unified audit row. Fail-soft: never throws.
 * Returns true when the row was written, false otherwise.
 */
export async function logAudit(entry: LogAuditEntry): Promise<boolean> {
  try {
    const meta = entry.req ? requestMeta(entry.req) : { ip: null, userAgent: null }
    const changes = entry.fieldChanges ?? null
    const oldValue =
      entry.oldValue ??
      (changes && changes.length ? compactFromChanges(changes, 'old') : null)
    const newValue =
      entry.newValue ??
      (changes && changes.length ? compactFromChanges(changes, 'new') : null)

    const actorId = entry.caller?.id ?? entry.actorId ?? null
    await prisma.auditLog.create({
      data: {
        actor_id: isUuid(actorId) ? actorId : null,
        actor_name: entry.caller?.full_name ?? entry.actorName ?? null,
        actor_role: entry.caller?.role ?? entry.actorRole ?? null,
        action: entry.action,
        event_type: entry.eventType,
        table_name: entry.entityTable,
        entity_table: entry.entityTable,
        entity_id: entry.entityId ?? null,
        record_id: isUuid(entry.entityId) ? entry.entityId : null,
        branch_id: isUuid(entry.branchId) ? entry.branchId : null,
        field_changes: (changes ?? null) as any,
        old_value: (oldValue ?? null) as any,
        new_value: (newValue ?? null) as any,
        ip_address: entry.ip ?? meta.ip,
        user_agent: entry.userAgent ?? meta.userAgent,
      },
    })
    return true
  } catch (err: any) {
    console.error('[audit] logAudit failed (fail-soft):', err?.message || err)
    return false
  }
}
