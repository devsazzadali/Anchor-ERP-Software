import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit, diffFields } from '@/lib/server/audit'
import { listBankAccounts } from '@/lib/server/accounting/bank'
import {
  listCheques,
  chequeSummary,
  createCheque,
  updateCheque,
  clearCheque,
  bounceCheque,
  cancelCheque,
  ChequeError,
} from '@/lib/server/accounting/cheques'

// /api/accounts/cheques — cheque register (A8).
// GET: the register (filters ?status=&direction=), the bank
//   account + counterparty pick lists for the record form, and
//   the status summary incl. the PDC due list.
// POST actions (admin-only, every mutation S1-audited):
//   {action:'create', direction, cheque_no, bank_account_id?,
//    counterparty_id?, amount, issue_date?, due_date?,
//    source_table?, source_id?, note?}
//   {action:'update', id, ...fields}        — pending cheques only
//   {action:'clear',  id, cleared_date?, note?}
//   {action:'bounce', id, bounce_date?, note?}
//   {action:'cancel', id, note?}
// Posting design (service header, D-A8-1): recording posts
// nothing; clearing posts the single money movement through the
// journal (idempotent); a bounce reverses a clearing. A posting
// refused by a locked period still lets the status stand and is
// reported back as posting_blocked (the durable exception is on
// the Accounts overview).
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
    const { searchParams } = new URL(req.url)
    const [cheques, summary, banks, counterparties] = await Promise.all([
      listCheques(db, {
        status: searchParams.get('status') || null,
        direction: searchParams.get('direction') || null,
        limit: Number(searchParams.get('limit') ?? 200),
      }),
      chequeSummary(db),
      listBankAccounts(db),
      db.counterparty.findMany({
        where: { is_active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, type: true },
      }),
    ])
    return NextResponse.json({ cheques, summary, bank_accounts: banks, counterparties })
  } catch (err: any) {
    console.error('[accounts] cheques GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const EDIT_FIELDS = [
  'cheque_no',
  'bank_account_id',
  'counterparty_id',
  'amount',
  'issue_date',
  'due_date',
  'note',
] as const

export async function POST(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    const db = prisma as any
    const callerId = (g.caller as any)?.id ?? null

    if (action === 'create') {
      const row = await createCheque(db, body)
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.cheque_created',
        eventType: 'create',
        entityTable: 'cheque_register',
        entityId: row.id,
        newValue: {
          direction: row.direction,
          cheque_no: row.cheque_no,
          amount: row.amount?.toString(),
          bank_account_id: row.bank_account_id,
          counterparty_id: row.counterparty_id,
          due_date: row.due_date?.toISOString?.().slice(0, 10) ?? null,
        } as any,
      })
      return NextResponse.json({ ok: true, cheque: row })
    }

    if (action === 'update') {
      const id = String(body.id ?? '')
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      const res = await updateCheque(db, id, body)
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.cheque_updated',
        eventType: 'update',
        entityTable: 'cheque_register',
        entityId: id,
        fieldChanges: diffFields(res.before, res.after, [...EDIT_FIELDS]),
      })
      return NextResponse.json({ ok: true, cheque: res.after })
    }

    if (action === 'clear' || action === 'bounce' || action === 'cancel') {
      const id = String(body.id ?? '')
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      const res =
        action === 'clear'
          ? await clearCheque(db, id, { cleared_date: body.cleared_date, note: body.note, created_by: callerId })
          : action === 'bounce'
            ? await bounceCheque(db, id, { bounce_date: body.bounce_date, note: body.note, created_by: callerId })
            : await cancelCheque(db, id, { note: body.note })
      await logAudit({
        caller: g.caller,
        req,
        action: `accounts.cheque_${action === 'clear' ? 'cleared' : action === 'bounce' ? 'bounced' : 'cancelled'}`,
        eventType: action === 'cancel' ? 'void' : 'update',
        entityTable: 'cheque_register',
        entityId: id,
        fieldChanges: diffFields(res.before, res.after, ['status', 'cleared_at', 'note']),
        newValue: {
          journal_entry_id: res.journal_entry_id,
          posting_blocked: res.posting_blocked,
        } as any,
      })
      return NextResponse.json({
        ok: true,
        cheque: res.after,
        journal_entry_id: res.journal_entry_id,
        posting_blocked: res.posting_blocked,
      })
    }

    return NextResponse.json(
      { error: "action must be one of 'create' | 'update' | 'clear' | 'bounce' | 'cancel'" },
      { status: 400 }
    )
  } catch (err: any) {
    if (err instanceof ChequeError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[accounts] cheques POST failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
