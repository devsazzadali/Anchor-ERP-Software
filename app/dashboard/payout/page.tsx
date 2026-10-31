'use client'

export const dynamic = 'force-dynamic'

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { paymentSchema } from '@/lib/validators'
// Sidebar import removed (handled by layout)
import { 
  FileText, CreditCard, Landmark, Phone, User, 
  Upload, Sparkles, Check, ChevronRight, X, AlertTriangle
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { uploadFile } from '@/lib/files-client'

// identity + KYC prefill come from the
// app session (/api/auth/me, /api/kyc/status); the invoice file
// uploads via uploadFile ('invoices' bucket) and the request is
// created through POST /api/payouts (server sets user_id).

export default function PayoutRequest() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const initUser = async () => {
      let uid = null;
      const meRes = await fetch('/api/auth/me')
      const me = meRes.ok ? await meRes.json().catch(() => null) : null
      if (me?.user) {
        uid = me.user.id;
      } else {
        // Fallback to localStorage session
        const sessionStr = localStorage.getItem('aura_session')
        if (sessionStr) {
          try {
            const session = JSON.parse(sessionStr)
            uid = session.user?.id || null
          } catch (e) {}
        }
      }
      
      if (uid) {
        setUserId(uid);
        
        // Fetch existing KYC details to pre-fill bank/payment info
        const kycRes = await fetch('/api/kyc/status')
        const kycData = kycRes.ok ? (await kycRes.json().catch(() => null))?.latestRequest : null

        if (kycData) {
          // Pre-fill fields if they exist in KYC
          if (kycData.bank_name) setValue('bankName', kycData.bank_name);
          if (kycData.account_holder_name) setValue('accountName', kycData.account_holder_name);
          if (kycData.bank_account_number) setValue('accountNumber', kycData.bank_account_number);
          if (kycData.district) setValue('district', kycData.district);
          if (kycData.phone_number) setValue('mobileNumber', kycData.phone_number);
          if (kycData.full_name && !kycData.account_holder_name) setValue('accountName', kycData.full_name);
        }
      }
    }
    initUser()
  }, [])

  const [selectedMethod, setSelectedMethod] = useState<'bkash' | 'nagad' | 'rocket' | 'bank_transfer'>('bkash')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  // React Hook Form Configuration
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors }
  } = useForm({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      currency: 'BDT',
      paymentMethod: 'bkash',
      invoiceTitle: '',
      invoiceNumber: '',
      amount: 0,
      description: '',
      accountName: '',
      mobileNumber: '',
      bankName: '',
      accountNumber: '',
      district: '',
      branchName: '',
      swiftCode: ''
    }
  })

  const invoiceFile = watch('invoiceFile')

  // Change payment method dynamically
  const changeMethod = (method: 'bkash' | 'nagad' | 'rocket' | 'bank_transfer') => {
    setSelectedMethod(method)
    setValue('paymentMethod', method)
  }

  // Demo OCR functionality removed

  // Handle Form Submission
  const onSubmit = async (data: any) => {
    setIsSubmitting(true)
    setFeedback(null)

    try {
      if (!userId) throw new Error('User not authenticated. Please log in again.')
      if (Number(data.amount) <= 0) throw new Error('Payout request amount must be greater than zero.')

      // Upload invoice file to storage
      // BUG-A3 FIX: Use null (not '') when no file is selected, to avoid broken links in admin panel
      let invoiceFileUrl: string | null = null
      if (data.invoiceFile && data.invoiceFile[0]) {
        const file = data.invoiceFile[0]
        const path = `${userId}/inv_${Date.now()}_${file.name}`
        const uploaded = await uploadFile('invoices', file, path)
        invoiceFileUrl = uploaded.url
      }

      // Build payout record (user_id is set server-side from the session)
      const payoutRecord: Record<string, any> = {
        invoice_title: data.invoiceTitle,
        invoice_number: data.invoiceNumber,
        description: data.description || null,
        amount: Number(data.amount),
        currency: data.currency || 'BDT',
        invoice_file_url: invoiceFileUrl,
        payment_method: data.paymentMethod,
        status: 'pending',
        payment_details: {
          account_name: data.accountName || null,
          mobile_number: data.mobileNumber || null,
          bank_name: data.bankName || null,
          account_number: data.accountNumber || null,
          district: data.district || null,
          branch_name: data.branchName || null,
          swift_code: data.swiftCode || null,
        }
      }

      const res = await fetch('/api/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payoutRecord)
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(result.error || 'Submission failed. Please try again.')
      const insertedReq = result.request

      // Trigger Email & Admin Notification
      fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'PAYOUT_REQUESTED',
          payload: { 
            userName: data.accountName || 'Partner', 
            amount: data.amount, 
            currency: data.currency || 'BDT',
            reqId: insertedReq?.id 
          }
        })
      }).catch(e => console.error('Failed to trigger payout email', e));

      setFeedback({ 
        type: 'success', 
        message: 'Your payout request invoice has been submitted successfully to the executive queue!' 
      })

      setTimeout(() => {
        router.push('/dashboard')
      }, 1500)
    } catch (err: any) {
      setFeedback({ 
        type: 'error', 
        message: err.message || 'Submission failed. Please try again.' 
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return <div className="flex-1 min-h-screen flex flex-col bg-white text-slate-900 font-sans">
      
      {/* Background neon gold filter */}
      <div className="absolute top-[-10%] left-[20%] w-[50%] h-[50%] bg-[#1ca34c]/3 rounded-full filter blur-[150px] pointer-events-none" />

      {/* Main Form container */}
      <div className="flex-1 flex flex-col p-6 overflow-y-auto max-h-screen relative z-10">
        
        {/* Upper title */}
        <div className="mb-8 pb-4 border-b border-slate-900/5 flex justify-between items-center">
          <div className="flex items-start gap-3">
            <span className="w-1.5 h-9 rounded-full bg-[#1ca34c] shrink-0" />
            <div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 font-serif">
              Submit <span className="premium-text-gradient">Payout Invoice</span>
            </h2>
            <p className="text-[11px] text-slate-500">Request account settlement liquidity. High-integrity compliance verified.</p>
            </div>
          </div>
        </div>

        {/* Notification UI removed per user request */}

        {/* Double Column Form Layout */}
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT COLUMN: CORE DOCUMENT UPLOAD & OCR SCANNER */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Invoice File Drag Container */}
            <div className="glass-panel p-6 rounded-2xl relative shadow-xl">
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#1ca34c]/20 to-transparent" />
              
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-4">Invoice Attachment</span>
              
              <label className="flex flex-col justify-center items-center h-48 bg-slate-900/[0.04] hover:bg-slate-900/[0.04] border border-dashed border-slate-900/10 hover:border-[#1ca34c]/30 rounded-2xl cursor-pointer relative overflow-hidden transition-all group">
                <input
                  type="file"
                  accept=".jpg,.png,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    setValue('invoiceFile', e.target.files)
                  }}
                />
                
                {/* Visual state selector */}
                <div className="text-center p-4 space-y-2">
                  <div className="w-12 h-12 rounded-xl bg-white border border-slate-900/10 flex items-center justify-center mx-auto text-slate-500 group-hover:text-[#15803d] transition-all">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-slate-900 block">Upload Invoice Document</span>
                    <span className="text-[10px] text-slate-500 mt-1 block">Supports PDF, PNG, JPG (Max 5MB)</span>
                  </div>
                </div>

                {invoiceFile && invoiceFile.length > 0 && (
                  <div className="absolute inset-0 bg-slate-900/[0.05] flex flex-col justify-center items-center p-4">
                    <FileText className="w-8 h-8 text-[#15803d] mb-2" />
                    <span className="text-xs font-semibold text-slate-900 truncate max-w-xs">{invoiceFile[0].name}</span>
                    <span className="text-[10px] text-slate-500 mt-1">File attached successfully</span>
                  </div>
                )}
              </label>

              {errors.invoiceFile && (
                <p className="text-[10px] text-rose-600 mt-2 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {String(errors.invoiceFile.message)}</p>
              )}
            </div>

            {/* Demo OCR UI removed */}

          </div>

          {/* RIGHT COLUMN: DETAILED SPECIFICATIONS & SPECIFIC GATEWAY SELECTIONS */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* INVOICE META DETAILS */}
            <div className="glass-panel p-6 rounded-2xl relative shadow-xl">
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#1ca34c]/20 to-transparent" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-5">Billing Ledger Meta</span>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Invoice Legal Title</label>
                  <input
                    type="text"
                    {...register('invoiceTitle')}
                    placeholder="e.g. Contract Retainer (May)"
                    className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all"
                  />
                  {errors.invoiceTitle && <p className="text-[9px] text-rose-600 mt-1">{String(errors.invoiceTitle.message)}</p>}
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Invoice Reference Reference</label>
                  <input
                    type="text"
                    {...register('invoiceNumber')}
                    placeholder="e.g. INV-2026-102"
                    className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all"
                  />
                  {errors.invoiceNumber && <p className="text-[9px] text-rose-600 mt-1">{String(errors.invoiceNumber.message)}</p>}
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Liquidity Amount (BDT)</label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('amount')}
                    placeholder="0.00"
                    className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all"
                  />
                  {errors.amount && <p className="text-[9px] text-rose-600 mt-1">{String(errors.amount.message)}</p>}
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Description / Memo</label>
                  <input
                    type="text"
                    {...register('description')}
                    placeholder="Technical services provided..."
                    className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-all"
                  />
                </div>
              </div>
            </div>

            {/* GATEWAY TRANSFER TARGET SELECTOR */}
            <div className="glass-panel p-6 rounded-2xl relative shadow-xl">
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#1ca34c]/20 to-transparent" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-4">Payout Clearance Channels</span>

              {/* Grid Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                {[
                  { id: 'bkash', name: 'bKash Mobile', icon: Phone },
                  { id: 'nagad', name: 'Nagad Mobile', icon: Phone },
                  { id: 'rocket', name: 'Rocket Mobile', icon: Phone },
                  { id: 'bank_transfer', name: 'Bank Protocol', icon: Landmark }
                ].map((item) => {
                  const isChosen = selectedMethod === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => changeMethod(item.id as any)}
                      className={`p-3 rounded-xl border flex flex-col items-center gap-2 cursor-pointer transition-all ${
                        isChosen 
                          ? 'bg-[#1ca34c]/10 border-[#1ca34c] text-slate-900 shadow-lg shadow-[#1ca34c]/5' 
                          : 'bg-slate-900/[0.04] border-slate-900/5 text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04]'
                      }`}
                    >
                      <item.icon className={`w-4 h-4 ${isChosen ? 'text-[#15803d]' : ''}`} />
                      <span className="text-[10px] font-semibold">{item.name}</span>
                    </button>
                  )
                })}
              </div>

              {/* CONDITIONAL GATEWAY FORM SPECIFICATIONS */}
              <div className="p-4 rounded-xl bg-white border border-slate-900/5">
                <AnimatePresence mode="wait">
                  {['bkash', 'nagad', 'rocket'].includes(selectedMethod) ? (
                    <motion.div
                      key="mobile-gateways"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-4"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[9px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Wallet Account Title</label>
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                            <input
                              type="text"
                              {...register('accountName')}
                              placeholder="Legal Account Name"
                              className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2.5 pl-9 pr-3 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/40"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[9px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Mobile Number</label>
                          <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                            <input
                              type="text"
                              {...register('mobileNumber')}
                              placeholder="017xxxxxxxx"
                              className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2.5 pl-9 pr-3 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/40"
                            />
                          </div>
                        </div>
                      </div>
                      {errors.mobileNumber && <p className="text-[9px] text-rose-600 mt-1">{String(errors.mobileNumber.message)}</p>}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="bank-gateways"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-4"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[9px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Bank Legal Name</label>
                          <input
                            type="text"
                            {...register('bankName')}
                            placeholder="e.g. City Bank PLC"
                            className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2.5 px-3 text-xs text-slate-900 focus:outline-none"
                          />
                        </div>

                         <div>
                          <label className="block text-[9px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Account Holder Name</label>
                          <input
                            type="text"
                            {...register('accountName')}
                            placeholder="Sazzad Ali"
                            className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2.5 px-3 text-xs text-slate-900 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Account Number</label>
                          <input
                            type="text"
                            {...register('accountNumber')}
                            placeholder="1209XXXXXXXX"
                            className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2.5 px-3 text-xs text-slate-900 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">District</label>
                          <input
                            type="text"
                            {...register('district')}
                            placeholder="e.g. Dhaka"
                            className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2.5 px-3 text-xs text-slate-900 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Branch Specification</label>
                          <input
                            type="text"
                            {...register('branchName')}
                            placeholder="Gulshan Branch"
                            className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2.5 px-3 text-xs text-slate-900 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">SWIFT Protocol (Optional)</label>
                          <input
                            type="text"
                            {...register('swiftCode')}
                            placeholder="CIBLBDDHA"
                            className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2.5 px-3 text-xs text-slate-900 focus:outline-none"
                          />
                        </div>
                      </div>
                      {errors.bankName && <p className="text-[9px] text-rose-600 mt-1">{String(errors.bankName.message)}</p>}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* ACTION DISPATCH TRIGGER */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-[#1ca34c] hover:bg-[#15803d] text-white font-semibold py-4 rounded-full text-xs tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer disabled:opacity-55"
            >
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Queue Payment Settlement</span>
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>

          </div>

        </form>

      </div>

    </div>

}
