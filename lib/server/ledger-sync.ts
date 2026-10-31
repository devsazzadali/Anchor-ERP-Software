/**
 * Ledger sync services — the app's replacement for the two
 * money-moving Postgres triggers of the old stack. The DB
 * logic is re-implemented as transactional server code:
 *
 *  - sync_deposit_to_cash_ledger (the fixed batch-1 version,
 *    proven by the mirror tests, 15/15) -> syncDepositToLedger
 *  - sync_expense_to_cash_ledger
 *    (the fixed expense-trigger version)
 *    -> syncExpenseToLedger
 *
 * Both run INSIDE the caller's Prisma transaction, so a deposit or
 * expense write and its ledger movement commit or roll back together
 * — the property the trigger gave the old stack, kept.
 *
 * Deposit algorithm: compute what the deposit contributed BEFORE
 * (old row) and AFTER (new row) and move exactly the difference.
 * A contribution exists only while the deposit is approved and not
 * reversed. NO GREATEST(0,...) clamps: a subtraction only ever
 * removes what this same deposit previously added, so one deposit can
 * never eat another deposit's money (B25) and never double-count
 * (B23/B24). Strict mode (rows this write creates or changes) rejects
 * malformed breakdowns loudly instead of distributing 0.
 *
 * DRAWER MODEL (closing fix, 2026-10-31 — diagnosis §D5 #1): for
 * drawer math (branch_cash_ledger.bank_deposits_out) an approved
 * deposit is now subtracted in ONE LUMP on its deposit_date — the
 * day the cash physically leaves the drawer. The daily_breakdown
 * slices are still stored on the deposit and still used for
 * REPORTING attribution (depositDistributionMap below is unchanged),
 * but they no longer drive bank_deposits_out.
 *
 * TRANSITION RULE — historical ledger rows are never rewritten in
 * bulk. Deposits approved BEFORE this fix were synced as slices, and
 * those slices are what actually sit in the ledger. So the BEFORE
 * side of a sync must remove the contribution under the model that
 * actually applied to that deposit, while the AFTER side always adds
 * under the new lump model:
 *   - a deposit carries the marker tag [LEDGER_MODEL:lump] in its
 *     notes once this code has added a lump contribution for it
 *     (stamped by syncDepositToLedger itself, in the same
 *     transaction — the same notes-tag pattern the deposits route
 *     already uses for [DAILY_BREAKDOWN:…] / [KHUCHRA_AMOUNT:…]);
 *   - old row WITH the tag    → remove the lump on deposit_date;
 *   - old row WITHOUT the tag → pre-fix deposit: remove the legacy
 *     slice distribution, exactly what was originally applied.
 * Editing a pre-fix deposit therefore transitions it (slices out,
 * lump in, tag stamped); editing it again afterwards removes the
 * lump, because the tag is now present. A deposit that is not
 * approved contributes nothing under either model, so the tag is
 * irrelevant while a deposit is draft/submitted/rejected/reversed.
 *
 * Expense algorithm: same before/after discipline. The old trigger
 * clamped subtractions with GREATEST(0, ...); the app subtracts
 * exactly what the expense itself added (same reasoning as B25 —
 * documented deviation from sync_expense_trigger_fix.sql, behaviour
 * differs only when the ledger was already inconsistent).
 *
 * Expense STREAM rule (owner's account-overview rule, 2026-10-31):
 * the ledger's cash_expenses is the branch's DRAWER figure, so only
 * the BRANCH stream of a branch_cash_expenses row may move it —
 * branchStreamAmount() (lib/expense-streams) is the contribution:
 * full amount for branch-stream rows, 0 for ledger-head rows and
 * salary copies. A rent or salary row recorded against the branch
 * therefore never drains the drawer figure; it is counted under its
 * ledger head / from salary_payments instead.
 */
import { Prisma } from '@prisma/client'
import { branchStreamAmount } from '../expense-streams'

type Tx = Prisma.TransactionClient

export interface DepositSyncShape {
  // id + notes are optional so hand-built shapes keep working; the
  // real callers pass full Prisma rows, which carry both. The id lets
  // the sync stamp the lump-model marker (see the header comment);
  // the notes carry that marker.
  id?: string
  branch_id: string
  amount: number | Prisma.Decimal
  deposit_date: Date | string
  daily_breakdown: unknown
  status: string
  is_reversed: boolean | null
  notes?: string | null
}

export interface ExpenseSyncShape {
  branch_id: string
  amount: number | Prisma.Decimal
  expense_date: Date | string
  // Stream links (lib/expense-streams classification). Optional for
  // hand-built shapes; a row described without them is treated as a
  // plain branch-cash expense — the historical shape of this sync.
  salary_payment_id?: string | null
  expense_request_id?: string | null
  ledger_head_id?: string | null
}

function dateKey(d: Date | string): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  return String(d).slice(0, 10)
}

function num(v: number | Prisma.Decimal): number {
  return typeof v === 'number' ? v : v.toNumber()
}

/** Notes tag marking a deposit whose ledger contribution was added
 *  under the lump drawer model (see the header comment). */
export const DEPOSIT_LUMP_TAG = '[LEDGER_MODEL:lump]'

export type DepositLedgerModel = 'lump' | 'legacy-slices'

/**
 * The drawer model that actually applied to a deposit row: 'lump'
 * only when the row carries the marker this code stamps when it adds
 * a lump contribution; every other approved deposit is a pre-fix
 * deposit whose money reached the ledger as breakdown slices.
 */
export function depositLedgerModelOf(row: { notes?: string | null } | null | undefined): DepositLedgerModel {
  return row && typeof row.notes === 'string' && row.notes.includes(DEPOSIT_LUMP_TAG)
    ? 'lump'
    : 'legacy-slices'
}

/** The lump drawer distribution: the whole amount on deposit_date. */
export function depositLumpDistributionMap(
  amount: number,
  depositDate: Date | string
): Map<string, number> {
  const map = new Map<string, number>()
  map.set(dateKey(depositDate), amount)
  return map
}

/**
 * Mirror of deposit_distribution_map(). Returns { 'YYYY-MM-DD': amt }.
 * In legacy mode (strict=false) malformed entries are ignored exactly
 * as the SQL ignores them; in strict mode they throw.
 *
 * This is now the LEGACY / REPORTING distribution: it describes how
 * pre-fix deposits were (and for reporting still are) attributed to
 * sales days. Drawer math for new contributions uses
 * depositLumpDistributionMap instead.
 */
export function depositDistributionMap(
  amount: number,
  depositDate: Date | string,
  breakdown: unknown,
  strict: boolean
): Map<string, number> {
  const map = new Map<string, number>()
  if (
    breakdown !== null &&
    breakdown !== undefined &&
    typeof breakdown === 'object' &&
    !Array.isArray(breakdown) &&
    Object.keys(breakdown as Record<string, unknown>).length > 0
  ) {
    let sum = 0
    for (const [key, raw] of Object.entries(breakdown as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
        if (strict) throw new Error(`deposit breakdown has invalid date key: ${key}`)
        continue
      }
      const value = raw === null || raw === undefined || raw === '' ? NaN : Number(raw)
      if (!Number.isFinite(value) || value < 0) {
        if (strict) throw new Error(`deposit breakdown has a negative amount for ${key}`)
        continue
      }
      sum += value
      if (value > 0) map.set(key, value)
    }
    if (strict && Math.round(sum * 100) !== Math.round(amount * 100)) {
      throw new Error(`deposit breakdown total (${sum}) does not equal deposit amount (${amount})`)
    }
    return map
  }
  map.set(dateKey(depositDate), amount)
  return map
}

function contributionOf(
  row: DepositSyncShape | null,
  strict: boolean,
  model: DepositLedgerModel
): { branchId: string; map: Map<string, number> } | null {
  if (!row) return null
  if (row.status !== 'approved' || row.is_reversed === true) {
    return { branchId: row.branch_id, map: new Map() }
  }
  if (model === 'lump') {
    // The breakdown no longer distributes drawer money, but strict
    // writes keep the old loud validation of it (the slices must
    // still sum to the amount — reports attribute by them), so run
    // the legacy map purely as a validator and discard its result.
    if (strict) depositDistributionMap(num(row.amount), row.deposit_date, row.daily_breakdown, true)
    return {
      branchId: row.branch_id,
      map: depositLumpDistributionMap(num(row.amount), row.deposit_date),
    }
  }
  return {
    branchId: row.branch_id,
    map: depositDistributionMap(num(row.amount), row.deposit_date, row.daily_breakdown, strict),
  }
}

/**
 * The cash-difference rule (old system: BEFORE INSERT/UPDATE trigger
 * recalculate_cash_difference; expected_closing_cash itself is a
 * GENERATED column and is never written). When actual_cash is NULL
 * the difference and status are NULL; otherwise difference =
 * actual − expected, status matched/shortage/excess. In the app
 * this runs in code wherever a trigger column changes.
 */
export function cashDifferencePatch(row: {
  opening_cash?: number | Prisma.Decimal | null
  cash_sales?: number | Prisma.Decimal | null
  other_cash_in?: number | Prisma.Decimal | null
  cash_expenses?: number | Prisma.Decimal | null
  bank_deposits_out?: number | Prisma.Decimal | null
  expected_closing_cash?: number | Prisma.Decimal | null
  actual_cash?: number | Prisma.Decimal | null
}): { cash_difference: number | null; difference_status: string | null } {
  if (row.actual_cash === null || row.actual_cash === undefined) {
    return { cash_difference: null, difference_status: null }
  }
  const n0 = (v: any): number => (v === null || v === undefined ? 0 : num(v))
  const expected =
    row.expected_closing_cash !== null && row.expected_closing_cash !== undefined
      ? n0(row.expected_closing_cash)
      : n0(row.opening_cash) +
        n0(row.cash_sales) +
        n0(row.other_cash_in) -
        n0(row.cash_expenses) -
        n0(row.bank_deposits_out)
  const diff = Math.round((num(row.actual_cash as any) - expected) * 100) / 100
  return {
    cash_difference: diff,
    difference_status: diff === 0 ? 'matched' : diff < 0 ? 'shortage' : 'excess',
  }
}

/** Recompute and persist a ledger row's difference after its money
 *  columns moved (trigger parity for sync-driven changes). */
export async function refreshLedgerDifference(tx: Tx, branchId: string, date: string) {
  const row = await tx.branchCashLedger.findUnique({
    where: { branch_id_ledger_date: { branch_id: branchId, ledger_date: new Date(`${date}T00:00:00.000Z`) } },
  })
  if (!row) return
  const patch = cashDifferencePatch(row as any)
  if (
    (row.cash_difference === null) !== (patch.cash_difference === null) ||
    (row.cash_difference !== null && patch.cash_difference !== null &&
      num(row.cash_difference as any) !== patch.cash_difference) ||
    row.difference_status !== patch.difference_status
  ) {
    await tx.branchCashLedger.update({ where: { id: row.id }, data: patch })
  }
}

async function adjustLedger(
  tx: Tx,
  branchId: string,
  date: string,
  delta: number,
  field: 'bank_deposits_out' | 'cash_expenses'
) {
  if (delta === 0) return
  if (delta > 0) {
    // Upsert-add (mirrors the SQL INSERT ... ON CONFLICT DO UPDATE).
    await tx.branchCashLedger.upsert({
      where: { branch_id_ledger_date: { branch_id: branchId, ledger_date: new Date(`${date}T00:00:00.000Z`) } },
      create: { branch_id: branchId, ledger_date: new Date(`${date}T00:00:00.000Z`), [field]: delta },
      update: { [field]: { increment: delta }, updated_at: new Date() },
    })
  } else {
    // Subtract exactly what was added before; a missing row is a
    // no-op, exactly like the SQL UPDATE.
    await tx.branchCashLedger.updateMany({
      where: { branch_id: branchId, ledger_date: new Date(`${date}T00:00:00.000Z`) },
      data: { [field]: { increment: delta }, updated_at: new Date() },
    })
  }
  // The old system's ledger trigger recomputed the day's cash
  // difference whenever deposits/expenses moved — keep parity.
  await refreshLedgerDifference(tx, branchId, date)
}

/**
 * Move a deposit's ledger contribution from `oldRow` to `newRow`.
 * Pass oldRow=null for INSERT, newRow=null for DELETE.
 * Strict validation applies when the new row is created, or when its
 * amount/breakdown changed (the SQL trigger's rule).
 *
 * Transition rule (see the header comment): the old contribution is
 * removed under the model that actually applied to the old row
 * (marker tag → lump; no tag → legacy slices), and the new
 * contribution is always added under the lump model. When a lump
 * contribution is added for a deposit row that exists in the DB, the
 * marker tag is stamped onto that row inside this same transaction,
 * so every later sync removes exactly what was added.
 */
export async function syncDepositToLedger(
  tx: Tx,
  oldRow: DepositSyncShape | null,
  newRow: DepositSyncShape | null
) {
  let strictNew = false
  if (newRow && !oldRow) strictNew = true
  else if (newRow && oldRow) {
    strictNew =
      num(newRow.amount) !== num(oldRow.amount) ||
      JSON.stringify(newRow.daily_breakdown ?? null) !== JSON.stringify(oldRow.daily_breakdown ?? null)
  }

  const oldC = contributionOf(oldRow, false, oldRow ? depositLedgerModelOf(oldRow) : 'legacy-slices')
  const newC = contributionOf(newRow, strictNew, 'lump')

  if (oldC) {
    for (const [date, amt] of oldC.map) {
      await adjustLedger(tx, oldC.branchId, date, -amt, 'bank_deposits_out')
    }
  }
  if (newC) {
    for (const [date, amt] of newC.map) {
      await adjustLedger(tx, newC.branchId, date, amt, 'bank_deposits_out')
    }
  }

  // Stamp the lump-model marker on the deposit row itself (same
  // notes-tag pattern as [DAILY_BREAKDOWN:…]). Only when a lump
  // contribution was actually added and the row is a real DB row;
  // hand-built shapes without an id, and transactions in tests
  // without the deposit model, simply skip the stamp.
  if (
    newRow?.id &&
    newC &&
    newC.map.size > 0 &&
    depositLedgerModelOf(newRow) !== 'lump' &&
    typeof (tx as any).branchBankDeposit?.update === 'function'
  ) {
    const notes = typeof newRow.notes === 'string' && newRow.notes ? newRow.notes : ''
    await (tx as any).branchBankDeposit.update({
      where: { id: newRow.id },
      data: { notes: notes ? `${notes}\n${DEPOSIT_LUMP_TAG}` : DEPOSIT_LUMP_TAG },
    })
  }
}

/**
 * Deposit-drift check (closing fix, 2026-10-31 — diagnosis §D5 #4):
 * for every branch/day in the window, compare the ledger's stored
 * bank_deposits_out against what the approved, non-reversed deposits
 * SHOULD have contributed under the model that actually applied to
 * each one (marker tag → lump on deposit_date; no tag → legacy
 * breakdown slices). Returns only the days where the two disagree;
 * drift = stored − allocated, so the known pre-fix gap (a breakdown
 * slice that never reached the ledger) reports as a NEGATIVE drift
 * of exactly the missing slice. Pure function over rows the caller
 * fetched — the reconciliation route feeds it live rows, tests feed
 * it fixtures or live rows directly.
 */
export interface DepositDriftDay {
  branch_id: string
  ledger_date: string
  allocated: number
  stored_bank_deposits_out: number
  drift: number
}

const round2 = (v: number): number => Math.round(v * 100) / 100

export function computeDepositDrift(
  deposits: Array<DepositSyncShape & { branch_id: string }>,
  ledgerRows: Array<{
    branch_id: string
    ledger_date: Date | string
    bank_deposits_out: number | Prisma.Decimal | null
  }>,
  window: { from: string; to: string }
): DepositDriftDay[] {
  const inWindow = (d: string) => d >= window.from && d <= window.to
  const key = (branchId: string, d: string) => `${branchId}|${d}`

  const allocated = new Map<string, number>()
  for (const dep of deposits) {
    const c = contributionOf(dep, false, depositLedgerModelOf(dep))
    if (!c) continue
    for (const [date, amt] of c.map) {
      if (!inWindow(date)) continue
      const k = key(c.branchId, date)
      allocated.set(k, round2((allocated.get(k) || 0) + amt))
    }
  }

  const stored = new Map<string, number>()
  for (const row of ledgerRows) {
    const d = dateKey(row.ledger_date as any)
    if (!inWindow(d)) continue
    stored.set(key(row.branch_id, d), num((row.bank_deposits_out ?? 0) as any))
  }

  const out: DepositDriftDay[] = []
  for (const k of new Set([...allocated.keys(), ...stored.keys()])) {
    const [branch_id, ledger_date] = k.split('|')
    const alloc = allocated.get(k) || 0
    const stor = stored.get(k) || 0
    const drift = round2(stor - alloc)
    if (drift !== 0) {
      out.push({
        branch_id,
        ledger_date,
        allocated: alloc,
        stored_bank_deposits_out: stor,
        drift,
      })
    }
  }
  out.sort((a, b) => a.branch_id.localeCompare(b.branch_id) || a.ledger_date.localeCompare(b.ledger_date))
  return out
}

/**
 * Move an expense's ledger contribution from `oldRow` to `newRow`
 * (branch and/or date and/or amount may all change). The contribution
 * is the row's BRANCH-stream amount (see the stream rule above): an
 * UPDATE that reclassifies a row (e.g. a ledger head is stamped on
 * it) moves its money OUT of the drawer figure, and vice versa.
 */
export async function syncExpenseToLedger(
  tx: Tx,
  oldRow: ExpenseSyncShape | null,
  newRow: ExpenseSyncShape | null
) {
  if (oldRow) {
    await adjustLedger(tx, oldRow.branch_id, dateKey(oldRow.expense_date), -branchStreamAmount(oldRow as any), 'cash_expenses')
  }
  if (newRow) {
    await adjustLedger(tx, newRow.branch_id, dateKey(newRow.expense_date), branchStreamAmount(newRow as any), 'cash_expenses')
  }
}
