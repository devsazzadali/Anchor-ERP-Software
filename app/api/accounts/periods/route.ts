import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit, diffFields } from '@/lib/server/audit'
import {
  listPeriods,
  closePeriod,
  lockPeriod,
  reopenPeriod,
  closeFiscalYear,
  PeriodsError,
} from '@/lib/server/accounting/periods'
import { trialBalance, unpostedSources } from '@/lib/server/accounting/reports'
import { listOpenExceptions } from '@/lib/server/accounting/exceptions'
import { computeOpeningPosition } from '@/lib/server/accounting/opening'

// /api/accounts/periods — period close & lock + FY rollover (A3).
// GET: fiscal years with their periods (status + close metadata),
//   per-period journal entry counts, and the pre-close checklist
//   (blueprint §B.5 A3: unposted sources = 0, TB balanced, drift
//   reviewed — the standing flags are returned for that review).
// POST actions (admin-only, every transition S1-audited):
//   {action:'close_period', period_id}
//   {action:'lock_period', period_id, note?}
//   {action:'reopen_period', period_id, reason}   — break-glass (D7)
//   {action:'close_fiscal_year', fiscal_year_id}  — posts the
//     rollover entry carrying the FY result to Retained Earnings.
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
    const [years, tb, unposted, exceptions, computation] = await Promise.all([
      listPeriods(prisma as any),
      trialBalance(prisma as any),
      unpostedSources(prisma as any),
      listOpenExceptions(prisma as any),
      computeOpeningPosition(prisma as any),
    ])
    const unpostedTotal = Object.entries(unposted)
      .filter(([k]) => k !== 'chalans_uncosted_flagged')
      .reduce((a, [, v]) => a + (v as number), 0)
    return NextResponse.json({
      fiscal_years: years,
      checklist: {
        trial_balance_balanced: tb.balanced,
        trial_balance_difference: (tb.difference / 100).toFixed(2),
        unposted_total: unpostedTotal,
        unposted,
        open_posting_exceptions: exceptions.length,
        standing_flags: computation.flags.map((f) => ({
          code: f.code,
          amount: f.amount != null ? f.amount.toFixed(2) : null,
          count: f.count ?? null,
          text: f.text,
        })),
      },
    })
  } catch (err: any) {
    console.error('[accounts] periods GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    const db = prisma as any

    if (action === 'close_period' || action === 'lock_period' || action === 'reopen_period') {
      const periodId = String(body.period_id ?? '')
      if (!periodId) return NextResponse.json({ error: 'period_id is required' }, { status: 400 })
      const run =
        action === 'close_period'
          ? () => closePeriod(db, periodId, g.caller.id)
          : action === 'lock_period'
            ? () => lockPeriod(db, periodId, g.caller.id, body.note ? String(body.note) : null)
            : () => reopenPeriod(db, periodId, String(body.reason ?? ''), g.caller.id)
      const { before, after } = await run()
      const auditAction = {
        close_period: 'accounts.period_closed',
        lock_period: 'accounts.period_locked',
        reopen_period: 'accounts.period_reopened',
      }[action]
      await logAudit({
        caller: g.caller,
        req,
        action: auditAction,
        eventType: 'settings',
        entityTable: 'accounting_periods',
        entityId: periodId,
        fieldChanges: diffFields(before as any, after as any, ['status']),
        newValue:
          action === 'reopen_period'
            ? ({ reason: String(body.reason ?? ''), from_status: before.status } as any)
            : undefined,
      })
      return NextResponse.json({ period: { id: after.id, month: after.month, status: after.status } })
    }

    if (action === 'close_fiscal_year') {
      const fyId = String(body.fiscal_year_id ?? '')
      if (!fyId) return NextResponse.json({ error: 'fiscal_year_id is required' }, { status: 400 })
      const before = await prisma.fiscalYear.findUnique({ where: { id: fyId } })
      if (!before) return NextResponse.json({ error: 'Fiscal year not found' }, { status: 404 })
      const result = await closeFiscalYear(db, fyId, g.caller.id)
      const after = await prisma.fiscalYear.findUnique({ where: { id: fyId } })
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.fiscal_year_closed',
        eventType: 'settings',
        entityTable: 'fiscal_years',
        entityId: fyId,
        fieldChanges: diffFields(before as any, after as any, ['status']),
        newValue: {
          rollover_entry_id: result.entry_id,
          rollover_created: result.created,
          carried: result.carried,
          next_fiscal_year: result.next_fiscal_year,
        } as any,
      })
      return NextResponse.json({ result })
    }

    return NextResponse.json(
      { error: "action must be 'close_period', 'lock_period', 'reopen_period' or 'close_fiscal_year'" },
      { status: 400 }
    )
  } catch (err: any) {
    if (err instanceof PeriodsError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[accounts] periods POST failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
