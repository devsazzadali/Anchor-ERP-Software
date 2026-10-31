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
import { dhakaToday } from '@/lib/dhaka-time'
import { syncExpenseToLedger } from '@/lib/server/ledger-sync'
import { logAudit, diffFields } from '@/lib/server/audit'
import { hookPostSource, hookSyncPayables } from '@/lib/server/accounting/hooks'

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
}

export interface SalaryIssueResult {
  payment: any
  transaction_id: string
  total_salary: number
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
  const descText = `Salary Payment for ${empName} (Basic: ${basic}${overtime! > 0 ? `, OT: ${overtime}` : ''}${bonus! > 0 ? `, Bonus: ${bonus}` : ''}${commission! > 0 ? `, Comm: ${commission}` : ''}${tiffin! > 0 ? `, Tiffin: ${tiffin}` : ''})`
  const today = dhakaToday()

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.salaryPayment.create({
      data: {
        employee_id: employeeId,
        branch_id: input.branch_id || null,
        amount: totalSalary,
        base_salary_at_time: basic!,
        overtime_amount: overtime!,
        bonus_amount: bonus!,
        sales_commission: commission!,
        tiffin_bill: tiffin!,
        total_salary: totalSalary,
        ledger_head_id: ledgerHeadId,
        payment_proof_url: input.payment_proof_url || '',
        account: input.account || null,
        transaction_id: newTrxId,
        notes: input.notes ?? undefined,
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
          amount: totalSalary,
          paid_amount: totalSalary,
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

  return { payment, transaction_id: newTrxId, total_salary: totalSalary }
}
