'use client'

import React, { useState, useEffect } from 'react'
import { X, Code, Check, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { dhakaToday } from '@/lib/dhaka-time'

// branches + developer payment methods come from
// /api/branches and /api/admin/branch-settings (admin-gated,
// Prisma); the bill itself was already issued through
// /api/branch-accounts/expenses.

interface IssueDeveloperBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  ledgerHeadName: string;
  preselectedLedgerHeadId: string;
}

export default function IssueDeveloperBillModal({ isOpen, onClose, onSuccess, ledgerHeadName, preselectedLedgerHeadId }: IssueDeveloperBillModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [branches, setBranches] = useState<any[]>([])
  const [methods, setMethods] = useState<any[]>([])

  const [branchId, setBranchId] = useState('')
  const [methodId, setMethodId] = useState('')

  const [amount, setAmount] = useState<number>(0)
  const [descriptionInput, setDescriptionInput] = useState('')

  useEffect(() => {
    if (isOpen) {
      fetchInitialData()
    }
  }, [isOpen])

  const fetchInitialData = async () => {
    const bRes = await fetch('/api/branches')
    if (bRes.ok) {
      const bJson = await bRes.json()
      setBranches(bJson.branches || [])
    }

    const mRes = await fetch('/api/admin/branch-settings?kind=developer_payment_methods')
    if (mRes.ok) {
      const mJson = await mRes.json()
      const mData = mJson.rows || []
      setMethods(mData)
      if (mData.length > 0) setMethodId(mData[0].id)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!branchId || amount <= 0) return setError('Invalid branch or amount.')
    if (!preselectedLedgerHeadId) return setError('Ledger Head is missing.')
    if (!descriptionInput.trim()) return setError('Description is required.')

    setIsSubmitting(true)
    setError(null)
    try {
      const selectedMethod = methods.find(m => m.id === methodId)
      let finalDescription = `${descriptionInput.trim()}`
      if (selectedMethod) {
        finalDescription += ` [Paid via ${selectedMethod.method_type}]`
      }

      // C7/C11: issue through the expenses API — the direct insert
      // stored category 'other' regardless of the chosen ledger head
      // (splitting the head in category reports) and used the UTC
      // date. The API resolves category from the head and validates
      // the money fields; the expense date is Dhaka today.
      const res = await fetch('/api/branch-accounts/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: branchId,
          ledger_head_id: preselectedLedgerHeadId,
          amount: amount,
          expense_date: dhakaToday(),
          description: finalDescription,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to issue developer bill')

      onSuccess()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-50" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
          >
            <div className="bg-white border border-slate-900/8 rounded-3xl w-full max-w-lg shadow-2xl pointer-events-auto max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col">

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-900/[0.08] shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                    <Code className="w-4 h-4 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 font-serif">Developer / Software Bill</h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">{ledgerHeadName}</p>
                  </div>
                </div>
                <button onClick={onClose} className="text-slate-600 hover:text-slate-900 transition-colors cursor-pointer p-2.5 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="p-6 space-y-5 flex-1 overflow-y-auto custom-scrollbar">
                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-600 p-3 text-xs rounded-xl flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {/* Branch Selection */}
                  <div className="col-span-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Paying Branch *</label>
                    <select required value={branchId} onChange={e => setBranchId(e.target.value)}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 focus:outline-none focus:border-purple-500/40 transition-all cursor-pointer">
                      <option value="" disabled className="bg-white text-slate-900">Select branch paying the bill</option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id} className="bg-white text-slate-900">{b.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Payment Method */}
                  {methods.length > 0 && (
                    <div className="col-span-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Developer Payment Info *</label>
                      <select value={methodId} onChange={e => setMethodId(e.target.value)} required
                        className="w-full bg-purple-500/5 border border-purple-500/20 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 focus:outline-none focus:border-purple-500/40 transition-all cursor-pointer">
                        <option value="" disabled className="bg-white text-slate-900">Select payment method</option>
                        {methods.map(m => {
                           let detailStr = ''
                           try {
                             if (m.method_type === 'Bank') detailStr = `${m.details.bank_name || ''} - ${m.details.account_number || ''}`
                             else detailStr = m.details.account_number || m.details.phone || ''
                           } catch(e){}
                           return (
                            <option key={m.id} value={m.id} className="bg-white text-slate-900">
                              {m.method_type}: {detailStr}
                            </option>
                           )
                        })}
                      </select>
                    </div>
                  )}

                  {/* Description */}
                  <div className="col-span-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Bill Description *</label>
                    <textarea required rows={2} value={descriptionInput} onChange={e => setDescriptionInput(e.target.value)}
                      placeholder="e.g. Server hosting, ERP update charge, Domain renewal..."
                      className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-purple-500/40 transition-all resize-none" />
                  </div>
                </div>

                <div className="bg-slate-900/[0.04] rounded-xl p-4 border border-slate-900/5 mt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Total Bill (BDT)</span>
                    <input type="number" step="0.01" min="0.01" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} required placeholder="0.00"
                      className="w-32 bg-transparent text-right text-lg font-bold text-[#15803d] focus:outline-none placeholder-slate-700" />
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex gap-3 pt-4 border-t border-slate-900/[0.08]">
                  <button type="button" onClick={onClose}
                    className="flex-1 py-3 border border-slate-900/8 text-slate-500 hover:text-slate-900 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer">
                    Cancel
                  </button>
                  <button type="submit" disabled={isSubmitting}
                    className="flex-1 bg-gradient-to-r from-purple-600 to-purple-500 text-white font-bold py-3 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-60 cursor-pointer shadow-lg shadow-purple-500/20">
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Confirm Payment
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
