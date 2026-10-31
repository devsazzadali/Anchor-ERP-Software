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
import { getPeriodForDate, postEvent, uuidFromString, type Db } from './post'
import { postForSource, reverseForSource, syncClosingEntry, ACCT } from './events'
import { recordIfPeriodBlocked } from './exceptions'
import { toPoishaExact } from './reports'
import { syncPayableItemForSource, ensureProfileParty } from './payables'
import { syncTaxForSource, reverseTaxForSource, recordSalaryTax } from './tax'
import { poishaToDecimalString } from './post'

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

/**
 * A7: bring a chalan's / company expense's VAT state to what the
 * tax config + source figures demand (post / keep / reverse +
 * repost). Runs after the base posting hook, in its own fail-soft
 * block; a period refusal becomes a posting exception keyed to the
 * tax event. In the dormant state (no rates configured) the sync
 * computes "not taxable" and writes nothing.
 */
async function taxSync(sourceTable: string, sourceId: string, caller?: Caller): Promise<void> {
  if (sourceTable !== 'product_chalans' && sourceTable !== 'company_expenses') return
  try {
    const res = await syncTaxForSource(prisma as Db, sourceTable, sourceId, caller?.id ?? null)
    if (res.action === 'posted' || res.action === 'reposted') {
      await logAudit({
        caller: caller ?? null,
        action: 'accounts.tax_posted',
        eventType: 'create',
        entityTable: 'tax_register_lines',
        entityId: null,
        newValue: { source_table: sourceTable, source_id: sourceId, action: res.action } as any,
      })
    }
  } catch (err: any) {
    await recordIfPeriodBlocked(prisma as Db, err, { source_table: sourceTable, source_id: sourceId })
    console.error(`[accounts] taxSync ${sourceTable}/${sourceId} failed (fail-soft):`, err?.message || err)
  }
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
    // A3: a posting refused by a closed/locked period becomes a
    // durable posting exception (the source write stands).
    await recordIfPeriodBlocked(prisma as Db, err, { source_table: sourceTable, source_id: sourceId })
    console.error(`[accounts] hookPostSource ${sourceTable}/${sourceId} failed (fail-soft):`, err?.message || err)
  }
  await taxSync(sourceTable, sourceId, caller)
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
    await recordIfPeriodBlocked(prisma as Db, err, { source_table: sourceTable, source_id: sourceId })
    console.error(`[accounts] hookReverseSource ${sourceTable}/${sourceId} failed (fail-soft):`, err?.message || err)
  }
  // A7: a reversed/voided/deleted source takes its tax postings
  // with it (contra entries; register lines flip to 'reversed').
  if (sourceTable === 'salary_payments' || sourceTable === 'product_chalans' || sourceTable === 'company_expenses') {
    try {
      await reverseTaxForSource(prisma as Db, sourceTable, sourceId, {
        entry_date: dhakaToday(),
        created_by: caller?.id ?? null,
      })
    } catch (err: any) {
      await recordIfPeriodBlocked(prisma as Db, err, { source_table: sourceTable, source_id: sourceId })
      console.error(`[accounts] tax reversal ${sourceTable}/${sourceId} failed (fail-soft):`, err?.message || err)
    }
  }
}

/**
 * Re-sync a source record whose figures may have been edited after
 * posting (BCE / company-expense / chalan PATCH paths): reverse the
 * active entry if the rebuilt lines differ, then post the current
 * figures (postForSource's repost-after-reversal logic assigns the
 * suffixed event type). No-op when nothing changed.
 */
async function resyncSourceInner(
  sourceTable: string,
  sourceId: string,
  caller?: Caller
): Promise<void> {
  try {
    const { buildInputForResync } = await import('./events')
    const desired = await buildInputForResync(prisma as Db, sourceTable, sourceId)
    const entries = await prisma.journalEntry.findMany({
      where: {
        source_table: sourceTable,
        source_id: sourceId,
        is_reversal: false,
        // Accounts A7: the resync owns the BASE entry family only;
        // tax legs (tax_*) on the same source are synced by
        // taxSync and must never be mistaken for the active base
        // entry (they are usually the newest rows on the source).
        event_type: { not: { startsWith: 'tax_' } },
      },
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
    let reversedActive = false
    if (active) {
      await reverseForSource(prisma as Db, sourceTable, sourceId, {
        entry_date: dhakaToday(),
        memo: 'Source record edited — entry reversed for repost',
        created_by: caller?.id ?? null,
      })
      reversedActive = true
    }
    if (desired) {
      // A3 controlled-correction path (blueprint §D E4): when the
      // edited record's own period is closed/locked, the repost may
      // NOT land there. Because an active entry was just reversed,
      // this is a correction, not a new posting: it lands in the
      // current open period (today) with the move stated on the
      // entry. With no prior entry to correct, the plain post runs
      // and the engine's refusal becomes a posting exception.
      let override: { entry_date_override: string; memo_suffix: string } | undefined
      if (reversedActive) {
        const ownPeriod = await getPeriodForDate(prisma as Db, desired.entry_date)
        if (ownPeriod && ownPeriod.status !== 'open') {
          const today = dhakaToday()
          override = {
            entry_date_override: today,
            memo_suffix:
              ` [A3 correction: original event dated ${desired.entry_date} falls in ${ownPeriod.status} period ` +
              `${desired.entry_date.slice(0, 7)} — reversed and re-posted into open period ${today.slice(0, 7)}]`,
          }
        }
      }
      const res = await postForSource(prisma as Db, sourceTable, sourceId, {
        created_by: caller?.id ?? null,
        ...override,
      })
      if (res?.created) await auditPost(caller, res.entry_id, sourceTable, sourceId, 'repost')
    }
  } catch (err: any) {
    await recordIfPeriodBlocked(prisma as Db, err, { source_table: sourceTable, source_id: sourceId })
    console.error(`[accounts] hookResyncSource ${sourceTable}/${sourceId} failed (fail-soft):`, err?.message || err)
  }
}

/**
 * A5 — keep the payables register in step with a source record
 * (company expense, expense request, payout, branch expense,
 * salary recipient). Fail-soft like every hook: the register is a
 * mirror, and a missed sync surfaces in the register tie-out
 * instead of breaking the operational write.
 */
/**
 * A7 wrapper: the base resync above early-returns when the base
 * entry is unchanged — but a tax-only change (the vat_bearing flag
 * flipped, a rate took effect) must still sync, so the tax sync
 * runs unconditionally after the base resync, in its own
 * fail-soft block.
 */
export async function hookResyncSource(
  sourceTable: string,
  sourceId: string,
  caller?: Caller
): Promise<void> {
  await resyncSourceInner(sourceTable, sourceId, caller)
  await taxSync(sourceTable, sourceId, caller)
}

/**
 * A7: record the TDS a salary issue withheld (the deduction
 * itself was applied inside the shared salary service). Writes
 * the P11 journal leg + register line via tax.ts. Fail-soft; a
 * period refusal becomes a posting exception.
 */
export async function hookTaxSalary(
  paymentId: string,
  applied: { base: number; rate_percent: string; amount: number },
  caller?: Caller
): Promise<void> {
  try {
    const payment = await prisma.salaryPayment.findUnique({ where: { id: paymentId } })
    if (!payment) return
    const party = await ensureProfileParty(prisma as Db, payment.employee_id)
    const res = await recordSalaryTax(
      prisma as Db,
      payment,
      {
        base_p: toPoishaExact(applied.base),
        rate_percent: applied.rate_percent,
        tax_p: toPoishaExact(applied.amount),
      },
      party?.id ?? null,
      caller?.id ?? null
    )
    if (res.created) {
      await logAudit({
        caller: caller ?? null,
        action: 'accounts.tax_posted',
        eventType: 'create',
        entityTable: 'tax_register_lines',
        entityId: res.register_id,
        newValue: { source_table: 'salary_payments', source_id: paymentId, kind: 'tds_salary' } as any,
      })
    }
  } catch (err: any) {
    await recordIfPeriodBlocked(prisma as Db, err, {
      source_table: 'salary_payments',
      source_id: paymentId,
      event_type: 'tax_tds_salary',
    })
    console.error(`[accounts] hookTaxSalary ${paymentId} failed (fail-soft):`, err?.message || err)
  }
}

export async function hookSyncPayables(sourceTable: string, sourceId: string): Promise<void> {
  try {
    await syncPayableItemForSource(prisma as Db, sourceTable, sourceId)
  } catch (err: any) {
    console.error(`[accounts] hookSyncPayables ${sourceTable}/${sourceId} failed (fail-soft):`, err?.message || err)
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
    await recordIfPeriodBlocked(prisma as Db, err, {
      source_table: 'branch_cash_ledger',
      source_id: ledgerRowId,
    })
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
    // A5: settlements can also be recorded through the Accounts
    // register (payables.ts settlePayable, mode 'journal'), and
    // this hook's own earlier settlements are invisible to the
    // journal scan above — their entries carry a state-derived
    // source_id, not the expense id. The payable_settlements
    // registry is the complete settlement record: count it, or a
    // second paid-change would post the first settlement again.
    let registrySettled = 0
    let registerItem = await prisma.payableReceivable.findFirst({
      where: { source_table: 'company_expenses', source_id: expenseId, direction: 'payable' },
      select: { id: true },
    })
    if (registerItem) {
      const regs = await prisma.payableSettlement.findMany({
        where: { payable_id: registerItem.id, mode: { in: ['journal', 'source_state'] } },
        select: { amount: true },
      })
      registrySettled = regs.reduce((a, r) => a + toPoishaExact(r.amount), 0)
    }
    const delta = paidNow - settled - registrySettled
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
    if (res.created) {
      await auditPost(caller, res.entry_id, 'company_expenses', expenseId, 'company_expense_payment')
      // Record the settlement in the A5 registry so the NEXT
      // paid-change (from either path) sees it. Fail-soft: the
      // journal entry above is the money truth; a missed registry
      // row would surface as a tie-out difference, never silently.
      try {
        if (!registerItem) {
          await syncPayableItemForSource(prisma as Db, 'company_expenses', expenseId)
          registerItem = await prisma.payableReceivable.findFirst({
            where: { source_table: 'company_expenses', source_id: expenseId, direction: 'payable' },
            select: { id: true },
          })
        }
        if (registerItem) {
          await prisma.payableSettlement.create({
            data: {
              payable_id: registerItem.id,
              amount: poishaToDecimalString(delta),
              paid_via: ACCT.cashHeadOffice,
              settlement_date: new Date(`${dhakaToday()}T00:00:00Z`),
              mode: 'source_state',
              note: 'Recorded from the company-expenses module (paid_amount change)',
              journal_entry_id: res.entry_id,
              created_by: caller?.id ?? null,
            },
          })
        }
      } catch (e: any) {
        console.error(`[accounts] settlement registry write for ${expenseId} failed (fail-soft):`, e?.message || e)
      }
    }
  } catch (err: any) {
    await recordIfPeriodBlocked(prisma as Db, err, {
      source_table: 'company_expenses',
      source_id: expenseId,
      event_type: 'company_expense_payment',
    })
    console.error(`[accounts] hookCompanyPaidChange ${expenseId} failed (fail-soft):`, err?.message || err)
  }
}
