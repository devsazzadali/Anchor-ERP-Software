import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { taka } from '@/lib/server/accounting/reports'
import {
  statementMeta,
  resolveScopeFor,
  trialBalanceStatement,
  profitAndLoss,
  balanceSheet,
} from '@/lib/server/accounting/statements'
import {
  trialBalanceCsv,
  profitAndLossCsv,
  balanceSheetCsv,
} from '@/lib/server/accounting/statementsCsv'

// GET /api/accounts/statements — Accounts A2 statements over the
// A1 journal. Query params:
//   type    = trial-balance | pl | balance-sheet   (required)
//   period  = YYYY-MM (accounting period; default = latest period
//             containing journal entries)
//   scope   = period | fytd    (trial-balance / pl; default period)
//   branch_id = uuid           (pl only; omit = company)
//   asof    = YYYY-MM-DD       (balance-sheet; default = period end)
//   format  = json | csv       (default json; csv = download with
//             the identical figures, audit-export header pattern)
// All figures come from journal_lines of posted entries only —
// see lib/server/accounting/statements.ts for the honesty rules.
// Admin-only (same gate as every /api/accounts/* route).
export const dynamic = 'force-dynamic'

const TYPES = ['trial-balance', 'pl', 'balance-sheet'] as const

export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const url = new URL(req.url)
    const type = url.searchParams.get('type') || ''
    if (!TYPES.includes(type as any)) {
      return NextResponse.json(
        { error: `Unknown statement type. Use one of: ${TYPES.join(', ')}` },
        { status: 400 }
      )
    }
    const format = (url.searchParams.get('format') || 'json').toLowerCase()
    const db = prisma as any
    const meta = await statementMeta(db)

    const periodMonth = url.searchParams.get('period') || meta.default_period
    const period = meta.periods.find((p) => p.month === periodMonth)
    if (!period) {
      return NextResponse.json({ error: `Unknown period: ${periodMonth}` }, { status: 400 })
    }
    const scopeKind = (url.searchParams.get('scope') || 'period').toLowerCase()
    if (scopeKind !== 'period' && scopeKind !== 'fytd') {
      return NextResponse.json({ error: 'scope must be "period" or "fytd"' }, { status: 400 })
    }
    const scope = await resolveScopeFor(db, periodMonth, scopeKind as 'period' | 'fytd')
    if (!scope) return NextResponse.json({ error: `Unknown period: ${periodMonth}` }, { status: 400 })

    const metaJson = {
      periods: meta.periods,
      branches: meta.branches,
      opening: meta.opening
        ? {
            status: meta.opening.status,
            label: meta.opening.label,
            as_of: meta.opening.as_of,
            equity_draft: meta.opening.equity_draft != null ? taka(meta.opening.equity_draft) : null,
          }
        : null,
      journal_coverage: meta.journal_coverage,
      default_period: meta.default_period,
    }

    if (type === 'trial-balance') {
      const stmt = await trialBalanceStatement(db, scope)
      if (format === 'csv') return csvResponse(trialBalanceCsv(stmt, scope.label), `trial-balance-${periodMonth}-${scopeKind}.csv`)
      return NextResponse.json({
        meta: metaJson,
        type,
        scope,
        statement: {
          rows: stmt.rows.map((r) => ({
            code: r.code, name: r.name, type: r.type,
            debit: taka(r.debit), credit: taka(r.credit), balance: taka(r.balance),
          })),
          total_debit: taka(stmt.total_debit),
          total_credit: taka(stmt.total_credit),
          difference: taka(stmt.difference),
          balanced: stmt.balanced,
          entry_count: stmt.entry_count,
        },
      })
    }

    if (type === 'pl') {
      const branchId = url.searchParams.get('branch_id') || null
      if (branchId && !meta.branches.some((b) => b.id === branchId)) {
        return NextResponse.json({ error: `Unknown branch_id: ${branchId}` }, { status: 400 })
      }
      const stmt = await profitAndLoss(db, scope, branchId)
      const branchName = branchId ? meta.branches.find((b) => b.id === branchId)?.name : null
      if (format === 'csv') return csvResponse(profitAndLossCsv(stmt, scope.label, branchName), `profit-loss-${periodMonth}-${scopeKind}.csv`)
      const rowJson = (r: { code: string; name: string; amount: number }) => ({
        code: r.code, name: r.name, amount: taka(r.amount),
      })
      return NextResponse.json({
        meta: metaJson,
        type,
        scope,
        statement: {
          income: stmt.income.map(rowJson),
          expenses: stmt.expenses.map(rowJson),
          total_income: taka(stmt.total_income),
          total_expenses: taka(stmt.total_expenses),
          net: taka(stmt.net),
          entry_count: stmt.entry_count,
          branch_id: stmt.branch_id,
          by_branch: stmt.by_branch
            ? stmt.by_branch.map((b) => ({
                branch_id: b.branch_id, branch_name: b.branch_name,
                income: taka(b.income), expenses: taka(b.expenses), net: taka(b.net),
              }))
            : null,
          notes: {
            journal_from: stmt.notes.journal_from,
            journal_to: stmt.notes.journal_to,
            opening_status: stmt.notes.opening_status,
            opening_equity_draft: stmt.notes.opening_equity_draft != null ? taka(stmt.notes.opening_equity_draft) : null,
            uncosted_chalans: stmt.notes.uncosted_chalans,
            uncosted_chalan_sale: taka(stmt.notes.uncosted_chalan_sale),
            total_chalans: stmt.notes.total_chalans,
          },
        },
      })
    }

    // balance-sheet
    const asof = url.searchParams.get('asof') || period.end
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asof)) {
      return NextResponse.json({ error: 'asof must be YYYY-MM-DD' }, { status: 400 })
    }
    const stmt = await balanceSheet(db, asof)
    if (format === 'csv') return csvResponse(balanceSheetCsv(stmt), `balance-sheet-${asof}.csv`)
    const rowJson = (r: { code: string; name: string; amount: number }) => ({
      code: r.code, name: r.name, amount: taka(r.amount),
    })
    return NextResponse.json({
      meta: metaJson,
      type,
      as_of: stmt.as_of,
      statement: {
        assets: stmt.assets.map(rowJson),
        liabilities: stmt.liabilities.map(rowJson),
        equity: stmt.equity.map(rowJson),
        total_assets: taka(stmt.total_assets),
        total_liabilities: taka(stmt.total_liabilities),
        total_equity: taka(stmt.total_equity),
        current_result: taka(stmt.current_result),
        total_liabilities_equity: taka(stmt.total_liabilities_equity),
        balanced: stmt.balanced,
        entry_count: stmt.entry_count,
        provisional: stmt.provisional,
        opening_status: stmt.opening_status,
      },
    })
  } catch (err: any) {
    console.error('[accounts] statements failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function csvResponse(body: string, filename: string) {
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
