import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { parseMoneyAmount, roundMoney } from '@/lib/money'
import { dhakaToday } from '@/lib/dhaka-time'
import { syncExpenseToLedger } from '@/lib/server/ledger-sync'
import { logAudit, diffFields } from '@/lib/server/audit'
import { hookPostSource, hookSyncPayables } from '@/lib/server/accounting/hooks'

export const dynamic = 'force-dynamic'

// employee expense requests — the admin
// Expense Requests page's data layer (the fixed copy read/wrote
// employee_expense_requests straight from the browser). Admin-gated
// on every method. Money rules from the fixed copy, enforced
// server-side:
//  - C34: paid may never exceed amount; due is RECOMPUTED as
//    amount − paid on every write — never stored as an independent
//    client truth.
//  - C32 (pay): a request already 'paid' can never book twice; pay
//    books only what is still DUE into branch_cash_expenses, stamps
//    expense_request_id, settles the request (paid = full amount,
//    due = 0), and the whole thing — request update + cash expense
//    + ledger movement — commits in ONE transaction (the fixed
//    copy's two separate browser writes could half-apply).
// Employee expense requests paid from branch cash are BRANCH-stream
// expenses (owner's model, lib/expense-streams rule b) — they never
// touch company_expenses.

// GET /api/admin/expense-requests — complete list (C38), newest
// first with id tiebreak (the page's order), plus the active ledger
// heads for the pay modal.
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const [requests, heads] = await Promise.all([
      prisma.employeeExpenseRequest.findMany({
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      }),
      prisma.ledgerHead.findMany({
        where: { is_active: true },
        select: { id: true, name: true },
      }),
    ])
    return NextResponse.json({
      requests: toPlain(requests) || [],
      ledger_heads: toPlain(heads) || [],
    })
  } catch (err: any) {
    console.error('[api] app/api/admin/expense-requests/route.ts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/admin/expense-requests — admin creates a request
// (the page's "add" flow: the admin is the requesting employee).
export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const amount = parseMoneyAmount(body.amount, { min: 0.01 })
    if (amount === null) return NextResponse.json({ error: 'Enter a valid amount.' }, { status: 400 })
    if (!body.title || !String(body.title).trim()) {
      return NextResponse.json({ error: 'Title is required.' }, { status: 400 })
    }
    const paid = body.paid_amount === undefined || body.paid_amount === null
      ? 0
      : parseMoneyAmount(body.paid_amount)
    if (paid === null || paid > amount) {
      return NextResponse.json({ error: 'Paid amount must be between 0 and the total amount.' }, { status: 400 })
    }

    const data = await prisma.employeeExpenseRequest.create({
      data: {
        employee_id: body.employee_id || caller.uid,
        employee_name: body.employee_name || caller.full_name,
        branch_id: body.branch_id || null,
        branch_name: body.branch_name || null,
        title: String(body.title).trim(),
        description: body.description || null,
        amount,
        currency: body.currency || 'BDT',
        is_purchased: !!body.is_purchased,
        invoice_url: body.invoice_url || null,
        payment_method: body.payment_method || 'bkash',
        account_holder_name: body.account_holder_name || null,
        account_number: body.account_number || null,
        bank_name: body.bank_name || null,
        bank_branch: body.bank_branch || null,
        routing_number: body.routing_number || null,
        status: body.status || 'pending',
        trx_id: body.trx_id || null,
        paid_amount: paid,
        // C34: due computed server-side.
        due_amount: roundMoney(amount - paid),
        paid_at: body.paid_at ? new Date(body.paid_at) : null,
      },
    })
    await logAudit({
      caller, req, action: 'expense_request.create', eventType: 'create',
      entityTable: 'employee_expense_requests', entityId: data.id,
      branchId: data.branch_id ?? null,
      fieldChanges: diffFields(null, data as any, ['title', 'amount', 'status', 'paid_amount', 'due_amount']),
    })
    // Accounts A1 (P6): a request created already-paid posts its
    // journal entry (the builder no-ops for non-paid rows). Fail-soft.
    await hookPostSource('employee_expense_requests', data.id, caller, 'request_paid')
    await hookSyncPayables('employee_expense_requests', data.id)
    return NextResponse.json({ request: toPlain(data) }, { status: 201 })
  } catch (err: any) {
    console.error('[api] app/api/admin/expense-requests/route.ts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/admin/expense-requests?id=<uuid>
// Two shapes:
//  - { action: 'pay', ledger_head_id, trx_id, admin_notes } — the
//    C32 pay flow (transactional, see header).
//  - any other body — the edit / approve / reject update over the
//    whitelisted columns, with C34 due recomputation.
export async function PATCH(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const body = await req.json()

    // ── C32 pay flow ──────────────────────────────────────────────
    if (body.action === 'pay') {
      const result = await prisma.$transaction(async (tx) => {
        const request = await tx.employeeExpenseRequest.findFirst({ where: { id } })
        if (!request) return { error: 'Request not found', status: 404 }
        // C32: double-pay guard, enforced server-side inside the
        // transaction — an already-paid request books NOTHING twice.
        if (request.status === 'paid') {
          return { error: 'This request has already been paid.', status: 400 }
        }
        const alreadyPaid = Number(request.paid_amount || 0)
        const payDueAmount = roundMoney(Number(request.amount || 0) - alreadyPaid)
        if (payDueAmount <= 0) return { error: 'Nothing is due on this request.', status: 400 }

        const ledgerHeadId = body.ledger_head_id || null
        let headName = 'General Expense'
        if (ledgerHeadId) {
          const head = await tx.ledgerHead.findFirst({
            where: { id: ledgerHeadId },
            select: { name: true },
          })
          if (head) headName = head.name
        }

        // Settle the request: paid becomes the full amount, due 0.
        const updated = await tx.employeeExpenseRequest.update({
          where: { id },
          data: {
            status: 'paid',
            trx_id: body.trx_id || null,
            paid_at: new Date(),
            admin_notes: body.admin_notes || null,
            paid_amount: Number(request.amount || 0),
            due_amount: 0,
          },
        })

        // Book the DUE amount into branch cash (branch stream),
        // stamped with the request link (C32).
        if (request.branch_id) {
          const branch = await tx.branch.findFirst({
            where: { id: request.branch_id },
            select: { name: true },
          })
          const today = dhakaToday()
          const expense = await tx.branchCashExpense.create({
            data: {
              branch_id: request.branch_id,
              branch_name: branch?.name || request.branch_name || null,
              manager_id: caller.uid,
              manager_name: caller.full_name,
              expense_date: new Date(`${today}T00:00:00.000Z`),
              amount: payDueAmount,
              paid_amount: payDueAmount,
              due_amount: 0,
              description: `[Expense Request] ${request.title}`,
              ledger_head_id: ledgerHeadId,
              category: headName,
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
      await logAudit({
        caller, req, action: 'expense_request.pay', eventType: 'approve',
        entityTable: 'employee_expense_requests', entityId: id,
        branchId: (result.request as any).branch_id ?? null,
        fieldChanges: [{ field: 'status', old: 'unpaid', new: 'paid' }],
        newValue: { status: 'paid', paid_amount: Number((result.request as any).amount || 0) } as any,
      })
      // Accounts A1 (P6): settlement posts its journal entry. Fail-soft.
      await hookPostSource('employee_expense_requests', id, caller, 'request_paid')
      await hookSyncPayables('employee_expense_requests', id)
      return NextResponse.json({ request: toPlain(result.request) })
    }

    // ── Edit / approve / reject ───────────────────────────────────
    const existing = await prisma.employeeExpenseRequest.findFirst({
      where: { id },
    })
    if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

    // FR-14.2 (law E3): a generic edit may NOT move a request into
    // 'paid' — settlement must run the transactional pay flow above
    // so the payment BOOKS (branch cash + ledger). The old verbatim
    // status copy let a request be marked paid with nothing booked
    // (the OD-5 integrity hole). A settled (paid) request's money
    // fields are likewise immutable here.
    if (body.status === 'paid') {
      return NextResponse.json({ error: 'Use the Pay action to settle this request — payment must book the expense.' }, { status: 400 })
    }
    if (existing.status === 'paid' && ('amount' in body || 'paid_amount' in body || 'status' in body)) {
      return NextResponse.json({ error: 'This request is already settled. Its amount and status can no longer be edited.' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}
    // Part B: routing_number (new nullable column) is writable here
    // ONLY as an account-detail edit — pay/approve semantics unchanged.
    for (const key of ['title', 'description', 'status', 'trx_id', 'admin_notes', 'routing_number'] as const) {
      if (key in body) patch[key] = body[key]
    }
    // FR-14.2: paid_at is owned by the pay flow and is deliberately
    // NOT copied from the body — a generic edit may not stamp a
    // payment date onto an unpaid request.

    let amount = Number(existing.amount)
    let paid = Number(existing.paid_amount || 0)
    if ('amount' in body) {
      const a = parseMoneyAmount(body.amount, { min: 0.01 })
      if (a === null) return NextResponse.json({ error: 'Please enter a valid total amount.' }, { status: 400 })
      amount = a
      patch.amount = a
    }
    if ('paid_amount' in body) {
      const p = parseMoneyAmount(body.paid_amount)
      if (p === null) return NextResponse.json({ error: 'Invalid paid amount.' }, { status: 400 })
      paid = p
      patch.paid_amount = p
    }
    // C34: paid may never exceed amount; due is recomputed.
    if ('amount' in body || 'paid_amount' in body) {
      if (paid < 0 || paid > amount) {
        return NextResponse.json({ error: 'Paid amount must be between 0 and the total amount.' }, { status: 400 })
      }
      patch.due_amount = roundMoney(amount - paid)
    }

    // FR-14.2: an amount edit on an APPROVED request voids the
    // approval — the request returns to 'pending' for re-approval,
    // with an audit row (old → new). Approving a number nobody
    // re-checked is how wrong amounts get paid.
    let amountEditAudit: { oldAmount: number; newAmount: number } | null = null
    if ('amount' in body && existing.status === 'approved' && patch.amount !== undefined && Number(patch.amount) !== Number(existing.amount)) {
      patch.status = 'pending'
      amountEditAudit = { oldAmount: Number(existing.amount), newAmount: Number(patch.amount) }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }
    const data = await prisma.employeeExpenseRequest.update({ where: { id }, data: patch as any })
    {
      const statusChanged = (patch as any).status !== undefined && (patch as any).status !== existing.status
      await logAudit({
        caller, req,
        action: amountEditAudit ? 'expense_request.amount_edit_reapproval' : statusChanged ? 'expense_request.status_change' : 'expense_request.update',
        eventType: amountEditAudit ? 'update' : (patch as any).status === 'approved' ? 'approve' : (patch as any).status === 'rejected' ? 'reject' : 'update',
        entityTable: 'employee_expense_requests', entityId: id,
        branchId: (existing as any).branch_id ?? null,
        fieldChanges: diffFields(existing as any, data as any, ['title', 'description', 'status', 'amount', 'paid_amount', 'due_amount', 'trx_id', 'admin_notes']),
      })
    }
    if (amountEditAudit) {
      await prisma.activityLog.create({
        data: {
          user_id: caller.id,
          action: 'EXPENSE_REQUEST_AMOUNT_EDIT',
          details: { request_id: id, old_amount: amountEditAudit.oldAmount, new_amount: amountEditAudit.newAmount, status_reset: 'pending', route: 'admin' },
        },
      }).catch((e: any) => console.error('[expense-requests PATCH] audit write failed:', e.message))
    }
    return NextResponse.json({ request: toPlain(data) })
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/admin/expense-requests?id=<uuid>
export async function DELETE(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const before = await prisma.employeeExpenseRequest.findUnique({ where: { id } }).catch(() => null)
    await prisma.employeeExpenseRequest.delete({ where: { id } })
    await logAudit({
      caller, req, action: 'expense_request.delete', eventType: 'delete',
      entityTable: 'employee_expense_requests', entityId: id,
      branchId: (before as any)?.branch_id ?? null,
      oldValue: before ? { title: before.title, amount: Number(before.amount), status: before.status } as any : null,
    })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[api] app/api/admin/expense-requests/route.ts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
