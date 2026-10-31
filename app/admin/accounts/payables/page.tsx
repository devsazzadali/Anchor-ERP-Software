'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import { Wallet, RefreshCw, CheckCircle2, AlertTriangle, History, HandCoins } from 'lucide-react'

// Accounts A5 — Payables & Ageing. Data: GET /api/accounts/payables
// (register + per-class tie-out against the source tables +
// ageing + paid-via options). The register MIRRORS obligations
// the source modules already record — Sync re-derives it.
// Settlements: company expenses post through the journal
// (Dr Accounts Payable / Cr paid-via) and update the source row;
// every other class keeps its module's own pay path, so Accounts
// records an EXTERNAL settlement with a mandatory note instead —
// never a second money path.

type Item = {
  id: string
  counterparty_id: string | null
  counterparty_name: string | null
  direction: string
  source_table: string
  class_label: string
  journal_backed: boolean
  description: string
  amount: string
  paid_amount: string
  open_amount: string
  due_date: string | null
  status: string
  overdue: boolean
}

type TieOut = {
  key: string
  label: string
  journal_backed: boolean
  items: number
  register_open: string
  source_open: string
  match: boolean
  note: string
}

type Buckets = { current: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string; total: string }

type Settlement = {
  id: string
  amount: string
  paid_via: string | null
  settlement_date: string
  mode: string
  note: string | null
  journal_entry_id: string | null
}

const taka = (v: string | number) => `৳${Number(v).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-amber-100 text-amber-800',
  partial: 'bg-sky-100 text-sky-800',
  settled: 'bg-emerald-100 text-emerald-800',
  overdue: 'bg-rose-100 text-rose-800',
}

export default function PayablesPage() {
  const [items, setItems] = useState<Item[]>([])
  const [tieOut, setTieOut] = useState<TieOut[]>([])
  const [ageing, setAgeing] = useState<{ as_of: string; basis: string; totals: { payable: Buckets; receivable: Buckets }; by_counterparty: any[] } | null>(null)
  const [paidVia, setPaidVia] = useState<Array<{ code: string; label: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [direction, setDirection] = useState<'payable' | 'receivable'>('payable')
  const [settling, setSettling] = useState<Item | null>(null)
  const [form, setForm] = useState({ amount: '', paid_via: '1005', settlement_date: '', note: '' })
  const [history, setHistory] = useState<{ item: Item; rows: Settlement[] } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts/payables')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load the register')
      setItems(json.items)
      setTieOut(json.tie_out)
      setAgeing(json.ageing)
      setPaidVia(json.paid_via)
    } catch (e: any) {
      setError(e?.message || 'Failed to load the register')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/accounts/payables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Action failed')
    return json
  }

  const sync = async () => {
    setError(null)
    setNotice(null)
    try {
      await post({ action: 'sync' })
      setNotice('Register re-derived from the source records.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Sync failed')
    }
  }

  const openHistory = async (item: Item) => {
    setError(null)
    try {
      const res = await fetch(`/api/accounts/payables?settlements_for=${item.id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load settlements')
      setHistory({ item, rows: json.settlements })
    } catch (e: any) {
      setError(e?.message || 'Failed to load settlements')
    }
  }

  const submitSettlement = async () => {
    if (!settling) return
    setError(null)
    setNotice(null)
    try {
      const json = await post({
        action: 'settle',
        item_id: settling.id,
        amount: form.amount,
        paid_via: settling.journal_backed ? form.paid_via : null,
        settlement_date: form.settlement_date || null,
        note: form.note || null,
      })
      setNotice(
        json.mode === 'journal'
          ? `Settlement posted to the journal (entry ${String(json.journal_entry_id).slice(0, 8)}…) and the source record updated.`
          : 'External settlement recorded — no journal entry, by design (the source module owns the pay path).'
      )
      setSettling(null)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Settlement failed')
    }
  }

  const shown = items.filter((i) => i.direction === direction)
  const bucketCols: Array<[keyof Buckets, string]> = [
    ['current', 'Current'],
    ['d1_30', '1–30 days'],
    ['d31_60', '31–60 days'],
    ['d61_90', '61–90 days'],
    ['d90_plus', '90+ days'],
    ['total', 'Total open'],
  ]

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Wallet className="w-6 h-6 text-emerald-600" /> Accounts — Payables &amp; Ageing
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            What the business owes, mirrored from the records that created the obligations — with ageing and
            settlements that can never double-pay.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={sync} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">
            <RefreshCw className="w-4 h-4" /> Sync from records
          </button>
          <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4 text-sm text-emerald-800 flex items-center gap-2 w-full">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {notice}
        </div>
      )}
      {loading && items.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading the register…</div>
      )}

      {/* ── Tie-out ─────────────────────────────────────────── */}
      <h2 className="text-lg font-bold text-slate-900 mb-3">Register tie-out — register vs source records</h2>
      <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white mb-6">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <th className="px-4 py-3 font-semibold">Class</th>
              <th className="px-4 py-3 font-semibold text-right">Items</th>
              <th className="px-4 py-3 font-semibold text-right">Register open</th>
              <th className="px-4 py-3 font-semibold text-right">Source open</th>
              <th className="px-4 py-3 font-semibold">Match</th>
            </tr>
          </thead>
          <tbody>
            {tieOut.map((c) => (
              <tr key={c.key} className="border-b border-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">
                    {c.label}
                    {c.journal_backed && <span className="ml-2 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">journal-backed</span>}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{c.note}</div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{c.items}</td>
                <td className="px-4 py-3 text-right tabular-nums">{taka(c.register_open)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{taka(c.source_open)}</td>
                <td className="px-4 py-3">
                  {c.match
                    ? <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="w-4 h-4" /> Match</span>
                    : <span className="inline-flex items-center gap-1 text-rose-700 font-semibold"><AlertTriangle className="w-4 h-4" /> Mismatch</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Ageing ──────────────────────────────────────────── */}
      <h2 className="text-lg font-bold text-slate-900 mb-3">Ageing {ageing && <span className="text-sm font-medium text-slate-500">— as of {ageing.as_of}</span>}</h2>
      {ageing && <p className="text-xs text-slate-500 mb-3">{ageing.basis}</p>}
      {ageing && (
        <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white mb-6">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3 font-semibold">Counterparty</th>
                {bucketCols.map(([k, label]) => (
                  <th key={k} className="px-4 py-3 font-semibold text-right">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ageing.by_counterparty.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-slate-500">Nothing open — no ageing to report.</td></tr>
              )}
              {ageing.by_counterparty.map((r: any) => (
                <tr key={r.counterparty_id ?? 'none'} className="border-b border-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.counterparty_name}</td>
                  {bucketCols.map(([k]) => (
                    <td key={k} className="px-4 py-3 text-right tabular-nums">
                      {Number((direction === 'payable' ? r.payable : r.receivable)[k]) > 0 ? taka((direction === 'payable' ? r.payable : r.receivable)[k]) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-4 py-3">Total {direction === 'payable' ? 'payables' : 'receivables'}</td>
                {bucketCols.map(([k]) => (
                  <td key={k} className="px-4 py-3 text-right tabular-nums">{taka(ageing.totals[direction][k])}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ── Register ────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-bold text-slate-900">Register</h2>
        <div className="ml-2 inline-flex rounded-lg border border-slate-200 overflow-hidden">
          {(['payable', 'receivable'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className={`px-3 py-1.5 text-sm font-semibold ${direction === d ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {d === 'payable' ? 'Payables' : 'Receivables'}
            </button>
          ))}
        </div>
      </div>

      {direction === 'receivable' && shown.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600 mb-6">
          <strong>No receivables are recorded.</strong> No source module records employee advances, credit
          sales or any other money owed TO the business — so this side of the register is empty by data,
          not by omission. When a source records one, it will appear here through Sync.
        </div>
      )}

      {settling && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
          <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
            <HandCoins className="w-4 h-4" /> Settle — {settling.description}
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Open balance {taka(settling.open_amount)} of {taka(settling.amount)}.
            {settling.journal_backed
              ? ' This posts Dr Accounts Payable / Cr the account below, and updates the source expense in the same step.'
              : ' This class is paid through its own module — Accounts records an EXTERNAL settlement only (no journal entry). A note is mandatory.'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="text-sm">
              <span className="block text-slate-600 mb-1">Amount (৳)</span>
              <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder={settling.open_amount} />
            </label>
            {settling.journal_backed && (
              <label className="text-sm">
                <span className="block text-slate-600 mb-1">Paid from</span>
                <select value={form.paid_via} onChange={(e) => setForm({ ...form, paid_via: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2">
                  {paidVia.map((o) => <option key={o.code} value={o.code}>{o.label} ({o.code})</option>)}
                </select>
              </label>
            )}
            <label className="text-sm">
              <span className="block text-slate-600 mb-1">Date</span>
              <input type="date" value={form.settlement_date} onChange={(e) => setForm({ ...form, settlement_date: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="block text-slate-600 mb-1">Note {settling.journal_backed ? '(optional)' : '(mandatory)'}</span>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder={settling.journal_backed ? '' : 'Who was paid, how, reference'} />
            </label>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={submitSettlement} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">
              Record settlement
            </button>
            <button onClick={() => setSettling(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {history && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
          <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
            <History className="w-4 h-4" /> Settlements — {history.item.description}
          </h3>
          {history.rows.length === 0 && <p className="text-sm text-slate-500">No settlements recorded yet.</p>}
          {history.rows.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold text-right">Amount</th>
                  <th className="px-3 py-2 font-semibold">Mode</th>
                  <th className="px-3 py-2 font-semibold">Paid via</th>
                  <th className="px-3 py-2 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50">
                    <td className="px-3 py-2">{s.settlement_date}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{taka(s.amount)}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">{s.mode}</span>
                      {s.journal_entry_id && <span className="ml-1 text-xs text-slate-400">entry {s.journal_entry_id.slice(0, 8)}…</span>}
                    </td>
                    <td className="px-3 py-2">{s.paid_via || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{s.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button onClick={() => setHistory(null)} className="mt-4 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Close
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
        <table className="w-full text-sm min-w-[920px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <th className="px-4 py-3 font-semibold">Item</th>
              <th className="px-4 py-3 font-semibold">Counterparty</th>
              <th className="px-4 py-3 font-semibold text-right">Amount</th>
              <th className="px-4 py-3 font-semibold text-right">Settled</th>
              <th className="px-4 py-3 font-semibold text-right">Open</th>
              <th className="px-4 py-3 font-semibold">Since</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id} className="border-b border-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{i.description}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {i.class_label}
                    {i.journal_backed && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold">journal-backed</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">{i.counterparty_name || '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{taka(i.amount)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{taka(i.paid_amount)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">{taka(i.open_amount)}</td>
                <td className="px-4 py-3 text-slate-600">{i.due_date || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[i.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {i.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {i.status !== 'settled' && (
                      <button
                        onClick={() => { setSettling(i); setForm({ amount: i.open_amount, paid_via: '1005', settlement_date: '', note: '' }); setHistory(null) }}
                        className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                      >
                        Settle
                      </button>
                    )}
                    <button
                      onClick={() => openHistory(i)}
                      className="px-2.5 py-1 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      History
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && direction === 'payable' && !loading && (
              <tr><td colSpan={8} className="px-4 py-6 text-slate-500">No payables in the register — run Sync to derive them from the source records.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
