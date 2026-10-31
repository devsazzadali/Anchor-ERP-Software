/**
 * Accounts A3 — period close & lock, break-glass reopen, and the
 * fiscal-year rollover (lib/server/accounting/periods.ts).
 *
 * State machine (blueprint §B.1 / §B.5 A3 / decision D7):
 *   period:  open ──close──▶ closed ──lock──▶ locked
 *              ▲                │                 │
 *              └──── reopen (break-glass: admin + mandatory reason
 *                    + audit; the ONLY way back) ◀┘
 *   fiscal year: open ──close──▶ closed, allowed only when every
 *   period is closed or locked; closing posts ONE rollover entry
 *   (P13 class) that carries the FY's income/expense balances to
 *   Retained Earnings, dated the first day of the NEXT fiscal year
 *   (seeded on demand) so it always lands in an open period.
 *
 * Every transition is a service-level decision made here; the API
 * route only gates (admin) and writes the S1 audit rows. Errors
 * carry an HTTP-ish `status` for the route to surface.
 */
import { postEvent, type Db } from './post'
import { toPoishaExact } from './reports'

export class PeriodsError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'PeriodsError'
    this.status = status
  }
}

const dateStr = (d: Date): string => d.toISOString().slice(0, 10)

// ── Read model ──────────────────────────────────────────────────────

export async function listPeriods(db: Db) {
  const [fys, periods, entryCounts] = await Promise.all([
    db.fiscalYear.findMany({ orderBy: { start_date: 'asc' } }),
    db.accountingPeriod.findMany({ orderBy: { month: 'asc' } }),
    db.$queryRawUnsafe(
      `SELECT period_id::text AS period_id, count(*)::int AS n FROM journal_entries GROUP BY period_id`
    ) as Promise<Array<{ period_id: string; n: number }>>,
  ])
  const countOf = new Map(entryCounts.map((r) => [r.period_id, r.n]))
  return fys.map((fy: any) => ({
    id: fy.id,
    label: fy.label,
    start_date: dateStr(fy.start_date),
    end_date: dateStr(fy.end_date),
    is_current: fy.is_current,
    status: fy.status,
    closed_by: fy.closed_by,
    closed_at: fy.closed_at?.toISOString() ?? null,
    periods: periods
      .filter((p: any) => p.fiscal_year_id === fy.id)
      .map((p: any) => ({
        id: p.id,
        month: p.month,
        start_date: dateStr(p.start_date),
        end_date: dateStr(p.end_date),
        status: p.status,
        entries: countOf.get(p.id) ?? 0,
        closed_by: p.closed_by,
        closed_at: p.closed_at?.toISOString() ?? null,
        locked_by: p.locked_by,
        locked_at: p.locked_at?.toISOString() ?? null,
        lock_note: p.lock_note,
        reopened_by: p.reopened_by,
        reopened_at: p.reopened_at?.toISOString() ?? null,
        reopen_reason: p.reopen_reason,
      })),
  }))
}

// ── Period transitions ──────────────────────────────────────────────

async function loadPeriod(db: Db, periodId: string): Promise<any> {
  const period = await db.accountingPeriod.findUnique({ where: { id: periodId } })
  if (!period) throw new PeriodsError(404, 'Accounting period not found')
  return period
}

export async function closePeriod(db: Db, periodId: string, callerId: string | null) {
  const before = await loadPeriod(db, periodId)
  if (before.status !== 'open') {
    throw new PeriodsError(409, `Period ${before.month} is already ${before.status}`)
  }
  const after = await db.accountingPeriod.update({
    where: { id: periodId },
    data: { status: 'closed', closed_by: callerId, closed_at: new Date() },
  })
  return { before, after }
}

export async function lockPeriod(db: Db, periodId: string, callerId: string | null, note?: string | null) {
  const before = await loadPeriod(db, periodId)
  if (before.status === 'locked') throw new PeriodsError(409, `Period ${before.month} is already locked`)
  if (before.status !== 'closed') {
    throw new PeriodsError(409, `Period ${before.month} must be closed before it can be locked`)
  }
  const after = await db.accountingPeriod.update({
    where: { id: periodId },
    data: {
      status: 'locked',
      locked_by: callerId,
      locked_at: new Date(),
      lock_note: note ?? before.lock_note ?? null,
    },
  })
  return { before, after }
}

/** Break-glass reopen (D7): admin-only at the route, reason mandatory. */
export async function reopenPeriod(db: Db, periodId: string, reason: string, callerId: string | null) {
  const clean = String(reason ?? '').trim()
  if (!clean) throw new PeriodsError(400, 'A reason is required to reopen a period (break-glass rule)')
  const before = await loadPeriod(db, periodId)
  if (before.status === 'open') throw new PeriodsError(409, `Period ${before.month} is already open`)
  const after = await db.accountingPeriod.update({
    where: { id: periodId },
    data: {
      status: 'open',
      closed_by: null,
      closed_at: null,
      locked_by: null,
      locked_at: null,
      reopened_by: callerId,
      reopened_at: new Date(),
      reopen_reason: clean,
    },
  })
  return { before, after }
}

// ── Fiscal-year rollover ────────────────────────────────────────────

function fyLabelFor(startYear: number): string {
  return `FY${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

/** Create the fiscal year starting the day after `fy` ends (+ its 12 periods), if missing. */
export async function ensureNextFiscalYear(db: Db, fy: any): Promise<any> {
  const start = new Date(fy.end_date)
  start.setUTCDate(start.getUTCDate() + 1)
  const label = fyLabelFor(start.getUTCFullYear())
  const existing = await db.fiscalYear.findUnique({ where: { label } })
  if (existing) {
    return { fy: existing, created_periods: 0 }
  }
  const end = new Date(start)
  end.setUTCFullYear(end.getUTCFullYear() + 1)
  end.setUTCDate(end.getUTCDate() - 1)
  const created = await db.fiscalYear.create({
    data: {
      label,
      start_date: start,
      end_date: end,
      is_current: false,
    },
  })
  let created_periods = 0
  for (let m = 0; m < 12; m++) {
    const pStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1))
    const pEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m + 1, 0))
    const month = pStart.toISOString().slice(0, 7)
    const found = await db.accountingPeriod.findUnique({ where: { month } })
    if (!found) {
      await db.accountingPeriod.create({
        data: { fiscal_year_id: created.id, month, start_date: pStart, end_date: pEnd, status: 'open' },
      })
      created_periods++
    }
  }
  return { fy: created, created_periods }
}

export interface RolloverResult {
  fiscal_year: string
  entry_id: string | null
  created: boolean
  carried: { income: number; expenses: number; net: number } // taka, signed: net > 0 = profit
  next_fiscal_year: string
}

/**
 * Close a fiscal year and carry its result to Retained Earnings.
 * Idempotent: a second close finds the year already closed and the
 * rollover entry already posted (unique source key) — nothing is
 * created twice.
 */
export async function closeFiscalYear(db: Db, fyId: string, callerId: string | null): Promise<RolloverResult> {
  const fy = await db.fiscalYear.findUnique({ where: { id: fyId } })
  if (!fy) throw new PeriodsError(404, 'Fiscal year not found')

  const { fy: nextFy } = await ensureNextFiscalYear(db, fy)
  const rolloverDate = dateStr(nextFy.start_date)

  if (fy.status === 'closed') {
    const existing = await db.journalEntry.findFirst({
      where: { source_table: 'fiscal_years', source_id: fy.id, event_type: 'fy_rollover' },
      select: { id: true },
    })
    return {
      fiscal_year: fy.label,
      entry_id: existing?.id ?? null,
      created: false,
      carried: { income: 0, expenses: 0, net: 0 },
      next_fiscal_year: nextFy.label,
    }
  }

  const periods = await db.accountingPeriod.findMany({ where: { fiscal_year_id: fy.id } })
  const openOnes = periods.filter((p: any) => p.status === 'open')
  if (openOnes.length > 0) {
    throw new PeriodsError(
      409,
      `Cannot close ${fy.label}: ${openOnes.length} period(s) still open (${openOnes.map((p: any) => p.month).join(', ')}). Close or lock every period first.`
    )
  }

  // P&L balances over the FY's own date range, from posted entries
  // only (the statements' convention). Balance is debit-positive
  // poisha per account.
  const lines = await db.$queryRawUnsafe(
    `SELECT ca.code AS code, ca.type AS type,
            COALESCE(SUM(jl.debit), 0)::text AS dr, COALESCE(SUM(jl.credit), 0)::text AS cr
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted'
       JOIN chart_accounts ca ON ca.id = jl.account_id
      WHERE ca.type IN ('income', 'expense')
        AND je.entry_date >= $1::date AND je.entry_date <= $2::date
      GROUP BY ca.code, ca.type`,
    dateStr(fy.start_date),
    dateStr(fy.end_date)
  ) as Array<{ code: string; type: string; dr: string; cr: string }>

  const RETAINED_EARNINGS = '3010'
  const rolloverLines: Array<{ account_code: string; debit?: number; credit?: number; memo?: string }> = []
  let incomePoisha = 0 // credit-positive
  let expensePoisha = 0 // debit-positive
  for (const r of lines) {
    const balance = toPoishaExact(r.dr) - toPoishaExact(r.cr) // debit-positive
    if (balance === 0) continue
    if (r.type === 'income') incomePoisha += -balance
    else expensePoisha += balance
    // Flip the account to zero.
    rolloverLines.push(
      balance > 0
        ? { account_code: r.code, credit: balance / 100, memo: `Close ${fy.label} balance to Retained Earnings` }
        : { account_code: r.code, debit: -balance / 100, memo: `Close ${fy.label} balance to Retained Earnings` }
    )
  }
  const netPoisha = incomePoisha - expensePoisha // > 0 profit, < 0 loss
  let entryId: string | null = null
  let created = false
  if (rolloverLines.length > 0) {
    if (netPoisha > 0) {
      rolloverLines.push({ account_code: RETAINED_EARNINGS, credit: netPoisha / 100, memo: `${fy.label} net profit carried forward` })
    } else if (netPoisha < 0) {
      rolloverLines.push({ account_code: RETAINED_EARNINGS, debit: -netPoisha / 100, memo: `${fy.label} net loss carried forward` })
    }
    const res = await postEvent(db, {
      source_table: 'fiscal_years',
      source_id: fy.id,
      event_type: 'fy_rollover',
      entry_date: rolloverDate,
      memo: `FY rollover — ${fy.label} result carried to Retained Earnings (posted into ${nextFy.label})`,
      created_by: callerId,
      lines: rolloverLines,
    })
    entryId = res.entry_id
    created = res.created
  }

  await db.fiscalYear.update({
    where: { id: fy.id },
    data: { status: 'closed', closed_by: callerId, closed_at: new Date() },
  })
  return {
    fiscal_year: fy.label,
    entry_id: entryId,
    created,
    carried: { income: incomePoisha / 100, expenses: expensePoisha / 100, net: netPoisha / 100 },
    next_fiscal_year: nextFy.label,
  }
}
