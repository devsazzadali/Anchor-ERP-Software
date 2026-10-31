import { NextRequest, NextResponse } from 'next/server'
import { sendDepositSubmissionEmailToAdmins } from '@/lib/email-service'
import { parseDailyBreakdown, cleanDepositNotes } from '@/lib/branch-deposit-utils'
import { parseMoneyAmount, validateBreakdown } from '@/lib/money'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { attachDepositBranch } from '@/lib/server/attach'
import { syncDepositToLedger } from '@/lib/server/ledger-sync'
import {
  DEPOSIT_BLOCKING_STATUSES,
  depositOverlapMessage,
  findDepositSalesOverlap,
} from '@/lib/server/deposit-overlap'

// legacy queries replaced by Prisma via
// the single role-resolution function. Admin status comes ONLY from
// the role column or admin_users membership (A1) — getCallerProfile
// computes caller.is_admin accordingly; profile_type is never trusted
// for admin. The old route's "graceful fallback" re-inserts for
// not-yet-migrated columns are gone: the app's schema is the fixed
// schema, all columns exist. Ledger movement on any deposit change is
// owned by lib/server/ledger-sync.ts (the trigger's replacement),
// inside the same transaction as the deposit write (B23/B24/B25).

async function notifyAdminsOfDepositSubmission({
  deposit,
  profile,
  baseUrl,
  dailyBreakdown,
}: {
  deposit: any
  profile: any
  baseUrl: string
  dailyBreakdown?: Record<string, number> | null
}) {
  try {
    // 1. Fetch admins for in-app notifications
    const admins = await prisma.profile.findMany({
      where: { role: { in: ['admin', 'super_admin'] } },
      select: { id: true, email: true, full_name: true },
    })

    if (admins.length > 0) {
      const formattedAmount = Number(deposit.amount).toLocaleString('en-BD')
      const branchLabel = deposit.branch_name || profile.branch || 'Branch'
      const managerLabel = deposit.manager_name || profile.full_name || 'Branch Manager'

      const notifs = admins.map((admin) => ({
        user_id: admin.id,
        title: `🏦 New Bank Deposit: ৳${formattedAmount}`,
        message: `${managerLabel} (${branchLabel}) submitted a bank deposit of ৳${formattedAmount} for ${deposit.deposit_date}. [deposit_id:${deposit.id}]`,
        type: 'deposit',
        read: false,
      }))

      await prisma.notification.createMany({ data: notifs })
    }

    // 2. Dispatch executive email asynchronously (non-blocking)
    sendDepositSubmissionEmailToAdmins({
      depositId: deposit.id,
      branchName: deposit.branch_name || profile.branch || 'Branch',
      managerName: deposit.manager_name || profile.full_name || 'Branch Manager',
      managerEmail: profile.email || null,
      depositDate: deposit.deposit_date,
      salesFromDate: deposit.sales_from_date,
      salesToDate: deposit.sales_to_date,
      amount: Number(deposit.amount),
      bankAccountName: deposit.bank_account_name,
      bankAccountNumber: deposit.bank_account_number || null,
      depositSlipNumber: deposit.deposit_slip_number || null,
      bankTransactionId: deposit.bank_transaction_id || null,
      depositedByName: deposit.deposited_by_name || profile.full_name,
      slipAttachmentUrl: deposit.slip_attachment_url || null,
      bankStatementUrl: deposit.bank_statement_url || null,
      notes: cleanDepositNotes(deposit.notes) || null,
      dailyBreakdown: dailyBreakdown || parseDailyBreakdown(deposit),
      baseUrl,
    }).catch((err) => console.error('Error dispatching admin deposit email:', err))
  } catch (err) {
    console.error('Failed to notify admins of deposit submission:', err)
  }
}

// GET /api/branch-accounts/deposits
// Manager: own branch deposits. Admin: all or by branch_id.
export async function GET(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isAdmin = callerIsAdmin(profile)
    const isManager = profile.is_branch_manager === true
    if (!isAdmin && !isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date')
    const status = searchParams.get('status')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const branchId = isAdmin ? searchParams.get('branch_id') : profile.branch_id

    const where: any = {}
    if (branchId) where.branch_id = branchId
    if (date) where.deposit_date = new Date(`${date}T00:00:00.000Z`)
    if (status) where.status = status
    if (from || to) {
      where.deposit_date = {
        ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
        ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
      }
    }

    const data = await prisma.branchBankDeposit.findMany({
      where,
      orderBy: [{ deposit_date: 'desc' }, { created_at: 'desc' }],
    })
    const withBranch = await attachDepositBranch(data as any)

    // Enrich deposits with parsed daily_breakdown and clean notes
    const enriched = withBranch.map((dep: any) => {
      const plain = toPlain(dep)
      return {
        ...plain,
        daily_breakdown: parseDailyBreakdown(plain),
        display_notes: cleanDepositNotes(plain.notes),
      }
    })

    return NextResponse.json({ deposits: enriched })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/branch-accounts/deposits — Create new deposit (starts as 'draft')
// IMPORTANT: This creates a TRANSFER record, not income. Revenue is tracked at sale time.
export async function POST(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isAdmin = callerIsAdmin(profile)
    const isManager = profile.is_branch_manager === true
    if (!isAdmin && !isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const {
      deposit_date,
      sales_from_date,
      sales_to_date,
      amount,
      khuchra_amount,
      bank_account_name,
      bank_account_number,
      deposit_slip_number,
      bank_transaction_id,
      deposited_by_name,
      slip_attachment_url,
      bank_statement_url,
      status,
      notes,
      daily_breakdown,
    } = body

    if (!deposit_date || amount === undefined || amount === null || !bank_account_name || !sales_from_date || !sales_to_date) {
      return NextResponse.json({
        error: 'deposit_date, sales_from_date, sales_to_date, amount (> 0), and bank_account_name are required',
      }, { status: 400 })
    }

    // B22: the amount must be a finite, bounded number, and a supplied
    // daily_breakdown must be well-formed and sum EXACTLY to the amount.
    // The ledger sync distributes the breakdown slices while reports
    // use the amount — trusting a client-computed breakdown verbatim
    // let the two diverge permanently.
    const parsedAmount = parseMoneyAmount(amount, { min: 0.01 })
    if (parsedAmount === null) {
      return NextResponse.json({ error: 'amount must be a valid number greater than 0' }, { status: 400 })
    }
    const breakdownCheck = validateBreakdown(parsedAmount, daily_breakdown)
    if (!breakdownCheck.ok) {
      return NextResponse.json({ error: breakdownCheck.error }, { status: 400 })
    }
    const parsedKhuchra = khuchra_amount === undefined ? 0 : parseMoneyAmount(khuchra_amount)
    if (parsedKhuchra === null) {
      return NextResponse.json({ error: 'khuchra_amount must be a valid non-negative number' }, { status: 400 })
    }

    // Branch ID always comes from server-side profile for managers
    const branchId = isManager ? profile.branch_id : body.branch_id
    if (!branchId) return NextResponse.json({ error: 'branch_id required' }, { status: 400 })

    // Enforce 1 bank deposit per branch per date (excluding rejected deposits)
    const existingDeposit = await prisma.branchBankDeposit.findFirst({
      where: {
        branch_id: branchId,
        deposit_date: new Date(`${deposit_date}T00:00:00.000Z`),
        status: { not: 'rejected' },
      },
      select: { id: true, deposit_date: true, status: true, amount: true },
    })

    if (existingDeposit) {
      return NextResponse.json({
        error: `A bank deposit for ${deposit_date} has already been recorded (৳${Number(existingDeposit.amount).toLocaleString()} — Status: ${existingDeposit.status}). Only one deposit is permitted per date.`,
      }, { status: 400 })
    }

    // Closing fix §D5 #2: the sales window must not overlap another
    // live claim (approved / submitted / pending) for this branch —
    // two deposits claiming the same sales days subtract the same
    // cash from the drawer twice. Rejected deposits do not block.
    const overlap = await findDepositSalesOverlap(prisma, {
      branchId,
      salesFromDate: sales_from_date,
      salesToDate: sales_to_date,
    })
    if (overlap) {
      return NextResponse.json(
        { error: depositOverlapMessage(overlap, sales_from_date, sales_to_date) },
        { status: 400 }
      )
    }

    const isSubmitted = status === 'submitted' || !!slip_attachment_url
    const finalStatus = isSubmitted ? 'submitted' : 'draft'

    // Dual-safety: embed breakdown tag AND khuchra tag into notes so they're always preserved regardless of DB schema state
    let finalNotes = notes || ''
    if (daily_breakdown && typeof daily_breakdown === 'object' && Object.keys(daily_breakdown).length > 0) {
      const breakdownTag = `[DAILY_BREAKDOWN: ${JSON.stringify(daily_breakdown)}]`
      if (!finalNotes.includes('[DAILY_BREAKDOWN:')) {
        finalNotes = finalNotes ? `${finalNotes}\n${breakdownTag}` : breakdownTag
      }
    }
    const khuchraVal = parsedKhuchra
    if (khuchraVal > 0 && !finalNotes.includes('[KHUCHRA_AMOUNT:')) {
      const khuchraTag = `[KHUCHRA_AMOUNT: ${khuchraVal}]`
      finalNotes = finalNotes ? `${finalNotes}\n${khuchraTag}` : khuchraTag
    }

    const insertPayload: Record<string, any> = {
      branch_id: branchId,
      branch_name: profile.branch || null,
      manager_id: profile.uid,
      manager_name: profile.full_name,
      deposit_date: new Date(`${deposit_date}T00:00:00.000Z`),
      sales_from_date: sales_from_date ? new Date(`${sales_from_date}T00:00:00.000Z`) : null,
      sales_to_date: sales_to_date ? new Date(`${sales_to_date}T00:00:00.000Z`) : null,
      amount: parsedAmount,
      khuchra_amount: khuchraVal > 0 ? khuchraVal : 0,
      bank_account_name,
      bank_account_number: bank_account_number || null,
      deposit_slip_number: deposit_slip_number || null,
      bank_transaction_id: bank_transaction_id || null,
      deposited_by_name: deposited_by_name || profile.full_name,
      slip_attachment_url: slip_attachment_url || null,
      bank_statement_url: bank_statement_url || null,
      notes: finalNotes || null,
      daily_breakdown: daily_breakdown || null,
      status: finalStatus,
      submitted_at: isSubmitted ? new Date() : null,
    }

    const data = await prisma.$transaction(async (tx) => {
      const created = await tx.branchBankDeposit.create({ data: insertPayload as any })
      // A draft/submitted deposit contributes nothing to the ledger;
      // the sync call keeps the invariant in exactly one place.
      await syncDepositToLedger(tx, null, created as any)
      return created
    })

    await prisma.branchAuditTrail.create({
      data: {
        branch_id: branchId,
        branch_name: profile.branch,
        table_name: 'branch_bank_deposits',
        record_id: data.id,
        action: 'create',
        performed_by: profile.uid,
        performed_by_name: profile.full_name,
        new_value: { deposit_date, amount, bank_account_name, status: finalStatus, daily_breakdown: daily_breakdown || null },
        notes: finalStatus === 'submitted' ? 'Deposit submitted for approval' : 'Deposit created as draft',
      },
    })

    const plain = toPlain(data)
    if (finalStatus === 'submitted') {
      const baseUrl = req.nextUrl?.origin || req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://www.anchorfashion.shop'
      await notifyAdminsOfDepositSubmission({ deposit: plain, profile, baseUrl, dailyBreakdown: daily_breakdown || parseDailyBreakdown(plain) })
    }

    return NextResponse.json({
      success: true,
      deposit: {
        ...plain,
        daily_breakdown: daily_breakdown || parseDailyBreakdown(plain),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/branch-accounts/deposits — Update deposit (upload docs, submit)
export async function PATCH(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isAdmin = callerIsAdmin(profile)
    const isManager = profile.is_branch_manager === true
    if (!isAdmin && !isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const { id, action, slip_attachment_url, bank_statement_url, notes, ...rest } = body

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    // Fetch existing deposit
    const deposit = await prisma.branchBankDeposit.findFirst({ where: { id } })
    if (!deposit) return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })

    // Managers can only modify their own branch's deposits
    if (isManager && !isAdmin && deposit.branch_id !== profile.branch_id) {
      return NextResponse.json({ error: 'Forbidden: Not your branch' }, { status: 403 })
    }

    // Only Admin can edit approved deposits.
    // Managers can edit their submissions while pending/submitted/draft/rejected, but CANNOT edit once approved!
    if (isManager && !isAdmin && deposit.status === 'approved') {
      return NextResponse.json({
        error: 'Approved deposits cannot be edited by branch managers. Only admin can modify approved deposits.',
      }, { status: 403 })
    }

    let updateData: Record<string, any> = { updated_at: new Date() }
    let auditAction: string = 'update'
    let auditNotes = isAdmin && deposit.status === 'approved' ? 'Approved deposit modified by admin' : 'Deposit updated'

    const editableFields = [
      'deposit_date', 'sales_from_date', 'sales_to_date',
      'amount', 'khuchra_amount',
      'bank_account_name', 'bank_account_number',
      'deposit_slip_number', 'bank_transaction_id',
      'deposited_by_name', 'daily_breakdown',
      'slip_attachment_url', 'bank_statement_url',
      'notes',
    ]
    const dateFields = new Set(['deposit_date', 'sales_from_date', 'sales_to_date'])
    const pickEditable = (target: Record<string, any>) => {
      for (const f of editableFields) {
        if (rest[f] !== undefined) target[f] = rest[f]
        else if (body[f] !== undefined) target[f] = body[f]
      }
    }

    if (action === 'submit') {
      // Manager submits deposit for admin approval
      if (!deposit.slip_attachment_url && !slip_attachment_url && !body.slip_attachment_url) {
        return NextResponse.json({
          error: 'Please upload a deposit slip or bank statement before submitting',
        }, { status: 400 })
      }
      updateData = {
        ...updateData,
        status: 'submitted',
        submitted_at: new Date(),
        slip_attachment_url: slip_attachment_url || body.slip_attachment_url || deposit.slip_attachment_url,
        bank_statement_url: bank_statement_url || body.bank_statement_url || deposit.bank_statement_url,
        notes: notes !== undefined ? notes : (body.notes !== undefined ? body.notes : deposit.notes),
      }
      pickEditable(updateData)
      auditAction = 'submit'
      auditNotes = 'Deposit submitted for admin approval'
    } else if (action === 'resubmit') {
      updateData = {
        ...updateData,
        status: 'submitted',
        submitted_at: new Date(),
        slip_attachment_url: slip_attachment_url || body.slip_attachment_url || deposit.slip_attachment_url,
        bank_statement_url: bank_statement_url || body.bank_statement_url || deposit.bank_statement_url,
        notes: notes !== undefined ? notes : (body.notes !== undefined ? body.notes : deposit.notes),
        rejection_reason: null,
      }
      pickEditable(updateData)
      auditAction = 'resubmit'
      auditNotes = 'Deposit resubmitted after rejection'
    } else {
      // Plain update / edit
      if (slip_attachment_url !== undefined) updateData.slip_attachment_url = slip_attachment_url
      else if (body.slip_attachment_url !== undefined) updateData.slip_attachment_url = body.slip_attachment_url

      if (bank_statement_url !== undefined) updateData.bank_statement_url = bank_statement_url
      else if (body.bank_statement_url !== undefined) updateData.bank_statement_url = body.bank_statement_url

      if (notes !== undefined) updateData.notes = notes
      else if (body.notes !== undefined) updateData.notes = body.notes

      pickEditable(updateData)

      if (isAdmin && body.status !== undefined) {
        updateData.status = body.status
      }
    }

    // B22 (edit path): when amount and/or daily_breakdown change, the
    // RESULTING pair must stay consistent — validate before writing.
    if (updateData.amount !== undefined || updateData.daily_breakdown !== undefined) {
      const nextAmount = updateData.amount !== undefined
        ? parseMoneyAmount(updateData.amount, { min: 0.01 })
        : Number(deposit.amount)
      if (nextAmount === null) {
        return NextResponse.json({ error: 'amount must be a valid number greater than 0' }, { status: 400 })
      }
      updateData.amount = nextAmount
      const nextBreakdown = updateData.daily_breakdown !== undefined
        ? updateData.daily_breakdown
        : parseDailyBreakdown(toPlain(deposit))
      const check = validateBreakdown(nextAmount, nextBreakdown)
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 })
      }
    }
    if (updateData.khuchra_amount !== undefined) {
      const parsedKh = parseMoneyAmount(updateData.khuchra_amount)
      if (parsedKh === null) {
        return NextResponse.json({ error: 'khuchra_amount must be a valid non-negative number' }, { status: 400 })
      }
      updateData.khuchra_amount = parsedKh
    }

    // Normalise date fields to Date objects for Prisma.
    for (const f of dateFields) {
      if (typeof updateData[f] === 'string') {
        updateData[f] = new Date(`${updateData[f]}T00:00:00.000Z`)
      }
    }

    // Closing fix §D5 #2 (edit path): when this write submits /
    // resubmits the deposit, moves its sales window, or changes its
    // status, the RESULTING live claim must not overlap another live
    // claim for the branch (excluding itself). Unrelated edits (slip
    // upload on an already-submitted deposit, notes, …) are not
    // re-checked here — approval re-checks every claim anyway.
    const resultingStatus = updateData.status !== undefined ? updateData.status : deposit.status
    const touchesClaim =
      action === 'submit' ||
      action === 'resubmit' ||
      updateData.sales_from_date !== undefined ||
      updateData.sales_to_date !== undefined ||
      updateData.status !== undefined
    if (touchesClaim && DEPOSIT_BLOCKING_STATUSES.includes(resultingStatus)) {
      const overlap = await findDepositSalesOverlap(prisma, {
        branchId: deposit.branch_id,
        salesFromDate: updateData.sales_from_date ?? deposit.sales_from_date,
        salesToDate: updateData.sales_to_date ?? deposit.sales_to_date,
        excludeId: id,
      })
      if (overlap) {
        return NextResponse.json(
          {
            error: depositOverlapMessage(
              overlap,
              updateData.sales_from_date ?? deposit.sales_from_date,
              updateData.sales_to_date ?? deposit.sales_to_date
            ),
          },
          { status: 400 }
        )
      }
    }

    // Ledger sync on edits is owned ENTIRELY by the sync service
    // (lib/server/ledger-sync.ts — the trigger's replacement): it
    // removes the deposit's old per-day distribution and adds the new
    // one, inside this same transaction. The old route ALSO adjusted
    // only the deposit_date ledger by the amount diff — ignoring the
    // breakdown split — and double-counted whenever the same PATCH
    // flipped the status to approved. (B23)
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.branchBankDeposit.update({ where: { id }, data: updateData as any })
      await syncDepositToLedger(tx, deposit as any, row as any)
      return row
    })

    await prisma.branchAuditTrail.create({
      data: {
        branch_id: deposit.branch_id,
        table_name: 'branch_bank_deposits',
        record_id: id,
        action: auditAction as any,
        performed_by: profile.uid,
        performed_by_name: profile.full_name,
        old_value: { status: deposit.status },
        new_value: { status: updated.status, ...toPlain(updateData) },
        notes: auditNotes,
      },
    })

    const plain = toPlain(updated)
    if (action === 'submit' || action === 'resubmit') {
      const baseUrl = req.nextUrl?.origin || req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://www.anchorfashion.shop'
      await notifyAdminsOfDepositSubmission({ deposit: plain, profile, baseUrl })
    }

    return NextResponse.json({ success: true, deposit: plain })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
