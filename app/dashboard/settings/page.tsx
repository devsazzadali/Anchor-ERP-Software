'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Landmark, User, MapPin, Check, Edit3, ShieldAlert, FileText, ChevronRight, Calendar, Download, Lock } from 'lucide-react'
import * as XLSX from 'xlsx'
import { generatePdf } from '@/lib/pdf-generator'
import { hashSecurityAnswer } from '@/lib/security-answer'

// profile + salary history from
// GET /api/me/profile (security digest never leaves the server —
// the form only learns whether one is saved), saves go to
// PATCH /api/me/profile (A1 whitelist), the password change goes
// to POST /api/auth/change-password, and the BUG-A5 admin
// broadcast is created by the PATCH route server-side.

const getDuration = (dateString: string) => {
  const start = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - start.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Joined today';
  if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? 's' : ''}`;
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    const days = diffDays % 30;
    return `${months} mo${months > 1 ? 's' : ''}${days > 0 ? `, ${days} d` : ''}`;
  }
  const years = Math.floor(diffDays / 365);
  const remainingMonths = Math.floor((diffDays % 365) / 30);
  return `${years} yr${years > 1 ? 's' : ''}${remainingMonths > 0 ? `, ${remainingMonths} mo` : ''}`;
};

export default function EmployeeSettings() {
  const [profile, setProfile] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  const [salaryHistory, setSalaryHistory] = useState<any[]>([])
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [showExportDropdown, setShowExportDropdown] = useState(false)

  // Form State
  const [fullName, setFullName] = useState('')
  const [address, setAddress] = useState('')
  const [bankInfo, setBankInfo] = useState({
    bankName: '',
    accountName: '',
    accountNumber: '',
    district: '',
    mobileBankingProvider: '',
    mobileBankingNumber: ''
  })
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Security Question
  const [securityQuestion, setSecurityQuestion] = useState('')
  const [securityAnswer, setSecurityAnswer] = useState('')

  // 2FA
  const [is2FAEnabled, setIs2FAEnabled] = useState(false)

  useEffect(() => {
    fetchProfile()
  }, [])

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/me/profile')
      if (!res.ok) return
      const { profile: data, salaryHistory: salaryData } = await res.json()

      setProfile(data)
      setFullName(data.full_name || '')
      setAddress(data.address || '')
      setSecurityQuestion(data.security_question || '')
      setIs2FAEnabled(data.is_2fa_enabled || false)
      // Intentionally not setting the answer in state so it stays hidden unless they change it
      
      if (data.bank_info) {
        setBankInfo({
          bankName: data.bank_info.bankName || '',
          accountName: data.bank_info.accountName || '',
          accountNumber: data.bank_info.accountNumber || '',
          district: data.bank_info.district || data.bank_info.routingNumber || '',
          mobileBankingProvider: data.bank_info.mobileBankingProvider || '',
          mobileBankingNumber: data.bank_info.mobileBankingNumber || ''
        })
      }

      setSalaryHistory(salaryData || [])
    } catch (err) {
      console.error('Error fetching profile:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setFeedback(null)

    try {
      const updateData: any = {
        full_name: fullName,
        address: address,
        bank_info: bankInfo,
        security_question: securityQuestion,
        is_2fa_enabled: is2FAEnabled
      }

      // Only update answer if they typed a new one.
      // D: store the DIGEST, never the plaintext answer.
      if (securityAnswer.trim() !== '') {
        updateData.security_answer = await hashSecurityAnswer(securityAnswer)
      }

      const res = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || 'Failed to update profile')
      }

      if (newPassword) {
        if (newPassword !== confirmPassword) {
          throw new Error('New passwords do not match')
        }
        if (newPassword.length < 6) {
          throw new Error('Password must be at least 6 characters')
        }
        const pwRes = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: newPassword }),
        })
        if (!pwRes.ok) {
          const body = await pwRes.json().catch(() => null)
          throw new Error(body?.error || 'Failed to update password')
        }
      }

      setFeedback({ type: 'success', message: 'Profile information updated successfully.' })
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setFeedback(null), 3000)
      
      // BUG-A5 FIX: Notify admins about profile update.
      // user_id is null + is_admin_only:true = broadcast to all admins via NotificationDropdown filter
      // The admin broadcast is created by PATCH /api/me/profile server-side.

      await fetchProfile()
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update profile.' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleBankChange = (field: string, value: string) => {
    setBankInfo(prev => ({ ...prev, [field]: value }))
  }

  const getDossierSpreadsheetData = () => {
    const data: any[] = []
    
    // Profile Header Section
    data.push({ 'Employee Dossier': 'COMPREHENSIVE RECORD' })
    data.push({ 'Employee Dossier': '' }) // blank line
    data.push({ 'Employee Dossier': 'Full Name:', 'Value': profile?.full_name || 'N/A' })
    data.push({ 'Employee Dossier': 'Address:', 'Value': profile?.address || 'N/A' })
    // BUG-B5 FIX: profile.branch and profile.salary columns don't exist.
    // Use branch_id as reference identifier, and base_salary for salary.
    data.push({ 'Employee Dossier': 'Branch ID (Ref):', 'Value': profile?.branch_id || 'N/A' })
    data.push({ 'Employee Dossier': 'Base Salary Setup:', 'Value': profile?.base_salary ? `${profile.base_salary} BDT` : 'N/A' })
    data.push({ 'Employee Dossier': '' }) // blank line
    
    data.push({ 'Employee Dossier': 'BANKING DETAILS' })
    if (bankInfo.bankName) {
      data.push({ 'Employee Dossier': 'Bank Name:', 'Value': bankInfo.bankName })
      data.push({ 'Employee Dossier': 'Account Name:', 'Value': bankInfo.accountName })
      data.push({ 'Employee Dossier': 'Account No:', 'Value': bankInfo.accountNumber })
    }
    if (bankInfo.mobileBankingProvider) {
      data.push({ 'Employee Dossier': 'Mobile Wallet:', 'Value': bankInfo.mobileBankingProvider })
      data.push({ 'Employee Dossier': 'Mobile No:', 'Value': bankInfo.mobileBankingNumber })
    }
    
    data.push({ 'Employee Dossier': '' }) // blank line
    data.push({ 'Employee Dossier': 'SALARY DISBURSEMENT HISTORY' })
    
    // Salary Header Row
    data.push({
      'Employee Dossier': 'Payment Date',
      'Value': 'Amount (BDT)',
      'Column C': 'Transaction ID',
      'Column D': 'Account/Reference',
      'Column E': 'Remarks'
    })
    
    // Salary Rows
    const selectedHistory = selectedHistoryIds.length > 0 ? salaryHistory.filter(s => selectedHistoryIds.includes(s.id)) : []
    const historyToExport = selectedHistoryIds.length > 0 ? selectedHistory : [];

    historyToExport.forEach(s => {
      data.push({
        'Employee Dossier': new Date(s.payment_date).toLocaleDateString(),
        'Value': s.amount,
        'Column C': s.transaction_id || 'N/A',
        'Column D': s.account || 'N/A',
        'Column E': s.notes || 'N/A'
      })
    })

    return data
  }

  const handleExportDossierExcel = () => {
    const dataToExport = getDossierSpreadsheetData()
    const worksheet = XLSX.utils.json_to_sheet(dataToExport, { skipHeader: true })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'EmployeeDossier')
    XLSX.writeFile(workbook, `employee_dossier_${fullName.replace(/\s+/g, '_')}.xlsx`)
  }

  const handleExportDossierCSV = () => {
    const dataToExport = getDossierSpreadsheetData()
    const worksheet = XLSX.utils.json_to_sheet(dataToExport, { skipHeader: true })
    const csvContent = XLSX.utils.sheet_to_csv(worksheet)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `employee_dossier_${fullName.replace(/\s+/g, '_')}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleExportDossierPDF = async () => {
    if (salaryHistory.length > 0 && selectedHistoryIds.length === 0) { alert("Please select at least one salary record to export."); return; }
    const historyToExport = selectedHistoryIds.length > 0 ? salaryHistory.filter((s: any) => selectedHistoryIds.includes(s.id)) : [];
    const columns = ['Payment Date', 'Amount (BDT)', 'Transaction ID', 'Account/Reference', 'Remarks']
    const rows = historyToExport.map((s: any) => [
      new Date(s.payment_date).toLocaleDateString(),
      `${Number(s.amount).toLocaleString()}`,
      s.transaction_id || 'N/A',
      s.account || 'N/A',
      s.notes || 'N/A'
    ])
    
    const totalPayments = historyToExport.reduce((sum: any, s: any) => sum + Number(s.amount), 0)

    await generatePdf(`Comprehensive Dossier: ${fullName || (profile?.profile_type === 'head_office' ? 'Head Office' : 'Employee')}`, columns, rows, {
      summaryData: [
        { label: 'Total Salary Received', value: `${totalPayments.toLocaleString()} BDT` }
      ],
      filename: `dossier_${new Date().getTime()}.pdf`
    })
  }

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex bg-white">
{/* Sidebar removed – global layout provides it */}
        <div className="flex-1 flex items-center justify-center">
           <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans">
      <div className="absolute top-[-10%] right-[-5%] w-[50%] h-[50%] bg-[#d4af37]/5 rounded-full filter blur-[150px] pointer-events-none" />
{/* Sidebar removed – global layout provides it */}

      <div className="flex-1 p-6 lg:p-10 overflow-y-auto max-h-screen relative z-10">
        <div className="mb-8 pb-4 border-b border-slate-900/5">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-serif">
            Profile <span className="premium-text-gradient">Settings</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {profile?.profile_type === 'partner'
              ? 'Manage your partner profile and banking details for payment settlements.'
              : 'Manage your employee profile and banking details for salary disbursement.'}
          </p>
        </div>

        {feedback && (
          <div className={`p-4 rounded-xl text-xs mb-6 flex gap-2 border ${
            feedback.type === 'success' 
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' 
              : 'bg-rose-500/10 border-rose-500/20 text-rose-600'
          }`}>
            {feedback.type === 'success' ? <Check className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            <span>{feedback.message}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT: EDITABLE PROFILE */}
          <div className="lg:col-span-8 space-y-6">
            <form onSubmit={handleSave} className="space-y-6">
              
              {/* Personal Details */}
              <div className="glass-panel p-6 rounded-2xl relative shadow-xl">
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/20 to-transparent" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-5">Personal Information</span>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Full Name</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Current Address</label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Bank Details */}
              <div className="glass-panel p-6 rounded-2xl relative shadow-xl">
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/20 to-transparent" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-5">Banking & Disbursement Information</span>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Bank Name</label>
                    <input
                      type="text"
                      value={bankInfo.bankName}
                      onChange={(e) => handleBankChange('bankName', e.target.value)}
                      placeholder="e.g. Example Bank"
                      className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Account Holder Name</label>
                    <input
                      type="text"
                      value={bankInfo.accountName}
                      onChange={(e) => handleBankChange('accountName', e.target.value)}
                      placeholder="e.g. Account Holder Name"
                      className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Account Number</label>
                    <input
                      type="text"
                      value={bankInfo.accountNumber}
                      onChange={(e) => handleBankChange('accountNumber', e.target.value)}
                      placeholder="e.g. 123456789"
                      className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">District</label>
                    <input
                      type="text"
                      value={bankInfo.district}
                      onChange={(e) => handleBankChange('district', e.target.value)}
                      placeholder="e.g. City Name"
                      className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                    />
                  </div>
                </div>

                <div className="my-6 border-t border-slate-900/5" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Mobile Banking Provider</label>
                    <input
                      type="text"
                      value={bankInfo.mobileBankingProvider}
                      onChange={(e) => handleBankChange('mobileBankingProvider', e.target.value)}
                      placeholder="e.g. Provider Name"
                      className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Mobile Number</label>
                    <input
                      type="text"
                      value={bankInfo.mobileBankingNumber}
                      onChange={(e) => handleBankChange('mobileBankingNumber', e.target.value)}
                      placeholder="e.g. Phone Number"
                      className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Settings & Privacy (Password) */}
              <div className="glass-panel p-6 rounded-2xl relative shadow-xl">
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/20 to-transparent" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-5">Settings & Privacy</span>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">New Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Leave blank to keep current"
                        className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Confirm New Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                        className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Account Recovery (Security Question) */}
              <div className="glass-panel p-6 rounded-2xl relative shadow-xl">
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/20 to-transparent" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-5 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  Account Recovery (Security Question)
                </span>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Security Question</label>
                    <select
                      value={securityQuestion}
                      onChange={(e) => setSecurityQuestion(e.target.value)}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                    >
                      <option value="" className="bg-white text-slate-900">Select a question...</option>
                      <option value="What was your childhood nickname?" className="bg-white text-slate-900">What was your childhood nickname?</option>
                      <option value="What is the name of your favorite childhood friend?" className="bg-white text-slate-900">What is the name of your favorite childhood friend?</option>
                      <option value="What city were you born in?" className="bg-white text-slate-900">What city were you born in?</option>
                      <option value="What was the name of your first pet?" className="bg-white text-slate-900">What was the name of your first pet?</option>
                      <option value="What is your favorite movie?" className="bg-white text-slate-900">What is your favorite movie?</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Security Answer</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="password"
                        value={securityAnswer}
                        onChange={(e) => setSecurityAnswer(e.target.value)}
                        placeholder={profile?.has_security_answer ? "•••••••• (Saved)" : "Enter secret answer"}
                        className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#d4af37]/40 transition-all"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Two-Factor Authentication (2FA) */}
              <div className="glass-panel p-6 rounded-2xl relative shadow-xl">
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/20 to-transparent" />
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <ShieldAlert className={`w-4 h-4 ${is2FAEnabled ? 'text-emerald-600' : 'text-slate-500'}`} />
                    Two-Factor Authentication (2FA)
                  </span>
                  
                  {/* Toggle Switch */}
                  <button
                    type="button"
                    onClick={() => setIs2FAEnabled(!is2FAEnabled)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${is2FAEnabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                  >
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${is2FAEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">
                  When enabled, you will be required to enter a 6-digit OTP sent to your email each time you log in. This adds an extra layer of security to your account.
                </p>
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="w-full bg-gradient-to-r from-[#d4af37] to-white text-black font-semibold py-4 rounded-xl text-xs tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer shadow-lg hover:shadow-[#d4af37]/20 transition-all disabled:opacity-50"
              >
                {isSaving ? (
                  <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Edit3 className="w-4 h-4" />
                    <span>Save Profile Changes</span>
                  </>
                )}
              </button>

            </form>
          </div>

          {/* RIGHT: READ-ONLY COMPANY INFO */}
          <div className="lg:col-span-4 space-y-6">
            <div className="glass-panel p-6 rounded-2xl relative shadow-xl border border-[#d4af37]/20 bg-[#d4af37]/5">
              <span className="text-[10px] font-bold text-[#8a6d1f] uppercase tracking-widest block mb-5 flex items-center gap-2">
                <Landmark className="w-4 h-4" />
                Company Placement
              </span>

              <div className="space-y-4">
                <div>
                  <span className="block text-[9px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#8a6d1f]" /> Joining Date
                  </span>
                  <div className="text-slate-900 font-semibold text-sm font-mono bg-white border border-[#d4af37]/20 px-3 py-1.5 rounded-lg inline-flex items-center gap-3">
                    <span>{profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : <span className="text-slate-500 italic font-sans">Not Available</span>}</span>
                    {profile?.created_at && (
                      <span className="text-[9px] bg-[#d4af37]/10 text-[#8a6d1f] px-2 py-0.5 rounded uppercase tracking-wider font-bold font-sans">
                        {getDuration(profile.created_at)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-[#d4af37]/10">
                  <span className="block text-[9px] font-semibold text-slate-500 tracking-wider uppercase mb-1">Assigned Branch</span>
                  <div className="text-slate-900 font-semibold text-sm">
                    {profile?.branch || <span className="text-slate-500 italic">Not Assigned</span>}
                  </div>
                </div>
                
                <div className="pt-4 border-t border-[#d4af37]/10">
                  <span className="block text-[9px] font-semibold text-slate-500 tracking-wider uppercase mb-1">Base Salary Setup</span>
                  <div className="text-2xl font-bold text-slate-900">
                    {profile?.salary ? (
                      <>{Number(profile.salary).toLocaleString()} <span className="text-xs text-[#8a6d1f] font-mono font-normal">BDT / mo</span></>
                    ) : (
                      <span className="text-slate-500 italic text-sm">Pending Admin Setup</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 rounded-xl bg-white border border-[#d4af37]/10 text-[10px] text-slate-500 leading-relaxed flex items-center justify-between">
                <span>Branch and Salary configurations are managed exclusively by the Executive Administration. Contact HR for discrepancies.</span>
              </div>
            </div>

            {/* Comprehensive Export Dropdown */}
            <div className="relative z-20 mt-6">
              <button
                type="button"
                onClick={() => setShowExportDropdown(!showExportDropdown)}
                className="w-full bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#d4af37]/40 hover:bg-[#d4af37]/5 text-white font-semibold py-4 rounded-xl text-xs tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <Download className="w-4 h-4 text-[#8a6d1f]" />
                Export Comprehensive Dossier
              </button>
              {showExportDropdown && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowExportDropdown(false)} />
                  <div className="absolute right-0 mt-2 w-full bg-white border border-slate-900/10 rounded-xl shadow-2xl py-2 z-20 flex flex-col">
                    <button onClick={() => { handleExportDossierExcel(); setShowExportDropdown(false) }} className="px-4 py-3 text-left text-xs font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors cursor-pointer">
                      Export Full Dossier (.xlsx)
                    </button>
                    <button onClick={() => { handleExportDossierCSV(); setShowExportDropdown(false) }} className="px-4 py-3 text-left text-xs font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors border-t border-slate-900/5 cursor-pointer">
                      Export Full Dossier (.csv)
                    </button>
                    <button onClick={() => { handleExportDossierPDF(); setShowExportDropdown(false) }} className="px-4 py-3 text-left text-xs font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors border-t border-slate-900/5 cursor-pointer">
                      Export Ledger (.pdf)
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Salary History Unified Table */}
            <div className="glass-panel p-6 rounded-2xl relative shadow-xl border border-slate-900/5 bg-slate-900/[0.04] mt-6">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-5 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Your Salary Ledger
              </span>
              
              <div className="space-y-3 max-h-[350px] overflow-y-auto custom-scrollbar pr-2">
                {salaryHistory.length === 0 ? (
                  <div className="text-center py-6 text-slate-500 text-xs italic">
                    No salary disbursements have been recorded yet.
                  </div>
                ) : (
                  salaryHistory.map((salary) => (
                    <div key={salary.id} className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-slate-900/10 transition-all">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="text-[11px] font-bold text-slate-900 flex items-center gap-1.5">
                            <Calendar className="w-3 h-3 text-[#8a6d1f]" />
                            {new Date(salary.payment_date).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Salary Received</span>
                          <span className="text-sm font-bold text-emerald-600 font-serif">+{Number(salary.amount).toLocaleString()} BDT</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-slate-500">
                        {salary.transaction_id && <span>Trx: <span className="font-mono text-slate-600">{salary.transaction_id}</span></span>}
                        {salary.notes && <span className="text-[#8a6d1f]/80">Note: {salary.notes}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
