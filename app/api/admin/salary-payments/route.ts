import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// /api/admin/salary-payments — admin-only salary_payments access for
// the admin branches / users pages (the /api/admin/salaries route
// serves the salaries ledger page's month-window shape instead).
// GET ?employee_id=<id>: that employee's payments, newest first.
// GET ?branch_id=<id>: payments whose EMPLOYEE profile belongs to
// the branch, with the profiles embed { full_name, branch_id } the
// branch view renders (the old query joined profiles!inner on
// branch_id).
// POST: record a salary payment (issue-salary flows). Amount is
// validated server-side; the row is stored as submitted otherwise.
async function requireAdmin(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!callerIsAdmin(caller)) return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  return { caller }
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employee_id')
    const branchId = searchParams.get('branch_id')

    if (branchId) {
      const empProfiles = await prisma.profile.findMany({
        where: { branch_id: branchId },
        select: { id: true, full_name: true, branch_id: true },
      })
      const empById = new Map(empProfiles.map((p) => [p.id, p]))
      const rows = empProfiles.length
        ? await prisma.salaryPayment.findMany({
            where: { employee_id: { in: empProfiles.map((p) => p.id) } },
            select: {
              id: true, amount: true, payment_date: true, transaction_id: true,
              notes: true, employee_id: true,
            },
            orderBy: { payment_date: 'desc' },
          })
        : []
      const payments = rows.map((r) => ({
        ...r,
        profiles: empById.get(r.employee_id)
          ? { full_name: empById.get(r.employee_id)!.full_name, branch_id: empById.get(r.employee_id)!.branch_id }
          : null,
      }))
      return NextResponse.json({ payments: toPlain(payments) })
    }

    const where: any = {}
    if (employeeId) where.employee_id = employeeId
    const payments = await prisma.salaryPayment.findMany({
      where,
      orderBy: { payment_date: 'desc' },
    })
    return NextResponse.json({ payments: toPlain(payments) })
  } catch (err: any) {
    console.error('[GET /api/admin/salary-payments] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch salary payments' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const body = await req.json()
    const amount = Number(body.amount)
    if (!body.employee_id || !Number.isFinite(amount)) {
      return NextResponse.json({ error: 'employee_id and a valid amount are required' }, { status: 400 })
    }

    const payment = await prisma.salaryPayment.create({
      data: {
        employee_id: body.employee_id,
        amount: amount as any,
        total_salary: body.total_salary !== undefined ? (Number(body.total_salary) as any) : undefined,
        transaction_id: body.transaction_id ?? null,
        payment_proof_url: body.payment_proof_url ?? null,
        payment_date: body.payment_date ? new Date(body.payment_date) : new Date(),
        branch_id: body.branch_id ?? null,
        account: body.account ?? null,
        notes: body.notes ?? null,
        base_salary_at_time: body.base_salary_at_time !== undefined && body.base_salary_at_time !== null
          ? (Number(body.base_salary_at_time) as any)
          : null,
        ledger_head_id: body.ledger_head_id ?? null,
        overtime_amount: body.overtime_amount !== undefined ? (Number(body.overtime_amount) as any) : undefined,
        bonus_amount: body.bonus_amount !== undefined ? (Number(body.bonus_amount) as any) : undefined,
        sales_commission: body.sales_commission !== undefined ? (Number(body.sales_commission) as any) : undefined,
        tiffin_bill: body.tiffin_bill !== undefined ? (Number(body.tiffin_bill) as any) : undefined,
      },
    })

    return NextResponse.json({ payment: toPlain(payment) })
  } catch (err: any) {
    console.error('[POST /api/admin/salary-payments] Error:', err)
    return NextResponse.json({ error: 'Failed to record salary payment' }, { status: 500 })
  }
}
