'use client'

import { useCallback, useEffect, useState } from 'react'

// Accounts → Cheques (stage A8).
// The cheque register: instruments ISSUED to payees and RECEIVED,
// each moving pending → cleared | bounced | cancelled.
// Recording a cheque posts nothing — clearing is the only money
// movement (issued: payables → bank; received: bank → receivables)
// and a bounce of a cleared cheque reverses it. The register
// starts empty: cheques are recorded here as they are written or
// received; nothing is derived or invented.
export const dynamic = 'force-dynamic'

const money = (v: unknown) =>
  `৳${Number(v ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  cleared: 'bg-emerald-100 text-emerald-700',
  bounced: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
}

interface Draft {
  direction: string
  cheque_no: string
  bank_account_id: string
  counterparty_id: string
  amount: string
  issue_date: string
  due_date: string
  note: string
}

const EMPTY_DRAFT: Draft = {
  direction: 'issued',
  cheque_no: '',
  bank_account_id: '',
  counterparty_id: '',
  amount: '',
  issue_date: '',
  due_date: '',
  note: '',
}

export default function ChequesPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cheques, setCheques] = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [banks, setBanks] = useState<any[]>([])
  const [counterparties, setCounterparties] = useState<any[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [directionFilter, setDirectionFilter] = useState('')
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState('')
  const [clearDates, setClearDates] = useState<Record<string, string>>({})
  const [bounceNotes, setBounceNotes] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams()
      if (statusFilter) qs.set('status', statusFilter)
      if (directionFilter) qs.set('direction', directionFilter)
      const res = await fetch(`/api/accounts/cheques${qs.toString() ? `?${qs}` : ''}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load cheques')
      setCheques(json.cheques ?? [])
      setSummary(json.summary ?? null)
      setBanks(json.bank_accounts ?? [])
      setCounterparties(json.counterparties ?? [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load cheques')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, directionFilter])

  useEffect(() => {
    load()
  }, [load])

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }))

  const submit = async () => {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const payload: any = {
        action: editingId ? 'update' : 'create',
        direction: draft.direction,
        cheque_no: draft.cheque_no,
        bank_account_id: draft.bank_account_id || null,
        counterparty_id: draft.counterparty_id || null,
        amount: draft.amount,
        issue_date: draft.issue_date || null,
        due_date: draft.due_date || null,
        note: draft.note || null,
      }
      if (editingId) payload.id = editingId
      const res = await fetch('/api/accounts/cheques', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      setNotice(editingId ? 'Cheque updated.' : 'Cheque recorded as pending — nothing is posted to the journal until it clears.')
      setDraft(EMPTY_DRAFT)
      setEditingId(null)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (c: any) => {
    setEditingId(c.id)
    setDraft({
      direction: c.direction,
      cheque_no: c.cheque_no,
      bank_account_id: c.bank_account_id ?? '',
      counterparty_id: c.counterparty_id ?? '',
      amount: String(c.amount ?? ''),
      issue_date: c.issue_date ?? '',
      due_date: c.due_date ?? '',
      note: c.note ?? '',
    })
    setError('')
    setNotice('')
  }

  const transition = async (c: any, actionName: 'clear' | 'bounce' | 'cancel') => {
    setActing(`${actionName}:${c.id}`)
    setError('')
    setNotice('')
    try {
      const payload: any = { action: actionName, id: c.id }
      if (actionName === 'clear') payload.cleared_date = clearDates[c.id] || null
      if (actionName === 'bounce') payload.note = bounceNotes[c.id] || null
      const res = await fetch('/api/accounts/cheques', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `${actionName} failed`)
      setNotice(
        json.posting_blocked
          ? `Status updated to ${actionName === 'clear' ? 'cleared' : actionName === 'bounce' ? 'bounced' : 'cancelled'}, but the journal posting was refused by a locked period — it is recorded on the Accounts overview as a posting exception.`
          : actionName === 'clear'
            ? 'Cheque cleared — the journal entry has been posted.'
            : actionName === 'bounce'
              ? 'Cheque marked bounced.'
              : 'Cheque cancelled.'
      )
      await load()
    } catch (e: any) {
      setError(e?.message || `${actionName} failed`)
    } finally {
      setActing('')
    }
  }

  const by = summary?.by_status ?? {}
  const pdcDue: any[] = summary?.pdc_due ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Cheques</h1>
        <p className="mt-1 text-sm text-slate-500">
          Register of cheques issued to payees and received. Recording a cheque posts nothing to the journal —
          clearing moves the money (issued: Accounts Payable → Bank; received: Bank → Accounts Receivable), and
          bouncing a cleared cheque reverses its entry. A cheque linked to a payable is for traceability only —
          settle the payable itself in Payables &amp; Ageing, not here.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      )}

      {/* ── Summary ─────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(['pending', 'cleared', 'bounced', 'cancelled'] as const).map((s) => (
          <div key={s} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{s}</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{money(by[s]?.total ?? 0)}</p>
            <p className="text-xs text-slate-400">{by[s]?.count ?? 0} cheque(s)</p>
          </div>
        ))}
      </div>

      {pdcDue.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="font-semibold text-amber-900">Post-dated cheques due within 7 days (or overdue): {pdcDue.length}</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-800">
            {pdcDue.map((c) => (
              <li key={c.id}>
                #{c.cheque_no} · {c.direction} · {money(c.amount)} · due {c.due_date ?? '—'}
                {c.counterparty_name ? ` · ${c.counterparty_name}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Record / edit form ──────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">{editingId ? 'Edit cheque (pending only)' : 'Record a cheque'}</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Direction</span>
            <select
              value={draft.direction}
              disabled={!!editingId}
              onChange={(e) => set({ direction: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50"
            >
              <option value="issued">Issued (we pay)</option>
              <option value="received">Received (we collect)</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Cheque number</span>
            <input
              type="text"
              value={draft.cheque_no}
              onChange={(e) => set({ cheque_no: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="e.g. 100234"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Bank account</span>
            <select
              value={draft.bank_account_id}
              onChange={(e) => set({ bank_account_id: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">— not linked yet —</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">{draft.direction === 'issued' ? 'Payee' : 'Drawer'}</span>
            <select
              value={draft.counterparty_id}
              onChange={(e) => set({ counterparty_id: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">— none —</option>
              {counterparties.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Amount (৳)</span>
            <input
              type="text"
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) => set({ amount: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="e.g. 25000.00"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Issue date</span>
            <input
              type="date"
              value={draft.issue_date}
              onChange={(e) => set({ issue_date: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Due date (PDC date)</span>
            <input
              type="date"
              value={draft.due_date}
              onChange={(e) => set({ due_date: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Note</span>
            <input
              type="text"
              value={draft.note}
              onChange={(e) => set({ note: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Record cheque'}
          </button>
          {editingId && (
            <button
              onClick={() => {
                setEditingId(null)
                setDraft(EMPTY_DRAFT)
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Stop editing
            </button>
          )}
          <p className="text-xs text-slate-400">
            The same cheque number on the same bank account is refused while an earlier one is pending or cleared.
          </p>
        </div>
      </div>

      {/* ── Register ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-900">Register</h2>
          <div className="flex gap-2 text-sm">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="cleared">Cleared</option>
              <option value="bounced">Bounced</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Both directions</option>
              <option value="issued">Issued</option>
              <option value="received">Received</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-slate-400">Loading…</p>
        ) : cheques.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            No cheques recorded{statusFilter || directionFilter ? ' for this filter' : ''} yet. The register starts
            empty — record a cheque above when one is written or received.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3">Cheque</th>
                  <th className="py-2 pr-3">Direction</th>
                  <th className="py-2 pr-3">Payee / Drawer</th>
                  <th className="py-2 pr-3">Bank</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 pr-3">Issued</th>
                  <th className="py-2 pr-3">Due</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cheques.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-3 font-medium text-slate-800">
                      #{c.cheque_no}
                      {c.journal_entry_id && <span className="block text-xs font-normal text-slate-400">journal posted</span>}
                      {c.note && <span className="block max-w-[220px] text-xs font-normal text-slate-400">{c.note}</span>}
                    </td>
                    <td className="py-2 pr-3 capitalize text-slate-600">{c.direction}</td>
                    <td className="py-2 pr-3 text-slate-600">{c.counterparty_name ?? '—'}</td>
                    <td className="py-2 pr-3 text-slate-600">{c.bank_label ?? '—'}</td>
                    <td className="py-2 pr-3 text-right font-medium text-slate-800">{money(c.amount)}</td>
                    <td className="py-2 pr-3 text-slate-600">{c.issue_date ?? '—'}</td>
                    <td className="py-2 pr-3 text-slate-600">{c.due_date ?? '—'}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[c.status] ?? 'bg-slate-100 text-slate-500'}`}>
                        {c.status}
                      </span>
                      {c.cleared_at && (
                        <span className="block text-xs text-slate-400">{String(c.cleared_at).slice(0, 10)}</span>
                      )}
                    </td>
                    <td className="py-2">
                      {c.status === 'pending' && (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="date"
                              value={clearDates[c.id] ?? ''}
                              onChange={(e) => setClearDates((p) => ({ ...p, [c.id]: e.target.value }))}
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                              title="Cleared date (defaults to today)"
                            />
                            <button
                              onClick={() => transition(c, 'clear')}
                              disabled={acting === `clear:${c.id}`}
                              className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Clear
                            </button>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={bounceNotes[c.id] ?? ''}
                              onChange={(e) => setBounceNotes((p) => ({ ...p, [c.id]: e.target.value }))}
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                              placeholder="Bounce reason"
                            />
                            <button
                              onClick={() => transition(c, 'bounce')}
                              disabled={acting === `bounce:${c.id}`}
                              className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              Bounce
                            </button>
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => startEdit(c)}
                              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => transition(c, 'cancel')}
                              disabled={acting === `cancel:${c.id}`}
                              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                      {c.status === 'cleared' && (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={bounceNotes[c.id] ?? ''}
                            onChange={(e) => setBounceNotes((p) => ({ ...p, [c.id]: e.target.value }))}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                            placeholder="Bounce reason"
                          />
                          <button
                            onClick={() => transition(c, 'bounce')}
                            disabled={acting === `bounce:${c.id}`}
                            className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            Bounce
                          </button>
                        </div>
                      )}
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
