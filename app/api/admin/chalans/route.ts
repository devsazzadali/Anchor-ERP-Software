import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

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
    const items = Array.isArray(body.items) ? body.items : []
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
    const items = Array.isArray(body.items) ? body.items : []
    const { total_amount, total_cost } = computeTotals(items)

    const chalan = await prisma.productChalan.update({
      where: { id: body.id },
      data: {
        items: items as any,
        total_amount: total_amount as any,
        total_cost: total_cost as any,
        notes: body.notes ?? null,
      },
    })

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

    await prisma.productChalan.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[DELETE /api/admin/chalans] Error:', err)
    return NextResponse.json({ error: 'Failed to delete chalan' }, { status: 500 })
  }
}
