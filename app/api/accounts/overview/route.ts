import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import {
  trialBalance,
  unpostedSources,
  classReconciliation,
  taka,
} from '@/lib/server/accounting/reports'
import { computeOpeningPosition } from '@/lib/server/accounting/opening'
import { listOpenExceptions } from '@/lib/server/accounting/exceptions'
import { chequeSummary, chequeFlags } from '@/lib/server/accounting/cheques'
import { inboxCounts } from '@/lib/server/accounting/inbox'
import { dhakaToday } from '@/lib/dhaka-time'

// GET /api/accounts/overview — Accounts A1 section home data:
// trial-balance health, journal counts, unposted-source counts,
// per-class reconciliation, the latest opening position (DRAFT
// until the owner confirms) and the standing honesty flags.
// Admin-only (FR-1 boundary: callerIsAdmin already excludes
// partner accounts without an admin_users row — blueprint §B.6).
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const [tb, unposted, reconciliation, position, computation, counts, exceptions, chequeSum, chequeFlagList, inboxSummary] = await Promise.all([
      trialBalance(prisma as any),
      unpostedSources(prisma as any),
      classReconciliation(prisma as any),
      prisma.openingPosition.findFirst({
        orderBy: { created_at: 'desc' },
      }),
      computeOpeningPosition(prisma as any),
      Promise.all([
        prisma.journalEntry.count(),
        prisma.chartAccount.count({ where: { is_active: true } }),
        prisma.accountingPeriod.count({ where: { status: 'open' } }),
      ]),
      listOpenExceptions(prisma as any),
      chequeSummary(prisma as any),
      chequeFlags(prisma as any),
      // A9: the exceptions inbox counts, computed by the same
      // assembly the inbox screen uses — additive key only; the
      // flags/posting_exceptions payloads above are unchanged.
      inboxCounts(prisma as any),
    ])

    let positionLines: any[] = []
    if (position) {
      positionLines = await prisma.openingPositionLine.findMany({
        where: { position_id: position.id },
        orderBy: { created_at: 'asc' },
      })
    }

    // ── Owner's daily check (Round 2 Step 6, plan §5) ────────
    // Answered live for TODAY (Dhaka): did today's closings
    // arrive, are they posted, did the counted cash match, are
    // deposits waiting, is a salary run waiting.
    const todayStr = dhakaToday()
    const todayDate = new Date(`${todayStr}T00:00:00.000Z`)
    const todayClosings = await prisma.branchCashLedger.findMany({
      where: { ledger_date: todayDate },
      select: { id: true, cash_difference: true },
    })
    const closingIds = todayClosings.map((c: any) => c.id)
    const postedClosingIds = closingIds.length
      ? new Set(
          (await prisma.journalEntry.findMany({
            where: { source_table: 'branch_cash_ledger', source_id: { in: closingIds } },
            select: { source_id: true },
          })).map((e: any) => e.source_id)
        )
      : new Set<string>()
    const [pendingDeposits, pendingPayroll] = await Promise.all([
      prisma.branchBankDeposit.count({
        where: { status: { in: ['submitted', 'pending_approval'] }, is_reversed: false },
      }),
      prisma.payrollRun.count({ where: { status: { in: ['draft', 'in_review', 'approved'] } } }),
    ])
    const daily_check = {
      date: todayStr,
      closings_today: todayClosings.length,
      closings_unposted: closingIds.filter((id: string) => !postedClosingIds.has(id)).length,
      cash_difference_today: todayClosings
        .reduce((s: number, c: any) => s + Number(c.cash_difference ?? 0), 0)
        .toFixed(2),
      deposits_pending: pendingDeposits,
      payroll_pending: pendingPayroll,
    }

    return NextResponse.json({
      trial_balance: {
        entries: tb.entry_count,
        total_debit: taka(tb.total_debit),
        total_credit: taka(tb.total_credit),
        difference: taka(tb.difference),
        balanced: tb.balanced,
      },
      counts: {
        journal_entries: counts[0],
        active_accounts: counts[1],
        open_periods: counts[2],
      },
      unposted,
      reconciliation: reconciliation.map((r) => ({
        cls: r.cls,
        source: taka(r.source_total),
        journal: taka(r.journal_total),
        match: r.match,
        note: r.note ?? null,
      })),
      opening_position: position
        ? {
            id: position.id,
            label: position.label,
            status: position.status,
            as_of: position.as_of_date.toISOString().slice(0, 10),
            confirmed_by: position.confirmed_by,
            confirmed_at: position.confirmed_at?.toISOString() ?? null,
            lines: positionLines.map((l) => ({
              component: l.component,
              label: l.label,
              amount: l.amount.toString(),
              side: l.side,
              source_note: l.source_note,
              detail: l.detail,
            })),
          }
        : null,
      flags: [
        ...computation.flags.map((f) => ({
          code: f.code,
          amount: f.amount != null ? f.amount.toFixed(2) : null,
          count: f.count ?? null,
          text: f.text,
        })),
        // A3: postings refused by a closed/locked period stay
        // visible here until resolved (the A9 inbox reads the same
        // posting_exceptions rows).
        // A8: cheque alerts derived live from the register —
        // bounced cheques + PDCs falling due (the A9 inbox reads
        // the same register conditions).
        ...chequeFlagList.map((f: any) => ({
          code: f.code,
          amount: f.amount,
          count: f.count,
          text: f.text,
        })),
        ...exceptions.map((x: any) => ({
          code: 'POSTING_BLOCKED',
          amount: null,
          count: null,
          text:
            `A ${x.event_type} posting for ${x.source_table} was refused: period ${x.period_month} is ` +
            `${x.reason.replace('period_', '')}. The source record stands; resolve by reopening the period ` +
            `(break-glass) and re-firing, or by a correction entry in an open period.`,
        })),
      ],
      cheques: {
        by_status: chequeSum.by_status,
        total_count: chequeSum.total_count,
        pdc_due: chequeSum.pdc_due,
      },
      // A9: Exceptions Inbox summary (see lib/server/accounting/inbox.ts).
      inbox: inboxSummary,
      daily_check,
      posting_exceptions: exceptions.map((x: any) => ({
        id: x.id,
        source_table: x.source_table,
        source_id: x.source_id,
        event_type: x.event_type,
        entry_date: x.entry_date.toISOString().slice(0, 10),
        period_month: x.period_month,
        reason: x.reason,
        status: x.status,
        created_at: x.created_at.toISOString(),
      })),
    })
  } catch (err: any) {
    console.error('[accounts] overview failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
