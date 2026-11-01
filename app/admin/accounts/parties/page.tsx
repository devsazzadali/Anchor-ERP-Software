'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import { Users, RefreshCw, Pencil, CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react'
import { PageHead } from '../ui'

// Accounts A5 — Counterparties. Data: GET /api/accounts/parties.
// The register is DERIVED from existing records (salary
// recipients, expense requesters, partners, landlords) — sync
// re-derives it; admins maintain display name/contact here and
// deactivate. A party carrying register items or journal lines
// cannot be deleted (the API answers 409 — deactivate instead).

type Party = {
  id: string
  name: string
  type: string
  phone: string | null
  address: string | null
  is_active: boolean
  source_table: string | null
  source_id: string | null
  edited_manually: boolean
  open_payable: string
  open_receivable: string
  register_items: number
}

const taka = (v: string | number) => `৳${Number(v).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const TYPE_LABEL: Record<string, string> = {
  staff: 'Staff',
  partner: 'Partner',
  landlord: 'Landlord',
  supplier: 'Supplier',
  customer: 'Customer',
  utility: 'Utility',
  other: 'Other',
}

const SOURCE_LABEL: Record<string, string> = {
  profiles: 'Profile',
  house_rent_accounts: 'House rent account',
}

export default function PartiesPage() {
  const [parties, setParties] = useState<Party[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<Party | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', address: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts/parties')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load counterparties')
      setParties(json.parties)
    } catch (e: any) {
      setError(e?.message || 'Failed to load counterparties')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (body: Record<string, unknown>, okMsg: string) => {
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/accounts/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Action failed')
      setNotice(okMsg)
      setEditing(null)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Action failed')
    }
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <PageHead icon={<Users className="w-6 h-6 text-emerald-600" />} title="People & Companies" bangla="যাদের সাথে লেনদেন হয়" tech="Counterparties">
        <div className="flex gap-2">
          <button
            onClick={() => act({ action: 'sync' }, 'Counterparties re-derived from the source records.')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
          >
            <RefreshCw className="w-4 h-4" /> Sync from records
          </button>
          <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </PageHead>
      <p className="text-sm text-slate-500 -mt-4 mb-6">
        Everyone the business owes or is owed by — derived from the existing records (staff, partners,
        landlords), never re-entered. Payees the source records do not name stay honestly unrecorded.
      </p>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4 text-sm text-emerald-800 inline-flex items-center gap-2 w-full">
          <CheckCircle2 className="w-4 h-4" /> {notice}
        </div>
      )}
      {loading && parties.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading counterparties…</div>
      )}

      {editing && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
          <h2 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
            <Pencil className="w-4 h-4" /> Edit counterparty
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            A name/contact you type here is kept — later syncs refresh source facts but never overwrite a human edit.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="block text-slate-600 mb-1">Display name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="block text-slate-600 mb-1">Phone</span>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="block text-slate-600 mb-1">Address</span>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => act({ action: 'update', id: editing.id, name: form.name, phone: form.phone || null, address: form.address || null }, 'Counterparty updated.')}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
            >
              Save
            </button>
            <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <th className="px-4 py-3 font-semibold">Counterparty</th>
              <th className="px-4 py-3 font-semibold">Source</th>
              <th className="px-4 py-3 font-semibold">Contact</th>
              <th className="px-4 py-3 font-semibold text-right">Open payable</th>
              <th className="px-4 py-3 font-semibold text-right">Open receivable</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {parties.map((p) => (
              <tr key={p.id} className="border-b border-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{p.name}</div>
                  <div className="mt-0.5">
                    <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
                      {TYPE_LABEL[p.type] ?? p.type}
                    </span>
                    {p.edited_manually && <span className="ml-1 text-xs text-slate-400">edited</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {p.source_table ? (SOURCE_LABEL[p.source_table] ?? p.source_table) : 'System'}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{p.phone || '—'}</div>
                  {p.address && <div className="text-xs text-slate-400">{p.address}</div>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{Number(p.open_payable) > 0 ? taka(p.open_payable) : '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{Number(p.open_receivable) > 0 ? taka(p.open_receivable) : '—'}</td>
                <td className="px-4 py-3">
                  {p.is_active
                    ? <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="w-4 h-4" /> Active</span>
                    : <span className="inline-flex items-center gap-1 text-slate-500 font-semibold"><AlertTriangle className="w-4 h-4" /> Inactive</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => { setEditing(p); setForm({ name: p.name, phone: p.phone ?? '', address: p.address ?? '' }) }}
                      className="px-2.5 py-1 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => act({ action: 'set_active', id: p.id, is_active: !p.is_active }, p.is_active ? 'Counterparty deactivated.' : 'Counterparty reactivated.')}
                      className="px-2.5 py-1 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {p.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => act({ action: 'delete', id: p.id }, 'Counterparty deleted.')}
                      className="px-2.5 py-1 rounded-md border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {parties.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-slate-500">No counterparties yet — run Sync to derive them from the existing records.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
