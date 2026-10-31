import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// /api/admin/positions — admin-only positions management for the
// admin users page. GET: all positions. POST { name }: create.
// DELETE { id }: delete.
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

    const positions = await prisma.position.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json({ positions: toPlain(positions) })
  } catch (err: any) {
    console.error('[GET /api/admin/positions] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch positions' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const body = await req.json()
    if (!body.name || !String(body.name).trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const position = await prisma.position.create({
      data: { name: String(body.name).trim() },
    })
    return NextResponse.json({ position: toPlain(position) })
  } catch (err: any) {
    console.error('[POST /api/admin/positions] Error:', err)
    return NextResponse.json({ error: 'Failed to create position' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const body = await req.json()
    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }
    await prisma.position.delete({ where: { id: body.id } })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[DELETE /api/admin/positions] Error:', err)
    return NextResponse.json({ error: 'Failed to delete position' }, { status: 500 })
  }
}
