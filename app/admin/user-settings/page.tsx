'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, ShieldCheck, Check, AlertTriangle, Key,
  Phone, Loader2, UserPlus, Trash2, Edit3, X
} from 'lucide-react'

export default function AdminUserSettings() {
  const [users, setUsers] = useState<any[]>([])
  const [selectedUser, setSelectedUser] = useState<any | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // UI States
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null)
  const [showRegisterModal, setShowRegisterModal] = useState(false)

  // Edit States
  const [password, setPassword] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [role, setRole] = useState('')
  const [profileType, setProfileType] = useState('')

  // Register States
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regFullName, setRegFullName] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regRole, setRegRole] = useState('user')
  const [regProfileType, setRegProfileType] = useState('employee')

  const fetchUsers = async () => {
    setIsLoading(true)
    try {
      // current identity via /api/auth/me (session cookie).
      const meRes = await fetch('/api/auth/me')
      const meData = await meRes.json().catch(() => null)
      const currentUser = meData?.user ?? null
      if (currentUser) setCurrentUserId(currentUser.id)

      const response = await fetch('/api/admin/users')
      if (!response.ok) {
        throw new Error('Failed to fetch users')
      }
      const data = await response.json()
      const allUsers = data.users || []
      setUsers(currentUser ? allUsers.filter((u: any) => u.id !== currentUser.id) : allUsers)
    } catch (err: any) {
      console.error('Error fetching users:', err)
      setFeedback({ type: 'error', message: 'Failed to load users.' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const handleSelectUser = (user: any) => {
    setSelectedUser(user)
    setPhoneNumber(user.phone_number || '')
    setRole(user.role || 'user')
    setProfileType(user.profile_type || 'employee')
    setPassword('')
  }

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return
    setIsSubmitting(true)
    setFeedback(null)

    try {
      const response = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: password || undefined,
          phone_number: phoneNumber,
          role: role,
          profile_type: profileType
        })
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to update user')

      setFeedback({ type: 'success', message: 'User updated successfully!' })
      setPassword('')
      fetchUsers()
      setTimeout(() => setFeedback(null), 3000)
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteUser = async () => {
    if (!selectedUser) return
    if (selectedUser.id === currentUserId) {
      setFeedback({ type: 'error', message: 'You cannot delete your own admin account.' })
      return
    }
    if (!confirm(`CRITICAL WARNING: Are you sure you want to permanently delete ${selectedUser.full_name}? This action cannot be undone.`)) return

    setIsSubmitting(true)
    setFeedback(null)

    try {
      const response = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: 'DELETE'
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to delete user')

      setFeedback({ type: 'success', message: 'User deleted permanently.' })
      setSelectedUser(null)
      fetchUsers()
      setTimeout(() => setFeedback(null), 3000)
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRegisterUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setFeedback(null)

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: regEmail,
          password: regPassword,
          full_name: regFullName,
          phone_number: regPhone,
          role: regRole,
          profile_type: regProfileType
        })
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to register user')

      setFeedback({ type: 'success', message: 'User registered successfully!' })
      setShowRegisterModal(false)
      // Reset form
      setRegEmail(''); setRegPassword(''); setRegFullName(''); setRegPhone('')
      fetchUsers()
      setTimeout(() => setFeedback(null), 3000)
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-white text-[#15803d]">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans overflow-x-hidden relative">
      <div className="absolute top-[-10%] right-[-5%] w-[45%] h-[45%] bg-[#1ca34c]/5 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="flex-1 flex flex-col p-6 max-w-6xl mx-auto z-10 w-full relative">
        <div className="flex justify-between items-end mb-8 pb-4 border-b border-slate-900/5">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 font-serif flex items-center gap-3">
              <span className="w-1.5 h-9 rounded-full bg-[#1ca34c] shrink-0" />
              User <span className="premium-text-gradient">Settings</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">Manage all user credentials, roles, and administrative permissions.</p>
          </div>
          <button
            onClick={() => setShowRegisterModal(true)}
            className="bg-[#1ca34c]/10 hover:bg-[#1ca34c]/20 border border-[#1ca34c]/30 text-[#15803d] px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all"
          >
            <UserPlus className="w-4 h-4" /> Register New User
          </button>
        </div>

        <AnimatePresence mode="wait">
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className={`p-4 rounded-xl border mb-6 flex gap-3 text-xs shadow-xl items-center ${
                feedback.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' : 'bg-rose-500/10 border-rose-500/20 text-rose-600'
              }`}
            >
              {feedback.type === 'success' ? <Check className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
              <span className="font-semibold text-sm">{feedback.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start pb-10">

          {/* USERS LIST */}
          <div className="lg:col-span-1 glass-panel p-4 rounded-2xl shadow-xl flex flex-col h-[70vh]">
            <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-widest pl-2">All Users</h3>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {users.filter(u => u.id !== currentUserId).map(user => (
                <div
                  key={user.id}
                  onClick={() => handleSelectUser(user)}
                  className={`p-3 rounded-xl cursor-pointer transition-all border ${
                    selectedUser?.id === user.id
                      ? 'bg-[#1ca34c]/10 border-[#1ca34c]/30'
                      : 'bg-slate-900/[0.04] border-slate-900/5 hover:bg-slate-900/[0.04]'
                  }`}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-sm text-slate-900">{user.full_name || 'Unnamed User'}</span>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold ${
                      user.role === 'admin' || user.role === 'super_admin' ? 'bg-rose-500/20 text-rose-600' : 'bg-blue-500/20 text-blue-600'
                    }`}>
                      {user.role}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 truncate">{user.email || 'No email associated'}</div>
                </div>
              ))}
            </div>
          </div>

          {/* USER DETAILS & EDIT */}
          <div className="lg:col-span-2">
            {selectedUser ? (
              <div className="glass-panel p-6 sm:p-8 rounded-2xl relative shadow-xl overflow-hidden">
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-10 h-10 rounded-xl bg-[#1ca34c]/10 border border-[#1ca34c]/30 flex items-center justify-center text-[#15803d]">
                    <Edit3 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 font-serif">Edit User: {selectedUser.full_name}</h3>
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest">Update Credentials & Permissions</span>
                  </div>
                </div>

                <form onSubmit={handleUpdateUser} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5 flex items-center gap-1.5"><Phone className="w-3 h-3" /> Phone Number</label>
                      <input
                        type="text"
                        value={phoneNumber}
                        onChange={e => setPhoneNumber(e.target.value)}
                        className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5 flex items-center gap-1.5"><Key className="w-3 h-3" /> Reset Password</label>
                      <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Leave blank to keep current"
                        className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50 placeholder-slate-600"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5 flex items-center gap-1.5"><ShieldCheck className="w-3 h-3" /> System Role</label>
                      <select
                        value={role}
                        onChange={e => setRole(e.target.value)}
                        className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                        <option value="super_admin">Super Admin</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5 flex items-center gap-1.5"><User className="w-3 h-3" /> Profile Type</label>
                      <select
                        value={profileType}
                        onChange={e => setProfileType(e.target.value)}
                        className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50"
                      >
                        <option value="employee">Employee</option>
                        <option value="partner">Partner</option>
                        <option value="head_office">Head Office</option>
                        <option value="branch_manager">Branch Manager</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-4 flex gap-4">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex-1 bg-[#1ca34c]/10 hover:bg-[#1ca34c]/20 border border-[#1ca34c]/30 text-[#15803d] font-bold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                    >
                      {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save User Settings
                    </button>

                    <button
                      type="button"
                      onClick={handleDeleteUser}
                      disabled={isSubmitting || selectedUser?.id === currentUserId}
                      title={selectedUser?.id === currentUserId ? "You cannot delete your own account" : "Delete User"}
                      className="px-6 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 font-bold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="glass-panel p-10 rounded-2xl flex flex-col items-center justify-center text-center h-[70vh]">
                <User className="w-12 h-12 text-slate-600 mb-4" />
                <h3 className="text-lg font-bold text-slate-500">No User Selected</h3>
                <p className="text-xs text-slate-500 mt-2 max-w-sm">Select a user from the list on the left to view and edit their credentials, roles, and profile information.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* REGISTRATION MODAL */}
      <AnimatePresence>
        {showRegisterModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="glass-panel p-6 sm:p-8 rounded-2xl w-full max-w-md relative shadow-2xl border border-slate-900/10 max-h-[90vh] overflow-y-auto"
            >
              <button
                onClick={() => setShowRegisterModal(false)}
                className="absolute top-4 right-4 p-3 rounded-xl hover:bg-slate-900/[0.04] text-slate-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              <h3 className="text-xl font-bold text-slate-900 font-serif mb-1">Register New User</h3>
              <p className="text-xs text-slate-500 mb-6">Manually add a new user to the system.</p>

              <form onSubmit={handleRegisterUser} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5">Full Name</label>
                  <input required type="text" value={regFullName} onChange={e => setRegFullName(e.target.value)} className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5">Email Address</label>
                  <input required type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5">Phone Number</label>
                  <input type="text" value={regPhone} onChange={e => setRegPhone(e.target.value)} className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5">Password</label>
                  <input required type="password" value={regPassword} onChange={e => setRegPassword(e.target.value)} className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5">System Role</label>
                    <select value={regRole} onChange={e => setRegRole(e.target.value)} className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50">
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                      <option value="super_admin">Super Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-1.5">Profile Type</label>
                    <select value={regProfileType} onChange={e => setRegProfileType(e.target.value)} className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50">
                      <option value="employee">Employee</option>
                      <option value="partner">Partner</option>
                      <option value="head_office">Head Office</option>
                      <option value="branch_manager">Branch Manager</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full mt-4 bg-[#1ca34c]/10 hover:bg-[#1ca34c]/20 border border-[#1ca34c]/30 text-[#15803d] font-bold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  Register User
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
