/**
 * Accounts A10 — text renderers for the auditor package: the
 * README and one CSV per bundle section. Pure functions over the
 * exact bundle object the JSON download carries (and, for the
 * three statements, the A2 CSV renderers over the same statement
 * objects), so a CSV can never disagree with bundle.json or with
 * the screens. Money cells are the bundle's taka strings verbatim.
 */
import { trialBalanceCsv, profitAndLossCsv, balanceSheetCsv } from './statementsCsv'
import type { AuditorPackage } from './auditor'
import type { ZipEntryInput } from './auditorZip'

const esc = (v: unknown): string => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const row = (...cells: unknown[]): string => cells.map(esc).join(',')
const csv = (lines: string[]): string => lines.join('\n') + '\n'

function chartCsv(bundle: any): string {
  const lines = [
    row('Anchor ERP — Chart of Accounts'),
    row('Basis', bundle.chart_of_accounts.basis),
    '',
    row('Code', 'Account', 'Name (BN)', 'Type', 'Ledger Head', 'System', 'Active', 'Debit', 'Credit', 'Balance (Dr+)'),
  ]
  for (const a of bundle.chart_of_accounts.accounts) {
    lines.push(row(a.code, a.name, a.name_bn, a.type, a.ledger_head, a.is_system ? 'YES' : 'NO', a.is_active ? 'YES' : 'NO', a.debit, a.credit, a.balance))
  }
  return csv(lines)
}

function journalCsv(bundle: any): string {
  const j = bundle.journal
  const lines = [
    row('Anchor ERP — Journal (posted entries)'),
    row('Scope', bundle.meta.scope.label),
    row('Entries', j.entry_count, 'Lines', j.line_count),
    row('Total Debit', j.total_debit, 'Total Credit', j.total_credit, 'Balanced', j.balanced ? 'YES' : 'NO'),
    '',
    row('Entry ID', 'Date', 'Period', 'Event', 'Source Table', 'Source ID', 'Reverses Entry', 'Entry Memo', 'Account Code', 'Account', 'Branch', 'Counterparty', 'Debit', 'Credit', 'Line Memo'),
  ]
  for (const e of j.entries) {
    for (const l of e.lines) {
      lines.push(row(e.id, e.entry_date, e.period, e.event_type, e.source_table, e.source_id, e.reverses_entry_id, e.memo, l.account_code, l.account_name, l.branch, l.counterparty, l.debit, l.credit, l.memo))
    }
  }
  return csv(lines)
}

function taxSettingsCsv(bundle: any): string {
  const lines = [
    row('Anchor ERP — VAT/TDS Settings'),
    row('Dormant', bundle.tax.dormant ? 'YES — nothing is configured or recorded' : 'NO'),
    '',
    row('Type', 'Label', 'Enabled', 'Rate %', 'Effective From', 'Payable Account', 'Offset Account', 'Configured', 'Notes'),
  ]
  for (const s of bundle.tax.settings) {
    lines.push(row(s.tax_type, s.label, s.is_enabled ? 'YES' : 'NO', s.rate_percent, s.effective_from, s.payable_code, s.offset_code, s.configured ? 'YES' : 'NO', s.notes))
  }
  return csv(lines)
}

function taxRegisterCsv(bundle: any): string {
  const lines = [
    row('Anchor ERP — Tax Register'),
    row('Dormant', bundle.tax.dormant ? 'YES — register empty by design' : 'NO'),
    '',
    row('Period', 'Kind', 'Source Table', 'Source ID', 'Base Amount', 'Rate %', 'Tax Amount', 'Counterparty', 'Journal Entry', 'Status'),
  ]
  for (const l of bundle.tax.register_lines) {
    lines.push(row(l.period, l.kind, l.source_table, l.source_id, l.base_amount, l.rate, l.tax_amount, l.counterparty_name, l.journal_entry_id, l.status))
  }
  lines.push('')
  lines.push(row('Period summaries (display only — no filing integration)'))
  lines.push(row('Period', 'VAT Output', 'VAT Input', 'Net VAT Payable', 'TDS Salary', 'TDS Payment', 'TDS Total'))
  for (const s of bundle.tax.period_summaries) {
    lines.push(row(s.period, s.vat_output, s.vat_input, s.net_vat_payable, s.tds_salary, s.tds_payment, s.tds_total))
  }
  return csv(lines)
}

function chequeCsv(bundle: any): string {
  const lines = [
    row('Anchor ERP — Cheque Register'),
    '',
    row('ID', 'Direction', 'Cheque No', 'Bank', 'Bank Chart Code', 'Counterparty', 'Amount', 'Issue Date', 'Due Date', 'Status', 'Cleared At', 'Source Table', 'Source ID', 'Journal Entry', 'Note'),
  ]
  for (const c of bundle.cheques.items) {
    lines.push(row(c.id, c.direction, c.cheque_no, c.bank_label, c.bank_chart_code, c.counterparty_name, c.amount, c.issue_date, c.due_date, c.status, c.cleared_at, c.source_table, c.source_id, c.journal_entry_id, c.note))
  }
  return csv(lines)
}

function payablesCsv(bundle: any): string {
  const lines = [
    row('Anchor ERP — Payables & Receivables Register'),
    '',
    row('ID', 'Counterparty', 'Type', 'Direction', 'Class', 'Journal Backed', 'Description', 'Amount', 'Paid', 'Open', 'Due Date', 'Status', 'Overdue'),
  ]
  for (const r of bundle.payables.register) {
    lines.push(row(r.id, r.counterparty_name, r.counterparty_type, r.direction, r.class_label, r.journal_backed ? 'YES' : 'NO', r.description, r.amount, r.paid_amount, r.open_amount, r.due_date, r.status, r.overdue ? 'YES' : 'NO'))
  }
  lines.push('')
  lines.push(row('Tie-out (register open total vs source modules)'))
  lines.push(row('Class', 'Items', 'Register Open', 'Source Open', 'Match', 'Note'))
  for (const t of bundle.payables.tie_out) {
    lines.push(row(t.label, t.items, t.register_open, t.source_open, t.match ? 'YES' : 'NO', t.note))
  }
  return csv(lines)
}

function ageingCsv(bundle: any): string {
  const a = bundle.payables.ageing
  const lines = [
    row('Anchor ERP — Ageing Report'),
    row('As of', a.as_of),
    row('Basis', a.basis),
    '',
    row('Direction', 'Current', '1–30 days', '31–60 days', '61–90 days', '90+ days', 'Total'),
    row('Payable', a.totals.payable.current, a.totals.payable.d1_30, a.totals.payable.d31_60, a.totals.payable.d61_90, a.totals.payable.d90_plus, a.totals.payable.total),
    row('Receivable', a.totals.receivable.current, a.totals.receivable.d1_30, a.totals.receivable.d31_60, a.totals.receivable.d61_90, a.totals.receivable.d90_plus, a.totals.receivable.total),
    '',
    row('Counterparty', 'Type', 'Payable Total', 'Receivable Total'),
  ]
  for (const p of a.by_counterparty) {
    lines.push(row(p.counterparty_name, p.counterparty_type, p.payable.total, p.receivable.total))
  }
  return csv(lines)
}

function bankAccountsCsv(bundle: any): string {
  const lines = [
    row('Anchor ERP — Bank Accounts'),
    '',
    row('Label', 'Bank', 'Account Name', 'Account Number', 'Type', 'Chart Code', 'Opening Balance', 'Opening Date', 'Draft (unconfirmed)', 'Active', 'Journal Balance', 'Statement Lines', 'Matched', 'Unmatched'),
  ]
  for (const b of bundle.banks.accounts) {
    lines.push(row(b.label, b.bank_name, b.account_name, b.account_number, b.account_type, b.chart_code, b.opening_balance, b.opening_balance_date, b.is_draft ? 'YES' : 'NO', b.is_active ? 'YES' : 'NO', b.journal_balance, b.statement_line_count, b.matched_line_count, b.unmatched_line_count))
  }
  return csv(lines)
}

function bankRecCsv(bundle: any): string {
  const lines = [
    row('Anchor ERP — Bank Reconciliation Status'),
    '',
    row('Account', 'Journal (book) Balance', 'Statement Balance', 'Statement Basis', 'Unmatched Stmt Credit', 'Unmatched Stmt Debit', 'Unmatched Journal Debit', 'Unmatched Journal Credit', 'Explained Difference', 'Unexplained Difference', 'Difference'),
  ]
  for (const b of bundle.banks.accounts) {
    const r = b.reconciliation
    lines.push(row(b.label, r.journal_balance, r.statement_balance, r.statement_balance_basis, r.unmatched_statement_credit, r.unmatched_statement_debit, r.unmatched_journal_debit, r.unmatched_journal_credit, r.explained_difference, r.unexplained_difference, r.difference))
  }
  return csv(lines)
}

function exceptionsCsv(bundle: any): string {
  const lines = [
    row('Anchor ERP — Posting Exceptions (blocked postings, A3/A9)'),
    '',
    row('ID', 'Source Table', 'Source ID', 'Event', 'Entry Date', 'Period', 'Reason', 'Status', 'Acknowledged At', 'Resolved At', 'Resolution Note', 'Created At'),
  ]
  for (const e of bundle.exceptions.posting_exceptions) {
    lines.push(row(e.id, e.source_table, e.source_id, e.event_type, e.entry_date, e.period_month, e.reason, e.status, e.acknowledged_at, e.resolved_at, e.resolution_note, e.created_at))
  }
  return csv(lines)
}

function inboxCsv(bundle: any): string {
  const lines = [
    row('Anchor ERP — Exceptions Inbox Snapshot (A9, at generation time)'),
    row('Stored Open', bundle.exceptions.inbox.counts.stored_open, 'Acknowledged', bundle.exceptions.inbox.counts.stored_acknowledged, 'Resolved', bundle.exceptions.inbox.counts.stored_resolved, 'Derived', bundle.exceptions.inbox.counts.derived, 'Total Active', bundle.exceptions.inbox.counts.total_active),
    '',
    row('Key', 'Kind', 'Code', 'Severity', 'Title', 'Amount', 'Count', 'Since', 'Age (days)', 'Status', 'Text'),
  ]
  for (const i of bundle.exceptions.inbox.items) {
    lines.push(row(i.key, i.kind, i.code, i.severity, i.title, i.amount, i.count, i.since, i.age_days, i.status, i.text))
  }
  return csv(lines)
}

function openingCsv(bundle: any): string {
  const o = bundle.opening_position
  const lines = [
    row('Anchor ERP — Opening Position'),
    row('Status', o.status ?? '(none computed)'),
    row('Confirmed', o.confirmed ? 'YES' : 'NO'),
  ]
  if (o.warning) lines.push(row('WARNING', o.warning))
  if (o.latest) {
    lines.push(row('Label', o.latest.label, 'As of', o.latest.as_of, 'Computed at', o.latest.computed_at))
    lines.push(row('Equity Figure', o.latest.equity_figure, 'Equity Status', o.latest.equity_status))
    lines.push(row('Opening journal entries posted', o.opening_journal_entries_posted))
    lines.push('')
    lines.push(row('Component', 'Label', 'Amount', 'Side', 'Source Note'))
    for (const l of o.latest.lines) {
      lines.push(row(l.component, l.label, l.amount, l.side, l.source_note))
    }
  }
  return csv(lines)
}

function readme(bundle: any): string {
  const m = bundle.meta
  const lines: string[] = [
    'ANCHOR ERP — AUDITOR PACKAGE',
    '============================',
    '',
    `Generated: ${m.generated_at}`,
    `Scope: ${m.scope.label} (${m.scope.from} → ${m.scope.to}; balance sheet as of ${m.scope.as_of})`,
    '',
    'BASIS',
    m.basis,
    m.generated_from,
    '',
    'KEY TOTALS',
    `Trial balance: Dr ${bundle.trial_balance.total_debit} = Cr ${bundle.trial_balance.total_credit} (difference ${bundle.trial_balance.difference}, balanced: ${bundle.trial_balance.balanced ? 'YES' : 'NO'})`,
    `Journal in scope: ${bundle.journal.entry_count} entries / ${bundle.journal.line_count} lines`,
    `Profit & loss: income ${bundle.profit_and_loss.total_income}, expenses ${bundle.profit_and_loss.total_expenses}, net ${bundle.profit_and_loss.net}`,
    `Balance sheet: assets ${bundle.balance_sheet.total_assets} = liabilities + equity ${bundle.balance_sheet.total_liabilities_equity} (balanced: ${bundle.balance_sheet.balanced ? 'YES' : 'NO'})`,
    '',
    'HONESTY NOTES — READ FIRST',
    `- Opening position status: ${bundle.opening_position.status ?? '(none)'}${bundle.opening_position.confirmed ? '' : ' — DRAFT, NOT CONFIRMED by the owner.'}`,
  ]
  if (bundle.opening_position.warning) lines.push(`  ${bundle.opening_position.warning}`)
  lines.push(
    `- Balance sheet provisional: ${bundle.balance_sheet.provisional ? 'YES — because the opening position is unconfirmed (see opening_position.csv)' : 'NO'}`,
    `- VAT/TDS dormant: ${bundle.tax.dormant ? 'YES — no rates configured, register empty; nothing is recorded until the owner/CA enters rates' : 'NO'}`,
    `- The P&L is an operating result BEFORE cost of goods: ${bundle.profit_and_loss.notes.uncosted_chalans} of ${bundle.profit_and_loss.notes.total_chalans} chalans have no recorded cost (sale value ${bundle.profit_and_loss.notes.uncosted_chalan_sale}) and post no COGS.`,
    '',
    'CONTENTS',
    'README.txt — this file',
    'bundle.json — the complete package as one structured JSON document',
    'chart_of_accounts.csv — chart of accounts with full-journal balances',
    'trial_balance.csv — trial balance for the scope',
    'journal.csv — every posted journal entry + line in the scope',
    'profit_and_loss.csv — P&L for the scope (company; by-branch in bundle.json)',
    'balance_sheet.csv — balance sheet as of the scope end',
    'tax_settings.csv / tax_register.csv — VAT/TDS configuration + register',
    'cheque_register.csv — cheque register (current state)',
    'payables_register.csv / payables_ageing.csv — AR/AP register, tie-out, ageing',
    'bank_accounts.csv / bank_reconciliation.csv — bank accounts + reconciliation status',
    'posting_exceptions.csv — blocked postings with their A9 workflow state',
    'inbox_snapshot.csv — the A9 exceptions inbox at generation time',
    'opening_position.csv — the opening position WITH its confirmation status',
    ''
  )
  return lines.join('\n')
}

/** Assemble the download files for a built package. */
export function auditorPackageFiles(pkg: AuditorPackage): ZipEntryInput[] {
  const b = pkg.bundle
  const s = pkg.statements
  return [
    { name: 'README.txt', data: readme(b) },
    { name: 'bundle.json', data: JSON.stringify(b, null, 2) + '\n' },
    { name: 'chart_of_accounts.csv', data: chartCsv(b) },
    { name: 'trial_balance.csv', data: trialBalanceCsv(s.tb, s.scope_label) },
    { name: 'journal.csv', data: journalCsv(b) },
    { name: 'profit_and_loss.csv', data: profitAndLossCsv(s.pl, s.scope_label) },
    { name: 'balance_sheet.csv', data: balanceSheetCsv(s.bs) },
    { name: 'tax_settings.csv', data: taxSettingsCsv(b) },
    { name: 'tax_register.csv', data: taxRegisterCsv(b) },
    { name: 'cheque_register.csv', data: chequeCsv(b) },
    { name: 'payables_register.csv', data: payablesCsv(b) },
    { name: 'payables_ageing.csv', data: ageingCsv(b) },
    { name: 'bank_accounts.csv', data: bankAccountsCsv(b) },
    { name: 'bank_reconciliation.csv', data: bankRecCsv(b) },
    { name: 'posting_exceptions.csv', data: exceptionsCsv(b) },
    { name: 'inbox_snapshot.csv', data: inboxCsv(b) },
    { name: 'opening_position.csv', data: openingCsv(b) },
  ]
}
