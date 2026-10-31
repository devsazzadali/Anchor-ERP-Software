'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Landmark, Search, Calendar, FileSearch, CheckCircle2, X, FileText, Download, UserX, UserCheck, AlertCircle, Building2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { generatePdf } from '@/lib/pdf-generator';
import IssueSalaryModal from './IssueSalaryModal';

// the ledger reads ONLY through
// GET /api/admin/salaries (converted earlier — C22/C23/C38 live
// there). The fixed copy's direct-browser fallback
// (fetchDirectFallback) is DELETED: like the localStorage fallbacks
// (audit A9/C41), a second data source can only disagree with the
// API — the API is the only source.

// C24: "Basic" is never the full amount. Exports used
// `base_salary_at_time || amount` — when the base was null the Basic
// column showed the TOTAL while the component columns were also
// populated, so exported components summed to more than the Total.
// When the base is missing (legacy rows), reconstruct it exactly:
// total − (overtime + bonus + commission + tiffin).
export const basicOf = (s: any): number =>
  s.base_salary_at_time !== null && s.base_salary_at_time !== undefined
    ? Number(s.base_salary_at_time)
    : Number(s.amount || 0) - Number(s.overtime_amount || 0) - Number(s.bonus_amount || 0) - Number(s.sales_commission || 0) - Number(s.tiffin_bill || 0)

export default function AdminSalariesLedger() {
  const [salaries, setSalaries] = useState<any[]>([])
  const [unpaidEmployees, setUnpaidEmployees] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [selectedSalary, setSelectedSalary] = useState<any | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showExportDropdown, setShowExportDropdown] = useState(false)
  const [isSelectMode, setIsSelectMode] = useState(false)

  // Tabs
  const [activeTab, setActiveTab] = useState<'paid' | 'unpaid'>('paid')
  const [showIssueModal, setShowIssueModal] = useState(false)

  // Filter states
  const [searchTerm, setSearchTerm] = useState('')
  const [branchFilter, setBranchFilter] = useState('All')

  // Date filters
  const [selectedMonth, setSelectedMonth] = useState('all')

  const last12Months = useMemo(() => {
    const months = []
    const d = new Date()
    for (let i = 0; i < 24; i++) {
      const year = d.getFullYear()
      const month = d.getMonth() + 1
      const val = `${year}-${String(month).padStart(2, '0')}`
      const label = d.toLocaleString('default', { month: 'long', year: 'numeric' })
      months.push({ value: val, label })
      d.setMonth(d.getMonth() - 1)
    }
    return months
  }, [])

  const currentMonthStr = useMemo(() => {
    if (selectedMonth === 'all') return 'All Time (Total History)'
    const match = last12Months.find(m => m.value === selectedMonth)
    return match ? match.label : selectedMonth
  }, [selectedMonth, last12Months])

  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [selectedMonth])

  const fetchData = async () => {
    try {
      setIsLoading(true)
      setErrorMsg(null)

      const res = await fetch(`/api/admin/salaries?month=${selectedMonth}`)
      if (!res.ok) {
        throw new Error(`API error ${res.status}: ${res.statusText}`)
      }
      const data = await res.json()

      if (data.error) throw new Error(data.error)

      setSalaries(data.payments || [])
      setUnpaidEmployees(data.unpaid || [])
    } catch (err: any) {
      console.error('Failed to load salary ledger:', err?.message || err)
      setErrorMsg(err?.message || 'Failed to load salary ledger data.')
    } finally {
      setIsLoading(false)
    }
  }

  // --- Computed ---
  const uniqueBranches = Array.from(new Set([
    ...salaries.map(s => s.profiles?.branch || 'HQ'),
    ...unpaidEmployees.map(u => u.branch || 'HQ')
  ].filter(Boolean))).sort() as string[]

  const filteredSalaries = salaries.filter(s => {
    const nameMatch = (s.profiles?.full_name || '').toLowerCase().includes(searchTerm.toLowerCase())
    const branchName = s.profiles?.branch || 'HQ'
    const branchMatch = branchFilter === 'All' || branchName === branchFilter || s.profiles?.branch === branchFilter
    return nameMatch && branchMatch
  })

  const filteredUnpaid = unpaidEmployees.filter(u => {
    const nameMatch = (u.full_name || '').toLowerCase().includes(searchTerm.toLowerCase())
    const branchName = u.branch || 'HQ'
    const branchMatch = branchFilter === 'All' || branchName === branchFilter || u.branch === branchFilter
    return nameMatch && branchMatch
  })

  // Summary Metrics
  const summaryStats = useMemo(() => {
    const totalPaidAmount = salaries.reduce((sum, s) => sum + Number(s.amount), 0)
    const totalUnpaidAmount = unpaidEmployees.reduce((sum, u) => sum + Number(u.salary || 0), 0)

    return {
      // C21: "Paid Employees" counts DISTINCT employees, not payment
      // rows — an employee paid twice in the window was counted
      // twice. (Note: totalUnpaidAmount is Σ CURRENT profile salary
      // of unpaid staff — no historical salary is stored, so it is
      // labelled as such on the card.)
      countPaid: new Set(salaries.map(s => s.employee_id)).size,
      countUnpaid: unpaidEmployees.length,
      totalPaidAmount,
      totalUnpaidAmount
    }
  }, [salaries, unpaidEmployees])

  // Exports
  const handleExportCSV = () => {
    const selectedSalaries = filteredSalaries.filter(s => selectedIds.includes(s.id))
    if (selectedSalaries.length === 0) return

    const headers = ['Employee Name', 'Branch', 'Basic (BDT)', 'Overtime', 'Bonus', 'Sales Comm', 'Tiffin Bill', 'Total Amount', 'Payment Date', 'Transaction ID', 'Account / Reference', 'Bank/Wallet Details']
    const rows = selectedSalaries.map(s => {
      let bankDetails = ''
      if (s.profiles?.bank_info) {
        const info = s.profiles.bank_info
        if (info.bankName) {
          bankDetails = `Bank: ${info.bankName} | Account Name: ${info.accountName || ''} | Account No: ${info.accountNumber || ''}`
        } else if (info.mobileNumber) {
          bankDetails = `Wallet: ${info.walletType || ''} | Mobile: ${info.mobileNumber}`
        }
      }
      const escape = (val: any) => `"${(val === null || val === undefined ? '' : String(val)).replace(/"/g, '""')}"`
      return [
        escape(s.profiles?.full_name || 'Unknown Employee'),
        escape(s.profiles?.branch || 'HQ'),
        basicOf(s),
        s.overtime_amount || 0,
        s.bonus_amount || 0,
        s.sales_commission || 0,
        s.tiffin_bill || 0,
        s.amount,
        escape(new Date(s.payment_date).toLocaleDateString()),
        escape(s.transaction_id || 'N/A'),
        escape(s.account || 'N/A'),
        escape(bankDetails)
      ].join(',')
    })

    const csvContent = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `master_salary_export_${new Date().toISOString().slice(0,10)}.csv`
    link.click()
  }

  const handleExportPDF = async () => {
    const selectedSalaries = filteredSalaries.filter(s => selectedIds.includes(s.id));
    if (selectedSalaries.length === 0) return;

    const columns = ['Employee Name', 'Branch', 'Basic', 'Overtime', 'Bonus', 'Sales Comm', 'Tiffin Bill', 'Total', 'Payment Date', 'Transaction ID', 'Account', 'Details'];
    const rows = selectedSalaries.map(s => {
      let bankDetails = '';
      if (s.profiles?.bank_info) {
        const info = s.profiles.bank_info;
        if (info.bankName) {
          bankDetails = `Bank: ${info.bankName} | Account Name: ${info.accountName || ''} | Account No: ${info.accountNumber || ''}`;
        } else if (info.mobileNumber) {
          bankDetails = `Wallet: ${info.walletType || ''} | Mobile: ${info.mobileNumber}`;
        }
      }
      return [
        s.profiles?.full_name || 'Unknown Employee',
        s.profiles?.branch || 'HQ',
        basicOf(s),
        s.overtime_amount || 0,
        s.bonus_amount || 0,
        s.sales_commission || 0,
        s.tiffin_bill || 0,
        s.amount,
        new Date(s.payment_date).toLocaleDateString(),
        s.transaction_id || 'N/A',
        s.account || 'N/A',
        bankDetails
      ];
    });

    const totalSalary = selectedSalaries.reduce((sum, s) => sum + Number(s.amount), 0);
    await generatePdf('Master Salary Ledger', columns, rows, {
      // C25: scope is stated — this total covers the SELECTED rows
      // only, unlike the screen's all-filtered total (also shown).
      summaryData: [
        { label: `Total Salary Amount (selected ${selectedSalaries.length} rows)`, value: `${totalSalary.toLocaleString()} BDT` },
        { label: 'Total Paid — all filtered rows', value: `${summaryStats.totalPaidAmount.toLocaleString()} BDT` }
      ],
      filename: `salaries_${new Date().getTime()}.pdf`
    });
  };

  const handleExportExcel = () => {
    const selectedSalaries = filteredSalaries.filter(s => selectedIds.includes(s.id))
    if (selectedSalaries.length === 0) return

    const dataToExport = selectedSalaries.map(s => {
      let bankDetails = ''
      if (s.profiles?.bank_info) {
        const info = s.profiles.bank_info
        if (info.bankName) {
          bankDetails = `Bank: ${info.bankName} | A/C: ${info.accountName || ''} | No: ${info.accountNumber || ''}`
        } else if (info.mobileNumber) {
          bankDetails = `Wallet: ${info.walletType || ''} | Mobile: ${info.mobileNumber}`
        }
      }
      return {
        'Employee Name': s.profiles?.full_name || 'Unknown Employee',
        'Branch': s.profiles?.branch || 'HQ',
        'Basic (BDT)': basicOf(s),
        'Overtime': s.overtime_amount || 0,
        'Bonus': s.bonus_amount || 0,
        'Sales Comm': s.sales_commission || 0,
        'Tiffin Bill': s.tiffin_bill || 0,
        'Total Amount (BDT)': s.amount,
        'Payment Date': new Date(s.payment_date).toLocaleDateString(),
        'Transaction ID': s.transaction_id || 'N/A',
        'Account / Reference': s.account || 'N/A',
        'Bank/Wallet Details': bankDetails
      }
    })

    const worksheet = XLSX.utils.json_to_sheet(dataToExport)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'SalariesData')
    XLSX.writeFile(workbook, `master_salary_export_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  const handleExportSingleSalaryPdf = async (s: any) => {
    const rows = [
      ['Employee Name', s.profiles?.full_name || 'Unknown Employee'],
      ['Payment Date', new Date(s.payment_date).toLocaleDateString()],
      ['Branch', s.profiles?.branch || 'Main Office'],
      ['Basic Disbursed', `${basicOf(s).toLocaleString()} BDT`],
      ['Overtime', `${Number(s.overtime_amount || 0).toLocaleString()} BDT`],
      ['Bonus', `${Number(s.bonus_amount || 0).toLocaleString()} BDT`],
      ['Sales Commission', `${Number(s.sales_commission || 0).toLocaleString()} BDT`],
      ['Tiffin Bill', `${Number(s.tiffin_bill || 0).toLocaleString()} BDT`],
      ['Total Amount', `${Number(s.amount).toLocaleString()} BDT`],
      ['Destination Account', s.account || 'N/A'],
      ['Transaction ID', s.transaction_id || 'N/A'],
      ['Notes / Remarks', s.notes || 'None']
    ]

    await generatePdf('Salary Disbursement Voucher', ['Specification', 'Details'], rows, {
      subtitle: `Official Payment Record - Trx: ${s.transaction_id || 'N/A'}`,
      preparedBy: 'Administrator',
      branch: s.profiles?.branch || 'Main Office',
      summaryData: [
        { label: 'Net Disbursed Amount', value: `${Number(s.amount).toLocaleString()} BDT` }
      ],
      filename: `Salary_Voucher_${s.profiles?.full_name || 'Employee'}_${s.transaction_id || s.id}.pdf`
    })
  }

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans">
      <div className="absolute top-[-10%] right-[-5%] w-[50%] h-[50%] bg-[#d4af37]/3 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="flex-1 flex flex-col p-6 lg:p-10 overflow-y-auto max-h-screen relative z-10">
        <div className="mb-8 pb-4 border-b border-slate-900/5 flex justify-between items-end">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-serif">
              Master Salary <span className="premium-text-gradient">Ledger</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">Audit log of disbursed and pending workforce compensations for {currentMonthStr}.</p>
          </div>

          <div className="flex items-center gap-4 flex-wrap justify-end">
            <button
              onClick={() => setShowIssueModal(true)}
              className="px-4 py-2 bg-gradient-to-r from-[#d4af37] to-white text-black hover:brightness-110 rounded-xl text-xs font-bold uppercase tracking-wider shadow-md hover:scale-105 transition-all flex items-center gap-2"
            >
              <Landmark className="w-4 h-4" />
              Issue Salary
            </button>
            {/* Filters */}
            <div className="flex items-center gap-3 bg-white p-2 rounded-2xl border border-slate-900/5 shadow-inner flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search Employee..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-white border border-slate-900/10 rounded-xl py-2 pl-9 pr-3 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/70 focus:ring-1 focus:ring-[#d4af37]/50 transition-all w-48 placeholder:text-slate-600"
                />
              </div>

              <div className="relative">
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="bg-white border border-slate-900/10 rounded-xl py-2 pl-3 pr-8 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/70 focus:ring-1 focus:ring-[#d4af37]/50 transition-all cursor-pointer appearance-none min-w-[140px]"
                >
                  <option value="All" className="bg-white">🏢 All Branches</option>
                  {uniqueBranches.map(branch => (
                    <option key={branch} value={branch} className="bg-white">{branch}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>

              <div className="relative">
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-[#d4af37]/10 border border-[#d4af37]/30 text-[#8a6d1f] rounded-xl py-2 pl-9 pr-8 text-xs font-bold focus:outline-none focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37]/50 transition-all cursor-pointer appearance-none min-w-[150px]"
                >
                  <option value="all" className="bg-white text-slate-900 font-bold">📅 All Time (Total)</option>
                  {last12Months.map(m => (
                    <option key={m.value} value={m.value} className="bg-white text-slate-900">{m.label}</option>
                  ))}
                </select>
                <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#8a6d1f]" />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#8a6d1f]">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>
            </div>

            {activeTab === 'paid' && filteredSalaries.length > 0 && (
            <div className="flex items-center gap-4">
              {!isSelectMode ? (
                <button
                  onClick={() => setIsSelectMode(true)}
                  className="px-3 py-1.5 bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/40 text-slate-600 hover:text-slate-900 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
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
                    className="px-2.5 py-1 bg-white border border-slate-900/5 text-slate-500 hover:text-slate-900 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={filteredSalaries.length > 0 && selectedIds.length === filteredSalaries.length}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds(filteredSalaries.map(s => s.id))
                        else setSelectedIds([])
                      }}
                      className="w-3.5 h-3.5 rounded border-slate-900/10 bg-white text-[#8a6d1f] focus:ring-0 accent-[#d4af37] cursor-pointer transition-all hover:scale-110"
                    />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Select All</span>
                  </label>
                </>
              )}

              {isSelectMode && selectedIds.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowExportDropdown(prev => !prev)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-[#d4af37] to-white text-black hover:brightness-110 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all hover:scale-105 active:scale-95 shadow-md shadow-[#d4af37]/10 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Export ({selectedIds.length}) ▼</span>
                  </button>

                  {showExportDropdown && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowExportDropdown(false)} />
                      <div className="absolute right-0 mt-1.5 w-36 bg-white border border-slate-900/10 rounded-lg shadow-xl py-1 z-20 flex flex-col">
                        <button
                          onClick={() => { handleExportExcel(); setShowExportDropdown(false); }}
                          className="px-3 py-1.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors cursor-pointer"
                        >
                          Export to Excel (.xlsx)
                        </button>
                        <button
                          onClick={() => { handleExportCSV(); setShowExportDropdown(false); }}
                          className="px-3 py-1.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors border-t border-slate-900/5 cursor-pointer"
                        >
                          Export to CSV (.csv)
                        </button>
                        <button
                          onClick={() => { handleExportPDF(); setShowExportDropdown(false); }}
                          className="px-3 py-1.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors border-t border-slate-900/5 cursor-pointer"
                        >
                          Export to PDF (.pdf)
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            )}
          </div>
        </div>

        {/* --- Summary Metrics --- */}
        {!isLoading && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="glass-panel p-5 rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.02]">
              <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest block mb-2">Total Paid Amount</span>
              <h3 className="text-2xl font-bold text-slate-900">{summaryStats.totalPaidAmount.toLocaleString()} <span className="text-xs text-slate-500 font-normal">BDT</span></h3>
            </div>
            <div className="glass-panel p-5 rounded-2xl border border-rose-500/10 bg-rose-500/[0.02]">
              <span className="text-[10px] font-bold text-rose-500 uppercase tracking-widest block mb-2">Total Unpaid Amount</span>
              <h3 className="text-2xl font-bold text-slate-900">{summaryStats.totalUnpaidAmount.toLocaleString()} <span className="text-xs text-slate-500 font-normal">BDT</span></h3>
              <p className="text-[9px] text-slate-500 mt-1">At current salary rates (no historical rate is stored)</p>
            </div>
            <div className="glass-panel p-5 rounded-2xl border border-slate-900/5 bg-slate-900/[0.04]">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Paid Employees</span>
              <h3 className="text-2xl font-bold text-slate-900">{summaryStats.countPaid}</h3>
            </div>
            <div className="glass-panel p-5 rounded-2xl border border-slate-900/5 bg-slate-900/[0.04]">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Unpaid Employees</span>
              <h3 className="text-2xl font-bold text-slate-900">{summaryStats.countUnpaid}</h3>
            </div>
          </div>
        )}
        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => fetchData()} className="text-[10px] underline hover:text-slate-900 uppercase font-bold tracking-wider cursor-pointer">
              Retry
            </button>
          </div>
        )}

        {/* --- Tabs --- */}
        <div className="flex gap-4 mb-6 border-b border-slate-900/5">
          <button
            onClick={() => setActiveTab('paid')}
            className={`pb-3 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 ${activeTab === 'paid' ? 'text-[#8a6d1f] border-[#d4af37]' : 'text-slate-500 border-transparent hover:text-slate-900'}`}
          >
            Paid ({summaryStats.countPaid})
          </button>
          <button
            onClick={() => setActiveTab('unpaid')}
            className={`pb-3 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 ${activeTab === 'unpaid' ? 'text-rose-600 border-rose-400' : 'text-slate-500 border-transparent hover:text-slate-900'}`}
          >
            Unpaid ({summaryStats.countUnpaid})
          </button>
        </div>

        {/* --- Content Area --- */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin mb-4" />
            <span className="text-xs tracking-wider uppercase">Loading Ledger...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">

            {activeTab === 'paid' && filteredSalaries.length === 0 && (
              <div className="col-span-full glass-panel p-12 rounded-2xl text-center text-slate-500 italic text-sm shadow-xl flex flex-col items-center gap-3">
                <FileSearch className="w-8 h-8 text-slate-600" />
                No paid records match your filters.
              </div>
            )}
            {activeTab === 'paid' && filteredSalaries.map((salary) => {
              const isChecked = selectedIds.includes(salary.id)
              return (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  key={salary.id}
                  onClick={() => setSelectedSalary(salary)}
                  className={`glass-panel p-6 rounded-2xl relative shadow-xl hover:border-[#d4af37]/30 transition-all border cursor-pointer group ${
                    isChecked && isSelectMode ? 'border-[#d4af37]/40 bg-[#d4af37]/5' : 'border-slate-900/5'
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      {isSelectMode && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedIds(prev => [...prev, salary.id])
                            else setSelectedIds(prev => prev.filter(id => id !== salary.id))
                          }}
                          className="w-4 h-4 rounded border-slate-900/10 bg-white text-[#8a6d1f] focus:ring-0 accent-[#d4af37] cursor-pointer transition-all hover:scale-110 shrink-0"
                        />
                      )}
                      <div className="w-10 h-10 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 flex items-center justify-center text-slate-900 font-bold text-sm">
                        {(salary.profiles?.branch?.toLowerCase().includes('head office') || salary.profiles?.branch?.toLowerCase() === 'hq' || salary.profiles?.profile_type === 'head_office') ? (
                          <Building2 className="w-5 h-5 text-[#8a6d1f]" />
                        ) : (
                          salary.profiles?.full_name?.charAt(0) || '?'
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 group-hover:text-[#8a6d1f] transition-colors">{salary.profiles?.full_name || 'Unknown Employee'}</h4>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider block">{salary.profiles?.branch || 'HQ'}</span>
                      </div>
                    </div>
                    <div className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-600 text-[10px] font-bold border border-emerald-500/20">
                      Paid
                    </div>
                  </div>

                  <div className="my-4">
                    <h3 className="text-xl font-bold text-slate-900 mb-1">
                      {Number(salary.amount).toLocaleString()} <span className="text-xs text-slate-500 font-normal">BDT</span>
                    </h3>
                  </div>

                  {/* Joining Date info in Paid view */}
                  <div className="text-[10px] text-slate-500 mb-3 flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 text-[#8a6d1f]" />
                    Joined: {salary.profiles?.joining_date ? new Date(salary.profiles.joining_date).toLocaleDateString() : (salary.profiles?.created_at ? new Date(salary.profiles.created_at).toLocaleDateString() : 'N/A')}
                  </div>

                  <div className="pt-4 border-t border-slate-900/5 flex justify-between items-center text-[10px]">
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      {new Date(salary.payment_date).toLocaleDateString()}
                    </div>
                    <span className="text-slate-500 font-mono">
                      {salary.transaction_id || 'No Trx ID'}
                    </span>
                  </div>
                </motion.div>
              )
            })}

            {activeTab === 'unpaid' && filteredUnpaid.length === 0 && (
              <div className="col-span-full glass-panel p-12 rounded-2xl text-center text-slate-500 italic text-sm shadow-xl flex flex-col items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                Everyone has been paid for this month!
              </div>
            )}
            {activeTab === 'unpaid' && filteredUnpaid.map((user) => (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                key={user.id}
                className="glass-panel p-6 rounded-2xl relative shadow-xl border border-rose-500/20 hover:border-rose-500/40 transition-all bg-rose-500/[0.02]"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 flex items-center justify-center text-slate-900 font-bold text-sm">
                      {(user.branch?.toLowerCase().includes('head office') || user.branch?.toLowerCase() === 'hq' || user.profile_type === 'head_office') ? (
                        <Building2 className="w-5 h-5 text-[#8a6d1f]" />
                      ) : (
                        user.full_name?.charAt(0) || '?'
                      )}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">{user.full_name || 'Unknown Employee'}</h4>
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider block">{user.branch || 'HQ'}</span>
                    </div>
                  </div>
                  <div className="px-2 py-1 rounded-md bg-rose-500/10 text-rose-600 text-[10px] font-bold border border-rose-500/20 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Unpaid
                  </div>
                </div>

                <div className="my-4">
                  <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Base Remuneration</p>
                  <h3 className="text-xl font-bold text-slate-900 mb-1">
                    {user.salary ? Number(user.salary).toLocaleString() : '0'} <span className="text-xs text-slate-500 font-normal">BDT</span>
                  </h3>
                </div>

                {/* Joining Date info in Unpaid view */}
                <div className="text-[10px] text-slate-500 mb-4 flex items-center gap-1.5 bg-white p-2 rounded-lg border border-slate-900/5">
                  <Calendar className="w-3.5 h-3.5 text-[#8a6d1f]" />
                  Joined: <span className="text-slate-900 font-medium">{user.joining_date ? new Date(user.joining_date).toLocaleDateString() : (user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A')}</span>
                </div>

                <div className="pt-4 border-t border-slate-900/5">
                  <a href={`/admin/users?user=${user.id}`} className="block text-center w-full bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 font-semibold py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all">
                    Pay Salary
                  </a>
                </div>
              </motion.div>
            ))}

          </div>
        )}
      </div>

      {/* FULL DETAILS MODAL */}
      <AnimatePresence>
        {selectedSalary && (
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
              className="glass-panel p-6 rounded-2xl max-w-md w-full relative shadow-2xl overflow-y-auto max-h-[90vh] border border-[#d4af37]/30"
            >
              <div className="flex justify-between items-start border-b border-slate-900/5 pb-4 mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Disbursement Details</h3>
                  <p className="text-[10px] text-slate-500 mt-1">Full audit log of this payment.</p>
                </div>
                <button onClick={() => setSelectedSalary(null)} className="text-slate-500 hover:text-slate-900 p-2.5 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 font-sans text-sm">
                <div className="flex justify-between border-b border-slate-900/5 pb-2">
                  <span className="text-slate-500">Employee:</span>
                  <span className="text-slate-900 font-bold">{selectedSalary.profiles?.full_name}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900/5 pb-2">
                  <span className="text-slate-500">Branch:</span>
                  <span className="text-slate-900">{selectedSalary.profiles?.branch || 'N/A'}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900/5 pb-2">
                  <span className="text-slate-500">Basic Paid:</span>
                  <span className="text-slate-900">{basicOf(selectedSalary).toLocaleString()} BDT</span>
                </div>
                <div className="flex justify-between border-b border-slate-900/5 pb-2">
                  <span className="text-slate-500">Overtime:</span>
                  <span className="text-slate-900">{Number(selectedSalary.overtime_amount || 0).toLocaleString()} BDT</span>
                </div>
                <div className="flex justify-between border-b border-slate-900/5 pb-2">
                  <span className="text-slate-500">Bonus:</span>
                  <span className="text-slate-900">{Number(selectedSalary.bonus_amount || 0).toLocaleString()} BDT</span>
                </div>
                <div className="flex justify-between border-b border-slate-900/5 pb-2">
                  <span className="text-slate-500">Sales Commission:</span>
                  <span className="text-slate-900">{Number(selectedSalary.sales_commission || 0).toLocaleString()} BDT</span>
                </div>
                <div className="flex justify-between border-b border-slate-900/5 pb-2">
                  <span className="text-slate-500">Tiffin Bill:</span>
                  <span className="text-slate-900">{Number(selectedSalary.tiffin_bill || 0).toLocaleString()} BDT</span>
                </div>
                <div className="flex justify-between border-b border-slate-900/5 pb-2">
                  <span className="text-slate-500">Total Paid:</span>
                  <span className="text-emerald-600 font-bold">{Number(selectedSalary.amount).toLocaleString()} BDT</span>
                </div>
                <div className="flex justify-between border-b border-slate-900/5 pb-2">
                  <span className="text-slate-500">Payment Date:</span>
                  <span className="text-slate-900">{new Date(selectedSalary.payment_date).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900/5 pb-2">
                  <span className="text-slate-500">Transaction ID:</span>
                  <span className="text-slate-900 font-mono">{selectedSalary.transaction_id || 'N/A'}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900/5 pb-2">
                  <span className="text-slate-500">System Logged At:</span>
                  <span className="text-slate-500 text-xs">{new Date(selectedSalary.created_at).toLocaleString()}</span>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-900/5">
                <button
                  type="button"
                  onClick={() => handleExportSingleSalaryPdf(selectedSalary)}
                  className="w-full py-3 rounded-xl bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 text-[#8a6d1f] text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm hover:shadow-[#d4af37]/10"
                >
                  <Download className="w-4 h-4" />
                  Export Voucher (PDF)
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <IssueSalaryModal
        isOpen={showIssueModal}
        onClose={() => setShowIssueModal(false)}
        onSuccess={() => fetchData()}
      />
    </div>
  )
}
