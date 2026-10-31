import { NextRequest, NextResponse } from 'next/server'
import { sendDailyClosingEmailToAdmins } from '@/lib/email-service'
import { parseDailyBreakdown } from '@/lib/branch-deposit-utils'
import { dhakaToday } from '@/lib/dhaka-time'
import { parseMoneyAmount } from '@/lib/money'
import { prisma } from '@/lib/db'
import { getCallerProfile, isAdminRole } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { attachLedgerRelations } from '@/lib/server/attach'
import {
  cashDifferencePatch,
  depositDistributionMap,
  depositLedgerModelOf,
  depositLumpDistributionMap,
} from '@/lib/server/ledger-sync'
import { branchStreamAmount } from '@/lib/expense-streams'

// this route's legacy queries (anon +
// service-role) are now Prisma queries via the single role-resolution
// function (lib/server/auth.ts). Behaviour — including every fix
// programme rule noted inline — is unchanged. Response rows pass
// through toPlain() so Decimals/dates render exactly as PostgREST
// rendered them. Prisma has no 1,000-row cap, so the B26/B44
// "complete range" guarantee holds by construction.

// ── Opening cash: ONE carry-forward rule for every created row ──────
// (closing diagnosis §D5 #3 — previously POST-create, PATCH-create and
// the closing UI each derived the opening differently, and Rangpur's
// chain broke 27 times in 38 transitions.)
//
//   opening_cash = the previous recorded day's actual_cash (the
//   physical count) for the same branch; if that day has not been
//   counted/closed yet (actual_cash is null), fall back to its
//   expected_closing_cash. "Previous recorded day" — not the previous
//   calendar day — matching how the chain is audited.
//
//   First day: a branch with no previous recorded day has nothing to
//   carry forward, so the supplied value IS the opening (0 when none
//   is supplied). That is the only case where a supplied opening is
//   accepted without comparison.
//
//   Override: when a previous day exists and the supplied opening
//   differs from the derived carry-forward, the caller must explain
//   why in opening_override_note — otherwise the create is rejected.
//   The override note is kept on the branch audit trail at create
//   (both POST and PATCH); the row itself is flagged in API responses
//   with opening_chain_break (see withOpeningChainFlags) so manager
//   and admin views can show it.
type PreviousLedgerDay = {
  ledger_date: unknown
  actual_cash: unknown
  expected_closing_cash: unknown
}

const moneyEquals = (a: number, b: number) =>
  Math.round(a * 100) === Math.round(b * 100)

/** The carry-forward value implied by a previous day's row, or null
 *  when there is no previous day (the first-day case). */
function derivedOpeningCash(previous: PreviousLedgerDay | null): number | null {
  if (!previous) return null
  if (previous.actual_cash !== null && previous.actual_cash !== undefined) {
    return Number(previous.actual_cash)
  }
  return Number(previous.expected_closing_cash || 0)
}

async function findPreviousLedgerDay(branchId: string, date: string) {
  return prisma.branchCashLedger.findFirst({
    where: { branch_id: branchId, ledger_date: { lt: new Date(`${date}T00:00:00.000Z`) } },
    orderBy: { ledger_date: 'desc' },
    select: { ledger_date: true, actual_cash: true, expected_closing_cash: true },
  })
}

type ResolvedOpening =
  | { openingCash: number; derivedOpening: number | null; isOverride: boolean }
  | { error: string }

/** Decide a created row's opening from the single rule above. */
function resolveCreateOpening({
  previous,
  supplied,
  overrideNote,
}: {
  previous: PreviousLedgerDay | null
  supplied: number | undefined
  overrideNote: unknown
}): ResolvedOpening {
  const derivedOpening = derivedOpeningCash(previous)

  // First recorded day for the branch: the supplied value (or 0)
  // is the opening — there is no chain to break yet.
  if (derivedOpening === null) {
    return { openingCash: supplied ?? 0, derivedOpening, isOverride: false }
  }

  // No opening supplied: the carry-forward applies.
  if (supplied === undefined) {
    return { openingCash: derivedOpening, derivedOpening, isOverride: false }
  }

  // Supplied opening matches the carry-forward: not an override.
  if (moneyEquals(supplied, derivedOpening)) {
    return { openingCash: derivedOpening, derivedOpening, isOverride: false }
  }

  // A differing opening is a deliberate chain break: it needs a note.
  const note = typeof overrideNote === 'string' ? overrideNote.trim() : ''
  if (!note) {
    return {
      error:
        `opening_cash differs from the previous day's carry-forward (৳${derivedOpening}). ` +
        'Provide opening_override_note explaining the override, or use the carry-forward value.',
    }
  }
  return { openingCash: supplied, derivedOpening, isOverride: true }
}

/** The derived flag block for one row, given its carry-forward. */
function openingChainFields(openingCash: unknown, derivedOpening: number | null) {
  return {
    opening_derived_cash: derivedOpening,
    opening_chain_break:
      derivedOpening !== null &&
      openingCash !== null &&
      openingCash !== undefined &&
      !moneyEquals(Number(openingCash), derivedOpening),
  }
}

/**
 * Attach the chain-break flag to plain (toPlain-ed) ledger rows:
 * opening_derived_cash = the carry-forward the single rule derives
 * for that row's date, opening_chain_break = the recorded opening
 * differs from it. Derived per branch from the stored rows
 * themselves — historical openings are reported exactly as recorded,
 * never rewritten. Extra fields only; stored fields pass through.
 */
async function withOpeningChainFlags<T extends Record<string, any>>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows

  const branchIds = [...new Set(rows.map((r) => r.branch_id).filter(Boolean))]
  const derivedByBranchDate = new Map<string, number | null>()
  for (const branchId of branchIds) {
    const maxDate = rows
      .filter((r) => r.branch_id === branchId)
      .reduce((max, r) => (String(r.ledger_date) > max ? String(r.ledger_date) : max), '')
    const sequence = await prisma.branchCashLedger.findMany({
      where: {
        branch_id: branchId,
        ledger_date: { lte: new Date(`${maxDate}T00:00:00.000Z`) },
      },
      orderBy: { ledger_date: 'asc' },
      select: { ledger_date: true, actual_cash: true, expected_closing_cash: true },
    })
    let previous: PreviousLedgerDay | null = null
    for (const row of sequence) {
      const dateKey = toPlain(row).ledger_date
      derivedByBranchDate.set(`${branchId}|${dateKey}`, derivedOpeningCash(previous))
      previous = row as PreviousLedgerDay
    }
  }

  return rows.map((row) => ({
    ...row,
    ...openingChainFields(
      row.opening_cash,
      derivedByBranchDate.get(`${row.branch_id}|${row.ledger_date}`) ?? null,
    ),
  }))
}

async function notifyAdminsOfDailyClosing({
  ledger,
  profile,
}: {
  ledger: any
  profile: any
}) {
  try {
    // 1. Fetch admins for in-app notifications
    const admins = await prisma.profile.findMany({
      where: { role: { in: ['admin', 'super_admin'] } },
      select: { id: true, email: true, full_name: true },
    })

    const branchLabel = ledger.branch?.name || profile.branch || 'Branch'
    const managerLabel = profile.full_name || 'Branch Manager'
    const totalSales = Number(ledger.cash_sales ?? 0) + Number(ledger.bkash_sales ?? 0) + Number(ledger.nagad_sales ?? 0) + Number(ledger.rocket_sales ?? 0) + Number(ledger.card_sales ?? 0) + Number(ledger.bank_transfer_sales ?? 0)
    const formattedTotalSales = Number(totalSales).toLocaleString('en-BD')
    const formattedClosingCash = Number(ledger.actual_cash ?? 0).toLocaleString('en-BD')
    const formattedDeposits = Number(ledger.bank_deposits_out ?? 0).toLocaleString('en-BD')
    const diffStatus = ledger.difference_status || 'matched'

    if (admins.length > 0) {
      const notifs = admins.map((admin) => ({
        user_id: admin.id,
        title: `📊 Daily Closing Submitted`,
        message: `${managerLabel} (${branchLabel}) closed day for ${ledger.ledger_date} — Total Sales: ৳${formattedTotalSales}, Bank Deposited: ৳${formattedDeposits}, Closing Cash: ৳${formattedClosingCash} (${diffStatus.toUpperCase()}). [ledger_id:${ledger.id}]`,
        type: 'general',
        read: false,
      }))
      await prisma.notification.createMany({ data: notifs })
    }

    // 2. Dispatch email asynchronously
    sendDailyClosingEmailToAdmins({
      branchName: branchLabel,
      managerName: managerLabel,
      ledgerDate: ledger.ledger_date,
      openingCash: Number(ledger.opening_cash ?? 0),
      cashSales: Number(ledger.cash_sales ?? 0),
      digitalSales: Number(ledger.bkash_sales ?? 0) + Number(ledger.nagad_sales ?? 0) + Number(ledger.rocket_sales ?? 0) + Number(ledger.card_sales ?? 0) + Number(ledger.bank_transfer_sales ?? 0),
      totalSales: totalSales,
      bkashSales: Number(ledger.bkash_sales ?? 0),
      nagadSales: Number(ledger.nagad_sales ?? 0),
      rocketSales: Number(ledger.rocket_sales ?? 0),
      cardSales: Number(ledger.card_sales ?? 0),
      bankTransferSales: Number(ledger.bank_transfer_sales ?? 0),
      otherCashIn: Number(ledger.other_cash_in ?? 0),
      cashExpenses: Number(ledger.cash_expenses ?? 0),
      bankDepositsOut: Number(ledger.bank_deposits_out ?? 0),
      expectedClosingCash: Number(ledger.expected_closing_cash ?? 0),
      actualCash: Number(ledger.actual_cash ?? 0),
      difference: Number(ledger.cash_difference ?? 0),
      differenceNotes: ledger.difference_notes,
    }).catch((err) => console.error('Error dispatching admin daily closing email:', err))
  } catch (err) {
    console.error('Failed to notify admins of daily closing:', err)
  }
}

// GET /api/branch-accounts/cash-ledger
// Supports:
//  - Single date: ?date=YYYY-MM-DD
//  - Date range: ?from=YYYY-MM-DD&to=YYYY-MM-DD
//  - History: ?history=true (or omit date/from/to)
//  - Branch filter: ?branch_id=xxx (optional for admin, required for manager)
export async function GET(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isAdmin = isAdminRole(profile.role)
    const isManager = profile.is_branch_manager === true
    if (!isAdmin && !isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const limit = Number(searchParams.get('limit') || 60)
    const branchId = isAdmin ? (searchParams.get('branch_id') || undefined) : profile.branch_id

    if (!branchId && !isAdmin) {
      return NextResponse.json({ error: 'No branch assigned' }, { status: 400 })
    }

    let data: any[]
    if (from && to) {
      // B44/B26: an explicit range promises COMPLETE results (the
      // admin page sums these rows into headline totals).
      data = await prisma.branchCashLedger.findMany({
        where: {
          ledger_date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
          ...(branchId ? { branch_id: branchId } : {}),
        },
        orderBy: [{ ledger_date: 'asc' }, { id: 'asc' }],
      })
    } else if (date) {
      data = await prisma.branchCashLedger.findMany({
        where: {
          ledger_date: new Date(`${date}T00:00:00.000Z`),
          ...(branchId ? { branch_id: branchId } : {}),
        },
        orderBy: { ledger_date: 'desc' },
      })
    } else {
      // Default / History: recent history (explicit limit semantics —
      // callers asking for a range use from/to above)
      data = await prisma.branchCashLedger.findMany({
        where: { ...(branchId ? { branch_id: branchId } : {}) },
        orderBy: { ledger_date: 'desc' },
        take: limit,
      })
    }
    data = await attachLedgerRelations(data as any)

    // If querying a single date and branch, augment ledger with pending deposit amounts
    let ledgerResult = data || []
    if (date && branchId && ledgerResult.length > 0) {
      const pendRows = await prisma.branchBankDeposit.findMany({
        where: {
          branch_id: branchId,
          status: { in: ['submitted', 'pending_approval'] },
          // NOT NULL column + required Prisma field: "not reversed"
          // is exactly is_reversed=false (was an invalid OR-with-null
          // that 500'd the single-date ledger view — see dashboard route).
          is_reversed: false,
        },
        select: { amount: true, deposit_date: true, daily_breakdown: true },
      })

      let pendingDepositsAmount = 0
      if (pendRows.length > 0) {
        for (const row of pendRows) {
          const breakdown = parseDailyBreakdown(toPlain(row))
          if (breakdown) {
            // B16: a breakdown deposit contributes ONLY its slice for
            // this date (0 when the date has no slice). The old code
            // fell through and added the FULL deposit amount on
            // deposit_date even when a breakdown existed.
            pendingDepositsAmount += Number(breakdown[date] || 0)
          } else if (toPlain(row).deposit_date === date) {
            pendingDepositsAmount += Number(row.amount || 0)
          }
        }
      }

      ledgerResult = ledgerResult.map((l: any) => ({
        ...l,
        pending_deposits_out: pendingDepositsAmount,
      }))
    }

    const plainLedger = await withOpeningChainFlags(toPlain(ledgerResult))

    // Single-date view of a day with no row yet: also report the
    // server-derived carry-forward opening for that date, so the
    // closing form pre-fills yesterday's count — never the old
    // khuchra float (diagnosis §D1 2.2 path d).
    let derivedOpening: Record<string, unknown> = {}
    if (date && branchId) {
      const previous = await findPreviousLedgerDay(branchId, date)
      derivedOpening = {
        derived_opening_cash: derivedOpeningCash(previous as PreviousLedgerDay | null),
        derived_opening_from_date: previous ? toPlain(previous).ledger_date : null,
      }
    }

    return NextResponse.json({ ledger: plainLedger, ...derivedOpening })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/branch-accounts/cash-ledger
// Create or update a ledger entry (sales data, opening cash, other cash in)
export async function POST(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isAdmin = isAdminRole(profile.role)
    const isManager = profile.is_branch_manager === true
    if (!isAdmin && !isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const {
      ledger_date,
      cash_sales,
      bkash_sales,
      nagad_sales,
      rocket_sales,
      card_sales,
      bank_transfer_sales,
      other_cash_in,
      khuchra_amount,
      opening_override_note,
      actual_cash,
      difference_notes,
      is_closed,
    } = body

    // Manager can only write to their own branch; Admin can specify branch_id
    const branchId = isManager ? profile.branch_id : (body.branch_id || profile.branch_id)
    if (!branchId) return NextResponse.json({ error: 'branch_id required' }, { status: 400 })

    const date = ledger_date || dhakaToday()

    // Money fields were previously written with bare Number(...) casts —
    // negative sales or a negative counted cash reached the database
    // unchecked. Validate every supplied money field (Part D).
    const moneyFields: Record<string, unknown> = {
      cash_sales, bkash_sales, nagad_sales, rocket_sales, card_sales,
      bank_transfer_sales, other_cash_in, khuchra_amount, actual_cash,
    }
    for (const [field, value] of Object.entries(moneyFields)) {
      if (value !== undefined && parseMoneyAmount(value) === null) {
        return NextResponse.json({ error: `${field} must be a valid non-negative amount` }, { status: 400 })
      }
    }

    // Check if record exists
    const existing = await prisma.branchCashLedger.findFirst({
      where: { branch_id: branchId, ledger_date: new Date(`${date}T00:00:00.000Z`) },
    })

    let result: any
    if (existing) {
      const updateData: any = { updated_at: new Date() }
      if (khuchra_amount !== undefined) {
        updateData.khuchra_amount = Number(khuchra_amount)
        updateData.opening_cash = Number(khuchra_amount)
      }
      if (cash_sales !== undefined) updateData.cash_sales = Number(cash_sales)
      if (bkash_sales !== undefined) updateData.bkash_sales = Number(bkash_sales)
      if (nagad_sales !== undefined) updateData.nagad_sales = Number(nagad_sales)
      if (rocket_sales !== undefined) updateData.rocket_sales = Number(rocket_sales)
      if (card_sales !== undefined) updateData.card_sales = Number(card_sales)
      if (bank_transfer_sales !== undefined) updateData.bank_transfer_sales = Number(bank_transfer_sales)
      if (other_cash_in !== undefined) updateData.other_cash_in = Number(other_cash_in)
      if (actual_cash !== undefined) updateData.actual_cash = Number(actual_cash)
      if (difference_notes !== undefined) updateData.difference_notes = difference_notes || null
      if (is_closed !== undefined) {
        updateData.is_closed = !!is_closed
        if (is_closed) {
          updateData.closed_by = profile.uid
          updateData.closed_at = new Date()
        }
      }

      // expected_closing_cash is a Postgres GENERATED column (never
      // written). cash_difference / difference_status were maintained
      // by the old system's recalculate_cash_difference TRIGGER —
      // in the app the same rule runs in code (cashDifferencePatch)
      // whenever a trigger column (money fields / actual_cash) moves.
      result = await prisma.branchCashLedger.update({ where: { id: existing.id }, data: updateData })
      if (
        updateData.opening_cash !== undefined || updateData.cash_sales !== undefined ||
        updateData.other_cash_in !== undefined || updateData.actual_cash !== undefined
      ) {
        const patch = cashDifferencePatch(result as any)
        result = await prisma.branchCashLedger.update({
          where: { id: existing.id },
          data: { ...patch, updated_at: new Date() },
        })
      }
    } else {
      // One opening-cash rule for created rows (see the helper block
      // at the top of this file): the previous recorded day's counted
      // cash, falling back to its expected closing when uncounted;
      // the supplied value only on a branch's first recorded day, or
      // as a noted override.
      const previous = await findPreviousLedgerDay(branchId, date)
      const resolved = resolveCreateOpening({
        previous: previous as PreviousLedgerDay | null,
        supplied: khuchra_amount === undefined ? undefined : Number(khuchra_amount),
        overrideNote: opening_override_note,
      })
      if ('error' in resolved) {
        return NextResponse.json({ error: resolved.error }, { status: 400 })
      }
      const opCash = resolved.openingCash

      const cSales = Number(cash_sales || 0)
      const oIn = Number(other_cash_in || 0)

      // Fetch any existing approved deposits or expenses on that date.
      // B17: a deposit counts toward this date when its lump sum lands
      // here OR its daily_breakdown allocates a slice to this date —
      // the old query only saw deposit_date, missing breakdown slices
      // banked from deposits created on other dates. (The deposit sync
      // service maintains bank_deposits_out afterwards; this is the
      // creation-time snapshot.)
      // Closing-fix §D5 #1 alignment: the snapshot uses the SAME
      // per-deposit drawer model as the sync — deposits stamped
      // [LEDGER_MODEL:lump] count in full on deposit_date only;
      // pre-fix deposits count by the slices actually applied.
      const [depRows, expRows] = await Promise.all([
        prisma.branchBankDeposit.findMany({
          where: { branch_id: branchId, status: 'approved', is_reversed: false },
          select: { amount: true, deposit_date: true, daily_breakdown: true, notes: true },
        }),
        prisma.branchCashExpense.findMany({
          where: { branch_id: branchId, expense_date: new Date(`${date}T00:00:00.000Z`) },
          // Stream links selected so the snapshot counts ONLY the
          // branch stream (owner's account-overview rule): ledger-head
          // rows and salary copies recorded against this branch/day
          // are not drawer expenses.
          select: { amount: true, salary_payment_id: true, expense_request_id: true, ledger_head_id: true },
        }),
      ])
      const bDepositsOut = depRows.reduce((s: number, d: any) => {
        const plain = toPlain(d)
        const amount = Number(plain.amount || 0)
        const map =
          depositLedgerModelOf(plain) === 'lump'
            ? depositLumpDistributionMap(amount, plain.deposit_date)
            : depositDistributionMap(
                amount,
                plain.deposit_date,
                parseDailyBreakdown(plain) ?? plain.daily_breakdown,
                false
              )
        return s + (map.get(date) ?? 0)
      }, 0)
      const cExpenses = expRows.reduce((s: number, e: any) => s + branchStreamAmount(e), 0)

      const insertPayload: any = {
        branch_id: branchId,
        ledger_date: new Date(`${date}T00:00:00.000Z`),
        khuchra_amount: opCash,
        opening_cash: opCash,
        cash_sales: cSales,
        bkash_sales: Number(bkash_sales || 0),
        nagad_sales: Number(nagad_sales || 0),
        rocket_sales: Number(rocket_sales || 0),
        card_sales: Number(card_sales || 0),
        bank_transfer_sales: Number(bank_transfer_sales || 0),
        other_cash_in: oIn,
        cash_expenses: cExpenses,
        bank_deposits_out: bDepositsOut,
        actual_cash: actual_cash !== undefined ? Number(actual_cash) : null,
        // Trigger parity (see above): a row created with a counted
        // cash figure carries its difference from the start.
        ...(actual_cash !== undefined
          ? cashDifferencePatch({
              opening_cash: opCash,
              cash_sales: cSales,
              other_cash_in: oIn,
              cash_expenses: cExpenses,
              bank_deposits_out: bDepositsOut,
              actual_cash: Number(actual_cash),
            })
          : { cash_difference: null, difference_status: null }),
        difference_notes: difference_notes || null,
        is_closed: !!is_closed,
        closed_by: is_closed ? profile.uid : null,
        closed_at: is_closed ? new Date() : null,
        updated_at: new Date(),
      }

      result = await prisma.branchCashLedger.create({ data: insertPayload })

      if (resolved.isOverride) {
        // Same audit-trail note as PATCH-create (see there): the
        // ledger schema has no override-note column, and none is added.
        await prisma.branchAuditTrail.create({
          data: {
            branch_id: branchId,
            table_name: 'branch_cash_ledger',
            record_id: result.id,
            action: 'create',
            performed_by: profile.uid,
            performed_by_name: profile.full_name,
            new_value: {
              opening_cash: resolved.openingCash,
              opening_derived_cash: resolved.derivedOpening,
            },
            notes: `Opening cash override on create for ${date}: recorded ৳${resolved.openingCash} instead of the carry-forward ৳${resolved.derivedOpening}. Note: ${String(opening_override_note).trim()}`,
          },
        })
      }
    }

    const [withRelations] = await attachLedgerRelations([result])
    const [plainLedger] = await withOpeningChainFlags([toPlain(withRelations)])
    return NextResponse.json({ success: true, ledger: plainLedger })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/branch-accounts/cash-ledger — Opening Cash, Daily Closing, Admin Edit, or Reopen
export async function PATCH(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isAdmin = isAdminRole(profile.role)
    const isManager = profile.is_branch_manager === true
    if (!isAdmin && !isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const {
      id,
      action, // 'set_khuchra_amount' | 'close_day' | 'reopen_day' | 'admin_edit'
      ledger_date,
      khuchra_amount,
      opening_override_note,
      cash_sales,
      bkash_sales,
      nagad_sales,
      rocket_sales,
      card_sales,
      bank_transfer_sales,
      other_cash_in,
      actual_cash,
      difference_notes,
      is_closed,
    } = body

    const branchId = isManager ? profile.branch_id : (body.branch_id || profile.branch_id)
    if (!branchId && !id) return NextResponse.json({ error: 'branch_id or id required' }, { status: 400 })

    const date = ledger_date || dhakaToday()

    // Validate supplied money fields (see POST; Part D input validation).
    const patchMoneyFields: Record<string, unknown> = {
      khuchra_amount, cash_sales, bkash_sales, nagad_sales, rocket_sales,
      card_sales, bank_transfer_sales, other_cash_in, actual_cash,
    }
    for (const [field, value] of Object.entries(patchMoneyFields)) {
      if (value !== undefined && parseMoneyAmount(value) === null) {
        return NextResponse.json({ error: `${field} must be a valid non-negative amount` }, { status: 400 })
      }
    }

    // 1. Check or create existing ledger entry
    let existing: any = id
      ? await prisma.branchCashLedger.findFirst({ where: { id } })
      : await prisma.branchCashLedger.findFirst({
          where: { branch_id: branchId, ledger_date: new Date(`${date}T00:00:00.000Z`) },
        })

    if (!existing) {
      // Create the initial ledger row for this date — with the SAME
      // opening-cash rule as POST create (see the helper block at the
      // top of this file). The old bare create silently opened at the
      // supplied value or 0, with no previous-day lookup at all: four
      // of Rangpur's historical chain breaks are 0-openings created
      // exactly this way.
      const previous = branchId ? await findPreviousLedgerDay(branchId, date) : null
      const resolved = resolveCreateOpening({
        previous: previous as PreviousLedgerDay | null,
        supplied: khuchra_amount === undefined ? undefined : Number(khuchra_amount),
        overrideNote: opening_override_note,
      })
      if ('error' in resolved) {
        return NextResponse.json({ error: resolved.error }, { status: 400 })
      }
      existing = await prisma.branchCashLedger.create({
        data: {
          branch_id: branchId,
          ledger_date: new Date(`${date}T00:00:00.000Z`),
          khuchra_amount: resolved.openingCash,
          opening_cash: resolved.openingCash,
          updated_at: new Date(),
        },
      })
      if (resolved.isOverride) {
        // The override note lives on the audit trail — the ledger
        // schema has no note column of its own, and none is added.
        await prisma.branchAuditTrail.create({
          data: {
            branch_id: branchId,
            table_name: 'branch_cash_ledger',
            record_id: existing.id,
            action: 'update',
            performed_by: profile.uid,
            performed_by_name: profile.full_name,
            new_value: {
              opening_cash: resolved.openingCash,
              opening_derived_cash: resolved.derivedOpening,
            },
            notes: `Opening cash override on create for ${date}: recorded ৳${resolved.openingCash} instead of the carry-forward ৳${resolved.derivedOpening}. Note: ${String(opening_override_note).trim()}`,
          },
        })
      }
    }

    // Branch-ownership check (Part D): the row above may have been
    // loaded by a body-supplied id alone — a manager of branch A must
    // never be able to set opening cash, close, or reopen branch B's
    // day by quoting B's ledger id. Admins are unrestricted.
    if (isManager && !isAdmin && existing.branch_id !== profile.branch_id) {
      return NextResponse.json({ error: 'Forbidden: Not your branch' }, { status: 403 })
    }

    // Handle Action: Admin Full Edit
    if (action === 'admin_edit') {
      if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

      const updateData: any = { updated_at: new Date() }
      if (khuchra_amount !== undefined) {
        updateData.khuchra_amount = Number(khuchra_amount)
        updateData.opening_cash = Number(khuchra_amount)
      }
      if (cash_sales !== undefined) updateData.cash_sales = Number(cash_sales)
      if (bkash_sales !== undefined) updateData.bkash_sales = Number(bkash_sales)
      if (nagad_sales !== undefined) updateData.nagad_sales = Number(nagad_sales)
      if (rocket_sales !== undefined) updateData.rocket_sales = Number(rocket_sales)
      if (card_sales !== undefined) updateData.card_sales = Number(card_sales)
      if (bank_transfer_sales !== undefined) updateData.bank_transfer_sales = Number(bank_transfer_sales)
      if (other_cash_in !== undefined) updateData.other_cash_in = Number(other_cash_in)
      if (difference_notes !== undefined) updateData.difference_notes = difference_notes || null
      if (is_closed !== undefined) updateData.is_closed = !!is_closed

      // If opening or sales changed, update first to let postgres recalculate expected_closing_cash
      const refreshed = await prisma.branchCashLedger.update({
        where: { id: existing.id },
        data: updateData,
      })

      // If actual_cash provided or changed, recalculate difference.
      // the old trigger (recalculate_cash_difference) did this
      // in the database; cashDifferencePatch is the same rule in code,
      // applied against the refreshed row (whose expected_closing_cash
      // the database has just recomputed).
      const finalActual = actual_cash !== undefined ? Number(actual_cash) : refreshed.actual_cash
      if (finalActual !== null && finalActual !== undefined) {
        const patch = cashDifferencePatch({ ...(refreshed as any), actual_cash: Number(finalActual) })
        const finalData = await prisma.branchCashLedger.update({
          where: { id: existing.id },
          data: { actual_cash: Number(finalActual), ...patch, updated_at: new Date() },
        })
        const [withRelations] = await attachLedgerRelations([finalData])
        const [plainLedger] = await withOpeningChainFlags([toPlain(withRelations)])
        return NextResponse.json({ success: true, ledger: plainLedger })
      }

      const [plainRefreshed] = await withOpeningChainFlags([toPlain(refreshed)])
      return NextResponse.json({ success: true, ledger: plainRefreshed })
    }

    // Handle Action: Setting Opening Cash
    if (action === 'set_khuchra_amount' || (khuchra_amount !== undefined && actual_cash === undefined && action !== 'reopen_day')) {
      // Changing the opening cash of an already-CLOSED day rewrites a
      // settled day's history — admin only.
      if (existing.is_closed && !isAdmin) {
        return NextResponse.json({ error: 'Forbidden: day is closed — admin only' }, { status: 403 })
      }
      // opening_cash is a trigger column in the old system: moving
      // it recomputes the day's difference when a count exists.
      const diffPatch = cashDifferencePatch({
        ...(existing as any),
        opening_cash: Number(khuchra_amount),
        // The stored expected_closing_cash predates this opening
        // change — force the field formula instead.
        expected_closing_cash: null,
      })
      const updated = await prisma.branchCashLedger.update({
        where: { id: existing.id },
        data: {
          khuchra_amount: Number(khuchra_amount),
          opening_cash: Number(khuchra_amount),
          ...diffPatch,
          updated_at: new Date(),
        },
      })

      await prisma.branchAuditTrail.create({
        data: {
          branch_id: branchId,
          table_name: 'branch_cash_ledger',
          record_id: updated.id,
          action: 'update',
          performed_by: profile.uid,
          performed_by_name: profile.full_name,
          new_value: { khuchra_amount: Number(khuchra_amount) },
          notes: `Opening cash ${existing.is_closed ? 'updated' : 'set'} to ৳${khuchra_amount} for ${date}`,
        },
      })

      const [withRelations] = await attachLedgerRelations([updated])
      const [plainLedger] = await withOpeningChainFlags([toPlain(withRelations)])
      return NextResponse.json({ success: true, ledger: plainLedger })
    }

    // Handle Action: Reopen Day (kept for API compatibility)
    // Reopening a closed day un-settles its accounts — admin only
    // (this previously had NO admin check at all; Part D).
    if (action === 'reopen_day') {
      if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 })
      const reopened = await prisma.branchCashLedger.update({
        where: { id: existing.id },
        data: {
          is_closed: false,
          closed_by: null,
          closed_at: null,
          updated_at: new Date(),
        },
      })
      const [withRelations] = await attachLedgerRelations([reopened])
      const [plainLedger] = await withOpeningChainFlags([toPlain(withRelations)])
      return NextResponse.json({ success: true, ledger: plainLedger })
    }

    // Handle Action: Daily Closing / Update Closing (actual_cash provided)
    // Managers & Admins can record or update that day's closing numbers seamlessly
    const isUpdate = !!existing.is_closed

    // Prepare updates for digital sales and opening cash if submitted
    const closingPreUpdates: any = { updated_at: new Date() }
    if (khuchra_amount !== undefined) {
      closingPreUpdates.khuchra_amount = Number(khuchra_amount)
      closingPreUpdates.opening_cash = Number(khuchra_amount)
    }
    if (cash_sales !== undefined) {
      closingPreUpdates.cash_sales = Number(cash_sales)
    }
    // B19 (CRITICAL): the old code BACK-SOLVED cash_sales from the
    // counted cash whenever recorded sales were 0
    // (sales := actual − opening − otherIn + expenses + deposits) and
    // wrote the invented figure back as the day's sales. The closing
    // difference then equalled 0 BY CONSTRUCTION — a real cash shortage
    // could never appear. Removed: closing now uses the RECORDED sales
    // (0 if none were recorded) and the difference is whatever it
    // honestly is — shortage included.
    if (bkash_sales !== undefined) closingPreUpdates.bkash_sales = Number(bkash_sales)
    if (nagad_sales !== undefined) closingPreUpdates.nagad_sales = Number(nagad_sales)
    if (rocket_sales !== undefined) closingPreUpdates.rocket_sales = Number(rocket_sales)
    if (card_sales !== undefined) closingPreUpdates.card_sales = Number(card_sales)
    if (bank_transfer_sales !== undefined) closingPreUpdates.bank_transfer_sales = Number(bank_transfer_sales)
    if (other_cash_in !== undefined) closingPreUpdates.other_cash_in = Number(other_cash_in)

    existing = await prisma.branchCashLedger.update({
      where: { id: existing.id },
      data: closingPreUpdates,
    })

    // B20: the fallback must mirror the generated column exactly —
    // opening_cash, NOT khuchra_amount (the two diverge on
    // trigger-created/legacy rows, so audit-trail figures disagreed
    // with the stored row).
    const calcExpected = (Number(existing.opening_cash ?? 0) + Number(existing.cash_sales ?? 0) + Number(existing.other_cash_in ?? 0))
      - Number(existing.cash_expenses ?? 0) - Number(existing.bank_deposits_out ?? 0)
    const expectedCash = existing.expected_closing_cash !== null && existing.expected_closing_cash !== undefined
      ? Number(existing.expected_closing_cash)
      : calcExpected
    const actualCash = Number(actual_cash ?? 0)
    const difference = actualCash - expectedCash
    const diffStatus = difference === 0 ? 'matched' : difference < 0 ? 'shortage' : 'excess'
    const netCashToday = actualCash - Number(existing.opening_cash ?? 0)

    const data = await prisma.branchCashLedger.update({
      where: { id: existing.id },
      data: {
        actual_cash: actualCash,
        // persisted here in code — the old system's trigger
        // wrote these on the actual_cash update (values identical to
        // the ones computed above and recorded in the audit trail).
        cash_difference: difference,
        difference_status: diffStatus,
        difference_notes: difference_notes || null,
        is_closed: true,
        closed_by: profile.uid,
        closed_at: existing.closed_at || new Date(),
        updated_at: new Date(),
      },
    })

    // Audit trail
    await prisma.branchAuditTrail.create({
      data: {
        branch_id: branchId,
        table_name: 'branch_cash_ledger',
        record_id: data.id,
        action: isUpdate ? 'update' : 'create',
        performed_by: profile.uid,
        performed_by_name: profile.full_name,
        new_value: {
          khuchra_amount: existing.khuchra_amount !== null && existing.khuchra_amount !== undefined ? Number(existing.khuchra_amount) : null,
          actual_cash: actualCash,
          net_cash_today: netCashToday,
          cash_difference: data?.cash_difference !== null && data?.cash_difference !== undefined ? Number(data.cash_difference) : difference,
          difference_status: data?.difference_status ?? diffStatus,
          difference_notes,
        },
        notes: `${isUpdate ? 'Updated daily closing' : 'Daily cash closing'} for ${date}: Opening ৳${existing.opening_cash ?? 0}, Closing ৳${actualCash}, Net ৳${netCashToday}`,
      },
    })

    const [withRelations] = await attachLedgerRelations([data])
    await notifyAdminsOfDailyClosing({ ledger: toPlain(withRelations), profile })

    const [plainLedger] = await withOpeningChainFlags([toPlain(withRelations)])
    return NextResponse.json({ success: true, ledger: plainLedger })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/branch-accounts/cash-ledger?id=xxx (Admin only)
export async function DELETE(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isAdmin = isAdminRole(profile.role)
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const existing = await prisma.branchCashLedger.findFirst({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 })

    await prisma.branchCashLedger.delete({ where: { id } })

    await prisma.branchAuditTrail.create({
      data: {
        branch_id: existing.branch_id,
        table_name: 'branch_cash_ledger',
        record_id: id,
        action: 'delete',
        performed_by: profile.uid,
        performed_by_name: profile.full_name,
        old_value: toPlain(existing),
        notes: `Admin deleted cash ledger entry for ${toPlain(existing).ledger_date}`,
      },
    })

    return NextResponse.json({ success: true, message: 'Deleted successfully' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
