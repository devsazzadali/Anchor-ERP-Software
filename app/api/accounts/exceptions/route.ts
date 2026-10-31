import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit, diffFields } from '@/lib/server/audit'
import {
  listInbox,
  acknowledgeException,
  resolveException,
  InboxError,
} from '@/lib/server/accounting/inbox'

// /api/accounts/exceptions — the A9 Exceptions Inbox.
// GET: the unified item list (stored posting exceptions with
//   their workflow state + derived signals computed live from the
//   owning modules) and the counts. `?count=1` returns counts
//   only (the sidebar badge + overview card).
// POST actions (admin-only, every mutation S1-audited):
//   {action:'acknowledge', id}         — open → acknowledged
//   {action:'resolve', id, note}       — open|acknowledged →
//     resolved; the note is mandatory, resolving never deletes
//     the row and never posts anything.
// Derived items accept no actions — they clear when the source
// record is fixed (their ids are not posting_exceptions rows, so
// an action against one 404s by construction).
export const dynamic = 'force-dynamic'

async function gate(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!callerIsAdmin(caller)) {
    return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  }
  return { caller }
}

export async function GET(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const db = prisma as any
    const { searchParams } = new URL(req.url)
    const { items, counts } = await listInbox(db)
    if (searchParams.get('count') === '1') {
      return NextResponse.json({ counts })
    }
    return NextResponse.json({ items, counts })
  } catch (err: any) {
    console.error('[accounts] exceptions GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    const id = String(body.id ?? '')
    const db = prisma as any
    const callerId = (g.caller as any)?.id ?? null

    if (action === 'acknowledge') {
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      const { before, after } = await acknowledgeException(db, id, callerId)
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.exception_acknowledged',
        eventType: 'update',
        entityTable: 'posting_exceptions',
        entityId: id,
        fieldChanges: diffFields(before, after, ['status', 'acknowledged_by']),
        newValue: { status: after.status, acknowledged_at: after.acknowledged_at?.toISOString() ?? null } as any,
      })
      return NextResponse.json({ ok: true, exception: after })
    }

    if (action === 'resolve') {
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      const { before, after } = await resolveException(db, id, callerId, body.note)
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.exception_resolved',
        eventType: 'update',
        entityTable: 'posting_exceptions',
        entityId: id,
        fieldChanges: diffFields(before, after, ['status', 'resolved_by', 'resolution_note']),
        newValue: {
          status: after.status,
          resolved_at: after.resolved_at?.toISOString() ?? null,
          resolution_note: after.resolution_note,
        } as any,
      })
      return NextResponse.json({ ok: true, exception: after })
    }

    return NextResponse.json({ error: `unknown action: ${action || '(none)'}` }, { status: 400 })
  } catch (err: any) {
    if (err instanceof InboxError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[accounts] exceptions POST failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
