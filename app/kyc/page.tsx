'use client'

export const dynamic = 'force-dynamic'
import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useForm, UseFormRegisterReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { kycSchema } from '@/lib/validators'
import { Shield, Upload, FileText, Check, ShieldAlert, MapPin, CreditCard } from 'lucide-react'
import { uploadFile } from '@/lib/files-client'
import { useRouter } from 'next/navigation'
import KycSignOutButton from '@/components/KycSignOutButton'

// ─── FileInput component ─────────────────────────────────────────────────────
// Receives the pre-spread register return so we avoid any dynamic `register(name)`
// call that confuses TypeScript's strict union-type inference.
interface FileInputProps {
  registration: UseFormRegisterReturn
  label: string
  error?: { message?: string }
  watchValue: FileList | undefined
}

const FileInput = ({ registration, label, error, watchValue }: FileInputProps) => (
  <div>
    <label className="block text-[11px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">
      {label}
    </label>
    <div className="relative">
      <input
        type="file"
        accept="image/*,application/pdf"
        {...registration}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
      />
      <div className="w-full bg-slate-900/[0.04] border border-slate-900/5 border-dashed hover:border-[#1ca34c]/50 rounded-xl py-4 flex flex-col items-center justify-center gap-2 transition-all">
        <Upload className="w-5 h-5 text-slate-500" />
        <span className="text-xs text-slate-500">
          {watchValue && watchValue.length > 0
            ? watchValue[0].name
            : `Click to upload ${label}`}
        </span>
      </div>
    </div>
    {error && (
      <p className="text-[10px] text-rose-600 mt-1 flex items-center gap-1">
        <ShieldAlert className="w-3 h-3" /> {String(error.message)}
      </p>
    )}
  </div>
)

// ─── Page ────────────────────────────────────────────────────────────────────
export default function KycPage() {
  const router = useRouter()
  const [role, setRole] = useState<'employee' | 'partner' | 'head_office'>('employee')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const r = params.get('role')
      const safeRole = (r === 'partner' || r === 'employee' || r === 'head_office') ? r : 'employee'
      setRole(safeRole)
    }
  }, [])

  const [kycStatus, setKycStatus] = useState<string | null>(null)
  const [loadingKyc, setLoadingKyc] = useState(true)

  // identity + latest request come from
  // /api/kyc/status (session-resolved; KYC users are not yet
  // approved). Documents upload via uploadFile to the
  // 'kyc' bucket (the old system's bucket); the dossier write goes
  // through /api/kyc/submit.
  useEffect(() => {
    const fetchStatus = async () => {
      const res = await fetch('/api/kyc/status')
      if (!res.ok) {
        setLoadingKyc(false)
        return
      }
      const { latestRequest: vr } = await res.json()
      if (vr && vr.nid_front_url) {
        setKycStatus(vr.status)
      }
      setLoadingKyc(false)
    }
    fetchStatus()
  }, [])

  useEffect(() => {
    if (!loadingKyc && kycStatus === 'pending') {
      router.replace('/kyc/pending')
    } else if (!loadingKyc && kycStatus === 'approved') {
      router.replace('/dashboard')
    }
  }, [loadingKyc, kycStatus, router])

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm({
    resolver: zodResolver(kycSchema(role)),
  })

  // ─── File upload helper ──────────────────────────────────────────────────
  const uploadFile = async (fileList: FileList, bucketPath: string) => {
    if (!fileList || fileList.length === 0) return ''
    const file = fileList[0]
    const fileExt = file.name.split('.').pop()?.toLowerCase() || 'bin'
    // SEC-03 FIX: Use crypto.randomUUID() (CSPRNG) instead of Math.random()
    // Math.random() is predictable and allows brute-force enumeration of private KYC documents
    const fileName = `${crypto.randomUUID()}.${fileExt}`
    const filePath = `${bucketPath}/${fileName}`

    // SEC-08 FIX: KYC documents contain sensitive personal identity data (NID, passport).
    // the 'kyc' bucket is NEVER public — files are
    // served only through authenticated server routes, and the
    // stored value is the canonical file URL.
    const { url } = await uploadFile('kyc', file, filePath)
    return url
  }

  // ─── Submit ──────────────────────────────────────────────────────────────
  const onSubmit = async (data: any) => {
    setIsSubmitting(true)
    setFeedback(null)

    try {
      const statusRes = await fetch('/api/kyc/status')
      if (!statusRes.ok)
        throw new Error('Not authenticated. Please log in first.')
      const statusData = await statusRes.json()
      const userData = { user: statusData.user }
      const profileData = statusData.profile

      const fullName = profileData?.full_name || 'User'

      // Check for existing KYC request for this user BEFORE uploading files to avoid storage leaks
      const existing = statusData.latestRequest

      if (existing && existing.status === 'pending') {
        throw new Error('You already have a pending KYC request. Please wait for approval.')
      }

      // Add user ID to upload path for better storage isolation and RLS compatibility
      const nidFrontUrl = await uploadFile(data.nidFront, `nid_fronts/${userData.user.id}`)
      const nidBackUrl = await uploadFile(data.nidBack, `nid_backs/${userData.user.id}`)
      const selfieUrl = await uploadFile(data.selfie, `selfies/${userData.user.id}`)

      // The server re-checks the pending rule, upserts the request
      // and updates the profile in one transaction.
      const submitRes = await fetch('/api/kyc/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: data.address,
          bank_name: data.bankName,
          account_holder_name: data.bankAccountName,
          bank_account_number: data.bankAccountNumber,
          district: data.district,
          nid_front_url: nidFrontUrl,
          nid_back_url: nidBackUrl,
          selfie_url: selfieUrl,
          profile_type: role,
        }),
      })
      const submitBody = await submitRes.json().catch(() => ({}))
      if (!submitRes.ok) throw new Error(submitBody.error || 'Failed to submit KYC.')
      const reqId = submitBody.request?.id

      // Trigger Email & Admin Notification
      fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'KYC_SUBMITTED',
          payload: { 
            userName: fullName,
            reqId: reqId,
            userId: userData.user.id
          }
        })
      }).catch(e => console.error('Failed to send KYC submission email', e));

      setFeedback({ type: 'success', message: 'Verification details submitted successfully!' })

      // Sync the local storage session with the selected profile_type
      const storedSession = localStorage.getItem('aura_session');
      if (storedSession) {
        try {
          const sessionObj = JSON.parse(storedSession);
          if (sessionObj.profile) {
            sessionObj.profile.profile_type = role;
            sessionObj.profile.verification_status = 'pending';
            localStorage.setItem('aura_session', JSON.stringify(sessionObj));
          }
        } catch (e) {
          console.error('Failed to sync local session', e);
        }
      }

      router.push('/kyc/pending')
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to submit KYC.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen bg-white text-slate-900 font-sans relative overflow-hidden flex justify-center items-center p-6"
      suppressHydrationWarning={true}
    >
      <KycSignOutButton />
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#1ca34c]/5 rounded-full filter blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] bg-[#1ca34c]/5 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="w-full max-w-2xl glass-panel p-8 rounded-2xl relative shadow-2xl overflow-hidden z-10 bg-white">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#1ca34c]/40 to-transparent" />

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[#1ca34c] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#1ca34c]/25">
            <img src="/logos.png" alt="Anchor ERP Official Logo" className="w-9 h-9 object-contain brightness-0 invert" />
          </div>
          <h1 className="text-2xl font-serif text-slate-900 tracking-wide">Verification Dossier</h1>
          <p className="text-xs text-slate-500 uppercase tracking-widest mt-2">
            Completing KYC as <strong className="text-[#15803d]">{role}</strong>
          </p>
        </div>

        {/* Feedback */}
        <AnimatePresence>
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`p-4 rounded-xl border mb-6 flex gap-3 text-xs ${
                feedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-600'
              }`}
            >
              {feedback.type === 'success' ? (
                <Check className="w-4 h-4 mt-0.5" />
              ) : (
                <ShieldAlert className="w-4 h-4 mt-0.5" />
              )}
              <span>{feedback.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Address */}
          <div className="grid grid-cols-1 gap-6">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">
                Full Address
              </label>
              <div className="relative">
                <MapPin className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-500" />
                <textarea
                  {...register('address')}
                  placeholder="Street address, City, Region..."
                  rows={3}
                  className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/50 focus:ring-1 focus:ring-[#1ca34c]/30 transition-all resize-none"
                />
              </div>
              {errors.address && (
                <p className="text-[10px] text-rose-600 mt-1">
                  {String(errors.address.message)}
                </p>
              )}
            </div>
          </div>

          {/* Bank info */}
          <div className="pt-4 border-t border-slate-900/5">
            <h3 className="text-xs font-semibold text-slate-600 tracking-widest uppercase mb-4 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[#15803d]" /> Bank Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1">Bank Name</label>
                <input
                  {...register('bankName')}
                  placeholder="e.g. City Bank"
                  className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/50"
                />
                {errors.bankName && (
                  <p className="text-[10px] text-rose-600 mt-1">
                    {String(errors.bankName.message)}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1">Account Holder Name</label>
                <input
                  {...register('bankAccountName')}
                  placeholder="e.g. Sazzad Ali"
                  className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/50"
                />
                {errors.bankAccountName && (
                  <p className="text-[10px] text-rose-600 mt-1">
                    {String(errors.bankAccountName.message)}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1">Account Number</label>
                <input
                  {...register('bankAccountNumber')}
                  placeholder="e.g. 1502XXXXX"
                  className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/50"
                />
                {errors.bankAccountNumber && (
                  <p className="text-[10px] text-rose-600 mt-1">
                    {String(errors.bankAccountNumber.message)}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1">District</label>
                <input
                  {...register('district')}
                  placeholder="e.g. Dhaka"
                  className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/50"
                />
                {errors.district && (
                  <p className="text-[10px] text-rose-600 mt-1">
                    {String(errors.district.message)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Documents */}
          <div className="pt-4 border-t border-slate-900/5">
            <h3 className="text-xs font-semibold text-slate-600 tracking-widest uppercase mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#15803d]" /> Identity Documents
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FileInput
                registration={register('nidFront')}
                label="NID Front"
                error={errors.nidFront as { message?: string } | undefined}
                watchValue={watch('nidFront') as FileList | undefined}
              />
              <FileInput
                registration={register('nidBack')}
                label="NID Back"
                error={errors.nidBack as { message?: string } | undefined}
                watchValue={watch('nidBack') as FileList | undefined}
              />
              <FileInput
                registration={register('selfie')}
                label="Selfie Photo"
                error={errors.selfie as { message?: string } | undefined}
                watchValue={watch('selfie') as FileList | undefined}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-[#1ca34c] hover:bg-[#15803d] text-white font-semibold py-4 rounded-full text-xs tracking-wider uppercase mt-8 flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-[#1ca34c]/20 transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
            ) : (
              'Submit Dossier for Verification'
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
