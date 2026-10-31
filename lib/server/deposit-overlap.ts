/**
 * Deposit sales-period overlap validation (closing fix, 2026-10-31 —
 * diagnosis §D5 #2 / §D3 (d2): two approved SOTIBARI deposits claimed
 * the same sales days, and the same days' cash was subtracted from
 * the drawer twice).
 *
 * Rule: a deposit's sales_from_date–sales_to_date window must not
 * overlap another deposit for the SAME branch that is already a live
 * claim on those days — status approved, submitted or pending_approval.
 * Rejected deposits never block (their claim was refused), and draft
 * deposits do not block either (they assert no claim yet — they are
 * checked when they are submitted / approved). A reversed deposit's
 * claim was backed out, so it does not block. The check runs at
 * create, at submit/resubmit/edit of a live claim, and again at
 * approval — approval is the moment the money enters the ledger, so
 * it is the last line of defence.
 *
 * Rejection only: there is deliberately NO silent override here. An
 * explicit override-with-audit (an admin knowingly allowing an
 * overlap, with the reason recorded) is a possible future owner
 * decision; until then, overlapping deposits are refused with a
 * message naming the conflicting deposit.
 */

export const DEPOSIT_BLOCKING_STATUSES = ['approved', 'submitted', 'pending_approval']

function dateKey(d: Date | string | null | undefined): string | null {
  if (d === null || d === undefined || d === '') return null
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  return String(d).slice(0, 10)
}

/** Inclusive range overlap: [aFrom, aTo] and [bFrom, bTo] share a day. */
export function salesRangesOverlap(
  aFrom: Date | string,
  aTo: Date | string,
  bFrom: Date | string,
  bTo: Date | string
): boolean {
  const af = dateKey(aFrom)
  const at = dateKey(aTo)
  const bf = dateKey(bFrom)
  const bt = dateKey(bTo)
  if (!af || !at || !bf || !bt) return false
  return af <= bt && bf <= at
}

export interface DepositOverlapConflict {
  id: string
  amount: number
  status: string
  sales_from_date: string | null
  sales_to_date: string | null
}

/**
 * Find a live-claim deposit for this branch whose sales window
 * overlaps [salesFromDate, salesToDate]. `client` is the Prisma
 * client or a transaction client — anything with branchBankDeposit.
 * Returns null when either date is missing (a window cannot be
 * determined, so nothing can be proven to overlap) or when no live
 * claim overlaps.
 */
export async function findDepositSalesOverlap(
  client: { branchBankDeposit: { findFirst: (args: any) => Promise<any> } },
  args: {
    branchId: string
    salesFromDate: Date | string | null | undefined
    salesToDate: Date | string | null | undefined
    excludeId?: string
  }
): Promise<DepositOverlapConflict | null> {
  const fromKey = dateKey(args.salesFromDate as any)
  const toKey = dateKey(args.salesToDate as any)
  if (!fromKey || !toKey) return null

  const found = await client.branchBankDeposit.findFirst({
    where: {
      branch_id: args.branchId,
      ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
      status: { in: DEPOSIT_BLOCKING_STATUSES },
      is_reversed: false,
      sales_from_date: { lte: new Date(`${toKey}T00:00:00.000Z`) },
      sales_to_date: { gte: new Date(`${fromKey}T00:00:00.000Z`) },
    },
    select: { id: true, amount: true, status: true, sales_from_date: true, sales_to_date: true },
    orderBy: { created_at: 'asc' },
  })
  if (!found) return null
  return {
    id: found.id,
    amount: Number(found.amount),
    status: found.status,
    sales_from_date: dateKey(found.sales_from_date),
    sales_to_date: dateKey(found.sales_to_date),
  }
}

/** The rejection message for an overlapping deposit (HTTP 400). */
export function depositOverlapMessage(
  conflict: DepositOverlapConflict,
  salesFromDate: Date | string,
  salesToDate: Date | string
): string {
  const amount = `৳${conflict.amount.toLocaleString('en-BD')}`
  return (
    `Sales period ${dateKey(salesFromDate)} to ${dateKey(salesToDate)} overlaps an existing ` +
    `${conflict.status} deposit for this branch (${amount}, sales ${conflict.sales_from_date} to ` +
    `${conflict.sales_to_date}). The same sales days cannot be claimed by two deposits — ` +
    `reject or correct the other deposit first.`
  )
}
