'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle, XCircle, Clock, AlertTriangle,
  RefreshCw, Eye, ChevronLeft, FileText, Image as ImageIcon,
  Search, Download, ExternalLink, ZoomIn, Building2, Calendar,
  CreditCard, Hash, Layers, FileSpreadsheet, ChevronDown, Edit3, Save, X
} from 'lucide-react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { generatePdf } from '@/lib/pdf-generator'
import { generateExcel } from '@/lib/excel-generator'
import DepositSlipModal from '@/components/DepositSlipModal'
import { parseDailyBreakdown, getDailyBreakdownList, cleanDepositNotes, parseKhuchraAmount } from '@/lib/branch-deposit-utils'

const fmt = (n: number) => '৳' + Number(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default function DepositApprovalsPage() {
  const router = useRouter()
  const [deposits, setDeposits] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [filter, setFilter] = useState<'submitted' | 'all'>('submitted')
  const [search, setSearch] = useState('')
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null)

  // Edit deposit state (Admin can edit any deposit, including approved)
  const [editDepositId, setEditDepositId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editKhuchra, setEditKhuchra] = useState('')
  const [editBankName, setEditBankName] = useState('')
  const [editBankAcctNumber, setEditBankAcctNumber] = useState('')
  const [editSlipNumber, setEditSlipNumber] = useState('')
  const [editTxnId, setEditTxnId] = useState('')
  const [editDepositDate, setEditDepositDate] = useState('')
  const [editSalesFromDate, setEditSalesFromDate] = useState('')
  const [editSalesToDate, setEditSalesToDate] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  // Lightbox Modal state
  const [modalDeposit, setModalDeposit] = useState<any | null>(null)
  const [modalUrl, setModalUrl] = useState<string | null>(null)
  const [modalTitle, setModalTitle] = useState<string>('Bank Deposit Slip')

  const checkAccess = useCallback(async () => {
    const res = await fetch('/api/auth/me')
    if (!res.ok) { router.replace('/'); return false }
    const me = await res.json()
    if (!me?.user) { router.replace('/'); return false }
    const isAdmin = !!me.is_admin
    if (!isAdmin) { router.replace('/dashboard'); return false }
    return true
  }, [router])

  const fetchDeposits = useCallback(async () => {
    const res = await fetch('/api/branch-accounts/deposits')
    const json = await res.json()
    if (res.ok) {
      const all = json.deposits || []
      setDeposits(all)
    } else {
      setError(json.error)
    }
  }, [])

  const init = useCallback(async () => {
    setIsLoading(true)
    const ok = await checkAccess()
    if (ok) await fetchDeposits()
    setIsLoading(false)
  }, [checkAccess, fetchDeposits])

  useEffect(() => { init() }, [init])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchDeposits()
    setIsRefreshing(false)
  }

  const handleApprove = async (id: string) => {
    setActionId(id)
    setError(null)
    try {
      const res = await fetch(`/api/branch-accounts/deposits/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSuccess(`Deposit approved successfully! Bank deposits ledger updated.`)
      setConfirmApproveId(null)
      setModalDeposit(null)
      await fetchDeposits()
      setTimeout(() => setSuccess(null), 4000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setActionId(null)
    }
  }

  const handleReject = async (id: string, reasonToUse?: string | any) => {
    const reason = typeof reasonToUse === 'string' ? reasonToUse : rejectReason
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      setError('Rejection reason is required')
      return
    }
    setActionId(id)
    setError(null)
    try {
      const res = await fetch(`/api/branch-accounts/deposits/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejection_reason: reason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSuccess('Deposit rejected. Branch manager has been notified.')
      setRejectId(null)
      setRejectReason('')
      setModalDeposit(null)
      await fetchDeposits()
      setTimeout(() => setSuccess(null), 4000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setActionId(null)
    }
  }

  const openEditDeposit = (dep: any) => {
    setEditDepositId(dep.id)
    setEditAmount(String(dep.amount || ''))
    setEditKhuchra(String(dep.khuchra_amount || parseKhuchraAmount(dep) || ''))
    setEditBankName(dep.bank_account_name || '')
    setEditBankAcctNumber(dep.bank_account_number || '')
    setEditSlipNumber(dep.deposit_slip_number || '')
    setEditTxnId(dep.bank_transaction_id || '')
    setEditDepositDate(dep.deposit_date || '')
    setEditSalesFromDate(dep.sales_from_date || '')
    setEditSalesToDate(dep.sales_to_date || '')
    setEditNotes(cleanDepositNotes(dep.notes) || '')
  }

  const handleSaveDepositEdit = async (depId: string) => {
    if (!editAmount || isNaN(Number(editAmount)) || Number(editAmount) <= 0) {
      setError('Please enter a valid amount.')
      return
    }
    setIsSavingEdit(true)
    setError(null)
    try {
      const res = await fetch('/api/branch-accounts/deposits', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: depId,
          amount: Number(editAmount),
          khuchra_amount: editKhuchra ? Number(editKhuchra) : 0,
          bank_account_name: editBankName,
          bank_account_number: editBankAcctNumber || null,
          deposit_slip_number: editSlipNumber || null,
          bank_transaction_id: editTxnId || null,
          deposit_date: editDepositDate || undefined,
          sales_from_date: editSalesFromDate || undefined,
          sales_to_date: editSalesToDate || undefined,
          notes: editNotes || undefined,
        })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to update deposit.')

      setSuccess('Deposit details updated successfully!')
      setEditDepositId(null)
      await fetchDeposits()
      setTimeout(() => setSuccess(null), 3000)
    } catch (e: any) {
      setError(e.message || 'Failed to update deposit.')
    } finally {
      setIsSavingEdit(false)
    }
  }

  // Filter & Search Logic
  const filteredDeposits = useMemo(() => {
    return deposits.filter(d => {
      const matchesFilter =
        filter === 'submitted'
          ? ['submitted', 'pending_approval'].includes(d.status)
          : true

      const query = search.toLowerCase().trim()
      if (!query) return matchesFilter

      const branchName = (d.branch?.name || d.branch_name || '').toLowerCase()
      const managerName = (d.manager_name || '').toLowerCase()
      const slipNo = (d.deposit_slip_number || '').toLowerCase()
      const txnId = (d.bank_transaction_id || '').toLowerCase()
      const bankName = (d.bank_account_name || '').toLowerCase()

      const matchesSearch =
        branchName.includes(query) ||
        managerName.includes(query) ||
        slipNo.includes(query) ||
        txnId.includes(query) ||
        bankName.includes(query)

      return matchesFilter && matchesSearch
    })
  }, [deposits, filter, search])

  // Aggregate Metrics
  const pendingCount = useMemo(
    () => deposits.filter(d => ['submitted', 'pending_approval'].includes(d.status)).length,
    [deposits]
  )
  const pendingAmount = useMemo(
    () => deposits.filter(d => ['submitted', 'pending_approval'].includes(d.status)).reduce((s, d) => s + Number(d.amount || 0), 0),
    [deposits]
  )
  const approvedCount = useMemo(
    // B47: reversed deposits keep status='approved' — they must not
    // count as approved money anywhere on this page.
    () => deposits.filter(d => d.status === 'approved' && !d.is_reversed).length,
    [deposits]
  )

  const openSlipModal = (dep: any, url: string, title: string) => {
    setModalDeposit(dep)
    setModalUrl(url)
    setModalTitle(title)
  }

  // ─── Multi-Format Exports (PDF, Excel, CSV) ─────────────────────────────────
  const handleExportPdf = async () => {
    if (!filteredDeposits || filteredDeposits.length === 0) return
    setIsExporting(true)
    setShowExportMenu(false)
    try {
      const columns = ['#', 'Branch', 'Manager', 'Deposit Date', 'Amount (BDT)', 'Bank Account', 'Slip #', 'TXN ID', 'Status']
      const rows = filteredDeposits.map((d, idx) => [
        idx + 1,
        d.branch?.name || d.branch_name || '-',
        d.manager_name || 'Manager',
        d.deposit_date,
        Number(d.amount).toLocaleString('en-BD'),
        d.bank_account_name || '—',
        d.deposit_slip_number || '—',
        d.bank_transaction_id || '—',
        d.status.toUpperCase()
      ])

      const totalAmount = filteredDeposits.reduce((s, d) => s + Number(d.amount || 0), 0)
      const approvedAmount = filteredDeposits.filter(d => d.status === 'approved' && !d.is_reversed).reduce((s, d) => s + Number(d.amount || 0), 0)

      await generatePdf('Branch Deposit Approvals Ledger', columns, rows, {
        subtitle: 'VERIFIED BANK DEPOSIT SLIPS & AUDIT LEDGER',
        preparedBy: 'Accounts Administrator',
        orientation: 'landscape',
        summaryData: [
          { label: 'Total Submissions', value: filteredDeposits.length.toString() },
          { label: 'Total Submitted Value', value: `${totalAmount.toLocaleString('en-BD')} BDT` },
          { label: 'Total Approved Value', value: `${approvedAmount.toLocaleString('en-BD')} BDT` },
          { label: 'Pending Reviews', value: `${pendingCount} Submissions` },
        ],
        filename: `Deposit_Approvals_${new Date().toISOString().slice(0, 10)}.pdf`,
        notes: 'Official Anchor Fashion ERP Audit. Verified bank deposits are credited to headquarters treasury ledger.'
      })
    } catch (e: any) {
      setError(e.message || 'Failed to export PDF')
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportExcel = () => {
    if (!filteredDeposits || filteredDeposits.length === 0) return
    setShowExportMenu(false)
    const columns = [
      '#',
      'Branch',
      'Manager',
      'Deposit Date',
      'Amount (BDT)',
      'Bank Account',
      'Slip Number',
      'Transaction ID',
      'Status',
    ]
    const rows = filteredDeposits.map((d, idx) => [
      idx + 1,
      d.branch?.name || d.branch_name || '-',
      d.manager_name || 'Manager',
      d.deposit_date,
      Number(d.amount),
      d.bank_account_name || '—',
      d.deposit_slip_number || '—',
      d.bank_transaction_id || '—',
      d.status.toUpperCase(),
    ])
    generateExcel('Branch Bank Deposits', columns, rows, {
      filename: `Deposit_Approvals_${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: 'Deposits',
    })
  }

  const handleExportCsv = () => {
    if (!filteredDeposits || filteredDeposits.length === 0) return
    setShowExportMenu(false)
    const headers = ['#', 'Branch', 'Manager', 'Deposit Date', 'Amount (BDT)', 'Bank Account', 'Slip Number', 'TXN ID', 'Status']
    const csvRows = filteredDeposits.map((d, idx) => [
      idx + 1,
      `"${(d.branch?.name || d.branch_name || '').replace(/"/g, '""')}"`,
      `"${(d.manager_name || '').replace(/"/g, '""')}"`,
      `"${d.deposit_date}"`,
      Number(d.amount),
      `"${(d.bank_account_name || '').replace(/"/g, '""')}"`,
      `"${(d.deposit_slip_number || '').replace(/"/g, '""')}"`,
      `"${(d.bank_transaction_id || '').replace(/"/g, '""')}"`,
      `"${d.status}"`
    ])
    const csvContent = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Deposit_Approvals_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-[600px] h-[350px] bg-[#d4af37]/3 rounded-full filter blur-[150px]" />
      </div>

      <div className="relative z-10 p-4 md:p-6 lg:p-8 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6 pb-5 border-b border-slate-900/5">
          <Link
            href="/admin/branch-accounts"
            className="p-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/30 text-slate-500 hover:text-slate-900 transition-all cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold font-serif flex items-center gap-2 text-slate-900">
                <Clock className="w-5 h-5 text-amber-600" /> Deposit Approvals
              </h1>
              {pendingCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 text-[10px] font-bold">
                  {pendingCount} Pending
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Review and verify branch manager bank deposit slips, transaction numbers, and credit confirmations
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Export Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={isExporting || filteredDeposits.length === 0}
                className="px-3.5 py-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/30 text-slate-600 hover:text-slate-900 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
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
                      onClick={handleExportPdf}
                      className="w-full px-4 py-2.5 text-left text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.04] flex items-center gap-2.5 transition-colors cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-[#8a6d1f]" /> Export PDF (Official)
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

            <button
              onClick={handleRefresh}
              className={`p-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/30 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${
                isRefreshing ? 'animate-spin text-[#8a6d1f]' : ''
              }`}
              title="Refresh submissions"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Metric Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5">
            <p className="text-[9px] uppercase tracking-widest text-amber-600/80 font-bold mb-1">Awaiting Approval</p>
            <div className="flex items-baseline justify-between">
              <p className="text-xl sm:text-2xl font-bold font-serif text-amber-600">{pendingCount}</p>
              <p className="text-xs font-semibold text-amber-700 font-serif">{fmt(pendingAmount)}</p>
            </div>
          </div>
          <div className="p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5">
            <p className="text-[9px] uppercase tracking-widest text-emerald-600/80 font-bold mb-1">Approved Deposits</p>
            <p className="text-xl sm:text-2xl font-bold font-serif text-emerald-600">{approvedCount}</p>
          </div>
          <div className="p-4 rounded-2xl border border-slate-900/10 bg-slate-900/[0.04]">
            <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold mb-1">Total Recorded Submissions</p>
            <p className="text-xl sm:text-2xl font-bold font-serif text-slate-900">{deposits.length}</p>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="flex gap-2">
            {(['submitted', 'all'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                  filter === f
                    ? 'bg-[#d4af37]/15 border-[#d4af37]/40 text-[#8a6d1f] shadow-sm'
                    : 'bg-slate-900/[0.04] border-slate-900/10 text-slate-500 hover:text-slate-900'
                }`}
              >
                {f === 'submitted' ? `Pending Review (${pendingCount})` : `All Submissions (${deposits.length})`}
              </button>
            ))}
          </div>

          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search branch name, manager, slip no., or TXN ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl py-2 pl-10 pr-4 text-xs text-slate-900 placeholder-slate-500 focus:outline-none focus:border-[#d4af37]/40 transition-colors"
            />
          </div>
        </div>

        {/* Notifications */}
        {error && (
          <div className="mb-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-rose-600 hover:text-slate-900 p-2.5 rounded-lg">
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}
        {success && (
          <div className="mb-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>{success}</span>
            </div>
            <button onClick={() => setSuccess(null)} className="text-emerald-600 hover:text-slate-900 p-2.5 rounded-lg">
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Deposits List */}
        {filteredDeposits.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-slate-900/5 bg-slate-900/[0.04]">
            <CheckCircle className="w-12 h-12 text-emerald-500/40 mx-auto mb-3" />
            <p className="text-slate-600 text-sm font-semibold">
              {filter === 'submitted' ? 'No pending deposits awaiting review' : 'No deposits found'}
            </p>
            <p className="text-slate-500 text-xs mt-1">
              {search ? 'Try clearing your search filters' : 'All branch deposits have been verified'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredDeposits.map((dep: any) => {
              const branchTitle = dep.branch?.name || dep.branch_name || 'Branch'
              const isPending = ['submitted', 'pending_approval'].includes(dep.status)

              return (
                <div
                  key={dep.id}
                  className="rounded-2xl border border-slate-900/10 bg-slate-900/[0.05] shadow-xl overflow-hidden hover:border-slate-900/20 transition-all"
                >
                  {/* Deposit Header */}
                  <div className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-900/[0.08]">
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-base font-bold text-slate-900 flex items-center gap-1.5 font-serif">
                          <Building2 className="w-4 h-4 text-[#8a6d1f]" /> {branchTitle}
                        </span>
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                            dep.status === 'approved'
                              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                              : dep.status === 'rejected'
                              ? 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                              : dep.status === 'draft'
                              ? 'bg-slate-500/10 text-slate-500 border-slate-500/20'
                              : 'bg-amber-500/10 text-amber-600 border-amber-500/20 animate-pulse'
                          }`}
                        >
                          {dep.status.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        Manager: <span className="text-slate-700">{dep.manager_name || '—'}</span> · Deposit Date:{' '}
                        <span className="text-slate-700">{dep.deposit_date}</span>
                      </p>
                    </div>

                    <div className="text-left sm:text-right shrink-0">
                      <p className="text-2xl font-bold font-serif text-[#8a6d1f]">{fmt(dep.amount)}</p>
                      <p className="text-[10px] text-slate-500">Bank Deposit Amount</p>
                      {parseKhuchraAmount(dep) > 0 && (
                        <p className="text-[11px] text-orange-600 font-semibold mt-0.5">
                          🪙 Khuchra: {fmt(parseKhuchraAmount(dep))}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Body Content: Details + Interactive Slip Thumbnail Card */}
                  <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                    {/* Details Column */}
                    <div className="lg:col-span-7 space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-slate-500">Bank Account</p>
                          <p className="text-xs text-slate-900 font-medium mt-0.5 truncate" title={dep.bank_account_name}>
                            {dep.bank_account_name}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-slate-500">Account No.</p>
                          <p className="text-xs text-slate-600 font-mono mt-0.5 truncate">
                            {dep.bank_account_number || '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-slate-500">Deposit Slip No.</p>
                          <p className="text-xs text-[#8a6d1f] font-mono font-bold mt-0.5 truncate">
                            {dep.deposit_slip_number || '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-slate-500">Sales Period</p>
                          <p className="text-xs text-slate-600 mt-0.5 truncate">
                            {dep.sales_from_date && dep.sales_to_date
                              ? `${dep.sales_from_date} → ${dep.sales_to_date}`
                              : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-slate-500">Bank TXN ID</p>
                          <p className="text-xs text-slate-600 font-mono mt-0.5 truncate">
                            {dep.bank_transaction_id || '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-slate-500">Deposited By</p>
                          <p className="text-xs text-slate-600 mt-0.5 truncate">
                            {dep.deposited_by_name || dep.manager_name || '—'}
                          </p>
                        </div>
                      </div>

                      {/* Daily Sales Breakdown Cards / Table (Audio Requirement) */}
                      {(() => {
                        const breakdown = parseDailyBreakdown(dep)
                        const list = getDailyBreakdownList(breakdown)
                        if (list.length === 0) return null

                        return (
                          <div className="p-4 rounded-xl bg-gradient-to-br from-[#d4af37]/10 via-[#d4af37]/5 to-transparent border border-[#d4af37]/25 space-y-2.5">
                            <div className="flex items-center justify-between border-b border-[#d4af37]/20 pb-2">
                              <span className="text-[11px] font-bold text-[#8a6d1f] uppercase tracking-wider flex items-center gap-1.5 font-serif">
                                <Layers className="w-3.5 h-3.5" />
                                প্রতিদিনের জমার বিবরণ · Daily Sales Breakdown ({list.length} Days Combined)
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                Total: {fmt(dep.amount)}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                              {list.map(item => {
                                const sharePercent = dep.amount > 0 ? Math.round((item.amount / dep.amount) * 100) : 0
                                return (
                                  <div
                                    key={item.date}
                                    className="p-2.5 rounded-lg bg-white border border-slate-900/5 flex items-center justify-between gap-2"
                                  >
                                    <div>
                                      <p className="text-[11px] font-mono text-slate-900 font-medium flex items-center gap-1.5">
                                        <Calendar className="w-3 h-3 text-[#8a6d1f]" />
                                        {item.date}
                                      </p>
                                      <p className="text-[9px] text-slate-500">
                                        Share: {sharePercent}%
                                      </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-xs font-bold font-serif text-[#8a6d1f]">
                                        {fmt(item.amount)}
                                      </p>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })()}

                      {cleanDepositNotes(dep.notes) && (
                        <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                          <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                            <span className="text-slate-500 uppercase text-[9px] mr-1.5 font-bold">Notes:</span>
                            {cleanDepositNotes(dep.notes)}
                          </p>
                        </div>
                      )}

                      {/* Processed Status Badges */}
                      {dep.status === 'approved' && (
                        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 shrink-0" />
                          <span>
                            Approved by {dep.reviewed_by_name || 'Admin'} ·{' '}
                            {dep.reviewed_at ? new Date(dep.reviewed_at).toLocaleDateString('en-GB') : ''}
                          </span>
                        </div>
                      )}
                      {dep.status === 'rejected' && (
                        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs">
                          <p className="font-semibold mb-1 flex items-center gap-1.5">
                            <XCircle className="w-3.5 h-3.5" /> Rejected by {dep.reviewed_by_name || 'Admin'}
                          </p>
                          <p className="text-rose-700 text-[11px]">{dep.rejection_reason || 'No reason specified'}</p>
                        </div>
                      )}
                    </div>

                    {/* Deposit Slip & Statement Media Previews */}
                    <div className="lg:col-span-5 flex flex-col sm:flex-row gap-3">
                      {/* Deposit Slip Card */}
                      <div className="flex-1 rounded-xl border border-slate-900/10 bg-white p-3 flex flex-col justify-between">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                            <ImageIcon className="w-3 h-3 text-[#8a6d1f]" /> Slip Photo
                          </span>
                          {dep.slip_attachment_url && (
                            <span className="text-[9px] bg-[#d4af37]/10 text-[#8a6d1f] px-1.5 py-0.5 rounded font-mono">
                              Attached
                            </span>
                          )}
                        </div>

                        {dep.slip_attachment_url ? (
                          <div className="space-y-2">
                            <div
                              onClick={() => openSlipModal(dep, dep.slip_attachment_url, 'Deposit Slip / Bank Receipt')}
                              className="relative aspect-video w-full rounded-lg overflow-hidden bg-white border border-slate-900/5 group cursor-pointer"
                            >
                              <img
                                src={dep.slip_attachment_url}
                                alt={`Slip for ${branchTitle}`}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                              />
                              <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-slate-900 text-xs font-semibold">
                                <ZoomIn className="w-4 h-4 text-[#8a6d1f]" />
                                <span>Inspect Full Slip</span>
                              </div>
                            </div>

                            <div className="flex gap-2">
                              <button
                                onClick={() => openSlipModal(dep, dep.slip_attachment_url, 'Deposit Slip / Bank Receipt')}
                                className="flex-1 py-1.5 rounded-lg bg-slate-900/[0.04] hover:bg-slate-900/[0.04] border border-slate-900/10 text-[11px] font-semibold text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                              >
                                <Eye className="w-3 h-3 text-[#8a6d1f]" /> View
                              </button>
                              <a
                                href={dep.slip_attachment_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 rounded-lg bg-slate-900/[0.04] hover:bg-slate-900/[0.04] border border-slate-900/10 text-slate-500 hover:text-slate-900 transition-all"
                                title="Open original file in new tab"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                        ) : (
                          <div className="py-8 text-center text-slate-600 space-y-1">
                            <FileText className="w-7 h-7 mx-auto text-slate-700" />
                            <p className="text-[10px]">No slip uploaded</p>
                          </div>
                        )}
                      </div>

                      {/* Bank Statement Card (if uploaded) */}
                      {dep.bank_statement_url && (
                        <div className="flex-1 rounded-xl border border-slate-900/10 bg-white p-3 flex flex-col justify-between">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                              <FileText className="w-3 h-3 text-blue-600" /> Statement
                            </span>
                            <span className="text-[9px] bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded font-mono">
                              Doc
                            </span>
                          </div>

                          <div className="space-y-2">
                            <div
                              onClick={() => openSlipModal(dep, dep.bank_statement_url, 'Bank Statement Document')}
                              className="relative aspect-video w-full rounded-lg overflow-hidden bg-white border border-slate-900/5 group cursor-pointer flex items-center justify-center"
                            >
                              <FileText className="w-8 h-8 text-blue-600" />
                              <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-slate-900 text-xs font-semibold">
                                <ZoomIn className="w-4 h-4 text-blue-600" />
                                <span>Inspect</span>
                              </div>
                            </div>

                            <button
                              onClick={() => openSlipModal(dep, dep.bank_statement_url, 'Bank Statement Document')}
                              className="w-full py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-600 text-[11px] font-semibold flex items-center justify-center gap-1.5 hover:bg-blue-500/20 transition-all cursor-pointer"
                            >
                              <Eye className="w-3 h-3" /> View Statement
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Reject Reason Inline Input */}
                  {rejectId === dep.id && (
                    <div className="px-5 pb-4 border-t border-slate-900/5 pt-4 bg-rose-500/[0.02]">
                      <p className="text-xs text-rose-600 font-semibold mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Rejection Reason (Mandatory) *
                      </p>
                      <textarea
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        rows={2}
                        placeholder="Explain clearly to the branch manager why this deposit is being rejected..."
                        className="w-full bg-slate-900/[0.04] border border-rose-500/30 rounded-xl px-3 py-2.5 text-slate-900 text-xs placeholder-slate-600 focus:outline-none focus:border-rose-500/50 resize-none mb-3"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleReject(dep.id)}
                          disabled={!!actionId || !rejectReason.trim()}
                          className="flex-1 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-rose-500/10"
                        >
                          {actionId === dep.id ? (
                            <div className="w-3.5 h-3.5 border-2 border-slate-200 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5" />
                          )}
                          Confirm Rejection
                        </button>
                        <button
                          onClick={() => { setRejectId(null); setRejectReason('') }}
                          className="px-4 py-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-500 text-xs hover:text-slate-900 transition-all cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Edit Deposit Inline Form (Admin can edit any deposit, including approved) */}
                  {editDepositId === dep.id && (
                    <div className="px-5 pb-4 border-t border-slate-900/5 pt-4 bg-[#d4af37]/[0.03] space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-[#8a6d1f] uppercase tracking-wider flex items-center gap-1.5">
                          <Edit3 className="w-3.5 h-3.5" /> Edit Deposit Details {dep.status === 'approved' && <span className="text-[10px] text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-normal ml-1">Approved Deposit</span>}
                        </p>
                        <span className="text-[10px] text-slate-500">ID: {dep.id.slice(0, 8)}...</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Bank Deposited (BDT) *</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editAmount}
                            onChange={e => setEditAmount(e.target.value)}
                            className="w-full bg-white border border-[#d4af37]/30 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#d4af37]/60 font-serif"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider text-orange-600 mb-1 font-semibold">🪙 Khuchra (Drawer Cash)</label>
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
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Deposit Date</label>
                          <input
                            type="date"
                            value={editDepositDate}
                            onChange={e => setEditDepositDate(e.target.value)}
                            className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#d4af37]/40"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Sales From Date</label>
                          <input
                            type="date"
                            value={editSalesFromDate}
                            onChange={e => setEditSalesFromDate(e.target.value)}
                            className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#d4af37]/40"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Sales To Date</label>
                          <input
                            type="date"
                            value={editSalesToDate}
                            onChange={e => setEditSalesToDate(e.target.value)}
                            className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#d4af37]/40"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Bank Account Name</label>
                          <input
                            type="text"
                            value={editBankName}
                            onChange={e => setEditBankName(e.target.value)}
                            placeholder="e.g. BRAC Bank PLC"
                            className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#d4af37]/40"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Bank Account Number</label>
                          <input
                            type="text"
                            value={editBankAcctNumber}
                            onChange={e => setEditBankAcctNumber(e.target.value)}
                            placeholder="Account Number"
                            className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#d4af37]/40 font-mono"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Deposit Slip Number</label>
                          <input
                            type="text"
                            value={editSlipNumber}
                            onChange={e => setEditSlipNumber(e.target.value)}
                            placeholder="Slip # / Challan #"
                            className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#d4af37]/40 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Transaction ID (TXN)</label>
                          <input
                            type="text"
                            value={editTxnId}
                            onChange={e => setEditTxnId(e.target.value)}
                            placeholder="Bank TXN ID"
                            className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#d4af37]/40 font-mono"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Notes</label>
                        <input
                          type="text"
                          value={editNotes}
                          onChange={e => setEditNotes(e.target.value)}
                          placeholder="Admin or manager notes"
                          className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#d4af37]/40"
                        />
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => handleSaveDepositEdit(dep.id)}
                          disabled={isSavingEdit}
                          className="flex-1 py-2.5 rounded-xl bg-[#d4af37] hover:bg-[#b8952e] text-black font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-[#d4af37]/10"
                        >
                          {isSavingEdit ? <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Save Changes
                        </button>
                        <button
                          onClick={() => setEditDepositId(null)}
                          className="px-4 py-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-500 text-xs hover:text-slate-900 transition-all cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons Bar - Available for all deposits (Admin can edit any deposit, including approved) */}
                  {rejectId !== dep.id && editDepositId !== dep.id && (
                    <div className="px-5 py-4 border-t border-slate-900/5 bg-slate-900/[0.04] flex flex-col sm:flex-row gap-3 items-center justify-between">
                      {/* Left Side: Inspect Slip and Edit Deposit */}
                      <div className="flex gap-2 w-full sm:w-auto">
                        <button
                          onClick={() => openSlipModal(dep, dep.slip_attachment_url, 'Deposit Slip / Bank Receipt')}
                          className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/30 text-slate-600 hover:text-slate-900 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
                        >
                          <ZoomIn className="w-3.5 h-3.5 text-[#8a6d1f]" /> Inspect Slip
                        </button>
                        <button
                          onClick={() => openEditDeposit(dep)}
                          className={`w-full sm:w-auto px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                            dep.status === 'approved'
                              ? 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20 text-amber-700'
                              : 'bg-[#d4af37]/10 border-[#d4af37]/20 hover:bg-[#d4af37]/20 text-[#8a6d1f]'
                          }`}
                          title={dep.status === 'approved' ? 'Admin: Edit approved deposit details' : 'Edit deposit details'}
                        >
                          <Edit3 className="w-3.5 h-3.5" /> {dep.status === 'approved' ? 'Edit Approved Deposit' : 'Edit'}
                        </button>
                      </div>

                      {/* Right Side: Approval actions or Status Indicators */}
                      {isPending ? (
                        confirmApproveId === dep.id ? (
                          <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
                            <div className="flex items-center gap-2 text-xs text-amber-600 font-semibold">
                              <AlertTriangle className="w-4 h-4" /> Confirm approve {fmt(dep.amount)}?
                            </div>
                            <div className="flex gap-2 w-full sm:w-auto">
                              <button
                                onClick={() => handleApprove(dep.id)}
                                disabled={!!actionId}
                                className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10 cursor-pointer"
                              >
                                {actionId === dep.id ? (
                                  <div className="w-3.5 h-3.5 border-2 border-slate-200 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <CheckCircle className="w-3.5 h-3.5" />
                                )}
                                Yes, Approve
                              </button>
                              <button
                                onClick={() => setConfirmApproveId(null)}
                                className="px-4 py-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-500 text-xs hover:text-slate-900 transition-all cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2 w-full sm:w-auto">
                            <button
                              onClick={() => setConfirmApproveId(dep.id)}
                              disabled={!!actionId}
                              className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:opacity-95 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10 cursor-pointer"
                            >
                              <CheckCircle className="w-3.5 h-3.5" /> Approve Deposit
                            </button>
                            <button
                              onClick={() => { setRejectId(dep.id); setConfirmApproveId(null) }}
                              disabled={!!actionId}
                              className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 text-rose-600 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" /> Reject
                            </button>
                          </div>
                        )
                      ) : dep.status === 'approved' ? (
                        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs font-semibold">
                          <CheckCircle className="w-4 h-4" />
                          <span>Approved {dep.reviewed_by_name ? `by ${dep.reviewed_by_name}` : ''} {dep.reviewed_at ? `on ${new Date(dep.reviewed_at).toLocaleDateString('en-GB')}` : ''}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs font-semibold">
                          <XCircle className="w-4 h-4" />
                          <span>Rejected: {dep.rejection_reason || '—'}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Lightbox / Slip Inspection Modal */}
      <DepositSlipModal
        isOpen={!!modalDeposit}
        onClose={() => setModalDeposit(null)}
        deposit={modalDeposit}
        activeUrl={modalUrl}
        title={modalTitle}
        onApprove={handleApprove}
        onReject={handleReject}
        isProcessingAction={!!actionId}
      />
    </div>
  )
}
