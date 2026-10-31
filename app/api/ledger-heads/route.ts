import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// caller resolution = the single
// role-resolution function (role OR admin_users — the original
// resolveCaller rule). Ledger heads via Prisma.

// GET /api/ledger-heads
// Admin: returns all heads (active + inactive)
// Authenticated non-admin: returns only is_active = true heads
// Query params:
//   ?include_inactive=true  (admin only — returns all heads)
//   ?code_number=23          (fetch single head by code)
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const isAdmin = callerIsAdmin(caller)

    const { searchParams } = new URL(req.url)
    const includeInactive = isAdmin && searchParams.get('include_inactive') === 'true'
    const codeParam = searchParams.get('code_number')

    const where: any = {}
    if (!includeInactive) where.is_active = true
    if (codeParam) {
      const code = parseInt(codeParam, 10)
      if (!isNaN(code)) where.code_number = code
    }

    const data = await prisma.ledgerHead.findMany({
      where,
      select: {
        id: true, code_number: true, name: true, ledger_type: true, is_active: true,
        reference_creation_date: true, created_at: true, updated_at: true,
      },
      orderBy: { code_number: 'asc' },
    })

    return NextResponse.json({ ledger_heads: toPlain(data) || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/ledger-heads
// Admin only — create a new Ledger Head
// Body: { code_number, name, ledger_type?, reference_creation_date? }
// code_number must be unique. Validated server-side.
export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })

    const body = await req.json()
    const { code_number, name, ledger_type, reference_creation_date } = body

    // Validate required fields
    if (!code_number || typeof code_number !== 'number' || !Number.isInteger(code_number) || code_number <= 0) {
      return NextResponse.json({ error: 'code_number must be a positive integer' }, { status: 400 })
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (name.trim().length > 100) {
      return NextResponse.json({ error: 'name must be 100 characters or fewer' }, { status: 400 })
    }

    const resolvedType = (ledger_type || 'All').trim()

    // Check for duplicate code_number
    const existing = await prisma.ledgerHead.findFirst({
      where: { code_number },
      select: { id: true, name: true },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Code ' + code_number + ' already exists as "' + existing.name + '". Each Ledger Head code must be unique.' },
        { status: 409 }
      )
    }

    const payload: any = {
      code_number,
      name: name.trim(),
      ledger_type: resolvedType,
      is_active: true,
    }
    if (reference_creation_date) {
      payload.reference_creation_date = reference_creation_date
    }

    try {
      const data = await prisma.ledgerHead.create({ data: payload })
      return NextResponse.json({ success: true, ledger_head: toPlain(data) }, { status: 201 })
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/ledger-heads?id=<uuid>
// Admin only — update a Ledger Head
// Allowed: name, ledger_type, is_active, reference_creation_date
// NOT allowed: code_number (immutable after creation)
// Deactivation (is_active=false) is allowed even if expenses reference this head.
// True deletion is NOT supported — use is_active=false.
export async function PATCH(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 })

    // Verify the ledger head exists
    const existing = await prisma.ledgerHead.findFirst({
      where: { id },
      select: { id: true, code_number: true, name: true, ledger_type: true, is_active: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Ledger Head not found' }, { status: 404 })
    }

    const body = await req.json()

    // code_number is immutable — reject if client attempts to change it
    if ('code_number' in body && body.code_number !== existing.code_number) {
      return NextResponse.json(
        { error: 'code_number is immutable after creation and cannot be changed' },
        { status: 400 }
      )
    }

    // Build safe update payload (only allowed fields)
    const patch: any = {}

    if ('name' in body) {
      const trimmed = String(body.name || '').trim()
      if (!trimmed) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
      if (trimmed.length > 100) return NextResponse.json({ error: 'name must be 100 characters or fewer' }, { status: 400 })
      patch.name = trimmed
    }

    if ('ledger_type' in body) {
      const trimmed = String(body.ledger_type || '').trim()
      if (!trimmed) return NextResponse.json({ error: 'ledger_type cannot be empty' }, { status: 400 })
      patch.ledger_type = trimmed
    }

    if ('is_active' in body) {
      patch.is_active = !!body.is_active
    }

    if ('reference_creation_date' in body) {
      patch.reference_creation_date = body.reference_creation_date || null
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    try {
      const data = await prisma.ledgerHead.update({ where: { id }, data: patch })
      return NextResponse.json({ success: true, ledger_head: toPlain(data) })
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE is NOT implemented.
// Ledger Heads are accounting master data. Use PATCH { is_active: false }.
export async function DELETE() {
  return NextResponse.json(
    {
      error: 'DELETE is not supported for Ledger Heads.',
      action: 'Use PATCH { is_active: false } to deactivate a Ledger Head.',
    },
    { status: 405 }
  )
}
