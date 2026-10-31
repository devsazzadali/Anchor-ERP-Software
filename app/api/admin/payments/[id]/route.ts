import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// /api/admin/payments/[id] — admin-only payment_requests mutations
// from the payouts page.
// PATCH { status, only_from? } — set the request status. The
//   accept flow passes only_from: 'pending' (the old client update
//   filtered on status='pending' too); the hold / fraud / reject
//   flows pass no guard.
// POST { transaction_id, screenshot_url? } — complete the payout.
//   This is the app's reimplementation of the old
//   complete_payout_atomic RPC: the payment_requests update AND the
//   transactions ledger insert happen in ONE Prisma transaction
//   (the old client's non-atomic fallback path is gone — the money
//   row and its ledger entry can no longer diverge). Amount,
//   currency, method and user are read from the stored request,
//   never trusted from the client.
async function requireAdmin(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!callerIsAdmin(caller)) return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  return { caller }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error
    const { id } = await params

    const body = await req.json()
    if (!body.status) {
      return NextResponse.json({ error: 'status is required' }, { status: 400 })
    }

    const existing = await prisma.paymentRequest.findUnique({
      where: { id },
      select: { id: true, status: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Payment request not found' }, { status: 404 })
    }
    if (body.only_from && existing.status !== body.only_from) {
      return NextResponse.json(
        { error: `Request is no longer ${body.only_from}` },
        { status: 409 }
      )
    }

    const updated = await prisma.paymentRequest.update({
      where: { id },
      data: { status: body.status },
    })
    return NextResponse.json({ request: toPlain(updated) })
  } catch (err: any) {
    console.error('[PATCH /api/admin/payments/[id]] Error:', err)
    return NextResponse.json({ error: 'Failed to update payment request' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error
    const { id } = await params

    const body = await req.json()
    if (!body.transaction_id) {
      return NextResponse.json({ error: 'transaction_id is required' }, { status: 400 })
    }

    // complete_payout_atomic semantics (aligned with
    // /api/payouts/complete): the row is locked FOR UPDATE inside
    // the transaction and an already-'completed' request errors —
    // without the guard, a double completion would insert a second
    // ledger transaction for one payout.
    const updated = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM payment_requests WHERE id = ${id}::uuid FOR UPDATE
      `
      if (!locked.length) throw new Error('Payment request not found')
      if (locked[0].status === 'completed') throw new Error('Payment request is already completed')

      const existing = await tx.paymentRequest.findUnique({ where: { id } })
      if (!existing) throw new Error('Payment request not found')

      const now = new Date()
      const upd = await tx.paymentRequest.update({
        where: { id },
        data: {
          status: 'completed',
          transaction_id: body.transaction_id,
          payment_screenshot_url: body.screenshot_url ?? existing.payment_screenshot_url,
          completed_at: now,
          updated_at: now,
        },
      })
      await tx.transaction.create({
        data: {
          payment_request_id: id,
          user_id: existing.user_id,
          amount: existing.amount,
          currency: existing.currency || 'BDT',
          payment_method: existing.payment_method || 'bank_transfer',
          transaction_id: body.transaction_id,
          status: 'completed',
        },
      })
      return upd
    })

    return NextResponse.json({ request: toPlain(updated) })
  } catch (err: any) {
    const message = err?.message || 'Failed to complete payout'
    const status =
      message === 'Payment request not found' ? 404 : message === 'Payment request is already completed' ? 400 : 500
    if (status === 500) console.error('[POST /api/admin/payments/[id] complete] Error:', err)
    return NextResponse.json({ error: status === 500 ? 'Failed to complete payout' : message }, { status })
  }
}
