import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { logAudit, diffFields } from '@/lib/server/audit'

// /api/admin/profiles/[id] — admin-only profile administration
// used by the admin users page for fields the /api/admin/users
// routes do not cover.
// PATCH — whitelisted administrative fields only: branch_id,
//   position_id, salary, profile_type, joining_date, is_banned.
// DELETE — removes the profile row (the old page deleted the
//   profile record directly; the auth account is handled by the
//   /api/admin/users routes).
const PATCHABLE = ['branch_id', 'position_id', 'salary', 'profile_type', 'joining_date', 'is_banned'] as const

async function requireAdmin(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!callerIsAdmin(caller)) return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  return { caller }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error
    const { id } = await params

    const body = await req.json()
    const data: any = {}
    for (const key of PATCHABLE) {
      if (body[key] !== undefined) data[key] = body[key]
    }
    if (data.salary !== undefined && data.salary !== null) data.salary = Number(data.salary) as any
    if (data.joining_date) data.joining_date = new Date(data.joining_date)

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
    }

    const before = await prisma.profile.findUnique({ where: { id } }).catch(() => null)
    const profile = await prisma.profile.update({ where: { id }, data })
    const verificationTouched = data.is_banned !== undefined || data.profile_type !== undefined
    await logAudit({
      caller: gate.caller, req,
      action: 'profile.update',
      eventType: verificationTouched ? 'verification' : 'update',
      entityTable: 'profiles', entityId: id,
      branchId: (profile as any).branch_id ?? null,
      fieldChanges: diffFields(before as any, profile as any, [...PATCHABLE] as unknown as string[]),
    })
    return NextResponse.json({ profile: toPlain(profile) })
  } catch (err: any) {
    console.error('[PATCH /api/admin/profiles/[id]] Error:', err)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error
    const { id } = await params

    const before = await prisma.profile.findUnique({ where: { id } }).catch(() => null)
    await prisma.profile.delete({ where: { id } })
    await logAudit({
      caller: gate.caller, req, action: 'profile.delete', eventType: 'delete',
      entityTable: 'profiles', entityId: id,
      oldValue: before ? { email: before.email, full_name: before.full_name, role: before.role } as any : null,
    })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[DELETE /api/admin/profiles/[id]] Error:', err)
    return NextResponse.json({ error: 'Failed to delete profile' }, { status: 500 })
  }
}
