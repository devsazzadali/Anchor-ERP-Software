import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit, diffFields } from '@/lib/server/audit'
import {
  createBankAccount,
  updateBankAccount,
  confirmBankOpening,
  BankError,
} from '@/lib/server/accounting/bank'
import { bankSummary, BankRecError } from '@/lib/server/accounting/bankrec'

// /api/accounts/bank — bank master list + create/update/opening
// confirmation (A4). GET: every bank account with its chart code,
// journal (book) balance, statement-line counts, statement balance
// (+ basis) and the statement−journal difference. POST actions
// (admin-only, S1-audited):
//   {action:'create', bank_name, account_name, account_number?, account_type?, label?}
//   {action:'update', id, label?, bank_name?, account_name?, account_number?, account_type?, is_active?}
//   {action:'confirm_opening', id, opening_balance, opening_balance_date}
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
    const rows = await db.bankAccount.findMany({ orderBy: { created_at: 'asc' } })
    const accounts = []
    for (const row of rows) accounts.push(await bankSummary(db, row))
    return NextResponse.json({ accounts })
  } catch (err: any) {
    console.error('[accounts] bank GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    const db = prisma as any

    if (action === 'create') {
      const row = await createBankAccount(db, {
        bank_name: body.bank_name,
        account_name: body.account_name,
        account_number: body.account_number ?? null,
        account_type: body.account_type ?? null,
        label: body.label ?? null,
      })
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.bank_created',
        eventType: 'create',
        entityTable: 'bank_accounts',
        entityId: row.id,
        newValue: {
          label: row.label,
          bank_name: row.bank_name,
          account_name: row.account_name,
          chart_account_id: row.chart_account_id,
        } as any,
      })
      const fresh = await db.bankAccount.findUnique({ where: { id: row.id } })
      return NextResponse.json({ account: await bankSummary(db, fresh) })
    }

    if (action === 'update') {
      const id = String(body.id ?? '')
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      const { before, after } = await updateBankAccount(db, id, {
        label: body.label,
        bank_name: body.bank_name,
        account_name: body.account_name,
        account_number: body.account_number,
        account_type: body.account_type,
        is_active: body.is_active,
      })
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.bank_updated',
        eventType: 'update',
        entityTable: 'bank_accounts',
        entityId: id,
        fieldChanges: diffFields(before as any, after as any, [
          'label', 'bank_name', 'account_name', 'account_number', 'account_type', 'is_active', 'chart_account_id',
        ]),
      })
      return NextResponse.json({ account: await bankSummary(db, after) })
    }

    if (action === 'confirm_opening') {
      const id = String(body.id ?? '')
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      const { before, after } = await confirmBankOpening(db, id, {
        opening_balance: body.opening_balance,
        opening_balance_date: body.opening_balance_date,
      })
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.bank_opening_confirmed',
        eventType: 'settings',
        entityTable: 'bank_accounts',
        entityId: id,
        fieldChanges: diffFields(before as any, after as any, [
          'opening_balance', 'opening_balance_date', 'is_draft',
        ]),
      })
      return NextResponse.json({ account: await bankSummary(db, after) })
    }

    return NextResponse.json(
      { error: "action must be 'create', 'update' or 'confirm_opening'" },
      { status: 400 }
    )
  } catch (err: any) {
    if (err instanceof BankError || err instanceof BankRecError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[accounts] bank POST failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
