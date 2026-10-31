'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import StatsCard from '@/components/stats-card'
import {
  Users, AlertTriangle, ShieldCheck, Wallet,
  Terminal, ShieldAlert, Compass, Activity,
  Clock, Search, UserMinus, ShieldCheck as ShieldIcon,
  Store, Building2, TrendingUp, Banknote, Landmark, Receipt
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, Area
} from 'recharts'

import { dhakaDateOf } from '@/lib/dhaka-time'
import { sumMoney } from '@/lib/money'

// Top arrays replaced by live state hooks

export default function AdminDashboard() {
  const [adminName, setAdminName] = useState('Chief Executive Officer')
  const [logs, setLogs] = useState<any[]>([])
  // F5: figures must not render (as 0 / ৳0 / "0.00 BDT") before the
  // telemetry bundle has loaded — the page shows skeletons until then,
  // and empty states only for a genuinely empty LOADED result.
  const [isLoading, setIsLoading] = useState(true)

  // Real data states
  const [activeClients, setActiveClients] = useState(0)
  const [pendingKyc, setPendingKyc] = useState(0)
  const [activePayoutLoad, setActivePayoutLoad] = useState(0)
  const [totalLiquidityCleared, setTotalLiquidityCleared] = useState(0)
  const [telemetryData, setTelemetryData] = useState<{name: string, payouts: number, salaries: number, expenses: number}[]>([])
  const [fraudAlerts, setFraudAlerts] = useState<any[]>([])
  const [totalExpenses, setTotalExpenses] = useState(0)
  const [totalSalaries, setTotalSalaries] = useState(0)
  const [workforceDistribution, setWorkforceDistribution] = useState({ employees: 0, partners: 0, branches: 0 })
  const [taskCompletion, setTaskCompletion] = useState({ completed: 0, pending: 0 })
  const [branchSalesSummary, setBranchSalesSummary] = useState<{
    totalSales: number
    cashSales: number | null
    digitalSales: number | null
    branchCount: number
    recentSales: number[]
  }>({
    totalSales: 0,
    cashSales: 0,
    digitalSales: 0,
    branchCount: 0,
    recentSales: [] as number[]
  })

  useEffect(() => {
    // all telemetry comes from the admin-gated
    // /api/admin/dashboard bundle (Prisma server-side). The
    // computations below are the page's original ones, unchanged.
    // SEC-06 FIX: admin name comes from the verified session profile,
    // not from localStorage.
    const fetchTelemetry = async () => {
      let data: any = null
      try {
        const res = await fetch('/api/admin/dashboard')
        data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to fetch telemetry')
      } catch (e) {
        console.error('[admin/dashboard] Failed to load telemetry:', e)
        setIsLoading(false)
        return
      }

      if (data.adminName) {
        setAdminName(data.adminName)
      } else {
        try {
          const meRes = await fetch('/api/auth/me')
          const me = await meRes.json()
          if (me?.user?.email) setAdminName(me.user.email.split('@')[0])
          else setAdminName('Chief Officer')
        } catch {
          setAdminName('Chief Officer')
        }
      }

      // Profiles count (users) split by role
      const profiles = data.profiles || null
      if (profiles) {
        setActiveClients(profiles.filter((p: any) => p.role !== 'admin' && p.role !== 'super_admin').length)
        setWorkforceDistribution(prev => ({
          ...prev,
          employees: profiles.filter((p: any) => p.role === 'employee').length,
          partners: profiles.filter((p: any) => p.role === 'partner').length
        }))
      }

      // Branches count
      const branchesCount = data.branchesCount
      if (branchesCount !== null && branchesCount !== undefined) {
        setWorkforceDistribution(prev => ({ ...prev, branches: branchesCount }))
      }

      // Tasks count.
      // C41: the localStorage fallback is GONE — when the database
      // says zero tasks, the dashboard shows zero tasks. Substituting
      // browser-local (possibly demo/stale) data and presenting it
      // identically to live data fabricated headline numbers.
      const loadedTasks = data.tasks || []
      setTaskCompletion({
        completed: loadedTasks.filter((t: any) => t.status === 'completed').length,
        pending: loadedTasks.filter((t: any) => t.status !== 'completed').length
      })

      // Pending KYC count
      if (data.kycCount !== null && data.kycCount !== undefined) setPendingKyc(data.kycCount)

      // Active payout load (pending/processing)
      const activePayments = data.activePayments || []
      setActivePayoutLoad(sumMoney(activePayments.map((p: any) => p.amount)))

      // Total Liquidity Cleared (completed)
      const completedPayments = data.completedPayments || []
      setTotalLiquidityCleared(sumMoney(completedPayments.map((p: any) => p.amount)))

      // Company Expenses (C41: no localStorage fallback — see tasks)
      const loadedExpenses = data.expenses || []
      setTotalExpenses(sumMoney(loadedExpenses.map((e: any) => e.total_amount)))

      // Salary Payments
      const salaries = data.salaries || []
      setTotalSalaries(sumMoney(salaries.map((s: any) => s.amount)))

      // Branch Network Sales Telemetry
      try {
        const ledgerSales = data.ledgerSales || []

        if (ledgerSales.length > 0) {
          const cSales = sumMoney(ledgerSales.map((l: any) => l.cash_sales))
          const dSales = sumMoney(ledgerSales.flatMap((l: any) => [l.bkash_sales, l.nagad_sales, l.rocket_sales, l.card_sales, l.bank_transfer_sales]))
          const bSet = new Set(ledgerSales.map((l: any) => l.branch_id)).size
          setBranchSalesSummary({
            totalSales: cSales + dSales,
            cashSales: cSales,
            digitalSales: dSales,
            branchCount: bSet,
            recentSales: ledgerSales.slice(-6).map((l: any) => Number(l.cash_sales || 0))
          })
        } else {
          // C39: the fallback used to INVENT a 70/30 cash/digital
          // split of the stored-report total and present it as real.
          // Stored reports carry totals only — show the total and
          // mark the split as unavailable instead of fabricating it.
          const finReports = data.finReports || []
          if (finReports.length > 0) {
            const tot = sumMoney(finReports.map((r: any) => r.amount))
            const bSet = new Set(finReports.map((r: any) => r.branch_id)).size
            setBranchSalesSummary({
              totalSales: tot,
              cashSales: null,
              digitalSales: null,
              branchCount: bSet,
              recentSales: finReports.slice(-6).map((r: any) => Number(r.amount || 0))
            })
          }
        }
      } catch (e) {
        console.error('Failed to fetch branch sales telemetry:', e)
      }

      // Generate Master Chart Data (chronologically)
      const dailyMap: Record<string, { payouts: number, salaries: number, expenses: number }> = {}

      // C42: chart day buckets are DHAKA calendar days — UTC keys
      // pushed everything from 00:00–05:59 Dhaka into the previous
      // day's bar.
      const dhakaKey = (value: any): string | null => {
        const d = new Date(value)
        return isNaN(d.getTime()) ? null : dhakaDateOf(d)
      }
      completedPayments.forEach((t: any) => {
        const key = dhakaKey(t.created_at)
        if (!key) return
        if (!dailyMap[key]) dailyMap[key] = { payouts: 0, salaries: 0, expenses: 0 }
        dailyMap[key].payouts += Number(t.amount)
      })
      salaries.forEach((s: any) => {
        const key = dhakaKey(s.payment_date)
        if (!key) return
        if (!dailyMap[key]) dailyMap[key] = { payouts: 0, salaries: 0, expenses: 0 }
        dailyMap[key].salaries += Number(s.amount)
      })
      loadedExpenses.forEach((e: any) => {
        const key = dhakaKey(e.created_at)
        if (!key) return
        if (!dailyMap[key]) dailyMap[key] = { payouts: 0, salaries: 0, expenses: 0 }
        dailyMap[key].expenses += Number(e.total_amount)
      })

      const chartArr = Object.entries(dailyMap)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, data]) => {
          const date = new Date(`${key}T12:00:00.000Z`)
          const name = date.toLocaleDateString('default', { month: 'short', day: 'numeric' })
          return { name, ...data }
        })
      setTelemetryData(chartArr)

      // Fraud alerts
      const fraudData = data.fraudData
      if (fraudData) {
        const mappedFraud = fraudData.map((f: any) => ({
          id: f.id,
          riskScore: 'CRITICAL',
          time: new Date(f.created_at).toLocaleString(),
          user: f.profiles?.full_name || 'Unknown',
          reason: `Flagged invoice: ${f.invoice_title}`
        }))
        setFraudAlerts(mappedFraud)
      }

      // Activity logs
      const auditLogs = data.auditLogs
      if (auditLogs) {
        const mappedLogs = auditLogs.map((a: any) => ({
          id: a.id,
          admin: a.profiles?.full_name || 'System Auto',
          action: a.action,
          target: a.details?.target || 'System Operation',
          ip: a.ip_address || 'Internal/Secure',
          time: a.created_at
        }))
        setLogs(mappedLogs)
      }
      setIsLoading(false)
    }

    fetchTelemetry()
  }, [])

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans">

      {/* Dynamic Red and Amber Glows for Admin Risks */}
      <div className="absolute top-[-10%] right-[-5%] w-[45%] h-[45%] bg-rose-500/3 rounded-full filter blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[20%] w-[50%] h-[50%] bg-[#1ca34c]/3 rounded-full filter blur-[150px] pointer-events-none" />

      {/* Admin Floating Sidebar */}

      {/* Main Core Dashboard panel */}
      <div className="flex-1 flex flex-col p-6 overflow-y-auto max-h-screen relative z-10">

        {/* UPPER STATUS BAR */}
        <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-900/5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] bg-rose-500/10 text-rose-600 border border-rose-500/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                <Terminal className="w-3.5 h-3.5" />
                Security Core Active
              </span>
            </div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 font-serif flex items-center gap-3">
              <span className="w-1.5 h-8 rounded-full bg-[#1ca34c] shrink-0" />
              Operations Control: <span className="premium-text-gradient">{adminName}</span>
            </h2>
            <p className="text-[11px] text-slate-500">Enterprise security status cleared. Realtime telemetry logs streaming.</p>
          </div>
        </div>

        {/* F5: loading skeletons (light + gold) until telemetry has
            loaded — no 0 / ৳0 / "0.00 BDT" / empty-state flashes. */}
        {isLoading ? (
          <div aria-busy="true" aria-label="Loading dashboard telemetry">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                <div key={i} className="glass-panel p-5 rounded-2xl h-[155px] animate-pulse">
                  <div className="h-2.5 w-28 rounded bg-[#1ca34c]/25 mb-3" />
                  <div className="h-7 w-40 rounded bg-slate-900/10 mb-4" />
                  <div className="h-2.5 w-32 rounded bg-slate-900/[0.07]" />
                </div>
              ))}
            </div>
            <div className="glass-panel p-6 rounded-2xl h-[320px] animate-pulse">
              <div className="h-2.5 w-36 rounded bg-[#1ca34c]/25 mb-3" />
              <div className="h-4 w-48 rounded bg-slate-900/10 mb-6" />
              <div className="h-[220px] rounded-xl bg-slate-900/[0.04]" />
            </div>
          </div>
        ) : (
        <>
        {/* 9 ADMIN TELEMETRY STATIONS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
          <Link href="/admin/users" className="block">
            <StatsCard
              title="Total Active Clients"
              value={`${activeClients}`}
              subtext="Enrolled verified accounts"
              icon={Users}
              sparklineColor="gold"
              sparklineData={telemetryData.map(d => d.payouts)}
              trend={{ value: 'Live data', isPositive: true }}
            />
          </Link>
          <Link href="/admin/branch-financial-reports" className="block">
            <StatsCard
              title="Total Branch Network Sales"
              value={`৳ ${branchSalesSummary.totalSales.toLocaleString('en-BD')}`}
              subtext={branchSalesSummary.cashSales === null || branchSalesSummary.digitalSales === null
                ? 'From stored monthly reports — cash/digital split unavailable'
                : `Cash: ৳${branchSalesSummary.cashSales.toLocaleString('en-BD')} | Digital: ৳${branchSalesSummary.digitalSales.toLocaleString('en-BD')}`}
              icon={Store}
              sparklineColor="emerald"
              sparklineData={branchSalesSummary.recentSales.length > 0 ? branchSalesSummary.recentSales : [activeClients]}
              trend={{ value: `${branchSalesSummary.branchCount} Active Branches`, isPositive: true }}
            />
          </Link>
          <Link href="/admin/users" className="block">
            <StatsCard
              title="Workforce & Branches"
              value={`${workforceDistribution.employees} Employee`}
              subtext={`${workforceDistribution.partners} Partners | ${workforceDistribution.branches} Branches`}
              icon={Building2}
              sparklineColor="blue"
              sparklineData={telemetryData.map(d => d.salaries)}
            />
          </Link>
          <Link href="/admin/tasks" className="block">
            <StatsCard
              title="Task Completion Rate"
              value={`${taskCompletion.completed} Complete`}
              subtext={`${taskCompletion.pending} Pending tasks`}
              icon={Activity}
              sparklineColor="emerald"
              sparklineData={[1, 2, 3, taskCompletion.completed]}
              trend={{ value: 'Operations', isPositive: taskCompletion.pending === 0 }}
            />
          </Link>
          <Link href="/admin/kyc" className="block">
            <StatsCard
              title="Pending KYC Files"
              value={`${pendingKyc}`}
              subtext="Biometric matching queue"
              icon={ShieldAlert}
              sparklineColor="rose"
              sparklineData={[pendingKyc]}
              trend={{ value: pendingKyc > 0 ? 'Priority Action' : 'All clear', isPositive: pendingKyc === 0 }}
            />
          </Link>
          <Link href="/admin/payments" className="block">
            <StatsCard
              title="Active Payout Load"
              value={`৳ ${activePayoutLoad.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
              subtext="Clearing through gateways"
              icon={Wallet}
              sparklineColor="gold"
              sparklineData={telemetryData.map(d => d.payouts)}
            />
          </Link>
          <Link href="/admin/payments" className="block">
            <StatsCard
              title="Total Liquidity Cleared"
              value={`৳ ${totalLiquidityCleared.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
              subtext="Settled partner payouts"
              icon={Landmark}
              sparklineColor="emerald"
              sparklineData={telemetryData.map(d => d.payouts)}
            />
          </Link>
          <Link href="/admin/salaries" className="block">
            <StatsCard
              title="Total Salary Payroll"
              value={`৳ ${totalSalaries.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
              subtext="All-time total disbursed to employees"
              icon={Banknote}
              sparklineColor="blue"
              sparklineData={telemetryData.map(d => d.salaries)}
            />
          </Link>
          <Link href="/admin/branch-expenses" className="block">
            <StatsCard
              title="Total OpEx (Expenses)"
              value={`৳ ${totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
              subtext="All-time logged company expenses (gross, incl. unpaid portion)"
              icon={Receipt}
              sparklineColor="rose"
              sparklineData={telemetryData.map(d => d.expenses)}
            />
          </Link>
        </div>

        {/* EXECUTIVE BRANCH ACCOUNTS & FINANCIAL SHORTCUT STRIP */}
        <div className="mb-8 p-4 rounded-3xl border border-slate-900/10 bg-slate-900/[0.04] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1ca34c]/10 border border-[#1ca34c]/20 flex items-center justify-center text-[#15803d] flex-shrink-0">
              <Store className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Branch Financial Intelligence & Performance</h4>
              <p className="text-[11px] text-slate-500">Review branch daily closings, verified monthly revenue & performance audits</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/admin/branch-accounts"
              className="px-3.5 py-1.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#1ca34c]/30 text-slate-600 hover:text-slate-900 text-xs font-semibold flex items-center gap-1.5 transition-all"
            >
              Daily Closings
            </Link>
            <Link
              href="/admin/branch-financial-reports"
              className="px-3.5 py-1.5 rounded-xl bg-[#1ca34c]/10 border border-[#1ca34c]/30 text-[#15803d] hover:bg-[#1ca34c]/20 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
            >
              Financial Reports
            </Link>
            <Link
              href="/admin/branch-performance"
              className="px-3.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/20 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
            >
              Branch Performance
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-8 items-start">

          {/* SYSTEM LOADS CHART */}
          <div className="lg:col-span-8 glass-panel p-6 rounded-2xl relative shadow-xl">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-rose-500/20 to-transparent" />

            <div className="flex justify-between items-center mb-6">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Financial Master Ledger</span>
                <h3 className="text-sm font-bold text-slate-900 font-serif">Outflow Analytics (BDT)</h3>
              </div>
            </div>

            <div className="h-[260px] w-full">
              {telemetryData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  {/* F8c: left margin was -20 with an auto-width YAxis, so
                      the y-axis tick labels were clipped off the left edge.
                      Give the chart a real left margin, fix the axis width,
                      and format ticks compactly so labels render fully. */}
                  <ComposedChart data={telemetryData} margin={{ top: 10, right: 10, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,18,25,0.08)" vertical={false} />
                    <XAxis dataKey="name" stroke="rgba(15,18,25,0.45)" fontSize={10} tickLine={false} />
                    <YAxis width={56} stroke="rgba(15,18,25,0.45)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v: number) => `৳${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#ffffff', borderColor: 'rgba(15,18,25,0.1)', borderRadius: '12px', fontSize: '11px', color: '#17181c' }}
                    />
                    <Area type="monotone" dataKey="expenses" fill="rgba(244,63,94,0.1)" stroke="#f43f5e" />
                    <Bar dataKey="payouts" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} maxBarSize={32} />
                    <Bar dataKey="salaries" stackId="a" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={32} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-600 text-xs italic">
                  No telemetry data available yet.
                </div>
              )}
            </div>
          </div>

          {/* FRAUD GEOLOCATION TELEMETRY & ALERTS */}
          <div className="lg:col-span-4 glass-panel p-6 rounded-2xl relative shadow-xl space-y-6">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#1ca34c]/20 to-transparent" />

            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Biometric Core Alerts</span>
              <h3 className="text-sm font-bold text-slate-900 font-serif">Anchor ERP AI Fraud Patrol</h3>
            </div>

            <div className="space-y-4">
              {fraudAlerts.map((alert: any) => (
                <div key={alert.id} className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/10 space-y-2.5 relative overflow-hidden group">
                  <div className="absolute -top-10 -right-10 w-20 h-20 bg-rose-500/5 rounded-full filter blur-xl group-hover:bg-rose-500/10 transition-all" />

                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Risk Level {alert.riskScore}
                    </span>
                    <span className="text-[9px] text-slate-500">{alert.time}</span>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Client Node anomaly: {alert.user}</h4>
                    <p className="text-[10px] text-slate-500 mt-1 font-sans">{alert.reason}</p>
                  </div>
                </div>
              ))}

              {fraudAlerts.length === 0 && (
                <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-center">
                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">No anomalies detected</span>
                  <span className="text-[9px] text-slate-500">System is secure.</span>
                </div>
              )}
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 flex gap-3.5 items-center">
              <Compass className="w-6 h-6 text-[#15803d]" />
              <div>
                <h4 className="text-[10px] font-bold uppercase text-slate-900 tracking-wider">Gateway Proxy Patrol</h4>
                <p className="text-[9px] text-slate-500 font-sans">Active SSL certificates & JWT keys matching with 100% security assurance.</p>
              </div>
            </div>

          </div>

        </div>

        {/* SYSTEM AUDIT LEDGER */}
        <div className="glass-panel p-6 rounded-2xl shadow-xl">
          <div className="flex justify-between items-center mb-6">
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Administrative Footprints</span>
              <h3 className="text-sm font-bold text-slate-900 font-serif">Secured Operations Ledger</h3>
            </div>
          </div>

          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-900/5 text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="pb-3 pl-2">Executive Admin</th>
                  <th className="pb-3">Action Enforced</th>
                  <th className="pb-3">Affected Dossier</th>
                  <th className="pb-3">Target IP Location</th>
                  <th className="pb-3 text-right pr-2">Execution Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/[0.08]">
                {logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-slate-900/[0.04] transition-colors">
                    <td className="py-3.5 pl-2 font-semibold text-slate-900">{log.admin}</td>
                    <td className="py-3.5 text-slate-600 font-medium">{log.action}</td>
                    <td className="py-3.5 font-bold text-[#15803d]">{log.target}</td>
                    <td className="py-3.5 font-mono text-slate-500 text-[10px]">{log.ip}</td>
                    <td className="py-3.5 text-right text-slate-500 text-[10px] pr-2">
                      {new Date(log.time).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}

                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 text-xs italic">
                      No recent administrative footprints.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}

      </div>

    </div>
  )
}
