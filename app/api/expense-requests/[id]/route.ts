import { NextResponse } from 'next/server'
import { parseMoneyAmount, roundMoney } from '@/lib/money'
import { dhakaToday } from '@/lib/dhaka-time'
import { prisma } from '@/lib/db'
import { callerIsAdmin, getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { syncExpenseToLedger } from '@/lib/server/ledger-sync'

// item actions for the dashboard
// branch-expenses page — approve / reject / pay (the action modal)
// and the full edit modal, plus delete. Gate: admin or partner
// (the page's audience). Money rule: when an edit supplies a paid
// amount, due is recomputed server-side as total − paid (the
// fix register's C20/C32 rule — the paid figure booked is the
// amount actually paid); status transitions keep the page's exact
// semantics (pay requires a TRX id, reject requires a reason —
// both validated on the page and re-validated here).

function canWrite(caller: { profile_type: string | null } & { is_admin: boolean }): boolean {
  return callerIsAdmin(caller as any) || caller.profile_type === 'partner'
}

export async function PATCH(req: Request, context: any) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canWrite(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await context.params
    const existing = await prisma.employeeExpenseRequest.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Expense request not found' }, { status: 404 })

    const body = await req.json().catch(() => ({}))

    // ── Pay flow (expense-model round, 2026-10-31) ────────────────
    // The audit gap this closes: this pay action used to settle the
    // request and book NOTHING — the money never appeared in any
    // stream. Now, mirroring the admin C32 discipline, settlement and
    // booking commit in ONE transaction, with the same double-pay
    // guard. FUNDING RULE (owner's model): only a request funded from
    // branch (sales) cash — payment_method 'cash', the model's
    // funding signal — books into branch_cash_expenses (branch
    // stream, rule b) and moves the branch ledger. A bKash/bank
    // request is settled on the request row alone: that money never
    // sat in the branch drawer, and no company-stream booking is
    // invented for it here (owner-decision item, see round report).
    if (body.action === 'pay') {
      if (!String(body.trx_id || '').trim()) {
        return NextResponse.json({ error: 'Please enter the Transaction ID.' }, { status: 400 })
      }
      const result = await prisma.$transaction(async (tx) => {
        const request = await tx.employeeExpenseRequest.findUnique({ where: { id } })
        if (!request) return { error: 'Expense request not found', status: 404 }
        if (request.status === 'paid') {
          return { error: 'This request has already been paid.', status: 400 }
        }
        const due = roundMoney(Number(request.amount || 0) - Number(request.paid_amount || 0))
        if (due <= 0) return { error: 'Nothing is due on this request.', status: 400 }

        const updated = await tx.employeeExpenseRequest.update({
          where: { id },
          data: {
            status: 'paid',
            trx_id: String(body.trx_id).trim(),
            paid_at: new Date(),
            admin_notes: body.admin_notes ? String(body.admin_notes) : null,
            // The booked payment is the amount actually paid (the
            // full requested amount for this flow); due zeroes.
            paid_amount: request.amount,
            due_amount: 0,
          },
        })

        if (request.payment_method === 'cash' && request.branch_id) {
          const expense = await tx.branchCashExpense.create({
            data: {
              branch_id: request.branch_id,
              branch_name: request.branch_name || null,
              manager_id: (caller as any).uid ?? caller.id,
              manager_name: caller.full_name,
              expense_date: new Date(`${dhakaToday()}T00:00:00.000Z`),
              category: 'general',
              description: `[Expense Request] ${request.title}`,
              amount: due,
              paid_amount: due,
              due_amount: 0,
              expense_request_id: request.id,
            },
          })
          await syncExpenseToLedger(tx, null, expense as any)
        }
        return { request: updated }
      })
      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      return NextResponse.json({ request: toPlain(result.request) })
    }

    const data: Record<string, unknown> = {}

    if (body.action === 'confirm' || body.action === 'reject') {
      // Action-modal flow (approve / reject). 'pay' is handled by the
      // transactional flow above and never reaches this block.
      if (body.action === 'confirm') {
        data.status = 'approved'
        data.admin_notes = body.admin_notes ? String(body.admin_notes) : null
      } else {
        if (!String(body.admin_notes || '').trim()) {
          return NextResponse.json({ error: 'Please provide a reason for rejection.' }, { status: 400 })
        }
        data.status = 'rejected'
        data.admin_notes = String(body.admin_notes)
      }
    } else {
      // Edit-modal flow.
      if ('title' in body) {
        const title = String(body.title || '').trim()
        if (!title) return NextResponse.json({ error: 'Title is required.' }, { status: 400 })
        data.title = title
      }
      if ('description' in body) data.description = body.description ? String(body.description).trim() || null : null

      let amount = existing.amount ? Number(existing.amount) : 0
      if ('amount' in body) {
        const parsed = parseMoneyAmount(body.amount, { min: 0 })
        if (parsed === null || parsed <= 0) {
          return NextResponse.json({ error: 'Enter a valid amount.' }, { status: 400 })
        }
        amount = parsed
        data.amount = parsed
      }
      if ('paid_amount' in body || 'amount' in body) {
        const paid = 'paid_amount' in body ? (parseMoneyAmount(body.paid_amount ?? 0, { min: 0 }) ?? 0) : (existing.paid_amount ? Number(existing.paid_amount) : 0)
        data.paid_amount = paid
        data.due_amount = Math.max(0, Math.round((amount - paid) * 100) / 100)
      }
      if ('status' in body) {
        if (!['pending', 'approved', 'rejected', 'paid'].includes(body.status)) {
          return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
        }
        data.status = body.status
        data.paid_at = body.status === 'paid' ? (existing.paid_at ?? new Date()) : null
      }
      if ('trx_id' in body) data.trx_id = body.trx_id ? String(body.trx_id).trim() || null : null
      if ('admin_notes' in body) data.admin_notes = body.admin_notes ? String(body.admin_notes).trim() || null : null
    }

    const updated = await prisma.employeeExpenseRequest.update({ where: { id }, data })
    return NextResponse.json({ request: toPlain(updated) })
  } catch (err: any) {
    console.error('[PATCH /api/expense-requests/[id]] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(req: Request, context: any) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canWrite(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await context.params
    await prisma.employeeExpenseRequest.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[DELETE /api/expense-requests/[id]] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
