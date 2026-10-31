'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, ShieldCheck, Check, AlertTriangle, Key,
  MapPin, Phone, Globe, Image as ImageIcon, Loader2
} from 'lucide-react'

export default function AdminSettings() {
  // Profile State
  const [profile, setProfile] = useState({
    id: '',
    full_name: '',
    phone_number: '',
    country: '',
    address: '',
    profile_photo_url: '',
    role: 'admin',
    is_2fa_enabled: false
  })

  // Password State
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // System Settings State
  const [systemSettings, setSystemSettings] = useState({
    resend_api_key_configured: false,
    sender_email: '',
    password_reset_mode: 'manual'
  })

  // UI State
  const [isLoading, setIsLoading] = useState(true)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [isSavingSystem, setIsSavingSystem] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  useEffect(() => {
    const fetchProfileData = async () => {
      try {
        // identity + own profile via /api/auth/me.
        // SEC-10 FIX: No session — redirect to login. Never fall back to localStorage for auth.
        // The old code had `role: session.user?.role || 'admin'` which was a security risk.
        const meRes = await fetch('/api/auth/me')
        const meData = await meRes.json().catch(() => null)
        const user = meData?.user
        if (!user) {
          setIsLoading(false)
          window.location.replace('/')
          return
        }

        const profileData = meData.profile
        if (profileData) {
          setProfile({
            id: profileData.id,
            full_name: profileData.full_name || '',
            phone_number: profileData.phone_number || '',
            country: profileData.country || '',
            address: profileData.address || '',
            profile_photo_url: profileData.profile_photo_url || '',
            role: profileData.role || 'employee', // Default to least-privilege role, not 'admin'
            is_2fa_enabled: profileData.is_2fa_enabled || false
          })
        }
      } catch (err: any) {
        console.error('Error fetching admin settings profile:', err.message)
        // On error, redirect to login — never expose admin UI without verified session
        window.location.replace('/')
      } finally {
        setIsLoading(false)
      }
    }

    const fetchSystemSettings = async () => {
      try {
        const res = await fetch('/api/admin/system-settings')
        const data = await res.json()
        if (data.settings) {
          setSystemSettings({
            resend_api_key_configured: data.settings.resend_api_key_configured === 'true',
            sender_email: data.settings.sender_email || '',
            password_reset_mode: data.settings.password_reset_mode || 'manual'
          })
        }
      } catch (err) {
        console.error('Error fetching system settings:', err)
      }
    }

    fetchProfileData()
    fetchSystemSettings()
  }, [])

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSavingProfile(true)
    setFeedback(null)

    try {
      // self-update goes through the A1-whitelisted
      // /api/profile/me route.
      const res = await fetch('/api/profile/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: profile.full_name,
          phone_number: profile.phone_number,
          country: profile.country,
          address: profile.address,
          profile_photo_url: profile.profile_photo_url,
          is_2fa_enabled: profile.is_2fa_enabled
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update profile')

      setFeedback({ type: 'success', message: 'Profile details updated successfully!' })
      setTimeout(() => setFeedback(null), 3000)
    } catch (err: any) {
      console.error('Failed to update profile:', err.message)
      // SEC-06 FIX: Do not silently fall back to localStorage on DB error.
      // This was giving a false 'success' message while data was not actually saved to the server.
      setFeedback({ type: 'error', message: err.message || 'Failed to update profile. Please try again.' })
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSavingPassword(true)
    setFeedback(null)

    if (password !== confirmPassword) {
      setFeedback({ type: 'error', message: 'Passwords do not match!' })
      setIsSavingPassword(false)
      return
    }

    if (password.length < 6) {
      setFeedback({ type: 'error', message: 'Password must be at least 6 characters long.' })
      setIsSavingPassword(false)
      return
    }

    try {
      // own-password change via /api/auth/change-password
      // (the old 'Auth session missing' demo-mode fake success is
      // gone — an error is an error).
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update password')

      setFeedback({ type: 'success', message: 'Security credentials updated successfully!' })
      setPassword('')
      setConfirmPassword('')
      setTimeout(() => setFeedback(null), 3000)
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update password.' })
    } finally {
      setIsSavingPassword(false)
    }
  }

  const handleSaveSystemSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSavingSystem(true)
    setFeedback(null)

    try {
      const res = await fetch('/api/admin/system-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(systemSettings)
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      setFeedback({ type: 'success', message: 'System configurations saved successfully!' })
      setTimeout(() => setFeedback(null), 3000)
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save system settings.' })
    } finally {
      setIsSavingSystem(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-white text-[#8a6d1f]">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans overflow-x-hidden relative">
      <div className="absolute top-[-10%] right-[-5%] w-[45%] h-[45%] bg-[#d4af37]/5 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="flex-1 flex flex-col p-6 max-w-5xl mx-auto z-10 w-full relative">
        <div className="mb-8 pb-4 border-b border-slate-900/5">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-serif">
            Security & <span className="premium-text-gradient">Settings</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">Manage your administrative footprint and authentication credentials.</p>
        </div>

        <AnimatePresence mode="wait">
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`p-4 rounded-xl border mb-8 flex gap-3 text-xs shadow-xl items-center ${
                feedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-600'
              }`}
            >
              {feedback.type === 'success' ? <Check className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
              <span className="font-semibold text-sm">{feedback.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start pb-10">

          {/* PROFILE CARD */}
          <div className="glass-panel p-6 sm:p-8 rounded-2xl relative shadow-xl overflow-hidden group">
            <div className="absolute top-0 right-0 w-40 h-40 bg-[#d4af37]/5 rounded-full filter blur-[80px] pointer-events-none group-hover:bg-[#d4af37]/10 transition-all duration-700" />

            <div className="flex items-center gap-3 mb-8 relative z-10">
              <div className="w-10 h-10 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/30 flex items-center justify-center text-[#8a6d1f]">
                <User className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 font-serif">Identity Configuration</h3>
                <span className="text-[10px] text-slate-500 uppercase tracking-widest">Master Profile Record</span>
              </div>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-5 relative z-10">

              {/* Profile Photo (Optional UI) */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-white border border-slate-900/5">
                <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-[#d4af37] to-white flex items-center justify-center text-xl font-black text-black shrink-0 shadow-[0_0_15px_rgba(212,175,55,0.2)]">
                  {profile.full_name?.substring(0, 2).toUpperCase() || 'AD'}
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1 flex items-center gap-1.5"><ImageIcon className="w-3 h-3" /> Avatar URL</label>
                  <input
                    type="url"
                    value={profile.profile_photo_url}
                    onChange={e => setProfile({...profile, profile_photo_url: e.target.value})}
                    placeholder="https://example.com/photo.png"
                    className="w-full bg-transparent border-b border-slate-900/10 py-1 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5">Full Name</label>
                  <input
                    required
                    type="text"
                    value={profile.full_name}
                    onChange={e => setProfile({...profile, full_name: e.target.value})}
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50 focus:bg-slate-900/[0.04] transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5 flex items-center gap-1"><Phone className="w-3 h-3" /> Phone</label>
                    <input
                      type="text"
                      value={profile.phone_number}
                      onChange={e => setProfile({...profile, phone_number: e.target.value})}
                      className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50 focus:bg-slate-900/[0.04] transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5 flex items-center gap-1"><Globe className="w-3 h-3" /> Country</label>
                    <input
                      type="text"
                      value={profile.country}
                      onChange={e => setProfile({...profile, country: e.target.value})}
                      className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50 focus:bg-slate-900/[0.04] transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5 flex items-center gap-1"><MapPin className="w-3 h-3" /> Address</label>
                  <textarea
                    rows={2}
                    value={profile.address}
                    onChange={e => setProfile({...profile, address: e.target.value})}
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50 focus:bg-slate-900/[0.04] transition-all"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="w-full bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 text-[#8a6d1f] font-bold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Save Identity Configuration
                </button>
              </div>
            </form>
          </div>

          {/* SECURITY CARD */}
          <div className="glass-panel p-6 sm:p-8 rounded-2xl relative shadow-[0_0_30px_rgba(212,175,55,0.03)] border border-[#d4af37]/20 bg-gradient-to-br from-[#d4af37]/[0.02] to-transparent overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#d4af37]/5 rounded-full filter blur-[100px] pointer-events-none" />

            <div className="flex items-center gap-3 mb-6 relative z-10">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-600">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 font-serif">Security Gateway</h3>
                <span className="text-[10px] text-slate-500 uppercase tracking-widest">Authentication Credentials</span>
              </div>
            </div>

            <div className="bg-rose-500/5 border border-rose-500/10 rounded-xl p-4 mb-6 relative z-10 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <div className="text-[10px] text-slate-600 leading-relaxed font-sans">
                <strong className="text-rose-600 uppercase tracking-wider block mb-0.5">Cryptographic Notice</strong>
                Old passwords cannot be retrieved or viewed. Passwords are irreversibly hashed using bcrypt. If you update your credentials, your active sessions may be terminated for security purposes.
              </div>
            </div>

            <form onSubmit={handleUpdatePassword} className="space-y-5 relative z-10">
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5 flex items-center gap-1.5"><Key className="w-3 h-3" /> New Password</label>
                  <input
                    required
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-3.5 px-4 text-xs text-slate-900 focus:outline-none focus:border-rose-500/50 focus:bg-slate-900/[0.04] transition-all font-mono tracking-widest"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5 flex items-center gap-1.5"><Check className="w-3 h-3" /> Confirm New Password</label>
                  <input
                    required
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-3.5 px-4 text-xs text-slate-900 focus:outline-none focus:border-rose-500/50 focus:bg-slate-900/[0.04] transition-all font-mono tracking-widest"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSavingPassword || !password || !confirmPassword}
                  className="w-full bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 font-bold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSavingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Enforce Security Update
                </button>
              </div>
            </form>

          </div>

          {/* TWO-FACTOR AUTHENTICATION (2FA) */}
          <div className="glass-panel p-6 sm:p-8 rounded-2xl relative shadow-[0_0_30px_rgba(212,175,55,0.03)] border border-[#d4af37]/20 bg-gradient-to-br from-[#d4af37]/[0.02] to-transparent overflow-hidden mt-8">
            <div className="flex items-center justify-between mb-2 relative z-10">
              <span className="text-sm font-bold text-slate-900 uppercase tracking-widest flex items-center gap-2">
                <ShieldCheck className={`w-5 h-5 ${profile.is_2fa_enabled ? 'text-emerald-600' : 'text-slate-500'}`} />
                Two-Factor Authentication (2FA)
              </span>

              {/* Toggle Switch */}
              <button
                type="button"
                onClick={async () => {
                  const newStatus = !profile.is_2fa_enabled;
                  setProfile({ ...profile, is_2fa_enabled: newStatus });
                  try {
                    const res = await fetch('/api/profile/me', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ is_2fa_enabled: newStatus })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to update 2FA status');
                    setFeedback({ type: 'success', message: `2FA ${newStatus ? 'Enabled' : 'Disabled'} successfully!` });
                    setTimeout(() => setFeedback(null), 3000);
                  } catch (e: any) {
                    setFeedback({ type: 'error', message: 'Failed to update 2FA status.' });
                  }
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${profile.is_2fa_enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${profile.is_2fa_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <p className="text-xs text-slate-500 relative z-10 mt-2">
              When enabled, you will be required to enter a 6-digit OTP sent to your email each time you log in. This heavily restricts unauthorized access.
            </p>
          </div>

          {/* System Configuration Card */}
          <div className="bg-slate-900/[0.05] backdrop-blur-md border border-slate-900/10 rounded-2xl p-6 lg:p-8 mt-8 shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#d4af37]/5 rounded-bl-full pointer-events-none transition-transform duration-700 group-hover:scale-110" />

            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 rounded-full bg-[#d4af37]/10 flex items-center justify-center border border-[#d4af37]/20">
                <Globe className="w-6 h-6 text-[#8a6d1f]" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 font-serif tracking-wide">System Configuration</h3>
                <p className="text-xs text-slate-500 mt-1">Manage global platform APIs like Resend Email configurations.</p>
              </div>
            </div>

            <form onSubmit={handleSaveSystemSettings} className="space-y-5 relative z-10">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider ml-1">Resend API Key</label>
                <div className="relative group">
                  <Key className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <div className="w-full bg-white border border-slate-900/5 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-600">
                    {systemSettings.resend_api_key_configured
                      ? 'Configured on the server (environment variable) ✓'
                      : 'Not configured — set RESEND_API_KEY in the server environment'}
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 ml-1">Secrets are no longer stored in the database or shown here.</p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider ml-1">Sender Email</label>
                <div className="relative group">
                  <AlertTriangle className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-[#8a6d1f] transition-colors" />
                  <input
                    type="email"
                    value={systemSettings.sender_email}
                    onChange={e => setSystemSettings({...systemSettings, sender_email: e.target.value})}
                    placeholder="anchorfashionsupport@gmail.com"
                    className="w-full bg-white border border-slate-900/5 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/50 transition-all text-slate-900 placeholder-slate-600"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider ml-1">Password Reset Workflow</label>
                <div className="relative group">
                  <ShieldCheck className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-[#8a6d1f] transition-colors" />
                  <select
                    value={systemSettings.password_reset_mode}
                    onChange={e => setSystemSettings({...systemSettings, password_reset_mode: e.target.value})}
                    className="w-full bg-white border border-slate-900/5 rounded-xl pl-10 pr-8 py-3 text-sm focus:outline-none focus:border-[#d4af37]/50 focus:ring-1 focus:ring-[#d4af37]/50 transition-all text-slate-900 appearance-none"
                  >
                    <option value="manual">Manual Admin Approval (Legacy)</option>
                    <option value="otp">Email OTP (Automated)</option>
                  </select>
                </div>
                <p className="text-[10px] text-slate-500 mt-1 ml-1">Choose 'Email OTP' to automatically send verification codes to users.</p>
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={isSavingSystem}
                  className="w-full py-3.5 bg-gradient-to-r from-[#d4af37] to-[#e7c996] text-black font-bold rounded-xl hover:opacity-90 transition-all focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSavingSystem ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Saving Configuration...</>
                  ) : (
                    'Save System Configuration'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
