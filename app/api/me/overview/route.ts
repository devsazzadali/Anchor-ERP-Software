import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// data for EmployeeDashboard — the
// caller's own tasks (BUG-020: assigned_to_id is the real column),
// own salary payments and own company expenses, in one round trip.
// Scoped to the caller server-side; the component's userId prop is
// display/routing state only.
export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [tasks, salaries, expenses] = await Promise.all([
      prisma.task.findMany({
        where: { assigned_to_id: caller.id },
        orderBy: { created_at: 'desc' },
      }),
      prisma.salaryPayment.findMany({
        where: { employee_id: caller.id, status: { not: 'voided' } }, // FR-14.1
        orderBy: { payment_date: 'desc' },
      }),
      prisma.companyExpense.findMany({
        where: { created_by: caller.id },
        orderBy: { created_at: 'desc' },
      }),
    ])

    return NextResponse.json({
      tasks: toPlain(tasks),
      salaries: toPlain(salaries),
      expenses: toPlain(expenses),
    })
  } catch (err: any) {
    console.error('[GET /api/me/overview] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
