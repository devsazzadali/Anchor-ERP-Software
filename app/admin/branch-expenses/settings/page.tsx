'use client'

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Building2, Zap, AlertCircle, Loader2, Landmark, Check } from 'lucide-react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

// the three registries (house_rent_accounts,
// utility_meters, developer_payment_methods) are read/written ONLY
// through /api/admin/branch-settings (admin-gated, Prisma) — the
// browser no longer writes these tables directly.

export default function ExpenseSettingsPage() {
  const [branches, setBranches] = useState<any[]>([])

  // States
  const [rentAccounts, setRentAccounts] = useState<any[]>([])
  const [utilityMeters, setUtilityMeters] = useState<any[]>([])
  const [developerMethods, setDeveloperMethods] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // UI Tabs
  const [activeTab, setActiveTab] = useState<'rent' | 'utility' | 'developer'>('rent')

  // Modals
  const [showRentModal, setShowRentModal] = useState(false)
  const [showMeterModal, setShowMeterModal] = useState(false)
  const [showDevModal, setShowDevModal] = useState(false)

  // Forms
  const [rentForm, setRentForm] = useState({ branch_id: '', bank_name: '', account_name: '', account_number: '', routing_number: '', bank_branch: '', mobile_banking_provider: '', mobile_banking_number: '' })
  const [meterForm, setMeterForm] = useState({ branch_id: '', meter_number: '', account_number: '', meter_type: 'Electricity', payable_to: '' })
  // Part B: edit mode for existing registry rows — writes ONLY the
  // new nullable account-detail fields via PATCH (see API route).
  const [editingRentId, setEditingRentId] = useState<string | null>(null)
  const [editingMeterId, setEditingMeterId] = useState<string | null>(null)
  const [devForm, setDevForm] = useState({ method_type: 'Bank', details: '' })

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/admin/branch-settings')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load settings')
      setBranches(json.branches || [])
      setRentAccounts(json.house_rent_accounts || [])
      setUtilityMeters(json.utility_meters || [])
      setDeveloperMethods(json.developer_payment_methods || [])
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  const createRow = async (kind: string, fields: Record<string, any>) => {
    const res = await fetch('/api/admin/branch-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ...fields }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Failed to save')
  }

  const handleAddRentAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      if (editingRentId) {
        // Part B edit path: PATCH writes only the new detail fields.
        const res = await fetch(`/api/admin/branch-settings?kind=house_rent_accounts&id=${editingRentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bank_branch: rentForm.bank_branch.trim() || null,
            mobile_banking_provider: rentForm.mobile_banking_provider.trim() || null,
            mobile_banking_number: rentForm.mobile_banking_number.trim() || null,
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error || 'Failed to save')
      } else {
        const payload: Record<string, any> = {
          branch_id: rentForm.branch_id,
          bank_name: rentForm.bank_name.trim(),
          account_name: rentForm.account_name.trim(),
          account_number: rentForm.account_number.trim(),
        }
        if (rentForm.routing_number && rentForm.routing_number.trim()) {
          payload.routing_number = rentForm.routing_number.trim()
        }
        for (const k of ['bank_branch', 'mobile_banking_provider', 'mobile_banking_number'] as const) {
          if (rentForm[k] && rentForm[k].trim()) payload[k] = rentForm[k].trim()
        }
        await createRow('house_rent_accounts', payload)
      }
      setShowRentModal(false)
      setEditingRentId(null)
      setRentForm({ branch_id: '', bank_name: '', account_name: '', account_number: '', routing_number: '', bank_branch: '', mobile_banking_provider: '', mobile_banking_number: '' })
      fetchData()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const openEditRent = (account: any) => {
    setEditingRentId(account.id)
    setRentForm({
      branch_id: account.branch_id || '',
      bank_name: account.bank_name || '',
      account_name: account.account_name || '',
      account_number: account.account_number || '',
      routing_number: account.routing_number || '',
      bank_branch: account.bank_branch || '',
      mobile_banking_provider: account.mobile_banking_provider || '',
      mobile_banking_number: account.mobile_banking_number || '',
    })
    setError(null)
    setShowRentModal(true)
  }

  const handleAddMeter = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      if (editingMeterId) {
        // Part B edit path: PATCH writes only the new payable_to field.
        const res = await fetch(`/api/admin/branch-settings?kind=utility_meters&id=${editingMeterId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payable_to: meterForm.payable_to.trim() || null }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error || 'Failed to save')
      } else {
        const payload: Record<string, any> = {
          branch_id: meterForm.branch_id,
          meter_number: meterForm.meter_number.trim(),
          meter_type: meterForm.meter_type,
        }
        if (meterForm.account_number && meterForm.account_number.trim()) {
          payload.account_number = meterForm.account_number.trim()
        }
        if (meterForm.payable_to && meterForm.payable_to.trim()) {
          payload.payable_to = meterForm.payable_to.trim()
        }
        await createRow('utility_meters', payload)
      }
      setShowMeterModal(false)
      setEditingMeterId(null)
      setMeterForm({ branch_id: '', meter_number: '', account_number: '', meter_type: 'Electricity', payable_to: '' })
      fetchData()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const openEditMeter = (meter: any) => {
    setEditingMeterId(meter.id)
    setMeterForm({
      branch_id: meter.branch_id || '',
      meter_number: meter.meter_number || '',
      account_number: meter.account_number || '',
      meter_type: meter.meter_type || 'Electricity',
      payable_to: meter.payable_to || '',
    })
    setError(null)
    setShowMeterModal(true)
  }

  const handleAddDevMethod = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      let parsedDetails = {}
      try { parsedDetails = JSON.parse(devForm.details) } catch (err) { parsedDetails = { info: devForm.details } }

      await createRow('developer_payment_methods', { method_type: devForm.method_type, details: parsedDetails })
      setShowDevModal(false)
      setDevForm({ method_type: 'Bank', details: '' })
      fetchData()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const deactivateItem = async (table: string, id: string) => {
    if (!confirm('Are you sure you want to remove this?')) return
    try {
      await fetch(`/api/admin/branch-settings?kind=${table}&id=${id}`, { method: 'PATCH' })
      fetchData()
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6 lg:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 text-[#15803d] mb-2">
              <Link href="/admin/branch-expenses" className="hover:text-slate-900 transition-colors">
                <ChevronLeft className="w-5 h-5" />
              </Link>
              <h1 className="text-2xl font-serif font-bold tracking-wide">Expense Account Settings</h1>
            </div>
            <p className="text-slate-500 text-sm ml-8">Manage bank accounts and meters for branch expenses</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-900/10 gap-6">
          <button onClick={() => setActiveTab('rent')} className={`pb-3 text-sm font-bold uppercase tracking-wider transition-colors border-b-2 ${activeTab === 'rent' ? 'text-[#15803d] border-[#1ca34c]' : 'text-slate-500 border-transparent hover:text-slate-900'}`}>
            House Rent Accounts
          </button>
          <button onClick={() => setActiveTab('utility')} className={`pb-3 text-sm font-bold uppercase tracking-wider transition-colors border-b-2 ${activeTab === 'utility' ? 'text-[#15803d] border-[#1ca34c]' : 'text-slate-500 border-transparent hover:text-slate-900'}`}>
            Utility Meters
          </button>
          <button onClick={() => setActiveTab('developer')} className={`pb-3 text-sm font-bold uppercase tracking-wider transition-colors border-b-2 ${activeTab === 'developer' ? 'text-[#15803d] border-[#1ca34c]' : 'text-slate-500 border-transparent hover:text-slate-900'}`}>
            Developer Payment Methods
          </button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-8 h-8 text-[#15803d] animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">

            {/* RENT ACCOUNTS TAB */}
            {activeTab === 'rent' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button onClick={() => { setEditingRentId(null); setRentForm({ branch_id: '', bank_name: '', account_name: '', account_number: '', routing_number: '', bank_branch: '', mobile_banking_provider: '', mobile_banking_number: '' }); setShowRentModal(true) }} className="bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20 hover:bg-[#1ca34c]/20 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-colors">
                    <Plus className="w-4 h-4" /> Add Rent Account
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {rentAccounts.length === 0 ? (
                    <div className="col-span-full p-8 text-center bg-slate-900/[0.04] border border-slate-900/5 rounded-3xl border-dashed text-slate-500 text-sm">
                      No rent accounts configured yet.
                    </div>
                  ) : rentAccounts.map(account => (
                    <div key={account.id} className="bg-slate-900/[0.04] border border-slate-900/5 rounded-3xl p-5 relative group">
                      <button onClick={() => deactivateItem('house_rent_accounts', account.id)} className="absolute top-4 right-4 text-slate-500 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                          <Landmark className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">{account.bank_name}</h4>
                          <span className="text-[10px] text-blue-600 font-medium uppercase tracking-wider">{account.branches?.name}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5 text-xs text-slate-500">
                        <p><span className="text-slate-500 mr-2">Name:</span> {account.account_name}</p>
                        <p><span className="text-slate-500 mr-2">A/C No:</span> <span className="text-slate-900 font-mono">{account.account_number}</span></p>
                        {account.routing_number && <p><span className="text-slate-500 mr-2">Routing:</span> {account.routing_number}</p>}
                        <p><span className="text-slate-500 mr-2">Branch:</span> {account.bank_branch || '—'}</p>
                        <p><span className="text-slate-500 mr-2">Mobile Banking:</span> {account.mobile_banking_provider ? `${account.mobile_banking_provider} ${account.mobile_banking_number || ''}` : '—'}</p>
                      </div>
                      <button onClick={() => openEditRent(account)} className="mt-3 text-[10px] font-bold uppercase tracking-wider text-[#15803d] hover:underline">
                        Edit Payment Details
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* UTILITY METERS TAB */}
            {activeTab === 'utility' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button onClick={() => { setEditingMeterId(null); setMeterForm({ branch_id: '', meter_number: '', account_number: '', meter_type: 'Electricity', payable_to: '' }); setShowMeterModal(true) }} className="bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20 hover:bg-[#1ca34c]/20 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-colors">
                    <Plus className="w-4 h-4" /> Add Utility Meter
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {utilityMeters.length === 0 ? (
                    <div className="col-span-full p-8 text-center bg-slate-900/[0.04] border border-slate-900/5 rounded-3xl border-dashed text-slate-500 text-sm">
                      No utility meters configured yet.
                    </div>
                  ) : utilityMeters.map(meter => (
                    <div key={meter.id} className="bg-slate-900/[0.04] border border-slate-900/5 rounded-3xl p-5 relative group">
                      <button onClick={() => deactivateItem('utility_meters', meter.id)} className="absolute top-4 right-4 text-slate-500 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                          <Zap className="w-5 h-5 text-orange-600" />
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">{meter.meter_type}</h4>
                          <span className="text-[10px] text-orange-600 font-medium uppercase tracking-wider">{meter.branches?.name}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5 text-xs text-slate-500">
                        <p><span className="text-slate-500 mr-2">Meter No:</span> <span className="text-slate-900 font-mono">{meter.meter_number}</span></p>
                        {meter.account_number && <p><span className="text-slate-500 mr-2">A/C Ref:</span> <span className="text-slate-900 font-mono">{meter.account_number}</span></p>}
                        <p><span className="text-slate-500 mr-2">Payable To:</span> {meter.payable_to || '—'}</p>
                      </div>
                      <button onClick={() => openEditMeter(meter)} className="mt-3 text-[10px] font-bold uppercase tracking-wider text-[#15803d] hover:underline">
                        Edit Payment Details
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DEVELOPER METHODS TAB */}
            {activeTab === 'developer' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button onClick={() => setShowDevModal(true)} className="bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20 hover:bg-[#1ca34c]/20 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-colors">
                    <Plus className="w-4 h-4" /> Add Payment Method
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {developerMethods.length === 0 ? (
                    <div className="col-span-full p-8 text-center bg-slate-900/[0.04] border border-slate-900/5 rounded-3xl border-dashed text-slate-500 text-sm">
                      No developer payment methods configured yet.
                    </div>
                  ) : developerMethods.map(method => (
                    <div key={method.id} className="bg-slate-900/[0.04] border border-slate-900/5 rounded-3xl p-5 relative group">
                      <button onClick={() => deactivateItem('developer_payment_methods', method.id)} className="absolute top-4 right-4 text-slate-500 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <h4 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                        {method.method_type}
                      </h4>
                      <pre className="text-[10px] text-slate-500 bg-white p-3 rounded-lg border border-slate-900/5 overflow-x-auto">
                        {JSON.stringify(method.details, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* --- MODALS --- */}
      <AnimatePresence>
        {/* RENT MODAL */}
        {showRentModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => { setShowRentModal(false); setEditingRentId(null) }} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white border border-slate-900/10 rounded-3xl w-full max-w-md p-6 relative z-10 shadow-2xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-bold text-slate-900 mb-4">{editingRentId ? 'Edit Rent Payment Details' : 'Add Rent Account'}</h3>
              {editingRentId && <p className="text-[11px] text-slate-500 mb-3">Only the payment-detail fields below (branch / mobile banking) are editable here — the account itself is unchanged.</p>}
              {error && <div className="text-red-600 text-xs mb-4 bg-red-500/10 p-3 rounded-xl border border-red-500/20">{error}</div>}
              <form onSubmit={handleAddRentAccount} className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Branch *</label>
                  <select required value={rentForm.branch_id} onChange={e => setRentForm({ ...rentForm, branch_id: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50">
                    <option value="" disabled className="bg-white">Select branch</option>
                    {branches.map(b => <option key={b.id} value={b.id} className="bg-white">{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Bank Name *</label>
                  <input required type="text" value={rentForm.bank_name} onChange={e => setRentForm({ ...rentForm, bank_name: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" placeholder="e.g. Dutch Bangla Bank" />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Account Name *</label>
                  <input required type="text" value={rentForm.account_name} onChange={e => setRentForm({ ...rentForm, account_name: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" placeholder="e.g. Mr. Landlord" />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Account Number *</label>
                  <input required type="text" value={rentForm.account_number} onChange={e => setRentForm({ ...rentForm, account_number: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" placeholder="e.g. 101.101.0000" />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Routing Number (Optional)</label>
                  <input type="text" value={rentForm.routing_number} onChange={e => setRentForm({ ...rentForm, routing_number: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" placeholder="e.g. 0902938" />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Bank Branch (Optional)</label>
                  <input type="text" value={rentForm.bank_branch} onChange={e => setRentForm({ ...rentForm, bank_branch: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" placeholder="e.g. Rangpur Branch" />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Mobile Banking Provider (Optional)</label>
                  <input type="text" value={rentForm.mobile_banking_provider} onChange={e => setRentForm({ ...rentForm, mobile_banking_provider: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" placeholder="e.g. bKash" />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Mobile Banking Number (Optional)</label>
                  <input type="text" value={rentForm.mobile_banking_number} onChange={e => setRentForm({ ...rentForm, mobile_banking_number: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" placeholder="e.g. 01700000000" />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => { setShowRentModal(false); setEditingRentId(null) }} className="flex-1 py-2.5 text-xs font-bold uppercase text-slate-500 hover:text-slate-900 border border-slate-900/10 rounded-xl">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 text-xs font-bold uppercase bg-[#1ca34c] text-white hover:brightness-110 rounded-full flex items-center justify-center gap-2">
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}

        {/* METER MODAL */}
        {showMeterModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => { setShowMeterModal(false); setEditingMeterId(null) }} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white border border-slate-900/10 rounded-3xl w-full max-w-md p-6 relative z-10 shadow-2xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-bold text-slate-900 mb-4">{editingMeterId ? 'Edit Meter Payment Details' : 'Add Utility Meter'}</h3>
              {editingMeterId && <p className="text-[11px] text-slate-500 mb-3">Only the Payable To field is editable here — the meter itself is unchanged.</p>}
              {error && <div className="text-red-600 text-xs mb-4 bg-red-500/10 p-3 rounded-xl border border-red-500/20">{error}</div>}
              <form onSubmit={handleAddMeter} className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Branch *</label>
                  <select required value={meterForm.branch_id} onChange={e => setMeterForm({ ...meterForm, branch_id: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50">
                    <option value="" disabled className="bg-white">Select branch</option>
                    {branches.map(b => <option key={b.id} value={b.id} className="bg-white">{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Meter Type *</label>
                  <select required value={meterForm.meter_type} onChange={e => setMeterForm({ ...meterForm, meter_type: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50">
                    <option value="Electricity" className="bg-white">Electricity</option>
                    <option value="Water" className="bg-white">Water</option>
                    <option value="Gas" className="bg-white">Gas</option>
                    <option value="Internet" className="bg-white">Internet</option>
                    <option value="Other" className="bg-white">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Meter Number *</label>
                  <input required type="text" value={meterForm.meter_number} onChange={e => setMeterForm({ ...meterForm, meter_number: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" placeholder="e.g. 10293019" />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Account Number / Reference (Optional)</label>
                  <input type="text" value={meterForm.account_number} onChange={e => setMeterForm({ ...meterForm, account_number: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" placeholder="e.g. A/C 9901" />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Payable To / Utility Provider (Optional)</label>
                  <input type="text" value={meterForm.payable_to} onChange={e => setMeterForm({ ...meterForm, payable_to: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" placeholder="e.g. DPDC / DESCO / WASA" />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => { setShowMeterModal(false); setEditingMeterId(null) }} className="flex-1 py-2.5 text-xs font-bold uppercase text-slate-500 hover:text-slate-900 border border-slate-900/10 rounded-xl">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 text-xs font-bold uppercase bg-[#1ca34c] text-white hover:brightness-110 rounded-full flex items-center justify-center gap-2">
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}

        {/* DEV MODAL */}
        {showDevModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setShowDevModal(false)} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white border border-slate-900/10 rounded-3xl w-full max-w-md p-6 relative z-10 shadow-2xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-bold text-slate-900 mb-4">Add Developer Payment Method</h3>
              {error && <div className="text-red-600 text-xs mb-4 bg-red-500/10 p-3 rounded-xl border border-red-500/20">{error}</div>}
              <form onSubmit={handleAddDevMethod} className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Method Type *</label>
                  <select required value={devForm.method_type} onChange={e => setDevForm({ ...devForm, method_type: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1ca34c]/50">
                    <option value="Bank" className="bg-white">Bank Transfer</option>
                    <option value="bKash" className="bg-white">bKash</option>
                    <option value="Rocket" className="bg-white">Rocket</option>
                    <option value="Nagad" className="bg-white">Nagad</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Details (JSON format or plain text) *</label>
                  <textarea required rows={4} value={devForm.details} onChange={e => setDevForm({ ...devForm, details: e.target.value })} className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 font-mono focus:outline-none focus:border-[#1ca34c]/50" placeholder={'{\n  "bank_name": "DBBL",\n  "account_number": "..."\n}'} />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setShowDevModal(false)} className="flex-1 py-2.5 text-xs font-bold uppercase text-slate-500 hover:text-slate-900 border border-slate-900/10 rounded-xl">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 text-xs font-bold uppercase bg-[#1ca34c] text-white hover:brightness-110 rounded-full flex items-center justify-center gap-2">
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
