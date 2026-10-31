/**
 * Accounts A2 — CSV rendering of the statements payloads.
 *
 * Pure functions over the exact objects the JSON API returns, so a
 * CSV export can never disagree with its screen: same rows, same
 * poisha totals, formatted with the house taka() (2dp string).
 * The API route serves these with the audit-export pattern
 * (text/csv + Content-Disposition attachment).
 */
import { taka } from './reports'

const esc = (v: unknown): string => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const row = (...cells: unknown[]): string => cells.map(esc).join(',')
const money = (poisha: number): string => taka(poisha)

export function trialBalanceCsv(stmt: any, scopeLabel: string): string {
  const lines: string[] = [
    row('Anchor ERP — Trial Balance'),
    row('Scope', scopeLabel),
    row('Entries', stmt.entry_count),
    '',
    row('Code', 'Account', 'Type', 'Debit', 'Credit', 'Balance (Dr+)'),
  ]
  for (const r of stmt.rows) {
    lines.push(row(r.code, r.name, r.type, money(r.debit), money(r.credit), money(r.balance)))
  }
  lines.push(row('TOTAL', '', '', money(stmt.total_debit), money(stmt.total_credit), money(stmt.difference)))
  lines.push(row('Balanced', stmt.balanced ? 'YES' : 'NO'))
  return lines.join('\n') + '\n'
}

export function profitAndLossCsv(stmt: any, scopeLabel: string, branchName?: string | null): string {
  const lines: string[] = [
    row('Anchor ERP — Profit & Loss'),
    row('Scope', scopeLabel),
    row('Branch', branchName || 'All branches (company)'),
    row('Entries', stmt.entry_count),
    '',
    row('Section', 'Code', 'Account', 'Amount'),
  ]
  for (const r of stmt.income) lines.push(row('Income', r.code, r.name, money(r.amount)))
  lines.push(row('Income', '', 'Total income', money(stmt.total_income)))
  for (const r of stmt.expenses) lines.push(row('Expenses', r.code, r.name, money(r.amount)))
  lines.push(row('Expenses', '', 'Total expenses', money(stmt.total_expenses)))
  lines.push(row('', '', 'Net result (income − expenses)', money(stmt.net)))
  return lines.join('\n') + '\n'
}

export function balanceSheetCsv(stmt: any): string {
  const lines: string[] = [
    row('Anchor ERP — Balance Sheet'),
    row('As of', stmt.as_of),
    row('Status', stmt.provisional ? 'PROVISIONAL — opening position not yet confirmed by the owner' : 'Opening position confirmed'),
    row('Entries', stmt.entry_count),
    '',
    row('Section', 'Code', 'Account', 'Amount'),
  ]
  for (const r of stmt.assets) lines.push(row('Assets', r.code, r.name, money(r.amount)))
  lines.push(row('Assets', '', 'Total assets', money(stmt.total_assets)))
  for (const r of stmt.liabilities) lines.push(row('Liabilities', r.code, r.name, money(r.amount)))
  lines.push(row('Liabilities', '', 'Total liabilities', money(stmt.total_liabilities)))
  for (const r of stmt.equity) lines.push(row('Equity', r.code, r.name, money(r.amount)))
  lines.push(row('Equity', '', 'Accumulated result (income − expenses to date)', money(stmt.current_result)))
  lines.push(row('Equity', '', 'Total equity (incl. accumulated result)', money(stmt.total_equity + stmt.current_result)))
  lines.push(row('', '', 'Total liabilities + equity', money(stmt.total_liabilities_equity)))
  lines.push(row('Balanced', stmt.balanced ? 'YES' : 'NO'))
  return lines.join('\n') + '\n'
}
