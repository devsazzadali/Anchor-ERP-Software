import { NextRequest, NextResponse } from 'next/server'
import { parseMoneyAmount, roundMoney } from '@/lib/money'
import { dhakaToday } from '@/lib/dhaka-time'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { attachExpenseLedgerHead } from '@/lib/server/attach'
import { syncExpenseToLedger } from '@/lib/server/ledger-sync'
import { logAudit, diffFields } from '@/lib/server/audit'
import { hookPostSource, hookResyncSource, hookReverseSource } from '@/lib/server/accounting/hooks'

// auth via the single role-resolution
// function (lib/server/auth.ts). FR-1.6 CONTRACT: this route is
// ADMIN-ONLY (the unified callerIsAdmin gate) for every method —
// the caller census found ONLY admin surfaces consuming it (the
// admin Ledger Heads page + the issue modals). An earlier version
// of this comment promised manager own-branch access that never
// existed in the handlers; that promise is removed — managers use
// their own branch surfaces, not this route. Ledger
// movement on create/edit/delete is owned by
// lib/server/ledger-sync.ts (the sync_expense_to_cash_ledger
// trigger's replacement), inside the same transaction as the expense
// write. Prisma has no 1,000-row cap, so the C38/B26 complete-list
// guarantee holds by construction.

// ─────────────────────────────────────────────────────────────────────────────
// Ledger Head resolver — validates UUID, confirms existence + is_active.
// Returns the authoritative name from the database.
// NEVER trusts a client-supplied ledger head name.
// ─────────────────────────────────────────────────────────────────────────────
async function resolveLedgerHead(
  ledgerHeadId: string
): Promise<{ id: string; name: string } | { error: string }> {
  if (!ledgerHeadId || typeof ledgerHeadId !== 'string') {
    return { error: 'ledger_head_id must be a non-empty string UUID' }
  }

  // Basic UUID format check
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(ledgerHeadId)) {
    return { error: 'ledger_head_id is not a valid UUID' }
  }

  const data = await prisma.ledgerHead.findFirst({
    where: { id: ledgerHeadId },
    select: { id: true, name: true, is_active: true },
  })

  if (!data) return { error: 'Ledger Head not found' }
  if (!data.is_active) return { error: 'Selected Ledger Head is no longer active and cannot be used for new entries' }

  return { id: data.id, name: data.name }
}

// ─────────────────────────────────────────────────────────────────────────────
// Month filter helper — half-open interval to avoid timezone edge cases.
// Input: '2026-09' → { gte: '2026-09-01', lt: '2026-10-01' }
// ─────────────────────────────────────────────────────────────────────────────
function parseMonthFilter(monthParam: string): { gte: string; lt: string } | null {
  const match = monthParam.match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  const year = parseInt(match[1], 10)
  const month = parseInt(match[2], 10)
  if (month < 1 || month > 12) return null

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  // Compute first day of next month
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

  return { gte: startDate, lt: endDate }
}

const EXPENSE_COLUMNS = {
  id: true, branch_id: true, branch_name: true, manager_id: true, manager_name: true,
  expense_date: true, category: true, description: true, amount: true,
  paid_amount: true, due_amount: true, recipient_account: true, rent_month: true, rent_year: true,
  receipt_url: true, notes: true, created_at: true, updated_at: true,
  ledger_head_id: true,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/branch-accounts/expenses
// Query params:
//   from, to           — expense_date range (YYYY-MM-DD)
//   month              — YYYY-MM (half-open interval, takes precedence over from/to for date)
//   branch_id          — optional filter (admin callers only; the route is admin-only)
//   ledger_head_id     — filter by Ledger Head UUID
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isAdmin = callerIsAdmin(profile)
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const monthParam = searchParams.get('month')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const ledgerHeadParam = searchParams.get('ledger_head_id')

    // Branch authorization: admin/head office may specify a branch_id to filter
    const branchId = searchParams.get('branch_id')

    const where: any = {}
    if (branchId) where.branch_id = branchId

    // Month filter (half-open interval — avoids end-of-day timezone bugs)
    if (monthParam) {
      const monthRange = parseMonthFilter(monthParam)
      if (monthRange) {
        where.expense_date = {
          gte: new Date(`${monthRange.gte}T00:00:00.000Z`),
          lt: new Date(`${monthRange.lt}T00:00:00.000Z`),
        }
      }
    } else {
      // Fallback to explicit from/to date range
      if (from || to) {
        where.expense_date = {
          ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
          ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
        }
      }
    }

    // Ledger Head filter (server-enforced)
    if (ledgerHeadParam) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (uuidRegex.test(ledgerHeadParam)) {
        where.ledger_head_id = ledgerHeadParam
      }
    }

    // C38/B26: the list fetch is complete — no silent 1,000-row cap.
    const data = await prisma.branchCashExpense.findMany({
      where,
      select: EXPENSE_COLUMNS,
      orderBy: [{ expense_date: 'desc' }, { created_at: 'desc' }, { id: 'asc' }],
    })
    const withHeads = await attachExpenseLedgerHead(data as any)

    return NextResponse.json({ expenses: toPlain(withHeads) })
  } catch (err: any) {
    console.error('[api] app/api/branch-accounts/expenses/route.ts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/branch-accounts/expenses
// Creates a new expense entry.
// If ledger_head_id is provided:
//   1. Validate UUID format
//   2. Fetch from DB — must exist and is_active = true
//   3. Resolve authoritative name from DB
//   4. Store both ledger_head_id AND category = resolved name
// If ledger_head_id is NOT provided:
//   category = body.category || 'general' (legacy behaviour preserved)
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isAdmin = callerIsAdmin(profile)
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const { description, amount, expense_date, receipt_url, notes, rent_month, rent_year, billing_month, billing_year } = body
    const clientLedgerHeadId = body.ledger_head_id
    const clientCategory = body.category

    // paid_amount / due_amount — used for house rent and other tracked expenses.
    // C14: the triple must be CONSISTENT (paid + due == amount,
    // poisha-exact). One missing side is derived; both missing means
    // fully paid. The old code trusted a client-supplied due_amount
    // verbatim, so inconsistent triples were stored and later summed
    // as truth.
    const totalAmount = parseMoneyAmount(amount, { min: 0.01 })
    if (!description || totalAmount === null) {
      return NextResponse.json({ error: 'description and a positive amount are required' }, { status: 400 })
    }
    let paidAmount: number
    let dueAmount: number
    if (body.paid_amount !== undefined && body.due_amount !== undefined) {
      const p = parseMoneyAmount(body.paid_amount)
      const d = parseMoneyAmount(body.due_amount)
      if (p === null || d === null || roundMoney(p + d) !== totalAmount) {
        return NextResponse.json({ error: 'paid_amount + due_amount must equal amount' }, { status: 400 })
      }
      paidAmount = p
      dueAmount = d
    } else if (body.paid_amount !== undefined) {
      const p = parseMoneyAmount(body.paid_amount)
      if (p === null || p > totalAmount) {
        return NextResponse.json({ error: 'paid_amount must be between 0 and amount' }, { status: 400 })
      }
      paidAmount = p
      dueAmount = roundMoney(totalAmount - p)
    } else if (body.due_amount !== undefined) {
      const d = parseMoneyAmount(body.due_amount)
      if (d === null || d > totalAmount) {
        return NextResponse.json({ error: 'due_amount must be between 0 and amount' }, { status: 400 })
      }
      dueAmount = d
      paidAmount = roundMoney(totalAmount - d)
    } else {
      paidAmount = totalAmount
      dueAmount = 0
    }

    // Branch authorization: Admin/Head Office must specify the branch
    const branchId = body.branch_id
    if (!branchId) return NextResponse.json({ error: 'branch_id required' }, { status: 400 })

    // Ledger Head resolution
    let resolvedLedgerHeadId: string | null = null
    let resolvedCategory = clientCategory || 'general'

    if (clientLedgerHeadId) {
      const result = await resolveLedgerHead(clientLedgerHeadId)
      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      // Both fields set for backward compatibility:
      // - ledger_head_id: the UUID FK relationship
      // - category:       the authoritative name (so existing code reading category still works)
      resolvedLedgerHeadId = result.id
      resolvedCategory = result.name // Server-resolved — NOT from client
    }

    // C13: branch_name must be the TARGET branch's name — the old
    // code stored the CALLER's branch (profile.branch), mislabelling
    // every cross-branch issue at source.
    const targetBranch = await prisma.branch.findFirst({
      where: { id: branchId },
      select: { name: true },
    })

    // FR-7: utility-bill guards (bills carry a structured billing
    // period). (1) Duplicate guard: a second bill for the same
    // branch + ledger head + billing month is rejected 409 unless
    // the caller explicitly confirms (confirm_duplicate) — Rangpur
    // electricity was historically billed twice in one month
    // (৳6,000 + ৳10,000) with no period to separate them.
    // (2) Meter validation: when the recipient cites "Meter: X",
    // X must be an ACTIVE meter of this branch — restricted to the
    // bill's type (from the head name) when the registry has meters
    // of that type (SOTIBARI's electricity bill historically cited
    // its Internet meter's number). No active registry → no block.
    if (billing_month && billing_year) {
      const existing = await prisma.branchCashExpense.findFirst({
        where: {
          branch_id: branchId,
          ledger_head_id: resolvedLedgerHeadId,
          billing_month,
          billing_year: Number(billing_year),
        },
        select: { id: true, amount: true },
      })
      if (existing && body.confirm_duplicate !== true) {
        return NextResponse.json({
          error: `A ${resolvedCategory} bill for this branch is already recorded for ${billing_month} ${billing_year} (৳${Number(existing.amount).toLocaleString('en-BD')}). Resubmit with confirm_duplicate to record another.`,
          duplicate: true,
        }, { status: 409 })
      }
      const meterCite = /Meter:\s*([^,]+)/.exec(String(body.recipient_account || ''))
      if (meterCite) {
        const cited = meterCite[1].trim()
        const activeMeters = await prisma.utilityMeter.findMany({
          where: { branch_id: branchId, is_active: true },
          select: { meter_number: true, meter_type: true },
        })
        if (activeMeters.length > 0) {
          const typeWord = ['Electricity', 'Internet', 'Water', 'Gas'].find((t) =>
            resolvedCategory.toLowerCase().includes(t.toLowerCase()))
          const typed = typeWord
            ? activeMeters.filter((m) => (m.meter_type || '').toLowerCase() === typeWord.toLowerCase())
            : []
          const pool = typed.length > 0 ? typed : activeMeters
          if (!pool.some((m) => m.meter_number === cited)) {
            return NextResponse.json({
              error: `Meter number "${cited}" is not an active ${typeWord || ''} meter for this branch.`.replace('  ', ' '),
            }, { status: 400 })
          }
        }
      }
    }

    const expenseDateStr: string = expense_date || dhakaToday()
    const insertPayload: Record<string, any> = {
      branch_id: branchId,
      branch_name: targetBranch?.name || null,
      manager_id: profile.uid,
      manager_name: profile.full_name,
      expense_date: new Date(`${expenseDateStr}T00:00:00.000Z`),
      category: resolvedCategory,
      ledger_head_id: resolvedLedgerHeadId,
      description,
      amount: totalAmount,
      paid_amount: paidAmount,
      due_amount: dueAmount,
      // C13(2): the rent modal sends the landlord's bank details as
      // recipient_account — it was silently dropped on every POST.
      recipient_account: body.recipient_account || null,
      receipt_url: receipt_url || null,
      notes: notes || null,
      rent_month: rent_month || null,
      rent_year: rent_year ? Number(rent_year) : null,
      // C10: structured billing period (utility bills) — part of the
      // app's schema from day one (Batch-3 migration columns).
      billing_month: billing_month || null,
      billing_year: billing_year ? Number(billing_year) : null,
    }

    const data = await prisma.$transaction(async (tx) => {
      const created = await tx.branchCashExpense.create({ data: insertPayload as any })
      await syncExpenseToLedger(tx, null, created as any)
      // Return with the same column set + embed shape as the old route.
      const full = await tx.branchCashExpense.findFirst({ where: { id: created.id } })
      return full!
    })
    const [withHead] = await attachExpenseLedgerHead([data as any])

    // Audit trail
    await prisma.branchAuditTrail.create({
      data: {
        branch_id: branchId,
        branch_name: targetBranch?.name || null,
        table_name: 'branch_cash_expenses',
        record_id: data.id,
        action: 'create',
        performed_by: profile.uid,
        performed_by_name: profile.full_name,
        new_value: {
          category: resolvedCategory,
          ledger_head_id: resolvedLedgerHeadId,
          description,
          amount,
          expense_date,
        },
      },
    })

    await logAudit({
      caller: profile, req, action: 'branch_expense.create', eventType: 'create',
      entityTable: 'branch_cash_expenses', entityId: data.id, branchId: branchId,
      fieldChanges: diffFields(null, data as any, ['category', 'description', 'amount', 'paid_amount', 'due_amount']),
    })

    // Accounts A1 (P2/P3): post the journal entry for this expense
    // (salary/request copies post from their sources; the builder
    // no-ops for them). Fail-soft.
    await hookPostSource('branch_cash_expenses', data.id, profile as any)

    return NextResponse.json({ success: true, expense: toPlain(withHead) })
  } catch (err: any) {
    console.error('[api] app/api/branch-accounts/expenses/route.ts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/branch-accounts/expenses?id=<uuid>
// Edit an existing expense. Same Ledger Head resolution rules as POST.
// If ledger_head_id changes, category is also updated to match.
// Historical expenses (ledger_head_id IS NULL) can be updated with a new LH.
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isAdmin = callerIsAdmin(profile)
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 })

    // Fetch existing expense — verify ownership. (expense_date is
    // fetched in addition to the old route's column set: the ledger
    // sync service needs the OLD date to move the contribution.)
    const existing = await prisma.branchCashExpense.findFirst({
      where: { id },
      select: {
        id: true, branch_id: true, manager_id: true, category: true, ledger_head_id: true,
        amount: true, paid_amount: true, due_amount: true, expense_date: true,
        // Stream links (expense round completion, 2026-10-31): the
        // ledger sync now moves only a row's BRANCH-stream amount, so
        // the OLD row shape it is handed must carry the links that
        // classify it — without them an expense-request row stamped
        // with a head (or a salary copy) would be misclassified and
        // its old drawer contribution never removed.
        salary_payment_id: true, expense_request_id: true,
      },
    })

    if (!existing) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })

    const body = await req.json()
    const patch: any = {}

    // Optional editable fields
    if ('description' in body) {
      if (!body.description || !String(body.description).trim()) {
        return NextResponse.json({ error: 'description cannot be empty' }, { status: 400 })
      }
      patch.description = String(body.description).trim()
    }

    if ('amount' in body) {
      const amt = parseMoneyAmount(body.amount, { min: 0.01 })
      if (amt === null) {
        return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
      }
      patch.amount = amt
    }

    if ('paid_amount' in body) {
      const p = parseMoneyAmount(body.paid_amount)
      if (p === null) {
        return NextResponse.json({ error: 'paid_amount must be a non-negative number' }, { status: 400 })
      }
      patch.paid_amount = p
    }

    if ('expense_date' in body && body.expense_date) {
      patch.expense_date = new Date(`${body.expense_date}T00:00:00.000Z`)
    }

    if ('notes' in body) {
      patch.notes = body.notes || null
    }

    if ('receipt_url' in body) {
      patch.receipt_url = body.receipt_url || null
    }

    if ('rent_month' in body) {
      patch.rent_month = body.rent_month || null
    }

    if ('rent_year' in body) {
      patch.rent_year = body.rent_year ? Number(body.rent_year) : null
    }

    // Ledger Head update — must update BOTH ledger_head_id AND category atomically
    if ('ledger_head_id' in body) {
      if (!body.ledger_head_id) {
        // Explicitly clearing ledger_head_id — allowed (reverts to legacy category)
        patch.ledger_head_id = null
        // Do NOT change existing category when clearing LH — preserve historical value
      } else {
        const result = await resolveLedgerHead(body.ledger_head_id)
        if ('error' in result) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }
        patch.ledger_head_id = result.id
        patch.category = result.name // Both updated atomically — no mismatch possible
      }
    }

    // C15: keep the money triple consistent. Editing amount alone
    // used to leave due_amount stale (!= amount − paid). Whenever
    // amount or paid_amount changes, due is recomputed server-side
    // and paid may never exceed amount.
    if ('amount' in patch || 'paid_amount' in patch) {
      const finalAmount = patch.amount ?? Number(existing.amount)
      const finalPaid = patch.paid_amount ?? Number(existing.paid_amount ?? finalAmount)
      if (finalPaid > finalAmount) {
        return NextResponse.json({ error: 'paid_amount cannot exceed amount' }, { status: 400 })
      }
      patch.amount = finalAmount
      patch.paid_amount = finalPaid
      patch.due_amount = roundMoney(finalAmount - finalPaid)
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const fullBeforeForAudit = await prisma.branchCashExpense.findUnique({ where: { id } }).catch(() => null)
    const data = await prisma.$transaction(async (tx) => {
      const updated = await tx.branchCashExpense.update({ where: { id }, data: patch })
      await syncExpenseToLedger(tx, existing as any, updated as any)
      return updated
    })
    const [withHead] = await attachExpenseLedgerHead([data as any])

    // Audit trail
    await prisma.branchAuditTrail.create({
      data: {
        branch_id: existing.branch_id,
        table_name: 'branch_cash_expenses',
        record_id: existing.id,
        action: 'update',
        performed_by: profile.uid,
        performed_by_name: profile.full_name,
        old_value: { category: existing.category, ledger_head_id: existing.ledger_head_id },
        new_value: toPlain(patch),
      },
    })

    await logAudit({
      caller: profile, req, action: 'branch_expense.update', eventType: 'update',
      entityTable: 'branch_cash_expenses', entityId: id, branchId: existing.branch_id,
      fieldChanges: diffFields(fullBeforeForAudit as any, data as any, ['description', 'amount', 'paid_amount', 'due_amount', 'category', 'ledger_head_id', 'notes']),
    })

    // Accounts A1: if the edit changed the posted figures, the
    // journal entry is reversed + reposted (no-op when unchanged).
    await hookResyncSource('branch_cash_expenses', id, profile as any)

    return NextResponse.json({ success: true, expense: toPlain(withHead) })
  } catch (err: any) {
    console.error('[api] app/api/branch-accounts/expenses/route.ts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/branch-accounts/expenses?id=<uuid>
// Admin only (FR-1.6 contract — see the file header).
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isAdmin = callerIsAdmin(profile)
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const expense = await prisma.branchCashExpense.findFirst({
      where: { id },
      select: {
        id: true, branch_id: true, manager_id: true, description: true, amount: true, expense_date: true,
        // Stream links — see the PATCH select above: the delete's
        // ledger reversal must remove exactly what the row's stream
        // contributed when it was created.
        ledger_head_id: true, salary_payment_id: true, expense_request_id: true,
      },
    })

    if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.branchCashExpense.delete({ where: { id } })
      await syncExpenseToLedger(tx, expense as any, null)
    })

    await prisma.branchAuditTrail.create({
      data: {
        branch_id: expense.branch_id,
        table_name: 'branch_cash_expenses',
        record_id: expense.id,
        action: 'delete',
        performed_by: profile.uid,
        performed_by_name: profile.full_name,
        old_value: { description: expense.description, amount: Number(expense.amount) },
      },
    })

    await logAudit({
      caller: profile, req, action: 'branch_expense.delete', eventType: 'delete',
      entityTable: 'branch_cash_expenses', entityId: id, branchId: expense.branch_id,
      oldValue: { description: expense.description, amount: Number(expense.amount) } as any,
    })

    // Accounts A1: deleting reverses the journal entry (append-only
    // contra; the journal never deletes). Fail-soft.
    await hookReverseSource('branch_cash_expenses', id, profile as any, 'Branch expense deleted')

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[api] app/api/branch-accounts/expenses/route.ts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
