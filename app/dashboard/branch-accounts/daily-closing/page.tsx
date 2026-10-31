'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle, AlertTriangle, ChevronLeft, Wallet,
  Calculator, TrendingDown, TrendingUp, Sun, Moon,
  Calendar, RefreshCw, ArrowRight, Download, Edit3,
  CreditCard, Smartphone, Banknote, History, Eye
} from 'lucide-react'
import Link from 'next/link'
import { generatePdf } from '@/lib/pdf-generator'

import { useBranchAuth } from '@/lib/hooks/use-branch-auth'
import { dhakaToday } from '@/lib/dhaka-time'
import { fetchWithCache, invalidateBranchCache, getCachedData } from '@/lib/branch-cache'

const fmt = (n: any) => (Number(n || 0) < 0 ? '-' : '') + '৳' + Math.abs(Number(n || 0)).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const getDayName = (dateStr: string) => {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-BD', { weekday: 'long' })
}

const formatDatePretty = (dateStr: string) => {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function DailyClosingPage() {
  const router = useRouter()
  const { user, isAdmin, branchName: authBranchName, isAuthorized, isLoading: isAuthLoading } = useBranchAuth()
  // B56: "today" is the Asia/Dhaka date — the old UTC date made the
  // page open on yesterday's ledger from 00:00–05:59 Dhaka.
  const [selectedDate, setSelectedDate] = useState(dhakaToday())

  const [ledger, setLedger] = useState<any>(() => {
    const todayStr = dhakaToday()
    const cached = getCachedData(`branch_ledger_${todayStr}`)
    return cached?.ledger?.[0] || (cached && !cached.ledger ? cached : null)
  })
  const [historyList, setHistoryList] = useState<any[]>(() => {
    const cached = getCachedData('branch_history_60')
    return Array.isArray(cached?.ledger) ? cached.ledger : (Array.isArray(cached) ? cached : [])
  })
  
  // Drawer cash states
  const [khuchraAmount, setKhuchraAmount] = useState('')
  const [closingCash, setClosingCash] = useState('')
  const [differenceNotes, setDifferenceNotes] = useState('')

  // Digital collections states
  const [bkashSales, setBkashSales] = useState('')
  const [nagadSales, setNagadSales] = useState('')
  const [rocketSales, setRocketSales] = useState('')
  const [cardSales, setCardSales] = useState('')
  const [bankTransferSales, setBankTransferSales] = useState('')
  const [cashSales, setCashSales] = useState('')

  const [isLoading, setIsLoading] = useState(() => {
    const todayStr = new Date().toISOString().split('T')[0]
    return !getCachedData(`branch_ledger_${todayStr}`)
  })
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [isSubmittingClosing, setIsSubmittingClosing] = useState(false)
  const [isEditingClosed, setIsEditingClosed] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  
  const [error, setError] = useState<string | null>(null)
  const [closingSuccess, setClosingSuccess] = useState<string | null>(null)
  const [branchName, setBranchName] = useState(authBranchName || 'My Branch')

  useEffect(() => {
    if (authBranchName) setBranchName(authBranchName)
  }, [authBranchName])

  // Reset editing mode whenever date changes
  useEffect(() => {
    setIsEditingClosed(false)
  }, [selectedDate])

  // Access check redirect
  useEffect(() => {
    if (!isAuthLoading && !isAuthorized) {
      router.replace('/dashboard')
    }
  }, [isAuthLoading, isAuthorized, router])

  const applyLedgerData = useCallback((led: any) => {
    setLedger(led)
    if (led) {
      const floatVal = (led.khuchra_amount !== undefined && led.khuchra_amount !== null) ? led.khuchra_amount : (led.opening_cash ?? '')
      setKhuchraAmount(floatVal !== undefined && floatVal !== null ? String(floatVal) : '')
      setClosingCash(led.actual_cash !== undefined && led.actual_cash !== null ? String(led.actual_cash) : '')
      setDifferenceNotes(led.difference_notes || '')
      setBkashSales(led.bkash_sales !== undefined && led.bkash_sales !== null ? String(led.bkash_sales) : '')
      setNagadSales(led.nagad_sales !== undefined && led.nagad_sales !== null ? String(led.nagad_sales) : '')
      setRocketSales(led.rocket_sales !== undefined && led.rocket_sales !== null ? String(led.rocket_sales) : '')
      setCardSales(led.card_sales !== undefined && led.card_sales !== null ? String(led.card_sales) : '')
      setBankTransferSales(led.bank_transfer_sales !== undefined && led.bank_transfer_sales !== null ? String(led.bank_transfer_sales) : '')
      setCashSales(led.cash_sales !== undefined && led.cash_sales !== null && led.cash_sales > 0 ? String(led.cash_sales) : '')
      if (led.branch?.name) setBranchName(led.branch.name)
    } else {
      setKhuchraAmount('')
      setClosingCash('')
      setDifferenceNotes('')
      setCashSales('')
      setBkashSales('')
      setNagadSales('')
      setRocketSales('')
      setCardSales('')
      setBankTransferSales('')
    }
  }, [])

  const fetchLedger = useCallback(async () => {
    try {
      const cacheKey = `branch_ledger_${selectedDate}`
      const json = await fetchWithCache(cacheKey, `/api/branch-accounts/cash-ledger?date=${selectedDate}`, 45000)
      const led = json?.ledger?.[0] || null
      applyLedgerData(led)
      setError(null)
      return led
    } catch (e: any) {
      setError(e.message)
      return null
    }
  }, [selectedDate, applyLedgerData])

  const fetchHistory = useCallback(async () => {
    setIsHistoryLoading(true)
    try {
      const json = await fetchWithCache('branch_history_60', '/api/branch-accounts/cash-ledger?limit=60', 60000)
      if (Array.isArray(json?.ledger)) {
        setHistoryList(json.ledger)
        return json.ledger
      }
      return []
    } catch (e) {
      console.error('Failed to fetch closing history', e)
      return []
    } finally {
      setIsHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAuthorized) return
    const cachedLedger = getCachedData(`branch_ledger_${selectedDate}`)
    if (cachedLedger?.ledger?.[0]) {
      applyLedgerData(cachedLedger.ledger[0])
      setIsLoading(false)
    }
    Promise.all([fetchLedger(), fetchHistory()]).then(([led, history]) => {
      // Auto-populate khuchra from previous closing if available
      if (!led && history && history.length > 0) {
        const pastLedgers = history.filter((h: any) => h.ledger_date < selectedDate && (h.khuchra_amount !== null || h.actual_cash !== null))
        if (pastLedgers.length > 0) {
          const prev = pastLedgers[0]
          const prevFloat = (prev.khuchra_amount !== undefined && prev.khuchra_amount !== null) ? prev.khuchra_amount : (prev.opening_cash ?? '')
          if (prevFloat !== '') setKhuchraAmount(String(prevFloat))
        }
      }
      setIsLoading(false)
    })
  }, [isAuthorized, selectedDate, fetchLedger, fetchHistory, applyLedgerData])

  const handleCloseDay = async (e: React.FormEvent) => {
    e.preventDefault()
    const closingNum = Number(closingCash)
    if (closingCash === '' || isNaN(closingNum) || closingNum < 0) {
      setError('Please enter a valid Closing Cash amount (৳)')
      return
    }

    setIsSubmittingClosing(true)
    setError(null)
    try {
      const khuchraNum = khuchraAmount !== '' ? Number(khuchraAmount) : Number(ledger?.opening_cash ?? ledger?.khuchra_amount ?? 0)
      const otherNum = Number(ledger?.other_cash_in || 0)

      // B53 (CRITICAL): cash sales are what was RECORDED — typed by the
      // manager here, or already stored on the ledger. The old code
      // INFERRED sales from the drawer count whenever neither existed
      // (closing + expenses + deposits − float − otherIn, with pending
      // deposits included), fabricating a sales figure that made the
      // closing difference match by construction. A shortage must be
      // able to appear: unrecorded sales close as 0 and the difference
      // shows honestly.
      const finalCashSales = cashSales !== ''
        ? Number(cashSales)
        : Number(ledger?.cash_sales || 0)

      const res = await fetch('/api/branch-accounts/cash-ledger', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'close_day',
          ledger_date: selectedDate,
          khuchra_amount: khuchraNum,
          actual_cash: closingNum,
          cash_sales: finalCashSales,
          other_cash_in: otherNum,
          bkash_sales: bkashSales !== '' ? Number(bkashSales) : 0,
          nagad_sales: nagadSales !== '' ? Number(nagadSales) : 0,
          rocket_sales: rocketSales !== '' ? Number(rocketSales) : 0,
          card_sales: cardSales !== '' ? Number(cardSales) : 0,
          bank_transfer_sales: bankTransferSales !== '' ? Number(bankTransferSales) : 0,
          difference_notes: differenceNotes || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      invalidateBranchCache('branch_')
      setLedger(json.ledger)
      setClosingSuccess(isEditingClosed ? 'Closing figures updated successfully!' : 'Day closed successfully!')
      setIsEditingClosed(false)
      await fetchHistory()
      setTimeout(() => setClosingSuccess(null), 4000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsSubmittingClosing(false)
    }
  }

  // Export PDF Statement (Clean BDT, Landscape layout, Zero character overflow)
  const handleExportPdf = async () => {
    if (!historyList || historyList.length === 0) {
      setError('No history records to export.')
      return
    }
    setIsExportingPdf(true)
    try {
      const numFmt = (val: any) => Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

      const columns = [
        'Date',
        'Day',
        'Khuchra (BDT)',
        'Cash Sales (BDT)',
        'Digital MFS (BDT)',
        'Total Sales (BDT)',
        'Bank Deposits (BDT)',
        'Closing Cash (BDT)',
        'Discrepancy (BDT)',
        'Status'
      ]
      
      const rows = historyList.map(item => {
        const digitalTotal = Number(item.bkash_sales || 0) + Number(item.nagad_sales || 0) + Number(item.rocket_sales || 0) + Number(item.card_sales || 0) + Number(item.bank_transfer_sales || 0)
        const totalSalesDay = Number(item.cash_sales || 0) + digitalTotal
        const diffNum = item.cash_difference !== null && item.cash_difference !== undefined
          ? Number(item.cash_difference)
          : null
        const diffStr = diffNum !== null
          ? `${diffNum >= 0 ? '+' : ''}${numFmt(diffNum)}`
          : '-'

        return [
          item.ledger_date,
          getDayName(item.ledger_date),
          numFmt(item.khuchra_amount ?? item.opening_cash ?? 0),
          numFmt(item.cash_sales),
          numFmt(digitalTotal),
          numFmt(totalSalesDay),
          numFmt(item.bank_deposits_out),
          item.actual_cash !== null && item.actual_cash !== undefined ? numFmt(item.actual_cash) : '-',
          diffStr,
          item.is_closed ? 'Closed' : 'Open'
        ]
      })

      const totalClosed = historyList.filter(h => h.is_closed).length
      const totalDigital = historyList.reduce((sum, h) => {
        return sum + Number(h.bkash_sales || 0) + Number(h.nagad_sales || 0) + Number(h.rocket_sales || 0) + Number(h.card_sales || 0) + Number(h.bank_transfer_sales || 0)
      }, 0)
      const totalCashSales = historyList.reduce((sum, h) => sum + Number(h.cash_sales || 0), 0)
      const totalAllSales = totalCashSales + totalDigital
      const totalBankDeposits = historyList.reduce((sum, h) => sum + Number(h.bank_deposits_out || 0), 0)
      // B55: the old summary summed actual_cash over up to 60 history
      // rows — adding daily drawer SNAPSHOTS together counts the same
      // float dozens of times and means nothing. Report the LATEST
      // closed day's counted cash instead.
      const closedDays = historyList.filter(h => h.is_closed && h.actual_cash !== null && h.actual_cash !== undefined)
      const latestCountedClosing = closedDays.length > 0
        ? Number(closedDays.reduce((a, b) => (a.ledger_date > b.ledger_date ? a : b)).actual_cash || 0)
        : 0

      await generatePdf('Daily Cash Closing Statement', columns, rows, {
        branch: branchName,
        subtitle: 'DAILY SALES REVENUE, BANK DEPOSITS & CASH DRAWER AUDIT',
        dateRange: `Last ${historyList.length} Entries`,
        preparedBy: 'Branch Manager / Operations',
        orientation: 'landscape',
        summaryData: [
          { label: 'Total Recorded Days', value: `${historyList.length} Days` },
          { label: 'Total Closed Days', value: `${totalClosed} Days` },
          { label: 'Total Gross Sales Revenue', value: `${totalAllSales.toLocaleString()} BDT` },
          { label: 'Pure Cash Sales', value: `${totalCashSales.toLocaleString()} BDT` },
          { label: 'Digital Collections (MFS & Card)', value: `${totalDigital.toLocaleString()} BDT` },
          { label: 'Cash Deposited to Bank/HQ', value: `${totalBankDeposits.toLocaleString()} BDT` },
          { label: 'Latest Counted Drawer Cash', value: `${latestCountedClosing.toLocaleString()} BDT` },
        ],
        filename: `Daily_Closing_Statement_${branchName.replace(/\s+/g, '_')}_${selectedDate}.pdf`,
        notes: 'Total Sales Revenue = Pure Cash Sales + Digital Collections (bKash/Nagad/Rocket/Card/Bank). Bank deposits are cash transfers to company accounts and are deducted from drawer balances.'
      })
    } catch (e: any) {
      setError(e.message || 'Failed to export PDF statement.')
    } finally {
      setIsExportingPdf(false)
    }
  }

  // Live Calculations
  const currentKhuchraNum = Number(khuchraAmount !== '' ? khuchraAmount : (ledger?.opening_cash ?? ledger?.khuchra_amount ?? 0))
  const currentClosingNum = Number(closingCash || 0)
  const currentExpenses = Number(ledger?.cash_expenses || 0)
  const currentBankDeposits = Number(ledger?.bank_deposits_out || 0)
  const currentPendingDeposits = Number(ledger?.pending_deposits_out || 0)
  // B54: ONE expected-cash definition everywhere — the generated
  // column's (opening + sales + otherIn − expenses − APPROVED deposits
  // out). Pending deposits are NOT deducted until approved; the old
  // live formula deducted them, so the manager closed against a
  // different expected figure than the stored row/reports used.
  const effectiveBankDeposits = currentBankDeposits
  const currentOtherIn = Number(ledger?.other_cash_in || 0)

  // Active Cash Sales:
  const activeCashSales = cashSales !== ''
    ? Number(cashSales)
    : Number(ledger?.cash_sales || 0)

  // Total cash handled in drawer today:
  const totalCashHandled = currentKhuchraNum + activeCashSales + currentOtherIn
  // Total cash outflow today:
  const totalCashOutflow = currentExpenses + effectiveBankDeposits

  // Expected Physical Cash remaining in drawer:
  // Khuchra + Cash Sales + Other Cash In - Cash Expenses - Bank Deposits Taken to Bank (Approved + Pending)
  const expectedCash = totalCashHandled - totalCashOutflow
  const difference = closingCash !== '' ? currentClosingNum - expectedCash : null
  const diffStatus = difference === null ? null : difference === 0 ? 'matched' : difference < 0 ? 'shortage' : 'excess'

  const totalDigitalNow = (
    Number(bkashSales || 0) +
    Number(nagadSales || 0) +
    Number(rocketSales || 0) +
    Number(cardSales || 0) +
    Number(bankTransferSales || 0)
  )

  const totalRevenueToday = activeCashSales + totalDigitalNow

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const closedDigitalTotal = ledger ? (
    Number(ledger.bkash_sales || 0) +
    Number(ledger.nagad_sales || 0) +
    Number(ledger.rocket_sales || 0) +
    Number(ledger.card_sales || 0) +
    Number(ledger.bank_transfer_sales || 0)
  ) : 0
  const closedTotalRevenue = ledger ? (Number(ledger.cash_sales || 0) + closedDigitalTotal) : 0

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Background ambience */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/4 w-[500px] h-[400px] bg-[#1ca34c]/4 rounded-full filter blur-[140px]" />
        <div className="absolute bottom-10 left-1/4 w-[400px] h-[300px] bg-blue-500/3 rounded-full filter blur-[130px]" />
      </div>

      <div className="relative z-10 p-4 md:p-6 lg:p-8 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link href="/dashboard/branch-accounts"
              className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/30 text-slate-500 hover:text-slate-900 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-bold font-serif flex items-center gap-2">
                  <Calculator className="w-5 h-5 text-[#15803d]" /> Daily Cash Closing & Sales Audit
                </h1>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20">
                  {branchName}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Physical drawer cash reconciliation, sales revenue & bank deposit verification
              </p>
            </div>
          </div>

          {/* Date Selector with Day of Week */}
          <div className="flex items-center gap-3 bg-slate-900/[0.04] border border-slate-900/10 rounded-2xl px-4 py-2.5 self-start sm:self-auto shadow-sm">
            <Calendar className="w-4 h-4 text-[#15803d]" />
            <div className="flex flex-col">
              <span className="text-[9px] uppercase tracking-wider text-[#15803d] font-bold">
                {getDayName(selectedDate)}
              </span>
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="bg-transparent text-slate-900 text-xs font-semibold focus:outline-none cursor-pointer [color-scheme:light]"
              />
            </div>
          </div>
        </div>

        {/* Feedback alerts */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
        {closingSuccess && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" /> {closingSuccess}
          </div>
        )}

        {/* Day Status Banner */}
        <div className={`mb-6 p-4 rounded-2xl border flex items-center justify-between ${
          ledger?.is_closed
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
            : 'bg-amber-500/10 border-amber-500/20 text-amber-600'
        }`}>
          <div className="flex items-center gap-3">
            {ledger?.is_closed
              ? <CheckCircle className="w-5 h-5 text-emerald-600" />
              : <Sun className="w-5 h-5 text-amber-600" />
            }
            <div>
              <p className="text-xs font-bold uppercase tracking-wider">
                {ledger?.is_closed
                  ? `Day Closed — ${getDayName(selectedDate)}, ${formatDatePretty(selectedDate)}`
                  : `Day Open — Pending Evening Close (${getDayName(selectedDate)})`
                }
              </p>
              <p className="text-[10px] opacity-80">
                {ledger?.is_closed
                  ? isEditingClosed
                    ? 'Editing mode active: Make any adjustments below and click "Update & Save Closing Figures".'
                    : `Closed on ${new Date(ledger.closed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by ${ledger.closed_by_user?.full_name || 'Manager'}`
                  : 'Enter Khuchra (petty cash), counted drawer cash & digital collections at close'}
              </p>
            </div>
          </div>
          {ledger?.is_closed && (
            <button
              type="button"
              onClick={() => setIsEditingClosed(prev => !prev)}
              className="px-3.5 py-1.5 rounded-lg bg-slate-900/[0.07] hover:bg-slate-900/[0.09] text-slate-900 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
            >
              <Edit3 className="w-3.5 h-3.5 text-[#15803d]" />
              {isEditingClosed ? 'Cancel Edit' : 'Edit Figures'}
            </button>
          )}
        </div>

        {/* MAIN PANEL: CLOSED DAY SUMMARY OR ACTIVE CLOSING FORM */}
        {ledger?.is_closed && !isEditingClosed ? (
          <div className="space-y-6 mb-12">
            {/* Top 4 Clear Accounting Hero Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-3xl border border-[#1ca34c]/20 bg-[#1ca34c]/5 text-center flex flex-col justify-center">
                <p className="text-[10px] uppercase tracking-widest text-[#15803d]/80 mb-1 font-semibold">Total Day's Sales (মোট বিক্রি)</p>
                <p className="text-2xl lg:text-3xl font-extrabold text-[#15803d]">
                  {fmt(closedTotalRevenue)}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                  Cash: {fmt(ledger.cash_sales)} + Digital: {fmt(closedDigitalTotal)}
                </p>
              </div>

              <div className="p-5 rounded-3xl border border-blue-500/20 bg-blue-500/5 text-center flex flex-col justify-center">
                <p className="text-[10px] uppercase tracking-widest text-blue-600/80 mb-1 font-semibold">Bank Deposits (ব্যাংকে জমা)</p>
                <p className="text-2xl lg:text-3xl font-extrabold text-slate-900">
                  {fmt(ledger.bank_deposits_out || 0)}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">Deducted from drawer cash</p>
              </div>

              <div className="p-5 rounded-3xl border border-emerald-500/20 bg-emerald-500/5 text-center flex flex-col justify-center">
                <p className="text-[10px] uppercase tracking-widest text-emerald-600/80 mb-1 font-semibold">Counted Closing Cash (ড্রয়ার ক্যাশ)</p>
                <p className="text-2xl lg:text-3xl font-extrabold text-emerald-600">
                  {fmt(ledger.actual_cash)}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                  Expected: {fmt(ledger.expected_closing_cash)}
                </p>
              </div>

              <div className="p-5 rounded-3xl border border-amber-500/20 bg-amber-500/5 text-center flex flex-col justify-center">
                <p className="text-[10px] uppercase tracking-widest text-amber-600/80 mb-1 font-semibold">Reconciliation Status (হিসাব স্থিতি)</p>
                <p className={`text-2xl lg:text-3xl font-extrabold ${
                  ledger.difference_status === 'matched' ? 'text-emerald-600' :
                  ledger.difference_status === 'shortage' ? 'text-rose-600' : 'text-amber-600'
                }`}>
                  {ledger.difference_status === 'matched'
                    ? '৳0 Matched'
                    : `${(ledger.cash_difference || 0) >= 0 ? '+' : ''}${fmt(ledger.cash_difference || 0)}`
                  }
                </p>
                <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider font-semibold">
                  Status: {ledger.difference_status === 'matched' ? 'Exact Match (সঠিক)' : ledger.difference_status === 'shortage' ? 'Shortage (ঘাটতি)' : 'Excess (উদ্বৃত্ত)'}
                </p>
              </div>
            </div>

            {/* Detailed Breakdown Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Physical Drawer Cash Details */}
              <div className="p-5 rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-900/5">
                  <Banknote className="w-4 h-4 text-[#15803d]" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">Physical Drawer Cash Reconciliation</h3>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs">
                  <span className="text-slate-500">1. Opening Cash / Khuchra Float (ড্রয়ারে খুচরা টাকা)</span>
                  <span className="font-semibold text-slate-900">{fmt(ledger.opening_cash ?? ledger.khuchra_amount ?? 0)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs">
                  <span className="text-slate-500">2. (+) Physical Cash Sales (সারাদিনের ক্যাশ বিক্রি)</span>
                  <span className="font-semibold text-emerald-600">+{fmt(ledger.cash_sales)}</span>
                </div>
                {Number(ledger.other_cash_in || 0) > 0 && (
                  <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs">
                    <span className="text-slate-500">3. (+) Other Cash In (অন্যান্য নগদ গ্রহণ)</span>
                    <span className="font-semibold text-blue-600">+{fmt(ledger.other_cash_in)}</span>
                  </div>
                )}
                <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs bg-slate-900/[0.04] px-2 rounded">
                  <span className="text-slate-600 font-semibold">= Total Cash Handled (মোট সংগৃহীত নগদ)</span>
                  <span className="font-bold text-slate-900 font-serif">
                    {fmt(Number(ledger.opening_cash ?? ledger.khuchra_amount ?? 0) + Number(ledger.cash_sales || 0) + Number(ledger.other_cash_in || 0))}
                  </span>
                </div>
                {Number(ledger.cash_expenses || 0) > 0 && (
                  <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs">
                    <span className="text-slate-500">4. (−) Cash Expenses Paid (নগদ খরচ)</span>
                    <span className="font-semibold text-rose-600">−{fmt(ledger.cash_expenses)}</span>
                  </div>
                )}
                {Number(ledger.bank_deposits_out || 0) > 0 && (
                  <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs">
                    <div>
                      <span className="text-slate-500">5. (−) Bank Deposits Taken to Bank (ব্যাংকে জমা)</span>
                      <p className="text-[9px] text-[#15803d]/80">Transferred from drawer to bank account</p>
                    </div>
                    <span className="font-semibold text-amber-600">−{fmt(ledger.bank_deposits_out)}</span>
                  </div>
                )}
                {Number(ledger.pending_deposits_out || 0) > 0 && (
                  <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs">
                    <div>
                      <span className="text-slate-500">6. Bank Deposits Pending HQ Approval (অনুমোদনাধীন জমা) — memo</span>
                      <p className="text-[9px] text-amber-600/80">Submitted today; deducted from the drawer only once HQ approves (B54)</p>
                    </div>
                    <span className="font-semibold text-amber-600/90">{fmt(ledger.pending_deposits_out)}</span>
                  </div>
                )}
                <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs bg-[#1ca34c]/10 px-2 rounded border border-[#1ca34c]/20">
                  <span className="text-[#15803d] font-semibold">= Expected Closing Cash (ড্রয়ারে থাকা উচিত)</span>
                  <span className="font-bold text-[#15803d] font-serif">{fmt(ledger.expected_closing_cash)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs">
                  <span className="text-slate-600 font-bold">Counted Physical Cash (ড্রয়ারে গুনে পাওয়া ক্যাশ)</span>
                  <span className="font-bold text-emerald-600 font-serif">{fmt(ledger.actual_cash)}</span>
                </div>
                <div className="flex justify-between py-1.5 text-xs">
                  <span className="text-slate-500 font-semibold">Variance / Discrepancy (পার্থক্য)</span>
                  <span className={`font-bold font-serif ${
                    ledger.difference_status === 'matched' ? 'text-emerald-600' :
                    ledger.difference_status === 'shortage' ? 'text-rose-600' : 'text-amber-600'
                  }`}>
                    {ledger.difference_status === 'matched' ? '✅ ৳0 (Exact Match)' : `${(ledger.cash_difference || 0) >= 0 ? '+' : ''}${fmt(ledger.cash_difference || 0)} (${ledger.difference_status})`}
                  </span>
                </div>
                {ledger.difference_notes && (
                  <div className="pt-2 text-[11px] text-slate-500 border-t border-slate-900/[0.08]">
                    <span className="font-semibold text-slate-600">Discrepancy Notes:</span> {ledger.difference_notes}
                  </div>
                )}
              </div>

              {/* Digital Collections Breakdown */}
              <div className="p-5 rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-900/5">
                  <Smartphone className="w-4 h-4 text-blue-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">Digital MFS & Online Collections</h3>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs">
                  <span className="text-slate-500">bKash Merchant/Personal</span>
                  <span className="font-semibold text-slate-900">{fmt(ledger.bkash_sales)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs">
                  <span className="text-slate-500">Nagad</span>
                  <span className="font-semibold text-slate-900">{fmt(ledger.nagad_sales)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs">
                  <span className="text-slate-500">Rocket</span>
                  <span className="font-semibold text-slate-900">{fmt(ledger.rocket_sales)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs">
                  <span className="text-slate-500">Card / POS Machine</span>
                  <span className="font-semibold text-slate-900">{fmt(ledger.card_sales)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-900/[0.08] text-xs">
                  <span className="text-slate-500">Bank Transfer</span>
                  <span className="font-semibold text-slate-900">{fmt(ledger.bank_transfer_sales)}</span>
                </div>
                <div className="flex justify-between py-1.5 text-xs bg-blue-500/10 px-2 rounded border border-blue-500/20">
                  <span className="text-blue-300 font-bold">Total Digital Collections (MFS/Card)</span>
                  <span className="font-bold text-blue-600 font-serif">
                    {fmt(closedDigitalTotal)}
                  </span>
                </div>
                <div className="flex justify-between py-2 text-xs bg-[#1ca34c]/10 px-2 rounded border border-[#1ca34c]/20 mt-2">
                  <span className="text-[#15803d] font-bold">Total Sales Revenue (Cash + Digital)</span>
                  <span className="font-bold text-[#15803d] font-serif text-sm">
                    {fmt(closedTotalRevenue)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ACTIVE / OPEN DAY FORM (OPENING CASH REMOVED - KHUCHRA INTEGRATED) */
          <div className="space-y-6 mb-12">
            <form onSubmit={handleCloseDay} className="p-6 rounded-3xl border border-slate-900/10 bg-slate-900/[0.04] space-y-6">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-900/5">
                <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600">
                  <Moon className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">Evening: Daily Closing, Khuchra & Sales Audit</h2>
                  <p className="text-[10px] text-slate-500">Reconcile physical cash drawer with Khuchra change and record digital collections</p>
                </div>
              </div>

              {/* KHUCHRA (PETTY CASH / CHANGE) FIELD */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                    Khuchra / Change Float (ড্রয়ারে থাকা খুচরা টাকা / ভাংতি) (৳)
                  </label>
                  <span className="text-[9px] text-[#15803d]">Petty Cash & Drawer Float</span>
                </div>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-serif">৳</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={khuchraAmount}
                    onChange={e => setKhuchraAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-sm font-serif focus:outline-none focus:border-[#1ca34c]/40 transition-colors"
                  />
                </div>
                <p className="text-[9px] text-slate-500 mt-1">
                  নগদ বিক্রির টাকার বাইরে ড্রয়ারে যে ভাংতি/খুচরা টাকা রক্ষিত থাকে তা এখানে দিন।
                </p>
              </div>

              {/* Digital Collections Grid */}
              <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-900">Evening Digital Collections</span>
                  </div>
                  <span className="text-xs font-bold text-blue-600 font-serif">
                    Total: {fmt(totalDigitalNow)}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500">
                  Document digital collections received today (separate from drawer cash)
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">bKash (৳)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={bkashSales}
                      onChange={e => setBkashSales(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">Nagad (৳)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={nagadSales}
                      onChange={e => setNagadSales(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">Rocket (৳)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rocketSales}
                      onChange={e => setRocketSales(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">Card / POS (৳)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cardSales}
                      onChange={e => setCardSales(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                    />
                  </div>
                  <div className="col-span-2 md:col-span-2">
                    <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">Bank Transfer (৳)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={bankTransferSales}
                      onChange={e => setBankTransferSales(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                    />
                  </div>
                </div>
              </div>

              {/* Physical Cash Sales Field */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500">
                    Physical Cash Sales (সারাদিনের ক্যাশ বিক্রি) (৳)
                  </label>
                  <span className="text-[9px] text-[#15803d]">
                    {cashSales !== '' ? 'Custom Amount' : Number(ledger?.cash_sales || 0) > 0 ? 'Loaded from POS Register' : 'Pure cash sales'}
                  </span>
                </div>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-serif">৳</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cashSales !== '' ? cashSales : (Number(ledger?.cash_sales || 0) > 0 ? String(ledger.cash_sales) : '')}
                    onChange={e => setCashSales(e.target.value)}
                    placeholder={Number(ledger?.cash_sales || 0) > 0 ? String(ledger.cash_sales) : '0.00'}
                    className="w-full pl-8 pr-4 py-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-sm font-serif focus:outline-none focus:border-[#1ca34c]/40 transition-colors"
                  />
                </div>
              </div>

              {/* Counted Physical Drawer Cash */}
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">
                  Total Counted Physical Cash in Drawer (ড্রয়ারে থাকা মোট ক্যাশ - বিক্রির টাকাসহ) (৳) *
                </label>
                <p className="text-[10px] text-amber-600 mb-2 font-semibold">
                  ড্রয়ারে থাকা সমস্ত ক্যাশ (বিক্রি + খুচরা) একসাথে গুনে এন্ট্রি করুন।
                </p>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-serif">৳</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={closingCash}
                    onChange={e => setClosingCash(e.target.value)}
                    placeholder="Enter total physical notes & coins in drawer"
                    className="w-full pl-8 pr-4 py-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-sm font-serif font-bold placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-colors"
                    required
                  />
                </div>
              </div>

              {/* LIVE EXPECTED DRAWER CASH CALCULATION & BREAKDOWN */}
              <div className="p-4 rounded-xl bg-white border border-slate-900/10 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-900/5">
                  <div className="flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-[#15803d]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-900">Expected Drawer Cash Breakdown</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">Khuchra + Sales − Expenses − Deposits</span>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between items-center py-1 border-b border-slate-900/[0.08]">
                    <span className="text-slate-500">Khuchra / Float (খুচরা ও ভাংতি টাকা)</span>
                    <span className="font-semibold text-slate-900 font-serif">+ {fmt(currentKhuchraNum)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-slate-900/[0.08]">
                    <span className="text-slate-500">(+) Physical Cash Sales (সারাদিনের ক্যাশ বিক্রি)</span>
                    <span className="font-semibold text-emerald-600 font-serif">+ {fmt(activeCashSales)}</span>
                  </div>
                  {currentOtherIn > 0 && (
                    <div className="flex justify-between items-center py-1 border-b border-slate-900/[0.08]">
                      <span className="text-slate-500">(+) Other Cash In (অন্যান্য জমা)</span>
                      <span className="font-semibold text-blue-600 font-serif">+ {fmt(currentOtherIn)}</span>
                    </div>
                  )}
                  {currentExpenses > 0 && (
                    <div className="flex justify-between items-center py-1 border-b border-slate-900/[0.08]">
                      <span className="text-slate-500">(−) Cash Expenses Paid (দৈনিক খরচ)</span>
                      <span className="font-semibold text-rose-600 font-serif">− {fmt(currentExpenses)}</span>
                    </div>
                  )}
                  {currentBankDeposits > 0 && (
                    <div className="flex justify-between items-center py-1 border-b border-slate-900/[0.08]">
                      <div>
                        <span className="text-slate-500">(−) Bank Deposits Taken to Bank (ব্যাংকে জমা দেওয়া ক্যাশ)</span>
                        <p className="text-[9px] text-[#15803d]/80">Deducted immediately from drawer — will not count as shortage</p>
                      </div>
                      <span className="font-semibold text-amber-600 font-serif">− {fmt(currentBankDeposits)}</span>
                    </div>
                  )}
                  {currentPendingDeposits > 0 && (
                    <div className="flex justify-between items-center py-1 border-b border-slate-900/[0.08]">
                      <div>
                        <span className="text-slate-500">(−) Bank Deposits Pending Approval (ব্যাংকে জমা - অনুমোদনের অপেক্ষায়)</span>
                        <p className="text-[9px] text-amber-600/80">Already deposited in bank — deducted from drawer so no shortage occurs</p>
                      </div>
                      <span className="font-semibold text-amber-600/90 font-serif">− {fmt(currentPendingDeposits)}</span>
                    </div>
                  )}
                  <div className="pt-2 flex justify-between items-center text-sm font-bold border-t border-slate-900/10 bg-slate-900/[0.04] p-2 rounded-lg">
                    <span className="text-[#15803d] uppercase tracking-wider text-xs">= Expected Cash in Drawer (ড্রয়ারে থাকা উচিত)</span>
                    <span className="font-serif text-[#15803d] text-base">{fmt(expectedCash)}</span>
                  </div>
                </div>
              </div>

              {/* EXPECTED VS ACTUAL COMPARISON */}
              {closingCash !== '' && (
                <div className={`p-4 rounded-xl border space-y-2.5 ${
                  diffStatus === 'matched' ? 'bg-emerald-500/10 border-emerald-500/20'
                  : diffStatus === 'shortage' ? 'bg-rose-500/10 border-rose-500/20'
                  : 'bg-amber-500/10 border-amber-500/20'
                }`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Actual Counted Physical Cash:</span>
                    <span className="font-bold text-slate-900 font-serif text-sm">{fmt(currentClosingNum)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Expected Physical Drawer Cash:</span>
                    <span className="font-semibold text-slate-600 font-serif">{fmt(expectedCash)}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-900/10 flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider font-semibold text-slate-600">
                      Discrepancy (পার্থক্য):
                    </span>
                    <span className={`text-sm font-bold font-serif ${
                      diffStatus === 'matched' ? 'text-emerald-600'
                      : diffStatus === 'shortage' ? 'text-rose-600'
                      : 'text-amber-600'
                    }`}>
                      {diffStatus === 'matched'
                        ? '✅ ৳0 (Exact Match / কোনো গরমিল নেই)'
                        : `${difference! >= 0 ? '+' : ''}${fmt(difference!)} (${diffStatus === 'shortage' ? 'Shortage / ঘাটতি' : 'Excess / উদ্বৃত্ত'})`
                      }
                    </span>
                  </div>
                </div>
              )}

              {/* Difference notes if discrepancy */}
              {diffStatus && diffStatus !== 'matched' && (
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">
                    Discrepancy Notes <span className="text-amber-600">*</span>
                  </label>
                  <textarea
                    value={differenceNotes}
                    onChange={e => setDifferenceNotes(e.target.value)}
                    placeholder="Explain the difference (e.g. damaged note, petty cash used, etc.)"
                    rows={2}
                    className="w-full p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/40 transition-colors resize-none"
                    required
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmittingClosing || !closingCash}
                className="w-full py-3.5 rounded-full bg-[#1ca34c] hover:bg-[#15803d] text-white font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-[#1ca34c]/10"
              >
                {isSubmittingClosing
                  ? <><div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" /> {isEditingClosed ? 'Updating Figures...' : 'Closing Day...'}</>
                  : isEditingClosed
                    ? <><CheckCircle className="w-4 h-4" /> Update & Save Closing Figures</>
                    : <><CheckCircle className="w-4 h-4" /> Close Day & Record Count</>
                }
              </button>
            </form>
          </div>
        )}

        {/* SECTION 3: DATE-WISE DAILY CLOSING HISTORY TABLE */}
        <div className="rounded-2xl border border-slate-900/10 bg-slate-900/[0.04] overflow-hidden shadow-xl">
          <div className="p-5 border-b border-slate-900/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/[0.04]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#1ca34c]/10 border border-[#1ca34c]/20 flex items-center justify-center text-[#15803d]">
                <History className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold font-serif text-slate-900">Daily Closing History</h3>
                <p className="text-[10px] text-slate-500">Date-wise chronological audit of Khuchra float, sales & counted drawer cash</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleExportPdf}
                disabled={isExportingPdf || historyList.length === 0}
                className="px-3.5 py-2 rounded-xl bg-[#1ca34c]/10 border border-[#1ca34c]/30 hover:bg-[#1ca34c]/20 text-[#15803d] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                {isExportingPdf ? 'Generating PDF...' : 'Export Statement (PDF)'}
              </button>
              <button
                onClick={fetchHistory}
                disabled={isHistoryLoading}
                className="p-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-slate-900/20 text-slate-500 hover:text-slate-900 transition-all cursor-pointer"
                title="Refresh History"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isHistoryLoading ? 'animate-spin text-[#15803d]' : ''}`} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-900/10 bg-slate-900/[0.04]">
                  {['Date & Day', 'Khuchra (খুচরা)', 'Cash Sales', 'Digital MFS', 'Total Sales', 'Bank Deposits', 'Closing Cash', 'Discrepancy', 'Status', 'Action'].map(h => (
                    <th key={h} className="text-left p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/[0.08]">
                {historyList.map((item) => {
                  const dayName = getDayName(item.ledger_date)
                  const digitalTotal = Number(item.bkash_sales || 0) + Number(item.nagad_sales || 0) + Number(item.rocket_sales || 0) + Number(item.card_sales || 0) + Number(item.bank_transfer_sales || 0)
                  const totalSales = Number(item.cash_sales || 0) + digitalTotal
                  const isSelected = item.ledger_date === selectedDate

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-900/[0.04] transition-colors ${isSelected ? 'bg-[#1ca34c]/5' : ''}`}
                    >
                      <td className="p-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{formatDatePretty(item.ledger_date)}</span>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                            dayName === 'Friday'
                              ? 'bg-amber-500/15 text-amber-700 border border-amber-500/20'
                              : 'bg-slate-900/[0.04] text-slate-500'
                          }`}>
                            {dayName}
                          </span>
                        </div>
                      </td>
                      <td className="p-3.5 font-medium text-slate-600 whitespace-nowrap">
                        {fmt(item.khuchra_amount ?? item.opening_cash ?? 0)}
                      </td>
                      <td className="p-3.5 font-medium text-emerald-600 whitespace-nowrap">
                        {fmt(item.cash_sales)}
                      </td>
                      <td className="p-3.5 font-medium text-blue-600 whitespace-nowrap" title={`bKash: ${fmt(item.bkash_sales)}, Nagad: ${fmt(item.nagad_sales)}, Rocket: ${fmt(item.rocket_sales)}, Card: ${fmt(item.card_sales)}`}>
                        {fmt(digitalTotal)}
                      </td>
                      <td className="p-3.5 font-serif font-bold text-[#15803d] whitespace-nowrap">
                        {fmt(totalSales)}
                      </td>
                      <td className="p-3.5 font-medium text-amber-600 whitespace-nowrap">
                        {Number(item.bank_deposits_out || 0) > 0 ? fmt(item.bank_deposits_out) : '—'}
                      </td>
                      <td className="p-3.5 font-serif font-bold text-slate-900 whitespace-nowrap">
                        {item.actual_cash !== null && item.actual_cash !== undefined ? fmt(item.actual_cash) : '—'}
                      </td>
                      <td className="p-3.5 whitespace-nowrap">
                        {item.cash_difference !== null && item.cash_difference !== undefined ? (
                          <span className={`text-[10px] font-bold ${
                            item.difference_status === 'matched' ? 'text-emerald-600' :
                            item.difference_status === 'shortage' ? 'text-rose-600' : 'text-amber-600'
                          }`}>
                            {item.cash_difference >= 0 ? '+' : ''}{fmt(item.cash_difference)}
                            {' '}({item.difference_status})
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="p-3.5 whitespace-nowrap">
                        <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                          item.is_closed
                            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                        }`}>
                          {item.is_closed ? 'Closed' : 'Open'}
                        </span>
                      </td>
                      <td className="p-3.5 whitespace-nowrap">
                        <button
                          onClick={() => {
                            setSelectedDate(item.ledger_date)
                            window.scrollTo({ top: 0, behavior: 'smooth' })
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-[#1ca34c] text-white'
                              : 'bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-600'
                          }`}
                        >
                          <Eye className="w-3 h-3" /> {isSelected ? 'Viewing' : 'Select'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {historyList.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">
                      No closing history recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
