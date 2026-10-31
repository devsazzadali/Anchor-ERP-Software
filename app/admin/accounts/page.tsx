'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Landmark, RefreshCw, CheckCircle2, AlertTriangle, Scale, BookOpen, ListTree, Flag } from 'lucide-react'

// Accounts A1 — section home. Data: GET /api/accounts/overview
// (trial-balance health, per-class reconciliation vs the source
// modules, unposted-source counts, opening-position summary and
// the standing data-quality flags). Read-only.

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
}

const taka = (v: string | number) => `৳${Number(v).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function AccountsOverviewPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts/overview')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load accounts overview')
      setData(json)
    } catch (e: any) {
      setError(e?.message || 'Failed to load accounts overview')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const tb = data?.trial_balance
  const unpostedTotal = data ? Object.entries(data.unposted).filter(([k]) => k !== 'chalans_uncosted_flagged').reduce((a, [, v]) => a + v, 0) : 0

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Landmark className="w-6 h-6 text-emerald-600" /> Accounts — Overview
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            The double-entry books, generated automatically from the existing modules — no re-entry.
          </p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}
      {loading && !data && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading the books…</div>}

      {data && tb && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className={`rounded-2xl border p-5 ${tb.balanced ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Scale className="w-4 h-4" /> Trial Balance
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{tb.balanced ? 'Balanced' : 'OUT OF BALANCE'}</div>
              <div className="mt-1 text-sm text-slate-600">
                Dr {taka(tb.total_debit)} · Cr {taka(tb.total_credit)} · Difference {taka(tb.difference)}
              </div>
              <div className="mt-1 text-xs text-slate-500">{tb.entries} journal entries</div>
            </div>
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
                <ListTree className="w-4 h-4" /> Opening position
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
