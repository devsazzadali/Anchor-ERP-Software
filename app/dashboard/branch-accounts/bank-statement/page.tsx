'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, FileText, CheckCircle, Clock, XCircle, AlertTriangle, RefreshCw, Info } from 'lucide-react'
import Link from 'next/link'

import { useBranchAuth } from '@/lib/hooks/use-branch-auth'
import { fetchWithCache, getCachedData } from '@/lib/branch-cache'

const fmt = (n: any) => (Number(n || 0) < 0 ? '-' : '') + '৳' + Math.abs(Number(n || 0)).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default function BankStatementPage() {
  const router = useRouter()
  const { isAuthorized, isLoading: isAuthLoading } = useBranchAuth()

  const [deposits, setDeposits] = useState<any[]>(() => {
    const cached = getCachedData('branch_bank_statements')
    return cached || []
  })
  const [isLoading, setIsLoading] = useState(() => !getCachedData('branch_bank_statements'))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthLoading && !isAuthorized) {
      router.replace('/dashboard/branch-accounts')
    }
  }, [isAuthLoading, isAuthorized, router])

  const fetchDeposits = useCallback(async () => {
    try {
      const json = await fetchWithCache('branch_bank_statements_raw', '/api/branch-accounts/deposits', 45000)
      if (json?.deposits) {
        const filtered = json.deposits.filter((d: any) => d.status !== 'draft')
        setDeposits(filtered)
      } else if (json?.error) {
        setError(json.error)
      }
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    if (!isAuthorized) return
    const cached = getCachedData('branch_bank_statements_raw')
    if (cached?.deposits) {
      setDeposits(cached.deposits.filter((d: any) => d.status !== 'draft'))
      setIsLoading(false)
    }
    fetchDeposits().finally(() => setIsLoading(false))
  }, [isAuthorized, fetchDeposits])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchDeposits()
    setIsRefreshing(false)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="relative z-10 p-4 md:p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard/branch-accounts"
            className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#d4af37]/20 text-slate-500 hover:text-slate-900 transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#8a6d1f]" /> Bank Statements
            </h1>
            <p className="text-[11px] text-slate-500">Submitted deposit documents and bank proofs</p>
          </div>
          <button onClick={handleRefresh}
            className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[#8a6d1f]' : ''}`}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        <div className="mb-6 p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-600 text-xs flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>All submitted deposits are listed here. Admin will verify your bank statements and approve or reject each deposit.</span>
        </div>

        {deposits.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-slate-900/5 bg-slate-900/[0.04]">
            <FileText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-500 text-sm">No submitted deposits yet</p>
            <Link href="/dashboard/branch-accounts/bank-deposit"
              className="mt-4 inline-block text-[#8a6d1f] text-xs hover:underline"
            >
              Create your first deposit →
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {deposits.map((dep: any) => (
              <div key={dep.id} className="p-5 rounded-2xl border border-slate-900/5 bg-slate-900/[0.04]">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{dep.bank_account_name}</p>
                    <p className="text-[10px] text-slate-500">{dep.deposit_date} · Slip: {dep.deposit_slip_number || '—'}</p>
                  </div>
                  <p className="text-lg font-bold font-serif text-slate-900">{fmt(dep.amount)}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {dep.slip_attachment_url ? (
                    <a href={dep.slip_attachment_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs hover:bg-emerald-500/15 transition-all"
                    >
                      <CheckCircle className="w-4 h-4" />
                      <span>View Deposit Slip</span>
                    </a>
                  ) : (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-600 text-xs">
                      <XCircle className="w-4 h-4" /> No slip uploaded
                    </div>
                  )}
                  {dep.bank_statement_url ? (
                    <a href={dep.bank_statement_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs hover:bg-emerald-500/15 transition-all"
                    >
                      <CheckCircle className="w-4 h-4" />
                      <span>View Bank Statement</span>
                    </a>
                  ) : (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-600 text-xs">
                      <XCircle className="w-4 h-4" /> No statement uploaded
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                    dep.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                    dep.status === 'rejected' ? 'bg-rose-500/10 text-rose-600 border-rose-500/20' :
                    'bg-amber-500/10 text-amber-600 border-amber-500/20'
                  }`}>{dep.status.replace('_', ' ')}</span>
                  {dep.rejection_reason && (
                    <p className="text-[10px] text-rose-600/70">Reason: {dep.rejection_reason}</p>
                  )}
                  {dep.reviewed_by_name && dep.status === 'approved' && (
                    <p className="text-[10px] text-slate-500">Approved by {dep.reviewed_by_name}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
