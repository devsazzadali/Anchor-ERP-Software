import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// GET /api/branch-accounts/manager/options
// Admin-only option lists for the Manager Setup page: assignable
// employees + all branches.
// replaces the page's browser-direct
// legacy profile and branch reads,
// preserving the visible behaviour (employees = role 'employee',
// ordered by full_name; branches ordered by name).
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller || !callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [employees, branches] = await Promise.all([
      prisma.profile.findMany({
        where: { role: 'employee' },
        select: { id: true, full_name: true, email: true, phone_number: true },
        orderBy: { full_name: 'asc' },
      }),
      prisma.branch.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ])

    return NextResponse.json({
      employees: toPlain(employees),
      branches: toPlain(branches),
    })
  } catch (err: any) {
    console.error('[GET /api/branch-accounts/manager/options] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
