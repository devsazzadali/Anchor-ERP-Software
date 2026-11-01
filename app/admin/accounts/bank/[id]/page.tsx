'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Landmark, RefreshCw, CheckCircle2, AlertTriangle, ArrowLeft, Upload, Plus, Pencil, Trash2 } from 'lucide-react'

// Accounts A4 — Bank Reconciliation workbench for one bank account.
// Data: GET /api/accounts/bank/[id] (account summary, reconciliation
// totals, statement lines, journal / book lines and suggested-match
// candidates). Actions POST to the same route: import_csv / add_line /
// edit_line / delete_line / set_line_status / match / unmatch.
// Reconciliation NEVER writes journal entries — matching only links a
// statement line to an existing journal line.

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

type Reconciliation = {
  journal_balance: string
  statement_balance: string | null
  statement_balance_basis: StatementBasis
  unmatched_statement_credit: string
  unmatched_statement_debit: string
  unmatched_journal_debit: string
  unmatched_journal_credit: string
  explained_difference: string
  unexplained_difference: string | null
}

type StatementLine = {
  id: string
  statement_date: string
  description: string
  reference: string | null
  debit: string | null
  credit: string | null
  balance: string | null
  match_status: 'unmatched' | 'matched' | 'ignored'
  matched_journal_line_id: string | null
  matched_entry_id: string | null
  matched_deposit_id: string | null
  import_batch_id: string | null
  created_at: string
}

type JournalLine = {
  journal_line_id: string
  entry_id: string
  entry_date: string
  debit: string
  credit: string
  memo: string | null
  source_table: string | null
  deposit_id: string | null
  shared_transaction_id: boolean
  matched_statement_line_id: string | null
}

type Candidate = {
  statement_line_id: string
  journal_line_id: string
  score: number | string
  amount: string
  date_diff_days: number
  direction: string
  flags: string[]
}

type Payload = {
  account: BankAccount
  reconciliation: Reconciliation
  lines: StatementLine[]
  journal_lines: JournalLine[]
  candidates: Candidate[]
}

type ImportResult = {
  batch_id?: string
  total_rows: number
  imported: number
  errors: Array<{ row: number; message: string }>
}

const BASIS_LABEL: Record<string, string> = {
  last_line_balance: 'Basis: last statement line balance',
  opening_plus_lines: 'Basis: opening balance + statement lines',
  lines_sum: 'Basis: sum of statement lines',
}

const SHARED_FLAG = 'shared_transaction_id'
const SHARED_WARNING = 'Shared bank transaction ID — verify manually'
const SHARED_TOOLTIP = 'This deposit shares its bank transaction ID with other deposits'

const taka = (v: string | number) => `৳${Number(v).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const takaOrDash = (v: string | number | null | undefined) => (v == null || v === '' || Number(v) === 0 ? '—' : taka(v))
const takaStrict = (v: string | number | null | undefined) => (v == null || v === '' ? '—' : taka(v))

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'

const lineStatusChip = (l: StatementLine) => {
  if (l.match_status === 'matched') {
    return (
      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">
        Matched · {l.matched_deposit_id ? 'Deposit' : 'Journal entry'}
      </span>
    )
  }
  if (l.match_status === 'ignored') return <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">Ignored</span>
  return <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">Unmatched</span>
}

export default function BankReconciliationWorkbenchPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''

  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [pasteCsv, setPasteCsv] = useState('')
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)

  const [addForm, setAddForm] = useState({ statement_date: '', description: '', reference: '', debit: '', credit: '', balance: '' })

  const [editingLine, setEditingLine] = useState<StatementLine | null>(null)
  const [editForm, setEditForm] = useState({ statement_date: '', description: '', reference: '', debit: '', credit: '', balance: '' })

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/accounts/bank/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load bank account')
      setData(json)
    } catch (e: any) {
      setError(e?.message || 'Failed to load bank account')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const act = async (body: Record<string, unknown>, okMessage: string, busyKey: string) => {
    setBusy(busyKey)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/accounts/bank/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Action failed')
      setNotice(okMessage)
      await load()
      return json
    } catch (e: any) {
      setError(e?.message || 'Action failed')
      return null
    } finally {
      setBusy(null)
    }
  }

  const doImport = async (csvText: string, fileName?: string) => {
    setBusy('import')
    setError(null)
    setNotice(null)
    setImportResult(null)
    try {
      const res = await fetch(`/api/accounts/bank/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_csv', csv_text: csvText, ...(fileName ? { file_name: fileName } : {}) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Import failed')
      setImportResult({ batch_id: json.batch_id, total_rows: json.total_rows, imported: json.imported, errors: json.errors ?? [] })
      setNotice(`Imported ${json.imported} of ${json.total_rows} rows.`)
      setPasteCsv('')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Import failed')
    } finally {
      setBusy(null)
    }
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    await doImport(text, file.name)
  }

  const submitAddLine = async () => {
    const json = await act(
      {
        action: 'add_line',
        statement_date: addForm.statement_date,
        description: addForm.description,
        ...(addForm.reference.trim() ? { reference: addForm.reference.trim() } : {}),
        ...(addForm.debit ? { debit: addForm.debit } : {}),
        ...(addForm.credit ? { credit: addForm.credit } : {}),
        ...(addForm.balance ? { balance: addForm.balance } : {}),
      },
      'Statement line added.',
      'add-line',
    )
    if (json) setAddForm({ statement_date: '', description: '', reference: '', debit: '', credit: '', balance: '' })
  }

  const openEditLine = (l: StatementLine) => {
    setEditingLine(l)
    setEditForm({
      statement_date: l.statement_date ?? '',
      description: l.description ?? '',
      reference: l.reference ?? '',
      debit: l.debit ?? '',
      credit: l.credit ?? '',
      balance: l.balance ?? '',
    })
  }

  const submitEditLine = async () => {
    if (!editingLine) return
    const json = await act(
      {
        action: 'edit_line',
        line_id: editingLine.id,
        statement_date: editForm.statement_date,
        description: editForm.description,
        reference: editForm.reference,
        debit: editForm.debit,
        credit: editForm.credit,
        balance: editForm.balance,
      },
      'Statement line updated.',
      `edit-${editingLine.id}`,
    )
    if (json) setEditingLine(null)
  }

  const onDeleteLine = async (l: StatementLine) => {
    if (!window.confirm(`Delete this statement line (${l.statement_date} — ${l.description})? This cannot be undone.`)) return
    await act({ action: 'delete_line', line_id: l.id }, 'Statement line deleted.', `delete-${l.id}`)
  }

  const account = data?.account
  const recon = data?.reconciliation
  const lines = data?.lines ?? []
  const journalLines = data?.journal_lines ?? []

  const statementLineById = useMemo(() => new Map(lines.map((l) => [l.id, l] as const)), [lines])
  const journalLineById = useMemo(() => new Map(journalLines.map((j) => [j.journal_line_id, j] as const)), [journalLines])

  const candidatesByLine = useMemo(() => {
    const map = new Map<string, Candidate[]>()
    for (const c of data?.candidates ?? []) {
      const arr = map.get(c.statement_line_id) ?? []
      arr.push(c)
      map.set(c.statement_line_id, arr)
    }
    return map
  }, [data?.candidates])

  const unmatchedStatement = lines.filter((l) => l.match_status === 'unmatched')
  const outstandingJournal = journalLines.filter((j) => !j.matched_statement_line_id)
  const selectedLine = selectedLineId ? statementLineById.get(selectedLineId) ?? null : null
  const unexplained = recon?.unexplained_difference
  const unexplainedNonZero = unexplained != null && Number(unexplained) !== 0

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="mb-4">
        <Link href="/admin/accounts/bank" className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
          <ArrowLeft className="w-4 h-4" /> Bank Reconciliation
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex flex-wrap items-center gap-2">
            <Landmark className="w-6 h-6 text-emerald-600" />
            {account ? (account.label || account.bank_name) : 'Bank Reconciliation'}
            {account?.bank_name && account.label && <span className="text-base font-medium text-slate-500">{account.bank_name}</span>}
            {account?.chart_code && <span className="font-mono text-xs font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{account.chart_code}</span>}
            {account && (account.is_draft
              ? <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">UNCONFIRMED — draft candidate</span>
              : <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">Confirmed</span>)}
          </h1>
          <p className="text-sm text-slate-600 mt-1 font-bangla">ব্যাংকের খাতার সাথে আমাদের হিসাব মেলানো</p>
          <p className="text-xs text-slate-400 mt-0.5">Bank Reconciliation — statement workbench</p>
          {account && (
            <p className="text-sm text-slate-500 mt-1">
              {account.account_name}
              {account.account_number ? <> · {account.account_number}</> : null}
              <> · {account.account_type}</>
              {account.is_draft && account.derived_hint != null && (
                <> · <span className="text-amber-700">deposit-history hint {taka(account.derived_hint)} — NOT a statement balance</span></>
              )}
              {!account.is_draft && account.opening_balance != null && (
                <> · Opening balance {taka(account.opening_balance)}{account.opening_balance_date ? ` as of ${account.opening_balance_date}` : ''}</>
              )}
            </p>
          )}
          <p className="text-sm text-slate-500 mt-1">Match statement lines against the journal bank lines. Reconciliation never writes journal entries.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4 text-sm text-emerald-800 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" /> {notice}</div>}
      {loading && !data && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading workbench…</div>}

      {data && recon && account && (
        <>
          {/* ── Reconciliation status ─────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-700">Book (journal) balance</div>
              <div className="mt-2 text-xl font-bold text-slate-900 tabular-nums">{taka(recon.journal_balance)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-700">Statement balance</div>
              <div className="mt-2 text-xl font-bold text-slate-900 tabular-nums">{takaStrict(recon.statement_balance)}</div>
              {recon.statement_balance_basis && <div className="mt-1 text-xs text-slate-500">{BASIS_LABEL[recon.statement_balance_basis] ?? recon.statement_balance_basis}</div>}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-700">Difference</div>
              <div className="mt-2 text-xl font-bold text-slate-900 tabular-nums">{takaStrict(account.difference)}</div>
              <div className="mt-1 text-sm text-slate-600">Explained {taka(recon.explained_difference)}</div>
            </div>
            <div className={`rounded-2xl border p-5 ${unexplained == null ? 'border-slate-200 bg-white' : unexplainedNonZero ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
              <div className="text-sm font-semibold text-slate-700">Unexplained difference</div>
              <div className={`mt-2 text-xl font-bold tabular-nums ${unexplained == null ? 'text-slate-900' : unexplainedNonZero ? 'text-rose-700' : 'text-emerald-700'}`}>
                {takaStrict(unexplained)}
              </div>
              <div className="mt-1 text-sm text-slate-600">
                {unexplained == null ? 'Not computable yet.' : unexplainedNonZero ? 'Still to explain — keep matching.' : 'Fully explained.'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <div className="text-sm font-semibold text-slate-700">Unmatched statement items</div>
              <div className="mt-2 text-xl font-bold text-slate-900">{unmatchedStatement.length}</div>
              <div className="mt-1 text-sm text-slate-600">
                Credits {taka(recon.unmatched_statement_credit)} · Debits {taka(recon.unmatched_statement_debit)}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-700">In the books, not on statement (in transit / unpresented)</div>
              <div className="mt-2 text-xl font-bold text-slate-900">{outstandingJournal.length}</div>
              <div className="mt-1 text-sm text-slate-600">
                Debits {taka(recon.unmatched_journal_debit)} · Credits {taka(recon.unmatched_journal_credit)}
              </div>
            </div>
          </div>

          {/* ── Import ────────────────────────────────────────── */}
          <h2 className="text-lg font-bold text-slate-900 mb-3">Import statement (CSV)</h2>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-8">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 cursor-pointer">
                <Upload className="w-4 h-4" /> Choose CSV file
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFileChange} disabled={busy === 'import'} />
              </label>
              <span className="text-xs text-slate-500">The file is read in your browser and sent as text — nothing is uploaded anywhere else.</span>
            </div>
            <label className="text-xs font-semibold text-slate-500 block">…or paste CSV
              <textarea
                className={`${inputCls} mt-1 font-mono text-xs`} rows={5}
                value={pasteCsv} onChange={(e) => setPasteCsv(e.target.value)}
                placeholder={'date,description,reference,debit,credit,balance'}
              />
            </label>
            <div className="mt-3">
              <button disabled={busy === 'import' || !pasteCsv.trim()} onClick={() => doImport(pasteCsv)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                Import pasted CSV
              </button>
            </div>
            {importResult && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-800">Imported {importResult.imported} of {importResult.total_rows} rows</p>
                {importResult.errors.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-sm font-semibold text-rose-700">{importResult.errors.length} row(s) rejected:</p>
                    {importResult.errors.map((er, i) => (
                      <p key={`${er.row}-${i}`} className="text-sm text-rose-700">Row {er.row}: {er.message}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Suggested matches ─────────────────────────────── */}
          <h2 className="text-lg font-bold text-slate-900 mb-3">Suggested matches</h2>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-8">
            {candidatesByLine.size === 0 && <p className="text-sm text-slate-500">No suggested matches right now.</p>}
            {[...candidatesByLine.entries()].map(([statementLineId, cands]) => {
              const sl = statementLineById.get(statementLineId)
              return (
                <div key={statementLineId} className="mb-4 last:mb-0">
                  <p className="text-sm font-semibold text-slate-800">
                    Statement line {sl ? `${sl.statement_date} — ${sl.description}` : statementLineId}
                    {sl && <> · {takaStrict(sl.credit ?? sl.debit)}</>}
                  </p>
                  <div className="mt-2 space-y-2">
                    {cands.map((c) => {
                      const jl = journalLineById.get(c.journal_line_id)
                      return (
                        <div key={`${c.statement_line_id}-${c.journal_line_id}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                          <span className="text-sm font-semibold text-slate-800 tabular-nums">{taka(c.amount)}</span>
                          <span className="text-xs text-slate-500">
                            Statement {sl?.statement_date ?? '—'} vs journal {jl?.entry_date ?? '—'} · {c.date_diff_days} day(s) apart · {c.direction}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">Score {c.score}</span>
                          {(c.flags ?? []).map((f) => (
                            f === SHARED_FLAG
                              ? <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold"><AlertTriangle className="w-3.5 h-3.5" /> {SHARED_WARNING}</span>
                              : <span key={f} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">{f}</span>
                          ))}
                          <button
                            disabled={busy === `match-${c.statement_line_id}-${c.journal_line_id}`}
                            onClick={() => act({ action: 'match', statement_line_id: c.statement_line_id, journal_line_id: c.journal_line_id }, 'Match confirmed.', `match-${c.statement_line_id}-${c.journal_line_id}`)}
                            className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Confirm match
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Statement lines ───────────────────────────────── */}
          <h2 className="text-lg font-bold text-slate-900 mb-3">Statement lines</h2>
          {selectedLine && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-3 text-sm text-emerald-800 flex flex-wrap items-center justify-between gap-2">
              <span>
                Matching manually: <strong>{selectedLine.statement_date} — {selectedLine.description}</strong> ({takaStrict(selectedLine.credit ?? selectedLine.debit)}).
                Use “Match to selected” on a book line below.
              </span>
              <button onClick={() => setSelectedLineId(null)} className="px-3 py-1.5 rounded-lg border border-emerald-300 text-xs font-semibold text-emerald-800">Clear selection</button>
            </div>
          )}
          <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white mb-4">
            <table className="w-full text-sm min-w-[980px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Description</th>
                  <th className="px-4 py-3 font-semibold">Reference</th>
                  <th className="px-4 py-3 font-semibold text-right">Debit</th>
                  <th className="px-4 py-3 font-semibold text-right">Credit</th>
                  <th className="px-4 py-3 font-semibold text-right">Balance</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <React.Fragment key={l.id}>
                    <tr className={`border-b border-slate-50 align-top ${selectedLineId === l.id ? 'bg-emerald-50' : ''}`}>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">{l.statement_date}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{l.description}</td>
                      <td className="px-4 py-3 text-slate-500">{l.reference || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{takaOrDash(l.debit)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{takaOrDash(l.credit)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{takaStrict(l.balance)}</td>
                      <td className="px-4 py-3">{lineStatusChip(l)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          {l.match_status === 'unmatched' && (
                            <button onClick={() => setSelectedLineId(l.id)} className="px-3 py-1.5 rounded-lg border border-emerald-600 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Match manually</button>
                          )}
                          {l.match_status === 'matched' && (
                            <button disabled={busy === `unmatch-${l.id}`} onClick={() => act({ action: 'unmatch', statement_line_id: l.id }, 'Match removed.', `unmatch-${l.id}`)} className="px-3 py-1.5 rounded-lg border border-amber-200 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50">Unmatch</button>
                          )}
                          {l.match_status === 'unmatched' && (
                            <button disabled={busy === `status-${l.id}`} onClick={() => act({ action: 'set_line_status', line_id: l.id, status: 'ignored' }, 'Statement line ignored.', `status-${l.id}`)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Ignore</button>
                          )}
                          {l.match_status === 'ignored' && (
                            <button disabled={busy === `status-${l.id}`} onClick={() => act({ action: 'set_line_status', line_id: l.id, status: 'unmatched' }, 'Statement line un-ignored.', `status-${l.id}`)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Unignore</button>
                          )}
                          <button onClick={() => openEditLine(l)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button disabled={busy === `delete-${l.id}`} onClick={() => onDeleteLine(l)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editingLine?.id === l.id && (
                      <tr className="border-b border-slate-100 bg-slate-50">
                        <td colSpan={8} className="px-4 py-3">
                          {l.match_status === 'matched' && (
                            <p className="text-xs text-amber-700 mb-2 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> This line is matched — date and money fields are locked; the server refuses edits to matched lines.</p>
                          )}
                          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                            <label className="text-xs font-semibold text-slate-500">Date
                              <input type="date" disabled={l.match_status === 'matched'} className={`${inputCls} disabled:opacity-50`} value={editForm.statement_date} onChange={(e) => setEditForm({ ...editForm, statement_date: e.target.value })} />
                            </label>
                            <label className="text-xs font-semibold text-slate-500">Description
                              <input className={inputCls} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                            </label>
                            <label className="text-xs font-semibold text-slate-500">Reference
                              <input className={inputCls} value={editForm.reference} onChange={(e) => setEditForm({ ...editForm, reference: e.target.value })} />
                            </label>
                            <label className="text-xs font-semibold text-slate-500">Debit
                              <input type="number" step="0.01" disabled={l.match_status === 'matched'} className={`${inputCls} disabled:opacity-50`} value={editForm.debit} onChange={(e) => setEditForm({ ...editForm, debit: e.target.value })} />
                            </label>
                            <label className="text-xs font-semibold text-slate-500">Credit
                              <input type="number" step="0.01" disabled={l.match_status === 'matched'} className={`${inputCls} disabled:opacity-50`} value={editForm.credit} onChange={(e) => setEditForm({ ...editForm, credit: e.target.value })} />
                            </label>
                            <label className="text-xs font-semibold text-slate-500">Balance
                              <input type="number" step="0.01" disabled={l.match_status === 'matched'} className={`${inputCls} disabled:opacity-50`} value={editForm.balance} onChange={(e) => setEditForm({ ...editForm, balance: e.target.value })} />
                            </label>
                          </div>
                          <div className="mt-3 flex justify-end gap-2">
                            <button disabled={busy === `edit-${l.id}`} onClick={submitEditLine} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">Save line</button>
                            <button onClick={() => setEditingLine(null)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700">Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {lines.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-3 text-slate-400">No statement lines yet — import a CSV or add a line below.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Add statement line ────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-8">
            <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2"><Plus className="w-4 h-4 text-emerald-600" /> Add statement line</h3>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <label className="text-xs font-semibold text-slate-500">Date
                <input type="date" className={inputCls} value={addForm.statement_date} onChange={(e) => setAddForm({ ...addForm, statement_date: e.target.value })} />
              </label>
              <label className="text-xs font-semibold text-slate-500">Description
                <input className={inputCls} value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} />
              </label>
              <label className="text-xs font-semibold text-slate-500">Reference
                <input className={inputCls} value={addForm.reference} onChange={(e) => setAddForm({ ...addForm, reference: e.target.value })} />
              </label>
              <label className="text-xs font-semibold text-slate-500">Debit
                <input type="number" step="0.01" className={inputCls} value={addForm.debit} onChange={(e) => setAddForm({ ...addForm, debit: e.target.value })} />
              </label>
              <label className="text-xs font-semibold text-slate-500">Credit
                <input type="number" step="0.01" className={inputCls} value={addForm.credit} onChange={(e) => setAddForm({ ...addForm, credit: e.target.value })} />
              </label>
              <label className="text-xs font-semibold text-slate-500">Balance (optional)
                <input type="number" step="0.01" className={inputCls} value={addForm.balance} onChange={(e) => setAddForm({ ...addForm, balance: e.target.value })} />
              </label>
            </div>
            <div className="mt-4">
              <button disabled={busy === 'add-line' || !addForm.statement_date || !addForm.description.trim()} onClick={submitAddLine} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">Add line</button>
            </div>
          </div>

          {/* ── Book (journal) lines ──────────────────────────── */}
          <h2 className="text-lg font-bold text-slate-900 mb-3">Book (journal) lines</h2>
          <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Memo</th>
                  <th className="px-4 py-3 font-semibold text-right">Debit</th>
                  <th className="px-4 py-3 font-semibold text-right">Credit</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {journalLines.map((j) => (
                  <tr key={j.journal_line_id} className="border-b border-slate-50 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">{j.entry_date}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800">{j.memo || '—'}</span>
                      {j.shared_transaction_id && (
                        <span title={SHARED_TOOLTIP} className="ml-2 inline-flex items-center gap-1 text-amber-600 align-middle">
                          <AlertTriangle className="w-4 h-4" />
                          <span className="text-xs font-semibold">Shared transaction ID</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{takaOrDash(j.debit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{takaOrDash(j.credit)}</td>
                    <td className="px-4 py-3">
                      {j.matched_statement_line_id
                        ? <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">Matched</span>
                        : <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">Outstanding</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {selectedLineId && !j.matched_statement_line_id && (
                        <button
                          disabled={busy === `match-${selectedLineId}-${j.journal_line_id}`}
                          onClick={async () => {
                            const json = await act({ action: 'match', statement_line_id: selectedLineId, journal_line_id: j.journal_line_id }, 'Match confirmed.', `match-${selectedLineId}-${j.journal_line_id}`)
                            if (json) setSelectedLineId(null)
                          }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Match to selected
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {journalLines.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-3 text-slate-400">No journal lines for this bank account yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
