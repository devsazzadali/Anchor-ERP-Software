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
 * ── Owner OPTION 1 (ruled 2026-11-01): confirm-as-acknowledgement ──
 *
 * The confirm MODE is a property of the POSITION (its stored
 * `origin`), never of the caller:
 *
 *   origin 'cutover'  — the position's history is NOT in the
 *     journal (a fresh cutover). Confirm = the A3 flow above:
 *     post the P12 entry, then flip status.
 *   origin 'backfill' — the position summarises history that A1
 *     ALREADY backfilled into the journal in full (the existing
 *     DRAFT's case). Posting P12 on top would DOUBLE-COUNT every
 *     figure it summarises (e.g. bank Dr ৳449,000 from the approved
 *     deposits IS the position's bank-candidate lines). Confirm =
 *     ACKNOWLEDGEMENT ONLY: flip status + confirmed_by/at stamps
 *     (+ the route's S1 audit row), ZERO journal writes.
 *
 * The posting branch is unreachable for a backfilled position:
 * `confirmOpeningPositionWithPosting` refuses it outright
 * (OpeningConfirmRefusedError, 409) and leaves a durable trace —
 * a posting_exceptions row the A9 inbox surfaces — so even a
 * direct service-level call cannot double-count. Symmetrically,
 * `acknowledgeOpeningPosition` refuses a cutover position.
 * `confirmOpeningPosition` is the mode dispatcher both the route
 * and the suites call.
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

/** A position whose history is already posted in the journal. */
export function isBackfilledPosition(position: { origin?: string | null }): boolean {
  return position?.origin === 'backfill'
}

/**
 * Refusal for a confirm attempted through the WRONG branch for the
 * position's provenance. Carries an HTTP-ish status so the route
 * can answer 409 without knowing the internals.
 */
export class OpeningConfirmRefusedError extends Error {
  readonly status = 409
  readonly reason: 'posting_refused_backfilled' | 'ack_refused_not_backfilled'
  readonly position_id: string
  constructor(
    reason: 'posting_refused_backfilled' | 'ack_refused_not_backfilled',
    positionId: string,
    message: string
  ) {
    super(message)
    this.name = 'OpeningConfirmRefusedError'
    this.reason = reason
    this.position_id = positionId
  }
}

export function isOpeningConfirmRefusedError(err: unknown): err is OpeningConfirmRefusedError {
  return err instanceof OpeningConfirmRefusedError
}

/**
 * Durable trace for a refused posting-branch attempt on a
 * backfilled position: one posting_exceptions row (the A9 inbox
 * feed), keyed like the period-block rows. Refresh semantics
 * mirror recordPostingException: a repeat attempt refreshes the
 * row and clears any workflow stamps. Never throws — a trace
 * failure must not mask the refusal itself.
 */
async function recordOpeningGuardException(
  db: Db,
  position: any,
  callerId: string | null
): Promise<void> {
  try {
    const cutover = openingCutoverDate(position.as_of_date)
    const detail = {
      memo: `P12 opening posting refused — position ${position.id} summarises backfilled history`,
      recorded_from: 'opening_guard',
      attempted_by: callerId,
    }
    const existing = await db.postingException.findFirst({
      where: { source_table: 'opening_positions', source_id: position.id, event_type: 'opening' },
      select: { id: true },
    })
    if (existing) {
      await db.postingException.update({
        where: { id: existing.id },
        data: {
          entry_date: new Date(`${cutover}T00:00:00Z`),
          period_month: cutover.slice(0, 7),
          reason: 'posting_refused_backfilled',
          detail: detail as any,
          status: 'open',
          resolved_at: null,
          resolved_by: null,
          resolution_note: null,
          acknowledged_at: null,
          acknowledged_by: null,
        },
      })
    } else {
      await db.postingException.create({
        data: {
          source_table: 'opening_positions',
          source_id: position.id,
          event_type: 'opening',
          entry_date: new Date(`${cutover}T00:00:00Z`),
          period_month: cutover.slice(0, 7),
          reason: 'posting_refused_backfilled',
          detail: detail as any,
          status: 'open',
        },
      })
    }
  } catch (err: any) {
    console.error('[accounts] opening guard exception record failed:', err?.message || err)
  }
}

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
  /** 'posting' = P12 entry posted (cutover); 'acknowledgement' = status flip only (backfill). */
  mode: 'posting' | 'acknowledgement'
  /** Null in acknowledgement mode — no entry exists by design. */
  entry_id: string | null
  entry_created: boolean
  already_confirmed: boolean
}

/**
 * Confirm a CUTOVER position AND post its opening entry (P12) —
 * the A3 flow, unchanged. Idempotent on both halves: the entry by
 * its unique source key, the status flip by the confirmed-state
 * early return.
 *
 * HARD GUARD: a backfilled position can never take this branch —
 * it is refused (409) with a durable exception trace, because
 * posting its snapshot on top of the A1 backfill double-counts.
 */
export async function confirmOpeningPositionWithPosting(
  db: Db,
  positionId: string,
  callerId: string | null
): Promise<ConfirmOpeningResult> {
  const position = await db.openingPosition.findUnique({ where: { id: positionId } })
  if (!position) throw new Error('ACCOUNTS: opening position not found')

  if (isBackfilledPosition(position)) {
    await recordOpeningGuardException(db, position, callerId)
    throw new OpeningConfirmRefusedError(
      'posting_refused_backfilled',
      positionId,
      `ACCOUNTS: opening position ${positionId} summarises history already posted in the journal (backfilled) — ` +
        'the P12 posting branch is refused; confirm it as an acknowledgement instead.'
    )
  }

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
    mode: 'posting',
    entry_id: posted.entry_id,
    entry_created: posted.created,
    already_confirmed: already,
  }
}

/**
 * Confirm a BACKFILLED position as an ACKNOWLEDGEMENT only
 * (owner OPTION 1): flip status + confirmed_by/at stamps, ZERO
 * journal writes — the figures are already in the journal from
 * the A1 backfill. Idempotent: re-confirming returns
 * already_confirmed with no writes. Refuses a cutover position
 * (its confirm must post the P12 entry).
 */
export async function acknowledgeOpeningPosition(
  db: Db,
  positionId: string,
  callerId: string | null
): Promise<ConfirmOpeningResult> {
  const position = await db.openingPosition.findUnique({ where: { id: positionId } })
  if (!position) throw new Error('ACCOUNTS: opening position not found')

  if (!isBackfilledPosition(position)) {
    throw new OpeningConfirmRefusedError(
      'ack_refused_not_backfilled',
      positionId,
      `ACCOUNTS: opening position ${positionId} is a cutover position — its history is not in the journal, ` +
        'so confirming must post the P12 opening entry; the acknowledgement branch is refused.'
    )
  }

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
    mode: 'acknowledgement',
    entry_id: null,
    entry_created: false,
    already_confirmed: already,
  }
}

/**
 * Confirm an opening position in the mode its PROVENANCE dictates
 * (the single entry point the route calls): backfilled positions
 * confirm as an acknowledgement only; cutover positions post the
 * P12 entry. The mode is read from the stored position — callers
 * cannot choose it.
 */
export async function confirmOpeningPosition(
  db: Db,
  positionId: string,
  callerId: string | null
): Promise<ConfirmOpeningResult> {
  const position = await db.openingPosition.findUnique({ where: { id: positionId } })
  if (!position) throw new Error('ACCOUNTS: opening position not found')
  return isBackfilledPosition(position)
    ? acknowledgeOpeningPosition(db, positionId, callerId)
    : confirmOpeningPositionWithPosting(db, positionId, callerId)
}
