/**
 * Response shaping — makes Prisma rows look EXACTLY like the
 * PostgREST rows the UI was built against, so the conversion is
 * invisible to the browser:
 *
 *  - Prisma Decimal serialises to a STRING via JSON; PostgREST
 *    returned JSON numbers. Decimals are converted to numbers here.
 *  - DATE columns: PostgREST returns "2026-10-05"; Prisma returns a
 *    Date (UTC midnight) which JSON-renders as a full timestamp.
 *    Fields in DATE_ONLY_FIELDS render back to "YYYY-MM-DD".
 *  - TIMESTAMPTZ columns: Prisma Date -> ISO string, matching
 *    PostgREST's rendering.
 *
 * Every converted route passes its payload through toPlain() (or
 * responds via json()) so these rules apply in exactly one place.
 */

/** Columns stored as Postgres DATE (date-only) across the schema. */
// Finalised against prisma/schema.prisma's @db.Date columns
// (2026-10-31 reconciliation). Only Date instances are transformed,
// so same-named String columns (branch_financial_reports.report_month
// 'YYYY-MM') pass through untouched while the performance report's
// @db.Date report_month formats to 'YYYY-MM-DD' — both exactly as
// PostgREST returned them. payment_date is timestamptz and is
// deliberately NOT in this set.
export const DATE_ONLY_FIELDS = new Set<string>([
  'ledger_date',
  'expense_date',
  'deposit_date',
  'sales_from_date',
  'sales_to_date',
  'report_month',
  'log_date',
  'join_date',
  'date',
  'start_date',
  'end_date',
  'effective_from',
  'effective_to',
  'requested_date',
  'holiday_date',
  'follow_up_date',
])

function isDecimalLike(value: unknown): value is { toNumber: () => number } {
  // Prisma 6 bundles decimal.js minified: the class's constructor
  // name is 'i', not 'Decimal', so the previous name check never
  // matched and every Decimal fell into the plain-object branch,
  // which mangled it into its { s, e, d } internals — downstream
  // Number() reads NaN, money sums came out 0, and API JSON carried
  // digit-array objects instead of numbers. Identify Decimals
  // structurally instead: decimal.js instances expose toNumber /
  // toFixed and carry the s / e / d fields.
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function' &&
    typeof (value as { toFixed?: unknown }).toFixed === 'function' &&
    's' in value &&
    'e' in value &&
    'd' in value
  )
}

function formatDateOnly(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function toPlain<T>(value: T): T {
  return convert(value, undefined) as T
}

function convert(value: unknown, key: string | undefined): unknown {
  if (value === null || value === undefined) return value
  if (isDecimalLike(value)) return value.toNumber()
  if (value instanceof Date) {
    if (key && DATE_ONLY_FIELDS.has(key)) return formatDateOnly(value)
    return value.toISOString()
  }
  if (Array.isArray(value)) return value.map((v) => convert(v, key))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = convert(v, k)
    }
    return out
  }
  if (typeof value === 'bigint') return Number(value)
  return value
}
