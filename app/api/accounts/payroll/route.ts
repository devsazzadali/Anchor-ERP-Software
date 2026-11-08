import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { logAudit, diffFields } from '@/lib/server/audit'
import {
  listRuns,
  createRun,
  listEmployees,
  listSalaryStructures,
  saveSalaryStructure,
  PayrollError,
} from '@/lib/server/accounting/payroll'

// /api/accounts/payroll — the monthly payroll cycle (A6).
// GET: runs list (+ the salary_settings count the screens quote
// honestly) and the employee population for the line form.
// POST: create a run for a month — refused (409) when an issued
// run with live payments already covers the month.
// Admin-only; lifecycle transitions are S1-audited in the service.
export const dynamic = 'force-dynamic'

async function gate(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!callerIsAdmin(caller)) {
    return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  }
  return { caller }
}

export async function GET(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const db = prisma as any
    const [data, employees, branches, structures] = await Promise.all([
      listRuns(db),
      listEmployees(db),
      db.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      listSalaryStructures(db),
    ])
    return NextResponse.json({ ...data, employees: toPlain(employees) || [], branches, structures })
  } catch (err: any) {
    console.error('[accounts] payroll GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const body = await req.json().catch(() => ({}))
    try {
      // Step 5 (D3): salary-structure wizard save. Everything
      // else in this POST remains the run-creation flow.
      if (body.action === 'save_structure') {
        const { before, after } = await saveSalaryStructure(prisma as any, body)
        await logAudit({
          caller: g.caller,
          req,
          action: 'accounts.salary_structure_saved',
          eventType: 'settings',
          entityTable: 'salary_settings',
          entityId: after.id,
          fieldChanges: diffFields(before as any, after as any, [
            'base_salary', 'house_rent_allowance', 'medical_allowance', 'transport_allowance', 'overtime_rate_per_hour',
          ]),
        })
        const structures = await listSalaryStructures(prisma as any)
        return NextResponse.json({ success: true, structures, salary_settings_count: structures.length })
      }
      const detail = await createRun(prisma as any, g.caller, {
        month: body.month,
        notes: body.notes ?? null,
      })
      return NextResponse.json({ success: true, ...toPlain(detail) })
    } catch (err: any) {
      if (err instanceof PayrollError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (err: any) {
    console.error('[accounts] payroll POST failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
