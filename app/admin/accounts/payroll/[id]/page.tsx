'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Wallet, RefreshCw, Plus, Trash2, Pencil, Landmark, AlertTriangle, Send, CheckCheck, Play, Ban } from 'lucide-react'
import PaymentAccountCard, { type PaymentAccountField } from '@/components/PaymentAccountCard'
import { salaryAccountFields } from '@/app/admin/salaries/IssueSalaryModal'

// Accounts A6 — one payroll run: lines, lifecycle, disbursement.
// Data: GET /api/accounts/payroll/[id]; actions POST to the same
// route. Disbursement ("Issue run") creates salary payments via
// the ONE shared salary service — the same function behind the
// Issue Salary modal — and each payment journals automatically.

type Line = {
  id: string
  user_id: string | null
  employee_name: string | null
  branch_id: string | null
  origin: string
  status: string | null
  basic: string
  allowances: string
  overtime: string
  bonus: string
  commission: string
  tiffin: string
  gross_salary: string
  deductions: string | null
  deduction_breakdown: Array<{ label: string; amount: number }> | null
  net_payable: string
  total_payable_days: string
  salary_payment_id: string | null
  employee: { id: string; full_name: string; branch_id: string | null; bank_info: any } | null
  salary_accounts: Array<{ bank_name: string; account_name: string; account_number: string; routing_number: string | null; is_active: boolean | null }>
  payment: { id: string; status: string; transaction_id: string | null; payment_date: string } | null
}

type Run = {
  id: string
  month: string
  status: string
  total_gross: string
  total_deductions: string
  total_net: string
  notes: string | null
  period_status: string | null
  blocking: boolean
  void_reason: string | null
  approved_at: string | null
  issued_at: string | null
}

const taka = (v: string | number | null | undefined) => `৳${Number(v ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  in_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-sky-100 text-sky-800',
  issued: 'bg-emerald-100 text-emerald-800',
  voided: 'bg-rose-100 text-rose-700',
  paid: 'bg-emerald-100 text-emerald-800',
}

// Payee card fields for a line: the employee's recorded salary
// account (employee_salary_accounts) wins; otherwise the profile
// bank_info mapping the Issue Salary modal uses.
function lineAccountFields(line: Line): PaymentAccountField[] {
  const acct = line.salary_accounts?.find((a) => a.is_active !== false) || line.salary_accounts?.[0]
  if (acct) {
    return [
      { label: 'Account Holder Name', value: acct.account_name },
      { label: 'Bank Name', value: acct.bank_name },
      { label: 'Account Number', value: acct.account_number },
      { label: 'Routing Number', value: acct.routing_number },
    ]
  }
  return salaryAccountFields(line.employee || {})
}

const EMPTY_FORM = {
  employee_id: '', branch_id: '', basic: '', allowances: '', overtime: '',
  bonus: '', commission: '', tiffin: '', deductions: '', deduction_label: '', total_payable_days: '',
}

export default function PayrollRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [runId, setRunId] = useState<string>('')
  const [run, setRun] = useState<Run | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [settingsCount, setSettingsCount] = useState(0)
  const [employees, setEmployees] = useState<any[]>([])
  const [branches, setBranches] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [cardFor, setCardFor] = useState<string | null>(null)

  useEffect(() => { params.then((p) => setRunId(p.id)) }, [params])

  const applyDetail = useCallback((json: any) => {
    if (json.run) setRun(json.run)
    if (json.lines) setLines(json.lines)
    if (json.suggestions) setSuggestions(json.suggestions)
    if (json.salary_settings_count !== undefined) setSettingsCount(json.salary_settings_count)
  }, [])

  const load = useCallback(async () => {
    if (!runId) return
    setLoading(true)
    setError(null)
    try {
      const [detailRes, listRes] = await Promise.all([
        fetch(`/api/accounts/payroll/${runId}`),
        fetch('/api/accounts/payroll'),
      ])
      const detail = await detailRes.json()
      if (!detailRes.ok) throw new Error(detail.error || 'Failed to load run')
      applyDetail(detail)
      const list = await listRes.json()
      if (listRes.ok) {
        setEmployees(list.employees || [])
        setBranches(list.branches || [])
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load run')
    } finally {
      setLoading(false)
    }
  }, [runId, applyDetail])

  useEffect(() => { load() }, [load])

  const act = async (payload: any): Promise<any> => {
    setBusy(true)
    setActionMsg(null)
    setError(null)
    try {
      const res = await fetch(`/api/accounts/payroll/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Action failed')
      if (json.detail) applyDetail(json.detail)
      return json
    } catch (e: any) {
      setError(e?.message || 'Action failed')
      return null
    } finally {
      setBusy(false)
    }
  }

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === form.employee_id) || null,
    [employees, form.employee_id]
  )

  const submitLine = async () => {
    const line: any = {
      employee_id: form.employee_id,
      branch_id: form.branch_id || undefined,
      basic: form.basic || 0,
      allowances: form.allowances || 0,
      overtime: form.overtime || 0,
      bonus: form.bonus || 0,
      commission: form.commission || 0,
      tiffin: form.tiffin || 0,
      deductions: form.deductions || 0,
      total_payable_days: form.total_payable_days || 0,
    }
    if (form.deduction_label.trim() && Number(form.deductions || 0) > 0) {
      line.deduction_breakdown = [{ label: form.deduction_label.trim(), amount: Number(form.deductions) }]
    }
    const json = editingId
      ? await act({ action: 'update_line', line_id: editingId, line })
      : await act({ action: 'add_line', line })
    if (json) {
      setForm({ ...EMPTY_FORM })
      setEditingId(null)
      setActionMsg(editingId ? 'Line updated.' : 'Line added.')
    }
  }

  const startEdit = (line: Line) => {
    setEditingId(line.id)
    setForm({
      employee_id: line.user_id || '',
      branch_id: line.branch_id || '',
      basic: String(Number(line.basic)),
      allowances: String(Number(line.allowances)),
      overtime: String(Number(line.overtime)),
      bonus: String(Number(line.bonus)),
      commission: String(Number(line.commission)),
      tiffin: String(Number(line.tiffin)),
      deductions: String(Number(line.deductions || 0)),
      deduction_label: line.deduction_breakdown?.[0]?.label || '',
      total_payable_days: String(Number(line.total_payable_days)),
    })
  }

  const issue = async () => {
    const json = await act({ action: 'issue' })
    if (json) {
      const parts = [`Issued ${json.issued?.length ?? 0} payment(s).`]
      if (json.failures?.length) parts.push(`${json.failures.length} line(s) failed — see the run and retry.`)
      if (json.period_missing) parts.push('Note: this month has no seeded accounting period.')
      setActionMsg(parts.join(' '))
    }
  }

  const runLines = lines.filter((l) => l.origin === 'run')
  const reviewLines = lines.filter((l) => l.origin === 'existing_payment')
  const isDraft = run?.status === 'draft'

  const numInput = (key: keyof typeof EMPTY_FORM, label: string) => (
    <label className="block">
      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
      />
    </label>
  )

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <Link href="/admin/accounts/payroll" className="text-sm font-semibold text-emerald-700 hover:underline">← Payroll runs</Link>
      <div className="flex flex-wrap items-center justify-between gap-4 mt-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Wallet className="w-6 h-6 text-emerald-600" /> Payroll — {run?.month ?? '…'}
          </h1>
          {run && (
            <p className="text-sm text-slate-500 mt-1">
              Status{' '}
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_STYLE[run.status] || ''}`}>
                {run.status.replace('_', ' ')}
              </span>{' '}
              · accounting period: {run.period_status ?? 'not seeded'}
              {run.blocking && ' · this run holds the month (live payments)'}
            </p>
          )}
          {run?.status === 'voided' && run.void_reason && (
            <p className="text-sm text-rose-700 mt-1">Voided: {run.void_reason}</p>
          )}
          {run?.notes && <p className="text-sm text-slate-500 mt-1">{run.notes}</p>}
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}
      {actionMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4 text-sm text-emerald-800">{actionMsg}</div>}
      {loading && !run && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading run…</div>}

      {run && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-700">Gross (run lines)</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{taka(run.total_gross)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-700">Deductions</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{taka(run.total_deductions)}</div>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="text-sm font-semibold text-slate-700">Net payable</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{taka(run.total_net)}</div>
              <div className="mt-1 text-xs text-slate-500">{runLines.length} run line(s) · {reviewLines.length} already-issued payment(s) under review</div>
            </div>
          </div>

          {/* Lifecycle actions */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
            <h2 className="text-sm font-bold text-slate-900 mb-3">Lifecycle</h2>
            <div className="flex flex-wrap items-center gap-3">
              {run.status === 'draft' && (
                <button disabled={busy} onClick={() => act({ action: 'submit_review' }).then((j) => j && setActionMsg('Submitted for review. Lines are now frozen.'))}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50">
                  <Send className="w-4 h-4" /> Submit for review
                </button>
              )}
              {run.status === 'in_review' && (
                <button disabled={busy} onClick={() => act({ action: 'approve' }).then((j) => j && setActionMsg('Approved. Unpaid lines now show as Salary Payable in Payables & Ageing.'))}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50">
                  <CheckCheck className="w-4 h-4" /> Approve run
                </button>
              )}
              {run.status === 'approved' && (
                <button disabled={busy} onClick={issue}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                  <Play className="w-4 h-4" /> Issue run (create salary payments)
                </button>
              )}
              {run.status === 'issued' && (
                <p className="text-sm text-slate-600">
                  Issued{run.issued_at ? ` on ${new Date(run.issued_at).toLocaleString('en-BD')}` : ''}. To correct a payment,
                  void it from <strong>Salary Payments</strong> — the void reflects back onto its line here automatically.
                </p>
              )}
              {run.status !== 'issued' && run.status !== 'voided' && (
                <span className="inline-flex items-center gap-2 ml-auto">
                  <input
                    type="text"
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="Reason (required to void)"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-56"
                  />
                  <button disabled={busy || !voidReason.trim()} onClick={() => act({ action: 'void_run', reason: voidReason }).then((j) => j && setActionMsg('Run voided.'))}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-rose-300 text-rose-700 text-sm font-semibold hover:bg-rose-50 disabled:opacity-50">
                    <Ban className="w-4 h-4" /> Void run
                  </button>
                </span>
              )}
            </div>
            {run.period_status && run.period_status !== 'open' && run.status === 'approved' && (
              <p className="mt-3 text-sm text-amber-700 flex gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                The accounting period for {run.month} is {run.period_status} — issuing will be refused and recorded
                as a posting exception until the period is reopened.
              </p>
            )}
          </div>

          {/* Suggestions + line form (draft only) */}
          {isDraft && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
              <h2 className="text-sm font-bold text-slate-900 mb-3">{editingId ? 'Edit line' : 'Add a line'}</h2>
              {settingsCount === 0 && !editingId && (
                <p className="text-xs text-slate-500 mb-3">
                  No salary structures are recorded (salary_settings: 0 rows), so there are no suggested
                  lines — enter each line manually. The system invents nothing.
                </p>
              )}
              {suggestions.length > 0 && !editingId && (
                <div className="mb-4 space-y-2">
                  {suggestions.map((s) => (
                    <div key={s.employee_id} className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-sm">
                      <span className="font-semibold text-slate-800">{s.employee_name}</span>
                      <span className="text-slate-500">from salary settings — basic {taka(s.basic)} · allowances {taka(s.allowances)}</span>
                      <button
                        className="ml-auto text-emerald-700 font-semibold hover:underline"
                        onClick={() => setForm({
                          ...EMPTY_FORM,
                          employee_id: s.employee_id,
                          branch_id: s.branch_id || '',
                          basic: String(s.basic),
                          allowances: String(s.allowances),
                        })}
                      >
                        Use as line →
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <label className="block col-span-2">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Employee</span>
                  <select
                    value={form.employee_id}
                    disabled={!!editingId}
                    onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Select employee…</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>{e.full_name}</option>
                    ))}
                  </select>
                </label>
                <label className="block col-span-2">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Branch (funding)</span>
                  <select
                    value={form.branch_id}
                    onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Employee&apos;s branch / none</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </label>
                {numInput('basic', 'Basic')}
                {numInput('allowances', 'Allowances')}
                {numInput('overtime', 'Overtime')}
                {numInput('bonus', 'Bonus')}
                {numInput('commission', 'Commission')}
                {numInput('tiffin', 'Tiffin')}
                {numInput('deductions', 'Deductions')}
                {numInput('total_payable_days', 'Payable days')}
                <label className="block col-span-2">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Deduction label (e.g. Advance recovery)</span>
                  <input
                    type="text"
                    value={form.deduction_label}
                    onChange={(e) => setForm({ ...form, deduction_label: e.target.value })}
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
              {selectedEmployee && (
                <div className="max-w-md">
                  <PaymentAccountCard title={`Payment Account — ${selectedEmployee.full_name}`} fields={salaryAccountFields(selectedEmployee)} />
                </div>
              )}
              <div className="mt-4 flex gap-3">
                <button disabled={busy || !form.employee_id} onClick={submitLine}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                  <Plus className="w-4 h-4" /> {editingId ? 'Save line' : 'Add line'}
                </button>
                {editingId && (
                  <button disabled={busy} onClick={() => { setEditingId(null); setForm({ ...EMPTY_FORM }) }}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    Cancel edit
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Run lines */}
          <h2 className="text-lg font-bold text-slate-900 mb-3">Run lines</h2>
          <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white mb-6">
            <table className="w-full text-sm min-w-[980px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold text-right">Basic</th>
                  <th className="px-4 py-3 font-semibold text-right">Allow.</th>
                  <th className="px-4 py-3 font-semibold text-right">OT</th>
                  <th className="px-4 py-3 font-semibold text-right">Bonus</th>
                  <th className="px-4 py-3 font-semibold text-right">Comm.</th>
                  <th className="px-4 py-3 font-semibold text-right">Tiffin</th>
                  <th className="px-4 py-3 font-semibold text-right">Deduct.</th>
                  <th className="px-4 py-3 font-semibold text-right">Net</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {runLines.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-6 text-sm text-slate-500">No run lines yet{isDraft ? ' — add the first one above.' : '.'}</td></tr>
                )}
                {runLines.map((l) => (
                  <React.Fragment key={l.id}>
                    <tr className="border-b border-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{l.employee_name || l.employee?.full_name || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{taka(l.basic)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{taka(l.allowances)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{taka(l.overtime)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{taka(l.bonus)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{taka(l.commission)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{taka(l.tiffin)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {taka(l.deductions)}
                        {l.deduction_breakdown?.length ? (
                          <div className="text-[11px] text-slate-400">{l.deduction_breakdown.map((d) => `${d.label} ${taka(d.amount)}`).join(' · ')}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{taka(l.net_payable)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_STYLE[l.status || 'draft'] || 'bg-slate-100 text-slate-700'}`}>
                          {l.status || 'draft'}
                        </span>
                        {l.payment && (
                          <div className="text-[11px] text-slate-400 mt-1">
                            {l.payment.transaction_id || l.payment.id.slice(0, 8)} · {l.payment.status}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => setCardFor(cardFor === l.id ? null : l.id)} title="Payment account"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-emerald-700 mr-2">
                          <Landmark className="w-3.5 h-3.5" /> Account
                        </button>
                        {isDraft && (
                          <>
                            <button onClick={() => startEdit(l)} title="Edit line" className="inline-flex text-slate-500 hover:text-emerald-700 mr-2">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => act({ action: 'delete_line', line_id: l.id })} title="Delete line" className="inline-flex text-slate-500 hover:text-rose-600">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                    {cardFor === l.id && (
                      <tr className="border-b border-slate-50 bg-slate-50/60">
                        <td colSpan={11} className="px-4 py-2">
                          <div className="max-w-md">
                            <PaymentAccountCard title={`Payment Account — ${l.employee_name || 'Employee'}`} fields={lineAccountFields(l)} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Review lines */}
          {reviewLines.length > 0 && (
            <>
              <h2 className="text-lg font-bold text-slate-900 mb-3">Already issued this month (for review — never re-paid)</h2>
              <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white mb-6">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                      <th className="px-4 py-3 font-semibold">Employee</th>
                      <th className="px-4 py-3 font-semibold text-right">Amount</th>
                      <th className="px-4 py-3 font-semibold">Payment</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewLines.map((l) => (
                      <React.Fragment key={l.id}>
                        <tr className="border-b border-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-800">{l.employee_name || '—'}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{taka(l.net_payable)}</td>
                          <td className="px-4 py-3 text-slate-600">{l.payment?.transaction_id || '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_STYLE[l.payment?.status === 'voided' ? 'voided' : 'paid']}`}>
                              {l.payment?.status === 'voided' ? 'payment voided' : (l.status || 'paid')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => setCardFor(cardFor === l.id ? null : l.id)} title="Payment account"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-emerald-700">
                              <Landmark className="w-3.5 h-3.5" /> Account
                            </button>
                          </td>
                        </tr>
                        {cardFor === l.id && (
                          <tr className="border-b border-slate-50 bg-slate-50/60">
                            <td colSpan={5} className="px-4 py-2">
                              <div className="max-w-md">
                                <PaymentAccountCard title={`Payment Account — ${l.employee_name || 'Employee'}`} fields={lineAccountFields(l)} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
