import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { logAudit, diffFields } from '@/lib/server/audit'

// /api/admin/branches — admin-only branch registry.
// GET: all branches (id, name by default; ?full=1 returns full rows).
// POST { name }: create a branch (the admin create-branch page).
// PATCH { id, name?, address?, phone?, city?, manager_id? }: edit a
// branch (FR-14.4 — a typo'd branch name previously had NO edit
// path at all; every referencing screen prints branch_name from
// source rows, and the live name comes from this registry).
// DELETE { id }: delete a branch (the admin branches page).
async function requireAdmin(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!callerIsAdmin(caller)) return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  return { caller }
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const full = new URL(req.url).searchParams.get('full') === '1'
    const branches = full
      ? await prisma.branch.findMany({ orderBy: { name: 'asc' } })
      : await prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })

    return NextResponse.json({ branches: toPlain(branches) })
  } catch (err: any) {
    console.error('[GET /api/admin/branches] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch branches' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const { name } = await req.json()
    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: 'Branch name is required' }, { status: 400 })
    }

    const branch = await prisma.branch.create({ data: { name: String(name).trim() } })
    await logAudit({
      caller: gate.caller, req, action: 'branch.create', eventType: 'create',
      entityTable: 'branches', entityId: branch.id, branchId: branch.id,
      fieldChanges: diffFields(null, branch as any, ['name']),
    })
    return NextResponse.json({ branch: toPlain(branch) })
  } catch (err: any) {
    console.error('[POST /api/admin/branches] Error:', err)
    return NextResponse.json({ error: 'Failed to create branch' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const body = await req.json().catch(() => ({}))
    const id = body.id
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const existing = await prisma.branch.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Branch not found' }, { status: 404 })

    const patch: Record<string, unknown> = {}
    if ('name' in body) {
      const name = String(body.name || '').trim()
      if (!name) return NextResponse.json({ error: 'Branch name cannot be empty' }, { status: 400 })
      patch.name = name
    }
    if ('address' in body) patch.address = body.address ? String(body.address).trim() || null : null
    if ('phone' in body) patch.phone = body.phone ? String(body.phone).trim() || null : null
    if ('city' in body) patch.city = body.city ? String(body.city).trim() || null : null
    if ('manager_id' in body) {
      if (body.manager_id) {
        const mgr = await prisma.profile.findUnique({ where: { id: String(body.manager_id) }, select: { id: true } })
        if (!mgr) return NextResponse.json({ error: 'Manager profile not found' }, { status: 400 })
        patch.manager_id = String(body.manager_id)
      } else {
        patch.manager_id = null
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const branch = await prisma.branch.update({ where: { id }, data: patch as any })
    // Audit (law E2): old → new on every changed field.
    await prisma.activityLog.create({
      data: {
        user_id: gate.caller.id,
        action: 'BRANCH_EDIT',
        details: {
          branch_id: id,
          changes: Object.fromEntries(Object.keys(patch).map((k) => [k, { from: (existing as any)[k] ?? null, to: (patch as any)[k] ?? null }])),
        },
      },
    }).catch((e: any) => console.error('[PATCH /api/admin/branches] audit write failed:', e.message))
    await logAudit({
      caller: gate.caller, req, action: 'branch.update', eventType: 'update',
      entityTable: 'branches', entityId: id, branchId: id,
      fieldChanges: diffFields(existing as any, branch as any, ['name', 'address', 'phone', 'city', 'manager_id']),
    })
    return NextResponse.json({ branch: toPlain(branch) })
  } catch (err: any) {
    console.error('[PATCH /api/admin/branches] Error:', err)
    return NextResponse.json({ error: 'Failed to update branch' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const before = await prisma.branch.findUnique({ where: { id } }).catch(() => null)
    await prisma.branch.delete({ where: { id } })
    await logAudit({
      caller: gate.caller, req, action: 'branch.delete', eventType: 'delete',
      entityTable: 'branches', entityId: id, branchId: id,
      oldValue: before ? { name: before.name } as any : null,
    })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[DELETE /api/admin/branches] Error:', err)
    return NextResponse.json({ error: 'Failed to delete branch' }, { status: 500 })
  }
}
