'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2, RefreshCw, TrendingUp, Wallet,
  AlertTriangle, CheckCircle, Clock, ChevronRight, ArrowRight,
  FileText, Plus, Download, Edit2, Trash2, Calendar, Filter,
  Smartphone, Banknote, ShieldAlert, X, BarChart3, PieChart, Coins,
  FileSpreadsheet, ChevronDown
} from 'lucide-react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { generatePdf } from '@/lib/pdf-generator'
import { generateExcel } from '@/lib/excel-generator'
import { useBranchAuth } from '@/lib/hooks/use-branch-auth'
import { fetchWithCache, invalidateBranchCache, getCachedData, setCachedData } from '@/lib/branch-cache'

const fmt = (n: number | null | undefined) => {
  const num = Number(n ?? 0)
  const abs = Math.abs(num)
  const formatted = abs.toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return num < 0 ? '-৳' + formatted : '৳' + formatted
}

const getDayName = (dateStr: string) => {
  if (!dateStr) return ''
  try {
    const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr
    const d = new Date(cleanDate + 'T00:00:00')
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('en-BD', { weekday: 'long' })
  } catch {
    return ''
  }
}

const formatDatePretty = (dateStr: string) => {
  if (!dateStr) return ''
  try {
    const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr
    const d = new Date(cleanDate + 'T00:00:00')
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return dateStr
  }
}

export default function AdminBranchAccountsPage() {
  const router = useRouter()
  const { user, isAdmin, isAuthorized, isLoading: isAuthLoading } = useBranchAuth()
  
  // Data states
  const [branches, setBranches] = useState<any[]>(() => {
    const cached = getCachedData('admin_branches')
    return Array.isArray(cached) ? cached : []
  })
  const [ledgerEntries, setLedgerEntries] = useState<any[]>(() => {
    const cached = getCachedData('admin_branch_ledgers_default')
    return Array.isArray(cached?.ledger) ? cached.ledger : (Array.isArray(cached) ? cached : [])
  })
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState<number>(() => {
    const cached = getCachedData('admin_pending_dep_count')
    return typeof cached === 'number' ? cached : 0
  })
  const [pendingBundleRequestsCount, setPendingBundleRequestsCount] = useState<number>(() => {
    const cached = getCachedData('admin_pending_bundle_count')
    return typeof cached === 'number' ? cached : 0
  })
  
  // Filters
  const [selectedBranch, setSelectedBranch] = useState<string>('all')
  const [datePreset, setDatePreset] = useState<'today' | '7days' | 'month' | '30days' | 'all' | 'custom'>('30days')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')

  // UI & Loading states
  const [isLoading, setIsLoading] = useState(() => !getCachedData('admin_branch_ledgers_default'))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<any>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form states for Add/Edit
  const [formBranchId, setFormBranchId] = useState('')
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0])
  const [formOpeningCash, setFormOpeningCash] = useState('')
  const [formCashSales, setFormCashSales] = useState('')
  const [formBkashSales, setFormBkashSales] = useState('')
  const [formNagadSales, setFormNagadSales] = useState('')
  const [formRocketSales, setFormRocketSales] = useState('')
  const [formCardSales, setFormCardSales] = useState('')
  const [formBankTransferSales, setFormBankTransferSales] = useState('')
  const [formOtherCashIn, setFormOtherCashIn] = useState('')
  const [formActualCash, setFormActualCash] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formIsClosed, setFormIsClosed] = useState(true)

  // Set date ranges according to presets
  useEffect(() => {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]

    if (datePreset === 'today') {
      setFromDate(todayStr)
      setToDate(todayStr)
    } else if (datePreset === '7days') {
      const past = new Date()
      past.setDate(today.getDate() - 7)
      setFromDate(past.toISOString().split('T')[0])
      setToDate(todayStr)
    } else if (datePreset === 'month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
      setFromDate(firstDay.toISOString().split('T')[0])
      setToDate(todayStr)
    } else if (datePreset === '30days') {
      const past = new Date()
      past.setDate(today.getDate() - 30)
      setFromDate(past.toISOString().split('T')[0])
      setToDate(todayStr)
    } else if (datePreset === 'all') {
      setFromDate('')
      setToDate('')
    }
  }, [datePreset])

  useEffect(() => {
    if (!isAuthLoading && !isAdmin) {
      router.replace('/dashboard')
    }
  }, [isAuthLoading, isAdmin, router])

  const fetchBranches = useCallback(async () => {
    try {
      const cached = getCachedData('admin_branches')
      if (cached) setBranches(cached)
      const res = await fetch('/api/branch-accounts/branches')
      const json = res.ok ? await res.json() : null
      const data = json?.branches
      if (data) {
        setBranches(data)
        setCachedData('admin_branches', data, 120000)
      }
    } catch {}
  }, [])

  const fetchPendingApprovals = useCallback(async () => {
    try {
      const [depJson, bundleJson] = await Promise.all([
        fetchWithCache('admin_pending_dep', '/api/branch-accounts/deposits?status=submitted', 45000),
        fetchWithCache('admin_pending_bundle', '/api/branch-accounts/bundle-requests?status=pending', 45000),
      ])
      if (Array.isArray(depJson?.deposits)) {
        setPendingApprovalsCount(depJson.deposits.length)
        setCachedData('admin_pending_dep_count', depJson.deposits.length, 45000)
      }
      if (Array.isArray(bundleJson?.requests)) {
        setPendingBundleRequestsCount(bundleJson.requests.length)
        setCachedData('admin_pending_bundle_count', bundleJson.requests.length, 45000)
      }
    } catch {
      // ignore
    }
  }, [])

  const fetchLedgers = useCallback(async () => {
    try {
      let url = '/api/branch-accounts/cash-ledger?'
      const params = new URLSearchParams()
      if (selectedBranch && selectedBranch !== 'all') {
        params.append('branch_id', selectedBranch)
      }
      if (fromDate && toDate) {
        params.append('from', fromDate)
        params.append('to', toDate)
      } else {
        // B44: "All time" used to fetch limit=120 and present the
        // partial sums as headline totals. Send an explicit wide
        // range instead — the API returns complete ranges (paginated
        // server-side), so the totals below cover everything.
        params.append('from', '2000-01-01')
        params.append('to', new Date().toISOString().split('T')[0])
      }

      const queryString = params.toString()
      const isDefaultQuery = (!selectedBranch || selectedBranch === 'all') && (!fromDate || !toDate)
      const cacheKey = isDefaultQuery ? 'admin_branch_ledgers_default' : `admin_branch_ledgers_${queryString}`

      const json = await fetchWithCache(
        cacheKey,
        `${url}${queryString}`,
        {
          ttlMs: 45000,
          onBackgroundUpdate: (fresh) => {
            if (Array.isArray(fresh?.ledger)) {
              setLedgerEntries(fresh.ledger)
            } else if (Array.isArray(fresh)) {
              setLedgerEntries(fresh)
            }
          }
        }
      )
      if (Array.isArray(json?.ledger)) {
        setLedgerEntries(json.ledger)
        setError(null)
      } else if (Array.isArray(json)) {
        setLedgerEntries(json)
        setError(null)
      }
    } catch (e: any) {
      setError(e.message)
    }
  }, [selectedBranch, fromDate, toDate])

  useEffect(() => {
    if (!isAdmin) return
    const isDefaultQuery = (!selectedBranch || selectedBranch === 'all') && (!fromDate || !toDate)
    const cacheKey = isDefaultQuery ? 'admin_branch_ledgers_default' : `admin_branch_ledgers_${selectedBranch}_${fromDate}_${toDate}`
    const cached = getCachedData(cacheKey)
    if (Array.isArray(cached?.ledger)) {
      setLedgerEntries(cached.ledger)
      setIsLoading(false)
    } else if (Array.isArray(cached)) {
      setLedgerEntries(cached)
      setIsLoading(false)
    }
    Promise.all([fetchBranches(), fetchPendingApprovals(), fetchLedgers()]).finally(() => {
      setIsLoading(false)
    })
  }, [isAdmin, selectedBranch, fromDate, toDate, fetchBranches, fetchPendingApprovals, fetchLedgers])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    const isDefaultQuery = (!selectedBranch || selectedBranch === 'all') && (!fromDate || !toDate)
    const cacheKey = isDefaultQuery ? 'admin_branch_ledgers_default' : `admin_branch_ledgers_${selectedBranch}_${fromDate}_${toDate}`
    invalidateBranchCache(cacheKey)
    invalidateBranchCache('admin_pending_dep')
    invalidateBranchCache('admin_pending_bundle')
    await Promise.all([fetchBranches(), fetchPendingApprovals(), fetchLedgers()])
    setIsRefreshing(false)
  }

  // Calculated Metrics
  const metrics = useMemo(() => {
    const entries = Array.isArray(ledgerEntries) ? ledgerEntries : []
    let totalCashSales = 0
    let totalDigitalCollections = 0
    let totalBankDeposits = 0
    let shortageCount = 0
    let totalShortageAmount = 0
    let closedDaysCount = 0
    const latestClosingPerBranch: Record<string, number> = {}
    const latestClosingDatePerBranch: Record<string, string> = {}

    entries.forEach(item => {
      totalCashSales += Number(item.cash_sales || 0)
      const dig = Number(item.bkash_sales || 0) + Number(item.nagad_sales || 0) + Number(item.rocket_sales || 0) + Number(item.card_sales || 0) + Number(item.bank_transfer_sales || 0)
      totalDigitalCollections += dig
      totalBankDeposits += Number(item.bank_deposits_out || 0)

      if (item.is_closed && item.actual_cash !== null && item.actual_cash !== undefined) {
        closedDaysCount++
        const branchKey = item.branch_id || item.branch?.name || 'unknown'
        // B45: "latest" must be chosen by ledger_date. The old code
        // kept the FIRST closed row seen, but range queries return
        // ASCENDING dates — so it kept the OLDEST closed day and
        // called it the latest closing.
        const itemDate = String(item.ledger_date || '')
        if (latestClosingDatePerBranch[branchKey] === undefined || itemDate > latestClosingDatePerBranch[branchKey]) {
          latestClosingDatePerBranch[branchKey] = itemDate
          latestClosingPerBranch[branchKey] = Number(item.actual_cash)
        }

        if (item.difference_status === 'shortage' && item.cash_difference) {
          shortageCount++
          totalShortageAmount += Math.abs(Number(item.cash_difference))
        }
      }
    })

    const totalClosingCash = Object.values(latestClosingPerBranch).reduce((s, v) => s + v, 0)
    const totalGrossSales = totalCashSales + totalDigitalCollections

    return {
      totalCashSales,
      totalDigitalCollections,
      totalGrossSales,
      totalBankDeposits,
      totalClosingCash,
      shortageCount,
      totalShortageAmount,
      closedDaysCount
    }
  }, [ledgerEntries])



  // Open Add Modal
  const handleOpenAddModal = () => {
    setFormBranchId(selectedBranch !== 'all' ? selectedBranch : (branches[0]?.id || ''))
    setFormDate(new Date().toISOString().split('T')[0])
    setFormOpeningCash('')
    setFormCashSales('')
    setFormBkashSales('')
    setFormNagadSales('')
    setFormRocketSales('')
    setFormCardSales('')
    setFormBankTransferSales('')
    setFormOtherCashIn('')
    setFormActualCash('')
    setFormNotes('')
    setFormIsClosed(true)
    setIsAddModalOpen(true)
  }

  // Open Edit Modal
  const handleOpenEditModal = (item: any) => {
    setEditingItem(item)
    setFormBranchId(item.branch_id || '')
    setFormDate(item.ledger_date || '')
    setFormOpeningCash(item.khuchra_amount !== undefined && item.khuchra_amount !== null ? String(item.khuchra_amount) : (item.khuchra_amount !== undefined && item.khuchra_amount !== null ? String(item.khuchra_amount) : ''))
    setFormCashSales(item.cash_sales !== undefined && item.cash_sales !== null ? String(item.cash_sales) : '')
    setFormBkashSales(item.bkash_sales !== undefined && item.bkash_sales !== null ? String(item.bkash_sales) : '')
    setFormNagadSales(item.nagad_sales !== undefined && item.nagad_sales !== null ? String(item.nagad_sales) : '')
    setRocketSalesValue(item.rocket_sales)
    setFormCardSales(item.card_sales !== undefined && item.card_sales !== null ? String(item.card_sales) : '')
    setFormBankTransferSales(item.bank_transfer_sales !== undefined && item.bank_transfer_sales !== null ? String(item.bank_transfer_sales) : '')
    setFormOtherCashIn(item.other_cash_in !== undefined && item.other_cash_in !== null ? String(item.other_cash_in) : '')
    setFormActualCash(item.actual_cash !== undefined && item.actual_cash !== null ? String(item.actual_cash) : '')
    setFormNotes(item.difference_notes || '')
    setFormIsClosed(!!item.is_closed)
    setIsEditModalOpen(true)
  }

  const setRocketSalesValue = (val: any) => {
    setFormRocketSales(val !== undefined && val !== null ? String(val) : '')
  }

  // Handle Create Closing (POST)
  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formBranchId) {
      setError('Please select a branch')
      return
    }

    // Prevent duplicate entry for branch and date
    const safeList = Array.isArray(ledgerEntries) ? ledgerEntries : []
    const duplicate = safeList.find(entry => entry.branch_id === formBranchId && entry.ledger_date === formDate)
    if (duplicate) {
      setError(`A daily closing record for this branch already exists on ${formDate}. Please edit the existing entry instead of creating a duplicate.`)
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/branch-accounts/cash-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: formBranchId,
          ledger_date: formDate,
          khuchra_amount: formOpeningCash !== '' ? Number(formOpeningCash) : 0,
          cash_sales: formCashSales !== '' ? Number(formCashSales) : 0,
          bkash_sales: formBkashSales !== '' ? Number(formBkashSales) : 0,
          nagad_sales: formNagadSales !== '' ? Number(formNagadSales) : 0,
          rocket_sales: formRocketSales !== '' ? Number(formRocketSales) : 0,
          card_sales: formCardSales !== '' ? Number(formCardSales) : 0,
          bank_transfer_sales: formBankTransferSales !== '' ? Number(formBankTransferSales) : 0,
          other_cash_in: formOtherCashIn !== '' ? Number(formOtherCashIn) : 0,
          actual_cash: formActualCash !== '' ? Number(formActualCash) : undefined,
          difference_notes: formNotes || null,
          is_closed: formIsClosed,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      invalidateBranchCache('admin_')
      invalidateBranchCache('branch_')
      setSuccess('Daily closing record created successfully!')
      setIsAddModalOpen(false)
      await fetchLedgers()
      setTimeout(() => setSuccess(null), 4000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle Edit Closing (PATCH action: 'admin_edit')
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingItem) return
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/branch-accounts/cash-ledger', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'admin_edit',
          id: editingItem.id,
          branch_id: formBranchId,
          ledger_date: formDate,
          khuchra_amount: formOpeningCash !== '' ? Number(formOpeningCash) : 0,
          cash_sales: formCashSales !== '' ? Number(formCashSales) : 0,
          bkash_sales: formBkashSales !== '' ? Number(formBkashSales) : 0,
          nagad_sales: formNagadSales !== '' ? Number(formNagadSales) : 0,
          rocket_sales: formRocketSales !== '' ? Number(formRocketSales) : 0,
          card_sales: formCardSales !== '' ? Number(formCardSales) : 0,
          bank_transfer_sales: formBankTransferSales !== '' ? Number(formBankTransferSales) : 0,
          other_cash_in: formOtherCashIn !== '' ? Number(formOtherCashIn) : 0,
          actual_cash: formActualCash !== '' ? Number(formActualCash) : undefined,
          difference_notes: formNotes || null,
          is_closed: formIsClosed,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      invalidateBranchCache('admin_')
      invalidateBranchCache('branch_')
      setSuccess('Daily closing record updated successfully!')
      setIsEditModalOpen(false)
      setEditingItem(null)
      await fetchLedgers()
      setTimeout(() => setSuccess(null), 4000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle Delete (DELETE)
  const handleDeleteItem = async (item: any) => {
    const branchName = item.branch?.name || 'Branch'
    if (!confirm(`Are you sure you want to permanently delete the cash ledger entry for ${branchName} on ${item.ledger_date}?`)) {
      return
    }
    try {
      const res = await fetch(`/api/branch-accounts/cash-ledger?id=${item.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      invalidateBranchCache('admin_')
      invalidateBranchCache('branch_')
      setSuccess(`Deleted cash ledger entry for ${item.ledger_date}`)
      await fetchLedgers()
      setTimeout(() => setSuccess(null), 4000)
    } catch (e: any) {
      setError(e.message)
    }
  }

  // Export PDF Statement (Clean BDT, Landscape layout, Zero character overflow)
  const handleExportPdf = async () => {
    const list = Array.isArray(ledgerEntries) ? ledgerEntries : []
    if (list.length === 0) {
      setError('No ledger entries found to export.')
      return
    }
    setIsExportingPdf(true)
    try {
      const activeBranchName = selectedBranch === 'all'
        ? 'All Branches'
        : branches.find(b => b.id === selectedBranch)?.name || 'Selected Branch'

      const dateLabel = fromDate && toDate
        ? `${fromDate} to ${toDate}`
        : `Recent ${list.length} Records`

      const numFmt = (val: any) => Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

      const columns = [
        'Branch',
        'Date',
        'Day',
        'Khuchra (BDT)',
        'Cash Sales (BDT)',
        'Digital MFS (BDT)',
        'Total Sales (BDT)',
        'Bank Deposits (BDT)',
        'Closing Cash (BDT)',
        'Difference (BDT)',
        'Status'
      ]
      
      const rows = list.map(item => {
        const digitalTotal = Number(item.bkash_sales || 0) + Number(item.nagad_sales || 0) + Number(item.rocket_sales || 0) + Number(item.card_sales || 0) + Number(item.bank_transfer_sales || 0)
        const totalSalesDay = Number(item.cash_sales || 0) + digitalTotal
        const diffNum = item.cash_difference !== null && item.cash_difference !== undefined
          ? Number(item.cash_difference)
          : null
        const diffStr = diffNum !== null
          ? `${diffNum >= 0 ? '+' : ''}${numFmt(diffNum)}`
          : '-'

        return [
          item.branch?.name || '-',
          item.ledger_date,
          getDayName(item.ledger_date),
          numFmt(item.khuchra_amount ?? item.khuchra_amount),
          numFmt(item.cash_sales),
          numFmt(digitalTotal),
          numFmt(totalSalesDay),
          numFmt(item.cash_expenses || 0),
          numFmt(item.bank_deposits_out),
          item.actual_cash !== null && item.actual_cash !== undefined ? numFmt(item.actual_cash) : '-',
          diffStr,
          item.is_closed ? 'Closed' : 'Open'
        ]
      })

      await generatePdf('Branch Cash Closing Statement', columns, rows, {
        branch: activeBranchName,
        subtitle: 'EXECUTIVE SALES REVENUE, BANK DEPOSIT & CASH AUDIT',
        dateRange: dateLabel,
        preparedBy: 'Operations & Finance Administrator',
        orientation: 'landscape',
        summaryData: [
          { label: 'Total Branches In Scope', value: selectedBranch === 'all' ? `${branches.length} Branches` : '1 Branch' },
          { label: 'Total Recorded Closings', value: `${metrics.closedDaysCount} Entries` },
          { label: 'Total Gross Sales Revenue', value: `${metrics.totalGrossSales.toLocaleString()} BDT` },
          { label: 'Total Pure Cash Sales', value: `${metrics.totalCashSales.toLocaleString()} BDT` },
          { label: 'Total Digital Collections (MFS & Card)', value: `${metrics.totalDigitalCollections.toLocaleString()} BDT` },
          { label: 'Total Bank Deposits Handled', value: `${metrics.totalBankDeposits.toLocaleString()} BDT` },
          { label: 'Total Counted Drawer Cash', value: `${metrics.totalClosingCash.toLocaleString()} BDT` },
          { label: 'Drawer Shortages Encountered', value: `${metrics.shortageCount} days (-${metrics.totalShortageAmount.toLocaleString()} BDT)` },
        ],
        filename: `Branch_Daily_Closing_Statement_${activeBranchName.replace(/\s+/g, '_')}.pdf`,
        notes: 'Official Anchor Fashion ERP Audit. Total Sales Revenue = Pure Cash Sales + Digital Collections. Bank deposits represent company account transfers deducted from drawer cash.'
      })
    } catch (e: any) {
      setError(e.message || 'Failed to export statement')
    } finally {
      setIsExportingPdf(false)
      setShowExportMenu(false)
    }
  }

  // Export Excel (.xlsx)
  const handleExportExcel = () => {
    const list = Array.isArray(ledgerEntries) ? ledgerEntries : []
    if (list.length === 0) {
      setError('No ledger entries found to export.')
      return
    }
    setShowExportMenu(false)
    const activeBranchName = selectedBranch === 'all'
      ? 'All Branches'
      : branches.find(b => b.id === selectedBranch)?.name || 'Selected Branch'

    const columns = [
      'Branch',
      'Date',
      'Day',
      'Khuchra (BDT)',
      'Cash Sales (BDT)',
      'Digital Collections (BDT)',
      'Total Sales (BDT)',
      'Cash Expenses (BDT)',
      'Bank Deposits (BDT)',
      'Closing Cash (BDT)',
      'Variance (BDT)',
      'Status',
    ]

    const rows = list.map(item => {
      const digitalTotal = Number(item.bkash_sales || 0) + Number(item.nagad_sales || 0) + Number(item.rocket_sales || 0) + Number(item.card_sales || 0) + Number(item.bank_transfer_sales || 0)
      const totalSales = Number(item.cash_sales || 0) + digitalTotal
      return [
        item.branch?.name || '-',
        item.ledger_date,
        getDayName(item.ledger_date),
        Number(item.khuchra_amount ?? item.khuchra_amount ?? 0),
        Number(item.cash_sales || 0),
        digitalTotal,
        totalSales,
        Number(item.cash_expenses || 0),
        Number(item.bank_deposits_out || 0),
        item.actual_cash !== null && item.actual_cash !== undefined ? Number(item.actual_cash) : '-',
        Number(item.cash_difference || 0),
        item.is_closed ? 'Closed' : 'Open',
      ]
    })

    generateExcel('Daily Cash Closing Ledger', columns, rows, {
      filename: `Branch_Cash_Ledger_${activeBranchName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: 'Cash Closings',
    })
  }

  // Export CSV (.csv)
  const handleExportCsv = () => {
    const list = Array.isArray(ledgerEntries) ? ledgerEntries : []
    if (list.length === 0) {
      setError('No ledger entries found to export.')
      return
    }
    setShowExportMenu(false)
    const headers = ['Branch', 'Date', 'Day', 'Khuchra', 'Cash Sales', 'Digital Collections', 'Total Sales', 'Cash Expenses', 'Bank Deposits', 'Closing Cash', 'Discrepancy', 'Status']
    const csvRows = list.map(item => {
      const digitalTotal = Number(item.bkash_sales || 0) + Number(item.nagad_sales || 0) + Number(item.rocket_sales || 0) + Number(item.card_sales || 0) + Number(item.bank_transfer_sales || 0)
      const totalSales = Number(item.cash_sales || 0) + digitalTotal
      return [
        `"${(item.branch?.name || '').replace(/"/g, '""')}"`,
        `"${item.ledger_date}"`,
        `"${getDayName(item.ledger_date)}"`,
        Number(item.khuchra_amount ?? item.khuchra_amount ?? 0),
        Number(item.cash_sales || 0),
        digitalTotal,
        totalSales,
        Number(item.cash_expenses || 0),
        Number(item.bank_deposits_out || 0),
        item.actual_cash !== null && item.actual_cash !== undefined ? Number(item.actual_cash) : '',
        item.cash_difference !== null && item.cash_difference !== undefined ? Number(item.cash_difference) : '',
        item.is_closed ? 'Closed' : 'Open',
      ]
    })
    const csvContent = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Branch_Cash_Closing_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Live Modal Net Cash Calculation
  const modalOpeningNum = Number(formOpeningCash || 0)
  const modalActualNum = Number(formActualCash || 0)
  const modalNetDrawer = formActualCash !== '' ? modalActualNum - modalOpeningNum : null
  const modalTotalDigital = (
    Number(formBkashSales || 0) +
    Number(formNagadSales || 0) +
    Number(formRocketSales || 0) +
    Number(formCardSales || 0) +
    Number(formBankTransferSales || 0)
  )

  const safeLedgerEntries = Array.isArray(ledgerEntries) ? ledgerEntries : []

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
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[400px] bg-[#1ca34c]/4 rounded-full filter blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-[450px] h-[350px] bg-blue-500/3 rounded-full filter blur-[140px]" />
      </div>

      <div className="relative z-10 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Building2 className="w-5 h-5 text-[#15803d]" />
              <span className="text-[10px] uppercase tracking-[0.25em] text-[#15803d]/80 font-semibold">
                Branch Accounts & Executive Audit
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold font-serif text-slate-900 flex items-center gap-3"><span className="w-1.5 h-9 rounded-full bg-[#1ca34c] shrink-0" />Daily Cash Closings & Digital Ledgers</h1>
            <p className="text-xs text-slate-500 mt-1">
              Real-time branch closing history, physical drawer cash reconciliation, and digital collections
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={handleOpenAddModal}
              className="px-4 py-2.5 rounded-full bg-[#1ca34c] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-lg shadow-[#1ca34c]/10 hover:opacity-90 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Add Daily Closing
            </button>
            <button
              onClick={handleRefresh}
              className={`p-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}
              title="Refresh Data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Feedback alerts */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" /> {success}
          </div>
        )}

        {/* TOP FILTER BAR */}
        <div className="mb-8 p-4 rounded-3xl border border-slate-900/10 bg-slate-900/[0.04] space-y-4">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
            {/* Branch Selector */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-[#15803d]" /> Branch:
              </span>
              <select
                value={selectedBranch}
                onChange={e => setSelectedBranch(e.target.value)}
                className="bg-white border border-slate-900/15 rounded-xl px-3.5 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:border-[#1ca34c]/50 cursor-pointer"
              >
                <option value="all">All Branches ({branches.length})</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>

              {/* Date Presets */}
              <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-900/10">
                {[
                  { id: 'today', label: 'Today' },
                  { id: '7days', label: '7 Days' },
                  { id: 'month', label: 'This Month' },
                  { id: '30days', label: '30 Days' },
                  { id: 'all', label: 'All History' },
                  { id: 'custom', label: 'Custom' },
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setDatePreset(p.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      datePreset === p.id
                        ? 'bg-[#1ca34c] text-white shadow'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Date Range if chosen */}
            {datePreset === 'custom' && (
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-white border border-slate-900/15 rounded-xl px-3 py-1.5 shadow-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase text-slate-500 font-semibold">From:</span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                    className="bg-transparent text-slate-900 text-xs focus:outline-none cursor-pointer [color-scheme:light]"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase text-slate-500 font-semibold">To:</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={e => setToDate(e.target.value)}
                    className="bg-transparent text-slate-900 text-xs focus:outline-none cursor-pointer [color-scheme:light]"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Global Executive KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="p-5 rounded-3xl border border-emerald-500/20 bg-emerald-500/5">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              <span className="text-[9px] font-bold text-emerald-600/80 uppercase tracking-widest">Revenue</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Total Gross Sales (মোট বিক্রি)</p>
            <p className="text-xl md:text-2xl font-bold font-serif text-slate-900">{fmt(metrics.totalGrossSales)}</p>
            <p className="text-[10px] text-slate-500 mt-1">Cash: {fmt(metrics.totalCashSales)} | Digital: {fmt(metrics.totalDigitalCollections)}</p>
          </div>

          <div className="p-5 rounded-3xl border border-blue-500/20 bg-blue-500/5">
            <div className="flex items-center justify-between mb-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              <span className="text-[9px] font-bold text-blue-600/80 uppercase tracking-widest">Remittance</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Bank Deposits Handled (ব্যাংকে জমা)</p>
            <p className="text-xl md:text-2xl font-bold font-serif text-blue-600">{fmt(metrics.totalBankDeposits)}</p>
            <p className="text-[10px] text-slate-500 mt-1">Deducted from drawer cash to bank</p>
          </div>

          <div className="p-5 rounded-3xl border border-[#1ca34c]/20 bg-[#1ca34c]/5">
            <div className="flex items-center justify-between mb-2">
              <Wallet className="w-5 h-5 text-[#15803d]" />
              <span className="text-[9px] font-bold text-[#15803d]/80 uppercase tracking-widest">Drawer Cash</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Closing Cash Retained (ক্লোজিং ক্যাশ)</p>
            <p className="text-xl md:text-2xl font-bold font-serif text-[#15803d]">{fmt(metrics.totalClosingCash)}</p>
            <p className="text-[10px] text-slate-500 mt-1">Current closing cash (latest entries)</p>
          </div>

          <div className="p-5 rounded-3xl border border-amber-500/20 bg-amber-500/5">
            <div className="flex items-center justify-between mb-2">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
              <span className="text-[9px] font-bold text-amber-600/80 uppercase tracking-widest">Audit</span>
            </div>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Shortage Alerts (হিসাব স্থিতি)</p>
            <p className="text-xl md:text-2xl font-bold font-serif text-slate-900">
              {metrics.shortageCount} days {metrics.shortageCount > 0 ? `(-${fmt(metrics.totalShortageAmount)})` : '(0 Shortage)'}
            </p>
            <p className="text-[10px] text-slate-500 mt-1">Physical drawer audit variances</p>
          </div>
        </div>

        {/* Quick Navigation Modules */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-8">
          <Link href="/admin/branch-accounts/deposit-approvals"
            className="p-3.5 sm:p-4 rounded-3xl border border-amber-500/20 bg-amber-500/10 hover:bg-amber-500/15 flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Clock className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-[11px] sm:text-xs font-bold text-amber-600 uppercase tracking-wider leading-snug">Deposit Approvals</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 ml-1">
              {pendingApprovalsCount > 0 && (
                <span className="px-1.5 sm:px-2 py-0.5 rounded-full bg-rose-500 text-white text-[9px] sm:text-[10px] font-bold animate-pulse">
                  {pendingApprovalsCount}
                </span>
              )}
              <ArrowRight className="w-3.5 h-3.5 text-amber-600 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </Link>

          <Link href="/admin/bundle-requests"
            className="p-3.5 sm:p-4 rounded-3xl border border-teal-500/20 bg-teal-500/10 hover:bg-teal-500/15 flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Coins className="w-4 h-4 text-teal-600 shrink-0" />
              <span className="text-[11px] sm:text-xs font-bold text-teal-600 uppercase tracking-wider leading-snug">Change Req</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 ml-1">
              {pendingBundleRequestsCount > 0 && (
                <span className="px-1.5 sm:px-2 py-0.5 rounded-full bg-rose-500 text-white text-[9px] sm:text-[10px] font-bold animate-pulse">
                  {pendingBundleRequestsCount}
                </span>
              )}
              <ArrowRight className="w-3.5 h-3.5 text-teal-600 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </Link>

          <Link href="/admin/branch-accounts/audit"
            className="p-3.5 sm:p-4 rounded-3xl border border-purple-500/20 bg-purple-500/10 hover:bg-purple-500/15 flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-2 min-w-0">
              <ShieldAlert className="w-4 h-4 text-purple-600 shrink-0" />
              <span className="text-[11px] sm:text-xs font-bold text-purple-600 uppercase tracking-wider leading-snug">Audit Log</span>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-purple-600 group-hover:translate-x-0.5 transition-transform shrink-0 ml-1" />
          </Link>

          <Link href="/admin/branch-financial-reports"
            className="p-3.5 sm:p-4 rounded-3xl border border-blue-500/20 bg-blue-500/10 hover:bg-blue-500/15 flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-2 min-w-0">
              <BarChart3 className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="text-[11px] sm:text-xs font-bold text-blue-600 uppercase tracking-wider leading-snug">Reports</span>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-blue-600 group-hover:translate-x-0.5 transition-transform shrink-0 ml-1" />
          </Link>

          <Link href="/admin/branch-performance"
            className="p-3.5 sm:p-4 rounded-3xl border border-emerald-500/20 bg-emerald-500/10 hover:bg-emerald-500/15 flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-2 min-w-0">
              <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-[11px] sm:text-xs font-bold text-emerald-600 uppercase tracking-wider leading-snug">Performance</span>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-emerald-600 group-hover:translate-x-0.5 transition-transform shrink-0 ml-1" />
          </Link>

          <Link href="/admin/branch-accounts/manager-setup"
            className="p-3.5 sm:p-4 rounded-3xl border border-[#1ca34c]/20 bg-[#1ca34c]/10 hover:bg-[#1ca34c]/15 flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="w-4 h-4 text-[#15803d] shrink-0" />
              <span className="text-[11px] sm:text-xs font-bold text-[#15803d] uppercase tracking-wider leading-snug">Manager Setup</span>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-[#15803d] group-hover:translate-x-0.5 transition-transform shrink-0 ml-1" />
          </Link>
        </div>



        {/* DATE-WISE DAILY CASH CLOSINGS TABLE */}
        <div className="rounded-3xl border border-slate-900/10 bg-slate-900/[0.04] overflow-hidden shadow-xl">
          <div className="p-5 border-b border-slate-900/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/[0.04]">
            <div>
              <p className="text-sm font-bold font-serif text-slate-900">Daily Cash Closing History & Digital Log</p>
              <p className="text-xs text-slate-500">
                {safeLedgerEntries.length > 0 ? `Showing 1–${safeLedgerEntries.length} of ${safeLedgerEntries.length}` : 'Showing 0'} entries for {selectedBranch === 'all' ? 'All Branches' : branches.find(b => b.id === selectedBranch)?.name}
              </p>
            </div>

            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={isExportingPdf || safeLedgerEntries.length === 0}
                className="px-3.5 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#1ca34c]/30 text-slate-600 hover:text-slate-900 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-[#15803d]" />
                <span>{isExportingPdf ? 'Exporting...' : 'Export'}</span>
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
          </div>

          {/* F3: proper horizontal-scroll container for the 13-column
              cash ledger; the Actions column is sticky right (below) so
              it stays reachable at any scroll position. */}
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-900/10 bg-slate-900/[0.04]">
                  {['Branch', 'Date & Day', 'Khuchra (খুচরা)', 'Cash Sales', 'Digital MFS'].map(h => (
                    <th key={h} className="text-left p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                  <th className="text-left p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap" title="Total Sales = Cash Sales + Digital/MFS Sales">Total Sales</th>
                  <th className="text-left p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap" title="Cash deducted from the drawer for expenses">Expenses</th>
                  <th className="text-left p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap" title="Bank Deposits are transfers of physical cash and are not sales">Bank Deposits</th>
                  {['Closing Cash', 'Discrepancy', 'Status', 'Closed By'].map(h => (
                    <th key={h} className="text-left p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                  <th className="text-left p-3.5 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap sticky right-0 z-10 bg-[#eef0f3] shadow-[-10px_0_14px_-10px_rgba(15,18,25,0.35)]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/[0.08]">
                {safeLedgerEntries.map(item => {
                  const dayName = getDayName(item.ledger_date)
                  const digitalTotal = Number(item.bkash_sales || 0) + Number(item.nagad_sales || 0) + Number(item.rocket_sales || 0) + Number(item.card_sales || 0) + Number(item.bank_transfer_sales || 0)
                  const totalSalesDay = Number(item.cash_sales || 0) + digitalTotal

                  return (
                    <tr key={item.id} className="hover:bg-slate-900/[0.04] transition-colors">
                      <td className="p-3.5 whitespace-nowrap">
                        <span className="font-semibold text-slate-900">{item.branch?.name || '—'}</span>
                      </td>
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
                        {fmt(item.khuchra_amount ?? item.khuchra_amount)}
                      </td>
                      <td className="p-3.5 font-medium text-emerald-600 whitespace-nowrap">
                        {fmt(item.cash_sales)}
                      </td>
                      <td className="p-3.5 font-medium text-blue-600 whitespace-nowrap" title={`bKash: ${fmt(item.bkash_sales)}, Nagad: ${fmt(item.nagad_sales)}, Rocket: ${fmt(item.rocket_sales)}, Card: ${fmt(item.card_sales)}`}>
                        {fmt(digitalTotal)}
                      </td>
                      <td className="p-3.5 font-serif font-bold text-slate-900 whitespace-nowrap">
                        {fmt(totalSalesDay)}
                      </td>
                      <td className="p-3.5 font-medium text-rose-600 whitespace-nowrap">
                        {fmt(item.cash_expenses)}
                      </td>
                      <td className="p-3.5 font-medium text-blue-600 whitespace-nowrap">
                        {fmt(item.bank_deposits_out)}
                      </td>
                      <td className="p-3.5 font-serif font-bold text-[#15803d] whitespace-nowrap">
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
                      <td className="p-3.5 text-slate-500 whitespace-nowrap">
                        {item.closed_by_user?.full_name || (item.is_closed ? 'Admin/Manager' : '—')}
                      </td>
                      <td className="p-3.5 whitespace-nowrap sticky right-0 z-10 bg-white shadow-[-10px_0_14px_-10px_rgba(15,18,25,0.35)]">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenEditModal(item)}
                            className="p-2.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 border border-blue-500/20 transition-all cursor-pointer"
                            title="Edit Closing"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteItem(item)}
                            className="p-2.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 border border-rose-500/20 transition-all cursor-pointer"
                            title="Delete Closing"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {safeLedgerEntries.length === 0 && (
                  <tr>
                    <td colSpan={13} className="p-8 text-center text-slate-500">
                      No daily closing records found for the selected branch and date filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* MODAL: ADD DAILY CLOSING */}
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white border border-slate-900/10 rounded-3xl w-full max-w-2xl p-6 relative shadow-2xl my-8">
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="absolute top-5 right-5 text-slate-500 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2 mb-4">
                <Plus className="w-5 h-5 text-[#15803d]" />
                <h2 className="text-lg font-bold font-serif text-slate-900">Record Daily Closing for Branch</h2>
              </div>
              <p className="text-xs text-slate-500 mb-6">
                Create or record evening closing on behalf of a branch manager.
              </p>

              <form onSubmit={handleSubmitAdd} className="space-y-4">
                {/* Branch & Date */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Branch *</label>
                    <select
                      value={formBranchId}
                      onChange={e => setFormBranchId(e.target.value)}
                      required
                      className="w-full px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/15 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/50"
                    >
                      <option value="">Select Branch</option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Date *</label>
                    <input
                      type="date"
                      value={formDate}
                      onChange={e => setFormDate(e.target.value)}
                      required
                      className="w-full px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/15 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/50"
                    />
                  </div>
                </div>

                {/* Cash Drawer: Khuchra & Cash Sales */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-900/5">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Khuchra / Change Float (৳) (খুচরা টাকা)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formOpeningCash}
                      onChange={e => setFormOpeningCash(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/15 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/50"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Pure Physical Cash Sales (৳)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formCashSales}
                      onChange={e => setFormCashSales(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/15 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/50"
                    />
                  </div>
                </div>

                {/* Digital Collections Grid */}
                <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-blue-600 font-bold flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5" /> Evening Digital Collections
                    </span>
                    <span className="text-xs font-bold text-blue-600 font-serif">
                      Total: {fmt(modalTotalDigital)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">bKash (৳)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formBkashSales}
                        onChange={e => setFormBkashSales(e.target.value)}
                        placeholder="0"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">Nagad (৳)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formNagadSales}
                        onChange={e => setFormNagadSales(e.target.value)}
                        placeholder="0"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">Rocket (৳)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formRocketSales}
                        onChange={e => setFormRocketSales(e.target.value)}
                        placeholder="0"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">Card / POS (৳)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formCardSales}
                        onChange={e => setFormCardSales(e.target.value)}
                        placeholder="0"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-2">
                      <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">Bank Transfer (৳)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formBankTransferSales}
                        onChange={e => setFormBankTransferSales(e.target.value)}
                        placeholder="0"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                      />
                    </div>
                  </div>
                </div>

                {/* Counted Closing Drawer Cash */}
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                    Counted Closing Cash in Drawer (৳) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formActualCash}
                    onChange={e => setFormActualCash(e.target.value)}
                    placeholder="Enter counted physical notes & coins"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/15 text-slate-900 font-serif font-bold text-sm focus:outline-none focus:border-[#1ca34c]/50"
                  />
                </div>

                {/* Live Net Drawer Cash Banner */}
                <div className="p-3 rounded-xl bg-[#1ca34c]/10 border border-[#1ca34c]/20 flex justify-between items-center text-xs">
                  <span className="text-slate-600">Net Drawer Cash Generated Today (Closing − Khuchra):</span>
                  <span className="font-bold font-serif text-[#15803d] text-base">
                    {modalNetDrawer !== null ? fmt(modalNetDrawer) : '৳0'}
                  </span>
                </div>

                {/* Notes & Closed Checkbox */}
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Notes / Discrepancy Reason</label>
                  <input
                    type="text"
                    value={formNotes}
                    onChange={e => setFormNotes(e.target.value)}
                    placeholder="Optional notes or remarks"
                    className="w-full px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/15 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/50"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="is_closed_add"
                    checked={formIsClosed}
                    onChange={e => setFormIsClosed(e.target.checked)}
                    className="rounded border-slate-900/20 bg-slate-900/[0.04] text-[#15803d] focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="is_closed_add" className="text-xs text-slate-600 cursor-pointer">
                    Mark day as officially Closed
                  </label>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-900/5">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-600 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 rounded-full bg-[#1ca34c] text-white text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? 'Saving...' : 'Save Closing'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: EDIT DAILY CLOSING */}
        {isEditModalOpen && editingItem && (
          <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white border border-slate-900/10 rounded-3xl w-full max-w-2xl p-6 relative shadow-2xl my-8">
              <button
                onClick={() => { setIsEditModalOpen(false); setEditingItem(null) }}
                className="absolute top-5 right-5 text-slate-500 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2 mb-4">
                <Edit2 className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold font-serif text-slate-900">
                  Edit Daily Closing — {editingItem.branch?.name} ({formatDatePretty(editingItem.ledger_date)})
                </h2>
              </div>
              <p className="text-xs text-slate-500 mb-6">
                Modify physical drawer cash, digital collections, or status.
              </p>

              <form onSubmit={handleSubmitEdit} className="space-y-4">
                {/* Cash Drawer: Khuchra & Cash Sales */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Khuchra / Change Float (৳) (খুচরা টাকা)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formOpeningCash}
                      onChange={e => setFormOpeningCash(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/15 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/50"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Pure Physical Cash Sales (৳)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formCashSales}
                      onChange={e => setFormCashSales(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/15 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/50"
                    />
                  </div>
                </div>

                {/* Digital Collections Grid */}
                <div className="p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-blue-600 font-bold flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5" /> Evening Digital Collections
                    </span>
                    <span className="text-xs font-bold text-blue-600 font-serif">
                      Total: {fmt(modalTotalDigital)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">bKash (৳)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formBkashSales}
                        onChange={e => setFormBkashSales(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">Nagad (৳)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formNagadSales}
                        onChange={e => setFormNagadSales(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">Rocket (৳)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formRocketSales}
                        onChange={e => setFormRocketSales(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">Card / POS (৳)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formCardSales}
                        onChange={e => setFormCardSales(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-2">
                      <label className="block text-[9px] uppercase tracking-wider text-slate-500 mb-1">Bank Transfer (৳)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formBankTransferSales}
                        onChange={e => setFormBankTransferSales(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 text-slate-900 text-xs focus:outline-none focus:border-blue-400/40"
                      />
                    </div>
                  </div>
                </div>

                {/* Counted Closing Drawer Cash */}
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                    Counted Closing Cash in Drawer (৳)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formActualCash}
                    onChange={e => setFormActualCash(e.target.value)}
                    placeholder="Physical drawer count"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/15 text-slate-900 font-serif font-bold text-sm focus:outline-none focus:border-[#1ca34c]/50"
                  />
                </div>

                {/* Live Net Drawer Cash Banner */}
                <div className="p-3 rounded-xl bg-[#1ca34c]/10 border border-[#1ca34c]/20 flex justify-between items-center text-xs">
                  <span className="text-slate-600">Net Drawer Cash Generated Today (Closing − Khuchra):</span>
                  <span className="font-bold font-serif text-[#15803d] text-base">
                    {modalNetDrawer !== null ? fmt(modalNetDrawer) : '৳0'}
                  </span>
                </div>

                {/* Notes & Closed Checkbox */}
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Notes / Discrepancy Reason</label>
                  <input
                    type="text"
                    value={formNotes}
                    onChange={e => setFormNotes(e.target.value)}
                    placeholder="Discrepancy notes"
                    className="w-full px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/15 text-slate-900 text-xs focus:outline-none focus:border-[#1ca34c]/50"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="is_closed_edit"
                    checked={formIsClosed}
                    onChange={e => setFormIsClosed(e.target.checked)}
                    className="rounded border-slate-900/20 bg-slate-900/[0.04] text-[#15803d] focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="is_closed_edit" className="text-xs text-slate-600 cursor-pointer">
                    Mark day as Closed
                  </label>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-900/5">
                  <button
                    type="button"
                    onClick={() => { setIsEditModalOpen(false); setEditingItem(null) }}
                    className="px-4 py-2 rounded-xl bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-600 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-700 text-white text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? 'Updating...' : 'Update Record'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
