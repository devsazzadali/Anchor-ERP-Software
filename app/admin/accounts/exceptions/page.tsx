'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Inbox, RefreshCw, AlertTriangle, CheckCircle2, ArrowRight, HandMetal, Flag } from 'lucide-react'

// Accounts A9 — Exceptions Inbox. Data: GET /api/accounts/exceptions
// (stored posting exceptions with the open → acknowledged →
// resolved workflow + derived signals computed live from the
// owning modules). Derived items carry no actions by design: they
// clear themselves when the source record is fixed, so each one
// shows a "fix at source" deep link instead of a resolve button.

type InboxItem = {
  key: string
  kind: 'stored' | 'derived'
  code: string
  severity: 'high' | 'medium' | 'low'
  title: string
  text: string
  amount: string | null
  count: number | null
  source_table: string | null
  source_id: string | null
  since: string | null
  age_days: number | null
  link: string
  link_label: string
  status: string | null
  can_act: boolean
  acknowledged_at: string | null
  detail: any
}
type Counts = { stored_open: number; stored_acknowledged: number; stored_resolved: number; derived: number; total_active: number }

const taka = (v: string | number) => `৳${Number(v).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const SEV_STYLE: Record<string, string> = {
  high: 'bg-rose-100 text-rose-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-slate-100 text-slate-600',
}
const SEV_BORDER: Record<string, string> = {
  high: 'border-rose-200',
  medium: 'border-amber-200',
  low: 'border-slate-200',
}

export default function ExceptionsInboxPage() {
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<'all' | 'stored' | 'derived'>('all')
  const [sevFilter, setSevFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')
  const [resolveOpenFor, setResolveOpenFor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts/exceptions')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load the exceptions inbox')
      setItems(json.items)
      setCounts(json.counts)
    } catch (e: any) {
      setError(e?.message || 'Failed to load the exceptions inbox')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const act = useCallback(async (it: InboxItem, action: 'acknowledge' | 'resolve') => {
    const exceptionId = it.detail?.exception_id
    if (!exceptionId) return
    setBusy(it.key)
    setActionError(null)
    try {
      const res = await fetch('/api/accounts/exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'resolve' ? { action, id: exceptionId, note } : { action, id: exceptionId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `${action} failed`)
      setResolveOpenFor(null)
      setNote('')
      await load()
    } catch (e: any) {
      setActionError(e?.message || `${action} failed`)
    } finally {
      setBusy(null)
    }
  }, [load, note])

  const visible = (items ?? []).filter(
    (it) => (kindFilter === 'all' || it.kind === kindFilter) && (sevFilter === 'all' || it.severity === sevFilter)
  )
  const highActive = (items ?? []).filter((it) => it.severity === 'high').length

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Inbox className="w-6 h-6 text-emerald-600" /> Accounts — Exceptions Inbox
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Every problem the books know about, in one list. Blocked postings are worked here;
            data signals clear themselves when the source record is fixed.
          </p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}
      {actionError && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{actionError}</div>}
      {loading && !items && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading the inbox…</div>}

      {counts && items && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
              <div className="text-sm font-semibold text-slate-700">Blocked postings — open</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{counts.stored_open}</div>
              <div className="mt-1 text-xs text-slate-500">Refused by a closed/locked period, waiting for action</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <div className="text-sm font-semibold text-slate-700">Acknowledged</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{counts.stored_acknowledged}</div>
              <div className="mt-1 text-xs text-slate-500">An admin has taken ownership; resolution still owed</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-700">Data signals (derived)</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{counts.derived}</div>
              <div className="mt-1 text-xs text-slate-500">Computed live from the source modules — fix at source</div>
            </div>
            <div className={`rounded-2xl border p-5 ${highActive > 0 ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
              <div className="text-sm font-semibold text-slate-700">High severity</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{highActive}</div>
              <div className="mt-1 text-xs text-slate-500">{counts.stored_resolved} blocked posting(s) resolved so far</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 mr-1">Show</span>
            {(['all', 'stored', 'derived'] as const).map((k) => (
              <button key={k} onClick={() => setKindFilter(k)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${kindFilter === k ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {k === 'all' ? 'All' : k === 'stored' ? 'Blocked postings' : 'Data signals'}
              </button>
            ))}
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 ml-3 mr-1">Severity</span>
            {(['all', 'high', 'medium', 'low'] as const).map((s) => (
              <button key={s} onClick={() => setSevFilter(s)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${sevFilter === s ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {visible.length === 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" /> Nothing here — no item matches this view.
            </div>
          )}

          <div className="space-y-3">
            {visible.map((it) => (
              <div key={it.key} className={`rounded-2xl border ${SEV_BORDER[it.severity]} bg-white p-4`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold uppercase ${SEV_STYLE[it.severity]}`}>{it.severity}</span>
                      <span className="font-mono text-[11px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{it.code}</span>
                      {it.kind === 'stored'
                        ? <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${it.status === 'acknowledged' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}>{it.status}</span>
                        : <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-500">derived — fix at source</span>}
                      {it.amount != null && <span className="text-sm font-bold text-slate-900">{taka(it.amount)}</span>}
                      {it.count != null && <span className="text-sm text-slate-600">× {it.count}</span>}
                      {it.age_days != null && <span className="text-xs text-slate-400">{it.age_days} day(s) old{it.since ? ` · since ${it.since}` : ''}</span>}
                    </div>
                    <div className="font-semibold text-slate-900">{it.title}</div>
                    <p className="text-sm text-slate-600 mt-0.5">{it.text}</p>
                    {it.kind === 'stored' && it.status === 'acknowledged' && it.acknowledged_at && (
                      <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                        <HandMetal className="w-3.5 h-3.5" /> Acknowledged {new Date(it.acknowledged_at).toLocaleString('en-GB')} — resolution still owed.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Link href={it.link} className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
                      {it.link_label} <ArrowRight className="w-4 h-4" />
                    </Link>
                    {it.can_act && (
                      <>
                        {it.status === 'open' && (
                          <button onClick={() => act(it, 'acknowledge')} disabled={busy === it.key} className="px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                            Acknowledge
                          </button>
                        )}
                        {resolveOpenFor !== it.key ? (
                          <button onClick={() => { setResolveOpenFor(it.key); setNote(''); setActionError(null) }} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700">
                            Resolve…
                          </button>
                        ) : (
                          <div className="w-72 rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                              <Flag className="w-3.5 h-3.5" /> How was this dealt with? (required)
                            </label>
                            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" placeholder="e.g. Period reopened (break-glass) and the posting re-fired; entry now posted." />
                            <div className="mt-2 flex gap-2">
                              <button onClick={() => act(it, 'resolve')} disabled={busy === it.key || !note.trim()} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">
                                Resolve
                              </button>
                              <button onClick={() => setResolveOpenFor(null)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-white">
                                Cancel
                              </button>
                            </div>
                            <p className="mt-2 text-[11px] text-slate-400">Resolving records your note and closes the item — it posts nothing and deletes nothing.</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-6 text-xs text-slate-400 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Data signals are computed from the source modules on every load — when the underlying record is fixed, the signal disappears on its own. Nothing on this page silently changes the books.
          </p>
        </>
      )}
    </div>
  )
}
