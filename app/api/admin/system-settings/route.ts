import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit } from '@/lib/server/audit'

// admin gate via the single
// role-resolution function; settings read/written with Prisma. The
// Resend key rule is unchanged: env-only, never stored, never
// returned.

// S4 (R2 Security Round): split the gate so an unauthenticated caller
// gets 401 and an authenticated non-admin gets 403 (the FR-1 model:
// anonymous -> 401 on everything non-public). Previously both cases
// collapsed into a single 403.
async function requireAdmin(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!callerIsAdmin(caller)) {
    return { response: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  }
  return { admin: caller }
}

export async function GET(req: Request) {
  // BUG-006 FIX: Verify admin identity before exposing settings
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response
  const admin = gate.admin

  try {
    const data = await prisma.systemSetting.findMany()

    // FR-1.4: GET is a key ALLOWLIST, not a denylist. Only the
    // non-secret keys the settings page actually edits are returned
    // with values (sender_email, password_reset_mode). EVERY other
    // key — present or future, secret-bearing or not — returns
    // only a `<key>_configured` flag, so a secret inserted into
    // this table can never leak by default.
    const ALLOWED_VALUE_KEYS = new Set(['sender_email', 'password_reset_mode'])
    const settings: Record<string, string> = {}
    for (const row of data ?? []) {
      if (row.key === 'resend_api_key') continue // handled below
      if (ALLOWED_VALUE_KEYS.has(row.key)) {
        settings[row.key] = row.value
      } else {
        settings[`${row.key}_configured`] = row.value ? 'true' : 'false'
      }
    }

    // The Resend API key is a secret and is NEVER returned by this API
    // (it previously came back in full to any admin session). It lives
    // in the server environment now; the UI only needs to know whether
    // one is configured. Any legacy plaintext row is also withheld.
    settings.resend_api_key_configured = process.env.RESEND_API_KEY ? 'true' : 'false'

    return NextResponse.json({ settings })
  } catch (error: any) {
    console.error('[GET /api/admin/system-settings] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings. Please try again.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  // BUG-006 FIX: Verify admin identity before allowing settings changes
  const gate = await requireAdmin(request)
  if ('response' in gate) return gate.response
  const admin = gate.admin

  try {
    const { sender_email, password_reset_mode } = await request.json()

    // resend_api_key is deliberately NOT accepted here anymore: secrets
    // do not belong in a database settings table. Set RESEND_API_KEY in
    // the server environment instead.
    const updates: { key: string; value: string }[] = []
    if (sender_email !== undefined) updates.push({ key: 'sender_email', value: sender_email })
    if (password_reset_mode !== undefined) updates.push({ key: 'password_reset_mode', value: password_reset_mode })

    const beforeRows = updates.length
      ? await prisma.systemSetting.findMany({ where: { key: { in: updates.map((u) => u.key) } } })
      : []
    const beforeByKey = new Map(beforeRows.map((r) => [r.key, r.value]))

    for (const u of updates) {
      await prisma.systemSetting.upsert({
        where: { key: u.key },
        create: { key: u.key, value: u.value },
        update: { value: u.value },
      })
    }

    // S1: record changed KEY NAMES always; values only for the
    // non-sensitive allowlisted keys (sender_email,
    // password_reset_mode) — anything else is recorded by name with
    // redacted values (defence in depth: this route only accepts the
    // two allowlisted keys today).
    const VALUE_SAFE_KEYS = new Set(['sender_email', 'password_reset_mode'])
    await logAudit({
      caller: admin, req: request, action: 'settings.update', eventType: 'settings',
      entityTable: 'system_settings', entityId: null,
      fieldChanges: updates.map((u) => ({
        field: u.key,
        old: VALUE_SAFE_KEYS.has(u.key) ? (beforeByKey.get(u.key) ?? null) : '[redacted]',
        new: VALUE_SAFE_KEYS.has(u.key) ? u.value : '[redacted]',
      })),
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[POST /api/admin/system-settings] Error:', error)
    return NextResponse.json({ error: 'Failed to update settings. Please try again.' }, { status: 500 })
  }
}
