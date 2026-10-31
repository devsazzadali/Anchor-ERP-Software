// app/api/partner/invoice-request/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// partner gate = profile_type 'partner'
// on the session-resolved caller (BUG-R01's server-side rule,
// preserved); invoice_requests via Prisma, own rows only.

// S4 (R2 Security Round): the gate errors carry their HTTP status so
// the catch blocks stop collapsing unauthenticated (401) and
// wrong-role (403) into the catch-all 400 (FR-1 model: anonymous ->
// 401 on everything non-public). Validation errors stay 400.
function gateError(status: number, message: string) {
  const e: any = new Error(message)
  e.status = status
  return e
}

async function getPartnerUser(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) throw gateError(401, 'Unauthenticated')
  if (caller.profile_type !== 'partner') throw gateError(403, 'Forbidden: not a partner')
  return { userId: caller.id }
}

// GET: list own invoice requests for the partner
export async function GET(req: Request) {
  try {
    const { userId } = await getPartnerUser(req)
    const data = await prisma.invoiceRequest.findMany({
      where: { created_by: userId },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ invoiceRequests: toPlain(data) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 400 })
  }
}

// POST: create a new invoice request (partner only)
export async function POST(req: Request) {
  try {
    const { userId } = await getPartnerUser(req)
    const body = await req.json()
    const { title, description, amount, currency } = body
    if (!title || !amount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const created = await prisma.invoiceRequest.create({
      data: {
        created_by: userId,
        title,
        description: description ?? null,
        amount,
        currency: currency ?? 'BDT',
      },
    })
    return NextResponse.json({ invoiceRequest: toPlain(created) }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 400 })
  }
}
