import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'

// GET /api/accounts/journal — the journal viewer feed (Accounts A1).
// Filters: from, to (YYYY-MM-DD), account_id, source_table,
// event_type, branch_id, q (memo search), page, page_size.
// Read-only: the journal is append-only — no write method exists
// here by design.
export const dynamic = 'force-dynamic'

const dec = (v: any): string => (v == null ? '0.00' : v.toString())

export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }
    const url = new URL(req.url)
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('page_size') ?? 25)))
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const accountId = url.searchParams.get('account_id')
    const sourceTable = url.searchParams.get('source_table')
    const eventType = url.searchParams.get('event_type')
    const branchId = url.searchParams.get('branch_id')
    const q = url.searchParams.get('q')

    const where: Record<string, unknown> = { status: 'posted' }
    if (from || to) {
      where.entry_date = {
        ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
        ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}),
      }
    }
    if (sourceTable) where.source_table = sourceTable
    if (eventType) where.event_type = eventType
    if (q) where.memo = { contains: q, mode: 'insensitive' }
    if (accountId || branchId) {
      const lineWhere: Record<string, unknown> = {}
      if (accountId) lineWhere.account_id = accountId
      if (branchId) lineWhere.branch_id = branchId
      const lineRows = await prisma.journalLine.findMany({
        where: lineWhere,
        select: { entry_id: true },
        distinct: ['entry_id'],
      })
      where.id = { in: lineRows.map((r) => r.entry_id) }
    }

    const [total, entries] = await Promise.all([
      prisma.journalEntry.count({ where: where as any }),
      prisma.journalEntry.findMany({
        where: where as any,
        orderBy: [{ entry_date: 'desc' }, { created_at: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    const entryIds = entries.map((e) => e.id)
    const lines = entryIds.length
      ? await prisma.journalLine.findMany({ where: { entry_id: { in: entryIds } } })
      : []
    const accountIds = [...new Set(lines.map((l) => l.account_id))]
    const accounts = accountIds.length
      ? await prisma.chartAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, code: true, name: true } })
      : []
    const acctOf = new Map(accounts.map((a) => [a.id, a]))
    const branchIds = [...new Set(lines.map((l) => l.branch_id).filter(Boolean))] as string[]
    const branches = branchIds.length
      ? await prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
      : []
    const branchOf = new Map(branches.map((b) => [b.id, b.name]))

    return NextResponse.json({
      total,
      page,
      page_size: pageSize,
      entries: entries.map((e) => {
        const entryLines = lines.filter((l) => l.entry_id === e.id)
        return {
          id: e.id,
          entry_date: e.entry_date.toISOString().slice(0, 10),
          event_type: e.event_type,
          source_table: e.source_table,
          source_id: e.source_id,
          memo: e.memo,
          is_reversal: e.is_reversal,
          reverses_entry_id: e.reverses_entry_id,
          total: entryLines.reduce((a, l) => a + Number(dec(l.debit)), 0).toFixed(2),
          lines: entryLines.map((l) => ({
            account_code: acctOf.get(l.account_id)?.code ?? '?',
            account_name: acctOf.get(l.account_id)?.name ?? '?',
            branch: l.branch_id ? branchOf.get(l.branch_id) ?? null : null,
            debit: dec(l.debit),
            credit: dec(l.credit),
            memo: l.memo,
          })),
        }
      }),
    })
  } catch (err: any) {
    console.error('[accounts] journal GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
