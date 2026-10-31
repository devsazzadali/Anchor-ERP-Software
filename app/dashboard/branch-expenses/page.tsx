'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Building2, Receipt, Check, X, DollarSign, Clock, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, Search, SlidersHorizontal, Download, Loader2,
  Eye, CreditCard, FileText, Banknote, ShoppingCart, CalendarRange,
  TrendingUp, BadgeCheck, BarChart3, ChevronDown, Filter, Globe, MapPin,
  ChevronRight, ArrowLeft, Plus, Upload, Trash2, Landmark, ShieldCheck, Edit3
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { generatePdf } from '@/lib/pdf-generator'
import { getCachedData, setCachedData, invalidateBranchCache } from '@/lib/branch-cache'

// branches + all requests come from
// GET /api/expense-requests/all (admin/partner/head-office gate
// enforced server-side; the branch-cache UI caching stays).
// Edits, confirm/reject/pay actions and deletes go through
// PATCH/DELETE /api/expense-requests/[id]; admin-direct creates
// go to POST /api/expense-requests/all (identity, due amount and
// status are computed server-side). Realtime is replaced with
// 30s polling + focus refetch.

const isHeadOffice = (name?: string | null) => {
  if (!name) return false
  const n = name.trim().toLowerCase()
  return n === 'head office' || n === 'head_office' || n === 'hq' || n === 'main office' || n === 'corporate'
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type Branch = { id: string; name: string }

type ExpenseRequest = {
  id: string
  employee_id: string
  employee_name: string | null
  branch_id: string | null
  branch_name: string | null
  title: string
  description: string | null
  amount: number
  paid_amount?: number | null
  due_amount?: number | null
  currency: string
  is_purchased: boolean
  invoice_url: string | null
  payment_method: 'bkash' | 'bank'
  account_holder_name: string | null
  account_number: string | null
  bank_name: string | null
  bank_branch?: string | null
  status: 'pending' | 'approved' | 'rejected' | 'paid'
  admin_notes: string | null
  trx_id: string | null
  paid_at: string | null
  created_at: string
}

const STATUS_CONFIG: Record<string, { label: string; cls: string; dot: string }> = {
  pending:  { label: 'Pending',  cls: 'bg-amber-500/10 text-amber-600 border-amber-500/20',       dot: 'bg-amber-400' },
  approved: { label: 'Approved', cls: 'bg-blue-500/10 text-blue-600 border-blue-500/20',           dot: 'bg-blue-400' },
  rejected: { label: 'Rejected', cls: 'bg-rose-500/10 text-rose-600 border-rose-500/20',           dot: 'bg-rose-400' },
  paid:     { label: 'Paid',     cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',  dot: 'bg-emerald-400' },
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PartnerBranchExpensesPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [allRequests, setAllRequests] = useState<ExpenseRequest[]>(() => getCachedData('partner_expense_requests') || [])
  const [branches, setBranches]       = useState<Branch[]>(() => getCachedData('partner_expense_branches') || [])
  const [isLoading, setIsLoading]     = useState(() => !getCachedData('partner_expense_requests'))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [adminName, setAdminName]     = useState('Admin')
  const [adminId, setAdminId]         = useState('')

  // URL-driven state
  const activeTab     = (searchParams?.get('view') ?? 'list') as 'list' | 'analytics'
  const statusFilter  = searchParams?.get('status') ?? 'all'
  const branchParam   = searchParams?.get('branch') ?? null

  // selectedBranch is resolved from branchParam + loaded branches
  const [branchesLoaded, setBranchesLoaded] = useState(() => !!getCachedData('partner_expense_branches'))
  const selectedBranch = useMemo(() => {
    if (!branchParam || !branchesLoaded) return null
    const cleanParam = branchParam.replace(/^name_/, '').toLowerCase()
    const found = branches.find(b => b.id === branchParam || (b.name && b.name.toLowerCase() === cleanParam))
    if (found) return found
    // Special virtual branches ('all', 'unassigned', 'general', 'branch')
    if (['all', 'unassigned', 'general', 'branch', 'unassigned branch'].includes(cleanParam)) {
      if (cleanParam === 'all') return { id: 'all', name: 'All Branches' }
      if (['unassigned', 'branch', 'unassigned branch'].includes(cleanParam)) return { id: 'unassigned', name: 'Unassigned Branch' }
      return { id: 'general', name: 'General' }
    }
    if (branchParam.startsWith('name_')) {
      return { id: branchParam, name: branchParam.replace('name_', '') }
    }
    return null
  }, [branchParam, branches, branchesLoaded])

  // URL update helpers
  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    if (value === null || value === 'all' || value === 'list') {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    return params.toString()
  }

  const goToBranch = (branch: { id: string; name: string } | null) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    if (branch) {
      params.set('branch', branch.id)
    } else {
      params.delete('branch')
      params.delete('view')
      params.delete('status')
    }
    router.push(pathname + '?' + params.toString())
  }

  const updateActiveTab = (tab: 'list' | 'analytics') => {
    const qs = updateParam('view', tab === 'list' ? null : tab)
    router.replace(pathname + (qs ? '?' + qs : ''))
  }

  const updateStatusFilter = (value: string) => {
    const qs = updateParam('status', value === 'all' ? null : value)
    router.replace(pathname + (qs ? '?' + qs : ''))
  }

  // Filters (kept in local state — they are secondary/secondary filters within a branch view)
  const [search, setSearch]           = useState('')
  const [branchFilter, setBranchFilter] = useState('all')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Action modal
  const [actionRequest, setActionRequest] = useState<ExpenseRequest | null>(null)
  const [actionType, setActionType]   = useState<'confirm' | 'reject' | 'pay' | 'view' | null>(null)
  const [adminNote, setAdminNote]     = useState('')
  const [trxInput, setTrxInput]       = useState('')
  const [isActioning, setIsActioning] = useState(false)
  const [feedback, setFeedback]       = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Export
  const [showExportDropdown, setShowExportDropdown] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isSelectMode, setIsSelectMode] = useState(false)

  // New Request modal
  const [showNewModal, setShowNewModal] = useState(false)
  const [isSubmittingNew, setIsSubmittingNew] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formIsPurchased, setFormIsPurchased] = useState(false)
  const [formInvoiceFile, setFormInvoiceFile] = useState<File | null>(null)
  const [formPayMethod, setFormPayMethod] = useState<'bkash' | 'bank'>('bkash')
  const [formAccountName, setFormAccountName] = useState('')
  const [formAccountNum, setFormAccountNum] = useState('')
  const [formBankName, setFormBankName] = useState('')
  const [formBankBranch, setFormBankBranch] = useState('')
  const [uploadProgress, setUploadProgress] = useState(false)
  const [formPaidAmount, setFormPaidAmount] = useState('')
  const [formDueAmount, setFormDueAmount] = useState('')
  const [modalFeedback, setModalFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Edit Request modal
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingRequest, setEditingRequest] = useState<ExpenseRequest | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editPaidAmount, setEditPaidAmount] = useState('')
  const [editDueAmount, setEditDueAmount] = useState('')
  const [editStatus, setEditStatus] = useState<'pending' | 'approved' | 'rejected' | 'paid'>('pending')
  const [editTrxId, setEditTrxId] = useState('')
  const [editAdminNotes, setEditAdminNotes] = useState('')
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const [editFeedback, setEditFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Auto-calculate Due Amount = Total - Paid
  const handleFormTotalChange = (val: string) => {
    setFormAmount(val)
    if (val === '' || isNaN(Number(val))) {
      setFormDueAmount('')
      return
    }
    const tot = Number(val)
    const paid = formPaidAmount !== '' ? Number(formPaidAmount) : 0
    setFormDueAmount(String(Math.max(0, tot - paid)))
  }

  const handleFormPaidChange = (val: string) => {
    setFormPaidAmount(val)
    if (formAmount !== '' && !isNaN(Number(formAmount))) {
      const tot = Number(formAmount)
      const paid = val !== '' ? Number(val) : 0
      setFormDueAmount(String(Math.max(0, tot - paid)))
    }
  }

  const handleFormDueChange = (val: string) => {
    setFormDueAmount(val)
    if (formAmount !== '' && !isNaN(Number(formAmount))) {
      const tot = Number(formAmount)
      const due = val !== '' ? Number(val) : 0
      setFormPaidAmount(String(Math.max(0, tot - due)))
    }
  }

  const openEditModal = (req: ExpenseRequest) => {
    setEditingRequest(req)
    setEditTitle(req.title || '')
    setEditDesc(req.description || '')
    setEditAmount(req.amount ? String(req.amount) : '')
    setEditPaidAmount(req.paid_amount !== undefined && req.paid_amount !== null ? String(req.paid_amount) : '0')
    setEditDueAmount(req.due_amount !== undefined && req.due_amount !== null ? String(req.due_amount) : String(req.amount || 0))
    setEditStatus(req.status || 'pending')
    setEditTrxId(req.trx_id || '')
    setEditAdminNotes(req.admin_notes || '')
    setEditFeedback(null)
    setShowEditModal(true)
  }

  const handleEditTotalChange = (val: string) => {
    setEditAmount(val)
    if (val === '' || isNaN(Number(val))) {
      setEditDueAmount('')
      return
    }
    const tot = Number(val)
    const paid = editPaidAmount !== '' ? Number(editPaidAmount) : 0
    setEditDueAmount(String(Math.max(0, tot - paid)))
  }

  const handleEditPaidChange = (val: string) => {
    setEditPaidAmount(val)
    if (editAmount !== '' && !isNaN(Number(editAmount))) {
      const tot = Number(editAmount)
      const paid = val !== '' ? Number(val) : 0
      setEditDueAmount(String(Math.max(0, tot - paid)))
      if (paid >= tot && tot > 0) setEditStatus('paid')
    }
  }

  const handleEditDueChange = (val: string) => {
    setEditDueAmount(val)
    if (editAmount !== '' && !isNaN(Number(editAmount))) {
      const tot = Number(editAmount)
      const due = val !== '' ? Number(val) : 0
      setEditPaidAmount(String(Math.max(0, tot - due)))
    }
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingRequest) return
    const amount = parseFloat(editAmount)
    if (!editTitle.trim()) return setEditFeedback({ type: 'error', message: 'Title is required.' })
    if (isNaN(amount) || amount <= 0) return setEditFeedback({ type: 'error', message: 'Enter a valid amount.' })

    setIsSubmittingEdit(true)
    setEditFeedback(null)

    const paidNum = parseFloat(editPaidAmount) || 0

    // Due amount and paid_at are recomputed server-side.
    const payload: any = {
      title: editTitle.trim(),
      description: editDesc.trim() || null,
      amount,
      paid_amount: paidNum,
      status: editStatus,
      trx_id: editTrxId.trim() || null,
      admin_notes: editAdminNotes.trim() || null,
    }

    try {
      const res = await fetch(`/api/expense-requests/${editingRequest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || 'Failed to update expense request')
      }
      setEditFeedback({ type: 'success', message: 'Expense request updated successfully!' })
      await fetchRequests()
      setTimeout(() => {
        setShowEditModal(false)
        setEditFeedback(null)
      }, 1000)
    } catch (error: any) {
      setEditFeedback({ type: 'error', message: error.message })
    }
    setIsSubmittingEdit(false)
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch('/api/auth/me')
        if (res.ok) {
          const me = await res.json()
          if (me.user) {
            setAdminId(me.user.id)
            setAdminName(me.profile?.full_name || 'Admin')
            return
          }
        }
      } catch (e) {}
      try {
        const sess = JSON.parse(localStorage.getItem('aura_session') || '{}')
        setAdminName(sess.user?.full_name || 'Admin')
        if (sess.user?.id) setAdminId(sess.user.id)
      } catch {}
    }
    init()
  }, [])

  // Close export dropdown on outside click
  useEffect(() => {
    if (!showExportDropdown) return
    const handler = () => setShowExportDropdown(false)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showExportDropdown])

  // ─── Fetch ────────────────────────────────────────────────────────────────
  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch('/api/expense-requests/all')
      if (!res.ok) return
      const { branches: data } = await res.json()
      if (data) {
        const sorted = [...data].sort((a, b) => {
          const aHq = isHeadOffice(a.name)
          const bHq = isHeadOffice(b.name)
          if (aHq && !bHq) return -1
          if (!aHq && bHq) return 1
          return (a.name || '').localeCompare(b.name || '')
        })
        setBranches(sorted)
        setBranchesLoaded(true)
        setCachedData('partner_expense_branches', sorted, 120000)
      }
    } catch (e) {}
  }, [])

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/expense-requests/all')
      if (!res.ok) return
      const { requests: data } = await res.json()
      if (data) {
        setAllRequests(data)
        setCachedData('partner_expense_requests', data, 45000)
      }
    } catch (e) {}
  }, [])

  const fetchAll = useCallback(async () => {
    if (!getCachedData('partner_expense_requests')) {
      setIsLoading(true)
    }
    await Promise.all([fetchBranches(), fetchRequests()])
    setIsLoading(false)
  }, [fetchBranches, fetchRequests])

  useEffect(() => {
    fetchAll()
    // Polling replaces the realtime subscription.
    const interval = setInterval(fetchRequests, 30000)
    const onFocus = () => fetchRequests()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchAll, fetchRequests])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchRequests()
    setIsRefreshing(false)
  }

  const setLast30Days = () => {
    const now = new Date()
    const from = new Date(now)
    from.setDate(from.getDate() - 30)
    setDateFrom(from.toISOString().slice(0, 10))
    setDateTo(now.toISOString().slice(0, 10))
  }

  // ─── Computed ─────────────────────────────────────────────────────────────
  const displayBranches = useMemo(() => {
    const list: { id: string; name: string }[] = [...branches]
    allRequests.forEach(r => {
      if (r.branch_id && !list.some(b => b.id === r.branch_id)) {
        list.push({ id: r.branch_id, name: r.branch_name || 'Unnamed Branch' })
      } else if (!r.branch_id && r.branch_name && !list.some(b => b.name.toLowerCase() === (r.branch_name || '').toLowerCase())) {
        list.push({ id: `name_${r.branch_name}`, name: r.branch_name })
      } else if (!r.branch_id && !r.branch_name && !list.some(b => b.id === 'unassigned')) {
        list.push({ id: 'unassigned', name: 'Unassigned Branch' })
      }
    })
    return list.sort((a, b) => {
      const aHq = isHeadOffice(a.name)
      const bHq = isHeadOffice(b.name)
      if (aHq && !bHq) return -1
      if (!aHq && bHq) return 1
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [branches, allRequests])

  const branchStats = useMemo(() => {
    const map: Record<string, { totalAmount: number; paidAmount: number; dueAmount: number; pendingCount: number; count: number }> = {}
    displayBranches.forEach(b => {
      map[b.id] = { totalAmount: 0, paidAmount: 0, dueAmount: 0, pendingCount: 0, count: 0 }
    })
    allRequests.forEach(r => {
      const amt = Number(r.amount) || 0
      const paidAmt = r.paid_amount !== undefined && r.paid_amount !== null
        ? Number(r.paid_amount)
        : (r.status === 'paid' ? amt : 0)
      const dueAmt = r.due_amount !== undefined && r.due_amount !== null
        ? Number(r.due_amount)
        : Math.max(0, amt - paidAmt)
      const isPending = r.status === 'pending'
      
      const matched = displayBranches.find(b => b.id === r.branch_id || (r.branch_name && b.name.toLowerCase() === (r.branch_name || '').toLowerCase())) || displayBranches.find(b => b.id === 'unassigned')
      if (matched) {
        if (!map[matched.id]) map[matched.id] = { totalAmount: 0, paidAmount: 0, dueAmount: 0, pendingCount: 0, count: 0 }
        map[matched.id].totalAmount += amt
        map[matched.id].paidAmount += paidAmt
        map[matched.id].dueAmount += dueAmt
        if (isPending) map[matched.id].pendingCount += 1
        map[matched.id].count += 1
      }
    })
    return map
  }, [allRequests, displayBranches])

  const summaryBase = useMemo(() => {
    if (selectedBranch) {
      if (selectedBranch.id === 'unassigned') return allRequests.filter(r => !r.branch_id && (!r.branch_name || ['branch', 'unassigned', 'unassigned branch', 'general'].includes(r.branch_name.toLowerCase())))
      return allRequests.filter(r => r.branch_id === selectedBranch.id || (r.branch_name && (r.branch_name || '').toLowerCase() === (selectedBranch.name || '').toLowerCase()))
    }
    if (branchFilter === 'all') return allRequests
    if (branchFilter === 'unassigned') return allRequests.filter(r => !r.branch_id && (!r.branch_name || ['branch', 'unassigned', 'unassigned branch', 'general'].includes(r.branch_name.toLowerCase())))
    const targetBranch = displayBranches.find(b => b.id === branchFilter)
    if (!targetBranch) return []
    return allRequests.filter(r => r.branch_id === targetBranch.id || (r.branch_name && (r.branch_name || '').toLowerCase() === (targetBranch.name || '').toLowerCase()))
  }, [allRequests, selectedBranch, branchFilter, displayBranches])

  const summaryStats = useMemo(() => ({
    total:      summaryBase.length,
    pending:    summaryBase.filter(r => r.status === 'pending').length,
    paid:       summaryBase.filter(r => r.status === 'paid').length,
    amount:     summaryBase.reduce((s, r) => s + Number(r.amount || 0), 0),
    paidAmount: summaryBase.reduce((s, r) => s + (r.paid_amount !== undefined && r.paid_amount !== null ? Number(r.paid_amount) : (r.status === 'paid' ? Number(r.amount || 0) : 0)), 0),
    dueAmount:  summaryBase.reduce((s, r) => {
      const amt = Number(r.amount || 0)
      const p = r.paid_amount !== undefined && r.paid_amount !== null ? Number(r.paid_amount) : (r.status === 'paid' ? amt : 0)
      return s + (r.due_amount !== undefined && r.due_amount !== null ? Number(r.due_amount) : Math.max(0, amt - p))
    }, 0),
  }), [summaryBase])

  // Clear search and date filters when navigating branches or statuses via URL
  useEffect(() => {
    setSearch('')
    setDateFrom('')
    setDateTo('')
  }, [statusFilter, branchParam])

  const filteredRequests = useMemo(() => {
    let base = [...allRequests]
    if (selectedBranch) {
      if (selectedBranch.id === 'unassigned') {
        base = base.filter(r => !r.branch_id && (!r.branch_name || ['branch', 'unassigned', 'unassigned branch', 'general'].includes(r.branch_name.toLowerCase())))
      } else if (selectedBranch.id === 'all' || selectedBranch.id === 'general') {
        // Do not filter by branch when viewing All Branches or General
      } else {
        base = base.filter(r => r.branch_id === selectedBranch.id || (r.branch_name && (r.branch_name || '').toLowerCase() === (selectedBranch.name || '').toLowerCase()))
      }
    } else if (branchFilter !== 'all') {
      if (branchFilter === 'unassigned') {
        base = base.filter(r => !r.branch_id && (!r.branch_name || ['branch', 'unassigned', 'unassigned branch', 'general'].includes(r.branch_name.toLowerCase())))
      } else {
        const targetBranch = displayBranches.find(b => b.id === branchFilter)
        if (targetBranch) {
          base = base.filter(r => r.branch_id === targetBranch.id || (r.branch_name && (r.branch_name || '').toLowerCase() === (targetBranch.name || '').toLowerCase()))
        }
      }
    }
    if (statusFilter !== 'all') base = base.filter(r => r.status === statusFilter)
    if (dateFrom) base = base.filter(r => new Date(r.created_at) >= new Date(dateFrom))
    if (dateTo) {
      const end = new Date(dateTo); end.setHours(23, 59, 59, 999)
      base = base.filter(r => new Date(r.created_at) <= end)
    }
    if (search) {
      const q = search.toLowerCase()
      base = base.filter(r =>
        r.title.toLowerCase().includes(q) ||
        (r.employee_name || '').toLowerCase().includes(q) ||
        (r.branch_name   || '').toLowerCase().includes(q) ||
        (r.description   || '').toLowerCase().includes(q)
      )
    }
    return base
  }, [allRequests, selectedBranch, branchFilter, statusFilter, dateFrom, dateTo, search, displayBranches])

  const analyticsData = useMemo(() => {
    const map: Record<string, number> = {}
    summaryBase.forEach(r => {
      const d = new Date(r.created_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      map[key] = (map[key] || 0) + Number(r.amount)
    })
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, amt]) => {
        const [y, m] = key.split('-')
        return {
          month: new Date(Number(y), Number(m) - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' }),
          amount: amt,
        }
      })
  }, [summaryBase])
  const maxAnalytics = Math.max(...analyticsData.map(d => d.amount), 1)

  // ─── Actions ──────────────────────────────────────────────────────────────
  const openAction = (req: ExpenseRequest, type: 'confirm' | 'reject' | 'pay' | 'view') => {
    setActionRequest(req); setActionType(type); setAdminNote(''); setTrxInput('')
  }

  const handleAction = async () => {
    if (!actionRequest || !actionType) return
    setIsActioning(true)

    let newStatus = ''
    if (actionType === 'confirm') {
      newStatus = 'approved'
    } else if (actionType === 'reject') {
      if (!adminNote.trim()) {
        setFeedback({ type: 'error', message: 'Please provide a reason for rejection.' })
        setIsActioning(false); return
      }
      newStatus = 'rejected'
    } else if (actionType === 'pay') {
      if (!trxInput.trim()) {
        setFeedback({ type: 'error', message: 'Please enter the Transaction ID.' })
        setIsActioning(false); return
      }
      newStatus = 'paid'
    }

    try {
      const res = await fetch(`/api/expense-requests/${actionRequest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionType,
          admin_notes: adminNote || null,
          trx_id: actionType === 'pay' ? trxInput.trim() : undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || 'Failed to update expense request')
      }
      // (In-app notifications are handled by the database trigger on employee_expense_requests)

      // Trigger employee email
      try {
        fetch('/api/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'EXPENSE_STATUS_UPDATED',
            payload: {
              userId: actionRequest.employee_id,
              userName: actionRequest.employee_name || 'Employee',
              title: actionRequest.title,
              status: newStatus,
              amount: actionRequest.amount,
              adminNotes: adminNote || null,
              trxId: newStatus === 'paid' ? trxInput.trim() : null
            }
          })
        })
      } catch (e) { console.error('Email trigger failed:', e) }

      const msgs: Record<string, string> = { confirm: '✓ Request approved & employee notified!', reject: '✓ Request rejected & employee notified.', pay: '✓ Payment recorded & employee notified!' }
      setFeedback({ type: 'success', message: msgs[actionType] })
      setActionRequest(null); setActionType(null)
      await fetchRequests()
    } catch (error: any) {
      setFeedback({ type: 'error', message: error.message })
    }
    setIsActioning(false)
    setTimeout(() => setFeedback(null), 4000)
  }

  // ─── Delete Request ──────────────────────────────────────────────────────
  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to delete the expense request "${title}"?`)) return
    try {
      const res = await fetch(`/api/expense-requests/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || 'Failed to delete expense request')
      }
      setAllRequests(prev => prev.filter(r => r.id !== id))
      setFeedback({ type: 'success', message: 'Expense request deleted successfully.' })
      setTimeout(() => setFeedback(null), 4000)
    } catch (err: any) {
      console.error('Delete error:', err)
      setFeedback({ type: 'error', message: err.message || 'Failed to delete expense request.' })
      setTimeout(() => setFeedback(null), 4000)
    }
  }

  // ─── Submit New Request (Admin) ──────────────────────────────────────────
  const handleNewSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedBranch || selectedBranch.id === 'unassigned' || selectedBranch.id === 'all' || selectedBranch.id.startsWith('name_')) {
      return setFeedback({ type: 'error', message: 'Please select a valid physical branch first.' })
    }
    const amount = parseFloat(formAmount)
    if (!formTitle.trim()) return setFeedback({ type: 'error', message: 'Title is required.' })
    if (isNaN(amount) || amount <= 0) return setFeedback({ type: 'error', message: 'Enter a valid amount.' })

    setIsSubmittingNew(true)
    setFeedback(null)

    if (!adminId) return setFeedback({ type: 'error', message: 'Admin session invalid. Please log in again.' })

    const paidNum = parseFloat(formPaidAmount) || 0

    // Identity, branch name, due amount and status are set
    // server-side (admin-direct create).
    const payload: any = {
      branch_id: selectedBranch.id,
      title: formTitle.trim(),
      description: formDesc.trim() || null,
      amount,
      paid_amount: paidNum,
      is_purchased: formIsPurchased,
      payment_method: formPayMethod,
      account_holder_name: formAccountName.trim() || null,
      account_number: formAccountNum.trim() || null,
      bank_name: formPayMethod === 'bank' ? (formBankName.trim() || null) : null,
      bank_branch: formPayMethod === 'bank' ? (formBankBranch.trim() || null) : null,
    }

    try {
      const res = await fetch('/api/expense-requests/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || 'Failed to add expense request')
      }
      setFormTitle(''); setFormDesc(''); setFormAmount(''); setFormIsPurchased(false); setFormInvoiceFile(null);
      setFormPayMethod('bkash'); setFormAccountName(''); setFormAccountNum(''); setFormBankName(''); setFormBankBranch('');
      setFormPaidAmount(''); setFormDueAmount('');
      setShowNewModal(false)
      setFeedback({ type: 'success', message: '✓ Expense request added successfully!' })
      await fetchRequests()
    } catch (error: any) {
      setFeedback({ type: 'error', message: error.message })
    }
    setIsSubmittingNew(false)
    setTimeout(() => setFeedback(null), 4000)
  }

  // ─── Exports ──────────────────────────────────────────────────────────────
  const branchLabel = selectedBranch?.name || (branchFilter === 'all' ? 'All Branches' : (displayBranches.find(b => b.id === branchFilter)?.name || 'All Branches'))

  const getExportDateRange = () => {
    if (dateFrom || dateTo) {
      return `${dateFrom || 'Start'} to ${dateTo || 'Present'}`;
    }
    if (filteredRequests.length === 0) return 'All Time';
    const timestamps = filteredRequests.map(r => new Date(r.created_at).getTime()).filter(t => !isNaN(t));
    if (timestamps.length === 0) return 'All Time';
    const minDate = new Date(Math.min(...timestamps)).toLocaleDateString('en-GB');
    const maxDate = new Date(Math.max(...timestamps)).toLocaleDateString('en-GB');
    return minDate === maxDate ? minDate : `${minDate} to ${maxDate}`;
  };

  const doExportCSV = () => {
    const targetData = (isSelectMode && selectedIds.length > 0) ? filteredRequests.filter(r => selectedIds.includes(r.id)) : filteredRequests;
    const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const headers = [q('Employee'), q('Branch'), q('Title'), q('Total Amount (BDT)'), q('Paid Amount (BDT)'), q('Due Amount (BDT)'), q('Method'), q('Account Name'), q('Account Number'), q('Bank'), q('Branch Name'), q('Purchased'), q('Status'), q('TRX ID'), q('Date'), q('Admin Notes')]
    const rows = targetData.map(r => [q(r.employee_name), q(r.branch_name), q(r.title), r.amount, r.paid_amount || 0, r.due_amount || 0, q(r.account_holder_name === 'Admin Direct' ? 'Admin Direct' : (r.payment_method === 'bkash' ? 'bKash' : 'Bank')), q(r.account_holder_name), q(r.account_number), q(r.bank_name), q(r.bank_branch), q(r.is_purchased ? 'Yes' : 'No'), q(r.status === 'paid' ? (r.trx_id ? `Paid (TRX: ${r.trx_id})` : 'Paid') : r.status.toUpperCase()), q(r.trx_id), q(new Date(r.created_at).toLocaleString()), q(r.admin_notes)].join(','))
    const total = targetData.reduce((s, r) => s + Number(r.amount || 0), 0)
    const totalPaid = targetData.reduce((s, r) => s + Number(r.paid_amount || 0), 0)
    const totalDue = targetData.reduce((s, r) => s + Number(r.due_amount || 0), 0)
    const content = [q('ANCHOR FASHION – Employee Expense Requests'), [q('Branch:'), q(branchLabel)].join(','), [q('Date Range:'), q(getExportDateRange())].join(','), '', headers.join(','), ...rows, '', [q('GRAND TOTAL'), q(''), q(''), total, totalPaid, totalDue, q(''), q(''), q(''), q(''), q(''), q(''), q(''), q(''), q(''), q('')].join(',')].join('\n')
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `Anchor_Expenses_${branchLabel.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv` })
    a.click(); URL.revokeObjectURL(a.href); setShowExportDropdown(false)
  }

  const doExportExcel = () => {
    const targetData = (isSelectMode && selectedIds.length > 0) ? filteredRequests.filter(r => selectedIds.includes(r.id)) : filteredRequests;
    const rows = targetData.map(r => ({
      'Employee': r.employee_name || '—',
      'Branch': r.branch_name || '—',
      'Title': r.title,
      'Description': r.description || '',
      'Total Amount (BDT)': Number(r.amount || 0),
      'Paid Amount (BDT)': Number(r.paid_amount || 0),
      'Due Amount (BDT)': Number(r.due_amount || 0),
      'Payment Method': r.account_holder_name === 'Admin Direct' ? 'Admin Direct' : (r.payment_method === 'bkash' ? 'bKash' : 'Bank'),
      'Account Name': r.account_holder_name || '',
      'Account Number': r.account_number || '',
      'Bank': r.bank_name || '',
      'Branch Name': r.bank_branch || '',
      'Purchased': r.is_purchased ? 'Yes' : 'No',
      'Status': r.status === 'paid' ? (r.trx_id ? `Paid (TRX: ${r.trx_id})` : 'Paid') : r.status.toUpperCase(),
      'TRX ID': r.trx_id || '',
      'Paid At': r.paid_at ? new Date(r.paid_at).toLocaleString() : '',
      'Submitted': new Date(r.created_at).toLocaleString(),
      'Admin Notes': r.admin_notes || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Employee Expenses')
    XLSX.writeFile(wb, `Anchor_Expenses_${branchLabel.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    setShowExportDropdown(false)
  }

  const doExportPDF = () => {
    const targetData = (isSelectMode && selectedIds.length > 0) ? filteredRequests.filter(r => selectedIds.includes(r.id)) : filteredRequests;
    const dateRangeStr = getExportDateRange()
    const totalAmount = targetData.reduce((s, r) => s + Number(r.amount || 0), 0)
    const totalPaid = targetData.reduce((s, r) => s + Number(r.paid_amount || 0), 0)
    const totalDue = targetData.reduce((s, r) => s + Number(r.due_amount || 0), 0)

    generatePdf('Employee Expense Requests', ['Employee', 'Branch', 'Title', 'Total Amount', 'Paid', 'Due', 'Status', 'Date'],
      targetData.map(r => [
        r.employee_name || '—',
        r.branch_name || '—',
        r.title,
        `${Number(r.amount).toLocaleString()} BDT`,
        `${Number(r.paid_amount || 0).toLocaleString()} BDT`,
        `${Number(r.due_amount || 0).toLocaleString()} BDT`,
        r.status === 'paid' ? (r.trx_id ? `Paid\nTRX: ${r.trx_id}` : 'Paid') : r.status.toUpperCase(),
        new Date(r.created_at).toLocaleDateString('en-GB')
      ]),
      {
        filename: `Anchor_Expenses_${branchLabel.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`,
        branch: branchLabel,
        subtitle: `Branch: ${branchLabel}`,
        preparedBy: adminName,
        dateRange: dateRangeStr,
        summaryData: [
          { label: 'Total Requests', value: `${targetData.length}` },
          { label: 'Total Amount', value: `${totalAmount.toLocaleString()} BDT` },
          { label: 'Total Paid', value: `${totalPaid.toLocaleString()} BDT` },
          { label: 'Total Due', value: `${totalDue.toLocaleString()} BDT` },
        ]
      }
    )
    setShowExportDropdown(false)
  }

  // ─────────────────────────────────────────────────────────────────────────
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

        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-4 border-b border-slate-900/5">
          <div>
            <span className="text-[10px] bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider inline-flex items-center gap-1 mb-1">
              <Building2 className="w-3 h-3" /> Branch Expense Requests
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 font-serif">Employee Expense Requests</h1>
            <p className="text-[11px] text-slate-500 mt-0.5">View and track expense requests across all branches.</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            

            {/* Refresh */}
            <button onClick={handleRefresh} className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}>
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Feedback ── */}
        <AnimatePresence>
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className={`mb-5 px-4 py-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${feedback.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' : 'bg-rose-500/10 border-rose-500/20 text-rose-600'}`}
            >
              {feedback.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {feedback.message}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─────────────────────────────────────────────────────── */}
        {/* VIEW A: BRANCH OVERVIEW (!selectedBranch)               */}
        {/* ─────────────────────────────────────────────────────── */}
        {!selectedBranch && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            {/* ── Summary Stats ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Total Requests', value: summaryStats.total,                                       cls: 'text-slate-900',      icon: FileText,   bg: 'bg-slate-900/[0.04] border-slate-900/5' },
                { label: 'Pending',        value: summaryStats.pending,                                     cls: 'text-amber-600',  icon: Clock,      bg: 'bg-amber-500/5 border-amber-500/10' },
                { label: 'Paid',           value: summaryStats.paid,                                        cls: 'text-emerald-600',icon: BadgeCheck, bg: 'bg-emerald-500/5 border-emerald-500/10' },
                { label: 'Total Amount',   value: `${summaryStats.amount.toLocaleString()} BDT`,            cls: 'text-[#15803d]',  icon: Banknote,   bg: 'bg-[#1ca34c]/5 border-[#1ca34c]/10' },
              ].map(item => (
                <div key={item.label} className={`p-4 rounded-2xl border flex items-center gap-3 ${item.bg}`}>
                  <div className="w-9 h-9 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 flex items-center justify-center flex-shrink-0">
                    <item.icon className={`w-4 h-4 ${item.cls}`} />
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">{item.label}</p>
                    <p className={`text-sm font-extrabold ${item.cls}`}>{item.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Branch Cards List ── */}
            <div className="rounded-2xl border border-slate-900/[0.08] overflow-hidden bg-slate-900/[0.05]">
              {/* List Header */}
              <div className="hidden md:flex items-center px-5 py-3 border-b border-slate-900/[0.08] bg-slate-900/[0.04]">
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 flex-1">Branch</span>
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 w-32 text-right">Requested</span>
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 w-28 text-right">Paid</span>
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 w-28 text-right">Pending</span>
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 w-24 text-right">Records</span>
                <span className="w-8"></span>
              </div>

              {/* Specific Branch Rows */}
              {displayBranches.length === 0 ? (
                <div className="py-16 text-center text-slate-500 text-sm">No branches found.</div>
              ) : (
                displayBranches.map((b, idx) => {
                  const st = branchStats[b.id] || { totalAmount: 0, paidAmount: 0, dueAmount: 0, pendingCount: 0, count: 0 }
                  const paidPct = st.totalAmount > 0 ? Math.round((st.paidAmount / st.totalAmount) * 100) : 0
                  const isHq = isHeadOffice(b.name)
                  return (
                    <motion.button
                      key={b.id}
                      whileHover={{ backgroundColor: isHq ? 'rgba(28,163,76,0.08)' : b.id === 'general' ? 'rgba(28,163,76,0.06)' : 'rgba(28,163,76,0.03)' }}
                      whileTap={{ scale: 0.995 }}
                      onClick={() => { goToBranch(b); setSearch(''); }}
                      className={`w-full flex items-center px-5 py-4 cursor-pointer group transition-all text-left ${
                        isHq
                          ? 'bg-gradient-to-r from-[#1ca34c]/15 via-[#1ca34c]/5 to-transparent border-b-2 border-[#1ca34c]/40 shadow-sm shadow-[#1ca34c]/5'
                          : b.id === 'general'
                          ? 'bg-[#1ca34c]/5 border border-[#1ca34c]/20 rounded-xl my-2'
                          : idx < displayBranches.length - 1 && b.id !== 'general'
                          ? 'border-b border-slate-900/[0.08]'
                          : ''
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          isHq
                            ? 'bg-gradient-to-br from-[#1ca34c]/30 to-[#1ca34c]/10 border border-[#1ca34c]/50 shadow-sm shadow-[#1ca34c]/20'
                            : b.id === 'general'
                            ? 'bg-[#1ca34c]/20 border border-[#1ca34c]/30'
                            : 'bg-[#1ca34c]/8 border border-slate-900/5'
                        }`}>
                          {isHq ? (
                            <Landmark className="w-4 h-4 text-[#15803d]" />
                          ) : b.id === 'general' ? (
                            <Building2 className="w-4 h-4 text-[#15803d]" />
                          ) : (
                            <MapPin className="w-3.5 h-3.5 text-[#15803d]" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold transition-colors truncate ${
                              isHq ? 'text-slate-500 group-hover:text-slate-900' : 'text-slate-900 group-hover:text-[#15803d]'
                            }`}>
                              {b.name}
                            </span>
                            {isHq && (
                              <span className="px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider rounded-full bg-[#1ca34c]/20 text-[#15803d] border border-[#1ca34c]/40 flex items-center gap-1 shadow-xs">
                                <ShieldCheck className="w-2.5 h-2.5" /> HQ / Main
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <div className="h-1 w-20 bg-slate-900/[0.04] rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${paidPct}%` }} />
                            </div>
                            <span className="text-[10px] text-slate-600">{paidPct}% processed</span>
                          </div>
                        </div>
                      </div>
                      <div className="hidden md:block w-32 text-right text-sm font-bold text-slate-900">{st.totalAmount > 0 ? `৳${st.totalAmount.toLocaleString()}` : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="hidden md:block w-28 text-right text-sm font-semibold text-emerald-600">{st.paidAmount > 0 ? `৳${st.paidAmount.toLocaleString()}` : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="hidden md:block w-28 text-right text-sm font-semibold">{st.pendingCount > 0 ? <span className="text-amber-600">{st.pendingCount} pending</span> : <span className="text-slate-600 text-xs">0 pending</span>}</div>
                      <div className="hidden md:block w-24 text-right text-[11px] text-slate-500">{st.count} records</div>
                      <div className="w-8 flex justify-end">
                        <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-[#15803d] transition-colors" />
                      </div>
                    </motion.button>
                  )
                })
              )}
            </div>
          </motion.div>
        )}

        {/* ─────────────────────────────────────────────────────── */}
        {/* VIEW B: BRANCH DETAIL (selectedBranch)                  */}
        {/* ─────────────────────────────────────────────────────── */}
        {selectedBranch && (
          <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
            {/* Back + Header */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-900/5">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { goToBranch(null); setSearch(''); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 hover:border-[#1ca34c]/30 transition-all text-xs font-semibold cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to Branches
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    {selectedBranch.id === 'all'
                      ? <Globe className="w-4 h-4 text-[#15803d]" />
                      : selectedBranch.id === 'general'
                        ? <Building2 className="w-4 h-4 text-slate-500" />
                        : <MapPin className="w-4 h-4 text-[#15803d]" />
                    }
                    <h2 className="text-lg font-bold font-serif text-slate-900">{selectedBranch.name}</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {summaryStats.total} expense requests &middot; {summaryStats.amount.toLocaleString()} BDT total requested
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Tabs */}
                <div className="flex gap-1 p-1 bg-slate-900/[0.04] border border-slate-900/5 rounded-xl">
                  {(['list', 'analytics'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => updateActiveTab(tab)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                        activeTab === tab ? 'bg-[#1ca34c] text-white shadow-lg shadow-[#1ca34c]/20' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      {tab === 'list' ? <FileText className="w-3 h-3" /> : <BarChart3 className="w-3 h-3" />}
                      {tab === 'list' ? 'Requests List' : 'Analytics'}
                    </button>
                  ))}
                </div>

                {/* Filter toggle */}
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${showFilters ? 'border-[#1ca34c]/40 bg-[#1ca34c]/10 text-[#15803d]' : 'border-slate-900/5 bg-slate-900/[0.04] text-slate-500 hover:border-slate-900/10'}`}
                >
                  <Filter className="w-3.5 h-3.5" /> Filters
                  {(search || statusFilter !== 'all' || dateFrom || dateTo) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#1ca34c]" />
                  )}
                </button>
              </div>
            </div>

            {/* Summary Stats specifically for this branch */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              {[
                { label: 'Total Requests', value: summaryStats.total,                                       cls: 'text-slate-900',      icon: FileText,   bg: 'bg-slate-900/[0.04] border-slate-900/5' },
                { label: 'Pending',        value: summaryStats.pending,                                     cls: 'text-amber-600',  icon: Clock,      bg: 'bg-amber-500/5 border-amber-500/10' },
                { label: 'Paid',           value: summaryStats.paid,                                        cls: 'text-emerald-600',icon: BadgeCheck, bg: 'bg-emerald-500/5 border-emerald-500/10' },
                { label: 'Total Amount',   value: `${summaryStats.amount.toLocaleString()} BDT`,            cls: 'text-[#15803d]',  icon: Banknote,   bg: 'bg-[#1ca34c]/5 border-[#1ca34c]/10' },
              ].map(item => (
                <div key={item.label} className={`p-4 rounded-2xl border flex items-center gap-3 ${item.bg}`}>
                  <div className="w-9 h-9 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 flex items-center justify-center flex-shrink-0">
                    <item.icon className={`w-4 h-4 ${item.cls}`} />
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">{item.label}</p>
                    <p className={`text-sm font-extrabold ${item.cls}`}>{item.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Filters Panel ── */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mb-5"
                >
                  <div className="glass-panel p-4 rounded-2xl">
                    <div className="flex flex-wrap gap-3 items-end">
                      {/* Search */}
                      <div className="relative flex-1 min-w-[180px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                        <input
                          type="text" placeholder="Search employee, title..."
                          value={search} onChange={e => setSearch(e.target.value)}
                          className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2 pl-9 pr-3 text-[11px] placeholder-slate-400 text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 transition-all"
                        />
                      </div>

                      {/* Status filter */}
                      <div className="relative min-w-[130px]">
                        <select
                          value={statusFilter} onChange={e => updateStatusFilter(e.target.value)}
                          className="w-full bg-white border border-slate-900/5 rounded-xl py-2 pl-3 pr-8 text-[11px] text-slate-500 focus:outline-none focus:border-[#1ca34c]/40 cursor-pointer appearance-none"
                        >
                          <option value="all">All Status</option>
                          <option value="pending">Pending</option>
                          <option value="approved">Approved</option>
                          <option value="paid">Paid</option>
                          <option value="rejected">Rejected</option>
                        </select>
                        <SlidersHorizontal className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
                      </div>

                      {/* Date range */}
                      <div>
                        <label className="block text-[9px] text-slate-600 uppercase tracking-wider mb-1">From</label>
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-white border border-slate-900/5 rounded-xl py-2 px-3 text-[11px] text-slate-500 focus:outline-none focus:border-[#1ca34c]/40 cursor-pointer" />
                      </div>
                      <div>
                        <label className="block text-[9px] text-slate-600 uppercase tracking-wider mb-1">To</label>
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-white border border-slate-900/5 rounded-xl py-2 px-3 text-[11px] text-slate-500 focus:outline-none focus:border-[#1ca34c]/40 cursor-pointer" />
                      </div>
                      <button onClick={setLast30Days} className="px-3 py-2 rounded-xl border border-slate-900/5 bg-slate-900/[0.04] text-[10px] text-slate-500 hover:border-[#1ca34c]/20 hover:text-slate-900 transition-all font-semibold flex items-center gap-1">
                        <CalendarRange className="w-3 h-3" /> Last 30 Days
                      </button>

                      {/* Clear */}
                      {(search || statusFilter !== 'all' || dateFrom || dateTo) && (
                        <button
                          onClick={() => { setSearch(''); updateStatusFilter('all'); setDateFrom(''); setDateTo('') }}
                          className="px-3 py-2 rounded-xl border border-slate-900/5 bg-slate-900/[0.04] text-[10px] text-rose-600 hover:border-rose-500/20 transition-all font-semibold flex items-center gap-1"
                        >
                          <X className="w-3 h-3" /> Clear
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ════════════════════════════════════
                ANALYTICS TAB
            ════════════════════════════════════ */}
            {activeTab === 'analytics' && (
              <div className="glass-panel rounded-2xl p-5 mb-6">
                <h3 className="text-sm font-bold text-slate-900 font-serif mb-5 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#15803d]" /> Monthly Expense Trend
                  <span className="text-[10px] text-slate-500 font-sans font-normal">— {branchLabel}</span>
                </h3>
                {analyticsData.length === 0 ? (
                  <div className="py-16 text-center text-slate-600 text-sm">No data yet.</div>
                ) : (
                  <div className="space-y-3">
                    {analyticsData.map(d => (
                      <div key={d.month} className="flex items-center gap-3">
                        <span className="text-[10px] text-slate-500 w-14 flex-shrink-0">{d.month}</span>
                        <div className="flex-1 bg-slate-900/[0.04] rounded-full h-5 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }} animate={{ width: `${(d.amount / maxAnalytics) * 100}%` }}
                            transition={{ duration: 0.6, ease: 'easeOut' }}
                            className="h-full bg-[#1ca34c] rounded-full"
                          />
                        </div>
                        <span className="text-[10px] text-slate-600 w-28 text-right flex-shrink-0 font-mono">{d.amount.toLocaleString()} BDT</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ════════════════════════════════════
                LIST TAB
            ════════════════════════════════════ */}
            {activeTab === 'list' && (
              <div className="glass-panel rounded-2xl overflow-hidden">
                {/* Table header */}
                <div className="hidden md:grid grid-cols-[2fr_1.2fr_1.2fr_1fr_1fr_auto] gap-3 px-5 py-3 border-b border-slate-900/5 bg-slate-900/[0.04]">
                  {['Request', 'Employee · Branch', 'Total / Paid / Due', 'Method', 'Status', 'Actions'].map(h => (
                    <span key={h} className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">{h}</span>
                  ))}
                </div>

                {filteredRequests.length === 0 ? (
                  <div className="py-20 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-slate-900/[0.04] border border-slate-900/5 flex items-center justify-center mx-auto mb-4">
                      <Receipt className="w-7 h-7 text-slate-500" />
                    </div>
                    <p className="text-slate-500 text-sm">No requests found</p>
                    <p className="text-slate-500 text-xs mt-1">Try adjusting your filters.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-900/[0.08]">
                    <AnimatePresence>
                      {filteredRequests.map((req, idx) => {
                        const sc = STATUS_CONFIG[req.status]
                        const isChecked = selectedIds.includes(req.id)
                        return (
                          <motion.div
                            key={req.id}
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                            className={`px-5 py-4 transition-colors group flex flex-col md:flex-row md:items-center gap-4 ${isSelectMode && isChecked ? 'bg-[#1ca34c]/10' : 'hover:bg-slate-900/[0.04]'} ${isSelectMode ? 'cursor-pointer' : ''}`}
                            onClick={() => {
                              if (isSelectMode) {
                                if (isChecked) setSelectedIds(selectedIds.filter(id => id !== req.id))
                                else setSelectedIds([...selectedIds, req.id])
                              }
                            }}
                          >
                            {/* Checkbox Column */}
                            {isSelectMode && (
                              <div className="relative flex items-center justify-center shrink-0 w-4 h-4 transition-all hover:scale-110 mr-1 md:mr-3">
                                <input type="checkbox" checked={isChecked} onChange={(e) => {}} className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                                <div className="w-full h-full rounded-[4px] border border-slate-900/20 bg-white peer-checked:bg-[#1ca34c] peer-checked:border-[#1ca34c] flex items-center justify-center transition-all duration-200 shadow-inner">
                                  <Check className="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" strokeWidth={3} />
                                </div>
                              </div>
                            )}
                            <div className="flex-1 min-w-0 w-full">
                            {/* Mobile layout */}
                            <div className="md:hidden flex flex-col gap-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-slate-900 truncate">{req.title}</p>
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <span className="text-[10px] text-slate-500">{req.employee_name || '—'}</span>
                                    {req.branch_name && (
                                      <>
                                        <span className="text-slate-500">·</span>
                                        <span className="text-[10px] text-[#15803d] flex items-center gap-0.5">
                                          <Building2 className="w-2.5 h-2.5" />{req.branch_name}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider flex-shrink-0 flex items-center gap-1 ${sc.cls}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />{sc.label}
                                </span>
                              </div>
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <div>
                                  <p className="text-sm font-bold text-slate-900">{Number(req.amount).toLocaleString()} BDT</p>
                                  <div className="flex items-center gap-2 text-[10px] font-mono mt-0.5">
                                    <span className="text-emerald-600">Paid: ৳{Number(req.paid_amount !== undefined && req.paid_amount !== null ? req.paid_amount : (req.status === 'paid' ? req.amount : 0)).toLocaleString()}</span>
                                    <span className="text-slate-600">·</span>
                                    <span className={Number(req.due_amount !== undefined && req.due_amount !== null ? req.due_amount : (req.status === 'paid' ? 0 : req.amount)) > 0 ? 'text-rose-600 font-semibold' : 'text-slate-500'}>
                                      Due: ৳{Number(req.due_amount !== undefined && req.due_amount !== null ? req.due_amount : (req.status === 'paid' ? 0 : req.amount)).toLocaleString()}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-slate-500 mt-1">{req.account_holder_name === 'Admin Direct' ? 'Admin Direct' : (req.payment_method === 'bkash' ? 'bKash' : 'Bank')} · {new Date(req.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                                </div>
                                <ActionButtons req={req} openAction={openAction} onDelete={handleDelete} onEdit={openEditModal} />
                              </div>
                            </div>

                            {/* Desktop layout */}
                            <div className="hidden md:grid grid-cols-[2fr_1.2fr_1.2fr_1fr_1fr_auto] gap-3 items-center">
                              {/* Request */}
                              <div className="min-w-0 pr-2">
                                <div className="flex items-center gap-2">
                                  {req.is_purchased && (
                                    <span className="text-[9px] bg-purple-500/10 text-purple-600 border border-purple-500/20 px-1.5 py-0.2 rounded font-bold uppercase flex items-center gap-0.5">
                                      <ShoppingCart className="w-2.5 h-2.5" /> Purchased
                                    </span>
                                  )}
                                  <p className="text-sm font-semibold text-slate-900 truncate">{req.title}</p>
                                </div>
                                {req.description && <p className="text-[11px] text-slate-500 truncate mt-0.5">{req.description}</p>}
                              </div>

                              {/* Employee & Branch */}
                              <div className="min-w-0 pr-2">
                                <p className="text-xs text-slate-600 truncate">{req.employee_name || '—'}</p>
                                <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5 truncate">
                                  <Building2 className="w-2.5 h-2.5 flex-shrink-0 text-[#15803d]" />{req.branch_name || 'Head Office'}
                                </p>
                              </div>

                              {/* Total / Paid / Due */}
                              <div>
                                <p className="text-sm font-bold text-slate-900 font-mono">{Number(req.amount).toLocaleString()} <span className="text-[9px] text-slate-600 font-sans">BDT</span></p>
                                <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono">
                                  <span className="text-emerald-600 font-medium">P: ৳{Number(req.paid_amount !== undefined && req.paid_amount !== null ? req.paid_amount : (req.status === 'paid' ? req.amount : 0)).toLocaleString()}</span>
                                  <span className="text-slate-600">|</span>
                                  <span className={`font-semibold ${Number(req.due_amount !== undefined && req.due_amount !== null ? req.due_amount : (req.status === 'paid' ? 0 : req.amount)) > 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                                    D: ৳{Number(req.due_amount !== undefined && req.due_amount !== null ? req.due_amount : (req.status === 'paid' ? 0 : req.amount)).toLocaleString()}
                                  </span>
                                </div>
                              </div>

                              {/* Method */}
                              <div>
                                <p className="text-xs text-slate-500">{req.account_holder_name === 'Admin Direct' ? 'Admin Direct' : (req.payment_method === 'bkash' ? 'bKash' : 'Bank Transfer')}</p>
                                {req.trx_id && <p className="text-[9px] font-mono text-emerald-500 truncate max-w-[100px]">{req.trx_id}</p>}
                              </div>

                              {/* Status */}
                              <span className={`text-[9px] px-2.5 py-1 rounded-full border font-bold uppercase tracking-wider inline-flex items-center gap-1.5 w-fit ${sc.cls}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />{sc.label}
                              </span>

                              {/* Actions */}
                              <ActionButtons req={req} openAction={openAction} onDelete={handleDelete} onEdit={openEditModal} />
                            </div>
                          </div>
                          </motion.div>
                        )
                      })}
                    </AnimatePresence>
                  </div>
                )}

                {/* Footer count */}
                {filteredRequests.length > 0 && (
                  <div className="px-5 py-3 border-t border-slate-900/5 flex items-center justify-between">
                    <span className="text-[10px] text-slate-600">{filteredRequests.length} record{filteredRequests.length !== 1 ? 's' : ''}</span>
                    <span className="text-[10px] text-slate-600 font-mono">
                      Total: <span className="text-slate-900 font-bold">{filteredRequests.reduce((s, r) => s + Number(r.amount), 0).toLocaleString()} BDT</span>
                    </span>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* ════════════════════════════════════
          ACTION MODAL
      ════════════════════════════════════ */}
      <AnimatePresence>
        {actionRequest && actionType && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-md flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) { setActionRequest(null); setActionType(null) } }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-md bg-white border border-slate-900/10 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              {/* Header */}
              <div className={`p-5 border-b border-slate-900/5 flex items-center justify-between ${
                actionType === 'pay' ? 'bg-emerald-500/5' : actionType === 'confirm' ? 'bg-blue-500/5' : actionType === 'reject' ? 'bg-rose-500/5' : ''
              }`}>
                <div>
                  <h3 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
                    {actionType === 'view' && <Eye className="w-4 h-4 text-slate-500" />}
                    {actionType === 'confirm' && <Check className="w-4 h-4 text-blue-600" />}
                    {actionType === 'reject' && <X className="w-4 h-4 text-rose-600" />}
                    {actionType === 'pay' && <Banknote className="w-4 h-4 text-emerald-600" />}
                    {actionType === 'view' ? 'Request Details' : actionType === 'confirm' ? 'Approve Request' : actionType === 'reject' ? 'Reject Request' : 'Record Payment'}
                  </h3>
                  <p className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[300px]">{actionRequest.title}</p>
                </div>
                <button onClick={() => { setActionRequest(null); setActionType(null) }} className="p-3 rounded-xl hover:bg-slate-900/[0.04] text-slate-500 hover:text-slate-900 transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Amount */}
                <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Amount</p>
                  <p className="text-2xl font-bold text-slate-900">{Number(actionRequest.amount).toLocaleString()} BDT</p>
                  <p className="text-[10px] text-slate-600 mt-1">
                    By {actionRequest.employee_name} · <span className="text-[#15803d]">{actionRequest.branch_name}</span>
                  </p>
                </div>

                {actionRequest.description && (
                  <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Description</p>
                    <p className="text-xs text-slate-600">{actionRequest.description}</p>
                  </div>
                )}

                {/* Payment info */}
                {(actionType === 'pay' || actionType === 'view') && actionRequest.account_holder_name !== 'Admin Direct' && (
                  <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 space-y-2">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-2 flex items-center gap-1">
                      <CreditCard className="w-3 h-3" /> Payment Account
                    </p>
                    {[
                      ['Method', actionRequest.payment_method === 'bkash' ? 'bKash / Mobile' : 'Bank Transfer'],
                      ['Account Name', actionRequest.account_holder_name || '—'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-[10px] text-slate-500">{k}</span>
                        <span className="text-[10px] text-slate-900 font-semibold">{v}</span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-slate-500">Number</span>
                      <span className="text-sm text-[#15803d] font-mono font-bold">{actionRequest.account_number || '—'}</span>
                    </div>
                    {actionRequest.bank_name && (
                      <div className="flex justify-between">
                        <span className="text-[10px] text-slate-500">Bank</span>
                        <span className="text-[10px] text-slate-900">{actionRequest.bank_name}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Invoice */}
                {actionRequest.invoice_url && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!actionRequest.invoice_url) return;
                      // Uploads store the direct file URL; legacy
                      // bare storage paths cannot be opened.
                      if (actionRequest.invoice_url.startsWith('http') || actionRequest.invoice_url.startsWith('/')) {
                        window.open(actionRequest.invoice_url, '_blank');
                        return;
                      }
                      alert('Failed to load invoice image.');
                    }}
                    className="flex items-center gap-2 p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 transition-colors group w-full text-left"
                  >
                    <Eye className="w-4 h-4 text-slate-500 group-hover:text-[#15803d]" />
                    <span className="text-xs text-slate-500 group-hover:text-slate-900">View Invoice</span>
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#1ca34c]/10 border border-[#1ca34c]/20 text-[#15803d] ml-auto">
                      {actionRequest.is_purchased ? 'Purchased' : 'Pre-approval'}
                    </span>
                  </button>
                )}

                {/* TRX input */}
                {actionType === 'pay' && (
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Transaction ID <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text" placeholder="Enter TRX ID after sending payment"
                      value={trxInput} onChange={e => setTrxInput(e.target.value)}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/40 transition-all font-mono"
                    />
                  </div>
                )}

                {/* Admin notes */}
                {(actionType === 'confirm' || actionType === 'reject' || actionType === 'pay') && (
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Admin Notes {actionType === 'reject' && <span className="text-rose-600">*</span>}
                    </label>
                    <textarea
                      placeholder={actionType === 'reject' ? 'Reason for rejection (required)...' : 'Optional notes...'}
                      value={adminNote} onChange={e => setAdminNote(e.target.value)} rows={2}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all resize-none"
                    />
                  </div>
                )}

                {/* Existing TRX for view */}
                {actionType === 'view' && actionRequest.trx_id && (
                  <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                    <p className="text-[10px] text-emerald-600 uppercase tracking-wider font-bold mb-1">Transaction ID</p>
                    <p className="text-xs font-mono text-emerald-300">{actionRequest.trx_id}</p>
                    {actionRequest.paid_at && <p className="text-[10px] text-emerald-600 mt-1">Paid: {new Date(actionRequest.paid_at).toLocaleString()}</p>}
                  </div>
                )}
                {actionType === 'view' && actionRequest.admin_notes && (
                  <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Admin Notes</p>
                    <p className="text-xs text-slate-600">{actionRequest.admin_notes}</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-5 border-t border-slate-900/5 flex gap-3">
                <button
                  onClick={() => { setActionRequest(null); setActionType(null) }}
                  className="flex-1 px-4 py-2.5 border border-slate-900/10 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-900 hover:border-slate-900/20 transition-all"
                >
                  Close
                </button>
                {actionType === 'view' && (
                  <button
                    onClick={() => {
                      const req = actionRequest
                      setActionRequest(null)
                      setActionType(null)
                      openEditModal(req)
                    }}
                    className="flex-1 px-4 py-2.5 bg-[#1ca34c]/10 hover:bg-[#1ca34c]/20 border border-[#1ca34c]/30 rounded-xl text-xs font-semibold text-[#15803d] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Edit Request
                  </button>
                )}
                {actionType !== 'view' && (
                  <button
                    onClick={handleAction} disabled={isActioning}
                    className={`flex-1 font-bold px-4 py-2.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-60 ${
                      actionType === 'pay'     ? 'bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-lg shadow-emerald-500/10' :
                      actionType === 'confirm' ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/10' :
                                                 'bg-gradient-to-r from-rose-600 to-rose-700 text-white shadow-lg shadow-rose-500/10'
                    }`}
                  >
                    {isActioning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (
                      actionType === 'pay'     ? <><Banknote className="w-3.5 h-3.5" />Record Payment</> :
                      actionType === 'confirm' ? <><Check className="w-3.5 h-3.5" />Approve</> :
                                                 <><X className="w-3.5 h-3.5" />Reject</>
                    )}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════════════════════════════
          NEW REQUEST MODAL
      ════════════════════════════════════ */}
      <AnimatePresence>
        {showNewModal && selectedBranch && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-md flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowNewModal(false) }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-lg bg-white border border-slate-900/10 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-900/5 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
                    <Plus className="w-4 h-4 text-[#15803d]" /> New Expense Request
                  </h2>
                  <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> Branch: {selectedBranch.name}
                  </p>
                </div>
                <button onClick={() => setShowNewModal(false)} className="p-3 rounded-xl hover:bg-slate-900/[0.04] text-slate-500 hover:text-slate-900 transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto custom-scrollbar p-5 space-y-4">
                <form id="new-expense-form" onSubmit={handleNewSubmit} className="space-y-4">
                  {/* Title */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Expense Title <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text" placeholder="e.g., Office Fan, Light Bulbs"
                      value={formTitle} onChange={e => setFormTitle(e.target.value)}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Description / Details
                    </label>
                    <textarea
                      placeholder="Describe why this expense is needed..."
                      value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={2}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all resize-none"
                    />
                  </div>

                  {/* Amounts with Auto-Calculation */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                        Total Amount (BDT) <span className="text-rose-600">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 font-bold">৳</span>
                        <input
                          type="number" placeholder="0.00" value={formAmount} min="1" step="0.01"
                          onChange={e => handleFormTotalChange(e.target.value)}
                          className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl pl-8 pr-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                        Paid Amount (BDT)
                      </label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 font-bold">৳</span>
                        <input
                          type="number" placeholder="0.00" value={formPaidAmount} min="0" step="0.01"
                          onChange={e => handleFormPaidChange(e.target.value)}
                          className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl pl-8 pr-4 py-2.5 text-xs text-emerald-600 placeholder-slate-400 focus:outline-none focus:border-emerald-500/40 transition-all font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                        Due Amount (BDT)
                      </label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 font-bold">৳</span>
                        <input
                          type="number" placeholder="0.00" value={formDueAmount} min="0" step="0.01"
                          onChange={e => handleFormDueChange(e.target.value)}
                          className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl pl-8 pr-4 py-2.5 text-xs text-rose-600 placeholder-slate-400 focus:outline-none focus:border-rose-500/40 transition-all font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* (Invoice & Payment Info removed for Admin direct entries) */}
                </form>
              </div>

              {/* Modal Footer */}
              <div className="p-5 border-t border-slate-900/5 flex gap-3">
                <button type="button" onClick={() => setShowNewModal(false)} className="flex-1 px-4 py-2.5 border border-slate-900/10 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-900 hover:border-slate-900/20 transition-all">
                  Cancel
                </button>
                <button
                  type="submit" form="new-expense-form" disabled={isSubmittingNew}
                  className="flex-1 bg-[#1ca34c] hover:bg-[#15803d] text-white font-bold px-4 py-2.5 rounded-full text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-[#1ca34c]/10 active:scale-95 transition-transform disabled:opacity-60"
                >
                  {isSubmittingNew ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" />Submitting...</>
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
          EDIT REQUEST MODAL
      ════════════════════════════════════ */}
      <AnimatePresence>
        {showEditModal && editingRequest && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-md flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowEditModal(false) }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-lg bg-white border border-slate-900/10 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-900/5 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
                    <Edit3 className="w-4 h-4 text-[#15803d]" /> Edit Expense Request
                  </h2>
                  <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> Branch: {editingRequest.branch_name || 'Branch'}
                  </p>
                </div>
                <button onClick={() => setShowEditModal(false)} className="p-3 rounded-xl hover:bg-slate-900/[0.04] text-slate-500 hover:text-slate-900 transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto custom-scrollbar p-5 space-y-4">
                {editFeedback && (
                  <div className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                    editFeedback.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' : 'bg-rose-500/10 border-rose-500/20 text-rose-600'
                  }`}>
                    {editFeedback.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                    <span>{editFeedback.message}</span>
                  </div>
                )}
                <form id="edit-expense-form" onSubmit={handleEditSubmit} className="space-y-4">
                  {/* Title */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Expense Title <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text" placeholder="e.g., Office Fan, Light Bulbs"
                      value={editTitle} onChange={e => setEditTitle(e.target.value)}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all"
                      required
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Description / Details
                    </label>
                    <textarea
                      placeholder="Details of the expense..."
                      value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={2}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all resize-none"
                    />
                  </div>

                  {/* Amounts with Auto-Calculation */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                        Total Amount (BDT) <span className="text-rose-600">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 font-bold">৳</span>
                        <input
                          type="number" placeholder="0.00" value={editAmount} min="1" step="0.01"
                          onChange={e => handleEditTotalChange(e.target.value)}
                          className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl pl-7 pr-3 py-2.5 text-xs text-slate-900 font-mono placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                        Paid Amount (BDT)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 font-bold">৳</span>
                        <input
                          type="number" placeholder="0.00" value={editPaidAmount} min="0" step="0.01"
                          onChange={e => handleEditPaidChange(e.target.value)}
                          className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl pl-7 pr-3 py-2.5 text-xs text-emerald-600 font-mono placeholder-slate-400 focus:outline-none focus:border-emerald-500/40 transition-all"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                        Due Amount (BDT)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 font-bold">৳</span>
                        <input
                          type="number" placeholder="0.00" value={editDueAmount} min="0" step="0.01"
                          onChange={e => handleEditDueChange(e.target.value)}
                          className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl pl-7 pr-3 py-2.5 text-xs text-rose-600 font-mono placeholder-slate-400 focus:outline-none focus:border-rose-500/40 transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Status & TRX */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                        Status
                      </label>
                      <select
                        value={editStatus}
                        onChange={e => setEditStatus(e.target.value as any)}
                        className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 transition-all"
                      >
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="paid">Paid</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                        TRX ID / Reference
                      </label>
                      <input
                        type="text" placeholder="e.g. TRX123456"
                        value={editTrxId} onChange={e => setEditTrxId(e.target.value)}
                        className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 font-mono placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all"
                      />
                    </div>
                  </div>

                  {/* Admin Notes */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Admin Notes
                    </label>
                    <textarea
                      placeholder="Internal remarks or approval notes..."
                      value={editAdminNotes} onChange={e => setEditAdminNotes(e.target.value)} rows={2}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all resize-none"
                    />
                  </div>
                </form>
              </div>

              {/* Modal Footer */}
              <div className="p-5 border-t border-slate-900/5 flex gap-3">
                <button type="button" onClick={() => setShowEditModal(false)} className="flex-1 px-4 py-2.5 border border-slate-900/10 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-900 hover:border-slate-900/20 transition-all">
                  Cancel
                </button>
                <button
                  type="submit" form="edit-expense-form" disabled={isSubmittingEdit}
                  className="flex-1 bg-[#1ca34c] hover:bg-[#15803d] text-white font-bold px-4 py-2.5 rounded-full text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-[#1ca34c]/10 active:scale-95 transition-transform disabled:opacity-60"
                >
                  {isSubmittingEdit ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving...</>
                  ) : (
                    <><Check className="w-3.5 h-3.5" />Update Expense</>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Reusable action button group ─────────────────────────────────────────────
function ActionButtons({
  req, openAction, onDelete, onEdit
}: {
  req: ExpenseRequest
  openAction: (r: ExpenseRequest, t: 'confirm' | 'reject' | 'pay' | 'view') => void
  onDelete: (id: string, title: string) => void
  onEdit?: (r: ExpenseRequest) => void
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button onClick={() => openAction(req, 'view')} title="View details"
        className="p-2.5 min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg bg-slate-900/[0.04] border border-slate-900/5 hover:border-slate-900/10 text-slate-500 hover:text-slate-900 transition-all cursor-pointer">
        <Eye className="w-3.5 h-3.5" />
      </button>
      {onEdit && (
        <button onClick={() => onEdit(req)} title="Edit Request"
          className="p-2.5 min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/30 text-slate-500 hover:text-[#15803d] transition-all cursor-pointer">
          <Edit3 className="w-3.5 h-3.5" />
        </button>
      )}
      {req.status === 'pending' && (
        <>
          <button onClick={() => openAction(req, 'confirm')} title="Approve"
            className="p-2.5 min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-600 hover:bg-blue-500/20 transition-all cursor-pointer">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => openAction(req, 'reject')} title="Reject"
            className="p-2.5 min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 hover:bg-rose-500/20 transition-all cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </>
      )}
      {req.status === 'approved' && (
        <button onClick={() => openAction(req, 'pay')} title="Record Payment"
          className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20 transition-all text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer">
          <Banknote className="w-3 h-3" /> Pay
        </button>
      )}
      <button onClick={() => onDelete(req.id, req.title)} title="Delete Request"
        className="p-2.5 min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 hover:bg-rose-500/20 transition-all cursor-pointer">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
