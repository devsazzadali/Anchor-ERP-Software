'use client'

export const dynamic = 'force-dynamic'
import React, { useState, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileCheck, ShieldCheck, Check, X,
  Eye, Minimize2, ZoomIn, ZoomOut, UserCheck, AlertTriangle,
  RefreshCw, Terminal, Loader2, Pencil, Landmark, Save, UserCircle
} from 'lucide-react'
import { recordActivityLog } from '@/lib/audit-logger'

type KycRequest = {
  id: string
  user_id: string
  full_name: string
  phone_number: string
  country: string
  address: string
  nid_front_url: string
  nid_back_url: string
  profile_photo_url: string | null
  selfie_url: string | null
  profile_type: string
  bank_account_number: string | null
  account_number: string | null  // alias field used as fallback
  bank_name: string | null
  account_holder_name: string | null
  district: string | null
  routing_code: string | null
  status: string
  rejection_reason: string | null
  admin_notes: string | null
  created_at: string
}

export default function KycReviews() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [queue, setQueue] = useState<KycRequest[]>([])
  const [selectedRequest, setSelectedRequest] = useState<KycRequest | null>(null)
  const [zoomImage, setZoomImage] = useState<string | null>(null)
  const [zoomScale, setZoomScale] = useState(1)
  const [adminNotes, setAdminNotes] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editFullName, setEditFullName] = useState('')
  const [editPhoneNumber, setEditPhoneNumber] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editCountry, setEditCountry] = useState('')
  const [editProfileType, setEditProfileType] = useState('employee')
  const [editBankName, setEditBankName] = useState('')
  const [editAccountHolder, setEditAccountHolder] = useState('')
  const [editAccountNumber, setEditAccountNumber] = useState('')
  const [editDistrict, setEditDistrict] = useState('')
  const [isSavingDetails, setIsSavingDetails] = useState(false)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Signed URL cache
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})

  const fetchQueue = async () => {
    setIsLoading(true)
    try {
      // the queue comes from the admin-gated /api/admin/kyc.
      const res = await fetch('/api/admin/kyc')
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Failed to load KYC queue')
      const data = payload.requests || []

      setQueue(data)

      // Auto-select based on URL param or first pending
      const paramId = searchParams?.get('id')
      const paramUser = searchParams?.get('user')
      if (data && data.length > 0) {
        let found = null;
        if (paramId) found = data.find((r: any) => r.id === paramId);
        if (!found && paramUser) found = data.find((r: any) => r.user_id === paramUser);
        if (found) setSelectedRequest(found);
        else if (!selectedRequest) setSelectedRequest(data[0]);
      }
    } catch (err: any) {
      setActionError('Failed to load KYC queue: ' + err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectRequest = (req: KycRequest) => {
    setSelectedRequest(req)
    setRejectionReason('')
    setAdminNotes(req.admin_notes || '')
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('id', req.id)
    if (req.user_id) params.set('user', req.user_id)
    router.replace(pathname + '?' + params.toString())
  }

  useEffect(() => {
    fetchQueue()
  }, [])

  // Derive status filter from URL
  const statusFilter = searchParams?.get('status') ?? 'all'

  const paramId = searchParams?.get('id') ?? null
  const paramUser = searchParams?.get('user') ?? null

  useEffect(() => {
    if (queue.length === 0) return
    const filtered = queue.filter(q => statusFilter === 'all' || q.status === statusFilter)
    if (paramId || paramUser) {
      let found = null
      if (paramId) found = queue.find(r => r.id === paramId)
      if (!found && paramUser) found = queue.find(r => r.user_id === paramUser)
      if (found && (!selectedRequest || selectedRequest.id !== found.id)) {
        setSelectedRequest(found)
        setRejectionReason('')
        setAdminNotes(found.admin_notes || '')
      }
    } else if (filtered.length > 0) {
      if (!selectedRequest || (statusFilter !== 'all' && selectedRequest.status !== statusFilter)) {
        setSelectedRequest(filtered[0])
        setRejectionReason('')
        setAdminNotes(filtered[0].admin_notes || '')
      }
    } else {
      setSelectedRequest(null)
    }
  }, [paramId, paramUser, statusFilter, queue, selectedRequest])

  const updateStatusFilter = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.delete('id')
    params.delete('user')
    if (value === 'all') {
      params.delete('status')
    } else {
      params.set('status', value)
    }
    const qs = params.toString()
    router.replace(pathname + (qs ? '?' + qs : ''))
  }

  // Resolve a KYC document reference to its file URL. Stored values
  // are already canonical file URLs (/api/files/kyc/...)
  // after the load-time rewrite — KYC documents are served
  // owner-or-admin only by that route, never via public URLs. A bare
  // storage path maps onto the kyc bucket (the old system's bucket).
  const getSignedUrl = async (path: string): Promise<string> => {
    if (signedUrls[path]) return signedUrls[path]

    // If it starts with http, it's already a URL
    if (path.startsWith('http')) {
      setSignedUrls(prev => ({ ...prev, [path]: path }))
      return path
    }

    const url = path.startsWith('/') ? path : `/api/files/kyc/${path}`
    setSignedUrls(prev => ({ ...prev, [path]: url }))
    return url
  }

  const loadSignedUrlsForRequest = async (req: KycRequest) => {
    if (req.nid_front_url) await getSignedUrl(req.nid_front_url)
    if (req.nid_back_url) await getSignedUrl(req.nid_back_url)
  }

  useEffect(() => {
    if (selectedRequest) {
      loadSignedUrlsForRequest(selectedRequest)
    }
  }, [selectedRequest])

  // Handle KYC verification approval
  const approveKyc = async (id: string) => {
    setActionSuccess(null)
    setActionError(null)
    const req = queue.find(q => q.id === id)
    if (!req) return

    try {
      // one transactional decision call — the route updates
      // verification_requests AND syncs the profile (verification
      // status, identity fields, role/profile_type, bank_info).
      const res = await fetch(`/api/admin/kyc/${id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', admin_notes: adminNotes || null })
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Approval failed')

      setQueue(prev => prev.map(item => item.id === id ? { ...item, status: 'approved' } : item))
      setSelectedRequest(null)
      setAdminNotes('')
      setActionSuccess('KYC dossier approved. Client now has full payout access.')
      setTimeout(() => setActionSuccess(null), 4000)

      recordActivityLog({
        action: 'KYC_APPROVED',
        details: {
          applicant: req.full_name,
          applicant_id: req.user_id,
          request_id: id,
          profile_type: req.profile_type,
          admin_notes: adminNotes || null
        }
      })
    } catch (err: any) {
      setActionError('Approval failed: ' + err.message)
    }
  }

  // Handle KYC rejection
  const rejectKyc = async (id: string) => {
    setActionSuccess(null)
    setActionError(null)
    if (!rejectionReason.trim()) {
      setActionError('Please provide a rejection reason before rejecting.')
      return
    }
    const req = queue.find(q => q.id === id)
    if (!req) return

    try {
      // transactional decision call (request + profile).
      const res = await fetch(`/api/admin/kyc/${id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          rejection_reason: rejectionReason,
          admin_notes: adminNotes || null
        })
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Rejection failed')

      setQueue(prev => prev.map(item => item.id === id ? { ...item, status: 'rejected', rejection_reason: rejectionReason } : item))
      setShowRejectModal(false)
      setSelectedRequest(null)
      setRejectionReason('')
      setAdminNotes('')
      setActionSuccess('Dossier rejected. Re-upload request dispatched to applicant.')
      setTimeout(() => setActionSuccess(null), 4000)

      recordActivityLog({
        action: 'KYC_REJECTED',
        details: {
          applicant: req.full_name,
          applicant_id: req.user_id,
          request_id: id,
          reason: rejectionReason,
          admin_notes: adminNotes || null
        }
      })
    } catch (err: any) {
      setActionError('Rejection failed: ' + err.message)
    }
  }

  // Open edit modal prefilled with all applicant details
  const handleOpenEditModal = () => {
    if (!selectedRequest) return
    setEditFullName(selectedRequest.full_name || '')
    setEditPhoneNumber(selectedRequest.phone_number || '')
    setEditAddress(selectedRequest.address || '')
    setEditCountry(selectedRequest.country || 'Bangladesh')
    setEditProfileType(selectedRequest.profile_type || 'employee')
    setEditBankName(selectedRequest.bank_name || '')
    setEditAccountHolder(selectedRequest.account_holder_name || '')
    setEditAccountNumber(selectedRequest.bank_account_number || selectedRequest.account_number || '')
    setEditDistrict(selectedRequest.district || '')
    setShowEditModal(true)
  }

  // Handle saving all edited KYC details
  const handleSaveAllDetails = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!selectedRequest) return
    setIsSavingDetails(true)
    setActionError(null)
    setActionSuccess(null)

    try {
      const trimmedFullName = editFullName.trim()
      if (!trimmedFullName) {
        throw new Error('Full Name is required.')
      }
      const trimmedPhone = editPhoneNumber.trim() || null
      const trimmedAddress = editAddress.trim() || null
      const trimmedCountry = editCountry.trim() || null
      const trimmedProfileType = editProfileType || 'employee'
      const trimmedBankName = editBankName.trim() || null
      const trimmedAccountHolder = editAccountHolder.trim() || null
      const trimmedAccountNumber = editAccountNumber.trim() || null
      const trimmedDistrict = editDistrict.trim() || null

      // one transactional decision call — the route updates
      // verification_requests and synchronizes the profile (merging
      // bank_info into the existing profile bank_info server-side).
      const vrPayload = {
        full_name: trimmedFullName,
        phone_number: trimmedPhone,
        address: trimmedAddress,
        country: trimmedCountry,
        profile_type: trimmedProfileType,
        bank_name: trimmedBankName,
        account_holder_name: trimmedAccountHolder,
        bank_account_number: trimmedAccountNumber,
        district: trimmedDistrict,
      }

      const res = await fetch(`/api/admin/kyc/${selectedRequest.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', ...vrPayload })
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Failed to update details')

      // Update local state in queue and selectedRequest
      const updatedFields = {
        full_name: trimmedFullName,
        phone_number: trimmedPhone || '',
        address: trimmedAddress || '',
        country: trimmedCountry || '',
        profile_type: trimmedProfileType,
        bank_name: trimmedBankName,
        account_holder_name: trimmedAccountHolder,
        bank_account_number: trimmedAccountNumber,
        account_number: trimmedAccountNumber,
        district: trimmedDistrict,
      }

      setSelectedRequest(prev => prev ? { ...prev, ...updatedFields } : null)
      setQueue(prev => prev.map(item => item.id === selectedRequest.id ? { ...item, ...updatedFields } : item))

      setShowEditModal(false)
      setActionSuccess('All applicant KYC details updated and synchronized with user profile.')
      setTimeout(() => setActionSuccess(null), 4000)

      recordActivityLog({
        action: 'KYC_DETAILS_EDITED',
        details: {
          applicant: trimmedFullName,
          applicant_id: selectedRequest.user_id,
          request_id: selectedRequest.id,
          updated_fields: updatedFields
        }
      })
    } catch (err: any) {
      setActionError('Failed to update details: ' + err.message)
    } finally {
      setIsSavingDetails(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans">

      {/* Background neon filters */}
      <div className="absolute top-[-10%] left-[20%] w-[50%] h-[50%] bg-[#d4af37]/3 rounded-full filter blur-[150px] pointer-events-none" />

      {/* Floating Sidebar */}

      {/* Main double column reviews workspace */}
      <div className="flex-1 flex flex-col p-6 overflow-y-auto max-h-screen relative z-10">

        {/* Upper title */}
        <div className="mb-6 pb-4 border-b border-slate-900/5 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900 font-serif">
              KYC Document <span className="premium-text-gradient">Review Bench</span>
            </h2>
            <p className="text-[11px] text-slate-500">Validate identity credentials, verify NID documents, and clear accounts.</p>
          </div>

          <button
            onClick={fetchQueue}
            disabled={isLoading}
            className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#d4af37]/20 text-slate-500 hover:text-slate-900 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#8a6d1f]' : ''}`} />
          </button>
        </div>

        {/* Feedback banners */}
        <AnimatePresence>
          {actionSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs mb-6 flex gap-2"
            >
              <Check className="w-4 h-4" />
              <span>{actionSuccess}</span>
            </motion.div>
          )}
          {actionError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs mb-6 flex gap-2"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>{actionError}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {isLoading && queue.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <span className="text-sm">Loading KYC queue...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">

            {/* LEFT LIST PANEL */}
            <div className="xl:col-span-4 space-y-4">
              <div className="glass-panel p-4 rounded-2xl relative shadow-xl">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    Requests ({queue.filter(q => statusFilter === 'all' || q.status === statusFilter).length})
                  </span>
                </div>

                {/* Status Filter Tabs */}
                <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
                  {['all', 'pending', 'approved', 'rejected'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => updateStatusFilter(tab)}
                      className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                        statusFilter === tab
                          ? 'bg-[#d4af37] text-black shadow-md font-extrabold'
                          : 'bg-slate-900/[0.04] text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.07]'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  {queue.filter(q => statusFilter === 'all' || q.status === statusFilter).map((req) => {
                    const isSelected = selectedRequest?.id === req.id

                    return (
                      <button
                        key={req.id}
                        onClick={() => handleSelectRequest(req)}
                        className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden flex items-center justify-between group ${
                          isSelected
                            ? 'bg-[#d4af37]/10 border-[#d4af37]/40 shadow'
                            : 'bg-slate-900/[0.04] border-slate-900/5 hover:border-slate-900/10'
                        }`}
                      >
                        <div>
                          <h4 className="text-xs font-bold text-slate-900 group-hover:text-[#8a6d1f] transition-colors">{req.full_name}</h4>
                          <p className="text-[10px] text-slate-500 mt-1">{req.phone_number}</p>
                          <span className="text-[8px] text-slate-600 font-mono block mt-1">{new Date(req.created_at).toLocaleDateString()}</span>
                        </div>

                        <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                          req.status === 'pending' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/10' :
                          req.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'
                        }`}>
                          {req.status}
                        </span>
                      </button>
                    )
                  })}

                  {queue.length === 0 && (
                    <p className="text-xs text-slate-500 text-center italic py-8">KYC applicant queue is completely cleared.</p>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT WORKBENCH PANEL */}
            <div className="xl:col-span-8">
              <AnimatePresence mode="wait">
                {selectedRequest ? (
                  <motion.div
                    key={selectedRequest.id}
                    initial={{ opacity: 0, x: 15 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -15 }}
                    className="glass-panel p-6 rounded-2xl relative shadow-2xl"
                  >
                    <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/30 to-transparent" />

                    {/* Workbench Title */}
                    <div className="flex justify-between items-start mb-6 border-b border-slate-900/5 pb-4">
                      <div>
                        <span className="text-[10px] font-bold text-[#8a6d1f] uppercase tracking-wider">Evaluation Console</span>
                        <h3 className="text-base font-bold text-slate-900 font-serif">{selectedRequest.full_name}</h3>
                        <p className="text-[10px] text-slate-500 font-mono">Ref: {selectedRequest.id}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleOpenEditModal}
                          className="px-3 py-1.5 rounded-lg bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 text-[#8a6d1f] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow hover:scale-[1.02] active:scale-[0.98]"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Edit All Info</span>
                        </button>
                        <span className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider ${
                          selectedRequest.status === 'pending' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' :
                          selectedRequest.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' :
                          'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                        }`}>{selectedRequest.status}</span>
                      </div>
                    </div>

                    {/* Metadata Specs Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6 text-xs bg-white p-4 rounded-xl border border-slate-900/5">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-slate-500 font-medium">Applicant Details:</span>
                          <button
                            type="button"
                            onClick={handleOpenEditModal}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-900/[0.04] hover:bg-slate-900/[0.07] border border-slate-900/10 hover:border-slate-900/20 text-slate-600 text-[10px] font-semibold transition-all cursor-pointer group"
                            title="Edit applicant information"
                          >
                            <Pencil className="w-3 h-3 text-[#8a6d1f] group-hover:scale-110 transition-transform" />
                            <span>Edit Info</span>
                          </button>
                        </div>
                        <div className="bg-slate-900/[0.04] border border-slate-900/5 rounded-lg p-2.5 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">Full Name:</span>
                            <span className="text-slate-900 font-semibold text-right">{selectedRequest.full_name}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">Phone:</span>
                            <span className="text-slate-900 font-semibold text-right">{selectedRequest.phone_number || 'N/A'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">Address:</span>
                            <span className="text-slate-900 font-semibold text-right max-w-[180px] truncate" title={selectedRequest.address || ''}>{selectedRequest.address || 'N/A'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">Country:</span>
                            <span className="text-slate-900 font-semibold text-right">{selectedRequest.country || 'Bangladesh'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">Profile Type:</span>
                            <span className="text-[#8a6d1f] font-semibold text-right capitalize">{selectedRequest.profile_type || 'employee'}</span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-slate-500 font-medium">Bank Details:</span>
                          <button
                            type="button"
                            onClick={handleOpenEditModal}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 text-[#8a6d1f] text-[10px] font-semibold transition-all cursor-pointer group"
                            title="Edit submitted bank details"
                          >
                            <Pencil className="w-3 h-3 group-hover:scale-110 transition-transform" />
                            <span>Edit Bank</span>
                          </button>
                        </div>
                        <div className="bg-slate-900/[0.04] border border-slate-900/5 rounded-lg p-2.5 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">Bank:</span>
                            <span className="text-slate-900 font-semibold text-right">{selectedRequest.bank_name || 'N/A'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">Holder:</span>
                            <span className="text-slate-600 font-mono text-right">{selectedRequest.account_holder_name || 'N/A'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">A/C:</span>
                            <span className="text-slate-700 font-mono font-medium text-right">{selectedRequest.bank_account_number || selectedRequest.account_number || 'N/A'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">District / Branch:</span>
                            <span className="text-slate-600 font-mono text-right">{selectedRequest.district || 'N/A'}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* NID DOCUMENT VIEWER */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      {/* NID Front */}
                      <div className="space-y-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">NID Card Front</span>
                        <NidImageBox
                          path={selectedRequest.nid_front_url}
                          alt="NID front"
                          signedUrls={signedUrls}
                          onZoom={setZoomImage}
                          onSetZoomScale={setZoomScale}
                        />
                      </div>

                      {/* NID Back */}
                      <div className="space-y-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">NID Card Back</span>
                        <NidImageBox
                          path={selectedRequest.nid_back_url}
                          alt="NID back"
                          signedUrls={signedUrls}
                          onZoom={setZoomImage}
                          onSetZoomScale={setZoomScale}
                        />
                      </div>
                    </div>

                    {/* DECISION AREA */}
                    {selectedRequest.status === 'pending' && (
                      <div className="space-y-4 pt-4 border-t border-slate-900/5">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Internal Audit Notes</label>
                          <textarea
                            rows={2}
                            value={adminNotes}
                            onChange={(e) => setAdminNotes(e.target.value)}
                            placeholder="e.g. Identity and address verify matching against Bangladesh NID server registry..."
                            className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3.5 px-4 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#d4af37]/40 transition-all resize-none"
                          />
                        </div>

                        <div className="flex gap-4">
                          <button
                            onClick={() => approveKyc(selectedRequest.id)}
                            className="flex-1 bg-gradient-to-r from-[#d4af37] to-white text-black font-semibold py-3 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg"
                          >
                            <UserCheck className="w-4 h-4" />
                            <span>Approve Applicant</span>
                          </button>
                          <button
                            onClick={() => setShowRejectModal(true)}
                            className="px-6 bg-rose-500/10 border border-rose-500/20 text-rose-600 hover:bg-rose-500/20 py-3 rounded-xl text-xs uppercase tracking-wider font-semibold cursor-pointer"
                          >
                            <span>Reject</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedRequest.status !== 'pending' && selectedRequest.rejection_reason && (
                      <div className="mt-4 p-4 rounded-xl bg-rose-500/5 border border-rose-500/20">
                        <span className="text-[9px] uppercase tracking-wider font-bold text-rose-600 block mb-1">Rejection Reason</span>
                        <p className="text-xs text-slate-600">{selectedRequest.rejection_reason}</p>
                      </div>
                    )}

                  </motion.div>
                ) : (
                  <div className="glass-panel p-12 rounded-2xl text-center text-slate-500 italic text-xs shadow-xl">
                    Select a pending applicant dossier from the queue to start comparison and verification checks.
                  </div>
                )}
              </AnimatePresence>
            </div>

          </div>
        )}

      </div>

      {/* ZOOM MAGNIFIER */}
      <AnimatePresence>
        {zoomImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/50 z-50 flex flex-col justify-center items-center p-6"
          >
            <div className="absolute top-6 left-6 right-6 flex justify-between items-center z-50 bg-white backdrop-blur-md px-5 py-3 rounded-xl border border-slate-900/5">
              <span className="text-xs font-semibold text-slate-900 tracking-widest uppercase flex items-center gap-2">
                <Terminal className="w-4 h-4 text-[#8a6d1f]" />
                Interactive Zoom Magnifier
              </span>
              <div className="flex gap-3">
                <button onClick={() => setZoomScale(s => Math.min(s + 0.25, 3))} className="p-3 bg-slate-900/[0.04] hover:bg-slate-900/[0.07] rounded-lg text-slate-900 transition-colors cursor-pointer">
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button onClick={() => setZoomScale(s => Math.max(s - 0.25, 0.75))} className="p-3 bg-slate-900/[0.04] hover:bg-slate-900/[0.07] rounded-lg text-slate-900 transition-colors cursor-pointer">
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button onClick={() => setZoomImage(null)} className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-600 hover:bg-rose-500/20 rounded-lg transition-colors cursor-pointer">
                  <Minimize2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <motion.div
              className="relative rounded-2xl overflow-hidden border border-slate-900/15 max-w-4xl max-h-[75vh]"
              style={{ scale: zoomScale }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            >
              <img src={zoomImage} alt="HD Magnified copy" className="max-w-full max-h-[75vh] object-contain" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* REJECTION MODAL */}
      <AnimatePresence>
        {showRejectModal && selectedRequest && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/50 z-50 flex justify-center items-center p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="glass-panel p-6 rounded-2xl max-w-md w-full relative shadow-2xl overflow-y-auto max-h-[90vh] border border-rose-500/30"
            >
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-rose-500/40 to-transparent" />

              <div className="flex gap-3 items-start mb-4">
                <div className="p-2 rounded-lg bg-rose-500/10 text-rose-600 border border-rose-500/20">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Specify Rejection Reasons</h3>
                  <p className="text-[10px] text-slate-500">Explain mismatch criteria. User will see this reason.</p>
                </div>
              </div>

              <div className="space-y-4">
                <textarea
                  rows={3}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. NID image blur. Please re-upload high-resolution photographs under good lighting..."
                  className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-rose-500/50 resize-none"
                />

                <div className="flex gap-3">
                  <button
                    onClick={() => rejectKyc(selectedRequest.id)}
                    className="flex-1 bg-rose-600 hover:bg-rose-700 transition-colors text-white font-semibold py-2.5 rounded-xl text-xs uppercase cursor-pointer"
                  >
                    Confirm Rejection
                  </button>
                  <button
                    onClick={() => setShowRejectModal(false)}
                    className="px-4 py-2.5 bg-white text-slate-500 rounded-xl text-xs font-semibold hover:text-slate-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* EDIT ALL INFO MODAL */}
      <AnimatePresence>
        {showEditModal && selectedRequest && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/50 z-50 flex justify-center items-center p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel p-6 rounded-2xl max-w-2xl w-full relative shadow-2xl overflow-hidden border border-[#d4af37]/30 bg-white max-h-[90vh] flex flex-col"
            >
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/40 to-transparent" />

              <div className="flex justify-between items-start mb-4 pb-3 border-b border-slate-900/5 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-[#d4af37]/10 text-[#8a6d1f] border border-[#d4af37]/20">
                    <Pencil className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 font-serif">Edit Applicant & KYC Information</h3>
                    <p className="text-[10px] text-slate-500">
                      Modifying record for <span className="text-slate-900 font-medium">{selectedRequest.full_name}</span> (Ref: {selectedRequest.id})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="p-3 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04] transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveAllDetails} className="space-y-4 overflow-y-auto custom-scrollbar flex-1 pr-1">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Column 1: Identity & Profile Details */}
                  <div className="space-y-3 bg-slate-900/[0.04] p-3.5 rounded-xl border border-slate-900/5">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-900/5">
                      <UserCircle className="w-4 h-4 text-[#8a6d1f]" />
                      <span className="text-[11px] font-bold text-slate-900 uppercase tracking-wider">Identity & Profile</span>
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1">
                        Full Name <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={editFullName}
                        onChange={(e) => setEditFullName(e.target.value)}
                        placeholder="Applicant Full Name"
                        className="w-full bg-slate-900/[0.04] border border-slate-900/10 focus:border-[#d4af37]/50 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none transition-colors"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1">
                        Phone Number
                      </label>
                      <input
                        type="text"
                        value={editPhoneNumber}
                        onChange={(e) => setEditPhoneNumber(e.target.value)}
                        placeholder="+880 1XXXXXXXXX"
                        className="w-full bg-slate-900/[0.04] border border-slate-900/10 focus:border-[#d4af37]/50 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1">
                        Physical Address
                      </label>
                      <textarea
                        rows={2}
                        value={editAddress}
                        onChange={(e) => setEditAddress(e.target.value)}
                        placeholder="Full street address / House / City"
                        className="w-full bg-slate-900/[0.04] border border-slate-900/10 focus:border-[#d4af37]/50 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none transition-colors resize-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1">
                        Country
                      </label>
                      <input
                        type="text"
                        value={editCountry}
                        onChange={(e) => setEditCountry(e.target.value)}
                        placeholder="Bangladesh"
                        className="w-full bg-slate-900/[0.04] border border-slate-900/10 focus:border-[#d4af37]/50 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1">
                        Profile Type / Role
                      </label>
                      <select
                        value={editProfileType}
                        onChange={(e) => setEditProfileType(e.target.value)}
                        className="w-full bg-white border border-slate-900/10 focus:border-[#d4af37]/50 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none transition-colors cursor-pointer"
                      >
                        <option value="employee">Employee</option>
                        <option value="partner">Partner</option>
                        <option value="head_office">Head Office</option>
                        <option value="branch_manager">Branch Manager</option>
                      </select>
                    </div>
                  </div>

                  {/* Column 2: Bank & Payout Details */}
                  <div className="space-y-3 bg-slate-900/[0.04] p-3.5 rounded-xl border border-slate-900/5">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-900/5">
                      <Landmark className="w-4 h-4 text-[#8a6d1f]" />
                      <span className="text-[11px] font-bold text-slate-900 uppercase tracking-wider">Bank & Financial Details</span>
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1">
                        Bank Name
                      </label>
                      <input
                        type="text"
                        value={editBankName}
                        onChange={(e) => setEditBankName(e.target.value)}
                        placeholder="e.g. Dutch-Bangla Bank PLC, Islami Bank"
                        className="w-full bg-slate-900/[0.04] border border-slate-900/10 focus:border-[#d4af37]/50 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1">
                        Account Holder Name
                      </label>
                      <input
                        type="text"
                        value={editAccountHolder}
                        onChange={(e) => setEditAccountHolder(e.target.value)}
                        placeholder="e.g. Md. Rahim Ahmed"
                        className="w-full bg-slate-900/[0.04] border border-slate-900/10 focus:border-[#d4af37]/50 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1">
                        Bank Account Number
                      </label>
                      <input
                        type="text"
                        value={editAccountNumber}
                        onChange={(e) => setEditAccountNumber(e.target.value)}
                        placeholder="e.g. 1041200000000"
                        className="w-full bg-slate-900/[0.04] border border-slate-900/10 focus:border-[#d4af37]/50 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 placeholder-slate-600 focus:outline-none transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1">
                        District / Branch Name
                      </label>
                      <input
                        type="text"
                        value={editDistrict}
                        onChange={(e) => setEditDistrict(e.target.value)}
                        placeholder="e.g. Dhaka, Motijheel Branch"
                        className="w-full bg-slate-900/[0.04] border border-slate-900/10 focus:border-[#d4af37]/50 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-600 focus:outline-none transition-colors"
                      />
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/5 mt-2">
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Changes will immediately sync to the user profile, Payouts, and Salary Disbursal.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-900/5 flex gap-3 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="flex-1 px-4 py-2.5 bg-white border border-slate-900/5 hover:border-slate-900/10 text-slate-500 rounded-xl text-xs font-semibold hover:text-slate-900 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingDetails}
                    className="flex-1 bg-gradient-to-r from-[#d4af37] to-white text-black font-semibold py-2.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg hover:brightness-110 transition-all disabled:opacity-50"
                  >
                    {isSavingDetails ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving Changes...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>Save All Changes</span>
                      </>
                    )}
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

// Helper component for NID image display
function NidImageBox({
  path,
  alt,
  signedUrls,
  onZoom,
  onSetZoomScale
}: {
  path: string
  alt: string
  signedUrls: Record<string, string>
  onZoom: (url: string) => void
  onSetZoomScale: (scale: number) => void
}) {
  const url = signedUrls[path] || ''
  const isPdf = path?.toLowerCase().endsWith('.pdf')

  return (
    <div className="relative aspect-square rounded-xl overflow-hidden border border-slate-900/5 group bg-white flex items-center justify-center">
      {url ? (
        isPdf ? (
          <div className="flex flex-col items-center justify-center gap-2 text-slate-500">
            <FileCheck className="w-8 h-8 text-[#8a6d1f]" />
            <span className="text-[9px] uppercase tracking-wider">PDF Document</span>
            <a href={url} target="_blank" rel="noreferrer" className="text-[9px] text-[#8a6d1f] underline">Open PDF</a>
          </div>
        ) : (
          <>
            <img src={url} alt={alt} className="w-full h-full object-cover" />
            <button
              onClick={() => { onZoom(url); onSetZoomScale(1); }}
              className="absolute inset-0 bg-white opacity-0 group-hover:opacity-100 flex items-center justify-center text-slate-900 transition-opacity cursor-pointer"
            >
              <Eye className="w-4 h-4 mr-1" /> View Zoom
            </button>
          </>
        )
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 text-slate-600">
          <ShieldCheck className="w-6 h-6" />
          <span className="text-[9px]">Loading...</span>
        </div>
      )}
    </div>
  )
}
