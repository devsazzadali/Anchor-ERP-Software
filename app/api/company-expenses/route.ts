import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// The dashboard company-expenses ledger (dashboard/expenses
// page). FR-1.5 (audit G4): this list is ADMIN-ONLY now. The old
// "preserve the RLS-era visibility" behaviour — every approved
// caller reading the full company outlays list — is RETIRED: it
// handed the complete ৳3.4M company opex detail to any approved
// employee/partner/manager. Caller census for the retirement:
// the only consumer page, app/dashboard/expenses, appears in NO
// role's sidebar navigation, and admins have their own surface
// (app/admin/expenses via the admin-gated
// /api/admin/company-expenses); no linked non-admin surface
// consumes this endpoint, so gating breaks no navigation — a
// non-admin opening the orphaned page by direct URL now gets an
// empty list instead of company-wide figures. The localStorage
// DATA fallback (aura_company_expenses, audit A9/C41) stays gone:
// the API is the only source.
export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const [expenses, branches] = await Promise.all([
      prisma.companyExpense.findMany({ orderBy: { created_at: 'desc' } }),
      prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])

    return NextResponse.json({ expenses: toPlain(expenses), branches: toPlain(branches) })
  } catch (err: any) {
    console.error('[GET /api/company-expenses] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
