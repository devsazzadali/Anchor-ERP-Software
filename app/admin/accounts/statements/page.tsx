'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { FileBarChart2, Scale, TrendingUp, Landmark, RefreshCw, AlertTriangle, BookOpen, CalendarClock } from 'lucide-react'
import { PeriodScopeBar, stmtUrl, taka, type StmtMeta } from './ui'
import { PageHead } from '../ui'
import { useLanguage } from '@/lib/i18n/provider'

// Accounts A2 — Reports hub. Period picker + the three big
// reports + a month-end door to Periods, and the journal-coverage
// strip. The posting map lives on its own Advanced page
// (/admin/accounts/posting-map). All figures on the linked screens
// are computed from journal_lines only
// (lib/server/accounting/statements.ts).

export default function StatementsIndexPage() {
  const { t } = useLanguage()
  const [meta, setMeta] = useState<StmtMeta | null>(null)
  const [period, setPeriod] = useState('')
  const [scope, setScope] = useState<'period' | 'fytd'>('period')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(stmtUrl('trial-balance', { scope: 'fytd' }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load statements')
      setMeta(json.meta)
      setPeriod((cur) => cur || json.meta.default_period)
    } catch (e: any) {
      setError(e?.message || 'Failed to load statements')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const q = period ? `?period=${period}&scope=${scope}` : ''
  const cards = [
    {
      href: `/admin/accounts/statements/trial-balance${q}`,
      icon: Scale,
      title: t.accounts.head.trialBalance.title,
      bangla: t.accounts.head.trialBalance.sub,
      text: t.accounts.statementsIndex.booksCheckText,
    },
    {
      href: `/admin/accounts/statements/pl${q}`,
      icon: TrendingUp,
      title: t.accounts.head.pl.title,
      bangla: t.accounts.head.pl.sub,
      text: t.accounts.statementsIndex.plText,
    },
    {
      href: `/admin/accounts/statements/balance-sheet${period ? `?period=${period}` : ''}`,
      icon: Landmark,
      title: t.accounts.head.balanceSheet.title,
      bangla: t.accounts.head.balanceSheet.sub,
      text: t.accounts.statementsIndex.balanceSheetText,
    },
    {
      href: '/admin/accounts/periods',
      icon: CalendarClock,
      title: t.accounts.head.periods.title,
      bangla: t.accounts.head.periods.sub,
      text: t.accounts.statementsIndex.monthEndText,
    },
  ]

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <PageHead
        icon={<FileBarChart2 className="w-6 h-6 text-emerald-600" />}
        title={t.accounts.head.statements.title}
        bangla={t.accounts.head.statements.sub}
        tech={t.accounts.head.statements.tech} purpose={t.accounts.head.statements.purpose}
      >
        <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 print:hidden">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </PageHead>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>}
      {loading && !meta && <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading statements…</div>}

      {meta && (
        <>
          <div className="mb-6 print:hidden">
            <PeriodScopeBar periods={meta.periods} period={period} onPeriod={setPeriod} scope={scope} onScope={setScope} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            {cards.map((c) => (
              <Link key={c.href} href={c.href} className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-emerald-300 hover:shadow-sm transition">
                <div className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <c.icon className="w-5 h-5 text-emerald-600" /> {c.title}
                </div>
                <p className="mt-1 text-sm text-slate-600 font-bangla">{c.bangla}</p>
                <p className="mt-2 text-sm text-slate-600">{c.text}</p>
                <span className="mt-3 inline-block text-sm font-semibold text-emerald-700">Open →</span>
              </Link>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <BookOpen className="w-4 h-4" /> Journal coverage
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {meta.journal_coverage.entries} posted entries
              {meta.journal_coverage.first_entry && (
                <> · from <strong>{meta.journal_coverage.first_entry}</strong> to <strong>{meta.journal_coverage.last_entry}</strong></>
              )}
              . Statements cover journal activity only; activity before the journal starts exists in no
              source module and appears solely in the opening position below.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Opening position:{' '}
              {meta.opening ? (
                meta.opening.status === 'draft' ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                    <AlertTriangle className="w-4 h-4" /> DRAFT — equity balancing figure {meta.opening.equity_draft ? taka(meta.opening.equity_draft) : '—'} awaiting owner confirmation
                  </span>
                ) : (
                  <span className="font-semibold text-emerald-700">CONFIRMED</span>
                )
              ) : (
                'not computed yet'
              )}
            </p>
          </div>

        </>
      )}
    </div>
  )
}
