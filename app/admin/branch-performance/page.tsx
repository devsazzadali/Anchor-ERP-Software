'use client'

export const dynamic = 'force-dynamic'

/* eslint-disable react/no-unescaped-entities */
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TrendingUp, MapPin, ChevronRight, ArrowLeft,
  RefreshCw, Download, Loader2, Check, Banknote,
  AlertTriangle, TrendingDown, CalendarDays,
  FileSpreadsheet, FileText, ChevronDown, Percent, Zap,
  Calendar, Eye, ShieldCheck, CreditCard, Coins, Landmark, Calculator
} from 'lucide-react'
import { generatePdf } from '@/lib/pdf-generator'
import { generateExcel } from '@/lib/excel-generator'
import { useBranchAuth } from '@/lib/hooks/use-branch-auth'
import { fetchWithCache, getCachedData, setCachedData, invalidateBranchCache } from '@/lib/branch-cache'

const fmt = (n: number | null | undefined) =>
  '৳' + Number(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type Branch = { id: string; name: string }

type BranchPerformanceSummary = {
  branchId: string
  branchName: string
  reportMonth: string
  cashSales: number
  bkashSales: number
  nagadSales: number
  rocketSales: number
  cardSales: number
  bankTransferSales: number
  digitalSales: number
  totalSales: number
  otherCashIn: number
  grossCashInflow: number
  totalExpenses: number
  operatingProfit: number
  operatingLoss: number
  profitMargin: number
  approvedDeposits: number
  pendingDeposits: number
  netCash: number
  daysClosed: number
  daysTracked: number
  daysWithShortage: number
  totalCashDifference: number
}

type DailyLedgerRow = {
  branch_id: string
  ledger_date: string
  cash_sales: number
  bkash_sales: number
  nagad_sales: number
  rocket_sales: number
  card_sales: number
  bank_transfer_sales: number
  other_cash_in: number
  cash_expenses: number
  bank_deposits_out: number
  actual_cash: number
  expected_closing_cash: number
  cash_difference: number
  difference_status: string
  is_closed: boolean
}

type LivePerformanceReportResponse = {
  year: number
  month: number
  fromDate: string
  toDate: string
  summary: {
    totalCashSales: number
    totalDigitalSales: number
    totalSales: number
    totalOtherCashIn: number
    grossCashInflow: number
    totalExpenses: number
    totalApprovedDeposits: number
    totalPendingDeposits: number
    netCash: number
    totalOperatingProfit: number
    totalOperatingLoss: number
    overallProfitMargin: number
    daysTracked: number
    daysClosed: number
    daysWithShortage: number
    daysWithExcess: number
    totalCashDifference: number
  }
  branches: BranchPerformanceSummary[]
  dailyLedger: DailyLedgerRow[]
  deposits: any[]
  expenses: any[]
}

export default function AdminBranchPerformancePage() {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const { user, isAdmin, isAuthorized, isLoading: isAuthLoading } = useBranchAuth()

  // Live period state (default to current year-month YYYY-MM)
  const currentMonthString = useMemo(() => new Date().toISOString().slice(0, 7), [])
  const [selectedMonth, setSelectedMonth]   = useState<string>(currentMonthString)
  const [searchQuery, setSearchQuery]       = useState('')

  // URL-driven selected branch
  const branchParam    = searchParams?.get('branch') ?? null

  const perfCacheKey = `admin_perf_${currentMonthString}_${branchParam || 'all'}`
  const [branches, setBranches]             = useState<Branch[]>(() => getCachedData('admin_branches') || [])
  const [branchesLoaded, setBranchesLoaded] = useState(() => !!getCachedData('admin_branches'))
  const [liveData, setLiveData]             = useState<LivePerformanceReportResponse | null>(() => getCachedData(perfCacheKey) || null)
  const [isLoading, setIsLoading]           = useState(() => !getCachedData(perfCacheKey))
  const [isRefreshing, setIsRefreshing]     = useState(false)
  const [adminName, setAdminName]           = useState((user as any)?.user_metadata?.full_name || 'Admin')

  const selectedBranch = useMemo<Branch | null>(() => {
    if (!branchParam || !branchesLoaded) return null
    return branches.find(b => b.id === branchParam) ?? null
  }, [branchParam, branches, branchesLoaded])

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [isExporting, setIsExporting]       = useState(false)

  // ─── Auth ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthLoading && !isAdmin) {
      router.replace('/dashboard')
    }
  }, [isAuthLoading, isAdmin, router])

  // ─── Navigation helpers ───────────────────────────────────────────────────
  const goToBranch = (branch: Branch | null) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    if (branch) { params.set('branch', branch.id) } else { params.delete('branch') }
    router.push(pathname + '?' + params.toString())
  }

  // ─── Fetch Branches ───────────────────────────────────────────────────────
  const fetchBranches = useCallback(async () => {
    try {
      const cached = getCachedData('admin_branches')
      if (cached) setBranches(cached)
      const res = await fetch('/api/branch-accounts/branches')
      const json = res.ok ? await res.json() : null
      const data = json?.branches
      if (data) {
        setBranches(data)
        setBranchesLoaded(true)
        setCachedData('admin_branches', data, 120000)
      }
    } catch {}
  }, [])

  // ─── Fetch Live Automated Performance Data ────────────────────────────────
  const fetchLivePerformance = useCallback(async (monthStr?: string, bId?: string | null) => {
    const targetMonth = monthStr || selectedMonth || currentMonthString
    const [yr, mo] = targetMonth.split('-')
    const targetBranchId = bId || (selectedBranch ? selectedBranch.id : 'all')

    try {
      const queryParams = new URLSearchParams({
        year: yr,
        month: String(parseInt(mo, 10)),
        branch_id: targetBranchId || 'all'
      })
      const cacheKey = `admin_perf_${targetMonth}_${targetBranchId || 'all'}`
      const json = await fetchWithCache(
        cacheKey,
        `/api/branch-accounts/reports/monthly?${queryParams.toString()}`,
        {
          ttlMs: 60000,
          onBackgroundUpdate: (fresh) => {
            if (fresh) setLiveData(fresh)
          }
        }
      )
      if (json) setLiveData(json)
    } catch (err: any) {
      console.error('Error fetching performance analytics:', err)
      setFeedback({ type: 'error', message: err.message || 'Failed to fetch performance analytics' })
    }
  }, [selectedMonth, currentMonthString, selectedBranch])

  useEffect(() => {
    if (!isAdmin) return
    fetchBranches()
    const targetBranchId = selectedBranch ? selectedBranch.id : 'all'
    const cacheKey = `admin_perf_${selectedMonth}_${targetBranchId}`
    const cached = getCachedData(cacheKey)
    if (cached) {
      setLiveData(cached)
      setIsLoading(false)
    }
    fetchLivePerformance(selectedMonth, selectedBranch?.id || null).finally(() => {
      setIsLoading(false)
    })
  }, [isAdmin, selectedMonth, selectedBranch, fetchBranches, fetchLivePerformance])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    invalidateBranchCache(`admin_perf_${selectedMonth}`)
    await fetchLivePerformance(selectedMonth, selectedBranch?.id || null)
    setIsRefreshing(false)
    setFeedback({ type: 'success', message: 'Performance metrics synchronized with live daily ledgers.' })
    setTimeout(() => setFeedback(null), 3000)
  }

  // ─── Computed Filtered Branch Summaries ───────────────────────────────────
  const filteredBranchSummaries = useMemo(() => {
    if (!liveData?.branches) return []
    return liveData.branches.filter(b => {
      const matchesSearch = !searchQuery || b.branchName.toLowerCase().includes(searchQuery.toLowerCase().trim())
      return matchesSearch
    })
  }, [liveData, searchQuery])

  // Overall statistics for the selected period
  const overallStats = useMemo(() => {
    if (!liveData?.summary) {
      return {
        totalSales: 0,
        totalCashSales: 0,
        totalDigitalSales: 0,
        totalExpenses: 0,
        netSurplus: 0,
        totalApprovedDeposits: 0,
        totalClosingCash: 0,
        daysClosed: 0,
        branchesCount: 0
      }
    }
    const s = liveData.summary
    const net = Number(s.totalSales || 0) - Number(s.totalExpenses || 0)
    return {
      totalSales: s.totalSales,
      totalCashSales: s.totalCashSales || 0,
      totalDigitalSales: s.totalDigitalSales || 0,
      totalExpenses: s.totalExpenses,
      netSurplus: net,
      totalApprovedDeposits: s.totalApprovedDeposits,
      totalClosingCash: s.netCash,
      daysClosed: s.daysClosed,
      branchesCount: liveData.branches.length
    }
  }, [liveData])

  // Drill-down data for single branch
  const activeBranchSummary = useMemo<BranchPerformanceSummary | null>(() => {
    if (!selectedBranch || !liveData?.branches) return null
    return liveData.branches.find(b => b.branchId === selectedBranch.id) || null
  }, [selectedBranch, liveData])

  const activeBranchLedger = useMemo<DailyLedgerRow[]>(() => {
    if (!selectedBranch || !liveData?.dailyLedger) return []
    return liveData.dailyLedger.filter(r => r.branch_id === selectedBranch.id)
  }, [selectedBranch, liveData])

  // Status helper
  const getBranchAuditStatus = (b: BranchPerformanceSummary) => {
    if (b.totalSales === 0 && b.daysClosed === 0) {
      return { label: '— No Activity', color: 'text-slate-500 bg-slate-100 border-slate-700/50' }
    }
    if (b.daysWithShortage > 0) {
      return { label: `⚠️ Shortage (${b.daysWithShortage}d)`, color: 'text-rose-600 bg-rose-500/10 border-rose-500/20' }
    }
    if (b.totalCashDifference > 0) {
      return { label: `🔹 Excess (+${fmt(b.totalCashDifference)})`, color: 'text-amber-600 bg-amber-500/10 border-amber-500/20' }
    }
    return { label: '✓ Balanced', color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20' }
  }

  // ─── Multi-Format Exports (Official PDF, Excel, CSV) ──────────────────────
  const handleExport = async (format: 'pdf' | 'excel' | 'csv') => {
    const isSingle = !!selectedBranch && !!activeBranchSummary
    const scopeName = isSingle ? selectedBranch!.name : 'All Branches'

    if (format === 'pdf') {
      setIsExporting(true)
      setShowExportMenu(false)

      try {
        if (isSingle && activeBranchSummary) {
          const columns = ['#', 'Date', 'Cash Sales', 'Digital Sales', 'Expenses', 'Bank Deposits Out', 'Closing Cash', 'Status']
          const rows: (string | number)[][] = activeBranchLedger.map((r, idx) => {
            const digital = Number(r.bkash_sales || 0) + Number(r.nagad_sales || 0) + Number(r.rocket_sales || 0) + Number(r.card_sales || 0) + Number(r.bank_transfer_sales || 0)
            return [
              idx + 1,
              r.ledger_date,
              Number(r.cash_sales).toLocaleString('en-BD'),
              digital.toLocaleString('en-BD'),
              Number(r.cash_expenses).toLocaleString('en-BD'),
              Number(r.bank_deposits_out).toLocaleString('en-BD'),
              Number(r.actual_cash).toLocaleString('en-BD'),
              r.difference_status === 'shortage' ? `Shortage (${fmt(Math.abs(r.cash_difference))})` : r.difference_status === 'excess' ? `Excess (${fmt(r.cash_difference)})` : 'Balanced'
            ]
          })

          await generatePdf(
            'Branch Performance Statement',
            columns,
            rows,
            {
              filename: `${scopeName.replace(/\s+/g, '_')}_Performance_${selectedMonth}.pdf`,
              branch: scopeName,
              subtitle: `INDIVIDUAL STORE REVENUE & AUDIT STATEMENT (${selectedMonth})`,
              preparedBy: adminName,
              dateRange: selectedMonth,
              summaryData: [
                { label: 'Store Scope', value: scopeName },
                { label: 'Total Sales Revenue', value: `${activeBranchSummary.totalSales.toLocaleString('en-BD')} BDT` },
                { label: 'Branch Operating Expenses', value: `${activeBranchSummary.totalExpenses.toLocaleString('en-BD')} BDT` },
                { label: 'Net Collection Surplus', value: `${(activeBranchSummary.totalSales - activeBranchSummary.totalExpenses).toLocaleString('en-BD')} BDT` },
                { label: 'Bank Remitted', value: `${activeBranchSummary.approvedDeposits.toLocaleString('en-BD')} BDT` },
                { label: 'Closing Cash Retained', value: `${activeBranchSummary.netCash.toLocaleString('en-BD')} BDT` }
              ],
              notes: 'Official Anchor Fashion ERP Analytics. Figures aggregated automatically from verified daily cash ledgers, bank deposits, and expenses.'
            }
          )
        } else {
          const columns = ['#', 'Branch Name', 'Period', 'Total Revenue (BDT)', 'Expenses (BDT)', 'Net Surplus (BDT)', 'Bank Deposits (BDT)', 'Closing Cash (BDT)', 'Audit Status']
          const rows: (string | number)[][] = filteredBranchSummaries.map((b, idx) => [
            idx + 1,
            b.branchName,
            selectedMonth,
            Number(b.totalSales).toLocaleString('en-BD'),
            Number(b.totalExpenses).toLocaleString('en-BD'),
            (b.totalSales - b.totalExpenses).toLocaleString('en-BD'),
            Number(b.approvedDeposits).toLocaleString('en-BD'),
            Number(b.netCash).toLocaleString('en-BD'),
            getBranchAuditStatus(b).label
          ])

          await generatePdf(
            'Network Branch Performance Statement',
            columns,
            rows,
            {
              filename: `Network_Performance_${selectedMonth}.pdf`,
              branch: 'All Branches',
              subtitle: `NETWORK STORE REVENUE & CASH AUDIT STATEMENT (${selectedMonth})`,
              preparedBy: adminName,
              dateRange: selectedMonth,
              summaryData: [
                { label: 'Reporting Period', value: selectedMonth },
                { label: 'Total Network Sales', value: `${overallStats.totalSales.toLocaleString('en-BD')} BDT` },
                { label: 'Total Branch Expenses', value: `${overallStats.totalExpenses.toLocaleString('en-BD')} BDT` },
                { label: 'Net Collection Surplus', value: `${overallStats.netSurplus.toLocaleString('en-BD')} BDT` },
                { label: 'Total Bank Remitted', value: `${overallStats.totalApprovedDeposits.toLocaleString('en-BD')} BDT` },
                { label: 'Total Closing Cash', value: `${overallStats.totalClosingCash.toLocaleString('en-BD')} BDT` }
              ],
              notes: 'Official Anchor Fashion ERP Analytics. Figures aggregated automatically from verified daily cash ledgers, bank deposits, and expenses.'
            }
          )
        }
      } catch (err: any) {
        setFeedback({ type: 'error', message: err.message || 'Failed to generate PDF' })
      } finally {
        setIsExporting(false)
      }
    } else if (format === 'excel') {
      setShowExportMenu(false)
      if (isSingle && activeBranchSummary) {
        const columns = ['SL', 'Date', 'Cash Sales (BDT)', 'Digital Sales (BDT)', 'Expenses (BDT)', 'Bank Deposits Out (BDT)', 'Closing Cash (BDT)', 'Audit Status']
        const rows = activeBranchLedger.map((r, idx) => {
          const digital = Number(r.bkash_sales || 0) + Number(r.nagad_sales || 0) + Number(r.rocket_sales || 0) + Number(r.card_sales || 0) + Number(r.bank_transfer_sales || 0)
          return [
            idx + 1,
            r.ledger_date,
            Number(r.cash_sales),
            digital,
            Number(r.cash_expenses),
            Number(r.bank_deposits_out),
            Number(r.actual_cash),
            r.difference_status || 'balanced'
          ]
        })
        generateExcel(
          'Branch Performance Ledger',
          columns,
          rows,
          {
            filename: `${scopeName.replace(/\s+/g, '_')}_Performance_${selectedMonth}.xlsx`,
            sheetName: 'Branch Performance'
          }
        )
      } else {
        const columns = ['SL', 'Branch Name', 'Reporting Period', 'Total Revenue (BDT)', 'Expenses (BDT)', 'Net Surplus (BDT)', 'Bank Deposits (BDT)', 'Closing Cash (BDT)', 'Audit Status']
        const rows = filteredBranchSummaries.map((b, idx) => [
          idx + 1,
          b.branchName,
          selectedMonth,
          Number(b.totalSales),
          Number(b.totalExpenses),
          b.totalSales - b.totalExpenses,
          Number(b.approvedDeposits),
          Number(b.netCash),
          getBranchAuditStatus(b).label
        ])
        const totals = [
          'TOTAL', '', '',
          overallStats.totalSales,
          overallStats.totalExpenses,
          overallStats.netSurplus,
          overallStats.totalApprovedDeposits,
          overallStats.totalClosingCash,
          ''
        ]
        generateExcel(
          'Network Branch Performance Statement',
          columns,
          rows,
          {
            filename: `Network_Performance_${selectedMonth}.xlsx`,
            sheetName: 'Performance',
            meta: [
              { key: 'PERIOD', value: selectedMonth },
              { key: 'TOTAL SALES REVENUE', value: `${overallStats.totalSales.toLocaleString('en-BD')} BDT` },
              { key: 'BRANCH EXPENSES', value: `${overallStats.totalExpenses.toLocaleString('en-BD')} BDT` },
              { key: 'NET REVENUE SURPLUS', value: `${overallStats.netSurplus.toLocaleString('en-BD')} BDT` },
              { key: 'BANK DEPOSITS REMITTED', value: `${overallStats.totalApprovedDeposits.toLocaleString('en-BD')} BDT` },
              { key: 'CLOSING CASH RETAINED', value: `${overallStats.totalClosingCash.toLocaleString('en-BD')} BDT` }
            ],
            totals
          }
        )
      }
    } else if (format === 'csv') {
      setShowExportMenu(false)
      const headers = ['SL', 'Branch Name', 'Reporting Month', 'Total Revenue', 'Expenses', 'Net Surplus', 'Bank Deposits', 'Closing Cash', 'Audit Status']
      const csvRows = filteredBranchSummaries.map((b, idx) => [
        idx + 1,
        `"${b.branchName.replace(/"/g, '""')}"`,
        `"${selectedMonth}"`,
        b.totalSales,
        b.totalExpenses,
        b.totalSales - b.totalExpenses,
        b.approvedDeposits,
        b.netCash,
        `"${getBranchAuditStatus(b).label}"`
      ])
      const csvContent = [headers.join(','), ...csvRows.map(row => row.join(','))].join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Branch_Performance_${selectedMonth}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  // ─── Loading screen ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Ambient background glows */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[400px] bg-[#d4af37]/4 rounded-full filter blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[350px] bg-emerald-500/3 rounded-full filter blur-[140px]" />
      </div>

      <div className="relative z-10 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-6 border-b border-slate-900/5">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" /> Branch Revenue & Operations Analytics
              </span>
              <span className="text-[10px] bg-indigo-500/10 text-indigo-600 border border-indigo-500/20 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider inline-flex items-center gap-1">
                <Zap className="w-3 h-3 text-indigo-600" /> Fully Automated Ledger Engine
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-serif">
              Branch Performance &amp; Revenue Reports
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Monthly sales revenue, branch operating expenses, net collections surplus, and drawer-to-bank cash reconciliation
            </p>
          </div>

          <div className="flex items-center gap-3 self-stretch sm:self-auto">
            {/* Export Dropdown */}
            <div className="relative flex-1 sm:flex-initial">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={isExporting}
                className="w-full sm:w-auto bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/30 text-slate-600 hover:text-slate-900 px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
              >
                <Download className="w-3.5 h-3.5 text-[#8a6d1f]" />
                <span>{isExporting ? 'Exporting...' : 'Export'}</span>
                <ChevronDown className="w-3 h-3 text-slate-500" />
              </button>

              <AnimatePresence>
                {showExportMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    className="absolute right-0 mt-2 w-48 bg-white border border-slate-900/15 rounded-xl shadow-2xl overflow-hidden z-30"
                  >
                    <button
                      onClick={() => handleExport('pdf')}
                      className="w-full px-4 py-2.5 text-left text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.04] flex items-center gap-2.5 transition-colors cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-[#8a6d1f]" /> Export PDF (Official)
                    </button>
                    <button
                      onClick={() => handleExport('excel')}
                      className="w-full px-4 py-2.5 text-left text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.04] flex items-center gap-2.5 transition-colors cursor-pointer border-t border-slate-900/5"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Export Excel (.xlsx)
                    </button>
                    <button
                      onClick={() => handleExport('csv')}
                      className="w-full px-4 py-2.5 text-left text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.04] flex items-center gap-2.5 transition-colors cursor-pointer border-t border-slate-900/5"
                    >
                      <Download className="w-4 h-4 text-blue-600" /> Export CSV (.csv)
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Live Refresh Button */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={`p-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/30 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'opacity-50' : ''}`}
              title="Refresh Analytics"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#8a6d1f]' : ''}`} />
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        <AnimatePresence>
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`mb-6 px-4 py-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2.5 ${feedback.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' : 'bg-rose-500/10 border-rose-500/20 text-rose-600'}`}
            >
              {feedback.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              {feedback.message}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 4-KPI Overview Cards Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="p-5 rounded-2xl border border-[#d4af37]/20 bg-[#d4af37]/5">
            <div className="flex items-center justify-between mb-2">
              <Banknote className="w-5 h-5 text-[#8a6d1f]" />
              <span className="text-[9px] font-bold text-[#8a6d1f]/80 uppercase tracking-widest">Revenue</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Total Gross Sales (মোট বিক্রি)</p>
            <p className="text-xl sm:text-2xl font-bold font-serif text-[#8a6d1f]">{fmt(overallStats.totalSales)}</p>
            <p className="text-[10px] text-slate-500 mt-1">
              Pure Cash + Digital Collections
            </p>
          </div>

          <div className="p-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              <span className="text-[9px] font-bold text-emerald-600/80 uppercase tracking-widest">Collections</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Net Sales After Expenses</p>
            <p className="text-xl sm:text-2xl font-bold font-serif text-emerald-600">{fmt(overallStats.netSurplus)}</p>
            <p className="text-[10px] text-slate-500 mt-1">
              Gross Sales minus Store Expenses
            </p>
          </div>

          <div className="p-5 rounded-2xl border border-blue-500/20 bg-blue-500/5">
            <div className="flex items-center justify-between mb-2">
              <Landmark className="w-5 h-5 text-blue-600" />
              <span className="text-[9px] font-bold text-blue-600/80 uppercase tracking-widest">Remittance</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Bank Remitted (ব্যাংক জমা)</p>
            <p className="text-xl sm:text-2xl font-bold font-serif text-blue-600">{fmt(overallStats.totalApprovedDeposits)}</p>
            <p className="text-[10px] text-slate-500 mt-1">
              Approved deposits in corporate accounts
            </p>
          </div>

          <div className="p-5 rounded-2xl border border-amber-500/20 bg-amber-500/5">
            <div className="flex items-center justify-between mb-2">
              <Coins className="w-5 h-5 text-amber-600" />
              <span className="text-[9px] font-bold text-amber-600/80 uppercase tracking-widest">Drawer Float</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Closing Cash Retained (ড্রয়ার ক্যাশ)</p>
            <p className="text-xl sm:text-2xl font-bold font-serif text-amber-600">
              {fmt(overallStats.totalClosingCash)}
            </p>
            <p className="text-[10px] text-slate-500 font-semibold mt-0.5">
              Across {overallStats.daysClosed} closed store days
            </p>
          </div>
        </div>

        {/* KPI Reconciliation Breakdown */}
        <div className="mb-8 p-5 rounded-2xl border border-slate-900/10 bg-slate-900/[0.04]">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-4 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-emerald-600" /> Executive Reconciliation Breakdown
          </h3>
          <div className="font-mono text-sm space-y-2 max-w-md text-slate-600">
            <div className="flex justify-between"><span>Gross Revenue (Cash + Digital)</span> <span>{fmt(overallStats.totalSales)}</span></div>
            <div className="flex justify-between text-slate-500 pl-4 text-xs"><span>↳ Cash Sales</span> <span>{fmt(overallStats.totalCashSales)}</span></div>
            <div className="flex justify-between text-slate-500 pl-4 text-xs"><span>↳ Digital Sales (Direct to Corporate)</span> <span>{fmt(overallStats.totalDigitalSales)}</span></div>
            <div className="flex justify-between text-rose-600 pt-2"><span>Less: Store Expenses</span> <span>- {fmt(overallStats.totalExpenses)}</span></div>
            <div className="flex justify-between border-t border-slate-900/10 pt-2 font-bold text-slate-900"><span>Net Revenue (After Expenses)</span> <span>{fmt(overallStats.netSurplus)}</span></div>
            
            <div className="mt-4 pt-4 border-t border-slate-900/10"></div>
            
            <div className="flex justify-between text-emerald-600"><span>Net Physical Cash Generated (Cash - Exp)</span> <span>{fmt(overallStats.totalCashSales - overallStats.totalExpenses)}</span></div>
            <div className="flex justify-between text-blue-600"><span>Less: Physical Bank Deposits</span> <span>- {fmt(overallStats.totalApprovedDeposits)}</span></div>
            <div className="flex justify-between border-t border-slate-900/10 pt-2 font-bold text-amber-600" title="Cash generated during the selected period after physical expenses and bank deposits. Opening cash is excluded.">
              <span>Pending Remittance</span>
              <span>{fmt((overallStats.totalCashSales - overallStats.totalExpenses) - overallStats.totalApprovedDeposits)}</span>
            </div>
            {/* B52: the period derivation above and the counted
                closing cash below measure different things — they
                differ by the opening floats branches started with
                plus counted surpluses/shortages. Show that bridge
                explicitly instead of leaving two disagreeing figures
                side by side unexplained. */}
            <div className="flex justify-between text-slate-500">
              <span>Add: Opening Floats & Counted Differences (bridge)</span>
              <span>{fmt(overallStats.totalClosingCash - ((overallStats.totalCashSales - overallStats.totalExpenses) - overallStats.totalApprovedDeposits))}</span>
            </div>
            <div className="flex justify-between border-t border-slate-900/10 pt-2 font-bold text-amber-600">
              <span>Closing Cash Retained (counted, latest closed day per branch)</span>
              <span>{fmt(overallStats.totalClosingCash)}</span>
            </div>
            <p className="text-[10px] text-slate-500 font-sans mt-2 italic">* Note: Digital sales are deposited directly to corporate and are never held in the physical cash drawer. Pending Remittance is period-derived (opening float excluded); Closing Cash Retained is the counted drawer snapshot — the bridge line above is exactly the difference between the two.</p>
          </div>
        </div>

        {/* Live Period & Branch Search Toolbar */}
        <div className="mb-6 p-4 rounded-2xl border border-slate-900/10 bg-slate-900/[0.04] flex flex-col md:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <TrendingUp className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search branch name in performance table..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl py-2.5 pl-10 pr-3.5 text-xs text-slate-900 placeholder-slate-500 focus:outline-none focus:border-emerald-500/40 w-full transition-colors"
            />
          </div>

          <div className="relative w-full md:w-56">
            <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8a6d1f] pointer-events-none" />
            <input
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="bg-white border border-slate-900/15 rounded-xl py-2.5 pl-10 pr-3.5 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 w-full [color-scheme:light] transition-colors cursor-pointer font-mono font-bold"
            />
          </div>

          {(searchQuery || selectedMonth !== currentMonthString) && (
            <button
              onClick={() => { setSearchQuery(''); setSelectedMonth(currentMonthString) }}
              className="px-3.5 py-2.5 rounded-xl bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-500 hover:text-slate-900 text-xs font-semibold transition-all cursor-pointer whitespace-nowrap"
            >
              Reset Period
            </button>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            VIEW A — BRANCH OVERVIEW (All branches - Live Automated Engine)
        ═══════════════════════════════════════════════════════════════════ */}
        {!selectedBranch && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-900/10 bg-slate-900/[0.04] overflow-hidden shadow-xl">
              <div className="p-4 sm:p-5 border-b border-slate-900/10 bg-slate-900/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Branch Revenue &amp; Collections Overview ({filteredBranchSummaries.length} Branches)
                  </p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 font-mono font-bold">
                    {selectedMonth}
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  Click any branch to view day-by-day cash &amp; deposit audit
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-900/10 bg-slate-900/[0.04]">
                      {['Branch Name', 'Days Closed', 'Total Sales (৳)', 'Expenses (৳)', 'Net Surplus (৳)', 'Bank Remitted (৳)', 'Closing Cash (৳)', 'Audit Status', 'Action'].map((h, i) => (
                        <th
                          key={h}
                          className={`p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap ${
                            i === 0 ? 'text-left' : i === 1 ? 'text-center' : i >= 2 && i <= 6 ? 'text-right' : i === 7 ? 'text-center' : 'text-right'
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/[0.08]">
                    {filteredBranchSummaries.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="text-center py-16 text-slate-500">
                          <TrendingUp className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                          <p>No performance data found for {selectedMonth}.</p>
                        </td>
                      </tr>
                    ) : (
                      filteredBranchSummaries.map(b => {
                        const netSurplus = b.totalSales - b.totalExpenses
                        const auditStatus = getBranchAuditStatus(b)

                        return (
                          <tr
                            key={b.branchId}
                            onClick={() => goToBranch({ id: b.branchId, name: b.branchName })}
                            className="hover:bg-slate-900/[0.04] transition-colors cursor-pointer group"
                          >
                            <td className="p-3.5 whitespace-nowrap">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 group-hover:scale-105 transition-transform">
                                  <MapPin className="w-3.5 h-3.5" />
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-900 group-hover:text-emerald-600 transition-colors">
                                    {b.branchName}
                                  </span>
                                  <p className="text-[10px] text-slate-500">
                                    Cash: {fmt(b.cashSales)} | Digital: {fmt(b.digitalSales)}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="p-3.5 text-center font-mono whitespace-nowrap">
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                {b.daysClosed} days
                              </span>
                            </td>
                            <td className="p-3.5 text-right font-serif font-bold text-[#8a6d1f] whitespace-nowrap">
                              {fmt(b.totalSales)}
                            </td>
                            <td className="p-3.5 text-right font-serif font-bold text-rose-600 whitespace-nowrap">
                              {fmt(b.totalExpenses)}
                            </td>
                            <td className="p-3.5 text-right font-serif font-bold text-emerald-600 whitespace-nowrap">
                              {fmt(netSurplus)}
                            </td>
                            <td className="p-3.5 text-right font-serif font-bold text-blue-600 whitespace-nowrap">
                              {fmt(b.approvedDeposits)}
                            </td>
                            <td className="p-3.5 text-right font-serif font-bold text-amber-600 whitespace-nowrap">
                              {fmt(b.netCash)}
                            </td>
                            <td className="p-3.5 text-center whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${auditStatus.color}`}>
                                {auditStatus.label}
                              </span>
                            </td>
                            <td className="p-3.5 text-right whitespace-nowrap">
                              <span className="px-3 py-1.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 group-hover:border-emerald-500/40 text-slate-600 group-hover:text-slate-900 text-xs font-semibold inline-flex items-center gap-1 transition-all">
                                Detailed Audit <ChevronRight className="w-3 h-3 text-slate-500 group-hover:text-emerald-600 transition-colors" />
                              </span>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                  {filteredBranchSummaries.length > 0 && (
                    <tfoot className="border-t-2 border-slate-900/15 bg-slate-900/[0.04]">
                      <tr className="font-bold text-xs">
                        <td colSpan={2} className="p-3.5 text-left uppercase tracking-wider text-slate-600 font-mono">
                          NETWORK TOTALS ({filteredBranchSummaries.length} Branches)
                        </td>
                        <td className="p-3.5 text-right font-serif font-bold text-[#8a6d1f]">
                          {fmt(overallStats.totalSales)}
                        </td>
                        <td className="p-3.5 text-right font-serif font-bold text-rose-600">
                          {fmt(overallStats.totalExpenses)}
                        </td>
                        <td className="p-3.5 text-right font-serif font-bold text-emerald-600">
                          {fmt(overallStats.netSurplus)}
                        </td>
                        <td className="p-3.5 text-right font-serif font-bold text-blue-600">
                          {fmt(overallStats.totalApprovedDeposits)}
                        </td>
                        <td className="p-3.5 text-right font-serif font-bold text-amber-600">
                          {fmt(overallStats.totalClosingCash)}
                        </td>
                        <td colSpan={2} className="p-3.5 text-center text-slate-500 text-[10px]">
                          Automated Live Ledger Sync
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            VIEW B — BRANCH DETAIL (Specific Branch - Live Daily Ledger Drill-down)
        ═══════════════════════════════════════════════════════════════════ */}
        {selectedBranch && (
          <div className="space-y-6">
            {/* Navigation back and header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl border border-slate-900/10 bg-slate-900/[0.04]">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => goToBranch(null)}
                  className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-emerald-500/40 text-slate-600 hover:text-slate-900 transition-all cursor-pointer"
                  title="Back to All Branches"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <h2 className="text-lg font-bold font-serif text-slate-900 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-emerald-600" /> {selectedBranch.name}
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Live revenue &amp; cash audit for <span className="text-[#8a6d1f] font-mono font-bold">{selectedMonth}</span> ({activeBranchLedger.length} Daily Ledger Records)
                  </p>
                </div>
              </div>

              {activeBranchSummary && (
                <div className="flex items-center gap-2 self-stretch sm:self-auto">
                  <div className="px-3.5 py-1.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">Audit Status:</span>
                    <div className="relative group cursor-help">
                      <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded-full border ${getBranchAuditStatus(activeBranchSummary).color}`}>
                        {getBranchAuditStatus(activeBranchSummary).label}
                      </span>
                      {activeBranchSummary.totalCashDifference !== 0 && (
                        <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-900/15 rounded-xl shadow-2xl p-4 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3 border-b border-slate-900/10 pb-2">Audit Breakdown</p>
                          <div className="space-y-2">
                            {activeBranchLedger.filter(r => r.cash_difference !== 0).map(r => (
                              <div key={r.ledger_date} className="flex justify-between items-center text-xs font-mono">
                                <span className="text-slate-600">{r.ledger_date}</span>
                                <span className={r.cash_difference > 0 ? 'text-amber-600' : 'text-rose-600'}>
                                  {r.cash_difference > 0 ? '+' : ''}{fmt(r.cash_difference)}
                                </span>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 pt-2 border-t border-slate-900/10 flex justify-between items-center text-xs font-mono font-bold">
                            <span className="text-slate-900">Total</span>
                            <span className={activeBranchSummary.totalCashDifference > 0 ? 'text-amber-600' : 'text-rose-600'}>
                              {activeBranchSummary.totalCashDifference > 0 ? '+' : ''}{fmt(activeBranchSummary.totalCashDifference)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Detailed Quick Summary Cards for this branch */}
            {activeBranchSummary && (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                  <p className="text-[9px] uppercase tracking-wider text-slate-500">Cash Sales (নগদ)</p>
                  <p className="text-base font-bold font-mono text-slate-900 mt-1">{fmt(activeBranchSummary.cashSales)}</p>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                  <p className="text-[9px] uppercase tracking-wider text-slate-500">Digital Sales (ডিজিটাল)</p>
                  <p className="text-base font-bold font-mono text-emerald-600 mt-1">{fmt(activeBranchSummary.digitalSales)}</p>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                  <p className="text-[9px] uppercase tracking-wider text-slate-500">Total Revenue (মোট বিক্রি)</p>
                  <p className="text-base font-bold font-serif text-[#8a6d1f] mt-1">{fmt(activeBranchSummary.totalSales)}</p>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                  <p className="text-[9px] uppercase tracking-wider text-slate-500">Store Expenses (খরচ)</p>
                  <p className="text-base font-bold font-mono text-rose-600 mt-1">{fmt(activeBranchSummary.totalExpenses)}</p>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                  <p className="text-[9px] uppercase tracking-wider text-slate-500">Closing Cash (ড্রয়ার ক্যাশ)</p>
                  <p className="text-base font-bold font-mono text-amber-600 mt-1">{fmt(activeBranchSummary.netCash)}</p>
                </div>
              </div>
            )}

            {/* Branch Detailed Daily Ledger Records Table */}
            <div className="rounded-2xl border border-slate-900/10 bg-slate-900/[0.04] overflow-hidden shadow-xl">
              <div className="p-4 border-b border-slate-900/10 bg-slate-900/[0.04] flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Daily Shift Ledgers & Reconciliation Breakdown
                </p>
                <span className="text-[10px] text-slate-500">
                  Automatically populated upon daily register closings
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-900/10 bg-slate-900/[0.04]">
                      {['Date', 'Cash Sales (৳)', 'Digital Sales (৳)', 'Expenses (৳)', 'Deposits (৳)', 'Closing Cash (৳)', 'Discrepancy Status', 'Shift Status'].map((h, i) => (
                        <th
                          key={h}
                          className={`p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap ${
                            i === 0 ? 'text-left' : i >= 1 && i <= 5 ? 'text-right' : 'text-center'
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/[0.08]">
                    {activeBranchLedger.map((row) => {
                      const digitalRow = Number(row.bkash_sales || 0) + Number(row.nagad_sales || 0) + Number(row.rocket_sales || 0) + Number(row.card_sales || 0) + Number(row.bank_transfer_sales || 0)

                      return (
                        <tr key={row.ledger_date} className="hover:bg-slate-900/[0.04] transition-colors">
                          <td className="p-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <CalendarDays className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="font-semibold text-slate-900 font-mono">
                                {row.ledger_date}
                              </span>
                            </div>
                          </td>
                          <td className="p-3.5 text-right font-mono text-slate-700 whitespace-nowrap">
                            {fmt(row.cash_sales)}
                          </td>
                          <td className="p-3.5 text-right font-mono text-emerald-600 whitespace-nowrap">
                            {fmt(digitalRow)}
                          </td>
                          <td className="p-3.5 text-right font-mono text-rose-600 whitespace-nowrap">
                            {fmt(row.cash_expenses)}
                          </td>
                          <td className="p-3.5 text-right font-mono text-blue-600 whitespace-nowrap">
                            {fmt(row.bank_deposits_out)}
                          </td>
                          <td className="p-3.5 text-right font-serif font-bold text-slate-900 whitespace-nowrap">
                            {fmt(row.actual_cash)}
                          </td>
                          <td className="p-3.5 text-center whitespace-nowrap">
                            {row.difference_status === 'shortage' ? (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-500/10 text-rose-600 border border-rose-500/20">
                                Shortage {fmt(Math.abs(row.cash_difference))}
                              </span>
                            ) : row.difference_status === 'excess' ? (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                                Excess {fmt(row.cash_difference)}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                Balanced
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 text-center whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                              row.is_closed ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {row.is_closed ? 'Closed' : 'Open'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                    {activeBranchLedger.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-12 text-center text-slate-500">
                          No daily shift records found for {selectedBranch.name} in {selectedMonth}.
                        </td>
                      </tr>
                    )}
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
