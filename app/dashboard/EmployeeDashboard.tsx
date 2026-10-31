'use client'

import React, { useEffect, useState, useCallback } from 'react'
import StatsCard from '@/components/stats-card'
import { ListTodo, Receipt, RefreshCw, Building2, ArrowRight } from 'lucide-react'
import Link from 'next/link'

// all three lists come from
// /api/me/overview, scoped to the caller server-side.

export default function EmployeeDashboard({ userId, userName, isBranchManager = false }: { userId: string; userName: string; isBranchManager?: boolean }) {
  const [tasks, setTasks] = useState<any[]>([])
  const [salaries, setSalaries] = useState<any[]>([])
  const [expenses, setExpenses] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/me/overview')
      if (!res.ok) throw new Error('Failed to load dashboard data')
      const data = await res.json()

      // Recent Tasks (BUG-020 FIX: assigned_to_id scoping happens server-side)
      if (data.tasks) setTasks(data.tasks)

      // Recent Salaries
      if (data.salaries) setSalaries(data.salaries)

      // Recent Expenses
      if (data.expenses) setExpenses(data.expenses)

    } catch (err) {
      console.error('Error fetching employee data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (userId) fetchData()
  }, [userId, fetchData])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchData()
    setIsRefreshing(false)
  }

  // Summary Metrics
  const activeTasks = tasks.filter(t => t.status !== 'completed').length
  const totalSalary = salaries.reduce((sum, s) => sum + Number(s.amount), 0)

  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 overflow-y-auto max-h-screen relative z-10 custom-scrollbar">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-4 border-b border-slate-900/5">
        <div className="flex items-start gap-3">
          <span className="w-1.5 h-9 rounded-full bg-[#1ca34c] shrink-0" />
          <div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900 font-serif">
            Welcome back, <span className="premium-text-gradient">{userName}</span>
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-[11px] text-slate-500">Anchor ERP Employee Access. Review your recent assignments and ledgers.</p>
            {isBranchManager && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20 flex-shrink-0">
                <Building2 className="w-2.5 h-2.5" /> Branch Manager
              </span>
            )}
          </div>
          </div>
        </div>
        <button 
          onClick={handleRefresh}
          className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all cursor-pointer active:scale-95 flex-shrink-0 ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 md:gap-5 mb-8">
        <StatsCard
          title="Active Tasks"
          value={`${activeTasks}`}
          subtext="Assigned to you"
          icon={ListTodo}
          sparklineColor="amber"
          sparklineData={[1, 2, 3, 2, 1]}
        />
        <StatsCard
          title="Total Salary Ledgers"
          value={`${totalSalary.toLocaleString()} BDT`}
          subtext="Recent payouts"
          icon={Receipt}
          sparklineColor="emerald"
          sparklineData={[5, 10, 15, 20]}
        />
      </div>

      {/* BRANCH PORTAL QUICK LINK — visible only for Branch Managers */}
      {isBranchManager && (
        <Link
          href="/dashboard/branch-accounts"
          className="group flex items-center justify-between gap-4 mb-8 p-4 rounded-2xl bg-gradient-to-r from-[#1ca34c]/10 to-[#1ca34c]/5 border border-[#1ca34c]/20 hover:border-[#1ca34c]/40 hover:from-[#1ca34c]/15 hover:to-[#1ca34c]/8 transition-all duration-300"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1ca34c]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#1ca34c]/20 transition-colors">
              <Building2 className="w-4 h-4 text-[#15803d]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#15803d] leading-tight">Branch Management Portal</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Access your branch accounts, sales, cash ledger &amp; reports</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-[#15803d]/60 group-hover:text-[#15803d] group-hover:translate-x-1 transition-all flex-shrink-0" />
        </Link>
      )}

      {/* RECENT DATA PANELS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Recent Tasks */}
        <div className="glass-panel p-4 rounded-2xl shadow-xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold text-slate-900 font-serif flex items-center gap-2"><ListTodo className="w-4 h-4 text-[#15803d]" /> Recent Tasks</h3>
          </div>
          <div className="space-y-3">
            {tasks.length === 0 ? <p className="text-xs text-slate-500 italic">No tasks assigned.</p> : tasks.slice(0, 5).map(t => (
              <div key={t.id} className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-semibold text-slate-900">{t.title}</span>
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-900/[0.04] text-slate-500 uppercase">{t.status}</span>
                </div>
                <p className="text-[10px] text-slate-500">{new Date(t.created_at).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Salaries */}
        <div className="glass-panel p-4 rounded-2xl shadow-xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold text-slate-900 font-serif flex items-center gap-2"><Receipt className="w-4 h-4 text-emerald-600" /> Recent Salary Disbursals</h3>
          </div>
          <div className="space-y-3">
            {salaries.length === 0 ? <p className="text-xs text-slate-500 italic">No salary ledgers found.</p> : salaries.slice(0, 5).map(s => (
              <div key={s.id} className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 flex justify-between items-center">
                <div>
                  <span className="text-xs font-semibold text-slate-900 block">{s.month_year || s.notes || new Date(s.payment_date).toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
                  <span className="text-[10px] text-slate-500">{new Date(s.payment_date).toLocaleDateString()}</span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs font-bold text-emerald-600">{Number(s.amount).toLocaleString()} BDT</span>
                  <span className="text-[8px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Salary Received</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
