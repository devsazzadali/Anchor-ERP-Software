'use client'

export const dynamic = 'force-dynamic'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function BranchAccountsPerformanceRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/admin/branch-performance') }, [router])
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-[#1ca34c] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
