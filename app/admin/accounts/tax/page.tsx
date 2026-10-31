'use client'

import { useCallback, useEffect, useState } from 'react'

// Accounts → VAT & TDS (stage A7).
// Configuration panel for the four tax types + the register
// viewer + the per-period return summary. The system ships
// DORMANT: every type is disabled with no rate, and nothing is
// recorded until the owner/CA enters a rate and enables a type.
// Rates are NEVER suggested or pre-filled by the system.
export const dynamic = 'force-dynamic'

const money = (v: unknown) =>
  `৳${Number(v ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const KIND_LABEL: Record<string, string> = {
  vat_output: 'VAT — output (sales)',
  vat_input: 'VAT — input (purchases)',
  tds_salary: 'TDS — salary',
  tds_payment: 'TDS — payments',
}

interface Setting {
  tax_type: string
  kind: string
  label: string
  blurb: string
  is_enabled: boolean
  rate_percent: string | null
  effective_from: string | null
  payable_account_id: string | null
  payable_code: string
  payable_name: string | null
  offset_account_id: string | null
  offset_code: string | null
  offset_name: string | null
  notes: string | null
  configured: boolean
}

interface Draft {
  rate_percent: string
  effective_from: string
  is_enabled: boolean
  payable_account_id: string
  offset_account_id: string
  notes: string
}

export default function TaxPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [settings, setSettings] = useState<Setting[]>([])
  const [accounts, setAccounts] = useState<any[]>([])
  const [dormant, setDormant] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saving, setSaving] = useState('')
  const [register, setRegister] = useState<any[]>([])
  const [summaries, setSummaries] = useState<any[]>([])
  const [kindFilter, setKindFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams()
      if (kindFilter) qs.set('kind', kindFilter)
      if (periodFilter) qs.set('period', periodFilter)
      const res = await fetch(`/api/accounts/tax${qs.toString() ? `?${qs}` : ''}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load VAT & TDS')
      setSettings(json.settings ?? [])
      setAccounts(json.accounts ?? [])
      setDormant(!!json.dormant)
      setSummaries(json.summaries ?? [])
      setRegister(json.register ?? [])
      const d: Record<string, Draft> = {}
      for (const s of json.settings ?? []) {
        d[s.tax_type] = {
          rate_percent: s.rate_percent ?? '',
          effective_from: s.effective_from ?? '',
          is_enabled: !!s.is_enabled,
          payable_account_id: s.payable_account_id ?? '',
          offset_account_id: s.offset_account_id ?? '',
          notes: s.notes ?? '',
        }
      }
      setDrafts(d)
    } catch (e: any) {
      setError(e?.message || 'Failed to load VAT & TDS')
    } finally {
      setLoading(false)
    }
  }, [kindFilter, periodFilter])

  useEffect(() => {
    load()
  }, [load])

  const save = async (s: Setting) => {
    const d = drafts[s.tax_type]
    if (!d) return
    setSaving(s.tax_type)
    setNotice('')
    setError('')
    try {
      const res = await fetch('/api/accounts/tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_setting',
          tax_type: s.tax_type,
          rate_percent: d.rate_percent === '' ? null : d.rate_percent,
          effective_from: d.effective_from === '' ? null : d.effective_from,
          is_enabled: d.is_enabled,
          payable_account_id: d.payable_account_id === '' ? null : d.payable_account_id,
          offset_account_id: d.offset_account_id === '' ? null : d.offset_account_id,
          notes: d.notes === '' ? null : d.notes,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      setNotice(`${s.label}: settings saved.`)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving('')
    }
  }

  const setDraft = (type: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">VAT &amp; TDS</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tax register for VAT and tax deducted at source. Tax is recorded only for the types you configure
          below — and only on events dated on or after the type&apos;s effective-from date.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      )}

      {dormant && !loading && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="font-semibold text-amber-900">VAT &amp; TDS are not configured — nothing is being recorded.</p>
          <p className="mt-1 text-sm text-amber-800">
            Every tax type below is disabled and has no rate. While it stays this way, sales, expenses, salaries
            and settlements post exactly as before, with no tax entries anywhere. Rates and effective dates are
            entered by the owner together with the company&apos;s tax consultant (CA) — the system never
            suggests or invents a rate. Enable a type only when its rate and start date are confirmed.
          </p>
        </div>
      )}

      {/* ── Configuration ─────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {settings.map((s) => {
          const d = drafts[s.tax_type]
          if (!d) return null
          return (
            <div key={s.tax_type} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{s.label}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{s.blurb}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    s.configured ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {s.configured ? 'Active' : 'Not configured'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Rate % (owner/CA-entered)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 7.5"
                    value={d.rate_percent}
                    onChange={(e) => setDraft(s.tax_type, { rate_percent: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Effective from</span>
                  <input
                    type="date"
                    value={d.effective_from}
                    onChange={(e) => setDraft(s.tax_type, { effective_from: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Tax payable account</span>
                  <select
                    value={d.payable_account_id}
                    onChange={(e) => setDraft(s.tax_type, { payable_account_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="">Default — {s.payable_code}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Offset account</span>
                  <select
                    value={d.offset_account_id}
                    onChange={(e) => setDraft(s.tax_type, { offset_account_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="">
                      {s.tax_type === 'VAT_OUTPUT'
                        ? `Default — ${s.offset_code ?? '—'} (sales revenue)`
                        : s.tax_type === 'VAT_INPUT'
                          ? 'The expense’s own account'
                          : 'Not applicable'}
                    </option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="col-span-2 block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Notes (e.g. CA reference)</span>
                  <input
                    type="text"
                    value={d.notes}
                    onChange={(e) => setDraft(s.tax_type, { notes: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={d.is_enabled}
                    onChange={(e) => setDraft(s.tax_type, { is_enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Enabled
                </label>
                <button
                  onClick={() => save(s)}
                  disabled={saving === s.tax_type}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving === s.tax_type ? 'Saving…' : 'Save'}
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Currently linked: payable {s.payable_code}
                {s.payable_name ? ` (${s.payable_name})` : ''}
                {s.offset_code ? ` · offset ${s.offset_code}${s.offset_name ? ` (${s.offset_name})` : ''}` : ''}. Enabling
                requires a rate above 0 and an effective-from date.
              </p>
            </div>
          )
        })}
      </div>

      {/* ── Per-period summary (return view) ──────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">Per-period summary</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Output VAT − input VAT = net VAT payable for the period; TDS totals alongside. These summaries are
          register reports for preparing a return — there is no filing integration; filing is done with the CA.
        </p>
        {summaries.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No tax recorded yet — the register is empty.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3 text-right">VAT output</th>
                  <th className="py-2 pr-3 text-right">VAT input</th>
                  <th className="py-2 pr-3 text-right">Net VAT payable</th>
                  <th className="py-2 pr-3 text-right">TDS — salary</th>
                  <th className="py-2 pr-3 text-right">TDS — payments</th>
                  <th className="py-2 text-right">Total TDS</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((r) => (
                  <tr key={r.period} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-medium">{r.period}</td>
                    <td className="py-2 pr-3 text-right">{money(r.vat_output)}</td>
                    <td className="py-2 pr-3 text-right">{money(r.vat_input)}</td>
                    <td className="py-2 pr-3 text-right font-medium">{money(r.net_vat_payable)}</td>
                    <td className="py-2 pr-3 text-right">{money(r.tds_salary)}</td>
                    <td className="py-2 pr-3 text-right">{money(r.tds_payment)}</td>
                    <td className="py-2 text-right">{money(r.tds_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Register ──────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-900">Tax register</h2>
          <div className="flex gap-2">
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All types</option>
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              type="month"
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading…</p>
        ) : register.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No register lines match.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3 text-right">Base</th>
                  <th className="py-2 pr-3 text-right">Rate %</th>
                  <th className="py-2 pr-3 text-right">Tax</th>
                  <th className="py-2 pr-3">Counterparty</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {register.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3">{r.period}</td>
                    <td className="py-2 pr-3">{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">
                      {r.source_table}
                      <br />
                      <span className="text-slate-400">{String(r.source_id).slice(0, 8)}…</span>
                    </td>
                    <td className="py-2 pr-3 text-right">{money(r.base_amount)}</td>
                    <td className="py-2 pr-3 text-right">{Number(r.rate).toFixed(2)}</td>
                    <td className="py-2 pr-3 text-right font-medium">{money(r.tax_amount)}</td>
                    <td className="py-2 pr-3">{r.counterparty_name ?? '—'}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          r.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
