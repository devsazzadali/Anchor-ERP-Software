'use client'

export const dynamic = 'force-dynamic'
import React, { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { TrendingUp, RefreshCw, AlertTriangle, Info, FileText } from 'lucide-react'
import { ExportButtons, PeriodScopeBar, stmtUrl, takaSigned, type StmtMeta } from '../ui'
import { PageHead, PrintHeader, PrintFooter, downloadPdf, taka, bdt } from '../../ui'

// Accounts A2 — Profit & Loss from the journal: company view or a
// single branch (branch is a dimension on journal lines). The
// footnotes are part of the statement — the journal's coverage and
// the COGS limit are stated, never smoothed over.

type PlRowT = { code: string; name: string; amount: string }
type PL = {
  income: PlRowT[]
  expenses: PlRowT[]
  total_income: string
  total_expenses: string
  net: string
  entry_count: number
  branch_id: string | null
  by_branch: Array<{ branch_id: string; branch_name: string; income: string; expenses: string; net: string }> | null
  notes: {
    journal_from: string | null
    journal_to: string | null
    opening_status: string | null
    opening_equity_draft: string | null
    uncosted_chalans: number
    uncosted_chalan_sale: string
    total_chalans: number
  }
}

function Section(props: { title: string; rows: PlRowT[]; totalLabel: string; total: string }) {
  return (
    <>
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mt-6 mb-2">{props.title}</h3>
      <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
        <table className="w-full text-sm min-w-[560px]">
          <tbody>
            {props.rows.map((r) => (
              <tr key={r.code} className="border-b border-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-500 w-20">{r.code}</td>
                <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{taka(r.amount)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 font-bold text-slate-900">
              <td className="px-4 py-3" colSpan={2}>{props.totalLabel}</td>
              <td className="px-4 py-3 text-right tabular-nums">{taka(props.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

function ProfitLossInner() {
  const search = useSearchParams()
  const [meta, setMeta] = useState<StmtMeta | null>(null)
  const [stmt, setStmt] = useState<PL | null>(null)
  const [period, setPeriod] = useState(search.get('period') || '')
  const [scope, setScope] = useState<'period' | 'fytd'>((search.get('scope') as any) === 'period' ? 'period' : 'fytd')
  const [branchId, setBranchId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scopeLabel, setScopeLabel] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(stmtUrl('pl', { period: period || undefined, scope, branch_id: branchId || undefined }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load profit & loss')
      setMeta(json.meta)
      setStmt(json.statement)
      setScopeLabel(json.scope?.label || '')
      if (!period) setPeriod(json.meta.default_period)
    } catch (e: any) {
      setError(e?.message || 'Failed to load profit & loss')
    } finally {
      setLoading(false)
    }
  }, [period, scope, branchId])

  useEffect(() => { load() }, [load])

  const net = stmt ? Number(stmt.net) : 0
  const n = stmt?.notes

  const handlePdf = () => {
    if (!stmt) return
    void downloadPdf({
      title: 'Profit & Loss',
      subtitle: 'Income and Expenses',
      dateRange: scopeLabel || undefined,
      columns: ['Type', 'Account', 'Amount (BDT)'],
      rows: [
        ...stmt.income.map((r) => ['Income', `${r.code} · ${r.name}`, r.amount] as (string | number)[]),
        ...stmt.expenses.map((r) => ['Expense', `${r.code} · ${r.name}`, r.amount] as (string | number)[]),
      ],
      summary: [
        { label: 'Total Income', value: bdt(stmt.total_income) },
        { label: 'Total Expenses', value: bdt(stmt.total_expenses) },
        { label: net >= 0 ? 'Net Profit' : 'Net Loss', value: bdt(Math.abs(net)) },
      ],
      filename: 'profit-and-loss.pdf',
    })
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto accounts-print-area">
      <PrintHeader title="Profit & Loss" subtitle="Income and Expenses" />
      <PageHead
        icon={<TrendingUp className="w-6 h-6 text-emerald-600" />}
        title="Profit & Loss (লাভ-ক্ষতি)"
        bangla="আয় থেকে খরচ বাদ দিলে যা থাকে"
        tech="Profit & Loss"
      >
        <div className="flex items-center gap-2 print:hidden">
          <ExportButtons csvHref={stmtUrl('pl', { period: period || undefined, scope, branch_id: branchId || undefined }, 'csv')} />
          <button onClick={handlePdf} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <FileText className="w-4 h-4" /> PDF
          </button>
          <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </PageHead>

      {meta && (
        <div className="flex flex-wrap items-center gap-3 mb-2 print:hidden">
          <PeriodScopeBar periods={meta.periods} period={period} onPeriod={setPeriod} scope={scope} onScope={setScope} />
          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            Branch
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
            >
              <option value="">All branches (company)</option>
              {meta.branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}
      {loading && !stmt && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading profit &amp; loss…</div>}

      {stmt && (
        <>
          {stmt.entry_count === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 mt-4">
              No journal entries in this scope — no result to report.
            </div>
          ) : (
            <>
              <Section title="Income" rows={stmt.income} totalLabel="Total income" total={stmt.total_income} />
              <Section title="Expenses" rows={stmt.expenses} totalLabel="Total expenses" total={stmt.total_expenses} />
              <div className={`rounded-2xl border p-5 mt-6 ${net >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-lg font-bold text-slate-900">Net result — {net >= 0 ? 'profit' : 'loss'}</div>
                  <div className="text-2xl font-bold text-slate-900 tabular-nums">{takaSigned(stmt.net)}</div>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  Income {taka(stmt.total_income)} − expenses {taka(stmt.total_expenses)} · {stmt.entry_count} entries in scope
                  {stmt.branch_id ? ' · branch view (lines carrying this branch only)' : ''}
                </p>
              </div>

              {stmt.by_branch && stmt.by_branch.length > 0 && (
                <>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mt-8 mb-2">Result by branch</h3>
                  <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                          <th className="px-4 py-3 font-semibold">Branch</th>
                          <th className="px-4 py-3 font-semibold text-right">Income</th>
                          <th className="px-4 py-3 font-semibold text-right">Expenses</th>
                          <th className="px-4 py-3 font-semibold text-right">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stmt.by_branch.map((b) => (
                          <tr key={b.branch_id} className="border-b border-slate-50">
                            <td className="px-4 py-2.5 font-medium text-slate-800">{b.branch_name}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{taka(b.income)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{taka(b.expenses)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-medium">{takaSigned(b.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Every income/expense journal line carries a branch, so the branch rows sum to the company totals above.
                  </p>
                </>
              )}
            </>
          )}

          {n && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 mt-8 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
                <AlertTriangle className="w-4 h-4" /> Read this result with its coverage notes
              </div>
              <p className="text-sm text-slate-700 inline-flex gap-1.5">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
                <span>
                  <strong>Coverage.</strong> This statement covers journal activity
                  {n.journal_from ? <> from <strong>{n.journal_from}</strong> to <strong>{n.journal_to}</strong></> : ''} only.
                  The historical funding of Head Office (owner capital put in over earlier years) exists in no source
                  module and is not in the journal — it is represented only by the opening position&apos;s equity
                  balancing figure{n.opening_equity_draft ? <> of <strong>{taka(n.opening_equity_draft)}</strong></> : ''},
                  which is {n.opening_status === 'confirmed' ? 'confirmed' : <strong>still a DRAFT awaiting owner confirmation</strong>}.
                  Expenses recorded here were really incurred; the matching funding sits outside the journal, so
                  treat the net figure as the journal-activity result, not a full historical profit measure.
                </span>
              </p>
              <p className="text-sm text-slate-700 inline-flex gap-1.5">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
                <span>
                  <strong>Cost of goods.</strong> No COGS is posted by the current posting map: chalan postings move
                  inventory at cost between branches, and <strong>{n.uncosted_chalans} of {n.total_chalans} chalans
                  have no recorded cost at all</strong> (sale value {taka(n.uncosted_chalan_sale)}) — they post
                  nothing. There is therefore no reliable gross-profit figure yet; the result above is an
                  operating result before cost of goods.
                </span>
              </p>
              <p className="text-sm text-slate-700 inline-flex gap-1.5">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
                <span>
                  <strong>Salary.</strong> Salary expense follows the journal account 5010 — salary payments plus
                  their ledger-head expense rows — not the salary module&apos;s own sum.
                </span>
              </p>
            </div>
          )}
        </>
      )}
      <PrintFooter />
    </div>
  )
}

export default function ProfitLossPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading profit &amp; loss…</div>}>
      <ProfitLossInner />
    </Suspense>
  )
}
