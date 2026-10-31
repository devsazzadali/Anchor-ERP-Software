'use client'

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, ZoomIn, ZoomOut, RotateCw, Download, ExternalLink,
  CheckCircle, XCircle, FileText, Image as ImageIcon, Building2,
  Calendar, CreditCard, Hash, AlertCircle, Layers
} from 'lucide-react'
import { parseDailyBreakdown, getDailyBreakdownList, cleanDepositNotes, parseKhuchraAmount } from '@/lib/branch-deposit-utils'

interface DepositData {
  id: string
  branch_name?: string
  branch?: { name?: string }
  manager_name?: string
  amount: number
  deposit_date: string
  sales_from_date?: string | null
  sales_to_date?: string | null
  bank_account_name?: string
  bank_account_number?: string | null
  deposit_slip_number?: string | null
  bank_transaction_id?: string | null
  slip_attachment_url?: string | null
  bank_statement_url?: string | null
  status: string
  notes?: string | null
  daily_breakdown?: Record<string, number> | null
  rejection_reason?: string | null
  reviewed_by_name?: string | null
}

interface DepositSlipModalProps {
  isOpen: boolean
  onClose: () => void
  deposit: DepositData | null
  activeUrl?: string | null
  title?: string
  onApprove?: (id: string) => Promise<void> | void
  onReject?: (id: string, reason: string) => Promise<void> | void
  isProcessingAction?: boolean
}

const fmt = (n: number | null | undefined) =>
  '৳' + Number(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default function DepositSlipModal({
  isOpen,
  onClose,
  deposit,
  activeUrl,
  title = 'Deposit Slip / Bank Receipt',
  onApprove,
  onReject,
  isProcessingAction = false
}: DepositSlipModalProps) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [imageError, setImageError] = useState(false)
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  // Determine effective media URL
  const fileUrl = activeUrl || deposit?.slip_attachment_url || deposit?.bank_statement_url || null
  const isPdf = fileUrl ? (fileUrl.toLowerCase().includes('.pdf') || fileUrl.includes('application/pdf')) : false

  // Reset transforms whenever deposit changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setZoom(1)
      setRotation(0)
      setImageError(false)
      setShowRejectInput(false)
      setRejectReason('')
    }
  }, [isOpen, fileUrl])

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !deposit) return null

  const branchLabel = deposit.branch?.name || deposit.branch_name || 'Branch'
  const isPending = ['submitted', 'pending_approval'].includes(deposit.status)

  const handleZoomIn = () => setZoom(z => Math.min(3, z + 0.25))
  const handleZoomOut = () => setZoom(z => Math.max(0.5, z - 0.25))
  const handleResetZoom = () => { setZoom(1); setRotation(0) }
  const handleRotate = () => setRotation(r => (r + 90) % 360)

  const handleDownload = async () => {
    if (!fileUrl) return
    try {
      const response = await fetch(fileUrl)
      const blob = await response.blob()
      const blobUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      const extension = isPdf ? 'pdf' : 'jpg'
      link.download = `Deposit_Slip_${branchLabel.replace(/\s+/g, '_')}_${deposit.deposit_date}_${deposit.deposit_slip_number || 'slip'}.${extension}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(blobUrl)
    } catch {
      window.open(fileUrl, '_blank')
    }
  }

  const handleConfirmReject = () => {
    if (!rejectReason.trim() || !onReject) return
    onReject(deposit.id, rejectReason)
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-hidden">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-950/50 backdrop-blur-md"
        />

        {/* Modal Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 15 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-5xl max-h-[92vh] flex flex-col bg-white border border-slate-900/10 rounded-3xl shadow-2xl overflow-hidden"
        >
          {/* Modal Header */}
          <div className="px-5 py-3.5 border-b border-slate-900/10 bg-slate-900/[0.04] flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[#1ca34c]/10 border border-[#1ca34c]/20 flex items-center justify-center text-[#15803d] shrink-0">
                <ImageIcon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 truncate font-serif">{title}</h3>
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                    deposit.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                    deposit.status === 'rejected' ? 'bg-rose-500/10 text-rose-600 border-rose-500/20' :
                    'bg-amber-500/10 text-amber-600 border-amber-500/20'
                  }`}>
                    {deposit.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 truncate">
                  {branchLabel} · {fmt(deposit.amount)} · Date: {deposit.deposit_date}
                  {deposit.deposit_slip_number ? ` · Slip #${deposit.deposit_slip_number}` : ''}
                </p>
              </div>
            </div>

            {/* Top Toolbar */}
            <div className="flex items-center gap-1.5 shrink-0">
              {fileUrl && !isPdf && (
                <>
                  <button
                    onClick={handleZoomIn}
                    className="p-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 hover:border-[#1ca34c]/30 transition-all cursor-pointer"
                    title="Zoom In (+)"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleZoomOut}
                    className="p-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 hover:border-[#1ca34c]/30 transition-all cursor-pointer"
                    title="Zoom Out (-)"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleRotate}
                    className="p-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 hover:border-[#1ca34c]/30 transition-all cursor-pointer"
                    title="Rotate 90°"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleResetZoom}
                    className="px-2 py-1 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-[10px] font-bold text-slate-600 hover:text-slate-900 transition-all cursor-pointer"
                    title="Reset Zoom"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                </>
              )}

              {fileUrl && (
                <>
                  <button
                    onClick={handleDownload}
                    className="p-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 hover:border-[#1ca34c]/30 transition-all cursor-pointer"
                    title="Download Slip File"
                  >
                    <Download className="w-4 h-4 text-[#15803d]" />
                  </button>
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 hover:border-[#1ca34c]/30 transition-all"
                    title="Open Full Resolution in New Tab"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </>
              )}

              <button
                onClick={onClose}
                className="p-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-500 hover:text-slate-900 hover:border-rose-500/30 transition-all cursor-pointer ml-1"
                title="Close Modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Modal Body: Image Canvas + Details Drawer */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
            {/* Image Canvas */}
            <div className="flex-1 bg-white flex items-center justify-center p-4 relative overflow-auto select-none min-h-[320px] lg:min-h-[480px]">
              {fileUrl ? (
                isPdf ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-center p-6">
                    <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600">
                      <FileText className="w-8 h-8" />
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-slate-900">PDF Deposit Document Attached</h4>
                      <p className="text-xs text-slate-500 mt-1 max-w-sm">
                        This deposit slip is stored as a PDF document. You can open it in a new window or download it.
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2.5 rounded-full bg-[#1ca34c] hover:bg-[#15803d] text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Open PDF Document
                      </a>
                      <button
                        onClick={handleDownload}
                        className="px-4 py-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 font-semibold text-xs flex items-center gap-2 hover:border-slate-900/20 transition-all"
                      >
                        <Download className="w-3.5 h-3.5" /> Download
                      </button>
                    </div>
                  </div>
                ) : imageError ? (
                  <div className="flex flex-col items-center justify-center gap-3 text-center p-6">
                    <AlertCircle className="w-12 h-12 text-amber-600/60" />
                    <p className="text-sm font-semibold text-slate-900">Unable to display slip image</p>
                    <p className="text-xs text-slate-500 max-w-xs">
                      The image could not be rendered directly. You can try opening it directly in a new tab.
                    </p>
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-[#15803d] text-xs font-semibold hover:bg-slate-900/[0.07] transition-all flex items-center gap-2"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Open Direct Link
                    </a>
                  </div>
                ) : (
                  <div
                    className="transition-transform duration-150 ease-out flex items-center justify-center max-w-full max-h-full"
                    style={{
                      transform: `scale(${zoom}) rotate(${rotation}deg)`,
                      transformOrigin: 'center center'
                    }}
                  >
                    <img
                      src={fileUrl}
                      alt={`Deposit Slip for ${branchLabel}`}
                      onError={() => setImageError(true)}
                      className="max-h-[58vh] lg:max-h-[72vh] max-w-full object-contain rounded-lg shadow-2xl"
                    />
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 text-slate-500 py-16">
                  <FileText className="w-12 h-12 text-slate-600" />
                  <p className="text-sm font-semibold">No Slip Document Uploaded</p>
                  <p className="text-xs text-slate-600">The manager did not attach a slip photo to this submission.</p>
                </div>
              )}
            </div>

            {/* Details & Actions Sidebar */}
            <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-slate-900/10 bg-white flex flex-col justify-between overflow-y-auto max-h-[38vh] lg:max-h-none">
              <div className="p-4 space-y-4">
                {/* Branch & Amount Header */}
                <div className="p-3.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 space-y-1">
                  <p className="text-[9px] uppercase tracking-widest text-[#15803d] font-bold flex items-center gap-1.5">
                    <Building2 className="w-3 h-3" /> {branchLabel}
                  </p>
                  <p className="text-2xl font-bold font-serif text-slate-900">{fmt(deposit.amount)}</p>
                  <p className="text-[10px] text-slate-500">
                    Manager: <span className="text-slate-900 font-medium">{deposit.manager_name || '—'}</span>
                  </p>
                  {parseKhuchraAmount(deposit) > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-900/5 space-y-1 text-xs">
                      <div className="flex justify-between text-slate-500">
                        <span>Bank Deposit:</span>
                        <span className="text-slate-900 font-serif">{fmt(deposit.amount)}</span>
                      </div>
                      <div className="flex justify-between text-orange-600 font-medium">
                        <span>🪙 Khuchra (In Drawer):</span>
                        <span className="font-serif">{fmt(parseKhuchraAmount(deposit))}</span>
                      </div>
                      <div className="flex justify-between text-[#15803d] font-semibold border-t border-slate-900/5 pt-1">
                        <span>Total Cash Sales:</span>
                        <span className="font-serif">{fmt(Number(deposit.amount) + parseKhuchraAmount(deposit))}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Metadata Grid */}
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08]">
                    <span className="text-[10px] uppercase text-slate-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Deposit Date
                    </span>
                    <span className="text-slate-900 font-medium">{deposit.deposit_date}</span>
                  </div>

                  {deposit.sales_from_date && deposit.sales_to_date && (
                    <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08]">
                      <span className="text-[10px] uppercase text-slate-500 flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> Sales Period
                      </span>
                      <span className="text-slate-900 text-[11px]">
                        {deposit.sales_from_date} → {deposit.sales_to_date}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08]">
                    <span className="text-[10px] uppercase text-slate-500 flex items-center gap-1">
                      <CreditCard className="w-3 h-3" /> Bank Account
                    </span>
                    <span className="text-slate-900 text-[11px] text-right truncate max-w-[140px]" title={deposit.bank_account_name}>
                      {deposit.bank_account_name || '—'}
                    </span>
                  </div>

                  {deposit.bank_account_number && (
                    <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08]">
                      <span className="text-[10px] uppercase text-slate-500">Account No.</span>
                      <span className="text-slate-600 font-mono text-[11px]">{deposit.bank_account_number}</span>
                    </div>
                  )}

                  <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08]">
                    <span className="text-[10px] uppercase text-slate-500 flex items-center gap-1">
                      <Hash className="w-3 h-3" /> Slip Number
                    </span>
                    <span className="text-[#15803d] font-mono font-bold text-xs">
                      {deposit.deposit_slip_number || '—'}
                    </span>
                  </div>

                  {deposit.bank_transaction_id && (
                    <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08]">
                      <span className="text-[10px] uppercase text-slate-500">TXN ID</span>
                      <span className="text-slate-600 font-mono text-[11px]">{deposit.bank_transaction_id}</span>
                    </div>
                  )}
                </div>

                {/* Daily Sales Breakdown (Audio Requirement) */}
                {(() => {
                  const breakdown = parseDailyBreakdown(deposit)
                  const list = getDailyBreakdownList(breakdown)
                  if (list.length === 0) return null
                  return (
                    <div className="p-3 rounded-xl bg-gradient-to-br from-[#1ca34c]/10 to-transparent border border-[#1ca34c]/25 space-y-2">
                      <div className="flex items-center justify-between border-b border-[#1ca34c]/20 pb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#15803d] flex items-center gap-1.5">
                          <Layers className="w-3 h-3" /> প্রতিদিনের জমার বিবরণ ({list.length} Days)
                        </span>
                        <span className="text-[9px] text-slate-500 font-mono">
                          Daily Breakdown
                        </span>
                      </div>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {list.map(item => (
                          <div key={item.date} className="flex items-center justify-between text-xs py-1 px-2.5 rounded-lg bg-white border border-slate-900/5">
                            <span className="text-slate-600 font-mono text-[11px] flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#1ca34c]" />
                              {item.date}
                            </span>
                            <span className="text-[#15803d] font-serif font-bold text-xs">{fmt(item.amount)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="pt-1.5 border-t border-slate-900/10 flex justify-between text-xs font-bold">
                        <span className="text-slate-900 text-[11px]">Total Aggregated:</span>
                        <span className="text-[#15803d] font-serif">{fmt(deposit.amount)}</span>
                      </div>
                    </div>
                  )
                })()}

                {/* Notes */}
                {cleanDepositNotes(deposit.notes) && (
                  <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">Manager Notes</p>
                    <p className="text-xs text-slate-600 leading-relaxed">{cleanDepositNotes(deposit.notes)}</p>
                  </div>
                )}

                {/* Status history note */}
                {deposit.status === 'approved' && (
                  <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-600 text-xs flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    <span>Approved by {deposit.reviewed_by_name || 'Admin'}</span>
                  </div>
                )}

                {deposit.status === 'rejected' && (
                  <div className="p-3 rounded-xl bg-rose-500/5 border border-rose-500/20 text-rose-600 text-xs">
                    <p className="font-semibold flex items-center gap-1.5 mb-1">
                      <XCircle className="w-3.5 h-3.5" /> Rejection Notice
                    </p>
                    <p className="text-rose-600 text-[11px]">{deposit.rejection_reason || 'No reason specified'}</p>
                  </div>
                )}

                {/* Rejection Form Input */}
                {showRejectInput && isPending && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 space-y-2">
                    <p className="text-[10px] font-bold text-rose-600 uppercase tracking-wider">
                      Specify Rejection Reason *
                    </p>
                    <textarea
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Explain to manager why this deposit is rejected..."
                      rows={2}
                      className="w-full bg-white border border-rose-500/30 rounded-lg p-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-rose-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleConfirmReject}
                        disabled={isProcessingAction || !rejectReason.trim()}
                        className="flex-1 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs uppercase disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        {isProcessingAction ? <div className="w-3 h-3 border-2 border-slate-200 border-t-transparent rounded-full animate-spin" /> : <XCircle className="w-3 h-3" />}
                        Confirm
                      </button>
                      <button
                        onClick={() => { setShowRejectInput(false); setRejectReason('') }}
                        className="px-3 py-1.5 rounded-lg bg-slate-900/[0.04] text-slate-500 text-xs hover:text-slate-900 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Action Buttons (if pending and handlers provided) */}
              {isPending && onApprove && onReject && !showRejectInput && (
                <div className="p-4 border-t border-slate-900/10 bg-white flex gap-2">
                  <button
                    onClick={() => onApprove(deposit.id)}
                    disabled={isProcessingAction}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:opacity-90 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/10 cursor-pointer"
                  >
                    {isProcessingAction ? <div className="w-3.5 h-3.5 border-2 border-slate-200 border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    Approve
                  </button>
                  <button
                    onClick={() => setShowRejectInput(true)}
                    disabled={isProcessingAction}
                    className="flex-1 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 text-rose-600 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
