'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, RefreshCw, AlertTriangle, CheckCircle, Clock, Eye, Image as ImageIcon } from 'lucide-react'
import Link from 'next/link'
import DepositSlipModal from '@/components/DepositSlipModal'

import { useBranchAuth } from '@/lib/hooks/use-branch-auth'
import { fetchWithCache, getCachedData } from '@/lib/branch-cache'

const fmt = (n: any) => (Number(n || 0) < 0 ? '-' : '') + '৳' + Math.abs(Number(n || 0)).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default function ManagerReconciliationPage() {
  const router = useRouter()
  const { isAuthorized, isLoading: isAuthLoading } = useBranchAuth()
  
  const [deposits, setDeposits] = useState<any[]>(() => {
    const cached = getCachedData('branch_reconciliation')
    return cached?.deposits || []
  })
  const [reconciliation, setReconciliation] = useState<any>(() => {
    const cached = getCachedData('branch_reconciliation')
    return cached?.summary?.[0] || null
  })
  const [isLoading, setIsLoading] = useState(() => !getCachedData('branch_reconciliation'))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedSlipDeposit, setSelectedSlipDeposit] = useState<any | null>(null)

  useEffect(() => {
    if (!isAuthLoading && !isAuthorized) {
      router.replace('/dashboard/branch-accounts')
    }
  }, [isAuthLoading, isAuthorized, router])

  const fetchData = useCallback(async () => {
    try {
      const json = await fetchWithCache('branch_reconciliation', '/api/branch-accounts/reconciliation', 45000)
      if (json) {
        setDeposits(json.deposits || [])
        setReconciliation(json.summary?.[0] || null)
      }
    } catch {
      // fallback
      try {
        const fallbackRes = await fetch('/api/branch-accounts/deposits')
        const fallbackJson = await fallbackRes.json()
        if (fallbackRes.ok) setDeposits(fallbackJson.deposits || [])
      } catch {}
    }
  }, [])

  useEffect(() => {
    if (!isAuthorized) return
    const cached = getCachedData('branch_reconciliation')
    if (cached?.deposits) {
      setDeposits(cached.deposits)
      setReconciliation(cached.summary?.[0] || null)
      setIsLoading(false)
    }
    fetchData().finally(() => setIsLoading(false))
  }, [isAuthorized, fetchData])

  const handleRefresh = async () => { setIsRefreshing(true); await fetchData(); setIsRefreshing(false) }

  const approved = deposits.filter(d => d.status === 'approved' && !d.is_reversed)
  const pending  = deposits.filter(d => ['submitted', 'pending_approval'].includes(d.status))
  const rejected = deposits.filter(d => d.status === 'rejected')

  const netCashCollected = reconciliation ? Number(reconciliation.net_cash_collected || 0) : approved.reduce((s, d) => s + Number(d.amount), 0)
  const totalApproved = reconciliation ? Number(reconciliation.total_approved || 0) : approved.reduce((s, d) => s + Number(d.amount), 0)
  const unbankedVariance = reconciliation ? Number(reconciliation.unbanked_cash_variance || 0) : 0

  if (isLoading) {
    return <div className="min-h-screen bg-white flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="relative z-10 p-4 md:p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard/branch-accounts" className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight">Bank & Cash Reconciliation</h1>
            <p className="text-[11px] text-slate-500">Reconcile net physical cash collections against verified bank deposits</p>
          </div>
          <button onClick={handleRefresh} className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Core Reconciliation KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20">
            <p className="text-[9px] uppercase tracking-widest text-blue-600/80 mb-1 font-semibold">Net Cash Collected</p>
            <p className="text-xl font-bold text-slate-900">{fmt(netCashCollected)}</p>
            <p className="text-[10px] text-slate-500 mt-1">Cash In − Cash Expenses</p>
          </div>
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-[9px] uppercase tracking-widest text-emerald-600/80 mb-1 font-semibold">Approved in Bank</p>
            <p className="text-xl font-bold text-emerald-600">{fmt(totalApproved)}</p>
            <p className="text-[10px] text-slate-500 mt-1">{approved.length} approved deposits</p>
          </div>
          <div className={`p-4 rounded-2xl border ${
            unbankedVariance > 500 ? 'bg-rose-500/10 border-rose-500/20' : 'bg-slate-500/10 border-slate-500/20'
          }`}>
            <p className={`text-[9px] uppercase tracking-widest mb-1 font-semibold ${
              unbankedVariance > 500 ? 'text-rose-600' : 'text-slate-500'
            }`}>
              {unbankedVariance > 500 ? 'Unbanked Cash' : unbankedVariance < -500 ? 'Excess Banked' : 'Variance'}
            </p>
            <p className={`text-xl font-bold ${
              unbankedVariance > 500 ? 'text-rose-600' : 'text-slate-900'
            }`}>
              {fmt(unbankedVariance)}
            </p>
            <p className="text-[10px] text-slate-500 mt-1">
              {unbankedVariance > 500 ? 'Cash in drawer to bank' : 'Cash vs bank status'}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-[9px] uppercase tracking-widest text-amber-600/80 mb-1 font-semibold">Pending Review</p>
            <p className="text-xl font-bold text-amber-600">{fmt(pending.reduce((s, d) => s + Number(d.amount), 0))}</p>
            <p className="text-[10px] text-slate-500 mt-1">{pending.length} under admin review</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-900/5 bg-slate-900/[0.04] overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-900/5 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">All Bank Deposits ({deposits.length})</p>
            <Link href="/dashboard/branch-accounts/bank-deposit" className="text-[10px] text-[#15803d] hover:underline font-semibold">
              + New Deposit
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-900/5 bg-slate-900/[0.04]">
                  <th className="text-left p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Date</th>
                  <th className="text-left p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Amount</th>
                  <th className="text-left p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Bank Account</th>
                  <th className="text-left p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Slip No.</th>
                  <th className="text-center p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Slip Photo</th>
                  <th className="text-left p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((dep: any) => (
                  <tr key={dep.id} className={`border-b border-slate-900/[0.08] hover:bg-slate-900/[0.04] transition-colors ${dep.is_reversed ? 'opacity-40' : ''}`}>
                    <td className="p-3.5 text-slate-600 font-mono whitespace-nowrap">{dep.deposit_date}</td>
                    <td className="p-3.5 text-[#15803d] font-bold whitespace-nowrap">{fmt(dep.amount)}</td>
                    <td className="p-3.5 text-slate-600 truncate max-w-[160px]" title={dep.bank_account_name}>{dep.bank_account_name || '—'}</td>
                    <td className="p-3.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">{dep.deposit_slip_number || '—'}</td>
                    <td className="p-3.5 text-center whitespace-nowrap">
                      {dep.slip_attachment_url ? (
                        <button
                          type="button"
                          onClick={() => setSelectedSlipDeposit(dep)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 border border-blue-500/30 text-[10px] font-semibold transition-all cursor-pointer"
                        >
                          <Eye className="w-3 h-3" /> View Slip
                        </button>
                      ) : (
                        <span className="text-slate-600 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="p-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest border ${
                          dep.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                          dep.status === 'rejected' ? 'bg-rose-500/10 text-rose-600 border-rose-500/20' :
                          dep.status === 'draft'    ? 'bg-slate-500/10 text-slate-500 border-slate-500/20' :
                          'bg-amber-500/10 text-amber-600 border-amber-500/20'
                        }`}>{dep.status.replace('_', ' ')}</span>
                        {dep.is_reversed && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest bg-slate-500/10 text-slate-500 border border-slate-500/20">Reversed</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {deposits.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-slate-500">No deposits recorded for this branch yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Deposit Slip Inspection Modal */}
      <DepositSlipModal
        isOpen={!!selectedSlipDeposit}
        onClose={() => setSelectedSlipDeposit(null)}
        deposit={selectedSlipDeposit}
      />
    </div>
  )
}
