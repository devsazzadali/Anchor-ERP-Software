/**
 * Accounts A9 — the Exceptions Inbox (lib/server/accounting/inbox.ts).
 *
 * ONE list of every durable problem signal in the Accounts module,
 * assembled at read time from two kinds of sources:
 *
 *  STORED — `posting_exceptions` rows (A3): postings the engine
 *  refused because their period was closed/locked. These carry the
 *  human workflow built here: open → acknowledged → resolved, with
 *  resolved_by / resolved_at / resolution_note stamped at resolve
 *  time. The note is MANDATORY — a blocked posting may only be
 *  closed by saying how it was dealt with (period reopened +
 *  re-fired, correction entry posted, …). Resolving never deletes
 *  the row and never posts anything by itself; if the same event
 *  blocks again, A3's recorder re-opens the row and clears the
 *  workflow fields.
 *
 *  DERIVED — conditions computed live from the owning modules'
 *  rows on every read (the A3/A8 flag pattern): the standing
 *  opening-position flags, unbooked paid cash requests (expense
 *  OD-6), unlinked salary mirrors (the FR-2 detector, permanent),
 *  unposted source records, pending approvals, closing shortages,
 *  reused deposit transaction ids, unmatched bank statement lines
 *  + unexplained bank differences (A4), overdue payables (A5
 *  ageing basis), bounced + PDC-due cheques (A8) and periods left
 *  open past their month. Derived items have NO resolve action —
 *  they clear themselves when the source is fixed, and the inbox
 *  shows "fix at source" guidance with a deep link instead. They
 *  are never fake-resolved and nothing about them is stored.
 *
 * Sources deliberately EXCLUDED (blueprint §B.5 A9 names the card
 * list; Boss's rule: a reminder joins the inbox only if the
 * blueprint names it):
 *  - BANK_UNCONFIRMED + the DRAFT opening position — not in the
 *    A9 card list. They already render as their own first-class
 *    panels (Accounts overview opening card, Bank screen draft
 *    badges); they are setup state, not exceptions.
 *  - Overdue RECEIVABLES — the A5 ageing covers both directions,
 *    but the inbox tracks money owed BY the company; no receivable
 *    rows exist in the data at all today.
 *  - Closing EXCESSES — a counted excess is income-side noise the
 *    closing already posts (P1); only shortages signal a problem.
 *  - Uncosted chalans appear once, as CHALAN_COST_MISSING — the
 *    unposted-sources count deliberately skips them (the same
 *    exclusion the overview's coverage card makes).
 *
 * Every derived count is computed from the same conditions the
 * owning screens/flags use, so the inbox can never disagree with
 * the Accounts overview for the same data.
 */
import { taka, toPoishaExact, unpostedSources } from './reports'
import { computeOpeningPosition } from './opening'
import { reconciliationStatus } from './bankrec'
import { PDC_DUE_WINDOW_DAYS } from './cheques'
import { dhakaToday, dhakaDateOf, addDays } from '../../dhaka-time'
import type { Db } from './post'

export class InboxError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type InboxSeverity = 'high' | 'medium' | 'low'

export interface InboxItem {
  /** Stable key: `stored:<exception id>` or `derived:<CODE>[:<source id>]`. */
  key: string
  kind: 'stored' | 'derived'
  code: string
  severity: InboxSeverity
  title: string
  text: string
  /** Taka string with 2dp, or null when the item carries no money figure. */
  amount: string | null
  count: number | null
  source_table: string | null
  source_id: string | null
  /** YYYY-MM-DD the underlying condition dates from, when known. */
  since: string | null
  age_days: number | null
  /** Deep link to the screen that resolves the item. */
  link: string
  link_label: string
  /** Stored exceptions only: the workflow state + who/when. */
  status: string | null
  can_act: boolean
  acknowledged_at: string | null
  acknowledged_by: string | null
  detail: unknown
}

export interface InboxCounts {
  stored_open: number
  stored_acknowledged: number
  stored_resolved: number
  derived: number
  /** Everything still needing attention: stored open+acknowledged + derived. */
  total_active: number
}

const dateOf = (d: Date): string => d.toISOString().slice(0, 10)

function ageDays(since: string | null, today: string): number | null {
  if (!since) return null
  const days = Math.floor((Date.parse(today) - Date.parse(since)) / 86400000)
  return days >= 0 ? days : null
}

function item(partial: Omit<InboxItem, 'age_days'> & { since: string | null }, today: string): InboxItem {
  return { ...partial, age_days: ageDays(partial.since, today) }
}

// ── Stored workflow ────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function loadException(db: Db, id: string): Promise<any> {
  if (!UUID_RE.test(String(id ?? ''))) throw new InboxError(404, 'exception not found')
  const row = await db.postingException.findUnique({ where: { id } })
  if (!row) throw new InboxError(404, 'exception not found')
  return row
}

/** open → acknowledged. Stamps who took ownership, and when. */
export async function acknowledgeException(db: Db, id: string, actorId: string | null) {
  const before = await loadException(db, id)
  if (before.status === 'resolved') throw new InboxError(409, 'this exception is already resolved')
  if (before.status === 'acknowledged') throw new InboxError(409, 'this exception is already acknowledged')
  const after = await db.postingException.update({
    where: { id: before.id },
    data: { status: 'acknowledged', acknowledged_at: new Date(), acknowledged_by: actorId },
  })
  return { before, after }
}

/**
 * open|acknowledged → resolved. The resolution note is mandatory:
 * it is the durable answer to "how was this blocked posting dealt
 * with". Resolving writes NO journal entry and deletes NOTHING.
 */
export async function resolveException(db: Db, id: string, actorId: string | null, note: unknown) {
  const clean = String(note ?? '').trim()
  if (!clean) throw new InboxError(400, 'a resolution note is required — say how the blocked posting was dealt with')
  const before = await loadException(db, id)
  if (before.status === 'resolved') throw new InboxError(409, 'this exception is already resolved')
  const after = await db.postingException.update({
    where: { id: before.id },
    data: {
      status: 'resolved',
      resolved_at: new Date(),
      resolved_by: actorId,
      resolution_note: clean,
    },
  })
  return { before, after }
}

// ── Derived sources ────────────────────────────────────────────────

/** Standing opening-position flags that belong in the inbox
 * (BANK_UNCONFIRMED excluded — see the header note). */
const OPENING_FLAG_META: Record<string, { severity: InboxSeverity; title: string; link: string; link_label: string }> = {
  DEPOSIT_DRIFT: {
    severity: 'high',
    title: 'Deposit drift — SOTIBARI 2026-09-10',
    link: '/admin/branch-accounts/reconciliation',
    link_label: 'Open reconciliation',
  },
  CHALAN_COST_MISSING: {
    severity: 'medium',
    title: 'Legacy chalans with no recorded cost',
    link: '/admin/branch-chalans',
    link_label: 'Open branch chalans',
  },
  DUPLICATE_RECORD: {
    severity: 'medium',
    title: 'Duplicate record — Nur Renu salary overlap',
    link: '/admin/salaries',
    link_label: 'Open salaries',
  },
  SALARY_HEAD_QUIRK: {
    severity: 'low',
    title: 'Salary rows carrying a rent ledger head',
    link: '/admin/salaries',
    link_label: 'Open salaries',
  },
  CASH_NOT_RECORDED: {
    severity: 'low',
    title: 'Branches with no closed daily closing',
    link: '/admin/branch-accounts',
    link_label: 'Open branch accounts',
  },
}

const UNPOSTED_LABELS: Record<string, string> = {
  closings_open: 'open daily closings',
  closings_closed: 'closed daily closings',
  branch_expenses: 'branch expenses',
  company_expenses: 'company expenses',
  salaries: 'salary payments',
  expense_requests_paid: 'paid expense requests',
  deposits_approved: 'approved deposits',
  chalans_costed: 'costed chalans',
}

async function derivedItems(db: Db, today: string): Promise<InboxItem[]> {
  const out: InboxItem[] = []
  const push = (p: Omit<InboxItem, 'age_days'> & { since: string | null }) => out.push(item(p, today))
  const base = {
    kind: 'derived' as const,
    status: null,
    can_act: false,
    acknowledged_at: null,
    acknowledged_by: null,
    detail: null,
  }

  const [
    computation,
    unposted,
    cashRequests,
    mirrors,
    pendingDeposits,
    pendingRequests,
    pendingKyc,
    shortageRows,
    approvedDeposits,
    registerItems,
    parties,
    bankAccounts,
    bouncedCheques,
    pendingCheques,
    pastOpenPeriods,
  ] = await Promise.all([
    computeOpeningPosition(db),
    unpostedSources(db),
    db.employeeExpenseRequest.findMany({ where: { status: 'paid', payment_method: 'cash' }, orderBy: { created_at: 'asc' } }),
    db.branchCashExpense.findMany({
      where: {
        salary_payment_id: null,
        OR: [{ description: { startsWith: 'Historical Salary Payment' } }, { description: { startsWith: 'Salary Payment for' } }],
      },
      orderBy: { expense_date: 'asc' },
    }),
    db.branchBankDeposit.findMany({ where: { status: 'pending' }, orderBy: { created_at: 'asc' } }),
    db.employeeExpenseRequest.findMany({ where: { status: 'pending' }, orderBy: { created_at: 'asc' } }),
    db.profile.findMany({ where: { verification_status: 'pending' }, orderBy: { created_at: 'asc' } }),
    db.branchCashLedger.findMany({ where: { cash_difference: { lt: 0 } }, orderBy: { ledger_date: 'asc' } }),
    db.branchBankDeposit.findMany({
      where: { status: 'approved', is_reversed: false, bank_transaction_id: { not: null } },
      orderBy: { deposit_date: 'asc' },
    }),
    db.payableReceivable.findMany({ where: { direction: 'payable', status: { in: ['open', 'partial'] } }, orderBy: { due_date: 'asc' } }),
    db.counterparty.findMany({ select: { id: true, name: true } }),
    db.bankAccount.findMany({ where: { is_active: true }, orderBy: { created_at: 'asc' } }),
    db.cheque.findMany({ where: { status: 'bounced' }, orderBy: { issue_date: 'asc' } }),
    db.cheque.findMany({ where: { status: 'pending', due_date: { not: null } }, orderBy: { due_date: 'asc' } }),
    db.accountingPeriod.findMany({ where: { status: 'open', month: { lt: today.slice(0, 7) } }, orderBy: { month: 'asc' } }),
  ])

  // 1 ── Standing opening-position flags ──────────────────────────
  for (const f of computation.flags) {
    const meta = OPENING_FLAG_META[f.code]
    if (!meta) continue
    push({
      ...base,
      key: `derived:${f.code}`,
      code: f.code,
      severity: meta.severity,
      title: meta.title,
      text: f.text,
      amount: f.amount != null ? f.amount.toFixed(2) : null,
      count: f.count ?? null,
      source_table: null,
      source_id: null,
      since: null,
      link: meta.link,
      link_label: meta.link_label,
    })
  }

  // 2 ── OD-6: paid cash expense requests never booked into the
  // branch drawer (no branch_cash_expenses mirror row). ─────────
  if (cashRequests.length > 0) {
    const ids = cashRequests.map((r: any) => r.id)
    const mirrorRows = await db.branchCashExpense.findMany({
      where: { expense_request_id: { in: ids } },
      select: { expense_request_id: true },
    })
    const mirrored = new Set(mirrorRows.map((m: any) => m.expense_request_id))
    for (const r of cashRequests) {
      if (mirrored.has(r.id)) continue
      push({
        ...base,
        key: `derived:UNBOOKED_PAID_REQUEST:${r.id}`,
        code: 'UNBOOKED_PAID_REQUEST',
        severity: 'medium',
        title: `Paid cash request never booked — ${r.employee_name ?? 'employee'}`,
        text:
          `Expense request "${r.title}" (${r.branch_name ?? 'branch not recorded'}) was PAID in cash but no ` +
          `branch-cash booking exists for it, so the drawer was never credited with the spend (expense round OD-6 — ` +
          `owner decision; the books surface it, they do not repair it).`,
        amount: taka(toPoishaExact(r.amount)),
        count: null,
        source_table: 'employee_expense_requests',
        source_id: r.id,
        since: dhakaDateOf(r.paid_at ?? r.created_at),
        link: '/admin/expense-requests',
        link_label: 'Open expense requests',
      })
    }
  }

  // 3 ── FR-2 unlinked-mirror detector (permanent): BCE rows that
  // read as salary-payment mirror copies but carry no link. ─────
  for (const r of mirrors) {
    push({
      ...base,
      key: `derived:UNLINKED_SALARY_MIRROR:${r.id}`,
      code: 'UNLINKED_SALARY_MIRROR',
      severity: 'medium',
      title: `Unlinked salary mirror copy — ${r.branch_name ?? 'branch'}`,
      text:
        `A branch-cash row reads as a salary-payment mirror ("${r.description}") but has no salary_payment_id link, ` +
        `so the expense streams cannot exclude it as a copy — the salary risks being counted twice until an admin links it.`,
      amount: taka(toPoishaExact(r.amount)),
      count: null,
      source_table: 'branch_cash_expenses',
      source_id: r.id,
      since: dateOf(r.expense_date),
      link: '/admin/branch-expenses',
      link_label: 'Open branch expenses',
    })
  }

  // 4 ── Unposted source records (per class, aggregate). Uncosted
  // chalans are excluded — they are CHALAN_COST_MISSING above. ──
  for (const [cls, count] of Object.entries(unposted)) {
    if (cls === 'chalans_uncosted_flagged' || !count) continue
    push({
      ...base,
      key: `derived:UNPOSTED_SOURCE:${cls}`,
      code: 'UNPOSTED_SOURCE',
      severity: 'medium',
      title: `${count} unposted ${UNPOSTED_LABELS[cls] ?? cls.replace(/_/g, ' ')}`,
      text:
        `${count} ${UNPOSTED_LABELS[cls] ?? cls} record(s) exist in the source module but have no journal entry. ` +
        `New events post automatically; a standing count means a posting was refused (see stored exceptions) or pre-dates the books.`,
      amount: null,
      count,
      source_table: null,
      source_id: null,
      since: null,
      link: '/admin/accounts',
      link_label: 'Open accounts overview',
      detail: { class: cls },
    })
  }

  // 5 ── Pending approvals across the money modules ──────────────
  if (pendingDeposits.length > 0) {
    push({
      ...base,
      key: 'derived:PENDING_DEPOSITS',
      code: 'PENDING_DEPOSITS',
      severity: 'low',
      title: `${pendingDeposits.length} bank deposit(s) awaiting approval`,
      text: 'Submitted branch deposits are waiting for an admin decision. Until approved they post nothing and the branch drawer still carries the cash.',
      amount: taka(pendingDeposits.reduce((a: number, r: any) => a + toPoishaExact(r.amount), 0)),
      count: pendingDeposits.length,
      source_table: 'branch_bank_deposits',
      source_id: null,
      since: dateOf(pendingDeposits[0].created_at),
      link: '/admin/branch-accounts/deposit-approvals',
      link_label: 'Open deposit approvals',
    })
  }
  if (pendingRequests.length > 0) {
    push({
      ...base,
      key: 'derived:PENDING_REQUESTS',
      code: 'PENDING_REQUESTS',
      severity: 'low',
      title: `${pendingRequests.length} expense request(s) awaiting a decision`,
      text: 'Employee expense requests are waiting for approval or rejection.',
      amount: taka(pendingRequests.reduce((a: number, r: any) => a + toPoishaExact(r.amount), 0)),
      count: pendingRequests.length,
      source_table: 'employee_expense_requests',
      source_id: null,
      since: dateOf(pendingRequests[0].created_at),
      link: '/admin/expense-requests',
      link_label: 'Open expense requests',
    })
  }
  if (pendingKyc.length > 0) {
    push({
      ...base,
      key: 'derived:KYC_PENDING',
      code: 'KYC_PENDING',
      severity: 'low',
      title: `${pendingKyc.length} KYC verification(s) pending`,
      text: 'Profiles are waiting for KYC review. Until approved, those users stay gated out of the money modules.',
      amount: null,
      count: pendingKyc.length,
      source_table: 'profiles',
      source_id: null,
      since: dateOf(pendingKyc[0].created_at),
      link: '/admin/kyc',
      link_label: 'Open KYC approvals',
    })
  }

  // 6 ── Closing shortages (counted cash below expected). ────────
  if (shortageRows.length > 0) {
    const total = shortageRows.reduce((a: number, r: any) => a + toPoishaExact(r.cash_difference), 0)
    push({
      ...base,
      key: 'derived:CLOSING_SHORTAGES',
      code: 'CLOSING_SHORTAGES',
      severity: 'high',
      title: `${shortageRows.length} daily closing(s) counted SHORT`,
      text:
        `Counted cash came in below expected on ${shortageRows.length} day(s), ${taka(total)} in total. ` +
        `Shortages post to the books as recorded — review the days in Reconciliation and follow up with the branches.`,
      amount: taka(total),
      count: shortageRows.length,
      source_table: 'branch_cash_ledger',
      source_id: null,
      since: dateOf(shortageRows[0].ledger_date),
      link: '/admin/branch-accounts/reconciliation',
      link_label: 'Open reconciliation',
    })
  }

  // 7 ── Reused bank transaction ids across approved deposits. ───
  const byTxn = new Map<string, any[]>()
  for (const d of approvedDeposits) {
    const txn = String(d.bank_transaction_id ?? '').trim()
    if (!txn) continue
    const arr = byTxn.get(txn) ?? []
    arr.push(d)
    byTxn.set(txn, arr)
  }
  for (const [txn, rows] of byTxn) {
    if (rows.length < 2) continue
    push({
      ...base,
      key: `derived:TXN_ID_REUSED:${txn}`,
      code: 'TXN_ID_REUSED',
      severity: 'medium',
      title: `Bank transaction id reused on ${rows.length} deposits`,
      text:
        `Transaction id ${txn} is recorded on ${rows.length} approved deposits. A bank transaction can only move money once — ` +
        `verify against the statement whether these are separate deposits mis-keyed with one id, or one deposit claimed more than once.`,
      amount: taka(rows.reduce((a: number, r: any) => a + toPoishaExact(r.amount), 0)),
      count: rows.length,
      source_table: 'branch_bank_deposits',
      source_id: null,
      since: dateOf(rows[0].deposit_date),
      link: '/admin/branch-accounts/deposit-approvals',
      link_label: 'Open deposit approvals',
      detail: { bank_transaction_id: txn, deposit_ids: rows.map((r: any) => r.id) },
    })
  }

  // 8 ── Bank reconciliation: unmatched statement lines +
  // unexplained differences (A4). ────────────────────────────────
  for (const bank of bankAccounts) {
    const lines = await db.bankStatementLine.findMany({ where: { bank_account_id: bank.id, match_status: 'unmatched' } })
    if (lines.length > 0) {
      const net = lines.reduce((a: number, s: any) => a + toPoishaExact(s.credit) - toPoishaExact(s.debit), 0)
      push({
        ...base,
        key: `derived:BANK_UNMATCHED_LINES:${bank.id}`,
        code: 'BANK_UNMATCHED_LINES',
        severity: 'medium',
        title: `${lines.length} unmatched statement line(s) — ${bank.label}`,
        text: 'Imported bank statement lines that no journal line has been matched to yet. Match them in Bank Reconciliation, or mark lines that are not the company\u2019s as ignored there.',
        amount: taka(net),
        count: lines.length,
        source_table: 'bank_statement_lines',
        source_id: null,
        since: dateOf(lines[0].statement_date),
        link: `/admin/accounts/bank/${bank.id}`,
        link_label: 'Open bank reconciliation',
      })
    }
    const status = await reconciliationStatus(db, bank)
    if (status.unexplained_difference != null && Number(status.unexplained_difference) !== 0) {
      push({
        ...base,
        key: `derived:BANK_UNEXPLAINED:${bank.id}`,
        code: 'BANK_UNEXPLAINED',
        severity: 'high',
        title: `Unexplained bank difference — ${bank.label}`,
        text:
          `After matching, the statement balance and the book balance for this account still differ by ` +
          `${status.unexplained_difference} with no unmatched line explaining it. Investigate in Bank Reconciliation.`,
        amount: status.unexplained_difference,
        count: null,
        source_table: 'bank_accounts',
        source_id: bank.id,
        since: null,
        link: `/admin/accounts/bank/${bank.id}`,
        link_label: 'Open bank reconciliation',
      })
    }
  }

  // 9 ── Overdue payables (A5 ageing basis: due date on the
  // register row, which is the source date — no source records a
  // contractual due date). Per item: each due is actionable. ────
  const partyOf = new Map<string, string>(parties.map((p: any) => [p.id, p.name]))
  for (const r of registerItems) {
    const open = toPoishaExact(r.amount) - toPoishaExact(r.paid_amount)
    if (open <= 0) continue
    const due = r.due_date ? dateOf(r.due_date) : dateOf(r.created_at)
    if (due >= today) continue
    const age = Math.floor((Date.parse(today) - Date.parse(due)) / 86400000)
    push({
      ...base,
      key: `derived:PAYABLE_OVERDUE:${r.id}`,
      code: 'PAYABLE_OVERDUE',
      severity: age > 90 ? 'high' : 'medium',
      title: `Overdue payable — ${r.counterparty_id ? partyOf.get(r.counterparty_id) ?? 'counterparty' : 'no counterparty recorded'}`,
      text: `${r.description ?? 'Payable'} — ৳${taka(open)} still unpaid, ${age} day(s) past its recorded date. Settle it from Payables & Ageing.`,
      amount: taka(open),
      count: null,
      source_table: 'payables_receivables',
      source_id: r.id,
      since: due,
      link: '/admin/accounts/payables',
      link_label: 'Open payables & ageing',
      detail: { register_source_table: r.source_table, register_source_id: r.source_id },
    })
  }

  // 10 ── Cheques (A8): bounced per item + PDCs due in the window.
  // Same conditions as the overview's CHEQUE_BOUNCED /
  // CHEQUE_PDC_DUE flags, so the counts always agree. ───────────
  const bankName = new Map<string, string>(bankAccounts.map((b: any) => [b.id, b.label]))
  const cpName = new Map<string, string>(parties.map((p: any) => [p.id, p.name]))
  for (const c of bouncedCheques) {
    push({
      ...base,
      key: `derived:CHEQUE_BOUNCED:${c.id}`,
      code: 'CHEQUE_BOUNCED',
      severity: 'high',
      title: `Cheque BOUNCED — no. ${c.cheque_no}`,
      text:
        `${c.direction === 'issued' ? 'Issued' : 'Received'} cheque ${c.cheque_no}` +
        `${c.counterparty_id ? ` (${cpName.get(c.counterparty_id) ?? 'counterparty'})` : ''}` +
        `${c.bank_account_id ? ` on ${bankName.get(c.bank_account_id) ?? 'bank account'}` : ''} has bounced. Follow up from the Cheque register.`,
      amount: taka(toPoishaExact(c.amount)),
      count: null,
      source_table: 'cheque_register',
      source_id: c.id,
      since: dateOf(c.issue_date),
      link: '/admin/accounts/cheques',
      link_label: 'Open cheque register',
    })
  }
  const pdcCutoff = addDays(today, PDC_DUE_WINDOW_DAYS)
  for (const c of pendingCheques) {
    const due = dateOf(c.due_date)
    if (due > pdcCutoff) continue
    push({
      ...base,
      key: `derived:CHEQUE_PDC_DUE:${c.id}`,
      code: 'CHEQUE_PDC_DUE',
      severity: 'low',
      title: `PDC due ${due} — cheque no. ${c.cheque_no}`,
      text:
        `${c.direction === 'issued' ? 'Issued' : 'Received'} post-dated cheque ${c.cheque_no} falls due on ${due} ` +
        `(within ${PDC_DUE_WINDOW_DAYS} days, or already overdue). Make sure ${c.direction === 'issued' ? 'the account is funded' : 'it is deposited in time'}.`,
      amount: taka(toPoishaExact(c.amount)),
      count: null,
      source_table: 'cheque_register',
      source_id: c.id,
      since: due,
      link: '/admin/accounts/cheques',
      link_label: 'Open cheque register',
    })
  }

  // 11 ── Period-close readiness: past months still open. ────────
  if (pastOpenPeriods.length > 0) {
    push({
      ...base,
      key: 'derived:PERIOD_CLOSE_PENDING',
      code: 'PERIOD_CLOSE_PENDING',
      severity: 'low',
      title: `${pastOpenPeriods.length} past period(s) still open`,
      text:
        `The accounting periods for ${pastOpenPeriods.map((p: any) => p.month).join(', ')} have ended but are still open. ` +
        `Run the pre-close checklist in Periods and close them so the books for those months are final.`,
      amount: null,
      count: pastOpenPeriods.length,
      source_table: 'accounting_periods',
      source_id: null,
      since: dateOf(pastOpenPeriods[0].start_date),
      link: '/admin/accounts/periods',
      link_label: 'Open periods',
      detail: { months: pastOpenPeriods.map((p: any) => p.month) },
    })
  }

  const sevRank: Record<InboxSeverity, number> = { high: 0, medium: 1, low: 2 }
  out.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.code.localeCompare(b.code) || a.key.localeCompare(b.key))
  return out
}

// ── Assembly ───────────────────────────────────────────────────────

export async function listInbox(db: Db): Promise<{ items: InboxItem[]; counts: InboxCounts }> {
  const today = dhakaToday()
  const [storedRows, resolvedCount, derived] = await Promise.all([
    db.postingException.findMany({
      where: { status: { in: ['open', 'acknowledged'] } },
      orderBy: { created_at: 'asc' },
    }),
    db.postingException.count({ where: { status: 'resolved' } }),
    derivedItems(db, today),
  ])

  const stored: InboxItem[] = storedRows.map((x: any) =>
    item(
      {
        key: `stored:${x.id}`,
        kind: 'stored',
        code: 'POSTING_BLOCKED',
        severity: 'high',
        title: `Posting blocked — ${x.event_type} (${x.source_table})`,
        text:
          `A ${x.event_type} posting for ${x.source_table} was refused: period ${x.period_month} is ` +
          `${String(x.reason).replace('period_', '')}. The source record stands; resolve by reopening the period ` +
          `(break-glass) and re-firing, or by a correction entry in an open period — then resolve here with a note.`,
        amount: null,
        count: null,
        source_table: x.source_table,
        source_id: x.source_id,
        since: dateOf(x.entry_date),
        link: '/admin/accounts/periods',
        link_label: 'Open periods',
        status: x.status,
        can_act: true,
        acknowledged_at: x.acknowledged_at?.toISOString() ?? null,
        acknowledged_by: x.acknowledged_by ?? null,
        detail: { period_month: x.period_month, reason: x.reason, exception_id: x.id, payload: x.detail ?? null },
      },
      today
    )
  )

  const counts: InboxCounts = {
    stored_open: storedRows.filter((x: any) => x.status === 'open').length,
    stored_acknowledged: storedRows.filter((x: any) => x.status === 'acknowledged').length,
    stored_resolved: resolvedCount,
    derived: derived.length,
    total_active: storedRows.length + derived.length,
  }
  return { items: [...stored, ...derived], counts }
}

/** Counts only — the sidebar badge + the overview card. */
export async function inboxCounts(db: Db): Promise<InboxCounts> {
  const { counts } = await listInbox(db)
  return counts
}
