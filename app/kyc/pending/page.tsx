'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Shield, Clock, ChevronRight, XCircle, ArrowRight, RefreshCw, CheckCircle2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

// status comes from /api/kyc/status
// (session-resolved — KYC users are not yet approved, so the
// A4-gated data routes cannot serve them). Sign-out goes through
// the app's /api/auth/logout.

export default function KycPendingPage() {
  const router = useRouter()
  const [verificationStatus, setVerificationStatus] = useState<string>('pending')
  const [checking, setChecking] = useState(true)

  const checkStatus = useCallback(async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/kyc/status')
      if (!res.ok) {
        setChecking(false)
        return
      }
      const { profile, latestRequest } = await res.json()
      if (profile) {
        // Verify that they actually submitted their KYC dossier (NID uploaded)
        if (profile.verification_status === 'pending') {
          if (!latestRequest || !latestRequest.nid_front_url) {
            router.replace('/kyc/role-selection')
            return
          }
        }

        setVerificationStatus(profile.verification_status)
        
        // If approved, sync profile session so the dashboard layout lets them in
        if (profile.verification_status === 'approved') {
           const sessionStr = localStorage.getItem('aura_session')
           if (sessionStr) {
             const session = JSON.parse(sessionStr)
             if (session.profile) {
               session.profile.verification_status = 'approved'
               localStorage.setItem('aura_session', JSON.stringify(session))
             }
           }
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setChecking(false)
    }
  }, [router])

  // Initial check and poll every 15 seconds
  useEffect(() => {
    checkStatus()
    const interval = setInterval(checkStatus, 15000)
    return () => clearInterval(interval)
  }, [checkStatus])

  const handleSignOut = async () => {
    try {
      localStorage.removeItem('aura_session')
      document.cookie = 'demo_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;'
      document.cookie = 'aura_role=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;'
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (e) {
      console.error(e)
    } finally {
      router.push('/')
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans relative overflow-hidden flex justify-center items-center p-6" suppressHydrationWarning={true}>
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#d4af37]/5 rounded-full filter blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] bg-amber-500/5 rounded-full filter blur-[150px] pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md glass-panel p-8 rounded-2xl relative shadow-2xl overflow-hidden z-10 bg-white text-center"
      >
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/40 to-transparent" />
        
        {checking && verificationStatus === 'pending' && false ? (
          <div className="flex flex-col items-center justify-center py-10">
            <RefreshCw className="w-8 h-8 text-[#8a6d1f] animate-spin mb-4" />
            <p className="text-xs text-slate-500 animate-pulse">Checking status...</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {verificationStatus === 'pending' && (
              <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-[#d4af37]/10 via-[#d4af37]/20 to-[#f3e5ab]/20 flex items-center justify-center mx-auto mb-6 border border-[#d4af37]/30">
                  <Clock className="w-10 h-10 text-[#8a6d1f]" />
                </div>
                <h1 className="text-2xl font-serif text-slate-900 tracking-wide mb-3">Verification Pending</h1>
                <p className="text-sm text-slate-500 mb-8 leading-relaxed">
                  Your KYC dossier has been securely encrypted and submitted. Our compliance team is currently reviewing your profile.
                </p>
                <button
                  onClick={handleSignOut}
                  className="w-full relative group overflow-hidden rounded-xl border border-slate-900/10 hover:border-[#d4af37]/50 bg-slate-900/[0.04] hover:bg-slate-900/[0.04] transition-all p-4 flex items-center justify-center gap-2"
                >
                  <span className="text-xs font-semibold tracking-wider text-slate-900">Sign In / Sign Up Other Account</span>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-[#8a6d1f] transition-colors" />
                </button>
              </motion.div>
            )}

            {verificationStatus === 'rejected' && (
              <motion.div key="rejected" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="w-20 h-20 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-6 border border-rose-500/30">
                  <XCircle className="w-10 h-10 text-rose-500" />
                </div>
                <h1 className="text-2xl font-serif text-slate-900 tracking-wide mb-3">KYC Cancelled, Try Again</h1>
                <p className="text-sm text-slate-500 mb-8 leading-relaxed">
                  Your previous KYC submission was rejected by our compliance team. Please submit a new request.
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => router.push('/kyc/role-selection')}
                    className="w-full relative group overflow-hidden rounded-xl border border-[#d4af37]/50 bg-gradient-to-r from-[#d4af37]/10 to-[#d4af37]/5 hover:from-[#d4af37]/20 hover:to-[#d4af37]/10 transition-all p-4 flex items-center justify-center gap-2"
                  >
                    <span className="text-xs font-semibold tracking-wider text-[#8a6d1f]">Submit KYC Request Again</span>
                    <ArrowRight className="w-4 h-4 text-[#8a6d1f] group-hover:translate-x-1 transition-transform" />
                  </button>
                  <button
                    onClick={handleSignOut}
                    className="w-full relative group overflow-hidden rounded-xl border border-slate-900/10 hover:border-slate-900/20 bg-slate-900/[0.04] hover:bg-slate-900/[0.04] transition-all p-4 flex items-center justify-center gap-2"
                  >
                    <span className="text-xs font-semibold tracking-wider text-slate-900">Sign In / Sign Up Again</span>
                    <ChevronRight className="w-4 h-4 text-slate-500 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </motion.div>
            )}

            {verificationStatus === 'approved' && (
              <motion.div key="approved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-6 border border-emerald-500/30">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                </div>
                <h1 className="text-2xl font-serif text-slate-900 tracking-wide mb-3">Congratulations</h1>
                <p className="text-sm text-slate-500 mb-8 leading-relaxed">
                  Your KYC verification has been approved. You now have full access to your account.
                </p>
                <button
                  onClick={() => router.push('/dashboard')}
                  className="w-full relative group overflow-hidden rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all p-4 flex items-center justify-center gap-2"
                >
                  <span className="text-xs font-semibold tracking-wider text-emerald-600">Proceed to Dashboard</span>
                  <ArrowRight className="w-4 h-4 text-emerald-500 group-hover:translate-x-1 transition-transform" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>
    </div>
  )
}
