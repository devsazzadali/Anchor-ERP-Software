import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// the signed-in user's own financial
// records for the dashboard home, statements, transactions and
// salaries pages. Every query is scoped to the CALLER (never a
// client-supplied user id — the old pages passed their own id from
// the browser auth session). Branches are the id/name reference
// list those pages render against.
export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [branches, paymentRequests, salaryPayments] = await Promise.all([
      prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.paymentRequest.findMany({
        where: { user_id: caller.id },
        orderBy: { created_at: 'desc' },
      }),
      prisma.salaryPayment.findMany({
        where: { employee_id: caller.id, status: { not: 'voided' } }, // FR-14.1
        orderBy: { payment_date: 'desc' },
      }),
    ])

    return NextResponse.json({
      user: { id: caller.id, email: caller.email },
      profile: { full_name: caller.full_name, profile_type: caller.profile_type },
      branches: toPlain(branches),
      paymentRequests: toPlain(paymentRequests),
      salaryPayments: toPlain(salaryPayments),
    })
  } catch (err: any) {
    console.error('[GET /api/me/financials] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
