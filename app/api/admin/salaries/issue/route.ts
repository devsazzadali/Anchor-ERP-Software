import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { parseMoneyAmount, sumMoney } from '@/lib/money'
import { dhakaToday } from '@/lib/dhaka-time'
import { syncExpenseToLedger } from '@/lib/server/ledger-sync'
import { logAudit, diffFields } from '@/lib/server/audit'
import { hookPostSource } from '@/lib/server/accounting/hooks'

export const dynamic = 'force-dynamic'

// salary ISSUE — the IssueSalaryModal's
// write path, moved server-side (the fixed copy wrote salary_payments
// + the branch_cash_expenses cash copy straight from the browser).
// Rules carried from the fixed copy:
//  - admin = the unified callerIsAdmin definition (FR-1.2), same gate as GET /api/admin/salaries;
//  - the total is RECOMPUTED on the server from the components
//    (basic + overtime + bonus + commission + tiffin, poisha-exact
//    via lib/money) — a client-supplied total is never stored;
//  - C20: the cash copy carries salary_payment_id, so combined
//    reporting (the three-stream classifier) counts the salary
//    ONCE, from salary_payments;
//  - C11: the copy's category is the ledger head's NAME, resolved
//    server-side from the head row — never a client string;
//  - both rows + the ledger movement commit in ONE transaction
//    (the old two-insert sequence could half-apply).

// GET /api/admin/salaries/issue — the modal's initial data:
// branches, employees (with bank_info — admin surface, same
// exposure as GET /api/admin/salaries) and the Salary ledger heads
// (name match, deterministic name order — C8).
// U2: ?include_partners=1 (only the users page's partners tab,
// whose value transfers issue through the same shared modal) adds
// partner profiles to the employee list; the default list and the
// response shape are unchanged.
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const includePartners = new URL(req.url).searchParams.get('include_partners') === '1'
    const profileTypes = includePartners
      ? ['employee', 'head_office', 'branch_manager', 'partner']
      : ['employee', 'head_office', 'branch_manager']

    const [branches, employees, heads] = await Promise.all([
      prisma.branch.findMany({ select: { id: true, name: true } }),
      prisma.profile.findMany({
        where: { profile_type: { in: profileTypes } },
        select: { id: true, full_name: true, branch_id: true, salary: true, bank_info: true },
      }),
      prisma.ledgerHead.findMany({
        where: { name: { contains: 'Salary', mode: 'insensitive' } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ])
    return NextResponse.json({
      branches: toPlain(branches) || [],
      employees: toPlain(employees) || [],
      ledger_heads: toPlain(heads) || [],
    })
  } catch (err: any) {
    console.error('[api] app/api/admin/salaries/issue/route.ts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/admin/salaries/issue
// Body: { employee_id, branch_id, basic_salary, overtime_amount,
// bonus_amount, sales_commission, tiffin_bill, ledger_head_id,
// payment_proof_url, account }
export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const employeeId = body.employee_id
    const ledgerHeadId = body.ledger_head_id
    if (!employeeId) return NextResponse.json({ error: 'employee_id is required' }, { status: 400 })
    if (!ledgerHeadId) {
      return NextResponse.json({ error: 'System Error: Salary Ledger Head not found. Please contact admin.' }, { status: 400 })
    }

    const component = (v: unknown) => {
      if (v === undefined || v === null || v === '') return 0
      return parseMoneyAmount(v)
    }
    const basic = component(body.basic_salary)
    const overtime = component(body.overtime_amount)
    const bonus = component(body.bonus_amount)
    const commission = component(body.sales_commission)
    const tiffin = component(body.tiffin_bill)
    if ([basic, overtime, bonus, commission, tiffin].some((v) => v === null)) {
      return NextResponse.json({ error: 'Invalid salary component amount.' }, { status: 400 })
    }
    // Server-recomputed total (never the client's).
    const totalSalary = sumMoney([basic!, overtime!, bonus!, commission!, tiffin!])
    if (totalSalary <= 0) return NextResponse.json({ error: 'Invalid employee or salary amount.' }, { status: 400 })

    const [employee, head, branch] = await Promise.all([
      prisma.profile.findFirst({ where: { id: employeeId }, select: { id: true, full_name: true } }),
      prisma.ledgerHead.findFirst({ where: { id: ledgerHeadId }, select: { id: true, name: true } }),
      body.branch_id
        ? prisma.branch.findFirst({ where: { id: body.branch_id }, select: { id: true, name: true } })
        : Promise.resolve(null),
    ])
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    if (!head) return NextResponse.json({ error: 'Ledger Head not found' }, { status: 400 })

    const newTrxId = `SAL-${Date.now()}`
    const empName = employee.full_name || 'Employee'
    const descText = `Salary Payment for ${empName} (Basic: ${basic}${overtime! > 0 ? `, OT: ${overtime}` : ''}${bonus! > 0 ? `, Bonus: ${bonus}` : ''}${commission! > 0 ? `, Comm: ${commission}` : ''}${tiffin! > 0 ? `, Tiffin: ${tiffin}` : ''})`
    const today = dhakaToday()

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.salaryPayment.create({
        data: {
          employee_id: employeeId,
          branch_id: body.branch_id || null,
          amount: totalSalary,
          base_salary_at_time: basic!,
          overtime_amount: overtime!,
          bonus_amount: bonus!,
          sales_commission: commission!,
          tiffin_bill: tiffin!,
          total_salary: totalSalary,
          ledger_head_id: ledgerHeadId,
          payment_proof_url: body.payment_proof_url || '',
          account: body.account || null,
          transaction_id: newTrxId,
        },
      })

      // C20 cash copy — only when a branch funds it (branch_id is
      // NOT NULL on branch_cash_expenses; the fixed copy's insert
      // failed the same way when no branch was chosen).
      if (body.branch_id) {
        const expense = await tx.branchCashExpense.create({
          data: {
            branch_id: body.branch_id,
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
      branchId: body.branch_id || null,
      fieldChanges: diffFields(null, payment as any, ['amount', 'total_salary', 'employee_id']),
    })

    // Accounts A1 (P5): post the salary journal entry. Fail-soft —
    // a posting failure never fails the salary issue itself.
    await hookPostSource('salary_payments', payment.id, caller, 'salary')

    return NextResponse.json({
      success: true,
      payment: toPlain(payment),
      transaction_id: newTrxId,
      total_salary: totalSalary,
    })
  } catch (err: any) {
    console.error('[api] app/api/admin/salaries/issue/route.ts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
