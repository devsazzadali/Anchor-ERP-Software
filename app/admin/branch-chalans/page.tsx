'use client'

export const dynamic = 'force-dynamic'

/* eslint-disable react/no-unescaped-entities */
/* eslint-disable @next/next/no-img-element */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Building2, Package, MapPin, ChevronRight, ArrowLeft, Plus, Trash2,
  RefreshCw, Download, Loader2, Check, X, Banknote,
  AlertTriangle, Search, Hash, ClipboardList, Pencil, Eye
} from 'lucide-react'
import { generatePdf } from '@/lib/pdf-generator'
import { getCachedData, setCachedData, invalidateBranchCache } from '@/lib/branch-cache'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type Branch = { id: string; name: string }

type ChalanItem = {
  code?: string
  name: string
  quantity: number
  cost_price: number
  sale_price: number
  shipping_cost?: number | null
  total_shipping?: number
  total_cost: number
  total_sale: number
}

type ProductChalan = {
  id: string
  branch_id: string | null
  branch_name: string
  chalan_ref: string | null
  items: ChalanItem[]
  total_amount: number
  total_cost: number
  notes: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminBranchChalansPage() {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const [branches, setBranches]         = useState<Branch[]>(() => getCachedData('admin_branches') || [])
  const [chalans, setChalans]           = useState<ProductChalan[]>(() => getCachedData('admin_chalans_all') || [])
  const [isLoading, setIsLoading]       = useState(() => !getCachedData('admin_chalans_all'))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [adminName, setAdminName]       = useState('Admin')
  const [adminId, setAdminId]           = useState('')
  const [branchesLoaded, setBranchesLoaded] = useState(() => !!getCachedData('admin_branches'))
  const [monthFilter, setMonthFilter]   = useState<string>(() => new Date().toISOString().slice(0, 7))

  // URL-driven selected branch
  const branchParam    = searchParams?.get('branch') ?? null
  const selectedBranch = useMemo<Branch | null>(() => {
    if (!branchParam || !branchesLoaded) return null
    return branches.find(b => b.id === branchParam) ?? null
  }, [branchParam, branches, branchesLoaded])

  const [search, setSearch] = useState('')
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // New Chalan modal
  const [showNewModal, setShowNewModal]     = useState(false)
  const [isSubmitting, setIsSubmitting]     = useState(false)
  const [formNotes, setFormNotes]           = useState('')
  const [formItems, setFormItems]           = useState<{ code: string; name: string; quantity: string; cost_price: string; sale_price: string; shipping_cost: string }[]>([
    { code: '', name: '', quantity: '', cost_price: '', sale_price: '', shipping_cost: '' },
  ])

  // Delete confirm
  const [deletingId, setDeletingId]         = useState<string | null>(null)
  const [isDeleting, setIsDeleting]         = useState(false)

  // View chalan detail
  const [viewingChalan, setViewingChalan]   = useState<ProductChalan | null>(null)

  // Edit chalan
  const [editingChalan, setEditingChalan]   = useState<ProductChalan | null>(null)
  const [showEditModal, setShowEditModal]   = useState(false)
  const [isEditing, setIsEditing]           = useState(false)
  const [editNotes, setEditNotes]           = useState('')
  const [editItems, setEditItems]           = useState<{ code: string; name: string; quantity: string; cost_price: string; sale_price: string; shipping_cost: string }[]>([])

  // ─── Auth ─────────────────────────────────────────────────────────────────
  // identity via /api/auth/me.
  useEffect(() => {
    const init = async () => {
      const res = await fetch('/api/auth/me').catch(() => null)
      const data = res ? await res.json().catch(() => null) : null
      const user = data?.user
      if (user) {
        setAdminId(user.id)
        setAdminName(data.profile?.full_name || 'Admin')
      }
    }
    init()
  }, [])

  // ─── Navigation helpers ───────────────────────────────────────────────────
  const goToBranch = (branch: Branch | null) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    if (branch) { params.set('branch', branch.id) } else { params.delete('branch') }
    router.push(pathname + '?' + params.toString())
  }

  // ─── Fetch ────────────────────────────────────────────────────────────────
  // branches + chalans come from the admin-gated API routes.
  const fetchBranches = useCallback(async () => {
    const res = await fetch('/api/admin/branches').catch(() => null)
    const payload = res ? await res.json().catch(() => null) : null
    const data = payload?.branches
    if (data) {
      setBranches(data)
      setBranchesLoaded(true)
      setCachedData('admin_branches', data, 120000)
    }
  }, [])

  const fetchChalans = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/chalans')
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Failed to fetch chalans')
      const data = payload.chalans
      if (data) {
        setChalans(data)
        setCachedData('admin_chalans_all', data, 45000)
      }
    } catch {
      // Keep the current list; the next focus/poll refetch retries.
    }
  }, [])

  const fetchAll = useCallback(async () => {
    if (!getCachedData('admin_chalans_all')) {
      setIsLoading(true)
    }
    await Promise.all([fetchBranches(), fetchChalans()])
    setIsLoading(false)
  }, [fetchBranches, fetchChalans])

  useEffect(() => {
    fetchAll()
    // realtime channel replaced with refetch on focus + 30s polling.
    const onFocus = () => fetchChalans()
    window.addEventListener('focus', onFocus)
    const interval = setInterval(fetchChalans, 30000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [fetchAll, fetchChalans])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchChalans()
    setIsRefreshing(false)
  }

  // Clear search when branch changes
  useEffect(() => { setSearch('') }, [branchParam])

  // ─── Computed ─────────────────────────────────────────────────────────────
  // Per-branch stats from all chalans
  const branchStats = useMemo(() => {
    const map: Record<string, { count: number; totalAmount: number }> = {}
    branches.forEach(b => { map[b.id] = { count: 0, totalAmount: 0 } })
    const filtered = monthFilter === 'all' ? chalans : chalans.filter(c => c.created_at.startsWith(monthFilter))
    filtered.forEach(c => {
      const key = c.branch_id ?? ''
      if (!map[key]) map[key] = { count: 0, totalAmount: 0 }
      map[key].count += 1
      map[key].totalAmount += Number(c.total_amount)
    })
    return map
  }, [branches, chalans, monthFilter])

  // Overall stats
  const overallStats = useMemo(() => {
    const filtered = monthFilter === 'all' ? chalans : chalans.filter(c => c.created_at.startsWith(monthFilter))
    return {
      totalChalans:  filtered.length,
      totalAmount:   filtered.reduce((s, c) => s + Number(c.total_amount), 0),
      totalItems:    filtered.reduce((s, c) => s + (c.items?.length ?? 0), 0),
    }
  }, [chalans, monthFilter])

  // Chalans for the selected branch, filtered by search
  const branchChalans = useMemo(() => {
    if (!selectedBranch) return []
    let base = chalans.filter(c => c.branch_id === selectedBranch.id)
    if (search) {
      const q = search.toLowerCase()
      base = base.filter(c =>
        (c.chalan_ref ?? '').toLowerCase().includes(q) ||
        (c.notes ?? '').toLowerCase().includes(q) ||
        c.items.some(i => i.name.toLowerCase().includes(q))
      )
    }
    return base
  }, [chalans, selectedBranch, search])

  // ─── Form helpers ─────────────────────────────────────────────────────────
  const addItemRow = () => setFormItems(prev => [...prev, { code: '', name: '', quantity: '', cost_price: '', sale_price: '', shipping_cost: '' }])
  const removeItemRow = (idx: number) => {
    if (formItems.length <= 1) return
    setFormItems(prev => prev.filter((_, i) => i !== idx))
  }
  const updateItem = (idx: number, field: 'code' | 'name' | 'quantity' | 'cost_price' | 'sale_price' | 'shipping_cost', val: string) => {
    setFormItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item))
  }

  const computedItems = useMemo((): ChalanItem[] =>
    formItems
      .filter(i => i.name.trim())
      .map(i => {
        const qty = parseFloat(i.quantity) || 0
        const cp  = parseFloat(i.cost_price) || 0
        const sp  = parseFloat(i.sale_price) || 0
        const shipRaw = (i.shipping_cost ?? '').toString().trim()
        const ship = shipRaw === '' ? null : (parseFloat(shipRaw) || 0)
        return { code: i.code?.trim() || undefined, name: i.name.trim(), quantity: qty, cost_price: cp, sale_price: sp, ...(ship !== null ? { shipping_cost: ship, total_shipping: qty * ship } : {}), total_cost: qty * cp, total_sale: qty * sp }
      }),
    [formItems]
  )

  const grandTotalCost = useMemo(() =>
    computedItems.reduce((s, i) => s + i.total_cost, 0),
    [computedItems]
  )

  const grandTotalShipping = useMemo(() =>
    computedItems.reduce((s, i) => s + (i.total_shipping ?? 0), 0),
    [computedItems]
  )

  const grandTotalSale = useMemo(() =>
    computedItems.reduce((s, i) => s + i.total_sale, 0),
    [computedItems]
  )

  const resetForm = () => {
    setFormItems([{ code: '', name: '', quantity: '', cost_price: '', sale_price: '', shipping_cost: '' }])
    setFormNotes('')
  }

  // ─── Generate chalan ref ───────────────────────────────────────────────────
  const genChalanRef = () => {
    const now = new Date()
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '')
    const rand = Math.floor(1000 + Math.random() * 9000)
    return `CHN-${datePart}-${rand}`
  }

  // ─── Open Edit Modal ──────────────────────────────────────────────────────
  const openEditModal = (chalan: ProductChalan) => {
    setEditingChalan(chalan)
    setEditNotes(chalan.notes ?? '')
    setEditItems(
      chalan.items.map(i => ({
        code: i.code ?? '',
        name: i.name,
        quantity: String(i.quantity),
        cost_price: String(i.cost_price),
        sale_price: String(i.sale_price),
        shipping_cost: String(i.shipping_cost ?? ''),
      }))
    )
    setShowEditModal(true)
  }

  const computedEditItems = useMemo((): ChalanItem[] =>
    editItems
      .filter(i => i.name.trim())
      .map(i => {
        const qty = parseFloat(i.quantity) || 0
        const cp  = parseFloat(i.cost_price) || 0
        const sp  = parseFloat(i.sale_price) || 0
        const shipRaw = (i.shipping_cost ?? '').toString().trim()
        const ship = shipRaw === '' ? null : (parseFloat(shipRaw) || 0)
        return { code: i.code?.trim() || undefined, name: i.name.trim(), quantity: qty, cost_price: cp, sale_price: sp, ...(ship !== null ? { shipping_cost: ship, total_shipping: qty * ship } : {}), total_cost: qty * cp, total_sale: qty * sp }
      }),
    [editItems]
  )

  const grandTotalEditCost = useMemo(() =>
    computedEditItems.reduce((s, i) => s + i.total_cost, 0),
    [computedEditItems]
  )

  const grandTotalEditShipping = useMemo(() =>
    computedEditItems.reduce((s, i) => s + (i.total_shipping ?? 0), 0),
    [computedEditItems]
  )

  const grandTotalEditSale = useMemo(() =>
    computedEditItems.reduce((s, i) => s + i.total_sale, 0),
    [computedEditItems]
  )

  const updateEditItem = (idx: number, field: 'code' | 'name' | 'quantity' | 'cost_price' | 'sale_price' | 'shipping_cost', val: string) => {
    setEditItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item))
  }
  const addEditItemRow = () => setEditItems(prev => [...prev, { code: '', name: '', quantity: '', cost_price: '', sale_price: '', shipping_cost: '' }])
  const removeEditItemRow = (idx: number) => {
    if (editItems.length <= 1) return
    setEditItems(prev => prev.filter((_, i) => i !== idx))
  }

  // ─── Submit edit ──────────────────────────────────────────────────────────
  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingChalan) return
    if (computedEditItems.length === 0) return setFeedback({ type: 'error', message: 'Add at least one product.' })
    const invalid = computedEditItems.find(i => i.quantity <= 0 || i.cost_price < 0 || i.sale_price < 0 || (i.shipping_cost != null && i.shipping_cost < 0))
    if (invalid) return setFeedback({ type: 'error', message: `"${invalid.name}" has invalid quantity or price.` })

    setIsEditing(true)
    setFeedback(null)

    // PATCH /api/admin/chalans (server recomputes the totals).
    const res = await fetch('/api/admin/chalans', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingChalan.id,
        items: computedEditItems,
        notes: editNotes.trim() || null,
      })
    }).catch(() => null)
    const payload = res ? await res.json().catch(() => ({})) : {}
    const error = !res || !res.ok ? { message: payload.error || 'Failed to update chalan' } : null

    if (error) {
      setFeedback({ type: 'error', message: error.message })
    } else {
      setShowEditModal(false)
      setEditingChalan(null)
      setFeedback({ type: 'success', message: '✓ Chalan updated successfully!' })
      await fetchChalans()
    }
    setIsEditing(false)
    setTimeout(() => setFeedback(null), 5000)
  }

  // ─── Submit new chalan ────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedBranch) return setFeedback({ type: 'error', message: 'No branch selected.' })
    if (computedItems.length === 0) return setFeedback({ type: 'error', message: 'Add at least one product.' })
    const invalid = computedItems.find(i => i.quantity <= 0 || i.cost_price < 0 || i.sale_price < 0 || (i.shipping_cost != null && i.shipping_cost < 0))
    if (invalid) return setFeedback({ type: 'error', message: `Product "${invalid.name}" has invalid quantity or price.` })

    setIsSubmitting(true)
    setFeedback(null)

    const payload = {
      branch_id:       selectedBranch.id,
      branch_name:     selectedBranch.name,
      chalan_ref:      genChalanRef(),
      items:           computedItems,
      total_amount:    grandTotalSale,
      total_cost:      grandTotalCost,
      notes:           formNotes.trim() || null,
      created_by:      adminId || null,
      created_by_name: adminName,
    }

    // POST /api/admin/chalans (server recomputes the totals
    // from the items; created_by is the session caller server-side).
    const res = await fetch('/api/admin/chalans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => null)
    const resPayload = res ? await res.json().catch(() => ({})) : {}
    const error = !res || !res.ok ? { message: resPayload.error || 'Failed to create chalan' } : null
    if (error) {
      setFeedback({ type: 'error', message: error.message })
    } else {
      resetForm()
      setShowNewModal(false)
      setFeedback({ type: 'success', message: '✓ Chalan created successfully!' })
      await fetchChalans()
    }
    setIsSubmitting(false)
    setTimeout(() => setFeedback(null), 5000)
  }

  // ─── Delete chalan ────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    setIsDeleting(true)
    const res = await fetch('/api/admin/chalans', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    }).catch(() => null)
    const payload = res ? await res.json().catch(() => ({})) : {}
    const error = !res || !res.ok ? { message: payload.error || 'Failed to delete chalan' } : null
    if (error) {
      setFeedback({ type: 'error', message: error.message })
    } else {
      setChalans(prev => prev.filter(c => c.id !== id))
      setFeedback({ type: 'success', message: '✓ Chalan deleted.' })
    }
    setDeletingId(null)
    setIsDeleting(false)
    setTimeout(() => setFeedback(null), 4000)
  }

  // ─── PDF Export ───────────────────────────────────────────────────────────
  const exportPdf = (chalan: ProductChalan) => {
    const rows: (string | number)[][] = chalan.items.map((item, idx) => [
      idx + 1,
      item.code ? `[${item.code}] ${item.name}` : item.name,
      item.quantity,
      `${Number(item.cost_price).toLocaleString('en-BD')} BDT`,
      `${Number(item.sale_price).toLocaleString('en-BD')} BDT`,
      item.shipping_cost === undefined || item.shipping_cost === null ? '—' : `${Number(item.shipping_cost).toLocaleString('en-BD')} BDT`,
      `${Number(item.total_cost).toLocaleString('en-BD')} BDT`,
      item.total_shipping === undefined || item.total_shipping === null ? '—' : `${Number(item.total_shipping).toLocaleString('en-BD')} BDT`,
      `${Number(item.total_sale).toLocaleString('en-BD')} BDT`,
    ])

    generatePdf(
      'Branch Product Dispatch Chalan',
      ['#', 'Code / Product Title', 'Qty', 'Buy Price', 'Sell Price', 'Shipping Cost', 'Total Cost', 'Total Shipping', 'Total Sale'],
      rows,
      {
        filename:    `${chalan.chalan_ref || 'Chalan'}.pdf`,
        branch:      chalan.branch_name,
        subtitle:    'Product Dispatch Chalan',
        preparedBy:  chalan.created_by_name || 'Admin',
        dateRange:   new Date(chalan.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        reportRef:   chalan.chalan_ref || chalan.id.slice(0, 8).toUpperCase(),
        summaryData: [
          { label: 'Total Line Items',   value: chalan.items.length.toString() },
          { label: 'Total Cost Value',   value: `${Number(chalan.total_cost).toLocaleString('en-BD')} BDT` },
          { label: 'Total Retail Value', value: `${Number(chalan.total_amount).toLocaleString('en-BD')} BDT` },
        ],
        notes: chalan.notes,
      }
    )
  }

  // ─── Loading screen ────────────────────────────────────────────────────────
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
      {/* Ambient glows */}
      <div className="absolute top-[-5%] right-[-5%] w-[40%] h-[40%] bg-[#1ca34c]/3 rounded-full filter blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-5%] left-[10%] w-[50%] h-[50%] bg-indigo-500/3 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="relative z-10 flex flex-col p-4 md:p-6 max-h-screen overflow-y-auto custom-scrollbar">

        {/* ── Page Header ── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-4 border-b border-slate-900/5">
          <div>
            <span className="text-[10px] bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider inline-flex items-center gap-1 mb-1">
              <Package className="w-3 h-3" /> Branch Dispatch
            </span>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900 font-serif flex items-center gap-3"><span className="w-1.5 h-8 rounded-full bg-[#1ca34c] shrink-0" />Branch Product Chalans</h1>
            <p className="text-[11px] text-slate-500 mt-0.5">Create, manage, and export product dispatch chalans for all branches.</p>
          </div>
          <div className="flex items-center gap-3">
            {!selectedBranch && (
              <select
                value={monthFilter}
                onChange={e => setMonthFilter(e.target.value)}
                className="bg-slate-900/[0.04] border border-slate-900/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 transition-all cursor-pointer"
              >
                <option value="all" className="bg-white text-slate-900">All Time</option>
                {Array.from(new Set(chalans.map(c => c.created_at.slice(0, 7)))).sort().reverse().map(m => (
                  <option key={m} value={m} className="bg-white text-slate-900">
                    {new Date(m + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={handleRefresh}
              className={`p-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}
            >
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

        {/* ═══════════════════════════════════════════════════════════════════
            VIEW A — BRANCH OVERVIEW (no branch selected)
        ═══════════════════════════════════════════════════════════════════ */}
        {!selectedBranch && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

            {/* Summary strip */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { label: 'Total Chalans',     value: overallStats.totalChalans,                               cls: 'text-slate-900',      icon: ClipboardList, bg: 'bg-slate-900/[0.04] border-slate-900/5' },
                { label: 'Total Line Items',  value: overallStats.totalItems,                                 cls: 'text-indigo-600', icon: Package,       bg: 'bg-indigo-500/5 border-indigo-500/10' },
                { label: 'Total Dispatched',  value: `৳ ${overallStats.totalAmount.toLocaleString('en-BD')}`, cls: 'text-[#15803d]',  icon: Banknote,      bg: 'bg-[#1ca34c]/5 border-[#1ca34c]/10' },
              ].map(item => (
                <div key={item.label} className={`p-4 rounded-3xl border flex items-center gap-3 ${item.bg}`}>
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
            <div className="rounded-3xl border border-slate-900/[0.08] overflow-hidden bg-slate-900/[0.05]">
              {/* List header */}
              <div className="hidden md:flex items-center px-5 py-3 border-b border-slate-900/[0.08] bg-slate-900/[0.04]">
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 flex-1">Branch</span>
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 w-28 text-right">Chalans</span>
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 w-36 text-right">Total Dispatched</span>
                <span className="w-8" />
              </div>

              {branches.length === 0 ? (
                <div className="py-16 text-center text-slate-500 text-sm">No branches found.</div>
              ) : (
                branches.map((b, idx) => {
                  const st = branchStats[b.id] || { count: 0, totalAmount: 0 }
                  return (
                    <motion.button
                      key={b.id}
                      whileHover={{ backgroundColor: 'rgba(28,163,76,0.03)' }}
                      whileTap={{ scale: 0.995 }}
                      onClick={() => goToBranch(b)}
                      className={`w-full flex items-center px-5 py-4 cursor-pointer group transition-colors text-left ${idx < branches.length - 1 ? 'border-b border-slate-900/[0.08]' : ''}`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-[#1ca34c]/8 flex items-center justify-center flex-shrink-0">
                          <MapPin className="w-3.5 h-3.5 text-[#15803d]" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 group-hover:text-[#15803d] transition-colors truncate">{b.name}</div>
                          <div className="text-[10px] text-slate-600 mt-0.5">{st.count === 0 ? 'No chalans yet' : `${st.count} chalan${st.count !== 1 ? 's' : ''}`}</div>
                        </div>
                      </div>
                      <div className="hidden md:block w-28 text-right text-sm font-semibold text-slate-900">{st.count > 0 ? st.count : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="hidden md:block w-36 text-right text-sm font-bold text-[#15803d]">{st.totalAmount > 0 ? `৳${st.totalAmount.toLocaleString('en-BD')}` : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="w-8 flex justify-end">
                        <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-[#15803d] transition-colors" />
                      </div>
                    </motion.button>
                  )
                })
              )}
            </div>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            VIEW B — BRANCH DETAIL (branch selected)
        ═══════════════════════════════════════════════════════════════════ */}
        {selectedBranch && (
          <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
            {/* Back + Header */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-900/5">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => goToBranch(null)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 hover:border-[#1ca34c]/30 transition-all text-xs font-semibold cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to Branches
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-[#15803d]" />
                    <h2 className="text-lg font-bold font-serif text-slate-900">{selectedBranch.name}</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {branchChalans.length} chalan{branchChalans.length !== 1 ? 's' : ''} &middot; ৳{branchChalans.reduce((s, c) => s + Number(c.total_amount), 0).toLocaleString('en-BD')} total dispatched
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text" placeholder="Search chalans..."
                    value={search} onChange={e => setSearch(e.target.value)}
                    className="bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2 pl-9 pr-3 text-[11px] placeholder-slate-600 text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 transition-all w-44"
                  />
                </div>

                {/* New Chalan */}
                <button
                  onClick={() => { resetForm(); setShowNewModal(true) }}
                  className="bg-[#1ca34c] text-white font-semibold px-3 py-2 rounded-full text-xs tracking-wider uppercase flex items-center gap-1.5 shadow-lg shadow-[#1ca34c]/10 active:scale-95 transition-transform"
                >
                  <Plus className="w-3.5 h-3.5" /> New Chalan
                </button>
              </div>
            </div>

            {/* Chalan list */}
            <div className="rounded-3xl border border-slate-900/[0.08] overflow-hidden bg-slate-900/[0.05]">
              {/* List header */}
              <div className="hidden md:grid grid-cols-[1fr_160px_140px_220px] items-center px-5 py-3 border-b border-slate-900/[0.08] bg-slate-900/[0.04] gap-4">
                {['Chalan Ref', 'Date', 'Grand Total', 'Actions'].map(h => (
                  <span key={h} className={`text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 ${h === 'Grand Total' || h === 'Items' ? 'text-right' : h === 'Actions' ? 'text-right' : ''}`}>{h}</span>
                ))}
              </div>

              {branchChalans.length === 0 ? (
                <div className="py-20 text-center">
                  <Package className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                  <p className="text-slate-500 text-sm">No chalans yet for {selectedBranch.name}.</p>
                  <p className="text-slate-600 text-xs mt-1">Click "New Chalan" to create the first one.</p>
                </div>
              ) : (
                branchChalans.map((chalan, idx) => (
                  <motion.div
                    key={chalan.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.03 }}
                    className={`flex flex-col md:grid md:grid-cols-[1fr_160px_140px_220px] items-start md:items-center px-5 py-4 gap-4 group hover:bg-slate-900/[0.04] transition-colors ${idx < branchChalans.length - 1 ? 'border-b border-slate-900/[0.08]' : ''}`}
                  >
                    {/* Top row (mobile) / Col 1 (desktop): Ref & Notes */}
                    <div className="flex justify-between items-start w-full md:w-auto min-w-0">
                      <div className="flex items-start gap-3 w-full">
                        <div className="w-8 h-8 mt-0.5 rounded-lg bg-[#1ca34c]/10 border border-[#1ca34c]/20 flex items-center justify-center flex-shrink-0">
                          <Hash className="w-3.5 h-3.5 text-[#15803d]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-900 font-mono truncate">{chalan.chalan_ref || chalan.id.slice(0, 8).toUpperCase()}</p>
                          {chalan.notes && <p className="text-[10px] text-slate-500 truncate mt-0.5">{chalan.notes}</p>}
                          {/* Mobile: items summary */}
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {(chalan.items ?? []).map((it, i) => (
                              <span key={i} className="text-[9px] bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 px-1.5 py-0.5 rounded-md">
                                {it.code ? <span className="text-[#15803d] font-mono">{it.code} </span> : null}{it.name} ×{it.quantity}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                     <div className="w-full md:w-auto flex justify-between md:block pl-11 md:pl-0 text-[11px] text-slate-500">
                      <div>
                        {new Date(chalan.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        <span className="block text-slate-600 text-[10px]">{chalan.created_by_name || 'Admin'}</span>
                      </div>

                    </div>



                    {/* Grand total & Actions (Mobile Row / Desktop Cols) */}
                    <div className="w-full md:w-auto flex items-center justify-between md:contents pl-11 md:pl-0 mt-2 md:mt-0 pt-3 md:pt-0 border-t border-slate-900/[0.08] md:border-t-0">
                      {/* Total */}
                      <div className="text-left md:text-right">
                        <span className="text-xs text-slate-500 block md:hidden mb-0.5 uppercase tracking-wider font-bold">Total</span>
                        <span className="text-sm font-bold text-[#15803d]">৳ {Number(chalan.total_amount).toLocaleString('en-BD')}</span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => setViewingChalan(chalan)}
                          title="View Details"
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20 transition-all text-[10px] font-bold uppercase tracking-wider"
                        >
                          <Eye className="w-3 h-3" /> <span className="hidden sm:inline">View</span>
                        </button>
                        <button
                          onClick={() => exportPdf(chalan)}
                          title="Export PDF"
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1ca34c]/10 border border-[#1ca34c]/20 text-[#15803d] hover:bg-[#1ca34c]/20 transition-all text-[10px] font-bold uppercase tracking-wider"
                        >
                          <Download className="w-3 h-3" /> <span className="hidden sm:inline">PDF</span>
                        </button>
                        <button
                          onClick={() => openEditModal(chalan)}
                          title="Edit Chalan"
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 hover:bg-indigo-500/20 transition-all text-[10px] font-bold uppercase tracking-wider"
                        >
                          <Pencil className="w-3 h-3" /> <span className="hidden sm:inline">Edit</span>
                        </button>
                        <button
                          onClick={() => setDeletingId(chalan.id)}
                          title="Delete chalan"
                          className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 hover:bg-rose-500/20 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          NEW CHALAN MODAL
      ════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showNewModal && selectedBranch && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-md flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowNewModal(false) }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 20 }}
              className="w-full max-w-xl bg-white border border-slate-900/10 rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-900/5 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
                    <Package className="w-4 h-4 text-[#15803d]" /> New Product Chalan
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
              <div className="overflow-y-auto custom-scrollbar p-5 space-y-5 flex-1">
                <form id="new-chalan-form" onSubmit={handleSubmit} className="space-y-5">

                  {/* Column headers */}
                  <div className="overflow-x-auto custom-scrollbar pb-1">
                    <div className="grid grid-cols-[80px_1fr_60px_80px_80px_80px_40px] gap-2 mb-2 px-1 min-w-[640px]">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Code</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Product Name</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-center">Qty</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-center">Buy Price</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-center">Sell Price</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-center">Shipping Cost</span>
                      <span />
                    </div>

                    <div className="space-y-2">
                      {formItems.map((item, idx) => {
                        const qty = parseFloat(item.quantity) || 0
                        const cp  = parseFloat(item.cost_price) || 0
                        const sp  = parseFloat(item.sale_price) || 0
                        const rowCost = qty * cp
                        const rowSale = qty * sp
                        return (
                          <div key={idx}>
                            <div className="grid grid-cols-[80px_1fr_60px_80px_80px_80px_40px] gap-2 items-center min-w-[640px]">
                              <input
                                type="text" placeholder="Code"
                                value={item.code}
                                onChange={e => {
                                  // Hack to determine which update function to call based on context
                                  // Since this replace hits both new and edit forms, we use generic ID check
                                  if (e.target.closest('#new-chalan-form')) updateItem(idx, 'code', e.target.value);
                                  else if (typeof updateEditItem !== 'undefined') updateEditItem(idx, 'code', e.target.value);
                                }}
                                className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-2 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/40 transition-all w-full font-mono"
                              />
                              <input
                                type="text"
                                placeholder={`e.g. Shirt, Dress`}
                                value={item.name}
                                onChange={e => updateItem(idx, 'name', e.target.value)}
                                className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/40 transition-all w-full"
                              />
                              <input
                                type="number" min="1" step="1" placeholder="0"
                                value={item.quantity}
                                onChange={e => updateItem(idx, 'quantity', e.target.value)}
                                className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-2 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/40 transition-all text-center w-full"
                              />
                              <input
                                type="number" min="0" step="0.01" placeholder="0"
                                value={item.cost_price}
                                onChange={e => updateItem(idx, 'cost_price', e.target.value)}
                                className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-2 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/40 transition-all text-right w-full"
                              />
                              <input
                                type="number" min="0" step="0.01" placeholder="0"
                                value={item.sale_price}
                                onChange={e => updateItem(idx, 'sale_price', e.target.value)}
                                className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-2 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/40 transition-all text-right w-full"
                              />
                              <input
                                type="number" min="0" step="0.01" placeholder="—"
                                value={item.shipping_cost}
                                onChange={e => updateItem(idx, 'shipping_cost', e.target.value)}
                                className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-2 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/40 transition-all text-right w-full"
                              />
                              <button
                                type="button"
                                onClick={() => removeItemRow(idx)}
                                disabled={formItems.length <= 1}
                                className="w-10 h-10 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 hover:bg-rose-500/20 transition-all flex items-center justify-center disabled:opacity-20 disabled:cursor-not-allowed"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                            {/* Row subtotal */}
                            {(rowCost > 0 || rowSale > 0 || (parseFloat(item.shipping_cost) || 0) > 0) && (
                              <div className="text-right text-[10px] text-slate-500 pr-9 mt-0.5">
                                Cost: <span className="text-slate-900 font-semibold">৳{rowCost.toLocaleString('en-BD')}</span> | Sale: <span className="text-[#15803d] font-semibold">৳{rowSale.toLocaleString('en-BD')}</span>{(parseFloat(item.shipping_cost) || 0) > 0 && <> | Shipping: <span className="text-slate-900 font-semibold">৳{(qty * (parseFloat(item.shipping_cost) || 0)).toLocaleString('en-BD')}</span></>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Add row */}
                    <button
                      type="button"
                      onClick={addItemRow}
                      className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-slate-900/10 hover:border-[#1ca34c]/30 text-slate-500 hover:text-[#15803d] text-[10px] font-semibold uppercase tracking-wider transition-all"
                    >
                      <Plus className="w-3 h-3" /> Add Product Row
                    </button>
                  </div>

                  {/* Grand total display */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Total Cost</span>
                      <span className="text-xl font-bold text-slate-900">৳ {grandTotalCost.toLocaleString('en-BD')}</span>
                    </div>
                    <div className="p-4 rounded-xl bg-[#1ca34c]/5 border border-[#1ca34c]/15 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Total Sale</span>
                      <span className="text-xl font-bold text-[#15803d]">৳ {grandTotalSale.toLocaleString('en-BD')}</span>
                    </div>
                    {grandTotalShipping > 0 && (
                      <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Total Shipping Cost</span>
                        <span className="text-xl font-bold text-slate-900">৳ {grandTotalShipping.toLocaleString('en-BD')}</span>
                      </div>
                    )}
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Notes <span className="text-slate-600 normal-case tracking-normal font-normal">(optional)</span>
                    </label>
                    <textarea
                      placeholder="e.g. Dispatched for Eid season, special delivery..."
                      value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/40 transition-all resize-none"
                    />
                  </div>
                </form>
              </div>

              {/* Modal Footer */}
              <div className="p-5 border-t border-slate-900/5 flex gap-3 shrink-0">
                <button
                  type="button" onClick={() => setShowNewModal(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-900/10 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-900 hover:border-slate-900/20 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit" form="new-chalan-form" disabled={isSubmitting || computedItems.length === 0}
                  className="flex-1 bg-[#1ca34c] text-white font-bold px-4 py-2.5 rounded-full text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-[#1ca34c]/10 active:scale-95 transition-transform disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving...</>
                  ) : (
                    <><Check className="w-3.5 h-3.5" />Save Chalan</>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════════════════════════════════════════════════════════════
          DELETE CONFIRM MODAL
      ════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {deletingId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-white border border-rose-500/20 rounded-3xl p-6 shadow-2xl text-center"
            >
              <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-2 font-serif">Delete this Chalan?</h3>
              <p className="text-[11px] text-slate-500 mb-6">This action cannot be undone. The chalan and all its product data will be permanently removed.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeletingId(null)}
                  className="flex-1 px-4 py-2.5 border border-slate-900/10 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-900 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deletingId && handleDelete(deletingId)}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2.5 bg-rose-500/80 hover:bg-rose-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                >
                  {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Trash2 className="w-3.5 h-3.5" />Delete</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════════════════════════════════════════════════════════════
          VIEW CHALAN DETAIL MODAL
      ════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {viewingChalan && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-md flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setViewingChalan(null) }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 20 }}
              className="w-full max-w-2xl bg-white border border-emerald-500/20 rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              {/* Header */}
              <div className="p-5 border-b border-slate-900/5 flex items-center justify-between shrink-0 bg-emerald-500/5">
                <div>
                  <h2 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
                    <Eye className="w-4 h-4 text-emerald-600" /> Chalan Details
                  </h2>
                  <p className="text-[10px] text-slate-500 mt-0.5 font-mono">
                    {viewingChalan.chalan_ref || viewingChalan.id.slice(0, 8).toUpperCase()} &middot; {viewingChalan.branch_name}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => exportPdf(viewingChalan)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1ca34c]/10 border border-[#1ca34c]/20 text-[#15803d] hover:bg-[#1ca34c]/20 transition-all text-[10px] font-bold uppercase tracking-wider"
                  >
                    <Download className="w-3 h-3" /> PDF
                  </button>
                  <button onClick={() => setViewingChalan(null)} className="p-3 rounded-xl hover:bg-slate-900/[0.04] text-slate-500 hover:text-slate-900 transition-all">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Meta info */}
              <div className="px-5 pt-4 pb-0 shrink-0 grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Date', value: new Date(viewingChalan.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) },
                  { label: 'Created By', value: viewingChalan.created_by_name || 'Admin' },
                  { label: 'Total Items', value: `${viewingChalan.items?.length ?? 0} products` },
                  { label: 'Total Qty', value: `${(viewingChalan.items ?? []).reduce((s, i) => s + Number(i.quantity), 0)} pcs` },
                ].map(m => (
                  <div key={m.label} className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">{m.label}</p>
                    <p className="text-xs font-bold text-slate-900">{m.value}</p>
                  </div>
                ))}
              </div>

              {/* Notes */}
              {viewingChalan.notes && (
                <div className="px-5 pt-3 shrink-0">
                  <p className="text-[10px] text-slate-500 italic bg-slate-900/[0.04] border border-slate-900/5 rounded-xl px-3 py-2">
                    📝 {viewingChalan.notes}
                  </p>
                </div>
              )}

              {/* Product table */}
              <div className="overflow-auto custom-scrollbar flex-1 p-5">
                <div className="rounded-xl border border-slate-900/[0.08] overflow-hidden">
                  {/* Table header */}
                  <div className="grid grid-cols-[2fr_70px_80px_80px_90px_90px_90px_90px] gap-0 bg-slate-900/[0.04] min-w-[820px] border-b border-slate-900/[0.08]">
                    {['Product Name', 'Qty', 'Buy Price', 'Sell Price', 'Shipping Cost', 'Total Cost', 'Total Shipping', 'Total Sale'].map((h, i) => (
                      <div key={h} className={`px-3 py-2.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 ${i > 0 ? 'text-right' : ''}`}>{h}</div>
                    ))}
                  </div>
                  {/* Table rows */}
                  {(viewingChalan.items ?? []).map((item, idx) => (
                    <div
                      key={idx}
                      className={`grid grid-cols-[2fr_70px_80px_80px_90px_90px_90px_90px] gap-0 items-center min-w-[820px] hover:bg-slate-900/[0.04] transition-colors ${idx < (viewingChalan.items?.length ?? 0) - 1 ? 'border-b border-slate-900/[0.08]' : ''}`}
                    >
                      <div className="px-3 py-3">
                        <span className="text-xs font-semibold text-slate-900">{item.name}</span>
                      </div>
                      <div className="px-3 py-3 text-right">
                        <span className="text-sm font-bold text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-lg">{Number(item.quantity).toLocaleString('en-BD')}</span>
                      </div>
                      <div className="px-3 py-3 text-right text-xs text-slate-600">
                        ৳{Number(item.cost_price).toLocaleString('en-BD')}
                      </div>
                      <div className="px-3 py-3 text-right text-xs text-[#15803d] font-semibold">
                        ৳{Number(item.sale_price).toLocaleString('en-BD')}
                      </div>
                      <div className="px-3 py-3 text-right text-xs text-slate-600">
                        {item.shipping_cost === undefined || item.shipping_cost === null ? '—' : `৳${Number(item.shipping_cost).toLocaleString('en-BD')}`}
                      </div>
                      <div className="px-3 py-3 text-right text-xs text-slate-500">
                        ৳{Number(item.total_cost).toLocaleString('en-BD')}
                      </div>
                      <div className="px-3 py-3 text-right text-xs text-slate-500">
                        {item.total_shipping === undefined || item.total_shipping === null ? '—' : `৳${Number(item.total_shipping).toLocaleString('en-BD')}`}
                      </div>
                      <div className="px-3 py-3 text-right text-xs font-bold text-[#15803d]">
                        ৳{Number(item.total_sale).toLocaleString('en-BD')}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Summary totals */}
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <div>
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider">Total Cost Value</p>
                      <p className="text-lg font-bold text-slate-900 mt-0.5">৳ {Number(viewingChalan.total_cost).toLocaleString('en-BD')}</p>
                    </div>
                    <Banknote className="w-5 h-5 text-slate-600" />
                  </div>
                  <div className="p-4 rounded-xl bg-[#1ca34c]/5 border border-[#1ca34c]/20 flex items-center justify-between">
                    <div>
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider">Total Sale Value</p>
                      <p className="text-lg font-bold text-[#15803d] mt-0.5">৳ {Number(viewingChalan.total_amount).toLocaleString('en-BD')}</p>
                    </div>
                    <Banknote className="w-5 h-5 text-[#15803d]/40" />
                  </div>
                  {(viewingChalan.items ?? []).some(i => i.total_shipping !== undefined && i.total_shipping !== null) && (
                    <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 flex items-center justify-between">
                      <div>
                        <p className="text-[9px] text-slate-500 uppercase tracking-wider">Total Shipping Cost</p>
                        <p className="text-lg font-bold text-slate-900 mt-0.5">৳ {(viewingChalan.items ?? []).reduce((s, i) => s + Number(i.total_shipping ?? 0), 0).toLocaleString('en-BD')}</p>
                      </div>
                      <Banknote className="w-5 h-5 text-slate-600" />
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-slate-900/5 flex gap-3 shrink-0">
                <button
                  onClick={() => { setViewingChalan(null); openEditModal(viewingChalan) }}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 border border-indigo-500/20 rounded-xl text-xs font-semibold text-indigo-600 hover:bg-indigo-500/10 transition-all"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit This Chalan
                </button>
                <button
                  onClick={() => setViewingChalan(null)}
                  className="flex-1 px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs font-semibold text-emerald-600 hover:bg-emerald-500/20 transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════════════════════════════════════════════════════════════
          EDIT CHALAN MODAL
      ════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showEditModal && editingChalan && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-md flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowEditModal(false) }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 20 }}
              className="w-full max-w-xl bg-white border border-indigo-500/20 rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-900/5 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
                    <Pencil className="w-4 h-4 text-indigo-600" /> Edit Chalan
                  </h2>
                  <p className="text-[10px] text-slate-500 mt-0.5 font-mono">{editingChalan.chalan_ref || editingChalan.id.slice(0, 8).toUpperCase()} &middot; {editingChalan.branch_name}</p>
                </div>
                <button onClick={() => setShowEditModal(false)} className="p-3 rounded-xl hover:bg-slate-900/[0.04] text-slate-500 hover:text-slate-900 transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto custom-scrollbar p-5 space-y-5 flex-1">
                <form id="edit-chalan-form" onSubmit={handleEdit} className="space-y-5">

                  {/* Column headers */}
                  <div className="overflow-x-auto custom-scrollbar pb-1">
                    <div className="grid grid-cols-[80px_1fr_60px_80px_80px_80px_40px] gap-2 mb-2 px-1 min-w-[640px]">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Code</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Product Name</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-center">Qty</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-center">Buy Price</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-center">Sell Price</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-center">Shipping Cost</span>
                      <span />
                    </div>

                    <div className="space-y-2">
                      {editItems.map((item, idx) => {
                        const qty = parseFloat(item.quantity) || 0
                        const cp  = parseFloat(item.cost_price) || 0
                        const sp  = parseFloat(item.sale_price) || 0
                        const rowCost = qty * cp
                        const rowSale = qty * sp
                        return (
                          <div key={idx}>
                            <div className="grid grid-cols-[80px_1fr_60px_80px_80px_80px_40px] gap-2 items-center min-w-[640px]">
                              <input
                                type="text" placeholder="Code"
                                value={item.code}
                                onChange={e => {
                                  // Hack to determine which update function to call based on context
                                  // Since this replace hits both new and edit forms, we use generic ID check
                                  if (e.target.closest('#new-chalan-form')) updateItem(idx, 'code', e.target.value);
                                  else if (typeof updateEditItem !== 'undefined') updateEditItem(idx, 'code', e.target.value);
                                }}
                                className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-2 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/40 transition-all w-full font-mono"
                              />
                              <input
                                type="text" placeholder="e.g. Shirt, Dress"
                                value={item.name}
                                onChange={e => updateEditItem(idx, 'name', e.target.value)}
                                className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-indigo-500/40 transition-all w-full"
                              />
                              <input
                                type="number" min="1" step="1" placeholder="0"
                                value={item.quantity}
                                onChange={e => updateEditItem(idx, 'quantity', e.target.value)}
                                className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-2 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-indigo-500/40 transition-all text-center w-full"
                              />
                              <input
                                type="number" min="0" step="0.01" placeholder="0"
                                value={item.cost_price}
                                onChange={e => updateEditItem(idx, 'cost_price', e.target.value)}
                                className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-2 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-indigo-500/40 transition-all text-right w-full"
                              />
                              <input
                                type="number" min="0" step="0.01" placeholder="0"
                                value={item.sale_price}
                                onChange={e => updateEditItem(idx, 'sale_price', e.target.value)}
                                className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-2 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-indigo-500/40 transition-all text-right w-full"
                              />
                              <input
                                type="number" min="0" step="0.01" placeholder="—"
                                value={item.shipping_cost}
                                onChange={e => updateEditItem(idx, 'shipping_cost', e.target.value)}
                                className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-2 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-indigo-500/40 transition-all text-right w-full"
                              />
                              <button
                                type="button"
                                onClick={() => removeEditItemRow(idx)}
                                disabled={editItems.length <= 1}
                                className="w-10 h-10 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 hover:bg-rose-500/20 transition-all flex items-center justify-center disabled:opacity-20 disabled:cursor-not-allowed"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                            {(rowCost > 0 || rowSale > 0 || (parseFloat(item.shipping_cost) || 0) > 0) && (
                              <div className="text-right text-[10px] text-slate-500 pr-9 mt-0.5">
                                Cost: <span className="text-slate-900 font-semibold">৳{rowCost.toLocaleString('en-BD')}</span> | Sale: <span className="text-indigo-600 font-semibold">৳{rowSale.toLocaleString('en-BD')}</span>{(parseFloat(item.shipping_cost) || 0) > 0 && <> | Shipping: <span className="text-slate-900 font-semibold">৳{(qty * (parseFloat(item.shipping_cost) || 0)).toLocaleString('en-BD')}</span></>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={addEditItemRow}
                      className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-slate-900/10 hover:border-indigo-500/30 text-slate-500 hover:text-indigo-600 text-[10px] font-semibold uppercase tracking-wider transition-all"
                    >
                      <Plus className="w-3 h-3" /> Add Product Row
                    </button>
                  </div>

                  {/* Grand total */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Total Cost</span>
                      <span className="text-xl font-bold text-slate-900">৳ {grandTotalEditCost.toLocaleString('en-BD')}</span>
                    </div>
                    <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/15 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Total Sale</span>
                      <span className="text-xl font-bold text-indigo-600">৳ {grandTotalEditSale.toLocaleString('en-BD')}</span>
                    </div>
                    {grandTotalEditShipping > 0 && (
                      <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Total Shipping Cost</span>
                        <span className="text-xl font-bold text-indigo-600">৳ {grandTotalEditShipping.toLocaleString('en-BD')}</span>
                      </div>
                    )}
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Notes <span className="text-slate-600 normal-case tracking-normal font-normal">(optional)</span>
                    </label>
                    <textarea
                      placeholder="e.g. Dispatched for Eid season..."
                      value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-indigo-500/40 transition-all resize-none"
                    />
                  </div>
                </form>
              </div>

              {/* Modal Footer */}
              <div className="p-5 border-t border-slate-900/5 flex gap-3 shrink-0">
                <button
                  type="button" onClick={() => setShowEditModal(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-900/10 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-900 hover:border-slate-900/20 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit" form="edit-chalan-form" disabled={isEditing || computedEditItems.length === 0}
                  className="flex-1 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-bold px-4 py-2.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/10 active:scale-95 transition-transform disabled:opacity-50"
                >
                  {isEditing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving...</> : <><Check className="w-3.5 h-3.5" />Save Changes</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
