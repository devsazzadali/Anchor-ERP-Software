import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { parseMoneyAmount, roundMoney } from '@/lib/money'
import { expenseKindOf } from '@/lib/expense-streams'

export const dynamic = 'force-dynamic'

// company expenses — expense stream 2 of
// the owner's model (money spent FROM the company profile), with
// the setup-vs-operating split on expense_kind (settled spec,
// lib/expense-streams.ts). Admin-gated on every method (the old page
// wrote the table straight from the browser under RLS). Money is
// recomputed server-side: due is ALWAYS total − paid (C28) — the
// client never stores an independent due figure. The page's
// localStorage fallback (aura_company_expenses, audit A9/C41) is
// deleted: this route is the only source.

// GET /api/admin/company-expenses — complete list (no 1,000-row cap,
// C38), newest first, id tiebreak — the order the page always used.
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const data = await prisma.companyExpense.findMany({
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    })
    return NextResponse.json({ expenses: toPlain(data) || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/admin/company-expenses — create one company expense.
// Body: { purpose, total_amount, paid_amount, branch_id,
// branch_name, is_all_branches, expense_kind }
// created_by / created_by_name come from the CALLER, never the body.
export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : ''
    if (!purpose) return NextResponse.json({ error: 'purpose is required' }, { status: 400 })

    const total = parseMoneyAmount(body.total_amount, { min: 0.01 })
    if (total === null) return NextResponse.json({ error: 'Valid total required.' }, { status: 400 })
    const paid = body.paid_amount === undefined || body.paid_amount === null
      ? 0
      : parseMoneyAmount(body.paid_amount)
    if (paid === null || paid > total) return NextResponse.json({ error: 'Invalid paid amount.' }, { status: 400 })

    const data = await prisma.companyExpense.create({
      data: {
        purpose,
        total_amount: total,
        paid_amount: paid,
        // C28: due recomputed server-side, poisha-exact.
        due_amount: roundMoney(total - paid),
        branch_id: body.branch_id || null,
        branch_name: body.branch_name || null,
        is_all_branches: !!body.is_all_branches,
        // Anything not explicitly 'setup' is 'operating'
        // (expenseKindOf's rule — a one-time opening cost must be a
        // deliberate mark).
        expense_kind: expenseKindOf(body),
        created_by: caller.uid,
        created_by_name: caller.full_name,
      },
    })
    return NextResponse.json({ expense: toPlain(data) }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/admin/company-expenses?id=<uuid>
// The page's inline edit: paid_amount (+ expense_kind). Due is
// recomputed from the STORED total (C28), never taken from the body.
export async function PATCH(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const existing = await prisma.companyExpense.findFirst({
      where: { id },
      select: { id: true, total_amount: true },
    })
    if (!existing) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })

    const body = await req.json()
    const patch: Record<string, unknown> = {}

    if ('paid_amount' in body) {
      const paid = parseMoneyAmount(body.paid_amount)
      const total = Number(existing.total_amount)
      if (paid === null || paid > total) {
        return NextResponse.json({ error: 'Invalid paid amount.' }, { status: 400 })
      }
      patch.paid_amount = paid
      patch.due_amount = roundMoney(total - paid)
    }
    if ('expense_kind' in body) {
      patch.expense_kind = expenseKindOf(body)
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const data = await prisma.companyExpense.update({ where: { id }, data: patch as any })
    return NextResponse.json({ expense: toPlain(data) })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/admin/company-expenses?id=<uuid>
export async function DELETE(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    await prisma.companyExpense.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
