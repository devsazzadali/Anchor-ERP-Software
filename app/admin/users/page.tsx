'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, Landmark, MapPin, Copy, CreditCard, Check, X, Camera, ShieldCheck, UserX, UserCheck, UserCircle, Search, Image as ImageIcon, FileText, Download, CheckSquare, Square, Calendar, Building2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { generatePdf } from '@/lib/pdf-generator'
import { uploadFile } from '@/lib/files-client'

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

export default function AdminUsersDirectory() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [users, setUsers] = useState<any[]>([])
  // F5: directory figures/list must not flash "Directory (0)" or the
  // empty state before the first /api/admin/users load completes.
  const [isUsersLoading, setIsUsersLoading] = useState(true)
  const [selectedUser, setSelectedUser] = useState<any | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showExportDropdown, setShowExportDropdown] = useState(false)
  const [showDossierDropdown, setShowDossierDropdown] = useState(false)
  const [isSelectMode, setIsSelectMode] = useState(false)

  // URL-driven tab
  const activeTab = (searchParams?.get('tab') ?? 'employees') as 'employees' | 'partners'

  const updateTab = (tab: 'employees' | 'partners') => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    if (tab === 'employees') {
      params.delete('tab')
    } else {
      params.set('tab', tab)
    }
    params.delete('user') // clear selected user when switching tabs
    const qs = params.toString()
    router.replace(pathname + (qs ? '?' + qs : ''))
    setSelectedUser(null)
  }

  // Extra Details for selected user
  const [kycDetails, setKycDetails] = useState<any | null>(null)
  const [financialStats, setFinancialStats] = useState<{ totalPaid: number, count: number }>({ totalPaid: 0, count: 0 })
  // F5: per-user detail figures (Total Paid / frequency / ledger list)
  // show skeletons until /api/admin/user-details has loaded, not 0 BDT.
  const [isDetailsLoading, setIsDetailsLoading] = useState(false)
  const [salaryHistory, setSalaryHistory] = useState<any[]>([]); // kept for backward compat; use paymentHistory
  // New: payment history list
  const [paymentHistory, setPaymentHistory] = useState<any[]>([])
  const [selectedProfileVouchers, setSelectedProfileVouchers] = useState<string[]>([])
  const [selectedGlobalVouchers, setSelectedGlobalVouchers] = useState<string[]>([])

  // Loaded branches
  const [branches, setBranches] = useState<any[]>([])
  const [selectedHistoryBranch, setSelectedHistoryBranch] = useState<string>('all')
  const [showGlobalExportDropdown, setShowGlobalExportDropdown] = useState(false)

  // Loaded positions
  const [positions, setPositions] = useState<any[]>([])
  const [positionInput, setPositionInput] = useState('')
  const [newPositionInput, setNewPositionInput] = useState('')

  // Branch Transfer states
  const [showBranchModal, setShowBranchModal] = useState(false)
  const [transferBranchId, setTransferBranchId] = useState('')
  const [transferJoinDate, setTransferJoinDate] = useState(new Date().toISOString().split('T')[0])
  const [transferNote, setTransferNote] = useState('')
  const [branchTransfers, setBranchTransfers] = useState<any[]>([])

  // Position Transfer states
  const [showPositionModal, setShowPositionModal] = useState(false)
  const [transferPositionId, setTransferPositionId] = useState('')
  const [transferPositionJoinDate, setTransferPositionJoinDate] = useState(new Date().toISOString().split('T')[0])
  const [transferPositionNote, setTransferPositionNote] = useState('')
  const [positionTransfers, setPositionTransfers] = useState<any[]>([])

  // Edit mode for branch/salary/position
  const [isEditing, setIsEditing] = useState(false)
  const [branchInput, setBranchInput] = useState('')
  const [salaryInput, setSalaryInput] = useState('')
  const [positionInputState, setPositionInputState] = useState('')
  const [profileTypeInput, setProfileTypeInput] = useState('')
  const [joiningDateInput, setJoiningDateInput] = useState('')

  // Add Salary Modal
  const [showSalaryModal, setShowSalaryModal] = useState(false)
  const [amount, setAmount] = useState('')
  const [overtimeAmount, setOvertimeAmount] = useState('')
  const [bonusAmount, setBonusAmount] = useState('')
  const [salesCommission, setSalesCommission] = useState('')
  const [tiffinBill, setTiffinBill] = useState('')
  const [ledgerHeads, setLedgerHeads] = useState<any[]>([])
  const [ledgerHeadId, setLedgerHeadId] = useState('')
  const [salaryNote, setSalaryNote] = useState('')
  const [trxId, setTrxId] = useState('')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [proofFile, setProofFile] = useState<File | null>(null)

  // Modal states for branch and account method selection
  const [selectedSalaryBranch, setSelectedSalaryBranch] = useState<string>('')
  const [selectedSalaryAccount, setSelectedSalaryAccount] = useState<string>('Custom')
  const [customAccountInput, setCustomAccountInput] = useState<string>('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  // Manager Assignment
  const [managerAssignBranch, setManagerAssignBranch] = useState('')
  const [managerAssignNotes, setManagerAssignNotes] = useState('')

  // Master Ledger State
  const [masterLedger, setMasterLedger] = useState<any[]>([])

  // Fullscreen Image viewer
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null)

  // SEC-01 FIX: Removed isDemoAdmin localStorage bypass.
  // All access MUST be verified via real auth session — no exceptions.
  useEffect(() => {
    const initSession = async () => {
      try {
        const res = await fetch('/api/auth/me')
        if (!res.ok) {
          router.replace('/')
          return
        }
        const { user } = await res.json()
        if (!user) {
          router.replace('/')
          return
        }
        setCurrentUserId(user.id)
      } catch (e) {
        router.replace('/')
        return
      }
      fetchUsers()
      fetchBranches()
      fetchPositions()
      fetchMasterLedger()
      fetchLedgerHeads()
    }
    initSession()
  }, [])

  const fetchLedgerHeads = async () => {
    try {
      const res = await fetch('/api/ledger-heads')
      if (!res.ok) return
      const { ledger_heads } = await res.json()
      // Old filter: name ILIKE '%Salary%' OR code_number = 11.
      const data = (ledger_heads || []).filter((h: any) =>
        (h.name && h.name.toLowerCase().includes('salary')) || String(h.code_number) === '11'
      )
      if (data.length > 0) {
        setLedgerHeads(data)
        const code11 = data.find((d: any) => String(d.code_number) === '11')
        setLedgerHeadId(code11 ? code11.id : data[0].id)
      }
    } catch (err) {
      console.error(err)
    }
  }

  const fetchBranches = async () => {
    try {
      const res = await fetch('/api/admin/branches')
      if (!res.ok) throw new Error('Failed to fetch branches')
      const { branches: data } = await res.json()
      setBranches(data || [])
    } catch (e) {
      console.error('Failed to fetch branches', e)
    }
  }

  const fetchPositions = async () => {
    try {
      const res = await fetch('/api/admin/positions')
      if (!res.ok) throw new Error('Failed to fetch positions')
      const { positions: data } = await res.json()
      setPositions(data || [])
    } catch (e: any) {
      console.error('Failed to fetch positions:', e?.message || e)
    }
  }

  const fetchMasterLedger = async () => {
    try {
      const res = await fetch('/api/admin/master-ledger')
      if (!res.ok) throw new Error('Failed to fetch master ledger')
      const { salaryPayments: salaryData, payouts: payoutData } = await res.json()

      const formattedSalaries = (salaryData || []).map((item: any) => ({
        ...item,
        profile_type: item.profiles?.profile_type || 'employee'
      }))

      const formattedPayouts = (payoutData || []).map((item: any) => ({
        id: item.id,
        amount: item.amount,
        payment_date: item.completed_at || item.created_at || new Date().toISOString(),
        transaction_id: item.transaction_id,
        payment_proof_url: null,
        notes: 'Completed Payout Request',
        base_salary_at_time: null,
        account: item.payment_method || 'Payout Request',
        employee_id: item.user_id,
        profiles: item.profiles,
        profile_type: item.profiles?.profile_type || 'partner'
      }))

      const combined = [...formattedSalaries, ...formattedPayouts].sort((a, b) =>
        new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
      )

      setMasterLedger(combined)
    } catch (err: any) {
      console.error('Failed to fetch master ledger:', err.message)
    }
  }

  const handleCreatePosition = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPositionInput.trim()) return
    setIsSubmitting(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/admin/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPositionInput.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create position.')
      }
      setFeedback({ type: 'success', message: 'Position created successfully!' })
      setNewPositionInput('')
      fetchPositions()
      setTimeout(() => setFeedback(null), 3000)
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to create position.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeletePosition = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete the position "${name}"?`)) return
    setIsSubmitting(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/admin/positions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete position.')
      }
      setFeedback({ type: 'success', message: 'Position deleted successfully.' })
      fetchPositions()
      setTimeout(() => setFeedback(null), 3000)
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to delete position. Ensure no employees are assigned to it.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBranchTransfer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser || !transferBranchId || !transferJoinDate) return
    setIsSubmitting(true)
    setFeedback(null)

    try {
      const response = await fetch('/api/branch-transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: selectedUser.id,
          newBranchId: transferBranchId,
          joinDate: transferJoinDate,
          note: transferNote
        })
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to transfer branch')
      }

      setFeedback({ type: 'success', message: 'Branch transferred and notifications sent successfully.' })
      setTimeout(() => setFeedback(null), 3000)

      setShowBranchModal(false)
      setTransferBranchId('')
      setTransferNote('')

      // Refresh user lists and current select user details
      await fetchUsers()
      // Bug fix #10: use actual profile_type so partners get correct financial history
      fetchUserDetails(selectedUser.id, selectedUser.profile_type || 'employee')
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to complete transfer.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePositionTransfer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser || !transferPositionId || !transferPositionJoinDate) return
    setIsSubmitting(true)
    setFeedback(null)

    try {
      const response = await fetch('/api/position-transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: selectedUser.id,
          newPositionId: transferPositionId,
          joinDate: transferPositionJoinDate,
          note: transferPositionNote
        })
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to change position')
      }

      setFeedback({ type: 'success', message: 'Position changed and notifications sent successfully.' })
      setTimeout(() => setFeedback(null), 3000)

      setShowPositionModal(false)
      setTransferPositionId('')
      setTransferPositionNote('')

      // Refresh user lists and current select user details
      await fetchUsers()
      // Bug fix #10: use actual profile_type so partners get correct financial history
      fetchUserDetails(selectedUser.id, selectedUser.profile_type || 'employee')
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to complete position change.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAssignManager = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser || !managerAssignBranch) return
    setIsSubmitting(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/branch-accounts/manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: selectedUser.id,
          branch_id: managerAssignBranch,
          notes: managerAssignNotes
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to assign manager')

      setFeedback({ type: 'success', message: 'Assigned as Branch Manager successfully!' })
      setTimeout(() => setFeedback(null), 3000)
      setManagerAssignBranch('')
      setManagerAssignNotes('')

      await fetchUsers()
      fetchUserDetails(selectedUser.id, 'branch_manager')
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRemoveManager = async () => {
    if (!selectedUser) return
    if (!confirm(`Remove Branch Manager role from ${selectedUser.full_name}? They will become a regular employee.`)) return
    setIsSubmitting(true)
    setFeedback(null)
    try {
      const res = await fetch(`/api/branch-accounts/manager?employee_id=${selectedUser.id}`, {
        method: 'DELETE',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to remove manager role')
      setFeedback({ type: 'success', message: 'Branch Manager role revoked successfully.' })
      setTimeout(() => setFeedback(null), 3000)
      await fetchUsers()
      fetchUserDetails(selectedUser.id, 'employee')
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/admin/users')

      if (!response.ok) {
        if (response.status === 401) {
          // Session expired — the app session cannot be silently
          // refreshed from the client; send the admin to sign in.
          router.replace('/')
          return
        }
        throw new Error('Failed to fetch users from API')
      }

      const responseData = await response.json()
      // Filter out admin and super_admin from this view, and only show approved users
      const data = (responseData.users || []).filter((u: any) => u.role !== 'admin' && u.role !== 'super_admin' && u.verification_status === 'approved')
      setUsers(data || [])

      if (selectedUser && data) {
        const updated = data.find((u: any) => u.id === selectedUser.id)
        if (updated) setSelectedUser(updated)
      }
    } catch (err: any) {
      console.error('fetchUsers failed:', err?.message || err?.toString() || 'Unknown error')
    } finally {
      setIsUsersLoading(false)
    }
  }

  const handleExportCSV = () => {
    const selectedUsers = selectedIds.length > 0
      ? users.filter(u => selectedIds.includes(u.id))
      : users.filter(u => {
          const pt = u.profile_type || 'partner'
          return activeTab === 'employees' ? (pt === 'employee' || pt === 'head_office' || pt === 'branch_manager') : pt === 'partner'
        })
    if (selectedUsers.length === 0) return

    // Define CSV Headers
    const headers = [
      'Full Name',
      'Phone Number',
      'Role',
      'Profile Type',
      'Salary (BDT)',
      'Branch',
      'Position',
      'Address',
      'Verification Status',
      'Bank/Wallet Details',
      'Created At'
    ]

    // Convert rows
    const rows = selectedUsers.map(u => {
      let bankDetails = ''
      if (u.bank_info) {
        if (u.bank_info.bankName) {
          bankDetails = `Bank: ${u.bank_info.bankName} | Account Name: ${u.bank_info.accountName || ''} | Account No: ${u.bank_info.accountNumber || ''}`
        } else if (u.bank_info.mobileNumber) {
          bankDetails = `Wallet: ${u.bank_info.walletType || ''} | Mobile: ${u.bank_info.mobileNumber}`
        }
      }

      // Escape quotes
      const escape = (val: any) => {
        const text = val === null || val === undefined ? '' : String(val)
        return `"${text.replace(/"/g, '""')}"`
      }

      return [
        escape(u.full_name),
        escape(u.phone_number || 'N/A'),
        escape(u.role),
        escape(u.profile_type),
        u.salary || 0,
        escape(u.branch || 'N/A'),
        escape(u.position || 'N/A'),
        escape(u.address || 'N/A'),
        escape(u.verification_status),
        escape(bankDetails),
        escape(new Date(u.created_at).toLocaleString())
      ].join(',')
    })

    const csvContent = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `users_directory_export_${new Date().toISOString().slice(0,10)}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleExportExcel = () => {
    const selectedUsers = selectedIds.length > 0
      ? users.filter(u => selectedIds.includes(u.id))
      : users.filter(u => {
          const pt = u.profile_type || 'partner'
          return activeTab === 'employees' ? (pt === 'employee' || pt === 'head_office' || pt === 'branch_manager') : pt === 'partner'
        })
    if (selectedUsers.length === 0) return

    const dataToExport = selectedUsers.map(u => {
      let bankDetails = ''
      if (u.bank_info) {
        if (u.bank_info.bankName) {
          bankDetails = `Bank: ${u.bank_info.bankName} | Account Name: ${u.bank_info.accountName || ''} | Account No: ${u.bank_info.accountNumber || ''}`
        } else if (u.bank_info.mobileNumber) {
          bankDetails = `Wallet: ${u.bank_info.walletType || ''} | Mobile: ${u.bank_info.mobileNumber}`
        }
      }

      return {
        'Full Name': u.full_name,
        'Phone Number': u.phone_number || 'N/A',
        'Role': u.role,
        'Profile Type': u.profile_type,
        'Salary (BDT)': u.salary || 0,
        'Branch': u.branch || 'N/A',
        'Position': u.position || 'N/A',
        'Address': u.address || 'N/A',
        'Verification Status': u.verification_status,
        'Bank/Wallet Details': bankDetails,
        'Created At': new Date(u.created_at).toLocaleString()
      }
    })

    const worksheet = XLSX.utils.json_to_sheet(dataToExport)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'UsersData')
    XLSX.writeFile(workbook, `users_directory_export_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  const handleExportPDF = async () => {
    const selectedUsers = selectedIds.length > 0
      ? users.filter(u => selectedIds.includes(u.id))
      : users.filter(u => {
          const pt = u.profile_type || 'partner'
          return activeTab === 'employees' ? (pt === 'employee' || pt === 'head_office' || pt === 'branch_manager') : pt === 'partner'
        })
    if (selectedUsers.length === 0) return

    const columns = [
      'Full Name',
      'Phone Number',
      'Role',
      'Profile Type',
      'Salary (BDT)',
      'Branch',
      'Position',
      'Address',
      'Verification Status',
      'Bank/Wallet Details',
      'Joined Date'
    ]

    const rows = selectedUsers.map(u => {
      let bankDetails = 'N/A'
      if (u.bank_info) {
        if (u.bank_info.bankName) {
          bankDetails = `Bank: ${u.bank_info.bankName}, A/C: ${u.bank_info.accountName}, No: ${u.bank_info.accountNumber}`
        } else if (u.bank_info.mobileNumber) {
          bankDetails = `Wallet: ${u.bank_info.walletType}, Mobile: ${u.bank_info.mobileNumber}`
        }
      }
      return [
        u.full_name || '',
        u.phone_number || 'N/A',
        u.role || '',
        u.profile_type || '',
        (u.salary || 0).toString(),
        u.branch || 'N/A',
        u.position || 'N/A',
        u.address || 'N/A',
        u.verification_status || '',
        bankDetails || '',
        new Date(u.created_at).toLocaleDateString()
      ]
    })

    const totalSalary = selectedUsers.reduce((sum, u) => sum + Number(u.salary || 0), 0)

    await generatePdf('Users Directory', columns, rows, {
      summaryData: [
        { label: 'Total Base Salary', value: `${totalSalary.toLocaleString()} BDT` }
      ],
      filename: `users_${new Date().getTime()}.pdf`
    })
  }

  const fetchUserDetails = async (userId: string, profileType: string) => {
    setKycDetails(null)
    setFinancialStats({ totalPaid: 0, count: 0 })
    setPaymentHistory([])
    setBranchTransfers([])
    setIsDetailsLoading(true)

    try {
      const res = await fetch(`/api/admin/user-details?user_id=${encodeURIComponent(userId)}`)
      if (!res.ok) throw new Error('Failed to fetch user details')
      const bundle = await res.json()

      // 1. KYC Data (latest verification request)
      if (bundle.kyc) setKycDetails(bundle.kyc)

      // 2. Fetch Financial Stats based on profile type
      if (profileType === 'employee' || profileType === 'head_office' || profileType === 'branch_manager') {
          const salaries = bundle.salaries || []
          const total = salaries.reduce((sum: number, s: any) => sum + Number(s.amount), 0)
          setFinancialStats({ totalPaid: total, count: salaries.length })
          setPaymentHistory(salaries)

          // 3. Branch Transfers History
          if (bundle.branchTransfers) {
            setBranchTransfers(bundle.branchTransfers)
          }

          // 4. Position Transfers History
          if (bundle.positionTransfers) {
            setPositionTransfers(bundle.positionTransfers)
          }
        } else {
          // 1. Direct Value Transfers issued by Admin (from salary_payments)
          const partnerSalaries = bundle.salaries || []

          // 2. Completed Payout Requests requested by partner (from payment_requests)
          const payouts = bundle.payouts || []

          const formattedPayouts = (payouts || []).map((p: any) => ({
            id: p.id,
            amount: p.amount,
            transaction_id: p.transaction_id,
            payment_date: p.completed_at || p.created_at || new Date().toISOString(),
            branch_id: null,
            account: p.payment_method || 'Payout Request',
            notes: 'Completed Payout Request'
          }))

          const combinedHistory = [...(partnerSalaries || []), ...formattedPayouts].sort((a, b) =>
            new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
          )

          const total = combinedHistory.reduce((sum, p) => sum + Number(p.amount), 0)
          setFinancialStats({ totalPaid: total, count: combinedHistory.length })
          setPaymentHistory(combinedHistory)
        }

    } catch (err) {
      console.error('Error fetching details:', err)
    } finally {
      setIsDetailsLoading(false)
    }
  }

  // Helper: get full image URL - handles both full URLs and relative paths.
  // KYC documents resolve through the file server (owner-or-admin
  // kyc bucket) — never a public storage URL.
  const getKycImageUrl = (url: string | null | undefined, bucket = 'kyc') => {
    if (!url) return null
    if (url.startsWith('http://') || url.startsWith('https://')) return url
    if (url.startsWith('/')) return url
    return `/api/files/${bucket}/${url}`
  }

  const userParam = searchParams?.get('user') ?? null

  useEffect(() => {
    if (userParam && users.length > 0 && (!selectedUser || selectedUser.id !== userParam)) {
      const found = users.find(u => u.id === userParam)
      if (found) {
        setSelectedUser(found)
        setBranchInput(found.branch_id || '')
        setSalaryInput(found.salary ? String(found.salary) : '')
        setPositionInput(found.position_id || '')
        setProfileTypeInput(found.profile_type || 'partner')
        setIsEditing(false)
        setSelectedHistoryBranch('all')
        fetchUserDetails(found.id, found.profile_type || 'employee')
      }
    }
  }, [userParam, users, selectedUser])

  const handleSelect = (user: any) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('user', user.id)
    const targetTab = user.profile_type === 'partner' ? 'partners' : 'employees'
    params.set('tab', targetTab)
    router.replace(pathname + '?' + params.toString())

    setSelectedUser(user)
    setBranchInput(user.branch_id || '')
    setSalaryInput(user.salary ? String(user.salary) : '')
    setPositionInput(user.position_id || '')
    setProfileTypeInput(user.profile_type || 'partner')
    setJoiningDateInput(user.joining_date ? String(user.joining_date) : (user.created_at ? new Date(user.created_at).toISOString().split('T')[0] : ''))
    setIsEditing(false)
    setSelectedHistoryBranch('all')
    fetchUserDetails(user.id, user.profile_type || 'employee')
  }



  // ---------------------------------------------------
  // Profile update handler (used by the Save button)
  // ---------------------------------------------------
  const handleUpdateProfile = async () => {
    if (!selectedUser) return;
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const payload: any = {};
      if (branchInput) payload.branch_id = branchInput;
      if (positionInput) payload.position_id = positionInput;
      if (salaryInput) payload.salary = Number(salaryInput);
      if (profileTypeInput) payload.profile_type = profileTypeInput;
      if (joiningDateInput) payload.joining_date = joiningDateInput;

      const isSalaryUpdated = salaryInput && Number(salaryInput) !== selectedUser.salary;

      const res = await fetch(`/api/admin/profiles/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update profile');
      }

      if (isSalaryUpdated) {
        fetch('/api/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'SALARY_UPDATED',
            payload: {
              userId: selectedUser.id,
              userName: selectedUser.full_name || 'Employee',
              newSalary: Number(salaryInput),
              currency: 'BDT'
            }
          })
        }).catch(e => console.error('Failed to trigger salary update email', e));
      }

      setFeedback({ type: 'success', message: 'Profile updated successfully.' });
      setTimeout(() => setFeedback(null), 3000);
      setIsEditing(false);
      fetchUsers();
      // Refresh salary history if salary was updated
      if (salaryInput) fetchUserDetails(selectedUser.id, selectedUser.profile_type || 'employee');
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleBan = async () => {
    if (!selectedUser) return;
    setIsSubmitting(true);
    const newStatus = !selectedUser.is_banned;
    try {
      const res = await fetch(`/api/admin/profiles/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_banned: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update ban status');
      }

      setFeedback({ type: 'success', message: `User has been successfully ${newStatus ? 'BANNED' : 'UNBANNED'}.` });
      setTimeout(() => setFeedback(null), 3000);
      fetchUsers();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  // New: Delete user profile (admin only)
  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    if (selectedUser.id === currentUserId) {
      setFeedback({ type: 'error', message: 'You cannot delete your own admin account.' });
      return;
    }
    if (!confirm(`Are you sure you want to permanently delete user "${selectedUser.full_name}"?`)) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/profiles/${selectedUser.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete user');
      }
      setFeedback({ type: 'success', message: 'User deleted successfully.' });
      setTimeout(() => setFeedback(null), 3000);
      // Clear selection and refresh list
      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setFeedback({ type: 'success', message: 'Copied to clipboard!' })
    setTimeout(() => setFeedback(null), 2000)
  }

  const handleAddSalary = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return
    setIsSubmitting(true)
    setFeedback(null)

    const finalAccount = selectedSalaryAccount === 'Custom' ? customAccountInput : selectedSalaryAccount;
    const basicAmountNum = Number(amount || 0);
    const overtimeNum = Number(overtimeAmount || 0);
    const bonusNum = Number(bonusAmount || 0);
    const salesCommissionNum = Number(salesCommission || 0);
    const tiffinBillNum = Number(tiffinBill || 0);
    const totalAmount = basicAmountNum + overtimeNum + bonusNum + salesCommissionNum + tiffinBillNum;

    if (totalAmount <= 0) {
      setFeedback({ type: 'error', message: 'Total amount must be greater than zero.' });
      setIsSubmitting(false);
      return;
    }

    if (activeTab === 'employees' && !ledgerHeadId) {
      setFeedback({ type: 'error', message: 'Please select a Ledger Head for this salary payment.' });
      setIsSubmitting(false);
      return;
    }

    try {
      let proofUrl = null
      if (proofFile) {
        const fileExt = proofFile.name.split('.').pop()
        const fileName = `${selectedUser.id}_${Date.now()}.${fileExt}`
        // salary proof slips go through the file server —
        // same 'salaries' bucket as the old system (now served to
        // authenticated users only by /api/files).
        const uploaded = await uploadFile('salaries', proofFile, fileName)
        proofUrl = uploaded.url
      }

      const salaryRes = await fetch('/api/admin/salary-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: selectedUser.id,
          amount: totalAmount,
          transaction_id: trxId,
          payment_proof_url: proofUrl,
          payment_date: new Date(paymentDate.includes('T') ? paymentDate : `${paymentDate}T12:00:00.000Z`).toISOString(),
          branch_id: selectedSalaryBranch || null,
          account: finalAccount || null,
          notes: salaryNote || null,
          base_salary_at_time: basicAmountNum,
          overtime_amount: overtimeNum,
          bonus_amount: bonusNum,
          sales_commission: salesCommissionNum,
          tiffin_bill: tiffinBillNum,
          total_salary: totalAmount,
          ledger_head_id: activeTab === 'employees' ? ledgerHeadId : null
        }),
      })
      if (!salaryRes.ok) {
        const data = await salaryRes.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to record salary.')
      }
      const { payment: salaryData } = await salaryRes.json()

      if (activeTab === 'employees' && ledgerHeadId) {
        // Mirror the payment into the branch cash ledger; the API
        // stamps manager_id from the caller's session server-side.
        try {
          await fetch('/api/admin/branch-cash-expenses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              branch_id: selectedSalaryBranch || null,
              ledger_head_id: ledgerHeadId,
              amount: totalAmount,
              expense_date: new Date(paymentDate.includes('T') ? paymentDate : `${paymentDate}T12:00:00.000Z`).toISOString().split('T')[0],
              description: `Salary Payment for ${selectedUser.full_name}`,
              category: 'other',
              salary_payment_id: salaryData?.id || null
            }),
          })
        } catch (expenseErr) {
          console.warn('Failed to mirror salary into branch cash expenses', expenseErr)
        }
      }

      // Trigger Email
      fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: selectedUser.profile_type === 'partner' ? 'VALUE_TRANSFER_COMPLETED' : 'SALARY_PAID',
          payload: {
            userId: selectedUser.id,
            userName: selectedUser.full_name || 'Employee',
            email: selectedUser.email || null,
            month: new Date(paymentDate.includes('T') ? paymentDate : `${paymentDate}T12:00:00.000Z`).toLocaleString('default', { month: 'long', year: 'numeric' }),
            amount: totalAmount,
            base_salary: basicAmountNum,
            overtime: overtimeNum,
            bonus: bonusNum,
            sales_commission: salesCommissionNum,
            tiffin_bill: tiffinBillNum,
            currency: 'BDT',
            transactionId: trxId || `SAL-${Date.now().toString().slice(-8)}`,
            paymentMethod: finalAccount || 'Payroll Bank Account',
            branchName: branches.find((b: any) => b.id === selectedSalaryBranch)?.name || 'Head Office'
          }
        })
      }).catch(e => console.error('Failed to trigger salary email', e));

      setFeedback({ type: 'success', message: 'Salary payment recorded successfully.' })
      setTimeout(() => setFeedback(null), 3000)

      setShowSalaryModal(false)
      setAmount('')
      setOvertimeAmount('')
      setBonusAmount('')
      setSalesCommission('')
      setTiffinBill('')
      setSalaryNote('')
      setTrxId('')
      setProofFile(null)
      setCustomAccountInput('')
      fetchUserDetails(selectedUser.id, selectedUser.profile_type || 'employee')
      fetchMasterLedger()
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to record salary.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const filteredHistory = selectedHistoryBranch === 'all'
    ? paymentHistory
    : paymentHistory.filter((s: any) => s.branch_id === selectedHistoryBranch);

  const totalPaid = filteredHistory.reduce((sum, item) => sum + Number(item.amount), 0);
  const transactionCount = filteredHistory.length;

  const filteredUsers = users.filter(u => {
    const pt = u.profile_type || 'partner'
    // branch_managers are employees — include them in the employees tab
    if (activeTab === 'employees') return pt === 'employee' || pt === 'head_office' || pt === 'branch_manager'
    return pt === 'partner'
  })

  const filteredMasterLedger = masterLedger.filter(item => {
    const userObj = users.find(u => u.id === item.employee_id || u.id === item.user_id);
    const userType = item.profile_type || item.profiles?.profile_type || userObj?.profile_type || (item.account === 'Payout Request' ? 'partner' : 'employee');
    // branch_managers belong to the employees tab
    if (activeTab === 'employees') return userType === 'employee' || userType === 'head_office' || userType === 'branch_manager';
    return userType === 'partner';
  });

  const getIndividualDossierSpreadsheetData = () => {
    if (!selectedUser) return []
    const data: any[] = []

    // Profile Header Section
    data.push({ 'Employee Dossier': 'COMPREHENSIVE RECORD (ADMIN EXPORT)' })
    data.push({ 'Employee Dossier': '' }) // blank line
    data.push({ 'Employee Dossier': 'Full Name:', 'Value': selectedUser.full_name || 'N/A' })
    data.push({ 'Employee Dossier': 'Email:', 'Value': selectedUser.email || 'N/A' })
    data.push({ 'Employee Dossier': 'Address:', 'Value': selectedUser.address || 'N/A' })
    data.push({ 'Employee Dossier': 'Assigned Branch:', 'Value': selectedUser.branch || 'N/A' })
    data.push({ 'Employee Dossier': 'Base Salary Setup:', 'Value': selectedUser.salary ? `${selectedUser.salary} BDT` : 'N/A' })
    data.push({ 'Employee Dossier': '' }) // blank line

    data.push({ 'Employee Dossier': 'BANKING DETAILS' })
    if (selectedUser.bank_info?.bankName) {
      data.push({ 'Employee Dossier': 'Bank Name:', 'Value': selectedUser.bank_info.bankName })
      data.push({ 'Employee Dossier': 'Account Name:', 'Value': selectedUser.bank_info.accountName })
      data.push({ 'Employee Dossier': 'Account No:', 'Value': selectedUser.bank_info.accountNumber })
    }
    if (selectedUser.bank_info?.mobileBankingProvider) {
      data.push({ 'Employee Dossier': 'Mobile Wallet:', 'Value': selectedUser.bank_info.mobileBankingProvider })
      data.push({ 'Employee Dossier': 'Mobile No:', 'Value': selectedUser.bank_info.mobileBankingNumber })
    }

    data.push({ 'Employee Dossier': '' }) // blank line
    data.push({ 'Employee Dossier': 'SALARY DISBURSEMENT HISTORY' })

    // Salary Header Row
    data.push({
      'Employee Dossier': 'Payment Date',
      'Value': 'Basic Amount',
      'Column C': 'Overtime',
      'Column D': 'Bonus',
      'Column E': 'Sales Comm',
      'Column F': 'Tiffin Bill',
      'Column G': 'Total',
      'Column H': 'Transaction ID',
      'Column I': 'Account',
      'Column J': 'Remarks'
    })

    // Salary Rows (using paymentHistory filtered by selection if any)
    const activeHistory = selectedProfileVouchers.length > 0
      ? paymentHistory.filter(s => selectedProfileVouchers.includes(s.id))
      : paymentHistory

    activeHistory.forEach(s => {
      data.push({
        'Employee Dossier': new Date(s.payment_date).toLocaleDateString(),
        'Value': s.base_salary_at_time || s.amount,
        'Column C': s.overtime_amount || 0,
        'Column D': s.bonus_amount || 0,
        'Column E': s.sales_commission || 0,
        'Column F': s.tiffin_bill || 0,
        'Column G': s.amount,
        'Column H': s.transaction_id || 'N/A',
        'Column I': s.account || 'N/A',
        'Column J': s.notes || 'N/A'
      })
    })

    return data
  }

  const handleExportIndividualDossierExcel = () => {
    if (!selectedUser) return
    const dataToExport = getIndividualDossierSpreadsheetData()
    const worksheet = XLSX.utils.json_to_sheet(dataToExport, { skipHeader: true })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'EmployeeDossier')
    XLSX.writeFile(workbook, `employee_dossier_${selectedUser.full_name?.replace(/\s+/g, '_')}.xlsx`)
  }

  const handleExportIndividualDossierCSV = () => {
    if (!selectedUser) return
    const dataToExport = getIndividualDossierSpreadsheetData()
    const worksheet = XLSX.utils.json_to_sheet(dataToExport, { skipHeader: true })
    const csvContent = XLSX.utils.sheet_to_csv(worksheet)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `employee_dossier_${selectedUser.full_name?.replace(/\s+/g, '_')}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleExportIndividualDossierPDF = async () => {
    if (!selectedUser) return
    const activeHistory = selectedProfileVouchers.length > 0
      ? paymentHistory.filter(s => selectedProfileVouchers.includes(s.id))
      : paymentHistory
    const columns = ['Payment Date', 'Basic', 'Overtime', 'Bonus', 'Sales Comm', 'Tiffin', 'Total', 'Trx ID', 'Account']
    const rows = activeHistory.map(s => [
      new Date(s.payment_date).toLocaleDateString(),
      `${Number(s.base_salary_at_time || s.amount).toLocaleString()}`,
      `${Number(s.overtime_amount || 0).toLocaleString()}`,
      `${Number(s.bonus_amount || 0).toLocaleString()}`,
      `${Number(s.sales_commission || 0).toLocaleString()}`,
      `${Number(s.tiffin_bill || 0).toLocaleString()}`,
      `${Number(s.amount).toLocaleString()}`,
      s.transaction_id || 'N/A',
      s.account || 'N/A'
    ])

    const totalPayments = activeHistory.reduce((sum, s) => sum + Number(s.amount), 0)

    await generatePdf(`Comprehensive Dossier: ${selectedUser.full_name || 'Employee'}`, columns, rows, {
      summaryData: [
        { label: 'Total Salary Disbursed', value: `${totalPayments.toLocaleString()} BDT` }
      ],
      filename: `dossier_${selectedUser.id}.pdf`
    })
  }

  const toggleProfileVoucherSelection = (id: string) => {
    setSelectedProfileVouchers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleAllProfileVouchers = (list: any[]) => {
    if (list.length === 0) return
    const allSelected = list.every(x => selectedProfileVouchers.includes(x.id))
    if (allSelected) {
      const listIds = new Set(list.map(x => x.id))
      setSelectedProfileVouchers(prev => prev.filter(id => !listIds.has(id)))
    } else {
      const listIds = list.map(x => x.id)
      setSelectedProfileVouchers(prev => Array.from(new Set([...prev, ...listIds])))
    }
  }

  const handleExportSingleLedgerVoucherPdf = async (item: any, empName?: string) => {
    const itemBranch = branches.find(b => b.id === item.branch_id)
    const isPartner = activeTab === 'partners' || selectedUser?.profile_type === 'partner'
    const targetName = empName || selectedUser?.full_name || item.profiles?.full_name || (isPartner ? 'Unknown Partner' : 'Unknown Employee')
    const rows = [
      [isPartner ? 'Partner Name' : 'Employee Name', targetName],
      ['Payment Date', new Date(item.payment_date).toLocaleDateString()],
      ['Branch / Channel', itemBranch?.name || 'Main Office'],
      ['Basic Disbursed', `${Number(item.base_salary_at_time || item.amount).toLocaleString()} BDT`],
      ['Overtime', `${Number(item.overtime_amount || 0).toLocaleString()} BDT`],
      ['Bonus', `${Number(item.bonus_amount || 0).toLocaleString()} BDT`],
      ['Sales Commission', `${Number(item.sales_commission || 0).toLocaleString()} BDT`],
      ['Tiffin Bill', `${Number(item.tiffin_bill || 0).toLocaleString()} BDT`],
      ['Total Disbursed', `${Number(item.amount).toLocaleString()} BDT`],
      ['Destination Account', item.account || 'N/A'],
      ['Transaction ID', item.transaction_id || 'N/A'],
      ['Notes / Remarks', item.notes || 'None']
    ]

    await generatePdf(isPartner ? 'Partner Payout Voucher' : 'Salary Disbursement Voucher', ['Specification', 'Details'], rows, {
      subtitle: `Official Payment Record - Trx: ${item.transaction_id || 'N/A'}`,
      preparedBy: 'Administrator',
      branch: itemBranch?.name || 'Main Office',
      summaryData: [
        { label: 'Net Disbursed Amount', value: `${Number(item.amount).toLocaleString()} BDT` }
      ],
      filename: `${isPartner ? 'Payout_Voucher' : 'Salary_Voucher'}_${targetName}_${item.transaction_id || item.id}.pdf`
    })
  }

  const getActiveGlobalLedgerList = () => {
    const currentFiltered = masterLedger.filter(item => {
      const userObj = users.find(u => u.id === item.employee_id || u.id === item.user_id);
      const userType = item.profile_type || item.profiles?.profile_type || userObj?.profile_type || (item.account === 'Payout Request' ? 'partner' : 'employee');
      if (activeTab === 'employees') return userType === 'employee' || userType === 'head_office' || userType === 'branch_manager';
      return userType === 'partner';
    });
    return selectedGlobalVouchers.length > 0
      ? currentFiltered.filter(item => selectedGlobalVouchers.includes(item.id))
      : currentFiltered;
  };

  const handleExportGlobalExcel = () => {
    const activeList = getActiveGlobalLedgerList();
    if (activeList.length === 0) return
    const nameHeader = activeTab === 'employees' ? 'Employee Name' : 'Partner Name';
    const data = activeList.map(item => ({
      [nameHeader]: item.profiles?.full_name || 'Unknown',
      'Payment Date': new Date(item.payment_date).toLocaleDateString(),
      'Amount (BDT)': item.amount,
      'Account': item.account || 'N/A',
      'Transaction ID': item.transaction_id || 'N/A',
      'Notes': item.notes || 'None'
    }))
    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, activeTab === 'employees' ? 'GlobalSalaryLedger' : 'GlobalValueTransfers')
    XLSX.writeFile(workbook, `${activeTab === 'employees' ? 'Global_Salary_Vouchers' : 'Global_Value_Transfers'}_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  const handleExportGlobalCSV = () => {
    const activeList = getActiveGlobalLedgerList();
    if (activeList.length === 0) return
    const nameHeader = activeTab === 'employees' ? 'Employee Name' : 'Partner Name';
    const data = activeList.map(item => ({
      [nameHeader]: item.profiles?.full_name || 'Unknown',
      'Payment Date': new Date(item.payment_date).toLocaleDateString(),
      'Amount (BDT)': item.amount,
      'Account': item.account || 'N/A',
      'Transaction ID': item.transaction_id || 'N/A',
      'Notes': item.notes || 'None'
    }))
    const worksheet = XLSX.utils.json_to_sheet(data)
    const csvContent = XLSX.utils.sheet_to_csv(worksheet)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `${activeTab === 'employees' ? 'Global_Salary_Vouchers' : 'Global_Value_Transfers'}_${new Date().toISOString().slice(0,10)}.csv`)
    link.click()
  }

  const handleExportGlobalPDF = async () => {
    const activeList = getActiveGlobalLedgerList();
    if (activeList.length === 0) return
    const nameHeader = activeTab === 'employees' ? 'Employee Name' : 'Partner Name';
    const columns = [nameHeader, 'Payment Date', 'Amount (BDT)', 'Transaction ID', 'Account']
    const rows = activeList.map(item => [
      item.profiles?.full_name || 'Unknown',
      new Date(item.payment_date).toLocaleDateString(),
      `${Number(item.amount).toLocaleString()}`,
      item.transaction_id || 'N/A',
      item.account || 'N/A'
    ])
    const total = activeList.reduce((sum, item) => sum + Number(item.amount), 0)
    await generatePdf(activeTab === 'employees' ? 'Global Salary Disbursement Ledger' : 'Global Partner Value Transfer Ledger', columns, rows, {
      subtitle: `Disbursed Vouchers Summary (${activeList.length} entries)`,
      preparedBy: 'Administrator',
      summaryData: [
        { label: 'Total Payouts Disbursed', value: `${total.toLocaleString()} BDT` }
      ],
      filename: `${activeTab === 'employees' ? 'Global_Salary_Vouchers' : 'Global_Value_Transfers'}_${new Date().toISOString().slice(0,10)}.pdf`
    })
  }

  const toggleGlobalVoucherSelection = (id: string) => {
    setSelectedGlobalVouchers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleAllGlobalVouchers = (list: any[]) => {
    if (list.length === 0) return
    const allSelected = list.every(x => selectedGlobalVouchers.includes(x.id))
    if (allSelected) {
      const listIds = new Set(list.map(x => x.id))
      setSelectedGlobalVouchers(prev => prev.filter(id => !listIds.has(id)))
    } else {
      const listIds = list.map(x => x.id)
      setSelectedGlobalVouchers(prev => Array.from(new Set([...prev, ...listIds])))
    }
  }

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans">
      <div className="absolute top-[-10%] right-[-5%] w-[50%] h-[50%] bg-[#d4af37]/3 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="flex-1 flex flex-col p-4 md:p-6 lg:p-10 overflow-y-auto max-h-screen relative z-10 custom-scrollbar">
        <div className="mb-8 pb-4 border-b border-slate-900/5">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-serif">
            User <span className="premium-text-gradient">Directory</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">Manage all registered Employees and Partners across the ecosystem.</p>
        </div>

        {feedback && (
          <div className={`p-4 rounded-xl text-xs mb-6 flex gap-2 border ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-600'
          }`}>
            {feedback.type === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Custom Tabs */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-6">
          <button
            onClick={() => updateTab('employees')}
            className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border w-full sm:w-auto active:scale-95 ${
              activeTab === 'employees'
                ? 'bg-[#d4af37]/10 text-[#8a6d1f] border-[#d4af37]/30 shadow-lg'
                : 'bg-slate-900/[0.04] text-slate-500 border-slate-900/5 hover:border-slate-900/10'
            }`}
          >
            Workforce (Employees)
          </button>
          <button
            onClick={() => updateTab('partners')}
            className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border w-full sm:w-auto active:scale-95 ${
              activeTab === 'partners'
                ? 'bg-[#d4af37]/10 text-[#8a6d1f] border-[#d4af37]/30 shadow-lg'
                : 'bg-slate-900/[0.04] text-slate-500 border-slate-900/5 hover:border-slate-900/10'
            }`}
          >
            Network (Partners)
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">

          {/* LEFT: USER LIST */}
          <div className="lg:col-span-5 xl:col-span-4 space-y-4">
            <div className="glass-panel p-4 rounded-2xl relative shadow-xl">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-900/5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Users className="w-4 h-4" /> Directory ({isUsersLoading ? '…' : filteredUsers.length})
                </span>
                <div className="flex items-center gap-2">
                  {!isSelectMode ? (
                    <button
                      onClick={() => setIsSelectMode(true)}
                      className="px-2 py-0.5 bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/40 text-slate-600 hover:text-slate-900 rounded text-[8px] font-bold uppercase tracking-wider transition-all cursor-pointer"
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
                        className="px-2 py-0.5 bg-white border border-slate-900/5 text-slate-500 hover:text-slate-900 rounded text-[8px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                      >
                        Cancel
                      </button>
                      <label className="flex items-center gap-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={filteredUsers.length > 0 && selectedIds.length === filteredUsers.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(filteredUsers.map(u => u.id))
                            } else {
                              setSelectedIds([])
                            }
                          }}
                          className="w-3 h-3 rounded border-slate-900/10 bg-white text-[#8a6d1f] focus:ring-0 accent-[#d4af37] cursor-pointer"
                        />
                        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider">All</span>
                      </label>
                    </>
                  )}
                  {isSelectMode && selectedIds.length > 0 && (
                    <div className="relative">
                      <button
                        onClick={() => setShowExportDropdown(prev => !prev)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-[#d4af37] to-white text-black hover:brightness-110 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all hover:scale-105 active:scale-95 shadow-md shadow-[#d4af37]/10 cursor-pointer"
                      >
                        <FileText className="w-3 h-3" />
                        <span>{selectedIds.length > 0 ? `Export Selected (${selectedIds.length}) ▼` : `Export All (${filteredUsers.length}) ▼`}</span>
                      </button>

                      {showExportDropdown && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowExportDropdown(false)} />
                          <div className="absolute right-0 mt-1.5 w-36 bg-white border border-slate-900/10 rounded-lg shadow-xl py-1 z-20 flex flex-col">
                            <button
                              onClick={() => {
                                handleExportExcel();
                                setShowExportDropdown(false);
                              }}
                              className="px-3 py-1.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors cursor-pointer"
                            >
                              Export to Excel (.xlsx)
                            </button>
                            <button
                              onClick={() => {
                                handleExportCSV();
                                setShowExportDropdown(false);
                              }}
                              className="px-3 py-1.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors border-t border-slate-900/5 cursor-pointer"
                            >
                              Export to CSV (.csv)
                            </button>
                            <button
                              onClick={() => {
                                handleExportPDF();
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
                  )}
                </div>
              </div>

              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {isUsersLoading ? (
                  <div aria-busy="true" aria-label="Loading users" className="space-y-3">
                    {[0, 1, 2, 3].map(i => (
                      <div key={i} className="p-4 rounded-xl border border-slate-900/5 bg-slate-900/[0.03] animate-pulse">
                        <div className="h-3.5 w-32 rounded bg-slate-900/10 mb-2" />
                        <div className="h-2.5 w-44 rounded bg-[#d4af37]/20" />
                      </div>
                    ))}
                  </div>
                ) : filteredUsers.length === 0 && (
                  <div className="text-center py-10 text-slate-500 text-xs italic">No users found in this category.</div>
                )}
                {filteredUsers.map(u => {
                  const isSelected = selectedUser?.id === u.id
                  const isChecked = selectedIds.includes(u.id)
                  return (
                    <div key={u.id} className="flex items-center gap-2 group/row">
                      {isSelectMode && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(prev => [...prev, u.id])
                            } else {
                              setSelectedIds(prev => prev.filter(id => id !== u.id))
                            }
                          }}
                          className="w-4 h-4 rounded border-slate-900/10 bg-white text-[#8a6d1f] focus:ring-0 accent-[#d4af37] cursor-pointer transition-all hover:scale-110 shrink-0"
                        />
                      )}
                      <button
                        onClick={() => handleSelect(u)}
                        className={`flex-1 text-left p-4 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                          isSelected
                            ? 'bg-[#d4af37]/10 border-[#d4af37]/40 shadow-lg'
                            : 'bg-slate-900/[0.04] border-slate-900/5 hover:border-slate-900/10'
                        }`}
                      >
                        <div className="flex justify-between items-start w-full">
                          <div className="min-w-0 flex-1 pr-2">
                            <h4 className={`text-sm font-bold truncate ${isSelected ? 'text-[#8a6d1f]' : 'text-slate-900'} flex items-center gap-1.5`}>
                              <span>{u.full_name}</span>
                              {u.branch && (
                                <span className="text-[10px] text-slate-500 font-normal">
                                  {u.branch}
                                </span>
                              )}
                              {u.is_banned && <span className="ml-2 text-[9px] bg-rose-500/20 text-rose-600 px-1.5 py-0.5 rounded font-bold uppercase">Banned</span>}
                              {u.profile_type === 'branch_manager' && <span className="ml-1 text-[9px] bg-[#d4af37]/15 text-[#8a6d1f] px-1.5 py-0.5 rounded font-bold uppercase border border-[#d4af37]/20">Mgr</span>}
                            </h4>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-slate-500 truncate">
                                {u.phone_number || u.email || 'No contact info'}
                              </span>
                            </div>
                          </div>
                          {u.verification_status === 'approved' ? (
                            <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)] shrink-0 mt-1" title="Verified" />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0 mt-1" title="Pending KYC" />
                          )}
                        </div>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Position Directory Panel */}
            <div className="glass-panel p-4 rounded-2xl relative shadow-xl border border-slate-900/5 space-y-4 mt-4 bg-gradient-to-br from-slate-900/[0.01] to-slate-900/[0.03]">
              <span className="text-[10px] font-bold text-[#8a6d1f] uppercase tracking-widest block flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#8a6d1f]" /> Position Directory
              </span>

              <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1 custom-scrollbar">
                {positions.length === 0 ? (
                  <p className="text-[10px] text-slate-500 italic">No positions created yet.</p>
                ) : (
                  positions.map((p) => (
                    <div key={p.id} className="flex justify-between items-center bg-slate-900/[0.04] border border-slate-900/5 px-2.5 py-1.5 rounded-lg text-[11px] group hover:border-slate-900/10 transition-all">
                      <span className="font-semibold text-slate-900">{p.name}</span>
                      <button
                        type="button"
                        onClick={() => handleDeletePosition(p.id, p.name)}
                        className="text-rose-600 hover:text-rose-700 opacity-0 group-hover:opacity-100 transition-opacity p-2.5 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleCreatePosition} className="flex gap-2 pt-2 border-t border-slate-900/5">
                <input
                  type="text"
                  value={newPositionInput}
                  onChange={(e) => setNewPositionInput(e.target.value)}
                  placeholder="e.g. Manager, HR"
                  required
                  maxLength={30}
                  className="flex-1 bg-white border border-slate-900/10 rounded-xl py-2 px-3 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50"
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 text-[#8a6d1f] px-3.5 rounded-xl text-xs font-bold uppercase transition-all cursor-pointer"
                >
                  Create
                </button>
              </form>
            </div>
          </div>

          {/* RIGHT: USER DETAILS */}
          <div className="lg:col-span-7 xl:col-span-8">
            <AnimatePresence mode="wait">
              {selectedUser ? (
                <motion.div
                  key={selectedUser.id}
                  initial={{ opacity: 0, x: 15 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -15 }}
                  className="space-y-6"
                >
                  {/* TOP HEADER: IDENTITY & FINANCIALS */}
                  <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    {/* Identity Overview */}
                    <div className="xl:col-span-2 glass-panel p-6 rounded-2xl relative shadow-xl border border-slate-900/5 flex flex-col justify-center overflow-hidden">
                      {/* Premium Background Accent */}
                      <div className="absolute top-0 right-0 w-64 h-64 bg-[#d4af37]/5 rounded-full filter blur-[100px] pointer-events-none" />

                      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4 relative z-10">
                        <div className="flex items-center gap-4 sm:gap-5 min-w-0">
                          {/* Dynamic Avatar */}
                          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-tr from-[#d4af37] to-white flex items-center justify-center text-lg sm:text-xl font-black text-black shadow-[0_0_20px_rgba(212,175,55,0.3)] shrink-0">
                            {selectedUser.full_name?.substring(0, 2).toUpperCase() || 'US'}
                          </div>
                          <div className="min-w-0">
                            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-1 flex flex-wrap items-center gap-2 sm:gap-3 font-serif truncate">
                              {selectedUser.full_name}
                              {selectedUser.is_banned && (
                                <span className="text-[9px] bg-rose-500/20 border border-rose-500/30 text-rose-600 px-2 py-1 rounded-md uppercase tracking-widest font-bold animate-pulse shrink-0">Suspended</span>
                              )}
                            </h2>
                            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-500 font-medium">
                              <span className="flex items-center gap-1.5"><UserCircle className="w-3.5 h-3.5 text-[#8a6d1f]" /> {selectedUser.phone_number || 'No Phone Number'}</span>
                              <span className="w-1 h-1 rounded-full bg-[#d4af37]/50" />
                              <span className="uppercase tracking-widest text-[#8a6d1f]/80">{activeTab}</span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={handleToggleBan}
                          disabled={isSubmitting}
                          className={`w-full sm:w-auto justify-center p-2.5 rounded-xl border transition-all flex items-center gap-2 group shrink-0 ${
                            selectedUser.is_banned
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                              : 'bg-rose-500/10 border-rose-500/30 text-rose-600 hover:bg-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.1)] hover:shadow-[0_0_20px_rgba(244,63,94,0.2)]'
                          }`}
                        >
                          {selectedUser.is_banned ? <UserCheck className="w-4 h-4 group-hover:scale-110 transition-transform" /> : <UserX className="w-4 h-4 group-hover:scale-110 transition-transform" />}
                          <span className="text-[10px] font-bold uppercase tracking-wider inline">{selectedUser.is_banned ? 'Restore Access' : 'Ban User'}</span>
                        </button>
                      </div>

                      <div className="p-3.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 text-[11px] text-slate-600 relative z-10 flex items-start gap-2.5 hover:border-slate-900/10 transition-all">
                        <MapPin className="w-4 h-4 shrink-0 text-[#8a6d1f]" />
                        <span className="leading-relaxed">
                          {selectedUser.address || kycDetails?.address || 'Address information has not been provided yet.'}
                        </span>
                      </div>
                    </div>

                    {/* Financial Summary */}
                    <div className="glass-panel p-6 rounded-2xl relative shadow-[0_0_30px_rgba(212,175,55,0.05)] border border-[#d4af37]/20 bg-[#d4af37]/[0.03] flex flex-col justify-center overflow-hidden group">
                      <div className="absolute inset-0 bg-gradient-to-br from-[#d4af37]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                      <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-[#d4af37]/20 rounded-full filter blur-[40px] animate-pulse" />

                      <span className="text-[9px] font-bold text-[#8a6d1f] uppercase tracking-widest block mb-3 relative z-10 flex items-center gap-2">
                        <CreditCard className="w-3.5 h-3.5" />
                        {activeTab === 'employees' ? 'Total Salary Disbursed' : 'Total Value Transfer'}
                      </span>
                      <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2 font-serif relative z-10 tracking-tight break-all sm:break-normal">
                        {isDetailsLoading ? '…' : <>৳{totalPaid.toLocaleString()}</>}
                      </h3>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest relative z-10 border-t border-[#d4af37]/10 pt-3 mt-1">
                        Across <span className="text-[#8a6d1f] font-bold">{isDetailsLoading ? '…' : transactionCount}</span> successful records
                      </p>
                    </div>
                  </div>

                  {/* KYC DOCUMENTS GRID */}
                  {kycDetails && (
                    <div className="glass-panel p-6 rounded-2xl relative shadow-xl border border-slate-900/5">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-4 flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4" /> KYC Verification Documents
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {[
                          { title: 'NID Front', url: kycDetails.nid_front_url },
                          { title: 'NID Back', url: kycDetails.nid_back_url },
                          { title: 'Live Selfie', url: kycDetails.selfie_url }
                        ].map((doc, idx) => (
                          <div key={idx} className="space-y-2">
                            <span className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold pl-1">{doc.title}</span>
                            {doc.url ? (
                              <button
                                onClick={() => setFullscreenImage(getKycImageUrl(doc.url)!)}
                                className="w-full aspect-[4/3] rounded-xl bg-white border border-slate-900/10 hover:border-[#d4af37]/50 overflow-hidden relative group transition-all"
                              >
                                <img
                                  src={getKycImageUrl(doc.url)!}
                                  alt={doc.title}
                                  className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                />
                                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-sm">
                                  <ImageIcon className="w-6 h-6 text-slate-900" />
                                </div>
                              </button>
                            ) : (
                              <div className="w-full aspect-[4/3] rounded-xl bg-slate-900/[0.04] border border-slate-900/5 border-dashed flex items-center justify-center text-[10px] text-slate-600">
                                Not Uploaded
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* USER DATA & CONFIGURATION */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {/* PERSONAL/EMPLOYMENT INFO */}
                    <div className="glass-panel p-6 rounded-2xl relative shadow-xl border border-slate-900/5 space-y-6 flex flex-col">
                      <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-3 border-b border-slate-900/5 pb-4">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 shrink-0">
                          <UserCircle className="w-4 h-4 text-[#8a6d1f]" /> Configuration
                        </span>
                        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                          {!isEditing ? (
                            <button
                              onClick={() => setIsEditing(true)}
                              className="text-[10px] font-bold text-[#8a6d1f] border border-[#d4af37]/20 bg-[#d4af37]/5 px-3 py-1.5 rounded-lg hover:bg-[#d4af37]/15 transition-all uppercase cursor-pointer"
                            >
                              Edit Data
                            </button>
                          ) : (
                            <button
                              onClick={() => setIsEditing(false)}
                              className="text-[10px] font-bold text-slate-500 border border-slate-400/20 px-3 py-1.5 rounded-lg hover:bg-slate-900/[0.04] transition-all uppercase cursor-pointer"
                            >
                              Cancel
                            </button>
                          )}
                          {activeTab === 'employees' && (
                            <button
                              onClick={() => setShowBranchModal(true)}
                              className="text-[10px] font-bold text-[#8a6d1f] border border-[#d4af37]/20 bg-[#d4af37]/5 px-3 py-1.5 rounded-lg hover:bg-[#d4af37]/15 transition-all uppercase cursor-pointer"
                            >
                              Transfer
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleDeleteUser}
                            disabled={selectedUser?.id === currentUserId}
                            title={selectedUser?.id === currentUserId ? "You cannot delete your own account" : "Delete User"}
                            className="text-[10px] font-bold text-rose-600 border border-rose-400/20 bg-rose-400/5 px-3 py-1.5 rounded-lg hover:bg-rose-400/15 transition-all uppercase cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      <div className="flex-1 space-y-1 mt-2">
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-3 border-b border-slate-900/5 group">
                          <span className="text-[11px] font-medium text-slate-500 group-hover:text-slate-900 transition-colors flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-[#8a6d1f]" /> Joining Date
                          </span>
                          {isEditing ? (
                            <input
                              type="date"
                              value={joiningDateInput}
                              onChange={(e) => setJoiningDateInput(e.target.value)}
                              className="w-full sm:w-48 bg-white border border-[#d4af37]/30 rounded-lg py-1.5 px-3 text-sm text-slate-900 focus:outline-none mt-2 sm:mt-0"
                            />
                          ) : (
                            <span className="text-sm font-semibold text-slate-900 mt-1 sm:mt-0 font-mono bg-slate-900/[0.04] px-3 py-1 rounded-lg border border-slate-900/5 shadow-inner flex items-center gap-3">
                              <span>{selectedUser.joining_date ? new Date(selectedUser.joining_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : (selectedUser.created_at ? new Date(selectedUser.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A')}</span>
                              {(selectedUser.joining_date || selectedUser.created_at) && (
                                <span className="text-[9px] bg-[#d4af37]/10 text-[#8a6d1f] px-2 py-0.5 rounded uppercase tracking-wider font-bold">
                                  {getDuration(selectedUser.joining_date || selectedUser.created_at)}
                                </span>
                              )}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-3 border-b border-slate-900/5 group">
                          <span className="text-[11px] font-medium text-slate-500 group-hover:text-slate-900 transition-colors">Assigned Branch</span>
                          <span className="text-sm font-semibold text-slate-900 mt-1 sm:mt-0">{selectedUser.branch || 'Unassigned'}</span>
                        </div>

                        {activeTab === 'employees' ? (
                          <>
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-3 border-b border-slate-900/5 group">
                              <span className="text-[11px] font-medium text-slate-500 group-hover:text-slate-900 transition-colors">Corporate Position</span>
                              <div className="flex items-center gap-4 mt-1 sm:mt-0">
                                <span className="text-sm font-semibold text-slate-900">{selectedUser.position || 'Not Assigned'}</span>
                                {!isEditing && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setTransferPositionId('')
                                      setTransferPositionJoinDate(new Date().toISOString().split('T')[0])
                                      setTransferPositionNote('')
                                      setShowPositionModal(true)
                                    }}
                                    className="text-[9px] font-bold text-[#8a6d1f] uppercase hover:underline"
                                  >
                                    Update
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-3 border-b border-slate-900/5 group">
                              <span className="text-[11px] font-medium text-slate-500 group-hover:text-slate-900 transition-colors">Monthly Base Remuneration</span>
                              {isEditing ? (
                                <input
                                  type="number"
                                  value={salaryInput}
                                  onChange={(e) => setSalaryInput(e.target.value)}
                                  className="w-full sm:w-48 bg-white border border-[#d4af37]/30 rounded-lg py-1.5 px-3 text-sm font-mono text-slate-900 focus:outline-none mt-2 sm:mt-0"
                                />
                              ) : (
                                <span className="text-lg font-bold text-slate-900 font-serif mt-1 sm:mt-0">{selectedUser.salary ? `${Number(selectedUser.salary).toLocaleString()} BDT` : 'Not Set'}</span>
                              )}
                            </div>

                            {/* Branch Change History */}
                            {branchTransfers.length > 0 && (
                              <div className="mt-4 pt-4 border-t border-slate-900/5 space-y-3">
                                <span className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold block">Branch Timeline</span>
                                <div className="space-y-2 max-h-[120px] overflow-y-auto pr-1 custom-scrollbar">
                                  {branchTransfers.map((bt) => (
                                    <div key={bt.id} className="text-[11px] bg-white border-l-[2px] border-l-[#d4af37] border-y border-y-slate-900/10 border-r border-r-slate-900/10 p-2.5 rounded-r-lg space-y-1 hover:bg-slate-900/[0.04] transition-colors">
                                      <div className="flex justify-between items-center">
                                        <span className="text-slate-600 font-medium">
                                          {bt.old_branch_name || 'N/A'} <span className="text-slate-500 mx-1">&rarr;</span> <span className="text-[#8a6d1f] font-bold">{bt.new_branch_name}</span>
                                        </span>
                                        <span className="text-slate-500 text-[9px] font-mono">{new Date(bt.join_date).toLocaleDateString()}</span>
                                      </div>
                                      {bt.note && <p className="text-slate-500 italic text-[10px] mt-1">"{bt.note}"</p>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Position Change History */}
                            {positionTransfers.length > 0 && (
                              <div className="mt-4 pt-4 border-t border-slate-900/5 space-y-3">
                                <span className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold block">Position Timeline</span>
                                <div className="space-y-2 max-h-[120px] overflow-y-auto pr-1 custom-scrollbar">
                                  {positionTransfers.map((pt) => (
                                    <div key={pt.id} className="text-[11px] bg-white border-l-[2px] border-l-[#d4af37] border-y border-y-slate-900/10 border-r border-r-slate-900/10 p-2.5 rounded-r-lg space-y-1 hover:bg-slate-900/[0.04] transition-colors">
                                      <div className="flex justify-between items-center">
                                        <span className="text-slate-600 font-medium">
                                          {pt.old_position_name || 'N/A'} <span className="text-slate-500 mx-1">&rarr;</span> <span className="text-[#8a6d1f] font-bold">{pt.new_position_name}</span>
                                        </span>
                                        <span className="text-slate-500 text-[9px] font-mono">{new Date(pt.join_date).toLocaleDateString()}</span>
                                      </div>
                                      {pt.note && <p className="text-slate-500 italic text-[10px] mt-1">"{pt.note}"</p>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-3 border-b border-slate-900/5 group">
                            <span className="text-[11px] font-medium text-slate-500 group-hover:text-slate-900 transition-colors">Account Type</span>
                            {isEditing ? (
                              <select
                                value={profileTypeInput}
                                onChange={(e) => setProfileTypeInput(e.target.value)}
                                className="w-full sm:w-48 bg-white border border-[#d4af37]/30 rounded-lg py-1.5 px-3 text-sm font-semibold text-[#8a6d1f] focus:outline-none mt-2 sm:mt-0"
                              >
                                <option value="employee">Corporate Employee</option>
                                <option value="partner">Corporate Partner</option>
                                <option value="head_office">Head Office</option>
                                <option value="branch_manager">Branch Manager</option>
                              </select>
                            ) : (
                              <span className="text-sm font-semibold text-[#8a6d1f]">
                                {selectedUser.profile_type === 'head_office' ? 'Head Office'
                                  : selectedUser.profile_type === 'employee' ? 'Corporate Employee'
                                  : selectedUser.profile_type === 'branch_manager' ? 'Branch Manager'
                                  : 'Corporate Partner'}
                              </span>
                            )}
                          </div>
                        )}

                        {isEditing && (
                          <button
                            onClick={handleUpdateProfile}
                            disabled={isSubmitting}
                            className="mt-4 w-full py-2.5 bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 text-[#8a6d1f] text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all"
                          >
                            {isSubmitting ? 'Saving...' : 'Save Configuration'}
                          </button>
                        )}

                        {activeTab === 'employees' && !isEditing && selectedUser.profile_type !== 'branch_manager' && (
                          <div className="mt-4 pt-4 border-t border-slate-900/5">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-3 flex items-center gap-2">
                              <Building2 className="w-3.5 h-3.5" /> Assign as Branch Manager
                            </span>
                            <form onSubmit={handleAssignManager} className="space-y-3">
                              <select
                                value={managerAssignBranch}
                                onChange={(e) => setManagerAssignBranch(e.target.value)}
                                className="w-full bg-white border border-[#d4af37]/30 rounded-xl py-2.5 px-3 text-xs text-slate-900 focus:outline-none"
                                required
                              >
                                <option value="">— Select Branch —</option>
                                {branches.map(b => (
                                  <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                              </select>
                              <button
                                type="submit"
                                disabled={isSubmitting || !managerAssignBranch}
                                className="w-full py-2 bg-gradient-to-r from-emerald-500/20 to-emerald-600/20 border border-emerald-500/30 text-emerald-600 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all hover:bg-emerald-500/30 disabled:opacity-50"
                              >
                                {isSubmitting ? 'Assigning...' : 'Confirm Manager Assignment'}
                              </button>
                            </form>
                          </div>
                        )}
                        {selectedUser.profile_type === 'branch_manager' && !isEditing && (
                           <div className="mt-4 pt-4 border-t border-slate-900/5 space-y-2">
                              <div className="p-3 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-between">
                                 <div>
                                   <span className="text-[10px] font-bold text-[#8a6d1f] uppercase tracking-widest block">Branch Manager</span>
                                   <span className="text-xs text-slate-600">{selectedUser.branch || 'Assigned to Branch'}</span>
                                 </div>
                                 <Building2 className="w-5 h-5 text-[#8a6d1f]" />
                              </div>
                              <button
                                onClick={handleRemoveManager}
                                disabled={isSubmitting}
                                className="w-full py-2 bg-rose-500/10 border border-rose-500/20 text-rose-600 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all hover:bg-rose-500/20 disabled:opacity-50"
                              >
                                {isSubmitting ? 'Removing...' : 'Remove Manager Role'}
                              </button>
                           </div>
                        )}

                        {!isEditing && (
                          <button
                            onClick={() => {
                              setAmount(selectedUser.salary && activeTab === 'employees' ? String(selectedUser.salary) : '')
                              setSalaryNote('')
                              setSelectedSalaryBranch(selectedUser.branch_id || '')
                              const bankKeys = selectedUser.bank_info ? Object.keys(selectedUser.bank_info) : []
                              if (bankKeys.length > 0) {
                                const firstKey = bankKeys[0]
                                const formattedKey = firstKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())
                                setSelectedSalaryAccount(`${formattedKey}: ${selectedUser.bank_info[firstKey]}`)
                              } else {
                                setSelectedSalaryAccount('Custom')
                              }
                              setCustomAccountInput('')
                              setShowSalaryModal(true)
                            }}
                            className="mt-6 w-full bg-gradient-to-r from-[#d4af37] to-white text-black font-bold py-3 rounded-xl text-xs tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_15px_rgba(212,175,55,0.2)] hover:shadow-[0_0_25px_rgba(212,175,55,0.4)] transition-all hover:-translate-y-0.5"
                          >
                            <CreditCard className="w-4 h-4" /> {activeTab === 'employees' ? 'Issue Salary Payment' : 'Issue Value Transfer'}
                          </button>
                        )}
                      </div>
                    </div>


                    {/* BANKING DETAILS (FOR EVERYONE) */}
                    <div className={`glass-panel p-6 rounded-2xl relative shadow-xl border border-slate-900/5 flex flex-col ${activeTab === 'partners' ? 'lg:col-span-2' : ''}`}>
                      <div className="flex justify-between items-center border-b border-slate-900/5 pb-4 mb-4">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                          <Landmark className="w-4 h-4 text-[#8a6d1f]" /> Banking & Routing
                        </span>
                      </div>

                      {selectedUser.bank_info && Object.keys(selectedUser.bank_info).length > 0 ? (
                        <div className="space-y-1">
                          {Object.entries(selectedUser.bank_info).map(([key, val]) => {
                            if (!val) return null
                            const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())
                            return (
                              <div key={key} className="flex flex-col sm:flex-row justify-between sm:items-center py-2.5 border-b border-slate-900/5 group transition-all">
                                <span className="text-[11px] font-medium text-slate-500 group-hover:text-slate-900 transition-colors">{label}</span>
                                <div className="flex items-center gap-3 mt-1 sm:mt-0">
                                  <span className="text-sm font-semibold text-slate-900 font-mono">{String(val)}</span>
                                  <button
                                    onClick={() => copyToClipboard(String(val))}
                                    className="text-slate-500 hover:text-[#8a6d1f] transition-colors opacity-0 group-hover:opacity-100"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="p-5 rounded-xl bg-rose-500/[0.03] border border-rose-500/10 flex flex-col items-center justify-center text-center">
                          <Landmark className="w-6 h-6 text-rose-500/30 mb-2" />
                          <span className="text-rose-600 text-xs font-semibold">No banking details provided</span>
                          <span className="text-[10px] text-rose-600/50 mt-1">This user has not configured their payment routing yet.</span>
                        </div>
                      )}

                      {kycDetails && (
                        <div className="mt-8">
                           <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                             <ShieldCheck className="w-3.5 h-3.5" /> KYC Submitted Bank Details
                           </span>
                           <div className="space-y-1 border-t border-slate-900/5 pt-2">
                             {kycDetails.bank_name && (
                               <div className="flex justify-between items-center py-2 border-b border-slate-900/5 group">
                                 <span className="text-[10px] text-slate-500 group-hover:text-slate-900 transition-colors">Bank Name</span>
                                 <span className="text-xs font-semibold text-slate-900">{kycDetails.bank_name}</span>
                               </div>
                             )}
                             {kycDetails.account_holder_name && (
                               <div className="flex justify-between items-center py-2 border-b border-slate-900/5 group">
                                 <span className="text-[10px] text-slate-500 group-hover:text-slate-900 transition-colors">Account Holder</span>
                                 <span className="text-xs font-semibold text-slate-900">{kycDetails.account_holder_name}</span>
                               </div>
                             )}
                             {kycDetails.bank_account_number && (
                               <div className="flex justify-between items-center py-2 border-b border-slate-900/5 group">
                                 <span className="text-[10px] text-slate-500 group-hover:text-slate-900 transition-colors">A/C Number</span>
                                 <div className="flex items-center gap-3">
                                   <span className="text-xs font-bold text-slate-900 font-mono">{kycDetails.bank_account_number}</span>
                                   <button
                                     onClick={() => copyToClipboard(kycDetails.bank_account_number)}
                                     className="text-slate-500 hover:text-[#8a6d1f] transition-colors opacity-0 group-hover:opacity-100"
                                   >
                                     <Copy className="w-3 h-3"/>
                                   </button>
                                 </div>
                               </div>
                             )}
                             {(kycDetails.district || kycDetails.routing_code) && (
                               <div className="flex justify-between items-center py-2 border-b border-slate-900/5 group">
                                 <span className="text-[10px] text-slate-500 group-hover:text-slate-900 transition-colors">District / Routing</span>
                                 <span className="text-xs font-bold text-slate-900 font-mono">{kycDetails.district || kycDetails.routing_code}</span>
                               </div>
                             )}
                           </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* TRANSACTION LEDGER */}
                  <div className="glass-panel p-6 rounded-2xl relative shadow-xl border border-slate-900/5 space-y-6">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-900/5 flex-wrap">
                      <div className="shrink-0">
                        <span className="text-[10px] font-bold text-[#8a6d1f] uppercase tracking-widest block mb-1">Disbursement History</span>
                        <h3 className="text-sm font-bold text-slate-900 font-serif">{activeTab === 'employees' ? 'Salary Payment Ledger' : 'Value Transfer Ledger'}</h3>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 mt-2 md:mt-0 w-full md:w-auto justify-start md:justify-end">
                          {/* Export Dossier Dropdown */}
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setShowDossierDropdown(!showDossierDropdown)}
                              className="flex items-center gap-1.5 bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 text-[#8a6d1f] px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              {selectedProfileVouchers.length > 0 ? `Export Selected (${selectedProfileVouchers.length})` : 'Export All Vouchers'}
                            </button>
                            {showDossierDropdown && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setShowDossierDropdown(false)} />
                                <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-900/10 rounded-xl shadow-2xl py-2 z-50 flex flex-col">
                                  <button onClick={() => { handleExportIndividualDossierExcel(); setShowDossierDropdown(false) }} className="px-4 py-2.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors cursor-pointer">
                                    Export Vouchers (.xlsx)
                                  </button>
                                  <button onClick={() => { handleExportIndividualDossierCSV(); setShowDossierDropdown(false) }} className="px-4 py-2.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors border-t border-slate-900/5 cursor-pointer">
                                    Export Vouchers (.csv)
                                  </button>
                                  <button onClick={() => { handleExportIndividualDossierPDF(); setShowDossierDropdown(false) }} className="px-4 py-2.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors border-t border-slate-900/5 cursor-pointer">
                                    Export Vouchers (.pdf)
                                  </button>
                                </div>
                              </>
                            )}
                          </div>

                          {/* Branch History Filter */}
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Filter:</label>
                          <select
                            value={selectedHistoryBranch}
                            onChange={(e) => setSelectedHistoryBranch(e.target.value)}
                            className="bg-white border border-slate-900/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50 animate-fade-in"
                          >
                            <option value="all" className="bg-white text-slate-900">All Branches</option>
                            {branches.map(b => (
                              <option key={b.id} value={b.id} className="bg-white text-slate-900">{b.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      </div>

                      {/* Summary stats for selected branch */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
                        <div>
                          <span className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold block mb-0.5">Total Paid (Selected Filter)</span>
                          <span className="text-xl font-bold text-slate-900 font-serif break-all sm:break-normal">{isDetailsLoading ? '…' : `${totalPaid.toLocaleString()} BDT`}</span>
                        </div>
                        <div>
                          <span className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold block mb-0.5">Disbursement Frequency</span>
                          <span className="text-xl font-bold text-slate-900 font-serif">{isDetailsLoading ? '…' : `${transactionCount} times`}</span>
                        </div>
                      </div>

                      {/* Select All Bar */}
                      {filteredHistory.length > 0 && (
                        <div className="flex items-center gap-2 pb-2 border-b border-slate-900/5">
                          <button
                            type="button"
                            onClick={() => toggleAllProfileVouchers(filteredHistory)}
                            className="flex items-center gap-2 text-xs text-slate-500 hover:text-[#8a6d1f] transition-colors focus:outline-none"
                          >
                            {selectedProfileVouchers.length === filteredHistory.length && filteredHistory.length > 0 ? (
                              <CheckSquare className="w-4 h-4 text-[#8a6d1f]" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                            <span className="font-semibold select-none">Select All ({filteredHistory.length})</span>
                          </button>
                        </div>
                      )}

                      {/* Ledger list */}
                      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {isDetailsLoading ? (
                          <div aria-busy="true" aria-label="Loading payment history" className="space-y-3">
                            {[0, 1].map(i => (
                              <div key={i} className="p-4 rounded-xl border border-slate-900/5 bg-white animate-pulse">
                                <div className="h-3.5 w-36 rounded bg-slate-900/10 mb-2" />
                                <div className="h-2.5 w-24 rounded bg-[#d4af37]/20" />
                              </div>
                            ))}
                          </div>
                        ) : filteredHistory.length === 0 ? (
                          <div className="text-center py-6 text-slate-500 text-xs italic">
                            No salary payments found for the selected branch filter.
                          </div>
                        ) : (
                          filteredHistory.map((item: any) => {
                            const itemBranch = branches.find(b => b.id === item.branch_id);
                            const isChecked = selectedProfileVouchers.includes(item.id);
                            return (
                              <div key={item.id} className={`p-4 rounded-xl bg-white border flex flex-col sm:flex-row justify-between sm:items-center gap-3 relative overflow-hidden group transition-all ${isChecked ? 'border-[#d4af37]/50 bg-[#d4af37]/5' : 'border-slate-900/5'}`}>
                                <div className="absolute top-0 left-0 bottom-0 w-[3px] bg-[#d4af37]" />
                                <div className="flex items-start gap-3 pl-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleProfileVoucherSelection(item.id)}
                                    className="mt-0.5 p-2 text-slate-500 hover:text-[#8a6d1f] transition-colors focus:outline-none shrink-0"
                                  >
                                    {isChecked ? <CheckSquare className="w-4 h-4 text-[#8a6d1f]" /> : <Square className="w-4 h-4" />}
                                  </button>
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-slate-900">{activeTab === 'employees' ? 'Salary Disbursed' : 'Value Transfer'}</span>
                                    {itemBranch && (
                                      <span className="text-[9px] bg-[#d4af37]/10 text-[#8a6d1f] border border-[#d4af37]/20 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                                        {itemBranch.name}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-500 space-y-0.5">
                                    {(item.base_salary_at_time > 0 || item.overtime_amount > 0 || item.bonus_amount > 0 || item.sales_commission > 0 || item.tiffin_bill > 0) && (
                                      <div className="flex flex-wrap gap-2 mb-1.5 text-slate-600">
                                        {item.base_salary_at_time > 0 && <span>Basic: {item.base_salary_at_time}</span>}
                                        {item.overtime_amount > 0 && <span>OT: {item.overtime_amount}</span>}
                                        {item.bonus_amount > 0 && <span>Bonus: {item.bonus_amount}</span>}
                                        {item.sales_commission > 0 && <span>Comm: {item.sales_commission}</span>}
                                        {item.tiffin_bill > 0 && <span>Tiffin: {item.tiffin_bill}</span>}
                                      </div>
                                    )}
                                    {item.account && <p>Account: <span className="font-mono text-slate-700">{item.account}</span></p>}
                                    <p>Trx ID: <span className="font-mono text-slate-600">{item.transaction_id || 'N/A'}</span></p>
                                    <p className="text-[9px] text-slate-500">Date: {new Date(item.payment_date).toLocaleDateString()} {new Date(item.payment_date).toLocaleTimeString()}</p>
                                  </div>
                                  </div>
                                </div>
                                <div className="flex sm:flex-col items-end justify-between sm:justify-center gap-2 pr-2 pl-4 sm:pl-0">
                                  <span className="text-sm font-bold text-emerald-600 font-serif">+{Number(item.amount).toLocaleString()} BDT</span>
                                  <button
                                    type="button"
                                    onClick={() => handleExportSingleLedgerVoucherPdf(item)}
                                    className="px-2.5 py-1 rounded-lg bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 text-[#8a6d1f] text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-all cursor-pointer shadow-sm hover:shadow-[#d4af37]/10"
                                    title="Export Voucher (PDF)"
                                  >
                                    <Download className="w-3 h-3" />
                                    Export
                                  </button>
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </motion.div>
              ) : (
                <div className="glass-panel p-6 lg:p-10 rounded-2xl shadow-xl flex flex-col gap-6 animate-fade-in border border-slate-900/5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-[#d4af37]/5 rounded-full filter blur-[100px] pointer-events-none" />

                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-slate-900/5 z-10">
                    <div>
                      <h3 className="text-2xl font-bold text-slate-900 font-serif flex items-center gap-3">
                        <CreditCard className="w-6 h-6 text-[#8a6d1f]" /> {activeTab === 'employees' ? 'Global Employee Salary Ledger' : 'Global Partner Value Transfer Ledger'}
                      </h3>
                      <p className="text-xs text-slate-500 mt-2">{activeTab === 'employees' ? 'History of all recent salary disbursements across the workforce.' : 'History of all value transfers and completed payouts across network partners.'}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowGlobalExportDropdown(!showGlobalExportDropdown)}
                          className="flex items-center gap-1.5 bg-gradient-to-r from-[#d4af37] to-white text-black px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-md hover:scale-105"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {selectedGlobalVouchers.length > 0 ? `Export Selected (${selectedGlobalVouchers.length}) ▼` : 'Export Vouchers (Bulk) ▼'}
                        </button>
                        {showGlobalExportDropdown && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowGlobalExportDropdown(false)} />
                            <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-900/10 rounded-xl shadow-2xl py-2 z-50 flex flex-col">
                              <button onClick={() => { handleExportGlobalExcel(); setShowGlobalExportDropdown(false) }} className="px-4 py-2.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors cursor-pointer">
                                {selectedGlobalVouchers.length > 0 ? 'Export Selected (.xlsx)' : 'Export All (.xlsx)'}
                              </button>
                              <button onClick={() => { handleExportGlobalCSV(); setShowGlobalExportDropdown(false) }} className="px-4 py-2.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors border-t border-slate-900/5 cursor-pointer">
                                {selectedGlobalVouchers.length > 0 ? 'Export Selected (.csv)' : 'Export All (.csv)'}
                              </button>
                              <button onClick={() => { handleExportGlobalPDF(); setShowGlobalExportDropdown(false) }} className="px-4 py-2.5 text-left text-[10px] font-semibold hover:bg-slate-900/[0.04] hover:text-[#8a6d1f] text-slate-900 transition-colors border-t border-slate-900/5 cursor-pointer">
                                {selectedGlobalVouchers.length > 0 ? 'Export Selected (.pdf)' : 'Export All (.pdf)'}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="bg-slate-900/[0.04] border border-slate-900/10 px-5 py-3 rounded-xl flex flex-col items-end">
                        <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Total Payouts</span>
                        <span className="text-emerald-600 font-bold font-mono text-lg">{filteredMasterLedger.reduce((sum, item) => sum + Number(item.amount), 0).toLocaleString()} BDT</span>
                      </div>
                    </div>
                  </div>

                  {/* Select All Bar */}
                  {filteredMasterLedger.length > 0 && (
                    <div className="flex items-center gap-2 pb-2 z-10 border-b border-slate-900/5">
                      <button
                        type="button"
                        onClick={() => toggleAllGlobalVouchers(filteredMasterLedger)}
                        className="flex items-center gap-2 text-xs text-slate-500 hover:text-[#8a6d1f] transition-colors focus:outline-none"
                      >
                        {selectedGlobalVouchers.length === filteredMasterLedger.length && filteredMasterLedger.length > 0 ? (
                          <CheckSquare className="w-4 h-4 text-[#8a6d1f]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                        <span className="font-semibold select-none">Select All ({filteredMasterLedger.length})</span>
                      </button>
                    </div>
                  )}

                  <div className="space-y-3 z-10 max-h-[500px] overflow-y-auto custom-scrollbar pr-2">
                    {filteredMasterLedger.length === 0 ? (
                      <div className="text-center py-10 text-slate-500 text-xs italic">
                        {activeTab === 'employees' ? 'No salary payments have been recorded yet. Select an employee to issue their first salary.' : 'No value transfers or completed payouts found for partners.'}
                      </div>
                    ) : (
                      filteredMasterLedger.map((item) => {
                        const isChecked = selectedGlobalVouchers.includes(item.id);
                        return (
                        <div key={item.id} className={`flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 rounded-xl border transition-all gap-4 ${isChecked ? 'border-[#d4af37]/50 bg-[#d4af37]/5' : 'bg-slate-900/[0.04] border-slate-900/5 hover:border-slate-900/10'}`}>
                          <div className="flex items-start gap-3 flex-1">
                            <button
                              type="button"
                              onClick={() => toggleGlobalVoucherSelection(item.id)}
                              className="mt-0.5 p-2 text-slate-500 hover:text-[#8a6d1f] transition-colors focus:outline-none shrink-0"
                            >
                              {isChecked ? <CheckSquare className="w-4 h-4 text-[#8a6d1f]" /> : <Square className="w-4 h-4" />}
                            </button>
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-bold text-slate-900">{item.profiles?.full_name || 'Unknown Employee'}</span>
                              <span className="text-[10px] bg-slate-900/[0.04] text-slate-500 px-2 py-0.5 rounded font-mono">
                                {new Date(item.payment_date).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-slate-500">
                              {item.transaction_id && <span>Trx: <span className="font-mono text-slate-600">{item.transaction_id}</span></span>}
                              {item.account && <span>Acc: <span className="text-slate-600">{item.account}</span></span>}
                            </div>
                            {item.notes && (
                              <div className="mt-2 text-[10px] text-[#8a6d1f]/80 bg-[#d4af37]/10 px-3 py-1.5 rounded-lg border border-[#d4af37]/20 inline-block">
                                Note: {item.notes}
                              </div>
                            )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2 shrink-0">
                            <span className="text-sm font-bold text-emerald-600 font-serif">+{Number(item.amount).toLocaleString()} BDT</span>
                            <button
                              type="button"
                              onClick={() => handleExportSingleLedgerVoucherPdf(item, item.profiles?.full_name)}
                              className="px-2.5 py-1 rounded-lg bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 text-[#8a6d1f] text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-all cursor-pointer shadow-sm hover:shadow-[#d4af37]/10"
                              title="Export Voucher (PDF)"
                            >
                              <Download className="w-3 h-3" />
                              Export
                            </button>
                          </div>
                        </div>
                      );
                    })
                    )}
                  </div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* FULLSCREEN IMAGE VIEWER */}
      <AnimatePresence>
        {fullscreenImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/50 z-[60] flex items-center justify-center p-4 backdrop-blur-md"
            onClick={() => setFullscreenImage(null)}
          >
            <button
              className="absolute top-6 right-6 p-2 rounded-full bg-slate-900/[0.07] hover:bg-slate-900/[0.09] text-slate-900 transition-colors"
              onClick={() => setFullscreenImage(null)}
            >
              <X className="w-6 h-6" />
            </button>
            <img src={fullscreenImage} className="max-w-full max-h-[90vh] object-contain rounded-lg border border-slate-900/10 shadow-2xl" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ADD SALARY MODAL */}
      <AnimatePresence>
        {showSalaryModal && selectedUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/50 z-[60] flex justify-center items-center p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="glass-panel p-4 sm:p-6 rounded-2xl max-w-lg w-full relative shadow-2xl overflow-y-auto max-h-[90vh] border border-[#d4af37]/30"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 font-serif">{activeTab === 'employees' ? 'Disburse Salary' : 'Issue Value Transfer'}</h3>
                  <p className="text-xs text-slate-500 mt-1">{activeTab === 'employees' ? 'Record a new salary payment to the ledger.' : 'Record a value transfer to partner ledger.'}</p>
                </div>
                <button onClick={() => setShowSalaryModal(false)} className="text-slate-500 hover:text-slate-900 bg-slate-900/[0.04] p-2.5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Reference Card */}
              <div className="mb-6 p-4 rounded-xl bg-gradient-to-br from-[#d4af37]/10 to-transparent border border-[#d4af37]/20 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-[#8a6d1f] uppercase tracking-wider mb-0.5">{activeTab === 'employees' ? 'Employee' : 'Partner'}</p>
                  <p className="text-sm font-semibold text-slate-900 break-all sm:break-normal">{selectedUser.full_name}</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-[10px] font-bold text-[#8a6d1f] uppercase tracking-wider mb-0.5">{activeTab === 'employees' ? 'Fixed Base Salary' : 'Base Allocation'}</p>
                  <p className="text-sm font-bold text-emerald-600">{selectedUser.salary ? `${Number(selectedUser.salary).toLocaleString()} BDT` : 'Not Set'}</p>
                </div>
              </div>

              <form onSubmit={handleAddSalary} className="space-y-5">
                {activeTab === 'employees' && ledgerHeads.length > 0 && (
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Ledger Head (Expense Category) <span className="text-emerald-500">*</span></label>
                    <select value={ledgerHeadId} onChange={(e)=>setLedgerHeadId(e.target.value)} required className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-sm font-bold text-slate-900 focus:outline-none focus:border-[#d4af37]/50 transition-colors">
                      <option value="" disabled className="bg-white">Select Ledger Head</option>
                      {ledgerHeads.map(l => <option key={l.id} value={l.id} className="bg-white">{l.name} {l.code_number ? `(Code ${l.code_number})` : ''}</option>)}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 flex justify-between">
                      <span>Basic (BDT)</span>
                      <span className="text-emerald-500">*</span>
                    </label>
                    <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-sm font-bold text-slate-900 focus:outline-none focus:border-[#d4af37]/50 transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 flex justify-between">
                      <span>Overtime</span>
                    </label>
                    <input type="number" value={overtimeAmount} onChange={(e) => setOvertimeAmount(e.target.value)} className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-sm font-bold text-slate-900 focus:outline-none focus:border-[#d4af37]/50 transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 flex justify-between">
                      <span>Bonus</span>
                    </label>
                    <input type="number" value={bonusAmount} onChange={(e) => setBonusAmount(e.target.value)} className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-sm font-bold text-slate-900 focus:outline-none focus:border-[#d4af37]/50 transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 flex justify-between">
                      <span>Sales Comm</span>
                    </label>
                    <input type="number" value={salesCommission} onChange={(e) => setSalesCommission(e.target.value)} className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-sm font-bold text-slate-900 focus:outline-none focus:border-[#d4af37]/50 transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 flex justify-between">
                      <span>Tiffin Bill</span>
                    </label>
                    <input type="number" value={tiffinBill} onChange={(e) => setTiffinBill(e.target.value)} className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-sm font-bold text-slate-900 focus:outline-none focus:border-[#d4af37]/50 transition-colors" />
                  </div>
                </div>

                <div className="p-4 bg-[#d4af37]/5 border border-[#d4af37]/20 rounded-xl flex justify-between items-center">
                  <div className="flex items-center gap-2 text-[#8a6d1f]"><span className="text-xs font-bold uppercase tracking-wider">Total Amount</span></div>
                  <span className="text-lg font-bold text-slate-900">{(Number(amount || 0) + Number(overtimeAmount || 0) + Number(bonusAmount || 0) + Number(salesCommission || 0) + Number(tiffinBill || 0)).toLocaleString()} BDT</span>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Remarks / Notes (Optional)</label>
                  <textarea rows={2} value={salaryNote} onChange={(e) => setSalaryNote(e.target.value)} placeholder="e.g. Added 5k Eid Bonus" className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-sm text-slate-900 focus:outline-none focus:border-[#d4af37]/50 transition-colors resize-none" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Branch for Transaction</label>
                    <select
                      value={selectedSalaryBranch}
                      onChange={(e) => setSelectedSalaryBranch(e.target.value)}
                      required
                      className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50"
                    >
                      <option value="" className="bg-white text-slate-900">Select Branch</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id} className="bg-white text-slate-900">{b.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Payout Destination/Account</label>
                    <select
                      value={selectedSalaryAccount}
                      onChange={(e) => setSelectedSalaryAccount(e.target.value)}
                      className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50"
                    >
                      {selectedUser.bank_info && Object.entries(selectedUser.bank_info).map(([key, val]) => {
                        if (!val) return null
                        const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())
                        return (
                          <option key={key} value={`${label}: ${val}`} className="bg-white text-slate-900">
                            {label}: {String(val)}
                          </option>
                        )
                      })}
                      <option value="Custom" className="bg-white text-slate-900">Custom / Other</option>
                    </select>
                  </div>
                </div>

                {selectedSalaryAccount === 'Custom' && (
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Custom Account/Method Details</label>
                    <input
                      type="text"
                      value={customAccountInput}
                      onChange={(e) => setCustomAccountInput(e.target.value)}
                      required
                      placeholder="e.g. bKash: 01712345678 or Hand Cash"
                      className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Transaction ID</label>
                    <input type="text" value={trxId} onChange={(e) => setTrxId(e.target.value)} required placeholder="e.g. TRX-1290381" className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs font-mono text-slate-900 focus:outline-none focus:border-[#d4af37]/50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Payment Date</label>
                    <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50" />
                  </div>
                </div>

                <div>
                  <label className="flex flex-col items-center justify-center w-full py-6 border-2 border-dashed border-slate-900/10 hover:border-[#d4af37]/30 rounded-xl cursor-pointer bg-slate-900/[0.04] transition-all">
                    <Camera className="w-6 h-6 text-slate-500 mb-2" />
                    <span className="text-xs text-slate-500 font-semibold">{proofFile ? proofFile.name : 'Upload Screenshot (PNG, JPG)'}</span>
                    <input type="file" className="hidden" accept="image/*" onChange={(e) => { if (e.target.files && e.target.files[0]) setProofFile(e.target.files[0]) }} />
                  </label>
                </div>
                <button type="submit" disabled={isSubmitting} className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-600 font-semibold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 mt-4">
                  {isSubmitting ? 'Processing...' : (activeTab === 'employees' ? 'Confirm Salary Disbursement' : 'Confirm Value Transfer')}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CHANGE BRANCH MODAL */}
      <AnimatePresence>
        {showBranchModal && selectedUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/50 z-[60] flex justify-center items-center p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="glass-panel p-4 sm:p-6 rounded-2xl max-w-md w-full relative shadow-2xl overflow-y-auto max-h-[90vh] border border-[#d4af37]/30"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 font-serif">Transfer Employee Branch</h3>
                  <p className="text-[10px] text-slate-500 mt-1">Employee: <span className="text-[#8a6d1f]">{selectedUser.full_name}</span></p>
                </div>
                <button type="button" onClick={() => setShowBranchModal(false)} className="text-slate-500 hover:text-slate-900 cursor-pointer p-2.5 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleBranchTransfer} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 font-sans">Current Branch</label>
                  <div className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs font-semibold text-slate-500">
                    {selectedUser.branch || 'Not Assigned'}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 font-sans">New Branch</label>
                  <select
                    value={transferBranchId}
                    onChange={(e) => setTransferBranchId(e.target.value)}
                    required
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50"
                  >
                    <option value="" className="bg-white text-slate-900">Select New Branch</option>
                    {branches
                      .filter((b) => b.id !== selectedUser.branch_id)
                      .map((b) => (
                        <option key={b.id} value={b.id} className="bg-white text-slate-900">
                          {b.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 font-sans">Effective Join Date</label>
                  <input
                    type="date"
                    value={transferJoinDate}
                    onChange={(e) => setTransferJoinDate(e.target.value)}
                    required
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 font-sans">Transfer Note / Reason</label>
                  <textarea
                    value={transferNote}
                    onChange={(e) => setTransferNote(e.target.value)}
                    placeholder="e.g. Relocated to Dhaka Head Office for project support"
                    maxLength={200}
                    rows={3}
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50 resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-gradient-to-r from-[#d4af37] to-white text-black font-semibold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 mt-4 cursor-pointer hover:shadow-lg hover:shadow-[#d4af37]/10 transition-all"
                >
                  {isSubmitting ? 'Processing Transfer...' : 'Confirm Branch Transfer'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CHANGE POSITION MODAL */}
      <AnimatePresence>
        {showPositionModal && selectedUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/50 z-[60] flex justify-center items-center p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="glass-panel p-4 sm:p-6 rounded-2xl max-w-md w-full relative shadow-2xl overflow-y-auto max-h-[90vh] border border-[#d4af37]/30"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 font-serif">Change Employee Position</h3>
                  <p className="text-[10px] text-slate-500 mt-1">Employee: <span className="text-[#8a6d1f]">{selectedUser.full_name}</span></p>
                </div>
                <button type="button" onClick={() => setShowPositionModal(false)} className="text-slate-500 hover:text-slate-900 cursor-pointer p-2.5 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handlePositionTransfer} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 font-sans">Current Position</label>
                  <div className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-4 text-xs font-semibold text-slate-500">
                    {selectedUser.position || 'Not Assigned'}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 font-sans">New Position</label>
                  <select
                    value={transferPositionId}
                    onChange={(e) => setTransferPositionId(e.target.value)}
                    required
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50"
                  >
                    <option value="" className="bg-white text-slate-900">Select New Position</option>
                    {positions
                      .filter((p) => p.id !== selectedUser.position_id)
                      .map((p) => (
                        <option key={p.id} value={p.id} className="bg-white text-slate-900">
                          {p.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 font-sans">Effective Date</label>
                  <input
                    type="date"
                    value={transferPositionJoinDate}
                    onChange={(e) => setTransferPositionJoinDate(e.target.value)}
                    required
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5 font-sans">Change Note / Reason</label>
                  <textarea
                    value={transferPositionNote}
                    onChange={(e) => setTransferPositionNote(e.target.value)}
                    placeholder="e.g. Promoted to Senior Role after annual evaluation"
                    maxLength={200}
                    rows={3}
                    className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50 resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-gradient-to-r from-[#d4af37] to-white text-black font-semibold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 mt-4 cursor-pointer hover:shadow-lg hover:shadow-[#d4af37]/10 transition-all"
                >
                  {isSubmitting ? 'Processing Position Change...' : 'Confirm Position Change'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
