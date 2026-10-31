import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// /api/admin/branches — admin-only branch registry.
// GET: all branches (id, name by default; ?full=1 returns full rows).
// POST { name }: create a branch (the admin create-branch page).
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
    return NextResponse.json({ branch: toPlain(branch) })
  } catch (err: any) {
    console.error('[POST /api/admin/branches] Error:', err)
    return NextResponse.json({ error: 'Failed to create branch' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    await prisma.branch.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[DELETE /api/admin/branches] Error:', err)
    return NextResponse.json({ error: 'Failed to delete branch' }, { status: 500 })
  }
}
