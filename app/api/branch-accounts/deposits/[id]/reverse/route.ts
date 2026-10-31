import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { syncDepositToLedger, depositDistributionMap } from '@/lib/server/ledger-sync'
import { logAudit } from '@/lib/server/audit'
import { hookReverseSource } from '@/lib/server/accounting/hooks'

// POST /api/branch-accounts/deposits/[id]/reverse
// Admin only — REVERSE an approved deposit (§D5 #6).
//
// Until now `is_reversed` was honoured by every read and by the
// ledger sync, but no writer existed: an externally reversed
// deposit kept its money in branch_cash_ledger.bank_deposits_out
// forever. This endpoint is that writer, and it is deliberately
// narrow:
//   - admin-only, and only for a deposit that is currently
//     status='approved' and not already reversed;
//   - a reversal_note is REQUIRED — reversal is a visible,
//     deliberate act, never automatic, never a silent edit;
//   - the flag write and the ledger back-out happen in ONE
//     transaction: the row is marked is_reversed (with note, actor
//     and timestamp) and syncDepositToLedger re-runs with the
//     reversed row as the new state. The sync already honours
//     is_reversed (a reversed deposit contributes nothing), so it
//     subtracts exactly the distribution it previously added;
//   - the action is recorded in branch_audit_trail and the branch
//     manager is notified, mirroring the approve/reject route.
//
// DRIFT GUARD — removal must match what was actually applied.
// The ledger holds only per-day aggregates, so a single deposit's
// contribution cannot be read back directly. What CAN be proven
// is the invariant the sync maintains on every day it touches:
//
//   ledger.bank_deposits_out(day) === Σ distributions(day) over
//   all approved, not-reversed deposits of the branch.
//
// If that invariant holds on EVERY day this deposit's distribution
// touches, then subtracting exactly this deposit's distribution
// leaves every touched day still satisfying the invariant for the
// remaining deposits — the back-out is provably the money this
// deposit added, in aggregate, on those days. If any touched day
// does NOT reconcile, the deposit's money is not provably in the
// ledger: the known case is §D3-e — SOTIBARI 2026-09-10, where
// distributions total ৳31,627 (a ৳20,000 lump + this deposit's
// ৳11,627 slice) but the ledger holds only ৳20,000, because that
// one slice never reached the ledger. Reversing that deposit
// through the sync would subtract ৳11,627 from a day where it
// never added it, eating the other deposit's money. So: any
// non-reconciling touched day → REFUSED (409), nothing written;
// that deposit needs a data-repair / owner decision first.
// The guard deliberately computes distributions with the sync's
// own depositDistributionMap, so it stays correct under the
// hybrid sync reality (new deposits lumped on deposit_date,
// legacy rows holding slices): whichever distribution the sync
// would remove is the distribution the guard reconciles.
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

    const body = await req.json().catch(() => ({}))
    const reversalNote = typeof body?.reversal_note === 'string' ? body.reversal_note.trim() : ''
    if (!reversalNote) {
      return NextResponse.json({ error: 'reversal_note is required when reversing a deposit' }, { status: 400 })
    }

    const deposit = await prisma.branchBankDeposit.findFirst({ where: { id } })
    if (!deposit) {
      return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })
    }
    if (deposit.status !== 'approved') {
      return NextResponse.json({
        error: `Deposit is in status '${deposit.status}' and cannot be reversed — only an approved deposit can be reversed`,
      }, { status: 400 })
    }
    if (deposit.is_reversed === true) {
      return NextResponse.json({ error: 'Deposit is already reversed' }, { status: 400 })
    }

    // Drift guard (see header): on every day this deposit's
    // distribution touches, the ledger must equal the sum of ALL
    // approved, not-reversed distributions of the branch for that
    // day — otherwise this deposit's contribution is not provably
    // in the ledger and reversal is refused.
    const distribution = depositDistributionMap(
      Number(deposit.amount),
      deposit.deposit_date as any,
      deposit.daily_breakdown,
      false
    )
    const touchedDates = [...distribution.keys()]
    if (touchedDates.length > 0) {
      const branchApproved = await prisma.branchBankDeposit.findMany({
        where: { branch_id: deposit.branch_id, status: 'approved', is_reversed: false },
        select: { amount: true, deposit_date: true, daily_breakdown: true },
      })
      const expectedByDate = new Map<string, number>()
      for (const other of branchApproved) {
        const otherMap = depositDistributionMap(Number(other.amount), other.deposit_date as any, other.daily_breakdown, false)
        for (const date of touchedDates) {
          const v = otherMap.get(date)
          if (v) expectedByDate.set(date, (expectedByDate.get(date) ?? 0) + v)
        }
      }
      for (const date of touchedDates) {
        const ledgerRow = await prisma.branchCashLedger.findFirst({
          where: { branch_id: deposit.branch_id, ledger_date: new Date(`${date}T00:00:00.000Z`) },
          select: { bank_deposits_out: true },
        })
        const held = Number(ledgerRow?.bank_deposits_out ?? 0)
        const expected = expectedByDate.get(date) ?? 0
        if (Math.abs(held - expected) > 0.005) {
          return NextResponse.json({
            error:
              `Reversal refused: the ledger does not reconcile with the recorded deposits on ${date} ` +
              `(approved deposits distribute ৳${expected.toLocaleString('en-BD')} to that day, the ledger holds ৳${held.toLocaleString('en-BD')}). ` +
              `Part of the money recorded for that day never reached the ledger, so this deposit's own ` +
              `contribution cannot be proven to be there — reversing would subtract money it may not have added. ` +
              `This needs a data-repair decision before reversal — nothing was changed.`,
          }, { status: 409 })
        }
      }
    }

    const adminName = caller.full_name || 'Admin'

    // One transaction: mark reversed + back the ledger contribution
    // out via the existing sync (which honours is_reversed).
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.branchBankDeposit.update({
        where: { id },
        data: {
          is_reversed: true,
          reversal_note: reversalNote,
          reversed_by: caller.uid,
          reversed_at: new Date(),
          updated_at: new Date(),
        } as any,
      })
      await syncDepositToLedger(tx, deposit as any, row as any)
      return row
    })

    // Audit trail — same pattern as approve/reject.
    await prisma.branchAuditTrail.create({
      data: {
        branch_id: deposit.branch_id,
        branch_name: deposit.branch_name,
        table_name: 'branch_bank_deposits',
        record_id: id,
        action: 'reverse' as any,
        performed_by: caller.uid,
        performed_by_name: adminName,
        old_value: { status: deposit.status, is_reversed: false },
        new_value: { status: updated.status, is_reversed: true, reversal_note: reversalNote },
        notes: `Deposit of ৳${Number(deposit.amount).toLocaleString('en-BD')} reversed by admin: ${reversalNote}. Its ledger contribution was backed out of bank_deposits_out.`,
      },
    })

    await logAudit({
      caller, req, action: 'deposit.reverse', eventType: 'reverse',
      entityTable: 'branch_bank_deposits', entityId: id,
      branchId: deposit.branch_id,
      fieldChanges: [
        { field: 'is_reversed', old: false, new: true },
        { field: 'status', old: deposit.status, new: updated.status },
        { field: 'reversal_note', old: null, new: reversalNote },
      ],
    })

    // Notify the manager — same pattern as approve/reject.
    if (deposit.manager_id) {
      await prisma.notification.create({
        data: {
          user_id: deposit.manager_id,
          title: '↩️ Deposit Reversed',
          message: `Your approved bank deposit of ৳${Number(deposit.amount).toLocaleString('en-BD')} for ${toPlain(deposit).deposit_date} was reversed by ${adminName}. Reason: ${reversalNote}`,
          type: 'warning',
          read: false,
        },
      })
    }

    // Accounts A1 (P7): reversing the deposit posts the exact
    // contra journal entry. Fail-soft.
    await hookReverseSource('branch_bank_deposits', id, caller, `Deposit reversed: ${reversalNote}`)

    return NextResponse.json({
      success: true,
      action: 'reverse',
      deposit: toPlain(updated),
    })
  } catch (err: any) {
    console.error('Deposit reverse error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
