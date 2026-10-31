import { NextResponse } from 'next/server'
import { parseMoneyAmount, roundMoney } from '@/lib/money'
import { dhakaToday } from '@/lib/dhaka-time'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { syncExpenseToLedger } from '@/lib/server/ledger-sync'
import { logAudit, diffFields } from '@/lib/server/audit'
import { hookPostSource, hookSyncPayables } from '@/lib/server/accounting/hooks'

// the dashboard expense-requests page's
// OWN requests. Identity (employee_id/name, branch) always comes
// from the caller's profile server-side — never from the request
// body. The cash flow keeps the page's semantics (a cash request
// is immediately 'paid' with trx 'Cash') but books it properly:
// the request row AND its branch_cash_expenses row (linked via
// expense_request_id — the fix L11 mechanism) AND the ledger sync
// happen in ONE transaction, instead of the old page's unlinked
// client-side second insert (which also named a created_by column
// that does not exist).

export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const requests = await prisma.employeeExpenseRequest.findMany({
      where: { employee_id: caller.id },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ requests: toPlain(requests) })
  } catch (err: any) {
    console.error('[GET /api/expense-requests] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return NextResponse.json({ error: 'Title is required.' }, { status: 400 })

    const amount = parseMoneyAmount(body.amount, { min: 0 })
    if (amount === null || amount <= 0) {
      return NextResponse.json({ error: 'Enter a valid amount.' }, { status: 400 })
    }

    const paymentMethod = ['bkash', 'bank', 'cash'].includes(body.payment_method)
      ? body.payment_method
      : 'bkash'
    const isCash = paymentMethod === 'cash'

    // Account-detail rules mirror the page's client validation.
    if (!isCash) {
      if (!String(body.account_holder_name || '').trim() || !String(body.account_number || '').trim()) {
        return NextResponse.json({ error: 'Payment account name and number are required.' }, { status: 400 })
      }
      if (paymentMethod === 'bank' && !String(body.bank_name || '').trim()) {
        return NextResponse.json({ error: 'Bank name is required for bank transfers.' }, { status: 400 })
      }
      if (paymentMethod === 'bank' && !String(body.bank_branch || '').trim()) {
        return NextResponse.json({ error: 'Branch name is required for bank transfers.' }, { status: 400 })
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.employeeExpenseRequest.create({
        data: {
          employee_id: caller.id,
          employee_name: caller.full_name,
          branch_id: caller.branch_id,
          branch_name: caller.branch,
          title,
          description: body.description ? String(body.description).trim() || null : null,
          amount,
          currency: 'BDT',
          is_purchased: body.is_purchased === true,
          invoice_url: body.invoice_url ? String(body.invoice_url) : null,
          payment_method: paymentMethod,
          account_holder_name: isCash ? null : String(body.account_holder_name).trim(),
          account_number: isCash ? null : String(body.account_number).trim(),
          bank_name: paymentMethod === 'bank' ? String(body.bank_name).trim() : null,
          bank_branch: paymentMethod === 'bank' ? String(body.bank_branch).trim() : null,
          // Part B: optional routing number for bank transfers (new
          // nullable column) — accepted when the employee supplies it.
          routing_number: paymentMethod === 'bank' && body.routing_number ? String(body.routing_number).trim() || null : null,
          status: isCash ? 'paid' : 'pending',
          paid_at: isCash ? new Date() : null,
          trx_id: isCash ? 'Cash' : null,
        },
      })

      // Cash: deduct from the branch's daily cash in the same
      // transaction (request + expense + ledger, or none of them).
      if (isCash && caller.branch_id) {
        const expense = await tx.branchCashExpense.create({
          data: {
            branch_id: caller.branch_id,
            branch_name: caller.branch,
            manager_id: caller.id,
            manager_name: caller.full_name,
            expense_date: new Date(`${dhakaToday()}T00:00:00.000Z`),
            category: 'general',
            description: `[Expense Request] ${title}`,
            amount,
            paid_amount: amount,
            due_amount: 0,
            expense_request_id: request.id,
          },
        })
        await syncExpenseToLedger(tx, null, {
          branch_id: expense.branch_id,
          amount: roundMoney(amount),
          expense_date: expense.expense_date,
          // The link is what makes this row branch-stream by rule b —
          // pass it explicitly so the sync sees the same row the DB
          // holds (the created expense above carries it too).
          expense_request_id: request.id,
          salary_payment_id: null,
          ledger_head_id: null,
        })
      }

      return request
    })

    await logAudit({
      caller, req, action: 'expense_request.create', eventType: 'create',
      entityTable: 'employee_expense_requests', entityId: created.id,
      branchId: (created as any).branch_id ?? null,
      fieldChanges: diffFields(null, created as any, ['title', 'amount', 'status']),
    })
    // Accounts A1 (P6): cash requests are born paid — post the
    // journal entry (builder no-ops otherwise). Fail-soft.
    await hookPostSource('employee_expense_requests', created.id, caller, 'request_paid')
    await hookSyncPayables('employee_expense_requests', created.id)
    return NextResponse.json({ request: toPlain(created) }, { status: 201 })
  } catch (err: any) {
    console.error('[POST /api/expense-requests] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
