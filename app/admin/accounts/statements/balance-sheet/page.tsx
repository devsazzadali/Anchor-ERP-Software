'use client'

export const dynamic = 'force-dynamic'
import React, { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Landmark, RefreshCw, CheckCircle2, AlertTriangle, FileText } from 'lucide-react'
import { ExportButtons, stmtUrl, takaSigned, type StmtMeta } from '../ui'
import { PageHead, PrintHeader, PrintFooter, downloadPdf, taka, bdt } from '../../ui'

// Accounts A2 — Balance sheet as of a date: cumulative journal
// position (assets / liabilities / equity + the accumulated P&L
// result, which is part of equity until a period close moves it).
//
// HONESTY LAW: while the opening position is unconfirmed this
// sheet is PROVISIONAL and says so in a banner. Head Office cash
// (1005) carries a large credit balance — the modules recorded
// money going out of head office but its historical funding was
// never recorded anywhere; that funding is exactly the opening
// position's unconfirmed equity balancing figure. The sheet shows
// the journal's true shape and explains it; it does not hide it.

type BSRow = { code: string; name: string; amount: string }
type BS = {
  assets: BSRow[]
  liabilities: BSRow[]
  equity: BSRow[]
  total_assets: string
  total_liabilities: string
  total_equity: string
  current_result: string
  total_liabilities_equity: string
  balanced: boolean
  entry_count: number
  provisional: boolean
  opening_status: string | null
}

function SectionRows(props: { rows: BSRow[] }) {
  return (
    <>
      {props.rows.map((r) => (
        <tr key={r.code} className="border-b border-slate-50">
          <td className="px-4 py-2.5 font-mono text-xs text-slate-500 w-20">{r.code}</td>
          <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
          <td className="px-4 py-2.5 text-right tabular-nums">{takaSigned(r.amount)}</td>
        </tr>
      ))}
      {props.rows.length === 0 && (
        <tr><td className="px-4 py-3 text-sm text-slate-500" colSpan={3}>No balances.</td></tr>
      )}
    </>
  )
}

function BalanceSheetInner() {
  const search = useSearchParams()
  const [meta, setMeta] = useState<StmtMeta | null>(null)
  const [stmt, setStmt] = useState<BS | null>(null)
  const [asOf, setAsOf] = useState(search.get('asof') || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(stmtUrl('balance-sheet', { asof: asOf || undefined, period: search.get('period') || undefined }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load balance sheet')
      setMeta(json.meta)
      setStmt(json.statement)
      if (!asOf) setAsOf(json.as_of)
    } catch (e: any) {
      setError(e?.message || 'Failed to load balance sheet')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOf])

  useEffect(() => { load() }, [load])

  const periodEnd = (month: string) => meta?.periods.find((p) => p.month === month)?.end

  const handlePdf = () => {
    if (!stmt) return
    void downloadPdf({
      title: 'What We Own & Owe',
      subtitle: 'Balance Sheet',
      dateRange: asOf ? `As of ${asOf}` : undefined,
      columns: ['Type', 'Account', 'Amount (BDT)'],
      rows: [
        ...stmt.assets.map((r) => ['Asset', `${r.code} · ${r.name}`, r.amount] as (string | number)[]),
        ...stmt.liabilities.map((r) => ['Liability', `${r.code} · ${r.name}`, r.amount] as (string | number)[]),
        ...stmt.equity.map((r) => ['Equity', `${r.code} · ${r.name}`, r.amount] as (string | number)[]),
        ['Equity', 'Accumulated result', stmt.current_result] as (string | number)[],
      ],
      summary: [
        { label: 'Total Assets', value: bdt(stmt.total_assets) },
        { label: 'Total Liabilities', value: bdt(stmt.total_liabilities) },
        { label: 'Total Equity', value: bdt(stmt.total_equity) },
        { label: 'Accumulated Result', value: bdt(stmt.current_result) },
        { label: 'Total Liabilities + Equity', value: bdt(stmt.total_liabilities_equity) },
      ],
      filename: 'what-we-own-and-owe.pdf',
    })
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto accounts-print-area">
      <PrintHeader title="What We Own & Owe" subtitle="Balance Sheet" />
      <PageHead
        icon={<Landmark className="w-6 h-6 text-emerald-600" />}
        title="What We Own & Owe"
        bangla="সম্পদ আর দেনার অবস্থা"
        tech="Balance Sheet"
      >
        <div className="flex items-center gap-2 print:hidden">
          <ExportButtons csvHref={stmtUrl('balance-sheet', { asof: asOf || undefined }, 'csv')} />
          <button onClick={handlePdf} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <FileText className="w-4 h-4" /> PDF
          </button>
          <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </PageHead>

      {meta && (
        <div className="flex flex-wrap items-center gap-3 mb-6 print:hidden">
          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            As of
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            Period end
            <select
              value=""
              onChange={(e) => { const end = periodEnd(e.target.value); if (end) setAsOf(end) }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
            >
              <option value="">Choose…</option>
              {meta.periods.map((p) => (
                <option key={p.month} value={p.month}>{p.month} · ends {p.end}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}
      {loading && !stmt && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading balance sheet…</div>}

      {stmt && (
        <>
          {stmt.provisional && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 mb-6">
              <div className="flex items-center gap-2 text-base font-bold text-amber-900">
                <AlertTriangle className="w-5 h-5" /> PROVISIONAL — opening position not yet confirmed
              </div>
              <p className="mt-2 text-sm text-slate-700">
                This sheet is built only from journal activity since {meta?.journal_coverage.first_entry ?? 'the journal start'}.
                The historical funding of Head Office (owner capital put in over earlier years) exists in no source
                module, so accounts settled centrally — above all Cash — Head Office (1005) — carry credit balances
                here. That funding is represented by the opening position&apos;s equity balancing figure
                {meta?.opening?.equity_draft ? <> of <strong>{taka(meta.opening.equity_draft)}</strong></> : ''},
                which the owner has not yet confirmed. Until it is confirmed and posted, read this sheet as the
                journal&apos;s true shape with its funding leg outstanding — not as the company&apos;s full
                historical balance sheet.
              </p>
            </div>
          )}

          <div className={`rounded-2xl border p-5 mb-6 ${stmt.balanced ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-lg font-bold text-slate-900 inline-flex items-center gap-2">
                {stmt.balanced
                  ? <><CheckCircle2 className="w-5 h-5 text-emerald-600" /> Assets = Liabilities + Equity</>
                  : <><AlertTriangle className="w-5 h-5 text-rose-600" /> DOES NOT BALANCE</>}
              </div>
              <div className="text-sm text-slate-600">
                As of {asOf} · {stmt.entry_count} entries · Assets {takaSigned(stmt.total_assets)} · Liabilities + Equity {takaSigned(stmt.total_liabilities_equity)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-2">Assets</h3>
              <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
                <table className="w-full text-sm">
                  <tbody>
                    <SectionRows rows={stmt.assets} />
                    <tr className="border-t-2 border-slate-200 font-bold text-slate-900">
                      <td className="px-4 py-3" colSpan={2}>Total assets</td>
                      <td className="px-4 py-3 text-right tabular-nums">{takaSigned(stmt.total_assets)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                A negative asset line is a credit balance on that account, shown as recorded — see the provisional note above.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-2">Liabilities &amp; Equity</h3>
              <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
                <table className="w-full text-sm">
                  <tbody>
                    {stmt.liabilities.map((r) => (
                      <tr key={r.code} className="border-b border-slate-50">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500 w-20">{r.code}</td>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{takaSigned(r.amount)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-100 font-semibold text-slate-800">
                      <td className="px-4 py-2.5" colSpan={2}>Total liabilities</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{takaSigned(stmt.total_liabilities)}</td>
                    </tr>
                    {stmt.equity.map((r) => (
                      <tr key={r.code} className="border-b border-slate-50">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500 w-20">{r.code}</td>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{takaSigned(r.amount)}</td>
                      </tr>
                    ))}
                    <tr className="border-b border-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500 w-20">—</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">Accumulated result (income − expenses to date)</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{takaSigned(stmt.current_result)}</td>
                    </tr>
                    <tr className="border-t-2 border-slate-200 font-bold text-slate-900">
                      <td className="px-4 py-3" colSpan={2}>Total liabilities + equity</td>
                      <td className="px-4 py-3 text-right tabular-nums">{takaSigned(stmt.total_liabilities_equity)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                The accumulated result sits inside equity until a period close (stage A3) moves it to retained earnings.
              </p>
            </div>
          </div>
        </>
      )}
      <PrintFooter />
    </div>
  )
}

export default function BalanceSheetPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading balance sheet…</div>}>
      <BalanceSheetInner />
    </Suspense>
  )
}
