'use client'

import React, { useState, useEffect } from 'react'
import { Building, Plus, Loader2, X, Check, Search } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { dhakaToday } from '@/lib/dhaka-time'
import { sumMoney } from '@/lib/money'

// accounts + branches come from
// /api/admin/branch-settings (kind=house_rent_accounts returns ALL
// accounts, active and inactive, with the branches embed), the
// current-month payment rows from /api/admin/house-rent, and
// account creation posts to /api/admin/branch-settings — the
// browser no longer touches these tables directly.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function HouseRentPage() {
  const [accounts, setAccounts] = useState<any[]>([])
  const [branches, setBranches] = useState<any[]>([])
  const [paymentStatus, setPaymentStatus] = useState<Record<string, any>>({})
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setIsLoading(true)
    const accRes = await fetch('/api/admin/branch-settings?kind=house_rent_accounts')
    if (accRes.ok) {
      const accJson = await accRes.json()
      setAccounts(accJson.rows || [])
    }

    const bRes = await fetch('/api/branches')
    if (bRes.ok) {
      const bJson = await bRes.json()
      setBranches(bJson.branches || [])
    }

    // Fetch current month payment statuses.
    // C3: "current month" is the DHAKA month (server-local Date used
    // the viewer's timezone) — the API resolves it server-side.
    // C1: a branch-month can have SEVERAL rent rows (part-payments)
    // — aggregate ALL of them. The old code overwrote the map entry
    // per row, so the verdict depended on whichever row happened to
    // be returned last.
    // C38: the API returns the complete set (no 1,000-row cap).
    let payments: any[] = []
    const payRes = await fetch('/api/admin/house-rent')
    if (payRes.ok) {
      const payJson = await payRes.json()
      payments = payJson.payments || []
    }

    if (payments) {
      const statusMap: Record<string, any> = {}
      for (const p of payments) {
        const agg = statusMap[p.branch_id] || { branch_id: p.branch_id, amount: 0, paid_amount: 0, due_amount: 0 }
        agg.amount = sumMoney([agg.amount, p.amount])
        agg.paid_amount = sumMoney([agg.paid_amount, p.paid_amount])
        agg.due_amount = sumMoney([agg.due_amount, p.due_amount])
        statusMap[p.branch_id] = agg
      }
      setPaymentStatus(statusMap)
    }

    setIsLoading(false)
  }

  return (
    <div className="p-4 md:p-10 min-h-screen bg-white text-slate-900">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-900/5">
          <div>
            <h2 className="text-2xl font-extrabold font-serif text-slate-900 flex items-center gap-3"><span className="w-1.5 h-9 rounded-full bg-[#1ca34c] shrink-0" />House Rent Accounts</h2>
            <p className="text-xs text-slate-500">Setup and manage bank accounts for branch house rent.</p>
          </div>
          <button onClick={() => setIsModalOpen(true)} className="px-4 py-2.5 bg-[#1ca34c] text-white font-bold text-xs rounded-full flex items-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-[#1ca34c]/20">
            <Plus className="w-4 h-4" /> Add Account
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 text-[#15803d] animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {accounts.map(acc => {
                const status = paymentStatus[acc.branch_id]
                // C2: the verdict compares TOTAL paid against the
                // account's contractual rent_amount — not against the
                // (possibly partial) invoiced row amount.
                const rentDue = Number(acc.rent_amount || 0)
                const paidTotal = status ? Number(status.paid_amount) : 0
                const remainingDue = Math.max(0, rentDue - paidTotal)
                const isPaid = !!status && rentDue > 0 && paidTotal >= rentDue
                const isPartial = !!status && paidTotal > 0 && paidTotal < rentDue
                const isUnpaid = !!status && paidTotal === 0
                // FR-7: with no contractual rent_amount set, no
                // paid/unpaid verdict is reachable — the card must
                // say so (a setup state) instead of claiming "No
                // payment recorded" / "UNPAID". Stamped payments, when
                // they exist, are shown as recorded amounts.
                const rentNotSet = rentDue <= 0
                const recordedTotal = status ? Number(status.amount) : 0
                return (
                <div key={acc.id} className="p-6 border border-slate-900/10 rounded-3xl bg-slate-900/[0.04] hover:bg-slate-900/[0.04] hover:border-[#1ca34c]/30 transition-all group">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-900/[0.04] flex items-center justify-center font-bold text-lg text-slate-600 group-hover:text-[#15803d] group-hover:bg-[#1ca34c]/10 transition-all">
                        {acc.bank_name?.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-slate-900">{acc.bank_name}</h3>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider">{acc.branches?.name || 'Unknown Branch'}</p>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider ${acc.is_active ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-600 border border-rose-500/20'}`}>
                      {acc.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div className="space-y-2 mb-4 bg-white p-3 rounded-xl border border-slate-900/5">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Account Name</span>
                      <span className="text-xs text-slate-900 font-medium">{acc.account_name}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Account Number</span>
                      <code className="text-xs text-[#15803d] tracking-wider font-bold">{acc.account_number}</code>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Routing / Branch</span>
                      <span className="text-xs text-slate-900 font-medium">{acc.routing_number || '—'} / {acc.bank_branch || '—'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Mobile Banking</span>
                      <span className="text-xs text-slate-900 font-medium">{acc.mobile_banking_provider ? `${acc.mobile_banking_provider} ${acc.mobile_banking_number || ''}` : '—'}</span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-900/5 flex justify-between items-center mb-2">
                    <span className="text-[10px] text-slate-500 uppercase">Fixed Rent</span>
                    <span className="text-sm font-bold text-emerald-600">৳{Number(acc.rent_amount || 0).toLocaleString('en-BD')}</span>
                  </div>

                  {/* Current Month Status */}
                  <div className="pt-2">
                    <span className="text-[9px] text-slate-600 uppercase tracking-wider block mb-1.5">This Month Status</span>
                    {rentNotSet ? (
                      status ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-sky-500/10 text-sky-600 border border-sky-500/20">
                          Recorded ৳{recordedTotal.toLocaleString('en-BD')} — rent amount not set for this branch
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-700">
                          Rent amount not set for this branch
                        </span>
                      )
                    ) : !status ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-700">
                        — No payment recorded
                      </span>
                    ) : isPaid ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        ✓ PAID — ৳{paidTotal.toLocaleString('en-BD')}
                      </span>
                    ) : isPartial ? (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                          ~ PARTIAL — Paid: ৳{paidTotal.toLocaleString('en-BD')}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-rose-500/10 text-rose-600 border border-rose-500/20">
                          Due: ৳{remainingDue.toLocaleString('en-BD')}
                        </span>
                      </div>
                    ) : isUnpaid ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-rose-500/10 text-rose-600 border border-rose-500/20">
                        ✗ UNPAID — Due: ৳{remainingDue.toLocaleString('en-BD')}
                      </span>
                    ) : null}
                  </div>
                </div>
                )
              })}
            {accounts.length === 0 && (
              <div className="col-span-full py-20 text-center border border-slate-900/5 bg-slate-900/[0.04] rounded-3xl">
                <Building className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-500 text-sm font-medium">No rent accounts found</p>
                <p className="text-xs text-slate-600 mt-1">Click Add Account to setup a bank account for a branch.</p>
              </div>
            )}
          </div>
        )}
      </div>

      <AddAccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => { setIsModalOpen(false); fetchData(); }}
        branches={branches}
      />
    </div>
  )
}

function AddAccountModal({ isOpen, onClose, onSuccess, branches }: { isOpen: boolean, onClose: () => void, onSuccess: () => void, branches: any[] }) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    branch_id: '',
    bank_name: '',
    account_name: '',
    account_number: '',
    rent_amount: '',
    // Part B: new nullable landlord payment-detail fields.
    bank_branch: '',
    mobile_banking_provider: '',
    mobile_banking_number: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/admin/branch-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'house_rent_accounts',
          branch_id: form.branch_id,
          bank_name: form.bank_name,
          account_name: form.account_name,
          account_number: form.account_number,
          rent_amount: Number(form.rent_amount),
          bank_branch: form.bank_branch.trim() || undefined,
          mobile_banking_provider: form.mobile_banking_provider.trim() || undefined,
          mobile_banking_number: form.mobile_banking_number.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to save account')

      setForm({ branch_id: '', bank_name: '', account_name: '', account_number: '', rent_amount: '', bank_branch: '', mobile_banking_provider: '', mobile_banking_number: '' })
      onSuccess()
    } catch (err: any) {
      setError(err.message)
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
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
          >
            <div className="bg-white border border-slate-900/10 rounded-3xl w-full max-w-md shadow-2xl pointer-events-auto max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-900/5">
                <h3 className="text-sm font-bold text-slate-900 font-serif">Setup Rent Account</h3>
                <button onClick={onClose} className="text-slate-500 hover:text-slate-900 p-3 rounded-md hover:bg-slate-900/[0.04]">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs rounded-xl">{error}</div>}

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Branch *</label>
                  <select required value={form.branch_id} onChange={e => setForm({...form, branch_id: e.target.value})}
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50">
                    <option value="" disabled>Select Branch</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Bank Name (e.g. City Bank / bKash) *</label>
                  <input required type="text" value={form.bank_name} onChange={e => setForm({...form, bank_name: e.target.value})}
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Account Name *</label>
                  <input required type="text" value={form.account_name} onChange={e => setForm({...form, account_name: e.target.value})}
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Account Number *</label>
                  <input required type="text" value={form.account_number} onChange={e => setForm({...form, account_number: e.target.value})}
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 font-mono focus:outline-none focus:border-[#1ca34c]/50" />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Bank Branch (Optional)</label>
                  <input type="text" value={form.bank_branch} onChange={e => setForm({...form, bank_branch: e.target.value})}
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Mobile Banking Provider (Optional)</label>
                  <input type="text" value={form.mobile_banking_provider} onChange={e => setForm({...form, mobile_banking_provider: e.target.value})}
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" placeholder="e.g. bKash" />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Mobile Banking Number (Optional)</label>
                  <input type="text" value={form.mobile_banking_number} onChange={e => setForm({...form, mobile_banking_number: e.target.value})}
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 font-mono focus:outline-none focus:border-[#1ca34c]/50" />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Fixed Rent Amount (BDT) *</label>
                  <input required type="number" step="0.01" value={form.rent_amount} onChange={e => setForm({...form, rent_amount: e.target.value})}
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-2.5 px-3.5 text-xs text-[#15803d] font-bold focus:outline-none focus:border-[#1ca34c]/50" />
                </div>

                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={onClose} className="flex-1 py-3 bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-600 rounded-xl text-xs font-bold transition-all">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="flex-1 py-3 bg-[#1ca34c] text-white rounded-full text-xs font-bold hover:opacity-90 flex items-center justify-center gap-2">
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Save Account
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
