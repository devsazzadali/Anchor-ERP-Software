'use client'

import React, { useState, useEffect } from 'react'
import { X, UploadCloud, Calculator, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

// data via the app's API layer only —
// GET /api/admin/salaries/issue supplies branches / employees /
// Salary ledger heads; POST /api/admin/salaries/issue issues the
// payment (server recomputes the total, generates the trx id and
// books the C20/C11 branch-cash copy in one transaction). The
// payment proof uploads through the app's storage (uploadFile).
import { uploadFile } from '@/lib/files-client'

interface IssueSalaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedUserId?: string;
  preselectedBranch?: string;
  preselectedBaseSalary?: number;
}

export default function IssueSalaryModal({
  isOpen, onClose, onSuccess, preselectedUserId, preselectedBranch, preselectedBaseSalary
}: IssueSalaryModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [branches, setBranches] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])

  const [branchId, setBranchId] = useState(preselectedBranch || '')
  const [employeeId, setEmployeeId] = useState(preselectedUserId || '')
  const [ledgerHeadId, setLedgerHeadId] = useState('')
  const [ledgerHeadName, setLedgerHeadName] = useState('')

  const [basicSalary, setBasicSalary] = useState<number>(preselectedBaseSalary || 0)
  const [overtimeAmount, setOvertimeAmount] = useState<number>(0)
  const [bonusAmount, setBonusAmount] = useState<number>(0)
  const [salesCommission, setSalesCommission] = useState<number>(0)
  const [tiffinBill, setTiffinBill] = useState<number>(0)

  const [file, setFile] = useState<File | null>(null)

  useEffect(() => {
    if (isOpen) {
      fetchInitialData()
    }
  }, [isOpen])

  const fetchInitialData = async () => {
    const res = await fetch('/api/admin/salaries/issue')
    if (!res.ok) return
    const data = await res.json()
    setBranches(data.branches || [])
    setEmployees(data.employees || [])

    // Silently fetch and set the Salary ledger head.
    // C8: deterministic order (see house-rent modal) — the route
    // returns the Salary heads name-ordered.
    const lData = data.ledger_heads || []
    if (lData.length > 0) {
      setLedgerHeadId(lData[0].id)
      setLedgerHeadName(lData[0].name)
    }
  }

  const handleBranchChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setBranchId(e.target.value)
    setEmployeeId('')
    setBasicSalary(0)
  }

  const handleEmployeeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const empId = e.target.value
    setEmployeeId(empId)
    const emp = employees.find(emp => emp.id === empId)
    if (emp) setBasicSalary(Number(emp.salary || 0))
  }

  const totalSalary = Number(basicSalary) + Number(overtimeAmount) + Number(bonusAmount) + Number(salesCommission) + Number(tiffinBill)
  const selectedEmployee = employees.find(emp => emp.id === employeeId)

  let bankDetailsText = ''
  if (selectedEmployee?.bank_info) {
    const bInfo = selectedEmployee.bank_info
    if (bInfo.bankName) {
      bankDetailsText = `Bank: ${bInfo.bankName}, A/C Name: ${bInfo.accountName || ''}, A/C No: ${bInfo.accountNumber || ''}`
    } else if (bInfo.mobileBankingProvider) {
      bankDetailsText = `${bInfo.mobileBankingProvider} - ${bInfo.mobileBankingNumber || ''}`
    } else if (bInfo.mobileNumber) {
      bankDetailsText = `${bInfo.walletType || 'Mobile Wallet'} - ${bInfo.mobileNumber}`
    } else {
      bankDetailsText = JSON.stringify(bInfo)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employeeId || totalSalary <= 0) return setError('Invalid employee or salary amount.')
    if (!ledgerHeadId) return setError('System Error: Salary Ledger Head not found. Please contact admin.')

    setIsSubmitting(true)
    setError(null)
    try {
      let fileUrl = ''
      if (file) {
        const fileExt = file.name.split('.').pop()
        const fileName = `${employeeId}-${Date.now()}.${fileExt}`
        fileUrl = await uploadFile('payment_proofs', file, `salaries/${fileName}`)
      }

      // C20/C11 now live server-side: POST /api/admin/salaries/issue
      // inserts the salary payment AND its branch-cash copy (stamped
      // with salary_payment_id so combined reporting counts the
      // salary once; category = the ledger head's name) in one
      // transaction, recomputes the total from the components, and
      // returns the transaction id it stored.
      const empName = employees.find(em => em.id === employeeId)?.full_name || 'Employee';

      const res = await fetch('/api/admin/salaries/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          branch_id: branchId || null,
          basic_salary: basicSalary,
          overtime_amount: overtimeAmount,
          bonus_amount: bonusAmount,
          sales_commission: salesCommission,
          tiffin_bill: tiffinBill,
          ledger_head_id: ledgerHeadId,
          payment_proof_url: fileUrl,
          account: bankDetailsText, // store the account details so admin knows where it was sent
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Failed to process salary payment.')
      const newTrxId = j.transaction_id

      // Trigger Email
      const selBranchObj = branches.find(b => b.id === branchId);
      fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SALARY_PAID',
          payload: {
            userId: employeeId,
            userName: empName,
            email: null, // email will be fetched in backend if null
            month: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
            amount: totalSalary,
            base_salary: basicSalary,
            overtime: overtimeAmount,
            bonus: bonusAmount,
            sales_commission: salesCommission,
            tiffin_bill: tiffinBill,
            currency: 'BDT',
            transactionId: newTrxId,
            paymentMethod: bankDetailsText || 'Payroll Bank Account',
            branchName: selBranchObj?.name || 'Head Office'
          }
        })
      }).catch(e => console.error('Failed to trigger salary email', e));

      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to process salary payment.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const branchEmps = employees.filter(emp => !branchId || emp.branch_id === branchId)

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-slate-950/50 z-50 flex justify-center items-center p-4">
        <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="glass-panel p-6 rounded-2xl max-w-md w-full relative border border-[#1ca34c]/30 max-h-[90vh] overflow-y-auto custom-scrollbar">
          <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-900/5">
            <h3 className="text-xl font-bold text-slate-900">Issue Salary</h3>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-900 p-2.5 rounded-lg"><X className="w-5 h-5" /></button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="p-3 bg-rose-500/10 text-rose-600 border border-rose-500/20 rounded-xl text-xs">{error}</div>}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Branch</label>
                <select value={branchId} onChange={handleBranchChange} disabled={!!preselectedUserId} className="w-full bg-white border border-slate-900/10 rounded-xl py-2 px-3 text-xs text-slate-900 disabled:opacity-50">
                  <option value="" className="bg-white text-slate-900">Select Branch</option>
                  {branches.map(b => <option key={b.id} value={b.id} className="bg-white text-slate-900">{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Employee</label>
                <select value={employeeId} onChange={handleEmployeeChange} disabled={!!preselectedUserId} required className="w-full bg-white border border-slate-900/10 rounded-xl py-2 px-3 text-xs text-slate-900 disabled:opacity-50">
                  <option value="" disabled className="bg-white text-slate-900">Select Employee</option>
                  {branchEmps.map(emp => <option key={emp.id} value={emp.id} className="bg-white text-slate-900">{emp.full_name}</option>)}
                </select>
              </div>
            </div>

            {employeeId && (
              bankDetailsText ? (
                <div className="bg-[#1ca34c]/10 border border-[#1ca34c]/30 rounded-xl p-3 my-2">
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Payment Account (Send money here)</p>
                  <p className="text-xs text-slate-900 font-medium">{bankDetailsText}</p>
                </div>
              ) : (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 my-2 text-rose-600 text-xs">
                  No bank account setup for this employee yet. Please update their profile.
                </div>
              )
            )}

            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Basic Salary (BDT)</label>
                <input type="number" min="0" value={basicSalary} onChange={(e) => setBasicSalary(Number(e.target.value))} required className="w-full bg-white border border-slate-900/10 rounded-xl py-2 px-3 text-slate-900 focus:border-[#1ca34c]/50 focus:outline-none" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Overtime (BDT)</label>
                  <input type="number" min="0" value={overtimeAmount} onChange={(e) => setOvertimeAmount(Number(e.target.value))} className="w-full bg-white border border-slate-900/10 rounded-xl py-2 px-3 text-slate-900 focus:border-[#1ca34c]/50 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Bonus (BDT)</label>
                  <input type="number" min="0" value={bonusAmount} onChange={(e) => setBonusAmount(Number(e.target.value))} className="w-full bg-white border border-slate-900/10 rounded-xl py-2 px-3 text-slate-900 focus:border-[#1ca34c]/50 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Sales Comm (BDT)</label>
                  <input type="number" min="0" value={salesCommission} onChange={(e) => setSalesCommission(Number(e.target.value))} className="w-full bg-white border border-slate-900/10 rounded-xl py-2 px-3 text-slate-900 focus:border-[#1ca34c]/50 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Tiffin Bill (BDT)</label>
                  <input type="number" min="0" value={tiffinBill} onChange={(e) => setTiffinBill(Number(e.target.value))} className="w-full bg-white border border-slate-900/10 rounded-xl py-2 px-3 text-slate-900 focus:border-[#1ca34c]/50 focus:outline-none" />
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-900/5 flex justify-between items-center mt-2">
              <span className="text-xs text-slate-500 uppercase tracking-widest font-bold">Total Payout</span>
              <span className="text-lg font-bold text-[#15803d]">{totalSalary.toLocaleString()} BDT</span>
            </div>

            <div>
              <label className="text-xs text-slate-500 mb-1 block uppercase tracking-wider font-bold">Payment Proof (Screenshot)</label>
              <div className="border border-dashed border-slate-900/10 rounded-xl p-4 text-center hover:border-[#1ca34c]/50 transition-colors bg-white">
                <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" id="proof-upload" accept="image/*" />
                <label htmlFor="proof-upload" className="cursor-pointer flex flex-col items-center justify-center gap-2">
                  <UploadCloud className="w-6 h-6 text-[#15803d]" />
                  <span className="text-xs text-slate-500">{file ? file.name : 'Click to upload proof (TrxID / Screenshot)'}</span>
                </label>
              </div>
            </div>

            <button type="submit" disabled={isSubmitting || totalSalary <= 0} className="w-full py-3 bg-[#1ca34c] text-white font-bold uppercase tracking-widest text-xs rounded-full hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center gap-2 mt-4">
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
              {isSubmitting ? 'Processing...' : 'Confirm Salary Payment'}
            </button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
