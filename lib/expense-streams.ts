/**
 * Expense streams — the owner's expense model as ONE classifier.
 *
 * The owner separates spending into three streams (2026-10-31):
 *   1. BRANCH expenses   — money spent FROM a branch's cash drawer. An
 *      employee expense paid out of branch cash is a branch expense.
 *   2. COMPANY expenses  — money spent FROM the company (head-office)
 *      profile. Inside this stream, the ONE-TIME costs from when the
 *      company was first opened (AC, lights, furnishing…) are their own
 *      group ('setup'), distinct from ongoing spending ('operating').
 *      The split lives on company_expenses.expense_kind (migration
 *      20261031_expense_model.sql).
 *   3. LEDGER-HEAD expenses — the continually recurring costs that live
 *      under Ledger Heads (house rent, utility bills, salary…),
 *      grouped by head.
 *
 * This module is the single source of truth for assigning every expense
 * row to exactly ONE stream, so no report can ever count a row twice
 * (the historical failure mode: the financial summary merged all four
 * sources into one list under a synthesised 'company-general' bucket,
 * and salary survived in two places at once until C20 linked the
 * copies). Every sum goes through lib/money (integer poisha), so the
 * grand total is taka-exact.
 *
 * Classification of a branch_cash_expenses row — FIRST match wins:
 *   a. salary_payment_id set → EXCLUDED from every stream here. The row
 *      is the cash copy of a salary payment; the payment itself is
 *      counted once, in stream 3, from salary_payments (C20). The copy
 *      is reported in `excludedSalaryCopies` so the UI can disclose it.
 *   b. expense_request_id set → stream 1 (branch). It is an employee
 *      expense request settled out of branch cash — the branch stream
 *      wins even though the pay flow also stamps a ledger head on the
 *      row for categorisation.
 *   c. ledger_head_id set → stream 3, under that head (rent, bills and
 *      other recurring head expenses are issued under a head).
 *   d. otherwise → stream 1 (plain branch-cash spending), under its
 *      branch.
 *
 * Salary payments and partner payouts arrive pre-mapped to the ledger
 * head they belong to (the caller resolves the head, as the financial
 * summary always did) and land in stream 3. Company rows land in
 * stream 2, split by expenseKindOf(). Pre-migration rows (link columns
 * absent) classify on whatever fields exist — a salary copy whose link
 * column does not exist yet cannot be recognised, which is exactly the
 * pre-Batch-2 limitation C20 already documents.
 */

import { sumMoney } from './money'

export type ExpenseKind = 'setup' | 'operating'

/**
 * The company-expense kind of a row. Anything that is not an explicit
 * 'setup' is 'operating': pre-migration rows have no expense_kind at
 * all, and the migration backfills them to 'operating' — a one-time
 * opening cost must be a deliberate mark, never an accident of missing
 * data.
 */
export function expenseKindOf(row: { expense_kind?: unknown } | null | undefined): ExpenseKind {
  return row != null && row.expense_kind === 'setup' ? 'setup' : 'operating'
}

export interface BranchCashExpenseRow {
  amount?: number | string | null
  branch_id?: string | null
  branch_name?: string | null
  ledger_head_id?: string | null
  category?: string | null
  salary_payment_id?: string | null
  expense_request_id?: string | null
}

export interface CompanyExpenseRow {
  total_amount?: number | string | null
  expense_kind?: unknown
}

export interface HeadPaymentRow {
  amount?: number | string | null
  headId: string
  headName: string
}

export interface NamedRef {
  id: string
  name: string
}

/**
 * The stream ONE branch_cash_expenses row belongs to — the single-row
 * form of the classification documented at the top of this file:
 *   'salary-copy' — rule a: the cash copy of a salary payment; counted
 *                   once from salary_payments in the ledger-head
 *                   stream, never as a branch expense.
 *   'branch'      — rules b + d: an expense request settled out of
 *                   branch cash, or plain branch-cash spending. This
 *                   is the ONLY stream the branch accounts (Account
 *                   Overview, daily closing, drawer math) may count —
 *                   the owner's account-overview rule (2026-10-31).
 *   'ledger-head' — rule c: a recurring cost issued under a ledger
 *                   head (rent, bills…), counted under its head.
 */
export type BranchCashExpenseStream = 'branch' | 'ledger-head' | 'salary-copy'

export function branchCashExpenseStream(row: BranchCashExpenseRow): BranchCashExpenseStream {
  if (row.salary_payment_id) return 'salary-copy'
  if (row.expense_request_id || !row.ledger_head_id) return 'branch'
  return 'ledger-head'
}

/**
 * How much of a branch_cash_expenses row counts toward the BRANCH
 * stream (and therefore toward the branch cash ledger): the full
 * amount for branch-stream rows, 0 for ledger-head rows and salary
 * copies. Every branch-accounts aggregation and the ledger sync go
 * through this one function so the rule cannot drift between pages.
 */
export function branchStreamAmount(row: BranchCashExpenseRow): number {
  return branchCashExpenseStream(row) === 'branch' ? Number(row.amount ?? 0) : 0
}

export interface ExpenseStreams {
  branch: {
    total: number
    perBranch: Array<{ branchId: string | null; branchName: string; total: number; count: number }>
  }
  company: { setup: number; operating: number; total: number }
  ledgerHead: {
    total: number
    byHead: Array<{ id: string; name: string; total: number; count: number }>
  }
  /** Salary cash copies counted in NO stream (see rule a) — disclosed, never hidden. */
  excludedSalaryCopies: { count: number; total: number }
  /** branch.total + company.total + ledgerHead.total — every input row counted at most once. */
  grandTotal: number
}

export function classifyExpenseStreams(input: {
  branchCashExpenses: BranchCashExpenseRow[]
  companyExpenses: CompanyExpenseRow[]
  headPayments: HeadPaymentRow[]
  branches?: NamedRef[]
  ledgerHeads?: NamedRef[]
}): ExpenseStreams {
  const branches = input.branches || []
  const ledgerHeads = input.ledgerHeads || []

  const branchNameOf = (row: BranchCashExpenseRow): string => {
    if (row.branch_id) {
      const b = branches.find(x => x.id === row.branch_id)
      if (b) return b.name
    }
    return row.branch_name || 'Unassigned Branch'
  }

  const headNameOf = (row: BranchCashExpenseRow): string => {
    const lh = row.ledger_head_id ? ledgerHeads.find(x => x.id === row.ledger_head_id) : undefined
    if (lh) return lh.name
    return row.category || 'General Expense'
  }

  // ── Streams 1 + 3 from branch cash rows, and the salary-copy trap ──
  const perBranchMap = new Map<string, { branchId: string | null; branchName: string; amounts: number[]; count: number }>()
  const byHeadMap = new Map<string, { id: string; name: string; amounts: number[]; count: number }>()
  const excludedAmounts: number[] = []
  let excludedCount = 0

  const addToHead = (id: string, name: string, amount: number) => {
    const key = id || 'unassigned'
    const cur = byHeadMap.get(key) || { id: key, name, amounts: [] as number[], count: 0 }
    cur.amounts.push(amount)
    cur.count++
    byHeadMap.set(key, cur)
  }

  for (const row of input.branchCashExpenses) {
    const amount = Number(row.amount ?? 0)
    const stream = branchCashExpenseStream(row)
    if (stream === 'salary-copy') {
      // Rule a — the cash copy of a salary payment. Counted once via
      // salary_payments (stream 3); NEVER here.
      excludedAmounts.push(amount)
      excludedCount++
      continue
    }
    if (stream === 'branch') {
      // Rules b + d — branch stream.
      const key = row.branch_id || '__unassigned__'
      const cur = perBranchMap.get(key) || {
        branchId: row.branch_id || null,
        branchName: branchNameOf(row),
        amounts: [] as number[],
        count: 0,
      }
      cur.amounts.push(amount)
      cur.count++
      perBranchMap.set(key, cur)
    } else {
      // Rule c — ledger-head stream.
      addToHead(row.ledger_head_id as string, headNameOf(row), amount)
    }
  }

  // Salaries + payouts, pre-mapped to their head by the caller.
  for (const p of input.headPayments) {
    addToHead(p.headId, p.headName, Number(p.amount ?? 0))
  }

  // ── Stream 2: company expenses, setup vs operating ─────────────────
  const setupAmounts: number[] = []
  const operatingAmounts: number[] = []
  for (const row of input.companyExpenses) {
    const amount = Number(row.total_amount ?? 0)
    if (expenseKindOf(row) === 'setup') setupAmounts.push(amount)
    else operatingAmounts.push(amount)
  }

  const perBranch = [...perBranchMap.values()]
    .map(b => ({ branchId: b.branchId, branchName: b.branchName, total: sumMoney(b.amounts), count: b.count }))
    .sort((a, b) => b.total - a.total)
  const byHead = [...byHeadMap.values()]
    .map(h => ({ id: h.id, name: h.name, total: sumMoney(h.amounts), count: h.count }))
    .sort((a, b) => b.total - a.total)

  const branchTotal = sumMoney(perBranch.map(b => b.total))
  const ledgerHeadTotal = sumMoney(byHead.map(h => h.total))
  const companySetup = sumMoney(setupAmounts)
  const companyOperating = sumMoney(operatingAmounts)
  const companyTotal = sumMoney([companySetup, companyOperating])

  return {
    branch: { total: branchTotal, perBranch },
    company: { setup: companySetup, operating: companyOperating, total: companyTotal },
    ledgerHead: { total: ledgerHeadTotal, byHead },
    excludedSalaryCopies: { count: excludedCount, total: sumMoney(excludedAmounts) },
    grandTotal: sumMoney([branchTotal, companyTotal, ledgerHeadTotal]),
  }
}
