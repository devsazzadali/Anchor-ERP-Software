/**
 * Accounts A1 — the posting service (lib/server/accounting/post.ts).
 *
 * ONE idempotent writer for the double-entry journal. Every
 * operational event (closing, deposit, salary, expense, chalan, …)
 * becomes a balanced journal entry through here — the builders in
 * events.ts translate source rows into lines, this file validates
 * and persists them.
 *
 * Laws (blueprint §B.0):
 *  - The journal is APPEND-ONLY. This module exposes create +
 *    reversal only; there is no update or delete path for entries.
 *  - Idempotency: (source_table, source_id, event_type) is unique.
 *    Re-firing the same source event returns the existing entry —
 *    retries and double hooks can never double-post.
 *  - Every entry balances to the poisha: Σ debit == Σ credit, each
 *    line carries exactly one side > 0. Amounts are validated as
 *    integer poisha (lib/money) and stored as Decimal(15,2) strings.
 *  - Amounts are the source rows' own figures — the posting service
 *    never recomputes money.
 *
 * The `db` argument is the root Prisma client (routes pass
 * `@/lib/db`'s prisma; scripts pass their own client). It is a
 * parameter — not an import — so proof/backfill scripts can import
 * this module directly without the app's path aliases.
 */
import { createHash } from 'crypto'
import { toPoisha } from '../../money'

export type Db = any

export interface PostingLineInput {
  account_code: string
  branch_id?: string | null
  counterparty_id?: string | null
  debit?: number
  credit?: number
  memo?: string | null
}

export interface PostEventInput {
  source_table?: string | null
  source_id?: string | null
  event_type: string
  /** YYYY-MM-DD (Dhaka calendar date of the source event). */
  entry_date: string
  memo?: string | null
  created_by?: string | null
  lines: PostingLineInput[]
  is_reversal?: boolean
  reverses_entry_id?: string | null
}

/** Integer-poisha → exact Decimal(15,2) string, no float drift. */
export function poishaToDecimalString(poisha: number): string {
  const neg = poisha < 0
  const abs = Math.abs(Math.round(poisha))
  const int = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${neg ? '-' : ''}${int}.${frac}`
}

/** Deterministic UUID from a string key (state-keyed idempotency). */
export function uuidFromString(key: string): string {
  const h = createHash('sha256').update(key).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

async function resolveAccountIds(db: Db, codes: string[]): Promise<Map<string, string>> {
  const rows = await db.chartAccount.findMany({
    where: { code: { in: [...new Set(codes)] } },
    select: { id: true, code: true },
  })
  const map = new Map<string, string>(rows.map((r: any) => [r.code, r.id]))
  for (const code of codes) {
    if (!map.has(code)) throw new Error(`ACCOUNTS: chart account ${code} not found (seed missing?)`)
  }
  return map
}

async function resolvePeriodId(db: Db, entryDate: string): Promise<string> {
  const month = entryDate.slice(0, 7)
  const period = await db.accountingPeriod.findUnique({ where: { month } })
  if (!period) throw new Error(`ACCOUNTS: no accounting period for ${month}`)
  if (period.status === 'locked') throw new Error(`ACCOUNTS: period ${month} is locked`)
  return period.id
}

export interface PostResult {
  entry_id: string
  created: boolean
}

/**
 * Post one balanced journal entry. Idempotent on
 * (source_table, source_id, event_type): a re-fire returns the
 * existing entry with created=false.
 */
export async function postEvent(db: Db, input: PostEventInput): Promise<PostResult> {
  if (input.source_table && input.source_id) {
    const existing = await db.journalEntry.findFirst({
      where: {
        source_table: input.source_table,
        source_id: input.source_id,
        event_type: input.event_type,
      },
      select: { id: true },
    })
    if (existing) return { entry_id: existing.id, created: false }
  }

  // Validate lines in integer poisha.
  let totalDebit = 0
  let totalCredit = 0
  const prepared = input.lines.map((l) => {
    const debit = toPoisha(Number(l.debit ?? 0))
    const credit = toPoisha(Number(l.credit ?? 0))
    if (debit < 0 || credit < 0) throw new Error('ACCOUNTS: negative line amount')
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw new Error('ACCOUNTS: each line carries exactly one side > 0')
    }
    totalDebit += debit
    totalCredit += credit
    return { ...l, debitP: debit, creditP: credit }
  })
  if (prepared.length < 2) throw new Error('ACCOUNTS: an entry needs at least two lines')
  if (totalDebit !== totalCredit || totalDebit === 0) {
    throw new Error(`ACCOUNTS: unbalanced entry (debit ${totalDebit} != credit ${totalCredit} poisha)`)
  }

  const accountIds = await resolveAccountIds(db, prepared.map((l) => l.account_code))
  const periodId = await resolvePeriodId(db, input.entry_date)

  const entry = await db.$transaction(async (tx: Db) => {
    const created = await tx.journalEntry.create({
      data: {
        entry_date: new Date(`${input.entry_date}T00:00:00Z`),
        period_id: periodId,
        source_table: input.source_table ?? null,
        source_id: input.source_id ?? null,
        event_type: input.event_type,
        memo: input.memo ?? null,
        status: 'posted',
        is_reversal: !!input.is_reversal,
        reverses_entry_id: input.reverses_entry_id ?? null,
        created_by: input.created_by ?? null,
        posted_by: input.created_by ?? null,
        posted_at: new Date(),
      },
    })
    await tx.journalLine.createMany({
      data: prepared.map((l) => ({
        entry_id: created.id,
        account_id: accountIds.get(l.account_code)!,
        branch_id: l.branch_id ?? null,
        counterparty_id: l.counterparty_id ?? null,
        debit: poishaToDecimalString(l.debitP),
        credit: poishaToDecimalString(l.creditP),
        memo: l.memo ?? null,
      })),
    })
    return created
  })
  return { entry_id: entry.id, created: true }
}

/**
 * Reverse a posted entry with an exact contra entry (the ONLY
 * correction path for the journal). Idempotent: reversing an
 * already-reversed entry returns the existing reversal.
 */
export async function reverseEntry(
  db: Db,
  originalEntryId: string,
  opts: { entry_date: string; memo?: string | null; created_by?: string | null }
): Promise<PostResult> {
  const prior = await db.journalEntry.findFirst({
    where: { reverses_entry_id: originalEntryId },
    select: { id: true },
  })
  if (prior) return { entry_id: prior.id, created: false }

  const original = await db.journalEntry.findUnique({ where: { id: originalEntryId } })
  if (!original) throw new Error('ACCOUNTS: entry to reverse not found')
  const lines = await db.journalLine.findMany({ where: { entry_id: originalEntryId } })
  const accounts = await db.chartAccount.findMany({
    where: { id: { in: lines.map((l: any) => l.account_id) } },
    select: { id: true, code: true },
  })
  const codeOf = new Map<string, string>(accounts.map((a: any) => [a.id, a.code]))

  return postEvent(db, {
    source_table: original.source_table,
    source_id: original.source_id,
    // Keyed to the ORIGINAL entry's event type so a source that is
    // posted, reversed, re-posted (closing_r1, …) and reversed again
    // never collides on the (source, event_type) unique key.
    event_type: original.source_table ? `reversal:${original.event_type}` : 'reversal',
    entry_date: opts.entry_date,
    memo: opts.memo ?? `Reversal of journal entry ${originalEntryId}`,
    created_by: opts.created_by ?? null,
    is_reversal: true,
    reverses_entry_id: originalEntryId,
    lines: lines.map((l: any) => ({
      account_code: codeOf.get(l.account_id)!,
      branch_id: l.branch_id,
      counterparty_id: l.counterparty_id,
      debit: Number(l.credit?.toString() ?? 0),
      credit: Number(l.debit?.toString() ?? 0),
      memo: l.memo,
    })),
  })
}
