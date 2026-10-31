'use client'

// Accounts A2 — shared bits for the statement screens: money
// formatting (same helper shape as the A1 pages), the period/scope
// control bar, and CSV/Print export buttons. The CSV is produced
// server-side from the identical payload (statementsCsv.ts), so an
// export can never disagree with the screen it was taken from.

import React from 'react'
import { Download, Printer } from 'lucide-react'

export const taka = (v: string | number) =>
  `৳${Number(v).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Negative amounts in accounting parentheses, e.g. (৳1,234.00). */
export const takaSigned = (v: string | number) => {
  const n = Number(v)
  return n < 0 ? `(${taka(Math.abs(n))})` : taka(n)
}

export type PeriodInfo = { month: string; fy_label: string; status: string; start: string; end: string }
export type StmtMeta = {
  periods: PeriodInfo[]
  branches: Array<{ id: string; name: string }>
  opening: { status: string; label: string; as_of: string; equity_draft: string | null } | null
  journal_coverage: { first_entry: string | null; last_entry: string | null; entries: number }
  default_period: string
}

export function stmtUrl(type: string, params: Record<string, string | undefined>, format?: string): string {
  const q = new URLSearchParams()
  q.set('type', type)
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
  if (format) q.set('format', format)
  return `/api/accounts/statements?${q.toString()}`
}

export function PeriodScopeBar(props: {
  periods: PeriodInfo[]
  period: string
  onPeriod: (m: string) => void
  scope?: 'period' | 'fytd'
  onScope?: (s: 'period' | 'fytd') => void
}) {
  const { periods, period, onPeriod, scope, onScope } = props
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="inline-flex items-center gap-2 text-sm text-slate-600">
        Period
        <select
          value={period}
          onChange={(e) => onPeriod(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
        >
          {periods.map((p) => (
            <option key={p.month} value={p.month}>
              {p.month} · {p.fy_label}{p.status !== 'open' ? ` (${p.status})` : ''}
            </option>
          ))}
        </select>
      </label>
      {scope && onScope && (
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden" role="group" aria-label="Scope">
          {(['period', 'fytd'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onScope(s)}
              className={`px-3 py-2 text-sm font-semibold ${scope === s ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {s === 'period' ? 'This period' : 'FY to date'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ExportButtons(props: { csvHref: string }) {
  return (
    <div className="flex items-center gap-2 print:hidden">
      <a
        href={props.csvHref}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        <Download className="w-4 h-4" /> CSV
      </a>
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        <Printer className="w-4 h-4" /> Print
      </button>
    </div>
  )
}
