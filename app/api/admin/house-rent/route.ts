import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { dhakaToday } from '@/lib/dhaka-time'

export const dynamic = 'force-dynamic'

// the house-rent page's payment-status
// source — the current DHAKA month's branch_cash_expenses rent rows
// (rent_month / rent_year stamped at issue time by the rent modal,
// C7). The page aggregates ALL rows per branch itself (C1: a
// branch-month can have several part-payment rows). Accounts and
// account creation live in /api/admin/branch-settings
// (kind=house_rent_accounts); rent ISSUE goes through
// /api/branch-accounts/expenses, as in the fixed copy.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// GET /api/admin/house-rent — rent payment rows:
//   (default)          — the current Dhaka month's rows (the
//                        house-rent page's status source).
//   ?branch_id=<uuid>  — ALL rent rows of one branch, any month
//                        (the Issue House Rent modal's past-payment
//                        history for its C5/C6 status checks).
// Rows: [{ branch_id, amount, paid_amount, due_amount, rent_month,
//    rent_year, description }]
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const branchId = searchParams.get('branch_id')

    let where: any
    if (branchId) {
      where = { branch_id: branchId, NOT: { rent_month: null } }
    } else {
      // C3: "current month" is the DHAKA month.
      const [dYear, dMonth] = dhakaToday().split('-').map(Number)
      where = { rent_month: MONTH_NAMES[dMonth - 1], rent_year: dYear, NOT: { rent_month: null } }
    }

    // Complete fetch (C38) — Prisma has no 1,000-row cap.
    const payments = await prisma.branchCashExpense.findMany({
      where,
      select: {
        branch_id: true, amount: true, paid_amount: true, due_amount: true,
        rent_month: true, rent_year: true, description: true,
      },
      orderBy: { id: 'asc' },
    })
    return NextResponse.json({ payments: toPlain(payments) || [] })
  } catch (err: any) {
    console.error('[api] app/api/admin/house-rent/route.ts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
