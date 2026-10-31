'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { ShieldAlert, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function BranchExpensesPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-white text-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full p-8 rounded-3xl bg-white border border-slate-900/5 shadow-2xl text-center relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-[-20%] left-[-10%] w-[140%] h-[140%] bg-rose-500/5 rounded-full filter blur-[100px] pointer-events-none" />

        <div className="relative z-10">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600 shadow-inner">
            <ShieldAlert className="w-8 h-8" />
          </div>
          
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-3">Feature Moved</h1>
          
          <p className="text-slate-500 text-sm mb-8 leading-relaxed">
            The Branch Expenses feature has been moved to the <span className="text-slate-900 font-medium">Head Office</span>. 
            Branch Managers can no longer add or modify expenses directly from this dashboard.
          </p>
          
          <div className="space-y-3">
            <Link 
              href="/dashboard/branch-accounts"
              className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:bg-slate-900/[0.04] hover:border-slate-900/20 transition-all text-sm font-semibold text-slate-900 group"
            >
              <ArrowLeft className="w-4 h-4 text-slate-500 group-hover:text-slate-900 transition-colors" />
              Return to Branch Accounts
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

