'use client'

export const dynamic = 'force-dynamic'
import React, { useState } from 'react'
import { MapPin, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function CreateBranch() {
  const router = useRouter()
  const [branchName, setBranchName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!branchName.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: branchName.trim() })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create branch')
      router.push('/admin/branches')
    } catch (e: any) {
      setError(e.message || 'Failed to create branch')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans">
      {/* Glow background */}
      <div className="absolute top-[-10%] right-[-5%] w-[50%] h-[50%] bg-[#1ca34c]/3 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="flex-1 flex flex-col p-6 lg:p-10 overflow-y-auto max-h-screen relative z-10">
        <div className="mb-8 pb-4 border-b border-slate-900/5 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-serif">
              Create <span className="premium-text-gradient">New Branch</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">Add a new institutional branch location to the database.</p>
          </div>
          <Link href="/admin/branches" className="flex items-center gap-2 text-[#15803d] hover:underline text-xs tracking-wider uppercase font-semibold">
            <MapPin className="w-4 h-4" /> Back to List
          </Link>
        </div>

        <div className="glass-panel p-6 rounded-2xl relative shadow-xl max-w-md">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Branch Name</label>
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                maxLength={30}
                className="w-full bg-white border border-slate-900/10 rounded-xl py-3 px-4 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50"
                placeholder="e.g., Dhaka, Rangpur"
                required
              />
            </div>
            {error && <p className="text-rose-500 text-[10px] font-semibold">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20 px-4 py-3 rounded-xl hover:bg-[#1ca34c]/20 transition-all font-semibold text-xs tracking-wider uppercase"
            >
              <Plus className="w-4 h-4" /> {loading ? 'Creating…' : 'Create Branch'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
