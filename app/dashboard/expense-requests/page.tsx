'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Receipt, Plus, X, Check, Clock, AlertTriangle, RefreshCw,
  Upload, CreditCard, Building2, Loader2, ChevronRight,
  CheckCircle2, XCircle, Banknote, ShoppingCart, Eye,
  ArrowLeft, FileText, Wallet
} from 'lucide-react'
import { uploadFile } from '@/lib/files-client'
import StatsCard from '@/components/stats-card'

// profile from /api/auth/me; own
// requests from GET /api/expense-requests; submit via POST
// /api/expense-requests — the server sets employee/branch
// identity from the session and, for cash requests, books the
// branch cash expense + ledger entry in the same transaction.
// Invoice uploads go through uploadFile ('expense-invoices').
// Realtime is replaced with 30s polling + focus refetch.

type ExpenseRequest = {
  id: string
  title: string
  description: string | null
  amount: number
  currency: string
  is_purchased: boolean
  invoice_url: string | null
  payment_method: 'bkash' | 'bank' | 'cash'
  account_holder_name: string | null
  account_number: string | null
  bank_name: string | null
  status: 'pending' | 'approved' | 'rejected' | 'paid'
  admin_notes: string | null
  trx_id: string | null
  paid_at: string | null
  created_at: string
  branch_name: string | null
  bank_branch: string | null
}

type UserProfile = {
  id: string
  full_name: string
  branch_id: string | null
  branch_name: string | null
  role: string
  is_branch_manager?: boolean
  profile_type?: string
}

const statusConfig: Record<string, { label: string; cls: string; icon: React.FC<any> }> = {
  pending:  { label: 'Pending Review', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/20',    icon: Clock },
  approved: { label: 'Approved',       cls: 'bg-blue-500/10 text-blue-600 border-blue-500/20',      icon: CheckCircle2 },
  rejected: { label: 'Rejected',       cls: 'bg-rose-500/10 text-rose-600 border-rose-500/20',      icon: XCircle },
  paid:     { label: 'Paid',           cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', icon: CheckCircle2 },
}

export default function EmployeeExpenseRequestsPageWrapper() {
  return (
    <Suspense fallback={<div>Loading expenses...</div>}>
      <EmployeeExpenseRequestsPage />
    </Suspense>
  )
}

function EmployeeExpenseRequestsPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [requests, setRequests] = useState<ExpenseRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Detail drawer
  const [selectedRequest, setSelectedRequest] = useState<ExpenseRequest | null>(null)

  const searchParams = useSearchParams();
  const highlightId = searchParams?.get('id');

  useEffect(() => {
    if (highlightId && requests.length > 0) {
      setTimeout(() => {
        const el = document.getElementById(`item-${highlightId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-[#d4af37]', 'ring-offset-2', 'ring-offset-white');
          setTimeout(() => {
            el.classList.remove('ring-2', 'ring-[#d4af37]', 'ring-offset-2', 'ring-offset-white');
          }, 3000);
        }
      }, 100);
    }
  }, [highlightId, requests]);

  // Form fields
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formIsPurchased, setFormIsPurchased] = useState(false)
  const [formInvoiceFile, setFormInvoiceFile] = useState<File | null>(null)
  const [formPayMethod, setFormPayMethod] = useState<'bkash' | 'bank' | 'cash'>('bkash')
  const [formAccountName, setFormAccountName] = useState('')
  const [formAccountNum, setFormAccountNum] = useState('')
  const [formBankName, setFormBankName] = useState('')
  const [formBankBranch, setFormBankBranch] = useState('')
  const [uploadProgress, setUploadProgress] = useState(false)

  // ─── Load profile ─────────────────────────────────────────────────────────
  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (!res.ok) return
      const me = await res.json()
      const data = me.profile
      if (data) {
        setProfile({
          id: data.id,
          full_name: data.full_name,
          branch_id: data.branch_id,
          branch_name: data.branch || null,
          role: data.role,
          is_branch_manager: data.is_branch_manager,
          profile_type: data.profile_type,
        })
      }
    } catch (e) {}
  }, [])

  // ─── Load requests ────────────────────────────────────────────────────────
  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/expense-requests')
      if (!res.ok) return
      const { requests: data } = await res.json()
      if (data) setRequests(data)
    } catch (e) {}
  }, [])

  const fetchAll = useCallback(async () => {
    setIsLoading(true)
    await Promise.all([loadProfile(), loadRequests()])
    setIsLoading(false)
  }, [loadProfile, loadRequests])

  useEffect(() => {
    fetchAll()
    // Polling replaces the realtime subscription (the API
    // already scopes rows to this user).
    const interval = setInterval(loadRequests, 30000)
    const onFocus = () => loadRequests()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchAll, loadRequests])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await loadRequests()
    setIsRefreshing(false)
  }

  // ─── Submit new request ───────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseFloat(formAmount)
    if (!formTitle.trim()) return setFeedback({ type: 'error', message: 'Title is required.' })
    if (isNaN(amount) || amount <= 0) return setFeedback({ type: 'error', message: 'Enter a valid amount.' })
    // Cash method does not require account details
    if (formPayMethod !== 'cash') {
      if (!formAccountName.trim() || !formAccountNum.trim())
        return setFeedback({ type: 'error', message: 'Payment account name and number are required.' })
      if (formPayMethod === 'bank' && !formBankName.trim())
        return setFeedback({ type: 'error', message: 'Bank name is required for bank transfers.' })
      if (formPayMethod === 'bank' && !formBankBranch.trim())
        return setFeedback({ type: 'error', message: 'Branch name is required for bank transfers.' })
    }

    setIsSubmitting(true)
    setFeedback(null)

    // Guard: profile must be loaded before submitting
    if (!profile) {
      setFeedback({ type: 'error', message: 'Profile not loaded. Please refresh and try again.' })
      setIsSubmitting(false)
      return
    }

    let invoiceUrl: string | null = null

    // Upload invoice if purchased and file selected
    if (formIsPurchased && formInvoiceFile) {
      setUploadProgress(true)
      try {
        const ext = formInvoiceFile.name.split('.').pop()
        const path = `${profile.id}/${Date.now()}.${ext}`
        const uploaded = await uploadFile('expense-invoices', formInvoiceFile, path)
        // Save the file URL in the database
        invoiceUrl = uploaded.url
      } catch (uploadErr: any) {
        setUploadProgress(false)
        setFeedback({ type: 'error', message: `Invoice upload failed: ${uploadErr.message}` })
        setIsSubmitting(false)
        return
      }
      setUploadProgress(false)
    }

    // Identity, branch, cash status and the cash-ledger booking
    // are all set server-side from the session.
    const payload = {
      title: formTitle.trim(),
      description: formDesc.trim() || null,
      amount,
      is_purchased: formIsPurchased,
      invoice_url: invoiceUrl,
      payment_method: formPayMethod,
      account_holder_name: formPayMethod === 'cash' ? null : formAccountName.trim(),
      account_number: formPayMethod === 'cash' ? null : formAccountNum.trim(),
      bank_name: formPayMethod === 'bank' ? formBankName.trim() : null,
      bank_branch: formPayMethod === 'bank' ? formBankBranch.trim() : null,
    }

    try {
      const res = await fetch('/api/expense-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || 'Failed to submit expense request')
      }
    } catch (error: any) {
      setFeedback({ type: 'error', message: error.message })
      setIsSubmitting(false)
      return
    }

    // Trigger admin notifications in background
    try {
      fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'EXPENSE_SUBMITTED',
          payload: {
            userName: profile.full_name,
            branchName: profile.branch_name || 'Branch',
            title: formTitle.trim(),
            amount,
            branchId: profile.branch_id
          }
        })
      });
    } catch (e) { console.error('Notify error:', e) }

    // Success: close modal first, then show banner, then clear after delay
    resetForm()
    setShowModal(false)
    await loadRequests()
    setIsSubmitting(false)
    setFeedback({ type: 'success', message: '✓ Expense request submitted successfully!' })
    setTimeout(() => setFeedback(null), 4000)
  }

  const resetForm = () => {
    setFormTitle(''); setFormDesc(''); setFormAmount('')
    setFormIsPurchased(false); setFormInvoiceFile(null)
    setFormPayMethod('cash'); setFormAccountName('')
    setFormAccountNum(''); setFormBankName(''); setFormBankBranch('')
  }

  // ─── Stats ────────────────────────────────────────────────────────────────
  const totalAmount = requests.reduce((s, r) => s + Number(r.amount), 0)
  const pendingCount = requests.filter(r => r.status === 'pending').length
  const paidCount = requests.filter(r => r.status === 'paid').length
  const paidAmount = requests.filter(r => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0)

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isManagerOrAdmin =
    profile?.role === 'branch_manager' ||
    profile?.role === 'admin' ||
    profile?.role === 'super_admin' ||
    profile?.is_branch_manager === true ||
    profile?.profile_type === 'branch_manager'

  if (profile && !isManagerOrAdmin) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="max-w-md w-full p-8 rounded-2xl border border-slate-900/10 bg-slate-900/[0.04] text-center shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
            <Receipt className="w-7 h-7 text-[#8a6d1f]" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2 font-serif">Expense Requests Restricted</h1>
          <p className="text-sm text-slate-500 mb-6 leading-relaxed">
            Official expense requests can only be initiated by <strong className="text-slate-900">Branch Managers</strong>. If you have branch operating expenses to report, please contact your Branch Manager directly.
          </p>
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#d4af37] to-white text-black text-xs font-bold uppercase tracking-wider shadow-lg shadow-[#d4af37]/10 hover:opacity-95 transition-all"
          >
            <ArrowLeft className="w-4 h-4" /> Return to Portal
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-white text-slate-900 font-sans relative">
      {/* Background glows */}
      <div className="absolute top-[-5%] right-[-5%] w-[40%] h-[40%] bg-[#d4af37]/3 rounded-full filter blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-5%] left-[10%] w-[45%] h-[45%] bg-emerald-500/3 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="relative z-10 flex flex-col p-4 md:p-6 overflow-y-auto max-h-screen custom-scrollbar">

        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-4 border-b border-slate-900/5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] bg-[#d4af37]/10 text-[#8a6d1f] border border-[#d4af37]/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                <Receipt className="w-3 h-3" /> Expense Requests
              </span>
              {profile?.branch_name && (
                <span className="text-[10px] bg-slate-900/[0.04] text-slate-500 border border-slate-900/10 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> {profile.branch_name}
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 font-serif">
              My Expense Requests
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5">Submit and track your branch expense requests.</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleRefresh}
              className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#d4af37]/20 text-slate-500 hover:text-slate-900 transition-all cursor-pointer active:scale-95 ${isRefreshing ? 'animate-spin text-[#8a6d1f]' : ''}`}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => { resetForm(); setShowModal(true) }}
              className="bg-gradient-to-r from-[#d4af37] to-white text-black font-semibold px-4 py-2.5 rounded-xl text-xs tracking-wider uppercase flex items-center gap-2 shadow-lg shadow-[#d4af37]/10 active:scale-95 transition-transform"
            >
              <Plus className="w-4 h-4" />
              New Request
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

        {/* ── Stats ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatsCard title="Total Requests" value={String(requests.length)} subtext="All time" icon={FileText} sparklineColor="gold" sparklineData={[1,2,3,2,4]} />
          <StatsCard title="Pending Review" value={String(pendingCount)} subtext="Awaiting admin" icon={Clock} sparklineColor="amber" sparklineData={[2,1,3,2,1]} />
          <StatsCard title="Paid Out" value={String(paidCount)} subtext="Received" icon={Wallet} sparklineColor="emerald" sparklineData={[1,2,3,4,5]} />
          <StatsCard title="Total Requested" value={`${totalAmount.toLocaleString()} BDT`} subtext="Cumulative" icon={Banknote} sparklineColor="rose" sparklineData={[3,2,5,4,6]} />
        </div>

        {/* ── Request List ── */}
        <div className="glass-panel rounded-2xl shadow-xl overflow-hidden">
          <div className="p-4 md:p-5 border-b border-slate-900/5 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 font-serif flex items-center gap-2">
              <Receipt className="w-4 h-4 text-[#8a6d1f]" /> Request History
            </h2>
            <span className="text-[10px] text-slate-500">{requests.length} total</span>
          </div>

          {requests.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-900/[0.04] border border-slate-900/5 flex items-center justify-center mx-auto mb-4">
                <Receipt className="w-8 h-8 text-slate-600" />
              </div>
              <p className="text-slate-500 text-sm mb-1">No expense requests yet</p>
              <p className="text-slate-600 text-xs">Click "New Request" to submit your first expense request.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-900/[0.08]">
              <AnimatePresence>
                {requests.map(req => {
                  const sc = statusConfig[req.status] || statusConfig.pending
                  const Icon = sc.icon
                  return (
                    <motion.div
                      key={req.id}
                      id={`item-${req.id}`}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      onClick={() => setSelectedRequest(req)}
                      className="p-4 md:p-5 flex items-center justify-between gap-4 hover:bg-slate-900/[0.04] cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${sc.cls.split(' ')[0]}`}>
                          <Icon className={`w-4 h-4 ${sc.cls.split(' ')[1]}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate group-hover:text-[#8a6d1f] transition-colors">{req.title}</p>
                          <p className="text-[10px] text-slate-500 truncate mt-0.5">
                            {new Date(req.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                            {req.is_purchased && <span className="ml-2 text-[#8a6d1f]">· Already Purchased</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-bold text-slate-900">{Number(req.amount).toLocaleString()} BDT</p>
                          <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${sc.cls}`}>
                            {sc.label}
                          </span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-500 transition-colors" />
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════
          NEW REQUEST MODAL
      ════════════════════════════════════ */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-md flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-lg bg-white border border-slate-900/10 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-900/5 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
                    <Plus className="w-4 h-4 text-[#8a6d1f]" /> New Expense Request
                  </h2>
                  {profile?.branch_name && (
                    <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
                      <Building2 className="w-3 h-3" /> Branch: {profile.branch_name}
                    </p>
                  )}
                </div>
                <button onClick={() => setShowModal(false)} className="p-3 rounded-xl hover:bg-slate-900/[0.04] text-slate-500 hover:text-slate-900 transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto custom-scrollbar p-5 space-y-4">
                <form id="expense-form" onSubmit={handleSubmit} className="space-y-4">

                  {/* Title */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Expense Title <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Office Fan, Light Bulbs"
                      value={formTitle}
                      onChange={e => setFormTitle(e.target.value)}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Description / Details
                    </label>
                    <textarea
                      placeholder="Describe why this expense is needed..."
                      value={formDesc}
                      onChange={e => setFormDesc(e.target.value)}
                      rows={2}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all resize-none"
                    />
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Amount (BDT) <span className="text-rose-600">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 font-bold">৳</span>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={formAmount}
                        min="1"
                        step="0.01"
                        onChange={e => setFormAmount(e.target.value)}
                        className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl pl-8 pr-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                      />
                    </div>
                  </div>

                  {/* Already Purchased Toggle */}
                  <div className="p-3 rounded-xl border border-slate-900/5 bg-slate-900/[0.04]">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div className="flex items-center gap-2">
                        <ShoppingCart className="w-4 h-4 text-[#8a6d1f]" />
                        <div>
                          <p className="text-xs font-semibold text-slate-900">I already purchased this item</p>
                          <p className="text-[10px] text-slate-500">Upload invoice and request reimbursement</p>
                        </div>
                      </div>
                      <div
                        onClick={() => setFormIsPurchased(!formIsPurchased)}
                        className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${formIsPurchased ? 'bg-[#d4af37]' : 'bg-slate-900/[0.07]'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${formIsPurchased ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </div>
                    </label>

                    {/* Invoice Upload (conditional) */}
                    <AnimatePresence>
                      {formIsPurchased && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 pt-3 border-t border-slate-900/5">
                            <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                              Invoice / Receipt <span className="text-slate-600">(Optional)</span>
                            </label>
                            <label className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-900/10 hover:border-[#d4af37]/30 rounded-xl p-4 cursor-pointer transition-colors group">
                              <input
                                type="file"
                                accept="image/*,application/pdf"
                                className="hidden"
                                onChange={e => setFormInvoiceFile(e.target.files?.[0] || null)}
                              />
                              <Upload className="w-4 h-4 text-slate-500 group-hover:text-[#8a6d1f] transition-colors" />
                              <span className="text-xs text-slate-500 group-hover:text-slate-600 transition-colors">
                                {formInvoiceFile ? formInvoiceFile.name : 'Click to upload invoice / photo'}
                              </span>
                            </label>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* ── Payment Info Section ── */}
                  <div className="pt-2">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-3">
                      Payment Method
                    </p>

                    {/* Method Toggle — 3 options */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                      {([
                        { key: 'cash',  label: 'Cash',          icon: Banknote   },
                        { key: 'bkash', label: 'bKash/Mobile',  icon: CreditCard },
                        { key: 'bank',  label: 'Bank Transfer', icon: Building2  },
                      ] as const).map(({ key, label, icon: Icon }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setFormPayMethod(key)}
                          className={`p-3 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center gap-1.5 transition-all ${
                            formPayMethod === key
                              ? key === 'cash'
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                                : 'border-[#d4af37]/40 bg-[#d4af37]/10 text-[#8a6d1f]'
                              : 'border-slate-900/5 bg-slate-900/[0.04] text-slate-500 hover:border-slate-900/10'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span className="text-[10px] leading-tight text-center">{label}</span>
                        </button>
                      ))}
                    </div>

                    {/* Cash info box */}
                    {formPayMethod === 'cash' && (
                      <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex items-start gap-2.5">
                        <Banknote className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-emerald-600">Branch Cash Expense</p>
                          <p className="text-[10px] text-emerald-600 mt-0.5 leading-relaxed">
                            এই amount টি branch-এর daily cash closing থেকে automatically deduct হবে।
                            কোনো account number দরকার নেই।
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Account fields — only for bkash / bank */}
                    {formPayMethod !== 'cash' && (
                      <div className="space-y-3">
                        <input
                          type="text"
                          placeholder="Account Holder Name *"
                          value={formAccountName}
                          onChange={e => setFormAccountName(e.target.value)}
                          className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                        />
                        <input
                          type="text"
                          placeholder={formPayMethod === 'bkash' ? 'bKash / Mobile Number *' : 'Bank Account Number *'}
                          value={formAccountNum}
                          onChange={e => setFormAccountNum(e.target.value)}
                          className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                        />
                        {formPayMethod === 'bank' && (
                          <>
                            <input
                              type="text"
                              placeholder="Bank Name *"
                              value={formBankName}
                              onChange={e => setFormBankName(e.target.value)}
                              className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                            />
                            <input
                              type="text"
                              placeholder="Branch Name *"
                              value={formBankBranch}
                              onChange={e => setFormBankBranch(e.target.value)}
                              className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </form>
              </div>

              {/* Modal Footer */}
              <div className="p-5 border-t border-slate-900/5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-900/10 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-900 hover:border-slate-900/20 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="expense-form"
                  disabled={isSubmitting}
                  className="flex-1 bg-gradient-to-r from-[#d4af37] to-white text-black font-bold px-4 py-2.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-[#d4af37]/10 active:scale-95 transition-transform disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" />{uploadProgress ? 'Uploading...' : 'Submitting...'}</>
                  ) : (
                    <><Check className="w-3.5 h-3.5" />Submit Request</>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════════════════════════════
          DETAIL DRAWER
      ════════════════════════════════════ */}
      <AnimatePresence>
        {selectedRequest && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-md flex items-end md:items-center justify-center p-4 md:p-4"
            onClick={e => { if (e.target === e.currentTarget) setSelectedRequest(null) }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
              className="w-full max-w-md bg-white border border-slate-900/10 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              {/* Drawer Header */}
              <div className="p-5 border-b border-slate-900/5 flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 font-serif truncate pr-4">{selectedRequest.title}</h3>
                <button onClick={() => setSelectedRequest(null)} className="p-3 rounded-xl hover:bg-slate-900/[0.04] text-slate-500 hover:text-slate-900 transition-all flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Status */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Status</span>
                  <span className={`text-[10px] px-3 py-1 rounded-full border font-bold uppercase tracking-wider ${statusConfig[selectedRequest.status]?.cls}`}>
                    {statusConfig[selectedRequest.status]?.label}
                  </span>
                </div>

                {/* Amount */}
                <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Requested Amount</p>
                  <p className="text-2xl font-bold text-slate-900">{Number(selectedRequest.amount).toLocaleString()} BDT</p>
                </div>

                {/* Details */}
                <div className="space-y-2">
                  {selectedRequest.description && (
                    <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Description</p>
                      <p className="text-xs text-slate-600">{selectedRequest.description}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Payment Method</p>
                      <p className="text-xs text-slate-900 capitalize">
                        {selectedRequest.payment_method === 'cash'
                          ? '💵 Cash (Branch)'
                          : selectedRequest.payment_method === 'bkash'
                          ? 'bKash / Mobile'
                          : 'Bank Transfer'}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Purchased</p>
                      <p className="text-xs text-slate-900">{selectedRequest.is_purchased ? 'Yes — Invoice provided' : 'No — Pre-approval'}</p>
                    </div>
                  </div>

                  {/* Payment account — only for bkash/bank */}
                  {selectedRequest.payment_method !== 'cash' && (
                    <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-2">Payment Account</p>
                      <p className="text-xs text-slate-900">{selectedRequest.account_holder_name}</p>
                      <p className="text-xs text-slate-500 font-mono">{selectedRequest.account_number}</p>
                      {selectedRequest.bank_name && <p className="text-xs text-slate-500">{selectedRequest.bank_name}</p>}
                      {selectedRequest.bank_branch && <p className="text-xs text-slate-500">Branch: {selectedRequest.bank_branch}</p>}
                    </div>
                  )}
                  {selectedRequest.payment_method === 'cash' && (
                    <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                      <p className="text-[10px] text-emerald-600 uppercase tracking-wider font-bold mb-1">Cash Expense</p>
                      <p className="text-xs text-emerald-600">Branch daily cash থেকে deduct হবে।</p>
                    </div>
                  )}

                  {/* TRX / Paid */}
                  {selectedRequest.status === 'paid' && selectedRequest.trx_id && (
                    <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                      <p className="text-[10px] text-emerald-600 uppercase tracking-wider font-bold mb-1">Transaction ID</p>
                      <p className="text-xs font-mono text-emerald-300">{selectedRequest.trx_id}</p>
                      {selectedRequest.paid_at && (
                        <p className="text-[10px] text-emerald-500 mt-1">Paid on {new Date(selectedRequest.paid_at).toLocaleString()}</p>
                      )}
                    </div>
                  )}

                  {/* Admin notes */}
                  {selectedRequest.admin_notes && (
                    <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Admin Notes</p>
                      <p className="text-xs text-slate-600">{selectedRequest.admin_notes}</p>
                    </div>
                  )}

                  {/* Invoice link */}
                  {selectedRequest.invoice_url && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedRequest.invoice_url) return;
                        // Uploads store the direct file URL; legacy
                        // bare storage paths cannot be opened.
                        if (selectedRequest.invoice_url.startsWith('http') || selectedRequest.invoice_url.startsWith('/')) {
                          window.open(selectedRequest.invoice_url, '_blank');
                          return;
                        }
                        alert('Failed to load invoice image.');
                      }}
                      className="flex items-center gap-2 p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#d4af37]/20 transition-colors group w-full text-left"
                    >
                      <Eye className="w-4 h-4 text-slate-500 group-hover:text-[#8a6d1f]" />
                      <span className="text-xs text-slate-500 group-hover:text-slate-900 transition-colors">View Uploaded Invoice</span>
                    </button>
                  )}
                </div>

                {/* Date */}
                <p className="text-[10px] text-slate-600 text-right">
                  Submitted on {new Date(selectedRequest.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
