import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit } from '@/lib/server/audit'
import {
  listRegister,
  registerTieOut,
  ageingReport,
  paidViaOptions,
  listSettlements,
  settlePayable,
  syncPayablesRegister,
  CLASS_META,
  PayableError,
} from '@/lib/server/accounting/payables'

// /api/accounts/payables — the payables/receivables register,
// ageing and settlements (A5). The register MIRRORS obligations
// the source modules already record (sync = re-derivation, never
// re-entry). Settlements:
//   - company expenses post through the A1 engine (Dr Accounts
//     Payable / Cr the paid-via account) and update the source
//     row's paid/due — one money path, shared with the module's
//     own hookCompanyPaidChange via the settlement registry;
//   - every other class is external-only (mandatory note, no
//     journal entry) because its source module owns the pay path.
// Admin-only; mutations are S1-audited.
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
    const url = new URL(req.url)
    const itemId = url.searchParams.get('settlements_for')
    if (itemId) {
      return NextResponse.json({ settlements: await listSettlements(db, itemId) })
    }
    const [items, tie_out, ageing, paid_via] = await Promise.all([
      listRegister(db),
      registerTieOut(db),
      ageingReport(db),
      paidViaOptions(db),
    ])
    return NextResponse.json({ items, tie_out, ageing, paid_via, class_meta: CLASS_META })
  } catch (err: any) {
    console.error('[accounts] payables GET failed:', err?.message || err)
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
      const result = await syncPayablesRegister(db)
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.payables_synced',
        eventType: 'settings',
        entityTable: 'payables_receivables',
        entityId: null,
        newValue: result as any,
      })
      return NextResponse.json({ result })
    }

    if (action === 'settle') {
      const itemId = String(body.item_id ?? '')
      if (!itemId) return NextResponse.json({ error: 'item_id is required' }, { status: 400 })
      const before = await db.payableReceivable.findUnique({ where: { id: itemId } })
      if (!before) return NextResponse.json({ error: 'Register item not found' }, { status: 404 })
      const res = await settlePayable(db, {
        item_id: itemId,
        amount: body.amount,
        paid_via: body.paid_via ?? null,
        settlement_date: body.settlement_date ?? null,
        note: body.note ?? null,
        created_by: g.caller.id ?? null,
      })
      await logAudit({
        caller: g.caller,
        req,
        action: res.mode === 'journal' ? 'accounts.payable_settled' : 'accounts.payable_settled_external',
        eventType: 'create',
        entityTable: 'payable_settlements',
        entityId: res.settlement_id,
        branchId: before.branch_id ?? null,
        newValue: {
          payable_id: itemId,
          source_table: before.source_table,
          source_id: before.source_id,
          amount: String(body.amount ?? ''),
          mode: res.mode,
          journal_entry_id: res.journal_entry_id,
        } as any,
      })
      return NextResponse.json({
        settlement_id: res.settlement_id,
        journal_entry_id: res.journal_entry_id,
        mode: res.mode,
        settlements: await listSettlements(db, itemId),
      })
    }

    return NextResponse.json({ error: "action must be 'sync' or 'settle'" }, { status: 400 })
  } catch (err: any) {
    if (err instanceof PayableError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[accounts] payables POST failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
