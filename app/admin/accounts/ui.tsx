'use client'

// Accounts SIMPLIFICATION — shared presentation bits for the
// simplified Accounts screens (spec: ANCHORERP_ACCOUNTS_SIMPLIFY_SPEC).
// Presentation only: every figure still comes from the existing
// /api/accounts/* services; nothing here computes money.
//
//   PageHead     — simple English title + one plain Bangla line
//                  explaining the page + the technical term kept
//                  small for accountants (spec design rules 2–3).
//   PrintHeader / PrintFooter — the OFFICIAL print theme for
//                  browser print views: same company header, navy
//                  (#0f3057) + gold (#d4af37) and footer line as the
//                  official PDFs from lib/pdf-generator.ts. They
//                  render only inside @media print, within the
//                  page's .accounts-print-area wrapper (globals.css).
//   downloadPdf  — official-design PDF export through the shared
//                  generator (lib/pdf-generator.ts), the exact same
//                  function the rest of the ERP uses. The generator
//                  sanitises for Helvetica: the taka sign becomes
//                  "BDT" and Bengali glyphs are stripped BY DESIGN,
//                  so PDF content is passed in simple English only
//                  (see bdt() below) — nothing can silently drop.

import React from 'react'
import { generatePdf } from '@/lib/pdf-generator'

export const taka = (v: string | number) =>
  `৳${Number(v).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Money for official PDFs: plain English "BDT 1,234.00" (never ৳/Bangla — see header note). */
export const bdt = (v: string | number) =>
  `BDT ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function PageHead(props: {
  icon?: React.ReactNode
  title: string
  bangla: string
  tech?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6 print:hidden">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          {props.icon}
          {props.title}
        </h1>
        <p className="text-sm text-slate-600 mt-1 font-bangla">{props.bangla}</p>
        {props.tech && <p className="text-xs text-slate-400 mt-0.5">{props.tech}</p>}
      </div>
      {props.children}
    </div>
  )
}

/** Official-theme print header — print only. Mirrors lib/pdf-generator.ts:
 *  logo + ANCHOR FASHION wordmark, navy bar with gold rule, report title. */
export function PrintHeader(props: { title: string; subtitle?: string }) {
  const now = new Date()
  const when = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="hidden print:block accounts-print-header mb-6">
      <div className="flex items-end justify-between">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos.png" alt="Anchor Fashion" className="h-14 w-auto object-contain" />
          <div>
            <div className="text-lg font-extrabold tracking-wide" style={{ color: '#0f3057' }}>ANCHOR FASHION</div>
            <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: '#78828f' }}>
              Enterprise Resource Planning System
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold" style={{ color: '#7d8594' }}>{props.title}</div>
          <div className="text-[10px]" style={{ color: '#78828f' }}>Printed: {when}</div>
        </div>
      </div>
      <div className="mt-3 px-3 py-1.5 flex items-center justify-between" style={{ backgroundColor: '#0f3057', borderBottom: '2px solid #d4af37' }}>
        <span className="text-[10px] font-bold uppercase tracking-widest text-white">
          {props.subtitle ?? 'Accounts — Official Statement'}
        </span>
        <span className="text-[10px] uppercase tracking-widest" style={{ color: '#c8d7f0' }}>Anchor Fashion ERP</span>
      </div>
    </div>
  )
}

/** Official-theme print footer — print only, fixed to each printed page. */
export function PrintFooter() {
  const when = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  return (
    <div className="accounts-print-footer hidden text-[9px]" style={{ color: '#78828f' }}>
      <div style={{ borderTop: '0.5px solid #d0d6e0' }} className="pt-1.5 flex items-center justify-between">
        <span>ANCHOR FASHION ERP · Confidential &amp; Proprietary · {when}</span>
        <span>This is a computer-generated electronic statement and does not require a physical signature.</span>
      </div>
    </div>
  )
}

/**
 * Official-design PDF export — delegates to the shared generator so an
 * Accounts PDF is indistinguishable in design from every other ERP PDF
 * (same header, logo, table styling, notes, signatures and footer).
 * All strings must be simple English (the generator strips Bengali
 * glyphs and converts ৳ to "BDT" by design).
 */
export async function downloadPdf(opts: {
  title: string
  subtitle?: string
  dateRange?: string
  columns: string[]
  rows: (string | number)[][]
  summary?: { label: string; value: string }[]
  filename?: string
  notes?: string
  tableTitle?: string
}) {
  await generatePdf(opts.title, opts.columns, opts.rows, {
    subtitle: opts.subtitle,
    dateRange: opts.dateRange,
    summaryData: opts.summary,
    filename: opts.filename,
    notes: opts.notes,
    tableTitle: opts.tableTitle,
    preparedBy: 'Accounts Department',
  })
}
