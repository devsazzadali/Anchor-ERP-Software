'use client'

export const dynamic = 'force-dynamic'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  BookMarked, Plus, Search, RefreshCw, ChevronLeft,
  Check, X, Edit2, Power, PowerOff, FileOutput,
  AlertTriangle, CheckCircle, Hash, Calendar, Tag,
} from 'lucide-react'
import Link from 'next/link'
import { generatePdf } from '@/lib/pdf-generator'

interface LedgerHead {
  id: string
  code_number: number
  name: string
  ledger_type: string
  is_active: boolean
  reference_creation_date: string | null
  created_at: string
  updated_at: string
}

// ─── Admin guard ─────────────────────────────────────────────────────────────
// identity comes from /api/auth/me (the app
// session) instead of a browser database client; the admin test is
// the route's is_admin (role column OR admin_users — A1).
function useAdminGuard() {
  const router = useRouter()
  const [allowed, setAllowed] = useState(false)
  const [adminName, setAdminName] = useState('')

  useEffect(() => {
    const check = async () => {
      const res = await fetch('/api/auth/me')
      if (!res.ok) { router.replace('/'); return }
      const { profile, is_admin } = await res.json()
      if (!profile || !is_admin) {
        router.replace('/dashboard')
        return
      }
      setAdminName(profile.full_name || 'Admin')
      setAllowed(true)
    }
    check()
  }, [router])

  return { allowed, adminName }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const fmtRef = (d: string | null) => d || '—'

// ─── Component ───────────────────────────────────────────────────────────────
export default function LedgerHeadsPage() {
  const { allowed, adminName } = useAdminGuard()

  const [heads, setHeads] = useState<LedgerHead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')

  // Add modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({
    code_number: '', name: '', ledger_type: 'All', reference_creation_date: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Edit modal
  const [editHead, setEditHead] = useState<LedgerHead | null>(null)
  const [editForm, setEditForm] = useState({
    name: '', ledger_type: '', reference_creation_date: '',
  })
  const [isEditing, setIsEditing] = useState(false)

  // ─── Fetch ──────────────────────────────────────────────────────────────
  const fetchHeads = useCallback(async () => {
    try {
      const res = await fetch('/api/ledger-heads?include_inactive=true')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setHeads(json.ledger_heads || [])
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    if (!allowed) return
    fetchHeads().finally(() => setIsLoading(false))
  }, [allowed, fetchHeads])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchHeads()
    setIsRefreshing(false)
  }

  // ─── Filtered list ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let base = [...heads]
    if (search) {
      const q = search.toLowerCase()
      base = base.filter(h =>
        h.name.toLowerCase().includes(q) ||
        String(h.code_number).includes(q) ||
        h.ledger_type.toLowerCase().includes(q)
      )
    }
    if (typeFilter !== 'all') base = base.filter(h => h.ledger_type === typeFilter)
    if (activeFilter === 'active')   base = base.filter(h => h.is_active)
    if (activeFilter === 'inactive') base = base.filter(h => !h.is_active)
    return base.sort((a, b) => a.code_number - b.code_number)
  }, [heads, search, typeFilter, activeFilter])

  const ledgerTypes = useMemo(() => {
    const types = [...new Set(heads.map(h => h.ledger_type))].sort()
    return types
  }, [heads])

  // ─── Add ────────────────────────────────────────────────────────────────
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = parseInt(addForm.code_number, 10)
    if (isNaN(code) || code <= 0) {
      setError('Code Number must be a positive integer')
      return
    }
    if (!addForm.name.trim()) {
      setError('Name is required')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/ledger-heads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code_number:             code,
          name:                    addForm.name.trim(),
          ledger_type:             addForm.ledger_type || 'All',
          reference_creation_date: addForm.reference_creation_date || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSuccess(`Ledger Head ${code} — ${addForm.name.trim()} created successfully`)
      setShowAddModal(false)
      setAddForm({ code_number: '', name: '', ledger_type: 'All', reference_creation_date: '' })
      await fetchHeads()
      setTimeout(() => setSuccess(null), 4000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Edit ────────────────────────────────────────────────────────────────
  const openEdit = (h: LedgerHead) => {
    setEditHead(h)
    setEditForm({
      name:                    h.name,
      ledger_type:             h.ledger_type,
      reference_creation_date: h.reference_creation_date || '',
    })
    setError(null)
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editHead) return
    if (!editForm.name.trim()) { setError('Name is required'); return }
    setIsEditing(true)
    setError(null)
    try {
      const res = await fetch(`/api/ledger-heads?id=${editHead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:                    editForm.name.trim(),
          ledger_type:             editForm.ledger_type,
          reference_creation_date: editForm.reference_creation_date || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSuccess(`Ledger Head ${editHead.code_number} updated successfully`)
      setEditHead(null)
      await fetchHeads()
      setTimeout(() => setSuccess(null), 4000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsEditing(false)
    }
  }

  // ─── Toggle active ───────────────────────────────────────────────────────
  const toggleActive = async (h: LedgerHead) => {
    const action = h.is_active ? 'deactivate' : 'activate'
    if (!confirm(`${action === 'deactivate' ? 'Deactivate' : 'Activate'} "${h.name}"?\n\n${action === 'deactivate' ? 'It will no longer appear in new expense forms, but historical records are unaffected.' : 'It will appear in expense forms again.'}`)) return
    try {
      const res = await fetch(`/api/ledger-heads?id=${h.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !h.is_active }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSuccess(`Ledger Head ${h.code_number} — ${h.name} ${h.is_active ? 'deactivated' : 'activated'}`)
      await fetchHeads()
      setTimeout(() => setSuccess(null), 4000)
    } catch (e: any) {
      setError(e.message)
    }
  }

  // ─── PDF Export ──────────────────────────────────────────────────────────
  const handleExportPDF = async () => {
    const cols = ['Code', 'Ledger Head Name', 'Ledger Type', 'Ref Date', 'Status']
    const rows = filtered.map(h => [
      h.code_number,
      h.name,
      h.ledger_type,
      fmtRef(h.reference_creation_date),
      h.is_active ? 'Active' : 'Inactive',
    ])
    await generatePdf('List of Ledger Head Information', cols, rows, {
      subtitle:    `${filtered.length} Records · All Types`,
      preparedBy:  adminName,
      dateRange:   'All Time',
      reportRef:   `LH-${Date.now().toString().slice(-8)}`,
      // C50: the summary must describe the EXPORTED (filtered) rows —
      // it previously reported the unfiltered heads.length, so the
      // summary contradicted the rows whenever a filter was active.
      summaryData: [
        { label: 'Total Heads (in this export)', value: filtered.length },
        { label: 'Active Heads',   value: filtered.filter(h => h.is_active).length },
        { label: 'Inactive Heads', value: filtered.filter(h => !h.is_active).length },
      ],
      filename: `Anchor_Ledger_Heads_${new Date().toISOString().slice(0, 10)}.pdf`,
    })
  }

  // ─── Loading guard ───────────────────────────────────────────────────────
  if (!allowed || isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Background glows */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/4 w-[500px] h-[400px] bg-[#1ca34c]/3 rounded-full filter blur-[140px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[300px] bg-indigo-500/3 rounded-full filter blur-[120px]" />
      </div>

      <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/dashboard"
            className="p-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
              <BookMarked className="w-6 h-6 text-[#15803d]" />
              Ledger Head Master
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Accounting classification master — {heads.length} heads · {heads.filter(h => h.is_active).length} active
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 hover:text-slate-900 hover:border-slate-900/10 text-xs transition-all"
            >
              <FileOutput className="w-3.5 h-3.5" /> PDF
            </button>
            <button
              onClick={handleRefresh}
              className={`p-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => { setShowAddModal(true); setError(null); setSuccess(null) }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#1ca34c] text-white font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-all"
            >
              <Plus className="w-4 h-4" /> New Head
            </button>
          </div>
        </div>

        {/* Feedback */}
        {error && (
          <div className="mb-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto shrink-0 cursor-pointer p-2.5 rounded-lg"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}
        {success && (
          <div className="mb-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" /> <span className="flex-1">{success}</span>
            <button onClick={() => setSuccess(null)} className="ml-auto shrink-0 cursor-pointer p-2.5 rounded-lg"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Total Heads',   val: heads.length,                          color: 'text-[#15803d]' },
            { label: 'Active',        val: heads.filter(h => h.is_active).length, color: 'text-emerald-600' },
            { label: 'Inactive',      val: heads.filter(h => !h.is_active).length,color: 'text-slate-500' },
          ].map(s => (
            <div key={s.label} className="p-4 rounded-3xl bg-slate-900/[0.04] border border-slate-900/5 text-center">
              <p className={`text-2xl font-bold font-serif ${s.color}`}>{s.val}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search by code, name, or type..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl pl-9 pr-3 py-2.5 text-slate-900 text-xs placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/40"
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="bg-white border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/40 cursor-pointer"
          >
            <option value="all">All Types</option>
            {ledgerTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={activeFilter}
            onChange={e => setActiveFilter(e.target.value as any)}
            className="bg-white border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/40 cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
          {(search || typeFilter !== 'all' || activeFilter !== 'all') && (
            <button
              onClick={() => { setSearch(''); setTypeFilter('all'); setActiveFilter('all') }}
              className="px-3 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs hover:bg-rose-500/20 transition-all"
            >
              Clear
            </button>
          )}
        </div>

        {/* Table */}
        <div className="rounded-3xl border border-slate-900/5 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[60px_1fr_100px_120px_80px_120px] gap-3 px-5 py-3 bg-slate-900/[0.04] border-b border-slate-900/5">
            {['Code', 'Ledger Head Name', 'Type', 'Ref Date', 'Status', 'Actions'].map(h => (
              <div key={h} className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">{h}</div>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-16">
              <BookMarked className="w-10 h-10 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No Ledger Heads found</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-900/[0.08]">
              {filtered.map(h => (
                <div
                  key={h.id}
                  className={`grid grid-cols-[60px_1fr_100px_120px_80px_120px] gap-3 px-5 py-3.5 hover:bg-slate-900/[0.04] transition-all ${!h.is_active ? 'opacity-50' : ''}`}
                >
                  {/* Code */}
                  <div className="flex items-center">
                    <span className="text-xs font-bold text-[#15803d] font-mono">{h.code_number}</span>
                  </div>

                  {/* Name */}
                  <div className="flex items-center min-w-0">
                    <span className="text-sm text-slate-900 font-medium truncate">{h.name}</span>
                  </div>

                  {/* Ledger Type */}
                  <div className="flex items-center">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-600">
                      {h.ledger_type}
                    </span>
                  </div>

                  {/* Ref Date */}
                  <div className="flex items-center">
                    <span className="text-xs text-slate-500">{fmtRef(h.reference_creation_date)}</span>
                  </div>

                  {/* Status */}
                  <div className="flex items-center">
                    {h.is_active ? (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                        <Check className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-slate-500">
                        <X className="w-3 h-3" /> Inactive
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openEdit(h)}
                      title="Edit"
                      className="p-2.5 rounded-lg bg-slate-900/[0.04] hover:bg-[#1ca34c]/10 hover:text-[#15803d] text-slate-500 transition-all cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => toggleActive(h)}
                      title={h.is_active ? 'Deactivate' : 'Activate'}
                      className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                        h.is_active
                          ? 'bg-slate-900/[0.04] hover:bg-rose-500/10 hover:text-rose-600 text-slate-500'
                          : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600'
                      }`}
                    >
                      {h.is_active ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Result count */}
        {filtered.length > 0 && (
          <p className="text-[10px] text-slate-600 mt-3 text-center">
            Showing {filtered.length} of {heads.length} Ledger Heads
          </p>
        )}
      </div>

      {/* ─── Add Modal ─────────────────────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-900/10 rounded-3xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#15803d]" /> New Ledger Head
              </h2>
              <button onClick={() => { setShowAddModal(false); setError(null) }} className="text-slate-500 hover:text-slate-900 cursor-pointer p-3 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
              </div>
            )}

            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">
                    <Hash className="w-3 h-3 inline mr-1" />Code Number *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={addForm.code_number}
                    onChange={e => setAddForm(f => ({ ...f, code_number: e.target.value }))}
                    placeholder="e.g. 39"
                    className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-xs placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/40 [appearance:textfield]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">
                    <Tag className="w-3 h-3 inline mr-1" />Ledger Type
                  </label>
                  <input
                    type="text"
                    value={addForm.ledger_type}
                    onChange={e => setAddForm(f => ({ ...f, ledger_type: e.target.value }))}
                    placeholder="All"
                    className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-xs placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/40"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Ledger Head Name *</label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. New Expense Category"
                  maxLength={100}
                  className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-xs placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/40"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">
                  <Calendar className="w-3 h-3 inline mr-1" />Reference Date (optional)
                </label>
                <input
                  type="date"
                  value={addForm.reference_creation_date}
                  onChange={e => setAddForm(f => ({ ...f, reference_creation_date: e.target.value }))}
                  className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/40 [color-scheme:light]"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-3 rounded-full bg-[#1ca34c] text-white font-bold text-xs uppercase tracking-widest hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {isSubmitting
                    ? <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    : <Plus className="w-3.5 h-3.5" />}
                  Create Ledger Head
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddModal(false); setError(null) }}
                  className="px-4 py-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 text-xs hover:text-slate-900 transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Edit Modal ────────────────────────────────────────────────────── */}
      {editHead && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-900/10 rounded-3xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-[#15803d]" />
                Edit — Code {editHead.code_number}
              </h2>
              <button onClick={() => { setEditHead(null); setError(null) }} className="text-slate-500 hover:text-slate-900 cursor-pointer p-3 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-4 p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Code Number (immutable)</p>
              <p className="text-sm font-bold text-[#15803d] font-mono mt-0.5">{editHead.code_number}</p>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
              </div>
            )}

            <form onSubmit={handleEdit} className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Ledger Head Name *</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  maxLength={100}
                  className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/40"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Ledger Type</label>
                <input
                  type="text"
                  value={editForm.ledger_type}
                  onChange={e => setEditForm(f => ({ ...f, ledger_type: e.target.value }))}
                  className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/40"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">
                  <Calendar className="w-3 h-3 inline mr-1" />Reference Date
                </label>
                <input
                  type="date"
                  value={editForm.reference_creation_date}
                  onChange={e => setEditForm(f => ({ ...f, reference_creation_date: e.target.value }))}
                  className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/40 [color-scheme:light]"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={isEditing}
                  className="flex-1 py-3 rounded-full bg-[#1ca34c] text-white font-bold text-xs uppercase tracking-widest hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {isEditing
                    ? <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    : <Check className="w-3.5 h-3.5" />}
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => { setEditHead(null); setError(null) }}
                  className="px-4 py-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 text-xs hover:text-slate-900 transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
