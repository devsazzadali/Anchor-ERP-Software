import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit, diffFields } from '@/lib/server/audit'
import { storeOpeningPosition } from '@/lib/server/accounting/opening'
import { confirmOpeningPosition, isOpeningConfirmRefusedError } from '@/lib/server/accounting/openingPost'
import { isPeriodBlockedError } from '@/lib/server/accounting/post'

// /api/accounts/opening — the opening position (Accounts A1).
// GET: all computed positions (latest first) with lines.
// POST {action:'recompute'}: compute + store a NEW draft from the
//   current data (previous drafts are kept).
// POST {action:'confirm', id}: the OWNER's confirmation. The mode
//   is the POSITION's provenance (stored origin), never a request
//   flag: a 'cutover' position posts the P12 opening journal entry
//   through the engine (A3) and only then flips to confirmed; a
//   'backfill' position — one summarising history already posted
//   by the A1 backfill — confirms as an ACKNOWLEDGEMENT ONLY
//   (owner OPTION 1): status flip + stamps, zero journal writes,
//   so nothing double-counts. Both modes are audited. If a posting
//   confirm cannot post (e.g. its cutover period is locked) the
//   position stays DRAFT and the route answers 409.
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
    const positions = await prisma.openingPosition.findMany({ orderBy: { created_at: 'desc' }, take: 10 })
    const lines = positions.length
      ? await prisma.openingPositionLine.findMany({
          where: { position_id: { in: positions.map((p) => p.id) } },
          orderBy: { created_at: 'asc' },
        })
      : []
    return NextResponse.json({
      positions: positions.map((p) => ({
        id: p.id,
        label: p.label,
        status: p.status,
        origin: p.origin,
        as_of: p.as_of_date.toISOString().slice(0, 10),
        computed_at: p.computed_at.toISOString(),
        confirmed_by: p.confirmed_by,
        confirmed_at: p.confirmed_at?.toISOString() ?? null,
        notes: p.notes,
        lines: lines
          .filter((l) => l.position_id === p.id)
          .map((l) => ({
            component: l.component,
            label: l.label,
            amount: l.amount.toString(),
            side: l.side,
            source_note: l.source_note,
            detail: l.detail,
          })),
      })),
    })
  } catch (err: any) {
    console.error('[accounts] opening GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')

    if (action === 'recompute') {
      const { position_id, computation } = await storeOpeningPosition(prisma as any)
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.opening_computed',
        eventType: 'create',
        entityTable: 'opening_positions',
        entityId: position_id,
        newValue: { status: 'draft', equity: computation.totals.equity } as any,
      })
      return NextResponse.json({ position_id, status: 'draft' })
    }

    if (action === 'confirm') {
      const id = String(body.id ?? '')
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      const before = await prisma.openingPosition.findUnique({ where: { id } })
      if (!before) return NextResponse.json({ error: 'Position not found' }, { status: 404 })
      if (before.status === 'confirmed') {
        return NextResponse.json({ error: 'This position is already confirmed' }, { status: 409 })
      }
      let result
      try {
        result = await confirmOpeningPosition(prisma as any, id, g.caller.id)
      } catch (err: any) {
        if (isOpeningConfirmRefusedError(err)) {
          return NextResponse.json({ error: err.message }, { status: 409 })
        }
        if (isPeriodBlockedError(err)) {
          return NextResponse.json(
            { error: `Opening entry refused: period ${err.month} is ${err.status}. Reopen it (break-glass) or re-compute the position for a later cutover.` },
            { status: 409 }
          )
        }
        throw err
      }
      const updated = await prisma.openingPosition.findUnique({ where: { id } })
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.opening_confirmed',
        eventType: 'approve',
        entityTable: 'opening_positions',
        entityId: id,
        fieldChanges: diffFields(before as any, updated as any, ['status']),
        newValue: {
          mode: result.mode,
          opening_entry_id: result.entry_id,
          entry_created: result.entry_created,
        } as any,
      })
      return NextResponse.json({
        position: { id, status: 'confirmed' },
        mode: result.mode,
        opening_entry: result.entry_id
          ? { entry_id: result.entry_id, created: result.entry_created }
          : null,
      })
    }

    return NextResponse.json({ error: "action must be 'recompute' or 'confirm'" }, { status: 400 })
  } catch (err: any) {
    console.error('[accounts] opening POST failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
