/**
 * Accounts A8 — cheque register (lib/server/accounting/cheques.ts).
 *
 * The register for cheque instruments (table `cheque_register`,
 * created EMPTY in A1): cheques ISSUED to payees and cheques
 * RECEIVED, each with a status lifecycle
 *   pending → cleared | bounced | cancelled
 * plus bounce-from-cleared (a bank can return a cheque after a
 * provisional credit). Transitions are the only way status moves;
 * every one is S1-audited by the route, and a non-pending cheque's
 * fields can no longer be edited (no silent edits of cleared
 * cheques — corrections travel as bounce/reversal, never rewrites).
 *
 * POSTING DESIGN (decision D-A8-1 — the blueprint §B.2 map P1–P13
 * names no cheque legs, so the conservative option is taken and
 * documented here):
 *  - RECORDING a cheque posts NOTHING. A cheque is an instrument,
 *    not a money movement; the journal moves only when money does.
 *  - CLEARING is the single money movement, posted through the A1
 *    engine (source_table 'cheque_register', event_type
 *    'cheque_cleared', entry date = the cleared date):
 *      issued   → Dr 2000 Accounts Payable (counterparty-tagged
 *                 when set) / Cr the bank account's chart account
 *      received → Dr the bank account's chart account /
 *                 Cr 1050 Accounts Receivable (counterparty-tagged
 *                 when set)
 *    i.e. an issued cheque discharges a payee obligation through
 *    the bank; a received cheque collects a receivable into the
 *    bank. postEvent's unique (source, event) key makes clearing
 *    idempotent — a re-fire returns the existing entry.
 *  - The source_table/source_id link on a cheque is TRACEABILITY
 *    (e.g. the payables_receivables row it relates to). Clearing
 *    does NOT settle A5 register rows: settlement stays with the
 *    owning module's flow (A5 settlePayable posts its own legs);
 *    the register screen says so, so the two are never both fired
 *    for the same obligation by design of the workflow.
 *  - BOUNCE from pending: nothing was ever posted, so nothing is
 *    reversed — the row flips to 'bounced' and the Accounts
 *    overview derives a durable CHEQUE_BOUNCED flag from the
 *    register (the A3/A9 read-time derivation pattern).
 *  - BOUNCE from cleared: the clearing entry is reversed with an
 *    exact contra entry (reverseEntry, dated the bounce date).
 *  - PERIOD RESPECT (A3): if the clearing (or the bounce
 *    reversal) dates into a closed/locked period, the engine
 *    refuses it; the transition still stands (fail-soft law), a
 *    durable posting exception is recorded, and the caller is
 *    told posting_blocked so the UI can show it.
 *  - Clearing REQUIRES a bank account linked to a chart account;
 *    a missing link is created with the A4 bank.ts pattern (one
 *    chart account per bank account, never a second).
 *
 * DUPLICATE GUARD: the same cheque number on the same bank
 * account (NULL-safe) among rows still live (pending/cleared) is
 * refused 409 — a cancelled or bounced earlier cheque frees its
 * number. Service-enforced (the A6 duplicate-month pattern) and
 * proven by the stage harness.
 *
 * NO DERIVATION: no source module records cheque instruments, so
 * the register starts EMPTY — nothing is invented into it.
 */
import { dhakaToday } from '../../dhaka-time'
import { postEvent, reverseEntry, isPeriodBlockedError, type Db } from './post'
import { recordPostingException } from './exceptions'
import { createBankChartAccount, isRealDate } from './bank'
import { ACCT } from './events'

export class ChequeError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ChequeError'
    this.status = status
  }
}

export const CHEQUE_EVENT = 'cheque_cleared'
const LIVE_STATUSES = ['pending', 'cleared']
/** PDC-due window: a pending cheque due within this many days (or
 *  overdue) raises the overview's CHEQUE_PDC_DUE flag. */
export const PDC_DUE_WINDOW_DAYS = 7

const dateStr = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null
const moneyStr = (v: unknown): string | null => (v == null ? null : (v as any).toString())
const normalizeNo = (s: string) => s.trim().toUpperCase()

export interface ChequeListItem {
  id: string
  direction: string
  cheque_no: string
  bank_account_id: string | null
  bank_label: string | null
  bank_chart_code: string | null
  counterparty_id: string | null
  counterparty_name: string | null
  amount: string
  issue_date: string | null
  due_date: string | null
  status: string
  cleared_at: string | null
  source_table: string | null
  source_id: string | null
  note: string | null
  journal_entry_id: string | null
  created_at: string
  updated_at: string
}

export function chequeShape(
  row: any,
  bank: { label: string; chart_code: string | null } | null,
  counterpartyName: string | null,
  journalEntryId: string | null
): ChequeListItem {
  return {
    id: row.id,
    direction: row.direction,
    cheque_no: row.cheque_no,
    bank_account_id: row.bank_account_id ?? null,
    bank_label: bank?.label ?? null,
    bank_chart_code: bank?.chart_code ?? null,
    counterparty_id: row.counterparty_id ?? null,
    counterparty_name: counterpartyName,
    amount: moneyStr(row.amount) ?? '0',
    issue_date: dateStr(row.issue_date),
    due_date: dateStr(row.due_date),
    status: row.status,
    cleared_at: row.cleared_at?.toISOString?.() ?? (row.cleared_at ? String(row.cleared_at) : null),
    source_table: row.source_table ?? null,
    source_id: row.source_id ?? null,
    note: row.note ?? null,
    journal_entry_id: journalEntryId,
    created_at: row.created_at?.toISOString?.() ?? String(row.created_at),
    updated_at: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  }
}

async function resolveChequeExtras(db: Db, rows: any[]) {
  const bankIds = [...new Set(rows.map((r: any) => r.bank_account_id).filter(Boolean))]
  const cpIds = [...new Set(rows.map((r: any) => r.counterparty_id).filter(Boolean))]
  const banks = bankIds.length
    ? await db.bankAccount.findMany({ where: { id: { in: bankIds } } })
    : []
  const chartIds = banks.map((b: any) => b.chart_account_id).filter(Boolean)
  const charts = chartIds.length
    ? await db.chartAccount.findMany({ where: { id: { in: chartIds } }, select: { id: true, code: true } })
    : []
  const codeOf = new Map<string, string>(charts.map((c: any) => [c.id, c.code]))
  const bankOf = new Map<string, { label: string; chart_code: string | null }>(
    banks.map((b: any) => [
      b.id,
      { label: b.label, chart_code: b.chart_account_id ? codeOf.get(b.chart_account_id) ?? null : null },
    ])
  )
  const cps = cpIds.length
    ? await db.counterparty.findMany({ where: { id: { in: cpIds } }, select: { id: true, name: true } })
    : []
  const cpOf = new Map<string, string>(cps.map((c: any) => [c.id, c.name]))
  const entries = rows.length
    ? await db.journalEntry.findMany({
        where: {
          source_table: 'cheque_register',
          source_id: { in: rows.map((r: any) => r.id) },
          event_type: CHEQUE_EVENT,
        },
        select: { id: true, source_id: true },
      })
    : []
  const entryOf = new Map<string, string>(entries.map((e: any) => [e.source_id, e.id]))
  return { bankOf, cpOf, entryOf }
}

export async function listCheques(
  db: Db,
  filter: { status?: string | null; direction?: string | null; limit?: number } = {}
): Promise<ChequeListItem[]> {
  const where: Record<string, unknown> = {}
  if (filter.status) where.status = filter.status
  if (filter.direction) where.direction = filter.direction
  const rows = await db.cheque.findMany({
    where,
    orderBy: [{ due_date: 'asc' }, { created_at: 'desc' }],
    take: Math.min(Math.max(filter.limit ?? 200, 1), 500),
  })
  const { bankOf, cpOf, entryOf } = await resolveChequeExtras(db, rows)
  return rows.map((r: any) =>
    chequeShape(
      r,
      r.bank_account_id ? bankOf.get(r.bank_account_id) ?? null : null,
      r.counterparty_id ? cpOf.get(r.counterparty_id) ?? null : null,
      entryOf.get(r.id) ?? null
    )
  )
}

export async function loadCheque(db: Db, id: string): Promise<any> {
  const row = await db.cheque.findUnique({ where: { id } })
  if (!row) throw new ChequeError(404, 'Cheque not found')
  return row
}

/** Register totals + the two derived alert sets (overview flags). */
export async function chequeSummary(db: Db, today: string = dhakaToday()) {
  const rows = await db.cheque.findMany({})
  const blank = () => ({ count: 0, total: 0 })
  const byStatus: Record<string, { count: number; total: number }> = {
    pending: blank(),
    cleared: blank(),
    bounced: blank(),
    cancelled: blank(),
  }
  const dueCutoff = new Date(`${today}T00:00:00Z`)
  dueCutoff.setUTCDate(dueCutoff.getUTCDate() + PDC_DUE_WINDOW_DAYS)
  const pdcDue: any[] = []
  for (const r of rows) {
    const bucket = byStatus[r.status] ?? (byStatus[r.status] = blank())
    bucket.count++
    bucket.total += Number(r.amount?.toString() ?? 0)
    if (r.status === 'pending' && r.due_date && r.due_date <= dueCutoff) pdcDue.push(r)
  }
  const { bankOf, cpOf, entryOf } = await resolveChequeExtras(db, pdcDue)
  return {
    by_status: byStatus,
    total_count: rows.length,
    pdc_due: pdcDue.map((r: any) =>
      chequeShape(
        r,
        r.bank_account_id ? bankOf.get(r.bank_account_id) ?? null : null,
        r.counterparty_id ? cpOf.get(r.counterparty_id) ?? null : null,
        entryOf.get(r.id) ?? null
      )
    ),
    bounced: byStatus.bounced,
  }
}

/**
 * The Accounts overview flags (A3/A9 read-time derivation): open
 * bounced cheques and PDCs due inside the window. Derived from the
 * register on every read — nothing extra is stored, and the flags
 * clear themselves as the rows resolve.
 */
export async function chequeFlags(db: Db, today: string = dhakaToday()) {
  const s = await chequeSummary(db, today)
  const flags: { code: string; amount: string | null; count: number | null; text: string }[] = []
  if (s.bounced.count > 0) {
    flags.push({
      code: 'CHEQUE_BOUNCED',
      amount: s.bounced.total.toFixed(2),
      count: s.bounced.count,
      text:
        `${s.bounced.count} cheque(s) totalling ৳${s.bounced.total.toFixed(2)} have BOUNCED. ` +
        `Review them in Accounts → Cheques and follow up with the drawer/payee.`,
    })
  }
  if (s.pdc_due.length > 0) {
    const total = s.pdc_due.reduce((sum: number, c: any) => sum + Number(c.amount), 0)
    flags.push({
      code: 'CHEQUE_PDC_DUE',
      amount: total.toFixed(2),
      count: s.pdc_due.length,
      text:
        `${s.pdc_due.length} post-dated cheque(s) totalling ৳${total.toFixed(2)} are due within ` +
        `${PDC_DUE_WINDOW_DAYS} days (or overdue). See Accounts → Cheques for the due list.`,
    })
  }
  return flags
}

// ── validation helpers ─────────────────────────────────────────

function validAmount(raw: unknown): string {
  const s = raw == null ? '' : String(raw).trim()
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new ChequeError(400, 'amount must be a valid amount (up to 2 decimals)')
  const v = Number(s)
  if (!Number.isFinite(v) || v <= 0) throw new ChequeError(400, 'amount must be greater than zero')
  return v.toFixed(2)
}

function validDate(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  const s = String(raw).trim()
  if (!isRealDate(s)) throw new ChequeError(400, `${field} must be a real date (YYYY-MM-DD)`)
  return s
}

async function assertNoDuplicate(
  db: Db,
  bankAccountId: string | null,
  chequeNo: string,
  excludeId?: string
) {
  const candidates = await db.cheque.findMany({
    where: {
      bank_account_id: bankAccountId,
      status: { in: LIVE_STATUSES },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, cheque_no: true, status: true },
  })
  const clash = candidates.find((c: any) => normalizeNo(c.cheque_no) === normalizeNo(chequeNo))
  if (clash) {
    throw new ChequeError(
      409,
      `Cheque number ${chequeNo} is already recorded on this bank account (status: ${clash.status}). ` +
        `A number can only be reused after the earlier cheque is cancelled or bounced.`
    )
  }
}

async function assertRefs(db: Db, bankAccountId: string | null, counterpartyId: string | null) {
  if (bankAccountId) {
    const bank = await db.bankAccount.findUnique({ where: { id: bankAccountId }, select: { id: true } })
    if (!bank) throw new ChequeError(400, 'bank_account_id does not match a bank account')
  }
  if (counterpartyId) {
    const cp = await db.counterparty.findUnique({ where: { id: counterpartyId }, select: { id: true } })
    if (!cp) throw new ChequeError(400, 'counterparty_id does not match a counterparty')
  }
}

// ── create / update ────────────────────────────────────────────

export interface CreateChequeInput {
  direction?: unknown
  cheque_no?: unknown
  bank_account_id?: unknown
  counterparty_id?: unknown
  amount?: unknown
  issue_date?: unknown
  due_date?: unknown
  source_table?: unknown
  source_id?: unknown
  note?: unknown
}

export async function createCheque(db: Db, input: CreateChequeInput) {
  const direction = String(input.direction ?? '').trim()
  if (direction !== 'issued' && direction !== 'received') {
    throw new ChequeError(400, "direction must be 'issued' or 'received'")
  }
  const chequeNo = String(input.cheque_no ?? '').trim()
  if (!chequeNo) throw new ChequeError(400, 'cheque_no is required')
  const amount = validAmount(input.amount)
  const issueDate = validDate(input.issue_date, 'issue_date')
  const dueDate = validDate(input.due_date, 'due_date')
  const bankAccountId = input.bank_account_id ? String(input.bank_account_id) : null
  const counterpartyId = input.counterparty_id ? String(input.counterparty_id) : null
  await assertRefs(db, bankAccountId, counterpartyId)
  const sourceTable = input.source_table ? String(input.source_table).trim() : null
  const sourceId = input.source_id ? String(input.source_id).trim() : null
  if ((sourceTable && !sourceId) || (!sourceTable && sourceId)) {
    throw new ChequeError(400, 'source_table and source_id must be given together')
  }
  await assertNoDuplicate(db, bankAccountId, chequeNo)
  const row = await db.cheque.create({
    data: {
      direction,
      cheque_no: chequeNo,
      bank_account_id: bankAccountId,
      counterparty_id: counterpartyId,
      amount,
      issue_date: issueDate ? new Date(`${issueDate}T00:00:00Z`) : null,
      due_date: dueDate ? new Date(`${dueDate}T00:00:00Z`) : null,
      status: 'pending',
      source_table: sourceTable,
      source_id: sourceId,
      note: input.note ? String(input.note).trim() || null : null,
    },
  })
  return row
}

export interface UpdateChequeInput {
  cheque_no?: unknown
  bank_account_id?: unknown
  counterparty_id?: unknown
  amount?: unknown
  issue_date?: unknown
  due_date?: unknown
  note?: unknown
}

/**
 * Field edits — PENDING cheques only. Once a cheque has cleared,
 * bounced or been cancelled its recorded facts are history: the
 * register refuses edits (409) and corrections travel as
 * transitions/reversals, never rewrites.
 */
export async function updateCheque(db: Db, id: string, fields: UpdateChequeInput) {
  const before = await loadCheque(db, id)
  if (before.status !== 'pending') {
    throw new ChequeError(
      409,
      `A ${before.status} cheque can no longer be edited. Corrections travel as transitions (bounce / reversal), never rewrites.`
    )
  }
  const data: Record<string, unknown> = {}
  let chequeNo = before.cheque_no
  let bankAccountId = before.bank_account_id ?? null
  if (fields.cheque_no !== undefined) {
    chequeNo = String(fields.cheque_no ?? '').trim()
    if (!chequeNo) throw new ChequeError(400, 'cheque_no cannot be empty')
    data.cheque_no = chequeNo
  }
  if (fields.bank_account_id !== undefined) {
    bankAccountId = fields.bank_account_id ? String(fields.bank_account_id) : null
    data.bank_account_id = bankAccountId
  }
  if (fields.counterparty_id !== undefined) {
    data.counterparty_id = fields.counterparty_id ? String(fields.counterparty_id) : null
  }
  if (fields.amount !== undefined) data.amount = validAmount(fields.amount)
  if (fields.issue_date !== undefined) {
    const d = validDate(fields.issue_date, 'issue_date')
    data.issue_date = d ? new Date(`${d}T00:00:00Z`) : null
  }
  if (fields.due_date !== undefined) {
    const d = validDate(fields.due_date, 'due_date')
    data.due_date = d ? new Date(`${d}T00:00:00Z`) : null
  }
  if (fields.note !== undefined) {
    data.note = fields.note ? String(fields.note).trim() || null : null
  }
  await assertRefs(db, bankAccountId, (data.counterparty_id as string | null) ?? before.counterparty_id ?? null)
  if (fields.cheque_no !== undefined || fields.bank_account_id !== undefined) {
    await assertNoDuplicate(db, bankAccountId, chequeNo, id)
  }
  data.updated_at = new Date()
  const after = await db.cheque.update({ where: { id }, data })
  return { before, after }
}

// ── transitions ────────────────────────────────────────────────

export interface TransitionResult {
  before: any
  after: any
  journal_entry_id: string | null
  posting_blocked: boolean
}

/** The bank chart account code for a cheque, linking one if the
 *  bank account has none yet (the A4 pattern — never a second). */
async function bankChartCode(db: Db, cheque: any): Promise<string> {
  if (!cheque.bank_account_id) {
    throw new ChequeError(
      400,
      'This cheque has no bank account linked — link one (edit the cheque) before it can clear.'
    )
  }
  const bank = await db.bankAccount.findUnique({ where: { id: cheque.bank_account_id } })
  if (!bank) throw new ChequeError(400, 'The linked bank account no longer exists')
  let chartId = bank.chart_account_id
  if (!chartId) {
    const chart = await createBankChartAccount(db, bank.bank_name)
    await db.bankAccount.update({ where: { id: bank.id }, data: { chart_account_id: chart.id } })
    chartId = chart.id
  }
  const chart = await db.chartAccount.findUnique({ where: { id: chartId }, select: { code: true } })
  if (!chart) throw new ChequeError(400, 'The bank account’s chart account is missing')
  return chart.code
}

/**
 * CLEAR — the register's only money movement (D-A8-1). Idempotent
 * at the engine level: if a clearing entry already exists for the
 * cheque, it is returned, never duplicated.
 */
export async function clearCheque(
  db: Db,
  id: string,
  opts: { cleared_date?: unknown; note?: unknown; created_by?: string | null } = {}
): Promise<TransitionResult> {
  const before = await loadCheque(db, id)
  if (before.status === 'cleared') {
    throw new ChequeError(409, 'This cheque has already cleared.')
  }
  if (before.status !== 'pending') {
    throw new ChequeError(409, `A ${before.status} cheque cannot be cleared.`)
  }
  const clearedDate = validDate(opts.cleared_date, 'cleared_date') ?? dhakaToday()
  const bankCode = await bankChartCode(db, before)
  const amount = Number(before.amount.toString())
  const party = before.counterparty_id ?? null
  const lines =
    before.direction === 'issued'
      ? [
          { account_code: ACCT.accountsPayable, counterparty_id: party, debit: amount, memo: `Cheque ${before.cheque_no} issued — cleared` },
          { account_code: bankCode, credit: amount, memo: `Cheque ${before.cheque_no} cleared` },
        ]
      : [
          { account_code: bankCode, debit: amount, memo: `Cheque ${before.cheque_no} received — cleared` },
          { account_code: ACCT.accountsReceivable, counterparty_id: party, credit: amount, memo: `Cheque ${before.cheque_no} cleared` },
        ]
  let entryId: string | null = null
  let postingBlocked = false
  try {
    const res = await postEvent(db, {
      source_table: 'cheque_register',
      source_id: before.id,
      event_type: CHEQUE_EVENT,
      entry_date: clearedDate,
      memo:
        `Cheque ${before.cheque_no} (${before.direction}) cleared — ` +
        `${before.direction === 'issued' ? 'payment out of' : 'collection into'} bank`,
      created_by: opts.created_by ?? null,
      lines,
    })
    entryId = res.entry_id
  } catch (err) {
    if (!isPeriodBlockedError(err)) throw err
    // A3 fail-soft: the status change stands; the blocked posting
    // is durably recorded for resolution.
    await recordPostingException(db, err as any, {
      source_table: 'cheque_register',
      source_id: before.id,
      event_type: CHEQUE_EVENT,
    })
    postingBlocked = true
  }
  const noteParts = [before.note, opts.note ? String(opts.note).trim() : null].filter(Boolean)
  const after = await db.cheque.update({
    where: { id },
    data: {
      status: 'cleared',
      cleared_at: new Date(`${clearedDate}T00:00:00Z`),
      note: noteParts.length ? noteParts.join(' · ') : null,
      updated_at: new Date(),
    },
  })
  return { before, after, journal_entry_id: entryId, posting_blocked: postingBlocked }
}

/**
 * BOUNCE — from pending (nothing posted; flag only) or from
 * cleared (the clearing entry is reversed with an exact contra
 * entry dated the bounce date; a locked period records the
 * exception and the status still stands).
 */
export async function bounceCheque(
  db: Db,
  id: string,
  opts: { bounce_date?: unknown; note?: unknown; created_by?: string | null } = {}
): Promise<TransitionResult> {
  const before = await loadCheque(db, id)
  if (before.status === 'bounced') throw new ChequeError(409, 'This cheque has already bounced.')
  if (before.status === 'cancelled') throw new ChequeError(409, 'A cancelled cheque cannot bounce.')
  const bounceDate = validDate(opts.bounce_date, 'bounce_date') ?? dhakaToday()
  let reversalId: string | null = null
  let postingBlocked = false
  if (before.status === 'cleared') {
    const clearing = await db.journalEntry.findFirst({
      where: { source_table: 'cheque_register', source_id: before.id, event_type: CHEQUE_EVENT },
      select: { id: true },
    })
    if (clearing) {
      try {
        const res = await reverseEntry(db, clearing.id, {
          entry_date: bounceDate,
          memo: `Cheque ${before.cheque_no} BOUNCED — clearing reversed`,
          created_by: opts.created_by ?? null,
        })
        reversalId = res.entry_id
      } catch (err) {
        if (!isPeriodBlockedError(err)) throw err
        await recordPostingException(db, err as any, {
          source_table: 'cheque_register',
          source_id: before.id,
          event_type: CHEQUE_EVENT,
        })
        postingBlocked = true
      }
    }
  }
  const reason = opts.note ? String(opts.note).trim() : ''
  const noteParts = [before.note, `Bounced ${bounceDate}${reason ? `: ${reason}` : ''}`].filter(Boolean)
  const after = await db.cheque.update({
    where: { id },
    data: { status: 'bounced', note: noteParts.join(' · '), updated_at: new Date() },
  })
  return { before, after, journal_entry_id: reversalId, posting_blocked: postingBlocked }
}

/** CANCEL — pending only; a cleared cheque must bounce instead. */
export async function cancelCheque(
  db: Db,
  id: string,
  opts: { note?: unknown } = {}
): Promise<TransitionResult> {
  const before = await loadCheque(db, id)
  if (before.status === 'cancelled') throw new ChequeError(409, 'This cheque is already cancelled.')
  if (before.status === 'cleared') {
    throw new ChequeError(409, 'A cleared cheque cannot be cancelled — if the bank returned it, record a bounce instead.')
  }
  if (before.status === 'bounced') {
    throw new ChequeError(409, 'A bounced cheque is already closed.')
  }
  const reason = opts.note ? String(opts.note).trim() : ''
  const noteParts = [before.note, `Cancelled${reason ? `: ${reason}` : ''}`].filter(Boolean)
  const after = await db.cheque.update({
    where: { id },
    data: { status: 'cancelled', note: noteParts.join(' · '), updated_at: new Date() },
  })
  return { before, after, journal_entry_id: null, posting_blocked: false }
}
