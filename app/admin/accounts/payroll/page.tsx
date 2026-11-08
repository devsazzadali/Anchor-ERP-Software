'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Wallet, RefreshCw, Plus, AlertTriangle, CheckCircle2, Printer, Download } from 'lucide-react'
import { PageHead, PrintHeader, PrintFooter, downloadPdf, bdt } from '../ui'
import { useLanguage } from '@/lib/i18n/provider'

// Accounts A6 — Payroll runs. Data: GET /api/accounts/payroll.
// A run drafts the month's already-issued payments for review and
// takes manually-added lines (salary_settings is empty today —
// the notice below says so plainly; nothing is auto-invented).
// Disbursement happens from the run detail, through the ONE
// shared salary service the Issue Salary modal uses.

type RunRow = {
  id: string
  month: string
  status: string
  total_gross: string
  total_deductions: string
  total_net: string
  line_count: number
  paid_line_count: number
  review_line_count: number
  period_status: string | null
  blocking: boolean
  void_reason: string | null
  created_at: string
}

const taka = (v: string | number) => `৳${Number(v).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  in_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-sky-100 text-sky-800',
  issued: 'bg-emerald-100 text-emerald-800',
  voided: 'bg-rose-100 text-rose-700',
}

export default function PayrollRunsPage() {
  const { t } = useLanguage()
  const [runs, setRuns] = useState<RunRow[] | null>(null)
  const [settingsCount, setSettingsCount] = useState<number | null>(null)
  const [employees, setEmployees] = useState<Array<{ id: string; full_name: string }>>([])
  const [structures, setStructures] = useState<Array<{ user_id: string; full_name: string | null; gross: string }>>([])
  const [wizard, setWizard] = useState({ user_id: '', basic: '', house_rent: '', medical: '', conveyance: '', overtime_rate: '' })
  const [wizardBusy, setWizardBusy] = useState(false)
  const [wizardError, setWizardError] = useState<string | null>(null)
  const [wizardSaved, setWizardSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [month, setMonth] = useState('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts/payroll')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load payroll runs')
      setRuns(json.runs || [])
      setSettingsCount(json.salary_settings_count ?? 0)
      setEmployees(json.employees || [])
      setStructures(json.structures || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load payroll runs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const wizardGross = [wizard.basic, wizard.house_rent, wizard.medical, wizard.conveyance]
    .reduce((s, v) => s + (Number(v) || 0), 0)

  const saveStructure = async () => {
    setWizardBusy(true)
    setWizardError(null)
    setWizardSaved(false)
    try {
      const res = await fetch('/api/accounts/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_structure',
          user_id: wizard.user_id,
          basic: wizard.basic,
          house_rent: wizard.house_rent,
          medical: wizard.medical,
          conveyance: wizard.conveyance,
          overtime_rate: wizard.overtime_rate,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      setWizardSaved(true)
      setWizard({ user_id: '', basic: '', house_rent: '', medical: '', conveyance: '', overtime_rate: '' })
      await load()
    } catch (e: any) {
      setWizardError(e?.message || 'Save failed')
    } finally {
      setWizardBusy(false)
    }
  }

  const create = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/accounts/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, notes: notes || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create run')
      window.location.href = `/admin/accounts/payroll/${json.run.id}`
    } catch (e: any) {
      setCreateError(e?.message || 'Failed to create run')
    } finally {
      setCreating(false)
    }
  }

  const exportPdf = () =>
    void downloadPdf({
      title: 'Salary Accounts',
      subtitle: 'Payroll',
      columns: ['Month', 'Status', 'Gross', 'Deductions', 'Net'],
      rows: (runs ?? []).map((r) => [
        r.month,
        r.status.replace('_', ' '),
        bdt(r.total_gross),
        bdt(r.total_deductions),
        bdt(r.total_net),
      ]),
      summary: [{ label: 'Payroll Runs', value: String(runs?.length ?? 0) }],
      filename: 'salary-accounts.pdf',
    })

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <PageHead icon={<Wallet className="w-6 h-6 text-emerald-600" />} title={t.accounts.head.payroll.title} bangla={t.accounts.head.payroll.sub} tech={t.accounts.head.payroll.tech} purpose={t.accounts.head.payroll.purpose}>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={exportPdf} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Download className="w-4 h-4" /> PDF
          </button>
        </div>
      </PageHead>
      <p className="text-sm text-slate-500 -mt-4 mb-6">
        The monthly salary cycle — draft a run, review, approve, then disburse through the same
        Issue Salary path the modal uses. One money path, journal-posted automatically.
      </p>

      <div className="accounts-print-area">
      <PrintHeader title="Salary Accounts" subtitle="Payroll" />

      {settingsCount === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-6 text-sm text-amber-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong>No salary structures are recorded.</strong> The salary-settings register
            (<code>salary_settings</code>) currently holds 0 rows, so runs cannot pre-fill lines from
            recorded structures. A new run starts with the month&apos;s already-issued payments for
            review, and each payable line is added manually — the system invents nothing.
          </span>
        </div>
      )}
      {settingsCount !== null && settingsCount > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-6 text-sm text-emerald-800 flex gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{settingsCount} salary structure(s) are recorded — new runs offer them as suggested lines.</span>
        </div>
      )}

      {/* ── Salary setup wizard (Step 5, D3) ─────────────────── */}
      <div className="rounded-2xl border border-emerald-200 bg-white p-5 mb-6">
        <h2 className="text-base font-bold text-slate-900 font-bangla">{t.accounts.payrollWizard.title}</h2>
        {structures.length === 0 && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-800 font-bangla">{t.accounts.payrollWizard.emptyTitle}</div>
            <p className="mt-1 text-sm text-slate-600 font-bangla">{t.accounts.payrollWizard.emptyText}</p>
          </div>
        )}
        {structures.length > 0 && (
          <div className="mt-3 space-y-1">
            {structures.map((s) => (
              <div key={s.user_id} className="flex items-baseline justify-between text-sm border-b border-slate-50 py-1">
                <span className="text-slate-700">{s.full_name ?? s.user_id}</span>
                <span className="font-semibold tabular-nums">{taka(Number(s.gross))}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <div className="text-sm font-semibold text-slate-700 font-bangla">{t.accounts.payrollWizard.stepEmployee}</div>
          <select
            value={wizard.user_id}
            onChange={(e) => setWizard({ ...wizard, user_id: e.target.value })}
            className="mt-1 block w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          <div className="text-sm font-semibold text-slate-700 font-bangla">{t.accounts.payrollWizard.stepComponents}</div>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-3">
            {([
              ['basic', t.accounts.payrollWizard.basic],
              ['house_rent', t.accounts.payrollWizard.houseRent],
              ['medical', t.accounts.payrollWizard.medical],
              ['conveyance', t.accounts.payrollWizard.conveyance],
              ['overtime_rate', t.accounts.payrollWizard.overtimeRate],
            ] as const).map(([key, label]) => (
              <label key={key} className="block">
                <span className="text-xs font-semibold text-slate-500 font-bangla">{label}</span>
                <input
                  type="number" step="0.01" min="0"
                  value={wizard[key]}
                  onChange={(e) => setWizard({ ...wizard, [key]: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="0.00"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-700 font-bangla">{t.accounts.payrollWizard.stepReview}</div>
            <div className="text-sm text-slate-600">
              <span className="font-bangla">{t.accounts.payrollWizard.grossPreview}</span>{' '}
              <span className="text-lg font-bold text-slate-900 tabular-nums">{taka(wizardGross)}</span>
            </div>
          </div>
          <button
            disabled={wizardBusy || !wizard.user_id || !(Number(wizard.basic) > 0)}
            onClick={saveStructure}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 font-bangla"
          >
            {t.accounts.payrollWizard.saveButton}
          </button>
          {wizardSaved && <span className="text-sm font-semibold text-emerald-700 font-bangla">{t.accounts.payrollWizard.savedNotice}</span>}
          {wizardError && <span className="text-sm font-semibold text-rose-700">{wizardError}</span>}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
        <h2 className="text-sm font-bold text-slate-900 mb-3">Start a run</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Month</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block grow min-w-[200px]">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes (optional)</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="e.g. Regular monthly payroll"
            />
          </label>
          <button
            onClick={create}
            disabled={creating || !month}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Create run
          </button>
        </div>
        {createError && <p className="mt-3 text-sm text-rose-700">{createError}</p>}
        <p className="mt-3 text-xs text-slate-500">
          Creating a run drafts the month&apos;s already-issued salary payments into it for review
          (they are never re-paid). A month with a live issued run refuses a second run (409).
        </p>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}
      {loading && !runs && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading runs…</div>}

      {runs && (
        <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3 font-semibold">Month</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Lines</th>
                <th className="px-4 py-3 font-semibold text-right">Gross</th>
                <th className="px-4 py-3 font-semibold text-right">Deductions</th>
                <th className="px-4 py-3 font-semibold text-right">Net</th>
                <th className="px-4 py-3 font-semibold">Period</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-sm text-slate-500">No payroll runs yet — start the first one above.</td></tr>
              )}
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-800">{r.month}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_STYLE[r.status] || 'bg-slate-100 text-slate-700'}`}>
                      {r.status.replace('_', ' ')}
                    </span>
                    {r.blocking && <span className="ml-2 text-xs font-semibold text-emerald-700">live</span>}
                    {r.status === 'voided' && r.void_reason && (
                      <div className="text-xs text-slate-500 mt-1">Voided: {r.void_reason}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.line_count} payable · {r.paid_line_count} paid · {r.review_line_count} review
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{taka(r.total_gross)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{taka(r.total_deductions)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{taka(r.total_net)}</td>
                  <td className="px-4 py-3 text-slate-600">{r.period_status ?? 'not seeded'}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/accounts/payroll/${r.id}`} className="text-sm font-semibold text-emerald-700 hover:underline">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PrintFooter />
      </div>
    </div>
  )
}
