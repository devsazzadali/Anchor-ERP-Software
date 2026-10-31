'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CreditCard, Landmark, Phone, AlertTriangle, ShieldCheck,
  Check, X, FileText, Compass, Clock, Terminal, ChevronRight,
  ShieldAlert, Camera, ArrowUpRight
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { generatePdf } from '@/lib/pdf-generator'
import { recordActivityLog } from '@/lib/audit-logger'
import { uploadFile } from '@/lib/files-client'
import PaymentAccountCard, { type PaymentAccountField } from '@/components/PaymentAccountCard'

// Part B: the selected payout request's clearance target as
// PaymentAccountCard fields. Sources: PaymentRequest.payment_details
// Json (what the dashboard writes) merged with the request's
// dedicated columns — both read in camelCase AND snake_case, as the
// clearance grid always did. No schema change: every field below
// already exists in the model.
export function payoutAccountFields(req: any): PaymentAccountField[] {
  if (!req) return []
  const d = req.paymentDetails && typeof req.paymentDetails === 'object' ? req.paymentDetails : {}
  const pick = (...keys: string[]): string | number | null => {
    for (const k of keys) {
      const v = d[k]
      if (v !== null && v !== undefined && String(v).trim() !== '') return v
    }
    return null
  }
  if (req.paymentMethod === 'bank_transfer') {
    return [
      { label: 'Account Holder Name', value: pick('accountName', 'account_name') },
      { label: 'Bank Name', value: pick('bankName', 'bank_name') },
      { label: 'Account Number', value: pick('accountNumber', 'account_number') },
      { label: 'Branch', value: pick('branchName', 'branch_name') },
      { label: 'District', value: pick('district') },
      { label: 'Routing Number', value: pick('routingNumber', 'routing_number') },
      { label: 'SWIFT Code', value: pick('swiftCode', 'swift_code') },
      { label: 'Mobile Number', value: pick('mobileNumber', 'mobile_number') },
    ]
  }
  return [
    { label: 'Payment Method', value: req.paymentMethod || null },
    { label: 'Registered Name', value: pick('accountName', 'account_name') },
    { label: 'Mobile Number', value: pick('mobileNumber', 'mobile_number') },
    { label: 'Account Number', value: pick('accountNumber', 'account_number') },
  ]
}

// Stored file values resolve through the file server: API
// paths and absolute URLs pass through unchanged; bare stored paths
// are served from the payment_proofs bucket route (never a public
// storage URL).
const resolveFileUrl = (url: string | null | undefined) => {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/')) return url
  return `/api/files/payment_proofs/${url}`
}

// Mock incoming requests
const INITIAL_REQUESTS: any[] = []

export default function PayoutManagement() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [requests, setRequests] = useState<any[]>([])
  const [selectedReq, setSelectedReq] = useState<any | null>(null)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [transactionId, setTransactionId] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [screenshotAttached, setScreenshotAttached] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showExportDropdown, setShowExportDropdown] = useState(false)
  const [isSelectMode, setIsSelectMode] = useState(false)

  // Status filter is URL-driven
  const statusFilter = searchParams?.get('status') ?? 'all'

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

  const fetchRequests = async () => {
    try {
      // C38: both sources feed a money queue — the API returns
      // every row server-side so the old 1,000-row client cap can
      // never silently drop requests/transfers.
      const res = await fetch('/api/admin/payments')
      if (!res.ok) throw new Error('Failed to fetch payments')
      const { paymentRequests: data, valueTransfers } = await res.json()

      let allRequests: any[] = []

      if (data) {
        allRequests = data.map((r: any) => ({
          id: r.id,
          invoiceTitle: r.invoice_title,
          invoiceNumber: r.invoice_number,
          amount: Number(r.amount),
          currency: r.currency || 'BDT',
          paymentMethod: r.payment_method,
          status: r.status,
          userName: r.profiles?.full_name || 'Client',
          userEmail: 'anchorfashionsupport@gmail.com', // Would need email from auth if needed
          // Part B: dedicated PaymentRequest columns are merged
          // UNDER payment_details (the Json the dashboard writes
          // wins) so the clearance card can read either store.
          paymentDetails: {
            account_name: r.account_name ?? null,
            mobile_number: r.mobile_number ?? null,
            bank_name: r.bank_name ?? null,
            account_number: r.account_number ?? null,
            routing_number: r.routing_number ?? null,
            branch_name: r.branch_name ?? null,
            swift_code: r.swift_code ?? null,
            ...(r.payment_details || {}),
          },
          invoiceFileUrl: r.invoice_file_url || '',
          submittedAt: r.created_at,
          completedAt: r.completed_at || null,
          transactionId: r.transaction_id || null,
          adminNotes: r.admin_notes || '',
          user_id: r.user_id,
          paymentScreenshotUrl: r.payment_screenshot_url || null,
          is_value_transfer: false
        }))
      }

      if (valueTransfers) {
        const vtAdapted = valueTransfers.map((vt: any) => ({
          id: vt.id,
          invoiceTitle: 'Value Transfer',
          invoiceNumber: `VT-${vt.id.substring(0, 8).toUpperCase()}`,
          amount: Number(vt.amount),
          currency: 'BDT',
          paymentMethod: 'system_transfer',
          status: 'completed',
          userName: vt.profiles?.full_name || 'Partner',
          userEmail: 'N/A',
          paymentDetails: { account: vt.account, notes: vt.notes },
          invoiceFileUrl: '',
          submittedAt: vt.payment_date,
          completedAt: vt.payment_date,
          transactionId: vt.transaction_id || 'N/A',
          adminNotes: vt.notes || 'Direct Partner Value Transfer',
          user_id: vt.employee_id,
          paymentScreenshotUrl: vt.payment_proof_url || null,
          is_value_transfer: true
        }))
        allRequests = [...allRequests, ...vtAdapted]
      }

      // Sort combined array by submittedAt desc
      allRequests.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())

      setRequests(allRequests)
      const paramId = searchParams?.get('id')
      if (paramId) {
        const found = allRequests.find(a => a.id === paramId)
        if (found) setSelectedReq(found)
        else if (allRequests.length > 0 && !selectedReq) setSelectedReq(allRequests[0])
      } else if (allRequests.length > 0 && !selectedReq) {
        setSelectedReq(allRequests[0])
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleSelectReq = (req: any) => {
    setSelectedReq(req)
    const params = new URLSearchParams(searchParams?.toString() || '')
    if (req) params.set('id', req.id)
    else params.delete('id')
    router.replace(pathname + '?' + params.toString())
  }

  useEffect(() => {
    fetchRequests()
  }, [])

  const paramId = searchParams?.get('id') ?? null
  const paramUser = searchParams?.get('user') ?? null

  useEffect(() => {
    if (requests.length === 0) return
    const filtered = requests.filter(r => statusFilter === 'all' || r.status === statusFilter)
    if (paramId || paramUser) {
      let found = null
      if (paramId) found = requests.find(r => r.id === paramId)
      if (!found && paramUser) found = requests.find(r => r.user_id === paramUser)
      if (found && (!selectedReq || selectedReq.id !== found.id)) {
        setSelectedReq(found)
      }
    } else if (filtered.length > 0) {
      if (!selectedReq || (statusFilter !== 'all' && selectedReq.status !== statusFilter)) {
        setSelectedReq(filtered[0])
      }
    } else {
      setSelectedReq(null)
    }
  }, [paramId, paramUser, statusFilter, requests, selectedReq])

  const handleExportCSV = () => {
    const selectedRequests = requests.filter(r => selectedIds.includes(r.id))
    if (selectedRequests.length === 0) return

    // Define CSV Headers
    const headers = [
      'Invoice Title',
      'Invoice Number',
      'Client Name',
      'Amount (BDT)',
      'Payment Method',
      'Status',
      'Transaction ID',
      'Submitted At',
      'Completed At',
      'Bank/Wallet Details'
    ]

    // Convert rows
    const rows = selectedRequests.map(r => {
      let detailsString = ''
      if (r.paymentMethod === 'bank_transfer') {
        const bank = r.paymentDetails?.bankName || r.paymentDetails?.bank_name || ''
        const accName = r.paymentDetails?.accountName || r.paymentDetails?.account_name || ''
        const accNo = r.paymentDetails?.accountNumber || r.paymentDetails?.account_number || ''
        const dist = r.paymentDetails?.district || r.paymentDetails?.routingNumber || r.paymentDetails?.routing_number || ''
        detailsString = `Bank: ${bank} | Account Name: ${accName} | Account No: ${accNo} | District: ${dist}`
      } else {
        const accName = r.paymentDetails?.accountName || r.paymentDetails?.account_name || ''
        const mobNo = r.paymentDetails?.mobileNumber || r.paymentDetails?.mobile_number || ''
        detailsString = `Wallet: ${r.paymentMethod} | Name: ${accName} | Mobile: ${mobNo}`
      }

      // Escape quotes for CSV compatibility
      const escape = (val: any) => {
        const text = val === null || val === undefined ? '' : String(val)
        return `"${text.replace(/"/g, '""')}"`
      }

      return [
        escape(r.invoiceTitle),
        escape(r.invoiceNumber),
        escape(r.userName),
        r.amount,
        escape(r.paymentMethod),
        escape(r.status),
        escape(r.transactionId),
        escape(new Date(r.submittedAt).toLocaleString()),
        r.completedAt ? escape(new Date(r.completedAt).toLocaleString()) : 'N/A',
        escape(detailsString)
      ].join(',')
    })

    const csvContent = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `liquidity_payouts_export_${new Date().toISOString().slice(0,10)}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleExportExcel = () => {
    const selectedRequests = requests.filter(r => selectedIds.includes(r.id))
    if (selectedRequests.length === 0) return

    // Format data for sheetjs
    const dataToExport = selectedRequests.map(r => {
      let detailsString = ''
      if (r.paymentMethod === 'bank_transfer') {
        const bank = r.paymentDetails?.bankName || r.paymentDetails?.bank_name || ''
        const accName = r.paymentDetails?.accountName || r.paymentDetails?.account_name || ''
        const accNo = r.paymentDetails?.accountNumber || r.paymentDetails?.account_number || ''
        const dist = r.paymentDetails?.district || r.paymentDetails?.routingNumber || r.paymentDetails?.routing_number || ''
        detailsString = `Bank: ${bank} | Account Name: ${accName} | Account No: ${accNo} | District: ${dist}`
      } else {
        const accName = r.paymentDetails?.accountName || r.paymentDetails?.account_name || ''
        const mobNo = r.paymentDetails?.mobileNumber || r.paymentDetails?.mobile_number || ''
        detailsString = `Wallet: ${r.paymentMethod} | Name: ${accName} | Mobile: ${mobNo}`
      }

      return {
        'Invoice Title': r.invoiceTitle,
        'Invoice Number': r.invoiceNumber,
        'Client Name': r.userName,
        'Amount (BDT)': r.amount,
        'Payment Method': r.paymentMethod === 'bank_transfer' ? 'Bank Transfer' : r.paymentMethod,
        'Status': r.status,
        'Transaction ID': r.transactionId || '',
        'Submitted At': new Date(r.submittedAt).toLocaleString(),
        'Completed At': r.completedAt ? new Date(r.completedAt).toLocaleString() : 'N/A',
        'Bank/Wallet Details': detailsString
      }
    })

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(dataToExport)
    // Create workbook
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'PayoutsData')
    // Download XLSX file
    XLSX.writeFile(workbook, `liquidity_payouts_export_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  const handleExportPDF = async () => {
    const selectedRequests = requests.filter(r => selectedIds.includes(r.id))
    if (selectedRequests.length === 0) return

    const columns = [
      'Invoice Title',
      'Invoice Number',
      'Client Name',
      'Amount (BDT)',
      'Payment Method',
      'Status',
      'Transaction ID',
      'Submitted At',
      'Completed At',
      'Bank/Wallet Details'
    ]

    const rows = selectedRequests.map(r => {
      let detailsString = ''
      if (r.paymentMethod === 'bank_transfer') {
        const bank = r.paymentDetails?.bankName || r.paymentDetails?.bank_name || ''
        const accName = r.paymentDetails?.accountName || r.paymentDetails?.account_name || ''
        const accNo = r.paymentDetails?.accountNumber || r.paymentDetails?.account_number || ''
        const dist = r.paymentDetails?.district || r.paymentDetails?.routingNumber || r.paymentDetails?.routing_number || ''
        detailsString = `Bank: ${bank} | Account Name: ${accName} | Account No: ${accNo} | District: ${dist}`
      } else {
        const accName = r.paymentDetails?.accountName || r.paymentDetails?.account_name || ''
        const mobNo = r.paymentDetails?.mobileNumber || r.paymentDetails?.mobile_number || ''
        detailsString = `Wallet: ${r.paymentMethod} | Name: ${accName} | Mobile: ${mobNo}`
      }
      return [
        r.invoiceTitle,
        r.invoiceNumber,
        r.userName,
        r.amount,
        r.paymentMethod,
        r.status,
        r.transactionId || '',
        new Date(r.submittedAt).toLocaleString(),
        r.completedAt ? new Date(r.completedAt).toLocaleString() : 'N/A',
        detailsString
      ]
    })

    // C36: this queue merges TWO kinds of money — partner payout
    // requests and partner salary payments relabelled as "value
    // transfers" (which ALSO appear in the salary ledger / payroll
    // totals). A single blended "Total Payout Amount" let the same
    // money be presented as both payout and salary. The PDF summary
    // now splits the total by source type.
    const payoutTotal = selectedRequests.filter(r => !r.is_value_transfer).reduce((sum, r) => sum + Number(r.amount), 0)
    const transferTotal = selectedRequests.filter(r => r.is_value_transfer).reduce((sum, r) => sum + Number(r.amount), 0)

    await generatePdf('Liquidity Payouts', columns, rows, {
      summaryData: [
        { label: 'Partner Payouts (payment requests)', value: `${payoutTotal.toLocaleString()} BDT` },
        { label: 'Partner Value Transfers (salary payments — also in payroll)', value: `${transferTotal.toLocaleString()} BDT` },
        { label: 'Combined Total', value: `${(payoutTotal + transferTotal).toLocaleString()} BDT` }
      ],
      filename: `payouts_${new Date().getTime()}.pdf`
    })
  }

  // Step 1: Accept -> Processing
  // Step 1: Accept -> Processing
  const handleAccept = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/payments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'processing', only_from: 'pending' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to accept request')
      }

      setRequests(prev => prev.map(req => {
        if (req.id === id) {
          const updated = { ...req, status: 'processing' }
          if (selectedReq?.id === id) setSelectedReq(updated)
          return updated
        }
        return req
      }))

      setFeedback('Payout request accepted. Moved to Processing queue.')
      setTimeout(() => setFeedback(null), 3000)

      recordActivityLog({
        action: 'PAYOUT_PROCESSING',
        details: {
          request_id: id,
          recipient: selectedReq?.userName || 'Client',
          amount: selectedReq?.amount,
          currency: selectedReq?.currency || 'BDT',
          payment_method: selectedReq?.paymentMethod
        }
      })
    } catch (e: any) {
      console.error(e)
      setFeedback(`Error accepting request: ${e.message || 'Permission denied or RLS policy block'}`)
      setTimeout(() => setFeedback(null), 4000)
    }
  }

  // Step 2: Confirm -> Completed
  const handleConfirmCompletion = async () => {
    if (!transactionId || !selectedReq) return
    const id = selectedReq.id

    try {
      setIsUploading(true)
      let screenshotUrl = ''

      if (selectedFile) {
        const fileExt = selectedFile.name.split('.').pop()
        const fileName = `${id}_proof_${Date.now()}.${fileExt}`
        try {
          const uploaded = await uploadFile('payment_proofs', selectedFile, fileName)
          screenshotUrl = uploaded.url
        } catch (uploadError: any) {
          // Old flow warned and proceeded with settlement when the
          // proof upload failed; keep that behaviour.
          console.warn('Screenshot upload notice (payment_proofs bucket):', uploadError.message)
        }
      }

      // completion runs server-side in one transaction (the
      // old complete_payout_atomic RPC equivalent) — the request
      // update and the transactions ledger insert can no longer
      // diverge the way the old client fallback allowed.
      const res = await fetch(`/api/admin/payments/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          screenshot_url: screenshotUrl || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(`Permission or database error: ${data.error || 'completion failed'}`)
      }

      setRequests(prev => prev.map(req => {
        if (req.id === id) {
          const updated = { ...req, status: 'completed', transactionId, paymentScreenshotUrl: screenshotUrl || req.paymentScreenshotUrl }
          setSelectedReq(updated)
          return updated
        }
        return req
      }))

      // Trigger Email to User
      fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'PAYOUT_COMPLETED',
          payload: {
            userId: selectedReq.user_id,
            recipient: selectedReq.userName,
            email: selectedReq.userEmail && selectedReq.userEmail !== 'anchorfashionsupport@gmail.com' ? selectedReq.userEmail : null,
            amount: selectedReq.amount,
            currency: selectedReq.currency || 'BDT',
            transactionId,
            paymentMethod: selectedReq.paymentMethod || 'Bank Transfer / Mobile Banking',
            invoiceTitle: selectedReq.invoiceTitle || 'Partner Earnings Payout'
          }
        })
      }).catch(e => console.error('Failed to trigger payout completion email', e));

      setShowConfirmModal(false)
      setTransactionId('')
      setScreenshotAttached(false)
      setSelectedFile(null)
      setFeedback('Payout completed successfully. Transaction ID cleared.')
      setTimeout(() => setFeedback(null), 3000)

      recordActivityLog({
        action: 'PAYOUT_COMPLETED',
        details: {
          request_id: id,
          recipient: selectedReq.userName,
          user_id: selectedReq.user_id,
          amount: selectedReq.amount,
          currency: selectedReq.currency || 'BDT',
          transaction_id: transactionId,
          payment_method: selectedReq.paymentMethod || 'bank_transfer',
          has_screenshot: Boolean(screenshotUrl)
        }
      })
    } catch (e: any) {
      console.error(e)
      setFeedback(`Failed to complete payout: ${e.message || 'Please verify admin permissions'}`)
      setTimeout(() => setFeedback(null), 4000)
    } finally {
      setIsUploading(false)
    }
  }

  // Admin Flag actions: Hold, Fraud, Reject
  const changeStatus = async (id: string, status: 'hold' | 'fraud_flagged' | 'rejected') => {
    try {
      const res = await fetch(`/api/admin/payments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to modify status')
      }

      setRequests(prev => prev.map(req => {
        if (req.id === id) {
          const updated = { ...req, status }
          if (selectedReq?.id === id) setSelectedReq(updated)
          return updated
        }
        return req
      }))

      setFeedback(`Status modified to ${status.toUpperCase()}. Operational ledger updated.`)
      setTimeout(() => setFeedback(null), 3000)
    } catch (e: any) {
      console.error(e)
      setFeedback(`Error modifying status: ${e.message || 'Permission denied'}`)
      setTimeout(() => setFeedback(null), 4000)
    }
  }

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans">

      {/* Background neon filters */}
      <div className="absolute top-[-10%] right-[-5%] w-[50%] h-[50%] bg-[#1ca34c]/3 rounded-full filter blur-[150px] pointer-events-none" />

      {/* Floating Sidebar */}

      {/* Main Core telemetry workspace */}
      <div className="flex-1 flex flex-col p-6 overflow-y-auto max-h-screen relative z-10">

        {/* Upper title */}
        <div className="mb-6 pb-4 border-b border-slate-900/5 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 font-serif flex items-center gap-3">
              <span className="w-1.5 h-8 rounded-full bg-[#1ca34c] shrink-0" />
              Liquidity Payout <span className="premium-text-gradient">Manager Desk</span>
            </h2>
            <p className="text-[11px] text-slate-500">Clear settlement payouts, audit billing details, and verify transaction hashes.</p>
          </div>
        </div>

        {feedback && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs mb-6 flex gap-2">
            <Check className="w-4 h-4" />
            <span>{feedback}</span>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">

          {/* LEFT LIST PANEL: INCOMING PAYOUT CLAIMS QUEUE (xl:col-span-5) */}
          <div className="xl:col-span-5 space-y-4">
            <div className="glass-panel p-4 rounded-2xl relative shadow-xl">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-900/5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Payout Claims Queue</span>
                <div className="flex items-center gap-3">
                  {!isSelectMode ? (
                    <button
                      onClick={() => setIsSelectMode(true)}
                      className="px-2.5 py-1 bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#1ca34c]/40 text-slate-600 hover:text-slate-900 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                    >
                      Select Mode
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setIsSelectMode(false)
                          setSelectedIds([])
                        }}
                        className="px-2 py-0.5 bg-white border border-slate-900/5 text-slate-500 hover:text-slate-900 rounded text-[8px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                      >
                        Cancel
                      </button>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={requests.length > 0 && selectedIds.length === requests.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(requests.map(r => r.id))
                            } else {
                              setSelectedIds([])
                            }
                          }}
                          className="w-3 h-3 rounded border-slate-900/10 bg-white text-[#15803d] focus:ring-0 accent-[#1ca34c] cursor-pointer"
                        />
                        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider">All</span>
                      </label>
                    </>
                  )}
                  {isSelectMode && selectedIds.length > 0 && (
                    <div className="relative">
                      <button
                        onClick={() => setShowExportDropdown(prev => !prev)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-[#1ca34c] text-white hover:brightness-110 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all hover:scale-105 active:scale-95 shadow-md shadow-[#1ca34c]/10 cursor-pointer"
                      >
                        <FileText className="w-3 h-3" />
                        <span>Export ({selectedIds.length}) ▼</span>
                      </button>

                      {showExportDropdown && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowExportDropdown(false)} />
                          <div className="absolute right-0 mt-1.5 w-36 bg-white border border-slate-900/10 rounded-lg shadow-xl py-1 z-20 flex flex-col">
                            <button
                              onClick={() => {
                                handleExportExcel();
                                setShowExportDropdown(false);
                              }}
                              className="px-3 py-1.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#15803d] text-slate-900 transition-colors cursor-pointer"
                            >
                              Export to Excel (.xlsx)
                            </button>
                            <button
                              onClick={() => {
                                handleExportCSV();
                                setShowExportDropdown(false);
                              }}
                              className="px-3 py-1.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#15803d] text-slate-900 transition-colors border-t border-slate-900/5 cursor-pointer"
                            >
                              Export to CSV (.csv)
                            </button>
                            <button
                              onClick={() => {
                                handleExportPDF();
                                setShowExportDropdown(false);
                              }}
                              className="px-3 py-1.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#15803d] text-slate-900 transition-colors border-t border-slate-900/5 cursor-pointer"
                            >
                              Export to PDF (.pdf)
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Status Filter Tabs */}
              <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1">
                {['all', 'pending', 'processing', 'completed'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => updateStatusFilter(tab)}
                    className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                      statusFilter === tab
                        ? 'bg-[#1ca34c] text-white shadow-md shadow-[#1ca34c]/20 font-extrabold'
                        : 'bg-slate-900/[0.04] text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.07]'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {requests.filter(r => statusFilter === 'all' || r.status === statusFilter).map((req) => {
                  const isSelected = selectedReq?.id === req.id
                  const isChecked = selectedIds.includes(req.id)
                  const statusColors = {
                    pending: 'bg-amber-500/10 text-amber-600 border border-amber-500/15',
                    processing: 'bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20',
                    completed: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/10',
                    hold: 'bg-slate-100 text-slate-500 border border-slate-700',
                    fraud_flagged: 'bg-rose-500/10 text-rose-600 border border-rose-500/20 animate-pulse'
                  }[req.status as 'pending' | 'processing' | 'completed' | 'hold' | 'fraud_flagged'] || 'bg-slate-100 text-slate-500'

                  return (
                    <div key={req.id} className="flex items-center gap-2.5 group/row">
                      {isSelectMode && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(prev => [...prev, req.id])
                            } else {
                              setSelectedIds(prev => prev.filter(id => id !== req.id))
                            }
                          }}
                          className="w-4 h-4 rounded border-slate-900/10 bg-white text-[#15803d] focus:ring-0 accent-[#1ca34c] cursor-pointer transition-all hover:scale-110 shrink-0"
                        />
                      )}
                      <button
                        onClick={() => handleSelectReq(req)}
                        className={`flex-1 text-left p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between group gap-3 ${
                          isSelected
                            ? 'bg-[#1ca34c]/10 border-[#1ca34c]/40 shadow-lg'
                            : 'bg-slate-900/[0.04] border-slate-900/5 hover:border-slate-900/10'
                        }`}
                      >
                        <div className="flex justify-between items-start w-full">
                          <div>
                            <h4 className="text-xs font-bold text-slate-900 group-hover:text-[#15803d] transition-colors">{req.invoiceTitle}</h4>
                            <p className="text-[10px] text-slate-500 mt-1">{req.userName} ({req.userEmail})</p>
                          </div>
                          <span className={`px-2.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider ${statusColors}`}>
                            {req.status}
                          </span>
                        </div>

                        <div className="flex justify-between items-center w-full mt-1.5 pt-2.5 border-t border-slate-900/[0.08]">
                          <span className="text-sm font-bold text-slate-900">{req.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} BDT</span>
                          <span className="text-[9px] text-slate-500 font-mono uppercase">{req.paymentMethod === 'bank_transfer' ? 'Bank Transfer' : req.paymentMethod}</span>
                        </div>
                      </button>
                    </div>
                  )
                })}

                {requests.filter(r => statusFilter === 'all' || r.status === statusFilter).length === 0 && (
                  <p className="text-xs text-slate-500 text-center italic py-8">Incoming payout queue is empty for this filter.</p>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT WORKBENCH PANEL: CLEARANCE AND GATEWAY STATUS ACTIONS (xl:col-span-7) */}
          <div className="xl:col-span-7">
            <AnimatePresence mode="wait">
              {selectedReq ? (
                <motion.div
                  key={selectedReq.id}
                  initial={{ opacity: 0, x: 15 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -15 }}
                  className="glass-panel p-6 rounded-2xl relative shadow-2xl space-y-6"
                >
                  <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#1ca34c]/30 to-transparent" />

                  {/* Title & Status */}
                  <div className="flex justify-between items-start border-b border-slate-900/5 pb-4">
                    <div>
                      <span className="text-[10px] font-bold text-[#15803d] uppercase tracking-wider">Settlement Console</span>
                      <h3 className="text-base font-bold text-slate-900 font-serif">{selectedReq.invoiceTitle}</h3>
                      <p className="text-[10px] text-slate-500 font-mono">Invoice Reference: {selectedReq.invoiceNumber}</p>
                    </div>

                    <span className="text-lg font-extrabold text-slate-900">{selectedReq.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} BDT</span>
                  </div>

                  {/* Target Billing Specifics — Part B: the clearance
                      target is now the shared per-field copyable card
                      (was a display-only grid), shown BEFORE any
                      accept / confirm action below. */}
                  <PaymentAccountCard
                    title="Clearance Target — Payment Account (Send money here)"
                    fields={payoutAccountFields(selectedReq)}
                  />

                  {/* ACTIVE WORKFLOW STEP ACTIONS */}
                  <div className="space-y-4 pt-4 border-t border-slate-900/5">

                    {selectedReq.status === 'pending' && (
                      <div className="space-y-3">
                        <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">Claim Workflow State: Pending Approval</span>
                        <div className="flex gap-4">
                          <button
                            onClick={() => handleAccept(selectedReq.id)}
                            className="flex-1 bg-[#1ca34c] text-white font-semibold py-3.5 rounded-full text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg"
                          >
                            <Check className="w-4 h-4" />
                            <span>Accept & Move to Processing</span>
                          </button>

                          <button
                            onClick={() => changeStatus(selectedReq.id, 'rejected')}
                            className="px-6 py-3 bg-rose-500/10 border border-rose-500/20 text-rose-600 hover:bg-rose-500/20 rounded-xl text-xs font-semibold uppercase tracking-wider"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedReq.status === 'processing' && (
                      <div className="space-y-4">
                        <div className="p-3.5 rounded-xl bg-[#1ca34c]/5 border border-[#1ca34c]/20 text-[#15803d] text-[10px] flex items-center gap-2">
                          <Clock className="w-4 h-4 animate-pulse" />
                          <span>Invoice Claim is currently under active Processing state. Transfer funds to client target bank specifications.</span>
                        </div>

                        <button
                          onClick={() => setShowConfirmModal(true)}
                          className="w-full bg-[#1ca34c] text-white font-semibold py-3.5 rounded-full text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg"
                        >
                          <Compass className="w-4 h-4 animate-spin" />
                          <span>Input Transaction ID & Clear Payout</span>
                        </button>
                      </div>
                    )}

                    {selectedReq.status === 'completed' && (
                      <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-600 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                          <ShieldCheck className="w-4.5 h-4.5" />
                          <span>Payout Cleared successfully</span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-sans">
                          Sovereign funds released under hash ID: <strong className="text-slate-900 font-mono">{selectedReq.transactionId}</strong>
                        </p>
                        {selectedReq.paymentScreenshotUrl && (
                          <div className="pt-2 border-t border-emerald-500/20">
                            <a
                              href={resolveFileUrl(selectedReq.paymentScreenshotUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 underline flex items-center gap-1 w-max"
                            >
                              <Camera className="w-3 h-3" /> View Payment Proof Receipt
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    {/* FLAGS SUB-HUD FOR FLEXIBLE CONTROLS */}
                    {selectedReq.status !== 'completed' && (
                      <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 space-y-3">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Executive Risk Flag Override Controls</span>
                        <div className="flex flex-wrap gap-2.5">
                          <button
                            onClick={() => changeStatus(selectedReq.id, 'hold')}
                            className="px-3.5 py-2 rounded-lg bg-white border border-slate-900/5 hover:border-[#1ca34c]/30 text-slate-500 hover:text-slate-900 text-[10px] font-semibold tracking-wider transition-colors cursor-pointer"
                          >
                            Hold settlement
                          </button>
                          <button
                            onClick={() => changeStatus(selectedReq.id, 'fraud_flagged')}
                            className="px-3.5 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 hover:bg-rose-500/20 text-[10px] font-bold tracking-wider transition-colors cursor-pointer"
                          >
                            Flag Potential Fraud
                          </button>
                        </div>
                      </div>
                    )}

                  </div>

                </motion.div>
              ) : (
                <div className="glass-panel p-12 rounded-2xl text-center text-slate-500 italic text-xs shadow-xl">
                  Select an active incoming payment request dossier to clear liquidity.
                </div>
              )}
            </AnimatePresence>
          </div>

        </div>

      </div>

      {/* POPUP: CLEARANCE TRANSACTION ID CONFIRMATION MODAL */}
      <AnimatePresence>
        {showConfirmModal && selectedReq && (
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
              className="glass-panel p-6 rounded-2xl max-w-md w-full relative shadow-2xl overflow-y-auto max-h-[90vh] border border-[#1ca34c]/30"
            >
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#1ca34c]/40 to-transparent" />

              <div className="flex gap-3 items-start mb-4">
                <div className="p-2 rounded-lg bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Clearance Verification Protocol</h3>
                  <p className="text-[10px] text-slate-500">Executive authorization required to clear {selectedReq.amount.toLocaleString()} BDT.</p>
                </div>
              </div>

              <div className="space-y-4">
                {/* Part B: the payee card again at the final confirm
                    step, so details are copyable at the exact moment
                    of settlement. */}
                <PaymentAccountCard
                  title="Clearance Target — Payment Account (Send money here)"
                  fields={payoutAccountFields(selectedReq)}
                />
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Gateway Transaction Hash ID (Required)</label>
                  <div className="relative">
                    <Terminal className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      value={transactionId}
                      onChange={(e) => setTransactionId(e.target.value)}
                      placeholder="e.g. TRX-992102831"
                      className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 pl-10 pr-4 text-xs font-mono text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/50"
                    />
                  </div>
                </div>

                {/* Optional Screenshot attachment upload */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Payment Receipt Screenshot (Optional)</label>
                  <div className="relative">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setSelectedFile(e.target.files[0])
                          setScreenshotAttached(true)
                        } else {
                          setSelectedFile(null)
                          setScreenshotAttached(false)
                        }
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <button
                      type="button"
                      className={`w-full py-3.5 border border-dashed rounded-xl flex items-center justify-center gap-2 text-xs font-semibold transition-all ${
                        selectedFile
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
                          : 'bg-slate-900/[0.04] border-slate-900/10 hover:border-[#1ca34c]/30 text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      <Camera className="w-4 h-4" />
                      <span className="truncate max-w-[200px]">
                        {selectedFile ? selectedFile.name : 'Click to attach receipt image'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleConfirmCompletion}
                    disabled={!transactionId || isUploading}
                    className="flex-1 bg-[#1ca34c] text-white font-semibold py-2.5 rounded-full text-xs uppercase cursor-pointer disabled:opacity-55 flex items-center justify-center gap-2"
                  >
                    {isUploading && <Compass className="w-4 h-4 animate-spin" />}
                    {isUploading ? 'Processing...' : 'Confirm Settlement'}
                  </button>
                  <button
                    onClick={() => { setShowConfirmModal(false); setTransactionId(''); setScreenshotAttached(false); setSelectedFile(null); }}
                    className="px-4 py-2.5 bg-white text-slate-500 rounded-xl text-xs font-semibold hover:text-slate-900"
                    disabled={isUploading}
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  )
}
