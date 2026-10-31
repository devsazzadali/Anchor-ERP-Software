import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { callerIsAdmin, getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { syncExpenseToLedger } from '@/lib/server/ledger-sync'
import { logAudit, diffFields } from '@/lib/server/audit'

// POST /api/admin/salary-payments/[id]/void — FR-14.1.
//
// Law E3: an issued salary payment is never edited or deleted.
// The correction path is VOID + REISSUE: voiding (this route)
//   1. marks the payment status='voided' (money readers exclude
//      voided rows — the payment stops counting everywhere),
//   2. reverses its branch-cash mirror: the mirror row is deleted
//      and the ledger is re-synced through the existing sync path
//      (syncExpenseToLedger with a null new row), and
//   3. writes an audit row (old state preserved in the payment's
//      notes marker + the activity log).
// Reissue = issue a fresh payment through the normal Issue Salary
// flow. If the mirror's ledger day is already CLOSED, the void is
// refused (409): reopen the day first (admin + reason, FR-14.7) so
// a settled day never changes silently (law E4).
export async function POST(req: Request, context: any) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })

    const { id } = await context.params
    const body = await req.json().catch(() => ({}))
    const reason = String(body.reason || '').trim()

    const payment = await prisma.salaryPayment.findUnique({ where: { id } })
    if (!payment) return NextResponse.json({ error: 'Salary payment not found' }, { status: 404 })
    if ((payment as any).status === 'voided') {
      return NextResponse.json({ error: 'This payment is already voided.' }, { status: 409 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const mirror = await tx.branchCashExpense.findFirst({ where: { salary_payment_id: id } })
      let mirrorReversed = false
      if (mirror) {
        const day = await tx.branchCashLedger.findFirst({
          where: { branch_id: mirror.branch_id, ledger_date: mirror.expense_date },
          select: { is_closed: true },
        })
        if (day?.is_closed) {
          return { error: 'The mirror expense sits on a CLOSED ledger day. Reopen that day first (a reason is recorded), then void.', status: 409 as const }
        }
        await tx.branchCashExpense.delete({ where: { id: mirror.id } })
        await syncExpenseToLedger(tx, mirror as any, null)
        mirrorReversed = true
      }

      const marker = `[VOIDED ${new Date().toISOString()} by ${caller.full_name || 'Admin'}${reason ? `: ${reason}` : ''}]`
      const updated = await tx.salaryPayment.update({
        where: { id },
        data: {
          status: 'voided',
          notes: payment.notes ? `${payment.notes} ${marker}` : marker,
        },
      })
      return { payment: updated, mirrorReversed }
    })
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    await prisma.activityLog.create({
      data: {
        user_id: caller.id,
        action: 'SALARY_PAYMENT_VOID',
        details: {
          payment_id: id,
          employee_id: payment.employee_id,
          amount: Number(payment.amount),
          reason: reason || null,
          mirror_reversed: result.mirrorReversed,
        },
      },
    }).catch((e: any) => console.error('[salary void] audit write failed:', e.message))

    await logAudit({
      caller, req, action: 'salary_payment.void', eventType: 'void',
      entityTable: 'salary_payments', entityId: id,
      branchId: (payment as any).branch_id ?? null,
      fieldChanges: [
        { field: 'status', old: (payment as any).status ?? null, new: 'voided' },
        { field: 'amount', old: Number(payment.amount), new: Number(payment.amount) },
        { field: 'reason', old: null, new: reason || null },
        { field: 'mirror_reversed', old: null, new: result.mirrorReversed },
      ],
    })

    return NextResponse.json({ payment: toPlain(result.payment), mirror_reversed: result.mirrorReversed })
  } catch (err: any) {
    console.error('[POST /api/admin/salary-payments/[id]/void] Error:', err)
    return NextResponse.json({ error: 'Failed to void salary payment' }, { status: 500 })
  }
}
