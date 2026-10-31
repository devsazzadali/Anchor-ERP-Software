'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'

import StatsCard from '@/components/stats-card'
import { 
  DollarSign, Activity, 
  Search, SlidersHorizontal, ArrowDownToLine,
  RefreshCw, ShieldCheck, Clock, Building2, Wallet, TrendingUp, TrendingDown
} from 'lucide-react'
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, 
  ResponsiveContainer, CartesianGrid 
} from 'recharts'
import * as XLSX from 'xlsx'
import EmployeeDashboard from './EmployeeDashboard'

// identity resolves via /api/auth/me
// (the aura_session read below stays only as first-paint UI
// cache), the ledger via /api/me/financials, and the partner
// aggregates via /api/partner/overview.

export default function UserDashboard() {
  const [userName, setUserName] = useState('Client')
  const [userId, setUserId] = useState<string | null>(null)
  const [profileType, setProfileType] = useState<'partner' | 'employee' | 'head_office' | 'branch_manager' | null>(() => {
    try {
      if (typeof window !== 'undefined') {
        const s = localStorage.getItem('aura_session')
        if (s) {
          const parsed = JSON.parse(s)
          return parsed.profile?.profile_type || parsed.user?.profile_type || null
        }
      }
    } catch (e) {}
    return null
  })
  const [transactions, setTransactions] = useState<any[]>([])
  const [chartData, setChartData] = useState<{ name: string; volume: number }[]>([])
  const router = useRouter()
  
  // Table search and filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [methodFilter, setMethodFilter] = useState('all')
  const [activeLedgerTab, setActiveLedgerTab] = useState<'payout_request' | 'value_transfer'>('payout_request')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Partner: expense overview (read-only aggregate)
  const [partnerExpenseStats, setPartnerExpenseStats] = useState<{ total: number; paid: number; pending: number; branchCount: number }>({ total: 0, paid: 0, pending: 0, branchCount: 0 })
  // Partner: performance stats (sales, profit, loss from latest month)
  const [partnerPerfStats, setPartnerPerfStats] = useState<{ totalSales: number; totalProfit: number; totalLoss: number; latestMonth: string } | null>(null)
  // BUG-029 FIX: Track if userId resolution has timed out
  const [userIdTimeout, setUserIdTimeout] = useState(false)

  // Load session info
  useEffect(() => {
    const sessionStr = localStorage.getItem('aura_session')
    if (sessionStr) {
      try {
        const session = JSON.parse(sessionStr)
        setUserName(session.user?.full_name || 'Premium Client')
        setUserId(session.user?.id || null)
        if (session.profile?.profile_type) {
          setProfileType(session.profile.profile_type)
        }
      } catch (e) {
        // Fallback
      }
    }
  }, [])

  // Check from the API directly to prevent cached data issues
  // Removed automatic employee redirect; employee can now see sidebar navigation (no redirect)

  const fetchTransactions = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/me/financials')
      if (!res.ok) throw new Error('Failed to fetch financials')
      const { paymentRequests: payoutData, salaryPayments: salaryData } = await res.json()

      const formattedPayouts = (payoutData || []).map((t: any) => ({
        ...t,
        status: (t.status || 'pending').toLowerCase(),
        created_at: t.created_at || new Date().toISOString(),
        type: 'payout_request'
      }))

      const formattedSalaries = (salaryData || []).map((s: any) => ({
        id: s.id,
        invoice_title: 'Value Transfer / Direct Payment',
        invoice_number: `VT-${s.id.slice(0, 8).toUpperCase()}`,
        amount: s.amount,
        currency: 'BDT',
        payment_method: s.account || 'Direct Transfer',
        status: 'completed',
        transaction_id: s.transaction_id || 'N/A',
        created_at: s.payment_date || s.created_at || new Date().toISOString(),
        type: 'value_transfer'
      }))

      const combined = [...formattedPayouts, ...formattedSalaries].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )

      setTransactions(combined)

      // Build monthly chart data from actual data
      if (combined && combined.length > 0) {
        const monthlyMap: Record<string, number> = {}
        combined.forEach((t: any) => {
          const d = new Date(t.created_at || Date.now())
          if (isNaN(d.getTime())) return
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          monthlyMap[key] = (monthlyMap[key] || 0) + Number(t.amount || 0)
        })
        const chartArr = Object.entries(monthlyMap)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([key, volume]) => {
            const [y, m] = key.split('-')
            const name = new Date(Number(y), Number(m) - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' })
            return { name, volume }
          })
        setChartData(chartArr)
      }
    } catch (err: any) {
      console.error('Error fetching transactions:', err.message)
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (userId) {
      fetchTransactions()
      // Partner overview: /api/partner/overview returns the partner's
      // OWN expense requests only (FR-9 — personal payout details of
      // other employees are never partner-visible) plus company-wide
      // branch performance reports (a partner's legitimate view).
      if (profileType === 'partner') {
        fetch('/api/partner/overview')
          .then(res => res.ok ? res.json() : null)
          .then((overview: any) => {
            if (!overview) return
            const data = overview.expenseRequests
            if (data) {
              const total = data.reduce((s: number, r: any) => s + Number(r.amount), 0)
              const paid = data.filter((r: any) => r.status === 'paid').reduce((s: number, r: any) => s + Number(r.amount), 0)
              const pending = data.filter((r: any) => r.status === 'pending').length
              const branchCount = new Set(data.map((r: any) => r.branch_id).filter(Boolean)).size
              setPartnerExpenseStats({ total, paid, pending, branchCount })
            }

            // Fetch partner branch performance stats — ALL branches aggregated
            const reports = overview.performanceReports
            if (reports && reports.length > 0) {
              const totalSales  = reports.reduce((s: number, r: any) => s + Number(r.total_sales), 0)
              const totalProfit = reports.reduce((s: number, r: any) => s + Number(r.total_profit), 0)
              const totalLoss   = reports.reduce((s: number, r: any) => s + Number(r.total_loss), 0)
              const latestMonth = new Date(reports[0].report_month).toLocaleDateString('en-BD', { month: 'long', year: 'numeric' })
              setPartnerPerfStats({ totalSales, totalProfit, totalLoss, latestMonth })
            }
          }, console.error)
      }
    }
  }, [userId, fetchTransactions, profileType])

    // Real‑time subscription removed – data is fetched manually via fetchTransactions
// and can be refreshed with the Refresh button.

  // Also re-fetch when userId resolves from the API
  useEffect(() => {
    const initFromAuth = async () => {
      try {
        const res = await fetch('/api/auth/me')
        if (res.ok) {
          const me = await res.json()
          const user = me.user
          if (user && !userId) {
            setUserId(user.id)
          }
          if (me.profile) {
            if (me.profile.profile_type) setProfileType(me.profile.profile_type)
            if (me.profile.full_name) setUserName(me.profile.full_name)
          }
        }
      } catch (e) {}
    }
    initFromAuth()

    // BUG-029 FIX: If userId hasn't resolved after 10 seconds, show an error state
    const timeoutId = setTimeout(() => {
      setUserIdTimeout(true)
    }, 10000)
    return () => clearTimeout(timeoutId)
  }, [])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchTransactions()
    setIsRefreshing(false)
  }

  // Filters logic
  const filteredTransactions = transactions.filter((t) => {
    const matchesSearch = t.invoice_title?.toLowerCase().includes(search.toLowerCase()) || 
                          t.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
                          (t.transaction_id && t.transaction_id.toLowerCase().includes(search.toLowerCase()))
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter
    const matchesMethod = methodFilter === 'all' || t.payment_method === methodFilter
    const matchesTab = t.type === activeLedgerTab
    return matchesSearch && matchesStatus && matchesMethod && matchesTab
  })

  // Export to Excel using SheetJS
  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      filteredTransactions.map(t => ({
        'Invoice Title': t.invoice_title,
        'Invoice Reference': t.invoice_number,
        'Amount': `${t.amount} ${t.currency}`,
        'Payout Gateway': t.payment_method?.toUpperCase(),
        'Status': t.status?.toUpperCase(),
        'Transaction ID': t.transaction_id || 'N/A',
        'Submission Timestamp': new Date(t.created_at).toLocaleString()
      }))
    )
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'ANCHOR ERP Statement')
    XLSX.writeFile(wb, `ANCHOR-ERP-Statement-${Date.now()}.xlsx`)
  }

  // Stats Counters
  const totalValueTransfers = transactions
    .filter(t => t.type === 'value_transfer' && (t.status || '').toLowerCase() === 'completed')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0)

  const totalPayouts = transactions
    .filter(t => t.type === 'payout_request' && (t.status || '').toLowerCase() === 'completed')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0)

  const pendingCount = transactions.filter(t => (t.status || '').toLowerCase() === 'pending' && t.type === 'payout_request').length
  const processingCount = transactions.filter(t => (t.status || '').toLowerCase() === 'processing' && t.type === 'payout_request').length
  const totalRequestsCount = transactions.filter(t => t.type === 'payout_request').length


  // Branch Managers are strictly routed to the Branch Accounts Suite (No employee portal)
  useEffect(() => {
    if (profileType === 'branch_manager') {
      router.replace('/dashboard/branch-accounts')
    }
  }, [profileType, router])

  if (profileType === 'branch_manager') {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-white text-slate-900">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" />
          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
            Entering Branch Management...
          </span>
        </div>
      </div>
    )
  }

  // Regular employees & Corporate Head Office see Employee Dashboard
  if (profileType === 'employee' || profileType === 'head_office') {
    return (
      <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans">
        <div className="absolute top-[-5%] right-[-5%] w-[45%] h-[45%] bg-[#1ca34c]/3 rounded-full filter blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-5%] left-[20%] w-[50%] h-[50%] bg-[#10b981]/3 rounded-full filter blur-[150px] pointer-events-none" />
        {userId ? <EmployeeDashboard userId={userId} userName={userName} isBranchManager={false} /> : (
          <div className="flex-1 flex flex-col p-4 md:p-6 overflow-y-auto max-h-screen relative z-10 custom-scrollbar items-center justify-center">
            {userIdTimeout ? (
              // BUG-029 FIX: Show error after 10s timeout instead of infinite spin
              <>
                <span className="text-[10px] text-rose-600 uppercase tracking-widest font-bold">Session Error</span>
                <p className="text-xs text-slate-500 mt-2">Could not load user data. Please <a href="/" className="text-[#15803d] underline">sign in again</a>.</p>
              </>
            ) : (
              <>
                <div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin mb-4" />
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Loading Employee Data...</span>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full flex flex-col bg-white text-slate-900 font-sans relative overflow-hidden">
      
      {/* Glow Effects */}
      <div className="absolute top-[-5%] right-[-5%] w-[45%] h-[45%] bg-[#1ca34c]/3 rounded-full filter blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-5%] left-[20%] w-[50%] h-[50%] bg-[#10b981]/3 rounded-full filter blur-[150px] pointer-events-none" />

      {/* Main Core Dashboard panel */}
      <div className="flex-1 flex flex-col p-4 md:p-6 pb-24 relative z-10 w-full">
        
        {/* UPPER STATUS BAR */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-4 border-b border-slate-900/5">
          <div className="flex items-start gap-3">
            <span className="w-1.5 h-9 rounded-full bg-[#1ca34c] shrink-0" />
            <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Dossier Verified
              </span>
            </div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 font-serif">
              Welcome back, <span className="premium-text-gradient">{userName}</span>
            </h2>
            <p className="text-[11px] text-slate-500">Account tier: Anchor ERP Sovereign Client. Last active logs secure.</p>
            </div>
          </div>

          <div className="flex gap-3 w-full md:w-auto mt-2 md:mt-0">
            <button 
              onClick={handleRefresh}
              className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all cursor-pointer active:scale-95 flex-shrink-0 ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            
            {/* Quick action button */}
            <Link 
              href="/dashboard/payout"
              className="bg-[#1ca34c] hover:bg-[#15803d] text-white font-semibold px-4 py-2.5 rounded-full text-xs tracking-wider uppercase flex items-center justify-center gap-2 shadow-lg shadow-[#1ca34c]/10 flex-1 md:flex-none active:scale-95 transition-transform"
            >
              <span>Initiate Payout</span>
            </Link>
          </div>
        </div>

        {/* 4 STUNNING FLOATING CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5 mb-8">
          <StatsCard
            title="Total Value Transfer"
            value={`${totalValueTransfers.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BDT`}
            subtext="Directly Issued by Admin"
            icon={ShieldCheck}
            sparklineColor="emerald"
            sparklineData={chartData.map(d => d.volume)}
            trend={{ value: 'Completed', isPositive: true }}
          />
          <StatsCard
            title="Total Payouts"
            value={`${totalPayouts.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BDT`}
            subtext="Accepted & Paid Requests"
            icon={DollarSign}
            sparklineColor="gold"
            sparklineData={chartData.map(d => d.volume)}
            trend={{ value: 'Completed', isPositive: true }}
          />
          <StatsCard
            title="Pending Requests"
            value={`${pendingCount}`}
            subtext="Awaiting executive confirmation"
            icon={Clock}
            sparklineColor="amber"
            sparklineData={chartData.map(d => d.volume)}
            trend={{ value: `${pendingCount} active`, isPositive: pendingCount === 0 }}
          />
          <StatsCard
            title="Processing Liquidity"
            value={`${processingCount}`}
            subtext="Gateway execution active"
            icon={Activity}
            sparklineColor="rose"
            sparklineData={chartData.map(d => d.volume)}
          />
        </div>

        {/* Partner: Read-only Branch Expense Overview */}
        {profileType === 'partner' && (
          <div className="glass-panel p-4 md:p-5 rounded-2xl mb-8 relative shadow-xl overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#1ca34c]/15 to-transparent" />
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Read-Only Overview</span>
                <h3 className="text-sm font-bold text-slate-900 font-serif flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-[#15803d]" /> Branch Employee Expense Overview
                </h3>
              </div>
              <span className="text-[9px] px-2 py-1 rounded-full bg-slate-100 border border-slate-900/5 text-slate-500 font-bold uppercase tracking-wider">View Only</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-center">
                <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Total Requested</p>
                <p className="text-sm font-bold text-slate-900">{partnerExpenseStats.total.toLocaleString()} BDT</p>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-center">
                <p className="text-[9px] text-emerald-600 uppercase tracking-wider mb-1">Total Paid</p>
                <p className="text-sm font-bold text-emerald-600">{partnerExpenseStats.paid.toLocaleString()} BDT</p>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/10 text-center">
                <p className="text-[9px] text-amber-600 uppercase tracking-wider mb-1">Pending Count</p>
                <p className="text-sm font-bold text-amber-600">{partnerExpenseStats.pending}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-center">
                <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Active Branches</p>
                <p className="text-sm font-bold text-slate-900 flex items-center justify-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-slate-500" /> {partnerExpenseStats.branchCount}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Partner: Branch Performance Overview (Sales, Profit, Loss) */}
        {profileType === 'partner' && partnerPerfStats && (
          <div className="glass-panel p-4 md:p-5 rounded-2xl mb-8 relative shadow-xl overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/15 to-transparent" />
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Cumulative · All Time</span>
                <h3 className="text-sm font-bold text-slate-900 font-serif flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-600" /> Branch Performance Summary
                </h3>
                {/* FR-10/X5: source label — stored monthly snapshots, not a live recomputation */}
                <p className="text-[10px] text-slate-400 italic">Source: stored monthly snapshots (auto-synced from live ledgers).</p>
              </div>
              <span className="text-[9px] px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 font-bold uppercase tracking-wider">View Only</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-[#1ca34c]/5 border border-[#1ca34c]/10 text-center">
                <p className="text-[9px] text-[#15803d]/70 uppercase tracking-wider mb-1">Total Sales</p>
                <p className="text-sm font-bold text-[#15803d]">৳ {partnerPerfStats.totalSales.toLocaleString('en-BD')}</p>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-center">
                <p className="text-[9px] text-emerald-600 uppercase tracking-wider mb-1 flex items-center justify-center gap-1"><TrendingUp className="w-2.5 h-2.5" />Total Profit</p>
                <p className="text-sm font-bold text-emerald-600">৳ {partnerPerfStats.totalProfit.toLocaleString('en-BD')}</p>
              </div>
              <div className="p-3 rounded-xl bg-rose-500/5 border border-rose-500/10 text-center">
                <p className="text-[9px] text-rose-500 uppercase tracking-wider mb-1 flex items-center justify-center gap-1"><TrendingDown className="w-2.5 h-2.5" />Total Loss</p>
                <p className="text-sm font-bold text-rose-600">৳ {partnerPerfStats.totalLoss.toLocaleString('en-BD')}</p>
              </div>
            </div>
          </div>
        )}

        {/* FINANCIAL ANALYTICS AREA CHART */}
        <div className="glass-panel p-4 md:p-6 rounded-2xl mb-8 relative shadow-xl overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#1ca34c]/20 to-transparent" />
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Monthly Payout Flow Volume</span>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5 font-serif">
                Liquidity Allocations (BDT) 
                <span className="text-[9px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-1.5 py-0.5 rounded font-sans">Live Realtime</span>
              </h3>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#1ca34c]" />
                <span>Verified Transfers</span>
              </div>
            </div>
          </div>

          <div className="h-[240px] w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1ca34c" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#1ca34c" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,18,25,0.08)" vertical={false} />
                  <XAxis dataKey="name" stroke="rgba(15,18,25,0.45)" fontSize={10} tickLine={false} />
                  <YAxis stroke="rgba(15,18,25,0.45)" fontSize={10} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#ffffff', 
                      borderColor: 'rgba(15,18,25,0.1)',
                      borderRadius: '12px',
                      fontSize: '11px',
                      color: '#17181c'
                    }} 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="volume" 
                    stroke="#1ca34c" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#goldGradient)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-600 text-xs italic">
                {isLoading ? 'Loading payment data...' : 'No transaction data yet. Submit your first payout to see analytics.'}
              </div>
            )}
          </div>
        </div>

        {/* BANKING STATEMENT TRANSACTION LIST */}
        <div className="glass-panel p-4 md:p-6 rounded-2xl shadow-xl flex-1 flex flex-col justify-between overflow-hidden">
          <div className="flex flex-col gap-4 mb-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Ledger Statements</span>
                <h3 className="text-sm font-bold text-slate-900 font-serif">Historical Payout Records</h3>
              </div>

              {/* Tabs for Payout Requests vs Issue Value Transfer */}
              <div className="flex bg-slate-900/[0.04] border border-slate-900/5 rounded-xl p-1 w-full md:w-auto overflow-x-auto custom-scrollbar">
                <button
                  onClick={() => setActiveLedgerTab('payout_request')}
                  className={`flex-1 md:flex-none px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                    activeLedgerTab === 'payout_request'
                      ? 'bg-[#1ca34c] text-white shadow-lg shadow-[#1ca34c]/20'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04]'
                  }`}
                >
                  Payout Requests
                </button>
                <button
                  onClick={() => setActiveLedgerTab('value_transfer')}
                  className={`flex-1 md:flex-none px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                    activeLedgerTab === 'value_transfer'
                      ? 'bg-[#1ca34c] text-white shadow-lg shadow-[#1ca34c]/20'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04]'
                  }`}
                >
                  Value Transfers
                </button>
              </div>
            </div>

            {/* Table Filters controls */}
            <div className="flex flex-wrap items-center gap-3 w-full pt-4 border-t border-slate-900/5">
              
              {/* Search */}
              <div className="relative w-full sm:w-auto flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search invoice or TRX ID..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full sm:min-w-[200px] bg-slate-900/[0.04] border border-slate-900/5 hover:border-slate-900/10 rounded-xl py-2 pl-9 pr-3 text-[11px] placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all text-slate-900"
                />
              </div>

              {/* Status Selector */}
              <div className="relative w-full sm:w-auto flex-1 sm:flex-none">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full bg-white border border-slate-900/5 rounded-xl py-2 pl-3 pr-8 text-[11px] text-slate-500 focus:outline-none focus:border-[#1ca34c]/40 cursor-pointer appearance-none min-w-[120px]"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="accepted">Accepted</option>
                  <option value="processing">Processing</option>
                  <option value="completed">Completed</option>
                  <option value="rejected">Rejected</option>
                  <option value="hold">On Hold</option>
                </select>
                <SlidersHorizontal className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
              </div>

              {/* Method Selector */}
              <div className="relative w-full sm:w-auto flex-1 sm:flex-none">
                <select
                  value={methodFilter}
                  onChange={(e) => setMethodFilter(e.target.value)}
                  className="w-full bg-white border border-slate-900/5 rounded-xl py-2 pl-3 pr-8 text-[11px] text-slate-500 focus:outline-none focus:border-[#1ca34c]/40 cursor-pointer appearance-none min-w-[120px]"
                >
                  <option value="all">All Methods</option>
                  <option value="bkash">bKash</option>
                  <option value="nagad">Nagad</option>
                  <option value="rocket">Rocket</option>
                  <option value="bank_transfer">Bank</option>
                </select>
                <SlidersHorizontal className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
              </div>

              {/* Export Trigger */}
              <button 
                onClick={exportToExcel}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 hover:bg-slate-900/[0.04] text-[#15803d] hover:text-slate-900 transition-all cursor-pointer flex justify-center items-center gap-2 text-[11px] font-bold active:scale-95"
              >
                <ArrowDownToLine className="w-3.5 h-3.5" />
                <span>Export XLS</span>
              </button>
            </div>
          </div>

          {/* TABLE MARKUP */}
          <div className="overflow-x-auto w-full custom-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
            <table className="w-full min-w-[600px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-900/5 text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="pb-3.5 pl-2">Invoice Details</th>
                  <th className="pb-3.5">Method</th>
                  <th className="pb-3.5">Value (BDT)</th>
                  <th className="pb-3.5">Transfer Status</th>
                  <th className="pb-3.5">Gateway Reference</th>
                  <th className="pb-3.5 text-right pr-2">Logged Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/[0.08] text-xs">
                <AnimatePresence mode="popLayout">
                  {filteredTransactions.map((t) => {
                    const statusConfig = {
                      pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
                      accepted: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
                      processing: 'bg-[#1ca34c]/10 text-[#15803d] border-[#1ca34c]/20',
                      completed: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
                      rejected: 'bg-rose-500/10 text-rose-600 border-rose-500/20',
                      hold: 'bg-slate-100 text-slate-500 border-slate-300',
                      fraud_flagged: 'bg-red-900/20 text-red-600 border-red-500/20',
                    }[t.status as string] || 'bg-slate-100 text-slate-500 border-slate-300'

                    return (
                      <motion.tr 
                        key={t.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="hover:bg-slate-900/[0.04] transition-colors group"
                      >
                        <td className="py-4 pl-2 font-medium">
                          <div className="font-semibold text-slate-900 group-hover:text-[#15803d] transition-colors">{t.invoice_title}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{t.invoice_number}</div>
                        </td>
                        <td className="py-4 font-semibold text-slate-500 uppercase tracking-wide">
                          {t.payment_method === 'bank_transfer' ? 'Bank Transfer' : t.payment_method}
                        </td>
                        <td className="py-4 font-bold text-slate-900">
                          {Number(t.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {t.currency || 'BDT'}
                        </td>
                        <td className="py-4">
                          <span className={`px-2.5 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider ${statusConfig}`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="py-4 font-mono text-[10px] text-slate-500">
                          {t.transaction_id || <span className="text-slate-500 font-sans italic">Awaiting clearance...</span>}
                        </td>
                        <td className="py-4 text-right text-slate-500 text-[10px] pr-2">
                          {new Date(t.created_at).toLocaleDateString()}
                        </td>
                      </motion.tr>
                    )
                  })}

                  {filteredTransactions.length === 0 && !isLoading && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-500 text-xs italic">
                        {transactions.length === 0 
                          ? "No payment requests found. Click 'Initiate Payout' to submit your first invoice."
                          : "No transactions match your active filters."
                        }
                      </td>
                    </tr>
                  )}

                  {isLoading && transactions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-500 text-xs">
                        Loading payment records...
                      </td>
                    </tr>
                  )}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

        </div>

      </div>

    </div>
  )
}
