/**
 * Accounts A4 — bank statement import + reconciliation
 * (lib/server/accounting/bankrec.ts).
 *
 * Statement lines are EXTERNAL EVIDENCE: importing one never writes
 * a journal entry and is allowed regardless of period locks. The
 * reconciliation matches statement lines 1:1 against ACTIVE journal
 * lines on the bank account's chart account (posted, not a reversal,
 * not reversed — the classReconciliation active-entry rule).
 *
 * The reused-transaction-id trap is handled head-on: deposits that
 * share one bank_transaction_id are FLAGGED (`shared_transaction_id`)
 * and their match candidates are score-capped — never silently
 * matched away.
 *
 * All money math is integer poisha (reports.ts toPoishaExact/taka).
 */
import { type Db } from './post'
import { toPoishaExact, taka } from './reports'
import { BankError, bankAccountShape } from './bank'

export class BankRecError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'BankRecError'
    this.status = status
  }
}

const dateStr = (d: Date): string => d.toISOString().slice(0, 10)
const moneyStr = (v: unknown): string => (v == null ? '0.00' : (v as any).toString())

// ── CSV parsing (pure) ──────────────────────────────────────────────

interface CsvRow {
  line: number // 1-based physical line where the record starts
  fields: string[]
}

/** Split CSV text into records with proper quoted-field handling. */
function splitCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = []
  let fields: string[] = []
  let field = ''
  let inQuotes = false
  let line = 1
  let recordLine = 1
  let recordStarted = false
  const pushField = () => { fields.push(field); field = '' }
  const pushRow = () => {
    pushField()
    rows.push({ line: recordLine, fields })
    fields = []
    recordStarted = false
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"') { inQuotes = true; recordStarted = true; continue }
    if (c === ',') { pushField(); recordStarted = true; continue }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      pushRow()
      line++
      recordLine = line
      continue
    }
    field += c
    recordStarted = true
  }
  if (recordStarted || field !== '' || fields.length > 0) pushRow()
  return rows
}

const normHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '')

const HEADER_MAP: Record<string, 'date' | 'description' | 'reference' | 'debit' | 'credit' | 'amount' | 'balance'> = {}
for (const v of ['date', 'valuedate', 'transactiondate', 'txndate', 'postingdate']) HEADER_MAP[v] = 'date'
for (const v of ['description', 'narration', 'particulars', 'details', 'transactiondetails', 'remarks']) HEADER_MAP[v] = 'description'
for (const v of ['reference', 'ref', 'refno', 'referenceno', 'chequeno', 'transactionid', 'utr']) HEADER_MAP[v] = 'reference'
for (const v of ['debit', 'withdrawal', 'withdrawals', 'debitamount', 'dr', 'moneyout', 'paidout']) HEADER_MAP[v] = 'debit'
for (const v of ['credit', 'deposit', 'deposits', 'creditamount', 'cr', 'moneyin', 'paidin']) HEADER_MAP[v] = 'credit'
HEADER_MAP['amount'] = 'amount'
HEADER_MAP['transactionamount'] = 'amount'
for (const v of ['balance', 'runningbalance', 'closingbalance']) HEADER_MAP[v] = 'balance'

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function makeDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Parse a statement date: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY,
 *  DD.MM.YYYY (day-first), or 'DD MMM YYYY'. Null when unparseable. */
export function parseStatementDate(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return makeDate(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/)
  if (m) return makeDate(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2})$/)
  if (m) return makeDate(2000 + +m[3], +m[2], +m[1])
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/)
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (mon) return makeDate(+m[3], mon, +m[1])
  }
  return null
}

/** Parse a money cell → integer poisha. Strips ৳/commas/spaces;
 *  parentheses mean negative. Null when unparseable; empty → 0. */
export function parseMoneyCell(raw: string | undefined): number | null {
  if (raw == null) return 0
  let s = String(raw).trim()
  if (!s) return 0
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim() }
  s = s.replace(/৳/g, '').replace(/,/g, '').replace(/\s+/g, '')
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1) }
  if (s.startsWith('+')) s = s.slice(1)
  if (s.startsWith('-')) { neg = true; s = s.slice(1) }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const p = toPoishaExact(s)
  return neg ? -p : p
}

export interface ParsedStatementRow {
  statement_date: string
  description: string
  reference: string | null
  debit: string
  credit: string
  balance: string | null
}
export interface StatementRowError {
  row: number
  message: string
}
export interface ParseResult {
  rows: ParsedStatementRow[]
  errors: StatementRowError[]
  total_rows: number
}

const poishaStr = (p: number): string => (p / 100).toFixed(2)

/**
 * Parse a bank statement CSV. Pure — no DB. Throws BankRecError(400)
 * on a fatal problem (no recognisable header / no date column / no
 * amount column); per-row problems are collected in `errors`.
 */
export function parseStatementCsv(text: string): ParseResult {
  const clean = String(text ?? '').replace(/^\uFEFF/, '')
  const records = splitCsv(clean)
  // Find the header within the first 5 rows.
  let headerIdx = -1
  let cols: Partial<Record<'date' | 'description' | 'reference' | 'debit' | 'credit' | 'amount' | 'balance', number>> = {}
  for (let i = 0; i < Math.min(5, records.length); i++) {
    const mapped: typeof cols = {}
    records[i].fields.forEach((f, idx) => {
      const kind = HEADER_MAP[normHeader(f)]
      if (kind && mapped[kind] === undefined) mapped[kind] = idx
    })
    const hasAmount = mapped.debit !== undefined || mapped.credit !== undefined || mapped.amount !== undefined
    if (mapped.date !== undefined && hasAmount) {
      headerIdx = i
      cols = mapped
      break
    }
    if (mapped.date !== undefined || hasAmount) {
      // Partial header in the first rows: remember nothing — keep
      // scanning, but if nothing better appears this stays fatal.
    }
  }
  if (headerIdx === -1) {
    throw new BankRecError(
      400,
      'Could not recognise the statement header: a date column and an amount column (debit/credit or amount) are required'
    )
  }
  const cell = (fields: string[], idx: number | undefined): string =>
    idx === undefined ? '' : (fields[idx] ?? '').trim()

  const rows: ParsedStatementRow[] = []
  const errors: StatementRowError[] = []
  let total = 0
  for (let i = headerIdx + 1; i < records.length; i++) {
    const rec = records[i]
    if (rec.fields.every((f) => !f.trim())) continue // blank row — skipped silently
    total++
    const dateRaw = cell(rec.fields, cols.date)
    const statementDate = parseStatementDate(dateRaw)
    if (!statementDate) {
      errors.push({ row: rec.line, message: `Unparseable date: '${dateRaw}'` })
      continue
    }
    let debitP: number | null
    let creditP: number | null
    if (cols.amount !== undefined && cols.debit === undefined && cols.credit === undefined) {
      const amt = parseMoneyCell(cell(rec.fields, cols.amount))
      if (amt === null) {
        errors.push({ row: rec.line, message: `Unparseable amount: '${cell(rec.fields, cols.amount)}'` })
        continue
      }
      debitP = amt < 0 ? -amt : 0
      creditP = amt > 0 ? amt : 0
    } else {
      debitP = parseMoneyCell(cell(rec.fields, cols.debit))
      creditP = parseMoneyCell(cell(rec.fields, cols.credit))
      if (debitP === null || creditP === null) {
        errors.push({ row: rec.line, message: 'Unparseable debit/credit amount' })
        continue
      }
      // Negative cells flip sides (a negative withdrawal is a deposit).
      if (debitP < 0) { creditP += -debitP; debitP = 0 }
      if (creditP < 0) { debitP += -creditP; creditP = 0 }
    }
    if (debitP > 0 && creditP > 0) {
      errors.push({ row: rec.line, message: 'Both debit and credit are filled — a statement line carries exactly one side' })
      continue
    }
    if (debitP === 0 && creditP === 0) {
      errors.push({ row: rec.line, message: 'Both debit and credit are zero' })
      continue
    }
    let balance: string | null = null
    if (cols.balance !== undefined) {
      const bRaw = cell(rec.fields, cols.balance)
      if (bRaw) {
        const b = parseMoneyCell(bRaw)
        if (b === null) {
          errors.push({ row: rec.line, message: `Unparseable balance: '${bRaw}'` })
          continue
        }
        balance = poishaStr(b)
      }
    }
    rows.push({
      statement_date: statementDate,
      description: cell(rec.fields, cols.description) || '(no description)',
      reference: cell(rec.fields, cols.reference) || null,
      debit: poishaStr(debitP),
      credit: poishaStr(creditP),
      balance,
    })
  }
  return { rows, errors, total_rows: total }
}

// ── Import ──────────────────────────────────────────────────────────

/**
 * Import a statement CSV for one bank account. Fatal parse errors
 * throw (400) before anything is written. Otherwise ONE transaction
 * creates the batch row (counts + full error report) and inserts the
 * valid lines as unmatched. Allowed regardless of period locks —
 * statement lines are external evidence and never post journal
 * entries.
 */
export async function importStatementCsv(
  db: Db,
  bankAccountId: string,
  csvText: string,
  fileName: string | null,
  createdBy: string | null
) {
  const account = await db.bankAccount.findUnique({ where: { id: bankAccountId } })
  if (!account) throw new BankError(404, 'Bank account not found')
  const parsed = parseStatementCsv(csvText) // throws BankRecError(400) on fatal
  const result = await db.$transaction(async (tx: Db) => {
    const batch = await tx.bankImportBatch.create({
      data: {
        bank_account_id: bankAccountId,
        file_name: fileName ?? null,
        total_rows: parsed.total_rows,
        imported_rows: parsed.rows.length,
        error_rows: parsed.errors.length,
        error_report: parsed.errors as any,
        created_by: createdBy ?? null,
      },
    })
    if (parsed.rows.length > 0) {
      await tx.bankStatementLine.createMany({
        data: parsed.rows.map((r) => ({
          bank_account_id: bankAccountId,
          statement_date: new Date(`${r.statement_date}T00:00:00Z`),
          description: r.description,
          reference: r.reference,
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
          import_batch_id: batch.id,
          match_status: 'unmatched',
        })),
      })
    }
    return batch
  })
  return {
    batch_id: result.id,
    total_rows: parsed.total_rows,
    imported: parsed.rows.length,
    errors: parsed.errors,
  }
}

// ── Statement line CRUD ─────────────────────────────────────────────

export function statementLineShape(row: any) {
  return {
    id: row.id,
    bank_account_id: row.bank_account_id,
    statement_date: dateStr(row.statement_date),
    description: row.description,
    reference: row.reference ?? null,
    debit: moneyStr(row.debit),
    credit: moneyStr(row.credit),
    balance: row.balance == null ? null : (row.balance as any).toString(),
    import_batch_id: row.import_batch_id ?? null,
    match_status: row.match_status,
    matched_journal_line_id: row.matched_journal_line_id ?? null,
    matched_entry_id: row.matched_entry_id ?? null,
    matched_deposit_id: row.matched_deposit_id ?? null,
    created_at: row.created_at?.toISOString?.() ?? String(row.created_at),
    updated_at: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  }
}

async function loadStatementLine(db: Db, lineId: string): Promise<any> {
  const row = await db.bankStatementLine.findUnique({ where: { id: lineId } })
  if (!row) throw new BankRecError(404, 'Statement line not found')
  return row
}

function assertNotMatched(row: any) {
  if (row.match_status === 'matched') {
    throw new BankRecError(409, 'Statement line is matched — unmatch it first')
  }
}

function validateLineAmounts(debitRaw: unknown, creditRaw: unknown): { debit: string; credit: string } {
  const d = debitRaw == null || debitRaw === '' ? 0 : toPoishaExact(debitRaw as any)
  const c = creditRaw == null || creditRaw === '' ? 0 : toPoishaExact(creditRaw as any)
  if (Number.isNaN(d) || Number.isNaN(c) || d < 0 || c < 0) {
    throw new BankRecError(400, 'debit/credit must be valid non-negative amounts')
  }
  if ((d > 0 && c > 0) || (d === 0 && c === 0)) {
    throw new BankRecError(400, 'Exactly one of debit/credit must be > 0')
  }
  return { debit: poishaStr(d), credit: poishaStr(c) }
}

function validateLineDate(raw: unknown): string {
  const s = String(raw ?? '').trim()
  const d = new Date(`${s}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new BankRecError(400, 'statement_date must be a real date (YYYY-MM-DD)')
  }
  return s
}

export async function addStatementLine(
  db: Db,
  bankAccountId: string,
  input: { statement_date: unknown; description: unknown; reference?: unknown; debit?: unknown; credit?: unknown; balance?: unknown }
) {
  const account = await db.bankAccount.findUnique({ where: { id: bankAccountId } })
  if (!account) throw new BankError(404, 'Bank account not found')
  const statementDate = validateLineDate(input.statement_date)
  const description = String(input.description ?? '').trim()
  if (!description) throw new BankRecError(400, 'description is required')
  const amounts = validateLineAmounts(input.debit, input.credit)
  const row = await db.bankStatementLine.create({
    data: {
      bank_account_id: bankAccountId,
      statement_date: new Date(`${statementDate}T00:00:00Z`),
      description,
      reference: input.reference == null ? null : String(input.reference).trim() || null,
      debit: amounts.debit,
      credit: amounts.credit,
      balance:
        input.balance == null || input.balance === ''
          ? null
          : poishaStr(toPoishaExact(input.balance as any)),
      match_status: 'unmatched',
    },
  })
  return row
}

export async function updateStatementLine(
  db: Db,
  lineId: string,
  fields: { statement_date?: unknown; description?: unknown; reference?: unknown; debit?: unknown; credit?: unknown; balance?: unknown }
) {
  const before = await loadStatementLine(db, lineId)
  assertNotMatched(before) // covers money/date changes on matched lines too
  const data: Record<string, unknown> = {}
  if (fields.statement_date !== undefined) {
    data.statement_date = new Date(`${validateLineDate(fields.statement_date)}T00:00:00Z`)
  }
  if (fields.description !== undefined) {
    const v = String(fields.description ?? '').trim()
    if (!v) throw new BankRecError(400, 'description cannot be empty')
    data.description = v
  }
  if (fields.reference !== undefined) {
    data.reference = fields.reference == null ? null : String(fields.reference).trim() || null
  }
  if (fields.debit !== undefined || fields.credit !== undefined) {
    const amounts = validateLineAmounts(
      fields.debit !== undefined ? fields.debit : moneyStr(before.debit),
      fields.credit !== undefined ? fields.credit : moneyStr(before.credit)
    )
    data.debit = amounts.debit
    data.credit = amounts.credit
  }
  if (fields.balance !== undefined) {
    data.balance =
      fields.balance == null || fields.balance === ''
        ? null
        : poishaStr(toPoishaExact(fields.balance as any))
  }
  data.updated_at = new Date()
  const after = await db.bankStatementLine.update({ where: { id: lineId }, data })
  return { before, after }
}

export async function deleteStatementLine(db: Db, lineId: string) {
  const before = await loadStatementLine(db, lineId)
  assertNotMatched(before)
  await db.bankStatementLine.delete({ where: { id: lineId } })
  return { before }
}

export async function setStatementLineStatus(db: Db, lineId: string, status: 'ignored' | 'unmatched') {
  if (status !== 'ignored' && status !== 'unmatched') {
    throw new BankRecError(400, "status must be 'ignored' or 'unmatched'")
  }
  const before = await loadStatementLine(db, lineId)
  assertNotMatched(before)
  const after = await db.bankStatementLine.update({
    where: { id: lineId },
    data: { match_status: status, updated_at: new Date() },
  })
  return { before, after }
}

// ── Journal side ────────────────────────────────────────────────────

export interface JournalBankLine {
  journal_line_id: string
  entry_id: string
  entry_date: string
  debit: string
  credit: string
  memo: string | null
  source_table: string | null
  deposit_id: string | null
  bank_transaction_id: string | null
  shared_transaction_id: boolean
  matched_statement_line_id: string | null
}

/**
 * Journal lines on the account's chart account from ACTIVE entries
 * only: entry status='posted', not a reversal, and not itself
 * reversed (the classReconciliation active-entry rule).
 */
export async function listJournalBankLines(db: Db, bankAccount: any): Promise<JournalBankLine[]> {
  if (!bankAccount?.chart_account_id) return []
  const entries = await db.journalEntry.findMany({
    where: { status: 'posted' },
    select: {
      id: true, entry_date: true, source_table: true, source_id: true,
      event_type: true, memo: true, is_reversal: true, reverses_entry_id: true,
    },
  })
  const reversedIds = new Set(
    entries.filter((e: any) => e.reverses_entry_id).map((e: any) => e.reverses_entry_id)
  )
  const active = new Map(
    entries
      .filter((e: any) => !e.is_reversal && !reversedIds.has(e.id))
      .map((e: any) => [e.id, e])
  )
  const lines = await db.journalLine.findMany({
    where: { account_id: bankAccount.chart_account_id },
    select: { id: true, entry_id: true, debit: true, credit: true, memo: true },
  })
  // Deposit linkage + the shared-transaction-id census.
  const depositIds = [...new Set(
    lines
      .map((l: any) => active.get(l.entry_id))
      .filter((e: any) => e && e.source_table === 'branch_bank_deposits' && e.source_id)
      .map((e: any) => e.source_id as string)
  )]
  const deposits = depositIds.length
    ? await db.branchBankDeposit.findMany({
        where: { id: { in: depositIds } },
        select: { id: true, bank_transaction_id: true },
      })
    : []
  const depositById = new Map<string, any>(deposits.map((d: any) => [d.id, d]))
  const txnIds = deposits.map((d: any) => d.bank_transaction_id).filter(Boolean) as string[]
  const sharedTxn = new Set<string>()
  if (txnIds.length) {
    const all = await db.branchBankDeposit.findMany({
      where: { bank_transaction_id: { in: txnIds }, status: 'approved', is_reversed: false },
      select: { bank_transaction_id: true },
    })
    const counts = new Map<string, number>()
    for (const d of all) counts.set(d.bank_transaction_id!, (counts.get(d.bank_transaction_id!) ?? 0) + 1)
    for (const [txn, n] of counts) if (n > 1) sharedTxn.add(txn)
  }
  const matched = await db.bankStatementLine.findMany({
    where: { bank_account_id: bankAccount.id, matched_journal_line_id: { not: null } },
    select: { id: true, matched_journal_line_id: true },
  })
  const stmtByJournalLine = new Map<string, string>(
    matched.map((s: any) => [s.matched_journal_line_id, s.id])
  )
  const out: JournalBankLine[] = []
  for (const l of lines) {
    const e: any = active.get(l.entry_id)
    if (!e) continue
    const depositId = e.source_table === 'branch_bank_deposits' ? (e.source_id ?? null) : null
    const dep = depositId ? depositById.get(depositId) : null
    out.push({
      journal_line_id: l.id,
      entry_id: e.id,
      entry_date: dateStr(e.entry_date),
      debit: moneyStr(l.debit),
      credit: moneyStr(l.credit),
      memo: l.memo ?? e.memo ?? null,
      source_table: e.source_table ?? null,
      deposit_id: depositId,
      bank_transaction_id: dep?.bank_transaction_id ?? null,
      shared_transaction_id: !!dep?.bank_transaction_id && sharedTxn.has(dep.bank_transaction_id),
      matched_statement_line_id: stmtByJournalLine.get(l.id) ?? null,
    })
  }
  out.sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.journal_line_id.localeCompare(b.journal_line_id))
  return out
}

// ── Candidate matching ──────────────────────────────────────────────

export interface MatchCandidate {
  statement_line_id: string
  journal_line_id: string
  score: number
  amount: string
  date_diff_days: number
  direction: 'credit' | 'debit' // the statement line's side
  flags: string[]
}

const dayMs = 86_400_000
const dayDiff = (a: string, b: string): number =>
  Math.round(Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / dayMs)

/**
 * Candidate matches for every unmatched statement line: ACTIVE,
 * unmatched journal lines on the chart account with the
 * opposite-side amount exactly equal (poisha) and dates within
 * `windowDays`. Scoring: 100 − 10×days_diff, +15 when the statement
 * reference equals the candidate deposit's bank_transaction_id;
 * a candidate whose deposit shares its transaction id is flagged
 * and capped at 60 — the reused-id pattern is surfaced, never
 * silently matched away.
 */
export async function findCandidates(db: Db, bankAccount: any, windowDays = 5): Promise<MatchCandidate[]> {
  const stmtLines = await db.bankStatementLine.findMany({
    where: { bank_account_id: bankAccount.id, match_status: 'unmatched' },
  })
  const journal = await listJournalBankLines(db, bankAccount)
  const open = journal.filter((j) => !j.matched_statement_line_id)
  const out: MatchCandidate[] = []
  for (const s of stmtLines) {
    const sDebit = toPoishaExact(s.debit)
    const sCredit = toPoishaExact(s.credit)
    if ((sDebit > 0) === (sCredit > 0)) continue // exactly one side > 0 only
    const direction: 'credit' | 'debit' = sCredit > 0 ? 'credit' : 'debit'
    const amountP = direction === 'credit' ? sCredit : sDebit
    const sDate = dateStr(s.statement_date)
    const cands: MatchCandidate[] = []
    for (const j of open) {
      const jAmountP = direction === 'credit' ? toPoishaExact(j.debit) : toPoishaExact(j.credit)
      if (jAmountP !== amountP || amountP === 0) continue
      const diff = dayDiff(sDate, j.entry_date)
      if (diff > windowDays) continue
      let score = 100 - 10 * diff
      const flags: string[] = []
      if (s.reference && j.bank_transaction_id && s.reference === j.bank_transaction_id) score += 15
      if (j.shared_transaction_id) {
        flags.push('shared_transaction_id')
        if (score > 60) score = 60
      }
      cands.push({
        statement_line_id: s.id,
        journal_line_id: j.journal_line_id,
        score,
        amount: taka(amountP),
        date_diff_days: diff,
        direction,
        flags,
      })
    }
    if (cands.length > 1) for (const c of cands) c.flags.push('multiple_candidates')
    out.push(...cands)
  }
  out.sort((a, b) => b.score - a.score || a.date_diff_days - b.date_diff_days)
  return out
}

/**
 * The account summary both bank routes serve: the bank row + chart
 * code + journal (book) balance + statement-line counts + statement
 * balance (+ basis) + the statement−journal difference.
 */
export async function bankSummary(db: Db, row: any) {
  const chart = row.chart_account_id
    ? await db.chartAccount.findUnique({ where: { id: row.chart_account_id }, select: { code: true } })
    : null
  const rec = await reconciliationStatus(db, row)
  const lines = await db.bankStatementLine.findMany({
    where: { bank_account_id: row.id },
    select: { match_status: true },
  })
  return {
    ...bankAccountShape(row, chart?.code ?? null),
    journal_balance: rec.journal_balance,
    statement_line_count: lines.length,
    matched_line_count: lines.filter((l: any) => l.match_status === 'matched').length,
    unmatched_line_count: lines.filter((l: any) => l.match_status === 'unmatched').length,
    statement_balance: rec.statement_balance,
    statement_balance_basis: rec.statement_balance_basis,
    difference: rec.difference,
  }
}

// ── Match / unmatch ─────────────────────────────────────────────────

export async function matchLines(db: Db, input: { statementLineId: string; journalLineId: string }) {
  const line = await db.bankStatementLine.findUnique({ where: { id: input.statementLineId } })
  if (!line) throw new BankRecError(404, 'Statement line not found')
  const jl = await db.journalLine.findUnique({ where: { id: input.journalLineId } })
  if (!jl) throw new BankRecError(404, 'Journal line not found')
  const account = await db.bankAccount.findUnique({ where: { id: line.bank_account_id } })
  if (!account) throw new BankError(404, 'Bank account not found')
  if (!account.chart_account_id || jl.account_id !== account.chart_account_id) {
    throw new BankRecError(400, 'Journal line is not on this bank account’s chart account')
  }
  if (line.match_status === 'matched') {
    throw new BankRecError(409, 'Statement line is already matched — unmatch it first')
  }
  const already = await db.bankStatementLine.findFirst({
    where: { matched_journal_line_id: input.journalLineId },
    select: { id: true },
  })
  if (already) throw new BankRecError(409, 'Journal line is already matched to another statement line')
  const sDebit = toPoishaExact(line.debit)
  const sCredit = toPoishaExact(line.credit)
  const jDebit = toPoishaExact(jl.debit)
  const jCredit = toPoishaExact(jl.credit)
  const compatible =
    (sCredit > 0 && jDebit === sCredit && jCredit === 0) ||
    (sDebit > 0 && jCredit === sDebit && jDebit === 0)
  if (!compatible) {
    throw new BankRecError(
      400,
      'Amounts/direction do not match: a statement credit matches a journal debit (and vice versa) of exactly the same amount'
    )
  }
  const entry = await db.journalEntry.findUnique({
    where: { id: jl.entry_id },
    select: { id: true, source_table: true, source_id: true },
  })
  const after = await db.bankStatementLine.update({
    where: { id: line.id },
    data: {
      matched_journal_line_id: jl.id,
      matched_entry_id: entry?.id ?? jl.entry_id,
      matched_deposit_id:
        entry?.source_table === 'branch_bank_deposits' ? (entry.source_id ?? null) : null,
      match_status: 'matched',
      updated_at: new Date(),
    },
  })
  return { before: line, after }
}

export async function unmatchLine(db: Db, statementLineId: string) {
  const before = await loadStatementLine(db, statementLineId)
  if (before.match_status !== 'matched') {
    throw new BankRecError(409, 'Statement line is not matched')
  }
  const after = await db.bankStatementLine.update({
    where: { id: statementLineId },
    data: {
      matched_journal_line_id: null,
      matched_entry_id: null,
      matched_deposit_id: null,
      match_status: 'unmatched',
      updated_at: new Date(),
    },
  })
  return { before, after }
}

// ── Reconciliation status ───────────────────────────────────────────

export interface ReconciliationStatus {
  journal_balance: string
  statement_balance: string | null
  statement_balance_basis: 'last_line_balance' | 'opening_plus_lines' | 'lines_sum' | null
  unmatched_statement_credit: string
  unmatched_statement_debit: string
  unmatched_journal_debit: string
  unmatched_journal_credit: string
  explained_difference: string
  unexplained_difference: string | null
  difference: string | null
}

export async function reconciliationStatus(db: Db, bankAccount: any): Promise<ReconciliationStatus> {
  // Journal balance: Σ debit − credit over ALL posted entries'
  // lines on the chart account (the book balance).
  let journalP = 0
  if (bankAccount.chart_account_id) {
    const postedIds = new Set(
      (await db.journalEntry.findMany({ where: { status: 'posted' }, select: { id: true } })).map((e: any) => e.id)
    )
    const lines = await db.journalLine.findMany({
      where: { account_id: bankAccount.chart_account_id },
      select: { entry_id: true, debit: true, credit: true },
    })
    for (const l of lines) {
      if (!postedIds.has(l.entry_id)) continue
      journalP += toPoishaExact(l.debit) - toPoishaExact(l.credit)
    }
  }

  const stmtLines = await db.bankStatementLine.findMany({
    where: { bank_account_id: bankAccount.id },
    orderBy: [{ statement_date: 'asc' }, { created_at: 'asc' }],
  })
  let statementP: number | null = null
  let basis: ReconciliationStatus['statement_balance_basis'] = null
  const withBalance = stmtLines.filter((s: any) => s.balance != null)
  if (withBalance.length > 0) {
    statementP = toPoishaExact(withBalance[withBalance.length - 1].balance)
    basis = 'last_line_balance'
  } else if (stmtLines.length > 0 || bankAccount.opening_balance != null) {
    if (bankAccount.opening_balance != null) {
      const openingDate = bankAccount.opening_balance_date ? dateStr(bankAccount.opening_balance_date) : null
      let sum = toPoishaExact(bankAccount.opening_balance)
      for (const s of stmtLines) {
        if (openingDate && dateStr(s.statement_date) < openingDate) continue
        sum += toPoishaExact(s.credit) - toPoishaExact(s.debit)
      }
      statementP = sum
      basis = 'opening_plus_lines'
    } else {
      let sum = 0
      for (const s of stmtLines) sum += toPoishaExact(s.credit) - toPoishaExact(s.debit)
      statementP = sum
      basis = 'lines_sum'
    }
  }

  let usCredit = 0
  let usDebit = 0
  for (const s of stmtLines) {
    if (s.match_status !== 'unmatched') continue // 'ignored' excluded
    usCredit += toPoishaExact(s.credit)
    usDebit += toPoishaExact(s.debit)
  }
  const journalLines = await listJournalBankLines(db, bankAccount)
  let ujDebit = 0
  let ujCredit = 0
  for (const j of journalLines) {
    if (j.matched_statement_line_id) continue
    ujDebit += toPoishaExact(j.debit)
    ujCredit += toPoishaExact(j.credit)
  }
  const explainedP = (usCredit - usDebit) - (ujDebit - ujCredit)
  const differenceP = statementP == null ? null : statementP - journalP
  return {
    journal_balance: taka(journalP),
    statement_balance: statementP == null ? null : taka(statementP),
    statement_balance_basis: basis,
    unmatched_statement_credit: taka(usCredit),
    unmatched_statement_debit: taka(usDebit),
    unmatched_journal_debit: taka(ujDebit),
    unmatched_journal_credit: taka(ujCredit),
    explained_difference: taka(explainedP),
    unexplained_difference: differenceP == null ? null : taka(differenceP - explainedP),
    difference: differenceP == null ? null : taka(differenceP),
  }
}
