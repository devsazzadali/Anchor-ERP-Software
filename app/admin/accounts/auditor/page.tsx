'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { PackageCheck, RefreshCw, AlertTriangle, Download, FileJson, Info } from 'lucide-react'

// Accounts A10 — Auditor Package. Pick a scope (full history, a
// fiscal year, or one period) and download ONE bundle: README +
// bundle.json + a CSV per section (chart, trial balance, journal,
// P&L, balance sheet, tax, cheques, payables + ageing, bank +
// reconciliation, exceptions + inbox, opening position).
// Data: GET /api/accounts/auditor?format=meta for the picker;
// the downloads hit the same route with format=zip|json. Every
// figure in the bundle is produced by the same services behind
// the Accounts screens, so the package cannot disagree with them.

type Meta = {
  periods: Array<{ month: string; fy_label: string; status: string; start: string; end: string }>
  fiscal_years: Array<{ label: string; start: string; end: string; status: string }>
  default_period: string
  journal_coverage: { first_entry: string | null; last_entry: string | null; entries: number }
  opening: { status: string; as_of: string } | null
}

const CONTENTS: Array<[string, string]> = [
  ['bundle.json', 'The complete package as one structured JSON document'],
  ['chart_of_accounts.csv', 'Chart of accounts with full-journal balances'],
  ['trial_balance.csv', 'Trial balance for the chosen scope'],
  ['journal.csv', 'Every posted journal entry and line in the scope'],
  ['profit_and_loss.csv', 'Profit & loss for the scope (by-branch detail in bundle.json)'],
  ['balance_sheet.csv', 'Balance sheet as of the scope end'],
  ['tax_settings.csv · tax_register.csv', 'VAT/TDS configuration and register'],
  ['cheque_register.csv', 'Cheque register (current state)'],
  ['payables_register.csv · payables_ageing.csv', 'Payables/receivables register, tie-out and ageing'],
  ['bank_accounts.csv · bank_reconciliation.csv', 'Bank accounts and reconciliation status'],
  ['posting_exceptions.csv · inbox_snapshot.csv', 'Blocked postings and the exceptions inbox snapshot'],
  ['opening_position.csv', 'The opening position — with its confirmation status on its face'],
]

export default function AuditorPackagePage() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<'full' | 'fiscal_year' | 'period'>('full')
  const [period, setPeriod] = useState('')
  const [fy, setFy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts/auditor?format=meta')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load the auditor package')
      setMeta(json)
      setPeriod((cur) => cur || json.default_period || '')
      setFy((cur) => cur || json.fiscal_years?.[json.fiscal_years.length - 1]?.label || '')
    } catch (e: any) {
      setError(e?.message || 'Failed to load the auditor package')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const query = useMemo(() => {
    const q = new URLSearchParams({ scope })
    if (scope === 'period' && period) q.set('period', period)
    if (scope === 'fiscal_year' && fy) q.set('fy', fy)
    return q.toString()
  }, [scope, period, fy])

  const scopeReady = scope === 'full' || (scope === 'period' && !!period) || (scope === 'fiscal_year' && !!fy)
  const openingDraft = meta?.opening && meta.opening.status !== 'confirmed'

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <PackageCheck className="w-6 h-6 text-emerald-600" /> Auditor Package
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-3xl">
            One download for the external auditor or CA: statements, the full journal and every
            register, produced by the same services behind these screens — the figures cannot
            disagree with what you see in Accounts.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      )}

      {openingDraft && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <span className="font-semibold">The opening position is still a DRAFT</span> (status:{' '}
            {meta?.opening?.status}, as of {meta?.opening?.as_of}). The package exports it with that
            status on its face — its equity figure is a computed balancing figure,{' '}
            <span className="font-semibold">not</span> a confirmed opening balance — and the balance
            sheet inside the package is marked PROVISIONAL for the same reason.
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Journal coverage</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">
            {meta ? `${meta.journal_coverage.entries} entries` : '—'}
          </div>
          <div className="text-sm text-slate-500 mt-1">
            {meta?.journal_coverage.first_entry ?? '—'} → {meta?.journal_coverage.last_entry ?? '—'}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Statements & journal</div>
          <div className="mt-2 text-sm text-slate-600">
            Scoped by your choice below — a period, a fiscal year (to date through its last period),
            or the full history.
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Registers</div>
          <div className="mt-2 text-sm text-slate-600">
            Current-state snapshots at generation time — the same figures their screens show. The
            bundle states this basis on its README and in bundle.json.
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-bold text-slate-900">Choose the scope</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              ['full', 'Full history'],
              ['fiscal_year', 'Fiscal year'],
              ['period', 'One period'],
            ] as Array<['full' | 'fiscal_year' | 'period', string]>
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setScope(k)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                scope === k
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {scope === 'period' && (
          <div className="mt-4">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Period</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="mt-1 block w-full max-w-xs rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              {(meta?.periods ?? []).map((p) => (
                <option key={p.month} value={p.month}>
                  {p.month} · {p.fy_label} · {p.status}
                </option>
              ))}
            </select>
          </div>
        )}
        {scope === 'fiscal_year' && (
          <div className="mt-4">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Fiscal year</label>
            <select
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              className="mt-1 block w-full max-w-xs rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              {(meta?.fiscal_years ?? []).map((y) => (
                <option key={y.label} value={y.label}>
                  {y.label} · {y.start} → {y.end} · {y.status}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={scopeReady ? `/api/accounts/auditor?${query}&format=zip` : undefined}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold ${
              scopeReady ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-100 text-slate-400 pointer-events-none'
            }`}
          >
            <Download className="w-4 h-4" /> Download package (ZIP)
          </a>
          <a
            href={scopeReady ? `/api/accounts/auditor?${query}&format=json` : undefined}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border ${
              scopeReady ? 'border-slate-200 text-slate-700 hover:bg-slate-50' : 'border-slate-100 text-slate-400 pointer-events-none'
            }`}
          >
            <FileJson className="w-4 h-4" /> Download bundle.json only
          </a>
        </div>
        <p className="mt-3 text-xs text-slate-400 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" /> Generating a package is read-only — nothing is posted or
          changed. Verified database backups are produced separately (see the A10 backup manifest).
        </p>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-bold text-slate-900">What&rsquo;s inside</h2>
        <div className="mt-3 divide-y divide-slate-100">
          {CONTENTS.map(([name, desc]) => (
            <div key={name} className="py-2.5 flex flex-wrap gap-x-4 gap-y-0.5">
              <span className="font-mono text-xs font-semibold text-slate-700 min-w-64">{name}</span>
              <span className="text-sm text-slate-500">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
