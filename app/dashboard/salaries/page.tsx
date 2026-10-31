'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Landmark, Calendar, CheckCircle2, Search, FileSearch, Download, FileText } from 'lucide-react'
import { generatePdf } from '@/lib/pdf-generator'
import * as XLSX from 'xlsx'

// branches, own profile basics and own
// salary payments come from /api/me/financials (caller-scoped).

export default function EmployeeSalaries() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-500">Loading ledger...</div>}>
      <EmployeeSalariesContent />
    </Suspense>
  )
}

function EmployeeSalariesContent() {
  const [salaries, setSalaries] = useState<any[]>([])
  const [branches, setBranches] = useState<any[]>([])
  const [userName, setUserName] = useState<string>('')
  const [profileType, setProfileType] = useState<string>('employee')
  const [isLoading, setIsLoading] = useState(true)
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showExportDropdown, setShowExportDropdown] = useState(false)
  const searchParams = useSearchParams()
  const highlightId = searchParams?.get('id')

  useEffect(() => {
    const fetchSalaries = async () => {
      try {
        const res = await fetch('/api/me/financials')
        if (!res.ok) throw new Error('Failed to fetch salaries')
        const { branches: bData, profile: profileData, salaryPayments: data } = await res.json()

        setBranches(bData || [])

        if (profileData?.full_name) setUserName(profileData.full_name)
        if (profileData?.profile_type) setProfileType(profileData.profile_type)

        setSalaries(data || [])
      } catch (err) {
        console.error('Error fetching salaries:', err)
      } finally {
        setIsLoading(false)
      }
    }
    
    fetchSalaries()
  }, [])

  useEffect(() => {
    if (highlightId && salaries.length > 0) {
      setTimeout(() => {
        // BUG-B4 FIX: Search by BOTH id and transaction_id so highlight works with either URL param
        const sal = salaries.find(s => s.id === highlightId || s.transaction_id === highlightId)
        if (sal) {
          const el = document.getElementById(`item-${sal.id}`)
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            el.classList.add('ring-2', 'ring-[#d4af37]', 'ring-offset-2', 'ring-offset-white')
            setTimeout(() => {
              el.classList.remove('ring-2', 'ring-[#d4af37]', 'ring-offset-2', 'ring-offset-white')
            }, 3000)
          }
        }
      }, 100)
    }
  }, [highlightId, salaries])

  const handleExportIndividualPdf = async (salary: any) => {
    const matchedBranch = branches.find(b => b.id === salary.branch_id)
    const rows = [
      [profileType === 'head_office' ? 'Head Office Name' : 'Employee Name', userName || (profileType === 'head_office' ? 'Head Office' : 'Employee')],
      ['Payment Date', new Date(salary.payment_date).toLocaleDateString()],
      ['Branch', matchedBranch?.name || 'Main Office'],
      ['Basic Disbursed', `${Number(salary.base_salary_at_time || salary.amount).toLocaleString()} BDT`],
      ['Overtime', `${Number(salary.overtime_amount || 0).toLocaleString()} BDT`],
      ['Bonus', `${Number(salary.bonus_amount || 0).toLocaleString()} BDT`],
      ['Sales Commission', `${Number(salary.sales_commission || 0).toLocaleString()} BDT`],
      ['Tiffin Bill', `${Number(salary.tiffin_bill || 0).toLocaleString()} BDT`],
      ['Total Amount', `${Number(salary.amount).toLocaleString()} BDT`],
      ['Destination Account', salary.account || 'N/A'],
      ['Transaction ID', salary.transaction_id || 'N/A'],
      ['Notes / Remarks', salary.notes || 'None']
    ]

    await generatePdf('Salary Disbursement Voucher', ['Specification', 'Details'], rows, {
      subtitle: `Official Payment Record - Trx: ${salary.transaction_id || 'N/A'}`,
      preparedBy: userName || (profileType === 'head_office' ? 'Head Office' : 'Employee'),
      branch: matchedBranch?.name || 'Main Office',
      summaryData: [
        { label: 'Net Disbursed Amount', value: `${Number(salary.amount).toLocaleString()} BDT` }
      ],
      filename: `Salary_Voucher_${salary.transaction_id || salary.id}.pdf`
    })
  }

  const handleExportSelectedExcel = () => {
    const targets = selectedIds.length > 0 ? salaries.filter(s => selectedIds.includes(s.id)) : salaries
    if (targets.length === 0) return
    const data = targets.map(s => {
      const b = branches.find(br => br.id === s.branch_id)
      return {
        [profileType === 'head_office' ? 'Head Office Name' : 'Employee Name']: userName || (profileType === 'head_office' ? 'Head Office' : 'Employee'),
        'Branch': b?.name || 'Main Office',
        'Basic (BDT)': salary.base_salary_at_time || salary.amount,
        'Overtime': salary.overtime_amount || 0,
        'Bonus': salary.bonus_amount || 0,
        'Sales Comm': salary.sales_commission || 0,
        'Tiffin Bill': salary.tiffin_bill || 0,
        'Total Amount (BDT)': s.amount,
        'Payment Date': new Date(s.payment_date).toLocaleDateString(),
        'Transaction ID': s.transaction_id || 'N/A',
        'Destination Account': s.account || 'N/A',
        'Notes': s.notes || 'None'
      }
    })
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'VouchersExport')
    XLSX.writeFile(wb, `My_Salary_Vouchers_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  const handleExportSelectedCSV = () => {
    const targets = selectedIds.length > 0 ? salaries.filter(s => selectedIds.includes(s.id)) : salaries
    if (targets.length === 0) return
    const data = targets.map(s => {
      const b = branches.find(br => br.id === s.branch_id)
      return {
        [profileType === 'head_office' ? 'Head Office Name' : 'Employee Name']: userName || (profileType === 'head_office' ? 'Head Office' : 'Employee'),
        'Branch': b?.name || 'Main Office',
        'Basic (BDT)': salary.base_salary_at_time || salary.amount,
        'Overtime': salary.overtime_amount || 0,
        'Bonus': salary.bonus_amount || 0,
        'Sales Comm': salary.sales_commission || 0,
        'Tiffin Bill': salary.tiffin_bill || 0,
        'Total Amount (BDT)': s.amount,
        'Payment Date': new Date(s.payment_date).toLocaleDateString(),
        'Transaction ID': s.transaction_id || 'N/A',
        'Destination Account': s.account || 'N/A',
        'Notes': s.notes || 'None'
      }
    })
    const ws = XLSX.utils.json_to_sheet(data)
    const csv = XLSX.utils.sheet_to_csv(ws)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `My_Salary_Vouchers_${new Date().toISOString().slice(0,10)}.csv`
    link.click()
  }

  const handleExportSelectedPDF = async () => {
    const targets = selectedIds.length > 0 ? salaries.filter(s => selectedIds.includes(s.id)) : salaries
    if (targets.length === 0) return
    const columns = ['Payment Date', 'Branch', 'Basic', 'Overtime', 'Bonus', 'Sales Comm', 'Tiffin', 'Total', 'Trx ID', 'Account']
    const rows = targets.map(s => {
      const b = branches.find(br => br.id === s.branch_id)
      return [
        new Date(s.payment_date).toLocaleDateString(),
        b?.name || 'Main Office',
        `${Number(s.base_salary_at_time || s.amount).toLocaleString()}`,
        `${Number(s.overtime_amount || 0).toLocaleString()}`,
        `${Number(s.bonus_amount || 0).toLocaleString()}`,
        `${Number(s.sales_commission || 0).toLocaleString()}`,
        `${Number(s.tiffin_bill || 0).toLocaleString()}`,
        `${Number(s.amount).toLocaleString()}`,
        s.transaction_id || 'N/A',
        s.account || 'N/A'
      ]
    })
    const total = targets.reduce((sum, s) => sum + Number(s.amount), 0)
    await generatePdf(`Salary Vouchers Ledger: ${userName || (profileType === 'head_office' ? 'Head Office' : 'Employee')}`, columns, rows, {
      subtitle: `Multiple Vouchers Summary (${targets.length} entries)`,
      preparedBy: userName || (profileType === 'head_office' ? 'Head Office' : 'Employee'),
      summaryData: [
        { label: 'Total Selected Amount', value: `${total.toLocaleString()} BDT` }
      ],
      filename: `My_Salary_Vouchers_${new Date().toISOString().slice(0,10)}.pdf`
    })
  }

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans">
      <div className="absolute top-[-10%] right-[-5%] w-[50%] h-[50%] bg-[#d4af37]/5 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="flex-1 p-6 lg:p-10 overflow-y-auto max-h-screen relative z-10">
        <div className="mb-8 pb-4 border-b border-slate-900/5 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-serif">
              Salary <span className="premium-text-gradient">Ledger</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">Track your disbursed salary payments and receipts.</p>
          </div>

          {salaries.length > 0 && (
            <div className="flex items-center gap-3 self-end sm:self-auto">
              {!isSelectMode ? (
                <button
                  onClick={() => setIsSelectMode(true)}
                  className="px-3 py-1.5 bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/40 text-slate-600 hover:text-slate-900 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                >
                  Select Vouchers
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
                      checked={salaries.length > 0 && selectedIds.length === salaries.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(salaries.map(s => s.id))
                        } else {
                          setSelectedIds([])
                        }
                      }}
                      className="w-3.5 h-3.5 rounded border-slate-900/10 bg-white text-[#8a6d1f] focus:ring-0 accent-[#d4af37] cursor-pointer transition-all hover:scale-110"
                    />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Select All</span>
                  </label>
                </>
              )}
              <div className="relative">
                <button
                  onClick={() => setShowExportDropdown(prev => !prev)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-[#d4af37] to-white text-black hover:brightness-110 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all hover:scale-105 active:scale-95 shadow-md shadow-[#d4af37]/10 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{selectedIds.length > 0 ? `Export (${selectedIds.length}) ▼` : 'Export All ▼'}</span>
                </button>
                  
                {showExportDropdown && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowExportDropdown(false)} />
                    <div className="absolute right-0 mt-1.5 w-36 bg-white border border-slate-900/10 rounded-lg shadow-xl py-1 z-20 flex flex-col">
                      <button
                        onClick={() => {
                          handleExportSelectedExcel();
                          setShowExportDropdown(false);
                        }}
                        className="px-3 py-1.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors cursor-pointer"
                      >
                        Export to Excel (.xlsx)
                      </button>
                      <button
                        onClick={() => {
                          handleExportSelectedCSV();
                          setShowExportDropdown(false);
                        }}
                        className="px-3 py-1.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors border-t border-slate-900/5 cursor-pointer"
                      >
                        Export to CSV (.csv)
                      </button>
                      <button
                        onClick={() => {
                          handleExportSelectedPDF();
                          setShowExportDropdown(false);
                        }}
                        className="px-3 py-1.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors border-t border-slate-900/5 cursor-pointer"
                      >
                        Export to PDF (.pdf)
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin mb-4" />
            <span className="text-xs tracking-wider uppercase">Loading Ledger...</span>
          </div>
        ) : salaries.length === 0 ? (
          <div className="glass-panel p-12 rounded-2xl text-center text-slate-500 italic text-sm shadow-xl flex flex-col items-center gap-3">
            <FileSearch className="w-8 h-8 text-slate-600" />
            No salary records found.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {salaries.map((salary) => {
              const matchedBranch = branches.find(b => b.id === salary.branch_id)
              const isChecked = selectedIds.includes(salary.id)
              return (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  key={salary.id} 
                  id={`item-${salary.id}`}
                  onClick={() => {
                    if (isSelectMode) {
                      if (isChecked) setSelectedIds(prev => prev.filter(id => id !== salary.id))
                      else setSelectedIds(prev => [...prev, salary.id])
                    }
                  }}
                  className={`glass-panel p-6 rounded-2xl relative shadow-xl hover:border-[#d4af37]/30 transition-all border group ${
                    isSelectMode ? 'cursor-pointer ' + (isChecked ? 'border-[#d4af37]/50 bg-[#d4af37]/5' : 'border-slate-900/5') : 'border-slate-900/5'
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      {isSelectMode && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // handled by onClick
                          className="w-4 h-4 rounded border-slate-900/10 bg-white text-[#8a6d1f] focus:ring-0 accent-[#d4af37] cursor-pointer transition-all hover:scale-110 shrink-0"
                        />
                      )}
                      <div className="w-10 h-10 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center text-[#8a6d1f]">
                        <Landmark className="w-5 h-5" />
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <div className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-[9px] font-bold uppercase tracking-wider flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Salary Received
                      </div>
                      {matchedBranch && (
                        <span className="text-[8px] bg-[#d4af37]/10 text-[#8a6d1f] border border-[#d4af37]/20 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                          {matchedBranch.name}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mb-5">
                    <h3 className="text-2xl font-bold text-slate-900 mb-1">
                      {Number(salary.amount).toLocaleString()} <span className="text-sm text-slate-500 font-normal">BDT</span>
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(salary.payment_date).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-900/5 space-y-2">
                    {(salary.base_salary_at_time > 0 || salary.overtime_amount > 0 || salary.bonus_amount > 0 || salary.sales_commission > 0 || salary.tiffin_bill > 0) && (
                      <div className="flex flex-wrap justify-between items-center text-[10px] text-slate-500 pb-2">
                        {salary.base_salary_at_time > 0 && <span>Basic: {salary.base_salary_at_time}</span>}
                        {salary.overtime_amount > 0 && <span>OT: {salary.overtime_amount}</span>}
                        {salary.bonus_amount > 0 && <span>Bonus: {salary.bonus_amount}</span>}
                        {salary.sales_commission > 0 && <span>Comm: {salary.sales_commission}</span>}
                        {salary.tiffin_bill > 0 && <span>Tiffin: {salary.tiffin_bill}</span>}
                      </div>
                    )}
                    {salary.account && (
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-slate-500 uppercase tracking-wider font-semibold">Destination Account</span>
                        <span className="text-slate-900 font-mono text-right truncate max-w-[150px]" title={salary.account}>{salary.account}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-500 uppercase tracking-wider font-semibold">Transaction ID</span>
                      <span className="text-slate-900 font-mono">{salary.transaction_id || 'N/A'}</span>
                    </div>
                    <button 
                      type="button"
                      onClick={() => handleExportIndividualPdf(salary)}
                      className="w-full mt-3 py-2.5 rounded-xl bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 text-[#8a6d1f] text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm hover:shadow-[#d4af37]/10"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export Voucher (PDF)
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
