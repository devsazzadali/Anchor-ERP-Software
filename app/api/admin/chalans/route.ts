import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { logAudit, diffFields } from '@/lib/server/audit'
import { hookPostSource, hookResyncSource, hookReverseSource } from '@/lib/server/accounting/hooks'

// /api/admin/chalans — admin-only product_chalans management for the
// admin branch-chalans page.
// GET: all chalans, newest first.
// POST: create — totals are RECOMPUTED server-side from the items
// (qty × cost/sale per line); the client-sent totals are not trusted.
// PATCH { id, items, notes }: edit — totals recomputed the same way.
// DELETE { id }: delete.
async function requireAdmin(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!callerIsAdmin(caller)) return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  return { caller }
}

// Shipping cost is a per-item JSON field (shipping_cost, per unit —
// alongside cost_price/sale_price). Items are stored verbatim, except
// that total_shipping (= qty × shipping_cost) is derived here when a
// shipping_cost was recorded, mirroring total_cost/total_sale. Items
// without shipping_cost pass through byte-identical. Shipping is
// display/record only: computeTotals below is unchanged, so it is NOT
// folded into total_cost/total_amount.
function withShippingTotals(items: any[]): any[] {
  return (items || []).map((i: any) => {
    if (!i || i.shipping_cost === undefined || i.shipping_cost === null || String(i.shipping_cost).trim() === '') return i
    const ship = Number(i.shipping_cost) || 0
    return { ...i, shipping_cost: ship, total_shipping: (Number(i.quantity) || 0) * ship }
  })
}

function computeTotals(items: any[]): { total_amount: number; total_cost: number } {
  let total_amount = 0
  let total_cost = 0
  for (const i of items || []) {
    const qty = Number(i.quantity) || 0
    total_cost += qty * (Number(i.cost_price) || 0)
    total_amount += qty * (Number(i.sale_price) || 0)
  }
  return { total_amount, total_cost }
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const chalans = await prisma.productChalan.findMany({ orderBy: { created_at: 'desc' } })
    return NextResponse.json({ chalans: toPlain(chalans) })
  } catch (err: any) {
    console.error('[GET /api/admin/chalans] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch chalans' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const body = await req.json()
    const items = withShippingTotals(Array.isArray(body.items) ? body.items : [])
    const { total_amount, total_cost } = computeTotals(items)

    const chalan = await prisma.productChalan.create({
      data: {
        branch_id: body.branch_id ?? null,
        branch_name: body.branch_name,
        chalan_ref: body.chalan_ref ?? null,
        items: items as any,
        total_amount: total_amount as any,
        total_cost: total_cost as any,
        notes: body.notes ?? null,
        created_by: gate.caller.id,
        created_by_name: body.created_by_name ?? gate.caller.full_name,
      },
    })

    await logAudit({
      caller: gate.caller, req, action: 'chalan.create', eventType: 'create',
      entityTable: 'product_chalans', entityId: chalan.id, branchId: chalan.branch_id ?? null,
      fieldChanges: diffFields(null, chalan as any, ['branch_name', 'chalan_ref', 'total_amount', 'total_cost']),
    })
    // Accounts A1 (P8): a costed chalan posts its inventory
    // transfer (uncosted chalans post nothing — flagged). Fail-soft.
    await hookPostSource('product_chalans', chalan.id, gate.caller, 'chalan')
    return NextResponse.json({ chalan: toPlain(chalan) })
  } catch (err: any) {
    console.error('[POST /api/admin/chalans] Error:', err)
    return NextResponse.json({ error: 'Failed to create chalan' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const body = await req.json()
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    const items = withShippingTotals(Array.isArray(body.items) ? body.items : [])
    const { total_amount, total_cost } = computeTotals(items)

    const before = await prisma.productChalan.findUnique({ where: { id: body.id } }).catch(() => null)
    const chalan = await prisma.productChalan.update({
      where: { id: body.id },
      data: {
        items: items as any,
        total_amount: total_amount as any,
        total_cost: total_cost as any,
        notes: body.notes ?? null,
      },
    })
    await logAudit({
      caller: gate.caller, req, action: 'chalan.update', eventType: 'update',
      entityTable: 'product_chalans', entityId: body.id, branchId: chalan.branch_id ?? null,
      fieldChanges: diffFields(before as any, chalan as any, ['total_amount', 'total_cost', 'notes']),
    })

    // Accounts A1 (P8): cost edits re-sync the journal entry.
    await hookResyncSource('product_chalans', body.id, gate.caller)

    return NextResponse.json({ chalan: toPlain(chalan) })
  } catch (err: any) {
    console.error('[PATCH /api/admin/chalans] Error:', err)
    return NextResponse.json({ error: 'Failed to update chalan' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const before = await prisma.productChalan.findUnique({ where: { id } }).catch(() => null)
    await prisma.productChalan.delete({ where: { id } })
    await logAudit({
      caller: gate.caller, req, action: 'chalan.delete', eventType: 'delete',
      entityTable: 'product_chalans', entityId: id, branchId: (before as any)?.branch_id ?? null,
      oldValue: before ? { branch_name: before.branch_name, total_amount: Number(before.total_amount) } as any : null,
    })
    // Accounts A1: deleting a posted chalan reverses its entry.
    await hookReverseSource('product_chalans', id, gate.caller, 'Chalan deleted')
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[DELETE /api/admin/chalans] Error:', err)
    return NextResponse.json({ error: 'Failed to delete chalan' }, { status: 500 })
  }
}
