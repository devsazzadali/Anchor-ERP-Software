'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  DollarSign, Briefcase, Calendar, Search, RefreshCw, Landmark, TrendingUp, FileText, Sparkles, BarChart2
} from 'lucide-react'
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid 
} from 'recharts'
import * as XLSX from 'xlsx'
import { generatePdf } from '@/lib/pdf-generator'

// the ledger comes from
// /api/company-expenses. The localStorage DATA fallback
// (aura_company_expenses, audit A9/C41) is deleted — the API is
// the only source. The realtime channel is replaced with
// refetch on mount + window focus + a 30s interval.

export default function UserExpenses() {
  const [expenses, setExpenses] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [userName, setUserName] = useState('Premium Client')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showExportDropdown, setShowExportDropdown] = useState(false)
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [branches, setBranches] = useState<any[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    const sessionStr = localStorage.getItem('aura_session')
    if (sessionStr) {
      try {
        const session = JSON.parse(sessionStr)
        setUserName(session.user?.full_name || 'Premium Client')
      } catch (e) {}
    }
  }, [])

  const fetchExpenses = async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/company-expenses')
      if (!res.ok) throw new Error('Failed to fetch expenses')
      const data = await res.json()
      setExpenses(data.expenses || [])
      setBranches(data.branches || [])
    } catch (err: any) {
      console.error('Error fetching expenses:', err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleExportCSV = () => {
    const selectedExpenses = filteredExpenses
    if (selectedExpenses.length === 0) return

    const headers = [
      'Purpose / Work description',
      'Branch',
      'Amount (BDT)',
      'Log Date & Time',
      'Logged By'
    ]

    const rows = selectedExpenses.map(e => {
      const escape = (val: any) => {
        const text = val === null || val === undefined ? '' : String(val)
        return `"${text.replace(/"/g, '""')}"`
      }

      return [
        escape(e.purpose),
        escape(e.branch_name || 'Head Office'),
        e.total_amount,
        escape(new Date(e.created_at).toLocaleString()),
        escape(e.created_by_name || 'System Auto')
      ].join(',')
    })

    const csvContent = [headers.join(','), ...rows].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `company_expenses_export_${new Date().toISOString().slice(0,10)}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleExportExcel = () => {
    const selectedExpenses = filteredExpenses
    if (selectedExpenses.length === 0) return

    const dataToExport = selectedExpenses.map(e => ({
      'Purpose / Work description': e.purpose,
      'Branch': e.branch_name || 'Head Office',
      'Amount (BDT)': e.total_amount,
      'Log Date & Time': new Date(e.created_at).toLocaleString(),
      'Logged By': e.created_by_name || 'System Auto'
    }))

    const worksheet = XLSX.utils.json_to_sheet(dataToExport)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ExpensesData')
    XLSX.writeFile(workbook, `company_expenses_export_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  const getExportDateRange = () => {
    if (dateFrom || dateTo) {
      return `${dateFrom || 'Start'} to ${dateTo || 'Present'}`
    }
    if (filteredExpenses.length === 0) return 'All Time'
    const timestamps = filteredExpenses.map(r => new Date(r.created_at).getTime()).filter(t => !isNaN(t))
    if (timestamps.length === 0) return 'All Time'
    const minDate = new Date(Math.min(...timestamps)).toLocaleDateString('en-GB')
    const maxDate = new Date(Math.max(...timestamps)).toLocaleDateString('en-GB')
    return minDate === maxDate ? minDate : `${minDate} to ${maxDate}`
  }

  const handleExportPDF = async () => {
    const selectedExpenses = filteredExpenses
    if (selectedExpenses.length === 0) return

    const columns = [
      'Purpose',
      'Branch',
      'Amount (BDT)',
      'Log Date & Time',
      'Logged By'
    ]

    const rows = selectedExpenses.map(e => [
      e.purpose || '',
      e.branch_name || 'Head Office',
      e.total_amount || 0,
      new Date(e.created_at).toLocaleString(),
      e.created_by_name || 'System Auto'
    ])

    const totalAmount = selectedExpenses.reduce((sum, e) => sum + Number(e.total_amount), 0)

    await generatePdf('Company Expenses', columns, rows, {
      dateRange: getExportDateRange(),
      summaryData: [
        { label: 'Total Amount', value: `${totalAmount.toLocaleString()} BDT` }
      ],
      filename: `expenses_${new Date().getTime()}.pdf`
    })
  }

  useEffect(() => {
    fetchExpenses()

    // Polling replaces the realtime subscription.
    const interval = setInterval(fetchExpenses, 30000)
    const onFocus = () => fetchExpenses()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // Filter
  const branchFilteredExpenses = expenses.filter(e => {
    if (selectedBranchId === 'all') return true;
    if (e.is_all_branches) return true;
    if (selectedBranchId === 'head_office') return !e.branch_id;
    return e.branch_id === selectedBranchId;
  });

  const totalSpent = branchFilteredExpenses.reduce((sum, e) => sum + (parseFloat(e.total_amount || 0) || 0), 0)

  const filteredExpenses = branchFilteredExpenses.filter(e => {
    let match = (e.purpose || '').toLowerCase().includes(search.toLowerCase());
    
    if (dateFrom) {
      match = match && new Date(e.created_at) >= new Date(dateFrom);
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      match = match && new Date(e.created_at) <= end;
    }
    
    return match;
  });

  const setDateRange = (months: number) => {
    const now = new Date()
    const from = new Date(now)
    from.setMonth(from.getMonth() - months)
    setDateFrom(from.toISOString().slice(0, 10))
    setDateTo(now.toISOString().slice(0, 10))
  }

  return (
    <div className="min-h-screen flex bg-white text-slate-900 font-sans md:ml-64 relative overflow-hidden">
      
      {/* Dynamic Background neon glows */}
      <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-[#d4af37]/5 rounded-full filter blur-[150px] pointer-events-none mix-blend-multiply" />
      <div className="absolute bottom-[-10%] left-[10%] w-[50%] h-[50%] bg-[#10b981]/5 rounded-full filter blur-[150px] pointer-events-none mix-blend-multiply" />
      <div className="absolute top-[40%] left-[40%] w-[30%] h-[30%] bg-blue-500/5 rounded-full filter blur-[120px] pointer-events-none mix-blend-multiply" />

      {/* Main Core Dashboard panel */}
      <div className="flex-1 flex flex-col p-6 sm:p-10 overflow-y-auto max-h-screen relative z-10">
        
        {/* UPPER STATUS BAR */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }} 
          animate={{ opacity: 1, y: 0 }} 
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-10 pb-6 relative"
        >
          <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-[#d4af37]/30 via-[#d4af37]/15 to-transparent" />
          
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[9px] bg-gradient-to-r from-[#d4af37]/20 to-[#d4af37]/5 text-[#8a6d1f] border border-[#d4af37]/30 px-3 py-1.5 rounded-full font-bold uppercase tracking-widest flex items-center gap-1.5 shadow-[0_0_20px_rgba(212,175,55,0.15)] backdrop-blur-md">
                <Landmark className="w-3 h-3" />
                Dossier Verified
              </span>
              <span className="text-[9px] bg-slate-900/[0.04] text-slate-500 border border-slate-900/10 px-3 py-1.5 rounded-full font-bold uppercase tracking-widest backdrop-blur-md">
                Finance Dept
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tighter text-slate-900 font-serif mb-1.5">
              Company <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#d4af37] via-[#f1d570] to-[#d4af37]">Outlays Ledger</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 tracking-wide font-light">Welcome back, <span className="text-slate-900 font-medium">{userName}</span>. Transparency report on operational capital.</p>
          </div>

          <button 
            onClick={fetchExpenses}
            className={`p-4 rounded-2xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10 text-slate-500 hover:text-[#8a6d1f] transition-all duration-300 cursor-pointer shadow-lg hover:shadow-[0_0_25px_rgba(212,175,55,0.2)] group self-start sm:self-auto ${isLoading ? 'animate-pulse border-[#d4af37]/50 text-[#8a6d1f]' : ''}`}
          >
            <RefreshCw className={`w-5 h-5 transition-transform duration-700 ease-out group-hover:rotate-180 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </motion.div>

        {/* 2 STUNNING OVERVIEW METRIC CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="glass-panel p-5 sm:p-6 rounded-3xl relative shadow-2xl border border-slate-900/5 bg-gradient-to-br from-white to-black overflow-hidden group flex flex-col justify-between"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-[#10b981]/0 via-[#10b981]/5 to-[#10b981]/0 opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none -translate-x-full group-hover:translate-x-full" />
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#10b981]/30 to-transparent opacity-60" />
            
            <div className="relative z-10 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2 flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 text-slate-500 shrink-0" /> Total Company Outlays</span>
                <h3 className="text-3xl sm:text-4xl font-black text-slate-900 font-mono tracking-tighter group-hover:text-slate-500 transition-colors drop-shadow-lg truncate">
                  <span className="text-slate-500 mr-1">৳</span>{totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </h3>
                <p className="text-[11px] text-slate-500 mt-3 flex items-center gap-2 flex-wrap">
                  <span className="bg-[#10b981]/10 text-slate-500 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border border-[#10b981]/20 shrink-0">Realtime</span> 
                  <span>Aggregated ledger value</span>
                </p>
              </div>
              <div className="p-3.5 sm:p-4 bg-gradient-to-br from-[#10b981]/20 to-[#10b981]/5 border border-[#10b981]/20 rounded-2xl text-slate-500 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-3 shrink-0">
                <DollarSign className="w-7 h-7 sm:w-8 sm:h-8" />
              </div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="glass-panel p-5 sm:p-6 rounded-3xl relative shadow-2xl border border-slate-900/5 bg-gradient-to-br from-white to-black overflow-hidden group flex flex-col justify-between"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-[#d4af37]/0 via-[#d4af37]/5 to-[#d4af37]/0 opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none -translate-x-full group-hover:translate-x-full" />
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/30 to-transparent opacity-60" />
            
            <div className="relative z-10 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Company Budget Logs</span>
                <h3 className="text-3xl sm:text-4xl font-black text-slate-900 font-mono tracking-tighter group-hover:text-[#8a6d1f] transition-colors drop-shadow-lg truncate">
                  {branchFilteredExpenses.length} <span className="text-sm sm:text-base text-slate-500 font-sans tracking-normal ml-1 font-medium">Entries</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-3 flex items-center gap-2 flex-wrap">
                  <Sparkles className="w-3.5 h-3.5 text-[#8a6d1f]/80 shrink-0" /> 
                  <span className="bg-[#d4af37]/10 text-[#8a6d1f] px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border border-[#d4af37]/20 shrink-0">Active</span> 
                  <span>Audit footprints streamed</span>
                </p>
              </div>
              <div className="p-3.5 sm:p-4 bg-gradient-to-br from-[#d4af37]/20 to-[#d4af37]/5 border border-[#d4af37]/20 rounded-2xl text-[#8a6d1f] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3 shrink-0">
                <TrendingUp className="w-7 h-7 sm:w-8 sm:h-8" />
              </div>
            </div>
          </motion.div>
        </div>

        <div className="mb-8">
          
          {/* READ-ONLY EXPENSES TABLE (Full Width) */}
          <motion.div 
            initial={{ opacity: 0, y: 30 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: 0.3, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="glass-panel p-5 sm:p-6 rounded-3xl relative shadow-2xl border border-slate-900/5 bg-gradient-to-b from-white to-black w-full overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/20 to-transparent opacity-40" />
            
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-5 mb-8 relative z-10">
              <div className="flex-1 w-full xl:w-auto">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Company Expenditure Ledger</span>
                <div className="flex flex-wrap items-center gap-4">
                  <h3 className="text-lg font-bold text-slate-900 font-serif">Transactions</h3>
                      {/* Select Mode UI removed */}
                      <div className="relative">
                        <button
                          onClick={() => setShowExportDropdown(prev => !prev)}
                          className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-[#d4af37] to-white text-black hover:brightness-110 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(212,175,55,0.3)] cursor-pointer border border-[#d4af37]/50 whitespace-nowrap"
                        >
                          <FileText className="w-4 h-4 shrink-0" />
                          <span>Export ({filteredExpenses.length}) ▼</span>
                        </button>
                      
                      <AnimatePresence>
                        {showExportDropdown && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowExportDropdown(false)} />
                            <motion.div 
                              initial={{ opacity: 0, y: -10, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -10, scale: 0.95 }}
                              transition={{ duration: 0.2 }}
                              className="absolute right-0 mt-2 w-48 bg-white border border-[#d4af37]/20 rounded-2xl shadow-[0_20px_40px_-15px_rgba(0,0,0,0.25)] py-2 z-20 flex flex-col backdrop-blur-xl"
                            >
                              <button
                                onClick={() => {
                                  handleExportExcel();
                                  setShowExportDropdown(false);
                                }}
                                className="px-4 py-2.5 text-left text-xs font-semibold hover:bg-[#d4af37]/10 hover:text-[#8a6d1f] text-slate-600 transition-colors cursor-pointer flex items-center gap-2"
                              >
                                Export Excel (.xlsx)
                              </button>
                               <button
                                onClick={() => {
                                  handleExportCSV();
                                  setShowExportDropdown(false);
                                }}
                                className="px-4 py-2.5 text-left text-xs font-semibold hover:bg-[#d4af37]/10 hover:text-[#8a6d1f] text-slate-600 transition-colors cursor-pointer flex items-center gap-2"
                              >
                                Export CSV (.csv)
                              </button>
                              <button
                                onClick={() => {
                                  handleExportPDF();
                                  setShowExportDropdown(false);
                                }}
                                className="px-4 py-2.5 text-left text-xs font-semibold hover:bg-[#d4af37]/10 hover:text-[#8a6d1f] text-slate-600 transition-colors cursor-pointer flex items-center gap-2"
                              >
                                Export PDF (.pdf)
                              </button>
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                </div>
              </div>

              {/* Filters & Search */}
              <div className="flex flex-col sm:flex-row items-center gap-3 w-full xl:w-auto">
                {/* Branch Filter */}
                <div className="w-full sm:w-auto">
                  <select
                    value={selectedBranchId}
                    onChange={(e) => setSelectedBranchId(e.target.value)}
                    className="w-full sm:w-48 bg-white border border-slate-900/10 hover:border-[#d4af37]/30 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/20 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)] appearance-none cursor-pointer"
                    style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23D4AF37%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem top 50%', backgroundSize: '0.65rem auto' }}
                  >
                    <option value="all">All Branches</option>
                    <option value="head_office">Head Office</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition-all ${showFilters ? 'border-[#d4af37]/40 bg-[#d4af37]/10 text-[#8a6d1f]' : 'border-slate-900/10 bg-white text-slate-500 hover:border-slate-900/20 hover:text-slate-900'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                  Filters
                  {(dateFrom || dateTo) && <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37]" />}
                </button>

                {/* Search */}
                <div className="relative w-full sm:w-64 shrink-0 group">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-[#8a6d1f] transition-colors" />
                  <input
                    type="text"
                    placeholder="Search ledger..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-white border border-slate-900/10 hover:border-[#d4af37]/30 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/20 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"
                  />
                </div>
              </div>
            </div>

            {/* Filters Panel */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mb-6 bg-white rounded-xl border border-slate-900/5"
                >
                  <div className="p-4 flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-[9px] text-slate-600 uppercase tracking-wider mb-1">From</label>
                      <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-white border border-slate-900/10 hover:border-[#d4af37]/30 rounded-xl py-2 px-3 text-[11px] text-slate-500 focus:outline-none focus:border-[#d4af37]/40 cursor-pointer shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)] transition-all" />
                    </div>
                    <div>
                      <label className="block text-[9px] text-slate-600 uppercase tracking-wider mb-1">To</label>
                      <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-white border border-slate-900/10 hover:border-[#d4af37]/30 rounded-xl py-2 px-3 text-[11px] text-slate-500 focus:outline-none focus:border-[#d4af37]/40 cursor-pointer shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)] transition-all" />
                    </div>
                    <button onClick={() => setDateRange(1)} className="px-3 py-2 rounded-xl border border-slate-900/10 bg-slate-900/[0.04] text-[10px] text-slate-500 hover:border-[#d4af37]/30 hover:text-slate-900 transition-all font-semibold">
                      Last 1 Month
                    </button>
                    <button onClick={() => setDateRange(3)} className="px-3 py-2 rounded-xl border border-slate-900/10 bg-slate-900/[0.04] text-[10px] text-slate-500 hover:border-[#d4af37]/30 hover:text-slate-900 transition-all font-semibold">
                      Last 3 Months
                    </button>
                    <button onClick={() => setDateRange(6)} className="px-3 py-2 rounded-xl border border-slate-900/10 bg-slate-900/[0.04] text-[10px] text-slate-500 hover:border-[#d4af37]/30 hover:text-slate-900 transition-all font-semibold">
                      Last 6 Months
                    </button>

                    {(dateFrom || dateTo) && (
                      <button
                        onClick={() => { setDateFrom(''); setDateTo('') }}
                        className="px-3 py-2 rounded-xl border border-slate-900/10 bg-slate-900/[0.04] text-[10px] text-rose-600 hover:border-rose-500/20 transition-all font-semibold flex items-center gap-1"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        Clear Dates
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* LIST */}
            {(dateFrom || dateTo) && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] bg-[#d4af37]/20 text-[#8a6d1f] border border-[#d4af37]/30 px-3 py-1.5 rounded-lg font-bold tracking-wider flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                  Filtered by Date: {dateFrom || 'Start'} to {dateTo || 'Present'}
                </span>
              </div>
            )}
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              <AnimatePresence>
                {filteredExpenses.map((exp, index) => {
                  const isChecked = selectedIds.includes(exp.id)
                  return (
                    <motion.div 
                      key={exp.id} 
                      initial={{ opacity: 0, x: -20, filter: 'blur(4px)' }}
                      animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: index * 0.04, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                      className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 transition-all duration-300 group relative overflow-hidden ${
                        isChecked && isSelectMode 
                          ? 'bg-[#d4af37]/10 border-[#d4af37]/50 shadow-[0_0_20px_rgba(212,175,55,0.15)]' 
                          : 'bg-white border-slate-900/5 hover:border-[#d4af37]/40 hover:bg-slate-900/[0.04] hover:shadow-lg'
                      }`}
                    >
                      {/* Magical glow effect on hover */}
                      <div className="absolute inset-0 bg-gradient-to-r from-[#d4af37]/0 via-[#d4af37]/10 to-[#d4af37]/0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none -translate-x-full group-hover:translate-x-full" />
                      
                      <div className="flex items-center gap-4 min-w-0 flex-1 relative z-10">
                        <div className="w-12 h-12 rounded-[14px] bg-gradient-to-tr from-[#d4af37]/20 to-white border border-[#d4af37]/30 flex items-center justify-center shrink-0 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] group-hover:shadow-[0_0_20px_rgba(212,175,55,0.25)] group-hover:scale-105 transition-all duration-400">
                          <Briefcase className="w-5 h-5 text-[#8a6d1f]" />
                        </div>
                        
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <span className="text-xs font-bold text-slate-900/90 block truncate group-hover:text-slate-900 transition-colors">{exp.purpose}</span>
                          
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 font-mono">
                            <span className="bg-[#d4af37]/10 text-[#8a6d1f] px-2 py-0.5 rounded border border-[#d4af37]/20 font-bold uppercase tracking-wider shrink-0">
                              {exp.branch_name || 'Head Office'}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0 bg-slate-900/[0.04] px-1.5 py-0.5 rounded-md border border-slate-900/5">
                              <Calendar className="w-3 h-3 text-[#8a6d1f]/80" />
                              <span>{new Date(exp.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                            </div>
                            <span className="w-1 h-1 rounded-full bg-slate-900/[0.09] shrink-0 hidden sm:inline-block" />
                            <span className="truncate">By <span className="text-slate-600 font-medium">{exp.created_by_name || 'System Auto'}</span></span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 md:gap-10 text-right shrink-0 relative z-10 pl-0 sm:pl-6 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-900/10 sm:border-transparent whitespace-nowrap">
                        <div className="flex flex-col items-start sm:items-end">
                          <span className="text-[8px] text-slate-500 uppercase tracking-widest font-bold mb-1">Total Amount</span>
                          <span className="text-xs sm:text-sm font-bold text-slate-900 font-mono opacity-90">
                            ৳{parseFloat(exp.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex flex-col items-center sm:items-end">
                          <span className="text-[8px] text-slate-500/70 uppercase tracking-widest font-bold mb-1">Paid Amount</span>
                          <span className="text-xs sm:text-sm font-bold text-slate-500 font-mono">
                            ৳{parseFloat(exp.paid_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex flex-col items-end border-l border-slate-900/10 pl-3 sm:pl-6 md:pl-10">
                          <span className="text-[8px] text-[#8a6d1f]/80 uppercase tracking-widest font-bold mb-1">Due Amount</span>
                          <span className="text-sm sm:text-base font-bold text-[#8a6d1f] font-mono drop-shadow-[0_0_10px_rgba(212,175,55,0.3)]">
                            ৳{parseFloat(exp.due_amount !== undefined ? exp.due_amount : (exp.total_amount || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>

              {filteredExpenses.length === 0 && (
                <motion.div 
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} 
                  className="py-16 text-center text-slate-500 italic text-xs border border-dashed border-slate-900/10 rounded-2xl bg-slate-900/[0.04]"
                >
                  <Briefcase className="w-8 h-8 mx-auto mb-3 opacity-20" />
                  No company expenditures logged or matching your search.
                </motion.div>
              )}
            </div>

          </motion.div>

        </div>

      </div>

    </div>
  )
}
