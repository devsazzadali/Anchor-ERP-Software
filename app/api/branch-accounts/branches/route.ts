import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// GET /api/branch-accounts/branches
// Branch id+name list for the branch-accounts pages' selectors.
// replaces the browser-direct
// a legacy branch list read (id, name, ordered by name).
// Any resolved caller may read the list (the old RLS-visible
// behaviour); enforcement for branch money stays on the money
// routes themselves.
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const branches = await prisma.branch.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ branches: toPlain(branches) })
  } catch (err: any) {
    console.error('[GET /api/branch-accounts/branches] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
