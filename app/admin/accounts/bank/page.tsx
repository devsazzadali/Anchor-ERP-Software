'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Landmark, RefreshCw, Plus, Pencil, CheckCircle2, AlertTriangle } from 'lucide-react'
import { PageHead } from '../ui'

// Accounts A4 — Bank Reconciliation register. Data: GET
// /api/accounts/bank (one summary row per bank account: journal /
// book balance, statement balance + its basis, difference and the
// statement-line match counts). Actions POST to the same route:
// create / update / confirm_opening. Reconciliation NEVER writes
// journal entries — it only compares the statement against them.

type StatementBasis = 'last_line_balance' | 'opening_plus_lines' | 'lines_sum' | null

type BankAccount = {
  id: string
  label: string
  bank_name: string
  account_name: string
  account_number: string | null
  account_type: string
  chart_account_id: string | null
  chart_code: string | null
  opening_balance: string | null
  opening_balance_date: string | null
  derived_hint: string | null
  is_draft: boolean
  is_active: boolean
  journal_balance: string
  statement_line_count: number
  matched_line_count: number
  unmatched_line_count: number
  statement_balance: string | null
  statement_balance_basis: StatementBasis
  difference: string | null
}

type Payload = { accounts: BankAccount[] }

const ACCOUNT_TYPES = ['bank', 'mfs', 'cash-office']

const BASIS_LABEL: Record<string, string> = {
  last_line_balance: 'Basis: last statement line balance',
  opening_plus_lines: 'Basis: opening balance + statement lines',
  lines_sum: 'Basis: sum of statement lines',
}

const taka = (v: string | number) => `৳${Number(v).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const takaOrDash = (v: string | number | null | undefined) => (v == null || v === '' ? '—' : taka(v))

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'

export default function BankReconciliationPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ bank_name: '', account_name: '', account_number: '', account_type: 'bank', label: '' })

  const [editing, setEditing] = useState<BankAccount | null>(null)
  const [editForm, setEditForm] = useState({ label: '', bank_name: '', account_name: '', account_number: '', account_type: 'bank', is_active: true })

  const [openingForms, setOpeningForms] = useState<Record<string, { opening_balance: string; opening_balance_date: string }>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts/bank')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load bank accounts')
      setData(json)
    } catch (e: any) {
      setError(e?.message || 'Failed to load bank accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (body: Record<string, unknown>, okMessage: string, busyKey: string) => {
    setBusy(busyKey)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/accounts/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Action failed')
      setNotice(okMessage)
      setEditing(null)
      setShowCreate(false)
      await load()
      return json
    } catch (e: any) {
      setError(e?.message || 'Action failed')
      return null
    } finally {
      setBusy(null)
    }
  }

  const submitCreate = async () => {
    await act(
      {
        action: 'create',
        bank_name: createForm.bank_name,
        account_name: createForm.account_name,
        ...(createForm.account_number.trim() ? { account_number: createForm.account_number.trim() } : {}),
        account_type: createForm.account_type,
        ...(createForm.label.trim() ? { label: createForm.label.trim() } : {}),
      },
      'Bank account created.',
      'create',
    ).then((json) => {
      if (json) setCreateForm({ bank_name: '', account_name: '', account_number: '', account_type: 'bank', label: '' })
    })
  }

  const openEdit = (a: BankAccount) => {
    setEditing(a)
    setEditForm({
      label: a.label ?? '',
      bank_name: a.bank_name ?? '',
      account_name: a.account_name ?? '',
      account_number: a.account_number ?? '',
      account_type: a.account_type ?? 'bank',
      is_active: a.is_active,
    })
  }

  const submitEdit = async () => {
    if (!editing) return
    await act(
      {
        action: 'update',
        id: editing.id,
        label: editForm.label,
        bank_name: editForm.bank_name,
        account_name: editForm.account_name,
        account_number: editForm.account_number,
        account_type: editForm.account_type,
        is_active: editForm.is_active,
      },
      `Bank account ${editing.bank_name} updated.`,
      editing.id,
    )
  }

  const submitConfirmOpening = async (a: BankAccount) => {
    const form = openingForms[a.id] ?? { opening_balance: '', opening_balance_date: '' }
    await act(
      { action: 'confirm_opening', id: a.id, opening_balance: form.opening_balance, opening_balance_date: form.opening_balance_date },
      `Opening balance confirmed for ${a.bank_name}.`,
      `confirm-${a.id}`,
    )
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <PageHead icon={<Landmark className="w-6 h-6 text-emerald-600" />} title="Match with Bank" bangla="ব্যাংকের খাতার সাথে আমাদের হিসাব মেলানো" tech="Bank Reconciliation">
        <div className="flex gap-2">
          <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={() => setShowCreate((s) => !s)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">
            <Plus className="w-4 h-4" /> Add bank account
          </button>
        </div>
      </PageHead>
      <p className="text-sm text-slate-500 -mt-4 mb-6">
        Statement import + matching against the journal bank lines. Reconciliation never writes journal
        entries — it only compares what the bank says against what the books already say.
      </p>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4 text-sm text-emerald-800 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" /> {notice}</div>}
      {loading && !data && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading bank accounts…</div>}

      {showCreate && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
          <h2 className="font-bold text-slate-900 mb-3">New bank account</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs font-semibold text-slate-500">Bank name
              <input className={inputCls} value={createForm.bank_name} onChange={(e) => setCreateForm({ ...createForm, bank_name: e.target.value })} placeholder="e.g. Dutch-Bangla Bank" />
            </label>
            <label className="text-xs font-semibold text-slate-500">Account name
              <input className={inputCls} value={createForm.account_name} onChange={(e) => setCreateForm({ ...createForm, account_name: e.target.value })} placeholder="Name on the account" />
            </label>
            <label className="text-xs font-semibold text-slate-500">Account number (optional)
              <input className={inputCls} value={createForm.account_number} onChange={(e) => setCreateForm({ ...createForm, account_number: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-slate-500">Type
              <select className={inputCls} value={createForm.account_type} onChange={(e) => setCreateForm({ ...createForm, account_type: e.target.value })}>
                {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-500">Label (optional)
              <input className={inputCls} value={createForm.label} onChange={(e) => setCreateForm({ ...createForm, label: e.target.value })} placeholder="Short display label" />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button disabled={busy === 'create' || !createForm.bank_name.trim() || !createForm.account_name.trim()} onClick={submitCreate} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">Create account</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700">Cancel</button>
          </div>
        </div>
      )}

      {editing && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
          <h2 className="font-bold text-slate-900 mb-3">Edit — {editing.label || editing.bank_name}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs font-semibold text-slate-500">Label
              <input className={inputCls} value={editForm.label} onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-slate-500">Bank name
              <input className={inputCls} value={editForm.bank_name} onChange={(e) => setEditForm({ ...editForm, bank_name: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-slate-500">Account name
              <input className={inputCls} value={editForm.account_name} onChange={(e) => setEditForm({ ...editForm, account_name: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-slate-500">Account number
              <input className={inputCls} value={editForm.account_number} onChange={(e) => setEditForm({ ...editForm, account_number: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-slate-500">Type
              <select className={inputCls} value={editForm.account_type} onChange={(e) => setEditForm({ ...editForm, account_type: e.target.value })}>
                {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="flex items-end gap-2 text-sm text-slate-700 pb-2">
              <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button disabled={busy === editing.id} onClick={submitEdit} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">Save changes</button>
            <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700">Cancel</button>
          </div>
        </div>
      )}

      {data && data.accounts.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">No bank accounts yet. Add one above to start reconciling.</div>
      )}

      {data && data.accounts.map((a) => {
        const openingForm = openingForms[a.id] ?? { opening_balance: '', opening_balance_date: '' }
        return (
          <div key={a.id} className={`rounded-2xl border p-5 mb-4 bg-white ${a.is_active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex flex-wrap items-center gap-2">
                  {a.bank_name}
                  {a.label && <span className="text-sm font-medium text-slate-500">— {a.label}</span>}
                  {a.chart_code && <span className="font-mono text-xs font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{a.chart_code}</span>}
                  {!a.is_active && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">INACTIVE</span>}
                </h2>
                <div className="mt-1 text-sm text-slate-600">
                  {a.account_name}
                  {a.account_number ? <> · {a.account_number}</> : null}
                  <> · {a.account_type}</>
                </div>
                <div className="mt-2">
                  {a.is_draft ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">UNCONFIRMED — draft candidate</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">Confirmed</span>
                  )}
                </div>
                {a.is_draft && a.derived_hint != null && (
                  <p className="mt-2 text-sm text-amber-700">
                    deposit-history hint {taka(a.derived_hint)} — NOT a statement balance
                  </p>
                )}
                {!a.is_draft && (
                  <p className="mt-2 text-sm text-slate-600">
                    Opening balance {takaOrDash(a.opening_balance)}
                    {a.opening_balance_date ? <> as of {a.opening_balance_date}</> : null}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(a)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                <Link href={`/admin/accounts/bank/${a.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700">
                  Open workbench →
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-700">Book (journal) balance</div>
                <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{taka(a.journal_balance)}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-700">Statement balance</div>
                <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{takaOrDash(a.statement_balance)}</div>
                {a.statement_balance_basis && <div className="mt-1 text-xs text-slate-500">{BASIS_LABEL[a.statement_balance_basis] ?? a.statement_balance_basis}</div>}
                {a.difference != null && <div className="mt-1 text-sm text-slate-600">Difference {taka(a.difference)}</div>}
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-700">Statement lines</div>
                <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{a.statement_line_count}</div>
                <div className="mt-1 text-sm text-slate-600">{a.matched_line_count} matched · {a.unmatched_line_count} unmatched</div>
              </div>
            </div>

            {a.is_draft && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> Confirm the opening balance
                </p>
                <p className="mt-1 text-sm text-amber-700">
                  Enter the balance from the actual bank statement — this replaces the deposit-history hint.
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="text-xs font-semibold text-slate-500">Opening balance
                    <input
                      type="number" step="0.01" className={inputCls}
                      value={openingForm.opening_balance}
                      onChange={(e) => setOpeningForms({ ...openingForms, [a.id]: { ...openingForm, opening_balance: e.target.value } })}
                      placeholder="0.00"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">As-of date
                    <input
                      type="date" className={inputCls}
                      value={openingForm.opening_balance_date}
                      onChange={(e) => setOpeningForms({ ...openingForms, [a.id]: { ...openingForm, opening_balance_date: e.target.value } })}
                    />
                  </label>
                  <button
                    disabled={busy === `confirm-${a.id}` || !openingForm.opening_balance || !openingForm.opening_balance_date}
                    onClick={() => submitConfirmOpening(a)}
                    className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50"
                  >
                    Confirm opening balance
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
