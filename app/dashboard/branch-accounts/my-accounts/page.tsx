'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Landmark, RefreshCw, TrendingUp, Wallet, Receipt } from 'lucide-react'
import { useBranchAuth } from '@/lib/hooks/use-branch-auth'
import { useLanguage } from '@/lib/i18n/provider'

// Round 2 Step 6 (D7) — "My Branch Accounts": the branch
// manager's read-only window. Data: GET /api/accounts/branch-view
// (the server derives the branch from the caller's profile —
// this page cannot ask for another branch). No posting or
// editing controls exist here by design.

type BranchView = {
  branch: { id: string; name: string }
  as_of: string
  month: string
  cash: string
  pl: { income: string; expenses: string; net: string } | null
  payables: Array<{
    id: string
    counterparty_name: string | null
    description: string
    amount_open: string
    due_date: string | null
    status: string
    overdue: boolean
  }>
  payables_total: string
}

const taka = (v: string | number) => {
  const n = Number(v)
  return `${n < 0 ? '-' : ''}৳${Math.abs(n).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function MyBranchAccountsPage() {
  const { t } = useLanguage()
  const router = useRouter()
  const { isAuthorized, isLoading: isAuthLoading } = useBranchAuth()
  const [view, setView] = useState<BranchView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthLoading && !isAuthorized) {
      router.replace('/dashboard/branch-accounts')
    }
  }, [isAuthLoading, isAuthorized, router])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts/branch-view')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load branch accounts')
      setView(json)
    } catch (e: any) {
      setError(e?.message || 'Failed to load branch accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized, load])

  const bv = t.accounts.branchView

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Landmark className="w-6 h-6 text-emerald-600" />
          <span className="font-bangla">{bv.title}</span>
          {view && <span className="text-base font-semibold text-slate-500">— {view.branch.name}</span>}
        </h1>
        <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      <p className="text-sm text-slate-500 font-bangla">{bv.sub}</p>
      {view && <p className="text-xs text-slate-400 mt-1">{bv.asOf} · {view.as_of} · {view.month}</p>}

      {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
      {loading && !view && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading…</div>}

      {view && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 font-bangla">
                <Wallet className="w-4 h-4 text-emerald-600" /> {bv.cashTitle}
              </div>
              <div className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">{taka(view.cash)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 font-bangla">
                <TrendingUp className="w-4 h-4 text-emerald-600" /> {bv.monthTitle} ({view.month})
              </div>
              {view.pl ? (
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500 font-bangla">{bv.income}</span><span className="font-semibold tabular-nums">{taka(view.pl.income)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500 font-bangla">{bv.expenses}</span><span className="font-semibold tabular-nums">{taka(view.pl.expenses)}</span></div>
                  <div className="flex justify-between border-t border-slate-100 pt-1">
                    <span className="font-semibold text-slate-700 font-bangla">{bv.net}</span>
                    <span className={`text-lg font-bold tabular-nums ${Number(view.pl.net) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{taka(view.pl.net)}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-400">—</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 mt-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 font-bangla">
              <Receipt className="w-4 h-4 text-emerald-600" /> {bv.payablesTitle}
            </div>
            {view.payables.length === 0 ? (
              <p className="mt-2 text-sm text-emerald-700 font-bangla">{bv.nothingOwed}</p>
            ) : (
              <>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                        <th className="py-2 pr-3 font-semibold">Party</th>
                        <th className="py-2 pr-3 font-semibold">{bv.dueLabel}</th>
                        <th className="py-2 font-semibold text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.payables.map((p) => (
                        <tr key={p.id} className="border-b border-slate-50">
                          <td className="py-2 pr-3">
                            <span className="font-medium text-slate-800">{p.counterparty_name ?? p.description}</span>
                            {p.counterparty_name && <span className="block text-xs text-slate-400">{p.description}</span>}
                          </td>
                          <td className="py-2 pr-3 text-slate-600">
                            {p.due_date ?? '—'}
                            {p.overdue && <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[11px] font-bold font-bangla">{bv.overdueLabel}</span>}
                          </td>
                          <td className="py-2 text-right font-semibold tabular-nums">{taka(p.amount_open)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex justify-between border-t border-slate-100 pt-2 text-sm">
                  <span className="font-semibold text-slate-700 font-bangla">{bv.payablesTotal}</span>
                  <span className="font-bold tabular-nums">{taka(view.payables_total)}</span>
                </div>
              </>
            )}
          </div>

          <p className="mt-4 text-xs text-slate-400 font-bangla">{bv.readOnlyNote}</p>
        </>
      )}
    </div>
  )
}
