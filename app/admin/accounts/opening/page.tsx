'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import { ListTree, RefreshCw, Calculator, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { PageHead } from '../ui'

// Accounts A1 — Opening Position. The position is COMPUTED from
// the existing records (counted branch cash from the latest closed
// ledger rows, bank balances as deposit-history-derived DRAFT
// candidates, payables itemised from recorded dues, equity as the
// explicit balancing figure) and stored as a DRAFT. Only the
// owner confirms it (POST /api/accounts/opening {action:'confirm'})
// after entering/confiming the real bank balances — A1 never
// self-confirms. Recompute stores a NEW draft from current data.

type PositionLine = {
  component: string; label: string; amount: string; side: string
  source_note: string | null; detail: any
}
type Position = {
  id: string; label: string; status: string; origin: string; as_of: string; computed_at: string
  confirmed_by: string | null; confirmed_at: string | null; notes: string | null
  lines: PositionLine[]
}

const taka = (v: string | number) => `৳${Number(v).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function OpeningPositionPage() {
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmArmed, setConfirmArmed] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts/opening')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load opening positions')
      setPositions(json.positions ?? [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load opening positions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const recompute = async () => {
    setBusy('recompute')
    setError(null)
    try {
      const res = await fetch('/api/accounts/opening', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recompute' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Recompute failed')
      setNotice('A new DRAFT opening position was computed from the current records.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Recompute failed')
    } finally {
      setBusy(null)
    }
  }

  const confirm = async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch('/api/accounts/opening', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Confirmation failed')
      setNotice(
        json.mode === 'acknowledgement'
          ? 'Opening position confirmed as an acknowledgement — no journal entry was posted, because these figures are already in the journal from the backfill.'
          : json.opening_entry
            ? `Opening position confirmed — opening journal entry posted (${json.opening_entry.entry_id.slice(0, 8)}…).`
            : 'Opening position confirmed.'
      )
      setConfirmArmed(null)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Confirmation failed')
    } finally {
      setBusy(null)
    }
  }

  const latest = positions[0]

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <PageHead icon={<ListTree className="w-6 h-6 text-emerald-600" />} title="Starting Figures" bangla="হিসাব শুরুর সময়ের অবস্থা" tech="Opening Position">
        <div className="flex gap-2">
          <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={recompute} disabled={busy === 'recompute'} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
            <Calculator className="w-4 h-4" /> Recompute draft
          </button>
        </div>
      </PageHead>
      <p className="text-sm text-slate-500 -mt-4 mb-6">
        Computed from the existing records — nothing re-entered, nothing invented. Bank balances stay DRAFT candidates until the owner confirms them against the real statements.
      </p>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4 text-sm text-emerald-700 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> {notice}</div>}
      {loading && positions.length === 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading…</div>}

      {positions.map((p) => (
        <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <div className="font-bold text-slate-900">{p.label}</div>
              <div className="text-xs text-slate-500">As of {p.as_of} · computed {new Date(p.computed_at).toLocaleString()}</div>
            </div>
            {p.status === 'draft' ? (
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">DRAFT — NOT CONFIRMED</span>
            ) : (
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> CONFIRMED {p.confirmed_at ? `· ${new Date(p.confirmed_at).toLocaleDateString()}` : ''}
              </span>
            )}
          </div>

          {p.status === 'confirmed' && p.origin === 'backfill' && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4 text-sm text-emerald-800">
              Confirmed as an <strong>acknowledgement</strong> — no opening journal entry was posted for this
              position, because its figures were already in the journal from the backfill of the existing records.
            </div>
          )}

          <div className="rounded-xl border border-slate-100 overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2.5 font-semibold">Component</th>
                  <th className="px-4 py-2.5 font-semibold">Detail</th>
                  <th className="px-4 py-2.5 font-semibold">Derivation</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs">{l.component}</td>
                    <td className="px-4 py-2.5">{l.label}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{l.source_note ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {taka(l.amount)} <span className="text-slate-400 text-xs">{l.side === 'debit' ? 'Dr' : 'Cr'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {p.notes && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-2">Flags carried with this position</div>
              {p.notes.split('\n').map((line, i) => (
                <p key={i} className="text-sm text-slate-700">{line}</p>
              ))}
            </div>
          )}

          {p.status === 'draft' && p.id === latest?.id && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              {p.origin === 'backfill' ? (
                <p className="text-sm text-slate-700 mb-3">
                  <strong>Owner action — acknowledgement only:</strong> this position summarises history that is
                  ALREADY posted in the journal (the full backfill of the existing records). Confirming it records
                  that you have checked these figures and marks the position confirmed — it posts{' '}
                  <strong>NO journal entry</strong>, so nothing is counted twice. Confirm only after checking the
                  bank candidates against the real bank statements and the branch cash against the physical
                  drawers. The confirmation is recorded in the audit log. Incomplete history (uncosted chalans,
                  the SOTIBARI deposit drift) stays flagged — it is NOT absorbed into these figures.
                </p>
              ) : (
                <p className="text-sm text-slate-700 mb-3">
                  <strong>Owner action:</strong> confirm this position only after checking the bank candidates against the real
                  bank statements and the branch cash against the physical drawers. Confirming posts the opening journal entry
                  (P12, dated the cutover — the 1st of the month after this position's as-of month) and is recorded in the audit log.
                  Incomplete history (uncosted chalans, the SOTIBARI deposit drift) stays flagged — it is NOT absorbed into these figures.
                </p>
              )}
              {confirmArmed === p.id ? (
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy === p.id} onClick={() => confirm(p.id)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                    {p.origin === 'backfill'
                      ? 'Yes — confirm as acknowledgement (no journal entry)'
                      : 'Yes — confirm this opening position'}
                  </button>
                  <button onClick={() => setConfirmArmed(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmArmed(p.id)} className="px-4 py-2 rounded-lg border border-emerald-600 text-emerald-700 text-sm font-semibold hover:bg-emerald-50">
                  Confirm opening position…
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      {!loading && positions.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
          No opening position yet — use “Recompute draft” to compute one from the existing records.
        </div>
      )}
    </div>
  )
}
