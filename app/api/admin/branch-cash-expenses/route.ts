import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// /api/admin/branch-cash-expenses — admin-only creation of
// branch_cash_expenses rows. Used by the admin users page's
// add-salary flow, which mirrors each employee salary payment
// into the branch cash ledger. manager_id is always the caller
// (server-side), never taken from the client.
export async function POST(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const body = await req.json()
    const amount = Number(body.amount)
    if (!body.branch_id || !Number.isFinite(amount)) {
      return NextResponse.json({ error: 'branch_id and a valid amount are required' }, { status: 400 })
    }

    const expense = await prisma.branchCashExpense.create({
      data: {
        branch_id: body.branch_id,
        ledger_head_id: body.ledger_head_id ?? null,
        amount: amount as any,
        expense_date: body.expense_date ? new Date(body.expense_date) : new Date(),
        description: body.description || '',
        manager_id: caller.id,
        category: body.category || 'other',
        salary_payment_id: body.salary_payment_id ?? null,
      },
    })

    return NextResponse.json({ expense: toPlain(expense) })
  } catch (err: any) {
    console.error('[POST /api/admin/branch-cash-expenses] Error:', err)
    return NextResponse.json({ error: 'Failed to record branch cash expense' }, { status: 500 })
  }
}
