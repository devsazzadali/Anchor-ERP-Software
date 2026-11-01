'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import { BookOpen, RefreshCw, Search, ChevronDown, ChevronRight, Undo2 } from 'lucide-react'
import { PageHead } from '../ui'

// Accounts A1 — journal viewer (READ-ONLY). The journal is
// append-only by law: corrections are reversal entries, never
// edits, so this page offers filters and inspection only.
// Data: GET /api/accounts/journal + GET /api/accounts/chart
// (for the account filter).

type Line = { account_code: string; account_name: string; branch: string | null; debit: string; credit: string; memo: string | null }
type Entry = {
  id: string; entry_date: string; event_type: string; source_table: string; source_id: string
  memo: string | null; is_reversal: boolean; reverses_entry_id: string | null; total: string; lines: Line[]
}

const SOURCES = [
  '', 'branch_cash_ledger', 'branch_cash_expenses', 'company_expenses', 'salary_payments',
  'employee_expense_requests', 'branch_bank_deposits', 'product_chalans', 'payment_requests', 'branch_bundle_requests',
]
const taka = (v: string | number) => `৳${Number(v).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function JournalPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(25)
  const [accounts, setAccounts] = useState<Array<{ id: string; code: string; name: string }>>([])
  const [filters, setFilters] = useState({ from: '', to: '', account_id: '', source_table: '', q: '' })
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      if (filters.account_id) params.set('account_id', filters.account_id)
      if (filters.source_table) params.set('source_table', filters.source_table)
      if (filters.q) params.set('q', filters.q)
      const res = await fetch(`/api/accounts/journal?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load journal')
      setEntries(json.entries ?? [])
      setTotal(json.total ?? 0)
    } catch (e: any) {
      setError(e?.message || 'Failed to load journal')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filters])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/accounts/chart')
      .then((r) => r.json())
      .then((j) => setAccounts((j.accounts ?? []).map((a: any) => ({ id: a.id, code: a.code, name: a.name }))))
      .catch(() => {})
  }, [])

  const pages = Math.max(1, Math.ceil(total / pageSize))
  const inputCls = 'rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <PageHead icon={<BookOpen className="w-6 h-6 text-emerald-600" />} title="All Entries" bangla="প্রতিটা লেনদেনের রেকর্ড" tech="Journal — append-only">
        <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </PageHead>
      <p className="text-sm text-slate-500 -mt-4 mb-6">
        {loading ? 'Loading…' : `${total} posted entries — append-only: corrections appear as reversal entries, history is never rewritten.`}
      </p>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-slate-500">From
          <input type="date" className={inputCls} value={filters.from} onChange={(e) => { setPage(1); setFilters({ ...filters, from: e.target.value }) }} />
        </label>
        <label className="text-xs font-semibold text-slate-500">To
          <input type="date" className={inputCls} value={filters.to} onChange={(e) => { setPage(1); setFilters({ ...filters, to: e.target.value }) }} />
        </label>
        <label className="text-xs font-semibold text-slate-500">Account
          <select className={inputCls} value={filters.account_id} onChange={(e) => { setPage(1); setFilters({ ...filters, account_id: e.target.value }) }}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-500">Source module
          <select className={inputCls} value={filters.source_table} onChange={(e) => { setPage(1); setFilters({ ...filters, source_table: e.target.value }) }}>
            {SOURCES.map((s) => <option key={s} value={s}>{s === '' ? 'All sources' : s}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-500 flex-1 min-w-[180px]">Search memo
          <span className="relative block">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400" />
            <input className={`${inputCls} w-full pl-8`} value={filters.q} onChange={(e) => { setPage(1); setFilters({ ...filters, q: e.target.value }) }} placeholder="e.g. Rangpur" />
          </span>
        </label>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}

      <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <th className="px-4 py-3 font-semibold w-8"></th>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Event</th>
              <th className="px-4 py-3 font-semibold">Source</th>
              <th className="px-4 py-3 font-semibold">Memo</th>
              <th className="px-4 py-3 font-semibold text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <React.Fragment key={e.id}>
                <tr className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer" onClick={() => setOpen({ ...open, [e.id]: !open[e.id] })}>
                  <td className="px-4 py-3 text-slate-400">{open[e.id] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{e.entry_date}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs">{e.event_type}</span>
                    {e.is_reversal && <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800"><Undo2 className="w-3 h-3" /> REVERSAL</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{e.source_table}</td>
                  <td className="px-4 py-3 text-slate-700">{e.memo ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{taka(e.total)}</td>
                </tr>
                {open[e.id] && (
                  <tr className="bg-slate-50/60">
                    <td></td>
                    <td colSpan={5} className="px-4 py-3">
                      <table className="w-full text-xs">
                        <tbody>
                          {e.lines.map((l, i) => (
                            <tr key={i} className="border-b border-slate-100 last:border-0">
                              <td className="py-1.5 pr-3 font-mono">{l.account_code}</td>
                              <td className="py-1.5 pr-3">{l.account_name}{l.branch ? <span className="text-slate-400"> · {l.branch}</span> : null}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums w-32">{Number(l.debit) ? `Dr ${taka(l.debit)}` : ''}</td>
                              <td className="py-1.5 text-right tabular-nums w-32">{Number(l.credit) ? `Cr ${taka(l.credit)}` : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!loading && entries.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No journal entries match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
        <span>Page {page} of {pages}</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold disabled:opacity-40">Previous</button>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  )
}
