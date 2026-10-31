'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { FileBarChart2, Scale, TrendingUp, Landmark, RefreshCw, AlertTriangle, BookOpen } from 'lucide-react'
import { PeriodScopeBar, stmtUrl, taka, type StmtMeta } from './ui'

// Accounts A2 — Statements index. Period picker + the three
// statements, the journal-coverage strip, and the read-only
// posting-map viewer (blueprint §B.4: settings/posting-map viewer
// lands with A2). All figures on the linked screens are computed
// from journal_lines only (lib/server/accounting/statements.ts).

const POSTING_MAP: Array<{ id: string; event: string; debit: string; credit: string; status: string }> = [
  { id: 'P1', event: 'Daily closing saved/closed', debit: 'Cash — Branch (cash sales + other cash-in); MFS & Card Clearing (digital sales)', credit: 'Sales Revenue; Other Income (other cash-in / counted excess); Cash Shortage is Dr on shortage', status: 'Live (A1)' },
  { id: 'P2', event: 'Branch cash expense (branch stream only)', debit: 'Branch Operating Expenses / mapped head account', credit: 'Cash — Branch (the drawer that bore it)', status: 'Live (A1)' },
  { id: 'P3', event: 'Ledger-head branch expense', debit: 'Expense account mapped from the ledger head', credit: 'Cash — Head Office (settled centrally; never the drawer)', status: 'Live (A1)' },
  { id: 'P4', event: 'Company expense created / paid', debit: 'Company Operating / Setup Expenses (accrual); Accounts Payable (settlement)', credit: 'Accounts Payable (accrual); Cash — Head Office (settlement)', status: 'Live (A1)' },
  { id: 'P5', event: 'Salary issued / voided', debit: 'Salary - Basic (5010)', credit: 'Cash — Head Office', status: 'Live (A1)' },
  { id: 'P6', event: 'Expense request paid', debit: 'Employee Expense Requests (5350)', credit: 'Cash — Branch (cash / mirror-booked) or MFS & Card Clearing', status: 'Live (A1)' },
  { id: 'P7', event: 'Deposit approved / reversed', debit: 'Bank — <account> (lump on deposit date)', credit: 'Cash — Branch', status: 'Live (A1)' },
  { id: 'P8', event: 'Chalan created (costed only)', debit: 'Inventory — receiving branch (at cost)', credit: 'Inventory — head-office pool (at cost)', status: 'Live (A1)' },
  { id: 'P9', event: 'Partner payout completed', debit: 'Partner Drawings — <partner>', credit: 'Cash — Head Office', status: 'Live (A1), no historical rows' },
  { id: 'P10', event: 'Bundle request completed', debit: 'Cash in Transit', credit: 'Cash — Head Office', status: 'Live (A1), no historical rows' },
  { id: 'P11', event: 'VAT / TDS on flagged events', debit: '—', credit: '—', status: 'Staged — A7 (register tables exist; dormant until rates are configured)' },
  { id: 'P12', event: 'Opening entry (one-time)', debit: 'Assets as confirmed', credit: 'Liabilities + Equity (balancing figure shown explicitly)', status: 'Staged — position computed as DRAFT; posting is an A3 decision after owner confirmation' },
  { id: 'P13', event: 'Period-end adjustments', debit: 'As entered', credit: 'As entered', status: 'Staged — via manual entries in a later stage' },
]

export default function StatementsIndexPage() {
  const [meta, setMeta] = useState<StmtMeta | null>(null)
  const [period, setPeriod] = useState('')
  const [scope, setScope] = useState<'period' | 'fytd'>('fytd')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(stmtUrl('trial-balance', { scope: 'fytd' }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load statements')
      setMeta(json.meta)
      setPeriod((cur) => cur || json.meta.default_period)
    } catch (e: any) {
      setError(e?.message || 'Failed to load statements')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const q = period ? `?period=${period}&scope=${scope}` : ''
  const cards = [
    {
      href: `/admin/accounts/statements/trial-balance${q}`,
      icon: Scale,
      title: 'Trial Balance',
      text: 'Every account with its debit, credit and balance for the period — the books balance to ৳0.00 or the badge says so.',
    },
    {
      href: `/admin/accounts/statements/pl${q}`,
      icon: TrendingUp,
      title: 'Profit & Loss',
      text: 'Company result and per-branch result from the journal — income, expenses, and the coverage notes that qualify them.',
    },
    {
      href: `/admin/accounts/statements/balance-sheet${period ? `?period=${period}` : ''}`,
      icon: Landmark,
      title: 'Balance Sheet',
      text: 'Assets, liabilities and equity as of a date. Provisional until the owner confirms the opening position.',
    },
  ]

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileBarChart2 className="w-6 h-6 text-emerald-600" /> Accounts — Statements
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Financial statements computed from the double-entry journal only — never re-keyed, never from module sums.
          </p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 print:hidden">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}
      {loading && !meta && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading statements…</div>}

      {meta && (
        <>
          <div className="mb-6 print:hidden">
            <PeriodScopeBar periods={meta.periods} period={period} onPeriod={setPeriod} scope={scope} onScope={setScope} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {cards.map((c) => (
              <Link key={c.href} href={c.href} className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-emerald-300 hover:shadow-sm transition">
                <div className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <c.icon className="w-5 h-5 text-emerald-600" /> {c.title}
                </div>
                <p className="mt-2 text-sm text-slate-600">{c.text}</p>
                <span className="mt-3 inline-block text-sm font-semibold text-emerald-700">Open →</span>
              </Link>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <BookOpen className="w-4 h-4" /> Journal coverage
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {meta.journal_coverage.entries} posted entries
              {meta.journal_coverage.first_entry && (
                <> · from <strong>{meta.journal_coverage.first_entry}</strong> to <strong>{meta.journal_coverage.last_entry}</strong></>
              )}
              . Statements cover journal activity only; activity before the journal starts exists in no
              source module and appears solely in the opening position below.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Opening position:{' '}
              {meta.opening ? (
                meta.opening.status === 'draft' ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                    <AlertTriangle className="w-4 h-4" /> DRAFT — equity balancing figure {meta.opening.equity_draft ? taka(meta.opening.equity_draft) : '—'} awaiting owner confirmation
                  </span>
                ) : (
                  <span className="font-semibold text-emerald-700">CONFIRMED</span>
                )
              ) : (
                'not computed yet'
              )}
            </p>
          </div>

          <h2 className="text-lg font-bold text-slate-900 mb-3">Posting map — how module events become journal entries (read-only)</h2>
          <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-3 font-semibold">Map</th>
                  <th className="px-4 py-3 font-semibold">Source event</th>
                  <th className="px-4 py-3 font-semibold">Debit</th>
                  <th className="px-4 py-3 font-semibold">Credit</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {POSTING_MAP.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 align-top">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-500">{r.id}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{r.event}</td>
                    <td className="px-4 py-3 text-slate-600">{r.debit}</td>
                    <td className="px-4 py-3 text-slate-600">{r.credit}</td>
                    <td className="px-4 py-3 text-slate-500">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
