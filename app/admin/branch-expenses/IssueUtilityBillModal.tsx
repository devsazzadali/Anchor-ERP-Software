'use client'

import React, { useState, useEffect } from 'react'
import { X, Zap, Check, Loader2, Droplets, Wifi } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import PaymentAccountCard, { type PaymentAccountField } from '@/components/PaymentAccountCard'

// Part B: the selected meter's bill-pay details as PaymentAccountCard
// fields — the exact references an admin must type into a banking /
// bill-pay app. payable_to is a Part B nullable column: older meters
// render "—" until filled in the registry settings.
export function utilityMeterFields(meter: any, amount?: number): PaymentAccountField[] {
  if (!meter) return []
  const pick = (v: any): string | number | null =>
    v === null || v === undefined || String(v).trim() === '' ? null : v
  return [
    { label: 'Payable To', value: pick(meter.payable_to) },
    { label: 'Meter Type', value: pick(meter.meter_type) },
    { label: 'Meter Number', value: pick(meter.meter_number) },
    { label: 'Account / Bill Number', value: pick(meter.account_number) },
    { label: 'Bill Amount (BDT)', value: amount && amount > 0 ? amount : null },
  ]
}

// branches + utility meters come from
// /api/branches and /api/admin/branch-settings (admin-gated,
// Prisma); the bill itself was already issued through
// /api/branch-accounts/expenses.

interface IssueUtilityBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  ledgerHeadName: string;
  preselectedLedgerHeadId: string;
}

export default function IssueUtilityBillModal({ isOpen, onClose, onSuccess, ledgerHeadName, preselectedLedgerHeadId }: IssueUtilityBillModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [branches, setBranches] = useState<any[]>([])
  const [meters, setMeters] = useState<any[]>([])

  const [branchId, setBranchId] = useState('')
  const [meterId, setMeterId] = useState('')

  const [amount, setAmount] = useState<number>(0)
  const [month, setMonth] = useState('')
  const [year, setYear] = useState(new Date().getFullYear().toString())

  // Determine icon and theme based on ledger name
  const isElectricity = ledgerHeadName.toLowerCase().includes('electricity')
  const isWaterGas = ledgerHeadName.toLowerCase().includes('water') || ledgerHeadName.toLowerCase().includes('gas')
  const isInternet = ledgerHeadName.toLowerCase().includes('internet') || ledgerHeadName.toLowerCase().includes('phone')

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

    // Default to current month
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    setMonth(months[new Date().getMonth()])
  }

  const handleBranchChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const bId = e.target.value
    setBranchId(bId)
    setMeterId('')

    if (bId) {
      const mRes = await fetch(`/api/admin/branch-settings?kind=utility_meters&branch_id=${bId}`)
      if (mRes.ok) {
        const mJson = await mRes.json()
        const mData = mJson.rows || []
        // We could filter meters based on isElectricity / isWaterGas, but sometimes names don't match perfectly.
        // We'll just show all active meters for this branch and let user select.
        setMeters(mData)
        if (mData.length > 0) setMeterId(mData[0].id)
      } else {
        setMeters([])
      }
    } else {
      setMeters([])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!branchId || amount <= 0) return setError('Invalid branch or amount.')
    if (!preselectedLedgerHeadId) return setError('Ledger Head is missing.')
    if (!meterId) return setError('Please select a Meter / Account Reference.')

    setIsSubmitting(true)
    setError(null)
    try {
      const selectedMeter = meters.find(m => m.id === meterId)
      let description = `${ledgerHeadName} Bill for ${month} ${year}`
      let recipientAccount = null

      if (selectedMeter) {
        recipientAccount = `Meter: ${selectedMeter.meter_number}${selectedMeter.account_number ? `, A/C: ${selectedMeter.account_number}` : ''}`
      }

      // C7/C10/C11: issue through the expenses API (like house rent)
      // instead of a direct insert. The API validates the money
      // triple, stores the TARGET branch's name and the recipient
      // account, and resolves category from the ledger head — the
      // direct insert stored category 'utility' (splitting this head
      // in category reports), no paid/due, and no billing period.
      // The billing month is now stored structurally
      // (billing_month/billing_year, Batch-3 migration) and
      // expense_date is the 1st of the BILLING month, so the
      // expense_date month filter and the billing period agree.
      const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      const monthIdx = MONTHS.indexOf(month)
      const expenseDate = monthIdx >= 0
        ? `${year}-${String(monthIdx + 1).padStart(2, '0')}-01`
        : undefined

      const res = await fetch('/api/branch-accounts/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: branchId,
          ledger_head_id: preselectedLedgerHeadId,
          amount: amount,
          expense_date: expenseDate,
          description: description,
          recipient_account: recipientAccount,
          billing_month: month || null,
          billing_year: year ? Number(year) : null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to issue utility bill')

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
                  <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                    {isElectricity ? <Zap className="w-4 h-4 text-orange-600" /> : isInternet ? <Wifi className="w-4 h-4 text-orange-600" /> : <Droplets className="w-4 h-4 text-orange-600" />}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 font-serif">Pay Utility Bill</h3>
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
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Branch *</label>
                    <select required value={branchId} onChange={handleBranchChange}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 focus:outline-none focus:border-orange-500/40 transition-all cursor-pointer">
                      <option value="" disabled className="bg-white text-slate-900">Select branch for this utility bill</option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id} className="bg-white text-slate-900">{b.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Meter Selection */}
                  {meters.length > 0 && (
                    <div className="col-span-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Meter / Account Reference *</label>
                      <select required value={meterId} onChange={e => setMeterId(e.target.value)}
                        className="w-full bg-orange-500/5 border border-orange-500/20 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 focus:outline-none focus:border-orange-500/40 transition-all cursor-pointer">
                        <option value="" disabled className="bg-white text-slate-900">Select a meter / account reference</option>
                        {meters.map(m => (
                          <option key={m.id} value={m.id} className="bg-white text-slate-900">
                            {m.meter_type} Meter: {m.meter_number} {m.account_number ? `(A/C: ${m.account_number})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Part B: post-selection bill-pay card, BEFORE confirm. */}
                  {meterId && meters.find(m => m.id === meterId) && (
                    <div className="col-span-2">
                      <PaymentAccountCard
                        title="Bill Payment Details (Pay to this meter / account)"
                        fields={utilityMeterFields(meters.find(m => m.id === meterId), amount)}
                      />
                    </div>
                  )}

                  {branchId && meters.length === 0 && (
                     <div className="col-span-2 text-xs text-red-600 bg-red-500/10 p-3 rounded-xl border border-red-500/20">
                       No meters setup for this branch. Please setup a meter/account in settings before proceeding.
                     </div>
                  )}

                  {/* Month & Year */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Billing Month *</label>
                    <select required value={month} onChange={e => setMonth(e.target.value)}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 focus:outline-none focus:border-orange-500/40 transition-all cursor-pointer">
                      {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                        <option key={m} value={m} className="bg-white text-slate-900">{m}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Year *</label>
                    <input required type="number" value={year} onChange={e => setYear(e.target.value)}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/8 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-orange-500/40 transition-all" />
                  </div>
                </div>

                <div className="bg-slate-900/[0.04] rounded-xl p-4 border border-slate-900/5 mt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Bill Amount (BDT)</span>
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
                    className="flex-1 bg-gradient-to-r from-orange-600 to-orange-500 text-white font-bold py-3 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-60 cursor-pointer shadow-lg shadow-orange-500/20">
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Confirm Bill Payment
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
