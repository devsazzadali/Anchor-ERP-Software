'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  PiggyBank, Upload, AlertTriangle, ChevronLeft,
  CheckCircle, FileText, Image as ImageIcon, X, Info, Calendar,
  Camera, ArrowRight, RefreshCw, Layers, Check, Coins
} from 'lucide-react'
import Link from 'next/link'
import { parseDailyBreakdown, cleanDepositNotes } from '@/lib/branch-deposit-utils'
import { allocateProportionally } from '@/lib/money'
import { uploadFile as uploadFileToStorage } from '@/lib/files-client'

const fmt = (n: any) => (Number(n || 0) < 0 ? '-' : '') + '৳' + Math.abs(Number(n || 0)).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

// Curated list of major Bangladeshi banks (Full official names)
const BD_BANKS = [
  'Islami Bank Bangladesh PLC',
  'BRAC Bank PLC',
  'Dutch-Bangla Bank PLC',
  'The City Bank PLC',
  'Eastern Bank PLC (EBL)',
  'United Commercial Bank PLC (UCB)',
  'Mutual Trust Bank PLC (MTB)',
  'Dhaka Bank PLC',
  'Prime Bank PLC',
  'Pubali Bank PLC',
  'Southeast Bank PLC',
  'Bank Asia PLC',
  'Mercantile Bank PLC',
  'The Premier Bank PLC',
  'Al-Arafah Islami Bank PLC',
  'Social Islami Bank PLC',
  'EXIM Bank PLC',
  'Jamuna Bank PLC',
  'NCC Bank PLC',
  'Trust Bank PLC',
  'Shahjalal Islami Bank PLC',
  'Midland Bank PLC',
  'Meghna Bank PLC',
  'NRB Bank PLC',
  'Standard Chartered Bangladesh',
  'Sonali Bank PLC',
  'Agrani Bank PLC',
  'Janata Bank PLC',
  'Rupali Bank PLC',
  'Bangladesh Krishi Bank',
  'Other / Custom Bank (অন্য ব্যাংক)',
]

function getDatesInRange(startStr: string, endStr: string): string[] {
  if (!startStr || !endStr) return [startStr || endStr || new Date().toISOString().split('T')[0]]
  // Normalize so minDate is always before or equal to maxDate
  const [minStr, maxStr] = startStr <= endStr ? [startStr, endStr] : [endStr, startStr]
  const dates: string[] = []
  // BUG-FIX: Parse as local calendar dates to prevent UTC midnight timezone shift
  const [my, mm, md] = minStr.split('-').map(Number)
  const [xy, xm, xd] = maxStr.split('-').map(Number)
  const cur = new Date(my, mm - 1, md)
  const last = new Date(xy, xm - 1, xd)
  // Safety guard: max 60 days
  let count = 0
  while (cur <= last && count < 60) {
    const yy = cur.getFullYear()
    const mo = String(cur.getMonth() + 1).padStart(2, '0')
    const dd = String(cur.getDate()).padStart(2, '0')
    dates.push(`${yy}-${mo}-${dd}`)
    cur.setDate(cur.getDate() + 1)
    count++
  }
  return dates
}

// Fast client-side image compression: reduces 10MB camera shots to ~250KB in 50ms
async function compressImageFile(file: File, maxWidth = 1600, maxHeight = 1600, quality = 0.82): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 250 * 1024) {
    return file
  }
  return new Promise((resolve) => {
    const img = new Image()
    const reader = new FileReader()
    reader.onload = (e) => {
      img.src = e.target?.result as string
    }
    img.onload = () => {
      try {
        let width = img.width
        let height = img.height
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width)
            width = maxWidth
          } else {
            width = Math.round((width * maxHeight) / height)
            height = maxHeight
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(file); return }
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          (blob) => {
            if (!blob) { resolve(file); return }
            const compressed = new File(
              [blob],
              file.name.replace(/\.[^.]+$/, '.jpg'),
              { type: 'image/jpeg', lastModified: Date.now() }
            )
            resolve(compressed)
          },
          'image/jpeg',
          quality
        )
      } catch {
        resolve(file)
      }
    }
    img.onerror = () => resolve(file)
    reader.readAsDataURL(file)
  })
}

export default function BankDepositPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <BankDepositContent />
    </Suspense>
  )
}

function BankDepositContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const paramDate = searchParams?.get('date') || null
  const paramResubmitId = searchParams?.get('resubmit_id') || null

  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isFetchingLedger, setIsFetchingLedger] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Step state: 1 = Details & Dates, 2 = Photo Prompt
  const [step, setStep] = useState<1 | 2>(1)

  // Date selection mode: 'single' | 'range'
  const [dateMode, setDateMode] = useState<'single' | 'range'>('range')

  const [form, setForm] = useState({
    deposit_date:        paramDate || new Date().toISOString().split('T')[0],
    sales_from_date:     paramDate || new Date().toISOString().split('T')[0],
    sales_to_date:       paramDate || new Date().toISOString().split('T')[0],
    amount:              '',
    bank_account_name:   'Anchor Fashion Main Account — BRAC Bank PLC',
    bank_account_number: '',
    deposit_slip_number: '',
    bank_transaction_id: '',
    deposited_by_name:   '',
    notes:               '',
  })

  const [selectedBank, setSelectedBank] = useState<string>('BRAC Bank PLC')
  const [dailyAmounts, setDailyAmounts] = useState<Record<string, number>>({})
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([])
  const [existingDepositForDate, setExistingDepositForDate] = useState<any>(null)
  const [rejectedDepositForDate, setRejectedDepositForDate] = useState<any>(null)
  const [slipFile, setSlipFile] = useState<File | null>(null)
  const [slipPreview, setSlipPreview] = useState<string | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [isCompressing, setIsCompressing] = useState(false)
  const initialFetchDone = React.useRef(false)

  // Check if a bank deposit already exists for the selected deposit_date (1 deposit per date rule, excluding rejected)
  const checkExistingDepositForDate = useCallback(async (dateStr: string) => {
    if (!dateStr) return
    try {
      const res = await fetch(`/api/branch-accounts/deposits?date=${dateStr}`)
      const json = await res.json()
      if (res.ok && Array.isArray(json.deposits)) {
        const active = json.deposits.find((d: any) => d.status !== 'rejected')
        const rejected = json.deposits.find((d: any) => d.status === 'rejected')
        setExistingDepositForDate(active || null)
        setRejectedDepositForDate(rejected || null)

        // If this date has a rejected deposit and form is empty or matching resubmit_id, pre-fill
        if (rejected && (!form.amount || paramResubmitId === rejected.id)) {
          const prevBreakdown = parseDailyBreakdown(rejected)
          if (prevBreakdown) {
            setDailyAmounts(prev => ({ ...prev, ...prevBreakdown }))
          }
          setForm(f => ({
            ...f,
            amount: f.amount || String(rejected.amount || ''),
            bank_account_name: rejected.bank_account_name || f.bank_account_name,
            bank_account_number: rejected.bank_account_number || f.bank_account_number,
            deposit_slip_number: rejected.deposit_slip_number || f.deposit_slip_number,
            bank_transaction_id: rejected.bank_transaction_id || f.bank_transaction_id,
            sales_from_date: rejected.sales_from_date || f.sales_from_date,
            sales_to_date: rejected.sales_to_date || f.sales_to_date,
            notes: cleanDepositNotes(rejected.notes) || f.notes,
          }))
          if (rejected.sales_from_date && rejected.sales_to_date && rejected.sales_from_date !== rejected.sales_to_date) {
            setDateMode('range')
          }
        }
      } else {
        setExistingDepositForDate(null)
        setRejectedDepositForDate(null)
      }
    } catch {
      setExistingDepositForDate(null)
      setRejectedDepositForDate(null)
    }
  }, [form.amount, paramResubmitId])

  // Fetch sales for selected date range (normalized min/max)
  const fetchSalesForRange = useCallback(async (fromDate: string, toDate: string) => {
    if (!fromDate || !toDate) return
    const [minDate, maxDate] = fromDate <= toDate ? [fromDate, toDate] : [toDate, fromDate]
    setIsFetchingLedger(true)
    try {
      const res = await fetch(`/api/branch-accounts/cash-ledger?from=${minDate}&to=${maxDate}`)
      const json = await res.json()
      if (res.ok && json.ledger) {
        setLedgerEntries(json.ledger)
      } else {
        setLedgerEntries([])
      }
    } catch {
      setLedgerEntries([])
    } finally {
      setIsFetchingLedger(false)
    }
  }, [])

  // Unified, high-speed parallel initialization
  const init = useCallback(async () => {
    setIsLoading(true)
    try {
      const meRes = await fetch('/api/auth/me')
      if (!meRes.ok) { router.replace('/'); return }
      const me = await meRes.json()
      if (!me?.user) { router.replace('/'); return }

      const initialDate = paramDate || new Date().toISOString().split('T')[0]

      const [depositRes, ledgerRes] = await Promise.all([
        fetch(`/api/branch-accounts/deposits?date=${initialDate}`).then(r => r.json()).catch(() => null),
        fetch(`/api/branch-accounts/cash-ledger?from=${initialDate}&to=${initialDate}`).then(r => r.json()).catch(() => null),
      ])

      const prof = me.profile
      const isManager = prof?.is_branch_manager === true || (prof as any)?.profile_type === 'branch_manager'
      const isAdmin = !!me.is_admin

      if (!isManager && !isAdmin) {
        router.replace('/dashboard/branch-accounts')
        return
      }

      if (prof?.full_name) {
        setForm(f => ({ ...f, deposited_by_name: f.deposited_by_name || prof.full_name }))
      }

      if (depositRes?.deposits && Array.isArray(depositRes.deposits)) {
        const active = depositRes.deposits.find((d: any) => d.status !== 'rejected')
        const rejected = depositRes.deposits.find((d: any) => d.status === 'rejected')
        setExistingDepositForDate(active || null)
        setRejectedDepositForDate(rejected || null)

        if (rejected) {
          const prevBreakdown = parseDailyBreakdown(rejected)
          if (prevBreakdown) {
            setDailyAmounts(prev => ({ ...prev, ...prevBreakdown }))
          }
          setForm(f => ({
            ...f,
            deposit_date: initialDate,
            sales_from_date: rejected.sales_from_date || initialDate,
            sales_to_date: rejected.sales_to_date || initialDate,
            amount: String(rejected.amount || ''),
            bank_account_name: rejected.bank_account_name || f.bank_account_name,
            bank_account_number: rejected.bank_account_number || f.bank_account_number,
            deposit_slip_number: rejected.deposit_slip_number || f.deposit_slip_number,
            bank_transaction_id: rejected.bank_transaction_id || f.bank_transaction_id,
            notes: cleanDepositNotes(rejected.notes) || f.notes,
          }))
          if (rejected.sales_from_date && rejected.sales_to_date && rejected.sales_from_date !== rejected.sales_to_date) {
            setDateMode('range')
          }
        }
      }

      if (ledgerRes?.ledger && Array.isArray(ledgerRes.ledger)) {
        setLedgerEntries(ledgerRes.ledger)
      }
    } catch (e: any) {
      console.error('Initialization error:', e)
    } finally {
      setIsLoading(false)
      initialFetchDone.current = true
    }
  }, [router, paramDate])

  useEffect(() => { init() }, [init])

  // Only re-fetch if deposit_date changes AFTER initial mount
  useEffect(() => {
    if (initialFetchDone.current && form.deposit_date) {
      checkExistingDepositForDate(form.deposit_date)
    }
  }, [form.deposit_date, checkExistingDepositForDate])

  // Only re-fetch if sales date range changes AFTER initial mount
  useEffect(() => {
    if (initialFetchDone.current && form.sales_from_date && form.sales_to_date) {
      fetchSalesForRange(form.sales_from_date, form.sales_to_date)
    }
  }, [form.sales_from_date, form.sales_to_date, fetchSalesForRange])

  // Compute normalized dates array
  const currentDates = useMemo(() => {
    if (!form.sales_from_date || !form.sales_to_date) return []
    const [minDate, maxDate] = form.sales_from_date <= form.sales_to_date
      ? [form.sales_from_date, form.sales_to_date]
      : [form.sales_to_date, form.sales_from_date]
    return getDatesInRange(minDate, maxDate)
  }, [form.sales_from_date, form.sales_to_date])

  // Auto-populate daily amounts whenever ledgerEntries or dates change
  useEffect(() => {
    setDailyAmounts(prev => {
      const next: Record<string, number> = {}
      currentDates.forEach(d => {
        const entry = ledgerEntries.find(l => l.ledger_date === d)
        // If date has not been manually edited yet:
        if (prev[d] === undefined || prev[d] === 0) {
          let autoCash = 0
          if (entry) {
            // B57: for a CLOSED day the physical count is the truth —
            // depositable cash is what the count added ABOVE the
            // opening float, never the whole counted amount (the old
            // fallback returned the full actual_cash including the
            // float whenever the recorded-sales path produced 0, and
            // ignored the count entirely when sales were recorded).
            if (entry.is_closed && entry.actual_cash !== null && entry.actual_cash !== undefined) {
              autoCash = Math.max(0, Number(entry.actual_cash) - Number(entry.opening_cash || 0))
            } else {
              const grossCash = Number(entry.cash_sales || 0) + Number(entry.other_cash_in || 0)
              const deductions = Number(entry.cash_expenses || 0) + Number(entry.bank_deposits_out || 0)
              const netAvailable = Math.max(0, grossCash - deductions)

              if (grossCash > 0) {
                autoCash = netAvailable
              } else if (Number(entry.expected_closing_cash || 0) > 0) {
                autoCash = Math.max(0, Number(entry.expected_closing_cash) - Number(entry.opening_cash || 0))
              }
            }
          }
          next[d] = autoCash
        } else {
          next[d] = prev[d]
        }
      })
      return next
    })
  }, [ledgerEntries, currentDates])

  // Total calculated cash sales across selected days
  const totalCalculatedSales = useMemo(() => {
    return currentDates.reduce((sum, d) => sum + (dailyAmounts[d] || 0), 0)
  }, [currentDates, dailyAmounts])

  // Khuchra = total sales - deposit amount (remaining change kept in drawer)
  const khuchraAmount = useMemo(() => {
    const depositVal = Number(form.amount || 0)
    if (totalCalculatedSales <= 0 || depositVal <= 0) return 0
    return Math.max(0, totalCalculatedSales - depositVal)
  }, [totalCalculatedSales, form.amount])

  // Quick-rounding helpers for deposit amount
  const handleRoundDeposit = (target: 'full' | 500 | 1000 | 5000) => {
    if (target === 'full') {
      setForm(f => ({ ...f, amount: String(totalCalculatedSales) }))
    } else {
      const rounded = Math.floor(totalCalculatedSales / target) * target
      if (rounded > 0) setForm(f => ({ ...f, amount: String(rounded) }))
    }
  }

  // Auto-suggest amount when calculated total changes
  useEffect(() => {
    if (totalCalculatedSales > 0) {
      setForm(f => ({ ...f, amount: String(totalCalculatedSales) }))
    }
  }, [totalCalculatedSales])

  const handleDayAmountChange = (dateStr: string, rawVal: string) => {
    const num = rawVal === '' ? 0 : Number(rawVal)
    setDailyAmounts(prev => {
      const next = { ...prev, [dateStr]: num }
      const newTotal = currentDates.reduce((sum, dt) => sum + (dt === dateStr ? num : (next[dt] || 0)), 0)
      setForm(f => ({ ...f, amount: String(newTotal) }))
      return next
    })
  }

  const handleBankSelect = (bankName: string) => {
    setSelectedBank(bankName)
    if (bankName && bankName !== 'Other / Custom Bank (অন্য ব্যাংক)') {
      setForm(f => ({ ...f, bank_account_name: `Anchor Fashion Main Account — ${bankName}` }))
    }
  }

  const handleDateModeChange = (mode: 'single' | 'range') => {
    setDateMode(mode)
    if (mode === 'single') {
      const singleDate = form.sales_from_date || new Date().toISOString().split('T')[0]
      setForm(f => ({ ...f, sales_from_date: singleDate, sales_to_date: singleDate }))
    }
  }

  const handleFileSelect = async (file: File | null) => {
    if (!file) {
      setSlipFile(null)
      setSlipPreview(null)
      return
    }

    // Instant local preview
    const reader = new FileReader()
    reader.onload = e => setSlipPreview(e.target?.result as string)
    reader.readAsDataURL(file)

    // Fast background compression
    if (file.type.startsWith('image/')) {
      setIsCompressing(true)
      try {
        const compressed = await compressImageFile(file)
        setSlipFile(compressed)
      } catch {
        setSlipFile(file)
      } finally {
        setIsCompressing(false)
      }
    } else {
      setSlipFile(file)
    }
  }

  const uploadFile = async (file: File, path: string) => {
    try {
      const uploaded = await uploadFileToStorage('branch-deposits', file, path)
      return uploaded.url
    } catch (err: any) {
      throw new Error(`Upload failed: ${err?.message || 'unknown error'}`)
    }
  }

  // Handle clicking "Deposit" on Step 1
  const handleProceedToPhoto = () => {
    if (existingDepositForDate && !paramResubmitId) {
      setError(`A bank deposit for this date (${form.deposit_date}) has already been recorded (৳${Number(existingDepositForDate.amount).toLocaleString()}). Only one deposit is permitted per date.`)
      return
    }
    if (!form.deposit_date || !form.amount || Number(form.amount) <= 0 || !form.bank_account_name) {
      setError('Please fill in Deposit Date, Amount (> 0), and Bank Account Name')
      return
    }
    if (!form.sales_from_date || !form.sales_to_date) {
      setError('Sales date range is required')
      return
    }

    // Always normalize from/to dates
    const [normFrom, normTo] = form.sales_from_date <= form.sales_to_date
      ? [form.sales_from_date, form.sales_to_date]
      : [form.sales_to_date, form.sales_from_date]

    setForm(f => ({ ...f, sales_from_date: normFrom, sales_to_date: normTo }))
    setError(null)

    // If slip file is already selected, submit directly; otherwise advance to photo prompt step
    if (slipFile) {
      handleSubmitDeposit()
    } else {
      setStep(2)
    }
  }

  // Handle final submission (with fast photo upload)
  const handleSubmitDeposit = async () => {
    if (!slipFile) {
      setError('Please take or upload a photo of the Bank Deposit Slip / Deposit Book')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setUploadStatus('Preparing slip document...')

    try {
      let fileToUpload = slipFile
      if (slipFile.type.startsWith('image/') && slipFile.size > 500 * 1024) {
        setUploadStatus('Optimizing image size for fast upload...')
        fileToUpload = await compressImageFile(slipFile)
      }

      setUploadStatus('Uploading slip photo...')
      const timestamp = Date.now()
      const sanitizedName = fileToUpload.name.replace(/[^a-zA-Z0-9.-]/g, '_')
      const slipUrl = await uploadFile(fileToUpload, `deposits/${timestamp}_slip_${sanitizedName}`)

      setUploadStatus('Submitting deposit & notifying admin...')
      const [normFrom, normTo] = form.sales_from_date <= form.sales_to_date
        ? [form.sales_from_date, form.sales_to_date]
        : [form.sales_to_date, form.sales_from_date]

      const depositAmount = Number(form.amount)
      // B58: largest-remainder allocation in integer poisha — every
      // slice >= 0 and the slices sum EXACTLY to the deposit amount.
      // The old per-day Math.round + last-day-remainder could make
      // the last day NEGATIVE, which the server (correctly) rejects
      // and the old trigger silently skipped.
      const dates = currentDates
      const shares = allocateProportionally(depositAmount, dates.map(d => dailyAmounts[d] || 0))
      const proratedBreakdown: Record<string, number> = {}
      dates.forEach((d, i) => { proratedBreakdown[d] = shares[i] })

      const isResubmit = !!paramResubmitId
      const res = isResubmit
        ? await fetch('/api/branch-accounts/deposits', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: paramResubmitId,
              action: 'resubmit',
              ...form,
              sales_from_date: normFrom,
              sales_to_date: normTo,
              amount: depositAmount,
              khuchra_amount: Math.max(0, totalCalculatedSales - depositAmount),
              daily_breakdown: proratedBreakdown,
              slip_attachment_url: slipUrl,
            }),
          })
        : await fetch('/api/branch-accounts/deposits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...form,
              sales_from_date: normFrom,
              sales_to_date: normTo,
              amount: depositAmount,
              khuchra_amount: Math.max(0, totalCalculatedSales - depositAmount),
              daily_breakdown: proratedBreakdown,
              slip_attachment_url: slipUrl,
              status: 'submitted',
            }),
          })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error)

      setSuccess(isResubmit ? 'Deposit resubmitted successfully for review!' : 'Deposit submitted successfully with slip photo! Admin has been notified.')
      setTimeout(() => router.push('/dashboard/branch-accounts/deposit-history'), 1500)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsSubmitting(false)
      setUploadStatus(null)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Background ambience */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 right-0 w-[500px] h-[500px] bg-[#1ca34c]/3 rounded-full filter blur-[150px]" />
      </div>

      <div className="relative z-10 p-4 md:p-6 lg:p-8 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/dashboard/branch-accounts"
            className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold font-serif flex items-center gap-2">
              <PiggyBank className="w-5 h-5 text-[#15803d]" /> Create Bank Deposit
            </h1>
            <p className="text-[11px] text-slate-500">
              {step === 1 ? 'Select sales period, review daily cash sales, and enter deposit amount' : 'Upload photo of deposit slip/book to complete submission'}
            </p>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-between mb-6 p-1 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
          <div className={`flex-1 py-2 text-center text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
            step === 1 ? 'bg-[#1ca34c]/20 text-[#15803d] border border-[#1ca34c]/30' : 'text-slate-500'
          }`}>
            1. Period & Amount
          </div>
          <div className="px-2 text-slate-600">→</div>
          <div className={`flex-1 py-2 text-center text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
            step === 2 ? 'bg-[#1ca34c]/20 text-[#15803d] border border-[#1ca34c]/30' : 'text-slate-500'
          }`}>
            2. Slip Photo & Confirm
          </div>
        </div>

        {/* Feedback alerts */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
        {/* Rejected Deposit Re-application Banner */}
        {rejectedDepositForDate && !existingDepositForDate && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-700 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 shrink-0 mt-0.5">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h4 className="font-bold text-sm text-amber-700">
                    পূর্ববর্তী ডিপোজিট প্রত্যাখ্যাত (Previous Deposit Rejected)
                  </h4>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300">
                    ✓ Re-application Allowed
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-1">
                  তারিখ: <span className="text-slate-900 font-medium">{form.deposit_date}</span> · এডমিনের কারণ:{' '}
                  <span className="text-rose-300 font-semibold italic">"{rejectedDepositForDate.rejection_reason || 'তথ্য বা স্লিপের ত্রুটি'}"</span>
                </p>
                <p className="text-[11px] text-amber-600/90 mt-1.5 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  আপনি নিচের ফর্মের তথ্য সংশোধন করে ও সঠিক স্লিপের ছবি সংযুক্ত করে এই তারিখের জন্য পুনরায় আবেদন জমা দিতে পারবেন।
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Existing Active Deposit Block Warning */}
        {existingDepositForDate && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-rose-500/20 text-rose-600 shrink-0 mt-0.5">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-sm text-rose-300">
                  এই তারিখে ইতোমধ্যে একটি ডিপোজিট সক্রিয় রয়েছে
                </h4>
                <p className="text-xs text-slate-600 mt-1">
                  তারিখ: <span className="text-slate-900 font-medium">{form.deposit_date}</span> · পরিমাণ:{' '}
                  <span className="text-[#15803d] font-semibold">৳{Number(existingDepositForDate.amount || 0).toLocaleString()}</span> · স্ট্যাটাস:{' '}
                  <span className="uppercase font-bold text-amber-600">{existingDepositForDate.status}</span>
                </p>
                <p className="text-[11px] text-rose-600/80 mt-1">
                  নিয়মানুযায়ী প্রতি ব্রাঞ্চে প্রতিদিন সর্বোচ্চ ১টি সক্রিয় ব্যাংক ডিপোজিট অনুমোদিত। পূর্ববর্তী ডিপোজিটটি রিজেক্ট হলে তবেই নতুন আবেদন করা যাবে।
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* STEP 1: DATES, DAILY BREAKDOWN & AMOUNT                     */}
        {/* ═══════════════════════════════════════════════════════════ */}
        {step === 1 && (
          <div className="space-y-5">
            {/* Mode Switcher: Single Day vs Date Range */}
            <div className="p-1 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 flex gap-1">
              <button
                type="button"
                onClick={() => handleDateModeChange('single')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  dateMode === 'single'
                    ? 'bg-[#1ca34c] text-white shadow-lg shadow-[#1ca34c]/20'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Single Day
              </button>
              <button
                type="button"
                onClick={() => handleDateModeChange('range')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  dateMode === 'range'
                    ? 'bg-[#1ca34c] text-white shadow-lg shadow-[#1ca34c]/20'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Date Range (Multiple Days)
              </button>
            </div>

            {/* Date Pickers Card */}
            <div className="p-5 rounded-3xl bg-slate-900/[0.04] border border-slate-900/5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#15803d] flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  {dateMode === 'single' ? 'Select Sales Date' : 'Select Sales Date Range'}
                </span>
                {isFetchingLedger && (
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin text-[#15803d]" /> Fetching sales...
                  </span>
                )}
              </div>

              {dateMode === 'single' ? (
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Sales Date *</label>
                  <input
                    type="date"
                    value={form.sales_from_date}
                    onChange={e => {
                      const d = e.target.value
                      setForm(f => ({ ...f, sales_from_date: d, sales_to_date: d }))
                    }}
                    className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-[#1ca34c]/40 transition-colors cursor-pointer [color-scheme:light]"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">From Date *</label>
                    <input
                      type="date"
                      value={form.sales_from_date}
                      onChange={e => setForm(f => ({ ...f, sales_from_date: e.target.value }))}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-[#1ca34c]/40 transition-colors cursor-pointer [color-scheme:light]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">To Date *</label>
                    <input
                      type="date"
                      value={form.sales_to_date}
                      onChange={e => setForm(f => ({ ...f, sales_to_date: e.target.value }))}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-[#1ca34c]/40 transition-colors cursor-pointer [color-scheme:light]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* DAY-BY-DAY SALES BREAKDOWN CARD (Audio Requirement) */}
            <div className="p-5 rounded-3xl bg-gradient-to-br from-[#1ca34c]/10 to-transparent border border-[#1ca34c]/20 space-y-3">
              <div className="flex items-center justify-between border-b border-[#1ca34c]/20 pb-2">
                <span className="text-[10px] uppercase tracking-widest text-[#15803d] font-bold flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  {dateMode === 'single' ? 'Single Day Sales' : `Daily Sales Breakdown (${currentDates.length} Days)`}
                </span>
                <span className="text-[10px] text-slate-500">Cash Amount (Editable)</span>
              </div>

              {/* List of individual days with editable inputs */}
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {currentDates.map(d => {
                  const entry = ledgerEntries.find(l => l.ledger_date === d)
                  const isClosed = !!entry?.is_closed
                  const val = dailyAmounts[d] !== undefined ? dailyAmounts[d] : ''
                  return (
                    <div key={d} className="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-xs gap-3">
                      <div className="flex flex-col">
                        <span className="text-slate-900 font-mono font-medium flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${isClosed ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                          {d}
                        </span>
                        <span className="text-[10px] text-slate-500 ml-4">
                          {isClosed ? (
                            <span className="text-emerald-600 font-medium">
                              Closed (Counted: {fmt(entry.actual_cash || 0)}{Number(entry.opening_cash || 0) > 0 ? ` | Op: ${fmt(entry.opening_cash)}` : ''})
                            </span>
                          ) : Number(entry?.cash_sales || 0) > 0 ? (
                            <span className="text-slate-600 font-medium">
                              Cash Sales: {fmt(entry?.cash_sales || 0)}{Number(entry?.cash_expenses || 0) > 0 ? ` · Exp: -${fmt(entry.cash_expenses)}` : ''}
                            </span>
                          ) : (
                            <span className="text-amber-600 font-medium">Pending Closing</span>
                          )}
                        </span>
                      </div>
                      <div className="relative w-36 shrink-0">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-serif">৳</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={val}
                          placeholder="0.00"
                          onChange={e => handleDayAmountChange(d, e.target.value)}
                          className="w-full pl-6 pr-2.5 py-1.5 rounded-lg bg-white border border-slate-900/20 text-slate-900 font-serif font-bold text-xs focus:outline-none focus:border-[#1ca34c] text-right transition-colors"
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Total Accumulated Sum (Auto-calculated) */}
              <div className="pt-3 border-t border-[#1ca34c]/20 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#15803d] font-bold">Total Accumulated Cash</p>
                  <p className="text-[9px] text-slate-500">Sum of daily cash sales (auto-fills Deposit Amount)</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold font-serif text-[#15803d]">{fmt(totalCalculatedSales)}</p>
                  {form.amount !== String(totalCalculatedSales) && totalCalculatedSales > 0 && (
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, amount: String(totalCalculatedSales) }))}
                      className="text-[10px] text-[#15803d] underline hover:text-[#15803d]/80 cursor-pointer"
                    >
                      Use calculated total
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Deposit Details Form */}
            <div className="space-y-4 p-5 rounded-3xl bg-slate-900/[0.04] border border-slate-900/5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Deposit Date *</label>
                  <input
                    type="date"
                    value={form.deposit_date}
                    onChange={e => setForm(f => ({ ...f, deposit_date: e.target.value }))}
                    className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-[#1ca34c]/40 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-[#15803d] font-semibold mb-1.5">
                    Deposit Amount (৳) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={form.amount}
                    placeholder="0.00"
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full bg-slate-900/[0.04] border border-[#1ca34c]/40 rounded-xl px-3 py-2.5 text-slate-900 font-serif font-bold text-base focus:outline-none focus:border-[#1ca34c] transition-colors"
                  />
                  {/* Quick-rounding buttons */}
                  {totalCalculatedSales > 0 && (
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      <button type="button" onClick={() => handleRoundDeposit('full')}
                        className="text-[9px] px-2 py-1 rounded-lg bg-[#1ca34c]/10 border border-[#1ca34c]/20 text-[#15803d] hover:bg-[#1ca34c]/20 transition-colors font-bold cursor-pointer">
                        Full Amount
                      </button>
                      {[5000, 1000, 500].map(v => {
                        const rounded = Math.floor(totalCalculatedSales / v) * v
                        if (rounded <= 0 || rounded === totalCalculatedSales) return null
                        return (
                          <button key={v} type="button" onClick={() => handleRoundDeposit(v as any)}
                            className="text-[9px] px-2 py-1 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:border-[#1ca34c]/30 hover:text-[#15803d] transition-colors cursor-pointer">
                            Round ৳{v.toLocaleString()}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {existingDepositForDate && (
                  <div className="col-span-2 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                    <span>
                      A bank deposit of <strong>{fmt(existingDepositForDate.amount)}</strong> has already been submitted for {form.deposit_date} ({existingDepositForDate.status}). Only 1 deposit per branch is permitted per day.
                    </span>
                  </div>
                )}
              </div>

              {/* ── Khuchra (Change) Indicator Card ───────────────────────── */}
              {totalCalculatedSales > 0 && Number(form.amount) > 0 && (
                <div className={`p-4 rounded-2xl border flex items-center gap-4 ${
                  khuchraAmount > 0
                    ? 'bg-amber-500/10 border-amber-500/30'
                    : 'bg-emerald-500/10 border-emerald-500/30'
                }`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    khuchraAmount > 0 ? 'bg-amber-500/20' : 'bg-emerald-500/20'
                  }`}>
                    <Coins className={`w-5 h-5 ${
                      khuchraAmount > 0 ? 'text-amber-600' : 'text-emerald-600'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Total Cash Sales</p>
                        <p className="text-base font-bold font-serif text-slate-900">{fmt(totalCalculatedSales)}</p>
                      </div>
                      <div className="text-slate-500 text-lg font-light">−</div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Bank Deposit</p>
                        <p className="text-base font-bold font-serif text-[#15803d]">{fmt(Number(form.amount || 0))}</p>
                      </div>
                      <div className="text-slate-500 text-lg font-light">=</div>
                      <div className="text-right">
                        <p className={`text-[10px] uppercase tracking-wider font-bold ${
                          khuchraAmount > 0 ? 'text-amber-600' : 'text-emerald-600'
                        }`}>
                          {khuchraAmount > 0 ? '🪙 Khuchra (Drawer)' : '✓ Full Deposit'}
                        </p>
                        <p className={`text-xl font-bold font-serif ${
                          khuchraAmount > 0 ? 'text-amber-700' : 'text-emerald-600'
                        }`}>
                          {khuchraAmount > 0 ? fmt(khuchraAmount) : '৳0'}
                        </p>
                      </div>
                    </div>
                    {khuchraAmount > 0 && (
                      <p className="text-[10px] text-amber-600/70 mt-2 flex items-center gap-1">
                        <Info className="w-3 h-3 shrink-0" />
                        {fmt(khuchraAmount)} in small notes will remain in the branch drawer as change (খুচরা).
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Bangladeshi Banks Selector & Account Title */}
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#15803d] font-semibold mb-1.5">
                  Select Bank (বাংলাদেশের ব্যাংক নির্বাচন করুন) *
                </label>
                <select
                  value={selectedBank}
                  onChange={e => handleBankSelect(e.target.value)}
                  className="w-full bg-white border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-[#1ca34c]/40 transition-colors mb-2.5 cursor-pointer"
                >
                  <option value="">-- Select Bank (ব্যাংক নির্বাচন করুন) --</option>
                  {BD_BANKS.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>

                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">
                  Bank Account Name / Branch Title *
                </label>
                <input
                  type="text"
                  value={form.bank_account_name}
                  placeholder="e.g. Anchor Fashion Main Account — BRAC Bank PLC"
                  onChange={e => setForm(f => ({ ...f, bank_account_name: e.target.value }))}
                  className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:border-[#1ca34c]/40 transition-colors"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Slip / Ref Number</label>
                  <input
                    type="text"
                    value={form.deposit_slip_number}
                    placeholder="e.g. DEP-2026-001"
                    onChange={e => setForm(f => ({ ...f, deposit_slip_number: e.target.value }))}
                    className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Bank TXN ID</label>
                  <input
                    type="text"
                    value={form.bank_transaction_id}
                    placeholder="e.g. TXN98765432"
                    onChange={e => setForm(f => ({ ...f, bank_transaction_id: e.target.value }))}
                    className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-xl px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* DEPOSIT BUTTON (Advances to Step 2 photo prompt) */}
            <button
              type="button"
              onClick={handleProceedToPhoto}
              disabled={Boolean(existingDepositForDate)}
              className="w-full py-4 rounded-full bg-[#1ca34c] hover:bg-[#15803d] text-white font-bold text-sm uppercase tracking-widest hover:opacity-95 transition-all shadow-lg shadow-[#1ca34c]/15 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {existingDepositForDate ? 'Deposit Already Recorded for this Date' : `Deposit ${form.amount ? `(${fmt(Number(form.amount))})` : ''} →`}
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* STEP 2: PHOTO PROMPT (Deposit Slip / Book Photo)            */}
        {/* ═══════════════════════════════════════════════════════════ */}
        {step === 2 && (
          <div className="space-y-6">
            {/* Deposit Summary Box */}
            <div className="p-4 rounded-2xl bg-slate-900/[0.04] border border-slate-900/5 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Deposit Amount:</span>
                <span className="font-bold text-slate-900 font-serif text-base">{fmt(Number(form.amount))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Sales Period:</span>
                <span className="text-[#15803d] font-semibold">{form.sales_from_date} → {form.sales_to_date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Bank Account:</span>
                <span className="text-slate-700">{form.bank_account_name}</span>
              </div>
            </div>

            {/* Big Photo Uploader Card */}
            <div className="p-6 rounded-3xl border-2 border-dashed border-[#1ca34c]/40 bg-[#1ca34c]/5 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#1ca34c]/15 border border-[#1ca34c]/30 flex items-center justify-center text-[#15803d]">
                <Camera className="w-7 h-7" />
              </div>

              <div>
                <h3 className="text-base font-bold font-serif text-slate-900">Deposit Slip / Book Photo</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Please take a photo or upload a picture of the deposit slip or bank book
                </p>
              </div>

              {/* Image Preview if selected */}
              {slipPreview ? (
                <div className="relative inline-block max-w-sm rounded-xl overflow-hidden border border-[#1ca34c]/40 shadow-xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={slipPreview} alt="Deposit Slip Preview" className="max-h-56 object-contain mx-auto" />
                  <button
                    type="button"
                    onClick={() => handleFileSelect(null)}
                    className="absolute top-2 right-2 p-3 rounded-full bg-white hover:bg-white text-slate-900 shadow-lg transition-all cursor-pointer"
                    title="Remove selected photo"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="p-2 bg-white text-[10px] text-emerald-600 flex items-center justify-center gap-1">
                    <Check className="w-3 h-3" /> Photo attached: {slipFile?.name} {slipFile && `(${(slipFile.size / 1024).toFixed(0)} KB)`}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                    <label className="w-full sm:w-auto px-5 py-3 rounded-full bg-[#1ca34c] hover:bg-[#15803d] text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 shadow-md">
                      <Camera className="w-4 h-4" /> Take Photo (Camera)
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={e => handleFileSelect(e.target.files?.[0] || null)}
                      />
                    </label>
                    <label className="w-full sm:w-auto px-5 py-3 rounded-xl bg-slate-900/[0.07] hover:bg-slate-900/[0.08] text-slate-900 font-bold text-xs uppercase tracking-wider border border-slate-900/10 transition-all cursor-pointer flex items-center justify-center gap-2">
                      <Upload className="w-4 h-4" /> Choose from Gallery
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={e => handleFileSelect(e.target.files?.[0] || null)}
                      />
                    </label>
                  </div>
                  {isCompressing && (
                    <p className="text-[11px] text-[#15803d] animate-pulse">⚡ Optimizing photo for ultra-fast upload...</p>
                  )}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={isSubmitting}
                className="py-3.5 px-5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-slate-900/20 text-slate-500 hover:text-slate-900 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
              >
                ← Back
              </button>

              <button
                type="button"
                onClick={handleSubmitDeposit}
                disabled={isSubmitting || !slipFile}
                className="flex-1 py-3.5 rounded-full bg-[#1ca34c] hover:bg-[#15803d] text-white font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-[#1ca34c]/15 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    {uploadStatus || 'Uploading & Submitting...'}
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload & Submit Deposit
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
