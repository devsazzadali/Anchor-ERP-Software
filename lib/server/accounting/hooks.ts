/**
 * Accounts A1 — route-facing hooks (app-side facade over post.ts /
 * events.ts).
 *
 * Called from inside the existing modules' write routes AFTER their
 * own write succeeds. Every hook is FAIL-SOFT: a posting failure is
 * logged and swallowed — the operational write that already
 * succeeded is never failed by the books (blueprint §B.0.2: source
 * systems never depend on the journal). A missed posting surfaces in
 * the Accounts overview's unposted-source count instead of breaking
 * operations. Idempotency in post.ts makes every hook safe to fire
 * more than once.
 */
import { prisma } from '@/lib/db'
import { logAudit } from '../audit'
import { dhakaToday } from '../../dhaka-time'
import { postEvent, uuidFromString, type Db } from './post'
import { postForSource, reverseForSource, syncClosingEntry, ACCT } from './events'
import { toPoishaExact } from './reports'

type Caller = Parameters<typeof logAudit>[0]['caller']

async function auditPost(caller: Caller, entryId: string, sourceTable: string, sourceId: string, eventType: string) {
  await logAudit({
    caller: caller ?? null,
    action: 'accounts.post',
    eventType: 'create',
    entityTable: 'journal_entries',
    entityId: entryId,
    newValue: { source_table: sourceTable, source_id: sourceId, event_type: eventType } as any,
  })
}

/** Post the journal entry for a source record (salary, deposit, …). */
export async function hookPostSource(
  sourceTable: string,
  sourceId: string,
  caller?: Caller,
  eventTypeLabel?: string
): Promise<void> {
  try {
    const res = await postForSource(prisma as Db, sourceTable, sourceId, {
      created_by: caller?.id ?? null,
    })
    if (res?.created) {
      await auditPost(caller, res.entry_id, sourceTable, sourceId, eventTypeLabel ?? sourceTable)
    }
  } catch (err: any) {
    console.error(`[accounts] hookPostSource ${sourceTable}/${sourceId} failed (fail-soft):`, err?.message || err)
  }
}

/** Reverse the journal entry for a source record (void / reversal). */
export async function hookReverseSource(
  sourceTable: string,
  sourceId: string,
  caller?: Caller,
  memo?: string
): Promise<void> {
  try {
    const res = await reverseForSource(prisma as Db, sourceTable, sourceId, {
      entry_date: dhakaToday(),
      memo: memo ?? null,
      created_by: caller?.id ?? null,
    })
    if (res?.created) {
      await auditPost(caller, res.entry_id, sourceTable, sourceId, 'reversal')
    }
  } catch (err: any) {
    console.error(`[accounts] hookReverseSource ${sourceTable}/${sourceId} failed (fail-soft):`, err?.message || err)
  }
}

/**
 * Re-sync a source record whose figures may have been edited after
 * posting (BCE / company-expense / chalan PATCH paths): reverse the
 * active entry if the rebuilt lines differ, then post the current
 * figures (postForSource's repost-after-reversal logic assigns the
 * suffixed event type). No-op when nothing changed.
 */
export async function hookResyncSource(
  sourceTable: string,
  sourceId: string,
  caller?: Caller
): Promise<void> {
  try {
    const { buildInputForResync } = await import('./events')
    const desired = await buildInputForResync(prisma as Db, sourceTable, sourceId)
    const entries = await prisma.journalEntry.findMany({
      where: { source_table: sourceTable, source_id: sourceId, is_reversal: false },
      orderBy: { created_at: 'desc' },
    })
    let active: any = null
    for (const e of entries) {
      const reversed = await prisma.journalEntry.findFirst({
        where: { reverses_entry_id: e.id },
        select: { id: true },
      })
      if (!reversed) { active = e; break }
    }
    if (!active && !desired) return
    if (active && desired) {
      // Compare active lines with desired lines (account code level).
      const lines = await prisma.journalLine.findMany({ where: { entry_id: active.id } })
      const accounts = await prisma.chartAccount.findMany({
        where: { id: { in: lines.map((l) => l.account_id) } },
        select: { id: true, code: true },
      })
      const codeOf = new Map(accounts.map((a) => [a.id, a.code]))
      const sig = (ls: Array<{ code: string; branch: string; d: number; c: number }>) =>
        ls.map((l) => `${l.code}|${l.branch}|${l.d}|${l.c}`).sort().join(';')
      const current = sig(lines.map((l) => ({
        code: codeOf.get(l.account_id) ?? '?',
        branch: l.branch_id ?? '',
        d: Number(l.debit.toString()),
        c: Number(l.credit.toString()),
      })))
      const wanted = sig(desired.lines.map((l) => ({
        code: l.account_code,
        branch: l.branch_id ?? '',
        d: Number(l.debit ?? 0),
        c: Number(l.credit ?? 0),
      })))
      if (current === wanted) return
    }
    if (active) {
      await reverseForSource(prisma as Db, sourceTable, sourceId, {
        entry_date: dhakaToday(),
        memo: 'Source record edited — entry reversed for repost',
        created_by: caller?.id ?? null,
      })
    }
    if (desired) {
      const res = await postForSource(prisma as Db, sourceTable, sourceId, { created_by: caller?.id ?? null })
      if (res?.created) await auditPost(caller, res.entry_id, sourceTable, sourceId, 'repost')
    }
  } catch (err: any) {
    console.error(`[accounts] hookResyncSource ${sourceTable}/${sourceId} failed (fail-soft):`, err?.message || err)
  }
}

/** Keep a closing row's journal entry in step with its lifecycle. */
export async function hookSyncClosing(ledgerRowId: string, caller?: Caller): Promise<void> {
  try {
    const row = await prisma.branchCashLedger.findUnique({ where: { id: ledgerRowId } })
    if (!row) return
    const res = await syncClosingEntry(prisma as Db, row, {
      today: dhakaToday(),
      created_by: caller?.id ?? null,
    })
    if (res.action === 'posted' || res.action === 'reposted' || res.action === 'reversed') {
      await logAudit({
        caller: caller ?? null,
        action: `accounts.closing_${res.action}`,
        eventType: res.action === 'reversed' ? 'reverse' : 'create',
        entityTable: 'journal_entries',
        entityId: null,
        branchId: row.branch_id,
        newValue: { source_table: 'branch_cash_ledger', source_id: ledgerRowId, action: res.action } as any,
      })
    }
  } catch (err: any) {
    console.error(`[accounts] hookSyncClosing ${ledgerRowId} failed (fail-soft):`, err?.message || err)
  }
}

/**
 * Company-expense settlement: when paid_amount changes after the
 * create posting, post Dr AP / Cr Head-Office Cash for the delta.
 * State-keyed idempotency — one settlement entry per (expense,
 * paid-total) state, so retries never double-post.
 */
export async function hookCompanyPaidChange(expenseId: string, caller?: Caller): Promise<void> {
  try {
    const row = await prisma.companyExpense.findUnique({ where: { id: expenseId } })
    if (!row) return
    const paidNow = toPoishaExact(row.paid_amount)
    const entries = await prisma.journalEntry.findMany({
      where: { source_table: 'company_expenses', source_id: expenseId },
      select: { id: true, event_type: true },
    })
    if (!entries.some((e) => e.event_type === 'company_expense')) return // create posting handles it
    const acct = await prisma.chartAccount.findMany({
      where: { code: { in: [ACCT.accountsPayable, ACCT.cashHeadOffice] } },
      select: { id: true, code: true },
    })
    const codeOf = new Map(acct.map((a) => [a.id, a.code]))
    const lines = await prisma.journalLine.findMany({
      where: { entry_id: { in: entries.map((e) => e.id) } },
      select: { entry_id: true, account_id: true, debit: true, credit: true },
    })
    const typeOf = new Map(entries.map((e) => [e.id, e.event_type]))
    let settled = 0
    for (const l of lines) {
      const code = codeOf.get(l.account_id)
      const type = typeOf.get(l.entry_id)
      if (type === 'company_expense' && code === ACCT.cashHeadOffice) settled += toPoishaExact(l.credit)
      if (type === 'company_expense_payment') {
        if (code === ACCT.accountsPayable) settled += toPoishaExact(l.debit) - toPoishaExact(l.credit)
      }
    }
    const delta = paidNow - settled
    if (delta === 0) return
    const amt = Math.abs(delta) / 100
    const res = await postEvent(prisma as Db, {
      source_table: 'company_expenses',
      source_id: uuidFromString(`ce-pay:${expenseId}:${paidNow}`),
      event_type: 'company_expense_payment',
      entry_date: dhakaToday(),
      memo: `Settlement — ${row.purpose}`,
      created_by: caller?.id ?? null,
      lines:
        delta > 0
          ? [
              { account_code: ACCT.accountsPayable, debit: amt },
              { account_code: ACCT.cashHeadOffice, credit: amt },
            ]
          : [
              { account_code: ACCT.cashHeadOffice, debit: amt },
              { account_code: ACCT.accountsPayable, credit: amt },
            ],
    })
    if (res.created) await auditPost(caller, res.entry_id, 'company_expenses', expenseId, 'company_expense_payment')
  } catch (err: any) {
    console.error(`[accounts] hookCompanyPaidChange ${expenseId} failed (fail-soft):`, err?.message || err)
  }
}
