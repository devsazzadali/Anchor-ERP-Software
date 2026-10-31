'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wallet, Search, RefreshCw, AlertTriangle, Check, Clock,
  CheckCircle2, XCircle, ArrowRight, Download, FileText,
  Building2, Coins, ChevronRight, X, AlertCircle, Info,
  Filter, CheckSquare, Edit3, Eye, ExternalLink, ShieldAlert
} from 'lucide-react'
import Link from 'next/link'
import { generatePdf } from '@/lib/pdf-generator'
import { generateExcel } from '@/lib/excel-generator'

const fmt = (n: number | null | undefined) =>
  '৳' + Number(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

type Branch = { id: string; name: string }

type BundleRequest = {
  id: string
  branch_id: string
  branch_name: string | null
  manager_id: string
  manager_name: string | null
  bundle_10_count: number
  bundle_20_count: number
  bundle_50_count: number
  bundle_100_count: number
  total_amount: number
  urgency: 'normal' | 'urgent'
  reason: string | null
  status: 'requested' | 'processing' | 'completed' | 'rejected'
  task_id: string | null
  processed_by: string | null
  processed_by_name: string | null
  processed_at: string | null
  completed_at: string | null
  admin_notes: string | null
  created_at: string
  updated_at: string
}

const statusConfig: Record<string, { label: string; cls: string; icon: React.FC<any> }> = {
  requested:  { label: 'Requested',   cls: 'bg-amber-500/10 text-amber-600 border-amber-500/20',     icon: Clock },
  processing: { label: 'In-Transit',  cls: 'bg-blue-500/10 text-blue-600 border-blue-500/20',       icon: RefreshCw },
  completed:  { label: 'Fulfilled',   cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', icon: CheckCircle2 },
  rejected:   { label: 'Declined',    cls: 'bg-rose-500/10 text-rose-600 border-rose-500/20',       icon: XCircle },
}

export default function AdminBundleRequestsPage() {
  const router = useRouter()

  const [requests, setRequests] = useState<BundleRequest[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [adminUser, setAdminUser] = useState<any>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterBranch, setFilterBranch] = useState<string>('')
  const [filterUrgency, setFilterUrgency] = useState<string>('all')

  // Action / Status Modal
  const [activeRequest, setActiveRequest] = useState<BundleRequest | null>(null)
  const [actionStatus, setActionStatus] = useState<'processing' | 'completed' | 'rejected'>('processing')
  const [actionNotes, setActionNotes] = useState('')
  const [isSubmittingAction, setIsSubmittingAction] = useState(false)

  // Detail Modal
  const [viewDetailReq, setViewDetailReq] = useState<BundleRequest | null>(null)

  // ─── Auth Verification ───────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const res = await fetch('/api/auth/me')
      if (!res.ok) { router.replace('/'); return }
      const me = await res.json()
      if (!me?.user) { router.replace('/'); return }

      const prof = me.profile
      const isAdmin = !!me.is_admin
      if (!isAdmin) {
        setAccessDenied(true)
        setIsLoading(false)
        return
      }

      setAdminUser(prof)
      await Promise.all([fetchBranches(), fetchRequests()])
      setIsLoading(false)
    }

    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchBranches = async () => {
    const res = await fetch('/api/branch-accounts/branches')
    if (!res.ok) return
    const json = await res.json()
    const data = json.branches
    if (data) setBranches(data)
  }

  const fetchRequests = async () => {
    try {
      const res = await fetch('/api/branch-accounts/bundle-requests')
      const json = await res.json()
      if (res.ok) {
        setRequests(json.requests || [])
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await Promise.all([fetchBranches(), fetchRequests()])
    setIsRefreshing(false)
  }

  // ─── Filtered Data ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return requests.filter(r => {
      const q = search.toLowerCase().trim()
      const matchesSearch = !q ||
        (r.branch_name || '').toLowerCase().includes(q) ||
        (r.manager_name || '').toLowerCase().includes(q) ||
        (r.reason || '').toLowerCase().includes(q) ||
        (r.admin_notes || '').toLowerCase().includes(q)

      const matchesStatus = filterStatus === 'all' || r.status === filterStatus
      const matchesBranch = !filterBranch || r.branch_id === filterBranch
      const matchesUrgency = filterUrgency === 'all' || r.urgency === filterUrgency

      return matchesSearch && matchesStatus && matchesBranch && matchesUrgency
    })
  }, [requests, search, filterStatus, filterBranch, filterUrgency])

  // ─── Metrics ─────────────────────────────────────────────────────────────
  const pendingCount = useMemo(() => filtered.filter(r => r.status === 'requested').length, [filtered])
  const pendingTotal = useMemo(() => filtered.filter(r => r.status === 'requested').reduce((s, r) => s + Number(r.total_amount || 0), 0), [filtered])
  const inTransitCount = useMemo(() => filtered.filter(r => r.status === 'processing').length, [filtered])
  const inTransitTotal = useMemo(() => filtered.filter(r => r.status === 'processing').reduce((s, r) => s + Number(r.total_amount || 0), 0), [filtered])
  const completedTotal = useMemo(() => filtered.filter(r => r.status === 'completed').reduce((s, r) => s + Number(r.total_amount || 0), 0), [filtered])
  const totalAllCash = useMemo(() => filtered.reduce((s, r) => s + Number(r.total_amount || 0), 0), [filtered])

  // ─── Update Status Handler ────────────────────────────────────────────────
  const handleOpenAction = (req: BundleRequest, targetStatus: 'processing' | 'completed' | 'rejected') => {
    setActiveRequest(req)
    setActionStatus(targetStatus)
    setActionNotes(req.admin_notes || '')
  }

  const handleSubmitStatus = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeRequest) return

    setIsSubmittingAction(true)
    setFeedback(null)

    try {
      const res = await fetch(`/api/branch-accounts/bundle-requests/${activeRequest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: actionStatus,
          admin_notes: actionNotes,
        }),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to update requisition status')

      setFeedback({ type: 'success', message: `Requisition status updated to ${actionStatus.toUpperCase()}` })
      setActiveRequest(null)
      await fetchRequests()
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message })
    } finally {
      setIsSubmittingAction(false)
      setTimeout(() => setFeedback(null), 4000)
    }
  }

  // ─── Export PDF ───────────────────────────────────────────────────────────
  const handleExportPdf = async () => {
    if (filtered.length === 0) {
      setFeedback({ type: 'error', message: 'No requisition records to export.' })
      return
    }

    try {
      const columns = ['#', 'Branch', 'Manager', 'Date', 'Urgency', 'Requested Bundles', 'Total Value (BDT)', 'Status', 'Notes']
      const rows: (string | number)[][] = filtered.map((r, idx) => {
        const bundlesSummary = [
          r.bundle_10_count > 0 ? `10 BDT: ${r.bundle_10_count}` : '',
          r.bundle_20_count > 0 ? `20 BDT: ${r.bundle_20_count}` : '',
          r.bundle_50_count > 0 ? `50 BDT: ${r.bundle_50_count}` : '',
          r.bundle_100_count > 0 ? `100 BDT: ${r.bundle_100_count}` : '',
        ].filter(Boolean).join(', ')

        return [
          idx + 1,
          r.branch_name || '-',
          r.manager_name || '-',
          new Date(r.created_at).toLocaleDateString('en-GB'),
          r.urgency.toUpperCase(),
          bundlesSummary || 'None',
          Number(r.total_amount).toLocaleString('en-BD'),
          r.status.toUpperCase(),
          r.admin_notes || r.reason || '—'
        ]
      })

      const totalFilteredAmount = filtered.reduce((s, r) => s + Number(r.total_amount || 0), 0)

      await generatePdf(
        'Head Office Cash Bundle Requisitions Statement',
        columns,
        rows,
        {
          filename: `HeadOffice_Bundle_Requisitions_${new Date().toISOString().slice(0, 10)}.pdf`,
          subtitle: `CENTRAL CASH DISPATCH AND CHANGE REQUISITION LEDGER`,
          preparedBy: adminUser?.full_name || 'System Admin',
          dateRange: 'All Recorded Submissions',
          summaryData: [
            { label: 'Requisitions Count', value: filtered.length.toString() },
            { label: 'Pending Requisitions', value: `${fmt(pendingTotal)} (${pendingCount})` },
            { label: 'In-Transit Requisitions', value: `${fmt(inTransitTotal)} (${inTransitCount})` },
            { label: 'Total Value In Scope', value: `${totalFilteredAmount.toLocaleString('en-BD')} BDT` }
          ],
          notes: 'Standard note bundle specifications: 1 bundle consists of 100 currency notes.'
        }
      )
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || 'Failed to export PDF' })
    }
  }

  // ─── Export Excel ─────────────────────────────────────────────────────────
  const handleExportExcel = () => {
    if (filtered.length === 0) {
      setFeedback({ type: 'error', message: 'No records to export.' })
      return
    }

    const columns = ['SL', 'Branch', 'Manager', 'Date', 'Urgency', '10 BDT Bundles', '20 BDT Bundles', '50 BDT Bundles', '100 BDT Bundles', 'Total Amount (BDT)', 'Status', 'Admin Notes']
    const rows = filtered.map((r, idx) => [
      idx + 1,
      r.branch_name || '-',
      r.manager_name || '-',
      new Date(r.created_at).toLocaleDateString('en-GB'),
      r.urgency,
      r.bundle_10_count,
      r.bundle_20_count,
      r.bundle_50_count,
      r.bundle_100_count,
      Number(r.total_amount),
      r.status,
      r.admin_notes || r.reason || ''
    ])

    const totalAmt = filtered.reduce((s, r) => s + Number(r.total_amount || 0), 0)
    const totals = ['TOTAL', '', '', '', '', '', '', '', '', totalAmt, '', '']

    generateExcel(
      'Cash Bundle Requisitions Ledger',
      columns,
      rows,
      {
        filename: `Change_Requisitions_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName: 'Requisitions',
        totals
      }
    )
  }

  if (accessDenied) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="max-w-md w-full p-8 rounded-3xl border border-slate-900/10 bg-slate-900/[0.04] text-center shadow-2xl">
          <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2 font-serif">Access Restricted</h1>
          <p className="text-sm text-slate-500 mb-6">
            This module is strictly reserved for Head Office and Executive Administrators.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900/[0.07] hover:bg-slate-900/[0.08] text-slate-900 text-xs font-semibold transition-all"
          >
            Return to Portal
          </Link>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-white text-slate-900 font-sans relative">
      {/* Background glow */}
      <div className="absolute top-[-5%] right-[-5%] w-[40%] h-[40%] bg-[#1ca34c]/5 rounded-full filter blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-5%] left-[10%] w-[45%] h-[45%] bg-blue-500/5 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="relative z-10 flex flex-col p-4 md:p-6 max-w-7xl mx-auto custom-scrollbar">

        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-5 border-b border-slate-900/10">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] bg-[#1ca34c]/15 text-[#15803d] border border-[#1ca34c]/20 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Coins className="w-3 h-3" /> Treasury Operations
              </span>
              <span className="text-[10px] bg-slate-900/[0.04] text-slate-500 border border-slate-900/10 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                Head Office Hub
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-serif flex items-center gap-2">
              Branch Change Requisitions Hub
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Monitor, dispatch, and fulfill note bundle cash requests (৳10, ৳20, ৳50, ৳100) across all retail branches.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleRefresh}
              className={`p-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#1ca34c]/30 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}
              title="Refresh requisitions"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <button
              onClick={handleExportExcel}
              className="px-3 py-2.5 rounded-xl bg-slate-900/[0.04] hover:bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <FileText className="w-4 h-4 text-emerald-600" />
              Excel
            </button>

            <button
              onClick={handleExportPdf}
              className="px-3.5 py-2.5 rounded-xl bg-slate-900/[0.04] hover:bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4 text-[#15803d]" />
              PDF Statement
            </button>
          </div>
        </div>

        {/* ── Feedback Banner ── */}
        <AnimatePresence>
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className={`mb-6 px-4 py-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                feedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-600'
              }`}
            >
              {feedback.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {feedback.message}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Metric Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="p-5 rounded-3xl border border-amber-500/20 bg-amber-500/5">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-5 h-5 text-amber-600" />
              <span className="text-[9px] font-bold text-amber-600/80 uppercase tracking-widest">Pending Review</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Awaiting Head Office</p>
            <div className="flex items-baseline justify-between">
              <p className="text-2xl font-bold font-serif text-amber-600">{pendingCount}</p>
              <p className="text-xs font-bold font-serif text-amber-700">{fmt(pendingTotal)}</p>
            </div>
          </div>

          <div className="p-5 rounded-3xl border border-blue-500/20 bg-blue-500/5">
            <div className="flex items-center justify-between mb-2">
              <RefreshCw className="w-5 h-5 text-blue-600" />
              <span className="text-[9px] font-bold text-blue-600/80 uppercase tracking-widest">In-Transit</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Cash In Route</p>
            <div className="flex items-baseline justify-between">
              <p className="text-2xl font-bold font-serif text-blue-600">{inTransitCount}</p>
              <p className="text-xs font-bold font-serif text-blue-700">{fmt(inTransitTotal)}</p>
            </div>
          </div>

          <div className="p-5 rounded-3xl border border-emerald-500/20 bg-emerald-500/5">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span className="text-[9px] font-bold text-emerald-600/80 uppercase tracking-widest">Fulfilled</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Delivered to Branch</p>
            <p className="text-2xl font-bold font-serif text-emerald-600">{fmt(completedTotal)}</p>
          </div>

          <div className="p-5 rounded-3xl border border-[#1ca34c]/20 bg-[#1ca34c]/5">
            <div className="flex items-center justify-between mb-2">
              <Coins className="w-5 h-5 text-[#15803d]" />
              <span className="text-[9px] font-bold text-[#15803d]/80 uppercase tracking-widest">Total Volume</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Cumulative Cash Requisitions</p>
            <p className="text-2xl font-bold font-serif text-[#15803d]">{fmt(totalAllCash)}</p>
          </div>
        </div>

        {/* ── Filter Bar ── */}
        <div className="mb-6 p-4 rounded-3xl border border-slate-900/10 bg-slate-900/[0.04] flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search by branch, manager, or reason..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl py-2.5 pl-10 pr-3.5 text-xs text-slate-900 placeholder-slate-500 focus:outline-none focus:border-[#1ca34c]/40 w-full transition-colors"
            />
          </div>

          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-white border border-slate-900/15 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 md:w-44 cursor-pointer"
          >
            <option value="all">All Statuses ({requests.length})</option>
            <option value="requested">Requested ({pendingCount})</option>
            <option value="processing">In-Transit ({inTransitCount})</option>
            <option value="completed">Completed</option>
            <option value="rejected">Declined</option>
          </select>

          <select
            value={filterBranch}
            onChange={e => setFilterBranch(e.target.value)}
            className="bg-white border border-slate-900/15 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 md:w-48 cursor-pointer"
          >
            <option value="">All Branches ({branches.length})</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>

          <select
            value={filterUrgency}
            onChange={e => setFilterUrgency(e.target.value)}
            className="bg-white border border-slate-900/15 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 md:w-36 cursor-pointer"
          >
            <option value="all">All Urgency</option>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </select>

          {(search || filterStatus !== 'all' || filterBranch || filterUrgency !== 'all') && (
            <button
              onClick={() => { setSearch(''); setFilterStatus('all'); setFilterBranch(''); setFilterUrgency('all') }}
              className="px-3 py-2 rounded-xl bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-500 hover:text-slate-900 text-xs font-semibold transition-all cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        {/* ── Data Table ── */}
        <div className="rounded-3xl border border-slate-900/10 bg-slate-900/[0.04] overflow-hidden shadow-xl">
          <div className="p-4 sm:p-5 border-b border-slate-900/10 bg-slate-900/[0.04] flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2">
              <Coins className="w-4 h-4 text-[#15803d]" />
              Branch Change Requisitions ({filtered.length})
            </p>
            <span className="text-[10px] text-slate-500">1 Bundle = 100 Notes</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-900/10 bg-slate-900/[0.04]">
                  {['#', 'Branch & Manager', 'Date & Priority', 'Bundles Requested', 'Total Value', 'Status', 'Task Link', 'Actions'].map((h, i) => (
                    <th
                      key={h}
                      className={`p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap ${
                        i === 0 ? 'text-center w-10' : i === 4 ? 'text-right' : i === 7 ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/[0.08]">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-16 text-slate-500">
                      <Coins className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                      <p>No branch change requisitions matching current filters.</p>
                    </td>
                  </tr>
                ) : (
                  filtered.map((req, idx) => {
                    const statusInfo = statusConfig[req.status] || statusConfig.requested
                    const StatusIcon = statusInfo.icon

                    return (
                      <tr key={req.id} className="hover:bg-slate-900/[0.04] transition-colors">
                        <td className="p-3.5 text-center text-slate-500 font-mono">
                          {idx + 1}
                        </td>

                        {/* Branch & Manager */}
                        <td className="p-3.5 whitespace-nowrap">
                          <div>
                            <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5 text-[#15803d]" /> {req.branch_name || 'Branch'}
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {req.manager_name || 'Branch Manager'}
                            </p>
                          </div>
                        </td>

                        {/* Date & Priority */}
                        <td className="p-3.5 whitespace-nowrap font-mono text-slate-600">
                          <div>
                            <p>{new Date(req.created_at).toLocaleDateString('en-GB')}</p>
                            <span className={`inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                              req.urgency === 'urgent'
                                ? 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                                : 'bg-slate-100 text-slate-500 border-slate-900/10'
                            }`}>
                              {req.urgency}
                            </span>
                          </div>
                        </td>

                        {/* Bundles Breakdown */}
                        <td className="p-3.5">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {req.bundle_10_count > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 border border-amber-500/20 font-mono">
                                ৳10 × {req.bundle_10_count}
                              </span>
                            )}
                            {req.bundle_20_count > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 font-mono">
                                ৳20 × {req.bundle_20_count}
                              </span>
                            )}
                            {req.bundle_50_count > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-700 border border-blue-500/20 font-mono">
                                ৳50 × {req.bundle_50_count}
                              </span>
                            )}
                            {req.bundle_100_count > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/10 text-purple-700 border border-purple-500/20 font-mono">
                                ৳100 × {req.bundle_100_count}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Total Amount */}
                        <td className="p-3.5 whitespace-nowrap text-right font-serif font-bold text-[#15803d] text-sm">
                          {fmt(req.total_amount)}
                        </td>

                        {/* Status */}
                        <td className="p-3.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${statusInfo.cls}`}>
                            <StatusIcon className="w-3 h-3" />
                            {statusInfo.label}
                          </span>
                        </td>

                        {/* Task Link */}
                        <td className="p-3.5 whitespace-nowrap">
                          {req.task_id ? (
                            <Link
                              href={`/admin/tasks?search=${req.id}`}
                              className="text-[11px] text-blue-600 hover:text-blue-700 flex items-center gap-1 hover:underline"
                            >
                              Task Linked <ExternalLink className="w-3 h-3" />
                            </Link>
                          ) : (
                            <span className="text-slate-600 text-[11px]">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="p-3.5 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setViewDetailReq(req)}
                              className="p-3 rounded-lg bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-500 hover:text-slate-900"
                              title="View full details"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            {req.status === 'requested' && (
                              <>
                                <button
                                  onClick={() => handleOpenAction(req, 'processing')}
                                  className="px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 border border-blue-500/30 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                                >
                                  Dispatch
                                </button>
                                <button
                                  onClick={() => handleOpenAction(req, 'rejected')}
                                  className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 border border-rose-500/30 text-[11px] font-semibold cursor-pointer transition-colors"
                                >
                                  Decline
                                </button>
                              </>
                            )}

                            {req.status === 'processing' && (
                              <button
                                onClick={() => handleOpenAction(req, 'completed')}
                                className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 border border-emerald-500/30 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                Complete
                              </button>
                            )}

                            {req.status === 'completed' && (
                              <span className="text-[11px] text-emerald-600 font-semibold px-2">
                                Delivered
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* ── Modal: Status Action Confirmation ── */}
      <AnimatePresence>
        {activeRequest && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-900/15 rounded-3xl w-full max-w-md shadow-2xl p-6 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-900/10 mb-4">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#15803d] tracking-wider">Treasury Action</span>
                  <h3 className="text-base font-bold text-slate-900 font-serif mt-0.5">
                    Update Requisition Status
                  </h3>
                </div>
                <button
                  onClick={() => setActiveRequest(null)}
                  className="p-3 rounded-lg bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-500 hover:text-slate-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmitStatus} className="space-y-4">
                <div className="p-3.5 rounded-xl border border-slate-900/10 bg-slate-900/[0.04]">
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-slate-500">Branch:</span>
                    <strong className="text-slate-900">{activeRequest.branch_name}</strong>
                  </div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-slate-500">Requisition Amount:</span>
                    <strong className="text-[#15803d] font-serif">{fmt(activeRequest.total_amount)}</strong>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500">New Target Status:</span>
                    <span className="font-bold uppercase tracking-wider text-xs px-2 py-0.5 rounded bg-slate-900/[0.07] text-slate-900">
                      {actionStatus}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-1.5">
                    Target Status
                  </label>
                  <select
                    value={actionStatus}
                    onChange={e => setActionStatus(e.target.value as any)}
                    className="w-full bg-white border border-slate-900/15 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 cursor-pointer"
                  >
                    <option value="processing">In-Transit / Processing</option>
                    <option value="completed">Completed / Fulfilled</option>
                    <option value="rejected">Declined / Rejected</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-1.5">
                    Head Office / Dispatch Notes
                  </label>
                  <textarea
                    rows={2}
                    value={actionNotes}
                    onChange={e => setActionNotes(e.target.value)}
                    placeholder="e.g. Dispatched with armored courier ref #AC-9921..."
                    className="w-full bg-white border border-slate-900/15 rounded-xl p-2.5 text-xs text-slate-900 placeholder-slate-500 focus:outline-none focus:border-[#1ca34c]/40"
                  />
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveRequest(null)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-600 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingAction}
                    className="flex-1 py-2.5 rounded-full bg-[#1ca34c] text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-lg shadow-[#1ca34c]/20 hover:opacity-95 cursor-pointer"
                  >
                    {isSubmittingAction ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="w-4 h-4" /> Save Status
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Modal: Detail View ── */}
      <AnimatePresence>
        {viewDetailReq && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-900/15 rounded-3xl w-full max-w-md shadow-2xl p-6 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-900/10 mb-4">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#15803d] tracking-wider">Requisition Inspector</span>
                  <h3 className="text-base font-bold text-slate-900 font-serif mt-0.5">
                    {viewDetailReq.branch_name}
                  </h3>
                </div>
                <button
                  onClick={() => setViewDetailReq(null)}
                  className="p-3 rounded-lg bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-500 hover:text-slate-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-900/5">
                  <span className="text-slate-500">Manager</span>
                  <span className="text-slate-900 font-medium">{viewDetailReq.manager_name}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-900/5">
                  <span className="text-slate-500">Date</span>
                  <span className="text-slate-900 font-mono">{new Date(viewDetailReq.created_at).toLocaleString('en-GB')}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-900/5">
                  <span className="text-slate-500">Status</span>
                  <span className="text-slate-900 font-semibold uppercase">{viewDetailReq.status}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-900/5">
                  <span className="text-slate-500">Urgency</span>
                  <span className="text-slate-900 font-semibold uppercase">{viewDetailReq.urgency}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-900/5">
                  <span className="text-slate-500">Grand Total</span>
                  <span className="text-[#15803d] font-bold font-serif text-sm">{fmt(viewDetailReq.total_amount)}</span>
                </div>

                <div className="pt-2">
                  <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1.5">Note Bundles Breakdown:</span>
                  <div className="bg-white rounded-xl p-3 border border-slate-900/5 space-y-1.5 font-mono text-[11px]">
                    {viewDetailReq.bundle_10_count > 0 && (
                      <div className="flex justify-between">
                        <span>৳10 Bundles ({viewDetailReq.bundle_10_count} × 100 pcs)</span>
                        <span className="text-amber-600">{fmt(viewDetailReq.bundle_10_count * 1000)}</span>
                      </div>
                    )}
                    {viewDetailReq.bundle_20_count > 0 && (
                      <div className="flex justify-between">
                        <span>৳20 Bundles ({viewDetailReq.bundle_20_count} × 100 pcs)</span>
                        <span className="text-emerald-600">{fmt(viewDetailReq.bundle_20_count * 2000)}</span>
                      </div>
                    )}
                    {viewDetailReq.bundle_50_count > 0 && (
                      <div className="flex justify-between">
                        <span>৳50 Bundles ({viewDetailReq.bundle_50_count} × 100 pcs)</span>
                        <span className="text-blue-600">{fmt(viewDetailReq.bundle_50_count * 5000)}</span>
                      </div>
                    )}
                    {viewDetailReq.bundle_100_count > 0 && (
                      <div className="flex justify-between">
                        <span>৳100 Bundles ({viewDetailReq.bundle_100_count} × 100 pcs)</span>
                        <span className="text-purple-600">{fmt(viewDetailReq.bundle_100_count * 10000)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {viewDetailReq.reason && (
                  <div>
                    <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Manager Note:</span>
                    <p className="bg-white p-2.5 rounded-xl border border-slate-900/5 text-slate-600 text-[11px]">
                      {viewDetailReq.reason}
                    </p>
                  </div>
                )}

                {viewDetailReq.admin_notes && (
                  <div>
                    <span className="text-[10px] uppercase text-amber-600 font-bold tracking-wider block mb-1">Head Office Note:</span>
                    <p className="bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/20 text-amber-700 text-[11px]">
                      {viewDetailReq.admin_notes}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-5 pt-3 border-t border-slate-900/10 flex justify-end">
                <button
                  onClick={() => setViewDetailReq(null)}
                  className="px-4 py-2 rounded-xl bg-slate-900/[0.07] hover:bg-slate-900/[0.08] text-slate-900 text-xs font-semibold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
