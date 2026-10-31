/**
 * The ONE salary-issuing service (small-updates law U2, enforced
 * by Accounts A6): every salary payment in the system is created
 * here — the Issue Salary modal's route is a thin wrapper over
 * this function, and the Accounts payroll cycle (A6) disburses
 * through it too. There is exactly ONE salary-payment create call
 * in the codebase and it lives below; do not add another.
 *
 * Behaviour carried verbatim from the route's original inline
 * implementation (which itself carried the fixed copy's rules):
 *  - the total is RECOMPUTED on the server from the components
 *    (basic + overtime + bonus + commission + tiffin, poisha-exact
 *    via lib/money) — a client-supplied total is never stored;
 *  - C20: the branch-cash copy carries salary_payment_id, so
 *    combined reporting (the three-stream classifier) counts the
 *    salary ONCE, from salary_payments;
 *  - C11: the copy's category is the ledger head's NAME, resolved
 *    server-side from the head row — never a client string;
 *  - payment + cash copy + ledger movement commit in ONE
 *    transaction;
 *  - after commit: the S1 audit row and the Accounts A1 hooks
 *    (P5 journal post + A5 payables sync), both fail-soft in the
 *    same way the route always ran them.
 */
import { prisma } from '@/lib/db'
import { parseMoneyAmount, sumMoney } from '@/lib/money'
import { dhakaToday, dhakaDateOf } from '@/lib/dhaka-time'
import { syncExpenseToLedger } from '@/lib/server/ledger-sync'
import { logAudit, diffFields } from '@/lib/server/audit'
import { hookPostSource, hookSyncPayables, hookTaxSalary } from '@/lib/server/accounting/hooks'
import { salaryTdsFor } from '@/lib/server/accounting/tax'
import { toPoishaExact } from '@/lib/server/accounting/reports'

export class SalaryIssueError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'SalaryIssueError'
    this.status = status
  }
}

export interface SalaryIssueInput {
  employee_id: string
  branch_id?: string | null
  basic_salary?: unknown
  overtime_amount?: unknown
  bonus_amount?: unknown
  sales_commission?: unknown
  tiffin_bill?: unknown
  ledger_head_id: string
  payment_proof_url?: string | null
  account?: string | null
  /** Optional note stored on the payment (payroll disbursement
   * records its gross/deductions mapping here). The modal passes
   * none — behaviour unchanged. */
  notes?: string | null
  /** Optional suffix for the generated transaction id (batch
   * callers — payroll — pass a per-line suffix so ids stay unique
   * inside one millisecond). */
  trx_suffix?: string | null
  /** Accounts A7: deductions taken off the recomputed gross before
   * payment (advance recovery beyond payroll's fold, tax
   * withholding, …). The stored payment amount is the NET. A
   * deduction carrying tax_kind 'tds_salary' is the caller's own
   * TDS computation (payroll); when no such deduction is passed
   * and TDS_SALARY is enabled in Accounts → VAT & TDS, the service
   * applies the configured TDS itself — one application, never
   * two. With tax disabled (the shipped state) and no deductions
   * passed, behaviour is byte-identical to before A7. */
  deductions?: Array<{
    label?: string
    amount?: unknown
    tax_kind?: string | null
    rate_percent?: string | number | null
  }>
}

export interface SalaryDeductionApplied {
  label: string
  amount: number
  tax_kind: string | null
  rate_percent: string | null
}

export interface SalaryIssueResult {
  payment: any
  transaction_id: string
  /** The NET actually paid (gross − deductions). */
  total_salary: number
  /** Accounts A7: the recomputed gross before deductions. */
  gross_salary: number
  /** Accounts A7: the deductions applied (empty in the dormant state). */
  deductions: SalaryDeductionApplied[]
}

/**
 * Issue one salary payment. `caller` is the resolved admin caller
 * (getCallerProfile shape). Throws SalaryIssueError with the exact
 * status/message the issue route has always returned.
 */
export async function issueSalaryPayment(
  caller: any,
  input: SalaryIssueInput,
  req?: Request
): Promise<SalaryIssueResult> {
  const employeeId = input.employee_id
  const ledgerHeadId = input.ledger_head_id
  if (!employeeId) throw new SalaryIssueError(400, 'employee_id is required')
  if (!ledgerHeadId) {
    throw new SalaryIssueError(400, 'System Error: Salary Ledger Head not found. Please contact admin.')
  }

  const component = (v: unknown) => {
    if (v === undefined || v === null || v === '') return 0
    return parseMoneyAmount(v)
  }
  const basic = component(input.basic_salary)
  const overtime = component(input.overtime_amount)
  const bonus = component(input.bonus_amount)
  const commission = component(input.sales_commission)
  const tiffin = component(input.tiffin_bill)
  if ([basic, overtime, bonus, commission, tiffin].some((v) => v === null)) {
    throw new SalaryIssueError(400, 'Invalid salary component amount.')
  }
  // Server-recomputed total (never the client's).
  const totalSalary = sumMoney([basic!, overtime!, bonus!, commission!, tiffin!])
  if (totalSalary <= 0) throw new SalaryIssueError(400, 'Invalid employee or salary amount.')

  // Accounts A7 — deductions (see SalaryIssueInput.deductions).
  // Caller-passed deductions are taken as given; the configured
  // salary TDS is applied by the service itself only when the
  // caller did not already pass a TDS deduction.
  const deductions: SalaryDeductionApplied[] = []
  for (const d of input.deductions ?? []) {
    if (d?.amount === undefined || d?.amount === null || d?.amount === '') continue
    const amt = parseMoneyAmount(d.amount)
    if (amt === null || amt < 0) throw new SalaryIssueError(400, 'Invalid deduction amount.')
    if (amt > 0) {
      deductions.push({
        label: String(d?.label ?? 'Deduction').slice(0, 120),
        amount: amt,
        tax_kind: d?.tax_kind ?? null,
        rate_percent: d?.rate_percent != null ? String(d.rate_percent) : null,
      })
    }
  }
  let autoTds: SalaryDeductionApplied | null = null
  if (!deductions.some((d) => d.tax_kind === 'tds_salary')) {
    const tds = await salaryTdsFor(prisma as any, toPoishaExact(totalSalary), dhakaDateOf(new Date()))
    if (tds) {
      autoTds = { label: 'TDS', amount: tds.tax, tax_kind: 'tds_salary', rate_percent: tds.rate_percent }
      deductions.push(autoTds)
    }
  }
  const deductionTotal = deductions.length ? sumMoney(deductions.map((d) => d.amount))! : 0
  const netSalary = sumMoney([totalSalary, -deductionTotal])!
  if (deductionTotal > 0 && netSalary <= 0) {
    throw new SalaryIssueError(400, 'Deductions meet or exceed the salary amount.')
  }

  const [employee, head, branch] = await Promise.all([
    prisma.profile.findFirst({ where: { id: employeeId }, select: { id: true, full_name: true } }),
    prisma.ledgerHead.findFirst({ where: { id: ledgerHeadId }, select: { id: true, name: true } }),
    input.branch_id
      ? prisma.branch.findFirst({ where: { id: input.branch_id }, select: { id: true, name: true } })
      : Promise.resolve(null),
  ])
  if (!employee) throw new SalaryIssueError(404, 'Employee not found')
  if (!head) throw new SalaryIssueError(400, 'Ledger Head not found')

  const newTrxId = `SAL-${Date.now()}${input.trx_suffix ? `-${input.trx_suffix}` : ''}`
  const empName = employee.full_name || 'Employee'
  const descText = `Salary Payment for ${empName} (Basic: ${basic}${overtime! > 0 ? `, OT: ${overtime}` : ''}${bonus! > 0 ? `, Bonus: ${bonus}` : ''}${commission! > 0 ? `, Comm: ${commission}` : ''}${tiffin! > 0 ? `, Tiffin: ${tiffin}` : ''})${deductionTotal > 0 ? ` [net of deductions ৳${deductionTotal}]` : ''}`
  const today = dhakaToday()

  // A service-applied TDS is documented on the payment itself;
  // caller-passed deductions are documented by the caller's notes
  // (payroll writes its full breakdown, TDS included).
  let notesOut = input.notes ?? undefined
  if (autoTds) {
    const line = `TDS deducted ৳${autoTds.amount} at ${autoTds.rate_percent}% on gross ৳${totalSalary} (VAT/TDS register).`
    notesOut = notesOut ? `${notesOut} ${line}` : line
  }

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.salaryPayment.create({
      data: {
        employee_id: employeeId,
        branch_id: input.branch_id || null,
        amount: netSalary,
        base_salary_at_time: basic!,
        overtime_amount: overtime!,
        bonus_amount: bonus!,
        sales_commission: commission!,
        tiffin_bill: tiffin!,
        total_salary: netSalary,
        ledger_head_id: ledgerHeadId,
        payment_proof_url: input.payment_proof_url || '',
        account: input.account || null,
        transaction_id: newTrxId,
        notes: notesOut,
      },
    })

    // C20 cash copy — only when a branch funds it (branch_id is
    // NOT NULL on branch_cash_expenses; the fixed copy's insert
    // failed the same way when no branch was chosen).
    if (input.branch_id) {
      const expense = await tx.branchCashExpense.create({
        data: {
          branch_id: input.branch_id,
          branch_name: branch?.name || null,
          manager_id: caller.uid,
          manager_name: caller.full_name,
          ledger_head_id: ledgerHeadId,
          amount: netSalary,
          paid_amount: netSalary,
          due_amount: 0,
          expense_date: new Date(`${today}T00:00:00.000Z`),
          description: descText,
          // C11: category = the head's authoritative name.
          category: head.name || 'Salary',
          // C20: the link that stops the double count.
          salary_payment_id: created.id,
        },
      })
      await syncExpenseToLedger(tx, null, expense as any)
    }
    return created
  })

  await logAudit({
    caller, req, action: 'salary_payment.issue', eventType: 'create',
    entityTable: 'salary_payments', entityId: payment.id,
    branchId: input.branch_id || null,
    fieldChanges: diffFields(null, payment as any, ['amount', 'total_salary', 'employee_id']),
  })

  // Accounts A1 (P5): post the salary journal entry. Fail-soft —
  // a posting failure never fails the salary issue itself.
  await hookPostSource('salary_payments', payment.id, caller, 'salary')
  await hookSyncPayables('salary_payments', payment.id)

  // Accounts A7 (P11): when a TDS deduction was withheld, record
  // the tax leg (Dr 5010 / Cr TDS Payable) + the register line, so
  // the books carry the GROSS salary across P5 (net) + P11 (tax).
  // Fail-soft like every hook.
  const tdsApplied = deductions.find((d) => d.tax_kind === 'tds_salary')
  if (tdsApplied) {
    await hookTaxSalary(
      payment.id,
      { base: totalSalary, rate_percent: tdsApplied.rate_percent ?? '', amount: tdsApplied.amount },
      caller
    )
  }

  return { payment, transaction_id: newTrxId, total_salary: netSalary, gross_salary: totalSalary, deductions }
}
