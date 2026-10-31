import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { logAudit } from '@/lib/server/audit'

// GET /api/admin/audit — admin-only audit bundle for the security
// audit page: activity_logs (100, with operator profile embed),
// branch_audit_trail (100) and fraud-flagged payment_requests (20,
// with applicant profile embed) — the three streams the page read
// browser-direct before. Branch trail rows are shaped to the page's
// expected embed form (branches.name / profiles.full_name /
// old_values / new_values) from the model's branch_name /
// performed_by_name / old_value / new_value columns.
//
// S1 (Security Round): the bundle ALSO carries the unified stream
// (`unified` — audit_logs rows, newest first, take ≤200) with
// optional filters: ?actor= ?from= ?to= ?event_type= ?entity=.
// ?export=csv returns the filtered unified stream as a CSV download
// (text/csv + Content-Disposition) instead of JSON, and the export
// itself is written to the unified log. The viewer is read-only —
// no delete/edit path exists here or may be added.

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })

    const url = new URL(req.url)
    const actor = url.searchParams.get('actor')?.trim() || null
    const from = url.searchParams.get('from')?.trim() || null
    const to = url.searchParams.get('to')?.trim() || null
    const eventType = url.searchParams.get('event_type')?.trim() || null
    const entity = url.searchParams.get('entity')?.trim() || null
    const exportCsv = url.searchParams.get('export') === 'csv'

    // Unified-stream filter (audit_logs).
    const unifiedWhere: any = {}
    if (actor) {
      unifiedWhere.OR = [
        { actor_name: { contains: actor, mode: 'insensitive' } },
        ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor)
          ? [{ actor_id: actor }]
          : []),
      ]
    }
    if (eventType) unifiedWhere.event_type = eventType
    if (entity) {
      const entityOr = [
        { entity_table: { contains: entity, mode: 'insensitive' } },
        { entity_id: { contains: entity } },
        { table_name: { contains: entity, mode: 'insensitive' } },
      ]
      unifiedWhere.AND = [...(unifiedWhere.AND || []), { OR: entityOr }]
    }
    if (from || to) {
      unifiedWhere.created_at = {
        ...(from ? { gte: new Date(from.length === 10 ? `${from}T00:00:00.000Z` : from) } : {}),
        ...(to ? { lte: new Date(to.length === 10 ? `${to}T23:59:59.999Z` : to) } : {}),
      }
    }

    if (exportCsv) {
      const rows = await prisma.auditLog.findMany({
        where: unifiedWhere,
        orderBy: { created_at: 'desc' },
        take: 1000,
      })
      const header = [
        'id', 'created_at', 'actor_name', 'actor_role', 'actor_id',
        'event_type', 'action', 'entity_table', 'entity_id', 'branch_id',
        'ip_address', 'user_agent', 'field_changes',
      ]
      const lines = [header.join(',')]
      for (const r of rows as any[]) {
        lines.push(header.map((h) => csvCell(h === 'created_at' ? r.created_at?.toISOString?.() ?? r.created_at : r[h])).join(','))
      }
      await logAudit({
        caller, req, action: 'audit.export_csv', eventType: 'export',
        entityTable: 'audit_logs', entityId: null,
        newValue: { rows: rows.length, filters: { actor, from, to, event_type: eventType, entity } } as any,
      })
      return new NextResponse(lines.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="unified-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      })
    }

    const [actRows, trailRows, fraudRows, unifiedRows] = await Promise.all([
      prisma.activityLog.findMany({ orderBy: { created_at: 'desc' }, take: 100 }),
      prisma.branchAuditTrail.findMany({ orderBy: { created_at: 'desc' }, take: 100 }),
      prisma.paymentRequest.findMany({
        where: { status: 'fraud_flagged' },
        orderBy: { created_at: 'desc' },
        take: 20,
      }),
      prisma.auditLog.findMany({
        where: unifiedWhere,
        orderBy: { created_at: 'desc' },
        take: 200,
      }),
    ])

    const profileIds = [...new Set([
      ...actRows.map((r) => r.user_id).filter(Boolean) as string[],
      ...fraudRows.map((r) => r.user_id).filter(Boolean),
    ])]
    const profs = profileIds.length
      ? await prisma.profile.findMany({
          where: { id: { in: profileIds } },
          select: { id: true, full_name: true, role: true },
        })
      : []
    const profById = new Map(profs.map((p) => [p.id, p]))

    const branchIds = [...new Set(trailRows.map((r) => r.branch_id).filter(Boolean) as string[])]
    const branches = branchIds.length
      ? await prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
      : []
    const branchById = new Map(branches.map((b) => [b.id, b.name]))

    const activityLogs = actRows.map((r) => {
      const p: any = r.user_id ? profById.get(r.user_id) : null
      return { ...r, profiles: p ? { full_name: p.full_name, role: p.role } : null }
    })

    const branchTrail = trailRows.map((r: any) => ({
      ...r,
      branches: { name: r.branch_name || (r.branch_id ? branchById.get(r.branch_id) : null) || null },
      profiles: { full_name: r.performed_by_name || null },
      old_values: r.old_value ?? null,
      new_values: r.new_value ?? null,
      user_agent: null,
    }))

    const fraudData = fraudRows.map((f) => {
      const p: any = profById.get(f.user_id)
      return { ...f, profiles: p ? { full_name: p.full_name } : null }
    })

    // Unified rows: resolve branch names for display when possible.
    const unifiedBranchIds = [...new Set(unifiedRows.map((r) => r.branch_id).filter(Boolean) as string[])]
    const unifiedBranches = unifiedBranchIds.length
      ? await prisma.branch.findMany({ where: { id: { in: unifiedBranchIds } }, select: { id: true, name: true } })
      : []
    const unifiedBranchById = new Map(unifiedBranches.map((b) => [b.id, b.name]))
    const unified = unifiedRows.map((r: any) => ({
      ...r,
      branch_name: r.branch_id ? unifiedBranchById.get(r.branch_id) || null : null,
    }))

    return NextResponse.json(toPlain({ activityLogs, branchTrail, fraudData, unified }))
  } catch (err: any) {
    console.error('[GET /api/admin/audit] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch audit data' }, { status: 500 })
  }
}
