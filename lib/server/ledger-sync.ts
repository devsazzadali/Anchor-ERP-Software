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
 * Deposit algorithm (identical to the canonical SQL): compute what
 * the deposit contributed BEFORE (old row) and AFTER (new row) and
 * move exactly the difference, per sales day. A contribution exists
 * only while the deposit is approved and not reversed; it is the
 * per-day breakdown when one is stored, otherwise the lump sum on
 * deposit_date. NO GREATEST(0,...) clamps: a subtraction only ever
 * removes what this same deposit previously added, so one deposit can
 * never eat another deposit's money (B25) and never double-count
 * (B23/B24). Strict mode (rows this write creates or changes) rejects
 * malformed breakdowns loudly instead of distributing 0.
 *
 * Expense algorithm: same before/after discipline. The old trigger
 * clamped subtractions with GREATEST(0, ...); the app subtracts
 * exactly what the expense itself added (same reasoning as B25 —
 * documented deviation from sync_expense_trigger_fix.sql, behaviour
 * differs only when the ledger was already inconsistent).
 */
import { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

export interface DepositSyncShape {
  branch_id: string
  amount: number | Prisma.Decimal
  deposit_date: Date | string
  daily_breakdown: unknown
  status: string
  is_reversed: boolean | null
}

export interface ExpenseSyncShape {
  branch_id: string
  amount: number | Prisma.Decimal
  expense_date: Date | string
}

function dateKey(d: Date | string): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  return String(d).slice(0, 10)
}

function num(v: number | Prisma.Decimal): number {
  return typeof v === 'number' ? v : v.toNumber()
}

/**
 * Mirror of deposit_distribution_map(). Returns { 'YYYY-MM-DD': amt }.
 * In legacy mode (strict=false) malformed entries are ignored exactly
 * as the SQL ignores them; in strict mode they throw.
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
  strict: boolean
): { branchId: string; map: Map<string, number> } | null {
  if (!row) return null
  if (row.status !== 'approved' || row.is_reversed === true) {
    return { branchId: row.branch_id, map: new Map() }
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

  const oldC = contributionOf(oldRow, false)
  const newC = contributionOf(newRow, strictNew)

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
}

/**
 * Move an expense's ledger contribution from `oldRow` to `newRow`
 * (branch and/or date and/or amount may all change).
 */
export async function syncExpenseToLedger(
  tx: Tx,
  oldRow: ExpenseSyncShape | null,
  newRow: ExpenseSyncShape | null
) {
  if (oldRow) {
    await adjustLedger(tx, oldRow.branch_id, dateKey(oldRow.expense_date), -num(oldRow.amount), 'cash_expenses')
  }
  if (newRow) {
    await adjustLedger(tx, newRow.branch_id, dateKey(newRow.expense_date), num(newRow.amount), 'cash_expenses')
  }
}
