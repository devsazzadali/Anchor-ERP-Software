'use client'

export const dynamic = 'force-dynamic'
import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ShieldAlert, Check, Loader2, ArrowRight, ShieldCheck } from 'lucide-react'

export default function Verify2FAPage() {
  const router = useRouter()

  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const [isLoading, setIsLoading] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [error, setError] = useState('')
  const [timeLeft, setTimeLeft] = useState(0) // Will initialize in useEffect

  const [userContext, setUserContext] = useState<{ id: string, email: string, full_name: string } | null>(null)
  // BUG-R07 FIX: Track timeout so spinner doesn't hang forever on network/session failure
  const [authTimeout, setAuthTimeout] = useState(false)

  useEffect(() => {
    // Check if user is authenticated but needs 2FA
    // identity comes from /api/auth/me (session cookie).
    const checkAuth = async () => {
      const res = await fetch('/api/auth/me').catch(() => null)
      const data = res ? await res.json().catch(() => null) : null
      const user = data?.user
      if (!user) {
        router.replace('/') // Not logged in at all
        return
      }

      const profile = data.profile

      if (!profile?.is_2fa_enabled) {
        // If 2FA is not enabled, they shouldn't be here
        router.replace('/dashboard')
        return
      }

      setUserContext({
        id: user.id,
        email: user.email || '',
        full_name: profile.full_name || 'User'
      })

      // Parse expires_at from URL if present
      const params = new URLSearchParams(window.location.search)
      const expiresAtParam = params.get('expires_at')
      if (expiresAtParam) {
        const expiresAt = new Date(expiresAtParam).getTime()
        const diff = Math.floor((expiresAt - Date.now()) / 1000)
        setTimeLeft(diff > 0 ? diff : 0)
      } else {
        setTimeLeft(120) // Default fallback
      }
    }
    checkAuth()

    // BUG-R07 FIX: After 8s with no userContext, show error instead of infinite spinner
    const timeoutId = setTimeout(() => setAuthTimeout(true), 8000)
    return () => clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    if (timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [timeLeft])

  const handleOtpChange = (index: number, value: string) => {
    if (!/^[0-9]*$/.test(value)) return

    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)

    // Move to next input automatically
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData('text').slice(0, 6).replace(/[^0-9]/g, '')
    if (pastedData) {
      const newOtp = [...otp]
      for (let i = 0; i < pastedData.length; i++) {
        newOtp[i] = pastedData[i]
      }
      setOtp(newOtp)
      // Focus the next empty input or the last one
      const nextEmptyIndex = newOtp.findIndex(val => val === '')
      if (nextEmptyIndex !== -1) {
        inputRefs.current[nextEmptyIndex]?.focus()
      } else {
        inputRefs.current[5]?.focus()
      }
    }
  }

  const handleVerify = async () => {
    const code = otp.join('')
    if (code.length !== 6 || !userContext) return

    setIsLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/verify-2fa-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userContext.id,
          otpCode: code
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Verification failed')
      }

      // If successful, the cookie is set, we can go to dashboard
      router.replace('/dashboard')
    } catch (err: any) {
      setError(err.message)
      setOtp(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setIsLoading(false)
    }
  }

  const handleResend = async () => {
    if (!userContext || timeLeft > 0) return

    setIsResending(true)
    setError('')

    try {
      const res = await fetch('/api/auth/send-2fa-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userContext.id,
          email: userContext.email,
          fullName: userContext.full_name
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to resend OTP')
      }

      if (data.expires_at) {
        const expiresAt = new Date(data.expires_at).getTime()
        const diff = Math.floor((expiresAt - Date.now()) / 1000)
        setTimeLeft(diff > 0 ? diff : 0)

        // Update URL to preserve state on refresh
        const url = new URL(window.location.href)
        url.searchParams.set('expires_at', data.expires_at)
        window.history.replaceState({}, '', url.toString())
      } else {
        setTimeLeft(120) // Fallback
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsResending(false)
    }
  }

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }

  if (!userContext) {
    return (
      <div className="min-h-screen w-full bg-white flex items-center justify-center">
        {authTimeout ? (
          // BUG-R07 FIX: Timeout reached — show actionable error instead of spinning forever
          <div className="text-center">
            <ShieldAlert className="w-10 h-10 text-rose-500 mx-auto mb-4" />
            <p className="text-sm font-bold text-slate-900 mb-2">Session Expired</p>
            <p className="text-xs text-slate-500 mb-6">Could not load your session. Please sign in again.</p>
            <a href="/" className="text-[#15803d] underline text-xs">Back to Login</a>
          </div>
        ) : (
          <Loader2 className="w-8 h-8 text-[#15803d] animate-spin" />
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-white flex items-center justify-center p-4 relative overflow-hidden font-sans">
      <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-[#1ca34c]/10 rounded-full filter blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[60%] h-[60%] bg-[#1ca34c]/5 rounded-full filter blur-[150px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-slate-900/[0.05] backdrop-blur-xl border border-slate-900/10 rounded-3xl p-8 sm:p-10 shadow-[0_0_50px_rgba(28,163,76,0.05)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#1ca34c]/50 to-transparent" />

          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-[#1ca34c] flex items-center justify-center shadow-lg shadow-[#1ca34c]/25">
              <img src="/logos.png" alt="Anchor ERP Official Logo" className="w-10 h-10 object-contain brightness-0 invert" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-center text-slate-900 font-serif mb-2">Two-Step Verification</h2>
          <p className="text-sm text-center text-slate-500 mb-8">
            Enter the 6-digit code sent to <br />
            <strong className="text-slate-900">{userContext.email}</strong>
          </p>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex items-center gap-2 justify-center text-center"
            >
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}

          <div className="flex justify-between gap-2 sm:gap-3 mb-8" onPaste={handlePaste}>
            {otp.map((digit, index) => (
              <input
                key={index}
                ref={el => { inputRefs.current[index] = el }}
                type="text"
                maxLength={1}
                value={digit}
                onChange={e => handleOtpChange(index, e.target.value)}
                onKeyDown={e => handleKeyDown(index, e)}
                className="flex-1 min-w-0 h-12 sm:h-14 text-center text-xl sm:text-2xl font-bold text-slate-900 bg-white border border-slate-900/10 rounded-xl focus:border-[#1ca34c] focus:ring-1 focus:ring-[#1ca34c] outline-none transition-all"
              />
            ))}
          </div>

          <button
            onClick={handleVerify}
            disabled={isLoading || otp.join('').length !== 6}
            className="w-full bg-[#1ca34c] hover:bg-[#15803d] text-white font-bold py-4 rounded-full text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all hover:shadow-[0_0_20px_rgba(28,163,76,0.3)] disabled:opacity-50 disabled:hover:shadow-none"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
              <>
                Verify Identity
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <div className="mt-8 text-center">
            {timeLeft > 0 ? (
              <p className="text-xs text-slate-500">
                Resend code in <strong className="text-[#15803d] font-mono">{formatTime(timeLeft)}</strong>
              </p>
            ) : (
              <button
                onClick={handleResend}
                disabled={isResending}
                className="text-xs text-[#15803d] hover:text-slate-900 transition-colors font-semibold uppercase tracking-wider"
              >
                {isResending ? 'Resending...' : 'Resend Code Now'}
              </button>
            )}
          </div>
        </div>

        <div className="mt-8 text-center text-[10px] text-slate-600 uppercase tracking-widest flex items-center justify-center gap-2">
          <ShieldCheck className="w-3 h-3" />
          Secured by Anchor ERP Auth
        </div>
      </motion.div>
    </div>
  )
}
