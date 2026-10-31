/**
 * Accounts A6 — the monthly payroll cycle
 * (lib/server/accounting/payroll.ts).
 *
 * A run (payroll_runs) drafts its per-employee lines into the
 * dormant payroll_sheets model (blueprint §B.1: lines REUSE it),
 * walks draft → in_review → approved → issued, and disburses by
 * creating salary_payments through the ONE shared salary service
 * (lib/server/salary-issue.ts) — the same function the Issue
 * Salary modal's route wraps. No second salary money path exists.
 *
 * Honesty rules (owner's no-re-entry / no-invention laws):
 *  - Lines are drafted ONLY from recorded data: the month's
 *    existing salary_payments (review lines — already issued via
 *    Issue Salary, never re-paid by the run) and, as *suggestions*
 *    the admin may add, salary_settings structures where rows
 *    exist. salary_settings is EMPTY today: the API says so
 *    plainly (settings_count) and the screens state it — no
 *    salary structure is ever invented.
 *  - salary_payments has no allowances/deductions columns, while
 *    a run line's payable figure is its NET. Disbursement folds
 *    allowances (+) and deductions (−) into the payment's basic
 *    component so payment.amount == line net EXACTLY (blueprint
 *    A6 gate: run totals == Σ issued payments == journal P5), and
 *    the payment's notes carry the full component breakdown. The
 *    payroll line remains the component-level truth.
 *  - Period respect (A3): issuing a run whose month's accounting
 *    period is closed/locked is refused (409) and recorded as a
 *    posting exception; the run stays approved-not-issued. The
 *    journal leg itself still travels the A1 hooks (fail-soft).
 *  - Approved-but-unpaid run lines are mirrored into the A5
 *    payables register (source_table 'payroll_sheets') so they
 *    appear as Salary Payable with ageing; issuing settles the
 *    mirror, voiding the payment reopens it, voiding the run
 *    removes it.
 */
import { logAudit, diffFields } from '../audit'
import { parseMoneyAmount, sumMoney } from '../../money'
import { issueSalaryPayment, SalaryIssueError } from '../salary-issue'
import { PeriodBlockedError } from './post'
import { recordPostingException } from './exceptions'
import { ensureProfileParty } from './payables'
import { toPoishaExact, taka } from './reports'
import { salaryTdsFor } from './tax'
import { dhakaToday } from '../../dhaka-time'

export class PayrollError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'PayrollError'
    this.status = status
  }
}

type Db = any
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const money = (poisha: number): string => (poisha / 100).toFixed(2)
export const RUN_STATUSES = ['draft', 'in_review', 'approved', 'issued', 'voided'] as const

function assertMonth(month: unknown): string {
  const m = String(month ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) {
    throw new PayrollError(400, 'month must be YYYY-MM (e.g. 2026-10).')
  }
  return m
}

function monthBounds(month: string): { start: Date; end: Date; endDay: Date } {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 1))
  const endDay = new Date(Date.UTC(y, m, 0))
  return { start, end, endDay }
}

/** The accounting period for a run month, or null when the month
 * is outside the seeded fiscal years. */
export async function periodForMonth(db: Db, month: string): Promise<any | null> {
  return db.accountingPeriod.findUnique({ where: { month } })
}

/** Run totals over the run's OWN lines (origin 'run', not voided).
 * Review lines (existing payments) are other modules' money and
 * never enter run totals. Poisha-exact. */
export async function recomputeRunTotals(db: Db, runId: string): Promise<any> {
  const lines = await db.payrollSheet.findMany({
    where: { payroll_run_id: runId, origin: 'run', status: { not: 'voided' } },
    select: { gross_salary: true, deductions: true, net_payable: true },
  })
  let gross = 0, ded = 0, net = 0
  for (const l of lines) {
    gross += toPoishaExact(l.gross_salary)
    ded += toPoishaExact(l.deductions ?? 0)
    net += toPoishaExact(l.net_payable)
  }
  return db.payrollRun.update({
    where: { id: runId },
    data: { total_gross: money(gross), total_deductions: money(ded), total_net: money(net) },
  })
}

/** An issued run blocks its month while at least one of its run
 * lines still holds a LIVE (non-voided) payment. An issued run
 * whose payments were all voided through FR-14.1 no longer
 * blocks — the "unless the first is voided" leg of the rule. */
export async function isBlockingRun(db: Db, run: any): Promise<boolean> {
  if (!run || run.status !== 'issued') return false
  const lines = await db.payrollSheet.findMany({
    where: { payroll_run_id: run.id, origin: 'run', salary_payment_id: { not: null } },
    select: { salary_payment_id: true },
  })
  if (!lines.length) return false
  const live = await db.salaryPayment.count({
    where: { id: { in: lines.map((l: any) => l.salary_payment_id) }, status: { not: 'voided' } },
  })
  return live > 0
}

export async function findBlockingIssuedRun(db: Db, month: string, excludeRunId?: string): Promise<any | null> {
  const runs = await db.payrollRun.findMany({
    where: { month, status: 'issued', ...(excludeRunId ? { id: { not: excludeRunId } } : {}) },
    orderBy: { created_at: 'asc' },
  })
  for (const r of runs) {
    if (await isBlockingRun(db, r)) return r
  }
  return null
}

// ── Creation + drafting ─────────────────────────────────────────

/** Draft the month's already-issued payments into the run as
 * review lines (origin 'existing_payment', status 'paid'). These
 * are NEVER re-paid by the run; they exist so the run shows the
 * month's full salary picture in one place. */
async function draftReviewLines(db: Db, run: any): Promise<number> {
  const { start, end } = monthBounds(run.month)
  const payments = await db.salaryPayment.findMany({
    where: { payment_date: { gte: start, lt: end } },
    orderBy: { payment_date: 'asc' },
  })
  let count = 0
  for (const p of payments) {
    const emp = await db.profile.findUnique({
      where: { id: p.employee_id },
      select: { full_name: true },
    })
    await db.payrollSheet.create({
      data: {
        user_id: p.employee_id,
        month_year: run.month,
        total_payable_days: 0,
        gross_salary: p.amount,
        deductions: 0,
        net_payable: p.amount,
        status: 'paid',
        payroll_run_id: run.id,
        employee_name: emp?.full_name ?? null,
        branch_id: p.branch_id ?? null,
        basic: p.base_salary_at_time ?? p.amount,
        allowances: 0,
        overtime: p.overtime_amount ?? 0,
        bonus: p.bonus_amount ?? 0,
        commission: p.sales_commission ?? 0,
        tiffin: p.tiffin_bill ?? 0,
        salary_payment_id: p.id,
        origin: 'existing_payment',
      },
    })
    count++
  }
  return count
}

/** Suggested lines from salary_settings — ONLY where a settings
 * row exists (the table is empty today; callers surface the count
 * and say so). Suggestions are returned, not persisted: the admin
 * adds the ones that apply. */
export async function suggestedLines(db: Db, run: any): Promise<any[]> {
  const settings = await db.salarySetting.findMany({})
  if (!settings.length) return []
  const existing = await db.payrollSheet.findMany({
    where: { payroll_run_id: run.id, status: { not: 'voided' } },
    select: { user_id: true },
  })
  const taken = new Set(existing.map((l: any) => l.user_id))
  const out: any[] = []
  for (const s of settings) {
    if (!s.user_id || taken.has(s.user_id)) continue
    const emp = await db.profile.findUnique({
      where: { id: s.user_id },
      select: { id: true, full_name: true, branch_id: true },
    })
    if (!emp) continue
    const allowances = sumMoney([n(s.house_rent_allowance), n(s.medical_allowance), n(s.transport_allowance)])
    out.push({
      employee_id: emp.id,
      employee_name: emp.full_name,
      branch_id: emp.branch_id ?? null,
      basic: n(s.base_salary),
      allowances,
      source: 'salary_settings',
    })
  }
  return out
}

export async function createRun(db: Db, caller: any, input: { month: unknown; notes?: string | null }): Promise<any> {
  const month = assertMonth(input.month)
  const blocking = await findBlockingIssuedRun(db, month)
  if (blocking) {
    throw new PayrollError(
      409,
      `An issued payroll run already exists for ${month} (run ${blocking.id.slice(0, 8)}). ` +
      'Void its payments first, or work with that run — a month is never paid twice.'
    )
  }
  const run = await db.payrollRun.create({
    data: { month, status: 'draft', notes: input.notes ?? null, created_by: caller?.id ?? null },
  })
  const reviewCount = await draftReviewLines(db, run)
  await recomputeRunTotals(db, run.id)
  await logAudit({
    caller: caller ?? null, action: 'payroll.run_created', eventType: 'create',
    entityTable: 'payroll_runs', entityId: run.id,
    newValue: { month, review_lines: reviewCount } as any,
  })
  return getRunDetail(db, run.id)
}

// ── Reads ───────────────────────────────────────────────────────

export async function listRuns(db: Db): Promise<any> {
  const runs = await db.payrollRun.findMany({ orderBy: [{ month: 'desc' }, { created_at: 'desc' }] })
  const out: any[] = []
  for (const r of runs) {
    const [lineCount, paidCount, reviewCount, period] = await Promise.all([
      db.payrollSheet.count({ where: { payroll_run_id: r.id, origin: 'run', status: { not: 'voided' } } }),
      db.payrollSheet.count({ where: { payroll_run_id: r.id, origin: 'run', status: 'paid' } }),
      db.payrollSheet.count({ where: { payroll_run_id: r.id, origin: 'existing_payment' } }),
      periodForMonth(db, r.month),
    ])
    out.push({
      ...r,
      line_count: lineCount,
      paid_line_count: paidCount,
      review_line_count: reviewCount,
      period_status: period?.status ?? null,
      blocking: await isBlockingRun(db, r),
    })
  }
  const settingsCount = await db.salarySetting.count()
  return { runs: out, salary_settings_count: settingsCount }
}

export async function getRunDetail(db: Db, runId: string): Promise<any> {
  const run = await db.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new PayrollError(404, 'Payroll run not found')
  const lines = await db.payrollSheet.findMany({
    where: { payroll_run_id: runId },
    orderBy: [{ origin: 'asc' }, { employee_name: 'asc' }, { created_at: 'asc' }],
  })
  const detailed: any[] = []
  for (const l of lines) {
    const emp = l.user_id
      ? await db.profile.findUnique({
          where: { id: l.user_id },
          select: { id: true, full_name: true, branch_id: true, bank_info: true },
        })
      : null
    const accounts = l.user_id
      ? await db.employeeSalaryAccount.findMany({
          where: { employee_id: l.user_id },
          orderBy: [{ is_active: 'desc' }, { created_at: 'asc' }],
        })
      : []
    const payment = l.salary_payment_id
      ? await db.salaryPayment.findUnique({
          where: { id: l.salary_payment_id },
          select: { id: true, status: true, amount: true, transaction_id: true, payment_date: true },
        })
      : null
    detailed.push({ ...l, employee: emp, salary_accounts: accounts, payment })
  }
  const period = await periodForMonth(db, run.month)
  const settingsCount = await db.salarySetting.count()
  const suggestions = run.status === 'draft' ? await suggestedLines(db, run) : []
  return {
    run: { ...run, period_status: period?.status ?? null, blocking: await isBlockingRun(db, run) },
    lines: detailed,
    salary_settings_count: settingsCount,
    suggestions,
  }
}

/** Employees the line form may pick (same population as the Issue
 * Salary modal's default list). */
export async function listEmployees(db: Db): Promise<any[]> {
  return db.profile.findMany({
    where: { profile_type: { in: ['employee', 'head_office', 'branch_manager'] } },
    select: { id: true, full_name: true, branch_id: true, salary: true, bank_info: true },
    orderBy: { full_name: 'asc' },
  })
}

// ── Line editing (draft runs only) ──────────────────────────────

function parseComponents(input: any): {
  basic: number; allowances: number; overtime: number; bonus: number
  commission: number; tiffin: number; deductions: number
  gross: number; net: number; breakdown: any
} {
  const comp = (v: unknown) => {
    if (v === undefined || v === null || v === '') return 0
    const parsed = parseMoneyAmount(v)
    if (parsed === null) throw new PayrollError(400, 'Invalid money amount in line components.')
    return parsed
  }
  const basic = comp(input.basic)
  const allowances = comp(input.allowances)
  const overtime = comp(input.overtime)
  const bonus = comp(input.bonus)
  const commission = comp(input.commission)
  const tiffin = comp(input.tiffin)
  const deductions = comp(input.deductions)
  let breakdown: any = null
  if (input.deduction_breakdown !== undefined && input.deduction_breakdown !== null) {
    if (!Array.isArray(input.deduction_breakdown)) {
      throw new PayrollError(400, 'deduction_breakdown must be a list of {label, amount}.')
    }
    let sum = 0
    breakdown = input.deduction_breakdown.map((d: any) => {
      const amt = comp(d?.amount)
      sum = sumMoney([sum, amt])!
      return { label: String(d?.label ?? '').slice(0, 120), amount: amt }
    })
    if (toPoishaExact(sum) !== toPoishaExact(deductions)) {
      throw new PayrollError(400, 'deduction_breakdown amounts must sum to the deductions total.')
    }
  }
  const gross = sumMoney([basic, allowances, overtime, bonus, commission, tiffin])!
  const net = sumMoney([gross, -deductions])!
  if (gross <= 0) throw new PayrollError(400, 'A payroll line needs a positive gross.')
  if (net <= 0) throw new PayrollError(400, 'Deductions cannot meet or exceed the gross — net must be positive.')
  return { basic, allowances, overtime, bonus, commission, tiffin, deductions, gross, net, breakdown }
}

function assertDraftRun(run: any, what: string) {
  if (run.status !== 'draft') {
    throw new PayrollError(409, `Lines can only be ${what} while the run is a draft (current status: ${run.status}).`)
  }
}

export async function addLine(db: Db, caller: any, runId: string, input: any): Promise<any> {
  const run = await db.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new PayrollError(404, 'Payroll run not found')
  assertDraftRun(run, 'added')
  const employeeId = input.employee_id
  if (!employeeId) throw new PayrollError(400, 'employee_id is required')
  const emp = await db.profile.findUnique({
    where: { id: employeeId },
    select: { id: true, full_name: true, branch_id: true },
  })
  if (!emp) throw new PayrollError(404, 'Employee not found')
  const dupe = await db.payrollSheet.findFirst({
    where: { payroll_run_id: runId, user_id: employeeId, origin: 'run', status: { not: 'voided' } },
    select: { id: true },
  })
  if (dupe) {
    throw new PayrollError(409, `${emp.full_name} already has a line in this run — edit that line instead.`)
  }
  const c = parseComponents(input)
  const days = input.total_payable_days === undefined || input.total_payable_days === null || input.total_payable_days === ''
    ? 0
    : Number(input.total_payable_days)
  if (!Number.isFinite(days) || days < 0) throw new PayrollError(400, 'total_payable_days must be a non-negative number.')
  const line = await db.payrollSheet.create({
    data: {
      user_id: employeeId,
      month_year: run.month,
      total_payable_days: days,
      gross_salary: c.gross,
      deductions: c.deductions,
      net_payable: c.net,
      status: 'draft',
      payroll_run_id: runId,
      employee_name: emp.full_name,
      branch_id: input.branch_id || emp.branch_id || null,
      basic: c.basic,
      allowances: c.allowances,
      overtime: c.overtime,
      bonus: c.bonus,
      commission: c.commission,
      tiffin: c.tiffin,
      deduction_breakdown: c.breakdown ?? undefined,
      origin: 'run',
    },
  })
  await recomputeRunTotals(db, runId)
  await logAudit({
    caller: caller ?? null, action: 'payroll.line_added', eventType: 'create',
    entityTable: 'payroll_sheets', entityId: line.id, branchId: line.branch_id,
    newValue: { run_id: runId, employee_id: employeeId, gross: c.gross, deductions: c.deductions, net: c.net } as any,
  })
  return line
}

export async function updateLine(db: Db, caller: any, runId: string, lineId: string, input: any): Promise<any> {
  const run = await db.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new PayrollError(404, 'Payroll run not found')
  assertDraftRun(run, 'edited')
  const line = await db.payrollSheet.findFirst({ where: { id: lineId, payroll_run_id: runId } })
  if (!line) throw new PayrollError(404, 'Payroll line not found')
  if (line.origin !== 'run') {
    throw new PayrollError(409, 'Review lines mirror payments issued via Issue Salary — they are read-only here.')
  }
  const c = parseComponents(input)
  const updated = await db.payrollSheet.update({
    where: { id: lineId },
    data: {
      gross_salary: c.gross,
      deductions: c.deductions,
      net_payable: c.net,
      basic: c.basic,
      allowances: c.allowances,
      overtime: c.overtime,
      bonus: c.bonus,
      commission: c.commission,
      tiffin: c.tiffin,
      deduction_breakdown: c.breakdown ?? undefined,
      branch_id: input.branch_id !== undefined ? (input.branch_id || null) : line.branch_id,
    },
  })
  await recomputeRunTotals(db, runId)
  await logAudit({
    caller: caller ?? null, action: 'payroll.line_updated', eventType: 'update',
    entityTable: 'payroll_sheets', entityId: lineId, branchId: updated.branch_id,
    fieldChanges: diffFields(line as any, updated as any, ['gross_salary', 'deductions', 'net_payable']),
  })
  return updated
}

export async function deleteLine(db: Db, caller: any, runId: string, lineId: string): Promise<any> {
  const run = await db.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new PayrollError(404, 'Payroll run not found')
  assertDraftRun(run, 'removed')
  const line = await db.payrollSheet.findFirst({ where: { id: lineId, payroll_run_id: runId } })
  if (!line) throw new PayrollError(404, 'Payroll line not found')
  await db.payrollSheet.delete({ where: { id: lineId } })
  await recomputeRunTotals(db, runId)
  await logAudit({
    caller: caller ?? null, action: 'payroll.line_deleted', eventType: 'delete',
    entityTable: 'payroll_sheets', entityId: lineId,
    oldValue: { run_id: runId, employee_id: line.user_id, origin: line.origin, net: n(line.net_payable) } as any,
  })
  return { deleted: true }
}

// ── A5 register mirror ──────────────────────────────────────────

/** Mirror the run's unpaid own-lines into the A5 register as
 * Salary Payable (called at approval; idempotent upserts). */
export async function syncPayrollPayables(db: Db, run: any): Promise<void> {
  const { endDay } = monthBounds(run.month)
  const lines = await db.payrollSheet.findMany({
    where: { payroll_run_id: run.id, origin: 'run', status: { not: 'voided' } },
  })
  for (const l of lines) {
    const payment = l.salary_payment_id
      ? await db.salaryPayment.findUnique({ where: { id: l.salary_payment_id }, select: { status: true } })
      : null
    const settled = !!payment && payment.status !== 'voided'
    const party = await ensureProfileParty(db, l.user_id, l.employee_name)
    const existing = await db.payableReceivable.findFirst({
      where: { source_table: 'payroll_sheets', source_id: l.id, direction: 'payable' },
      select: { id: true },
    })
    const data = {
      counterparty_id: party?.id ?? null,
      description: `Salary payable — ${l.employee_name ?? 'Employee'} — ${run.month}`,
      amount: l.net_payable,
      paid_amount: settled ? l.net_payable : 0,
      due_date: endDay,
      status: settled ? 'settled' : 'open',
      branch_id: l.branch_id ?? null,
    }
    if (existing) {
      await db.payableReceivable.update({ where: { id: existing.id }, data })
    } else {
      await db.payableReceivable.create({
        data: { direction: 'payable', source_table: 'payroll_sheets', source_id: l.id, ...data },
      })
    }
  }
}

async function settlePayrollPayable(db: Db, lineId: string): Promise<void> {
  const row = await db.payableReceivable.findFirst({
    where: { source_table: 'payroll_sheets', source_id: lineId, direction: 'payable' },
  })
  if (!row) return
  await db.payableReceivable.update({
    where: { id: row.id },
    data: { paid_amount: row.amount, status: 'settled' },
  })
}

async function reopenPayrollPayable(db: Db, lineId: string): Promise<void> {
  const row = await db.payableReceivable.findFirst({
    where: { source_table: 'payroll_sheets', source_id: lineId, direction: 'payable' },
  })
  if (!row) return
  await db.payableReceivable.update({
    where: { id: row.id },
    data: { paid_amount: 0, status: 'open' },
  })
}

// ── Lifecycle transitions ───────────────────────────────────────

export async function submitReview(db: Db, caller: any, runId: string): Promise<any> {
  const run = await db.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new PayrollError(404, 'Payroll run not found')
  if (run.status !== 'draft') throw new PayrollError(409, `Only a draft run can be submitted for review (current: ${run.status}).`)
  const count = await db.payrollSheet.count({
    where: { payroll_run_id: runId, origin: 'run', status: { not: 'voided' } },
  })
  if (!count) throw new PayrollError(400, 'A run with no payable lines cannot be submitted — add at least one line.')
  const updated = await db.payrollRun.update({ where: { id: runId }, data: { status: 'in_review' } })
  await logAudit({
    caller: caller ?? null, action: 'payroll.run_submitted', eventType: 'update',
    entityTable: 'payroll_runs', entityId: runId,
    fieldChanges: [{ field: 'status', old: 'draft', new: 'in_review' }],
  })
  return updated
}

export async function approveRun(db: Db, caller: any, runId: string): Promise<any> {
  const run = await db.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new PayrollError(404, 'Payroll run not found')
  if (run.status !== 'in_review') throw new PayrollError(409, `Only an in-review run can be approved (current: ${run.status}).`)
  const updated = await db.payrollRun.update({
    where: { id: runId },
    data: { status: 'approved', approved_by: caller?.id ?? null, approved_at: new Date() },
  })
  // Unpaid run lines become Salary Payable in the A5 register.
  await syncPayrollPayables(db, updated)
  await logAudit({
    caller: caller ?? null, action: 'payroll.run_approved', eventType: 'update',
    entityTable: 'payroll_runs', entityId: runId,
    fieldChanges: [{ field: 'status', old: 'in_review', new: 'approved' }],
    newValue: { total_net: n(updated.total_net) } as any,
  })
  return updated
}

/** Fold allowances (+) and deductions (−) into the payment's
 * component slots so the shared service's recomputed total equals
 * the line NET exactly. Deductions come off the basic component
 * first (basic already carries allowances), then overtime, bonus,
 * commission, tiffin. */
function foldComponents(line: any): { basic: number; overtime: number; bonus: number; commission: number; tiffin: number } {
  const slots = [
    sumMoney([n(line.basic), n(line.allowances)])!,
    n(line.overtime),
    n(line.bonus),
    n(line.commission),
    n(line.tiffin),
  ]
  let remaining = toPoishaExact(line.deductions ?? 0)
  const folded = slots.map((v) => {
    const p = toPoishaExact(v)
    const take = Math.min(p, remaining)
    remaining -= take
    return (p - take) / 100
  })
  return { basic: folded[0], overtime: folded[1], bonus: folded[2], commission: folded[3], tiffin: folded[4] }
}

export async function issueRun(db: Db, caller: any, runId: string, req?: Request): Promise<any> {
  const run = await db.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new PayrollError(404, 'Payroll run not found')
  if (run.status !== 'approved') {
    throw new PayrollError(409, `Only an approved run can be issued (current: ${run.status}).`)
  }
  const blocking = await findBlockingIssuedRun(db, run.month, runId)
  if (blocking) {
    throw new PayrollError(
      409,
      `Run ${blocking.id.slice(0, 8)} already issued live payments for ${run.month} — a month is never paid twice.`
    )
  }
  // A3 period respect: a closed/locked run month refuses the
  // issue and records the durable posting exception.
  const period = await periodForMonth(db, run.month)
  if (period && period.status !== 'open') {
    const err = new PeriodBlockedError({
      entry_date: `${run.month}-01`,
      month: run.month,
      status: period.status,
      source_table: 'payroll_runs',
      source_id: run.id,
      event_type: 'payroll_issue',
      memo: `Payroll issue refused — period ${run.month} is ${period.status}`,
    })
    await recordPostingException(db, err, { source_table: 'payroll_runs', source_id: run.id, event_type: 'payroll_issue' })
    throw new PayrollError(
      409,
      `The accounting period ${run.month} is ${period.status} — payroll for that month cannot be issued. ` +
      'Reopen the period (break-glass, with a reason) and retry, or void this run. The refusal has been recorded in the posting exceptions.'
    )
  }
  const heads = await db.ledgerHead.findMany({
    where: { name: { contains: 'Salary', mode: 'insensitive' } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  if (!heads.length) {
    throw new PayrollError(400, 'System Error: Salary Ledger Head not found. Please contact admin.')
  }
  const head = heads[0]

  const lines = await db.payrollSheet.findMany({
    where: { payroll_run_id: runId, origin: 'run', status: { not: 'voided' }, salary_payment_id: null },
    orderBy: { created_at: 'asc' },
  })
  if (!lines.length) throw new PayrollError(400, 'This run has no unpaid lines to issue.')

  const issued: any[] = []
  const failures: any[] = []
  for (const line of lines) {
    const emp = await db.profile.findUnique({
      where: { id: line.user_id },
      select: { branch_id: true, full_name: true },
    })
    const folded = foldComponents(line)
    // Accounts A7: when TDS_SALARY is configured, tax is withheld
    // at issue — computed on the line GROSS (the statutory base)
    // and passed through the shared service's deduction input;
    // the service records the register line + P11 journal leg.
    // Dormant (null) in the shipped state: the issue below is
    // then byte-identical to A6.
    const tds = await salaryTdsFor(db, toPoishaExact(line.gross_salary), dhakaToday())
    const breakdown = Array.isArray(line.deduction_breakdown) && line.deduction_breakdown.length
      ? ` (${line.deduction_breakdown.map((d: any) => `${d.label} ৳${d.amount}`).join(', ')})`
      : ''
    const notes =
      `Payroll ${run.month} (run ${runId.slice(0, 8)}): basic ৳${n(line.basic)} + allowances ৳${n(line.allowances)}` +
      ` + OT ৳${n(line.overtime)} + bonus ৳${n(line.bonus)} + commission ৳${n(line.commission)} + tiffin ৳${n(line.tiffin)}` +
      ` = gross ৳${n(line.gross_salary)}; deductions ৳${n(line.deductions)}${breakdown}; net ৳${n(line.net_payable)}.` +
      ' Allowances/deductions are folded into the payment basic component — the payroll line keeps the full breakdown.' +
      (tds
        ? ` TDS withheld ৳${taka(tds.tax_p)} at ${tds.rate_percent}% on the gross (VAT/TDS register) — net paid ৳${taka(toPoishaExact(line.net_payable) - tds.tax_p)}.`
        : '')
    try {
      const result = await issueSalaryPayment(caller, {
        employee_id: line.user_id,
        branch_id: line.branch_id ?? emp?.branch_id ?? null,
        basic_salary: folded.basic,
        overtime_amount: folded.overtime,
        bonus_amount: folded.bonus,
        sales_commission: folded.commission,
        tiffin_bill: folded.tiffin,
        ledger_head_id: head.id,
        notes,
        trx_suffix: line.id.slice(0, 8),
        ...(tds
          ? { deductions: [{ label: 'TDS', amount: tds.tax, tax_kind: 'tds_salary', rate_percent: tds.rate_percent }] }
          : {}),
      }, req)
      await db.payrollSheet.update({
        where: { id: line.id },
        data: { salary_payment_id: result.payment.id, status: 'paid' },
      })
      await settlePayrollPayable(db, line.id)
      issued.push({ line_id: line.id, payment_id: result.payment.id, amount: result.total_salary })
    } catch (err: any) {
      failures.push({
        line_id: line.id,
        employee_name: line.employee_name ?? emp?.full_name ?? null,
        error: err instanceof SalaryIssueError ? err.message : (err?.message || 'Issue failed'),
      })
    }
  }

  await recomputeRunTotals(db, runId)
  if (issued.length && !failures.length) {
    const updated = await db.payrollRun.update({
      where: { id: runId },
      data: { status: 'issued', issued_by: caller?.id ?? null, issued_at: new Date() },
    })
    await logAudit({
      caller: caller ?? null, action: 'payroll.run_issued', eventType: 'update',
      entityTable: 'payroll_runs', entityId: runId,
      fieldChanges: [{ field: 'status', old: 'approved', new: 'issued' }],
      newValue: { lines_issued: issued.length, total_net: n(updated.total_net), period_missing: !period } as any,
    })
    return { run: updated, issued, failures, period_missing: !period }
  }
  await logAudit({
    caller: caller ?? null, action: 'payroll.run_issue_partial', eventType: 'update',
    entityTable: 'payroll_runs', entityId: runId,
    newValue: { lines_issued: issued.length, lines_failed: failures.length } as any,
  })
  return { run: await db.payrollRun.findUnique({ where: { id: runId } }), issued, failures, period_missing: !period }
}

export async function voidRun(db: Db, caller: any, runId: string, reason: unknown): Promise<any> {
  const run = await db.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new PayrollError(404, 'Payroll run not found')
  const why = String(reason ?? '').trim()
  if (!why) throw new PayrollError(400, 'A reason is required to void a payroll run.')
  if (run.status === 'voided') throw new PayrollError(409, 'This run is already voided.')
  if (run.status === 'issued') {
    throw new PayrollError(
      409,
      'An issued run cannot be voided — its payments are live money records. ' +
      'Void individual payments from Salary Payments (each void reflects back onto its line), or leave the run as the record of what was paid.'
    )
  }
  const updated = await db.payrollRun.update({
    where: { id: runId },
    data: { status: 'voided', voided_by: caller?.id ?? null, voided_at: new Date(), void_reason: why },
  })
  await db.payrollSheet.updateMany({
    where: { payroll_run_id: runId, origin: 'run', status: { not: 'paid' } },
    data: { status: 'voided' },
  })
  // The run's register mirrors die with it.
  const lineIds = (await db.payrollSheet.findMany({
    where: { payroll_run_id: runId }, select: { id: true },
  })).map((l: any) => l.id)
  if (lineIds.length) {
    await db.payableReceivable.deleteMany({
      where: { source_table: 'payroll_sheets', source_id: { in: lineIds }, direction: 'payable' },
    })
  }
  await recomputeRunTotals(db, runId)
  await logAudit({
    caller: caller ?? null, action: 'payroll.run_voided', eventType: 'void',
    entityTable: 'payroll_runs', entityId: runId,
    fieldChanges: [
      { field: 'status', old: run.status, new: 'voided' },
      { field: 'reason', old: null, new: why },
    ],
  })
  return db.payrollRun.findUnique({ where: { id: runId } })
}

// ── FR-14.1 reflection ──────────────────────────────────────────

/**
 * Called (fail-soft) from the salary void route: a voided payment
 * reflects back onto the payroll line that issued it — the line
 * is marked voided, its register mirror reopens (the obligation
 * is owed again), and the run totals recompute. A review line
 * (origin 'existing_payment') is marked voided too — its payment
 * is gone; the line was only ever a mirror of it. Never throws.
 */
export async function hookPayrollPaymentVoided(db: Db, paymentId: string, caller?: any): Promise<void> {
  try {
    const line = await db.payrollSheet.findFirst({ where: { salary_payment_id: paymentId } })
    if (!line) return
    await db.payrollSheet.update({ where: { id: line.id }, data: { status: 'voided' } })
    if (line.origin === 'run') {
      await reopenPayrollPayable(db, line.id)
      if (line.payroll_run_id) await recomputeRunTotals(db, line.payroll_run_id)
    }
    await logAudit({
      caller: caller ?? null, action: 'payroll.line_void_reflected', eventType: 'void',
      entityTable: 'payroll_sheets', entityId: line.id,
      fieldChanges: [{ field: 'status', old: line.status, new: 'voided' }],
      newValue: { payment_id: paymentId, run_id: line.payroll_run_id } as any,
    })
  } catch (err: any) {
    console.error('[accounts] hookPayrollPaymentVoided failed (fail-soft):', err?.message || err)
  }
}
