import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// /api/admin/user-details?user_id=<id> — admin-only bundle behind
// the admin users page's per-user dossier:
//   kyc              — the user's latest verification request
//                      (null when none).
//   salaries         — salary_payments for the user (employee_id),
//                      newest payment_date first.
//   branchTransfers  — branch_transfers history, newest first.
//   positionTransfers— position_transfers history, newest first.
//   payouts          — the user's COMPLETED payment_requests.
export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('user_id')
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
    }

    const [kycRows, salaries, branchTransfers, positionTransfers, payouts] = await Promise.all([
      prisma.verificationRequest.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: 1,
      }),
      prisma.salaryPayment.findMany({
        where: { employee_id: userId },
        orderBy: { payment_date: 'desc' },
      }),
      prisma.branchTransfer.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
      }),
      prisma.positionTransfer.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
      }),
      prisma.paymentRequest.findMany({
        where: { user_id: userId, status: 'completed' },
        select: {
          id: true, amount: true, transaction_id: true,
          created_at: true, completed_at: true, payment_method: true,
        },
      }),
    ])

    return NextResponse.json({
      kyc: toPlain(kycRows[0] ?? null),
      salaries: toPlain(salaries),
      branchTransfers: toPlain(branchTransfers),
      positionTransfers: toPlain(positionTransfers),
      payouts: toPlain(payouts),
    })
  } catch (err: any) {
    console.error('[GET /api/admin/user-details] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch user details' }, { status: 500 })
  }
}
