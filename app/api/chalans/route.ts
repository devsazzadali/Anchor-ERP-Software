import { NextResponse } from 'next/server'
import { roundMoney, sumMoney } from '@/lib/money'
import { prisma } from '@/lib/db'
import { callerIsAdmin, getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// product chalans for the dashboard
// branch-chalans page. Reads: any approved caller (the page is
// view-only for non-head-office users). Writes: head-office
// profiles and admins only — the page's own rule ("Head Office
// users can create and edit, but NOT delete"), enforced
// server-side. Money is recomputed server-side from the items:
// each line's total_cost / total_sale and the chalan's
// total_cost / total_amount are derived here, never trusted from
// the client. Item rows keep BOTH schemas the live data carries
// (new cost/sale fields and legacy unit_price — audit #31
// is a reader concern; rows written here use the new schema).

function canWrite(caller: { profile_type: string | null } & { is_admin: boolean }): boolean {
  return callerIsAdmin(caller as any) || caller.profile_type === 'head_office'
}

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
      // Shipping cost (per unit, bringing the product in) — additive
      // per-item field alongside cost_price/sale_price. Absent/blank =
      // not recorded: the key is omitted (old items simply lack it).
      // Display/record only — NOT folded into total_cost/total_amount.
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

export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [chalans, branches] = await Promise.all([
      prisma.productChalan.findMany({ orderBy: { created_at: 'desc' } }),
      prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])
    return NextResponse.json({ chalans: toPlain(chalans), branches: toPlain(branches) })
  } catch (err: any) {
    console.error('[GET /api/chalans] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canWrite(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const branchId = typeof body.branch_id === 'string' ? body.branch_id : null
    if (!branchId) return NextResponse.json({ error: 'No branch selected.' }, { status: 400 })
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } })
    if (!branch) return NextResponse.json({ error: 'No branch selected.' }, { status: 400 })

    const computed = computeChalanItems(body.items)
    if ('error' in computed) return NextResponse.json({ error: computed.error }, { status: 400 })

    const created = await prisma.productChalan.create({
      data: {
        branch_id: branch.id,
        branch_name: branch.name,
        chalan_ref: typeof body.chalan_ref === 'string' && body.chalan_ref ? body.chalan_ref : null,
        items: computed.items,
        total_amount: computed.totalAmount,
        total_cost: computed.totalCost,
        notes: body.notes ? String(body.notes).trim() || null : null,
        created_by: caller.id,
        created_by_name: caller.full_name,
      },
    })
    return NextResponse.json({ chalan: toPlain(created) }, { status: 201 })
  } catch (err: any) {
    console.error('[POST /api/chalans] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
