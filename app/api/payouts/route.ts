import { NextResponse } from 'next/server'
import { parseMoneyAmount } from '@/lib/money'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// create a payout request (dashboard
// payout page). user_id is ALWAYS the caller; amount is validated
// and rounded server-side (@/lib/money). invoice_file_url stores
// the file URL returned by uploadFile (the old code stored
// the raw storage path). BUG-A3 note: the old code stored null
// when no file was uploaded to avoid broken admin links; the
// app's Prisma column is NOT NULL, so the empty string is
// stored instead — it is falsy in every admin render check, so
// no broken link appears (schema-forced deviation, flagged).
export async function POST(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const amount = parseMoneyAmount(body.amount, { min: 0 })
    if (amount === null || amount <= 0) {
      return NextResponse.json({ error: 'Payout request amount must be greater than zero.' }, { status: 400 })
    }

    const paymentMethod = ['bkash', 'nagad', 'rocket', 'bank_transfer'].includes(body.payment_method)
      ? body.payment_method
      : 'bkash'

    const created = await prisma.paymentRequest.create({
      data: {
        user_id: caller.id,
        invoice_title: String(body.invoice_title || ''),
        invoice_number: String(body.invoice_number || ''),
        description: body.description ? String(body.description) : null,
        amount,
        currency: body.currency ? String(body.currency) : 'BDT',
        invoice_file_url: body.invoice_file_url ? String(body.invoice_file_url) : '',
        payment_method: paymentMethod,
        status: 'pending',
        payment_details: body.payment_details ?? {},
      },
    })

    return NextResponse.json({ request: toPlain(created) }, { status: 201 })
  } catch (err: any) {
    console.error('[POST /api/payouts] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
