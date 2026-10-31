'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  LayoutDashboard, TrendingUp, Wallet, Building2,
  ArrowUpRight, ArrowDownRight, Clock, CheckCircle,
  XCircle, AlertTriangle, RefreshCw, ChevronRight,
  Banknote, CreditCard, PiggyBank, FileText, BarChart3
} from 'lucide-react'

import { useBranchAuth } from '@/lib/hooks/use-branch-auth'
import { fetchWithCache, getCachedData } from '@/lib/branch-cache'

function StatCard({
  title, value, sub, icon: Icon, color = 'gold', trend
}: {
  title: string
  value: string
  sub?: string
  icon: any
  color?: 'gold' | 'green' | 'red' | 'blue' | 'purple'
  trend?: 'up' | 'down' | 'neutral'
}) {
  const colorMap = {
    gold:   'from-[#1ca34c]/20 to-[#1ca34c]/5 border-[#1ca34c]/20 text-[#15803d]',
    green:  'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20 text-emerald-600',
    red:    'from-rose-500/20 to-rose-500/5 border-rose-500/20 text-rose-600',
    blue:   'from-blue-500/20 to-blue-500/5 border-blue-500/20 text-blue-600',
    purple: 'from-purple-500/20 to-purple-500/5 border-purple-500/20 text-purple-600',
  }
  return (
    <div className={`relative overflow-hidden rounded-3xl border bg-gradient-to-br p-5 ${colorMap[color]}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-slate-900/[0.04] ${colorMap[color].split(' ').pop()}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${
            trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-rose-600' : 'text-slate-500'
          }`}>
            {trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : trend === 'down' ? <ArrowDownRight className="w-3 h-3" /> : null}
          </div>
        )}
      </div>
      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">{title}</p>
      <p className="text-xl font-extrabold text-slate-900 tracking-tight">{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-1">{sub}</p>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft:            { label: 'Draft',            cls: 'bg-slate-500/20 text-slate-500 border-slate-500/30' },
    submitted:        { label: 'Submitted',        cls: 'bg-blue-500/20 text-blue-600 border-blue-500/30' },
    pending_approval: { label: 'Pending',          cls: 'bg-amber-500/20 text-amber-600 border-amber-500/30' },
    approved:         { label: 'Approved',         cls: 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30' },
    rejected:         { label: 'Rejected',         cls: 'bg-rose-500/20 text-rose-600 border-rose-500/30' },
    matched:          { label: 'Matched',          cls: 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30' },
    shortage:         { label: 'Shortage',         cls: 'bg-rose-500/20 text-rose-600 border-rose-500/30' },
    excess:           { label: 'Excess',           cls: 'bg-amber-500/20 text-amber-600 border-amber-500/30' },
  }
  const { label, cls } = map[status] || { label: status, cls: 'bg-slate-500/20 text-slate-500 border-slate-500/30' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest border ${cls}`}>
      {label}
    </span>
  )
}

const fmt = (n: any) => (Number(n || 0) < 0 ? '-' : '') + '৳' + Math.abs(Number(n || 0)).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default function BranchAccountsDashboard() {
  const router = useRouter()
  const { profile, ready } = useBranchAuth()

  // Instant SWR cache initialization
  const cachedDashboard = getCachedData('branch_dashboard', 60000)
  const cachedDeposits = getCachedData('branch_recent_deposits', 60000)

  const [dashboard, setDashboard] = useState<any>(cachedDashboard || null)
  const [recentDeposits, setRecentDeposits] = useState<any[]>(cachedDeposits?.deposits ? cachedDeposits.deposits.slice(0, 5) : [])
  const [isLoading, setIsLoading] = useState(!cachedDashboard)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDashboard = useCallback(async (forceRefresh = false) => {
    try {
      const json = await fetchWithCache(
        'branch_dashboard',
        async () => {
          const res = await fetch('/api/branch-accounts/dashboard')
          const data = await res.json()
          if (!res.ok) throw new Error(data.error)
          return data
        },
        {
          forceRefresh,
          ttlMs: 45000,
          onBackgroundUpdate: (fresh) => setDashboard(fresh),
        }
      )
      setDashboard(json)
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  const fetchRecentDeposits = useCallback(async (forceRefresh = false) => {
    try {
      const json = await fetchWithCache(
        'branch_recent_deposits',
        async () => {
          const res = await fetch('/api/branch-accounts/deposits?')
          const data = await res.json()
          if (res.ok) return data
          return { deposits: [] }
        },
        {
          forceRefresh,
          ttlMs: 45000,
          onBackgroundUpdate: (fresh) => setRecentDeposits((fresh.deposits || []).slice(0, 5)),
        }
      )
      if (json?.deposits) setRecentDeposits(json.deposits.slice(0, 5))
    } catch {}
  }, [])

  const init = useCallback(async () => {
    // If we have cache, don't show full-screen blocking loader
    if (!cachedDashboard) setIsLoading(true)
    await Promise.all([fetchDashboard(), fetchRecentDeposits()])
    setIsLoading(false)
  }, [cachedDashboard, fetchDashboard, fetchRecentDeposits])

  useEffect(() => {
    init()
  }, [init])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await Promise.all([fetchDashboard(true), fetchRecentDeposits(true)])
    setIsRefreshing(false)
  }

  if (isLoading && !dashboard) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const today = dashboard?.today || {}
  const monthly = dashboard?.monthly || {}

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[400px] bg-[#1ca34c]/3 rounded-full filter blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] bg-blue-500/3 rounded-full filter blur-[120px]" />
      </div>

      <div className="relative z-10 flex-1 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-[#1ca34c]/10 border border-[#1ca34c]/20 flex items-center justify-center">
                <Building2 className="w-4 h-4 text-[#15803d]" />
              </div>
              <span className="text-[10px] uppercase tracking-[0.3em] text-[#15803d]/70 font-semibold">
                Branch Accounts
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold font-serif text-slate-900">
              {profile?.branch || 'Branch'} Dashboard
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Welcome, <span className="text-slate-900 font-medium">{profile?.full_name}</span> —{' '}
              {new Date().toLocaleDateString('en-BD', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all cursor-pointer flex-shrink-0 ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {/* Today's KPI Cards */}
        <div className="mb-2">
          <h2 className="text-[10px] uppercase tracking-widest text-slate-500 mb-4 font-semibold">Today's Executive Summary (আজকের হিসাব)</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="Total Sales (মোট বিক্রি)"
            value={fmt((Number(today.cashSales || 0) + Number(today.bkashSales || 0) + Number(today.nagadSales || 0) + Number(today.rocketSales || 0) + Number(today.cardSales || 0) + Number(today.bankTransferSales || 0)))}
            sub={`Cash: ${fmt(today.cashSales || 0)}`}
            icon={TrendingUp}
            color="gold"
          />
          <StatCard
            title="Bank Deposits (ব্যাংকে জমা)"
            value={fmt(today.bankDepositsOut || 0)}
            sub="Ledger bank_deposits_out · today"
            icon={Building2}
            color="blue"
          />
          <StatCard
            title="Closing Cash (ড্রয়ার ক্যাশ)"
            value={today.isClosed ? fmt(today.actualCash) : fmt(today.expectedClosingCash)}
            sub={today.isClosed ? 'Counted physical cash' : 'Expected in hand'}
            icon={Wallet}
            color="green"
          />
          <StatCard
            title="Audit Status (হিসাব স্থিতি)"
            value={today.differenceStatus ? today.differenceStatus.charAt(0).toUpperCase() + today.differenceStatus.slice(1) : (today.isClosed ? 'Closed' : 'Open')}
            sub={today.isClosed ? (today.cashDifference ? `Diff: ${Number(today.cashDifference) >= 0 ? '+' : ''}${fmt(today.cashDifference)}` : 'Zero Discrepancy') : 'Pending day closing'}
            icon={today.differenceStatus === 'matched' || (!today.cashDifference && today.isClosed) ? CheckCircle : today.differenceStatus === 'shortage' ? XCircle : AlertTriangle}
            color={today.differenceStatus === 'matched' || (!today.cashDifference && today.isClosed) ? 'green' : today.differenceStatus === 'shortage' ? 'red' : 'gold'}
          />
        </div>

        {/* Digital Sales breakdown */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
          <StatCard title="bKash Sales"         value={fmt(today.bkashSales)}         icon={CreditCard} color="purple" sub="Direct to Wallet" />
          <StatCard title="Nagad Sales"         value={fmt(today.nagadSales)}         icon={CreditCard} color="purple" sub="Direct to Wallet" />
          <StatCard title="Rocket Sales"        value={fmt(today.rocketSales)}        icon={CreditCard} color="purple" sub="Direct to Wallet" />
          <StatCard title="Card Sales"          value={fmt(today.cardSales)}          icon={CreditCard} color="blue"   sub="Direct POS" />
          <StatCard title="Bank Transfer"       value={fmt(today.bankTransferSales)}  icon={CreditCard} color="blue"   sub="Direct Account" />
        </div>

        {/* Monthly Performance & Deposits */}
        <div className="mb-2">
          <h2 className="text-[10px] uppercase tracking-widest text-slate-500 mb-4 font-semibold">This Month — Financial Performance (মাসিক কর্মক্ষমতা)</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard title="MTD Total Gross Sales" value={fmt(monthly.totalSales || 0)}  icon={TrendingUp}  color="gold"   sub={`Cash: ${fmt(monthly.cashSales || 0)}`} />
          <StatCard title="Deposits (Ledger)"     value={fmt(monthly.approvedDeposits)} icon={CheckCircle} color="green"  sub="Σ ledger bank_deposits_out · this month (Dhaka) — the single deposits definition" />
          <StatCard title="Pending Approval"      value={fmt(monthly.pendingDeposits)}  icon={Clock}       color="blue"   sub={`${monthly.pendingCount || 0} pending`} />
          <StatCard title="Net Drawer Cash"       value={fmt(monthly.netCashInflow || monthly.netCash || 0)} icon={Wallet} color="purple" sub="Cash retained MTD" />
        </div>

        {/* Quick Actions */}
        <div className="mb-6">
          <h2 className="text-[10px] uppercase tracking-widest text-slate-500 mb-4 font-semibold">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Daily Closing',  href: '/dashboard/branch-accounts/daily-closing',  icon: CheckCircle,    desc: 'Close today\'s cash' },
              { label: 'Bank Deposit',   href: '/dashboard/branch-accounts/bank-deposit',   icon: PiggyBank,      desc: 'Submit a deposit' },
              { label: 'Cash Ledger',    href: '/dashboard/branch-accounts/cash-ledger',    icon: Wallet,         desc: 'Daily cash balance' },
              { label: 'Reconciliation', href: '/dashboard/branch-accounts/reconciliation', icon: BarChart3,      desc: 'Bank vs cash audit' },
              { label: 'Monthly Report', href: '/dashboard/branch-accounts/monthly-report', icon: FileText,      desc: 'View this month' },
            ].map(({ label, href, icon: Icon, desc }) => (
              <Link key={href} href={href}
                className="group p-4 rounded-2xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 hover:bg-[#1ca34c]/5 transition-all cursor-pointer"
              >
                <Icon className="w-5 h-5 text-[#15803d] mb-2 group-hover:scale-110 transition-transform" />
                <p className="text-xs font-semibold text-slate-900">{label}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{desc}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent Deposits */}
        {recentDeposits.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Recent Deposits</h2>
              <Link href="/dashboard/branch-accounts/deposit-history"
                className="text-[10px] text-[#15803d]/70 hover:text-[#15803d] flex items-center gap-1 transition-colors"
              >
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="rounded-2xl border border-slate-900/5 bg-slate-900/[0.04] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-900/5">
                      <th className="text-left p-4 text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Date</th>
                      <th className="text-left p-4 text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Amount</th>
                      <th className="text-left p-4 text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Bank</th>
                      <th className="text-left p-4 text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDeposits.map((dep: any) => (
                      <tr key={dep.id} className="border-b border-slate-900/[0.08] hover:bg-slate-900/[0.04] transition-colors">
                        <td className="p-4 text-slate-600">{dep.deposit_date}</td>
                        <td className="p-4 text-slate-900 font-semibold">{fmt(dep.amount)}</td>
                        <td className="p-4 text-slate-500 truncate max-w-[150px]">{dep.bank_account_name}</td>
                        <td className="p-4"><StatusBadge status={dep.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
