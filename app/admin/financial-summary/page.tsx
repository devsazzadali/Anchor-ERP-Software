'use client'

export const dynamic = 'force-dynamic'

import React, { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  DollarSign, Calendar, Loader2,
  BarChart3, RefreshCw, Layers, MapPin, ArrowDownRight, ArrowUpRight, Building2
} from 'lucide-react'
import { dhakaToday, monthWindowOf, dhakaRangeUtcWindow } from '@/lib/dhaka-time'
import { sumMoney } from '@/lib/money'
import { classifyExpenseStreams } from '@/lib/expense-streams'

// all reads go through
// GET /api/admin/financial-summary (admin-gated, Prisma) — the
// browser no longer queries the database directly. The route
// returns the same raw sources with the same filters (B39/B40/B41,
// C20 link columns, expense_kind), and the three-stream
// classification still happens here via the single shared
// classifier (lib/expense-streams).

export default function FinancialSummaryPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [branches, setBranches] = useState<{id: string, name: string}[]>([])
  const [selectedBranch, setSelectedBranch] = useState('all')

  const [dateRange, setDateRange] = useState(() => {
    const today = dhakaToday()
    const [y, m] = today.split('-').map(Number)
    const prevMonth = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
    return {
      startDate: monthWindowOf(`${prevMonth.y}-${String(prevMonth.m).padStart(2, '0')}-01`).start,
      endDate: today
    }
  })

  // Data states
  const [deposits, setDeposits] = useState<any[]>([])
  const [salesLedgers, setSalesLedgers] = useState<any[]>([])
  // Expense model (owner, 2026-10-31): the three expense streams are
  // kept as SEPARATE raw sources and classified by
  // lib/expense-streams. The old code merged all four sources into ONE
  // array under a synthetic 'company-general' bucket, which mixed
  // branch cash, company money and ledger-head costs into a single
  // undifferentiated list.
  const [cashExpenses, setCashExpenses] = useState<any[]>([])
  const [headPayments, setHeadPayments] = useState<{ amount: any; headId: string; headName: string }[]>([])
  const [companyExpenses, setCompanyExpenses] = useState<any[]>([])
  const [ledgerHeads, setLedgerHeads] = useState<{id: string, name: string}[]>([])

  useEffect(() => {
    fetchFinancialData()
  }, [selectedBranch, dateRange.startDate, dateRange.endDate])

  const fetchFinancialData = async () => {
    setIsLoading(true)
    const startDate = dateRange.startDate
    const endDate = dateRange.endDate

    try {
      const params = new URLSearchParams({
        branch: selectedBranch,
        start: startDate,
        end: endDate,
      })
      const res = await fetch(`/api/admin/financial-summary?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load financial summary')

      const bData = json.branches || []
      const lData = json.ledgerHeads || []
      setBranches(bData)
      setLedgerHeads(lData)
      setDeposits(json.deposits || [])
      setSalesLedgers(json.salesLedgers || [])
      // Branch cash expenses WITH their link columns. C20's rule —
      // a row that is the cash copy of a salary payment must never be
      // counted next to the salary itself — is enforced by the
      // stream classifier (lib/expense-streams), which also discloses
      // the excluded copies instead of silently dropping them, and
      // needs expense_request_id to keep employee-request payments in
      // the branch stream. In the app the link columns are part of
      // the schema from day one, so the pre-migration fallback query
      // of the legacy copy no longer exists.
      setCashExpenses(json.cashExpenses || [])
      // Company expenses are global (head office), like salaries and
      // payouts: only returned in the all-branches view. expense_kind
      // carries the setup/operating split (expense-model spec).
      setCompanyExpenses(json.companyExpenses || [])

      const salsData = json.salaries || []
      const pOutsData = json.payouts || []

      // Salaries and partner payouts are recurring costs that live
      // under a Ledger Head (the owner's stream 3): pre-map each to its
      // head, exactly as the summary always resolved them, and let the
      // classifier group them. Company expenses are NOT mapped into a
      // pseudo-head any more — the 'company-general' bucket is gone;
      // they form their own stream, split setup vs operating.
      const mappedHeads: { amount: any; headId: string; headName: string }[] = []
      if (salsData && salsData.length > 0) {
        const salaryLedger = lData.find((l: any) => l.name.toLowerCase().includes('salary')) || { id: 'unassigned', name: 'Salary' }
        salsData.forEach((s: any) => mappedHeads.push({ amount: s.amount, headId: salaryLedger.id, headName: salaryLedger.name }))
      }
      if (pOutsData && pOutsData.length > 0) {
        const payoutLedger = lData.find((l: any) => l.name.toLowerCase().includes('payout') || l.name.toLowerCase().includes('partner')) || { id: 'unassigned', name: 'Partner Payout' }
        pOutsData.forEach((p: any) => mappedHeads.push({ amount: p.amount, headId: payoutLedger.id, headName: payoutLedger.name }))
      }
      setHeadPayments(mappedHeads)
    } catch (e) {
      console.error('Failed to fetch financial summary:', e)
    }

    setIsLoading(false)
    setIsRefreshing(false)
  }

  // Analytics
  // B39: deposits are TRANSFERS of sales already counted at sale time.
  // Calling them "income" double-counted revenue, and
  // deposits-minus-expenses was neither profit nor balance. Income is
  // now total sales from the daily ledgers; deposits are reported
  // separately as the transfer figure they are.
  const totalIncome = sumMoney(salesLedgers.flatMap(l => [l.cash_sales, l.bkash_sales, l.nagad_sales, l.rocket_sales, l.card_sales, l.bank_transfer_sales]))
  const totalDeposits = sumMoney(deposits.map(d => d.amount))

  // The owner's three expense streams (branch cash / company /
  // ledger-head recurring) — classified by the single shared
  // classifier, so every underlying row lands in exactly ONE stream
  // and the grand total is their exact sum.
  const streams = useMemo(() => classifyExpenseStreams({
    branchCashExpenses: cashExpenses,
    companyExpenses,
    headPayments,
    branches,
    ledgerHeads
  }), [cashExpenses, companyExpenses, headPayments, branches, ledgerHeads])

  const totalExpenses = streams.grandTotal
  const netBalance = totalIncome - totalExpenses

  const handleRefresh = () => {
    setIsRefreshing(true)
    fetchFinancialData()
  }

  // One ranked row inside a stream block; pct is the share of ITS stream.
  const StreamRow = ({ rank, name, sub, total, streamTotal }: { rank: number; name: string; sub?: string; total: number; streamTotal: number }) => {
    const pct = streamTotal > 0 ? (total / streamTotal) * 100 : 0
    return (
      <div className="bg-slate-900/[0.04] border border-slate-900/5 rounded-xl p-4 flex flex-col md:flex-row items-center gap-4 hover:bg-slate-900/[0.04] transition-colors">
        <div className="w-8 h-8 rounded-full bg-[#1ca34c]/10 flex items-center justify-center text-[#15803d] font-bold text-xs shrink-0">
          {rank}
        </div>
        <div className="flex-1 w-full">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm">{name}{sub ? <span className="text-slate-500 font-normal text-xs ml-2">{sub}</span> : null}</span>
            <span className="font-mono font-bold text-[#15803d]">৳ {total.toLocaleString('en-BD')}</span>
          </div>
          <div className="w-full h-1.5 bg-white rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="h-full bg-[#1ca34c] rounded-full"
            />
          </div>
        </div>
        <div className="text-xs font-bold text-slate-500 w-16 text-right shrink-0">
          {pct.toFixed(1)}%
        </div>
      </div>
    )
  }

  // One of the owner's three expense streams, with its own total.
  const StreamBlock = ({ icon: Icon, title, subtitle, total, isEmpty, children }: {
    icon: React.ElementType; title: string; subtitle: string; total: number; isEmpty: boolean; children: React.ReactNode
  }) => (
    <div className="bg-slate-900/[0.05] border border-slate-900/5 rounded-3xl p-6 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-bold font-serif flex items-center gap-2">
            <Icon className="w-5 h-5 text-[#15803d]" />
            {title}
          </h3>
          <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Stream Total</p>
          <p className="font-mono font-bold text-xl text-slate-900">৳ {total.toLocaleString('en-BD')}</p>
        </div>
      </div>
      {isEmpty ? (
        <div className="py-10 text-center text-slate-500 bg-slate-900/[0.04] rounded-3xl border border-dashed border-slate-900/10">
          No expenses in this stream for this period.
        </div>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-white text-slate-900 pb-20 font-sans selection:bg-[#1ca34c]/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8 pb-6 border-b border-slate-900/5">
          <div>
            <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-slate-900 via-slate-900 to-slate-500 font-serif flex items-center gap-2">
              <Layers className="w-6 h-6 text-[#15803d]" />
              Financial Summary Dashboard
            </h1>
            <p className="text-slate-500 text-sm mt-1 flex items-center gap-1.5">
              Aggregate Sales and Expenses to calculate the Net position. Bank deposits are transfers of sales already counted — never income.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh} disabled={isLoading || isRefreshing}
              className="flex items-center gap-2 px-4 py-2 bg-slate-900/[0.04] hover:bg-slate-900/[0.04] border border-slate-900/10 rounded-xl text-sm font-semibold transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-slate-900/[0.05] border border-slate-900/[0.08] rounded-3xl p-4 flex flex-col md:flex-row gap-4 mb-8 relative z-10">
          {/* Branch Select */}
          <div className="flex-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Branch</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#15803d]" />
              <select
                value={selectedBranch}
                onChange={e => setSelectedBranch(e.target.value)}
                className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl pl-9 pr-4 py-2.5 text-sm font-semibold focus:outline-none focus:border-[#1ca34c]/40 transition-all appearance-none"
              >
                <option value="all">Global (All Branches)</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Date Range Select */}
          <div className="flex-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Date Range</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateRange.startDate}
                onChange={e => setDateRange(p => ({ ...p, startDate: e.target.value }))}
                className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-[#1ca34c]/40 transition-all text-slate-600"
              />
              <span className="text-slate-500 font-bold text-sm">to</span>
              <input
                type="date"
                value={dateRange.endDate}
                onChange={e => setDateRange(p => ({ ...p, endDate: e.target.value }))}
                className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-[#1ca34c]/40 transition-all text-slate-600"
              />
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[#15803d] mb-4" />
            <p className="text-slate-500 font-semibold text-sm">Calculating Financials...</p>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">

            {/* B43: in branch view, head-office salaries, partner payouts
                and company expenses are excluded by design — say so on
                screen instead of silently presenting a partial total. */}
            {selectedBranch !== 'all' && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-700 font-semibold">
                Branch view: head-office salaries, partner payouts and company-wide expenses are excluded — branch totals are not comparable with the all-branches view.
              </div>
            )}

            {/* Top Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Income */}
              <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-900/5 border border-emerald-500/20 rounded-3xl p-6 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <ArrowUpRight className="w-24 h-24 text-emerald-500" />
                </div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-600/80 mb-2">Total Income (Sales)</p>
                <h3 className="text-3xl font-bold font-mono text-emerald-600 flex items-center gap-1">
                  <span className="text-xl">৳</span> {totalIncome.toLocaleString('en-BD')}
                </h3>
                <p className="text-xs text-emerald-500/60 mt-3 font-semibold">
                  Cash + digital sales from daily ledgers · Bank deposits (transfers, not income): ৳{totalDeposits.toLocaleString('en-BD')}
                </p>
              </div>

              {/* Expenses */}
              <div className="bg-gradient-to-br from-rose-500/10 to-rose-900/5 border border-rose-500/20 rounded-3xl p-6 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <ArrowDownRight className="w-24 h-24 text-rose-500" />
                </div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-rose-600/80 mb-2">Total Expenses</p>
                <h3 className="text-3xl font-bold font-mono text-rose-600 flex items-center gap-1">
                  <span className="text-xl">৳</span> {totalExpenses.toLocaleString('en-BD')}
                </h3>
                <p className="text-xs text-rose-500/60 mt-3 font-semibold">
                  Branch ৳{streams.branch.total.toLocaleString('en-BD')} · Company ৳{streams.company.total.toLocaleString('en-BD')} · Ledger heads ৳{streams.ledgerHead.total.toLocaleString('en-BD')} — every row counted in exactly one stream
                </p>
              </div>

              {/* Net Balance */}
              <div className={`bg-gradient-to-br border rounded-3xl p-6 relative overflow-hidden group ${
                netBalance >= 0
                  ? 'from-blue-500/10 to-blue-900/5 border-blue-500/20'
                  : 'from-orange-500/10 to-orange-900/5 border-orange-500/20'
              }`}>
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <DollarSign className={`w-24 h-24 ${netBalance >= 0 ? 'text-blue-500' : 'text-orange-500'}`} />
                </div>
                <p className={`text-[11px] font-black uppercase tracking-[0.2em] mb-2 ${netBalance >= 0 ? 'text-blue-600/80' : 'text-orange-600/80'}`}>
                  Net (Sales − Expenses)
                </p>
                <h3 className={`text-3xl font-bold font-mono flex items-center gap-1 ${netBalance >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                  <span className="text-xl">৳</span> {netBalance.toLocaleString('en-BD')}
                </h3>
                <p className={`text-xs mt-3 font-semibold ${netBalance >= 0 ? 'text-blue-500/60' : 'text-orange-500/60'}`}>
                  Sales minus all expenses in range
                </p>
              </div>
            </div>

            {/* ── The owner's three expense streams ───────────────────
                Every expense row is classified into exactly ONE
                stream by lib/expense-streams; the three stream totals
                sum exactly to Total Expenses above. */}
            <StreamBlock
              icon={MapPin}
              title="Branch Expenses"
              subtitle="Spent from branch cash — per branch (employee expenses paid from branch cash land here)"
              total={streams.branch.total}
              isEmpty={streams.branch.perBranch.length === 0}
            >
              {streams.branch.perBranch.map((b, idx) => (
                <StreamRow key={b.branchId || 'unassigned'} rank={idx + 1} name={b.branchName} sub={`${b.count} record${b.count !== 1 ? 's' : ''}`} total={b.total} streamTotal={streams.branch.total} />
              ))}
            </StreamBlock>

            {selectedBranch === 'all' && (
              <StreamBlock
                icon={Building2}
                title="Company Expenses"
                subtitle="Spent from the company (head-office) profile — one-time opening setup kept apart from regular operating costs"
                total={streams.company.total}
                isEmpty={streams.company.total === 0}
              >
                <StreamRow rank={1} name="One-time Setup (company opening)" sub="AC, lights, furnishing and other opening costs" total={streams.company.setup} streamTotal={streams.company.total} />
                <StreamRow rank={2} name="Regular Operating" sub="Ongoing company spending" total={streams.company.operating} streamTotal={streams.company.total} />
              </StreamBlock>
            )}

            <StreamBlock
              icon={BarChart3}
              title="Ledger-Head Expenses"
              subtitle="Continually recurring costs under Ledger Heads — house rent, utility bills, salary and similar"
              total={streams.ledgerHead.total}
              isEmpty={streams.ledgerHead.byHead.length === 0}
            >
              {streams.ledgerHead.byHead.map((lh, idx) => (
                <StreamRow key={lh.id} rank={idx + 1} name={lh.name} sub={`${lh.count} record${lh.count !== 1 ? 's' : ''}`} total={lh.total} streamTotal={streams.ledgerHead.total} />
              ))}
            </StreamBlock>

            {/* Reconciliation: the three streams ARE the total. */}
            <div className="bg-slate-900/[0.04] border border-slate-900/5 rounded-3xl px-5 py-4 text-xs text-slate-500 font-semibold space-y-2">
              <p>
                Grand total ৳{streams.grandTotal.toLocaleString('en-BD')} = Branch ৳{streams.branch.total.toLocaleString('en-BD')}
                {selectedBranch === 'all' ? <> + Company ৳{streams.company.total.toLocaleString('en-BD')} (setup ৳{streams.company.setup.toLocaleString('en-BD')} + operating ৳{streams.company.operating.toLocaleString('en-BD')})</> : null}
                {' '}+ Ledger heads ৳{streams.ledgerHead.total.toLocaleString('en-BD')} — every expense row is counted in exactly one stream.
              </p>
              {streams.excludedSalaryCopies.count > 0 && (
                <p className="text-amber-700/90">
                  {streams.excludedSalaryCopies.count} salary cash-copy row{streams.excludedSalaryCopies.count !== 1 ? 's' : ''} (৳{streams.excludedSalaryCopies.total.toLocaleString('en-BD')}) not counted above — salaries are counted once, from salary payments, under the Salary ledger head.
                </p>
              )}
            </div>

          </motion.div>
        )}
      </div>
    </div>
  )
}
