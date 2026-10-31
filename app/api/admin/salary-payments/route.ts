import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// /api/admin/salary-payments — admin-only READ access to
// salary_payments for the admin branches page's disbursement
// ledger (the /api/admin/salaries route serves the salaries
// ledger page's month-window shape instead).
// GET ?employee_id=<id>: that employee's payments, newest first.
// GET ?branch_id=<id>: payments whose EMPLOYEE profile belongs to
// the branch, with the profiles embed { full_name, branch_id } the
// branch view renders (the old query joined profiles!inner on
// branch_id).
// U2: the POST write handler is DELETED — it was the duplicate
// issue path behind the branches/users inline forms. Salary is
// issued ONLY through POST /api/admin/salaries/issue (the shared
// IssueSalaryModal's route), which recomputes the total and books
// the C20/C11 branch-cash copy + ledger sync in one transaction.
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
