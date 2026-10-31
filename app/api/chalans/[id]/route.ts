import { NextResponse } from 'next/server'
import { roundMoney, sumMoney } from '@/lib/money'
import { prisma } from '@/lib/db'
import { callerIsAdmin, getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// Same server-side totals computation as POST /api/chalans
// (duplicated here so neither route file exports non-handlers).
function computeChalanItems(rawItems: unknown): {
  items: any[]
  totalAmount: number
  totalCost: number
} | { error: string } {
  if (!Array.isArray(rawItems)) return { error: 'Add at least one product.' }
  const items = rawItems
    .filter((i: any) => i && String(i.name || '').trim())
    .map((i: any) => {
      const qty = Number(i.quantity) || 0
      const cp = roundMoney(Number(i.cost_price) || 0)
      const sp = roundMoney(Number(i.sale_price) || 0)
      // Shipping cost (per unit) — see POST /api/chalans: additive,
      // omitted when not recorded, never folded into the totals.
      const hasShip = i.shipping_cost !== undefined && i.shipping_cost !== null && String(i.shipping_cost).trim() !== ''
      const ship = hasShip ? roundMoney(Number(i.shipping_cost) || 0) : null
      return {
        ...(i.code && String(i.code).trim() ? { code: String(i.code).trim() } : {}),
        name: String(i.name).trim(),
        quantity: qty,
        cost_price: cp,
        sale_price: sp,
        ...(ship !== null ? { shipping_cost: ship, total_shipping: roundMoney(qty * ship) } : {}),
        total_cost: roundMoney(qty * cp),
        total_sale: roundMoney(qty * sp),
      }
    })
  if (items.length === 0) return { error: 'Add at least one product.' }
  const invalid = items.find((i) => i.quantity <= 0)
  if (invalid) return { error: `"${invalid.name}" must have a quantity > 0.` }
  return {
    items,
    totalAmount: sumMoney(items.map((i) => i.total_sale)),
    totalCost: sumMoney(items.map((i) => i.total_cost)),
  }
}

// chalan edit for the dashboard
// branch-chalans page — head-office / admin only (the page's
// rule), totals recomputed server-side from the submitted items.
// There is deliberately NO delete: head-office users can create
// and edit, but not delete (page spec).

function canWrite(caller: { profile_type: string | null } & { is_admin: boolean }): boolean {
  return callerIsAdmin(caller as any) || caller.profile_type === 'head_office'
}

export async function PATCH(req: Request, context: any) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canWrite(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await context.params
    const existing = await prisma.productChalan.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: 'Chalan not found' }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    const computed = computeChalanItems(body.items)
    if ('error' in computed) return NextResponse.json({ error: computed.error }, { status: 400 })

    const updated = await prisma.productChalan.update({
      where: { id },
      data: {
        items: computed.items,
        total_amount: computed.totalAmount,
        total_cost: computed.totalCost,
        notes: body.notes ? String(body.notes).trim() || null : null,
      },
    })
    return NextResponse.json({ chalan: toPlain(updated) })
  } catch (err: any) {
    console.error('[PATCH /api/chalans/[id]] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
