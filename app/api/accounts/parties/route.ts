import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit, diffFields } from '@/lib/server/audit'
import {
  listParties,
  updateParty,
  setPartyActive,
  deleteParty,
  syncCounterparties,
  PayableError,
} from '@/lib/server/accounting/payables'

// /api/accounts/parties — the counterparty register (A5).
// Counterparties are DERIVED from existing records (employees,
// landlords, partners, …) by syncCounterparties; admins maintain
// display name/contact here and deactivate. A counterparty that
// carries register items or journal lines cannot be deleted
// (409) — history is never deleted. Admin-only; mutations are
// S1-audited.
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
    const parties = await listParties(prisma as any)
    return NextResponse.json({ parties })
  } catch (err: any) {
    console.error('[accounts] parties GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    const db = prisma as any

    if (action === 'sync') {
      const result = await syncCounterparties(db)
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.parties_synced',
        eventType: 'settings',
        entityTable: 'counterparties',
        entityId: null,
        newValue: result as any,
      })
      return NextResponse.json({ result })
    }

    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    if (action === 'update') {
      const { before, after } = await updateParty(db, id, {
        name: body.name,
        phone: body.phone,
        address: body.address,
      })
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.party_updated',
        eventType: 'update',
        entityTable: 'counterparties',
        entityId: id,
        fieldChanges: diffFields(before as any, after as any, ['name', 'phone', 'address']),
      })
      return NextResponse.json({ party: after })
    }

    if (action === 'set_active') {
      const { before, after } = await setPartyActive(db, id, !!body.is_active)
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.party_active_changed',
        eventType: 'update',
        entityTable: 'counterparties',
        entityId: id,
        fieldChanges: diffFields(before as any, after as any, ['is_active']),
      })
      return NextResponse.json({ party: after })
    }

    if (action === 'delete') {
      await deleteParty(db, id)
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.party_deleted',
        eventType: 'delete',
        entityTable: 'counterparties',
        entityId: id,
      })
      return NextResponse.json({ deleted: true })
    }

    return NextResponse.json(
      { error: "action must be 'sync', 'update', 'set_active' or 'delete'" },
      { status: 400 }
    )
  } catch (err: any) {
    if (err instanceof PayableError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[accounts] parties POST failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
