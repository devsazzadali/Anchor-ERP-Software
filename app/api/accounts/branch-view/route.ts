import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { branchAccountsView } from '@/lib/server/accounting/branchview'

// GET /api/accounts/branch-view — Round 2 Step 6 (D7): the branch
// manager's read-only "My Branch Accounts" data.
//
// Scope is enforced HERE, never trusted from the client:
//  - a branch manager always gets THEIR OWN branch (from their
//    profile); asking for any other branch_id is a 403;
//  - an admin may pass ?branch_id= to preview a branch's window;
//  - anyone else is a 403.
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const requested = url.searchParams.get('branch_id')

    let branchId: string | null = null
    if (callerIsAdmin(caller)) {
      branchId = requested ?? (caller as any).branch_id ?? null
      if (!branchId) {
        return NextResponse.json({ error: 'branch_id is required' }, { status: 400 })
      }
    } else if (caller.profile_type === 'branch_manager' || caller.is_branch_manager) {
      branchId = (caller as any).branch_id ?? null
      if (!branchId) {
        return NextResponse.json({ error: 'No branch is assigned to this profile' }, { status: 403 })
      }
      if (requested && requested !== branchId) {
        return NextResponse.json({ error: 'Forbidden: branch managers can only view their own branch' }, { status: 403 })
      }
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const view = await branchAccountsView(prisma as any, branchId)
    if (!view) return NextResponse.json({ error: 'Branch not found' }, { status: 404 })
    return NextResponse.json(view)
  } catch (err: any) {
    console.error('[accounts] branch-view GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
