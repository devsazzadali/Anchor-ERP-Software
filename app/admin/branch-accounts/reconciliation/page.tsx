'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart3, ChevronLeft, RefreshCw, AlertTriangle,
  CheckCircle, Clock, Building2, Calendar, Banknote,
  Download, FileText, FileSpreadsheet, ChevronDown
} from 'lucide-react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { generatePdf } from '@/lib/pdf-generator'
import { generateExcel } from '@/lib/excel-generator'

const fmt = (n: number) => '৳' + Number(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function AdminReconciliationPage() {
  const router = useRouter()
  const now = new Date()
  const [fromDate, setFromDate] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
  const [toDate,   setToDate]   = useState(now.toISOString().split('T')[0])
  const [data, setData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkAccess = useCallback(async () => {
    const res = await fetch('/api/auth/me')
    if (!res.ok) { router.replace('/'); return false }
    const me = await res.json()
    if (!me?.user) { router.replace('/'); return false }
    const isAdmin = !!me.is_admin
    if (!isAdmin) { router.replace('/dashboard'); return false }
    return true
  }, [router])

  const [isDataLoading, setIsDataLoading] = useState(false)
  const fetchSeqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    // FR-0b: sequence token + abort. Overlapping range fetches (the
    // auto-fetch on every date-state change, Apply, Refresh) used to
    // resolve in arbitrary order and the last RESOLVER overwrote state
    // unconditionally, so the page could display one range's figures
    // under another range's labels. Only the latest request may now
    // set state; the previous request is aborted outright.
    const seq = ++fetchSeqRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsDataLoading(true)
    try {
      const res = await fetch(`/api/branch-accounts/reconciliation?from=${fromDate}&to=${toDate}`, { signal: controller.signal })
      const json = await res.json()
      if (seq !== fetchSeqRef.current) return
      if (!res.ok) throw new Error(json.error)
      setData(json)
      setError(null)
    } catch (e: any) {
      if (e?.name === 'AbortError' || seq !== fetchSeqRef.current) return
      setError(e.message)
    } finally {
      if (seq === fetchSeqRef.current) setIsDataLoading(false)
    }
  }, [fromDate, toDate])

  const init = useCallback(async () => {
    setIsLoading(true)
    const ok = await checkAccess()
    if (ok) await fetchData()
    setIsLoading(false)
  }, [checkAccess, fetchData])

  useEffect(() => { init() }, [init])

  const handleRefresh = async () => { setIsRefreshing(true); await fetchData(); setIsRefreshing(false) }

  const summary: any[] = data?.summary || []
  const depositDrift: any[] = data?.deposit_drift || []
  const totalCashCollected   = summary.reduce((s, b) => s + Number(b.net_cash_collected || 0), 0)
  const totalApproved        = summary.reduce((s, b) => s + Number(b.total_approved || 0), 0)
  const totalPending         = summary.reduce((s, b) => s + Number(b.total_pending  || 0), 0)
  const totalUnbankedVariance = summary.reduce((s, b) => s + Number(b.unbanked_cash_variance || 0), 0)

  // ─── Multi-Format Exports (PDF, Excel, CSV) ─────────────────────────────────
  const handleExportPdf = async () => {
    if (!summary || summary.length === 0) return
    setIsExporting(true)
    setShowExportMenu(false)
    try {
      const columns = [
        '#',
        'Branch Name',
        'Net Cash Collected (BDT)',
        'Approved in Bank (BDT)',
        'Pending Deposits (BDT)',
        'Variance (BDT)',
        'Status'
      ]
      const rows = summary.map((b, idx) => {
        const variance = Number(b.unbanked_cash_variance || 0)
        let status = 'Balanced'
        if (variance > 500) status = 'Unbanked Cash'
        else if (variance < -500) status = 'Excess Banked'
        else if (Number(b.total_pending || 0) > 0) status = 'Pending Review'

        return [
          idx + 1,
          b.branch_name || '-',
          Number(b.net_cash_collected || 0).toLocaleString('en-BD'),
          Number(b.total_approved || 0).toLocaleString('en-BD'),
          Number(b.total_pending || 0).toLocaleString('en-BD'),
          variance > 500 ? fmt(variance) : variance < -500 ? `-${fmt(Math.abs(variance))}` : '৳0',
          status
        ]
      })

      await generatePdf('Bank & Cash Reconciliation Statement', columns, rows, {
        subtitle: 'AUDIT OF NET CASH COLLECTIONS VS APPROVED BANK DEPOSITS',
        dateRange: `${fromDate} to ${toDate}`,
        preparedBy: 'Finance & Accounts Administrator',
        orientation: 'landscape',
        summaryData: [
          { label: 'Total Branches Audited', value: `${summary.length} Branches` },
          { label: 'Total Net Cash Collected', value: `${totalCashCollected.toLocaleString('en-BD')} BDT` },
          { label: 'Total Approved in Bank', value: `${totalApproved.toLocaleString('en-BD')} BDT` },
          { label: 'Total Pending Deposits', value: `${totalPending.toLocaleString('en-BD')} BDT` },
          { label: 'Net Unbanked Variance', value: `${totalUnbankedVariance.toLocaleString('en-BD')} BDT` },
        ],
        filename: `Reconciliation_Statement_${fromDate}_to_${toDate}.pdf`,
        notes: 'Unbanked Cash Variance = Net Cash Collected - Approved Bank Deposits. A positive variance indicates cash collected at branch not yet reflected in bank.'
      })
    } catch (e: any) {
      setError(e.message || 'Failed to export reconciliation PDF')
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportExcel = () => {
    if (!summary || summary.length === 0) return
    setShowExportMenu(false)
    const columns = [
      '#',
      'Branch Name',
      'Net Cash Collected (BDT)',
      'Approved Bank Deposits (BDT)',
      'Pending Deposits (BDT)',
      'Unbanked Cash Variance (BDT)',
      'Status',
    ]
    const rows = summary.map((b, idx) => {
      const variance = Number(b.unbanked_cash_variance || 0)
      let status = 'Balanced'
      if (variance > 500) status = 'Unbanked Cash'
      else if (variance < -500) status = 'Excess Banked'
      else if (Number(b.total_pending || 0) > 0) status = 'Pending Review'

      return [
        idx + 1,
        b.branch_name || '-',
        Number(b.net_cash_collected || 0),
        Number(b.total_approved || 0),
        Number(b.total_pending || 0),
        variance,
        status,
      ]
    })
    generateExcel('Bank & Cash Reconciliation', columns, rows, {
      filename: `Reconciliation_${fromDate}_to_${toDate}.xlsx`,
      sheetName: 'Reconciliation',
    })
  }

  const handleExportCsv = () => {
    if (!summary || summary.length === 0) return
    setShowExportMenu(false)
    const headers = ['#', 'Branch Name', 'Net Cash Collected', 'Approved in Bank', 'Pending Deposits', 'Unbanked Variance', 'Status']
    const csvRows = summary.map((b, idx) => {
      const variance = Number(b.unbanked_cash_variance || 0)
      let status = 'Balanced'
      if (variance > 500) status = 'Unbanked Cash'
      else if (variance < -500) status = 'Excess Banked'
      else if (Number(b.total_pending || 0) > 0) status = 'Pending Review'

      return [
        idx + 1,
        `"${(b.branch_name || '').replace(/"/g, '""')}"`,
        Number(b.net_cash_collected || 0),
        Number(b.total_approved || 0),
        Number(b.total_pending || 0),
        variance,
        `"${status}"`
      ]
    })
    const csvContent = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Reconciliation_${fromDate}_to_${toDate}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (isLoading) {
    return <div className="min-h-screen bg-white flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/3 w-[500px] h-[400px] bg-blue-500/3 rounded-full filter blur-[150px]" />
      </div>

      <div className="relative z-10 p-4 md:p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/branch-accounts" className="p-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold font-serif flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#15803d]" /> Bank & Cash Reconciliation
            </h1>
            <p className="text-[11px] text-slate-500">Auditing net cash collections against approved bank deposits</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Export Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={isExporting || summary.length === 0}
                className="px-3.5 py-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#1ca34c]/30 text-slate-600 hover:text-slate-900 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-[#15803d]" />
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
                      onClick={handleExportPdf}
                      className="w-full px-4 py-2.5 text-left text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.04] flex items-center gap-2.5 transition-colors cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-[#15803d]" /> Export PDF (Official)
                    </button>
                    <button
                      onClick={handleExportExcel}
                      className="w-full px-4 py-2.5 text-left text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.04] flex items-center gap-2.5 transition-colors cursor-pointer border-t border-slate-900/5"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Export Excel (.xlsx)
                    </button>
                    <button
                      onClick={handleExportCsv}
                      className="w-full px-4 py-2.5 text-left text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.04] flex items-center gap-2.5 transition-colors cursor-pointer border-t border-slate-900/5"
                    >
                      <Download className="w-4 h-4 text-blue-600" /> Export CSV (.csv)
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button onClick={handleRefresh} className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}>
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Date Filter Bar */}
        <div className="flex flex-wrap items-center gap-3 p-4 rounded-3xl bg-slate-900/[0.04] border border-slate-900/5 mb-6">
          <Calendar className="w-4 h-4 text-[#15803d]" />
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-widest text-slate-500">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/40 cursor-pointer [color-scheme:light]" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-widest text-slate-500">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/40 cursor-pointer [color-scheme:light]" />
          </div>
          <button onClick={fetchData}
            className="px-4 py-2 rounded-full bg-[#1ca34c] text-white font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-all"
          >
            Apply
          </button>
          <span className="text-[10px] text-slate-500 ml-auto">{fromDate} → {toDate}</span>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        {/* Global totals — FR-0b: skeleton-gated while a range fetch is
            in flight, so a headline figure from a previous range can
            never be read under the new range's labels. The headline is
            single-sourced: it is only ever the reduce over the current
            response's summary.net_cash_collected. */}
        {isDataLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="p-5 rounded-3xl bg-slate-900/[0.04] border border-slate-900/5 animate-pulse">
                <div className="h-5 w-5 rounded bg-slate-900/10 mb-2" />
                <div className="h-2 w-20 rounded bg-slate-900/10 mb-2" />
                <div className="h-7 w-24 rounded bg-slate-900/10" />
              </div>
            ))}
          </div>
        ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="p-5 rounded-3xl bg-blue-500/10 border border-blue-500/20">
            <Banknote className="w-5 h-5 text-blue-600 mb-2" />
            <p className="text-[9px] uppercase tracking-widest text-blue-600/70 mb-1">Net Cash Collected</p>
            <p className="text-2xl font-bold font-serif text-slate-900">{fmt(totalCashCollected)}</p>
          </div>
          <div className="p-5 rounded-3xl bg-emerald-500/10 border border-emerald-500/20">
            <CheckCircle className="w-5 h-5 text-emerald-600 mb-2" />
            <p className="text-[9px] uppercase tracking-widest text-emerald-600/70 mb-1">Approved in Bank</p>
            <p className="text-2xl font-bold font-serif text-slate-900">{fmt(totalApproved)}</p>
          </div>
          <div className={`p-5 rounded-3xl border ${totalUnbankedVariance > 500 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20'}`}>
            <AlertTriangle className={`w-5 h-5 mb-2 ${totalUnbankedVariance > 500 ? 'text-amber-600' : 'text-emerald-600'}`} />
            <p className={`text-[9px] uppercase tracking-widest mb-1 ${totalUnbankedVariance > 500 ? 'text-amber-600/70' : 'text-emerald-600/70'}`}>
              {totalUnbankedVariance > 500 ? 'Unbanked Cash in Drawer' : 'Bank Reconciliation Status'}
            </p>
            <p className={`text-2xl font-bold font-serif ${totalUnbankedVariance > 500 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {totalUnbankedVariance > 500 ? fmt(totalUnbankedVariance) : '৳0 (Balanced)'}
            </p>
          </div>
          <div className="p-5 rounded-3xl bg-amber-500/10 border border-amber-500/20">
            <Clock className="w-5 h-5 text-amber-600 mb-2" />
            <p className="text-[9px] uppercase tracking-widest text-amber-600/70 mb-1">Pending Approvals</p>
            <p className="text-2xl font-bold font-serif text-slate-900">{fmt(totalPending)}</p>
          </div>
        </div>
        )}

        {/* Deposit Drift (FR-0) — stored ledger bank_deposits_out vs the
            allocated contribution of approved deposits, per branch/day.
            The section always renders: an empty list shows an explicit
            "No deposit drift" line so absence is provable. */}
        <div className="rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] overflow-hidden mb-6">
          <div className="p-5 border-b border-slate-900/5 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Deposit Drift</p>
            <span className="text-[10px] text-slate-500 font-medium">Allocated deposits vs stored ledger amounts</span>
          </div>
          {isDataLoading ? (
            <div className="p-5 animate-pulse"><div className="h-3 w-48 rounded bg-slate-900/10" /></div>
          ) : depositDrift.length === 0 ? (
            <p className="p-5 text-xs text-slate-500">No deposit drift</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-900/5">
                    {['Branch', 'Date', 'Allocated', 'Stored in Ledger', 'Drift'].map(h => (
                      <th key={h} className="text-left p-4 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {depositDrift.map((d: any) => {
                    const drift = Number(d.drift || 0)
                    return (
                      <tr key={`${d.branch_id}-${d.ledger_date}`} className="border-b border-slate-900/[0.08] hover:bg-slate-900/[0.04] transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-3.5 h-3.5 text-slate-500" />
                            <span className="text-slate-900 font-semibold">{d.branch_name}</span>
                          </div>
                        </td>
                        <td className="p-4 text-slate-600 whitespace-nowrap">{d.ledger_date}</td>
                        <td className="p-4 text-slate-900 font-semibold">{fmt(d.allocated)}</td>
                        <td className="p-4 text-slate-900 font-semibold">{fmt(d.stored_bank_deposits_out)}</td>
                        <td className="p-4">
                          <span className={`font-bold ${drift < 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                            {drift < 0 ? `-${fmt(Math.abs(drift))}` : fmt(drift)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Branch-wise reconciliation table */}
        <div className="rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] overflow-hidden mb-6">
          <div className="p-5 border-b border-slate-900/5 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Branch Cash vs Bank Deposits</p>
            <span className="text-[10px] text-slate-500 font-medium">Reconciliation Period: {fromDate} to {toDate}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-900/5">
                  {['Branch', 'Net Cash Collected', 'Approved in Bank', 'Unbanked Variance', 'Pending Review', 'Audit Status'].map(h => (
                    <th key={h} className="text-left p-4 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.map((b: any) => {
                  const variance = Number(b.unbanked_cash_variance || 0)
                  const hasPending = Number(b.pending_count || 0) > 0

                  return (
                    <tr key={b.branch_id} className="border-b border-slate-900/[0.08] hover:bg-slate-900/[0.04] transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-slate-900 font-semibold">{b.branch_name}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="text-slate-900 font-semibold">{fmt(b.net_cash_collected)}</span>
                        {Number(b.total_cash_expenses) > 0 && (
                          <p className="text-[10px] text-slate-500 mt-0.5">Exp: -{fmt(b.total_cash_expenses)}</p>
                        )}
                      </td>
                      <td className="p-4">
                        <span className="text-emerald-600 font-semibold">{fmt(b.total_approved)}</span>
                        <p className="text-[10px] text-slate-500 mt-0.5">{b.deposit_count || 0} deposit(s)</p>
                      </td>
                      <td className="p-4">
                        {variance > 500 ? (
                          <div>
                            <span className="text-amber-600 font-bold">{fmt(variance)}</span>
                            <p className="text-[9px] text-amber-500 font-medium">Unbanked Cash</p>
                          </div>
                        ) : (
                          <div>
                            <span className="text-emerald-600 font-bold">৳0</span>
                            <p className="text-[9px] text-emerald-500 font-medium">Balanced</p>
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        {hasPending ? (
                          <Link href="/admin/branch-accounts/deposit-approvals"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 text-[10px] font-bold hover:bg-amber-500/20 transition-all"
                          >
                            {b.pending_count} pending ({fmt(b.total_pending)}) →
                          </Link>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col items-start gap-1">
                        {hasPending ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-600 uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                            ⏳ Pending Review
                          </span>
                        ) : variance > 500 ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-600 uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                            ⚠️ Unbanked Cash
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-600 uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                            ✓ Balanced
                          </span>
                        )}
                        {(Number(b.deposit_drift || 0) !== 0 || Number(b.deposit_drift_days || 0) > 0) && (
                          <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${Number(b.deposit_drift || 0) < 0 ? 'text-rose-600 bg-rose-500/10 border-rose-500/20' : 'text-amber-600 bg-amber-500/10 border-amber-500/20'}`}>
                            Deposit drift {Number(b.deposit_drift || 0) < 0 ? `-${fmt(Math.abs(Number(b.deposit_drift)))}` : fmt(b.deposit_drift)} ({b.deposit_drift_days} day{Number(b.deposit_drift_days) === 1 ? '' : 's'})
                          </span>
                        )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {summary.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-slate-500">No deposit or sales data found for selected period</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {data?.deposits?.length > 0 ? (
          <div className="rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] overflow-hidden">
            <div className="p-5 border-b border-slate-900/5">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Individual Deposit Records — {data.from} to {data.to}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-900/5">
                    {['Date', 'Branch', 'Manager', 'Amount', 'Bank', 'Slip No.', 'TXN ID', 'Status'].map(h => (
                      <th key={h} className="text-left p-3 text-[9px] uppercase tracking-widest text-slate-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.deposits.map((dep: any) => (
                    <tr key={dep.id} className={`border-b border-slate-900/[0.08] hover:bg-slate-900/[0.04] transition-colors ${dep.is_reversed ? 'opacity-40' : ''}`}>
                      <td className="p-3 text-slate-600 whitespace-nowrap">{dep.deposit_date}</td>
                      <td className="p-3 text-slate-900 font-semibold whitespace-nowrap">{dep.branch_name}</td>
                      <td className="p-3 text-slate-500 whitespace-nowrap">{dep.manager_name}</td>
                      <td className="p-3 text-slate-900 font-semibold">{fmt(dep.amount)}</td>
                      <td className="p-3 text-slate-500 truncate max-w-[100px]">{dep.bank_account_name}</td>
                      <td className="p-3 text-slate-500">{dep.deposit_slip_number || '—'}</td>
                      <td className="p-3 text-slate-500">{dep.bank_transaction_id || '—'}</td>
                      <td className="p-3">
                        <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                          dep.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                          dep.status === 'rejected' ? 'bg-rose-500/10 text-rose-600 border-rose-500/20' :
                          dep.status === 'draft'    ? 'bg-slate-500/10 text-slate-500 border-slate-500/20' :
                          'bg-amber-500/10 text-amber-600 border-amber-500/20'
                        }`}>{dep.is_reversed ? 'reversed' : dep.status.replace('_', ' ')}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : data !== null && (
          <div className="rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] p-10 text-center">
            <p className="text-slate-500 text-sm">No deposit records found for {data?.from} → {data?.to}.</p>
          </div>
        )}

      </div>
    </div>
  )
}
