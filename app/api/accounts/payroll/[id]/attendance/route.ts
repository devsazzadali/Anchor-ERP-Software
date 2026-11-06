import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { getRunDetail, PayrollError } from '@/lib/server/accounting/payroll'
import { getAttendanceDrafts } from '@/lib/server/attendance/service'

// /api/accounts/payroll/[id]/attendance — the run month's
// attendance summaries as DRAFT inputs for the line form.
//
// strictly READ-ONLY in both directions: the attendance system
// is read over HTTP GET (lib/server/attendance/client.ts) and
// this route writes nothing anywhere. It never creates lines
// or payments — the admin reads a summary, fills the ordinary
// line form, and confirms like any other line; disbursement
// still travels the ONE salary service at issue time.
// Admin-only, like every payroll route.
export const dynamic = 'force-dynamic'

async function gate(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!callerIsAdmin(caller)) {
    return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  }
  return { caller }
}

export async function GET(req: Request, context: any) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const { id } = await context.params
    try {
      const db = prisma as any
      const detail = await getRunDetail(db, id)
      const drafts = await getAttendanceDrafts(db, detail.run.month)
      return NextResponse.json(toPlain(drafts))
    } catch (err: any) {
      if (err instanceof PayrollError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (err: any) {
    console.error('[accounts] payroll attendance GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
