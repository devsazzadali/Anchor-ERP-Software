'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Banknote, CreditCard, TrendingUp, RefreshCw,
  AlertTriangle, CheckCircle, ChevronLeft, Calendar,
  ArrowDownRight
} from 'lucide-react'
import Link from 'next/link'

import { useBranchAuth } from '@/lib/hooks/use-branch-auth'
import { fetchWithCache, getCachedData } from '@/lib/branch-cache'

const fmt = (n: any) => (Number(n || 0) < 0 ? '-' : '') + '৳' + Math.abs(Number(n || 0)).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default function SalesSummaryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const branchId = searchParams?.get('branch_id') || ''
  const { isAuthorized, isLoading: isAuthLoading } = useBranchAuth()
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

  const cacheKey = `branch_sales_summary_${branchId || 'own'}_${selectedDate}`
  const [ledger, setLedger] = useState<any>(() => {
    const cached = getCachedData(cacheKey)
    return cached?.ledger?.[0] || null
  })
  const [isLoading, setIsLoading] = useState(() => !getCachedData(cacheKey))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthLoading && !isAuthorized) {
      router.replace('/dashboard/branch-accounts')
    }
  }, [isAuthLoading, isAuthorized, router])

  const fetchLedger = useCallback(async () => {
    try {
      let url = `/api/branch-accounts/cash-ledger?date=${selectedDate}`
      if (branchId) url += `&branch_id=${branchId}`
      const key = `branch_sales_summary_${branchId || 'own'}_${selectedDate}`
      const json = await fetchWithCache(key, url, 45000)
      setLedger(json?.ledger?.[0] || null)
      setError(null)
    } catch (e: any) { setError(e.message) }
  }, [selectedDate, branchId])

  useEffect(() => {
    if (!isAuthorized) return
    const key = `branch_sales_summary_${branchId || 'own'}_${selectedDate}`
    const cached = getCachedData(key)
    if (cached?.ledger?.[0]) {
      setLedger(cached.ledger[0])
      setIsLoading(false)
    }
    fetchLedger().finally(() => setIsLoading(false))
  }, [isAuthorized, selectedDate, branchId, fetchLedger])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchLedger()
    setIsRefreshing(false)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const totalSales = (ledger?.cash_sales || 0) + (ledger?.bkash_sales || 0) +
    (ledger?.nagad_sales || 0) + (ledger?.rocket_sales || 0) + (ledger?.card_sales || 0) + (ledger?.bank_transfer_sales || 0)

  const paymentBreakdown = [
    { label: 'Cash',          value: ledger?.cash_sales || 0,           icon: Banknote,       color: 'text-[#15803d]',   bg: 'bg-[#1ca34c]/10 border-[#1ca34c]/20' },
    { label: 'bKash',         value: ledger?.bkash_sales || 0,          icon: CreditCard,     color: 'text-pink-400',    bg: 'bg-pink-500/10 border-pink-500/20' },
    { label: 'Nagad',         value: ledger?.nagad_sales || 0,          icon: CreditCard,     color: 'text-orange-600',  bg: 'bg-orange-500/10 border-orange-500/20' },
    { label: 'Rocket',        value: ledger?.rocket_sales || 0,         icon: CreditCard,     color: 'text-purple-600',  bg: 'bg-purple-500/10 border-purple-500/20' },
    { label: 'Card',          value: ledger?.card_sales || 0,           icon: CreditCard,     color: 'text-blue-600',    bg: 'bg-blue-500/10 border-blue-500/20' },
    { label: 'Bank Transfer', value: ledger?.bank_transfer_sales || 0,  icon: TrendingUp,     color: 'text-cyan-600',    bg: 'bg-cyan-500/10 border-cyan-500/20' },
  ]

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/3 w-[500px] h-[300px] bg-[#1ca34c]/3 rounded-full filter blur-[130px]" />
      </div>

      <div className="relative z-10 p-4 md:p-6 lg:p-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard/branch-accounts"
            className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight">Sales Summary</h1>
            <p className="text-[11px] text-slate-500">Payment method breakdown for selected date</p>
          </div>
          <button onClick={handleRefresh}
            className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Date selector */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-900/[0.04] border border-slate-900/5 rounded-xl px-4 py-2.5">
            <Calendar className="w-4 h-4 text-[#15803d]" />
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="bg-transparent text-slate-900 text-sm focus:outline-none"
            />
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        {/* Total Sales Hero */}
        <div className="mb-6 p-6 rounded-3xl bg-gradient-to-br from-[#1ca34c]/15 to-[#1ca34c]/3 border border-[#1ca34c]/20 text-center">
          <p className="text-[10px] uppercase tracking-widest text-[#15803d]/70 mb-2">Total Sales — {selectedDate}</p>
          <p className="text-4xl font-extrabold tracking-tight text-slate-900">{fmt(totalSales)}</p>
          {!ledger && <p className="text-[11px] text-slate-500 mt-2">No ledger entry for this date. Sales data will appear once the ledger is created.</p>}
        </div>

        {/* Payment Breakdown Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {paymentBreakdown.map(({ label, value, icon: Icon, color, bg }) => {
            const pct = totalSales > 0 ? ((value / totalSales) * 100).toFixed(1) : '0.0'
            return (
              <div key={label} className={`p-5 rounded-3xl border ${bg}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${color}`} />
                    <span className="text-xs font-semibold text-slate-900">{label}</span>
                  </div>
                  <span className={`text-[10px] font-bold ${color}`}>{pct}%</span>
                </div>
                <p className="text-xl font-extrabold text-slate-900 tracking-tight">{fmt(value)}</p>
                {/* Progress bar */}
                <div className="mt-3 h-1 bg-slate-900/[0.04] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${color.replace('text-', 'bg-')}`}
                    style={{ width: `${Math.min(100, Number(pct))}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* Cash Flow Summary */}
        {ledger && (
          <div className="rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] p-6">
            <h3 className="text-[10px] uppercase tracking-widest text-slate-500 mb-4 font-semibold">Cash Flow</h3>
            <div className="space-y-3">
              {[
                { label: 'Opening Cash',       value: ledger.opening_cash || 0,         sign: '' },
                { label: '+ Cash Sales',       value: ledger.cash_sales || 0,            sign: '+' },
                { label: '+ Other Cash In',    value: ledger.other_cash_in || 0,         sign: '+' },
                { label: '− Cash Expenses',    value: ledger.cash_expenses || 0,         sign: '−' },
                { label: '− Bank Deposits',    value: ledger.bank_deposits_out || 0,     sign: '−' },
              ].map(({ label, value, sign }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-slate-900/[0.08]">
                  <span className="text-xs text-slate-500">{label}</span>
                  <span className={`text-xs font-semibold ${sign === '−' ? 'text-rose-600' : sign === '+' ? 'text-emerald-600' : 'text-slate-900'}`}>
                    {sign === '−' ? '-' : sign === '+' ? '+' : ''}{fmt(value)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-3">
                <span className="text-sm font-bold text-slate-900">Expected Closing Cash</span>
                <span className="text-lg font-bold text-[#15803d] tracking-tight">{fmt(ledger.expected_closing_cash || 0)}</span>
              </div>
              {ledger.is_closed && (
                <div className="flex items-center justify-between pt-1 border-t border-slate-900/5">
                  <span className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600" /> Actual Cash
                  </span>
                  <span className="text-lg font-bold text-emerald-600 tracking-tight">{fmt(ledger.actual_cash || 0)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
