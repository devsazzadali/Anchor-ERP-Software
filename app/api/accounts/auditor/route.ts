import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { statementMeta } from '@/lib/server/accounting/statements'
import {
  buildAuditorBundle,
  AuditorError,
  type AuditorScopeInput,
} from '@/lib/server/accounting/auditor'
import { auditorPackageFiles } from '@/lib/server/accounting/auditorCsv'
import { buildZip } from '@/lib/server/accounting/auditorZip'

// GET /api/accounts/auditor — Accounts A10 auditor package.
// Query params:
//   scope  = full | fiscal_year | period   (default full)
//   period = YYYY-MM                        (scope=period)
//   fy     = fiscal-year label, e.g. 2026-27 (scope=fiscal_year)
//   format = zip | json | meta              (default zip)
//     zip  — ONE downloadable bundle: README + bundle.json + a CSV
//            per section (the statements CSVs are A2's renderers).
//     json — the structured bundle alone (bundle.json contents).
//     meta — picker data for the screen (periods, fiscal years,
//            coverage, opening status); no package is built.
// Every figure is produced by the stage services behind the
// Accounts screens (see lib/server/accounting/auditor.ts) — the
// package cannot disagree with them. Read-only: this route never
// writes. Admin-only (same gate as every /api/accounts/* route).
export const dynamic = 'force-dynamic'

async function gate(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!callerIsAdmin(caller)) {
    return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  }
  return { caller }
}

export async function GET(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const db = prisma as any
    const url = new URL(req.url)
    const format = (url.searchParams.get('format') || 'zip').toLowerCase()

    if (format === 'meta') {
      const meta = await statementMeta(db)
      const years = await db.fiscalYear.findMany({ orderBy: { start_date: 'asc' } })
      return NextResponse.json({
        periods: meta.periods,
        fiscal_years: years.map((y: any) => ({
          label: y.label,
          start: y.start_date.toISOString().slice(0, 10),
          end: y.end_date.toISOString().slice(0, 10),
          status: y.status,
        })),
        default_period: meta.default_period,
        journal_coverage: meta.journal_coverage,
        opening: meta.opening
          ? { status: meta.opening.status, as_of: meta.opening.as_of }
          : null,
      })
    }

    const scopeKind = (url.searchParams.get('scope') || 'full').toLowerCase()
    if (scopeKind !== 'full' && scopeKind !== 'fiscal_year' && scopeKind !== 'period') {
      return NextResponse.json({ error: 'scope must be "full", "fiscal_year" or "period"' }, { status: 400 })
    }
    const input: AuditorScopeInput = {
      kind: scopeKind,
      period: url.searchParams.get('period'),
      fy_label: url.searchParams.get('fy'),
    }

    const pkg = await buildAuditorBundle(db, input)

    if (format === 'json') {
      return new NextResponse(JSON.stringify(pkg.bundle, null, 2) + '\n', {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${pkg.filename_base}.json"`,
        },
      })
    }
    if (format !== 'zip') {
      return NextResponse.json({ error: 'format must be "zip", "json" or "meta"' }, { status: 400 })
    }

    const zip = buildZip(auditorPackageFiles(pkg))
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${pkg.filename_base}.zip"`,
        'Content-Length': String(zip.length),
      },
    })
  } catch (err: any) {
    if (err instanceof AuditorError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[accounts] auditor GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
