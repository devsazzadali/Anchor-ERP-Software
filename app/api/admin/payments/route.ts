import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// /api/admin/payments — admin-only bundle for the payouts page.
// C38: the page merges TWO money sources, both returned in full
// (the old client fetch paginated around the 1,000-row cap; the
// server returns every row so nothing is silently dropped):
//   paymentRequests — payment_requests with the requester profile
//     embed { full_name, role } (as `profiles`).
//   valueTransfers — salary_payments whose employee profile is a
//     partner, with the embed { full_name, role, profile_type }.
export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const [requests, profiles, transfers] = await Promise.all([
      prisma.paymentRequest.findMany({ orderBy: { created_at: 'desc' } }),
      prisma.profile.findMany({ select: { id: true, full_name: true, role: true, profile_type: true } }),
      prisma.salaryPayment.findMany({ orderBy: { payment_date: 'desc' } }),
    ])

    const profileById = new Map(profiles.map((p) => [p.id, p]))

    const paymentRequests = requests.map((r) => {
      const p = profileById.get(r.user_id)
      return { ...r, profiles: p ? { full_name: p.full_name, role: p.role } : null }
    })

    const valueTransfers = transfers
      .filter((t) => profileById.get(t.employee_id)?.profile_type === 'partner')
      .map((t) => {
        const p = profileById.get(t.employee_id)
        return {
          ...t,
          profiles: p ? { full_name: p.full_name, role: p.role, profile_type: p.profile_type } : null,
        }
      })

    return NextResponse.json({
      paymentRequests: toPlain(paymentRequests),
      valueTransfers: toPlain(valueTransfers),
    })
  } catch (err: any) {
    console.error('[GET /api/admin/payments] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
}
