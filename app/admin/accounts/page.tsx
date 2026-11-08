'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Landmark, RefreshCw, CheckCircle2, AlertTriangle, Scale, BookOpen, ListTree, Flag, ArrowRight } from 'lucide-react'
import { PageHead, taka } from './ui'
import { useLanguage } from '@/lib/i18n/provider'
import { fill } from '@/lib/i18n/provider'

// Accounts A1 — section home, simplified (presentation only).
// Data: GET /api/accounts/overview (trial-balance health, per-class
// reconciliation vs the source modules, unposted-source counts,
// opening-position summary and the standing data-quality flags) plus
// fail-soft parallel reads of the existing statements / bank /
// payables / exceptions endpoints for the simple glance cards.
// Every figure comes from those endpoints — nothing is recomputed
// here except the cash lines' debit−credit, as specified. Read-only.

type ReconRow = { cls: string; source: string; journal: string; match: boolean; note: string | null }
type FlagRow = { code: string; amount: string | null; count: number | null; text: string }
type Overview = {
  trial_balance: { entries: number; total_debit: string; total_credit: string; difference: string; balanced: boolean }
  counts: { journal_entries: number; active_accounts: number; open_periods: number }
  unposted: Record<string, number>
  reconciliation: ReconRow[]
  opening_position: {
    id: string; label: string; status: string; as_of: string
    lines: Array<{ component: string; label: string; amount: string; side: string }>
  } | null
  flags: FlagRow[]
  // Accounts A9: exceptions inbox counts (additive).
  inbox?: { stored_open: number; stored_acknowledged: number; stored_resolved: number; derived: number; total_active: number }
  // Round 2 Step 6: the owner's daily check (additive).
  daily_check?: {
    date: string; closings_today: number; closings_unposted: number
    cash_difference_today: string; deposits_pending: number; payroll_pending: number
  }
}

type PlData = {
  statement: { total_income: string; total_expenses: string; net: string }
  scope: { label: string }
  meta: { default_period: string }
}
type TbStmtData = {
  statement: { rows: Array<{ code: string; name: string; debit: string; credit: string }> }
}
type BankData = {
  accounts: Array<{ label: string; bank_name: string; is_draft: boolean; journal_balance: string }>
}
type PayablesData = {
  items: Array<{ direction: string; status: string }>
  ageing: { totals: { payable: { total: string }; receivable: { total: string } } }
}
type ExceptionsData = {
  items: Array<{ code: string; title: string; severity: 'high' | 'medium' | 'low'; amount: string | null; count: number | null; link: string; link_label: string }>
  counts: { total_active: number }
}

const CASH_CODES = ['1000', '1005', '1020']

export default function AccountsOverviewPage() {
  const { t } = useLanguage()
  const [data, setData] = useState<Overview | null>(null)
  const [pl, setPl] = useState<PlData | null>(null)
  const [tbStmt, setTbStmt] = useState<TbStmtData | null>(null)
  const [bank, setBank] = useState<BankData | null>(null)
  const [payables, setPayables] = useState<PayablesData | null>(null)
  const [exceptions, setExceptions] = useState<ExceptionsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    // Fail-soft helper for the extra glance-card fetches: a failed
    // endpoint yields null and its cards show "—" / hide — the page
    // itself never breaks because of one of them.
    const soft = async (url: string) => {
      try {
        const res = await fetch(url)
        if (!res.ok) return null
        return await res.json()
      } catch {
        return null
      }
    }
    try {
      const [overviewRes, plJson, tbJson, bankJson, payablesJson, exceptionsJson] = await Promise.all([
        fetch('/api/accounts/overview'),
        soft('/api/accounts/statements?type=pl'),
        soft('/api/accounts/statements?type=trial-balance&scope=fytd'),
        soft('/api/accounts/bank'),
        soft('/api/accounts/payables'),
        soft('/api/accounts/exceptions'),
      ])
      const json = await overviewRes.json()
      if (!overviewRes.ok) throw new Error(json.error || 'Failed to load accounts overview')
      setData(json)
      setPl(plJson)
      setTbStmt(tbJson)
      setBank(bankJson)
      setPayables(payablesJson)
      setExceptions(exceptionsJson)
    } catch (e: any) {
      setError(e?.message || 'Failed to load accounts overview')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const tb = data?.trial_balance
  const unpostedTotal = data ? Object.entries(data.unposted).filter(([k]) => k !== 'chalans_uncosted_flagged').reduce((a, [, v]) => a + v, 0) : 0

  // Period label for Row A: the PL payload's scope label, presented
  // as a plain month name ("October 2026") derived from the payload's
  // meta.default_period (YYYY-MM) when it parses.
  const periodLabel = (() => {
    const raw = pl?.meta?.default_period
    if (raw && /^\d{4}-\d{2}$/.test(raw)) {
      const d = new Date(`${raw}-01T00:00:00`)
      if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    }
    return pl?.scope?.label || '—'
  })()

  const plNet = pl ? Number(pl.statement.net) : 0

  const cashRows = tbStmt
    ? CASH_CODES
        .map((code) => {
          const r = tbStmt.statement.rows.find((row) => row.code === code)
          return r ? { code: r.code, name: r.name, balance: Number(r.debit) - Number(r.credit) } : null
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
    : []
  const cashHeadOffice = cashRows.find((r) => r.code === '1005')

  const payableOpenCount = payables
    ? payables.items.filter((i) => i.direction === 'payable' && (i.status === 'open' || i.status === 'partial')).length
    : 0

  // Attention box: exceptions grouped by code, first-appearance order.
  const attentionGroups: Array<{ code: string; label: string; count: number; amount: number; hasAmount: boolean; link: string }> = []
  if (exceptions) {
    for (const item of exceptions.items) {
      let g = attentionGroups.find((x) => x.code === item.code)
      if (!g) {
        g = {
          code: item.code,
          label: (t.accounts.home.attention as Record<string, string>)[item.code] ?? item.title,
          count: 0,
          amount: 0,
          hasAmount: false,
          link: item.link,
        }
        attentionGroups.push(g)
      }
      g.count += item.count ?? 1
      if (item.amount != null) {
        g.hasAmount = true
        g.amount += Number(item.amount) || 0
      }
    }
  }
  const attentionTotal = exceptions?.counts?.total_active ?? 0

  // Today's top tasks (plan §5): the five most urgent exception
  // items — severity first, then amount — each deep-linking to
  // the exact place that fixes it.
  const SEV_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const topTasks = (exceptions?.items ?? [])
    .slice()
    .sort((a, b) =>
      (SEV_RANK[a.severity] - SEV_RANK[b.severity]) ||
      ((b.amount != null ? Number(b.amount) : -1) - (a.amount != null ? Number(a.amount) : -1)))
    .slice(0, 5)

  const detailLink = (href: string) => (
    <Link href={href} className="mt-3 inline-block text-sm font-semibold text-emerald-700 hover:underline font-bangla">
      {t.accounts.home.detailsLink}
    </Link>
  )

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <PageHead
        icon={<Landmark className="w-6 h-6 text-emerald-600" />}
        title={t.accounts.home.title}
        bangla={t.accounts.home.sub}
        tech={t.accounts.home.tech}
        purpose={t.accounts.home.purpose}
      >
        <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </PageHead>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}
      {loading && !data && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading the books…</div>}

      {data && tb && (
        <>
          {/* Row A — this period's result (PL payload, latest month) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-700">Income — {periodLabel}</div>
              <div className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">{pl ? taka(pl.statement.total_income) : '—'}</div>
              <p className="mt-1 text-sm text-slate-600 font-bangla">{t.accounts.home.incomeSub}</p>
              {detailLink('/admin/accounts/statements/pl')}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-700">Expenses — {periodLabel}</div>
              <div className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">{pl ? taka(pl.statement.total_expenses) : '—'}</div>
              <p className="mt-1 text-sm text-slate-600 font-bangla">{t.accounts.home.expensesSub}</p>
              {detailLink('/admin/accounts/statements/pl')}
            </div>
            <div className={`rounded-2xl border p-5 ${pl ? (plNet >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50') : 'border-slate-200 bg-white'}`}>
              <div className="text-sm font-semibold text-slate-700">Profit / Loss — {periodLabel}</div>
              <div className="mt-2 text-3xl font-bold tabular-nums">
                {pl ? (
                  <>
                    <span className={plNet >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{taka(pl.statement.net)}</span>{' '}
                    <span className={`text-lg font-bangla ${plNet >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{plNet >= 0 ? t.accounts.home.profitWord : t.accounts.home.lossWord}</span>
                  </>
                ) : '—'}
              </div>
              <p className="mt-1 text-sm text-slate-600 font-bangla">{t.accounts.home.profitSub}</p>
              {detailLink('/admin/accounts/statements/pl')}
            </div>
          </div>

          {/* Row B — cash, bank, payables, books verdict */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-700">Cash in hand</div>
              <p className="mt-1 text-sm text-slate-600 font-bangla">{t.accounts.home.cashSub}</p>
              <div className="mt-3 space-y-1.5">
                {!tbStmt && <div className="text-2xl font-bold text-slate-900">—</div>}
                {tbStmt && cashRows.length === 0 && <div className="text-sm text-slate-500">—</div>}
                {cashRows.map((r) => (
                  <div key={r.code} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-slate-700">{r.name}</span>
                    <span className="font-semibold text-slate-900 tabular-nums">{taka(r.balance)}</span>
                  </div>
                ))}
              </div>
              {cashHeadOffice && cashHeadOffice.balance < 0 && (
                <p className="mt-3 text-xs text-amber-700 font-bangla">
                  {t.accounts.home.headOfficeNote}
                </p>
              )}
              {detailLink('/admin/accounts/statements/trial-balance')}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-700">Money in bank</div>
              <p className="mt-1 text-sm text-slate-600 font-bangla">{t.accounts.home.bankSub}</p>
              <div className="mt-3 space-y-2">
                {!bank && <div className="text-2xl font-bold text-slate-900">—</div>}
                {bank && bank.accounts.length === 0 && <div className="text-sm text-slate-500">—</div>}
                {bank?.accounts.map((a, i) => (
                  <div key={`${a.label}-${i}`}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="text-slate-700">{a.label || a.bank_name}</span>
                      <span className="font-semibold text-slate-900 tabular-nums">{taka(a.journal_balance)}</span>
                    </div>
                    {a.is_draft && (
                      <div className="mt-0.5">
                        <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">UNCONFIRMED</span>{' '}
                        <span className="text-xs text-amber-700 font-bangla">{t.accounts.home.bankUnconfirmed}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {detailLink('/admin/accounts/bank')}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-700">To Pay</div>
              <p className="mt-1 text-sm text-slate-600 font-bangla">{t.accounts.home.toPaySub}</p>
              <div className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
                {payables ? taka(payables.ageing.totals.payable.total) : '—'}
              </div>
              {payables && (
                <>
                  <div className="mt-1 text-sm text-slate-600 font-bangla">{fill(t.accounts.home.payablesOutstanding, { count: payableOpenCount })}</div>
                  <div className="mt-1 text-sm text-slate-600 font-bangla">
                    {t.accounts.home.receivableLabel} {taka(payables.ageing.totals.receivable.total)}{' '}
                    <span className="text-slate-500">{t.accounts.home.receivableNote}</span>
                  </div>
                </>
              )}
              {detailLink('/admin/accounts/payables')}
            </div>

            <div className={`rounded-2xl border p-5 ${tb.balanced ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Scale className="w-4 h-4" /> Books Check
              </div>
              {tb.balanced ? (
                <>
                  <div className="mt-2 text-2xl font-bold text-emerald-700 font-bangla">{t.accounts.home.booksBalanced}</div>
                  <p className="mt-1 text-sm text-slate-600 font-bangla">{t.accounts.home.booksBalancedSub}</p>
                  <div className="mt-1 text-xs text-slate-500">
                    Dr {taka(tb.total_debit)} · Cr {taka(tb.total_credit)} · {tb.entries} entries
                  </div>
                </>
              ) : (
                <div className="mt-2 text-2xl font-bold text-rose-700 font-bangla">{t.accounts.home.difference} {taka(tb.difference)}</div>
              )}
              {detailLink('/admin/accounts/statements/trial-balance')}
            </div>
          </div>

          {/* Attention box — exceptions grouped in plain words */}
          {exceptions && (
            attentionTotal === 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 mb-6">
                <h2 className="text-lg font-bold text-emerald-800 font-bangla">{t.accounts.home.pleaseNote}</h2>
                <p className="text-xs text-slate-400 mt-0.5">Needs Attention</p>
                <p className="mt-2 text-sm font-semibold text-emerald-700 font-bangla">{t.accounts.home.allFine}</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 mb-6">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900 font-bangla">{t.accounts.home.pleaseNote}</h2>
                  <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-sm font-bold">{attentionTotal}</span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">Needs Attention</p>
                <div className="mt-3 space-y-1.5">
                  {attentionGroups.map((g) => (
                    <Link key={g.code} href={g.link} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-amber-100">
                      <span className="text-slate-800 font-bangla">{g.label}</span>
                      <span className="text-slate-600">
                        <span className="font-bangla">{fill(t.accounts.home.items, { count: g.count })}</span>
                        {g.hasAmount && <> · <span className="font-semibold tabular-nums">{taka(g.amount)}</span></>}
                      </span>
                    </Link>
                  ))}
                </div>
                <Link href="/admin/accounts/exceptions" className="mt-3 inline-block text-sm font-semibold text-emerald-700 hover:underline font-bangla">
                  {t.accounts.home.viewAll}
                </Link>
              </div>
            )
          )}

          {/* Daily check — the owner's morning questions (§5) */}
          {data.daily_check && (() => {
            const dc = data.daily_check
            const dcDict = t.accounts.home.dailyCheck
            type DcRow = { ok: boolean | null; text: string; detail?: string }
            const rows: DcRow[] = [
              dc.closings_today === 0
                ? { ok: null, text: dcDict.salesNone }
                : {
                    ok: dc.closings_unposted === 0,
                    text: dcDict.salesArrived,
                    detail: dc.closings_unposted === 0
                      ? dcDict.salesPosted
                      : dcDict.salesUnposted.replace('{count}', String(dc.closings_unposted)),
                  },
              dc.closings_today === 0
                ? { ok: null, text: dcDict.cashNone }
                : Number(dc.cash_difference_today) === 0
                  ? { ok: true, text: dcDict.cashMatched }
                  : { ok: false, text: dcDict.cashShortage, detail: taka(dc.cash_difference_today) },
              dc.deposits_pending === 0
                ? { ok: true, text: dcDict.depositsNone }
                : { ok: false, text: dcDict.depositsPending, detail: String(dc.deposits_pending) },
              dc.payroll_pending === 0
                ? { ok: true, text: dcDict.payrollNone }
                : { ok: false, text: dcDict.payrollPending, detail: String(dc.payroll_pending) },
            ]
            return (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
                <h2 className="text-lg font-bold text-slate-900 font-bangla">{t.accounts.home.dailyCheckTitle}</h2>
                <p className="text-xs text-slate-400 mt-0.5">{dc.date} · Asia/Dhaka</p>
                <div className="mt-3 space-y-2">
                  {rows.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-baseline gap-2 text-sm">
                      {r.ok === true
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 translate-y-0.5" />
                        : r.ok === false
                          ? <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 translate-y-0.5" />
                          : <span className="w-4 h-4 shrink-0 text-center text-slate-300">•</span>}
                      <span className="text-slate-800 font-bangla">{r.text}</span>
                      {r.detail && <span className="text-slate-500 text-xs">{r.detail}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Top tasks — the five most urgent fixes (§5) */}
          {exceptions && topTasks.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
              <h2 className="text-lg font-bold text-slate-900 font-bangla">{t.accounts.home.topTasksTitle}</h2>
              <p className="text-xs text-slate-400 mt-0.5 font-bangla">{t.accounts.home.topTasksSub}</p>
              <div className="mt-3 space-y-2">
                {topTasks.map((it, i) => (
                  <div key={`${it.code}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <span className="flex items-baseline gap-2 min-w-0">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold uppercase ${it.severity === 'high' ? 'bg-rose-100 text-rose-800' : it.severity === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{it.severity}</span>
                      <span className="text-sm font-medium text-slate-800 truncate font-bangla">
                        {(t.accounts.home.attention as Record<string, string>)[it.code] ?? it.title}
                      </span>
                      {it.amount != null && <span className="text-sm font-bold text-slate-900 tabular-nums">{taka(Number(it.amount))}</span>}
                    </span>
                    <Link href={it.link} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 font-bangla shrink-0">
                      {t.accounts.exceptionsUi.fixIt} <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Kept detail sections — books coverage + starting figures */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <BookOpen className="w-4 h-4" /> Books coverage
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{data.counts.journal_entries} entries</div>
              <div className="mt-1 text-sm text-slate-600">
                {unpostedTotal === 0
                  ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-4 h-4" /> Every source record is posted</span>
                  : <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="w-4 h-4" /> {unpostedTotal} source record(s) not yet posted</span>}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {data.unposted.chalans_uncosted_flagged ?? 0} uncosted chalan(s) flagged (no cost recorded — nothing posted for them)
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <ListTree className="w-4 h-4" /> Starting Figures
              </div>
              {data.opening_position ? (
                <>
                  <div className="mt-2 text-lg font-bold text-slate-900">
                    {data.opening_position.status === 'draft'
                      ? <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-sm">DRAFT — awaiting owner confirmation</span>
                      : <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-sm">CONFIRMED</span>}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">As of {data.opening_position.as_of}</div>
                  <Link href="/admin/accounts/opening" className="mt-2 inline-block text-sm font-semibold text-emerald-700 hover:underline">
                    View position &amp; flags →
                  </Link>
                </>
              ) : (
                <div className="mt-2 text-sm text-slate-600">No opening position computed yet.</div>
              )}
            </div>
          </div>

          <h2 className="text-lg font-bold text-slate-900 mb-3">Reconciliation — journal vs source modules</h2>
          <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white mb-6">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-3 font-semibold">Class</th>
                  <th className="px-4 py-3 font-semibold text-right">Source total</th>
                  <th className="px-4 py-3 font-semibold text-right">Journal total</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.reconciliation.map((r) => (
                  <tr key={r.cls} className="border-b border-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{r.cls}</div>
                      {r.note && <div className="text-xs text-slate-500 mt-0.5">{r.note}</div>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{taka(r.source)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{taka(r.journal)}</td>
                    <td className="px-4 py-3">
                      {r.match
                        ? <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="w-4 h-4" /> Match</span>
                        : <span className="inline-flex items-center gap-1 text-rose-700 font-semibold"><AlertTriangle className="w-4 h-4" /> Mismatch</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Flag className="w-5 h-5 text-amber-500" /> Standing flags (from the data — never silently fixed)
          </h2>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2">
            {data.flags.length === 0 && <p className="text-sm text-slate-600">No flags.</p>}
            {data.flags.map((f, i) => (
              <p key={`${f.code}-${i}`} className="text-sm text-slate-700">
                <span className="font-mono text-xs font-semibold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">{f.code}</span>{' '}
                {f.text}
                {f.amount != null && <> — <strong>{taka(f.amount)}</strong></>}
                {f.count != null && <> ({f.count})</>}
              </p>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
