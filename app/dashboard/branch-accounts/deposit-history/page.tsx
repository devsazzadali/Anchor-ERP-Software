'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  History, ChevronLeft, RefreshCw, AlertTriangle,
  ExternalLink, Clock, CheckCircle, XCircle, FileEdit, Eye, Layers,
  FileText, Coins, Download, Edit3, Save, X, Image as ImageIcon,
  Building2, Calendar, CreditCard, Hash, Upload, ZoomIn, Info
} from 'lucide-react'
import Link from 'next/link'
import DepositSlipModal from '@/components/DepositSlipModal'
import { parseDailyBreakdown, getDailyBreakdownList, cleanDepositNotes, parseKhuchraAmount } from '@/lib/branch-deposit-utils'
import { generatePdf } from '@/lib/pdf-generator'
import { uploadFile } from '@/lib/files-client'

import { useBranchAuth } from '@/lib/hooks/use-branch-auth'
import { fetchWithCache, getCachedData, invalidateBranchCache } from '@/lib/branch-cache'

const fmt = (n: any) => (Number(n || 0) < 0 ? '-' : '') + '৳' + Math.abs(Number(n || 0)).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const formatDateTime = (isoString?: string | null) => {
  if (!isoString) return null
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return isoString
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }) + ', ' + d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  } catch {
    return isoString
  }
}

const STATUS_CONFIG: Record<string, { label: string; icon: any; cls: string; badgeCls: string }> = {
  draft:            { label: 'Draft',           icon: FileEdit,    cls: 'bg-slate-500/10 text-slate-500 border-slate-500/20', badgeCls: 'text-slate-500' },
  submitted:        { label: 'Submitted (Pending Approval)', icon: Clock, cls: 'bg-blue-500/10 text-blue-600 border-blue-500/20', badgeCls: 'text-blue-600' },
  pending_approval: { label: 'Under Review',    icon: Clock,       cls: 'bg-amber-500/10 text-amber-600 border-amber-500/20', badgeCls: 'text-amber-600' },
  approved:         { label: 'Approved by Admin', icon: CheckCircle, cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', badgeCls: 'text-emerald-600' },
  rejected:         { label: 'Rejected',        icon: XCircle,     cls: 'bg-rose-500/10 text-rose-600 border-rose-500/20', badgeCls: 'text-rose-600' },
}

export default function DepositHistoryPage() {
  const router = useRouter()
  const { isAuthorized, isLoading: isAuthLoading } = useBranchAuth()
  const [selectedStatus, setSelectedStatus] = useState('all')

  const cacheKey = `branch_deposits_${selectedStatus}`
  const [deposits, setDeposits] = useState<any[]>(() => {
    const cached = getCachedData(cacheKey)
    return cached?.deposits || []
  })
  const [isLoading, setIsLoading] = useState(() => !getCachedData(cacheKey))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [selectedSlipDeposit, setSelectedSlipDeposit] = useState<any | null>(null)

  // Manager Edit Submission State
  const [editingDeposit, setEditingDeposit] = useState<any | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editKhuchra, setEditKhuchra] = useState('')
  const [editBankName, setEditBankName] = useState('')
  const [editBankAcctNumber, setEditBankAcctNumber] = useState('')
  const [editSlipNumber, setEditSlipNumber] = useState('')
  const [editTxnId, setEditTxnId] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editSlipFile, setEditSlipFile] = useState<File | null>(null)
  const [editSlipPreview, setEditSlipPreview] = useState<string | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthLoading && !isAuthorized) {
      router.replace('/dashboard/branch-accounts')
    }
  }, [isAuthLoading, isAuthorized, router])

  const fetchDeposits = useCallback(async () => {
    const params = selectedStatus !== 'all' ? `?status=${selectedStatus}` : ''
    const key = `branch_deposits_${selectedStatus}`
    try {
      const json = await fetchWithCache(key, `/api/branch-accounts/deposits${params}`, 45000)
      if (json?.deposits) setDeposits(json.deposits)
      else if (json?.error) setError(json.error)
    } catch (e: any) {
      setError(e.message)
    }
  }, [selectedStatus])

  useEffect(() => {
    if (!isAuthorized) return
    const key = `branch_deposits_${selectedStatus}`
    const cached = getCachedData(key)
    if (cached?.deposits) {
      setDeposits(cached.deposits)
      setIsLoading(false)
    }
    fetchDeposits().finally(() => setIsLoading(false))
  }, [isAuthorized, selectedStatus, fetchDeposits])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    invalidateBranchCache('branch_deposits')
    await fetchDeposits()
    setIsRefreshing(false)
  }

  const openEditModal = (dep: any) => {
    setEditingDeposit(dep)
    setEditAmount(String(dep.amount || ''))
    setEditKhuchra(String(dep.khuchra_amount || parseKhuchraAmount(dep) || ''))
    setEditBankName(dep.bank_account_name || '')
    setEditBankAcctNumber(dep.bank_account_number || '')
    setEditSlipNumber(dep.deposit_slip_number || '')
    setEditTxnId(dep.bank_transaction_id || '')
    setEditNotes(cleanDepositNotes(dep.notes) || '')
    setEditSlipFile(null)
    setEditSlipPreview(dep.slip_attachment_url || null)
    setEditError(null)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setEditSlipFile(file)
    const reader = new FileReader()
    reader.onload = () => {
      setEditSlipPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleSaveSubmissionEdit = async () => {
    if (!editingDeposit) return
    if (!editAmount || isNaN(Number(editAmount)) || Number(editAmount) <= 0) {
      setEditError('Please enter a valid deposit amount (Amount > 0).')
      return
    }
    if (!editBankName.trim()) {
      setEditError('Bank account name is required.')
      return
    }

    setIsSavingEdit(true)
    setEditError(null)

    try {
      let uploadedSlipUrl = editingDeposit.slip_attachment_url

      if (editSlipFile) {
        const ext = editSlipFile.name.split('.').pop() || 'jpg'
        const fileName = `${editingDeposit.branch_id || 'branch'}_${Date.now()}.${ext}`
        try {
          const uploaded = await uploadFile('branch-deposits', editSlipFile, fileName)
          uploadedSlipUrl = uploaded.url
        } catch (uploadError: any) {
          throw new Error(`Slip upload failed: ${uploadError.message}`)
        }
      }

      const res = await fetch('/api/branch-accounts/deposits', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingDeposit.id,
          amount: Number(editAmount),
          khuchra_amount: editKhuchra ? Number(editKhuchra) : 0,
          bank_account_name: editBankName,
          bank_account_number: editBankAcctNumber || null,
          deposit_slip_number: editSlipNumber || null,
          bank_transaction_id: editTxnId || null,
          slip_attachment_url: uploadedSlipUrl,
          notes: editNotes || undefined,
        })
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to update deposit submission.')

      invalidateBranchCache('branch_deposits')
      setSuccessMessage('Deposit submission updated successfully!')
      setEditingDeposit(null)
      await fetchDeposits()
      setTimeout(() => setSuccessMessage(null), 4000)
    } catch (err: any) {
      setEditError(err.message || 'Error occurred while updating submission.')
    } finally {
      setIsSavingEdit(false)
    }
  }

  const totalApproved = deposits.filter(d => d.status === 'approved').reduce((s, d) => s + Number(d.amount), 0)
  const totalPending  = deposits.filter(d => ['submitted', 'pending_approval'].includes(d.status)).reduce((s, d) => s + Number(d.amount), 0)
  const totalKhuchra  = deposits.reduce((s, d) => s + parseKhuchraAmount(d), 0)

  const handleExportPdf = async () => {
    if (deposits.length === 0) return
    setIsExporting(true)
    try {
      const columns = ['#', 'Date & Time', 'Sales Period', 'Deposited (BDT)', 'Khuchra (BDT)', 'Bank Info', 'Slip/TXN', 'Status']
      const rows = deposits.map((d: any, idx) => {
        const time = d.submitted_at || d.created_at
        const timeStr = time ? new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : ''
        const dateTime = `${d.deposit_date || '—'}${timeStr ? '\n' + timeStr : ''}`
        const bankInfo = `${d.bank_account_name || '—'}${d.bank_account_number ? '\nA/C: ' + d.bank_account_number : ''}`
        const refInfo = (d.deposit_slip_number ? `Slip: ${d.deposit_slip_number}` : '') + (d.deposit_slip_number && d.bank_transaction_id ? '\n' : '') + (d.bank_transaction_id ? `TXN: ${d.bank_transaction_id}` : '')

        return [
          idx + 1,
          dateTime,
          d.sales_from_date && d.sales_to_date ? `${d.sales_from_date} to ${d.sales_to_date}` : (d.sales_from_date || '—'),
          Number(d.amount).toLocaleString('en-BD'),
          parseKhuchraAmount(d) > 0 ? parseKhuchraAmount(d).toLocaleString('en-BD') : '0',
          bankInfo,
          refInfo,
          (d.status || '').toUpperCase(),
        ]
      })
      await generatePdf('Branch Deposit & Khuchra Statement', columns, rows, {
        filename: `Deposit_Khuchra_Statement_${new Date().toISOString().slice(0, 10)}.pdf`,
        subtitle: 'BRANCH BANK DEPOSIT & DRAWER CHANGE (KHUCHRA) RECORD',
        summaryData: [
          { label: 'Total Submissions', value: deposits.length.toString() },
          { label: 'Total Deposited', value: `${totalApproved.toLocaleString('en-BD')} BDT` },
          { label: 'Total Khuchra Kept', value: `${totalKhuchra.toLocaleString('en-BD')} BDT` },
        ],
        notes: 'Khuchra refers to small-denomination cash retained in the branch drawer after banking the rounded deposit amount.',
      })
    } catch (e: any) {
      setError(e.message || 'Failed to export PDF')
    } finally {
      setIsExporting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 pb-16">
      <div className="relative z-10 p-4 md:p-6 max-w-4xl mx-auto">
        {/* Top Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/dashboard/branch-accounts"
            className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <History className="w-5 h-5 text-[#15803d]" /> Bank Deposit History
            </h1>
            <p className="text-[11px] text-slate-500">Track all bank deposit submissions, status & khuchra amounts</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleRefresh}
              className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}
              title="Refresh deposits"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={handleExportPdf}
              disabled={isExporting || deposits.length === 0}
              title="Download Deposit & Khuchra PDF Report"
              className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 hover:text-[#15803d] hover:border-[#1ca34c]/20 transition-all cursor-pointer disabled:opacity-40"
            >
              <FileText className="w-4 h-4" />
            </button>
            <Link href="/dashboard/branch-accounts/bank-deposit"
              className="px-4 py-2.5 rounded-full bg-[#1ca34c] hover:bg-[#15803d] text-white font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-all shadow-lg shadow-[#1ca34c]/15"
            >
              + New Deposit
            </Link>
          </div>
        </div>

        {/* Global Notifications */}
        {error && (
          <div className="mb-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
        {successMessage && (
          <div className="mb-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" /> {successMessage}
          </div>
        )}

        {/* Summary Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-[10px] uppercase tracking-wider text-emerald-600/80 font-bold mb-1">Approved Deposits</p>
            <p className="text-2xl font-bold font-serif text-slate-900">{fmt(totalApproved)}</p>
          </div>
          <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20">
            <p className="text-[10px] uppercase tracking-wider text-blue-600/80 font-bold mb-1">Pending Approval</p>
            <p className="text-2xl font-bold font-serif text-slate-900">{fmt(totalPending)}</p>
          </div>
          <div className="p-4 rounded-2xl bg-orange-500/10 border border-orange-500/20">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-wider text-orange-600 font-bold flex items-center gap-1">
                🪙 Drawer Khuchra Held
              </p>
            </div>
            <p className="text-2xl font-bold font-serif text-slate-900">{fmt(totalKhuchra)}</p>
            <p className="text-[9px] text-orange-600/70 mt-0.5">Retained in drawer as opening cash</p>
          </div>
        </div>

        {/* Status Filter Pills */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 scrollbar-none">
          {['all', 'draft', 'submitted', 'pending_approval', 'approved', 'rejected'].map(s => (
            <button
              key={s}
              onClick={() => setSelectedStatus(s)}
              className={`px-3.5 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap border transition-all cursor-pointer ${
                selectedStatus === s
                  ? 'bg-[#1ca34c]/20 border-[#1ca34c]/40 text-[#15803d]'
                  : 'bg-slate-900/[0.04] border-slate-900/5 text-slate-500 hover:text-slate-900'
              }`}
            >
              {s === 'all' ? 'All Submissions' : STATUS_CONFIG[s]?.label || s}
            </button>
          ))}
        </div>

        {/* Deposit List */}
        {deposits.length === 0 ? (
          <div className="text-center py-20 rounded-2xl border border-slate-900/5 bg-slate-900/[0.04]">
            <History className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500 text-sm font-medium">No deposit submissions found</p>
            <p className="text-slate-600 text-xs mt-1">Submit a new deposit from the top button.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {deposits.map((dep: any) => {
              const cfg = STATUS_CONFIG[dep.status] || STATUS_CONFIG.draft
              const StatusIcon = cfg.icon
              const notesClean = cleanDepositNotes(dep.notes)
              const khuchra = parseKhuchraAmount(dep)
              const totalPeriodCash = Number(dep.amount || 0) + khuchra
              const breakdownList = getDailyBreakdownList(dep.daily_breakdown || parseDailyBreakdown(dep))

              // Manager can edit if status is NOT approved (draft, submitted, pending_approval, under_review, rejected)
              const canManagerEdit = ['draft', 'submitted', 'pending_approval', 'under_review', 'rejected'].includes(dep.status)

              return (
                <div
                  key={dep.id}
                  className="rounded-2xl border border-slate-900/10 bg-slate-900/[0.04] hover:border-slate-900/20 transition-all overflow-hidden"
                >
                  {/* Top Bar: Bank Name, Status Badge, and ID */}
                  <div className="p-4 sm:p-5 border-b border-slate-900/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/[0.04]">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-1.5">
                          <Building2 className="w-4 h-4 text-[#15803d]" />
                          {dep.bank_account_name || 'Bank Deposit'}
                        </span>
                        {dep.bank_account_number && (
                          <span className="text-xs text-slate-500 font-mono bg-slate-900/[0.04] px-2 py-0.5 rounded-md border border-slate-900/5">
                            A/C: {dep.bank_account_number}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          Deposit Date: <strong className="text-slate-900">{dep.deposit_date}</strong>
                        </span>
                        {dep.sales_from_date && dep.sales_to_date && (
                          <span className="text-slate-500">
                            · Sales Period: <span className="text-[#15803d] font-medium">{dep.sales_from_date} → {dep.sales_to_date}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${cfg.cls}`}>
                        <StatusIcon className="w-3.5 h-3.5" /> {cfg.label}
                      </span>
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-4 sm:p-5 space-y-4">
                    {/* Calculation & Amount Block */}
                    <div className="p-4 rounded-xl bg-white border border-slate-900/10 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <p className="text-[10px] uppercase font-bold text-[#15803d] tracking-wider mb-1 flex items-center gap-1">
                          🏦 Bank Deposited Amount
                        </p>
                        <p className="text-2xl font-bold font-serif text-slate-900">{fmt(dep.amount)}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">Amount deposited into bank account</p>
                      </div>

                      <div>
                        <p className="text-[10px] uppercase font-bold text-orange-600 tracking-wider mb-1 flex items-center gap-1">
                          🪙 Khuchra (Drawer Cash)
                        </p>
                        <p className="text-2xl font-bold font-serif text-orange-300">{fmt(khuchra)}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">Kept in drawer as change</p>
                      </div>

                      <div>
                        <p className="text-[10px] uppercase font-bold text-slate-600 tracking-wider mb-1 flex items-center gap-1">
                          💰 Total Period Sales
                        </p>
                        <p className="text-2xl font-bold font-serif text-[#15803d]">{fmt(totalPeriodCash)}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">Total period cash collection</p>
                      </div>
                    </div>

                    {/* Visual Equation Banner */}
                    {khuchra > 0 && (
                      <div className="px-3.5 py-2 rounded-lg bg-slate-900/[0.04] border border-slate-900/5 text-[11px] text-slate-600 flex items-center gap-2 flex-wrap font-mono">
                        <span className="text-emerald-600 font-semibold">🏦 {fmt(dep.amount)} (ব্যাংক জমা)</span>
                        <span className="text-slate-500">+</span>
                        <span className="text-orange-600 font-semibold">🪙 {fmt(khuchra)} (ড্রয়ারে অবশিষ্ট খুচরা)</span>
                        <span className="text-slate-500">=</span>
                        <span className="text-[#15803d] font-bold">মোট বিক্রয় {fmt(totalPeriodCash)}</span>
                        <span className="text-[10px] text-slate-500 italic ml-auto font-sans">
                          (খুচরা ২০ টাকা ড্রয়ারে থেকে যাবে এবং পরের দিনের ওপেনিং ব্যালেন্স হিসেবে যোগ হবে)
                        </span>
                      </div>
                    )}

                    {/* Middle Section: Reference Info & Proof Slip Picture Preview */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                      {/* Submission References */}
                      <div className="md:col-span-2 space-y-2 text-xs">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="p-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                            <span className="text-[10px] uppercase text-slate-500 block mb-0.5 font-semibold">Slip / Challan Number</span>
                            <span className="font-mono font-bold text-slate-900">{dep.deposit_slip_number || '—'}</span>
                          </div>
                          <div className="p-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                            <span className="text-[10px] uppercase text-slate-500 block mb-0.5 font-semibold">Bank TXN / Reference ID</span>
                            <span className="font-mono font-bold text-slate-900">{dep.bank_transaction_id || '—'}</span>
                          </div>
                        </div>

                        {/* Complete Timestamps and Actors */}
                        <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 space-y-1.5 text-[11px]">
                          {/* Submitted info */}
                          <div className="flex items-center justify-between text-slate-500">
                            <span className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-slate-500" /> Submitted At:
                            </span>
                            <span className="text-slate-900 font-medium">
                              {formatDateTime(dep.submitted_at || dep.created_at) || '—'}
                              {dep.deposited_by_name ? ` by ${dep.deposited_by_name}` : ''}
                            </span>
                          </div>

                          {/* Approved info */}
                          {dep.status === 'approved' && (
                            <div className="flex items-center justify-between text-emerald-600 border-t border-slate-900/5 pt-1.5">
                              <span className="flex items-center gap-1.5">
                                <CheckCircle className="w-3.5 h-3.5" /> Approved At:
                              </span>
                              <span className="font-semibold">
                                {formatDateTime(dep.reviewed_at) || dep.deposit_date}
                                {dep.reviewed_by_name ? ` by ${dep.reviewed_by_name}` : ''}
                              </span>
                            </div>
                          )}

                          {/* Rejection Alert */}
                          {dep.status === 'rejected' && (
                            <div className="border-t border-rose-500/20 pt-2 text-rose-600 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5 font-bold">
                                  <XCircle className="w-3.5 h-3.5" /> Rejected On:
                                </span>
                                <span>{formatDateTime(dep.reviewed_at) || '—'}</span>
                              </div>
                              {dep.rejection_reason && (
                                <p className="text-[11px] bg-rose-500/10 p-2 rounded-lg border border-rose-500/20 text-rose-300">
                                  <strong>Reason:</strong> {dep.rejection_reason}
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {notesClean && (
                          <div className="p-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-[11px] text-slate-600">
                            <span className="text-[9px] uppercase text-slate-500 font-bold block mb-0.5">Manager Notes:</span>
                            <p className="italic">{notesClean}</p>
                          </div>
                        )}
                      </div>

                      {/* Right: Slip Thumbnail / Preview Card */}
                      <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-center flex flex-col items-center justify-center">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2 flex items-center gap-1">
                          <ImageIcon className="w-3 h-3 text-[#15803d]" /> Proof Slip / Receipt
                        </span>

                        {dep.slip_attachment_url ? (
                          <div
                            onClick={() => setSelectedSlipDeposit(dep)}
                            className="group relative w-full h-32 rounded-xl overflow-hidden border border-slate-900/10 hover:border-[#1ca34c]/60 cursor-pointer transition-all bg-white flex items-center justify-center"
                          >
                            <img
                              src={dep.slip_attachment_url}
                              alt="Deposit Slip"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            />
                            <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-xs text-slate-900 font-semibold">
                              <ZoomIn className="w-4 h-4 text-[#15803d]" /> View Full Slip
                            </div>
                          </div>
                        ) : (
                          <div className="w-full h-32 rounded-xl border border-dashed border-slate-900/10 flex flex-col items-center justify-center text-slate-500 text-xs p-2">
                            <FileText className="w-8 h-8 text-slate-600 mb-1" />
                            <span>No Slip Attached</span>
                          </div>
                        )}

                        {dep.slip_attachment_url && (
                          <button
                            type="button"
                            onClick={() => setSelectedSlipDeposit(dep)}
                            className="mt-2 text-[11px] text-[#15803d] hover:underline flex items-center gap-1 font-medium cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" /> Inspect Slip Details
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Daily Sales Breakdown (ONLY shown if valid date entries exist) */}
                    {breakdownList.length > 0 && (
                      <div className="p-3.5 rounded-xl bg-gradient-to-br from-[#1ca34c]/5 to-transparent border border-[#1ca34c]/20 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#15803d] flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5" /> প্রতিদিনের বিক্রির বিবরণ ({breakdownList.length} Days Breakdown)
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            Total Deposited: {fmt(dep.amount)}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {breakdownList.map(item => (
                            <div key={item.date} className="px-3 py-1.5 rounded-lg bg-white border border-slate-900/5 flex items-center justify-between text-xs">
                              <span className="text-slate-500 font-mono text-[11px]">{item.date}</span>
                              <span className="text-[#15803d] font-semibold font-serif">{fmt(item.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer Actions */}
                  <div className="px-4 sm:px-5 py-3 border-t border-slate-900/5 bg-slate-900/[0.04] flex items-center justify-between gap-3">
                    <div className="text-[11px] text-slate-500">
                      {dep.status === 'approved' ? (
                        <span className="text-emerald-600 flex items-center gap-1.5 font-medium">
                          <CheckCircle className="w-3.5 h-3.5" /> Approved & Locked (Only Admin can modify approved deposits)
                        </span>
                      ) : (
                        <span className="text-slate-500 flex items-center gap-1.5">
                          <Info className="w-3.5 h-3.5 text-slate-500" />
                          Pending approval: You can edit payment details until approved
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Manager Edit Submission Button (Only available while NOT approved) */}
                      {canManagerEdit && (
                        <button
                          type="button"
                          onClick={() => openEditModal(dep)}
                          className="px-3.5 py-1.5 rounded-xl bg-[#1ca34c]/10 border border-[#1ca34c]/30 text-[#15803d] hover:bg-[#1ca34c]/20 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit Submission (তথ্য সংশোধন)
                        </button>
                      )}

                      {/* Resubmit button if rejected */}
                      {dep.status === 'rejected' && (
                        <Link
                          href={`/dashboard/branch-accounts/bank-deposit?date=${dep.deposit_date}&resubmit_id=${dep.id}`}
                          className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-xs font-bold flex items-center gap-1.5 transition-all hover:opacity-95"
                        >
                          Resubmit (পুনরায় পাঠান)
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Manager Edit Submission Modal */}
        {editingDeposit && (
          <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white border border-slate-900/10 rounded-3xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-900/10 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Edit3 className="w-4 h-4 text-[#15803d]" /> Edit Deposit Submission
                  </h3>
                  <p className="text-xs text-slate-500">
                    Deposit Date: <span className="text-slate-900 font-medium">{editingDeposit.deposit_date}</span> · Status: {editingDeposit.status}
                  </p>
                </div>
                <button
                  onClick={() => setEditingDeposit(null)}
                  className="p-3 rounded-lg bg-slate-900/[0.04] text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {editError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {editError}
                </div>
              )}

              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-500 font-semibold mb-1">Bank Deposited (BDT) *</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editAmount}
                      onChange={e => setEditAmount(e.target.value)}
                      className="w-full bg-white border border-[#1ca34c]/30 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/60 font-serif"
                    />
                  </div>
                  <div>
                    <label className="block text-orange-600 font-semibold mb-1">🪙 Khuchra Held (Drawer Cash)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editKhuchra}
                      onChange={e => setEditKhuchra(e.target.value)}
                      placeholder="0"
                      className="w-full bg-white border border-orange-500/30 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-orange-500/60 font-serif"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-500 font-semibold mb-1">Bank Account Name *</label>
                    <input
                      type="text"
                      value={editBankName}
                      onChange={e => setEditBankName(e.target.value)}
                      placeholder="e.g. BRAC Bank PLC"
                      className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/40"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 font-semibold mb-1">Bank Account Number</label>
                    <input
                      type="text"
                      value={editBankAcctNumber}
                      onChange={e => setEditBankAcctNumber(e.target.value)}
                      placeholder="e.g. 150120..."
                      className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-500 font-semibold mb-1">Deposit Slip / Challan Number</label>
                    <input
                      type="text"
                      value={editSlipNumber}
                      onChange={e => setEditSlipNumber(e.target.value)}
                      placeholder="Challan # / Slip #"
                      className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 font-semibold mb-1">Transaction ID (TXN)</label>
                    <input
                      type="text"
                      value={editTxnId}
                      onChange={e => setEditTxnId(e.target.value)}
                      placeholder="Bank TXN ID"
                      className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 font-mono"
                    />
                  </div>
                </div>

                {/* Upload or replace slip image */}
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Proof Slip / Receipt Photo</label>
                  <div className="flex items-center gap-3">
                    {editSlipPreview && (
                      <div className="w-16 h-16 rounded-lg overflow-hidden border border-slate-900/10 bg-white shrink-0">
                        <img src={editSlipPreview} alt="Slip preview" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <label className="flex-1 px-3 py-2.5 rounded-xl border border-dashed border-slate-900/20 hover:border-[#1ca34c]/50 bg-slate-900/[0.04] text-center cursor-pointer transition-colors block">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      <span className="text-xs text-[#15803d] font-semibold flex items-center justify-center gap-1.5">
                        <Upload className="w-3.5 h-3.5" />
                        {editSlipFile ? editSlipFile.name : 'Choose New Photo / Document'}
                      </span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Notes</label>
                  <input
                    type="text"
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    placeholder="Optional notes for admin"
                    className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/40"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-900/10">
                <button
                  onClick={handleSaveSubmissionEdit}
                  disabled={isSavingEdit}
                  className="flex-1 py-2.5 rounded-full bg-[#1ca34c] hover:bg-[#15803d] text-white font-bold text-xs uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-[#1ca34c]/15"
                >
                  {isSavingEdit ? (
                    <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save Changes (পরিবর্তন সেভ করুন)
                </button>
                <button
                  onClick={() => setEditingDeposit(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 text-xs hover:text-slate-900 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Interactive Deposit Slip Modal */}
        <DepositSlipModal
          isOpen={!!selectedSlipDeposit}
          onClose={() => setSelectedSlipDeposit(null)}
          deposit={selectedSlipDeposit}
        />
      </div>
    </div>
  )
}
