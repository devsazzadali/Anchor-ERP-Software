import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { callerIsAdmin, getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// POST /api/payouts/complete replaces
// the old system's ONLY rpc, complete_payout_atomic (definition
// in the legacy payout-fix SQL — the fixed copy).
// Same steps, atomically, in ONE prisma.$transaction:
//   1. admin caller required (the SQL's is_admin() check);
//   2. the payment_requests row is locked and its status checked —
//      a missing row errors, an already-'completed' row errors;
//   3. the request is marked completed with the transaction id,
//      the screenshot URL (COALESCE — the stored one survives when
//      none is supplied) and completed_at/updated_at = now;
//   4. the transactions ledger row is inserted.
// Ledger values (user_id, amount, currency) are taken from the
// STORED request — money is never trusted from the client; the
// body supplies request_id, transaction_id, payment_screenshot_url
// and (optionally) payment_method, exactly the parameters the old
// rpc received from the admin payments page.
export async function POST(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const requestId = typeof body.request_id === 'string' ? body.request_id : null
    const transactionId = typeof body.transaction_id === 'string' ? body.transaction_id : null
    if (!requestId || !transactionId) {
      return NextResponse.json({ error: 'request_id and transaction_id are required' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      // Row lock (FOR UPDATE equivalent): serialise completions of
      // the same request inside this transaction.
      const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM payment_requests WHERE id = ${requestId}::uuid FOR UPDATE
      `
      if (!locked.length) throw new Error('Payment request not found')
      if (locked[0].status === 'completed') throw new Error('Payment request is already completed')

      const request = await tx.paymentRequest.findUnique({ where: { id: requestId } })
      if (!request) throw new Error('Payment request not found')

      const now = new Date()
      const updated = await tx.paymentRequest.update({
        where: { id: requestId },
        data: {
          status: 'completed',
          transaction_id: transactionId,
          payment_screenshot_url:
            typeof body.payment_screenshot_url === 'string' && body.payment_screenshot_url
              ? body.payment_screenshot_url
              : request.payment_screenshot_url,
          completed_at: now,
          updated_at: now,
        },
      })

      const transaction = await tx.transaction.create({
        data: {
          payment_request_id: requestId,
          user_id: request.user_id,
          amount: request.amount,
          currency: request.currency || 'BDT',
          payment_method:
            typeof body.payment_method === 'string' && body.payment_method
              ? body.payment_method
              : request.payment_method,
          transaction_id: transactionId,
        },
      })

      return { request: updated, transaction }
    })

    return NextResponse.json({ request: toPlain(result.request), transaction: toPlain(result.transaction) })
  } catch (err: any) {
    const message = err?.message || 'Internal Server Error'
    const status =
      message === 'Payment request not found' ? 404 : message === 'Payment request is already completed' ? 400 : 500
    if (status === 500) console.error('[POST /api/payouts/complete] Error:', err)
    return NextResponse.json({ error: message }, { status })
  }
}
