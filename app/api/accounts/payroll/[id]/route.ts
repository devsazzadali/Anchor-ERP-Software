import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import {
  getRunDetail,
  addLine,
  updateLine,
  deleteLine,
  submitReview,
  approveRun,
  issueRun,
  voidRun,
  PayrollError,
} from '@/lib/server/accounting/payroll'

// /api/accounts/payroll/[id] — one run: detail (lines with payee
// account data for the payment-account cards), line editing while
// draft, and the lifecycle actions (submit_review / approve /
// issue / void_run). Issue disburses through the ONE shared
// salary service — see lib/server/accounting/payroll.ts.
// Admin-only; every transition is S1-audited in the service.
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
      const detail = await getRunDetail(prisma as any, id)
      return NextResponse.json(toPlain(detail))
    } catch (err: any) {
      if (err instanceof PayrollError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (err: any) {
    console.error('[accounts] payroll [id] GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request, context: any) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const { id } = await context.params
    const body = await req.json().catch(() => ({}))
    const db = prisma as any
    const caller = g.caller
    try {
      switch (String(body.action || '')) {
        case 'add_line': {
          const line = await addLine(db, caller, id, body.line || {})
          return NextResponse.json({ success: true, line: toPlain(line), detail: toPlain(await getRunDetail(db, id)) })
        }
        case 'update_line': {
          const line = await updateLine(db, caller, id, String(body.line_id || ''), body.line || {})
          return NextResponse.json({ success: true, line: toPlain(line), detail: toPlain(await getRunDetail(db, id)) })
        }
        case 'delete_line': {
          await deleteLine(db, caller, id, String(body.line_id || ''))
          return NextResponse.json({ success: true, detail: toPlain(await getRunDetail(db, id)) })
        }
        case 'submit_review': {
          await submitReview(db, caller, id)
          return NextResponse.json({ success: true, detail: toPlain(await getRunDetail(db, id)) })
        }
        case 'approve': {
          await approveRun(db, caller, id)
          return NextResponse.json({ success: true, detail: toPlain(await getRunDetail(db, id)) })
        }
        case 'issue': {
          const result = await issueRun(db, caller, id, req)
          if (!result.issued.length && result.failures.length) {
            return NextResponse.json(
              { error: 'No line could be issued.', failures: result.failures },
              { status: 409 }
            )
          }
          return NextResponse.json({
            success: true,
            issued: result.issued,
            failures: result.failures,
            period_missing: result.period_missing,
            detail: toPlain(await getRunDetail(db, id)),
          })
        }
        case 'void_run': {
          const run = await voidRun(db, caller, id, body.reason)
          return NextResponse.json({ success: true, run: toPlain(run) })
        }
        default:
          return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
      }
    } catch (err: any) {
      if (err instanceof PayrollError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (err: any) {
    console.error('[accounts] payroll [id] POST failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
