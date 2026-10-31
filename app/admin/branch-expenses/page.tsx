'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { generatePdf } from '@/lib/pdf-generator'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import {
  Wallet, RefreshCw, Calendar, AlertTriangle, Building2, Download,
  Search, ChevronLeft, Plus, Receipt, Trash2, X, CheckCircle, PackageOpen, MapPin, Check, Settings
} from 'lucide-react'

import IssueSalaryModal from '../salaries/IssueSalaryModal'
import IssueHouseRentModal from '../house-rent/IssueHouseRentModal'
import IssueUtilityBillModal from './IssueUtilityBillModal'
import IssueDeveloperBillModal from './IssueDeveloperBillModal'

// role + branches come from /api/auth/me and
// /api/branches; ledger heads and expenses were already API-driven
// (/api/ledger-heads, /api/branch-accounts/expenses).

const fmt = (n: any) => (Number(n || 0) < 0 ? '-' : '') + '৳' + Math.abs(Number(n || 0)).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default function AdminBranchExpensesPage() {
  const router = useRouter()

  // Data states
  const [userRole, setUserRole] = useState('')
  const [ledgerHeads, setLedgerHeads] = useState<any[]>([])
  const [branches, setBranches] = useState<any[]>([])

  // UI states
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Navigation & Search
  const [selectedHead, setSelectedHead] = useState<any | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Filters (for the detail view)
  const [filterMonth, setFilterMonth] = useState('')
  const [filterBranch, setFilterBranch] = useState('')

  // Form states
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    branch_id: '',
    description: '',
    amount: '',
    expense_date: new Date().toISOString().split('T')[0],
    notes: '',
  })
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Ledger Head Form state
  const [showAddHeadModal, setShowAddHeadModal] = useState(false)
  const [isSubmittingHead, setIsSubmittingHead] = useState(false)
  const [addHeadForm, setAddHeadForm] = useState({
    name: '',
    ledger_type: 'All',
    reference_creation_date: ''
  })

  const [expenses, setExpenses] = useState<any[]>([])

  const fetchData = useCallback(async () => {
    try {
      const meRes = await fetch('/api/auth/me')
      if (meRes.ok) {
        const me = await meRes.json()
        if (me.profile) setUserRole(me.profile.role || '')
      }

      const res = await fetch('/api/ledger-heads')
      const json = await res.json()
      if (res.ok && json.ledger_heads) {
        setLedgerHeads(json.ledger_heads)
      }

      const bRes = await fetch('/api/branches')
      if (bRes.ok) {
        const bJson = await bRes.json()
        setBranches(bJson.branches || [])
      }
    } catch (e) {
      console.error('Failed to fetch filter data', e)
    }
  }, [])

  const fetchExpenses = useCallback(async (ledgerHeadId: string) => {
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filterMonth) params.set('month', filterMonth)
      if (filterBranch) params.set('branch_id', filterBranch)
      params.set('ledger_head_id', ledgerHeadId)

      const res = await fetch(`/api/branch-accounts/expenses?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setExpenses(json.expenses || [])
    } catch (e: any) {
      setError(e.message)
    }
  }, [filterMonth, filterBranch])

  useEffect(() => {
    fetchData().finally(() => setIsLoading(false))
  }, [fetchData])

  useEffect(() => {
    if (selectedHead) {
      setIsLoading(true)
      fetchExpenses(selectedHead.id).finally(() => setIsLoading(false))
    }
  }, [selectedHead, filterMonth, filterBranch, fetchExpenses])

  const handleRefresh = async () => {
    if (selectedHead) {
      setIsRefreshing(true)
      await fetchExpenses(selectedHead.id)
      setIsRefreshing(false)
    }
  }

  const handleExportPdf = async () => {
    try {
      const cols = ['Date', 'Branch', 'Description', 'Account/Recipient', 'Amount']
      const rows = expenses.map(exp => [
        exp.expense_date,
        exp.branch_name || branches.find((b: any) => b.id === exp.branch_id)?.name || 'Branch',
        exp.description || '',
        exp.recipient_account || '-',
        exp.amount ? Number(exp.amount).toLocaleString('en-BD') : '0'
      ])

      let title = `Expenses: ${selectedHead?.name || 'Ledger Head'}`
      if (filterBranch) {
        const branchName = branches.find(b => b.id === filterBranch)?.name
        if (branchName) title += ` - ${branchName}`
      }
      if (filterMonth) title += ` (${filterMonth})`

      // C17: the PDF used to carry NO totals at all — the document
      // could not be reconciled against anything. It now carries the
      // same totals as the screen, split gross / paid / due so
      // unpaid and partial rows are not presented as fully spent.
      const grossTotal = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)
      const paidTotal = expenses.reduce((s, e) => s + Number(e.paid_amount ?? e.amount ?? 0), 0)
      const dueTotal = expenses.reduce((s, e) => s + Number(e.due_amount ?? 0), 0)
      await generatePdf(title, cols, rows, {
        orientation: 'portrait',
        summaryData: [
          { label: 'Total Records', value: String(expenses.length) },
          { label: 'Gross Total (BDT)', value: grossTotal.toLocaleString('en-BD') },
          { label: 'Paid (BDT)', value: paidTotal.toLocaleString('en-BD') },
          { label: 'Due (BDT)', value: dueTotal.toLocaleString('en-BD') },
        ],
      })
    } catch (err) {
      console.error('Failed to generate PDF', err)
      setError('Failed to generate PDF')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedHead || !form.branch_id || !form.amount || !form.description) {
      setError('Please fill in all required fields.')
      return
    }
    if (Number(form.amount) <= 0) {
      setError('Amount must be greater than zero.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/branch-accounts/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: form.branch_id,
          ledger_head_id: selectedHead.id,
          amount: parseFloat(form.amount),
          expense_date: form.expense_date,
          description: form.description,
          notes: form.notes
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to record expense')

      setSuccess('Expense recorded successfully!')
      setShowForm(false)
      setForm(f => ({ ...f, description: '', amount: '', notes: '' }))
      await fetchExpenses(selectedHead.id)
      setTimeout(() => setSuccess(null), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAddHead = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addHeadForm.name.trim()) return
    setIsSubmittingHead(true)
    setError(null)
    try {
      const highest = ledgerHeads.reduce((max, h) => {
        const num = parseInt(h.code_number)
        return !isNaN(num) && num > max ? num : max
      }, 0)
      const newCode = highest > 0 ? (highest + 1).toString().padStart(4, '0') : '1000'

      const res = await fetch('/api/ledger-heads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code_number: newCode,
          name: addHeadForm.name.trim(),
          ledger_type: addHeadForm.ledger_type || 'All',
          reference_creation_date: addHeadForm.reference_creation_date || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)

      setSuccess(`Ledger Category ${newCode} — ${addHeadForm.name.trim()} created successfully`)
      setShowAddHeadModal(false)
      setAddHeadForm({ name: '', ledger_type: 'All', reference_creation_date: '' })

      const lhRes = await fetch('/api/ledger-heads')
      const lhJson = await lhRes.json()
      if (lhRes.ok && lhJson.ledger_heads) {
        setLedgerHeads(lhJson.ledger_heads)
      }
      setTimeout(() => setSuccess(null), 4000)
    } catch (err: any) {
      setError(err.message || 'Failed to create category')
    } finally {
      setIsSubmittingHead(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return }
    setConfirmDeleteId(null)
    try {
      const res = await fetch(`/api/branch-accounts/expenses?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      if (selectedHead) {
        await fetchExpenses(selectedHead.id)
      }
    } catch (e: any) {
      setError(e.message)
    }
  }

  const totalExpenses = useMemo(() => expenses.reduce((s, e) => s + Number(e.amount), 0), [expenses])

  const canDelete = ['admin', 'super_admin'].includes(userRole)

  const filteredHeads = useMemo(() => {
    if (!searchQuery) return ledgerHeads
    const lowerQ = searchQuery.toLowerCase()
    return ledgerHeads.filter(lh =>
      String(lh.code_number).includes(lowerQ) ||
      (lh.name && lh.name.toLowerCase().includes(lowerQ))
    )
  }, [ledgerHeads, searchQuery])

  if (isLoading && !selectedHead && ledgerHeads.length === 0) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 p-4 md:p-6 custom-scrollbar">
      <div className="max-w-5xl mx-auto relative z-10">

        {/* Glow */}
        <div className="absolute top-[-10%] right-[-5%] w-[400px] h-[400px] bg-[#d4af37]/5 rounded-full filter blur-[150px] pointer-events-none" />

        {error && (
          <div className="mb-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> {success}
          </div>
        )}

        {!selectedHead ? (
          // ======================================================================
          // STATE 1: LEDGER HEADS LIST VIEW
          // ======================================================================
          <div>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
              <div>
                <span className="text-[10px] bg-[#d4af37]/10 text-[#8a6d1f] border border-[#d4af37]/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider inline-flex items-center gap-1 mb-1">
                  <Building2 className="w-3 h-3" /> Ledger Categories
                </span>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2 font-serif">
                   Ledger Heads
                </h1>
                <p className="text-[11px] text-slate-500 mt-0.5">Select a ledger head to view or add expenses for branches.</p>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-64">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search by code or name..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-white border border-slate-900/10 rounded-xl pl-9 pr-3 py-2.5 text-slate-900 text-xs focus:outline-none focus:border-[#d4af37]/40"
                  />
                </div>
                {canDelete && (
                  <div className="flex items-center gap-2">
                    <Link href="/admin/branch-expenses/settings"
                      className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-slate-900/[0.04] border border-slate-900/8 hover:border-[#d4af37]/30 text-slate-600 hover:text-slate-900 rounded-xl text-xs font-semibold transition-all cursor-pointer">
                      <Settings className="w-3.5 h-3.5" /> Account Settings
                    </Link>
                    <button onClick={() => setShowAddHeadModal(true)}
                      className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-slate-900/[0.04] border border-slate-900/8 hover:border-[#d4af37]/30 text-slate-600 hover:text-slate-900 rounded-xl text-xs font-semibold transition-all cursor-pointer">
                      <Plus className="w-3.5 h-3.5" /> Add Category
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredHeads.map(lh => (
                <button
                  key={lh.id}
                  onClick={() => {
                    setSelectedHead(lh)
                    setExpenses([])
                    setFilterMonth('')
                    setFilterBranch('')
                  }}
                  className="text-left p-5 rounded-2xl bg-white border border-slate-900/5 hover:border-[#d4af37]/30 hover:bg-[#d4af37]/5 transition-all group relative overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-[#d4af37]/0 to-[#d4af37]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <span className="text-[10px] font-mono font-bold text-[#8a6d1f] bg-[#d4af37]/10 px-2 py-1 rounded-lg mb-3 inline-block">
                    Code: {lh.code_number}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 mb-1 group-hover:text-[#8a6d1f] transition-colors line-clamp-2">
                    {lh.name}
                  </h3>
                </button>
              ))}
              {filteredHeads.length === 0 && (
                <div className="col-span-full py-16 text-center border border-slate-900/5 bg-slate-900/[0.04] rounded-2xl">
                  <p className="text-slate-500 text-sm">No ledger heads found matching "{searchQuery}"</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          // ======================================================================
          // STATE 2: LEDGER HEAD DETAIL VIEW
          // ======================================================================
          <div>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setSelectedHead(null)}
                  className="p-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#d4af37]/20 text-slate-500 hover:text-slate-900 transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] bg-[#d4af37]/10 text-[#8a6d1f] border border-[#d4af37]/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                      Code {selectedHead.code_number}
                    </span>
                  </div>
                  <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2 font-serif">
                     {selectedHead.name}
                  </h1>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={handleExportPdf} disabled={expenses.length === 0}
                  className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 hover:text-slate-900 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                  title="Export as PDF"
                >
                  <Download className="w-4 h-4" /> <span className="text-xs font-medium hidden sm:inline">Export PDF</span>
                </button>
                <button onClick={handleRefresh}
                  className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[#8a6d1f]' : ''}`}
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowForm(!showForm)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#d4af37] to-white text-black font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-all"
                >
                  <Plus className="w-4 h-4" /> {showForm ? 'Cancel' : 'Add Expense'}
                </button>
              </div>
            </div>

            {/* Table or Empty State */}
            {isLoading ? (
              <div className="py-16 flex justify-center">
                 <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : expenses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-slate-900/[0.04] border border-slate-900/5 flex items-center justify-center">
                    <PackageOpen className="w-6 h-6 text-slate-600" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-slate-500">No expenses found</p>
                    <p className="text-xs text-slate-600 mt-1">
                      Click "Add Expense" to log the first expense for this ledger head.
                    </p>
                  </div>
                  <button onClick={() => setShowForm(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-slate-900/[0.04] border border-slate-900/8 hover:border-[#d4af37]/30 text-slate-600 hover:text-slate-900 rounded-lg text-xs font-semibold transition-all cursor-pointer">
                    <Plus className="w-3.5 h-3.5" /> Add First Expense
                  </button>
                </div>
            ) : (
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left min-w-[750px]">
                  <thead>
                    <tr className="text-[9px] uppercase tracking-[0.1em] text-slate-600 font-bold border-b border-slate-900/[0.08]">
                      <th className="py-3 pl-5">Description</th>
                      <th className="py-3">Account</th>
                      <th className="py-3">Branch</th>
                      <th className="py-3">Date</th>
                      <th className="py-3 text-right">Amount</th>
                      <th className="py-3 pr-5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((exp: any) => (
                      <tr key={exp.id} className="border-b border-slate-900/[0.08] text-xs transition-colors hover:bg-slate-900/[0.04]">
                        <td className="py-3.5 pl-5 text-slate-900 font-medium max-w-[220px]">
                          <div className="truncate" title={exp.description}>{exp.description}</div>
                          {exp.notes && <div className="text-[10px] text-slate-500 truncate mt-0.5" title={exp.notes}>{exp.notes}</div>}
                        </td>
                        <td className="py-3.5 text-slate-500 text-[10px]">
                          {exp.recipient_account ? (
                            <div className="truncate max-w-[150px]" title={exp.recipient_account}>{exp.recipient_account}</div>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="py-3.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#d4af37]/8 text-[#8a6d1f] border border-[#d4af37]/15 text-[9px] font-bold uppercase">
                            <MapPin className="w-2.5 h-2.5" /> {(() => {
                              const bName = exp.branch_name || branches.find((b: any) => b.id === exp.branch_id)?.name || 'Branch';
                              return bName.length > 14 ? bName.slice(0, 14) + '…' : bName;
                            })()}
                          </span>
                        </td>
                        <td className="py-3.5 text-slate-500 text-[11px]">
                          {new Date(exp.expense_date || exp.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="py-3.5 text-right text-rose-600 font-bold">
                          {fmt(exp.amount)}
                        </td>
                        <td className="py-3.5 pr-5">
                          {canDelete && (
                            <div className="flex items-center justify-end">
                              {confirmDeleteId === exp.id ? (
                                <div className="flex items-center gap-1">
                                  <button onClick={() => handleDelete(exp.id)} className="px-3 py-2.5 rounded-md bg-rose-500/20 border border-rose-500/30 text-rose-600 text-[10px] font-bold hover:bg-rose-500/30 transition-all cursor-pointer">Confirm</button>
                                  <button onClick={() => setConfirmDeleteId(null)} className="p-2.5 rounded-md text-slate-500 hover:text-slate-900 transition-all cursor-pointer bg-slate-900/[0.04]"><X className="w-3.5 h-3.5" /></button>
                                </div>
                              ) : (
                                <button onClick={() => setConfirmDeleteId(exp.id)} className="p-2.5 rounded-md text-slate-600 hover:text-rose-600 transition-colors cursor-pointer" title="Delete expense">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* MODAL: Add Expense                                         */}
      {/* ─────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showForm && selectedHead && selectedHead.name.toLowerCase().includes('salary') && (
          <IssueSalaryModal
            isOpen={showForm}
            onClose={() => setShowForm(false)}
            onSuccess={() => {
              setShowForm(false)
              fetchExpenses(selectedHead.id)
            }}
          />
        )}

        {showForm && selectedHead && selectedHead.name.toLowerCase().includes('rent') && (
          <IssueHouseRentModal
            isOpen={showForm}
            onClose={() => setShowForm(false)}
            onSuccess={() => {
              setShowForm(false)
              fetchExpenses(selectedHead.id)
            }}
          />
        )}

        {showForm && selectedHead && selectedHead.name.toLowerCase().includes('utility') && (
          <IssueUtilityBillModal
            isOpen={showForm}
            onClose={() => setShowForm(false)}
            onSuccess={() => {
              setShowForm(false)
              fetchExpenses(selectedHead.id)
            }}
            ledgerHeadName={selectedHead.name}
            preselectedLedgerHeadId={selectedHead.id}
          />
        )}

        {showForm && selectedHead && (selectedHead.name.toLowerCase().includes('developer') || selectedHead.name.toLowerCase().includes('software')) && (
          <IssueDeveloperBillModal
            isOpen={showForm}
            onClose={() => setShowForm(false)}
            onSuccess={() => {
              setShowForm(false)
              fetchExpenses(selectedHead.id)
            }}
            ledgerHeadName={selectedHead.name}
            preselectedLedgerHeadId={selectedHead.id}
          />
        )}

        {showForm && selectedHead &&
          !selectedHead.name.toLowerCase().includes('salary') &&
          !selectedHead.name.toLowerCase().includes('rent') &&
          !selectedHead.name.toLowerCase().includes('utility') &&
          !selectedHead.name.toLowerCase().includes('developer') &&
          !selectedHead.name.toLowerCase().includes('software') && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-40" onClick={() => setShowForm(false)} />
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
                      <span className="text-[10px] bg-[#d4af37]/10 text-[#8a6d1f] border border-[#d4af37]/20 px-1.5 py-0.5 rounded uppercase font-bold">
                        {selectedHead.code_number}
                      </span>
                      <span className="text-[10px] text-slate-500">{selectedHead.name}</span>
                    </div>
                  </div>
                  <button onClick={() => setShowForm(false)} className="text-slate-600 hover:text-slate-900 transition-colors cursor-pointer p-3 rounded-lg">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Branch *</label>
                    <select required value={form.branch_id} onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all cursor-pointer">
                      <option value="" disabled>Select target branch</option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Description *</label>
                    <textarea required rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="What was this expense for?"
                      className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#d4af37]/40 transition-all resize-none" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Amount (BDT) *</label>
                      <input required type="number" step="0.01" min="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                        placeholder="0.00"
                        className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#d4af37]/40 transition-all" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Date *</label>
                      <input required type="date" value={form.expense_date} onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))}
                        className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#d4af37]/40 transition-all [color-scheme:light] cursor-pointer" />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Notes (Optional)</label>
                    <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      placeholder="Additional remarks"
                      className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#d4af37]/40 transition-all" />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={() => setShowForm(false)}
                      className="flex-1 py-2.5 border border-slate-900/8 text-slate-500 hover:text-slate-900 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer">
                      Cancel
                    </button>
                    <button type="submit" disabled={isSubmitting}
                      className="flex-1 bg-gradient-to-r from-[#d4af37] to-white text-black font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 hover:brightness-110 disabled:opacity-60 cursor-pointer shadow-lg shadow-[#d4af37]/15">
                      {isSubmitting ? <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Confirm & Save
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* MODAL: Add Ledger Head (Category)                          */}
      {/* ─────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showAddHeadModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-40" onClick={() => setShowAddHeadModal(false)} />
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
                    <h3 className="text-sm font-bold text-slate-900 font-serif">Create Ledger Category</h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">Code will be auto-generated</p>
                  </div>
                  <button onClick={() => setShowAddHeadModal(false)} className="text-slate-600 hover:text-slate-900 transition-colors cursor-pointer p-3 rounded-lg">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Form */}
                <form onSubmit={handleAddHead} className="p-6 space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Category Name *</label>
                    <input required type="text" value={addHeadForm.name} onChange={e => setAddHeadForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Utility Bills, Office Supplies"
                      className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#d4af37]/40 transition-all" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Ledger Type</label>
                      <select value={addHeadForm.ledger_type} onChange={e => setAddHeadForm(f => ({ ...f, ledger_type: e.target.value }))}
                        className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all cursor-pointer">
                        <option value="All">All</option>
                        <option value="Expenses">Expenses</option>
                        <option value="Income">Income</option>
                        <option value="Asset">Asset</option>
                        <option value="Liability">Liability</option>
                        <option value="Equity">Equity</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Ref. Date</label>
                      <input type="date" value={addHeadForm.reference_creation_date} onChange={e => setAddHeadForm(f => ({ ...f, reference_creation_date: e.target.value }))}
                        className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#d4af37]/40 transition-all [color-scheme:light] cursor-pointer" />
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={() => setShowAddHeadModal(false)}
                      className="flex-1 py-2.5 border border-slate-900/8 text-slate-500 hover:text-slate-900 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer">
                      Cancel
                    </button>
                    <button type="submit" disabled={isSubmittingHead}
                      className="flex-1 bg-gradient-to-r from-[#d4af37] to-white text-black font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 hover:brightness-110 disabled:opacity-60 cursor-pointer shadow-lg shadow-[#d4af37]/15">
                      {isSubmittingHead ? <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Create Category
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
