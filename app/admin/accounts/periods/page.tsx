'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import { CalendarClock, RefreshCw, CheckCircle2, AlertTriangle, Lock, LockOpen, CalendarCheck2, Flag, ListChecks } from 'lucide-react'
import { PageHead } from '../ui'
import { useLanguage } from '@/lib/i18n/provider'

// Accounts A3 — Periods & fiscal years. Data: GET /api/accounts/periods
// (fiscal years + periods + pre-close checklist). Actions POST to the
// same route: close_period / lock_period / reopen_period (break-glass,
// reason mandatory) / close_fiscal_year (posts the rollover entry).

type Period = {
  id: string; month: string; start_date: string; end_date: string; status: string; entries: number
  closed_at: string | null; locked_at: string | null; lock_note: string | null
  reopened_at: string | null; reopen_reason: string | null
}
type FiscalYear = {
  id: string; label: string; start_date: string; end_date: string; is_current: boolean
  status: string; closed_at: string | null; periods: Period[]
}
type Checklist = {
  trial_balance_balanced: boolean; trial_balance_difference: string
  unposted_total: number; open_posting_exceptions: number
  standing_flags: Array<{ code: string; amount: string | null; count: number | null; text: string }>
}
type MonthEnd = {
  bank: {
    accounts: Array<{ id: string; name: string; difference: string | null; unmatched_count: number; confirmed: boolean }>
    unmatched_total: number; all_matched: boolean
  }
  payroll_pending: number
  shortages: { count: number; amount: string }
  costless_chalans: { count: number; sale_value: string }
}
type Payload = { fiscal_years: FiscalYear[]; checklist: Checklist; month_end: MonthEnd }

const statusChip = (s: string) =>
  s === 'open'
    ? 'bg-emerald-100 text-emerald-800'
    : s === 'closed'
      ? 'bg-amber-100 text-amber-800'
      : s === 'locked'
        ? 'bg-rose-100 text-rose-800'
        : 'bg-slate-100 text-slate-700'

export default function AccountsPeriodsPage() {
  const { t } = useLanguage()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reopenFor, setReopenFor] = useState<string | null>(null)
  const [reopenReason, setReopenReason] = useState('')
  const [fyArmed, setFyArmed] = useState<string | null>(null)
  const [flowPeriodId, setFlowPeriodId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts/periods')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load periods')
      setData(json)
    } catch (e: any) {
      setError(e?.message || 'Failed to load periods')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (body: Record<string, unknown>, okMessage: string) => {
    setBusy(String(body.period_id ?? body.fiscal_year_id ?? 'x'))
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/accounts/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Action failed')
      setNotice(okMessage)
      setReopenFor(null)
      setReopenReason('')
      setFyArmed(null)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const cl = data?.checklist
  const me = data?.month_end

  // ── Guided month-end flow (plan §7 ধাপ ৪) ──────────────────
  // Blockers stop the close; warnings stay visible (D8) but do
  // not block. The checklist is company-wide/current-state, so
  // the same gates apply to every period's Close button.
  const blockers: string[] = []
  if (cl && !cl.trial_balance_balanced) blockers.push('tb')
  if (cl && cl.unposted_total > 0) blockers.push('unposted')
  if (cl && cl.open_posting_exceptions > 0) blockers.push('exceptions')
  if (me && !me.bank.all_matched) blockers.push('bank')
  const closeBlocked = blockers.length > 0

  const todayStr = new Date().toISOString().slice(0, 10)
  const openPastPeriods = (data?.fiscal_years ?? [])
    .flatMap((fy) => fy.periods)
    .filter((p) => p.status === 'open' && p.end_date < todayStr)
    .sort((a, b) => a.month.localeCompare(b.month))
  const flowPeriod = openPastPeriods.find((p) => p.id === flowPeriodId) ?? openPastPeriods[0] ?? null

  type FlowStep = { label: string; state: 'pass' | 'fail' | 'warn'; detail?: string }
  const flowSteps: FlowStep[] = cl && me ? [
    {
      label: t.accounts.periodsFlow.stepTb,
      state: cl.trial_balance_balanced ? 'pass' : 'fail',
      detail: cl.trial_balance_balanced ? undefined : `৳${cl.trial_balance_difference}`,
    },
    {
      label: t.accounts.periodsFlow.stepUnposted,
      state: cl.unposted_total === 0 ? 'pass' : 'fail',
      detail: cl.unposted_total === 0 ? undefined : String(cl.unposted_total),
    },
    {
      label: t.accounts.periodsFlow.stepExceptions,
      state: cl.open_posting_exceptions === 0 ? 'pass' : 'fail',
      detail: cl.open_posting_exceptions === 0 ? undefined : String(cl.open_posting_exceptions),
    },
    {
      label: t.accounts.periodsFlow.stepBank,
      state: me.bank.all_matched ? 'pass' : 'fail',
      detail: me.bank.all_matched
        ? undefined
        : me.bank.accounts.filter((a) => !a.confirmed && (a.difference === null || Number(a.difference) !== 0))
            .map((a) => a.difference === null
              ? `${a.name} (${t.accounts.periodsFlow.bankNoStatement})`
              : `${a.name}: ৳${a.difference}`).join(' · ') +
          (me.bank.unmatched_total > 0 ? ` · ${t.accounts.periodsFlow.bankUnmatchedNote.replace('{count}', String(me.bank.unmatched_total))}` : ''),
    },
    {
      label: t.accounts.periodsFlow.stepPayroll,
      state: me.payroll_pending === 0 ? 'pass' : 'warn',
      detail: me.payroll_pending === 0 ? undefined : t.accounts.periodsFlow.payrollRunsNote.replace('{count}', String(me.payroll_pending)),
    },
    {
      label: t.accounts.periodsFlow.stepShortages,
      state: me.shortages.count === 0 ? 'pass' : 'warn',
      detail: me.shortages.count === 0 ? undefined : t.accounts.periodsFlow.shortagesNote.replace('{count}', String(me.shortages.count)).replace('{amount}', me.shortages.amount),
    },
    {
      label: t.accounts.periodsFlow.stepChalans,
      state: me.costless_chalans.count === 0 ? 'pass' : 'warn',
      detail: me.costless_chalans.count === 0 ? undefined : t.accounts.periodsFlow.chalansNote.replace('{count}', String(me.costless_chalans.count)).replace('{amount}', me.costless_chalans.sale_value),
    },
  ] : []

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <PageHead icon={<CalendarClock className="w-6 h-6 text-emerald-600" />} title={t.accounts.head.periods.title} bangla={t.accounts.head.periods.sub} tech={t.accounts.head.periods.tech} purpose={t.accounts.head.periods.purpose}>
        <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </PageHead>
      <p className="text-sm text-slate-500 -mt-4 mb-6">
        Close a month to stop new postings landing in it; lock it to make that final. Reopening is break-glass:
        it needs a written reason and is audit-logged. Closing a fiscal year carries its result to Retained Earnings.
      </p>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4 text-sm text-emerald-800">{notice}</div>}
      {loading && !data && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading periods…</div>}

      {data && cl && (
        <>
          <h2 className="text-lg font-bold text-slate-900 mb-3">Pre-close checklist</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className={`rounded-2xl border p-5 ${cl.trial_balance_balanced ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
              <div className="text-sm font-semibold text-slate-700">Trial balance</div>
              <div className="mt-2 text-xl font-bold text-slate-900 flex items-center gap-2">
                {cl.trial_balance_balanced
                  ? <><CheckCircle2 className="w-5 h-5 text-emerald-600" /> Balanced</>
                  : <><AlertTriangle className="w-5 h-5 text-rose-600" /> Out of balance</>}
              </div>
              <div className="mt-1 text-sm text-slate-600">Difference ৳{cl.trial_balance_difference}</div>
            </div>
            <div className={`rounded-2xl border p-5 ${cl.unposted_total === 0 ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
              <div className="text-sm font-semibold text-slate-700">Unposted sources</div>
              <div className="mt-2 text-xl font-bold text-slate-900">{cl.unposted_total}</div>
              <div className="mt-1 text-sm text-slate-600">
                {cl.unposted_total === 0 ? 'Every source record is posted.' : 'Source records with no journal entry yet — review before closing.'}
              </div>
            </div>
            <div className={`rounded-2xl border p-5 ${cl.open_posting_exceptions === 0 ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
              <div className="text-sm font-semibold text-slate-700">Blocked postings (exceptions)</div>
              <div className="mt-2 text-xl font-bold text-slate-900">{cl.open_posting_exceptions}</div>
              <div className="mt-1 text-sm text-slate-600">
                Postings refused by a closed/locked period. They stay visible until resolved.
              </div>
            </div>
          </div>

          {/* ── Guided month-end close flow (§7 ধাপ ৪) ──────── */}
          {me && (
            <div className="rounded-2xl border border-emerald-200 bg-white p-5 mb-8">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 font-bangla">
                <ListChecks className="w-5 h-5 text-emerald-600" /> {t.accounts.periodsFlow.title}
              </h2>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="text-sm font-semibold text-slate-700 font-bangla">{t.accounts.periodsFlow.selectMonth}</label>
                <select
                  value={flowPeriod?.id ?? ''}
                  onChange={(e) => setFlowPeriodId(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {openPastPeriods.length === 0 && <option value="">—</option>}
                  {openPastPeriods.map((p) => (
                    <option key={p.id} value={p.id}>{p.month}</option>
                  ))}
                </select>
              </div>

              <ol className="mt-4 space-y-2">
                {flowSteps.map((s, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className={`mt-0.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                      s.state === 'pass' ? 'bg-emerald-100 text-emerald-700'
                        : s.state === 'fail' ? 'bg-rose-100 text-rose-700'
                          : 'bg-amber-100 text-amber-700'}`}>
                      {s.state === 'pass' ? '✓' : s.state === 'fail' ? '!' : i + 1}
                    </span>
                    <span className="text-slate-700">
                      <span className="font-bangla">{s.label}</span>
                      {s.detail && <span className="block text-slate-500">{s.detail}</span>}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-slate-400 font-bangla">{t.accounts.periodsFlow.warnNote}</p>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  disabled={closeBlocked || !flowPeriod || busy === flowPeriod.id}
                  onClick={() => flowPeriod && act({ action: 'close_period', period_id: flowPeriod.id }, `Period ${flowPeriod.month} closed.`)}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 font-bangla"
                >
                  {flowPeriod ? t.accounts.periodsFlow.closeMonth.replace('{month}', flowPeriod.month) : t.accounts.periodsFlow.title}
                </button>
                {closeBlocked ? (
                  <span className="text-sm text-rose-700 font-bangla">{t.accounts.periodsFlow.blockedBy}</span>
                ) : (
                  <span className="text-sm text-emerald-700 font-bangla">{t.accounts.periodsFlow.readyToClose}</span>
                )}
              </div>
            </div>
          )}

          {data.fiscal_years.map((fy) => {
            const allSettled = fy.periods.every((p) => p.status !== 'open')
            return (
              <div key={fy.id} className="mb-8">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    {fy.label}
                    <span className="text-sm font-medium text-slate-500">{fy.start_date} → {fy.end_date}</span>
                    {fy.is_current && <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">CURRENT</span>}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusChip(fy.status)}`}>{fy.status.toUpperCase()}</span>
                  </h2>
                  {fy.status === 'open' && (
                    fyArmed === fy.id ? (
                      <div className="flex gap-2">
                        <button
                          disabled={busy === fy.id || !allSettled}
                          onClick={() => act({ action: 'close_fiscal_year', fiscal_year_id: fy.id }, `${fy.label} closed — rollover posted to Retained Earnings.`)}
                          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Yes — close {fy.label} &amp; post rollover
                        </button>
                        <button onClick={() => setFyArmed(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700">Cancel</button>
                      </div>
                    ) : (
                      <button
                        disabled={!allSettled}
                        title={allSettled ? '' : 'Every period must be closed or locked first'}
                        onClick={() => setFyArmed(fy.id)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-600 text-emerald-700 text-sm font-semibold hover:bg-emerald-50 disabled:opacity-40"
                      >
                        <CalendarCheck2 className="w-4 h-4" /> Close fiscal year…
                      </button>
                    )
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
                  <table className="w-full text-sm min-w-[760px]">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                        <th className="px-4 py-3 font-semibold">Period</th>
                        <th className="px-4 py-3 font-semibold text-right">Journal entries</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Close / lock trail</th>
                        <th className="px-4 py-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fy.periods.map((p) => (
                        <tr key={p.id} className="border-b border-slate-50 align-top">
                          <td className="px-4 py-3 font-medium text-slate-800">{p.month}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{p.entries}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusChip(p.status)}`}>{p.status.toUpperCase()}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500 space-y-0.5">
                            {p.closed_at && <div>Closed {new Date(p.closed_at).toLocaleDateString()}</div>}
                            {p.locked_at && <div>Locked {new Date(p.locked_at).toLocaleDateString()}{p.lock_note ? ` — ${p.lock_note}` : ''}</div>}
                            {p.reopen_reason && <div className="text-amber-700">Reopened {p.reopened_at ? new Date(p.reopened_at).toLocaleDateString() : ''}: {p.reopen_reason}</div>}
                            {!p.closed_at && !p.locked_at && !p.reopen_reason && <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap justify-end gap-2">
                              {p.status === 'open' && (
                                <button disabled={busy === p.id || closeBlocked}
                                  title={closeBlocked ? t.accounts.periodsFlow.blockedBy : ''}
                                  onClick={() => act({ action: 'close_period', period_id: p.id }, `Period ${p.month} closed.`)}
                                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Close</button>
                              )}
                              {p.status === 'closed' && (
                                <button disabled={busy === p.id} onClick={() => act({ action: 'lock_period', period_id: p.id }, `Period ${p.month} locked.`)}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                                  <Lock className="w-3.5 h-3.5" /> Lock</button>
                              )}
                              {p.status !== 'open' && reopenFor !== p.id && (
                                <button onClick={() => { setReopenFor(p.id); setReopenReason('') }}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-200 text-xs font-semibold text-amber-700 hover:bg-amber-50">
                                  <LockOpen className="w-3.5 h-3.5" /> Reopen…</button>
                              )}
                            </div>
                            {reopenFor === p.id && (
                              <div className="mt-2 flex flex-col gap-2">
                                <input
                                  value={reopenReason}
                                  onChange={(e) => setReopenReason(e.target.value)}
                                  placeholder="Reason (required — break-glass, audit-logged)"
                                  className="w-full rounded-lg border border-amber-300 px-3 py-2 text-xs"
                                />
                                <div className="flex justify-end gap-2">
                                  <button disabled={busy === p.id || !reopenReason.trim()}
                                    onClick={() => act({ action: 'reopen_period', period_id: p.id, reason: reopenReason }, `Period ${p.month} reopened.`)}
                                    className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold disabled:opacity-50">Reopen period</button>
                                  <button onClick={() => setReopenFor(null)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Flag className="w-5 h-5 text-amber-500" /> Standing flags — review before closing (drift &amp; data honesty)
          </h2>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2">
            {cl.standing_flags.length === 0 && <p className="text-sm text-slate-600">No flags.</p>}
            {cl.standing_flags.map((f, i) => (
              <p key={`${f.code}-${i}`} className="text-sm text-slate-700">
                <span className="font-mono text-xs font-semibold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">{f.code}</span>{' '}
                {f.text}
                {f.amount != null && <> — <strong>৳{f.amount}</strong></>}
                {f.count != null && <> ({f.count})</>}
              </p>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
