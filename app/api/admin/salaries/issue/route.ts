import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { issueSalaryPayment, SalaryIssueError } from '@/lib/server/salary-issue'

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
//
// Accounts A6: the write itself lives in the ONE shared service
// (lib/server/salary-issue.ts) — this route is the modal's thin
// HTTP wrapper over it, so the payroll cycle disburses through
// the exact same function (one salary component, one money path).
export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    try {
      const result = await issueSalaryPayment(caller, {
        employee_id: body.employee_id,
        branch_id: body.branch_id || null,
        basic_salary: body.basic_salary,
        overtime_amount: body.overtime_amount,
        bonus_amount: body.bonus_amount,
        sales_commission: body.sales_commission,
        tiffin_bill: body.tiffin_bill,
        ledger_head_id: body.ledger_head_id,
        payment_proof_url: body.payment_proof_url,
        account: body.account,
      }, req)
      return NextResponse.json({
        success: true,
        payment: toPlain(result.payment),
        transaction_id: result.transaction_id,
        total_salary: result.total_salary,
      })
    } catch (err: any) {
      if (err instanceof SalaryIssueError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (err: any) {
    console.error('[api] app/api/admin/salaries/issue/route.ts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
