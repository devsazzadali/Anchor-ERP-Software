import { NextResponse } from 'next/server'
import { parseMoneyAmount } from '@/lib/money'
import { prisma } from '@/lib/db'
import { callerIsAdmin, getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { logAudit, diffFields } from '@/lib/server/audit'
import { hookPostSource, hookSyncPayables } from '@/lib/server/accounting/hooks'

// the dashboard branch-expenses page
// (partner surface) — ALL employee expense requests + the branch
// reference list. Read gate mirrors the page's audience: admins,
// partners and head-office profiles. The create below is the
// page's "admin direct" entry: employee identity is the CALLER
// (with the page's "(Admin)" name suffix preserved), branch comes
// from the selected branch id, and paid/due are recomputed
// server-side (due = total − paid, never a client figure).

function canRead(caller: { profile_type: string | null } & { is_admin: boolean }): boolean {
  return callerIsAdmin(caller as any) || caller.profile_type === 'partner' || caller.profile_type === 'head_office'
}

function canWrite(caller: { profile_type: string | null } & { is_admin: boolean }): boolean {
  return callerIsAdmin(caller as any) || caller.profile_type === 'partner'
}

export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canRead(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const [requests, branches] = await Promise.all([
      prisma.employeeExpenseRequest.findMany({ orderBy: { created_at: 'desc' } }),
      prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])
    return NextResponse.json({ requests: toPlain(requests), branches: toPlain(branches) })
  } catch (err: any) {
    console.error('[GET /api/expense-requests/all] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canWrite(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return NextResponse.json({ error: 'Title is required.' }, { status: 400 })

    const amount = parseMoneyAmount(body.amount, { min: 0 })
    if (amount === null || amount <= 0) {
      return NextResponse.json({ error: 'Enter a valid amount.' }, { status: 400 })
    }

    const branchId = typeof body.branch_id === 'string' ? body.branch_id : null
    if (!branchId) {
      return NextResponse.json({ error: 'Please select a valid physical branch first.' }, { status: 400 })
    }
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } })
    if (!branch) {
      return NextResponse.json({ error: 'Please select a valid physical branch first.' }, { status: 400 })
    }

    // Money recomputed server-side: due is total − paid, clamped.
    const paidAmount = parseMoneyAmount(body.paid_amount ?? 0, { min: 0 }) ?? 0
    const dueAmount = Math.max(0, Math.round((amount - paidAmount) * 100) / 100)
    const status = dueAmount <= 0 && paidAmount > 0 ? 'paid' : paidAmount > 0 ? 'approved' : 'pending'
    const paymentMethod = body.payment_method === 'bank' ? 'bank' : 'bkash'

    const created = await prisma.employeeExpenseRequest.create({
      data: {
        employee_id: caller.id,
        employee_name: `${caller.full_name || 'Admin'} (Admin)`,
        branch_id: branch.id,
        branch_name: branch.name,
        title,
        description: body.description ? String(body.description).trim() || null : null,
        amount,
        currency: 'BDT',
        is_purchased: body.is_purchased === true,
        invoice_url: null,
        payment_method: paymentMethod,
        account_holder_name: body.account_holder_name ? String(body.account_holder_name).trim() || 'Admin Direct' : 'Admin Direct',
        account_number: body.account_number ? String(body.account_number).trim() || 'N/A' : 'N/A',
        bank_name: paymentMethod === 'bank' ? (body.bank_name ? String(body.bank_name).trim() || null : null) : null,
        bank_branch: paymentMethod === 'bank' ? (body.bank_branch ? String(body.bank_branch).trim() || null : null) : null,
        status,
        paid_amount: paidAmount,
        due_amount: dueAmount,
        trx_id: paidAmount > 0 ? 'Admin Direct' : null,
        paid_at: paidAmount > 0 ? new Date() : null,
      },
    })

    await logAudit({
      caller, req, action: 'expense_request.create', eventType: 'create',
      entityTable: 'employee_expense_requests', entityId: created.id,
      branchId: created.branch_id ?? null,
      fieldChanges: diffFields(null, created as any, ['title', 'amount', 'status', 'paid_amount', 'due_amount']),
    })
    // Accounts A1 (P6): a fully-paid created request posts its
    // journal entry (builder no-ops otherwise). Fail-soft.
    await hookPostSource('employee_expense_requests', created.id, caller, 'request_paid')
    await hookSyncPayables('employee_expense_requests', created.id)
    return NextResponse.json({ request: toPlain(created) }, { status: 201 })
  } catch (err: any) {
    console.error('[POST /api/expense-requests/all] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
