'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { 
  ChevronLeft, RefreshCw, FileText, TrendingUp, TrendingDown, 
  Building2, Wallet, ShieldAlert, Download, CheckCircle, Smartphone
} from 'lucide-react'
import Link from 'next/link'
import { generatePdf } from '@/lib/pdf-generator'
import { generateExcel } from '@/lib/excel-generator'

import { useBranchAuth } from '@/lib/hooks/use-branch-auth'
import { fetchWithCache, getCachedData } from '@/lib/branch-cache'

const fmt = (n: any) => (Number(n || 0) < 0 ? '-' : '') + '৳' + Math.abs(Number(n || 0)).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function MonthlyReportPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const branchId = searchParams?.get('branch_id') || ''
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  
  const cacheKey = `branch_monthly_report_${branchId || 'own'}_${year}_${month}`
  const [report, setReport] = useState<any>(() => getCachedData(cacheKey) || null)
  const { isAuthorized, isLoading: isAuthLoading } = useBranchAuth()
  const [isLoading, setIsLoading] = useState(() => !getCachedData(cacheKey))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    if (!isAuthLoading && !isAuthorized) {
      router.replace('/dashboard/branch-accounts')
    }
  }, [isAuthLoading, isAuthorized, router])

  const fetchReport = useCallback(async () => {
    let url = `/api/branch-accounts/reports/monthly?year=${year}&month=${month}`
    if (branchId) url += `&branch_id=${branchId}`
    const key = `branch_monthly_report_${branchId || 'own'}_${year}_${month}`
    const json = await fetchWithCache(key, url, 60000)
    if (json) setReport(json)
  }, [year, month, branchId])

  useEffect(() => {
    if (!isAuthorized) return
    const key = `branch_monthly_report_${branchId || 'own'}_${year}_${month}`
    const cached = getCachedData(key)
    if (cached) {
      setReport(cached)
      setIsLoading(false)
    }
    fetchReport().finally(() => setIsLoading(false))
  }, [isAuthorized, year, month, branchId, fetchReport])

  const handleRefresh = async () => { setIsRefreshing(true); await fetchReport(); setIsRefreshing(false) }

  const s = report?.summary
  const bankBreakdown = report?.bankBreakdown || s?.bankBreakdown || []

  // Export PDF Statement
  const handleExportPdf = async () => {
    if (!report || !report.dailyLedger || report.dailyLedger.length === 0) return
    setIsExporting(true)
    try {
      const branchLabel = report.branchName || 'Branch'
      const monthLabel = `${MONTHS[month - 1]} ${year}`

      const columns = [
        'Date',
        'Pure Cash Sales',
        'Expenses',
        'Bank Deposits',
        'Expected Closing',
        'Counted Cash',
        'Difference',
        'Status'
      ]

      const rows = report.dailyLedger.map((row: any) => [
        row.ledger_date,
        Number(row.cash_sales || 0).toLocaleString('en-US'),
        Number(row.cash_expenses || 0).toLocaleString('en-US'),
        Number(row.bank_deposits_out || 0).toLocaleString('en-US'),
        Number(row.expected_closing_cash || 0).toLocaleString('en-US'),
        row.actual_cash !== null && row.actual_cash !== undefined ? Number(row.actual_cash).toLocaleString('en-US') : '-',
        row.cash_difference !== null && row.cash_difference !== undefined ? `${row.cash_difference >= 0 ? '+' : ''}${Number(row.cash_difference).toLocaleString('en-US')}` : '-',
        !row.is_closed ? 'Open' : (row.difference_status || 'Closed')
      ])

      const summaryData = [
        { label: 'Branch Name', value: branchLabel },
        { label: 'Reporting Month', value: monthLabel },
        { label: 'Total Gross Sales Revenue', value: `${Number(s?.totalSales || 0).toLocaleString('en-US')} BDT` },
        { label: 'Pure Cash Sales', value: `${Number(s?.totalCashSales || 0).toLocaleString('en-US')} BDT` },
        { label: 'Digital Collections (bKash/Nagad/Card)', value: `${Number(s?.totalDigitalSales || 0).toLocaleString('en-US')} BDT` },
        { label: 'Total Bank Remittances', value: `${Number(s?.totalApprovedDeposits || 0).toLocaleString('en-US')} BDT` },
        { label: 'Cash Expenses Incurred', value: `${Number(s?.totalExpenses || 0).toLocaleString('en-US')} BDT` },
        { label: 'Net Drawer Cash Retained', value: `${Number(s?.netCash || 0).toLocaleString('en-US')} BDT` },
      ]

      await generatePdf('Monthly Branch Financial Statement', columns, rows, {
        branch: branchLabel,
        subtitle: `MONTHLY ACCOUNTING & AUDIT STATEMENT — ${monthLabel.toUpperCase()}`,
        dateRange: monthLabel,
        preparedBy: 'Branch Manager / Accounts',
        orientation: 'landscape',
        summaryData,
        filename: `Monthly_Statement_${branchLabel.replace(/\s+/g, '_')}_${MONTHS[month - 1]}_${year}.pdf`,
        notes: 'Official Anchor Fashion ERP Financial Statement. Total Sales Revenue = Cash Sales + Digital Collections. Bank Deposits are direct asset remittances to corporate accounts.',
        tableTitle: 'Daily Closing Summary'
      })
    } catch (e) {
      console.error(e)
    } finally {
      setIsExporting(false)
    }
  }

  // Export Excel
  const handleExportExcel = () => {
    if (!report || !report.dailyLedger || report.dailyLedger.length === 0) return
    const branchLabel = report.branchName || 'Branch'
    const columns = ['Date', 'Cash Sales (BDT)', 'Expenses (BDT)', 'Bank Deposits (BDT)', 'Expected Closing (BDT)', 'Counted Cash (BDT)', 'Difference (BDT)', 'Status']
    const rows = report.dailyLedger.map((row: any) => [
      row.ledger_date,
      Number(row.cash_sales || 0),
      Number(row.cash_expenses || 0),
      Number(row.bank_deposits_out || 0),
      Number(row.expected_closing_cash || 0),
      row.actual_cash !== null && row.actual_cash !== undefined ? Number(row.actual_cash) : '-',
      Number(row.cash_difference || 0),
      !row.is_closed ? 'Open' : (row.difference_status || 'Closed')
    ])
    generateExcel('Monthly Ledger Statement', columns, rows, {
      filename: `Monthly_Ledger_${branchLabel.replace(/\s+/g, '_')}_${MONTHS[month - 1]}_${year}.xlsx`,
      sheetName: 'Monthly Report'
    })
  }

  if (isLoading) {
    return <div className="min-h-screen bg-white flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="relative z-10 p-4 md:p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard/branch-accounts" className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#d4af37]/20 text-slate-500 hover:text-slate-900 transition-all">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2"><FileText className="w-5 h-5 text-[#8a6d1f]" /> Monthly Financial Report</h1>
            <p className="text-[11px] text-slate-500">{report?.branchName} — {MONTHS[month - 1]} {year}</p>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleExportPdf}
              disabled={isExporting || !report?.dailyLedger?.length}
              className="px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/40 text-slate-600 hover:text-slate-900 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#8a6d1f]" /> PDF
            </button>
            <button 
              onClick={handleExportExcel}
              disabled={!report?.dailyLedger?.length}
              className="px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-emerald-500/40 text-slate-600 hover:text-slate-900 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" /> Excel
            </button>
            <button onClick={handleRefresh} className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[#8a6d1f]' : ''}`}>
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Month/Year selector */}
        <div className="flex gap-3 mb-8 p-3 rounded-2xl bg-slate-900/[0.04] border border-slate-900/5">
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="bg-white border border-slate-900/10 rounded-xl px-3.5 py-2 text-slate-900 text-xs focus:outline-none focus:border-[#d4af37]/40 cursor-pointer"
          >
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="bg-white border border-slate-900/10 rounded-xl px-3.5 py-2 text-slate-900 text-xs focus:outline-none focus:border-[#d4af37]/40 cursor-pointer"
          >
            {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={fetchReport}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#d4af37] to-white text-black font-bold text-xs uppercase tracking-wider hover:opacity-90 transition-all cursor-pointer ml-auto"
          >
            Filter Month
          </button>
        </div>

        {!s ? (
          <div className="text-center py-16 rounded-2xl border border-slate-900/5 bg-slate-900/[0.04]">
            <FileText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-500 text-sm">No financial records found for {MONTHS[month - 1]} {year}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Hero cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-gradient-to-br from-[#d4af37]/15 to-transparent border border-[#d4af37]/20">
                <div className="flex items-center justify-between mb-2">
                  <TrendingUp className="w-4 h-4 text-[#8a6d1f]" />
                  <span className="text-[9px] font-bold text-[#8a6d1f] uppercase tracking-widest">Gross Sales</span>
                </div>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Total Sales (মোট বিক্রি)</p>
                <p className="text-xl md:text-2xl font-bold font-serif text-slate-900">{fmt(s.totalSales)}</p>
                <p className="text-[10px] text-slate-500 mt-1">Cash: {fmt(s.totalCashSales)} · Digital: {fmt(s.totalDigitalSales)}</p>
              </div>

              <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-500/15 to-transparent border border-blue-500/20">
                <div className="flex items-center justify-between mb-2">
                  <Building2 className="w-4 h-4 text-blue-600" />
                  <span className="text-[9px] font-bold text-blue-600 uppercase tracking-widest">Bank Remitted</span>
                </div>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Bank Deposits (ব্যাংকে জমা)</p>
                <p className="text-xl md:text-2xl font-bold font-serif text-blue-600">{fmt(s.totalApprovedDeposits)}</p>
                <p className="text-[10px] text-slate-500 mt-1">Pending: {fmt(s.totalPendingDeposits)}</p>
              </div>

              <div className="p-5 rounded-2xl bg-gradient-to-br from-rose-500/15 to-transparent border border-rose-500/20">
                <div className="flex items-center justify-between mb-2">
                  <TrendingDown className="w-4 h-4 text-rose-600" />
                  <span className="text-[9px] font-bold text-rose-600 uppercase tracking-widest">Expenses</span>
                </div>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Cash Expenses (খরচ)</p>
                <p className="text-xl md:text-2xl font-bold font-serif text-rose-600">{fmt(s.totalExpenses)}</p>
                <p className="text-[10px] text-slate-500 mt-1">Paid out of physical cash</p>
              </div>

              <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-transparent border border-emerald-500/20">
                <div className="flex items-center justify-between mb-2">
                  <Wallet className="w-4 h-4 text-emerald-600" />
                  <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest">Closing Cash</span>
                </div>
                <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Drawer Cash (ক্লোজিং ক্যাশ)</p>
                <p className="text-xl md:text-2xl font-bold font-serif text-emerald-600">{fmt(s.netCash)}</p>
                <p className="text-[10px] text-slate-500 mt-1">Closed across {s.daysClosed} days</p>
              </div>
            </div>

            {/* Bank Accounts Distribution Breakdown */}
            {bankBreakdown && bankBreakdown.length > 0 && (
              <div className="p-5 rounded-2xl border border-blue-500/20 bg-blue-500/5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-blue-600">Bank-Wise Deposit Breakdown (ব্যাংক অনুযায়ী জমা)</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-semibold">{bankBreakdown.length} Accounts Used</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {bankBreakdown.map((item: any, idx: number) => (
                    <div key={idx} className="p-3.5 rounded-xl bg-white border border-slate-900/5 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-slate-900">{item.bankName}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{item.count} deposit transaction{item.count !== 1 ? 's' : ''}</p>
                      </div>
                      <p className="text-sm font-bold font-serif text-blue-600">{fmt(item.amount)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cash difference summary */}
            {(s.daysWithShortage > 0 || s.daysWithExcess > 0) && (
              <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  <p className="text-[10px] uppercase tracking-widest text-amber-600 font-bold">Cash Count Discrepancies (অডিট বৈষম্য)</p>
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-slate-600">
                  <span>Shortage days: <span className="text-rose-600 font-semibold">{s.daysWithShortage}</span></span>
                  <span>Excess days: <span className="text-amber-600 font-semibold">{s.daysWithExcess}</span></span>
                  <span>Total Net Discrepancy: <span className={`font-semibold ${s.totalCashDifference < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmt(s.totalCashDifference)}</span></span>
                </div>
              </div>
            )}

            {/* Daily ledger table */}
            {report.dailyLedger?.length > 0 && (
              <div className="rounded-2xl border border-slate-900/5 bg-slate-900/[0.04] overflow-hidden">
                <div className="p-4 border-b border-slate-900/5 flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                    Daily Closing Reconciliation Log ({report.dailyLedger.length} Days)
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-900/5 bg-slate-900/[0.04]">
                        {['Date', 'Opening Cash', 'Pure Cash Sales', 'Cash Expenses', 'Bank Deposits', 'Expected Cash', 'Counted Cash', 'Status'].map(h => (
                          <th key={h} className="text-left p-3 text-[9px] uppercase tracking-widest text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900/[0.08]">
                      {report.dailyLedger.map((row: any) => (
                        <tr key={row.ledger_date} className="hover:bg-slate-900/[0.04] transition-colors">
                          <td className="p-3 font-semibold text-slate-900 whitespace-nowrap">{row.ledger_date}</td>
                          <td className="p-3 text-slate-500 whitespace-nowrap">{fmt(row.opening_cash)}</td>
                          <td className="p-3 text-emerald-600 font-medium whitespace-nowrap">{fmt(row.cash_sales)}</td>
                          <td className="p-3 text-rose-600 whitespace-nowrap">{fmt(row.cash_expenses)}</td>
                          <td className="p-3 text-blue-600 font-medium whitespace-nowrap">{fmt(row.bank_deposits_out)}</td>
                          <td className="p-3 text-slate-600 font-medium whitespace-nowrap">{fmt(row.expected_closing_cash)}</td>
                          <td className="p-3 text-[#8a6d1f] font-serif font-bold whitespace-nowrap">
                            {row.actual_cash !== null && row.actual_cash !== undefined ? fmt(row.actual_cash) : '—'}
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                              !row.is_closed ? 'text-slate-500 bg-white border-slate-900/5' :
                              row.difference_status === 'matched' ? 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20' :
                              row.difference_status === 'shortage' ? 'text-rose-600 bg-rose-500/10 border-rose-500/20' :
                              'text-amber-600 bg-amber-500/10 border-amber-500/20'
                            }`}>
                              {!row.is_closed ? 'Open' : row.difference_status || 'Closed'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
