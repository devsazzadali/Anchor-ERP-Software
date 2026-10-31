/**
 * Accounts A3 — the P12 opening entry (lib/server/accounting/openingPost.ts).
 *
 * A1 stored the opening position as a computed DRAFT snapshot and
 * built the owner's confirm action WITHOUT a journal posting. A3
 * completes the flow the blueprint specifies (§B.2 P12, §B.3):
 * confirming a position now ALSO posts the opening journal entry
 * through the engine —
 *
 *   Dr Cash in Hand — Branches   (per branch-cash line, branch-tagged)
 *   Dr Bank — <account>          (per bank candidate, its own line)
 *   Dr Inventory                 (costed-chalans figure)
 *   Cr Accounts Payable          (one line per itemised due)
 *   Cr Owner Capital             (the explicit balancing figure)
 *
 * dated the cutover date — the 1st of the month after the
 * position's as-of month (decision D10). The entry is keyed
 * (source_table='opening_positions', source_id=position id,
 * event_type='opening'), so confirming twice can never post twice.
 * Posting happens BEFORE the status flip: if the entry cannot post
 * (e.g. its period is locked), the position stays DRAFT and the
 * route answers with the refusal.
 *
 * ⚠ Interaction with the A1 backfill — flagged for Boss/owner in
 * the A3 report: A1 backfilled ALL history into the journal (the
 * owner's order), so the journal already carries the activity this
 * position summarises. Pressing Confirm on the real DRAFT position
 * will therefore ADD the snapshot balances on top of the backfilled
 * flows. The flow is built and proven (on a fixture position); the
 * ruling on whether/when the owner confirms the real position —
 * given that interaction — is Boss's/owner's, and A3 does not
 * execute it.
 */
import { postEvent, type Db, type PostEventInput } from './post'
import { ACCT } from './events'

/** Cutover date (D10): the 1st of the month after the as-of month. */
export function openingCutoverDate(asOf: Date | string): string {
  const s = typeof asOf === 'string' ? asOf : asOf.toISOString().slice(0, 10)
  const [y, m] = s.split('-').map(Number)
  const first = new Date(Date.UTC(y, m, 1)) // m is 1-based → this is the 1st of next month
  return first.toISOString().slice(0, 10)
}

const num = (v: unknown): number => (v == null ? 0 : Number((v as any).toString()))

/** Translate one stored position into the P12 journal input. */
export async function buildOpeningEntryInput(db: Db, position: any): Promise<PostEventInput> {
  const lines = await db.openingPositionLine.findMany({
    where: { position_id: position.id },
    orderBy: { created_at: 'asc' },
  })
  if (lines.length === 0) throw new Error(`ACCOUNTS: opening position ${position.id} has no lines`)

  const out: PostEventInput['lines'] = []
  for (const l of lines) {
    const amount = num(l.amount)
    if (amount === 0) continue
    const put = (account_code: string, extra?: Partial<PostEventInput['lines'][number]>) =>
      out.push({
        account_code,
        ...(l.side === 'credit' ? { credit: amount } : { debit: amount }),
        memo: l.label,
        ...extra,
      })
    switch (l.component) {
      case 'cash_branch':
        put(ACCT.cashBranch, { branch_id: l.branch_id ?? null })
        break
      case 'bank_candidate': {
        // Each candidate posts to ITS OWN bank chart account.
        let code: string = ACCT.bankUnallocated
        if (l.bank_account_id) {
          const bank = await db.bankAccount.findUnique({ where: { id: l.bank_account_id } })
          if (bank?.chart_account_id) {
            const acct = await db.chartAccount.findUnique({
              where: { id: bank.chart_account_id },
              select: { code: true },
            })
            if (acct) code = acct.code
          }
        }
        put(code)
        break
      }
      case 'inventory_cost':
        put(ACCT.inventory)
        break
      case 'payables': {
        // Itemised: one credit line per recorded due when the
        // position line carries its derivation detail.
        const items = Array.isArray(l.detail) ? l.detail : null
        if (items && items.length > 0) {
          for (const it of items) {
            const due = num((it as any).due)
            if (due <= 0) continue
            out.push({
              account_code: ACCT.accountsPayable,
              credit: due,
              memo: `Payable — ${(it as any).purpose ?? 'company expense due'}`,
            })
          }
        } else {
          put(ACCT.accountsPayable)
        }
        break
      }
      case 'equity':
        // The explicit balancing figure → Owner Capital (3000).
        put('3000')
        break
      default:
        throw new Error(`ACCOUNTS: opening component '${l.component}' has no posting map (position ${position.id})`)
    }
  }
  return {
    source_table: 'opening_positions',
    source_id: position.id,
    event_type: 'opening',
    entry_date: openingCutoverDate(position.as_of_date),
    memo: `Opening entry (P12) — ${position.label}`,
    lines: out,
  }
}

export interface ConfirmOpeningResult {
  position_id: string
  status: string
  entry_id: string
  entry_created: boolean
  already_confirmed: boolean
}

/**
 * Confirm a draft position AND post its opening entry (P12).
 * Idempotent on both halves: the entry by its unique source key,
 * the status flip by the confirmed-state early return.
 */
export async function confirmOpeningPosition(
  db: Db,
  positionId: string,
  callerId: string | null
): Promise<ConfirmOpeningResult> {
  const position = await db.openingPosition.findUnique({ where: { id: positionId } })
  if (!position) throw new Error('ACCOUNTS: opening position not found')

  const input = await buildOpeningEntryInput(db, position)
  const posted = await postEvent(db, { ...input, created_by: callerId })

  const already = position.status === 'confirmed'
  if (!already) {
    await db.openingPosition.update({
      where: { id: positionId },
      data: { status: 'confirmed', confirmed_by: callerId, confirmed_at: new Date() },
    })
  }
  return {
    position_id: positionId,
    status: 'confirmed',
    entry_id: posted.entry_id,
    entry_created: posted.created,
    already_confirmed: already,
  }
}
