'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useMemo } from 'react'
import StatsCard from '@/components/stats-card'
import { motion, AnimatePresence } from 'framer-motion'
import {
  DollarSign, Plus, Search, Check, Trash2, ShieldAlert, AlertTriangle,
  Loader2, RefreshCw, FileText, Edit, X, MapPin, Globe, Building2,
  ArrowLeft, PackageOpen, ChevronRight, Download, BadgeDollarSign, Filter
} from 'lucide-react'
import { expenseKindOf, type ExpenseKind } from '@/lib/expense-streams'
import * as XLSX from 'xlsx'
import { generatePdf } from '@/lib/pdf-generator'
import { generateExcel } from '@/lib/excel-generator'

// company expenses (expense stream 2) are read
// and written ONLY through /api/admin/company-expenses (admin-gated,
// Prisma; due recomputed server-side — C28; expense_kind carries
// the setup/operating split). The localStorage fallback
// (aura_company_expenses, audit A9/C41) is DELETED — the API is the
// only source. The legacy realtime channel is replaced by refetch
// on mount + window focus + a 30s interval. Identity comes from
// /api/auth/me.

// C49: sparklines must plot CHRONOLOGICALLY. The expense lists are
// fetched newest-first, so slice(-n) picked the OLDEST rows and
// plotted them in reverse order — the "trend" ran backwards.
const chronoSpark = (rows: any[], pick: (e: any) => number, n = 10): number[] =>
  [...rows]
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .slice(-n)
    .map(pick)

const calculateDue = (total: number, paid: number) => total - paid

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type Branch = { id: string; name: string }
type Expense = {
  id: string; purpose: string; total_amount: number; paid_amount: number;
  due_amount: number; created_at: string; created_by_name: string;
  branch_id: string | null; branch_name: string; is_all_branches: boolean;
  // Expense model (owner, 2026-10-31): 'setup' = one-time company-opening
  // cost, 'operating' = regular company expense. Absent on pre-migration
  // rows — expenseKindOf() treats anything not 'setup' as 'operating'.
  expense_kind?: string | null
}

export default function AdminExpenses() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Navigation state
  const [selectedBranch, setSelectedBranch] = useState<{ id: string; name: string } | null>(null)

  // Add expense modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [purpose, setPurpose] = useState('')
  const [expenseKind, setExpenseKind] = useState<ExpenseKind>('operating')
  const [total, setTotal] = useState('')
  const [paid, setPaid] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Create branch modal
  const [showBranchModal, setShowBranchModal] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [isCreatingBranch, setIsCreatingBranch] = useState(false)

  // Table actions
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | ExpenseKind>('all')
  const [editId, setEditId] = useState<string | null>(null)
  const [editPaid, setEditPaid] = useState('')
  const [editKind, setEditKind] = useState<ExpenseKind>('operating')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [showExportDropdown, setShowExportDropdown] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Admin info
  const [adminName, setAdminName] = useState('Operational Manager')
  const [adminId, setAdminId] = useState('demo-admin-001')

  useEffect(() => {
    const initAuth = async () => {
      try {
        const res = await fetch('/api/auth/me')
        if (res.ok) {
          const { user, profile } = await res.json()
          if (user) {
            setAdminId(user.id)
            setAdminName(profile?.full_name || user.email?.split('@')[0] || 'Admin')
            return
          }
        }
        // SEC-06 FIX: No session — admin layout already redirects, but guard here too.
        // Never fall back to localStorage for identity — it can be tampered.
        console.warn('[admin/expenses] No auth session found')
      } catch (e) {
        console.error('[admin/expenses] Auth init error:', e)
      }
    }
    initAuth()
  }, [])

  // ─── Fetch ────────────────────────────────
  const fetchAll = async () => {
    setIsLoading(true)
    await Promise.all([fetchExpenses(), fetchBranches()])
    setIsLoading(false)
  }

  const fetchExpenses = async () => {
    try {
      // C38: the API returns the COMPLETE list — this list feeds
      // every total on the page (Prisma has no 1,000-row cap).
      const res = await fetch('/api/admin/company-expenses')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load expenses')
      setExpenses(json.expenses || [])
    } catch (e) {
      console.error('Failed to fetch company expenses:', e)
    }
  }

  const fetchBranches = async () => {
    try {
      const res = await fetch('/api/branches')
      const json = await res.json()
      if (res.ok) setBranches(json.branches || [])
    } catch {}
  }

  useEffect(() => {
    fetchAll()
    // Realtime replacement: refetch on window focus + every 30s.
    const onFocus = () => { fetchExpenses(); fetchBranches() }
    window.addEventListener('focus', onFocus)
    const interval = setInterval(onFocus, 30000)
    return () => { window.removeEventListener('focus', onFocus); clearInterval(interval) }
  }, [])

  // ─── Create Branch ────────────────────────
  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newBranchName.trim()) return
    setIsCreatingBranch(true)
    try {
      const res = await fetch('/api/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newBranchName.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create branch.')
      const data = json.branch
      setBranches(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setFeedback({ type: 'success', message: `✓ Branch "${newBranchName.trim()}" created!` })
      setNewBranchName('')
      setShowBranchModal(false)
      setTimeout(() => setFeedback(null), 3000)
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to create branch.' })
    }
    setIsCreatingBranch(false)
  }

  // ─── Add Expense ──────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsedTotal = parseFloat(total)
    const parsedPaid = parseFloat(paid)
    if (isNaN(parsedTotal) || parsedTotal <= 0) return setFeedback({ type: 'error', message: 'Valid total required.' })
    if (isNaN(parsedPaid) || parsedPaid < 0 || parsedPaid > parsedTotal) return setFeedback({ type: 'error', message: 'Invalid paid amount.' })

    setIsSubmitting(true)
    const isAll = selectedBranch?.id === 'all'
    const branchName = isAll ? 'All Branches (Shared)' : (selectedBranch?.id === 'general' ? 'Head Office / General' : selectedBranch?.name || 'Head Office / General')

    // The server stamps created_by / created_by_name from the
    // caller and recomputes due_amount (C28) — the client sends
    // only the entered facts.
    const rec = {
      purpose, total_amount: parsedTotal, paid_amount: parsedPaid,
      branch_id: isAll || selectedBranch?.id === 'general' ? null : selectedBranch?.id || null,
      branch_name: branchName, is_all_branches: isAll,
      expense_kind: expenseKind
    }

    try {
      // expense_kind is a first-class column in the app's schema
      // (expense-model spec), so the pre-migration retry of the
      // legacy copy no longer exists.
      const res = await fetch('/api/admin/company-expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to log expense.')
      setFeedback({ type: 'success', message: '✓ Expense logged!' })
      await fetchExpenses()
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message })
    }
    setPurpose(''); setExpenseKind('operating'); setTotal(''); setPaid('')
    setShowAddModal(false)
    setIsSubmitting(false)
    setTimeout(() => setFeedback(null), 3000)
  }

  // ─── Delete ───────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this expense?')) return
    await fetch(`/api/admin/company-expenses?id=${id}`, { method: 'DELETE' })
    setExpenses(prev => prev.filter(e => e.id !== id))
  }

  // ─── Edit Paid ────────────────────────────
  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editId) return
    const paidNum = parseFloat(editPaid)
    const target = expenses.find(e => e.id === editId)
    if (!target || isNaN(paidNum) || paidNum < 0 || paidNum > Number(target.total_amount)) return
    const dueNum = calculateDue(Number(target.total_amount), paidNum)
    // The server recomputes due from the stored total (C28); the
    // local update mirrors the same figure for instant display.
    await fetch(`/api/admin/company-expenses?id=${editId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paid_amount: paidNum, expense_kind: editKind }),
    })
    const upd = expenses.map(e => e.id === editId ? { ...e, paid_amount: paidNum, due_amount: dueNum, expense_kind: editKind } : e)
    setExpenses(upd)
    setEditId(null); setEditPaid('')
  }

  // ─── Stats ────────────────────────────────
  const branchStats = useMemo(() => {
    const s: Record<string, { total: number; paid: number; due: number; count: number }> = {
      all: { total: 0, paid: 0, due: 0, count: 0 },
      general: { total: 0, paid: 0, due: 0, count: 0 }
    }
    branches.forEach(b => { s[b.id] = { total: 0, paid: 0, due: 0, count: 0 } })
    expenses.forEach(e => {
      const t = Number(e.total_amount), p = Number(e.paid_amount)
      // C28: due is always RECOMPUTED as total − paid. The stored
      // due_amount is only maintained on some write paths and goes
      // stale; reporting it as fact misstated dues.
      const d = t - p
      s.all.total += t; s.all.paid += p; s.all.due += d; s.all.count++
      if (e.is_all_branches) {
        // C26: a shared expense is allocated ONCE — equal shares
        // across branches. The old code ALSO added the full amount
        // to "general", so summing the cards exceeded the company
        // total by 100% of every shared expense. General now holds
        // only genuinely unassigned (head-office) expenses, and
        // Σ(branches) + general == all.
        const bCount = branches.length || 1
        branches.forEach(b => { if (s[b.id]) { s[b.id].total += t / bCount; s[b.id].paid += p / bCount; s[b.id].due += d / bCount; s[b.id].count++ } })
      } else if (!e.branch_id) {
        s.general.total += t; s.general.paid += p; s.general.due += d; s.general.count++
      } else if (s[e.branch_id]) {
        s[e.branch_id].total += t; s[e.branch_id].paid += p; s[e.branch_id].due += d; s[e.branch_id].count++
      }
    })
    return s
  }, [expenses, branches])

  // ─── Setup vs Operating split (expense model) ───
  // Company-wide, over ALL company expenses: the one-time opening
  // (setup) costs are reported apart from regular operating costs.
  // Due is recomputed as total − paid (C28), never the stored column.
  const kindStats = useMemo(() => {
    const s: Record<ExpenseKind, { total: number; paid: number; due: number; count: number }> = {
      setup: { total: 0, paid: 0, due: 0, count: 0 },
      operating: { total: 0, paid: 0, due: 0, count: 0 }
    }
    expenses.forEach(e => {
      const k = expenseKindOf(e)
      const t = Number(e.total_amount), p = Number(e.paid_amount)
      s[k].total += t; s[k].paid += p; s[k].due += t - p; s[k].count++
    })
    return s
  }, [expenses])

  // ─── Filtered expenses for detail view ────
  const detailExpenses = useMemo(() => {
    if (!selectedBranch) return []
    let base = expenses.filter(e => {
      if (selectedBranch.id === 'all') return true
      if (e.is_all_branches) return true
      if (selectedBranch.id === 'general') return !e.branch_id && !e.is_all_branches
      return e.branch_id === selectedBranch.id
    })

    // C27: in a single-branch view, shared expenses are shown at
    // their ALLOCATED SHARE — the same figure the branch's stat
    // cards use. The old detail table (and every export built from
    // it) showed the FULL shared amount, so the export total for a
    // branch never matched the branch's own cards. Due is recomputed
    // (C28).
    if (selectedBranch.id !== 'all' && selectedBranch.id !== 'general') {
      const bCount = branches.length || 1
      base = base.map(e => e.is_all_branches
        ? {
            ...e,
            total_amount: Math.round((Number(e.total_amount) / bCount) * 100) / 100,
            paid_amount: Math.round((Number(e.paid_amount) / bCount) * 100) / 100,
            due_amount: Math.round(((Number(e.total_amount) - Number(e.paid_amount)) / bCount) * 100) / 100,
          }
        : { ...e, due_amount: Number(e.total_amount) - Number(e.paid_amount) })
    } else {
      base = base.map(e => ({ ...e, due_amount: Number(e.total_amount) - Number(e.paid_amount) }))
    }

    if (dateFrom) base = base.filter(e => new Date(e.created_at) >= new Date(dateFrom))
    if (dateTo) {
      const end = new Date(dateTo); end.setHours(23, 59, 59, 999)
      base = base.filter(e => new Date(e.created_at) <= end)
    }
    if (kindFilter !== 'all') base = base.filter(e => expenseKindOf(e) === kindFilter)

    return base.filter(e =>
      (e.purpose || '').toLowerCase().includes(search.toLowerCase()) ||
      (e.created_by_name || '').toLowerCase().includes(search.toLowerCase())
    )
  }, [expenses, selectedBranch, search, dateFrom, dateTo, branches, kindFilter])

  const setDateRange = (months: number) => {
    const now = new Date()
    const from = new Date(now)
    from.setMonth(from.getMonth() - months)
    setDateFrom(from.toISOString().slice(0, 10))
    setDateTo(now.toISOString().slice(0, 10))
  }

  const currentStat = selectedBranch ? (branchStats[selectedBranch.id] || { total: 0, paid: 0, due: 0, count: 0 }) : branchStats.all

  // ─── Exports ──────────────────────────────
  const branchLabel = selectedBranch?.id === 'all' ? 'All Branches' : selectedBranch?.id === 'general' ? 'Head Office' : selectedBranch?.name || 'All'

  const getExportDateRange = () => {
    if (dateFrom || dateTo) {
      return `${dateFrom || 'Start'} to ${dateTo || 'Present'}`
    }
    if (detailExpenses.length === 0) return 'All Time'
    const timestamps = detailExpenses.map(r => new Date(r.created_at).getTime()).filter(t => !isNaN(t))
    if (timestamps.length === 0) return 'All Time'
    const minDate = new Date(Math.min(...timestamps)).toLocaleDateString('en-GB')
    const maxDate = new Date(Math.max(...timestamps)).toLocaleDateString('en-GB')
    return minDate === maxDate ? minDate : `${minDate} to ${maxDate}`
  }

  const doExportCSV = () => {
      const sel = isSelectMode && selectedIds.length > 0 ? detailExpenses.filter(e => selectedIds.includes(e.id)) : detailExpenses;
      if (isSelectMode && selectedIds.length === 0) { alert("Please select at least one record to export."); return; }
    if (!sel.length) return
    // Properly quote a CSV field (wraps in double-quotes and escapes internal quotes)
    const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const now = new Date()
    const printDate = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    // Info header block
    const infoBlock = [
      q('ANCHOR FASHION – Expense Statement'),
      [q('Branch / Scope:'), q(branchLabel)].join(','),
      [q('Date Range:'),     q(getExportDateRange())].join(','),
      [q('Print Date:'),     q(printDate)].join(','),
      [q('Prepared By:'),    q(adminName)].join(','),
      [q('Total Records:'),  q(sel.length)].join(','),
      '',
    ]
    const headers = [q('Purpose'), q('Branch'), q('Total (BDT)'), q('Paid (BDT)'), q('Due (BDT)'), q('Log Date'), q('Logged By')]
    const dataRows = sel.map(e => [
      q(e.purpose),
      q(e.is_all_branches ? 'All Branches (Shared)' : (e.branch_name || 'Head Office')),
      e.total_amount,
      e.paid_amount,
      e.due_amount,
      q(new Date(e.created_at).toLocaleString()),
      q(e.created_by_name),
    ].join(','))
    // GRAND TOTAL row
    const totalAmt = sel.reduce((s, e) => s + Number(e.total_amount), 0)
    const paidAmt  = sel.reduce((s, e) => s + Number(e.paid_amount),  0)
    const dueAmt   = sel.reduce((s, e) => s + Number(e.due_amount),   0)
    const totalRow = [q('GRAND TOTAL'), q(''), totalAmt, paidAmt, dueAmt, q(''), q('')].join(',')
    const content  = [...infoBlock, headers.join(','), ...dataRows, '', totalRow].join('\n')
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `Anchor_Expenses_${branchLabel.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`,
    })
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const doExportExcel = () => {
      const sel = isSelectMode && selectedIds.length > 0 ? detailExpenses.filter(e => selectedIds.includes(e.id)) : detailExpenses;
      if (isSelectMode && selectedIds.length === 0) { alert("Please select at least one record to export."); return; }
    if (!sel.length) return
    const cols = ['#', 'Purpose', 'Branch', 'Total (BDT)', 'Paid (BDT)', 'Due (BDT)', 'Date', 'Logged By']
    const rows = sel.map((e, i) => [
      i + 1,
      e.purpose,
      e.is_all_branches ? 'All Branches (Shared)' : (e.branch_name || 'Head Office'),
      Number(e.total_amount),
      Number(e.paid_amount),
      Number(e.due_amount),
      new Date(e.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      e.created_by_name || 'System'
    ])
    const totalAmt = sel.reduce((s, e) => s + Number(e.total_amount), 0)
    const paidAmt  = sel.reduce((s, e) => s + Number(e.paid_amount),  0)
    const dueAmt   = sel.reduce((s, e) => s + Number(e.due_amount),   0)

    generateExcel('ANCHOR FASHION – Expense Statement', cols, rows, {
      sheetName: 'Expenses',
      meta: [
        { key: 'STATEMENT REF:', value: `EXP-${Date.now().toString().slice(-8)}` },
        { key: 'BRANCH / SCOPE:', value: branchLabel },
        { key: 'DATE RANGE:', value: getExportDateRange() },
        { key: 'PREPARED BY:', value: adminName },
        { key: 'TOTAL RECORDS:', value: `${sel.length} entries` }
      ],
      totals: ['', 'GRAND TOTAL', '', totalAmt, paidAmt, dueAmt, '', ''],
      filename: `Anchor_Expenses_${branchLabel.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.xlsx`
    })
  }

  const doExportPDF = async () => {
      const sel = isSelectMode && selectedIds.length > 0 ? detailExpenses.filter(e => selectedIds.includes(e.id)) : detailExpenses;
      if (isSelectMode && selectedIds.length === 0) { alert("Please select at least one record to export."); return; }
    if (!sel.length) return
    const cols = ['#', 'Purpose', 'Branch', 'Total (BDT)', 'Paid (BDT)', 'Due (BDT)', 'Date']
    const rows = sel.map((e, i) => [
      i + 1,
      e.purpose,
      e.is_all_branches ? 'All Branches (Shared)' : (e.branch_name || 'Head Office'),
      Number(e.total_amount).toLocaleString(),
      Number(e.paid_amount).toLocaleString(),
      Number(e.due_amount).toLocaleString(),
      new Date(e.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    ])
    const totalAmt = sel.reduce((s, e) => s + Number(e.total_amount), 0)
    const paidAmt  = sel.reduce((s, e) => s + Number(e.paid_amount),  0)
    const dueAmt   = sel.reduce((s, e) => s + Number(e.due_amount),   0)
    await generatePdf(`Expense Statement`, cols, rows, {
      subtitle: `${branchLabel}  ·  ${sel.length} Record${sel.length !== 1 ? 's' : ''}`,
      branch:      branchLabel,
      preparedBy:  adminName,
      dateRange:   getExportDateRange(),
      reportRef:   `EXP-${Date.now().toString().slice(-8)}`,
      summaryData: [
        { label: 'Total Amount', value: `${totalAmt.toLocaleString()} BDT` },
        { label: 'Total Paid',   value: `${paidAmt.toLocaleString()} BDT`  },
        { label: 'Total Due',    value: `${dueAmt.toLocaleString()} BDT`   },
      ],
      filename: `Anchor_Expenses_${branchLabel.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.pdf`
    })
  }

  // ─────────────────────────────────────────────────────────────────
  // RENDER HELPERS
  // ─────────────────────────────────────────────────────────────────

  const StatPill = ({ label, value, color }: { label: string; value: string; color: string }) => (
    <div className={`flex-1 px-4 py-3 rounded-xl border ${color}`}>
      <div className="text-[9px] uppercase tracking-wider font-semibold mb-1 opacity-70">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  )

  // ─────────────────────────────────────────────────────────────────
  // MAIN RENDER
  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full bg-white text-slate-900 font-sans overflow-y-auto">
      {/* Glows */}
      <div className="fixed top-0 right-0 w-[40%] h-[40%] bg-[#d4af37]/3 rounded-full filter blur-[120px] pointer-events-none z-0" />
      <div className="fixed bottom-0 left-[10%] w-[40%] h-[40%] bg-slate-900/[0.05] rounded-full filter blur-[120px] pointer-events-none z-0" />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-8">

        {/* Global Feedback */}
        <AnimatePresence>
          {feedback && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border text-xs shadow-xl ${feedback.type === 'success' ? 'bg-emerald-950 border-emerald-500/20 text-emerald-600' : 'bg-rose-950 border-rose-500/20 text-rose-600'}`}>
              {feedback.type === 'success' ? <Check className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
              {feedback.message}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─────────────────────────────────────────────────────── */}
        {/* VIEW A: BRANCH OVERVIEW (no branch selected)           */}
        {/* ─────────────────────────────────────────────────────── */}
        {!selectedBranch && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>

            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h1 className="text-2xl font-bold font-serif text-slate-900">Company <span className="premium-text-gradient">Expenditures</span></h1>
                <p className="text-xs text-slate-500 mt-1">Branch-wise expense tracking & reporting</p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button onClick={fetchAll} className="h-10 w-10 flex items-center justify-center rounded-lg border border-slate-900/8 hover:border-slate-900/15 text-slate-500 hover:text-slate-900 transition-all cursor-pointer">
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
                <button onClick={() => setShowBranchModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-[#d4af37] to-white text-black font-bold rounded-lg text-[11px] uppercase tracking-wider hover:brightness-110 transition-all shadow-md shadow-[#d4af37]/10 cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> New Branch
                </button>
              </div>
            </div>

            {/* Premium Summary StatsCards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <StatsCard
                title="Total Spent"
                value={`৳${(branchStats.all?.total || 0).toLocaleString()}`}
                subtext={`Across ${1 + branches.length} branch${branches.length !== 0 ? 'es' : ''}`}
                icon={DollarSign}
                sparklineColor="gold"
                sparklineData={chronoSpark(expenses, e => parseFloat(String(e.total_amount)) || 0)}
              />
              <StatsCard
                title="Total Paid"
                value={`৳${(branchStats.all?.paid || 0).toLocaleString()}`}
                subtext={`${branchStats.all?.count || 0} total records`}
                icon={Check}
                sparklineColor="emerald"
                sparklineData={chronoSpark(expenses, e => parseFloat(String(e.paid_amount)) || 0)}
              />
              <StatsCard
                title="Total Due"
                value={`৳${(branchStats.all?.due || 0).toLocaleString()}`}
                subtext="Remaining balance"
                icon={AlertTriangle}
                sparklineColor="rose"
                sparklineData={chronoSpark(expenses, e => parseFloat(String(e.due_amount)) || 0)}
              />
            </div>

            {/* Expense model: one-time opening (setup) costs are
                reported APART from regular operating costs — the two
                cards below always sum to Total Spent above. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <StatsCard
                title="Setup — One-time (Company Opening)"
                value={`৳${kindStats.setup.total.toLocaleString()}`}
                subtext={`${kindStats.setup.count} records · ৳${kindStats.setup.paid.toLocaleString()} paid · ৳${kindStats.setup.due.toLocaleString()} due`}
                icon={Building2}
                sparklineColor="gold"
                sparklineData={chronoSpark(expenses.filter(e => expenseKindOf(e) === 'setup'), e => parseFloat(String(e.total_amount)) || 0)}
              />
              <StatsCard
                title="Operating — Regular Company Expenses"
                value={`৳${kindStats.operating.total.toLocaleString()}`}
                subtext={`${kindStats.operating.count} records · ৳${kindStats.operating.paid.toLocaleString()} paid · ৳${kindStats.operating.due.toLocaleString()} due`}
                icon={BadgeDollarSign}
                sparklineColor="emerald"
                sparklineData={chronoSpark(expenses.filter(e => expenseKindOf(e) === 'operating'), e => parseFloat(String(e.total_amount)) || 0)}
              />
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="w-6 h-6 animate-spin text-[#8a6d1f]" />
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-900/[0.08] overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
                  <div className="min-w-[650px]">
                    {/* List Header */}
                    <div className="flex items-center px-5 py-3 border-b border-slate-900/[0.08] bg-slate-900/[0.04]">
                  <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 flex-1">Branch</span>
                  <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 w-32 text-right">Total Spent</span>
                  <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 w-28 text-right">Paid</span>
                  <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 w-28 text-right">Due</span>
                  <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 w-24 text-right">Records</span>
                  <span className="w-8"></span>
                </div>

                {/* All Branches Row */}
                {[
                  { id: 'all', name: 'All Branches', icon: Globe, iconBg: 'bg-[#d4af37]/10', iconColor: 'text-[#8a6d1f]', badge: 'text-[#8a6d1f] bg-[#d4af37]/10 border-[#d4af37]/15' },
                  { id: 'general', name: 'Head Office / General', icon: Building2, iconBg: 'bg-blue-500/10', iconColor: 'text-blue-600', badge: 'text-blue-600 bg-blue-500/10 border-blue-500/15' }
                ].map(row => {
                  const st = branchStats[row.id] || { total: 0, paid: 0, due: 0, count: 0 }
                  const paidPct = st.total > 0 ? Math.round((st.paid / st.total) * 100) : 0
                  return (
                    <motion.button
                      key={row.id}
                      whileHover={{ backgroundColor: 'rgba(212,175,55,0.03)' }}
                      whileTap={{ scale: 0.995 }}
                      onClick={() => { setSelectedBranch({ id: row.id, name: row.name }); setSearch('') }}
                      className="w-full flex items-center px-5 py-4 border-b border-slate-900/[0.08] cursor-pointer group transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${row.iconBg}`}>
                          <row.icon className={`w-3.5 h-3.5 ${row.iconColor}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 group-hover:text-[#8a6d1f] transition-colors truncate">{row.name}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <div className="h-1 w-20 bg-slate-900/[0.04] rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${paidPct}%` }} />
                            </div>
                            <span className="text-[10px] text-slate-600">{paidPct}% paid</span>
                          </div>
                        </div>
                      </div>
                      <div className="w-32 text-right text-sm font-bold text-slate-900">{st.total > 0 ? `৳${st.total.toLocaleString()}` : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="w-28 text-right text-sm font-semibold text-emerald-600">{st.paid > 0 ? `৳${st.paid.toLocaleString()}` : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="w-28 text-right text-sm font-semibold">{st.due > 0 ? <span className="text-rose-600">৳{st.due.toLocaleString()}</span> : <span className="text-slate-600 text-xs">—</span>}</div>
                      <div className="w-24 text-right text-[11px] text-slate-500">{st.count} records</div>
                      <div className="w-8 flex justify-end">
                        <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-[#8a6d1f] transition-colors" />
                      </div>
                    </motion.button>
                  )
                })}

                {/* Branch Rows */}
                {branches.map((b, idx) => {
                  const st = branchStats[b.id] || { total: 0, paid: 0, due: 0, count: 0 }
                  const paidPct = st.total > 0 ? Math.round((st.paid / st.total) * 100) : 0
                  return (
                    <motion.button
                      key={b.id}
                      whileHover={{ backgroundColor: 'rgba(212,175,55,0.03)' }}
                      whileTap={{ scale: 0.995 }}
                      onClick={() => { setSelectedBranch(b); setSearch('') }}
                      className={`w-full flex items-center px-5 py-4 cursor-pointer group transition-colors text-left ${idx < branches.length - 1 ? 'border-b border-slate-900/[0.08]' : ''}`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-[#d4af37]/8 flex items-center justify-center flex-shrink-0">
                          <MapPin className="w-3.5 h-3.5 text-[#8a6d1f]" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 group-hover:text-[#8a6d1f] transition-colors truncate">{b.name}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <div className="h-1 w-20 bg-slate-900/[0.04] rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${paidPct}%` }} />
                            </div>
                            <span className="text-[10px] text-slate-600">{paidPct}% paid</span>
                          </div>
                        </div>
                      </div>
                      <div className="w-32 text-right text-sm font-bold text-slate-900">{st.total > 0 ? `৳${st.total.toLocaleString()}` : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="w-28 text-right text-sm font-semibold text-emerald-600">{st.paid > 0 ? `৳${st.paid.toLocaleString()}` : <span className="text-slate-600 font-normal text-xs">—</span>}</div>
                      <div className="w-28 text-right text-sm font-semibold">{st.due > 0 ? <span className="text-rose-600">৳{st.due.toLocaleString()}</span> : <span className="text-slate-600 text-xs">—</span>}</div>
                      <div className="w-24 text-right text-[11px] text-slate-500">{st.count} records</div>
                      <div className="w-8 flex justify-end">
                        <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-[#8a6d1f] transition-colors" />
                      </div>
                    </motion.button>
                  )
                })}

                {/* Empty – no branches yet */}
                {branches.length === 0 && (
                  <button onClick={() => setShowBranchModal(true)}
                    className="w-full flex flex-col items-center justify-center gap-3 py-14 hover:bg-slate-900/[0.04] transition-colors cursor-pointer group">
                    <div className="w-11 h-11 rounded-2xl bg-slate-900/[0.04] border border-dashed border-slate-900/10 group-hover:border-[#d4af37]/30 flex items-center justify-center transition-colors">
                      <Plus className="w-4.5 h-4.5 text-slate-600 group-hover:text-[#8a6d1f] transition-colors" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-slate-500 group-hover:text-slate-900 transition-colors">No branches yet</p>
                      <p className="text-xs text-slate-600 mt-0.5">Click to create your first branch</p>
                    </div>
                  </button>
                )}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ─────────────────────────────────────────────────────── */}
        {/* VIEW B: BRANCH DETAIL (branch selected)                */}
        {/* ─────────────────────────────────────────────────────── */}
        {selectedBranch && (
          <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>

            {/* Back + Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => { setSelectedBranch(null); setSearch(''); setIsSelectMode(false); setSelectedIds([]); setDateFrom(''); setDateTo(''); setShowFilters(false); }}
                  className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 transition-colors text-xs font-semibold cursor-pointer shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {selectedBranch.id === 'all'
                      ? <Globe className="w-4 h-4 text-[#8a6d1f] shrink-0" />
                      : selectedBranch.id === 'general'
                        ? <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
                        : <MapPin className="w-4 h-4 text-[#8a6d1f] shrink-0" />
                    }
                    <h1 className="text-xl font-bold font-serif text-slate-900 truncate">{selectedBranch.name}</h1>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5 pl-6 truncate">
                    {(branchStats[selectedBranch.id]?.count || 0)} expenses &middot; ৳{(branchStats[selectedBranch.id]?.total || 0).toLocaleString()} total
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-[#d4af37] to-white text-black font-bold rounded-lg text-[11px] uppercase tracking-wider hover:brightness-110 transition-all shadow-md shadow-[#d4af37]/10 cursor-pointer self-start sm:self-auto shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> Add Expense
              </button>
            </div>

            {/* Summary StatsCards for branch detail */}
            {(() => {
              const st = branchStats[selectedBranch.id] || { total: 0, paid: 0, due: 0, count: 0 }
              return (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <StatsCard
                    title="Total Spent"
                    value={`৳${st.total.toLocaleString()}`}
                    subtext={selectedBranch.name}
                    icon={DollarSign}
                    sparklineColor="gold"
                    sparklineData={chronoSpark(detailExpenses, e => parseFloat(String(e.total_amount)) || 0, 7)}
                  />
                  <StatsCard
                    title="Total Paid"
                    value={`৳${st.paid.toLocaleString()}`}
                    subtext={`${st.count} expenses`}
                    icon={Check}
                    sparklineColor="emerald"
                    sparklineData={chronoSpark(detailExpenses, e => parseFloat(String(e.paid_amount)) || 0, 7)}
                  />
                  <StatsCard
                    title="Total Due"
                    value={`৳${st.due.toLocaleString()}`}
                    subtext="Remaining balance"
                    icon={AlertTriangle}
                    sparklineColor="rose"
                    sparklineData={chronoSpark(detailExpenses, e => parseFloat(String(e.due_amount)) || 0, 7)}
                  />
                </div>
              )
            })()}

            {/* Table Card */}
            {(dateFrom || dateTo) && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] bg-[#d4af37]/20 text-[#8a6d1f] border border-[#d4af37]/30 px-3 py-1.5 rounded-lg font-bold tracking-wider flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                  Filtered by Date: {dateFrom || 'Start'} to {dateTo || 'Present'}
                </span>
              </div>
            )}
            <div className="rounded-2xl border border-slate-900/[0.08] bg-slate-900/[0.04] overflow-hidden">
              {/* Toolbar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-900/[0.08]">
                <div className="relative w-full sm:w-auto">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
                  <input type="text" placeholder="Search expenses..." value={search} onChange={e => setSearch(e.target.value)}
                    className="bg-transparent border border-slate-900/8 rounded-lg py-1.5 pl-9 pr-3 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#d4af37]/30 w-full sm:w-48 transition-all" />
                </div>
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all ${showFilters ? 'border-[#d4af37]/40 bg-[#d4af37]/10 text-[#8a6d1f]' : 'border-slate-900/8 bg-slate-900/[0.04] text-slate-500 hover:border-slate-900/15 hover:text-slate-900'}`}
                  >
                    <Filter className="w-3.5 h-3.5" /> Filters
                    {(dateFrom || dateTo || kindFilter !== 'all') && <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37]" />}
                  </button>


                    {!isSelectMode ? (
                      <button
                        onClick={() => setIsSelectMode(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/40 text-slate-600 hover:text-slate-900 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer shrink-0"
                      >
                        Select Mode
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setIsSelectMode(false)
                            setSelectedIds([])
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-900/5 text-slate-500 hover:text-slate-900 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer shrink-0"
                        >
                          Cancel
                        </button>
                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                          <div className="relative flex items-center justify-center shrink-0 w-4 h-4">
                            <input type="checkbox" checked={detailExpenses.length > 0 && selectedIds.length === detailExpenses.length} onChange={(e) => { if (e.target.checked) setSelectedIds(detailExpenses.map(r => r.id)); else setSelectedIds([]); }} className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                            <div className="w-full h-full rounded-[4px] border border-slate-900/20 bg-white peer-checked:bg-[#d4af37] peer-checked:border-[#d4af37] flex items-center justify-center transition-all duration-200">
                              <Check className="w-3 h-3 text-black opacity-0 peer-checked:opacity-100 transition-opacity" strokeWidth={3} />
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">All</span>
                        </label>
                      </>
                    )}

                    {(!isSelectMode || (isSelectMode && selectedIds.length > 0)) && (
                      <div className="relative">
                    <button onClick={() => setShowExportDropdown(p => !p)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-[#d4af37] to-white text-black font-bold rounded-lg text-[10px] uppercase tracking-wider hover:brightness-110 cursor-pointer">
                      <Download className="w-3 h-3" /> Export ({isSelectMode ? selectedIds.length : detailExpenses.length}) ▼
                    </button>
                    {showExportDropdown && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowExportDropdown(false)} />
                        <div className="absolute right-0 top-full mt-1.5 w-40 bg-white border border-slate-900/10 rounded-xl shadow-2xl py-1.5 z-20">
                          {[
                            { label: 'Excel (.xlsx)', fn: doExportExcel },
                            { label: 'CSV (.csv)', fn: doExportCSV },
                            { label: 'PDF (.pdf)', fn: doExportPDF }
                          ].map((o, i) => (
                            <button key={i} onClick={() => { o.fn(); setShowExportDropdown(false) }}
                              className="w-full text-left px-4 py-2 text-[11px] text-slate-600 hover:text-[#8a6d1f] hover:bg-slate-900/[0.04] transition-colors cursor-pointer">
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                    )}

                </div>
              </div>

              {/* Filters Panel */}
              <AnimatePresence>
                {showFilters && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden bg-white border-b border-slate-900/[0.08]"
                  >
                    <div className="p-4 flex flex-wrap gap-3 items-end">
                      <div>
                        <label className="block text-[9px] text-slate-600 uppercase tracking-wider mb-1">From</label>
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-white border border-slate-900/5 rounded-xl py-2 px-3 text-[11px] text-slate-500 focus:outline-none focus:border-[#d4af37]/40 cursor-pointer" />
                      </div>
                      <div>
                        <label className="block text-[9px] text-slate-600 uppercase tracking-wider mb-1">To</label>
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-white border border-slate-900/5 rounded-xl py-2 px-3 text-[11px] text-slate-500 focus:outline-none focus:border-[#d4af37]/40 cursor-pointer" />
                      </div>
                      <button onClick={() => setDateRange(1)} className="px-3 py-2 rounded-xl border border-slate-900/5 bg-slate-900/[0.04] text-[10px] text-slate-500 hover:border-[#d4af37]/20 hover:text-slate-900 transition-all font-semibold">
                        Last 1 Month
                      </button>
                      <button onClick={() => setDateRange(3)} className="px-3 py-2 rounded-xl border border-slate-900/5 bg-slate-900/[0.04] text-[10px] text-slate-500 hover:border-[#d4af37]/20 hover:text-slate-900 transition-all font-semibold">
                        Last 3 Months
                      </button>
                      <button onClick={() => setDateRange(6)} className="px-3 py-2 rounded-xl border border-slate-900/5 bg-slate-900/[0.04] text-[10px] text-slate-500 hover:border-[#d4af37]/20 hover:text-slate-900 transition-all font-semibold">
                        Last 6 Months
                      </button>

                      {(dateFrom || dateTo) && (
                        <button
                          onClick={() => { setDateFrom(''); setDateTo('') }}
                          className="px-3 py-2 rounded-xl border border-slate-900/5 bg-slate-900/[0.04] text-[10px] text-rose-600 hover:border-rose-500/20 transition-all font-semibold flex items-center gap-1"
                        >
                          <X className="w-3 h-3" /> Clear Dates
                        </button>
                      )}

                      <div>
                        <label className="block text-[9px] text-slate-600 uppercase tracking-wider mb-1">Expense Type</label>
                        <div className="flex gap-2">
                          {([['all', 'All Types'], ['setup', 'Setup (One-time)'], ['operating', 'Regular']] as const).map(([k, label]) => (
                            <button key={k} onClick={() => setKindFilter(k)}
                              className={`px-3 py-2 rounded-xl border text-[10px] font-semibold transition-all ${kindFilter === k ? 'border-[#d4af37]/40 bg-[#d4af37]/10 text-[#8a6d1f]' : 'border-slate-900/5 bg-slate-900/[0.04] text-slate-500 hover:border-[#d4af37]/20 hover:text-slate-900'}`}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Table or Empty State */}
              {detailExpenses.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-slate-900/[0.04] border border-slate-900/5 flex items-center justify-center">
                    <PackageOpen className="w-6 h-6 text-slate-600" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-slate-500">{search ? 'No results found' : 'No expenses yet'}</p>
                    <p className="text-xs text-slate-600 mt-1">
                      {search ? 'Try a different search term' : `Click "Add Expense" to log the first expense for ${selectedBranch.name}`}
                    </p>
                  </div>
                  {!search && (
                    <button onClick={() => setShowAddModal(true)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-slate-900/[0.04] border border-slate-900/8 hover:border-[#d4af37]/30 text-slate-600 hover:text-slate-900 rounded-lg text-xs font-semibold transition-all cursor-pointer">
                      <Plus className="w-3.5 h-3.5" /> Add First Expense
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left min-w-[750px]">
                    <thead>
                      <tr className="text-[9px] uppercase tracking-[0.1em] text-slate-600 font-bold border-b border-slate-900/[0.08]">
                        <th className="py-3 pl-5">Purpose</th>
                        <th className="py-3">Branch</th>
                        <th className="py-3">Date</th>
                        <th className="py-3">Logged By</th>
                        <th className="py-3 text-right">Total</th>
                        <th className="py-3 text-right">Paid</th>
                        <th className="py-3 text-right pr-5">Due</th>
                        <th className="py-3 pr-5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailExpenses.map(exp => {
                        const isEditing = editId === exp.id
                        const isChecked = selectedIds.includes(exp.id)
                        return (
                          <tr key={exp.id} onClick={() => {
                              if (isSelectMode) {
                                if (isChecked) setSelectedIds(selectedIds.filter(id => id !== exp.id))
                                else setSelectedIds([...selectedIds, exp.id])
                              }
                            }} className={`border-b border-slate-900/[0.08] text-xs transition-colors hover:bg-slate-900/[0.04] ${isSelectMode ? 'cursor-pointer' : ''} ${isChecked ? 'bg-[#d4af37]/5' : ''}`}>
                            <td className="py-3.5 pl-5 text-slate-900 font-medium max-w-[220px]">
                                <div className="flex items-center gap-3">
                                  {isSelectMode && (
                                    <div className="relative flex items-center justify-center shrink-0 w-4 h-4">
                                      <input type="checkbox" checked={isChecked} onChange={() => {}} className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                                      <div className="w-full h-full rounded-[4px] border border-slate-900/20 bg-white peer-checked:bg-[#d4af37] peer-checked:border-[#d4af37] flex items-center justify-center transition-all duration-200">
                                        <Check className="w-3 h-3 text-black opacity-0 peer-checked:opacity-100 transition-opacity" strokeWidth={3} />
                                      </div>
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <div className="truncate" title={exp.purpose}>{exp.purpose}</div>
                                    {expenseKindOf(exp) === 'setup' ? (
                                      <span className="inline-flex items-center mt-1 px-1.5 py-px rounded bg-[#d4af37]/10 text-[#8a6d1f] border border-[#d4af37]/20 text-[8px] font-bold uppercase tracking-wider">Setup · One-time</span>
                                    ) : (
                                      <span className="inline-flex items-center mt-1 px-1.5 py-px rounded bg-slate-900/[0.04] text-slate-500 border border-slate-900/10 text-[8px] font-bold uppercase tracking-wider">Regular</span>
                                    )}
                                  </div>
                                </div>
                              </td>
                            <td className="py-3.5">
                              {exp.is_all_branches ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 border border-blue-500/15 text-[9px] font-bold uppercase">
                                  <Globe className="w-2.5 h-2.5" /> All
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#d4af37]/8 text-[#8a6d1f] border border-[#d4af37]/15 text-[9px] font-bold uppercase">
                                  <MapPin className="w-2.5 h-2.5" /> {(exp.branch_name || 'HO').length > 14 ? (exp.branch_name || 'HO').slice(0, 14) + '…' : (exp.branch_name || 'HO')}
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 text-slate-500 text-[11px]">
                              {new Date(exp.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="py-3.5 text-slate-500 text-[11px] max-w-[90px] truncate">{exp.created_by_name}</td>
                            <td className="py-3.5 text-right text-slate-900 font-semibold">৳{Number(exp.total_amount).toLocaleString()}</td>
                            <td className="py-3.5 text-right text-emerald-600 font-semibold">৳{Number(exp.paid_amount).toLocaleString()}</td>
                            <td className="py-3.5 text-right pr-5">
                              {isEditing ? (
                                <form onSubmit={submitEdit} className="flex items-center gap-1 justify-end">
                                  <select value={editKind} onChange={e => setEditKind(e.target.value as ExpenseKind)} title="Expense type"
                                    className="bg-white border border-slate-900/15 rounded-md p-1 text-slate-900 text-[10px] focus:outline-none">
                                    <option value="operating">Regular</option>
                                    <option value="setup">Setup</option>
                                  </select>
                                  <input type="number" step="0.01" value={editPaid} onChange={e => setEditPaid(e.target.value)}
                                    className="w-20 bg-white border border-slate-900/15 rounded-md p-1 text-slate-900 text-xs focus:outline-none" />
                                  <button type="submit" className="text-emerald-600 hover:text-emerald-700 p-2"><Check className="w-3.5 h-3.5" /></button>
                                  <button type="button" onClick={() => { setEditId(null); setEditPaid('') }} className="text-slate-500 hover:text-slate-900 p-2"><X className="w-3.5 h-3.5" /></button>
                                </form>
                              ) : (
                                <span className={`font-semibold ${Number(exp.due_amount) > 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                                  ৳{Number(exp.due_amount).toLocaleString()}
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 pr-5">
                              {!isEditing && (
                                <div className="flex items-center justify-end gap-2">
                                  <button onClick={() => { setEditId(exp.id); setEditPaid(String(exp.paid_amount)); setEditKind(expenseKindOf(exp)) }} className="text-slate-600 hover:text-amber-600 transition-colors p-2 rounded-md"><Edit className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => handleDelete(exp.id)} className="text-slate-600 hover:text-rose-600 transition-colors p-2 rounded-md"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* MODAL: Add Expense                                         */}
      {/* ─────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showAddModal && selectedBranch && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-40" onClick={() => setShowAddModal(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-4"
            >
              <div className="bg-white border border-slate-900/8 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-900/[0.08]">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 font-serif">Log New Expense</h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {selectedBranch.id === 'all'
                        ? <Globe className="w-3 h-3 text-blue-600" />
                        : <MapPin className="w-3 h-3 text-[#8a6d1f]" />
                      }
                      <span className="text-[10px] text-slate-500">{selectedBranch.name}</span>
                    </div>
                  </div>
                  <button onClick={() => setShowAddModal(false)} className="text-slate-600 hover:text-slate-900 transition-colors cursor-pointer p-3 rounded-lg">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Description *</label>
                    <textarea required rows={2} value={purpose} onChange={e => setPurpose(e.target.value)}
                      placeholder="What was this expense for?"
                      className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#d4af37]/40 transition-all resize-none" />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Expense Type *</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setExpenseKind('operating')}
                        className={`text-left px-3 py-2.5 rounded-xl border transition-all ${expenseKind === 'operating' ? 'border-[#d4af37]/50 bg-[#d4af37]/10' : 'border-slate-900/8 bg-slate-900/[0.04] hover:border-slate-900/15'}`}>
                        <span className={`block text-[11px] font-bold ${expenseKind === 'operating' ? 'text-[#8a6d1f]' : 'text-slate-900'}`}>Regular company expense</span>
                        <span className="block text-[9px] text-slate-500 mt-0.5">Ongoing company spending</span>
                      </button>
                      <button type="button" onClick={() => setExpenseKind('setup')}
                        className={`text-left px-3 py-2.5 rounded-xl border transition-all ${expenseKind === 'setup' ? 'border-[#d4af37]/50 bg-[#d4af37]/10' : 'border-slate-900/8 bg-slate-900/[0.04] hover:border-slate-900/15'}`}>
                        <span className={`block text-[11px] font-bold ${expenseKind === 'setup' ? 'text-[#8a6d1f]' : 'text-slate-900'}`}>One-time setup (company opening)</span>
                        <span className="block text-[9px] text-slate-500 mt-0.5">AC, lights, furnishing &amp; other opening costs</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Total (BDT) *</label>
                      <input required type="number" step="0.01" min="0.01" value={total} onChange={e => setTotal(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#d4af37]/40 transition-all" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Paid (BDT) *</label>
                      <input required type="number" step="0.01" min="0" value={paid} onChange={e => setPaid(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#d4af37]/40 transition-all" />
                    </div>
                  </div>

                  {total && paid && (
                    <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-xs">
                      <span className="text-slate-500">Remaining Due</span>
                      <span className={`font-bold ${calculateDue(parseFloat(total || '0'), parseFloat(paid || '0')) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        ৳{calculateDue(parseFloat(total || '0'), parseFloat(paid || '0')).toLocaleString()} BDT
                      </span>
                    </div>
                  )}

                  <div className="flex gap-3 pt-1">
                    <button type="button" onClick={() => setShowAddModal(false)}
                      className="flex-1 py-2.5 border border-slate-900/8 text-slate-500 hover:text-slate-900 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer">
                      Cancel
                    </button>
                    <button type="submit" disabled={isSubmitting}
                      className="flex-1 bg-gradient-to-r from-[#d4af37] to-white text-black font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 hover:brightness-110 disabled:opacity-60 cursor-pointer shadow-lg shadow-[#d4af37]/15">
                      {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Log Expense
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* MODAL: Create Branch                                       */}
      {/* ─────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showBranchModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-40" onClick={() => setShowBranchModal(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-4"
            >
              <div className="bg-white border border-slate-900/8 rounded-2xl w-full max-w-sm shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-900/[0.08]">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 font-serif">Create New Branch</h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">Add a branch to track its expenses</p>
                  </div>
                  <button onClick={() => setShowBranchModal(false)} className="text-slate-600 hover:text-slate-900 transition-colors cursor-pointer p-3 rounded-lg"><X className="w-4 h-4" /></button>
                </div>
                <form onSubmit={handleCreateBranch} className="p-6 space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Branch Name *</label>
                    <input required type="text" value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
                      placeholder="e.g. Dhaka Main, Chittagong North"
                      className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#d4af37]/40 transition-all" />
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setShowBranchModal(false)}
                      className="flex-1 py-2.5 border border-slate-900/8 text-slate-500 hover:text-slate-900 rounded-xl text-xs font-bold uppercase cursor-pointer transition-all">
                      Cancel
                    </button>
                    <button type="submit" disabled={isCreatingBranch}
                      className="flex-1 bg-gradient-to-r from-[#d4af37] to-white text-black font-bold py-2.5 rounded-xl text-xs uppercase flex items-center justify-center gap-1.5 hover:brightness-110 disabled:opacity-60 cursor-pointer shadow-lg shadow-[#d4af37]/15">
                      {isCreatingBranch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Create Branch
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
