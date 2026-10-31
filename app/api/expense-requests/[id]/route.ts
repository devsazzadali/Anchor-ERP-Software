import { NextResponse } from 'next/server'
import { parseMoneyAmount } from '@/lib/money'
import { prisma } from '@/lib/db'
import { callerIsAdmin, getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

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
    const data: Record<string, unknown> = {}

    if (body.action === 'confirm' || body.action === 'reject' || body.action === 'pay') {
      // Action-modal flow (approve / reject / record payment).
      if (body.action === 'confirm') {
        data.status = 'approved'
        data.admin_notes = body.admin_notes ? String(body.admin_notes) : null
      } else if (body.action === 'reject') {
        if (!String(body.admin_notes || '').trim()) {
          return NextResponse.json({ error: 'Please provide a reason for rejection.' }, { status: 400 })
        }
        data.status = 'rejected'
        data.admin_notes = String(body.admin_notes)
      } else {
        if (!String(body.trx_id || '').trim()) {
          return NextResponse.json({ error: 'Please enter the Transaction ID.' }, { status: 400 })
        }
        data.status = 'paid'
        data.trx_id = String(body.trx_id).trim()
        data.paid_at = new Date()
        data.admin_notes = body.admin_notes ? String(body.admin_notes) : null
        // C20: booking the payment books the actually-paid amount
        // (the full requested amount for this flow) and zeroes due.
        data.paid_amount = existing.amount
        data.due_amount = 0
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
