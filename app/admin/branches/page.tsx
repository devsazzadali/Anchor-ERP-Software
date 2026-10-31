'use client'

export const dynamic = 'force-dynamic'

/* eslint-disable react/no-unescaped-entities */
/* eslint-disable @next/next/no-img-element */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, { useEffect, useState } from 'react'
import { MapPin, Plus, Trash2, Users, ChevronRight, X, UserCircle, Download, FileText, ImageIcon, CreditCard, Landmark, Phone, Mail, ShieldCheck, Calendar, CheckCircle2, DollarSign, Upload, AlertCircle, Eye, ArrowLeft, Search, Filter } from 'lucide-react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import * as XLSX from 'xlsx'
import { generatePdf } from '@/lib/pdf-generator'
import { uploadFile } from '@/lib/files-client'

type Branch = { id: string; name: string }
type Employee = {
  id: string;
  full_name: string;
  email?: string | null;
  phone_number: string | null;
  position: string | null;
  role: string;
  verification_status: string | null;
  is_banned: boolean;
  salary: number | null;
  bank_info?: any;
  address?: string | null;
  created_at?: string | null;
  profile_type?: string | null;
}

export default function BranchList() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeesLoading, setEmployeesLoading] = useState(false)
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([])
  const [branchPayments, setBranchPayments] = useState<any[]>([])
  const [showExportDropdown, setShowExportDropdown] = useState(false)

  // Employee Details & Salary Issue States
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [employeeDetailsLoading, setEmployeeDetailsLoading] = useState(false)
  const [employeeKyc, setEmployeeKyc] = useState<any | null>(null)
  const [employeePayments, setEmployeePayments] = useState<any[]>([])
  const [ledgerSearch, setLedgerSearch] = useState('')
  const [ledgerMonthFilter, setLedgerMonthFilter] = useState('')
  const [showEmpExportDropdown, setShowEmpExportDropdown] = useState(false)

  const [showSalaryModal, setShowSalaryModal] = useState(false)
  const [salaryAmount, setSalaryAmount] = useState('')
  const [salaryDate, setSalaryDate] = useState(new Date().toISOString().split('T')[0])
  const [salaryAccount, setSalaryAccount] = useState('')
  const [customAccount, setCustomAccount] = useState('')
  const [salaryTrxId, setSalaryTrxId] = useState('')
  const [salaryNote, setSalaryNote] = useState('')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [isSubmittingSalary, setIsSubmittingSalary] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null)

const isHeadOffice = (name?: string | null) => {
  if (!name) return false
  const n = name.trim().toLowerCase()
  return n === 'head office' || n === 'head_office' || n === 'hq' || n === 'main office' || n === 'corporate'
}

  const fetchBranches = async () => {
    try {
      const res = await fetch('/api/admin/branches')
      if (!res.ok) throw new Error('Failed to fetch branches')
      const { branches: data } = await res.json()
      const sorted = (data ?? []).sort((a: any, b: any) => {
        const aHq = isHeadOffice(a.name)
        const bHq = isHeadOffice(b.name)
        if (aHq && !bHq) return -1
        if (!aHq && bHq) return 1
        return a.name.localeCompare(b.name)
      })
      setBranches(sorted)
    } catch (e) {
      console.error('Failed to fetch branches', e)
    } finally {
      setLoading(false)
    }
  }

  const fetchBranchPayments = async (branchId: string) => {
    try {
      const res = await fetch(`/api/admin/salary-payments?branch_id=${encodeURIComponent(branchId)}`)
      if (!res.ok) throw new Error('Failed to fetch payments for branch')
      const { payments } = await res.json()
      setBranchPayments(payments || [])
    } catch (e) {
      console.error('Failed to fetch payments for branch', e)
      setBranchPayments([])
    }
  }

  // KYC document URLs resolve through the file server: stored
  // API paths and absolute URLs pass through unchanged; bare stored
  // paths are served from the owner-or-admin-only kyc-documents
  // bucket route (never a public URL).
  const getKycImageUrl = (url: string | null | undefined, bucket = 'kyc') => {
    if (!url) return null
    if (url.startsWith('http://') || url.startsWith('https://')) return url
    if (url.startsWith('/')) return url
    return `/api/files/${bucket}/${url}`
  }

  const handleSelectEmployee = async (emp: Employee) => {
    setSelectedEmployee(emp)
    setEmployeeDetailsLoading(true)
    setEmployeeKyc(null)
    setEmployeePayments([])
    setLedgerSearch('')
    setLedgerMonthFilter('')
    setShowEmpExportDropdown(false)

    setSalaryAmount(emp.salary ? String(emp.salary) : '')
    setSalaryDate(new Date().toISOString().split('T')[0])
    setSalaryTrxId('')
    setSalaryNote('')
    setProofFile(null)

    const bankKeys = emp.bank_info ? Object.keys(emp.bank_info) : []
    if (bankKeys.length > 0) {
      const firstKey = bankKeys[0]
      const formattedKey = firstKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())
      setSalaryAccount(`${formattedKey}: ${emp.bank_info[firstKey]}`)
    } else {
      setSalaryAccount('Custom')
    }
    setCustomAccount('')

    try {
      if (!emp.email) {
        try {
          const res = await fetch('/api/admin/users')
          if (res.ok) {
            const { users } = await res.json()
            const matched = (users || []).find((u: any) => u.id === emp.id)
            if (matched?.email) {
              emp.email = matched.email
              setSelectedEmployee((prev) => prev ? { ...prev, email: matched.email } : null)
            }
          }
        } catch (err) {
          console.warn('Failed to fetch fallback email', err)
        }
      }

      const kycRes = await fetch(`/api/admin/kyc?user_id=${encodeURIComponent(emp.id)}`)
      if (kycRes.ok) {
        const { requests } = await kycRes.json()
        const kycData = (requests || [])[0]
        if (kycData) setEmployeeKyc(kycData)
      }

      const payRes = await fetch(`/api/admin/salary-payments?employee_id=${encodeURIComponent(emp.id)}`)
      if (payRes.ok) {
        const { payments } = await payRes.json()
        if (payments) setEmployeePayments(payments)
      }
    } catch (e) {
      console.error('Failed to fetch employee details', e)
    } finally {
      setEmployeeDetailsLoading(false)
    }
  }

  const handleIssueSalary = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmployee || !selectedBranch) return
    setIsSubmittingSalary(true)
    setFeedback(null)

    const finalAccount = salaryAccount === 'Custom' ? customAccount : salaryAccount

    try {
      let proofUrl = null
      if (proofFile) {
        const fileExt = proofFile.name.split('.').pop()
        const fileName = `${selectedEmployee.id}_${Date.now()}.${fileExt}`
        // salary proof slips go through the file server —
        // same 'salaries' bucket as the old system (now served to
        // authenticated users only by /api/files).
        const uploaded = await uploadFile('salaries', proofFile, fileName)
        proofUrl = uploaded.url
      }

      const res = await fetch('/api/admin/salary-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: selectedEmployee.id,
          amount: Number(salaryAmount),
          transaction_id: salaryTrxId,
          payment_proof_url: proofUrl,
          payment_date: new Date(salaryDate.includes('T') ? salaryDate : `${salaryDate}T12:00:00.000Z`).toISOString(),
          branch_id: selectedBranch.id,
          account: finalAccount || null,
          notes: salaryNote || null,
          base_salary_at_time: selectedEmployee.salary ? Number(selectedEmployee.salary) : null
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to issue salary.')
      }

      fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SALARY_PAID',
          payload: {
            userId: selectedEmployee.id,
            userName: selectedEmployee.full_name || 'Employee',
            email: selectedEmployee.email || null,
            month: new Date(salaryDate.includes('T') ? salaryDate : `${salaryDate}T12:00:00.000Z`).toLocaleString('default', { month: 'long', year: 'numeric' }),
            amount: Number(salaryAmount),
            currency: 'BDT',
            transactionId: salaryTrxId || `SAL-${Date.now().toString().slice(-8)}`,
            paymentMethod: finalAccount || 'Payroll Bank Account',
            branchName: selectedBranch.name || 'Head Office'
          }
        })
      }).catch(e => console.error('Failed to trigger salary email', e))

      setFeedback({ type: 'success', message: 'Salary payment disbursed successfully.' })
      setTimeout(() => setFeedback(null), 4000)

      setShowSalaryModal(false)

      const payRes = await fetch(`/api/admin/salary-payments?employee_id=${encodeURIComponent(selectedEmployee.id)}`)
      if (payRes.ok) {
        const { payments: updatedPayments } = await payRes.json()
        if (updatedPayments) setEmployeePayments(updatedPayments)
      }

      await fetchBranchPayments(selectedBranch.id)

    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to issue salary.' })
    } finally {
      setIsSubmittingSalary(false)
    }
  }

  const fetchEmployeesForBranch = async (branch: Branch) => {
    setSelectedBranch(branch)
    setEmployeesLoading(true)
    try {
      let fetchedEmployees: Employee[] = []
      const res = await fetch('/api/admin/users')
      if (res.ok) {
        const { users } = await res.json()
        fetchedEmployees = (users || [])
          .filter((u: any) => u.branch_id === branch.id && u.role !== 'admin' && u.role !== 'super_admin')
      }

      fetchedEmployees.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))

      setEmployees(fetchedEmployees)

      // Also fetch payments for export
      await fetchBranchPayments(branch.id)
    } catch (e) {
      console.error('Failed to fetch employees for branch', e)
      setEmployees([])
      setBranchPayments([])
    } finally {
      setEmployeesLoading(false)
    }
  }

  const filteredEmployeePayments = employeePayments.filter((p) => {
    const matchesSearch = !ledgerSearch ||
      (p.transaction_id && p.transaction_id.toLowerCase().includes(ledgerSearch.toLowerCase())) ||
      (p.notes && p.notes.toLowerCase().includes(ledgerSearch.toLowerCase())) ||
      (p.account && p.account.toLowerCase().includes(ledgerSearch.toLowerCase())) ||
      String(p.amount).includes(ledgerSearch);

    const matchesMonth = !ledgerMonthFilter ||
      (p.payment_date && p.payment_date.startsWith(ledgerMonthFilter));

    return matchesSearch && matchesMonth;
  })

  const handleExportEmployeeSalaries = async (format: 'excel' | 'pdf' | 'csv') => {
    if (!selectedEmployee || filteredEmployeePayments.length === 0) return

    const exportData = filteredEmployeePayments.map(p => ({
      'Payment Date': new Date(p.payment_date).toLocaleDateString(),
      'Employee Name': selectedEmployee.full_name,
      'Amount (BDT)': Number(p.amount || 0),
      'Transaction ID': p.transaction_id || 'N/A',
      'Method / Account': p.account || 'N/A',
      'Remarks': p.notes || ''
    }))

    const fileName = `${selectedEmployee.full_name.replace(/\s+/g, '_')}_Salary_Ledger`

    if (format === 'excel') {
      const worksheet = XLSX.utils.json_to_sheet(exportData)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Salary Ledger')
      XLSX.writeFile(workbook, `${fileName}.xlsx`)
    } else if (format === 'csv') {
      const headers = Object.keys(exportData[0] || {})
      const rows = exportData.map(obj => headers.map(header => JSON.stringify((obj as any)[header] ?? '')).join(','))
      const csvContent = [headers.join(','), ...rows].join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.setAttribute('href', url)
      link.setAttribute('download', `${fileName}.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } else if (format === 'pdf') {
      const columns = ['Payment Date', 'Amount (BDT)', 'Transaction ID', 'Method / Account', 'Remarks']
      const rows = filteredEmployeePayments.map(p => [
        new Date(p.payment_date).toLocaleDateString(),
        `${Number(p.amount || 0).toLocaleString()} BDT`,
        p.transaction_id || 'N/A',
        p.account || 'N/A',
        p.notes || ''
      ])
      await generatePdf(
        `Salary Ledger - ${selectedEmployee.full_name}`,
        columns,
        rows,
        {
          subtitle: `Branch: ${selectedBranch?.name || 'Head Office'}`,
          summaryData: [
            { label: 'Total Disbursed', value: `${filteredEmployeePayments.reduce((acc, p) => acc + Number(p.amount || 0), 0).toLocaleString()} BDT` }
          ],
          filename: `${fileName}.pdf`
        }
      )
    }
    setShowEmpExportDropdown(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this branch?')) return
    setDeletingId(id)
    try {
      const res = await fetch('/api/admin/branches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error('Failed to delete branch')
      setBranches(branches.filter(b => b.id !== id))
      if (selectedBranch?.id === id) setSelectedBranch(null)
    } catch (e) {
      alert('Failed to delete branch. Ensure no employees are assigned to it.')
      console.error(e)
    } finally {
      setDeletingId(null)
    }
  }

  const handleExportCSV = (type: 'employees' | 'payments') => {
    if (!selectedBranch) return

    let headers: string[] = []
    let rows: string[] = []

    const escape = (val: any) => {
      const text = val === null || val === undefined ? '' : String(val)
      return `"${text.replace(/"/g, '""')}"`
    }

    if (type === 'employees') {
      headers = ['Full Name', 'Phone Number', 'Role', 'Position', 'Salary (BDT)', 'Verification Status', 'Account Status']
      rows = employees.map(u => [
        escape(u.full_name),
        escape(u.phone_number || 'N/A'),
        escape(u.role),
        escape(u.position || 'N/A'),
        u.salary || 0,
        escape(u.verification_status),
        escape(u.is_banned ? 'Banned' : 'Active')
      ].join(','))
    } else {
      headers = ['Payment Date', 'Employee Name', 'Amount (BDT)', 'Transaction ID', 'Notes']
      rows = branchPayments.map(p => [
        escape(new Date(p.payment_date).toLocaleDateString()),
        escape(p.profiles?.full_name || 'Unknown'),
        p.amount || 0,
        escape(p.transaction_id || 'N/A'),
        escape(p.notes || '')
      ].join(','))
    }

    const csvContent = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `${selectedBranch.name.replace(/\s+/g, '_')}_${type}_export.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setShowExportDropdown(false)
  }

  const handleExportExcel = () => {
    if (!selectedBranch) return

    // Prepare Employees Data
    const empData = employees.map(u => ({
      'Full Name': u.full_name,
      'Phone Number': u.phone_number || 'N/A',
      'Role': u.role,
      'Position': u.position || 'N/A',
      'Salary (BDT)': u.salary || 0,
      'Verification Status': u.verification_status,
      'Account Status': u.is_banned ? 'Banned' : 'Active'
    }))

    // Prepare Payments Data
    const payData = branchPayments.map(p => ({
      'Payment Date': new Date(p.payment_date).toLocaleDateString(),
      'Employee Name': p.profiles?.full_name || 'Unknown',
      'Amount (BDT)': p.amount || 0,
      'Transaction ID': p.transaction_id || 'N/A',
      'Notes': p.notes || ''
    }))

    const empWorksheet = XLSX.utils.json_to_sheet(empData)
    const payWorksheet = XLSX.utils.json_to_sheet(payData)

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, empWorksheet, 'Employees')
    XLSX.utils.book_append_sheet(workbook, payWorksheet, 'Payments')

    XLSX.writeFile(workbook, `${selectedBranch.name.replace(/\s+/g, '_')}_Branch_Data.xlsx`)
    setShowExportDropdown(false)
  }

  const handleExportPDF = async (type: 'employees' | 'payments') => {
    if (!selectedBranch) return
    if (type === 'employees') {
      const columns = ['Full Name', 'Phone Number', 'Role', 'Position', 'Salary (BDT)', 'Verification Status', 'Joined Date']
      const rows = employees.map(u => [
        u.full_name,
        u.phone_number || 'N/A',
        u.role,
        u.position || 'N/A',
        `${u.salary || 0}`,
        u.verification_status || 'pending',
        new Date((u as any).created_at || new Date()).toLocaleDateString()
      ])

      const totalSalary = (selectedEmployeeIds.length > 0 ? employees.filter(e => selectedEmployeeIds.includes(e.id)) : employees).reduce((sum: any, u: any) => sum + Number(u.salary || 0), 0)

      await generatePdf(`${selectedBranch.name} Employees`, columns, rows, {
        summaryData: [
          { label: 'Total Base Salary', value: `${totalSalary.toLocaleString()} BDT` }
        ],
        filename: `${selectedBranch.name.replace(/\s+/g, '_')}_employees.pdf`
      })
    } else {
      const columns = ['Payment Date', 'Employee Name', 'Amount (BDT)', 'Transaction ID', 'Notes']
      const rows = branchPayments.map(p => [
        new Date(p.payment_date).toLocaleDateString(),
        p.profiles?.full_name || 'Unknown',
        `${p.amount || 0}`,
        p.transaction_id || 'N/A',
        p.notes || ''
      ])

      const totalPayments = branchPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)

      await generatePdf(`${selectedBranch.name} Payments`, columns, rows, {
        summaryData: [
          { label: 'Total Payments', value: `${totalPayments.toLocaleString()} BDT` }
        ],
        filename: `${selectedBranch.name.replace(/\s+/g, '_')}_payments.pdf`
      })
    }
    setShowExportDropdown(false)
  }

  useEffect(() => {
    fetchBranches()
  }, [])

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans">
      {/* Glow background */}
      <div className="absolute top-[-10%] right-[-5%] w-[50%] h-[50%] bg-[#d4af37]/3 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="flex-1 flex flex-col p-6 lg:p-10 overflow-y-auto max-h-screen relative z-10">
        <AnimatePresence mode="wait">
          {selectedEmployee ? (
            <motion.div
              key="employee-details-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="space-y-6 max-w-7xl mx-auto w-full pb-12"
            >
              {/* Top Bar with Back Button */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-900/10">
                <button
                  onClick={() => {
                    setSelectedEmployee(null)
                    setLedgerSearch('')
                    setLedgerMonthFilter('')
                    setShowEmpExportDropdown(false)
                  }}
                  className="flex items-center gap-2.5 bg-slate-900/[0.04] hover:bg-slate-900/[0.04] text-slate-900 border border-slate-900/15 px-5 py-2.5 rounded-xl transition-all font-semibold text-xs tracking-wider uppercase group shadow-lg hover:border-[#d4af37]/50 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4 text-[#8a6d1f] group-hover:-translate-x-1 transition-transform" /> Back to Branch Workforce
                </button>

                {/* Feedback Notification */}
                {feedback && (
                  <div className={`p-3 px-4 rounded-xl border flex items-center gap-2.5 ${
                    feedback.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600' : 'bg-rose-500/10 border-rose-500/30 text-rose-600'
                  }`}>
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-semibold">{feedback.message}</span>
                  </div>
                )}
              </div>

              {/* Employee Banner Header Card */}
              <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-[#d4af37]/30 bg-gradient-to-r from-white via-white to-white shadow-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative overflow-hidden">
                <div className="absolute -top-24 -right-24 w-72 h-72 bg-[#d4af37]/10 rounded-full blur-3xl pointer-events-none" />
                <div className="flex items-center gap-5 z-10">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#d4af37] via-[#e5c158] to-white flex items-center justify-center text-black font-extrabold text-3xl shadow-[0_0_20px_rgba(212,175,55,0.3)] shrink-0">
                    {selectedEmployee.full_name?.charAt(0) || '?'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 font-serif tracking-wide">{selectedEmployee.full_name}</h2>
                      <span className={`text-[11px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full border ${
                        selectedEmployee.role === 'employee'
                          ? 'bg-blue-500/10 text-blue-600 border-blue-500/20'
                          : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                      }`}>
                        {selectedEmployee.role}
                      </span>
                      {selectedEmployee.verification_status === 'approved' ? (
                        <span className="text-[11px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-3 py-0.5 rounded-full font-bold flex items-center gap-1 shadow-[0_0_10px_rgba(52,211,153,0.2)]">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                        </span>
                      ) : (
                        <span className="text-[11px] bg-amber-500/10 text-amber-600 border border-amber-500/20 px-3 py-0.5 rounded-full font-bold">
                          Pending KYC
                        </span>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-slate-600 mt-1.5 flex items-center gap-3 flex-wrap">
                      {selectedEmployee.position && (
                        <span className="text-slate-900 font-semibold bg-slate-900/[0.04] px-2.5 py-0.5 rounded-md border border-slate-900/5">{selectedEmployee.position}</span>
                      )}
                      <span>Assigned Branch: <strong className="text-[#8a6d1f] font-semibold">{selectedBranch?.name}</strong></span>
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setShowSalaryModal(true)}
                  className="bg-gradient-to-r from-[#d4af37] via-[#f3e5ab] to-white text-black font-extrabold px-6 py-3.5 rounded-2xl text-xs tracking-wider uppercase flex items-center gap-2.5 shadow-[0_0_25px_rgba(212,175,55,0.4)] hover:shadow-[0_0_35px_rgba(212,175,55,0.6)] transition-all hover:-translate-y-0.5 z-10 w-full md:w-auto justify-center cursor-pointer"
                >
                  <CreditCard className="w-4 h-4 fill-black" /> Issue Salary Payment
                </button>
              </div>

              {employeeDetailsLoading ? (
                <div className="glass-panel p-16 rounded-3xl border border-slate-900/5 flex flex-col items-center justify-center">
                  <div className="w-10 h-10 border-3 border-[#d4af37] border-t-transparent rounded-full animate-spin mb-4 shadow-[0_0_15px_rgba(212,175,55,0.5)]" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Loading member ledger and KYC details...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Left 5 Cols: Compensation & Contact */}
                  <div className="lg:col-span-5 space-y-6">
                    {/* Compensation Card */}
                    <div className="glass-panel p-6 rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] space-y-4 relative overflow-hidden shadow-xl">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
                      <span className="text-[11px] font-bold text-[#8a6d1f] uppercase tracking-widest flex items-center gap-2">
                        <Landmark className="w-4 h-4" /> Compensation & Routing
                      </span>

                      <div className="py-3 border-y border-slate-900/5 flex justify-between items-center">
                        <span className="text-xs text-slate-500">Monthly Base Remuneration</span>
                        <span className="text-lg font-bold text-emerald-600 font-mono">
                          {selectedEmployee.salary ? `${Number(selectedEmployee.salary).toLocaleString()} BDT` : 'Not Set'}
                        </span>
                      </div>

                      <div className="space-y-2 pt-1">
                        <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block">Banking / Wallet Routing</span>
                        {selectedEmployee.bank_info && Object.keys(selectedEmployee.bank_info).length > 0 ? (
                          <div className="space-y-2">
                            {Object.entries(selectedEmployee.bank_info).map(([k, v]) => {
                              if (!v) return null
                              const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())
                              return (
                                <div key={k} className="flex justify-between items-center text-xs py-2 px-3 rounded-xl bg-white border border-slate-900/5">
                                  <span className="text-slate-500 font-medium">{label}</span>
                                  <span className="text-slate-900 font-mono font-semibold">{String(v)}</span>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500 italic py-2">No bank or wallet details configured yet.</p>
                        )}
                      </div>
                    </div>

                    {/* Contact Card */}
                    <div className="glass-panel p-6 rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] space-y-4 shadow-xl">
                      <span className="text-[11px] font-bold text-[#8a6d1f] uppercase tracking-widest flex items-center gap-2">
                        <UserCircle className="w-4 h-4" /> Contact & Profile Info
                      </span>

                      <div className="space-y-3.5 text-xs">
                        <div className="flex items-center gap-3.5 py-2 border-b border-slate-900/5">
                          <div className="p-2 rounded-xl bg-slate-900/[0.04] text-[#8a6d1f]">
                            <Phone className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 block uppercase font-semibold">Phone Number</span>
                            <span className="text-slate-900 font-medium text-sm">{selectedEmployee.phone_number || 'No phone recorded'}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3.5 py-2 border-b border-slate-900/5">
                          <div className="p-2 rounded-xl bg-slate-900/[0.04] text-[#8a6d1f]">
                            <Mail className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 block uppercase font-semibold">Email Address</span>
                            <span className="text-slate-900 font-medium text-sm">{selectedEmployee.email || employeeKyc?.email || 'No email recorded'}</span>
                          </div>
                        </div>

                        <div className="flex items-start gap-3.5 py-2">
                          <div className="p-2 rounded-xl bg-slate-900/[0.04] text-[#8a6d1f] shrink-0 mt-0.5">
                            <MapPin className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 block uppercase font-semibold">Residential Address</span>
                            <span className="text-slate-900 text-sm leading-relaxed">{selectedEmployee.address || employeeKyc?.address || 'Address not provided'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right 7 Cols: KYC & Disbursement Ledger */}
                  <div className="lg:col-span-7 space-y-6">
                    {/* KYC Documents Card */}
                    {employeeKyc && (
                      <div className="glass-panel p-6 rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] shadow-xl">
                        <span className="text-[11px] font-bold text-[#8a6d1f] uppercase tracking-widest block mb-4 flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4" /> Verified Identity Documents
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          {[
                            { title: 'NID Front', url: employeeKyc.nid_front_url },
                            { title: 'NID Back', url: employeeKyc.nid_back_url },
                            { title: 'Live Selfie', url: employeeKyc.selfie_url }
                          ].map((doc, idx) => (
                            <div key={idx} className="space-y-2">
                              <span className="text-[11px] uppercase font-bold text-slate-500 tracking-wider">{doc.title}</span>
                              {doc.url ? (
                                <button
                                  onClick={() => setFullscreenImage(getKycImageUrl(doc.url)!)}
                                  className="w-full aspect-[4/3] rounded-2xl bg-white border border-slate-900/10 hover:border-[#d4af37] overflow-hidden relative group transition-all cursor-pointer shadow-lg"
                                >
                                  <img
                                    src={getKycImageUrl(doc.url)!}
                                    alt={doc.title}
                                    className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                  />
                                  <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-xs">
                                    <div className="bg-white p-2.5 rounded-full border border-slate-900/20 text-slate-900 flex items-center gap-1.5 text-xs font-semibold">
                                      <Eye className="w-4 h-4 text-[#8a6d1f]" /> View Full
                                    </div>
                                  </div>
                                </button>
                              ) : (
                                <div className="w-full aspect-[4/3] rounded-2xl bg-slate-900/[0.04] border border-slate-900/5 border-dashed flex items-center justify-center text-xs text-slate-600 font-medium">
                                  Not Uploaded
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Salary Disbursement Ledger Card */}
                    <div className="glass-panel p-6 rounded-3xl border border-slate-900/5 bg-slate-900/[0.04] shadow-xl">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-slate-900/10">
                        <div>
                          <span className="text-xs font-bold text-[#8a6d1f] uppercase tracking-widest flex items-center gap-2">
                            <DollarSign className="w-4 h-4" /> Disbursement Ledger ({filteredEmployeePayments.length})
                          </span>
                          {filteredEmployeePayments.length > 0 && (
                            <span className="text-xs text-slate-500 font-mono mt-1 block">
                              Total: {filteredEmployeePayments.reduce((acc, p) => acc + Number(p.amount || 0), 0).toLocaleString()} BDT
                            </span>
                          )}
                        </div>

                        {employeePayments.length > 0 && (
                          <div className="flex items-center gap-3 relative w-full sm:w-auto justify-end flex-wrap">
                            {/* Filter Bar */}
                            <div className="flex items-center gap-2 flex-1 sm:flex-initial">
                              <div className="relative flex-1 sm:w-44">
                                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                <input
                                  type="text"
                                  placeholder="Search Trx, Notes..."
                                  value={ledgerSearch}
                                  onChange={(e) => setLedgerSearch(e.target.value)}
                                  className="w-full bg-white border border-slate-900/15 rounded-xl pl-8 pr-7 py-1.5 text-xs text-slate-900 placeholder-slate-500 focus:outline-none focus:border-[#d4af37] transition-colors"
                                />
                                {ledgerSearch && (
                                  <button onClick={() => setLedgerSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900">
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                              <input
                                type="month"
                                value={ledgerMonthFilter}
                                onChange={(e) => setLedgerMonthFilter(e.target.value)}
                                className="bg-white border border-slate-900/15 rounded-xl px-2.5 py-1.5 text-xs text-slate-600 focus:outline-none focus:border-[#d4af37] transition-colors font-mono"
                              />
                              {ledgerMonthFilter && (
                                <button onClick={() => setLedgerMonthFilter('')} className="text-slate-500 hover:text-slate-900 p-2.5">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>

                            {/* Export Dropdown */}
                            <div className="relative">
                              <button
                                onClick={() => setShowEmpExportDropdown(!showEmpExportDropdown)}
                                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#d4af37]/10 hover:bg-[#d4af37]/20 text-[#8a6d1f] border border-[#d4af37]/30 text-xs font-semibold transition-all shrink-0 cursor-pointer shadow-md"
                              >
                                <Download className="w-3.5 h-3.5" /> Export
                              </button>

                              <AnimatePresence>
                                {showEmpExportDropdown && (
                                  <motion.div
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 5 }}
                                    className="absolute right-0 mt-2 w-44 bg-white border border-slate-900/15 rounded-2xl shadow-2xl overflow-hidden z-50 py-1 backdrop-blur-xl"
                                  >
                                    <button onClick={() => handleExportEmployeeSalaries('excel')} className="w-full text-left px-3.5 py-2 text-xs text-slate-600 hover:bg-slate-900/[0.07] hover:text-slate-900 flex items-center gap-2 transition-colors">
                                      <FileText className="w-3.5 h-3.5 text-emerald-600" /> Excel (.xlsx)
                                    </button>
                                    <button onClick={() => handleExportEmployeeSalaries('pdf')} className="w-full text-left px-3.5 py-2 text-xs text-slate-600 hover:bg-slate-900/[0.07] hover:text-slate-900 flex items-center gap-2 transition-colors">
                                      <FileText className="w-3.5 h-3.5 text-rose-600" /> PDF (.pdf)
                                    </button>
                                    <button onClick={() => handleExportEmployeeSalaries('csv')} className="w-full text-left px-3.5 py-2 text-xs text-slate-600 hover:bg-slate-900/[0.07] hover:text-slate-900 flex items-center gap-2 transition-colors">
                                      <FileText className="w-3.5 h-3.5 text-blue-600" /> CSV (.csv)
                                    </button>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                        )}
                      </div>

                      {filteredEmployeePayments.length === 0 ? (
                        <div className="text-center py-12 text-slate-500 text-sm italic bg-white rounded-2xl border border-slate-900/5">
                          {employeePayments.length === 0
                            ? 'No salary payments recorded for this member yet. Click "Issue Salary Payment" above to disburse.'
                            : 'No salary payments match your filter criteria.'}
                        </div>
                      ) : (
                        <div className="space-y-3 max-h-[380px] overflow-y-auto pr-2 custom-scrollbar">
                          {filteredEmployeePayments.map((pay) => (
                            <div key={pay.id} className="p-4 rounded-2xl bg-white border border-slate-900/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-slate-900/15 transition-all shadow-md">
                              <div className="space-y-1">
                                <div className="flex items-center gap-3 flex-wrap">
                                  <span className="text-base font-extrabold text-emerald-600 font-mono">+{Number(pay.amount).toLocaleString()} BDT</span>
                                  <span className="text-xs bg-slate-900/[0.04] border border-slate-900/5 px-2.5 py-0.5 rounded-lg text-slate-600 font-mono">Trx: {pay.transaction_id || 'N/A'}</span>
                                </div>
                                {pay.notes && <p className="text-xs text-slate-600 italic">"{pay.notes}"</p>}
                                {pay.account && <p className="text-[11px] text-slate-500">Method/Account: <span className="text-slate-600 font-mono">{pay.account}</span></p>}
                              </div>
                              <div className="flex items-center gap-4 sm:text-right shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-900/5">
                                <div className="text-xs text-slate-500 font-medium">
                                  <Calendar className="w-3.5 h-3.5 inline mr-1.5 text-[#8a6d1f]" />
                                  {new Date(pay.payment_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="branches-grid-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-8"
            >
              <div className="pb-4 border-b border-slate-900/5 flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-serif">
                    Branch <span className="premium-text-gradient">Management</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">Manage branch locations and view who is working in each branch.</p>
                </div>
                <Link href="/admin/branches/create" className="flex items-center gap-2 bg-[#d4af37]/10 text-[#8a6d1f] border border-[#d4af37]/20 px-4 py-2.5 rounded-xl hover:bg-[#d4af37]/20 transition-all font-semibold text-xs tracking-wider uppercase">
                  <Plus className="w-4 h-4" /> Add Branch
                </Link>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* Branch List */}
                <div className="lg:col-span-5 glass-panel p-6 rounded-2xl relative shadow-xl">
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-900/5">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-[#8a6d1f]/75" /> All Branches ({branches.length})
                    </span>
                  </div>

                  {loading ? (
                    <p className="text-slate-500 text-xs">Loading branches…</p>
                  ) : branches.length === 0 ? (
                    <p className="text-slate-500 text-xs italic">No branches found. Create one using the button above.</p>
                  ) : (
                    <div className="space-y-2">
                      {branches.map((b) => {
                        const isHq = isHeadOffice(b.name)
                        return (
                          <div
                            key={b.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => fetchEmployeesForBranch(b)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fetchEmployeesForBranch(b) }}
                            className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer group ${
                              selectedBranch?.id === b.id
                                ? 'bg-[#d4af37]/15 border-[#d4af37]/50 shadow-lg shadow-[#d4af37]/10'
                                : isHq
                                ? 'bg-gradient-to-r from-[#d4af37]/12 via-[#d4af37]/5 to-transparent border-[#d4af37]/35 hover:border-[#d4af37]/50'
                                : 'bg-slate-900/[0.04] border-slate-900/5 hover:border-slate-900/10 hover:bg-slate-900/[0.04]'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {isHq ? (
                                <div className="w-7 h-7 rounded-lg bg-[#d4af37]/20 border border-[#d4af37]/40 flex items-center justify-center shrink-0">
                                  <Landmark className="w-3.5 h-3.5 text-[#8a6d1f]" />
                                </div>
                              ) : (
                                <MapPin className={`w-4 h-4 shrink-0 ${selectedBranch?.id === b.id ? 'text-[#8a6d1f]' : 'text-slate-500'}`} />
                              )}
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold ${
                                  selectedBranch?.id === b.id ? 'text-[#8a6d1f]' : isHq ? 'text-slate-500' : 'text-slate-900'
                                }`}>
                                  {b.name}
                                </span>
                                {isHq && (
                                  <span className="px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider rounded-full bg-[#d4af37]/20 text-[#8a6d1f] border border-[#d4af37]/40">
                                    HQ / Main
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <ChevronRight className={`w-4 h-4 ${selectedBranch?.id === b.id ? 'text-[#8a6d1f]' : 'text-slate-600 group-hover:text-slate-500'} transition-colors`} />
                              {!isHq && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDelete(b.id) }}
                                  disabled={deletingId === b.id}
                                  className="text-rose-600/60 hover:text-rose-600 transition-colors p-2.5 opacity-0 group-hover:opacity-100 cursor-pointer"
                                  title="Delete Branch"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Employee List for selected branch */}
                <div className="lg:col-span-7">
                  <AnimatePresence mode="wait">
                    {selectedBranch ? (
                      <motion.div
                        key={selectedBranch.id}
                        initial={{ opacity: 0, x: 15 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -15 }}
                        className="glass-panel p-6 rounded-2xl relative shadow-xl"
                      >
                        <div className="flex justify-between items-start mb-6 pb-4 border-b border-slate-900/5">
                          <div>
                            <span className="text-[10px] font-bold text-[#8a6d1f] uppercase tracking-widest block mb-1 flex items-center gap-2">
                              <MapPin className="w-3.5 h-3.5" /> Branch Workforce
                            </span>
                            <h3 className="text-lg font-bold text-slate-900 font-serif">{selectedBranch.name}</h3>
                            <p className="text-[10px] text-slate-500 mt-1">
                              {employeesLoading ? 'Loading...' : `${employees.length} member${employees.length !== 1 ? 's' : ''} in this branch`}
                            </p>
                          </div>

                          {employees.length > 0 && (
                            <div className="relative">
                              <button
                                onClick={() => setShowExportDropdown(!showExportDropdown)}
                                className="flex items-center gap-2 bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-900 border border-slate-900/10 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                              >
                                <Download className="w-3.5 h-3.5 text-[#8a6d1f]" /> Export
                              </button>
                              {showExportDropdown && (
                                <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-900/10 rounded-xl shadow-2xl py-2 z-30">
                                  <button onClick={handleExportExcel} className="w-full text-left px-4 py-2 text-xs text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900 flex items-center gap-2">
                                    <FileText className="w-3.5 h-3.5 text-emerald-600" /> Export as Excel (.xlsx)
                                  </button>
                                  <button onClick={() => handleExportCSV('employees')} className="w-full text-left px-4 py-2 text-xs text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900 flex items-center gap-2">
                                    <FileText className="w-3.5 h-3.5 text-blue-600" /> Export Employees (.csv)
                                  </button>
                                  <button onClick={() => handleExportCSV('payments')} className="w-full text-left px-4 py-2 text-xs text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900 flex items-center gap-2">
                                    <FileText className="w-3.5 h-3.5 text-amber-600" /> Export Payments (.csv)
                                  </button>
                                  <div className="border-t border-slate-900/5 my-1" />
                                  <button onClick={() => handleExportPDF('employees')} className="w-full text-left px-4 py-2 text-xs text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900 flex items-center gap-2">
                                    <FileText className="w-3.5 h-3.5 text-rose-600" /> Print Employees PDF
                                  </button>
                                  <button onClick={() => handleExportPDF('payments')} className="w-full text-left px-4 py-2 text-xs text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900 flex items-center gap-2">
                                    <FileText className="w-3.5 h-3.5 text-purple-600" /> Print Payments PDF
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {employeesLoading ? (
                          <div className="flex flex-col items-center justify-center py-12">
                            <div className="w-6 h-6 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin mb-2" />
                            <span className="text-xs text-slate-500">Loading workforce...</span>
                          </div>
                        ) : employees.length === 0 ? (
                          <div className="text-center py-12 text-slate-500 text-xs italic">
                            No employees assigned to this branch yet.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {employees.map((emp) => (
                              <div
                                key={emp.id}
                                onClick={() => handleSelectEmployee(emp)}
                                className="p-4 rounded-xl bg-white border border-slate-900/5 hover:border-[#d4af37]/40 hover:bg-slate-900/[0.04] transition-all cursor-pointer flex items-center justify-between gap-4 group shadow-sm"
                              >
                                <div className="flex items-center gap-3.5">
                                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#d4af37]/20 to-[#d4af37]/5 border border-[#d4af37]/30 flex items-center justify-center text-[#8a6d1f] font-bold text-sm shrink-0 group-hover:scale-105 transition-transform">
                                    {emp.full_name?.charAt(0) || '?'}
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-bold text-slate-900 group-hover:text-[#8a6d1f] transition-colors">{emp.full_name}</h4>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-[10px] text-slate-500 font-mono">{emp.phone_number || 'No Phone'}</span>
                                      {emp.position && (
                                        <>
                                          <span className="text-slate-600">•</span>
                                          <span className="text-[10px] text-slate-500 font-medium">{emp.position}</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                                    emp.role === 'employee'
                                      ? 'bg-blue-500/10 text-blue-600 border-blue-500/20'
                                      : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                                  }`}>
                                    {emp.role}
                                  </span>
                                  <div className={`w-2 h-2 rounded-full ${
                                    emp.verification_status === 'approved'
                                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                                      : 'bg-amber-400'
                                  }`} title={emp.verification_status === 'approved' ? 'Verified' : 'Pending KYC'} />
                                  <div className="flex items-center gap-1 text-xs font-semibold text-slate-500 group-hover:text-[#8a6d1f] transition-colors pl-2 border-l border-slate-900/5">
                                    <span className="hidden sm:inline">Details</span>
                                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform text-[#8a6d1f]" />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="glass-panel p-16 rounded-3xl text-center shadow-xl flex flex-col items-center justify-center gap-3 border border-slate-900/5"
                      >
                        <div className="w-16 h-16 rounded-full bg-slate-900/[0.04] flex items-center justify-center text-slate-600 mb-2">
                          <Users className="w-8 h-8 text-slate-500" />
                        </div>
                        <p className="text-slate-900 text-base font-bold font-serif">Select a Branch Location</p>
                        <p className="text-slate-500 text-xs max-w-sm">Click on any branch location from the list on the left to view and manage the members working there.</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ISSUE SALARY MODAL */}
        <AnimatePresence>
          {showSalaryModal && selectedEmployee && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/50 z-[60] flex justify-center items-center p-4 backdrop-blur-md overflow-y-auto"
            >
              <motion.div
                initial={{ scale: 0.95, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 20 }}
                className="glass-panel p-6 sm:p-8 rounded-3xl max-w-lg w-full relative shadow-2xl border border-[#d4af37]/40 bg-white"
              >
                <div className="flex justify-between items-start mb-6 border-b border-slate-900/10 pb-4">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 font-serif">Disburse Salary</h3>
                    <p className="text-xs text-slate-500 mt-1">Record a new payroll transfer for {selectedEmployee.full_name}.</p>
                  </div>
                  <button onClick={() => setShowSalaryModal(false)} className="text-slate-500 hover:text-slate-900 bg-slate-900/[0.04] p-2.5 rounded-full transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="mb-6 p-4 rounded-xl bg-gradient-to-br from-[#d4af37]/15 to-transparent border border-[#d4af37]/30 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-[#8a6d1f] uppercase tracking-wider mb-0.5">Recipient Member</p>
                    <p className="text-sm font-semibold text-slate-900">{selectedEmployee.full_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-[#8a6d1f] uppercase tracking-wider mb-0.5">Base Salary</p>
                    <p className="text-sm font-bold text-emerald-600 font-mono">{selectedEmployee.salary ? `${Number(selectedEmployee.salary).toLocaleString()} BDT` : 'Not Set'}</p>
                  </div>
                </div>

                <form onSubmit={handleIssueSalary} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">Amount (BDT) *</label>
                      <input
                        type="number"
                        required
                        value={salaryAmount}
                        onChange={(e) => setSalaryAmount(e.target.value)}
                        placeholder="e.g. 25000"
                        className="w-full bg-white border border-slate-900/15 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 font-mono focus:outline-none focus:border-[#d4af37] transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">Payment Date *</label>
                      <input
                        type="date"
                        required
                        value={salaryDate}
                        onChange={(e) => setSalaryDate(e.target.value)}
                        className="w-full bg-white border border-slate-900/15 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 font-mono focus:outline-none focus:border-[#d4af37] transition-colors"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">Payment Account/Method</label>
                      <select
                        value={salaryAccount}
                        onChange={(e) => setSalaryAccount(e.target.value)}
                        className="w-full bg-white border border-slate-900/15 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#d4af37] transition-colors"
                      >
                        {selectedEmployee.bank_info && Object.keys(selectedEmployee.bank_info).length > 0 && (
                          Object.entries(selectedEmployee.bank_info).map(([k, v]) => {
                            if (!v) return null
                            const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())
                            return <option key={k} value={`${label}: ${v}`}>{label}: {String(v)}</option>
                          })
                        )}
                        <option value="Cash">Cash Disbursed</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="bKash / Nagad">bKash / Nagad Mobile Wallet</option>
                        <option value="Custom">Custom Account...</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">Transaction ID / Ref</label>
                      <input
                        type="text"
                        value={salaryTrxId}
                        onChange={(e) => setSalaryTrxId(e.target.value)}
                        placeholder="e.g. TR6839201"
                        className="w-full bg-white border border-slate-900/15 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 font-mono focus:outline-none focus:border-[#d4af37] transition-colors"
                      />
                    </div>
                  </div>

                  {salaryAccount === 'Custom' && (
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">Specify Custom Account / Details</label>
                      <input
                        type="text"
                        value={customAccount}
                        onChange={(e) => setCustomAccount(e.target.value)}
                        placeholder="Enter Account Name / Number"
                        className="w-full bg-white border border-slate-900/15 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#d4af37] transition-colors"
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">Upload Voucher / Receipt Proof</label>
                    <div className="relative border border-dashed border-slate-900/15 hover:border-[#d4af37]/50 rounded-xl p-3 text-center bg-white transition-colors cursor-pointer">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => e.target.files && setProofFile(e.target.files[0])}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                        <Upload className="w-4 h-4 text-[#8a6d1f]" />
                        <span>{proofFile ? proofFile.name : 'Click or drag receipt file to upload'}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">Remarks / Notes</label>
                    <textarea
                      value={salaryNote}
                      onChange={(e) => setSalaryNote(e.target.value)}
                      rows={2}
                      placeholder="Optional notes for this payment..."
                      className="w-full bg-white border border-slate-900/15 rounded-xl p-3 text-sm text-slate-900 focus:outline-none focus:border-[#d4af37] transition-colors"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-900/10">
                    <button
                      type="button"
                      onClick={() => setShowSalaryModal(false)}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase text-slate-500 hover:text-slate-900 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingSalary}
                      className="bg-gradient-to-r from-[#d4af37] to-white text-black font-bold px-6 py-2.5 rounded-xl text-xs tracking-wider uppercase shadow-[0_0_15px_rgba(212,175,55,0.3)] hover:shadow-[0_0_25px_rgba(212,175,55,0.5)] transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isSubmittingSalary ? 'Disbursing...' : 'Confirm Disbursement'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* FULLSCREEN IMAGE MODAL */}
        <AnimatePresence>
          {fullscreenImage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/50 z-[70] flex justify-center items-center p-4 backdrop-blur-md"
              onClick={() => setFullscreenImage(null)}
            >
              <button
                onClick={() => setFullscreenImage(null)}
                className="absolute top-6 right-6 p-3 rounded-full bg-slate-900/[0.07] hover:bg-slate-900/[0.09] text-slate-900 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              <img src={fullscreenImage} alt="Fullscreen document" className="max-w-full max-h-[90vh] object-contain rounded-2xl border border-slate-900/20 shadow-2xl" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
