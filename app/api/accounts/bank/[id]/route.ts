import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit, diffFields } from '@/lib/server/audit'
import { BankError } from '@/lib/server/accounting/bank'
import {
  importStatementCsv,
  addStatementLine,
  updateStatementLine,
  deleteStatementLine,
  setStatementLineStatus,
  listJournalBankLines,
  findCandidates,
  matchLines,
  unmatchLine,
  reconciliationStatus,
  statementLineShape,
  bankSummary,
  BankRecError,
} from '@/lib/server/accounting/bankrec'

// /api/accounts/bank/[id] — one bank account's reconciliation
// workspace (A4). GET: the account summary + reconciliation status +
// statement lines (date asc, cap 1000) + active journal lines +
// match candidates. POST actions (admin-only, S1-audited):
//   {action:'import_csv', csv_text, file_name?}
//   {action:'add_line', statement_date, description, reference?, debit?, credit?, balance?}
//   {action:'edit_line', line_id, ...fields}
//   {action:'delete_line', line_id}
//   {action:'set_line_status', line_id, status:'ignored'|'unmatched'}
//   {action:'match', statement_line_id, journal_line_id}
//   {action:'unmatch', statement_line_id}
export const dynamic = 'force-dynamic'

async function gate(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!callerIsAdmin(caller)) {
    return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  }
  return { caller }
}

async function loadAccount(db: any, id: string) {
  const row = await db.bankAccount.findUnique({ where: { id } })
  if (!row) throw new BankError(404, 'Bank account not found')
  return row
}

/** A statement line addressed through this route must belong to it. */
async function loadOwnedLine(db: any, accountId: string, lineId: string) {
  const line = await db.bankStatementLine.findUnique({ where: { id: lineId } })
  if (!line || line.bank_account_id !== accountId) {
    throw new BankRecError(404, 'Statement line not found')
  }
  return line
}

export async function GET(req: Request, context: any) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const { id } = await context.params
    const db = prisma as any
    const account = await loadAccount(db, id)
    const [summary, reconciliation, lineRows, journalLines, candidates] = await Promise.all([
      bankSummary(db, account),
      reconciliationStatus(db, account),
      db.bankStatementLine.findMany({
        where: { bank_account_id: id },
        orderBy: [{ statement_date: 'asc' }, { created_at: 'asc' }],
        take: 1000,
      }),
      listJournalBankLines(db, account),
      findCandidates(db, account),
    ])
    return NextResponse.json({
      account: summary,
      reconciliation,
      lines: lineRows.map(statementLineShape),
      journal_lines: journalLines,
      candidates,
    })
  } catch (err: any) {
    if (err instanceof BankError || err instanceof BankRecError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[accounts] bank/[id] GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request, context: any) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const { id } = await context.params
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    const db = prisma as any
    await loadAccount(db, id) // unknown account id → 404 for every action

    if (action === 'import_csv') {
      const csvText = typeof body.csv_text === 'string' ? body.csv_text : ''
      if (!csvText) return NextResponse.json({ error: 'csv_text is required' }, { status: 400 })
      const result = await importStatementCsv(
        db, id, csvText, body.file_name ? String(body.file_name) : null, g.caller.id
      )
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.statement_imported',
        eventType: 'create',
        entityTable: 'bank_import_batches',
        entityId: result.batch_id,
        newValue: {
          total_rows: result.total_rows,
          imported: result.imported,
          error_rows: result.errors.length,
        } as any,
      })
      return NextResponse.json({
        batch_id: result.batch_id,
        total_rows: result.total_rows,
        imported: result.imported,
        errors: result.errors,
      })
    }

    if (action === 'add_line') {
      const row = await addStatementLine(db, id, {
        statement_date: body.statement_date,
        description: body.description,
        reference: body.reference,
        debit: body.debit,
        credit: body.credit,
        balance: body.balance,
      })
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.statement_line_added',
        eventType: 'create',
        entityTable: 'bank_statement_lines',
        entityId: row.id,
        newValue: statementLineShape(row) as any,
      })
      return NextResponse.json({ line: statementLineShape(row) })
    }

    if (action === 'edit_line') {
      const lineId = String(body.line_id ?? '')
      if (!lineId) return NextResponse.json({ error: 'line_id is required' }, { status: 400 })
      await loadOwnedLine(db, id, lineId)
      const { before, after } = await updateStatementLine(db, lineId, {
        statement_date: body.statement_date,
        description: body.description,
        reference: body.reference,
        debit: body.debit,
        credit: body.credit,
        balance: body.balance,
      })
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.statement_line_updated',
        eventType: 'update',
        entityTable: 'bank_statement_lines',
        entityId: lineId,
        fieldChanges: diffFields(before as any, after as any, [
          'statement_date', 'description', 'reference', 'debit', 'credit', 'balance', 'match_status',
        ]),
      })
      return NextResponse.json({ line: statementLineShape(after) })
    }

    if (action === 'delete_line') {
      const lineId = String(body.line_id ?? '')
      if (!lineId) return NextResponse.json({ error: 'line_id is required' }, { status: 400 })
      await loadOwnedLine(db, id, lineId)
      const { before } = await deleteStatementLine(db, lineId)
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.statement_line_deleted',
        eventType: 'delete',
        entityTable: 'bank_statement_lines',
        entityId: lineId,
        oldValue: statementLineShape(before) as any,
      })
      return NextResponse.json({ deleted: lineId })
    }

    if (action === 'set_line_status') {
      const lineId = String(body.line_id ?? '')
      if (!lineId) return NextResponse.json({ error: 'line_id is required' }, { status: 400 })
      await loadOwnedLine(db, id, lineId)
      const { before, after } = await setStatementLineStatus(db, lineId, body.status)
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.statement_line_updated',
        eventType: 'update',
        entityTable: 'bank_statement_lines',
        entityId: lineId,
        fieldChanges: diffFields(before as any, after as any, ['match_status']),
      })
      return NextResponse.json({ line: statementLineShape(after) })
    }

    if (action === 'match') {
      const statementLineId = String(body.statement_line_id ?? '')
      const journalLineId = String(body.journal_line_id ?? '')
      if (!statementLineId || !journalLineId) {
        return NextResponse.json({ error: 'statement_line_id and journal_line_id are required' }, { status: 400 })
      }
      await loadOwnedLine(db, id, statementLineId)
      const { before, after } = await matchLines(db, { statementLineId, journalLineId })
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.bank_matched',
        eventType: 'update',
        entityTable: 'bank_statement_lines',
        entityId: statementLineId,
        fieldChanges: diffFields(before as any, after as any, [
          'match_status', 'matched_journal_line_id', 'matched_entry_id', 'matched_deposit_id',
        ]),
      })
      return NextResponse.json({ line: statementLineShape(after) })
    }

    if (action === 'unmatch') {
      const statementLineId = String(body.statement_line_id ?? '')
      if (!statementLineId) {
        return NextResponse.json({ error: 'statement_line_id is required' }, { status: 400 })
      }
      await loadOwnedLine(db, id, statementLineId)
      const { before, after } = await unmatchLine(db, statementLineId)
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.bank_unmatched',
        eventType: 'update',
        entityTable: 'bank_statement_lines',
        entityId: statementLineId,
        fieldChanges: diffFields(before as any, after as any, [
          'match_status', 'matched_journal_line_id', 'matched_entry_id', 'matched_deposit_id',
        ]),
      })
      return NextResponse.json({ line: statementLineShape(after) })
    }

    return NextResponse.json(
      {
        error:
          "action must be 'import_csv', 'add_line', 'edit_line', 'delete_line', 'set_line_status', 'match' or 'unmatch'",
      },
      { status: 400 }
    )
  } catch (err: any) {
    if (err instanceof BankError || err instanceof BankRecError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[accounts] bank/[id] POST failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
