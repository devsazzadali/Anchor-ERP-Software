import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit, diffFields } from '@/lib/server/audit'
import { trialBalance, taka } from '@/lib/server/accounting/reports'

// /api/accounts/chart — Chart of Accounts (Accounts A1).
// GET: every account with its posted balance (trial-balance math).
// POST: create an account (admin). PATCH: rename / activate /
// deactivate — code and type are immutable once an account exists
// (blueprint §B.1), so they are simply not accepted here. All
// mutations write unified audit rows.
export const dynamic = 'force-dynamic'

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense']

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
    const tb = await trialBalance(prisma as any)
    const byId = new Map(tb.rows.map((r) => [r.account_id, r]))
    const accounts = await prisma.chartAccount.findMany({ orderBy: { code: 'asc' } })
    const heads = await prisma.ledgerHead.findMany({ select: { id: true, name: true } })
    const headName = new Map(heads.map((h) => [h.id, h.name]))
    return NextResponse.json({
      accounts: accounts.map((a) => {
        const bal = byId.get(a.id)
        return {
          id: a.id,
          code: a.code,
          name: a.name,
          name_bn: a.name_bn,
          type: a.type,
          parent_id: a.parent_id,
          branch_dimension: a.branch_dimension,
          ledger_head: a.ledger_head_id ? headName.get(a.ledger_head_id) ?? null : null,
          is_system: a.is_system,
          is_active: a.is_active,
          debit: taka(bal?.debit ?? 0),
          credit: taka(bal?.credit ?? 0),
          balance: taka(bal?.balance ?? 0),
        }
      }),
      totals: {
        total_debit: taka(tb.total_debit),
        total_credit: taka(tb.total_credit),
        balanced: tb.balanced,
      },
    })
  } catch (err: any) {
    console.error('[accounts] chart GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const body = await req.json().catch(() => ({}))
    const code = String(body.code ?? '').trim()
    const name = String(body.name ?? '').trim()
    const type = String(body.type ?? '').trim()
    if (!code || !name || !TYPES.includes(type)) {
      return NextResponse.json(
        { error: 'code, name and a valid type (asset/liability/equity/income/expense) are required' },
        { status: 400 }
      )
    }
    const existing = await prisma.chartAccount.findUnique({ where: { code } })
    if (existing) return NextResponse.json({ error: `Account code ${code} already exists` }, { status: 409 })
    let parentId: string | null = null
    if (body.parent_id) {
      const parent = await prisma.chartAccount.findUnique({ where: { id: String(body.parent_id) } })
      if (!parent) return NextResponse.json({ error: 'Parent account not found' }, { status: 400 })
      parentId = parent.id
    }
    const created = await prisma.chartAccount.create({
      data: {
        code,
        name,
        name_bn: body.name_bn ? String(body.name_bn) : null,
        type,
        parent_id: parentId,
        branch_dimension: !!body.branch_dimension,
        is_system: false,
        is_active: true,
      },
    })
    await logAudit({
      caller: g.caller,
      req,
      action: 'accounts.chart_create',
      eventType: 'create',
      entityTable: 'chart_accounts',
      entityId: created.id,
      newValue: { code, name, type } as any,
    })
    return NextResponse.json({ account: { id: created.id, code: created.code, name: created.name, type: created.type } })
  } catch (err: any) {
    console.error('[accounts] chart POST failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const body = await req.json().catch(() => ({}))
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    const before = await prisma.chartAccount.findUnique({ where: { id } })
    if (!before) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    const patch: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
    if (typeof body.name_bn === 'string') patch.name_bn = body.name_bn.trim() || null
    if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update (name, name_bn, is_active only)' }, { status: 400 })
    }
    const updated = await prisma.chartAccount.update({ where: { id }, data: patch as any })
    await logAudit({
      caller: g.caller,
      req,
      action: 'accounts.chart_update',
      eventType: 'update',
      entityTable: 'chart_accounts',
      entityId: id,
      fieldChanges: diffFields(before as any, updated as any, ['name', 'name_bn', 'is_active']),
    })
    return NextResponse.json({ account: { id: updated.id, code: updated.code, name: updated.name, is_active: updated.is_active } })
  } catch (err: any) {
    console.error('[accounts] chart PATCH failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
