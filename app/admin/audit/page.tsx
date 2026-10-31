'use client'

export const dynamic = 'force-dynamic'
import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, ShieldAlert, Activity, RefreshCw, Download,
  Search, Filter, Terminal, User, Building2, Landmark,
  Clock, CheckCircle2, AlertTriangle, Eye, ChevronRight,
  Laptop, Globe, FileText, ArrowRight, X
} from 'lucide-react'
import * as XLSX from 'xlsx'

type ActivityLogItem = {
  id: string
  user_id: string | null
  action: string
  details: Record<string, any> | null
  ip_address: string | null
  device_info: string | null
  created_at: string
  profiles?: { full_name: string; role: string } | null
}

type BranchAuditItem = {
  id: string
  branch_id: string | null
  table_name: string
  record_id: string | null
  action: string
  old_values: Record<string, any> | null
  new_values: Record<string, any> | null
  performed_by: string | null
  created_at: string
  ip_address: string | null
  user_agent: string | null
  branches?: { name: string } | null
  profiles?: { full_name: string } | null
}

type FraudAlertItem = {
  id: string
  user: string
  invoice_title: string
  amount: number
  currency: string
  risk_score: string
  time: string
  reason: string
}

export default function SecurityAuditLogPage() {
  const [activeTab, setActiveTab] = useState<'activity' | 'branch_trail' | 'threats'>('activity')
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([])
  const [branchTrail, setBranchTrail] = useState<BranchAuditItem[]>([])
  const [fraudAlerts, setFraudAlerts] = useState<FraudAlertItem[]>([])

  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionCategory, setActionCategory] = useState('all')
  const [selectedLogDetails, setSelectedLogDetails] = useState<any | null>(null)

  // Fetch all audit streams
  // one admin-gated bundle from /api/admin/audit.
  const fetchAuditData = async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/admin/audit')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load audit logs')

      if (data.activityLogs) {
        setActivityLogs(data.activityLogs)
      }

      if (data.branchTrail) {
        setBranchTrail(data.branchTrail)
      }

      if (data.fraudData) {
        setFraudAlerts(data.fraudData.map((f: any) => ({
          id: f.id,
          user: f.profiles?.full_name || 'Anonymous Applicant',
          invoice_title: f.invoice_title,
          amount: Number(f.amount),
          currency: f.currency || 'BDT',
          risk_score: 'CRITICAL',
          time: f.created_at,
          reason: `Flagged invoice detected: ${f.invoice_title}`,
        })))
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchAuditData()

    // realtime channel replaced with refetch on focus + 30s polling.
    const onFocus = () => fetchAuditData()
    window.addEventListener('focus', onFocus)
    const interval = setInterval(fetchAuditData, 30000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [])

  // Filtered activity logs
  const filteredActivity = useMemo(() => {
    return activityLogs.filter(item => {
      const q = searchQuery.toLowerCase().trim()
      const adminName = item.profiles?.full_name?.toLowerCase() || 'system auto'
      const action = item.action.toLowerCase()
      const target = JSON.stringify(item.details || {}).toLowerCase()
      const ip = item.ip_address?.toLowerCase() || ''

      const matchesSearch = !q || adminName.includes(q) || action.includes(q) || target.includes(q) || ip.includes(q)

      let matchesCategory = true
      if (actionCategory !== 'all') {
        matchesCategory = action.includes(actionCategory.toLowerCase())
      }

      return matchesSearch && matchesCategory
    })
  }, [activityLogs, searchQuery, actionCategory])

  // Filtered branch audit trail
  const filteredBranchTrail = useMemo(() => {
    return branchTrail.filter(item => {
      const q = searchQuery.toLowerCase().trim()
      const branchName = item.branches?.name?.toLowerCase() || ''
      const performedBy = item.profiles?.full_name?.toLowerCase() || 'system'
      const table = item.table_name.toLowerCase()
      const action = item.action.toLowerCase()

      return !q || branchName.includes(q) || performedBy.includes(q) || table.includes(q) || action.includes(q)
    })
  }, [branchTrail, searchQuery])

  // Export to Excel
  const handleExportExcel = () => {
    let exportData: any[] = []
    let fileName = 'Security_Audit_Log'

    if (activeTab === 'activity') {
      fileName = 'Administrative_Activity_Logs'
      exportData = filteredActivity.map(a => ({
        'Log ID': a.id,
        'Timestamp': new Date(a.created_at).toLocaleString(),
        'Operator / Admin': a.profiles?.full_name || 'System Auto',
        'Role': a.profiles?.role || 'system',
        'Action': a.action,
        'Details': JSON.stringify(a.details || {}),
        'IP Address': a.ip_address || 'Internal/Secure',
        'Device / Client': a.device_info || 'Unknown',
      }))
    } else if (activeTab === 'branch_trail') {
      fileName = 'Branch_Financial_Audit_Trail'
      exportData = filteredBranchTrail.map(b => ({
        'Trail ID': b.id,
        'Timestamp': new Date(b.created_at).toLocaleString(),
        'Branch': b.branches?.name || 'All Branches',
        'Entity / Table': b.table_name,
        'Action': b.action,
        'Performed By': b.profiles?.full_name || 'System / Manager',
        'Old Values': JSON.stringify(b.old_values || {}),
        'New Values': JSON.stringify(b.new_values || {}),
        'IP Address': b.ip_address || 'Internal',
      }))
    } else {
      fileName = 'Fraud_Security_Threats'
      exportData = fraudAlerts.map(f => ({
        'Alert ID': f.id,
        'Timestamp': new Date(f.time).toLocaleString(),
        'Applicant / Node': f.user,
        'Invoice Title': f.invoice_title,
        'Amount': `${f.amount} ${f.currency}`,
        'Risk Rating': f.risk_score,
        'Reason': f.reason,
      }))
    }

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Audit_Report')
    XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans relative">
      {/* Background ambient lighting */}
      <div className="absolute top-[-5%] left-[20%] w-[50%] h-[40%] bg-[#d4af37]/3 rounded-full filter blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[10%] w-[40%] h-[40%] bg-rose-500/3 rounded-full filter blur-[140px] pointer-events-none" />

      {/* Main Container */}
      <div className="flex-1 flex flex-col p-6 overflow-y-auto max-h-screen relative z-10">

        {/* Header section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-5 border-b border-slate-900/5">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] bg-[#d4af37]/10 text-[#8a6d1f] border border-[#d4af37]/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                <Shield className="w-3 h-3 text-[#8a6d1f]" /> Immutable Security Core
              </span>
              <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-mono bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Realtime Telemetry
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-serif">
              Security Audit <span className="premium-text-gradient">& Financial Trail</span>
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Comprehensive administrative footprints, ledger mutation verifications, and fraud detection.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchAuditData}
              disabled={isLoading}
              className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#d4af37]/20 text-slate-500 hover:text-slate-900 transition-all cursor-pointer disabled:opacity-50"
              title="Refresh audit logs"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#8a6d1f]' : ''}`} />
            </button>

            <button
              onClick={handleExportExcel}
              className="bg-slate-900/[0.04] hover:bg-slate-900/[0.07] border border-slate-900/10 hover:border-slate-900/20 text-slate-900 font-medium px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 transition-all cursor-pointer shadow"
            >
              <Download className="w-3.5 h-3.5 text-[#8a6d1f]" />
              <span>Export Audit</span>
            </button>
          </div>
        </div>

        {/* Telemetry Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="glass-panel p-5 rounded-2xl relative shadow-lg overflow-hidden border border-slate-900/5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Administrative Footprints</span>
                <h3 className="text-2xl font-bold tracking-tight text-slate-900 font-serif">{activityLogs.length}</h3>
              </div>
              <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600">
                <Terminal className="w-4 h-4" />
              </div>
            </div>
            <span className="text-[10px] text-slate-500 block mt-3">Executive security actions</span>
          </div>

          <div className="glass-panel p-5 rounded-2xl relative shadow-lg overflow-hidden border border-slate-900/5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Branch Ledger Audits</span>
                <h3 className="text-2xl font-bold tracking-tight text-slate-900 font-serif">{branchTrail.length}</h3>
              </div>
              <div className="p-2 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/20 text-[#8a6d1f]">
                <Building2 className="w-4 h-4" />
              </div>
            </div>
            <span className="text-[10px] text-slate-500 block mt-3">Immutable financial mutations</span>
          </div>

          <div className="glass-panel p-5 rounded-2xl relative shadow-lg overflow-hidden border border-slate-900/5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Threat Patrol Alerts</span>
                <h3 className="text-2xl font-bold tracking-tight text-slate-900 font-serif">{fraudAlerts.length}</h3>
              </div>
              <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600">
                <ShieldAlert className="w-4 h-4" />
              </div>
            </div>
            <span className="text-[10px] text-slate-500 block mt-3">{fraudAlerts.length === 0 ? 'All nodes secure' : 'Flagged anomalies requiring review'}</span>
          </div>

          <div className="glass-panel p-5 rounded-2xl relative shadow-lg overflow-hidden border border-slate-900/5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Audit Policy Status</span>
                <h3 className="text-2xl font-bold tracking-tight text-emerald-600 font-serif">Enforced</h3>
              </div>
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <span className="text-[10px] text-slate-500 block mt-3">Append-only audit policies active</span>
          </div>
        </div>

        {/* Tab Navigation & Search Bar */}
        <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 mb-6">
          {/* Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-900/[0.04] border border-slate-900/5 rounded-xl self-start">
            <button
              onClick={() => setActiveTab('activity')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'activity'
                  ? 'bg-[#d4af37] text-black shadow-md font-bold'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04]'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Admin Footprints ({activityLogs.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('branch_trail')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'branch_trail'
                  ? 'bg-[#d4af37] text-black shadow-md font-bold'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04]'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Branch Ledger Trail ({branchTrail.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('threats')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'threats'
                  ? 'bg-[#d4af37] text-black shadow-md font-bold'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04]'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Threat & Fraud Alerts ({fraudAlerts.length})</span>
            </button>
          </div>

          {/* Search and Category Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search operator, action, IP..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-900/[0.04] border border-slate-900/10 focus:border-[#d4af37]/40 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 placeholder-slate-500 focus:outline-none transition-colors w-64 max-w-full"
              />
            </div>

            {activeTab === 'activity' && (
              <select
                value={actionCategory}
                onChange={(e) => setActionCategory(e.target.value)}
                className="bg-white border border-slate-900/10 focus:border-[#d4af37]/40 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none transition-colors cursor-pointer"
              >
                <option value="all">All Actions</option>
                <option value="kyc">KYC Events</option>
                <option value="payout">Payout Events</option>
                <option value="salary">Salary Events</option>
                <option value="role">User Role Events</option>
                <option value="setting">System Settings</option>
              </select>
            )}
          </div>
        </div>

        {/* Tab Content Panes */}
        {activeTab === 'activity' && (
          <div className="glass-panel rounded-2xl shadow-xl overflow-hidden border border-slate-900/5">
            <div className="p-4 border-b border-slate-900/5 flex justify-between items-center bg-slate-900/[0.04]">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Real-Time Administrative Action Log ({filteredActivity.length} records)
              </span>
            </div>

            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-900/5 text-[9px] uppercase tracking-wider text-slate-500 font-semibold bg-slate-900/[0.04]">
                    <th className="py-3.5 pl-4">Timestamp</th>
                    <th className="py-3.5">Operator</th>
                    <th className="py-3.5">Action Code</th>
                    <th className="py-3.5">Target Dossier / Summary</th>
                    <th className="py-3.5">IP Address</th>
                    <th className="py-3.5">Device / Origin</th>
                    <th className="py-3.5 text-right pr-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900/[0.08]">
                  {filteredActivity.map((log) => {
                    const isKyc = log.action.includes('KYC')
                    const isPayout = log.action.includes('PAYOUT')
                    const isSalary = log.action.includes('SALARY')
                    const isRole = log.action.includes('ROLE') || log.action.includes('USER')

                    const badgeStyle = isKyc ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' :
                      isPayout ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                      isSalary ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' :
                      isRole ? 'bg-purple-500/10 text-purple-600 border-purple-500/20' :
                      'bg-slate-500/10 text-slate-600 border-slate-500/20'

                    return (
                      <tr key={log.id} className="hover:bg-slate-900/[0.04] transition-colors group">
                        <td className="py-3.5 pl-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="py-3.5 font-semibold text-slate-900">
                          <div className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-slate-500" />
                            <span>{log.profiles?.full_name || 'System Auto'}</span>
                          </div>
                        </td>
                        <td className="py-3.5">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${badgeStyle}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="py-3.5 text-slate-600">
                          {log.details?.target || log.details?.reason || log.details?.summary || (
                            <span className="text-slate-500 italic font-mono text-[10px]">
                              {JSON.stringify(log.details || {}).slice(0, 45)}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 font-mono text-slate-500 text-[10px] whitespace-nowrap">
                          <span className="flex items-center gap-1">
                            <Globe className="w-3 h-3 text-slate-600" />
                            {log.ip_address || 'Internal/Secure'}
                          </span>
                        </td>
                        <td className="py-3.5 text-slate-500 text-[10px] max-w-[160px] truncate" title={log.device_info || ''}>
                          <span className="flex items-center gap-1">
                            <Laptop className="w-3 h-3 text-slate-600" />
                            {log.device_info || 'Server'}
                          </span>
                        </td>
                        <td className="py-3.5 text-right pr-4">
                          <button
                            onClick={() => setSelectedLogDetails({ type: 'activity', data: log })}
                            className="p-3 rounded-lg bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
                            title="Inspect raw payload"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}

                  {filteredActivity.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500 italic text-xs">
                        {isLoading ? 'Streaming audit records...' : 'No administrative footprints found matching your criteria.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'branch_trail' && (
          <div className="glass-panel rounded-2xl shadow-xl overflow-hidden border border-slate-900/5">
            <div className="p-4 border-b border-slate-900/5 flex justify-between items-center bg-slate-900/[0.04]">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Branch Financial Ledger Audit Trail ({filteredBranchTrail.length} transactions)
              </span>
            </div>

            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-900/5 text-[9px] uppercase tracking-wider text-slate-500 font-semibold bg-slate-900/[0.04]">
                    <th className="py-3.5 pl-4">Timestamp</th>
                    <th className="py-3.5">Branch Location</th>
                    <th className="py-3.5">Target Entity</th>
                    <th className="py-3.5">Action</th>
                    <th className="py-3.5">Operator</th>
                    <th className="py-3.5">IP & Client</th>
                    <th className="py-3.5 text-right pr-4">Inspect Diff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900/[0.08]">
                  {filteredBranchTrail.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-900/[0.04] transition-colors">
                      <td className="py-3.5 pl-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                        {new Date(item.created_at).toLocaleString()}
                      </td>
                      <td className="py-3.5 font-semibold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-[#8a6d1f]" />
                          <span>{item.branches?.name || 'All Branches'}</span>
                        </div>
                      </td>
                      <td className="py-3.5 font-mono text-slate-600 text-[11px]">
                        {item.table_name}
                      </td>
                      <td className="py-3.5">
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-slate-900/[0.04] text-slate-600 border border-slate-900/10">
                          {item.action}
                        </span>
                      </td>
                      <td className="py-3.5 text-slate-600 font-medium">
                        {item.profiles?.full_name || 'System Auto'}
                      </td>
                      <td className="py-3.5 font-mono text-slate-500 text-[10px]">
                        {item.ip_address || 'Internal'}
                      </td>
                      <td className="py-3.5 text-right pr-4">
                        <button
                          onClick={() => setSelectedLogDetails({ type: 'branch', data: item })}
                          className="p-3 rounded-lg bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-slate-500 hover:text-[#8a6d1f] transition-colors cursor-pointer"
                          title="Inspect changes diff"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {filteredBranchTrail.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500 italic text-xs">
                        {isLoading ? 'Querying branch audit trail...' : 'No branch financial mutation records recorded yet.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'threats' && (
          <div className="space-y-4">
            <div className="glass-panel p-6 rounded-2xl shadow-xl border border-rose-500/20 bg-rose-500/[0.02]">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-xl bg-rose-500/10 text-rose-600 border border-rose-500/20">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 font-serif">AI Fraud Patrol & Threat Telemetry</h3>
                  <p className="text-xs text-slate-500">Real-time alerts triggered by heuristic anomaly detection and flagged liquidity nodes.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fraudAlerts.map(alert => (
                <div key={alert.id} className="glass-panel p-5 rounded-2xl border border-rose-500/20 relative shadow-lg">
                  <div className="flex justify-between items-start mb-3">
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-600 border border-rose-500/20 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Risk Rating {alert.risk_score}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(alert.time).toLocaleDateString()}
                    </span>
                  </div>

                  <h4 className="text-sm font-bold text-slate-900 mb-1">Target Account: {alert.user}</h4>
                  <p className="text-xs text-slate-600 font-mono mb-3">{alert.reason}</p>

                  <div className="pt-3 border-t border-slate-900/5 flex justify-between items-center text-xs">
                    <span className="text-slate-500">Flagged Amount:</span>
                    <span className="font-bold text-rose-600">{alert.amount.toLocaleString()} {alert.currency}</span>
                  </div>
                </div>
              ))}

              {fraudAlerts.length === 0 && (
                <div className="col-span-full glass-panel p-12 rounded-2xl text-center border border-emerald-500/20 bg-emerald-500/[0.02]">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                  <h4 className="text-sm font-bold text-slate-900">All Security Checks Passing</h4>
                  <p className="text-xs text-slate-500 mt-1">No payment anomalies, biometric mismatch flags, or security breaches recorded.</p>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* INSPECT DETAIL MODAL */}
      <AnimatePresence>
        {selectedLogDetails && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/50 z-50 flex justify-center items-center p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel p-6 rounded-2xl max-w-xl w-full relative shadow-2xl overflow-hidden border border-slate-900/10 bg-white max-h-[85vh] flex flex-col"
            >
              <div className="flex justify-between items-start mb-4 pb-3 border-b border-slate-900/5 flex-shrink-0">
                <div>
                  <h3 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-[#8a6d1f]" />
                    Audit Entry Payload Inspection
                  </h3>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                    Ref ID: {selectedLogDetails.data.id}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedLogDetails(null)}
                  className="p-3 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04] transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4 overflow-y-auto custom-scrollbar flex-1 pr-1 text-xs">
                {selectedLogDetails.type === 'activity' ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 bg-slate-900/[0.04] p-3 rounded-xl border border-slate-900/5">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block mb-0.5">Operator</span>
                        <span className="text-slate-900 font-semibold">{selectedLogDetails.data.profiles?.full_name || 'System Auto'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block mb-0.5">Action Code</span>
                        <span className="text-[#8a6d1f] font-semibold">{selectedLogDetails.data.action}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block mb-0.5">IP Address</span>
                        <span className="text-slate-600 font-mono">{selectedLogDetails.data.ip_address || 'Internal/Secure'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block mb-0.5">Timestamp</span>
                        <span className="text-slate-600 font-mono">{new Date(selectedLogDetails.data.created_at).toLocaleString()}</span>
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1.5">JSON Payload Details:</span>
                      <pre className="p-4 rounded-xl bg-white border border-slate-900/5 text-emerald-600 font-mono text-[11px] overflow-x-auto">
                        {JSON.stringify(selectedLogDetails.data.details || {}, null, 2)}
                      </pre>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 bg-slate-900/[0.04] p-3 rounded-xl border border-slate-900/5">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block mb-0.5">Branch</span>
                        <span className="text-slate-900 font-semibold">{selectedLogDetails.data.branches?.name || 'All Branches'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block mb-0.5">Entity / Table</span>
                        <span className="text-[#8a6d1f] font-semibold">{selectedLogDetails.data.table_name}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block mb-0.5">Performed By</span>
                        <span className="text-slate-600">{selectedLogDetails.data.profiles?.full_name || 'System'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block mb-0.5">Action</span>
                        <span className="text-slate-600 uppercase font-mono">{selectedLogDetails.data.action}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <span className="text-[10px] text-rose-600 uppercase tracking-wider font-bold block mb-1.5">Prior State (Old Values):</span>
                        <pre className="p-3 rounded-xl bg-white border border-rose-500/20 text-slate-500 font-mono text-[10px] overflow-x-auto max-h-48">
                          {JSON.stringify(selectedLogDetails.data.old_values || {}, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <span className="text-[10px] text-emerald-600 uppercase tracking-wider font-bold block mb-1.5">New State (New Values):</span>
                        <pre className="p-3 rounded-xl bg-white border border-emerald-500/20 text-emerald-700 font-mono text-[10px] overflow-x-auto max-h-48">
                          {JSON.stringify(selectedLogDetails.data.new_values || {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="pt-3 border-t border-slate-900/5 flex justify-end flex-shrink-0 mt-2">
                <button
                  onClick={() => setSelectedLogDetails(null)}
                  className="px-5 py-2 bg-white border border-slate-900/5 hover:border-slate-900/10 text-slate-600 rounded-xl text-xs font-semibold hover:text-slate-900 transition-colors cursor-pointer"
                >
                  Close Inspection
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  )
}
