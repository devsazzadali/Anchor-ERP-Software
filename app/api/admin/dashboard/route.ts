import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// GET /api/admin/dashboard — admin-only telemetry bundle for the
// admin dashboard page. Returns the same row sets the page used to
// read browser-direct from the database (profiles/roles, branches count,
// tasks, pending KYC count, payment_requests, company_expenses,
// salary_payments, branch_cash_ledger, branch_financial_reports,
// fraud-flagged payments and recent activity_logs with the acting
// profile's full_name attached). All aggregation stays client-side,
// exactly as the page computed it (C37/C39/C41/C42 behaviour kept).
export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })

    const [
      profiles, branchesCount, tasks, kycCount, activePayments, completedPayments,
      expenses, salaries, ledgerSales, fraudRows, auditRows,
    ] = await Promise.all([
      prisma.profile.findMany({ select: { role: true }, orderBy: { id: 'asc' } }),
      prisma.branch.count(),
      prisma.task.findMany({ select: { status: true }, orderBy: { id: 'asc' } }),
      prisma.verificationRequest.count({ where: { status: 'pending' } }),
      prisma.paymentRequest.findMany({
        where: { status: { in: ['pending', 'processing'] } },
        select: { amount: true },
        orderBy: { id: 'asc' },
      }),
      prisma.paymentRequest.findMany({
        where: { status: 'completed' },
        select: { amount: true, created_at: true },
        orderBy: { id: 'asc' },
      }),
      prisma.companyExpense.findMany({ select: { total_amount: true, created_at: true }, orderBy: { id: 'asc' } }),
      prisma.salaryPayment.findMany({ select: { amount: true, payment_date: true }, orderBy: { id: 'asc' } }),
      prisma.branchCashLedger.findMany({
        select: {
          cash_sales: true, bkash_sales: true, nagad_sales: true, rocket_sales: true,
          card_sales: true, bank_transfer_sales: true, branch_id: true,
        },
        orderBy: [{ ledger_date: 'asc' }, { id: 'asc' }],
      }),
      prisma.paymentRequest.findMany({
        where: { status: 'fraud_flagged' },
        orderBy: { created_at: 'desc' },
        take: 5,
      }),
      prisma.activityLog.findMany({ orderBy: { created_at: 'desc' }, take: 10 }),
    ])

    // branch_financial_reports fallback is only needed when the ledger
    // is empty — fetch lazily to mirror the page's original flow.
    let finReports: any[] = []
    if (ledgerSales.length === 0) {
      finReports = await prisma.branchFinancialReport.findMany({
        select: { amount: true, branch_id: true },
        orderBy: { id: 'asc' },
      })
    }

    // Attach profile full_name embeds (profiles:user_id(full_name)).
    const fraudUserIds = [...new Set(fraudRows.map((r) => r.user_id).filter(Boolean))]
    const auditUserIds = [...new Set(auditRows.map((r) => r.user_id).filter(Boolean) as string[])]
    const allIds = [...new Set([...fraudUserIds, ...auditUserIds])]
    const profs = allIds.length
      ? await prisma.profile.findMany({ where: { id: { in: allIds } }, select: { id: true, full_name: true } })
      : []
    const nameById = new Map(profs.map((p) => [p.id, p.full_name]))

    const fraudData = fraudRows.map((f) => ({
      ...f,
      profiles: { full_name: nameById.get(f.user_id) ?? null },
    }))
    const auditLogs = auditRows.map((a) => ({
      ...a,
      profiles: a.user_id ? { full_name: nameById.get(a.user_id) ?? null } : null,
    }))

    return NextResponse.json(toPlain({
      adminName: caller.full_name,
      profiles,
      branchesCount,
      tasks,
      kycCount,
      activePayments,
      completedPayments,
      expenses,
      salaries,
      ledgerSales,
      finReports,
      fraudData,
      auditLogs,
    }))
  } catch (err: any) {
    console.error('[GET /api/admin/dashboard] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch dashboard telemetry' }, { status: 500 })
  }
}
