'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import { ListTree, RefreshCw, Plus, Pencil, CheckCircle2, AlertTriangle, Lock } from 'lucide-react'

// Accounts A1 — Chart of Accounts. Data: GET /api/accounts/chart
// (accounts with trial-balance figures). Admins may ADD accounts
// and rename / activate / deactivate them (POST + PATCH); account
// codes and types are immutable by design (the journal references
// them), and seeded system accounts are marked as such.

type Account = {
  id: string; code: string; name: string; name_bn: string | null; type: string
  parent_id: string | null; branch_dimension: boolean; ledger_head: string | null
  is_system: boolean; is_active: boolean
  debit: string; credit: string; balance: string
}

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense']
const TYPE_LABEL: Record<string, string> = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses',
}
const taka = (v: string | number) => `৳${Number(v).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function ChartOfAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [totals, setTotals] = useState<{ total_debit: string; total_credit: string; balanced: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ code: '', name: '', name_bn: '', type: 'expense', parent_id: '', branch_dimension: false })
  const [editing, setEditing] = useState<Account | null>(null)
  const [editForm, setEditForm] = useState({ name: '', name_bn: '', is_active: true })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts/chart')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load chart of accounts')
      setAccounts(json.accounts ?? [])
      setTotals(json.totals ?? null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load chart of accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const submitAdd = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts/chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, parent_id: form.parent_id || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to add account')
      setNotice(`Account ${json.account.code} — ${json.account.name} added.`)
      setShowAdd(false)
      setForm({ code: '', name: '', name_bn: '', type: 'expense', parent_id: '', branch_dimension: false })
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to add account')
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (a: Account) => {
    setEditing(a)
    setEditForm({ name: a.name, name_bn: a.name_bn ?? '', is_active: a.is_active })
  }

  const submitEdit = async () => {
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts/chart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, ...editForm }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to update account')
      setNotice(`Account ${editing.code} updated.`)
      setEditing(null)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to update account')
    } finally {
      setBusy(false)
    }
  }

  const byType = (t: string) => accounts.filter((a) => a.type === t)
  const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ListTree className="w-6 h-6 text-emerald-600" /> Chart of Accounts
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {loading ? 'Loading…' : `${accounts.length} accounts · Trial balance ${totals?.balanced ? 'balances' : 'DOES NOT BALANCE'} (Dr ${totals ? taka(totals.total_debit) : '—'} / Cr ${totals ? taka(totals.total_credit) : '—'})`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={() => setShowAdd((s) => !s)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">
            <Plus className="w-4 h-4" /> Add account
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4 text-sm text-emerald-700 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> {notice}</div>}

      {showAdd && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
          <h2 className="font-bold text-slate-900 mb-3">New account</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs font-semibold text-slate-500">Code (unique, permanent)
              <input className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. 5405" />
            </label>
            <label className="text-xs font-semibold text-slate-500">Name
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Account name" />
            </label>
            <label className="text-xs font-semibold text-slate-500">Name (Bangla, optional)
              <input className={inputCls} value={form.name_bn} onChange={(e) => setForm({ ...form, name_bn: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-slate-500">Type
              <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-500">Parent account (optional)
              <select className={inputCls} value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
                <option value="">— none —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </label>
            <label className="flex items-end gap-2 text-sm text-slate-700 pb-2">
              <input type="checkbox" checked={form.branch_dimension} onChange={(e) => setForm({ ...form, branch_dimension: e.target.checked })} />
              Tracked per branch
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button disabled={busy} onClick={submitAdd} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">Add account</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700">Cancel</button>
          </div>
        </div>
      )}

      {editing && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
          <h2 className="font-bold text-slate-900 mb-1">Edit {editing.code} — {editing.name}</h2>
          <p className="text-xs text-slate-500 mb-3 flex items-center gap-1"><Lock className="w-3 h-3" /> Code and type cannot change — journal entries reference them. Rename or deactivate only.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs font-semibold text-slate-500">Name
              <input className={inputCls} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-slate-500">Name (Bangla)
              <input className={inputCls} value={editForm.name_bn} onChange={(e) => setEditForm({ ...editForm, name_bn: e.target.value })} />
            </label>
            <label className="flex items-end gap-2 text-sm text-slate-700 pb-2">
              <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button disabled={busy} onClick={submitEdit} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">Save changes</button>
            <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700">Cancel</button>
          </div>
        </div>
      )}

      {TYPES.map((t) => (
        <div key={t} className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-2">{TYPE_LABEL[t]}</h2>
          <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-3 font-semibold">Code</th>
                  <th className="px-4 py-3 font-semibold">Account</th>
                  <th className="px-4 py-3 font-semibold text-right">Debit</th>
                  <th className="px-4 py-3 font-semibold text-right">Credit</th>
                  <th className="px-4 py-3 font-semibold text-right">Balance</th>
                  <th className="px-4 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {byType(t).map((a) => (
                  <tr key={a.id} className={`border-b border-slate-50 ${a.is_active ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2.5 font-mono text-xs">{a.code}</td>
                    <td className="px-4 py-2.5">
                      <span className={a.parent_id ? 'pl-4' : 'font-medium'}>{a.name}</span>
                      {a.is_system && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">SYSTEM</span>}
                      {a.ledger_head && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">Ledger head: {a.ledger_head}</span>}
                      {a.branch_dimension && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">per-branch</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{Number(a.debit) ? taka(a.debit) : '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{Number(a.credit) ? taka(a.credit) : '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{taka(a.balance)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => openEdit(a)} className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-xs hover:underline"><Pencil className="w-3 h-3" /> Edit</button>
                    </td>
                  </tr>
                ))}
                {byType(t).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-3 text-slate-400">No accounts of this type.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
