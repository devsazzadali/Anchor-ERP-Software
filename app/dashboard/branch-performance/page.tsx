'use client'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  TrendingUp, TrendingDown, BarChart3, CalendarDays,
  RefreshCw, Download, Banknote, MapPin, ChevronRight, ArrowLeft
} from 'lucide-react'
import { generatePdf } from '@/lib/pdf-generator'
import { getCachedData, setCachedData } from '@/lib/branch-cache'

// ─────────────────────────────────────────────────────────────────────────────
type Branch = { id: string; name: string }

type PerformanceReport = {
  id: string
  branch_id: string | null
  branch_name: string
  report_month: string
  total_sales: number
  total_profit: number
  total_loss: number
  notes: string | null
  created_by_name: string | null
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PartnerBranchPerformancePage() {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const [branches, setBranches]         = useState<Branch[]>(() => getCachedData('partner_perf_branches') || [])
  const [reports, setReports]           = useState<PerformanceReport[]>(() => getCachedData('partner_perf_reports') || [])
  const [isLoading, setIsLoading]       = useState(() => !getCachedData('partner_perf_reports'))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [branchesLoaded, setBranchesLoaded] = useState(() => !!getCachedData('partner_perf_branches'))

  // URL-driven selected branch
  const branchParam    = searchParams?.get('branch') ?? null
  const selectedBranch = useMemo<Branch | null>(() => {
    if (!branchParam || !branchesLoaded) return null
    return branches.find(b => b.id === branchParam) ?? null
  }, [branchParam, branches, branchesLoaded])

  // ─── Navigation ────────────────────────────────────────────────────────────
  const goToBranch = (branch: Branch | null) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    if (branch) { params.set('branch', branch.id) } else { params.delete('branch') }
    router.push(pathname + '?' + params.toString())
  }

  // ─── Fetch ─────────────────────────────────────────────────────────────────
  const fetchBranches = useCallback(async () => {
    const res = await fetch('/api/branch-accounts/branches')
    if (!res.ok) return
    const json = await res.json()
    const data = json.branches
    if (data) {
      setBranches(data)
      setBranchesLoaded(true)
      setCachedData('partner_perf_branches', data, 120000)
    }
  }, [])

  const fetchReports = useCallback(async () => {
    const res = await fetch('/api/branch-accounts/performance-reports')
    if (!res.ok) return
    const json = await res.json()
    const data = json.reports
    if (data) {
      setReports(data)
      setCachedData('partner_perf_reports', data, 45000)
    }
  }, [])

  const fetchAll = useCallback(async () => {
    if (!getCachedData('partner_perf_reports')) {
      setIsLoading(true)
    }
    await Promise.all([fetchBranches(), fetchReports()])
    setIsLoading(false)
  }, [fetchBranches, fetchReports])

  useEffect(() => {
    fetchAll()
    // the legacy realtime channel is replaced with refetch
    // on window focus + a 30 s polling interval.
    const onFocus = () => { fetchReports() }
    window.addEventListener('focus', onFocus)
    const interval = setInterval(() => { fetchReports() }, 30000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [fetchAll, fetchReports])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchReports()
    setIsRefreshing(false)
  }

  // ─── Computed ──────────────────────────────────────────────────────────────
  const branchStats = useMemo(() => {
    const map: Record<string, { count: number; totalSales: number; totalProfit: number; totalLoss: number }> = {}
    branches.forEach(b => { map[b.id] = { count: 0, totalSales: 0, totalProfit: 0, totalLoss: 0 } })
    reports.forEach(r => {
      const key = r.branch_id ?? ''
      if (!map[key]) map[key] = { count: 0, totalSales: 0, totalProfit: 0, totalLoss: 0 }
      map[key].count += 1
      map[key].totalSales  += Number(r.total_sales)
      map[key].totalProfit += Number(r.total_profit)
      map[key].totalLoss   += Number(r.total_loss)
    })
    return map
  }, [branches, reports])

  const overallStats = useMemo(() => ({
    totalReports: reports.length,
    totalSales:   reports.reduce((s, r) => s + Number(r.total_sales), 0),
    totalProfit:  reports.reduce((s, r) => s + Number(r.total_profit), 0),
    totalLoss:    reports.reduce((s, r) => s + Number(r.total_loss), 0),
  }), [reports])

  const branchReports = useMemo(() => {
    if (!selectedBranch) return []
    return reports.filter(r => r.branch_id === selectedBranch.id)
  }, [reports, selectedBranch])

  // ─── PDF Export ────────────────────────────────────────────────────────────
  const exportBranchPdf = (branch: Branch) => {
    const bReports = reports.filter(r => r.branch_id === branch.id)
    const rows: (string | number)[][] = bReports.map((r, idx) => [
      idx + 1,
      new Date(r.report_month).toLocaleDateString('en-BD', { month: 'long', year: 'numeric' }),
      `${Number(r.total_sales).toLocaleString('en-BD')}`,
      `${Number(r.total_profit).toLocaleString('en-BD')}`,
      `${Number(r.total_loss).toLocaleString('en-BD')}`,
      r.notes || '—',
    ])

    const totalSales  = bReports.reduce((s, r) => s + Number(r.total_sales), 0)
    const totalProfit = bReports.reduce((s, r) => s + Number(r.total_profit), 0)
    const totalLoss   = bReports.reduce((s, r) => s + Number(r.total_loss), 0)

    generatePdf(
      'Branch Performance Report',
      ['#', 'Month', 'Total Sales (BDT)', 'Total Profit (BDT)', 'Total Loss (BDT)', 'Notes'],
      rows,
      {
        filename:    `${branch.name}-Performance-Report.pdf`,
        branch:      branch.name,
        subtitle:    'Monthly Performance Report',
        preparedBy:  'Partner View',
        summaryData: [
          { label: 'Total Months Reported', value: bReports.length.toString() },
          { label: 'Total Sales',           value: `${totalSales.toLocaleString('en-BD')} BDT` },
          { label: 'Total Profit',          value: `${totalProfit.toLocaleString('en-BD')} BDT` },
          { label: 'Total Loss',            value: `${totalLoss.toLocaleString('en-BD')} BDT` },
        ],
      }
    )
  }

  // ─── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen w-full bg-white text-slate-900 font-sans relative">
      <div className="absolute top-[-5%] right-[-5%] w-[40%] h-[40%] bg-[#1ca34c]/3 rounded-full filter blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-5%] left-[10%] w-[50%] h-[50%] bg-emerald-500/3 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="relative z-10 flex flex-col p-4 md:p-6 max-h-screen overflow-y-auto custom-scrollbar">

        {/* ── Page Header ── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-4 border-b border-slate-900/5">
          <div className="flex items-start gap-3">
            <span className="w-1.5 h-9 rounded-full bg-[#1ca34c] shrink-0" />
            <div>
            <span className="text-[10px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider inline-flex items-center gap-1 mb-1">
              <TrendingUp className="w-3 h-3" /> Branch Analytics
            </span>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900 font-serif">Branch Performance Reports</h1>
            <p className="text-[11px] text-slate-500 mt-0.5">Monthly sales, profit, and loss for all branches.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] px-2 py-1 rounded-full bg-slate-100 border border-slate-900/5 text-slate-500 font-bold uppercase tracking-wider">View Only</span>
            <button
              onClick={handleRefresh}
              className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            VIEW A — BRANCH OVERVIEW
        ═══════════════════════════════════════════════════════════════════ */}
        {!selectedBranch && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

            {/* Summary strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Total Reports',  value: overallStats.totalReports,                                       cls: 'text-slate-900',       icon: BarChart3,    bg: 'bg-slate-900/[0.04] border-slate-900/5' },
                { label: 'Total Sales',    value: `${overallStats.totalSales.toLocaleString('en-BD')} BDT`,        cls: 'text-[#15803d]',   icon: Banknote,     bg: 'bg-[#1ca34c]/5 border-[#1ca34c]/10' },
                { label: 'Total Profit',   value: `${overallStats.totalProfit.toLocaleString('en-BD')} BDT`,       cls: 'text-emerald-600', icon: TrendingUp,   bg: 'bg-emerald-500/5 border-emerald-500/10' },
                { label: 'Total Loss',     value: `${overallStats.totalLoss.toLocaleString('en-BD')} BDT`,         cls: 'text-rose-600',    icon: TrendingDown, bg: 'bg-rose-500/5 border-rose-500/10' },
              ].map(item => (
                <div key={item.label} className={`p-4 rounded-2xl border flex items-center gap-3 ${item.bg}`}>
                  <div className="w-9 h-9 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 flex items-center justify-center flex-shrink-0">
                    <item.icon className={`w-4 h-4 ${item.cls}`} />
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">{item.label}</p>
                    <p className={`text-sm font-bold ${item.cls}`}>{item.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Branch list */}
            <div className="rounded-2xl border border-slate-900/[0.08] overflow-hidden bg-slate-900/[0.05]">
              <div className="hidden md:grid grid-cols-[1fr_100px_140px_140px_140px_36px] items-center px-5 py-3 border-b border-slate-900/[0.08] bg-slate-900/[0.04] gap-4">
                {['Branch', 'Reports', 'Total Sales', 'Total Profit', 'Total Loss', ''].map(h => (
                  <span key={h} className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">{h}</span>
                ))}
              </div>

              {branches.length === 0 ? (
                <div className="py-16 text-center text-slate-500 text-sm">No branches found.</div>
              ) : (
                branches.map((b, idx) => {
                  const st = branchStats[b.id] || { count: 0, totalSales: 0, totalProfit: 0, totalLoss: 0 }
                  return (
                    <motion.div
                      key={b.id}
                      className={`flex flex-col md:grid md:grid-cols-[1fr_100px_140px_140px_140px_36px] items-start md:items-center px-5 py-4 gap-3 md:gap-4 group transition-colors hover:bg-slate-900/[0.04] ${idx < branches.length - 1 ? 'border-b border-slate-900/[0.08]' : ''}`}
                    >
                      <button
                        onClick={() => goToBranch(b)}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer hover:opacity-80 transition-opacity"
                      >
                        <div className="w-8 h-8 rounded-xl bg-emerald-500/8 flex items-center justify-center flex-shrink-0">
                          <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-600 transition-colors truncate">{b.name}</div>
                          <div className="text-[10px] text-slate-600 mt-0.5">{st.count === 0 ? 'No reports yet' : `${st.count} report${st.count !== 1 ? 's' : ''}`}</div>
                        </div>
                      </button>
                      <div className="hidden md:block text-sm font-semibold text-slate-900">{st.count > 0 ? st.count : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="hidden md:block text-sm font-bold text-[#15803d]">{st.totalSales > 0 ? `${st.totalSales.toLocaleString('en-BD')} BDT` : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="hidden md:block text-sm font-bold text-emerald-600">{st.totalProfit > 0 ? `${st.totalProfit.toLocaleString('en-BD')} BDT` : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="hidden md:block text-sm font-bold text-rose-600">{st.totalLoss > 0 ? `${st.totalLoss.toLocaleString('en-BD')} BDT` : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="hidden md:flex justify-end gap-1">
                        {st.count > 0 && (
                          <button
                            onClick={() => exportBranchPdf(b)}
                            title="Export PDF"
                            className="p-2.5 min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg bg-[#1ca34c]/10 border border-[#1ca34c]/20 text-[#15803d] hover:bg-[#1ca34c]/20 transition-all"
                          >
                            <Download className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      {/* Mobile: tap row to navigate */}
                      <button
                        onClick={() => goToBranch(b)}
                        className="md:hidden flex items-center gap-1 text-xs text-emerald-600 font-semibold"
                      >
                        View Reports <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </motion.div>
                  )
                })
              )}
            </div>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            VIEW B — BRANCH DETAIL
        ═══════════════════════════════════════════════════════════════════ */}
        {selectedBranch && (
          <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
            {/* Back + Header */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-900/5">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => goToBranch(null)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 hover:border-emerald-500/30 transition-all text-xs font-semibold cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to Branches
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-emerald-600" />
                    <h2 className="text-lg font-bold font-serif text-slate-900">{selectedBranch.name}</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {branchReports.length} report{branchReports.length !== 1 ? 's' : ''}
                    {branchReports.length > 0 && ` · ${branchReports.reduce((s, r) => s + Number(r.total_sales), 0).toLocaleString('en-BD')} BDT total sales`}
                  </p>
                </div>
              </div>

              {branchReports.length > 0 && (
                <button
                  onClick={() => exportBranchPdf(selectedBranch)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1ca34c]/10 border border-[#1ca34c]/20 text-[#15803d] hover:bg-[#1ca34c]/20 transition-all text-xs font-bold uppercase tracking-wider"
                >
                  <Download className="w-3.5 h-3.5" /> Export PDF
                </button>
              )}
            </div>

            {/* Branch Stats Cards */}
            {branchReports.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                {[
                  { label: 'Total Sales',  value: `${branchReports.reduce((s, r) => s + Number(r.total_sales), 0).toLocaleString('en-BD')} BDT`,  cls: 'text-[#15803d]',  border: 'border-[#1ca34c]/10',  bg: 'bg-[#1ca34c]/5'  },
                  { label: 'Total Profit', value: `${branchReports.reduce((s, r) => s + Number(r.total_profit), 0).toLocaleString('en-BD')} BDT`, cls: 'text-emerald-600', border: 'border-emerald-500/10', bg: 'bg-emerald-500/5' },
                  { label: 'Total Loss',   value: `${branchReports.reduce((s, r) => s + Number(r.total_loss), 0).toLocaleString('en-BD')} BDT`,   cls: 'text-rose-600',   border: 'border-rose-500/10',   bg: 'bg-rose-500/5'   },
                ].map(item => (
                  <div key={item.label} className={`p-4 rounded-2xl border ${item.border} ${item.bg} text-center`}>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{item.label}</p>
                    <p className={`text-lg font-bold ${item.cls}`}>{item.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Reports list */}
            <div className="rounded-2xl border border-slate-900/[0.08] overflow-hidden bg-slate-900/[0.05]">
              <div className="hidden md:grid grid-cols-[140px_1fr_1fr_1fr_180px] items-center px-5 py-3 border-b border-slate-900/[0.08] bg-slate-900/[0.04] gap-4">
                {['Month', 'Total Sales', 'Total Profit', 'Total Loss', 'Notes'].map(h => (
                  <span key={h} className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">{h}</span>
                ))}
              </div>

              {branchReports.length === 0 ? (
                <div className="py-20 text-center">
                  <TrendingUp className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                  <p className="text-slate-500 text-sm">No performance reports yet for {selectedBranch.name}.</p>
                </div>
              ) : (
                branchReports.map((report, idx) => (
                  <motion.div
                    key={report.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.03 }}
                    className={`flex flex-col md:grid md:grid-cols-[140px_1fr_1fr_1fr_180px] items-start md:items-center px-5 py-4 gap-3 md:gap-4 hover:bg-slate-900/[0.04] transition-colors ${idx < branchReports.length - 1 ? 'border-b border-slate-900/[0.08]' : ''}`}
                  >
                    {/* Month */}
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                        <CalendarDays className="w-3 h-3 text-emerald-600" />
                      </div>
                      <p className="text-sm font-bold text-slate-900">
                        {new Date(report.report_month).toLocaleDateString('en-BD', { month: 'short', year: 'numeric' })}
                      </p>
                    </div>

                    {/* Sales */}
                    <div>
                      <p className="text-[9px] text-slate-600 uppercase tracking-wider md:hidden mb-0.5">Sales</p>
                      <span className="text-sm font-bold text-[#15803d]">{Number(report.total_sales).toLocaleString('en-BD')} BDT</span>
                    </div>

                    {/* Profit */}
                    <div>
                      <p className="text-[9px] text-slate-600 uppercase tracking-wider md:hidden mb-0.5">Profit</p>
                      <span className="text-sm font-bold text-emerald-600">{Number(report.total_profit).toLocaleString('en-BD')} BDT</span>
                    </div>

                    {/* Loss */}
                    <div>
                      <p className="text-[9px] text-slate-600 uppercase tracking-wider md:hidden mb-0.5">Loss</p>
                      <span className="text-sm font-bold text-rose-600">{Number(report.total_loss).toLocaleString('en-BD')} BDT</span>
                    </div>

                    {/* Notes */}
                    <div>
                      {report.notes
                        ? <p className="text-[11px] text-slate-500 truncate max-w-[160px]">{report.notes}</p>
                        : <span className="text-slate-500 text-[10px]">—</span>
                      }
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
