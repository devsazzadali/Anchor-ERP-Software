import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// /api/admin/master-ledger — admin-only combined money feed for
// the admin users page's master ledger: every salary_payment plus
// every COMPLETED payment_request, each with the profile embed
// { full_name, profile_type } (as `profiles`) the page formats.
// The old client capped each source at 5,000 rows; the server
// returns all rows.
export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const [salaries, payouts, profiles] = await Promise.all([
      prisma.salaryPayment.findMany({ where: { status: { not: 'voided' } }, // FR-14.1
        select: {
          id: true, amount: true, payment_date: true, transaction_id: true,
          payment_proof_url: true, notes: true, base_salary_at_time: true,
          account: true, employee_id: true,
        },
        orderBy: { payment_date: 'desc' },
      }),
      prisma.paymentRequest.findMany({
        where: { status: 'completed' },
        select: {
          id: true, amount: true, created_at: true, completed_at: true,
          transaction_id: true, payment_method: true, user_id: true,
        },
        orderBy: { created_at: 'desc' },
      }),
      prisma.profile.findMany({ select: { id: true, full_name: true, profile_type: true } }),
    ])

    const profileById = new Map(profiles.map((p) => [p.id, p]))
    const embed = (id: string) => {
      const p = profileById.get(id)
      return p ? { full_name: p.full_name, profile_type: p.profile_type } : null
    }

    return NextResponse.json({
      salaryPayments: toPlain(salaries.map((s) => ({ ...s, profiles: embed(s.employee_id) }))),
      payouts: toPlain(payouts.map((p) => ({ ...p, profiles: embed(p.user_id) }))),
    })
  } catch (err: any) {
    console.error('[GET /api/admin/master-ledger] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch master ledger' }, { status: 500 })
  }
}
