import { NextRequest, NextResponse } from 'next/server'
import { sendDepositDecisionEmailToManager } from '@/lib/email-service'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { syncDepositToLedger } from '@/lib/server/ledger-sync'
import { depositOverlapMessage, findDepositSalesOverlap } from '@/lib/server/deposit-overlap'

// POST /api/branch-accounts/deposits/[id]/approve
// Admin only — Approve or Reject a submitted deposit
//
// approve/reject change the deposit's
// status AND move its ledger money via lib/server/ledger-sync.ts —
// the trigger's replacement — inside one transaction. The old route's
// hand-rolled ledger adjustments were removed by the fix programme
// (B24: cumulative-total guessing skipped or doubled distributions;
// B25: reject subtracted money belonging to OTHER deposits). Here the
// sync service computes this deposit's own before/after contribution
// and moves exactly that.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!id) return NextResponse.json({ error: 'Deposit id required' }, { status: 400 })

    const body = await req.json()
    const { action, rejection_reason } = body // action: 'approve' | 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 })
    }

    // Fetch existing deposit
    const deposit = await prisma.branchBankDeposit.findFirst({ where: { id } })
    if (!deposit) {
      return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })
    }

    if (!['submitted', 'pending_approval'].includes(deposit.status)) {
      return NextResponse.json({
        error: `Deposit is in status '${deposit.status}' and cannot be ${action}d`,
      }, { status: 400 })
    }

    if (action === 'reject' && !rejection_reason) {
      return NextResponse.json({ error: 'rejection_reason is required when rejecting' }, { status: 400 })
    }

    // Closing fix §D5 #2 (approve path): approval is the moment this
    // deposit's money enters the ledger, so it is re-checked here even
    // if it was clean at create — another live claim (approved /
    // submitted / pending) for the same branch over the same sales
    // days blocks the approval. Rejection is never blocked.
    if (action === 'approve') {
      const overlap = await findDepositSalesOverlap(prisma, {
        branchId: deposit.branch_id,
        salesFromDate: deposit.sales_from_date,
        salesToDate: deposit.sales_to_date,
        excludeId: id,
      })
      if (overlap) {
        return NextResponse.json(
          { error: depositOverlapMessage(overlap, deposit.sales_from_date as any, deposit.sales_to_date as any) },
          { status: 400 }
        )
      }
    }

    const adminName = caller.full_name || 'Admin'

    const updateData =
      action === 'approve'
        ? {
            status: 'approved',
            reviewed_by: caller.uid,
            reviewed_by_name: adminName,
            reviewed_at: new Date(),
            rejection_reason: null,
            updated_at: new Date(),
          }
        : {
            status: 'rejected',
            reviewed_by: caller.uid,
            reviewed_by_name: adminName,
            reviewed_at: new Date(),
            rejection_reason: rejection_reason || null,
            updated_at: new Date(),
          }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.branchBankDeposit.update({ where: { id }, data: updateData as any })
      await syncDepositToLedger(tx, deposit as any, row as any)
      return row
    })

    // Audit trail
    await prisma.branchAuditTrail.create({
      data: {
        branch_id: deposit.branch_id,
        branch_name: deposit.branch_name,
        table_name: 'branch_bank_deposits',
        record_id: id,
        action: action as any,
        performed_by: caller.uid,
        performed_by_name: adminName,
        old_value: { status: deposit.status },
        new_value: { status: updated.status, rejection_reason: rejection_reason || null },
        notes: action === 'approve'
          ? `Deposit of ৳${deposit.amount} approved`
          : `Deposit rejected: ${rejection_reason}`,
      },
    })

    // Notify the manager via notifications table
    await prisma.notification.create({
      data: {
        user_id: deposit.manager_id,
        title: action === 'approve' ? '✅ Deposit Approved' : '❌ Deposit Rejected',
        message: action === 'approve'
          ? `Your bank deposit of ৳${Number(deposit.amount).toLocaleString('en-BD')} for ${toPlain(deposit).deposit_date} has been approved.`
          : `Your deposit of ৳${Number(deposit.amount).toLocaleString('en-BD')} was rejected. Reason: ${rejection_reason}`,
        type: action === 'approve' ? 'success' : 'warning',
        read: false,
      },
    })

    // Notify manager via email if email available (non-blocking)
    if (deposit.manager_id) {
      ;(async () => {
        const mgrProfile = await prisma.profile.findFirst({
          where: { id: deposit.manager_id },
          select: { email: true, full_name: true },
        })

        if (mgrProfile?.email) {
          const baseUrl = req.nextUrl?.origin || req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://www.anchorfashion.shop'
          await sendDepositDecisionEmailToManager({
            managerEmail: mgrProfile.email,
            managerName: mgrProfile.full_name || deposit.manager_name || 'Branch Manager',
            branchName: deposit.branch_name || 'Branch',
            depositDate: toPlain(deposit).deposit_date,
            amount: Number(deposit.amount),
            status: action === 'approve' ? 'approved' : 'rejected',
            rejectionReason: rejection_reason || null,
            reviewedByName: adminName,
            baseUrl,
          })
        }
      })().catch((e) => console.error('Failed to send manager deposit email:', e))
    }

    return NextResponse.json({
      success: true,
      action,
      deposit: toPlain(updated),
    })
  } catch (err: any) {
    console.error('Deposit approve/reject error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
