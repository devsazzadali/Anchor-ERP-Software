'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  PieChart, MapPin, Download, Loader2,
  Search, X, Check, AlertTriangle, Calendar,
  FileSpreadsheet, FileText, ChevronDown, TrendingUp, Building2,
  Clock, ArrowRight, CheckCircle, XCircle, Coins, Zap,
  Eye, Banknote, CreditCard, RefreshCw, Layers, Landmark
} from 'lucide-react'
import Link from 'next/link'
import { generatePdf } from '@/lib/pdf-generator'
import { generateExcel } from '@/lib/excel-generator'
import DepositSlipModal from '@/components/DepositSlipModal'
import { parseKhuchraAmount } from '@/lib/branch-deposit-utils'
import { useBranchAuth } from '@/lib/hooks/use-branch-auth'
import { fetchWithCache, getCachedData, setCachedData, invalidateBranchCache } from '@/lib/branch-cache'

// the only direct data reads left in the fixed
// copy were branches and the per-branch drawer float — both now go
// through the app's API layer (/api/branches and
// /api/branch-accounts/cash-ledger). Everything else on this page
// already used API routes (reports/monthly, deposits, approve).

const fmt = (n: number | null | undefined) =>
  '৳' + Number(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const getDayName = (dateStr: string) => {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'short' })
  } catch {
    return ''
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type Branch = { id: string; name: string }

type BankBreakdownItem = {
  bankName: string
  totalAmount: number
  depositCount: number
}

type BranchSummary = {
  branchId: string
  branchName: string
  reportMonth: string
  cashSales: number
  bkashSales: number
  nagadSales: number
  rocketSales: number
  cardSales: number
  bankTransferSales: number
  digitalSales: number
  totalSales: number
  otherCashIn: number
  grossCashInflow: number
  totalExpenses: number
  operatingProfit: number
  operatingLoss: number
  profitMargin: number
  approvedDeposits: number
  pendingDeposits: number
  netCash: number
  daysClosed: number
  daysTracked: number
  daysWithShortage: number
  totalCashDifference: number
  bankBreakdown?: BankBreakdownItem[]
}

type DailyLedgerRow = {
  branch_id: string
  ledger_date: string
  opening_cash?: number
  cash_sales: number
  bkash_sales: number
  nagad_sales: number
  rocket_sales: number
  card_sales: number
  bank_transfer_sales: number
  other_cash_in: number
  cash_expenses: number
  bank_deposits_out: number
  actual_cash: number
  expected_closing_cash: number
  cash_difference: number
  difference_status: string
  is_closed: boolean
}

type LiveFinancialReportResponse = {
  year: number
  month: number
  fromDate: string
  toDate: string
  summary: {
    totalCashSales: number
    totalDigitalSales: number
    totalSales: number
    totalOtherCashIn: number
    grossCashInflow: number
    totalExpenses: number
    totalApprovedDeposits: number
    totalPendingDeposits: number
    netCash: number
    totalOperatingProfit: number
    totalOperatingLoss: number
    overallProfitMargin: number
    daysTracked: number
    daysClosed: number
    daysWithShortage: number
    daysWithExcess: number
    totalCashDifference: number
    bankBreakdown?: BankBreakdownItem[]
  }
  branches: BranchSummary[]
  dailyLedger: DailyLedgerRow[]
  deposits: any[]
  expenses: any[]
}

export default function BranchFinancialReportsPage() {
  const router = useRouter()
  const { user, isAdmin, isAuthorized, isLoading: isAuthLoading } = useBranchAuth()

  // Tab State: 'monthly_statements' | 'bank_deposits'
  const [activeTab, setActiveTab] = useState<'monthly_statements' | 'bank_deposits'>('monthly_statements')

  // Filters for Monthly Statements (Live Dynamic Aggregation)
  const currentMonthString = useMemo(() => new Date().toISOString().slice(0, 7), [])
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthString)
  const [search, setSearch] = useState('')
  const [filterBranch, setFilterBranch] = useState('')

  const finCacheKey = `admin_fin_${currentMonthString}_${filterBranch || 'all'}`
  const [branches, setBranches] = useState<Branch[]>(() => getCachedData('admin_branches') || [])
  const [deposits, setDeposits] = useState<any[]>(() => getCachedData('admin_all_deposits') || [])
  const [liveData, setLiveData] = useState<LiveFinancialReportResponse | null>(() => getCachedData(finCacheKey) || null)
  const [isLoading, setIsLoading] = useState(() => !getCachedData(finCacheKey))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDepositsLoading, setIsDepositsLoading] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [userName, setUserName] = useState((user as any)?.user_metadata?.full_name || 'Admin')
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Selected Branch for Daily Ledger Breakdown Inspection Modal
  const [inspectBranch, setInspectBranch] = useState<BranchSummary | null>(null)
  const [inspectTab, setInspectTab] = useState<'daily' | 'deposits' | 'banks'>('daily')

  // Filters for Bank Deposits
  const [depositSearch, setDepositSearch] = useState('')
  const [depositFilterStatus, setDepositFilterStatus] = useState<string>('all')
  const [depositFilterBranch, setDepositFilterBranch] = useState<string>('')

  // Export dropdown
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  // Deposit Lightbox Modal state
  const [selectedDepositModal, setSelectedDepositModal] = useState<any | null>(null)
  const [modalMediaUrl, setModalMediaUrl] = useState<string | null>(null)
  const [actionDepositId, setActionDepositId] = useState<string | null>(null)

  // ─── Auth ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthLoading && !isAdmin) {
      setAccessDenied(true)
      setIsLoading(false)
    }
  }, [isAuthLoading, isAdmin])

  // ─── Fetch Branches ───────────────────────────────────────────────────────
  const fetchBranches = useCallback(async () => {
    try {
      const cached = getCachedData('admin_branches')
      if (cached) setBranches(cached)
      const res = await fetch('/api/branches')
      const j = res.ok ? await res.json().catch(() => ({})) : {}
      const data = j.branches
      if (data) {
        setBranches(data)
        setCachedData('admin_branches', data, 120000)
      }
    } catch {}
  }, [])

  // ─── Fetch each branch's current drawer float (B50) ──────────────────────
  useEffect(() => {
    if (!branches || branches.length === 0) return
    let cancelled = false
    ;(async () => {
      const floats: Record<string, number> = {}
      await Promise.all((branches as any[]).map(async (b: any) => {
        const res = await fetch(`/api/branch-accounts/cash-ledger?branch_id=${b.id}&limit=1`)
        const json = res.ok ? await res.json().catch(() => ({})) : {}
        const row = json.ledger?.[0]
        floats[b.id] = row ? Number(row.khuchra_amount ?? row.opening_cash ?? 0) : 0
      }))
      if (!cancelled) setBranchFloats(floats)
    })()
    return () => { cancelled = true }
  }, [branches])

  // ─── Fetch Live Financial Report from Verified Ledgers ────────────────────
  const fetchLiveFinancials = useCallback(async (monthStr?: string, bId?: string) => {
    const targetMonth = monthStr || selectedMonth || currentMonthString
    const [yr, mo] = targetMonth.split('-')
    const targetBranchId = bId !== undefined ? bId : filterBranch

    try {
      const queryParams = new URLSearchParams({
        year: yr,
        month: String(parseInt(mo, 10)),
        branch_id: targetBranchId || 'all'
      })
      const cacheKey = `admin_fin_${targetMonth}_${targetBranchId || 'all'}`
      const json = await fetchWithCache(
        cacheKey,
        `/api/branch-accounts/reports/monthly?${queryParams.toString()}`,
        {
          ttlMs: 60000,
          onBackgroundUpdate: (fresh) => {
            if (fresh) setLiveData(fresh)
          }
        }
      )
      if (json) setLiveData(json)
    } catch (err: any) {
      console.error('Error fetching live financial report:', err)
      setFeedback({ type: 'error', message: err.message || 'Failed to fetch live financials' })
    }
  }, [selectedMonth, filterBranch, currentMonthString])

  // ─── Fetch Bank Deposits ──────────────────────────────────────────────────
  const fetchDeposits = useCallback(async () => {
    setIsDepositsLoading(true)
    try {
      const json = await fetchWithCache(
        'admin_all_deposits',
        '/api/branch-accounts/deposits',
        {
          ttlMs: 45000,
          onBackgroundUpdate: (fresh) => {
            if (fresh?.deposits) setDeposits(fresh.deposits)
          }
        }
      )
      if (json?.deposits) {
        setDeposits(json.deposits)
      }
    } catch {
      // silently handle
    } finally {
      setIsDepositsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    fetchBranches()
    fetchDeposits()
    const targetBranchId = filterBranch || 'all'
    const cacheKey = `admin_fin_${selectedMonth}_${targetBranchId}`
    const cached = getCachedData(cacheKey)
    if (cached) {
      setLiveData(cached)
      setIsLoading(false)
    }
    fetchLiveFinancials(selectedMonth, filterBranch).finally(() => {
      setIsLoading(false)
    })
  }, [isAdmin, selectedMonth, filterBranch, fetchBranches, fetchDeposits, fetchLiveFinancials])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    invalidateBranchCache(`admin_fin_${selectedMonth}`)
    invalidateBranchCache('admin_all_deposits')
    await Promise.all([fetchLiveFinancials(selectedMonth, filterBranch), fetchDeposits()])
    setIsRefreshing(false)
    setFeedback({ type: 'success', message: 'Financial ledgers synchronized with live database.' })
    setTimeout(() => setFeedback(null), 3000)
  }

  // ─── Computed Filtered Branch Summaries ───────────────────────────────────
  const filteredBranchSummaries = useMemo(() => {
    if (!liveData?.branches) return []
    return liveData.branches.filter(b => {
      const matchesSearch = !search || b.branchName.toLowerCase().includes(search.toLowerCase().trim())
      const matchesBranch = !filterBranch || b.branchId === filterBranch
      return matchesSearch && matchesBranch
    })
  }, [liveData, search, filterBranch])

  // Computed Totals for Filtered View
  const computedTotals = useMemo(() => {
    const list = filteredBranchSummaries
    const cashSales = list.reduce((s, b) => s + b.cashSales, 0)
    const digitalSales = list.reduce((s, b) => s + b.digitalSales, 0)
    const totalSales = cashSales + digitalSales
    const expenses = list.reduce((s, b) => s + b.totalExpenses, 0)
    const approvedDeposits = list.reduce((s, b) => s + b.approvedDeposits, 0)
    const netCash = list.reduce((s, b) => s + b.netCash, 0)
    const operatingProfit = list.reduce((s, b) => s + b.operatingProfit, 0)
    const operatingLoss = list.reduce((s, b) => s + b.operatingLoss, 0)
    const profitMargin = totalSales > 0 ? Number((((operatingProfit - operatingLoss) / totalSales) * 100).toFixed(1)) : 0

    return {
      branchesCount: list.length,
      cashSales,
      digitalSales,
      totalSales,
      expenses,
      approvedDeposits,
      netCash,
      operatingProfit,
      operatingLoss,
      profitMargin
    }
  }, [filteredBranchSummaries])

  const topBranch = useMemo(() => {
    if (!filteredBranchSummaries.length) return null
    return [...filteredBranchSummaries].sort((a, b) => b.totalSales - a.totalSales)[0]
  }, [filteredBranchSummaries])

  // ─── Computed Metrics (Bank Deposits & Slips) ─────────────────────────────
  const filteredDeposits = useMemo(() => {
    return deposits.filter(d => {
      const branchName = (d.branch?.name || d.branch_name || '').toLowerCase()
      const managerName = (d.manager_name || '').toLowerCase()
      const slipNo = (d.deposit_slip_number || '').toLowerCase()
      const txnId = (d.bank_transaction_id || '').toLowerCase()
      const bankName = (d.bank_account_name || '').toLowerCase()
      const q = depositSearch.toLowerCase().trim()

      const matchesSearch = !q ||
        branchName.includes(q) ||
        managerName.includes(q) ||
        slipNo.includes(q) ||
        txnId.includes(q) ||
        bankName.includes(q)

      const matchesStatus =
        depositFilterStatus === 'all'
          ? true
          : depositFilterStatus === 'pending'
          ? ['submitted', 'pending_approval'].includes(d.status)
          : d.status === depositFilterStatus

      const matchesBranch = !depositFilterBranch || d.branch_id === depositFilterBranch

      return matchesSearch && matchesStatus && matchesBranch
    })
  }, [deposits, depositSearch, depositFilterStatus, depositFilterBranch])

  const pendingDepositsCount = useMemo(
    // B51: reversed deposits are dead money — excluded from both the
    // pending and approved totals (same defect as B47, second site).
    () => filteredDeposits.filter(d => ['submitted', 'pending_approval'].includes(d.status) && !d.is_reversed).length,
    [filteredDeposits]
  )
  const pendingDepositsTotal = useMemo(
    () => filteredDeposits.filter(d => ['submitted', 'pending_approval'].includes(d.status) && !d.is_reversed).reduce((s, d) => s + Number(d.amount || 0), 0),
    [filteredDeposits]
  )
  const totalDepositsApproved = useMemo(
    () => filteredDeposits.filter(d => d.status === 'approved' && !d.is_reversed).reduce((s, d) => s + Number(d.amount || 0), 0),
    [filteredDeposits]
  )
  // B50: "khuchra kept" is the branch's CURRENT drawer float, which
  // lives on the latest cash-ledger day (khuchra_amount, falling back
  // to opening_cash — the same convention as daily closing). The old
  // code took the khuchra tag of whichever deposit was newest in an
  // all-time unfiltered list — a stale per-deposit remainder, not a
  // float. Floats are fetched per branch in fetchBranchFloats below.
  const [branchFloats, setBranchFloats] = useState<Record<string, number>>({})
  const totalKhuchraFiltered = useMemo(() => {
    const branchKeys = new Set(filteredDeposits.map(d => d.branch_id).filter(Boolean))
    let total = 0
    branchKeys.forEach(k => { total += Number(branchFloats[k as string] || 0) })
    return total
  }, [filteredDeposits, branchFloats])

  // ─── Handlers for Deposits Approvals ──────────────────────────────────────
  const handleApproveDeposit = async (id: string) => {
    setActionDepositId(id)
    try {
      const res = await fetch(`/api/branch-accounts/deposits/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setFeedback({ type: 'success', message: 'Bank deposit approved successfully!' })
      setSelectedDepositModal(null)
      await fetchDeposits()
      await fetchLiveFinancials()
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message })
    } finally {
      setActionDepositId(null)
      setTimeout(() => setFeedback(null), 4000)
    }
  }

  const handleRejectDeposit = async (id: string, reasonToUse: string | any) => {
    const reason = typeof reasonToUse === 'string' ? reasonToUse : ''
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      setFeedback({ type: 'error', message: 'Rejection reason is required' })
      return
    }
    setActionDepositId(id)
    try {
      const res = await fetch(`/api/branch-accounts/deposits/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejection_reason: reason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setFeedback({ type: 'success', message: 'Bank deposit rejected. Manager notified.' })
      setSelectedDepositModal(null)
      await fetchDeposits()
      await fetchLiveFinancials()
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message })
    } finally {
      setActionDepositId(null)
      setTimeout(() => setFeedback(null), 4000)
    }
  }

  // ─── Daily Breakdown for Inspected Branch ─────────────────────────────────
  const inspectedBranchDailyLedger = useMemo(() => {
    if (!inspectBranch || !liveData?.dailyLedger) return []
    return liveData.dailyLedger.filter(row => row.branch_id === inspectBranch.branchId)
  }, [inspectBranch, liveData])

  const inspectedBranchDeposits = useMemo(() => {
    if (!inspectBranch || !liveData?.deposits) return []
    return liveData.deposits.filter(d => d.branch_id === inspectBranch.branchId)
  }, [inspectBranch, liveData])

  const handleExportInspectedBranchPdf = async () => {
    if (!inspectBranch) return
    try {
      const numFmt = (val: any) => Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      const columns = [
        'Date',
        'Day',
        'Opening (BDT)',
        'Cash Sales (BDT)',
        'Digital MFS (BDT)',
        'Total Sales (BDT)',
        'Expenses (BDT)',
        'Bank Deposits (BDT)',
        'Closing Cash (BDT)',
        'Discrepancy (BDT)',
        'Status'
      ]

      const rows = inspectedBranchDailyLedger.map(row => {
        const digitalTotal = Number(row.bkash_sales || 0) + Number(row.nagad_sales || 0) + Number(row.rocket_sales || 0) + Number(row.card_sales || 0) + Number(row.bank_transfer_sales || 0)
        const totalSalesDay = Number(row.cash_sales || 0) + digitalTotal
        const diffNum = row.cash_difference !== null && row.cash_difference !== undefined ? Number(row.cash_difference) : null
        const diffStr = diffNum !== null ? `${diffNum >= 0 ? '+' : ''}${numFmt(diffNum)}` : '-'

        return [
          row.ledger_date,
          getDayName(row.ledger_date),
          numFmt(row.opening_cash),
          numFmt(row.cash_sales),
          numFmt(digitalTotal),
          numFmt(totalSalesDay),
          numFmt(row.cash_expenses),
          numFmt(row.bank_deposits_out),
          row.actual_cash !== null && row.actual_cash !== undefined ? numFmt(row.actual_cash) : '-',
          diffStr,
          row.is_closed ? 'Closed' : 'Open'
        ]
      })

      await generatePdf(`${inspectBranch.branchName} - Monthly Financial Statement`, columns, rows, {
        branch: inspectBranch.branchName,
        subtitle: `MONTHLY SALES, BANK DEPOSITS & CASH DRAWER AUDIT (${selectedMonth})`,
        dateRange: selectedMonth,
        preparedBy: userName,
        orientation: 'landscape',
        summaryData: [
          { label: 'Branch Name', value: inspectBranch.branchName },
          { label: 'Reporting Month', value: selectedMonth },
          { label: 'Total Gross Sales Revenue', value: `${inspectBranch.totalSales.toLocaleString('en-BD')} BDT` },
          { label: 'Pure Cash Sales', value: `${inspectBranch.cashSales.toLocaleString('en-BD')} BDT` },
          { label: 'Digital Collections (MFS & Card)', value: `${inspectBranch.digitalSales.toLocaleString('en-BD')} BDT` },
          { label: 'Operating Cash Expenses', value: `${inspectBranch.totalExpenses.toLocaleString('en-BD')} BDT` },
          { label: 'Approved Bank Deposits', value: `${inspectBranch.approvedDeposits.toLocaleString('en-BD')} BDT` },
          { label: 'Net Drawer Cash Retained', value: `${inspectBranch.netCash.toLocaleString('en-BD')} BDT` },
          { label: 'Days Closed / Tracked', value: `${inspectBranch.daysClosed} / ${inspectBranch.daysTracked} Days` }
        ],
        filename: `${inspectBranch.branchName.replace(/\s+/g, '_')}_Financial_Statement_${selectedMonth}.pdf`,
        notes: 'Official Anchor Fashion ERP Financial Statement. Total Sales = Cash + Digital MFS. Bank deposits represent company account transfers deducted from drawer cash.',
        tableTitle: 'Daily Closing Summary'
      })
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || 'Failed to export branch statement' })
    }
  }

  // ─── PDF Export (Live Data) ───────────────────────────────────────────────
  const handleExportPdf = async () => {
    if (activeTab === 'monthly_statements') {
      if (filteredBranchSummaries.length === 0) {
        setFeedback({ type: 'error', message: 'No records to export.' })
        return
      }
      setIsExporting(true)
      setShowExportMenu(false)

      try {
        const columns = ['#', 'Branch Name', 'Month', 'Cash Sales', 'Digital Sales', 'Total Revenue', 'Expenses', 'Bank Deposits', 'Net Cash']
        const rows: (string | number)[][] = filteredBranchSummaries.map((b, idx) => [
          idx + 1,
          b.branchName,
          selectedMonth,
          Number(b.cashSales).toLocaleString('en-BD'),
          Number(b.digitalSales).toLocaleString('en-BD'),
          Number(b.totalSales).toLocaleString('en-BD'),
          Number(b.totalExpenses).toLocaleString('en-BD'),
          Number(b.approvedDeposits).toLocaleString('en-BD'),
          Number(b.netCash).toLocaleString('en-BD'),
        ])

        const filterText = [
          `Period: ${selectedMonth}`,
          filterBranch ? `Branch: ${branches.find(b => b.id === filterBranch)?.name}` : 'All Branches'
        ].join(' | ')

        await generatePdf(
          'Branch Financial Report',
          columns,
          rows,
          {
            filename: `Branch_Financial_Report_${selectedMonth}.pdf`,
            subtitle: `LIVE VERIFIED MONTHLY FINANCIAL REVENUE (${filterText})`,
            preparedBy: userName,
            dateRange: selectedMonth,
            summaryData: [
              { label: 'Branches In Scope', value: computedTotals.branchesCount.toString() },
              { label: 'Gross Sales Revenue', value: `${computedTotals.totalSales.toLocaleString('en-BD')} BDT` },
              { label: 'Operating Expenses', value: `${computedTotals.expenses.toLocaleString('en-BD')} BDT` },
              { label: 'Approved Bank Deposits', value: `${computedTotals.approvedDeposits.toLocaleString('en-BD')} BDT` },
              { label: 'Net Cash Retained', value: `${computedTotals.netCash.toLocaleString('en-BD')} BDT` },
              { label: 'Top Performer', value: topBranch ? `${topBranch.branchName} (${fmt(topBranch.totalSales)})` : 'N/A' },
            ],
            notes: 'Official Anchor Fashion ERP Financial Statement. Aggregated dynamically from verified daily cash ledgers, bank deposit slips, and operating expenses with zero manual entry.'
          }
        )
      } catch (e: any) {
        setFeedback({ type: 'error', message: e.message || 'Failed to export PDF' })
      } finally {
        setIsExporting(false)
      }
    } else {
      if (filteredDeposits.length === 0) {
        setFeedback({ type: 'error', message: 'No bank deposit records to export.' })
        return
      }
      setIsExporting(true)
      setShowExportMenu(false)

      try {
        const columns = ['#', 'Branch', 'Manager', 'Date & Time', 'Sales Period', 'Deposited', 'Khuchra', 'Bank Info', 'Slip/TXN', 'Status']
        const rows: (string | number)[][] = filteredDeposits.map((d, idx) => {
          const time = d.submitted_at || d.created_at
          const timeStr = time ? new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : ''
          const dateTime = `${d.deposit_date}${timeStr ? '\\n' + timeStr : ''}`
          const bankInfo = `${d.bank_account_name || '—'}${d.bank_account_number ? '\\nA/C: ' + d.bank_account_number : ''}`
          const refInfo = (d.deposit_slip_number ? `Slip: ${d.deposit_slip_number}` : '') + (d.deposit_slip_number && d.bank_transaction_id ? '\\n' : '') + (d.bank_transaction_id ? `TXN: ${d.bank_transaction_id}` : '')

          return [
            idx + 1,
            d.branch?.name || d.branch_name || '-',
            d.manager_name || '-',
            dateTime,
            d.sales_from_date && d.sales_to_date ? `${d.sales_from_date} to ${d.sales_to_date}` : '-',
            Number(d.amount).toLocaleString('en-BD'),
            parseKhuchraAmount(d) > 0 ? parseKhuchraAmount(d).toLocaleString('en-BD') : '0',
            bankInfo,
            refInfo,
            d.status.toUpperCase()
          ]
        })

        await generatePdf(
          'Branch Bank Deposits Ledger',
          columns,
          rows,
          {
            filename: `Branch_Bank_Deposits_${new Date().toISOString().slice(0, 10)}.pdf`,
            subtitle: `VERIFIED BRANCH BANK DEPOSIT AND CREDIT STATEMENTS`,
            preparedBy: userName,
            dateRange: 'All Recorded Submissions',
            summaryData: [
              { label: 'Total Submissions', value: filteredDeposits.length.toString() },
              { label: 'Approved Deposits', value: `${totalDepositsApproved.toLocaleString('en-BD')} BDT` },
              { label: 'Pending Deposits', value: `${pendingDepositsTotal.toLocaleString('en-BD')} BDT` },
              { label: 'Total Khuchra Kept', value: `${totalKhuchraFiltered.toLocaleString('en-BD')} BDT` }
            ]
          }
        )
      } catch (e: any) {
        setFeedback({ type: 'error', message: e.message || 'Failed to export deposits PDF' })
      } finally {
        setIsExporting(false)
      }
    }
  }

  // ─── Excel Export (.xlsx) ─────────────────────────────────────────────────
  const handleExportExcel = () => {
    setShowExportMenu(false)
    if (activeTab === 'monthly_statements') {
      if (filteredBranchSummaries.length === 0) {
        setFeedback({ type: 'error', message: 'No records to export.' })
        return
      }
      const columns = ['SL', 'Branch Name', 'Reporting Month', 'Cash Sales (BDT)', 'Digital Sales (BDT)', 'Total Sales (BDT)', 'Expenses (BDT)', 'Approved Deposits (BDT)', 'Net Cash Retained (BDT)', 'Days Closed']
      const rows = filteredBranchSummaries.map((b, idx) => [
        idx + 1,
        b.branchName,
        selectedMonth,
        Number(b.cashSales),
        Number(b.digitalSales),
        Number(b.totalSales),
        Number(b.totalExpenses),
        Number(b.approvedDeposits),
        Number(b.netCash),
        b.daysClosed
      ])
      const totals = [
        'TOTAL', '', '',
        computedTotals.cashSales,
        computedTotals.digitalSales,
        computedTotals.totalSales,
        computedTotals.expenses,
        computedTotals.approvedDeposits,
        computedTotals.netCash,
        ''
      ]

      generateExcel(
        'Branch Financial Statement',
        columns,
        rows,
        {
          filename: `Branch_Financial_Report_${selectedMonth}.xlsx`,
          sheetName: 'Financial Report',
          meta: [
            { key: 'BRANCH SCOPE', value: filterBranch ? (branches.find(b => b.id === filterBranch)?.name || 'Selected') : 'All Branches' },
            { key: 'PERIOD', value: selectedMonth },
            { key: 'TOTAL SALES', value: `${computedTotals.totalSales.toLocaleString('en-BD')} BDT` },
            { key: 'BRANCHES COUNT', value: computedTotals.branchesCount }
          ],
          totals
        }
      )
    } else {
      if (filteredDeposits.length === 0) {
        setFeedback({ type: 'error', message: 'No bank deposit records to export.' })
        return
      }
      const columns = ['SL', 'Branch', 'Manager', 'Deposit Date', 'Time', 'Sales Period', 'Deposited (BDT)', 'Khuchra Kept (BDT)', 'Bank Name', 'Account Number', 'Slip Number', 'TXN ID', 'Status']
      const rows = filteredDeposits.map((d, idx) => {
        const time = d.submitted_at || d.created_at
        const timeStr = time ? new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '-'
        return [
          idx + 1,
          d.branch?.name || d.branch_name || '-',
          d.manager_name || '-',
          d.deposit_date,
          timeStr,
          d.sales_from_date && d.sales_to_date ? `${d.sales_from_date} to ${d.sales_to_date}` : '-',
          Number(d.amount),
          parseKhuchraAmount(d),
          d.bank_account_name || '-',
          d.bank_account_number || '-',
          d.deposit_slip_number || '-',
          d.bank_transaction_id || '-',
          d.status
        ]
      })
      const totalAmount = filteredDeposits.reduce((s, d) => s + Number(d.amount || 0), 0)
      const totalKhuchra = filteredDeposits.reduce((s, d) => s + parseKhuchraAmount(d), 0)
      const totals = ['TOTAL', '', '', '', '', '', totalAmount, totalKhuchra, '', '', '', '', '']

      generateExcel(
        'Branch Bank Deposits Ledger',
        columns,
        rows,
        {
          filename: `Branch_Bank_Deposits_${new Date().toISOString().slice(0, 10)}.xlsx`,
          sheetName: 'Deposits',
          totals
        }
      )
    }
  }

  // ─── CSV Export (.csv) ────────────────────────────────────────────────────
  const handleExportCsv = () => {
    setShowExportMenu(false)
    if (activeTab === 'monthly_statements') {
      if (filteredBranchSummaries.length === 0) {
        setFeedback({ type: 'error', message: 'No records to export.' })
        return
      }
      const headers = ['SL', 'Branch Name', 'Reporting Month', 'Cash Sales', 'Digital Sales', 'Total Sales', 'Expenses', 'Approved Deposits', 'Net Cash Retained', 'Days Closed']
      const csvRows = filteredBranchSummaries.map((b, idx) => [
        idx + 1,
        `"${b.branchName.replace(/"/g, '""')}"`,
        `"${selectedMonth}"`,
        b.cashSales,
        b.digitalSales,
        b.totalSales,
        b.totalExpenses,
        b.approvedDeposits,
        b.netCash,
        b.daysClosed
      ])
      const csvContent = [headers.join(','), ...csvRows.map(row => row.join(','))].join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Branch_Financial_Report_${selectedMonth}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } else {
      if (filteredDeposits.length === 0) {
        setFeedback({ type: 'error', message: 'No bank deposit records to export.' })
        return
      }
      const headers = ['SL', 'Branch', 'Manager', 'Deposit Date', 'Time', 'Sales Period', 'Deposited (BDT)', 'Khuchra Kept (BDT)', 'Bank Name', 'Account Number', 'Slip Number', 'TXN ID', 'Status']
      const csvRows = filteredDeposits.map((d, idx) => {
        const time = d.submitted_at || d.created_at
        const timeStr = time ? new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '-'
        return [
          idx + 1,
          `"${(d.branch?.name || d.branch_name || '').replace(/"/g, '""')}"`,
          `"${(d.manager_name || '').replace(/"/g, '""')}"`,
          `"${d.deposit_date}"`,
          `"${timeStr}"`,
          `"${d.sales_from_date && d.sales_to_date ? `${d.sales_from_date} to ${d.sales_to_date}` : '-'}"`,
          Number(d.amount),
          parseKhuchraAmount(d),
          `"${(d.bank_account_name || '').replace(/"/g, '""')}"`,
          `"${(d.bank_account_number || '').replace(/"/g, '""')}"`,
          `"${(d.deposit_slip_number || '').replace(/"/g, '""')}"`,
          `"${(d.bank_transaction_id || '').replace(/"/g, '""')}"`,
          `"${d.status}"`
        ]
      })
      const csvContent = [headers.join(','), ...csvRows.map(row => row.join(','))].join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Branch_Bank_Deposits_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  // ─── Loading / Guard ──────────────────────────────────────────────────────
  if (accessDenied) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-slate-900">
        You do not have permission to view this page.
      </div>
    )
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
      {/* Ambient background glows */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[400px] bg-[#1ca34c]/4 rounded-full filter blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[350px] bg-indigo-500/3 rounded-full filter blur-[140px]" />
      </div>

      <div className="relative z-10 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-6 border-b border-slate-900/5">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                <PieChart className="w-3.5 h-3.5" /> Financial Intelligence & Revenue Audits
              </span>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider inline-flex items-center gap-1">
                <Zap className="w-3 h-3 text-emerald-600" /> Automated Live Sync
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 font-serif flex items-center gap-3">
              <span className="w-1.5 h-9 rounded-full bg-[#1ca34c] shrink-0" />
              Branch Financial Reports
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Automated financial statements dynamically aggregated from daily cash ledgers, verified expenses, and bank deposits
            </p>
          </div>

          <div className="flex items-center gap-3 self-stretch sm:self-auto">
            {/* Export Dropdown */}
            <div className="relative flex-1 sm:flex-initial">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={isExporting}
                className="w-full sm:w-auto bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#1ca34c]/30 text-slate-600 hover:text-slate-900 px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
              >
                <Download className="w-3.5 h-3.5 text-[#15803d]" />
                <span>{isExporting ? 'Exporting...' : 'Export'}</span>
                <ChevronDown className="w-3 h-3 text-slate-500" />
              </button>

              <AnimatePresence>
                {showExportMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    className="absolute right-0 mt-2 w-48 bg-white border border-slate-900/15 rounded-xl shadow-2xl overflow-hidden z-30"
                  >
                    <button
                      onClick={handleExportPdf}
                      className="w-full px-4 py-2.5 text-left text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.04] flex items-center gap-2.5 transition-colors cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-[#15803d]" /> Export PDF (Official)
                    </button>
                    <button
                      onClick={handleExportExcel}
                      className="w-full px-4 py-2.5 text-left text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.04] flex items-center gap-2.5 transition-colors cursor-pointer border-t border-slate-900/5"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Export Excel (.xlsx)
                    </button>
                    <button
                      onClick={handleExportCsv}
                      className="w-full px-4 py-2.5 text-left text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.04] flex items-center gap-2.5 transition-colors cursor-pointer border-t border-slate-900/5"
                    >
                      <Download className="w-4 h-4 text-blue-600" /> Export CSV (.csv)
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Live Refresh Button */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={`p-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#1ca34c]/30 text-slate-600 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'opacity-50' : ''}`}
              title="Refresh Live Financials"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`} />
            </button>

            {/* Quick Link to Deposit Approvals if on bank deposits tab */}
            {activeTab === 'bank_deposits' && (
              <Link
                href="/admin/branch-accounts/deposit-approvals"
                className="flex-1 sm:flex-initial bg-[#e8f7ee] border border-[#1ca34c]/30 text-[#15803d] hover:bg-[#1ca34c]/15 font-bold px-4 py-2.5 rounded-xl text-xs tracking-wider uppercase flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Clock className="w-4 h-4" /> Review Queue
              </Link>
            )}
          </div>
        </div>

        {/* Pending Deposit Submissions Notice Banner */}
        {pendingDepositsCount > 0 && (
          <div className="mb-6 p-4 rounded-3xl bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-600 shrink-0">
                <Clock className="w-4 h-4 animate-spin text-amber-600" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900 flex items-center gap-2">
                  <span>{pendingDepositsCount} Branch Bank Deposit(s) Awaiting Review</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-700 font-mono font-bold">
                    {fmt(pendingDepositsTotal)}
                  </span>
                </p>
                <p className="text-[11px] text-slate-500">
                  Branch managers have submitted new deposit slips and bank transaction records for credit verification.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-stretch sm:self-auto">
              {activeTab !== 'bank_deposits' && (
                <button
                  onClick={() => setActiveTab('bank_deposits')}
                  className="flex-1 sm:flex-initial px-3.5 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 text-xs font-semibold transition-all cursor-pointer"
                >
                  View Here
                </button>
              )}
              <Link
                href="/admin/branch-accounts/deposit-approvals"
                className="flex-1 sm:flex-initial px-4 py-2 rounded-full bg-[#1ca34c] hover:bg-[#15803d] text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-[#1ca34c]/25 cursor-pointer"
              >
                <span>Approve Deposits</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        )}

        {/* Station Navigation Tab Switcher */}
        <div className="flex items-center gap-2 mb-6 border-b border-slate-900/10 pb-4 overflow-x-auto scrollbar-none flex-nowrap">
          <button
            onClick={() => setActiveTab('monthly_statements')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
              activeTab === 'monthly_statements'
                ? 'bg-[#1ca34c] text-white shadow-lg shadow-[#1ca34c]/20'
                : 'bg-slate-900/[0.04] border border-slate-900/10 text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04]'
            }`}
          >
            <PieChart className="w-4 h-4 shrink-0" />
            <span>Monthly Financial Revenue Statements</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
              activeTab === 'monthly_statements' ? 'bg-white text-black font-mono font-bold' : 'bg-slate-900/[0.07] text-slate-500'
            }`}>
              {filteredBranchSummaries.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('bank_deposits')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer relative shrink-0 whitespace-nowrap ${
              activeTab === 'bank_deposits'
                ? 'bg-[#1ca34c] text-white shadow-lg shadow-[#1ca34c]/20'
                : 'bg-slate-900/[0.04] border border-slate-900/10 text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04]'
            }`}
          >
            <Landmark className="w-4 h-4 shrink-0" />
            <span>Branch Bank Deposits & Slip Ledger</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
              activeTab === 'bank_deposits' ? 'bg-white text-black font-mono font-bold' : 'bg-slate-900/[0.07] text-slate-500'
            }`}>
              {deposits.length}
            </span>
            {pendingDepositsCount > 0 && activeTab !== 'bank_deposits' && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping absolute -top-0.5 -right-0.5" />
            )}
          </button>
        </div>

        {/* Feedback Alert */}
        <AnimatePresence>
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`mb-6 px-4 py-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2.5 ${feedback.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' : 'bg-rose-500/10 border-rose-500/20 text-rose-600'}`}
            >
              {feedback.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              {feedback.message}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* TAB 1: MONTHLY STATEMENTS VIEW (Live Automated Data)                */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {activeTab === 'monthly_statements' && (
          <div>
            {/* 4-Station Summary Cards Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="p-5 rounded-3xl border border-[#1ca34c]/20 bg-[#1ca34c]/5">
                <div className="flex items-center justify-between mb-2">
                  <PieChart className="w-5 h-5 text-[#15803d]" />
                  <span className="text-[9px] font-bold text-[#15803d]/80 uppercase tracking-widest">Revenue</span>
                </div>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Gross Sales Revenue</p>
                <p className="text-xl sm:text-2xl font-bold font-serif text-[#15803d]">{fmt(computedTotals.totalSales)}</p>
                <p className="text-[10px] text-slate-500 mt-1">
                  Cash: <span className="text-slate-900 font-mono">{fmt(computedTotals.cashSales)}</span> | Digital: <span className="text-emerald-600 font-mono">{fmt(computedTotals.digitalSales)}</span>
                </p>
              </div>

              <div className="p-5 rounded-3xl border border-rose-500/20 bg-rose-500/5">
                <div className="flex items-center justify-between mb-2">
                  <Coins className="w-5 h-5 text-rose-600" />
                  <span className="text-[9px] font-bold text-rose-600/80 uppercase tracking-widest">Operating</span>
                </div>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Operating Cash Expenses</p>
                <p className="text-xl sm:text-2xl font-bold font-serif text-rose-600">{fmt(computedTotals.expenses)}</p>
                <p className="text-[10px] text-slate-500 mt-1">
                  Verified receipts & store maintenance
                </p>
              </div>

              <div className="p-5 rounded-3xl border border-blue-500/20 bg-blue-500/5">
                <div className="flex items-center justify-between mb-2">
                  <Landmark className="w-5 h-5 text-blue-600" />
                  <span className="text-[9px] font-bold text-blue-600/80 uppercase tracking-widest">Banking</span>
                </div>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Approved Bank Deposits</p>
                <p className="text-xl sm:text-2xl font-bold font-serif text-blue-600">{fmt(computedTotals.approvedDeposits)}</p>
                <p className="text-[10px] text-slate-500 mt-1">
                  Transferred from drawers to company accounts
                </p>
              </div>

              <div className="p-5 rounded-3xl border border-emerald-500/20 bg-emerald-500/5">
                <div className="flex items-center justify-between mb-2">
                  <Building2 className="w-5 h-5 text-emerald-600" />
                  <span className="text-[9px] font-bold text-emerald-600/80 uppercase tracking-widest">Retained Till</span>
                </div>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Net Drawer Cash Retained</p>
                <p className="text-xl sm:text-2xl font-bold font-serif text-emerald-600">{fmt(computedTotals.netCash)}</p>
                <p className="text-[10px] text-slate-500 mt-1">
                  Active cash float held across {computedTotals.branchesCount} stores
                </p>
              </div>
            </div>

            {/* Filter & Live Period Bar */}
            <div className="mb-6 p-4 rounded-3xl border border-slate-900/10 bg-slate-900/[0.04] flex flex-col md:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search branch name..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl py-2.5 pl-10 pr-3.5 text-xs text-slate-900 placeholder-slate-500 focus:outline-none focus:border-[#1ca34c]/40 w-full transition-colors"
                />
              </div>

              <div className="relative w-full md:w-56">
                <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#15803d] pointer-events-none" />
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  className="bg-white border border-slate-900/15 rounded-xl py-2.5 pl-10 pr-3.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 w-full [color-scheme:light] transition-colors cursor-pointer font-mono font-bold"
                />
              </div>

              <select
                value={filterBranch}
                onChange={e => setFilterBranch(e.target.value)}
                className="bg-white border border-slate-900/15 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 w-full md:w-56 cursor-pointer"
              >
                <option value="">All Branches ({branches.length})</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>

              {(search || filterBranch || selectedMonth !== currentMonthString) && (
                <button
                  onClick={() => { setSearch(''); setFilterBranch(''); setSelectedMonth(currentMonthString) }}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-500 hover:text-slate-900 text-xs font-semibold transition-all cursor-pointer whitespace-nowrap"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Reports Data Table */}
            <div className="rounded-3xl border border-slate-900/10 bg-slate-900/[0.04] overflow-hidden shadow-xl">
              <div className="p-4 sm:p-5 border-b border-slate-900/10 bg-slate-900/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Live Verified Statements ({filteredBranchSummaries.length} Branches)
                  </p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 font-mono">
                    {selectedMonth}
                  </span>
                </div>
                <span className="text-xs font-bold text-[#15803d] font-serif">
                  Total Revenue: {fmt(computedTotals.totalSales)}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-900/10 bg-slate-900/[0.04]">
                      {['#', 'Branch Name', 'Cash Sales', 'Digital Sales', 'Total Revenue', 'Operating Expenses', 'Approved Deposits', 'Net Cash Retained', 'Closings', 'Action'].map((h, i) => (
                        <th
                          key={h}
                          className={`p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap ${
                            i === 0 ? 'text-center w-12' : i >= 2 && i <= 7 ? 'text-right' : i === 8 ? 'text-center' : i === 9 ? 'text-right' : 'text-left'
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/[0.08]">
                    {filteredBranchSummaries.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="text-center py-16 text-slate-500">
                          <FileText className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                          <p>No branch ledger entries found for {selectedMonth}.</p>
                          <p className="text-[11px] text-slate-600 mt-1">
                            Daily cash ledgers submitted by branch managers will automatically appear here.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      filteredBranchSummaries.map((bSummary, idx) => (
                        <tr key={bSummary.branchId} className="hover:bg-slate-900/[0.04] transition-colors">
                          <td className="p-3.5 text-center text-slate-500 font-mono">
                            {idx + 1}
                          </td>
                          <td className="p-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-600">
                                <MapPin className="w-3.5 h-3.5" />
                              </div>
                              <div>
                                <span className="font-semibold text-slate-900">{bSummary.branchName}</span>
                                {bSummary.daysWithShortage > 0 && (
                                  <p className="text-[9px] text-rose-600 font-medium">
                                    ⚠️ {bSummary.daysWithShortage} shortage days recorded
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="p-3.5 whitespace-nowrap text-right font-mono text-slate-600">
                            {fmt(bSummary.cashSales)}
                          </td>
                          <td className="p-3.5 whitespace-nowrap text-right font-mono text-emerald-600">
                            {fmt(bSummary.digitalSales)}
                          </td>
                          <td className="p-3.5 whitespace-nowrap text-right font-serif font-bold text-[#15803d]">
                            {fmt(bSummary.totalSales)}
                          </td>
                          <td className="p-3.5 whitespace-nowrap text-right font-mono text-rose-600">
                            {fmt(bSummary.totalExpenses)}
                          </td>
                          <td className="p-3.5 whitespace-nowrap text-right font-mono text-blue-600">
                            {fmt(bSummary.approvedDeposits)}
                          </td>
                          <td className="p-3.5 whitespace-nowrap text-right font-serif font-bold text-slate-900">
                            {fmt(bSummary.netCash)}
                          </td>
                          <td className="p-3.5 whitespace-nowrap text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                              bSummary.daysClosed > 0 ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {bSummary.daysClosed} closed
                            </span>
                          </td>
                          <td className="p-3.5 whitespace-nowrap text-right">
                            <button
                              onClick={() => setInspectBranch(bSummary)}
                              className="px-2.5 py-1.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#1ca34c]/40 text-slate-600 hover:text-slate-900 text-[11px] font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer"
                              title="Inspect Daily Breakdown"
                            >
                              <Eye className="w-3.5 h-3.5 text-[#15803d]" />
                              <span>Breakdown</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {filteredBranchSummaries.length > 0 && (
                    <tfoot className="border-t-2 border-slate-900/15 bg-slate-900/[0.04]">
                      <tr className="font-bold text-xs">
                        <td colSpan={2} className="p-3.5 text-left uppercase tracking-wider text-slate-600 font-mono">
                          NETWORK TOTALS ({computedTotals.branchesCount} Branches)
                        </td>
                        <td className="p-3.5 text-right font-mono text-slate-700">
                          {fmt(computedTotals.cashSales)}
                        </td>
                        <td className="p-3.5 text-right font-mono text-emerald-600">
                          {fmt(computedTotals.digitalSales)}
                        </td>
                        <td className="p-3.5 text-right font-serif font-bold text-[#15803d]">
                          {fmt(computedTotals.totalSales)}
                        </td>
                        <td className="p-3.5 text-right font-mono text-rose-600">
                          {fmt(computedTotals.expenses)}
                        </td>
                        <td className="p-3.5 text-right font-mono text-blue-600">
                          {fmt(computedTotals.approvedDeposits)}
                        </td>
                        <td className="p-3.5 text-right font-serif font-bold text-slate-900">
                          {fmt(computedTotals.netCash)}
                        </td>
                        <td colSpan={2} className="p-3.5 text-center text-slate-500 text-[10px]">
                          Live Verified Ledgers
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* TAB 2: BRANCH BANK DEPOSITS & SLIP LEDGER VIEW                     */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {activeTab === 'bank_deposits' && (
          <div>
            {/* Deposits Station Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="p-5 rounded-3xl border border-amber-500/20 bg-amber-500/5">
                <div className="flex items-center justify-between mb-2">
                  <Clock className="w-5 h-5 text-amber-600" />
                  <span className="text-[9px] font-bold text-amber-600/80 uppercase tracking-widest">Pending Review</span>
                </div>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Awaiting Verification</p>
                <div className="flex items-baseline justify-between">
                  <p className="text-xl sm:text-2xl font-bold font-serif text-amber-600">{pendingDepositsCount}</p>
                  <p className="text-sm font-bold font-serif text-amber-700">{fmt(pendingDepositsTotal)}</p>
                </div>
              </div>

              <div className="p-5 rounded-3xl border border-emerald-500/20 bg-emerald-500/5">
                <div className="flex items-center justify-between mb-2">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <span className="text-[9px] font-bold text-emerald-600/80 uppercase tracking-widest">Total Approved</span>
                </div>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Deposited to Bank</p>
                <p className="text-xl sm:text-2xl font-bold font-serif text-emerald-600">{fmt(totalDepositsApproved)}</p>
              </div>

              <div className="p-5 rounded-3xl border border-blue-500/20 bg-blue-500/5">
                <div className="flex items-center justify-between mb-2">
                  <Coins className="w-5 h-5 text-blue-600" />
                  <span className="text-[9px] font-bold text-blue-600/80 uppercase tracking-widest">Drawer Float</span>
                </div>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Active Khuchra in Till</p>
                <p className="text-xl sm:text-2xl font-bold font-serif text-blue-600">{fmt(totalKhuchraFiltered)}</p>
              </div>

              <div className="p-5 rounded-3xl border border-slate-900/10 bg-slate-900/[0.04]">
                <div className="flex items-center justify-between mb-2">
                  <Landmark className="w-5 h-5 text-slate-500" />
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Ledger Entries</span>
                </div>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Total Submissions</p>
                <p className="text-xl sm:text-2xl font-bold font-serif text-slate-900">{deposits.length}</p>
              </div>
            </div>

            {/* Deposit Filter Bar */}
            <div className="mb-6 p-4 rounded-3xl border border-slate-900/10 bg-slate-900/[0.04] flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search branch, manager, slip no., bank, or TXN ID..."
                  value={depositSearch}
                  onChange={e => setDepositSearch(e.target.value)}
                  className="bg-slate-900/[0.04] border border-slate-900/10 rounded-xl py-2.5 pl-10 pr-3.5 text-xs text-slate-900 placeholder-slate-500 focus:outline-none focus:border-[#1ca34c]/40 w-full transition-colors"
                />
              </div>

              <select
                value={depositFilterStatus}
                onChange={e => setDepositFilterStatus(e.target.value)}
                className="bg-white border border-slate-900/15 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 md:w-48 cursor-pointer"
              >
                <option value="all">All Statuses ({deposits.length})</option>
                <option value="pending">Pending Approval ({pendingDepositsCount})</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>

              <select
                value={depositFilterBranch}
                onChange={e => setDepositFilterBranch(e.target.value)}
                className="bg-white border border-slate-900/15 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/40 md:w-48 cursor-pointer"
              >
                <option value="">All Branches ({branches.length})</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>

              {(depositSearch || depositFilterStatus !== 'all' || depositFilterBranch) && (
                <button
                  onClick={() => { setDepositSearch(''); setDepositFilterStatus('all'); setDepositFilterBranch('') }}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-500 hover:text-slate-900 text-xs font-semibold transition-all cursor-pointer whitespace-nowrap"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Deposits Table */}
            <div className="rounded-3xl border border-slate-900/10 bg-slate-900/[0.04] overflow-hidden shadow-xl">
              <div className="p-4 sm:p-5 border-b border-slate-900/10 bg-slate-900/[0.04] flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Bank Deposits Ledger ({filteredDeposits.length})
                </p>
                <span className="text-xs font-bold text-emerald-600 font-serif">
                  Total Approved: {fmt(totalDepositsApproved)}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-900/10 bg-slate-900/[0.04]">
                      {['#', 'Branch & Manager', 'Deposit Date', 'Amount', 'Khuchra Kept', 'Bank Account', 'Slip & TXN', 'Status', 'Actions'].map((h, i) => (
                        <th
                          key={h}
                          className={`p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap ${
                            i === 0 ? 'text-center w-12' : i === 3 || i === 4 ? 'text-right' : i === 7 ? 'text-center' : i === 8 ? 'text-right' : 'text-left'
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/[0.08]">
                    {filteredDeposits.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="text-center py-16 text-slate-500">
                          <Landmark className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                          <p>No bank deposit records found matching your filters.</p>
                        </td>
                      </tr>
                    ) : (
                      filteredDeposits.map((dep, idx) => {
                        const khuchraVal = parseKhuchraAmount(dep)
                        const isPending = ['submitted', 'pending_approval'].includes(dep.status)

                        return (
                          <tr key={dep.id} className="hover:bg-slate-900/[0.04] transition-colors">
                            <td className="p-3.5 text-center text-slate-500 font-mono">
                              {idx + 1}
                            </td>
                            <td className="p-3.5 whitespace-nowrap">
                              <div>
                                <span className="font-semibold text-slate-900">{dep.branch?.name || dep.branch_name || 'Branch'}</span>
                                <p className="text-[10px] text-slate-500">By: {dep.manager_name || 'Manager'}</p>
                              </div>
                            </td>
                            <td className="p-3.5 whitespace-nowrap text-slate-600 font-mono">
                              {dep.deposit_date}
                            </td>
                            <td className="p-3.5 whitespace-nowrap text-right font-serif font-bold text-emerald-600">
                              {fmt(dep.amount)}
                            </td>
                            <td className="p-3.5 whitespace-nowrap text-right font-mono text-blue-600">
                              {khuchraVal > 0 ? fmt(khuchraVal) : '৳0'}
                            </td>
                            <td className="p-3.5 whitespace-nowrap text-slate-600">
                              {dep.bank_account_name || '—'}
                            </td>
                            <td className="p-3.5 whitespace-nowrap">
                              <div>
                                <span className="text-slate-900 font-mono text-[11px]">{dep.deposit_slip_number || 'No Slip #'}</span>
                                {dep.bank_transaction_id && (
                                  <p className="text-[9px] text-slate-500 font-mono">TXN: {dep.bank_transaction_id}</p>
                                )}
                              </div>
                            </td>
                            <td className="p-3.5 whitespace-nowrap text-center">
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 ${
                                dep.status === 'approved'
                                  ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                                  : dep.status === 'rejected'
                                  ? 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                                  : 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                              }`}>
                                {dep.status === 'approved' ? <Check className="w-3 h-3" /> : dep.status === 'rejected' ? <X className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                {dep.status}
                              </span>
                            </td>
                            <td className="p-3.5 whitespace-nowrap text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => {
                                    setSelectedDepositModal(dep)
                                    setModalMediaUrl(dep.slip_attachment_url || dep.bank_statement_url)
                                  }}
                                  className="p-1.5 rounded-lg bg-slate-900/[0.04] hover:bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 transition-all cursor-pointer"
                                  title="Inspect Slip & Details"
                                >
                                  <Eye className="w-3.5 h-3.5 text-[#15803d]" />
                                </button>
                                {isPending && (
                                  <>
                                    <button
                                      onClick={() => handleApproveDeposit(dep.id)}
                                      disabled={actionDepositId === dep.id}
                                      className="p-2.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-600 transition-all cursor-pointer disabled:opacity-50"
                                      title="Approve Deposit"
                                    >
                                      {actionDepositId === dep.id ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      ) : (
                                        <CheckCircle className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                    <button
                                      onClick={() => {
                                        setSelectedDepositModal(dep)
                                        setModalMediaUrl(dep.slip_attachment_url || dep.bank_statement_url)
                                      }}
                                      className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 transition-all cursor-pointer"
                                      title="Reject Deposit"
                                    >
                                      <XCircle className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* MODAL: DAILY BREAKDOWN INSPECTION FOR SELECTED BRANCH               */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <AnimatePresence>
          {inspectBranch && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-md">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white border border-slate-900/15 rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl"
              >
                {/* Modal Header */}
                <div className="p-5 border-b border-slate-900/10 flex items-center justify-between shrink-0 bg-white">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-600">
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold font-serif text-lg text-slate-900">
                        {inspectBranch.branchName} — Financial Statement & Audit
                      </h3>
                      <p className="text-xs text-slate-500">
                        Reporting Month: <span className="text-[#15803d] font-mono font-bold">{selectedMonth}</span> | {inspectBranch.daysClosed} Closed Shifts Recorded
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExportInspectedBranchPdf}
                      className="px-3.5 py-1.5 rounded-xl bg-[#1ca34c]/15 border border-[#1ca34c]/30 hover:bg-[#1ca34c]/25 text-[#15803d] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export PDF</span>
                    </button>
                    <button
                      onClick={() => setInspectBranch(null)}
                      className="text-slate-500 hover:text-slate-900 p-2.5 rounded-xl hover:bg-slate-900/[0.04] transition-colors cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Branch KPI Quick Summary */}
                <div className="p-4 bg-slate-900/[0.04] border-b border-slate-900/5 grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
                  <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">Cash Sales</p>
                    <p className="text-sm font-bold font-mono text-slate-900 mt-0.5">{fmt(inspectBranch.cashSales)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">Digital Sales</p>
                    <p className="text-sm font-bold font-mono text-emerald-600 mt-0.5">{fmt(inspectBranch.digitalSales)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">Total Sales (মোট বিক্রি)</p>
                    <p className="text-sm font-bold font-serif text-[#15803d] mt-0.5">{fmt(inspectBranch.totalSales)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">Approved Bank Deposits</p>
                    <p className="text-sm font-bold font-mono text-blue-600 mt-0.5">{fmt(inspectBranch.approvedDeposits)}</p>
                  </div>
                </div>

                {/* Subtab Switcher inside Modal */}
                <div className="flex items-center gap-2 px-5 pt-3 border-b border-slate-900/10 bg-white shrink-0">
                  <button
                    onClick={() => setInspectTab('daily')}
                    className={`px-3.5 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                      inspectTab === 'daily'
                        ? 'border-[#1ca34c] text-[#15803d]'
                        : 'border-transparent text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Daily Cash Ledger ({inspectedBranchDailyLedger.length})</span>
                  </button>

                  <button
                    onClick={() => setInspectTab('deposits')}
                    className={`px-3.5 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                      inspectTab === 'deposits'
                        ? 'border-[#1ca34c] text-[#15803d]'
                        : 'border-transparent text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    <Landmark className="w-3.5 h-3.5" />
                    <span>Bank Deposits ({inspectedBranchDeposits.length})</span>
                  </button>

                  <button
                    onClick={() => setInspectTab('banks')}
                    className={`px-3.5 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                      inspectTab === 'banks'
                        ? 'border-[#1ca34c] text-[#15803d]'
                        : 'border-transparent text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span>Bank Accounts Distribution ({(inspectBranch.bankBreakdown || []).length})</span>
                  </button>
                </div>

                {/* Subtab 1: Daily Cash Ledger */}
                {inspectTab === 'daily' && (
                  <div className="flex-1 overflow-auto p-4 sm:p-5">
                    <table className="w-full text-xs min-w-[720px]">
                      <thead>
                        <tr className="border-b border-slate-900/10 text-slate-500 text-[9px] uppercase tracking-wider">
                          <th className="pb-3 text-left">Date & Day</th>
                          <th className="pb-3 text-right">Opening</th>
                          <th className="pb-3 text-right">Cash Sales</th>
                          <th className="pb-3 text-right">Digital MFS</th>
                          <th className="pb-3 text-right">Total Sales</th>
                          <th className="pb-3 text-right">Expenses</th>
                          <th className="pb-3 text-right">Bank Deposits</th>
                          <th className="pb-3 text-right">Closing Cash</th>
                          <th className="pb-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900/[0.08]">
                        {inspectedBranchDailyLedger.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="py-12 text-center text-slate-500">
                              No daily ledger closings recorded for this branch in {selectedMonth}.
                            </td>
                          </tr>
                        ) : (
                          inspectedBranchDailyLedger.map(row => {
                            const digitalRow = Number(row.bkash_sales || 0) + Number(row.nagad_sales || 0) + Number(row.rocket_sales || 0) + Number(row.card_sales || 0) + Number(row.bank_transfer_sales || 0)
                            const totalSalesRow = Number(row.cash_sales || 0) + digitalRow

                            return (
                              <tr key={row.ledger_date} className="hover:bg-slate-900/[0.04] transition-colors">
                                <td className="py-2.5 font-mono text-slate-600">
                                  <div className="flex items-center gap-1.5">
                                    <span>{row.ledger_date}</span>
                                    <span className="text-[9px] text-slate-500">({getDayName(row.ledger_date)})</span>
                                  </div>
                                </td>
                                <td className="py-2.5 text-right font-mono text-slate-500">
                                  {fmt(row.opening_cash)}
                                </td>
                                <td className="py-2.5 text-right font-mono text-slate-700">
                                  {fmt(row.cash_sales)}
                                </td>
                                <td className="py-2.5 text-right font-mono text-emerald-600" title={`bKash: ${fmt(row.bkash_sales)}, Nagad: ${fmt(row.nagad_sales)}, Rocket: ${fmt(row.rocket_sales)}, Card: ${fmt(row.card_sales)}`}>
                                  {fmt(digitalRow)}
                                </td>
                                <td className="py-2.5 text-right font-serif font-bold text-[#15803d]">
                                  {fmt(totalSalesRow)}
                                </td>
                                <td className="py-2.5 text-right font-mono text-rose-600">
                                  {fmt(row.cash_expenses)}
                                </td>
                                <td className="py-2.5 text-right font-mono text-blue-600">
                                  {Number(row.bank_deposits_out || 0) > 0 ? fmt(row.bank_deposits_out) : '—'}
                                </td>
                                <td className="py-2.5 text-right font-serif font-bold text-slate-900">
                                  {row.actual_cash !== null && row.actual_cash !== undefined ? fmt(row.actual_cash) : '—'}
                                </td>
                                <td className="py-2.5 text-center">
                                  {row.difference_status === 'shortage' ? (
                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-500/10 text-rose-600 border border-rose-500/20">
                                      Shortage {fmt(Math.abs(row.cash_difference))}
                                    </span>
                                  ) : row.difference_status === 'excess' ? (
                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                                      Excess {fmt(row.cash_difference)}
                                    </span>
                                  ) : row.is_closed ? (
                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                      Balanced (৳0)
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[9px] text-slate-500 bg-slate-100">
                                      Open
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Subtab 2: Bank Deposits List */}
                {inspectTab === 'deposits' && (
                  <div className="flex-1 overflow-auto p-4 sm:p-5">
                    <table className="w-full text-xs min-w-[580px]">
                      <thead>
                        <tr className="border-b border-slate-900/10 text-slate-500 text-[9px] uppercase tracking-wider">
                          <th className="pb-3 text-left">Deposit Date</th>
                          <th className="pb-3 text-left">Sales Period</th>
                          <th className="pb-3 text-right">Amount</th>
                          <th className="pb-3 text-left">Bank Account</th>
                          <th className="pb-3 text-left">Slip / TXN</th>
                          <th className="pb-3 text-center">Status</th>
                          <th className="pb-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900/[0.08]">
                        {inspectedBranchDeposits.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-12 text-center text-slate-500">
                              No bank deposits submitted for this branch in {selectedMonth}.
                            </td>
                          </tr>
                        ) : (
                          inspectedBranchDeposits.map(dep => (
                            <tr key={dep.id} className="hover:bg-slate-900/[0.04] transition-colors">
                              <td className="py-2.5 font-mono text-slate-600">
                                {dep.deposit_date}
                              </td>
                              <td className="py-2.5 font-mono text-[11px] text-slate-500">
                                {dep.sales_from_date && dep.sales_to_date ? `${dep.sales_from_date} to ${dep.sales_to_date}` : 'Single Day'}
                              </td>
                              <td className="py-2.5 text-right font-serif font-bold text-emerald-600">
                                {fmt(dep.amount)}
                              </td>
                              <td className="py-2.5 text-slate-600 truncate max-w-[200px]">
                                {dep.bank_account_name || '—'}
                              </td>
                              <td className="py-2.5 font-mono text-[11px] text-slate-600">
                                <div>
                                  <span>{dep.deposit_slip_number || 'No Slip #'}</span>
                                  {dep.bank_transaction_id && (
                                    <p className="text-[9px] text-slate-500">TXN: {dep.bank_transaction_id}</p>
                                  )}
                                </div>
                              </td>
                              <td className="py-2.5 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                                  dep.status === 'approved'
                                    ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                                    : dep.status === 'rejected'
                                    ? 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                                    : 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                                }`}>
                                  {dep.status}
                                </span>
                              </td>
                              <td className="py-2.5 text-right">
                                <button
                                  onClick={() => {
                                    setSelectedDepositModal(dep)
                                    setModalMediaUrl(dep.slip_attachment_url || dep.bank_statement_url)
                                  }}
                                  className="p-1.5 rounded-lg bg-slate-900/[0.04] hover:bg-slate-900/[0.04] border border-slate-900/10 text-slate-600 hover:text-slate-900 transition-all cursor-pointer"
                                  title="Inspect Deposit Slip"
                                >
                                  <Eye className="w-3.5 h-3.5 text-[#15803d]" />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Subtab 3: Bank Breakdown */}
                {inspectTab === 'banks' && (
                  <div className="flex-1 overflow-y-auto p-4 sm:p-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {(!inspectBranch.bankBreakdown || inspectBranch.bankBreakdown.length === 0) ? (
                        <div className="col-span-2 py-12 text-center text-slate-500">
                          No approved bank deposits recorded for this branch in {selectedMonth}.
                        </div>
                      ) : (
                        inspectBranch.bankBreakdown.map((item, i) => (
                          <div key={i} className="p-4 rounded-3xl border border-slate-900/10 bg-slate-900/[0.04] flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600">
                                <Landmark className="w-5 h-5" />
                              </div>
                              <div>
                                <h4 className="font-semibold text-slate-900 text-xs">{item.bankName}</h4>
                                <p className="text-[10px] text-slate-500">{item.depositCount} Approved Deposit(s)</p>
                              </div>
                            </div>
                            <span className="font-serif font-bold text-base text-blue-600">
                              {fmt(item.totalAmount)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Modal Footer */}
                <div className="p-4 border-t border-slate-900/10 bg-white flex justify-between items-center shrink-0">
                  <span className="text-[11px] text-slate-500">
                    Net Drawer Cash Retained: <span className="text-slate-900 font-serif font-bold">{fmt(inspectBranch.netCash)}</span>
                  </span>
                  <button
                    onClick={() => setInspectBranch(null)}
                    className="px-5 py-2 rounded-xl bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-600 hover:text-slate-900 text-xs font-semibold transition-all cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Deposit Lightbox / Slip Inspection Modal */}
        <DepositSlipModal
          isOpen={!!selectedDepositModal}
          onClose={() => setSelectedDepositModal(null)}
          deposit={selectedDepositModal}
          activeUrl={modalMediaUrl}
          title="Branch Bank Deposit Slip"
          onApprove={handleApproveDeposit}
          onReject={handleRejectDeposit}
          isProcessingAction={!!actionDepositId}
        />
      </div>
    </div>
  )
}
