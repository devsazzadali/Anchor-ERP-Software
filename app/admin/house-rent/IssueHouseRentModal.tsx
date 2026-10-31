'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { X, Building2, Check, Loader2, Copy, CheckCircle, AlertCircle, Info } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { dhakaToday } from '@/lib/dhaka-time'
import { sumMoney } from '@/lib/money'

// branches from /api/branches, ledger heads from
// /api/ledger-heads (the House Rent heads are name-matched and
// name-ordered client-side, as the fixed copy's ilike + order did),
// rent accounts from /api/admin/branch-settings, past rent payments
// from /api/admin/house-rent?branch_id=. Issue still goes through
// /api/branch-accounts/expenses, as in the fixed copy.

interface IssueHouseRentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function IssueHouseRentModal({ isOpen, onClose, onSuccess }: IssueHouseRentModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copySuccess, setCopySuccess] = useState<string | null>(null)

  const [branches, setBranches] = useState<any[]>([])
  const [rentAccounts, setRentAccounts] = useState<any[]>([])
  const [ledgerHeads, setLedgerHeads] = useState<any[]>([])
  const [pastPayments, setPastPayments] = useState<any[]>([])

  const [branchId, setBranchId] = useState('')
  const [rentAccountId, setRentAccountId] = useState('')
  const [ledgerHeadId, setLedgerHeadId] = useState('')

  const [amount, setAmount] = useState<number>(0)
  const [paidAmount, setPaidAmount] = useState<number>(0)
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'unpaid' | 'partial'>('paid')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState(() => dhakaToday().split('-')[0])

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

    // C8: deterministic order — with several matching heads the old
    // unordered query booked whichever Postgres returned first.
    const lRes = await fetch('/api/ledger-heads?include_inactive=true')
    if (lRes.ok) {
      const lJson = await lRes.json()
      const lData = (lJson.ledger_heads || [])
        .filter((h: any) => h.name.toLowerCase().includes('house') && h.name.toLowerCase().includes('rent'))
        .sort((a: any, b: any) => a.name.localeCompare(b.name))
      setLedgerHeads(lData)
      if (lData.length > 0) setLedgerHeadId(lData[0].id)
    }

    // Default to current month (Dhaka)
    setMonth(MONTHS[Number(dhakaToday().split('-')[1]) - 1])
  }

  const handleBranchChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const bId = e.target.value
    setBranchId(bId)
    setRentAccountId('')
    setAmount(0)

    if (bId) {
      const rRes = await fetch(`/api/admin/branch-settings?kind=house_rent_accounts&branch_id=${bId}`)
      if (rRes.ok) {
        const rJson = await rRes.json()
        const rData = rJson.rows || []
        setRentAccounts(rData)
        if (rData.length === 1) {
          setRentAccountId(rData[0].id)
          setAmount(Number(rData[0].rent_amount || 0))
        }
      } else {
        setRentAccounts([])
      }

      // Fetch past payments for status checking — paid_amount is
      // required: the old select omitted it, so "paid" could only
      // ever mean "a row exists" (C5/C6).
      const pRes = await fetch(`/api/admin/house-rent?branch_id=${bId}`)
      if (pRes.ok) {
        const pJson = await pRes.json()
        setPastPayments(pJson.payments || [])
      } else {
        setPastPayments([])
      }

    } else {
      setRentAccounts([])
      setPastPayments([])
    }
  }

  const handleCopy = (e: React.MouseEvent, text: string) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopySuccess('Copied!')
    setTimeout(() => setCopySuccess(null), 2000)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!branchId || amount <= 0) return setError('Invalid branch or amount.')
    if (!ledgerHeadId) return setError('Please select a Ledger Head.')
    if (!rentAccountId) return setError('Please select a Bank Account.')
    if (!month || !year) return setError('Please select Month and Year.')
    if (paymentStatus === 'partial' && (paidAmount <= 0 || paidAmount >= amount)) {
      return setError('Partial paid amount must be between 0 and total amount.')
    }
    // C5: never issue a second full rent for a month that is already
    // fully paid — the old check only changed a badge's wording.
    if (currentMonthFullyPaid) {
      return setError(`House rent for ${month} ${year} is already fully paid (৳${currentMonthStatus?.paid.toLocaleString('en-BD')}).`)
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const selectedAccount = rentAccounts.find(a => a.id === rentAccountId)
      let description = `House Rent for ${month} ${year}`
      let recipientAccount = null

      // Calculate paid/due based on payment status
      let finalPaidAmount = amount
      let finalDueAmount = 0
      if (paymentStatus === 'unpaid') {
        finalPaidAmount = 0
        finalDueAmount = amount
        description += ` [UNPAID — Due: ৳${amount.toLocaleString('en-BD')}]`
      } else if (paymentStatus === 'partial') {
        finalPaidAmount = paidAmount
        finalDueAmount = amount - paidAmount
        description += ` [PARTIAL — Paid: ৳${paidAmount.toLocaleString('en-BD')}, Due: ৳${finalDueAmount.toLocaleString('en-BD')}]`
      } else {
        // Paid in full
        if (selectedAccount) {
          recipientAccount = `Bank: ${selectedAccount.bank_name}, A/C: ${selectedAccount.account_number}`
          const expectedAmount = Number(selectedAccount.rent_amount || 0)
          const diff = amount - expectedAmount
          if (diff > 0) description += ` (Advance: ৳${diff})`
          else if (diff < 0) description += ` (Short: ৳${Math.abs(diff)})`
        }
      }

      if (selectedAccount && paymentStatus !== 'unpaid') {
        recipientAccount = `Bank: ${selectedAccount.bank_name}, A/C: ${selectedAccount.account_number}`
      }

      // C7: the expense belongs to the RENT month — expense_date is
      // the 1st of the selected rent month so the expenses API's
      // expense_date month filter and rent_month always agree (the
      // old code dated every rent row "today", so a back-dated rent
      // landed in the wrong month's expense totals).
      const rentMonthIdx = MONTHS.indexOf(month)
      const rentExpenseDate = rentMonthIdx >= 0
        ? `${year}-${String(rentMonthIdx + 1).padStart(2, '0')}-01`
        : dhakaToday()

      const res = await fetch('/api/branch-accounts/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: branchId,
          ledger_head_id: ledgerHeadId,
          amount: amount,
          paid_amount: finalPaidAmount,
          due_amount: finalDueAmount,
          expense_date: rentExpenseDate,
          description: description,
          recipient_account: recipientAccount,
          notes: `Rent Month: ${month} ${year} | Status: ${paymentStatus.toUpperCase()}`,
          rent_month: month,
          rent_year: Number(year)
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to issue rent payment')

      onSuccess()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // C5/C6: status for a month is computed from ALL its rows: a month
  // is PAID only when total paid covers the invoiced total — a row
  // merely existing (even an UNPAID row) used to render "PAID" /
  // "ALREADY PAID". Aggregates: { exists, invoiced, paid }.
  const aggregateMonth = (m: string, y: number) => {
    const rows = pastPayments.filter(p => p.rent_month === m && p.rent_year === y)
    if (rows.length === 0) return null
    return {
      invoiced: sumMoney(rows.map(r => r.amount)),
      paid: sumMoney(rows.map(r => r.paid_amount)),
    }
  }

  const currentMonthStatus = useMemo(() => {
    if (!month || !year) return null
    return aggregateMonth(month, Number(year))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year, pastPayments])

  const prevMonthStatus = useMemo(() => {
    if (!month || !year) return null
    const idx = MONTHS.indexOf(month)
    let pMonth = ''
    let pYear = Number(year)
    if (idx === 0) {
      pMonth = 'December'
      pYear -= 1
    } else {
      pMonth = MONTHS[idx - 1]
    }
    return {
      month: pMonth,
      year: pYear,
      payment: aggregateMonth(pMonth, pYear)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year, pastPayments])

  // Fully-paid test for the selected month: total paid covers the
  // contractual rent of the selected account (falling back to the
  // invoiced total when no account rent is known).
  const selectedAccountRent = Number(rentAccounts.find(a => a.id === rentAccountId)?.rent_amount || 0)
  const currentMonthFullyPaid = !!currentMonthStatus &&
    currentMonthStatus.paid >= (selectedAccountRent > 0 ? selectedAccountRent : currentMonthStatus.invoiced) &&
    currentMonthStatus.paid > 0

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
            <div className="bg-white border border-slate-900/8 rounded-2xl w-full max-w-2xl shadow-2xl pointer-events-auto max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col">

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-900/[0.08] shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#d4af37]/20 to-[#d4af37]/5 flex items-center justify-center border border-[#d4af37]/20">
                    <Building2 className="w-5 h-5 text-[#8a6d1f]" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 font-serif">Issue House Rent</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Select an account and pay branch house rent</p>
                  </div>
                </div>
                <button onClick={onClose} className="text-slate-500 hover:text-slate-900 transition-colors cursor-pointer bg-slate-900/[0.04] p-2.5 rounded-xl hover:bg-slate-900/[0.07]">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="p-6 space-y-6 flex-1 overflow-y-auto custom-scrollbar">
                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-600 p-3 text-xs rounded-xl flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    {error}
                  </div>
                )}
                {copySuccess && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 p-3 text-xs rounded-xl flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    {copySuccess}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-5">
                  {/* Ledger Head Selection */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Ledger Head *</label>
                    <select required value={ledgerHeadId} onChange={e => setLedgerHeadId(e.target.value)}
                      className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50 transition-all cursor-pointer shadow-inner">
                      <option value="" disabled className="bg-white text-slate-900">Select target ledger head</option>
                      {ledgerHeads.map(l => (
                        <option key={l.id} value={l.id} className="bg-white text-slate-900">{l.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Branch Selection */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Branch *</label>
                    <select required value={branchId} onChange={handleBranchChange}
                      className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50 transition-all cursor-pointer shadow-inner">
                      <option value="" disabled className="bg-white text-slate-900">Select branch to pay rent for</option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id} className="bg-white text-slate-900">{b.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Month & Year Selection */}
                  {branchId && (
                    <div className="col-span-2 grid grid-cols-2 gap-5 p-4 rounded-xl border border-slate-900/5 bg-slate-900/[0.04]">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Rent Month *</label>
                        <select required value={month} onChange={e => setMonth(e.target.value)}
                          className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50 transition-all cursor-pointer">
                          {MONTHS.map(m => (
                            <option key={m} value={m} className="bg-white text-slate-900">{m}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Year *</label>
                        <input required type="number" value={year} onChange={e => setYear(e.target.value)}
                          className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#d4af37]/50 transition-all" />
                      </div>

                      {/* Status Checkers */}
                      <div className="col-span-2 flex flex-col sm:flex-row gap-4 mt-2">
                         <div className="flex-1 flex items-center justify-between p-3 rounded-lg border border-slate-900/5 bg-white">
                           <span className="text-[10px] text-slate-500 uppercase tracking-wider">Prev Month ({prevMonthStatus?.month})</span>
                           {!prevMonthStatus?.payment ? (
                              <span className="text-xs font-bold text-rose-600 bg-rose-400/10 px-2 py-1 rounded-md border border-rose-400/20">UNPAID</span>
                           ) : prevMonthStatus.payment.paid >= prevMonthStatus.payment.invoiced && prevMonthStatus.payment.paid > 0 ? (
                              <span className="text-xs font-bold text-emerald-600 bg-emerald-400/10 px-2 py-1 rounded-md border border-emerald-400/20">PAID (৳{prevMonthStatus.payment.paid.toLocaleString('en-BD')})</span>
                           ) : prevMonthStatus.payment.paid > 0 ? (
                              <span className="text-xs font-bold text-amber-600 bg-amber-400/10 px-2 py-1 rounded-md border border-amber-400/20">PARTIAL (৳{prevMonthStatus.payment.paid.toLocaleString('en-BD')} of ৳{prevMonthStatus.payment.invoiced.toLocaleString('en-BD')})</span>
                           ) : (
                              <span className="text-xs font-bold text-rose-600 bg-rose-400/10 px-2 py-1 rounded-md border border-rose-400/20">UNPAID</span>
                           )}
                         </div>
                         <div className="flex-1 flex items-center justify-between p-3 rounded-lg border border-slate-900/5 bg-white">
                           <span className="text-[10px] text-slate-500 uppercase tracking-wider">Selected ({month})</span>
                           {!currentMonthStatus ? (
                              <span className="text-xs font-bold text-slate-600">No Payment</span>
                           ) : currentMonthFullyPaid ? (
                              <span className="text-xs font-bold text-emerald-600 bg-emerald-400/10 px-2 py-1 rounded-md border border-emerald-400/20">ALREADY PAID</span>
                           ) : currentMonthStatus.paid > 0 ? (
                              <span className="text-xs font-bold text-amber-600 bg-amber-400/10 px-2 py-1 rounded-md border border-amber-400/20">PARTIAL — Paid ৳{currentMonthStatus.paid.toLocaleString('en-BD')}</span>
                           ) : (
                              <span className="text-xs font-bold text-rose-600 bg-rose-400/10 px-2 py-1 rounded-md border border-rose-400/20">UNPAID — Due ৳{currentMonthStatus.invoiced.toLocaleString('en-BD')}</span>
                           )}
                         </div>
                      </div>
                    </div>
                  )}

                  {/* Rent Accounts (Grid View) */}
                  {branchId && (
                    <div className="col-span-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-3">
                        House Rent Accounts (Select One) *
                      </label>
                      {rentAccounts.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {rentAccounts.map(a => {
                            const isSelected = rentAccountId === a.id;
                            const accDetails = `Bank: ${a.bank_name}\nA/C Name: ${a.account_name}\nA/C No: ${a.account_number}`;
                            return (
                              <div key={a.id}
                                onClick={() => {
                                  setRentAccountId(a.id);
                                  setAmount(Number(a.rent_amount || 0));
                                }}
                                className={`relative p-5 rounded-2xl border cursor-pointer transition-all group overflow-hidden ${
                                  isSelected
                                    ? 'bg-[#d4af37]/10 border-[#d4af37]/50 shadow-[0_0_20px_rgba(212,175,55,0.15)]'
                                    : 'bg-slate-900/[0.04] border-slate-900/10 hover:border-slate-900/20 hover:bg-slate-900/[0.04]'
                                }`}
                              >
                                {isSelected && (
                                  <div className="absolute top-0 right-0 p-3 text-[#8a6d1f]">
                                    <CheckCircle className="w-5 h-5 drop-shadow-[0_0_8px_rgba(212,175,55,0.8)]" />
                                  </div>
                                )}

                                <div className="flex items-center gap-3 mb-3">
                                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold ${isSelected ? 'bg-[#d4af37]/20 text-[#8a6d1f]' : 'bg-slate-900/[0.04] text-slate-500'}`}>
                                    {a.bank_name.charAt(0)}
                                  </div>
                                  <div>
                                    <h4 className={`font-bold text-sm ${isSelected ? 'text-slate-900' : 'text-slate-700'}`}>
                                      {a.bank_name}
                                    </h4>
                                    <p className="text-[11px] text-slate-500 truncate max-w-[140px]">{a.account_name}</p>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-900/5">
                                  <code className="text-xs text-[#8a6d1f] font-bold tracking-wide">{a.account_number}</code>
                                  <button type="button" onClick={(e) => handleCopy(e, accDetails)}
                                    className="text-slate-500 hover:text-slate-900 transition-colors p-2.5 rounded-md hover:bg-slate-900/[0.07]" title="Copy Details">
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                <div className="mt-4 pt-3 border-t border-slate-900/5 flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Fixed Rent</span>
                                  <span className="text-sm font-bold text-slate-900">৳{Number(a.rent_amount || 0).toLocaleString('en-BD')}</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="text-xs text-rose-600 bg-rose-500/10 p-4 rounded-xl border border-rose-500/20 flex items-start gap-3">
                          <AlertCircle className="w-5 h-5 shrink-0" />
                          <p>No bank account is set up for this branch. Please go to House Rent Management page to add a bank account first.</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Payment Amount & Status */}
                  <div className="col-span-2 space-y-4">
                    {/* Total Amount */}
                    <div className="bg-gradient-to-r from-[#d4af37]/20 to-[#d4af37]/5 rounded-2xl p-5 border border-[#d4af37]/20 relative overflow-hidden">
                      <div className="absolute inset-0 bg-[#d4af37]/5 blur-xl pointer-events-none" />
                      <div className="relative flex items-center justify-between">
                        <div>
                          <span className="text-[10px] text-[#8a6d1f] uppercase font-bold tracking-widest block mb-1">Total Rent Amount</span>
                          <div className="flex items-center gap-2">
                             <Info className="w-3.5 h-3.5 text-[#8a6d1f]/60" />
                             <p className="text-[10px] text-slate-500">Modify if paying advance/short</p>
                          </div>
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a6d1f] font-bold text-xl">৳</span>
                          <input type="number" step="0.01" min="0.01" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} required placeholder="0.00"
                            className="w-40 bg-white border border-[#d4af37]/30 rounded-xl py-2 pl-8 pr-4 text-right text-xl font-bold text-[#8a6d1f] focus:outline-none focus:border-[#d4af37] transition-all shadow-inner placeholder-slate-700" />
                        </div>
                      </div>
                    </div>

                    {/* Payment Status Toggle */}
                    <div className="p-4 rounded-xl border border-slate-900/10 bg-slate-900/[0.04]">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-3">Payment Status *</label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['paid', 'partial', 'unpaid'] as const).map(status => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => {
                              setPaymentStatus(status)
                              if (status === 'paid') setPaidAmount(amount)
                              if (status === 'unpaid') setPaidAmount(0)
                            }}
                            className={`py-2.5 px-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                              paymentStatus === status
                                ? status === 'paid'
                                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-600'
                                  : status === 'partial'
                                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-600'
                                  : 'bg-rose-500/20 border-rose-500/50 text-rose-600'
                                : 'bg-slate-900/[0.04] border-slate-900/10 text-slate-500 hover:border-slate-900/20'
                            }`}
                          >
                            {status === 'paid' ? '✓ Paid' : status === 'partial' ? '~ Partial' : '✗ Unpaid'}
                          </button>
                        ))}
                      </div>

                      {/* Partial amount input */}
                      {paymentStatus === 'partial' && (
                        <div className="mt-3 flex items-center gap-3">
                          <div className="flex-1">
                            <label className="text-[10px] text-amber-600/70 uppercase tracking-wider block mb-1.5">Amount Paid Now</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-600 font-bold">৳</span>
                              <input
                                type="number" step="0.01" min="1" max={amount - 1}
                                value={paidAmount || ''}
                                onChange={e => setPaidAmount(Number(e.target.value))}
                                placeholder="0.00"
                                className="w-full bg-white border border-amber-500/30 rounded-xl py-2.5 pl-7 pr-4 text-sm font-bold text-amber-600 focus:outline-none focus:border-amber-500 transition-all"
                              />
                            </div>
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] text-rose-600/70 uppercase tracking-wider block mb-1.5">Remaining Due</label>
                            <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-sm font-bold text-rose-600 text-center">
                              ৳{Math.max(0, amount - paidAmount).toLocaleString('en-BD')}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Summary badge */}
                      {paymentStatus === 'unpaid' && amount > 0 && (
                        <div className="mt-3 p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-600 font-semibold text-center">
                          ⚠ This will be recorded as UNPAID — Due: ৳{amount.toLocaleString('en-BD')}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex gap-4 pt-6 border-t border-slate-900/[0.08]">
                  <button type="button" onClick={onClose}
                    className="flex-1 py-3.5 border border-slate-900/10 hover:bg-slate-900/[0.04] text-slate-500 hover:text-slate-900 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer">
                    Cancel
                  </button>
                  <button type="submit" disabled={isSubmitting || !rentAccountId}
                    className={`flex-[2] font-bold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 cursor-pointer transition-all ${
                      paymentStatus === 'unpaid'
                        ? 'bg-rose-500/80 text-white shadow-[0_4px_20px_rgba(239,68,68,0.3)]'
                        : paymentStatus === 'partial'
                        ? 'bg-amber-500/80 text-white shadow-[0_4px_20px_rgba(245,158,11,0.3)]'
                        : 'bg-gradient-to-r from-[#d4af37] to-white text-black shadow-[0_4px_20px_rgba(212,175,55,0.3)]'
                    }`}>
                    {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                    {paymentStatus === 'unpaid' ? 'Record as Unpaid' : paymentStatus === 'partial' ? 'Record Partial Payment' : 'Confirm Rent Payment'}
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
