'use client'

export const dynamic = 'force-dynamic'
import React, { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Scale, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react'
import { ExportButtons, PeriodScopeBar, stmtUrl, taka, takaSigned, type StmtMeta } from '../ui'

// Accounts A2 — Trial balance for a period, or fiscal-year-to-date.
// Data: GET /api/accounts/statements?type=trial-balance. Same
// presentation semantics as the A1 trial balance (all accounts,
// posted entries only), date-scoped.

type TBRow = { code: string; name: string; type: string; debit: string; credit: string; balance: string }
type TB = {
  rows: TBRow[]
  total_debit: string
  total_credit: string
  difference: string
  balanced: boolean
  entry_count: number
}

function TrialBalanceInner() {
  const search = useSearchParams()
  const [meta, setMeta] = useState<StmtMeta | null>(null)
  const [stmt, setStmt] = useState<TB | null>(null)
  const [period, setPeriod] = useState(search.get('period') || '')
  const [scope, setScope] = useState<'period' | 'fytd'>((search.get('scope') as any) === 'period' ? 'period' : 'fytd')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(stmtUrl('trial-balance', { period: period || undefined, scope }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load trial balance')
      setMeta(json.meta)
      setStmt(json.statement)
      if (!period) setPeriod(json.meta.default_period)
    } catch (e: any) {
      setError(e?.message || 'Failed to load trial balance')
    } finally {
      setLoading(false)
    }
  }, [period, scope])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Scale className="w-6 h-6 text-emerald-600" /> Trial Balance
          </h1>
          <p className="text-sm text-slate-500 mt-1">All accounts, posted journal entries only.</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <ExportButtons csvHref={stmtUrl('trial-balance', { period: period || undefined, scope }, 'csv')} />
          <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {meta && (
        <div className="mb-6 print:hidden">
          <PeriodScopeBar periods={meta.periods} period={period} onPeriod={setPeriod} scope={scope} onScope={setScope} />
        </div>
      )}

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}
      {loading && !stmt && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading trial balance…</div>}

      {stmt && (
        <>
          <div className={`rounded-2xl border p-5 mb-6 ${stmt.balanced ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-lg font-bold text-slate-900 inline-flex items-center gap-2">
                {stmt.balanced
                  ? <><CheckCircle2 className="w-5 h-5 text-emerald-600" /> Balanced</>
                  : <><AlertTriangle className="w-5 h-5 text-rose-600" /> OUT OF BALANCE</>}
              </div>
              <div className="text-sm text-slate-600">
                Dr {taka(stmt.total_debit)} · Cr {taka(stmt.total_credit)} · Difference {taka(stmt.difference)} · {stmt.entry_count} entries in scope
              </div>
            </div>
          </div>

          {stmt.entry_count === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
              No journal entries in this scope — nothing to balance yet.
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    <th className="px-4 py-3 font-semibold">Code</th>
                    <th className="px-4 py-3 font-semibold">Account</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold text-right">Debit</th>
                    <th className="px-4 py-3 font-semibold text-right">Credit</th>
                    <th className="px-4 py-3 font-semibold text-right">Balance (Dr +)</th>
                  </tr>
                </thead>
                <tbody>
                  {stmt.rows.map((r) => (
                    <tr key={r.code} className="border-b border-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.code}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
                      <td className="px-4 py-2.5 text-slate-500 capitalize">{r.type}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{Number(r.debit) ? taka(r.debit) : '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{Number(r.credit) ? taka(r.credit) : '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{takaSigned(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 font-bold text-slate-900">
                    <td className="px-4 py-3" colSpan={3}>Total</td>
                    <td className="px-4 py-3 text-right tabular-nums">{taka(stmt.total_debit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{taka(stmt.total_credit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{takaSigned(stmt.difference)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function TrialBalancePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading trial balance…</div>}>
      <TrialBalanceInner />
    </Suspense>
  )
}
