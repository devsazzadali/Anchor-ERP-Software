'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ShieldAlert, UserCircle, Globe } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/context/AuthContext'
import KycSignOutButton from '@/components/KycSignOutButton'

// the profile_type write goes through
// /api/kyc/select-role (server-side whitelist, own row only — A1).

export default function RoleSelectionPage() {
  const router = useRouter()
  const { role, loading, refresh } = useAuth()
  const [isUpdating, setIsUpdating] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // If they are already an admin, send them away
  useEffect(() => {
    if (mounted && !loading && (role === 'admin' || role === 'super_admin')) {
      router.replace('/admin/dashboard')
    }
  }, [mounted, loading, role, router])

  const selectRole = async (selectedRole: 'employee' | 'partner' | 'head_office') => {
    setIsUpdating(true)
    try {
      // Update their profile_type in the DB (via the API)
      const meRes = await fetch('/api/auth/me')
      if (meRes.ok) {
        await fetch('/api/kyc/select-role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile_type: selectedRole }),
        })

        // Sync the local storage session with the selected profile_type
        const storedSession = localStorage.getItem('aura_session');
        if (storedSession) {
          try {
            const sessionObj = JSON.parse(storedSession);
            if (sessionObj.profile) {
              sessionObj.profile.profile_type = selectedRole;
              localStorage.setItem('aura_session', JSON.stringify(sessionObj));
            }
          } catch (e) {
            console.error('Failed to sync local session', e);
          }
        }
        await refresh()
      }
      // Redirect to the actual KYC form
      router.push(`/kyc?role=${selectedRole}`)
    } catch (e) {
      console.error('Failed to select role', e)
      setIsUpdating(false)
    }
  }

  if (!mounted || loading || isUpdating) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-slate-900 font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-2 border-[#d4af37] border-t-transparent animate-spin" />
          <p className="text-xs text-slate-500 tracking-widest uppercase">Initializing Secure Module...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center text-slate-900 font-sans p-4 relative overflow-hidden">
      <KycSignOutButton />
      {/* Glow Backdrops */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#d4af37]/5 rounded-full filter blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] bg-amber-500/5 rounded-full filter blur-[150px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md p-6 sm:p-8 rounded-3xl border border-slate-900/10 bg-white shadow-2xl text-center relative z-10"
      >
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
            <ShieldAlert className="w-8 h-8 text-amber-600" />
          </div>
        </div>

        <h3 className="text-2xl font-bold text-slate-900 mb-2 font-serif">Select Your Profile</h3>
        <p className="text-xs text-slate-500 mb-8 leading-relaxed px-4">
          Choose your account classification to initiate the strict KYC protocol.
        </p>

        <div className="space-y-4">
          {/* Employee */}
          <button
            onClick={() => selectRole('employee')}
            disabled={isUpdating}
            className="w-full relative group overflow-hidden rounded-xl border border-slate-900/5 bg-slate-900/[0.04] hover:bg-slate-900/[0.04] transition-all p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <UserCircle className="w-5 h-5 text-slate-500 group-hover:text-[#8a6d1f] transition-colors" />
              <div className="text-left">
                <div className="text-sm font-semibold text-slate-900">Verify as Employee</div>
                <div className="text-[10px] text-slate-500">Standard ledger access</div>
              </div>
            </div>
            <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center border border-slate-900/5 group-hover:border-[#d4af37]/30 transition-colors">
              <div className="w-2 h-2 rounded-full bg-[#d4af37] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>

          {/* Head Office */}
          <button
            onClick={() => selectRole('head_office')}
            disabled={isUpdating}
            className="w-full relative group overflow-hidden rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.02] hover:bg-[#d4af37]/[0.05] transition-all p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-slate-500 group-hover:text-[#8a6d1f] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M3 7l9-4 9 4M4 7v14M20 7v14M9 21V12h6v9" />
              </svg>
              <div className="text-left">
                <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  Verify as Head Office
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#d4af37]/20 text-[#8a6d1f] font-bold uppercase tracking-wider border border-[#d4af37]/30">HO</span>
                </div>
                <div className="text-[10px] text-slate-500">Branch chalan management access</div>
              </div>
            </div>
            <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center border border-[#d4af37]/10 group-hover:border-[#d4af37]/40 transition-colors">
              <div className="w-2 h-2 rounded-full bg-[#d4af37] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>

          {/* Partner */}
          <button
            onClick={() => selectRole('partner')}
            disabled={isUpdating}
            className="w-full relative group overflow-hidden rounded-xl border border-slate-900/5 bg-slate-900/[0.04] hover:bg-slate-900/[0.04] transition-all p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Globe className="w-5 h-5 text-slate-500 group-hover:text-[#8a6d1f] transition-colors" />
              <div className="text-left">
                <div className="text-sm font-semibold text-slate-900">Verify as Partner</div>
                <div className="text-[10px] text-slate-500">Extended network access</div>
              </div>
            </div>
            <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center border border-slate-900/5 group-hover:border-[#d4af37]/30 transition-colors">
              <div className="w-2 h-2 rounded-full bg-[#d4af37] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        </div>
      </motion.div>
    </div>
  )
}
