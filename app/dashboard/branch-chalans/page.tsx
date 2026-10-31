'use client'

export const dynamic = 'force-dynamic'

/* eslint-disable react/no-unescaped-entities */
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Package, MapPin, ChevronRight, ArrowLeft,
  RefreshCw, Download, Loader2,
  Search, Hash, ClipboardList, Banknote, Plus, X, Check, AlertTriangle, Pencil
} from 'lucide-react'
import { generatePdf } from '@/lib/pdf-generator'
import { useAuth } from '@/app/context/AuthContext'
import { getCachedData, setCachedData, invalidateBranchCache } from '@/lib/branch-cache'

// branches + chalans come from
// GET /api/chalans (the branch-cache UI caching stays), creates
// go to POST /api/chalans and edits to PATCH /api/chalans/[id] —
// branch name, totals and creator identity are set server-side
// and the head-office write gate is enforced there too.
// Realtime is replaced with 30s polling + focus refetch.

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type Branch = { id: string; name: string }

type ChalanItem = {
  code?: string
  name: string
  quantity: number
  cost_price?: number
  sale_price?: number
  total_cost?: number
  total_sale?: number
  // Legacy fields
  unit_price?: number
  total_price?: number
}

type ProductChalan = {
  id: string
  branch_id: string | null
  branch_name: string
  chalan_ref: string | null
  items: ChalanItem[]
  total_amount: number
  total_cost?: number
  notes: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PartnerBranchChalansPage() {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const { profileType, role } = useAuth()

  // Head Office users can create and edit, but NOT delete
  const isHeadOffice = role === 'head_office' || profileType === 'head_office'

  const [branches, setBranches]         = useState<Branch[]>(() => getCachedData('partner_chalan_branches') || [])
  const [chalans, setChalans]           = useState<ProductChalan[]>(() => getCachedData('partner_chalans_all') || [])
  const [isLoading, setIsLoading]       = useState(() => !getCachedData('partner_chalans_all'))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [branchesLoaded, setBranchesLoaded] = useState(() => !!getCachedData('partner_chalan_branches'))
  const [userId, setUserId]             = useState('')
  const [userName, setUserName]         = useState('Head Office')
  const [feedback, setFeedback]         = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // URL-driven selected branch
  const branchParam    = searchParams?.get('branch') ?? null
  const selectedBranch = useMemo<Branch | null>(() => {
    if (!branchParam || !branchesLoaded) return null
    return branches.find(b => b.id === branchParam) ?? null
  }, [branchParam, branches, branchesLoaded])

  const [search, setSearch] = useState('')

  // ─── New Chalan Modal ─────────────────────────────────────────────────────
  const [showNewModal, setShowNewModal]   = useState(false)
  const [isSubmitting, setIsSubmitting]   = useState(false)
  const [formNotes, setFormNotes]         = useState('')
  const [formItems, setFormItems]         = useState<{ code: string; name: string; quantity: string; cost_price: string; sale_price: string }[]>([
    { code: '', name: '', quantity: '', cost_price: '', sale_price: '' },
  ])

  // ─── Edit Chalan Modal ────────────────────────────────────────────────────
  const [editingChalan, setEditingChalan]   = useState<ProductChalan | null>(null)
  const [showEditModal, setShowEditModal]   = useState(false)
  const [isEditing, setIsEditing]           = useState(false)
  const [editNotes, setEditNotes]           = useState('')
  const [editItems, setEditItems]           = useState<{ code: string; name: string; quantity: string; cost_price: string; sale_price: string }[]>([])

  // ─── Auth ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch('/api/auth/me')
        if (res.ok) {
          const me = await res.json()
          if (me.user) {
            setUserId(me.user.id)
            setUserName(me.profile?.full_name || 'Head Office')
          }
        }
      } catch (e) {}
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
  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch('/api/chalans')
      if (!res.ok) return
      const { branches: data } = await res.json()
      if (data) {
        setBranches(data)
        setBranchesLoaded(true)
        setCachedData('partner_chalan_branches', data, 120000)
      }
    } catch (e) {}
  }, [])

  const fetchChalans = useCallback(async () => {
    try {
      const res = await fetch('/api/chalans')
      if (!res.ok) return
      const { chalans: data } = await res.json()
      if (data) {
        setChalans(data)
        setCachedData('partner_chalans_all', data, 45000)
      }
    } catch (e) {}
  }, [])

  const fetchAll = useCallback(async () => {
    if (!getCachedData('partner_chalans_all')) {
      setIsLoading(true)
    }
    await Promise.all([fetchBranches(), fetchChalans()])
    setIsLoading(false)
  }, [fetchBranches, fetchChalans])

  useEffect(() => {
    fetchAll()
    // Polling replaces the realtime subscription.
    const interval = setInterval(fetchChalans, 30000)
    const onFocus = () => fetchChalans()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
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
  const branchStats = useMemo(() => {
    const map: Record<string, { count: number; totalAmount: number }> = {}
    branches.forEach(b => { map[b.id] = { count: 0, totalAmount: 0 } })
    chalans.forEach(c => {
      const key = c.branch_id ?? ''
      if (!map[key]) map[key] = { count: 0, totalAmount: 0 }
      map[key].count += 1
      map[key].totalAmount += Number(c.total_amount)
    })
    return map
  }, [branches, chalans])

  const overallStats = useMemo(() => ({
    totalChalans:  chalans.length,
    totalAmount:   chalans.reduce((s, c) => s + Number(c.total_amount), 0),
    totalItems:    chalans.reduce((s, c) => s + (c.items?.length ?? 0), 0),
  }), [chalans])

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

  // ─── Form helpers (shared for new & edit) ─────────────────────────────────
  const addItemRow = (setter: React.Dispatch<React.SetStateAction<{ code: string; name: string; quantity: string; cost_price: string; sale_price: string }[]>>) =>
    setter(prev => [...prev, { code: '', name: '', quantity: '', cost_price: '', sale_price: '' }])

  const removeItemRow = (
    idx: number,
    items: { code: string; name: string; quantity: string; cost_price: string; sale_price: string }[],
    setter: React.Dispatch<React.SetStateAction<{ code: string; name: string; quantity: string; cost_price: string; sale_price: string }[]>>
  ) => {
    if (items.length <= 1) return
    setter(prev => prev.filter((_, i) => i !== idx))
  }

  const updateItem = (
    idx: number,
    field: 'code' | 'name' | 'quantity' | 'cost_price' | 'sale_price',
    val: string,
    setter: React.Dispatch<React.SetStateAction<{ code: string; name: string; quantity: string; cost_price: string; sale_price: string }[]>>
  ) => {
    setter(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item))
  }

  const computeItems = (raw: { code: string; name: string; quantity: string; cost_price: string; sale_price: string }[]): ChalanItem[] =>
    raw.filter(i => i.name.trim()).map(i => {
      const qty = parseFloat(i.quantity) || 0
      const cp  = parseFloat(i.cost_price) || 0
      const sp  = parseFloat(i.sale_price) || 0
      return { 
        code: i.code.trim() || undefined,
        name: i.name.trim(), 
        quantity: qty, 
        cost_price: cp, 
        sale_price: sp, 
        total_cost: qty * cp, 
        total_sale: qty * sp 
      }
    })

  const computedNewItems = useMemo(() => computeItems(formItems), [formItems])
  const grandTotalCostNew = useMemo(() => computedNewItems.reduce((s, i) => s + (i.total_cost ?? 0), 0), [computedNewItems])
  const grandTotalSaleNew = useMemo(() => computedNewItems.reduce((s, i) => s + (i.total_sale ?? 0), 0), [computedNewItems])

  const computedEditItems = useMemo(() => computeItems(editItems), [editItems])
  const grandTotalCostEdit = useMemo(() => computedEditItems.reduce((s, i) => s + (i.total_cost ?? 0), 0), [computedEditItems])
  const grandTotalSaleEdit = useMemo(() => computedEditItems.reduce((s, i) => s + (i.total_sale ?? 0), 0), [computedEditItems])

  const genChalanRef = () => {
    const now = new Date()
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '')
    const rand = Math.floor(1000 + Math.random() * 9000)
    return `CHN-${datePart}-${rand}`
  }

  // ─── Submit new chalan ────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedBranch) return setFeedback({ type: 'error', message: 'No branch selected.' })
    if (computedNewItems.length === 0) return setFeedback({ type: 'error', message: 'Add at least one product.' })
    const invalid = computedNewItems.find(i => i.quantity <= 0)
    if (invalid) return setFeedback({ type: 'error', message: `"${invalid.name}" must have a quantity > 0.` })

    setIsSubmitting(true)
    setFeedback(null)

    // Branch name, totals and creator identity are set server-side.
    const payload = {
      branch_id:  selectedBranch.id,
      chalan_ref: genChalanRef(),
      items:      computedNewItems,
      notes:      formNotes.trim() || null,
    }

    try {
      const res = await fetch('/api/chalans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || 'Failed to create chalan')
      }
      setFormItems([{ code: '', name: '', quantity: '', cost_price: '', sale_price: '' }])
      setFormNotes('')
      setShowNewModal(false)
      setFeedback({ type: 'success', message: '✓ Chalan created successfully!' })
      await fetchChalans()
    } catch (error: any) {
      setFeedback({ type: 'error', message: error.message })
    }
    setIsSubmitting(false)
    setTimeout(() => setFeedback(null), 5000)
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
        cost_price: String(i.cost_price ?? i.unit_price ?? ''),
        sale_price: String(i.sale_price ?? i.unit_price ?? ''),
      }))
    )
    setShowEditModal(true)
  }

  // ─── Submit edit ──────────────────────────────────────────────────────────
  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingChalan) return
    if (computedEditItems.length === 0) return setFeedback({ type: 'error', message: 'Add at least one product.' })
    const invalid = computedEditItems.find(i => i.quantity <= 0)
    if (invalid) return setFeedback({ type: 'error', message: `"${invalid.name}" must have a quantity > 0.` })

    setIsEditing(true)
    setFeedback(null)

    try {
      const res = await fetch(`/api/chalans/${editingChalan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: computedEditItems,
          notes: editNotes.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || 'Failed to update chalan')
      }
      setShowEditModal(false)
      setEditingChalan(null)
      setFeedback({ type: 'success', message: '✓ Chalan updated successfully!' })
      await fetchChalans()
    } catch (error: any) {
      setFeedback({ type: 'error', message: error.message })
    }
    setIsEditing(false)
    setTimeout(() => setFeedback(null), 5000)
  }

  // ─── PDF Export ───────────────────────────────────────────────────────────
  const exportPdf = (chalan: ProductChalan) => {
    const rows: (string | number)[][] = chalan.items.map((item, idx) => [
      idx + 1,
      item.code ? `[${item.code}] ${item.name}` : item.name,
      item.quantity,
      `${Number(item.cost_price ?? item.unit_price ?? 0).toLocaleString('en-BD')} BDT`,
      `${Number(item.sale_price ?? item.unit_price ?? 0).toLocaleString('en-BD')} BDT`,
      `${Number(item.total_sale ?? item.total_price ?? 0).toLocaleString('en-BD')} BDT`,
    ])

    generatePdf(
      'Branch Product Dispatch Chalan',
      ['#', 'Code / Product Title', 'Qty', 'Unit Cost (৳)', 'Unit Retail (৳)', 'Total Value (৳)'],
      rows,
      {
        filename:    `${chalan.chalan_ref || 'Chalan'}.pdf`,
        branch:      chalan.branch_name,
        subtitle:    'Product Dispatch Chalan',
        preparedBy:  chalan.created_by_name || 'Head Office',
        dateRange:   new Date(chalan.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        reportRef:   chalan.chalan_ref || chalan.id.slice(0, 8).toUpperCase(),
        summaryData: [
          { label: 'Total Line Items',   value: chalan.items.length.toString() },
          { label: 'Total Dispatch Cost', value: `${Number(chalan.total_cost || 0).toLocaleString('en-BD')} BDT` },
          { label: 'Total Expected Revenue', value: `${Number(chalan.total_amount).toLocaleString('en-BD')} BDT` },
        ],
        notes: chalan.notes,
      }
    )
  }

  // ─── Item form rows renderer ──────────────────────────────────────────────
  const renderItemRows = (
    items: { code: string; name: string; quantity: string; cost_price: string; sale_price: string }[],
    setter: React.Dispatch<React.SetStateAction<{ code: string; name: string; quantity: string; cost_price: string; sale_price: string }[]>>
  ) => (
    <div>
      <div className="grid grid-cols-[80px_1fr_60px_80px_80px_28px] md:grid-cols-[90px_1fr_72px_96px_96px_28px] gap-2 mb-2 px-1">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Code</span>
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Product Title / Name</span>
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-center">Qty</span>
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-center">Cost ৳</span>
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-center">Sale ৳</span>
        <span />
      </div>
      <div className="space-y-2">
        {items.map((item, idx) => {
          const qty = parseFloat(item.quantity) || 0
          const cp  = parseFloat(item.cost_price) || 0
          const sp  = parseFloat(item.sale_price) || 0
          const rowCostTotal = qty * cp
          const rowSaleTotal = qty * sp
          return (
            <div key={idx}>
              <div className="grid grid-cols-[80px_1fr_60px_80px_80px_28px] md:grid-cols-[90px_1fr_72px_96px_96px_28px] gap-2 items-center">
                <input
                  type="text" placeholder="e.g. A-101"
                  value={item.code}
                  onChange={e => updateItem(idx, 'code', e.target.value, setter)}
                  className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2 text-xs text-[#8a6d1f] placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all w-full font-mono"
                />
                <input
                  type="text" placeholder="e.g. Shirt"
                  value={item.name}
                  onChange={e => updateItem(idx, 'name', e.target.value, setter)}
                  className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all w-full"
                />
                <input
                  type="number" min="1" step="1" placeholder="0"
                  value={item.quantity}
                  onChange={e => updateItem(idx, 'quantity', e.target.value, setter)}
                  className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-2 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all text-center w-full"
                />
                <input
                  type="number" min="0" step="0.01" placeholder="0"
                  value={item.cost_price}
                  onChange={e => updateItem(idx, 'cost_price', e.target.value, setter)}
                  className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-2 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all text-right w-full"
                />
                <input
                  type="number" min="0" step="0.01" placeholder="0"
                  value={item.sale_price}
                  onChange={e => updateItem(idx, 'sale_price', e.target.value, setter)}
                  className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-2 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all text-right w-full"
                />
                <button
                  type="button"
                  onClick={() => removeItemRow(idx, items, setter)}
                  disabled={items.length <= 1}
                  className="w-10 h-10 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 hover:bg-rose-500/20 transition-all flex items-center justify-center disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              {(rowCostTotal > 0 || rowSaleTotal > 0) && (
                <div className="flex justify-end gap-3 text-[10px] text-slate-500 pr-9 mt-0.5">
                  {rowCostTotal > 0 && <span>Cost: <span className="text-slate-900 font-semibold">৳{rowCostTotal.toLocaleString('en-BD')}</span></span>}
                  {rowSaleTotal > 0 && <span>Retail: <span className="text-[#8a6d1f] font-semibold">৳{rowSaleTotal.toLocaleString('en-BD')}</span></span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => addItemRow(setter)}
        className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-slate-900/10 hover:border-[#d4af37]/30 text-slate-500 hover:text-[#8a6d1f] text-[10px] font-semibold uppercase tracking-wider transition-all"
      >
        <Plus className="w-3 h-3" /> Add Product Row
      </button>
    </div>
  )

  // ─── Loading screen ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen w-full bg-white text-slate-900 font-sans relative">
      {/* Ambient glows */}
      <div className="absolute top-[-5%] right-[-5%] w-[40%] h-[40%] bg-[#d4af37]/3 rounded-full filter blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-5%] left-[10%] w-[50%] h-[50%] bg-indigo-500/3 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="relative z-10 flex flex-col p-4 md:p-6 max-h-screen overflow-y-auto custom-scrollbar">

        {/* ── Page Header ── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-4 border-b border-slate-900/5">
          <div>
            <span className="text-[10px] bg-[#d4af37]/10 text-[#8a6d1f] border border-[#d4af37]/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider inline-flex items-center gap-1 mb-1">
              <Package className="w-3 h-3" /> Branch Dispatch
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 font-serif">Branch Product Chalans</h1>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {isHeadOffice ? 'Create, edit, and export product dispatch chalans for all branches.' : 'View product dispatch chalans for all branches.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isHeadOffice && (
              <span className="text-[9px] px-2 py-1 rounded-full bg-slate-100 border border-slate-900/5 text-slate-500 font-bold uppercase tracking-wider">View Only</span>
            )}
            {isHeadOffice && (
              <span className="text-[9px] px-2 py-1 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 text-[#8a6d1f] font-bold uppercase tracking-wider">Head Office</span>
            )}
            <button
              onClick={handleRefresh}
              className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#d4af37]/20 text-slate-500 hover:text-slate-900 transition-all ${isRefreshing ? 'animate-spin text-[#8a6d1f]' : ''}`}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { label: 'Total Chalans',     value: overallStats.totalChalans,                               cls: 'text-slate-900',      icon: ClipboardList, bg: 'bg-slate-900/[0.04] border-slate-900/5' },
                { label: 'Total Line Items',  value: overallStats.totalItems,                                 cls: 'text-indigo-600', icon: Package,       bg: 'bg-indigo-500/5 border-indigo-500/10' },
                { label: 'Total Dispatched',  value: `${overallStats.totalAmount.toLocaleString('en-BD')} BDT`, cls: 'text-[#8a6d1f]',  icon: Banknote,      bg: 'bg-[#d4af37]/5 border-[#d4af37]/10' },
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
                      whileHover={{ backgroundColor: 'rgba(212,175,55,0.03)' }}
                      whileTap={{ scale: 0.995 }}
                      onClick={() => goToBranch(b)}
                      className={`w-full flex items-center px-5 py-4 cursor-pointer group transition-colors text-left ${idx < branches.length - 1 ? 'border-b border-slate-900/[0.08]' : ''}`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-[#d4af37]/8 flex items-center justify-center flex-shrink-0">
                          <MapPin className="w-3.5 h-3.5 text-[#8a6d1f]" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 group-hover:text-[#8a6d1f] transition-colors truncate">{b.name}</div>
                          <div className="text-[10px] text-slate-600 mt-0.5">{st.count === 0 ? 'No chalans yet' : `${st.count} chalan${st.count !== 1 ? 's' : ''}`}</div>
                        </div>
                      </div>
                      <div className="hidden md:block w-28 text-right text-sm font-semibold text-slate-900">{st.count > 0 ? st.count : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="hidden md:block w-36 text-right text-sm font-bold text-[#8a6d1f]">{st.totalAmount > 0 ? `${st.totalAmount.toLocaleString('en-BD')} BDT` : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="w-8 flex justify-end">
                        <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-[#8a6d1f] transition-colors" />
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 hover:border-[#d4af37]/30 transition-all text-xs font-semibold cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to Branches
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-[#8a6d1f]" />
                    <h2 className="text-lg font-bold font-serif text-slate-900">{selectedBranch.name}</h2>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {branchChalans.length} chalan{branchChalans.length !== 1 ? 's' : ''} &middot; {branchChalans.reduce((s, c) => s + Number(c.total_amount), 0).toLocaleString('en-BD')} BDT total dispatched
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
                    className="bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2 pl-9 pr-3 text-[11px] placeholder-slate-400 text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all w-44"
                  />
                </div>

                {/* New Chalan — only for Head Office */}
                {isHeadOffice && (
                  <button
                    onClick={() => {
                      setFormItems([{ code: '', name: '', quantity: '', cost_price: '', sale_price: '' }])
                      setFormNotes('')
                      setShowNewModal(true)
                    }}
                    className="bg-gradient-to-r from-[#d4af37] to-white text-black font-semibold px-3 py-2 rounded-xl text-xs tracking-wider uppercase flex items-center gap-1.5 shadow-lg shadow-[#d4af37]/10 active:scale-95 transition-transform"
                  >
                    <Plus className="w-3.5 h-3.5" /> New Chalan
                  </button>
                )}
              </div>
            </div>

            {/* Chalan list */}
            <div className="rounded-2xl border border-slate-900/[0.08] overflow-hidden bg-slate-900/[0.05]">
              <div className={`hidden md:grid items-center px-5 py-3 border-b border-slate-900/[0.08] bg-slate-900/[0.04] gap-4 ${isHeadOffice ? 'grid-cols-[1fr_160px_80px_140px_220px]' : 'grid-cols-[1fr_160px_80px_140px_80px]'}`}>
                {['Chalan Ref', 'Date', 'Items', 'Grand Total', isHeadOffice ? 'Actions' : 'PDF'].map(h => (
                  <span key={h} className={`text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 ${h === 'Grand Total' || h === 'Items' ? 'text-right' : h === 'Actions' || h === 'PDF' ? 'text-right' : ''}`}>{h}</span>
                ))}
              </div>

              {branchChalans.length === 0 ? (
                <div className="py-20 text-center">
                  <Package className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                  <p className="text-slate-500 text-sm">No chalans yet for {selectedBranch.name}.</p>
                  <p className="text-slate-600 text-xs mt-1">
                    {isHeadOffice ? 'Click "New Chalan" to create the first one.' : 'Head Office or Admin will create chalans for this branch.'}
                  </p>
                </div>
              ) : (
                branchChalans.map((chalan, idx) => (
                  <motion.div
                    key={chalan.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.03 }}
                    className={`flex flex-col md:grid md:grid-cols-[1fr_160px_80px_140px_220px] items-start md:items-center px-5 py-4 gap-4 group hover:bg-slate-900/[0.04] transition-colors ${idx < branchChalans.length - 1 ? 'border-b border-slate-900/[0.08]' : ''}`}
                  >
                    {/* Top row (mobile) / Col 1 (desktop): Ref & Notes */}
                    <div className="flex justify-between items-start w-full md:w-auto min-w-0">
                      <div className="flex items-start gap-3 w-full">
                        <div className="w-8 h-8 mt-0.5 rounded-lg bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center flex-shrink-0">
                          <Hash className="w-3.5 h-3.5 text-[#8a6d1f]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-900 font-mono truncate">{chalan.chalan_ref || chalan.id.slice(0, 8).toUpperCase()}</p>
                          {chalan.notes && <p className="text-[10px] text-slate-500 truncate mt-0.5">{chalan.notes}</p>}
                          {/* Mobile: items summary with code + name */}
                          <div className="md:hidden flex flex-wrap gap-1.5 mt-2">
                            {(chalan.items ?? []).slice(0, 3).map((it, i) => (
                              <span key={i} className="text-[9px] bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 px-1.5 py-0.5 rounded-md">
                                {it.code ? <span className="text-[#8a6d1f] font-mono">{it.code} </span> : null}{it.name} ×{it.quantity}
                              </span>
                            ))}
                            {(chalan.items ?? []).length > 3 && <span className="text-[9px] text-slate-600">+{chalan.items.length - 3} more</span>}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Desktop: Date | Mobile: Date and Items inside a flex row */}
                    <div className="w-full md:w-auto flex justify-between md:block pl-11 md:pl-0 text-[11px] text-slate-500">
                      <div>
                        {new Date(chalan.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        <span className="block text-slate-600 text-[10px]">{chalan.created_by_name || 'Head Office'}</span>
                      </div>
                      <div className="md:hidden text-right">
                        <span className="text-sm font-bold text-indigo-600">{(chalan.items ?? []).length}</span>
                        <span className="text-[10px] text-slate-600 block">products</span>
                      </div>
                    </div>

                    {/* Desktop Items count (hidden on mobile) */}
                    <div className="hidden md:block text-right">
                      <span className="text-sm font-bold text-indigo-600">{(chalan.items ?? []).length}</span>
                      <span className="text-[10px] text-slate-600 block">products</span>
                    </div>

                    {/* Grand total & Actions (Mobile Row / Desktop Cols) */}
                    <div className="w-full md:w-auto flex items-center justify-between md:contents pl-11 md:pl-0 mt-2 md:mt-0 pt-3 md:pt-0 border-t border-slate-900/[0.08] md:border-t-0">
                      {/* Total */}
                      <div className="text-left md:text-right">
                        <span className="text-xs text-slate-500 block md:hidden mb-0.5 uppercase tracking-wider font-bold">Total</span>
                        <span className="text-sm font-bold text-[#8a6d1f]">৳ {Number(chalan.total_amount).toLocaleString('en-BD')}</span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 justify-end">
                        {isHeadOffice && (
                          <button
                            onClick={() => openEditModal(chalan)}
                            title="Edit Chalan"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 hover:bg-indigo-500/20 transition-all text-[10px] font-bold uppercase tracking-wider"
                          >
                            <Pencil className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Edit</span>
                          </button>
                        )}
                        <button
                          onClick={() => exportPdf(chalan)}
                          title="Export PDF"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#d4af37]/10 border border-[#d4af37]/20 text-[#8a6d1f] hover:bg-[#d4af37]/20 transition-all text-[10px] font-bold uppercase tracking-wider"
                        >
                          <Download className="w-3.5 h-3.5" /> <span className="hidden sm:inline">PDF</span>
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
          NEW CHALAN MODAL (Head Office only)
      ════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showNewModal && selectedBranch && isHeadOffice && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-md flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowNewModal(false) }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 20 }}
              className="w-full max-w-xl bg-white border border-slate-900/10 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-900/5 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
                    <Package className="w-4 h-4 text-[#8a6d1f]" /> New Product Chalan
                  </h2>
                  <p className="text-[10px] text-slate-500 mt-0.5">Branch: {selectedBranch.name}</p>
                </div>
                <button onClick={() => setShowNewModal(false)} className="p-3 rounded-xl hover:bg-slate-900/[0.04] text-slate-500 hover:text-slate-900 transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto custom-scrollbar p-5 space-y-5 flex-1">
                <form id="new-chalan-form" onSubmit={handleSubmit} className="space-y-5">
                  {renderItemRows(formItems, setFormItems)}

                  {/* Grand total */}
                  <div className="p-4 rounded-xl bg-[#d4af37]/5 border border-[#d4af37]/15 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Total Cost</span>
                      <span className="text-sm font-bold text-slate-900">৳ {grandTotalCostNew.toLocaleString('en-BD')}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-[#8a6d1f] uppercase tracking-wider font-bold">Expected Revenue</span>
                      <span className="text-xl font-bold text-[#8a6d1f]">৳ {grandTotalSaleNew.toLocaleString('en-BD')}</span>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Notes <span className="text-slate-600 normal-case tracking-normal font-normal">(optional)</span>
                    </label>
                    <textarea
                      placeholder="e.g. Dispatched for Eid season..."
                      value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all resize-none"
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
                  type="submit" form="new-chalan-form" disabled={isSubmitting || computedNewItems.length === 0}
                  className="flex-1 bg-gradient-to-r from-[#d4af37] to-white text-black font-bold px-4 py-2.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-[#d4af37]/10 active:scale-95 transition-transform disabled:opacity-50"
                >
                  {isSubmitting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving...</> : <><Check className="w-3.5 h-3.5" />Save Chalan</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════════════════════════════════════════════════════════════
          EDIT CHALAN MODAL (Head Office only)
      ════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showEditModal && editingChalan && isHeadOffice && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-md flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowEditModal(false) }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 20 }}
              className="w-full max-w-xl bg-white border border-indigo-500/20 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-900/5 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
                    <Pencil className="w-4 h-4 text-indigo-600" /> Edit Chalan
                  </h2>
                  <p className="text-[10px] text-slate-500 mt-0.5 font-mono">{editingChalan.chalan_ref || editingChalan.id.slice(0, 8).toUpperCase()}</p>
                </div>
                <button onClick={() => setShowEditModal(false)} className="p-3 rounded-xl hover:bg-slate-900/[0.04] text-slate-500 hover:text-slate-900 transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto custom-scrollbar p-5 space-y-5 flex-1">
                <form id="edit-chalan-form" onSubmit={handleEdit} className="space-y-5">
                  {renderItemRows(editItems, setEditItems)}

                  {/* Grand total */}
                  <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/15 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Total Cost</span>
                      <span className="text-sm font-bold text-slate-900">৳ {grandTotalCostEdit.toLocaleString('en-BD')}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-indigo-600 uppercase tracking-wider font-bold">Expected Revenue</span>
                      <span className="text-xl font-bold text-indigo-600">৳ {grandTotalSaleEdit.toLocaleString('en-BD')}</span>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1.5">
                      Notes <span className="text-slate-600 normal-case tracking-normal font-normal">(optional)</span>
                    </label>
                    <textarea
                      placeholder="e.g. Dispatched for Eid season..."
                      value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500/40 transition-all resize-none"
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
