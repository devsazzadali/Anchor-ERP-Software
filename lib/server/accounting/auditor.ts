/**
 * Accounts A10 — the auditor package builder.
 *
 * One bundle for an external auditor / the owner's CA: chart of
 * accounts, trial balance, the full posted journal for the scope,
 * P&L, balance sheet, and the registers (tax, cheques, payables +
 * ageing, bank + reconciliation), the posting exceptions with the
 * A9 inbox snapshot, and the opening position.
 *
 * EVERY figure comes from the existing stage services — A1
 * reports (trial balance), A2 statements, A4 bank, A5 payables,
 * A7 tax, A8 cheques, A9 inbox — so the bundle cannot disagree
 * with the on-screen numbers: it is literally the same payloads,
 * re-shaped for download. This module is READ-ONLY: it never
 * writes, never posts, never creates schema.
 *
 * Scope model (stated on the bundle itself):
 *  - Statements (TB / P&L / BS) and the journal are SCOPED —
 *    a period, a fiscal year (FY-to-date through its last period,
 *    exactly the statements screens' scope=fytd), or full history.
 *  - Registers are CURRENT-STATE snapshots as of generation —
 *    the same thing their screens show today. A register "as of"
 *    a past period is not reconstructible from current rows, and
 *    the bundle never pretends otherwise.
 *
 * Honesty rules carried into the bundle:
 *  - The opening position is exported WITH its stored status. A
 *    DRAFT position's equity figure is labelled "DRAFT —
 *    UNCONFIRMED balancing figure" everywhere it appears; the
 *    bundle never presents it as a confirmed opening balance.
 *  - The balance sheet keeps A2's `provisional` flag verbatim.
 *  - Tax ships dormant (A7): settings show enabled=false / no
 *    rate, and the register is empty — stated, not hidden.
 */
import { type Db } from './post'
import { trialBalance, taka, toPoishaExact } from './reports'
import {
  statementMeta,
  resolveScopeFor,
  trialBalanceStatement,
  profitAndLoss,
  balanceSheet,
  type ScopeInfo,
} from './statements'
import { bankSummary, reconciliationStatus } from './bankrec'
import { listRegister, registerTieOut, ageingReport } from './payables'
import { listTaxSettings, listRegisterLines, taxPeriodSummaries } from './tax'
import { listCheques, chequeSummary } from './cheques'
import { listInbox } from './inbox'

export class AuditorError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const isoDate = (d: unknown): string => {
  if (d == null) return ''
  if (typeof d === 'string') return d.slice(0, 10)
  return (d as Date).toISOString().slice(0, 10)
}
const isoTs = (d: unknown): string | null => {
  if (d == null) return null
  if (typeof d === 'string') return d
  return (d as Date).toISOString()
}

// ── Scope ──────────────────────────────────────────────────────

export interface AuditorScopeInput {
  kind: 'full' | 'fiscal_year' | 'period'
  period?: string | null
  fy_label?: string | null
}

export interface ResolvedAuditorScope {
  kind: 'full' | 'fiscal_year' | 'period'
  label: string
  filename_part: string
  from: string
  to: string
  as_of: string
  stmt_scope: ScopeInfo
  period_month: string | null
  fy_label: string | null
}

export async function resolveAuditorScope(
  db: Db,
  input: AuditorScopeInput
): Promise<ResolvedAuditorScope> {
  const meta = await statementMeta(db)

  if (input.kind === 'period') {
    const period = String(input.period ?? '')
    if (!meta.periods.some((p) => p.month === period)) {
      throw new AuditorError(400, `Unknown period: ${period || '(missing)'}`)
    }
    const scope = await resolveScopeFor(db, period, 'period')
    if (!scope) throw new AuditorError(400, `Unknown period: ${period}`)
    return {
      kind: 'period',
      label: `Period ${period}`,
      filename_part: period,
      from: scope.from,
      to: scope.to,
      as_of: scope.to,
      stmt_scope: scope,
      period_month: period,
      fy_label: meta.periods.find((p) => p.month === period)?.fy_label ?? null,
    }
  }

  if (input.kind === 'fiscal_year') {
    const label = String(input.fy_label ?? '')
    const fyPeriods = meta.periods.filter((p) => p.fy_label === label)
    if (!label || fyPeriods.length === 0) {
      throw new AuditorError(400, `Unknown fiscal year: ${label || '(missing)'}`)
    }
    const last = fyPeriods[fyPeriods.length - 1]
    const scope = await resolveScopeFor(db, last.month, 'fytd')
    if (!scope) throw new AuditorError(400, `Unknown fiscal year: ${label}`)
    return {
      kind: 'fiscal_year',
      label: `Fiscal year ${label} (through ${last.month})`,
      filename_part: `fy-${label.replace(/[^0-9A-Za-z]+/g, '-')}`,
      from: scope.from,
      to: scope.to,
      as_of: scope.to,
      stmt_scope: scope,
      period_month: last.month,
      fy_label: label,
    }
  }

  // Full history: every posted entry, first to last.
  const from = meta.journal_coverage.first_entry ?? '0001-01-01'
  const to = meta.journal_coverage.last_entry ?? from
  const scope: ScopeInfo = {
    kind: 'fytd',
    from,
    to,
    period_month: meta.default_period,
    label: 'Full history (all posted entries)',
  }
  return {
    kind: 'full',
    label: 'Full history (all posted entries)',
    filename_part: 'full-history',
    from,
    to,
    as_of: to,
    stmt_scope: scope,
    period_month: null,
    fy_label: null,
  }
}

// ── Section builders (all read-only) ───────────────────────────

async function chartSection(db: Db) {
  const [tb, accounts, heads] = await Promise.all([
    trialBalance(db),
    db.chartAccount.findMany({ orderBy: { code: 'asc' } }),
    db.ledgerHead.findMany({ select: { id: true, name: true } }),
  ])
  const byId = new Map(tb.rows.map((r: any) => [r.account_id, r]))
  const headName = new Map<string, string>(heads.map((h: any) => [h.id, h.name]))
  return {
    basis: 'Balances over the full posted journal (the Chart of Accounts screen figures).',
    accounts: accounts.map((a: any) => {
      const bal = byId.get(a.id)
      return {
        id: a.id,
        code: a.code,
        name: a.name,
        name_bn: a.name_bn,
        type: a.type,
        parent_id: a.parent_id,
        branch_dimension: a.branch_dimension,
        ledger_head: a.ledger_head_id ? (headName.get(a.ledger_head_id) ?? null) : null,
        is_system: a.is_system,
        is_active: a.is_active,
        debit: taka(bal?.debit ?? 0),
        credit: taka(bal?.credit ?? 0),
        balance: taka(bal?.balance ?? 0),
      }
    }),
  }
}

async function journalSection(db: Db, scope: ResolvedAuditorScope) {
  const entries = await db.journalEntry.findMany({
    where: {
      status: 'posted',
      entry_date: {
        gte: new Date(`${scope.from}T00:00:00Z`),
        lte: new Date(`${scope.to}T00:00:00Z`),
      },
    },
    orderBy: [{ entry_date: 'asc' }, { created_at: 'asc' }],
  })
  const ids = entries.map((e: any) => e.id)
  const lines = ids.length
    ? await db.journalLine.findMany({ where: { entry_id: { in: ids } } })
    : []
  const [accounts, branches, parties, periods] = await Promise.all([
    db.chartAccount.findMany({ select: { id: true, code: true, name: true } }),
    db.branch.findMany({ select: { id: true, name: true } }),
    db.counterparty.findMany({ select: { id: true, name: true } }),
    db.accountingPeriod.findMany({ select: { id: true, month: true } }),
  ])
  const accOf = new Map<string, any>(accounts.map((a: any) => [a.id, a]))
  const branchOf = new Map<string, string>(branches.map((b: any) => [b.id, b.name]))
  const partyOf = new Map<string, string>(parties.map((p: any) => [p.id, p.name]))
  const monthOf = new Map<string, string>(periods.map((p: any) => [p.id, p.month]))

  const linesByEntry = new Map<string, any[]>()
  for (const l of lines) {
    const arr = linesByEntry.get(l.entry_id) ?? []
    arr.push(l)
    linesByEntry.set(l.entry_id, arr)
  }

  let totalDebit = 0
  let totalCredit = 0
  let lineCount = 0
  const shaped = entries.map((e: any) => {
    const entryLines = (linesByEntry.get(e.id) ?? [])
      .map((l: any) => {
        const acc = accOf.get(l.account_id)
        const d = toPoishaExact(l.debit)
        const c = toPoishaExact(l.credit)
        totalDebit += d
        totalCredit += c
        lineCount++
        return {
          account_code: acc?.code ?? '',
          account_name: acc?.name ?? '',
          branch: l.branch_id ? (branchOf.get(l.branch_id) ?? null) : null,
          counterparty: l.counterparty_id ? (partyOf.get(l.counterparty_id) ?? null) : null,
          debit: taka(d),
          credit: taka(c),
          memo: l.memo ?? null,
        }
      })
      .sort((a: any, b: any) => a.account_code.localeCompare(b.account_code))
    return {
      id: e.id,
      entry_date: isoDate(e.entry_date),
      period: monthOf.get(e.period_id) ?? null,
      event_type: e.event_type,
      source_table: e.source_table ?? null,
      source_id: e.source_id ?? null,
      reverses_entry_id: e.reverses_entry_id ?? null,
      memo: e.memo ?? null,
      lines: entryLines,
    }
  })

  return {
    entry_count: shaped.length,
    line_count: lineCount,
    total_debit: taka(totalDebit),
    total_credit: taka(totalCredit),
    balanced: totalDebit === totalCredit,
    entries: shaped,
  }
}

async function openingSection(db: Db) {
  const [positions, openingEntries] = await Promise.all([
    db.openingPosition.findMany({ orderBy: { created_at: 'desc' }, take: 10 }),
    db.journalEntry.count({ where: { status: 'posted', event_type: 'opening' } }),
  ])
  const shape = async (p: any) => {
    const lines = await db.openingPositionLine.findMany({
      where: { position_id: p.id },
      orderBy: { created_at: 'asc' },
    })
    const equity = lines
      .filter((l: any) => l.component === 'equity')
      .reduce((a: number, l: any) => a + toPoishaExact(l.amount), 0)
    return {
      id: p.id,
      label: p.label,
      status: p.status,
      confirmed: p.status === 'confirmed',
      as_of: isoDate(p.as_of_date),
      computed_at: isoTs(p.computed_at),
      confirmed_by: p.confirmed_by ?? null,
      confirmed_at: isoTs(p.confirmed_at),
      notes: p.notes ?? null,
      equity_figure: taka(equity),
      equity_status:
        p.status === 'confirmed'
          ? 'Confirmed by the owner'
          : 'DRAFT — UNCONFIRMED balancing figure (computed by the system; NOT a confirmed opening balance)',
      lines: lines.map((l: any) => ({
        component: l.component,
        label: l.label,
        amount: l.amount.toString(),
        side: l.side,
        source_note: l.source_note ?? null,
        detail: l.detail ?? null,
      })),
    }
  }
  const latest = positions.length ? await shape(positions[0]) : null
  return {
    status: latest?.status ?? null,
    confirmed: latest?.confirmed ?? false,
    warning:
      latest && !latest.confirmed
        ? 'The latest opening position is a DRAFT and has NOT been confirmed by the owner. ' +
          'Its equity figure is a system-computed balancing figure awaiting confirmation — ' +
          'it must not be read as a confirmed opening balance. The balance sheet in this ' +
          'bundle is therefore PROVISIONAL (see its own flag).'
        : null,
    opening_journal_entries_posted: openingEntries,
    latest,
    prior_positions: positions.slice(1).map((p: any) => ({
      id: p.id,
      label: p.label,
      status: p.status,
      as_of: isoDate(p.as_of_date),
      computed_at: isoTs(p.computed_at),
    })),
  }
}

async function exceptionsSection(db: Db) {
  const rows = await db.postingException.findMany({ orderBy: { created_at: 'asc' } })
  const inbox = await listInbox(db)
  return {
    posting_exceptions: rows.map((r: any) => ({
      id: r.id,
      source_table: r.source_table,
      source_id: r.source_id,
      event_type: r.event_type,
      entry_date: isoDate(r.entry_date),
      period_month: r.period_month,
      reason: r.reason,
      detail: r.detail ?? null,
      status: r.status,
      acknowledged_at: isoTs(r.acknowledged_at),
      acknowledged_by: r.acknowledged_by ?? null,
      resolved_at: isoTs(r.resolved_at),
      resolved_by: r.resolved_by ?? null,
      resolution_note: r.resolution_note ?? null,
      created_at: isoTs(r.created_at),
      updated_at: isoTs(r.updated_at),
    })),
    inbox: {
      counts: inbox.counts,
      items: inbox.items,
      note: 'Live snapshot at generation time (the A9 Exceptions Inbox figures). Derived items clear themselves when their source record is fixed.',
    },
  }
}

async function banksSection(db: Db) {
  const rawRows = await db.bankAccount.findMany({ orderBy: { created_at: 'asc' } })
  const out: any[] = []
  for (const raw of rawRows) {
    const summary = await bankSummary(db, raw)
    const reconciliation = await reconciliationStatus(db, raw)
    out.push({ ...summary, reconciliation })
  }
  return { accounts: out }
}

// ── The bundle ─────────────────────────────────────────────────

export interface AuditorPackage {
  bundle: Record<string, any>
  statements: { tb: any; pl: any; bs: any; scope_label: string }
  scope: ResolvedAuditorScope
  filename_base: string
}

export async function buildAuditorBundle(
  db: Db,
  input: AuditorScopeInput
): Promise<AuditorPackage> {
  const scope = await resolveAuditorScope(db, input)
  const meta = await statementMeta(db)

  const [tbStmt, pl, bs, chart, journal, opening, taxSettings, taxRegister, taxSummaries, cheques, chequeSum, payRegister, tieOut, ageing, banks, exceptions] =
    await Promise.all([
      trialBalanceStatement(db, scope.stmt_scope),
      profitAndLoss(db, scope.stmt_scope),
      balanceSheet(db, scope.as_of),
      chartSection(db),
      journalSection(db, scope),
      openingSection(db),
      listTaxSettings(db),
      listRegisterLines(db, { limit: 500 }),
      taxPeriodSummaries(db),
      listCheques(db, { limit: 500 }),
      chequeSummary(db),
      listRegister(db),
      registerTieOut(db),
      ageingReport(db),
      banksSection(db),
      exceptionsSection(db),
    ])

  const rowJson = (r: { code: string; name: string; type?: string; debit?: number; credit?: number; balance?: number; amount?: number }) => ({
    code: r.code,
    name: r.name,
    ...(r.type !== undefined ? { type: r.type } : {}),
    ...(r.debit !== undefined ? { debit: taka(r.debit) } : {}),
    ...(r.credit !== undefined ? { credit: taka(r.credit) } : {}),
    ...(r.balance !== undefined ? { balance: taka(r.balance) } : {}),
    ...(r.amount !== undefined ? { amount: taka(r.amount) } : {}),
  })

  const bundle: Record<string, any> = {
    meta: {
      package: 'Anchor ERP — Auditor Package (Accounts A10)',
      generated_at: new Date().toISOString(),
      scope: {
        kind: scope.kind,
        label: scope.label,
        from: scope.from,
        to: scope.to,
        as_of: scope.as_of,
        period_month: scope.period_month,
        fy_label: scope.fy_label,
      },
      basis:
        'Trial balance, P&L, balance sheet and the journal are scoped as above. ' +
        'All registers (chart balances, tax, cheques, payables, bank, exceptions, opening) ' +
        'are current-state snapshots at generation time — the same figures their screens show.',
      generated_from:
        'The same server services that power the Accounts screens (A1 reports, A2 statements, A4 bank, A5 payables, A7 tax, A8 cheques, A9 inbox). No figure is recomputed by a second path.',
      journal_coverage: meta.journal_coverage,
      opening_status: opening.status,
      opening_confirmed: opening.confirmed,
      tax_dormant: taxSettings.dormant,
      balance_sheet_provisional: bs.provisional,
    },
    chart_of_accounts: chart,
    trial_balance: {
      scope_label: scope.stmt_scope.label,
      rows: tbStmt.rows.map(rowJson),
      total_debit: taka(tbStmt.total_debit),
      total_credit: taka(tbStmt.total_credit),
      difference: taka(tbStmt.difference),
      balanced: tbStmt.balanced,
      entry_count: tbStmt.entry_count,
    },
    journal,
    profit_and_loss: {
      scope_label: scope.stmt_scope.label,
      income: pl.income.map(rowJson),
      expenses: pl.expenses.map(rowJson),
      total_income: taka(pl.total_income),
      total_expenses: taka(pl.total_expenses),
      net: taka(pl.net),
      entry_count: pl.entry_count,
      by_branch: pl.by_branch
        ? pl.by_branch.map((b: any) => ({
            branch_id: b.branch_id,
            branch_name: b.branch_name,
            income: taka(b.income),
            expenses: taka(b.expenses),
            net: taka(b.net),
          }))
        : null,
      notes: {
        journal_from: pl.notes.journal_from,
        journal_to: pl.notes.journal_to,
        opening_status: pl.notes.opening_status,
        opening_equity_draft: pl.notes.opening_equity_draft != null ? taka(pl.notes.opening_equity_draft) : null,
        uncosted_chalans: pl.notes.uncosted_chalans,
        uncosted_chalan_sale: taka(pl.notes.uncosted_chalan_sale),
        total_chalans: pl.notes.total_chalans,
      },
    },
    balance_sheet: {
      as_of: bs.as_of,
      provisional: bs.provisional,
      opening_status: bs.opening_status,
      assets: bs.assets.map(rowJson),
      liabilities: bs.liabilities.map(rowJson),
      equity: bs.equity.map(rowJson),
      total_assets: taka(bs.total_assets),
      total_liabilities: taka(bs.total_liabilities),
      total_equity: taka(bs.total_equity),
      current_result: taka(bs.current_result),
      total_liabilities_equity: taka(bs.total_liabilities_equity),
      balanced: bs.balanced,
      entry_count: bs.entry_count,
    },
    tax: {
      dormant: taxSettings.dormant,
      dormant_note: taxSettings.dormant
        ? 'VAT/TDS are NOT configured: every type is disabled and no rate is set. The register is empty because nothing is recorded while dormant — rates are entered by the owner with the CA; the system never invents one.'
        : null,
      settings: taxSettings.settings,
      register_lines: taxRegister,
      period_summaries: taxSummaries,
    },
    cheques: { summary: chequeSum, items: cheques },
    payables: { register: payRegister, tie_out: tieOut, ageing },
    banks,
    exceptions,
    opening_position: opening,
  }

  return {
    bundle,
    statements: { tb: tbStmt, pl, bs, scope_label: scope.stmt_scope.label },
    scope,
    filename_base: `auditor-package-${scope.filename_part}`,
  }
}
