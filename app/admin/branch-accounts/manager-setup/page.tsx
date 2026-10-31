'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  UserCog, ChevronLeft, RefreshCw, Plus, Trash2,
  AlertTriangle, CheckCircle, Building2, User, Search
} from 'lucide-react'
import Link from 'next/link'

export default function ManagerSetupPage() {
  const router = useRouter()
  const [assignments, setAssignments] = useState<any[]>([])
  const [employees, setEmployees]     = useState<any[]>([])
  const [branches,  setBranches]      = useState<any[]>([])
  const [isLoading, setIsLoading]     = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Form
  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [selectedBranch,   setSelectedBranch]   = useState('')
  const [notes,            setNotes]            = useState('')

  const checkAccess = useCallback(async () => {
    const res = await fetch('/api/auth/me')
    if (!res.ok) { router.replace('/'); return false }
    const me = await res.json()
    if (!me?.user) { router.replace('/'); return false }
    const isAdmin = !!me.is_admin
    if (!isAdmin) { router.replace('/dashboard'); return false }
    return true
  }, [router])

  const fetchData = useCallback(async () => {
    const [assignRes, optionsRes] = await Promise.all([
      fetch('/api/branch-accounts/manager'),
      fetch('/api/branch-accounts/manager/options'),
    ])
    const assignJson = await assignRes.json()
    if (assignRes.ok) setAssignments(assignJson.assignments || [])
    if (optionsRes.ok) {
      const optionsJson = await optionsRes.json()
      setEmployees(optionsJson.employees || [])
      setBranches(optionsJson.branches || [])
    }
  }, [])

  const init = useCallback(async () => {
    setIsLoading(true)
    const ok = await checkAccess()
    if (ok) await fetchData()
    setIsLoading(false)
  }, [checkAccess, fetchData])

  useEffect(() => { init() }, [init])

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmployee || !selectedBranch) {
      setError('Please select both an employee and a branch')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/branch-accounts/manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: selectedEmployee, branch_id: selectedBranch, notes }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSuccess('Manager assigned successfully!')
      setSelectedEmployee('')
      setSelectedBranch('')
      setNotes('')
      await fetchData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRemove = async (employeeId: string, name: string) => {
    if (!confirm(`Remove ${name} as Branch Manager? They will lose manager access immediately.`)) return
    try {
      const res = await fetch(`/api/branch-accounts/manager?employee_id=${employeeId}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSuccess('Manager removed')
      await fetchData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const filteredAssignments = assignments.filter(a => {
    const q = search.toLowerCase()
    return (
      a.employee?.full_name?.toLowerCase().includes(q) ||
      a.branch?.name?.toLowerCase().includes(q) ||
      a.employee?.email?.toLowerCase().includes(q)
    )
  })

  if (isLoading) {
    return <div className="min-h-screen bg-white flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-[400px] h-[400px] bg-[#1ca34c]/3 rounded-full filter blur-[130px]" />
      </div>

      <div className="relative z-10 p-4 md:p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/branch-accounts" className="p-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold font-serif flex items-center gap-2">
              <UserCog className="w-5 h-5 text-[#15803d]" /> Manager Setup
            </h1>
            <p className="text-[11px] text-slate-500">Assign employees as Branch Managers</p>
          </div>
        </div>

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

        {/* Assign form */}
        <div className="mb-8 p-6 rounded-3xl border border-[#1ca34c]/20 bg-[#1ca34c]/5">
          <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#15803d]" /> Assign New Manager
          </h3>
          <form onSubmit={handleAssign} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Select Employee *</label>
                <select
                  value={selectedEmployee}
                  onChange={e => setSelectedEmployee(e.target.value)}
                  className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-3 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/40"
                  required
                >
                  <option value="">— Select Employee —</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name} {emp.phone_number ? `· ${emp.phone_number}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Assign to Branch *</label>
                <select
                  value={selectedBranch}
                  onChange={e => setSelectedBranch(e.target.value)}
                  className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-3 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/40"
                  required
                >
                  <option value="">— Select Branch —</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Notes (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Transferred from Dhaka branch"
                className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-xs placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/40"
              />
            </div>
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 text-[11px]">
              ⚠ Assigning a new manager will automatically deactivate the previous manager for the selected branch.
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 rounded-full bg-[#1ca34c] text-white font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" /> : <UserCog className="w-4 h-4" />}
              Assign as Branch Manager
            </button>
          </form>
        </div>

        {/* Current assignments */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Current Assignments ({assignments.length})</h3>
            <div className="flex items-center gap-2 bg-slate-900/[0.04] border border-slate-900/5 rounded-xl px-3 py-2">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                className="bg-transparent text-slate-900 text-xs focus:outline-none w-32"
              />
            </div>
          </div>

          {filteredAssignments.length === 0 ? (
            <div className="text-center py-12 rounded-3xl border border-slate-900/5 bg-slate-900/[0.04]">
              <User className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No manager assignments found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAssignments.map((a: any) => (
                <div key={a.id} className={`p-5 rounded-3xl border group transition-all ${
                  a.is_active
                    ? 'border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/30'
                    : 'border-slate-900/5 bg-slate-900/[0.04] opacity-60'
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                          a.is_active ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-slate-500/10 text-slate-500 border-slate-500/20'
                        }`}>{a.is_active ? 'Active' : 'Inactive'}</span>
                      </div>
                      <div className="flex items-center gap-3 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-sm font-semibold text-slate-900">{a.employee?.full_name || '—'}</span>
                        </div>
                        <span className="text-slate-600">→</span>
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-[#15803d]" />
                          <span className="text-sm font-semibold text-[#15803d]">{a.branch?.name || '—'}</span>
                        </div>
                      </div>
                      <div className="flex gap-4 text-[10px] text-slate-500">
                        <span>📧 {a.employee?.email || '—'}</span>
                        <span>📱 {a.employee?.phone_number || '—'}</span>
                        <span>Assigned: {a.assigned_at ? new Date(a.assigned_at).toLocaleDateString() : '—'}</span>
                      </div>
                      {a.notes && <p className="text-[10px] text-slate-500 mt-1.5 italic">{a.notes}</p>}
                    </div>
                    {a.is_active && (
                      <button
                        onClick={() => handleRemove(a.employee?.id, a.employee?.full_name)}
                        className="p-2.5 rounded-xl bg-rose-500/0 hover:bg-rose-500/10 text-slate-600 hover:text-rose-600 transition-all opacity-0 group-hover:opacity-100 border border-transparent hover:border-rose-500/20"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
