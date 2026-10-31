'use client'

export const dynamic = 'force-dynamic'
import { loginSchema, signupSchema } from '@/lib/validators'
import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  Eye, EyeOff,
  Globe,
  Lock, Mail,
  Phone,
  Shield,
  ShieldAlert, Sparkles,
  User,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import Link from 'next/link'
// Removed invalid Google import (lucide-react does not export Google)

import { useRouter } from 'next/navigation'
import { useAuth } from './context/AuthContext'

// authentication goes through the app's own API
// (/api/auth/login, /api/auth/register backed by Prisma) — there is
// no browser database client anymore.

export default function AuthPage() {

  const { role: loginUserRole, isAuthenticated, verificationStatus, loading, refresh } = useAuth();


  const [tab, setTab] = useState<'login' | 'register'>('login')
  // BUG-016 FIX: Separate show-password states for login vs register tabs
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [showRegPassword, setShowRegPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  // Role Selection Modal
  const [showRoleModal, setShowRoleModal] = useState(false)

  // Forgot Password States
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [fpStep, setFpStep] = useState(1) // 1: Email, 2: Question, 3: Status
  const [fpEmail, setFpEmail] = useState('')
  const [fpQuestion, setFpQuestion] = useState('')
  const [fpAnswer, setFpAnswer] = useState('')
  const [fpUserId, setFpUserId] = useState('')
  const [fpLoading, setFpLoading] = useState(false)
  const [fpError, setFpError] = useState('')
  const [fpStatusMsg, setFpStatusMsg] = useState('')
  const [fpReqId, setFpReqId] = useState('')
  const [fpOtp, setFpOtp] = useState('')

  // Registration OTP States
  const [showRegOtpModal, setShowRegOtpModal] = useState(false)
  const [regOtp, setRegOtp] = useState('')
  const [tempRegData, setTempRegData] = useState<any>(null)
  const [isRegOtpLoading, setIsRegOtpLoading] = useState(false)
  const [regOtpError, setRegOtpError] = useState('')

  // Password strength variables
  const [registerPassword, setRegisterPassword] = useState('')
  const [passwordStrength, setPasswordStrength] = useState({ score: 0, label: 'Empty', color: 'bg-slate-100' })

  // Database client session setup

  const router = useRouter()
  const [role, setRole] = useState<'employee' | 'partner'>('employee')


  // Redirect users who are logged in based on their role
  useEffect(() => {
    // Wait until they choose a role if the modal is open
    if (showRoleModal) return;

    if (!loading && isAuthenticated) {
      if (loginUserRole === 'admin' || loginUserRole === 'super_admin') {
        router.replace('/admin/dashboard');
      } else if (loginUserRole === 'employee' || loginUserRole === 'partner') {
        // Only allow dashboard access if they are fully approved employees or partners
        if (verificationStatus === 'approved') {
          router.replace('/dashboard');
        } else {
          router.replace('/kyc');
        }
      } else {
        // For default 'user' role or any unverified state, send them to KYC role selection
        router.replace('/kyc/role-selection');
      }
    }
  }, [isAuthenticated, loginUserRole, verificationStatus, loading, router, showRoleModal]);


  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const r = (params.get('role') as 'employee' | 'partner') || 'employee'
      setRole(r)
    }
  }, [])
  // (BUG-031's module-scope client is gone in the app — no client.)

  // Track Password Strength
  useEffect(() => {
    if (!registerPassword) {
      setPasswordStrength({ score: 0, label: 'Empty', color: 'bg-slate-100' })
      return
    }
    let s = 0
    if (registerPassword.length >= 8) s++
    if (/[a-z]/.test(registerPassword)) s++
    if (/[A-Z]/.test(registerPassword)) s++
    if (/[0-9]/.test(registerPassword)) s++
    if (/[^A-Za-z0-9]/.test(registerPassword)) s++

    let label = 'Very Weak'
    let color = 'bg-rose-500'
    if (s >= 5) {
      label = 'Premium Secure'
      color = 'bg-emerald-500'
    } else if (s >= 4) {
      label = 'Strong'
      color = 'bg-emerald-400'
    } else if (s >= 3) {
      label = 'Good'
      color = 'bg-amber-400'
    } else if (s >= 2) {
      label = 'Weak'
      color = 'bg-rose-400'
    }
    setPasswordStrength({ score: s, label, color })
  }, [registerPassword])

  // Form Setup
  const {
    register: loginRegister,
    handleSubmit: handleLoginSubmit,
    formState: { errors: loginErrors },
    setValue: setLoginValue
  } = useForm({
    resolver: zodResolver(loginSchema)
  })

  const {
    register: regRegister,
    handleSubmit: handleRegSubmit,
    formState: { errors: regErrors },
    setValue: setRegValue,
    // watch removed (nid files not part of this form)
  } = useForm({
    resolver: zodResolver(signupSchema)
  })

  // Watch files for input visual feedbacks


  // FP Handlers (Direct Gmail OTP Flow)
  const handleFpSendOtp = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!fpEmail || !emailRegex.test(fpEmail.trim())) {
      setFpError('Please enter a valid email address.');
      return;
    }
    setFpLoading(true);
    setFpError('');
    setFpStatusMsg('');
    try {
      const res = await fetch('/api/auth/request-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fpEmail.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send verification code');
      }

      setFpReqId(data.reqId);
      setFpStep(2);
      setFpStatusMsg(data.message || 'A 6-digit verification code has been sent to your Gmail.');
    } catch (e: any) {
      setFpError(e.message);
    } finally {
      setFpLoading(false);
    }
  }

  const handleFpResendOtp = async () => {
    if (!fpEmail) return;
    setFpLoading(true);
    setFpError('');
    try {
      const res = await fetch('/api/auth/request-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fpEmail.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resend code');
      }
      if (data.reqId) setFpReqId(data.reqId);
      setFpStatusMsg('A fresh verification code has been sent to your Gmail.');
    } catch (e: any) {
      setFpError(e.message);
    } finally {
      setFpLoading(false);
    }
  }

  const handleFpVerifyOtp = async () => {
    if (!fpOtp || fpOtp.trim().length !== 6) {
      setFpError('Please enter the complete 6-digit verification code.');
      return;
    }
    setFpLoading(true);
    setFpError('');
    try {
      const res = await fetch('/api/auth/verify-reset-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reqId: fpReqId, otpCode: fpOtp.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to verify OTP code');
      }

      router.push(`/reset-password?reqId=${fpReqId}`);
    } catch (e: any) {
      setFpError(e.message);
    } finally {
      setFpLoading(false);
    }
  }

  // Handle Login
  const onLogin = async (data: any) => {
    setIsSubmitting(true)
    setFeedback(null)

    // Hardcoded bypasses removed for security.
    // All users must authenticate via the app auth API.

    try {
      // one server call replaces signInWithPassword + the
      // profile select. The server verifies the password (with
      // transparent rehash of carried-over hashes) and sets the
      // erp_session cookie.
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, password: data.password }),
      });
      const loginData = await loginRes.json();
      if (!loginRes.ok) throw new Error(loginData.error || 'Authentication failed');
      const authUser = loginData.user;
      const profile = loginData.profile;
      if (!authUser) throw new Error('Missing session data');

      const role = profile?.role || 'user';
      const status = profile?.verification_status || 'pending';
      const profile_type = profile?.profile_type || 'partner';

      // BUG-001 FIX: Never store refresh_token in localStorage (XSS risk).
      // Store only non-sensitive profile data needed by UI components.
      const sessionObj = {
        user: { id: authUser.id, email: authUser.email, full_name: profile?.full_name || 'Client' },
        profile: { role, verification_status: status, profile_type },
        // no token is stored client-side in the app — the session
        // is an HttpOnly cookie the browser manages.
      };
      localStorage.setItem('aura_session', JSON.stringify(sessionObj));

      // Also set the cache for AuthContext so sidebar renders instantly without flashing
      const authCache = {
        role: role,
        profileType: profile_type,
        verificationStatus: status,
        isAuthenticated: true
      };
      localStorage.setItem('anchor_auth_cache', JSON.stringify(authCache));

      // F1 FIX: Writing localStorage does NOT update AuthContext's
      // React state (and 'storage' events never fire in the same
      // tab), and the root layout / AuthProvider do not remount on
      // client-side navigation — so without this, the provider kept
      // the empty role from its pre-login loadProfile() and the
      // sidebar stayed hidden on the first post-login landing.
      // Await refresh() so the provider re-fetches /api/auth/me
      // (the session cookie is already set) BEFORE we navigate.
      await refresh();

      // A9: the legacy `aura_role` cookie write was removed — no
      // server code reads it (the layouts actively delete it); role
      // authority is the server-verified profile only.

      // Fetch IP & Location dynamically
      let ipAddress = 'Unknown';
      let geoLoc = 'Unknown';

      // Parse basic device info
      const ua = navigator.userAgent;
      let device = 'Unknown Device';
      if (/windows/i.test(ua)) device = 'Windows PC';
      else if (/mac/i.test(ua)) device = 'Mac';
      else if (/android/i.test(ua)) device = 'Android Device';
      else if (/iphone|ipad|ipod/i.test(ua)) device = 'iOS Device';
      else if (/linux/i.test(ua)) device = 'Linux PC';

      try {
        const geoRes = await fetch('https://ipapi.co/json/');
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData.ip) ipAddress = geoData.ip;
          if (geoData.city && geoData.country_name) geoLoc = `${geoData.city}, ${geoData.country_name}`;
        }
      } catch (err: any) {
        console.warn('Failed to fetch IP (possibly blocked by adblocker):', err.message);
      }

      const fullLocation = geoLoc !== 'Unknown' ? `${geoLoc} (${device})` : device;

      if (profile?.is_2fa_enabled) {
        // Trigger 2FA OTP sending instead
        try {
          const res = await fetch('/api/auth/send-2fa-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: authUser.id,
              email: authUser.email,
              fullName: profile?.full_name || 'User'
            })
          });
          const data = await res.json();
          if (data.expires_at) {
            router.push(`/verify-2fa?expires_at=${encodeURIComponent(data.expires_at)}`);
            return;
          }
        } catch (e: any) {
          console.warn('Failed to send 2FA OTP:', e.message);
        }

        router.push('/verify-2fa');
        return;
      }

      // Trigger Login Email (Only if 2FA is not enabled, or if it is, maybe trigger it after 2FA. For now, trigger here if no 2FA)
      fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'LOGIN',
          payload: {
            email: authUser.email,
            userName: profile?.full_name || 'User',
            ip: ipAddress,
            location: fullLocation
          }
        })
      }).catch(e => console.warn('Failed to trigger login email:', e.message));

      // BUG-018 FIX: Reset isSubmitting before navigation so button doesn't stay stuck
      setIsSubmitting(false);
      if (role === 'admin' || role === 'super_admin') {
        // A9: the legacy `demo_admin` cookie write was removed —
        // nothing reads it; admin authority is server-verified.
        router.push('/admin/dashboard');
      } else {
        router.push('/dashboard');
      }
    } catch (err: any) {
      setIsSubmitting(false);
      setFeedback({ type: 'error', message: err.message || 'Authentication failed' });
    }
  }

  // Handle Registration with OTP flow
  const onRegister = async (data: any) => {
    setIsSubmitting(true);
    setFeedback(null);
    try {
      // Step 1: Send OTP instead of creating user immediately
      const res = await fetch('/api/auth/send-register-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, fullName: data.fullName })
      });
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Failed to send OTP');
      }

      // If successful, open OTP modal and save data
      setTempRegData(data);
      setShowRegOtpModal(true);

    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Registration failed.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyRegisterOtp = async () => {
    if (!regOtp || !tempRegData) return;
    setIsRegOtpLoading(true);
    setRegOtpError('');
    try {
      // Verify OTP (the server also mints the registration proof
      // cookie that /api/auth/register requires)
      const res = await fetch('/api/auth/verify-register-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: tempRegData.email, otpCode: regOtp })
      });
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Failed to verify OTP');
      }

      // OTP verified — create the account through the app's
      // register route (creates auth user + profile, signs in).
      const regRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: tempRegData.email,
          password: tempRegData.password,
          fullName: tempRegData.fullName,
          phoneNumber: tempRegData.phoneNumber,
        }),
      });
      const regData = await regRes.json();
      if (!regRes.ok) throw new Error(regData.error || 'User creation failed');
      if (!regData.user) throw new Error('User creation failed');

      const sessionObj = {
        user: { id: regData.user.id, email: regData.user.email, full_name: tempRegData.fullName },
        profile: { role: 'user', verification_status: 'pending', profile_type: 'employee' },
        // no refresh token exists in the app (BUG-001) — the
        // session is the HttpOnly erp_session cookie.
      };
      localStorage.setItem('aura_session', JSON.stringify(sessionObj));
      // A9: legacy `aura_role` cookie write removed (never read).

      setShowRegOtpModal(false);
      router.push('/kyc/role-selection');

    } catch (err: any) {
      setRegOtpError(err.message || 'OTP Verification Failed');
    } finally {
      setIsRegOtpLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row relative bg-white text-slate-900 overflow-x-hidden font-sans" suppressHydrationWarning={true}>

      {/* Glow Backdrops */}
      <motion.div
        animate={{ scale: [1, 1.05, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#d4af37]/10 rounded-full filter blur-[120px] pointer-events-none"
      />
      <motion.div
        animate={{ scale: [1, 1.1, 1], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        className="absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] bg-slate-900/[0.07] rounded-full filter blur-[150px] pointer-events-none"
      />

      {/* Decorative Gold Border Line */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#d4af37] to-transparent z-50" />

      {/* LEFT PANEL: LUXURY BANNER & INFORMATION */}
      <div className="w-full md:w-[42%] flex flex-col justify-between p-8 md:p-16 border-b md:border-b-0 md:border-r border-slate-900/5 relative bg-gradient-to-b from-white to-white">
        <div>
          {/* Anchor ERP Identity */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="flex items-center gap-3 mb-12"
          >
            <img src="/logos.png" alt="Anchor ERP Official Logo" className="w-14 h-14 object-contain drop-shadow-lg" />
            <div>
              <h1 className="text-xl font-bold tracking-wider premium-text-gradient font-serif">ANCHOR ERP</h1>
              <p className="text-[9px] uppercase tracking-[0.25em] text-slate-500 font-sans">Enterprise & Payouts</p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
            className="space-y-6 max-w-md"
          >
            <h2 className="text-3xl md:text-4xl font-semibold leading-tight tracking-tight font-serif">
              The Next Tier of <br />
              <span className="premium-text-gradient">Financial Assurance</span>
            </h2>
            <p className="text-slate-500 text-sm leading-relaxed">
              Experience dynamic client verification and seamless liquidity payouts under an elite, real-time banking standard.
            </p>
          </motion.div>
        </div>

        {/* Feature Highlights */}
        <div className="mt-12 space-y-6">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
            className="flex gap-4 items-start group"
          >
            <div className="p-2.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/5 text-[#8a6d1f] group-hover:scale-110 group-hover:bg-[#d4af37]/10 transition-all duration-300">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-900 group-hover:text-[#8a6d1f] transition-colors duration-300">Strict KYC Protocols</h4>
              <p className="text-[11px] text-slate-500">Biometric selfie matches and high-resolution NID verification safeguards every transacting node.</p>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.5, ease: "easeOut" }}
            className="flex gap-4 items-start group"
          >
            <div className="p-2.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/5 text-[#8a6d1f] group-hover:scale-110 group-hover:bg-[#d4af37]/10 transition-all duration-300">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-900 group-hover:text-[#8a6d1f] transition-colors duration-300">Instant Liquid Payouts</h4>
              <p className="text-[11px] text-slate-500">Direct integration to Premium Bangladeshi Mobile Banking channels (bKash/Nagad/Rocket) and SWIFT bank protocols.</p>
            </div>
          </motion.div>
        </div>

        {/* Bottom Status */}
        <div className="mt-12 pt-6 border-t border-slate-900/5 flex items-center justify-between text-[10px] text-slate-500">
          <span>ANCHOR ERP Ledger System</span>
          <span>v2.4.0 Secure</span>
        </div>
      </div>

      {/* RIGHT PANEL: INTERACTIVE FORM WITH SLIDING ANIMATIONS */}
      <div className="flex-1 flex flex-col justify-center items-center p-4 sm:p-6 md:p-12 relative bg-white">

        {/* Auth Floating Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3, ease: "easeOut" }}
          className="w-full max-w-lg glass-panel p-5 sm:p-6 md:p-8 rounded-2xl relative shadow-2xl overflow-hidden backdrop-blur-xl bg-white border border-slate-900/10"
        >

          {/* Card Accent Top Glow */}
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/40 to-transparent" />

          {/* Form Tabs Toggle */}
          <div className="flex w-full bg-white p-1.5 rounded-xl border border-slate-900/5 mb-8 relative">
            <button
              onClick={() => { setTab('login'); setFeedback(null); }}
              className={`flex-1 text-center py-2.5 rounded-lg text-xs font-semibold tracking-wide transition-all z-10 ${tab === 'login' ? 'text-black font-bold' : 'text-slate-500'
                }`}
            >
              Sign In to Account
            </button>
            <button
              onClick={() => { setTab('register'); setFeedback(null); }}
              className={`flex-1 text-center py-2.5 rounded-lg text-xs font-semibold tracking-wide transition-all z-10 ${tab === 'register' ? 'text-black font-bold' : 'text-slate-500'
                }`}
            >
              Request Account Activation
            </button>
            {/* Sliding highlight pill */}
            <motion.div
              layout
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              className="absolute top-1.5 bottom-1.5 left-1.5 rounded-lg bg-gradient-to-r from-[#d4af37] to-white shadow"
              style={{
                width: 'calc(50% - 12px)',
                x: tab === 'login' ? 0 : '100%',
              }}
            />
          </div>

          {/* Alert messages */}
          <AnimatePresence mode="wait">
            {feedback && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`p-4 rounded-xl border mb-6 flex gap-3 text-xs ${feedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-600'
                  }`}
              >
                {feedback.type === 'success' ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />}
                <span>{feedback.message}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* FORM PANELS */}
          <AnimatePresence mode="wait">
            {tab === 'login' ? (
              <motion.form
                key="login-form"
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                onSubmit={handleLoginSubmit(onLogin)}
                className="space-y-5"
              >
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Registered Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="email"
                      {...loginRegister('email')}
                      placeholder="anchorfashionsupport@gmail.com"
                      className="w-full bg-white hover:bg-white border border-slate-900/5 hover:border-slate-900/10 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30 transition-all duration-300 shadow-inner"
                    />
                  </div>
                  {loginErrors.email && (
                    <p className="text-[10px] text-rose-600 mt-1 flex items-center gap-1"><X className="w-3 h-3" /> {String(loginErrors.email.message)}</p>
                  )}
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-[11px] font-semibold text-slate-500 tracking-wider uppercase">Secure Password</label>
                    <button
                      type="button"
                      onClick={() => { setShowForgotPassword(true); setFpStep(1); setFpError(''); setFpEmail(''); setFpOtp(''); }}
                      className="text-[10px] text-[#8a6d1f] hover:underline bg-transparent border-none cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type={showLoginPassword ? 'text' : 'password'}
                      {...loginRegister('password')}
                      placeholder="••••••••"
                      className="w-full bg-white hover:bg-white border border-slate-900/5 hover:border-slate-900/10 rounded-xl py-3 pl-10 pr-10 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30 transition-all duration-300 shadow-inner"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword(!showLoginPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 p-2.5 min-w-[40px] min-h-[40px] flex items-center justify-center"
                    >
                      {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {loginErrors.password && (
                    <p className="text-[10px] text-rose-600 mt-1 flex items-center gap-1"><X className="w-3 h-3" /> {String(loginErrors.password.message)}</p>
                  )}
                </div>

                {/* Real Live Access only */}

                <motion.button
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full relative group bg-gradient-to-r from-[#d4af37] to-white text-black font-semibold py-3.5 rounded-xl text-xs tracking-wider uppercase mt-4 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-55 transition-all overflow-hidden shadow-lg shadow-[#d4af37]/20"
                >
                  <div className="absolute inset-0 bg-slate-900/[0.09] group-hover:translate-x-full -translate-x-full transition-transform duration-500 ease-out skew-x-12" />
                  {isSubmitting ? (
                    <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : 'Access Private Dashboard'}
                </motion.button>
              </motion.form>
            ) : (
              <motion.form
                key="register-form"
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                onSubmit={handleRegSubmit(onRegister)}
                className="space-y-4 max-h-[60vh] overflow-y-auto pr-2"
              >
                <div>
                  {/* Full Name */}
                  <label className="block text-[11px] font-semibold text-slate-500 tracking-wider uppercase mb-1">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      {...regRegister('fullName')}
                      placeholder="Full Name"
                      className="w-full bg-white hover:bg-white border border-slate-900/5 hover:border-slate-900/10 rounded-xl py-2.5 pl-9 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30 transition-all duration-300 shadow-inner"
                    />
                  </div>
                  {regErrors.fullName && (
                    <p className="text-[9px] text-rose-600 mt-1">{String(regErrors.fullName.message)}</p>
                  )}
                </div>
                <div>
                  {/* Email */}
                  <label className="block text-[11px] font-semibold text-slate-500 tracking-wider uppercase mb-1">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="email"
                      {...regRegister('email')}
                      placeholder="anchorfashionsupport@gmail.com"
                      className="w-full bg-white hover:bg-white border border-slate-900/5 hover:border-slate-900/10 rounded-xl py-2.5 pl-9 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30 transition-all duration-300 shadow-inner"
                    />
                  </div>
                  {regErrors.email && (
                    <p className="text-[9px] text-rose-600 mt-1">{String(regErrors.email.message)}</p>
                  )}
                </div>
                <div>
                  {/* Phone Number */}
                  <label className="block text-[11px] font-semibold text-slate-500 tracking-wider uppercase mb-1">Phone Number</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="tel"
                      {...regRegister('phoneNumber')}
                      placeholder="Phone Number"
                      className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2.5 pl-9 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/50 transition-all"
                    />
                  </div>
                  {regErrors.phoneNumber && (
                    <p className="text-[9px] text-rose-600 mt-1">{String(regErrors.phoneNumber.message)}</p>
                  )}
                </div>
                <div>
                  {/* Password */}
                  <label className="block text-[11px] font-semibold text-slate-500 tracking-wider uppercase mb-1">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type={showRegPassword ? 'text' : 'password'}
                      {...regRegister('password')}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-white hover:bg-white border border-slate-900/5 hover:border-slate-900/10 rounded-xl py-2.5 pl-9 pr-10 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30 transition-all duration-300 shadow-inner"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPassword(!showRegPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 p-2.5 min-w-[40px] min-h-[40px] flex items-center justify-center"
                    >
                      {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {regErrors.password && (
                    <p className="text-[9px] text-rose-600 mt-1">{String(regErrors.password.message)}</p>
                  )}
                </div>

                <motion.button
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full relative group bg-gradient-to-r from-[#d4af37] to-white text-black font-semibold py-3.5 rounded-xl text-xs tracking-wider uppercase mt-4 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-55 transition-all overflow-hidden shadow-lg shadow-[#d4af37]/20"
                >
                  <div className="absolute inset-0 bg-slate-900/[0.09] group-hover:translate-x-full -translate-x-full transition-transform duration-500 ease-out skew-x-12" />
                  {isSubmitting ? (
                    <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : 'Submit Verification Request'}
                </motion.button>
              </motion.form>
            )}
          </AnimatePresence>

        </motion.div>
      </div>

      {/* Role Selection Modal */}
      <AnimatePresence>
        {showRoleModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white border border-slate-900/10 rounded-2xl p-8 max-w-sm w-full shadow-2xl relative max-h-[90vh] overflow-y-auto"
            >
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/60 to-transparent" />

              <div className="text-center mb-8">
                <div className="w-12 h-12 rounded-full bg-[#d4af37]/10 flex items-center justify-center mx-auto mb-4 border border-[#d4af37]/20">
                  <Check className="w-6 h-6 text-[#8a6d1f]" />
                </div>
                <h3 className="text-xl font-serif text-slate-900 mb-2 tracking-wide">Account Created</h3>
                <p className="text-xs text-slate-500">Please choose your verification profile to proceed with KYC.</p>
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => router.push('/kyc?role=employee')}
                  className="w-full relative group overflow-hidden rounded-xl border border-slate-900/5 bg-slate-900/[0.04] hover:bg-slate-900/[0.04] transition-all p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <User className="w-5 h-5 text-slate-500 group-hover:text-[#8a6d1f] transition-colors" />
                    <div className="text-left">
                      <div className="text-sm font-semibold text-slate-900">Verify as Employee</div>
                      <div className="text-[10px] text-slate-500">Standard ledger access</div>
                    </div>
                  </div>
                  <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center border border-slate-900/5 group-hover:border-[#d4af37]/30 transition-colors">
                    <div className="w-2 h-2 rounded-full bg-[#d4af37] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>

                <button
                  onClick={() => router.push('/kyc?role=partner')}
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* REGISTRATION OTP MODAL */}
      <AnimatePresence>
        {showRegOtpModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md p-6 rounded-2xl border border-slate-900/10 bg-white shadow-2xl text-center max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-600" />
                  Email Verification
                </h3>
                <button
                  onClick={() => setShowRegOtpModal(false)}
                  className="text-slate-500 hover:text-slate-900 transition-colors p-[10px] min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {regOtpError && (
                <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex gap-2">
                  <X className="w-4 h-4 shrink-0" />
                  <span>{regOtpError}</span>
                </div>
              )}

              <div className="space-y-4">
                <p className="text-xs text-slate-500 mb-2">An OTP has been sent to your email address ({tempRegData?.email}). Please enter it below to complete registration.</p>
                <div>
                  <input
                    type="text"
                    value={regOtp}
                    onChange={(e) => setRegOtp(e.target.value.toUpperCase())}
                    placeholder="Enter 6-digit OTP"
                    className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-center text-lg tracking-[0.5em] text-[#8a6d1f] font-bold focus:outline-none focus:border-[#d4af37]/50"
                    maxLength={6}
                  />
                </div>
                <button
                  onClick={handleVerifyRegisterOtp}
                  disabled={isRegOtpLoading || regOtp.length !== 6}
                  className="w-full bg-[#d4af37] text-black font-semibold py-3 rounded-xl text-xs uppercase disabled:opacity-50"
                >
                  {isRegOtpLoading ? 'Verifying...' : 'Verify & Register'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FORGOT PASSWORD MODAL */}
      <AnimatePresence>
        {showForgotPassword && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md p-6 sm:p-7 rounded-2xl border border-slate-900/10 bg-white shadow-2xl relative max-h-[90vh] overflow-y-auto"
            >
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#d4af37]/60 to-transparent" />

              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2 font-serif">
                  <ShieldAlert className="w-5 h-5 text-[#8a6d1f]" />
                  Account Recovery
                </h3>
                <button
                  onClick={() => setShowForgotPassword(false)}
                  className="text-slate-500 hover:text-slate-900 transition-colors p-[10px] min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg hover:bg-slate-900/[0.04]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {fpError && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex gap-2 items-start"
                >
                  <X className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{fpError}</span>
                </motion.div>
              )}

              {fpStatusMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs flex gap-2 items-start"
                >
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{fpStatusMsg}</span>
                </motion.div>
              )}

              {/* STEP 1: ENTER EMAIL */}
              {fpStep === 1 && (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Enter your registered email address. We will send a secure 6-digit verification code directly to your Gmail.
                  </p>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Registered Email</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="email"
                        value={fpEmail}
                        onChange={(e) => setFpEmail(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleFpSendOtp(); }}
                        placeholder="yourname@gmail.com"
                        autoFocus
                        className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/30 transition-all"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleFpSendOtp}
                    disabled={fpLoading || !fpEmail}
                    className="w-full bg-gradient-to-r from-[#d4af37] to-white text-black font-bold py-3.5 rounded-xl text-xs uppercase tracking-wider disabled:opacity-50 hover:shadow-lg hover:shadow-[#d4af37]/15 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {fpLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                        <span>Sending Code to Gmail...</span>
                      </>
                    ) : (
                      'Send Verification Code'
                    )}
                  </button>
                </div>
              )}

              {/* STEP 2: ENTER OTP */}
              {fpStep === 2 && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-center">
                    <p className="text-[11px] text-slate-500">
                      Code sent to <span className="text-[#8a6d1f] font-semibold">{fpEmail}</span>
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Check your inbox or spam folder for the 6-digit code.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 text-center">
                      Enter 6-Digit Code
                    </label>
                    <input
                      type="text"
                      value={fpOtp}
                      onChange={(e) => setFpOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      onKeyDown={(e) => { if (e.key === 'Enter' && fpOtp.length === 6) handleFpVerifyOtp(); }}
                      placeholder="••••••"
                      maxLength={6}
                      autoFocus
                      className="w-full bg-white border border-slate-900/10 rounded-xl py-3.5 px-4 text-center text-2xl tracking-[0.5em] text-[#8a6d1f] font-mono font-bold focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/30 transition-all placeholder:text-slate-500"
                    />
                  </div>

                  <button
                    onClick={handleFpVerifyOtp}
                    disabled={fpLoading || fpOtp.length !== 6}
                    className="w-full bg-gradient-to-r from-[#d4af37] to-white text-black font-bold py-3.5 rounded-xl text-xs uppercase tracking-wider disabled:opacity-50 hover:shadow-lg hover:shadow-[#d4af37]/15 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {fpLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                        <span>Verifying Code...</span>
                      </>
                    ) : (
                      'Verify Code & Set Password'
                    )}
                  </button>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-900/5 text-xs">
                    <button
                      type="button"
                      onClick={handleFpResendOtp}
                      disabled={fpLoading}
                      className="text-[11px] text-[#8a6d1f] hover:underline disabled:opacity-50 transition-colors"
                    >
                      {fpLoading ? 'Resending...' : "Didn't receive code? Resend"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFpStep(1);
                        setFpOtp('');
                        setFpError('');
                        setFpStatusMsg('');
                      }}
                      className="text-[11px] text-slate-500 hover:text-slate-900 transition-colors"
                    >
                      Change Email
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
