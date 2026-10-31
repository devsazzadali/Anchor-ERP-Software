'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Wallet, Calendar, RefreshCw, AlertTriangle,
  ChevronLeft, TrendingDown, PiggyBank, Banknote,
  CheckCircle, Clock, Plus, Eye
} from 'lucide-react'
import Link from 'next/link'

import { useBranchAuth } from '@/lib/hooks/use-branch-auth'
import { fetchWithCache, getCachedData } from '@/lib/branch-cache'

const fmt = (n: any) => (Number(n || 0) < 0 ? '-' : '') + '৳' + Math.abs(Number(n || 0)).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

function LedgerRow({ label, value, color = 'white', border = true, large = false }: {
  label: string; value: string; color?: string; border?: boolean; large?: boolean
}) {
  return (
    <div className={`flex items-center justify-between py-3 ${border ? 'border-b border-slate-900/[0.08]' : ''}`}>
      <span className={`${large ? 'text-sm font-bold' : 'text-xs'} text-slate-500`}>{label}</span>
      <span className={`${large ? 'text-xl font-bold tracking-tight' : 'text-sm font-semibold'} ${color === 'white' ? 'text-slate-900' : color}`}>
        {value}
      </span>
    </div>
  )
}

export default function CashLedgerPage() {
  const router = useRouter()
  const { isAuthorized, isLoading: isAuthLoading } = useBranchAuth()
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

  const cacheKey = `branch_cash_ledger_${selectedDate}`
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
      const key = `branch_cash_ledger_${selectedDate}`
      const json = await fetchWithCache(key, `/api/branch-accounts/cash-ledger?date=${selectedDate}`, 45000)
      setLedger(json?.ledger?.[0] || null)
      setError(null)
    } catch (e: any) { setError(e.message) }
  }, [selectedDate])

  useEffect(() => {
    if (!isAuthorized) return
    const key = `branch_cash_ledger_${selectedDate}`
    const cached = getCachedData(key)
    if (cached?.ledger?.[0]) {
      setLedger(cached.ledger[0])
      setIsLoading(false)
    }
    fetchLedger().finally(() => setIsLoading(false))
  }, [isAuthorized, selectedDate, fetchLedger])

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

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-20 left-1/3 w-[400px] h-[300px] bg-emerald-500/3 rounded-full filter blur-[120px]" />
      </div>

      <div className="relative z-10 p-4 md:p-6 lg:p-8 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard/branch-accounts"
            className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold font-serif flex items-center gap-2">
              <Wallet className="w-5 h-5 text-[#15803d]" /> Cash Ledger
            </h1>
            <p className="text-[11px] text-slate-500">Daily cash balance tracker</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-slate-900/[0.04] border border-slate-900/5 rounded-xl px-3 py-2">
              <Calendar className="w-3.5 h-3.5 text-[#15803d]" />
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="bg-transparent text-slate-900 text-xs focus:outline-none cursor-pointer [color-scheme:light]"
              />
            </div>
            <button onClick={handleRefresh}
              className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        {!ledger ? (
          <div className="text-center py-16 rounded-2xl border border-slate-900/5 bg-slate-900/[0.04]">
            <Wallet className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-500 text-sm">No ledger entry for {selectedDate}</p>
            <p className="text-slate-600 text-xs mt-1">Sales data will automatically populate once entered</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Status bar */}
            <div className={`flex items-center justify-between p-4 rounded-2xl border ${
              ledger.is_closed
                ? 'bg-emerald-500/10 border-emerald-500/20'
                : 'bg-amber-500/10 border-amber-500/20'
            }`}>
              <div className="flex items-center gap-2">
                {ledger.is_closed
                  ? <CheckCircle className="w-4 h-4 text-emerald-600" />
                  : <Clock className="w-4 h-4 text-amber-600" />
                }
                <span className={`text-xs font-bold ${ledger.is_closed ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {ledger.is_closed ? 'Day Closed' : 'Day Open — Not yet closed'}
                </span>
              </div>
              {!ledger.is_closed && (
                <Link href="/dashboard/branch-accounts/daily-closing"
                  className="text-[10px] font-bold uppercase tracking-widest text-amber-600 hover:text-amber-700 transition-colors"
                >
                  Close Day →
                </Link>
              )}
            </div>

            {/* Physical Cash Drawer Flow Card */}
            <div className="rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] uppercase tracking-widest text-[#15803d] font-semibold">Physical Cash Drawer Flow</h3>
                <span className="text-[10px] text-slate-500">Excludes Digital Sales</span>
              </div>

              <LedgerRow label="Opening Cash"          value={fmt(ledger.opening_cash || 0)} />
              <LedgerRow label="+ Physical Cash Sales"  value={fmt(ledger.cash_sales || 0)}   color="text-emerald-600" />
              <LedgerRow label="+ Other Cash In"       value={fmt(ledger.other_cash_in || 0)} color="text-emerald-600" />
              <LedgerRow label="− Cash Expenses"       value={fmt(ledger.cash_expenses || 0)}  color="text-rose-600" />
              <LedgerRow label="− Bank Deposits Out"   value={fmt(ledger.bank_deposits_out || 0)} color="text-rose-600" />

              <div className="pt-3 border-t border-slate-900/10">
                <LedgerRow
                  label="= Expected Closing Cash"
                  value={fmt(ledger.expected_closing_cash || 0)}
                  color="text-[#15803d]"
                  border={false}
                  large
                />
              </div>
            </div>

            {/* Digital Sales Card */}
            <div className="rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] p-6">
              <h3 className="text-[10px] uppercase tracking-widest text-slate-500 mb-4 font-semibold">Digital Sales (Direct to Accounts / Wallets)</h3>
              <LedgerRow label="bKash Sales"          value={fmt(ledger.bkash_sales || 0)}  color="text-pink-400" />
              <LedgerRow label="Nagad Sales"          value={fmt(ledger.nagad_sales || 0)}  color="text-orange-600" />
              <LedgerRow label="Rocket Sales"         value={fmt(ledger.rocket_sales || 0)} color="text-purple-600" />
              <LedgerRow label="Card Sales"           value={fmt(ledger.card_sales || 0)}   color="text-blue-600" />
              <LedgerRow label="Bank Transfer Sales"  value={fmt(ledger.bank_transfer_sales || 0)} color="text-indigo-600" />
              <div className="pt-3 border-t border-slate-900/10">
                <LedgerRow
                  label="Total Digital Sales"
                  value={fmt((ledger.bkash_sales || 0) + (ledger.nagad_sales || 0) + (ledger.rocket_sales || 0) + (ledger.card_sales || 0) + (ledger.bank_transfer_sales || 0))}
                  color="text-slate-700"
                  border={false}
                />
              </div>
            </div>

            {/* Actual Cash (after close) */}
            {ledger.is_closed && (
              <div className="rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] p-6">
                <h3 className="text-[10px] uppercase tracking-widest text-[#15803d] mb-4 font-semibold">Actual Day Close Reconciliation</h3>
                <LedgerRow label="Opening Cash"              value={fmt(ledger.opening_cash || 0)} />
                <LedgerRow label="Total Cash Sales"          value={fmt(ledger.cash_sales || 0)} color="text-emerald-600" />
                <LedgerRow label="Bank Deposits Remitted"    value={fmt(ledger.bank_deposits_out || 0)} color="text-blue-600" />
                <LedgerRow label="Counted Closing Cash"      value={fmt(ledger.actual_cash || 0)} color="text-[#15803d]" large />
                <LedgerRow label="Expected Closing Cash"     value={fmt(ledger.expected_closing_cash || 0)} />
                <LedgerRow
                  label="Reconciliation Discrepancy"
                  value={`${(ledger.cash_difference || 0) >= 0 ? '+' : ''}${fmt(ledger.cash_difference || 0)} (${ledger.difference_status || 'matched'})`}
                  color={
                    ledger.difference_status === 'matched' ? 'text-emerald-600'
                    : ledger.difference_status === 'shortage' ? 'text-rose-600'
                    : 'text-amber-600'
                  }
                  border={false}
                />
                {ledger.difference_notes && (
                  <p className="mt-3 text-[11px] text-slate-500 bg-slate-900/[0.04] rounded-xl p-3 border border-slate-900/5">
                    Note: {ledger.difference_notes}
                  </p>
                )}
              </div>
            )}

            {/* Quick links */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Bank Deposit',  href: '/dashboard/branch-accounts/bank-deposit',  icon: PiggyBank },
                { label: 'Close Day',     href: '/dashboard/branch-accounts/daily-closing', icon: CheckCircle },
              ].map(({ label, href, icon: Icon }) => (
                <Link key={href} href={href}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 hover:bg-[#1ca34c]/5 transition-all text-center"
                >
                  <Icon className="w-4 h-4 text-[#15803d]" />
                  <span className="text-[10px] font-semibold text-slate-600">{label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
