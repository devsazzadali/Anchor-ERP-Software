'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wallet, Plus, RefreshCw, AlertTriangle, Check, Clock,
  CheckCircle2, XCircle, ArrowRight, Download, FileText,
  Building2, Coins, ChevronRight, X, AlertCircle, Info, Sparkles
} from 'lucide-react'
import Link from 'next/link'
import { generatePdf } from '@/lib/pdf-generator'

const fmt = (n: number | null | undefined) =>
  '৳' + Number(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

// Banking standard: 1 bundle = 100 notes — values come from the
// canonical table in lib/bundles.ts (shared with the API + email).
const DENOMINATIONS = BUNDLE_DENOMINATIONS.map((d) => ({
  note: d.note,
  multiplier: d.bundleValue,
  label: `৳${d.note} Notes`,
  desc: `1 Bundle = ${d.notesPerBundle} pcs = ৳${d.bundleValue.toLocaleString('en-BD')}`,
}))

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
  processed_by_name: string | null
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

import { fetchWithCache, getCachedData, invalidateBranchCache } from '@/lib/branch-cache'
import { BUNDLE_DENOMINATIONS, bundleTotal } from '@/lib/bundles'

export default function BranchBundleRequestsPage() {
  const [requests, setRequests] = useState<BundleRequest[]>(() => {
    const cached = getCachedData('branch_bundle_requests')
    return Array.isArray(cached?.requests) ? cached.requests : (Array.isArray(cached) ? cached : [])
  })
  const [isLoading, setIsLoading] = useState(() => !getCachedData('branch_bundle_requests'))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Manager profile
  const [profile, setProfile] = useState<any>(null)

  // Modal State
  const [showModal, setShowModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Detail Modal
  const [selectedRequest, setSelectedRequest] = useState<BundleRequest | null>(null)

  // Form State
  const [b10, setB10] = useState<number>(0)
  const [b20, setB20] = useState<number>(0)
  const [b50, setB50] = useState<number>(0)
  const [b100, setB100] = useState<number>(0)
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal')
  const [reason, setReason] = useState<string>('')

  // Computed Grand Total
  const grandTotal = useMemo(() => bundleTotal({ b10, b20, b50, b100 }), [b10, b20, b50, b100])

  // ─── Load Data ─────────────────────────────────────────────────────────────
  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (!res.ok) return
      const me = await res.json()
      if (me?.profile) setProfile(me.profile)
    } catch {}
  }, [])

  const fetchRequests = useCallback(async () => {
    try {
      const json = await fetchWithCache('branch_bundle_requests', '/api/branch-accounts/bundle-requests', 45000)
      if (json?.requests) {
        setRequests(json.requests)
      }
    } catch (e) {
      console.error(e)
    }
  }, [])

  const fetchAll = useCallback(async () => {
    if (!getCachedData('branch_bundle_requests')) {
      setIsLoading(true)
    }
    await Promise.all([loadProfile(), fetchRequests()])
    setIsLoading(false)
  }, [loadProfile, fetchRequests])

  useEffect(() => {
    fetchAll()

    // the legacy realtime subscription is replaced with
    // refetch on window focus + a 30 s polling interval.
    const onFocus = () => { fetchRequests() }
    window.addEventListener('focus', onFocus)
    const interval = setInterval(() => { fetchRequests() }, 30000)

    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [fetchAll, fetchRequests])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchRequests()
    setIsRefreshing(false)
  }

  // ─── Submit Requisition ───────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (grandTotal <= 0) {
      setFeedback({ type: 'error', message: 'Please request at least one note bundle.' })
      return
    }

    setIsSubmitting(true)
    setFeedback(null)

    try {
      const res = await fetch('/api/branch-accounts/bundle-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bundle_10_count: b10,
          bundle_20_count: b20,
          bundle_50_count: b50,
          bundle_100_count: b100,
          urgency,
          reason,
        }),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to submit requisition')

      invalidateBranchCache('branch_bundle_')
      setFeedback({ type: 'success', message: '✓ Change bundle requisition submitted! Head Office and Admin Tasks notified.' })
      setShowModal(false)
      resetForm()
      await fetchRequests()
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || 'Submission error' })
    } finally {
      setIsSubmitting(false)
      setTimeout(() => setFeedback(null), 5000)
    }
  }

  const resetForm = () => {
    setB10(0)
    setB20(0)
    setB50(0)
    setB100(0)
    setUrgency('normal')
    setReason('')
  }

  // ─── PDF Export ───────────────────────────────────────────────────────────
  const handleExportPdf = async () => {
    if (requests.length === 0) {
      setFeedback({ type: 'error', message: 'No requisitions recorded to export.' })
      return
    }

    try {
      const columns = ['#', 'Date', 'Urgency', '10 BDT', '20 BDT', '50 BDT', '100 BDT', 'Total (BDT)', 'Status', 'Remarks']
      const rows: (string | number)[][] = requests.map((r, idx) => [
        idx + 1,
        new Date(r.created_at).toLocaleDateString('en-GB'),
        r.urgency.toUpperCase(),
        `${r.bundle_10_count} bndl (BDT ${(r.bundle_10_count * 1000).toLocaleString('en-BD')})`,
        `${r.bundle_20_count} bndl (BDT ${(r.bundle_20_count * 2000).toLocaleString('en-BD')})`,
        `${r.bundle_50_count} bndl (BDT ${(r.bundle_50_count * 5000).toLocaleString('en-BD')})`,
        `${r.bundle_100_count} bndl (BDT ${(r.bundle_100_count * 10000).toLocaleString('en-BD')})`,
        Number(r.total_amount).toLocaleString('en-BD'),
        r.status.toUpperCase(),
        r.admin_notes || r.reason || '—',
      ])

      const totalReqAmount = requests.reduce((s, r) => s + Number(r.total_amount || 0), 0)
      const completedCount = requests.filter(r => r.status === 'completed').length

      await generatePdf(
        'Branch Cash Change Bundle Statement',
        columns,
        rows,
        {
          filename: `Change_Requisitions_${profile?.branch || 'Branch'}_${new Date().toISOString().slice(0, 10)}.pdf`,
          subtitle: `OFFICIAL NOTE BUNDLE REQUISITION & REPLENISHMENT STATEMENT`,
          preparedBy: profile?.full_name || 'Branch Manager',
          branch: profile?.branch || 'Anchor Fashion Branch',
          dateRange: 'All Recorded Requisitions',
          summaryData: [
            { label: 'Total Requisitions', value: requests.length.toString() },
            { label: 'Fulfilled Requisitions', value: completedCount.toString() },
            { label: 'Total Cash Requisitioned', value: `${totalReqAmount.toLocaleString('en-BD')} BDT` },
          ],
          notes: 'Standard Bangladesh Banking Standard applied: 1 note bundle equals 100 currency pieces.'
        }
      )
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || 'Failed to export PDF' })
    }
  }

  // ─── Metrics ─────────────────────────────────────────────────────────────
  const totalRequisitions = requests.length
  const activeInTransit = requests.filter(r => ['requested', 'processing'].includes(r.status)).length
  const completedRequisitions = requests.filter(r => r.status === 'completed').length
  const totalAmountRequested = requests.reduce((s, r) => s + Number(r.total_amount || 0), 0)

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-white text-slate-900 font-sans relative">
      {/* Glow effects */}
      <div className="absolute top-[-5%] right-[-5%] w-[40%] h-[40%] bg-[#d4af37]/5 rounded-full filter blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-5%] left-[10%] w-[45%] h-[45%] bg-blue-500/5 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="relative z-10 flex flex-col p-4 md:p-6 max-w-7xl mx-auto custom-scrollbar">

        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-5 border-b border-slate-900/10">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] bg-[#d4af37]/10 text-[#8a6d1f] border border-[#d4af37]/20 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Coins className="w-3 h-3" /> Branch Accounts
              </span>
              {profile?.branch && (
                <span className="text-[10px] bg-slate-900/[0.04] text-slate-600 border border-slate-900/10 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                  <Building2 className="w-3 h-3 text-[#8a6d1f]" /> {profile.branch}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-serif flex items-center gap-2">
              Cash Change Requisitions
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Request 10, 20, 50, and 100 BDT note bundles from Head Office with automatic task synchronization.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleRefresh}
              className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/30 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[#8a6d1f]' : ''}`}
              title="Refresh requisitions"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <button
              onClick={handleExportPdf}
              className="px-3.5 py-2.5 rounded-xl bg-slate-900/[0.04] hover:bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4 text-[#8a6d1f]" />
              Export PDF
            </button>

            <button
              onClick={() => { resetForm(); setShowModal(true) }}
              className="bg-gradient-to-r from-[#d4af37] to-white text-black font-semibold px-4 py-2.5 rounded-xl text-xs tracking-wider uppercase flex items-center gap-2 shadow-lg shadow-[#d4af37]/15 hover:opacity-95 active:scale-95 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New Bundle Request
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

        {/* ── Metrics Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="p-5 rounded-2xl border border-slate-900/10 bg-slate-900/[0.04]">
            <div className="flex items-center justify-between mb-2">
              <FileText className="w-5 h-5 text-slate-500" />
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Requisitions</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Total Submissions</p>
            <p className="text-2xl font-bold font-serif text-slate-900">{totalRequisitions}</p>
          </div>

          <div className="p-5 rounded-2xl border border-amber-500/20 bg-amber-500/5">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-5 h-5 text-amber-600" />
              <span className="text-[9px] font-bold text-amber-600/80 uppercase tracking-widest">Active / In-Transit</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Pending Head Office</p>
            <p className="text-2xl font-bold font-serif text-amber-600">{activeInTransit}</p>
          </div>

          <div className="p-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span className="text-[9px] font-bold text-emerald-600/80 uppercase tracking-widest">Fulfilled</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Received at Branch</p>
            <p className="text-2xl font-bold font-serif text-emerald-600">{completedRequisitions}</p>
          </div>

          <div className="p-5 rounded-2xl border border-[#d4af37]/20 bg-[#d4af37]/5">
            <div className="flex items-center justify-between mb-2">
              <Coins className="w-5 h-5 text-[#8a6d1f]" />
              <span className="text-[9px] font-bold text-[#8a6d1f]/80 uppercase tracking-widest">Total Cash Value</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Total Requisitioned</p>
            <p className="text-2xl font-bold font-serif text-[#8a6d1f]">{fmt(totalAmountRequested)}</p>
          </div>
        </div>

        {/* ── Requisitions List / Table ── */}
        <div className="rounded-2xl border border-slate-900/10 bg-slate-900/[0.04] overflow-hidden shadow-xl">
          <div className="p-4 sm:p-5 border-b border-slate-900/10 bg-slate-900/[0.04] flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2">
              <Coins className="w-4 h-4 text-[#8a6d1f]" />
              Requisition History ({requests.length})
            </p>
            <span className="text-[10px] text-slate-500">1 Bundle = 100 Notes</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-900/10 bg-slate-900/[0.04]">
                  {['#', 'Date & Urgency', 'Bundles Requested', 'Total Value', 'Status', 'Admin Notes / Remarks', 'Action'].map((h, i) => (
                    <th
                      key={h}
                      className={`p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap ${
                        i === 0 ? 'text-center w-10' : i === 3 ? 'text-right' : i === 6 ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/[0.08]">
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-slate-500">
                      <Coins className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                      <p>No change bundle requisitions recorded yet.</p>
                      <button
                        onClick={() => { resetForm(); setShowModal(true) }}
                        className="mt-3 text-xs text-[#8a6d1f] hover:underline"
                      >
                        Create your first bundle request
                      </button>
                    </td>
                  </tr>
                ) : (
                  requests.map((req, idx) => {
                    const statusInfo = statusConfig[req.status] || statusConfig.requested
                    const StatusIcon = statusInfo.icon

                    return (
                      <tr key={req.id} className="hover:bg-slate-900/[0.04] transition-colors">
                        <td className="p-3.5 text-center text-slate-500 font-mono">
                          {idx + 1}
                        </td>

                        {/* Date & Urgency */}
                        <td className="p-3.5 whitespace-nowrap">
                          <div>
                            <p className="font-mono text-slate-600 text-xs">
                              {new Date(req.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </p>
                            <span className={`inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                              req.urgency === 'urgent'
                                ? 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                                : 'bg-slate-100 text-slate-500 border-slate-900/10'
                            }`}>
                              {req.urgency}
                            </span>
                          </div>
                        </td>

                        {/* Bundles Requested */}
                        <td className="p-3.5">
                          <div className="flex flex-wrap gap-1.5 max-w-sm">
                            {req.bundle_10_count > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono">
                                ৳10 × {req.bundle_10_count} bndl ({fmt(req.bundle_10_count * 1000)})
                              </span>
                            )}
                            {req.bundle_20_count > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono">
                                ৳20 × {req.bundle_20_count} bndl ({fmt(req.bundle_20_count * 2000)})
                              </span>
                            )}
                            {req.bundle_50_count > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono">
                                ৳50 × {req.bundle_50_count} bndl ({fmt(req.bundle_50_count * 5000)})
                              </span>
                            )}
                            {req.bundle_100_count > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono">
                                ৳100 × {req.bundle_100_count} bndl ({fmt(req.bundle_100_count * 10000)})
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Total Amount */}
                        <td className="p-3.5 whitespace-nowrap text-right font-serif font-bold text-[#8a6d1f] text-sm">
                          {fmt(req.total_amount)}
                        </td>

                        {/* Status */}
                        <td className="p-3.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${statusInfo.cls}`}>
                            <StatusIcon className="w-3 h-3" />
                            {statusInfo.label}
                          </span>
                        </td>

                        {/* Admin Notes / Remarks */}
                        <td className="p-3.5 max-w-xs truncate text-slate-500">
                          {req.admin_notes ? (
                            <span className="text-amber-300/90 italic font-sans text-[11px]">
                              {req.admin_notes}
                            </span>
                          ) : req.reason ? (
                            <span className="text-slate-500 text-[11px]">{req.reason}</span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>

                        {/* Action */}
                        <td className="p-3.5 whitespace-nowrap text-right">
                          <button
                            onClick={() => setSelectedRequest(req)}
                            className="p-1.5 rounded-lg bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-600 hover:text-slate-900 text-xs inline-flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            Details <ChevronRight className="w-3 h-3" />
                          </button>
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

      {/* ── Modal: New Bundle Requisition ── */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-900/15 rounded-3xl w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              {/* Modal Header */}
              <div className="p-5 sm:p-6 border-b border-slate-900/10 bg-slate-900/[0.04] flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] bg-[#d4af37]/15 text-[#8a6d1f] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                      Requisition Slip
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">1 Bundle = 100 Notes</span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 font-serif">Request Cash Note Bundles</h2>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-3 rounded-xl text-slate-500 hover:text-slate-900 bg-slate-900/[0.04] hover:bg-slate-900/[0.07] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Form */}
              <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5 max-h-[80vh] overflow-y-auto custom-scrollbar">

                {/* Info Note */}
                <div className="p-3.5 rounded-xl border border-blue-500/20 bg-blue-500/5 text-blue-300 text-xs flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-blue-200">Bangladesh Banking Standard:</strong> Each bundle contains 100 fresh currency notes. Totals are calculated automatically.
                  </div>
                </div>

                {/* Denomination Steppers */}
                <div className="space-y-3">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center justify-between">
                    <span>Note Bundles Needed</span>
                    <span className="text-[10px] text-slate-500">Counts in Bundles</span>
                  </label>

                  {/* 10 BDT Bundle */}
                  <div className="p-3.5 rounded-2xl border border-slate-900/10 bg-slate-900/[0.04] flex items-center justify-between gap-4">
                    <div>
                      <p className="font-bold text-slate-900 text-sm">৳10 Note Bundle</p>
                      <p className="text-[11px] text-slate-500">100 pcs = ৳1,000 / bundle</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center border border-slate-900/15 rounded-xl bg-white overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setB10(Math.max(0, b10 - 1))}
                          className="px-3 py-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.07] text-sm font-bold cursor-pointer"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={b10}
                          onChange={e => setB10(Math.max(0, parseInt(e.target.value, 10) || 0))}
                          className="w-12 text-center bg-transparent text-slate-900 font-mono font-bold text-sm focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setB10(b10 + 1)}
                          className="px-3 py-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.07] text-sm font-bold cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                      <span className="w-20 text-right font-serif font-bold text-amber-300 text-xs">
                        {fmt(b10 * 1000)}
                      </span>
                    </div>
                  </div>

                  {/* 20 BDT Bundle */}
                  <div className="p-3.5 rounded-2xl border border-slate-900/10 bg-slate-900/[0.04] flex items-center justify-between gap-4">
                    <div>
                      <p className="font-bold text-slate-900 text-sm">৳20 Note Bundle</p>
                      <p className="text-[11px] text-slate-500">100 pcs = ৳2,000 / bundle</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center border border-slate-900/15 rounded-xl bg-white overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setB20(Math.max(0, b20 - 1))}
                          className="px-3 py-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.07] text-sm font-bold cursor-pointer"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={b20}
                          onChange={e => setB20(Math.max(0, parseInt(e.target.value, 10) || 0))}
                          className="w-12 text-center bg-transparent text-slate-900 font-mono font-bold text-sm focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setB20(b20 + 1)}
                          className="px-3 py-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.07] text-sm font-bold cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                      <span className="w-20 text-right font-serif font-bold text-emerald-300 text-xs">
                        {fmt(b20 * 2000)}
                      </span>
                    </div>
                  </div>

                  {/* 50 BDT Bundle */}
                  <div className="p-3.5 rounded-2xl border border-slate-900/10 bg-slate-900/[0.04] flex items-center justify-between gap-4">
                    <div>
                      <p className="font-bold text-slate-900 text-sm">৳50 Note Bundle</p>
                      <p className="text-[11px] text-slate-500">100 pcs = ৳5,000 / bundle</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center border border-slate-900/15 rounded-xl bg-white overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setB50(Math.max(0, b50 - 1))}
                          className="px-3 py-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.07] text-sm font-bold cursor-pointer"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={b50}
                          onChange={e => setB50(Math.max(0, parseInt(e.target.value, 10) || 0))}
                          className="w-12 text-center bg-transparent text-slate-900 font-mono font-bold text-sm focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setB50(b50 + 1)}
                          className="px-3 py-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.07] text-sm font-bold cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                      <span className="w-20 text-right font-serif font-bold text-blue-300 text-xs">
                        {fmt(b50 * 5000)}
                      </span>
                    </div>
                  </div>

                  {/* 100 BDT Bundle */}
                  <div className="p-3.5 rounded-2xl border border-slate-900/10 bg-slate-900/[0.04] flex items-center justify-between gap-4">
                    <div>
                      <p className="font-bold text-slate-900 text-sm">৳100 Note Bundle</p>
                      <p className="text-[11px] text-slate-500">100 pcs = ৳10,000 / bundle</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center border border-slate-900/15 rounded-xl bg-white overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setB100(Math.max(0, b100 - 1))}
                          className="px-3 py-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.07] text-sm font-bold cursor-pointer"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={b100}
                          onChange={e => setB100(Math.max(0, parseInt(e.target.value, 10) || 0))}
                          className="w-12 text-center bg-transparent text-slate-900 font-mono font-bold text-sm focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setB100(b100 + 1)}
                          className="px-3 py-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.07] text-sm font-bold cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                      <span className="w-20 text-right font-serif font-bold text-purple-300 text-xs">
                        {fmt(b100 * 10000)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Grand Total Bar */}
                <div className="p-4 rounded-2xl border border-[#d4af37]/30 bg-gradient-to-r from-[#d4af37]/10 to-transparent flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase tracking-widest text-[#8a6d1f] font-bold">Grand Requisition Total</span>
                    <p className="text-xs text-slate-500">
                      {(b10 + b20 + b50 + b100)} bundle(s) | {(b10 + b20 + b50 + b100) * 100} total currency notes
                    </p>
                  </div>
                  <p className="text-2xl font-bold font-serif text-[#8a6d1f]">
                    {fmt(grandTotal)}
                  </p>
                </div>

                {/* Urgency Selector */}
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-2">
                    Priority / Urgency
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setUrgency('normal')}
                      className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                        urgency === 'normal'
                          ? 'bg-[#d4af37]/10 border-[#d4af37]/40 text-[#8a6d1f]'
                          : 'bg-slate-900/[0.04] border-slate-900/10 text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      <Clock className="w-4 h-4" /> Normal (2-3 Days)
                    </button>
                    <button
                      type="button"
                      onClick={() => setUrgency('urgent')}
                      className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                        urgency === 'urgent'
                          ? 'bg-rose-500/10 border-rose-500/40 text-rose-600'
                          : 'bg-slate-900/[0.04] border-slate-900/10 text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      <AlertCircle className="w-4 h-4" /> Urgent (Next Day)
                    </button>
                  </div>
                </div>

                {/* Reason / Remarks */}
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-2">
                    Reason / Cash Drawer Remarks
                  </label>
                  <textarea
                    rows={2}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="e.g. Weekend retail rush expected; change drawer running low..."
                    className="w-full bg-white border border-slate-900/10 rounded-xl p-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40"
                  />
                </div>

                {/* Submit button */}
                <div className="pt-2 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 py-3 rounded-xl bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-600 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || grandTotal <= 0}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#d4af37] to-white text-black text-xs font-bold uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-[#d4af37]/20 hover:opacity-95 cursor-pointer"
                  >
                    {isSubmitting ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="w-4 h-4" /> Submit Requisition
                      </>
                    )}
                  </button>
                </div>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Modal: Requisition Details ── */}
      <AnimatePresence>
        {selectedRequest && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-900/15 rounded-3xl w-full max-w-md shadow-2xl p-6 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-900/10 mb-4">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#8a6d1f] tracking-wider">Requisition Details</span>
                  <h3 className="text-base font-bold text-slate-900 font-serif mt-0.5">
                    Ref #{selectedRequest.id.slice(0, 8)}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedRequest(null)}
                  className="p-3 rounded-lg bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-500 hover:text-slate-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3.5 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-900/5">
                  <span className="text-slate-500">Date</span>
                  <span className="text-slate-900 font-mono">{new Date(selectedRequest.created_at).toLocaleString('en-GB')}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-900/5">
                  <span className="text-slate-500">Status</span>
                  <span className="text-slate-900 font-semibold uppercase">{selectedRequest.status}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-900/5">
                  <span className="text-slate-500">Urgency</span>
                  <span className="text-slate-900 font-semibold uppercase">{selectedRequest.urgency}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-900/5">
                  <span className="text-slate-500">Grand Total</span>
                  <span className="text-[#8a6d1f] font-bold font-serif text-sm">{fmt(selectedRequest.total_amount)}</span>
                </div>

                <div className="pt-2">
                  <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1.5">Note Bundles:</span>
                  <div className="bg-white rounded-xl p-3 border border-slate-900/5 space-y-1.5 font-mono text-[11px]">
                    {selectedRequest.bundle_10_count > 0 && (
                      <div className="flex justify-between">
                        <span>৳10 Bundles ({selectedRequest.bundle_10_count} × 100 pcs)</span>
                        <span className="text-amber-600">{fmt(selectedRequest.bundle_10_count * 1000)}</span>
                      </div>
                    )}
                    {selectedRequest.bundle_20_count > 0 && (
                      <div className="flex justify-between">
                        <span>৳20 Bundles ({selectedRequest.bundle_20_count} × 100 pcs)</span>
                        <span className="text-emerald-600">{fmt(selectedRequest.bundle_20_count * 2000)}</span>
                      </div>
                    )}
                    {selectedRequest.bundle_50_count > 0 && (
                      <div className="flex justify-between">
                        <span>৳50 Bundles ({selectedRequest.bundle_50_count} × 100 pcs)</span>
                        <span className="text-blue-600">{fmt(selectedRequest.bundle_50_count * 5000)}</span>
                      </div>
                    )}
                    {selectedRequest.bundle_100_count > 0 && (
                      <div className="flex justify-between">
                        <span>৳100 Bundles ({selectedRequest.bundle_100_count} × 100 pcs)</span>
                        <span className="text-purple-600">{fmt(selectedRequest.bundle_100_count * 10000)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {selectedRequest.reason && (
                  <div>
                    <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Reason:</span>
                    <p className="bg-white p-2.5 rounded-xl border border-slate-900/5 text-slate-600 text-[11px]">
                      {selectedRequest.reason}
                    </p>
                  </div>
                )}

                {selectedRequest.admin_notes && (
                  <div>
                    <span className="text-[10px] uppercase text-amber-600 font-bold tracking-wider block mb-1">Head Office Notes:</span>
                    <p className="bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/20 text-amber-300 text-[11px]">
                      {selectedRequest.admin_notes}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-5 pt-3 border-t border-slate-900/10 flex justify-end">
                <button
                  onClick={() => setSelectedRequest(null)}
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
