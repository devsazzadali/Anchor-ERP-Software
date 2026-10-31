/**
 * Accounts A7 — VAT/TDS register (lib/server/accounting/tax.ts).
 *
 * Config-driven tax recording over the A1 journal. Four tax types
 * (tax_settings, one row each), ALL shipped DISABLED with no rate:
 *
 *   VAT_OUTPUT  — on chalan sales (base = the chalan's recorded
 *                 sale value, total_amount). Leg: Dr 4000 Sales
 *                 Revenue (the VAT part of recorded sales is not
 *                 revenue) / Cr 2030 VAT Payable.
 *   VAT_INPUT   — on company expenses the admin flagged
 *                 vat_bearing (never auto-assumed). Leg: Dr 2030
 *                 VAT Payable (input credit) / Cr the expense's
 *                 own account (5200/5210, mirroring P4).
 *   TDS_SALARY  — withheld at salary issue through the shared
 *                 salary service's deduction input (the payment
 *                 itself is net); this module records the books:
 *                 Dr 5010 Salary – Basic / Cr 2040 TDS Payable,
 *                 so 5010 carries the GROSS across P5 + P11.
 *   TDS_PAYMENT — withheld on journal-backed counterparty
 *                 settlements (A5 settlePayable, per-settlement
 *                 opt-in): the settlement entry itself carries
 *                 Dr 2000 gross / Cr paid-via net / Cr 2040 TDS;
 *                 this module supplies the math + register line.
 *
 * Laws honoured:
 *  - DORMANCY: with every type disabled (the shipped state) no
 *    recorder writes anything — no register lines, no journal
 *    legs, no behaviour change in any source flow.
 *  - NO INVENTED TAX: rates are owner/CA-entered in the settings
 *    screen; enabling a type without a rate + effective-from date
 *    is refused. Nothing is backfilled onto historical records.
 *  - APPEND-ONLY: corrections travel as reversal entries; a
 *    register line is never deleted — it flips to 'reversed'.
 *  - PERIOD RESPECT (A3): tax postings go through postEvent, so a
 *    closed/locked period refuses them; the calling hook records
 *    the durable posting exception (fail-soft law stands).
 */
import { dhakaDateOf, dhakaToday } from '../../dhaka-time'
import { postEvent, reverseEntry, poishaToDecimalString, type Db, type PostEventInput, type PostResult } from './post'
import { ACCT } from './events'
import { toPoishaExact, taka } from './reports'

export class TaxError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'TaxError'
    this.status = status
  }
}

export const TAX_TYPES = ['VAT_OUTPUT', 'VAT_INPUT', 'TDS_SALARY', 'TDS_PAYMENT'] as const
export type TaxType = (typeof TAX_TYPES)[number]

export const TAX_KIND: Record<TaxType, string> = {
  VAT_OUTPUT: 'vat_output',
  VAT_INPUT: 'vat_input',
  TDS_SALARY: 'tds_salary',
  TDS_PAYMENT: 'tds_payment',
}

const TAX_META: Record<TaxType, { label: string; defaultPayable: string; defaultOffset: string | null; blurb: string }> = {
  VAT_OUTPUT: {
    label: 'VAT — Output (on chalan sales)',
    defaultPayable: '2030',
    defaultOffset: '4000',
    blurb: 'Charged on the recorded sale value of chalans when they post.',
  },
  VAT_INPUT: {
    label: 'VAT — Input (on VAT-bearing company expenses)',
    defaultPayable: '2030',
    defaultOffset: null,
    blurb: 'Input credit on company expenses an admin flags as VAT-bearing. Unflagged expenses never claim input VAT.',
  },
  TDS_SALARY: {
    label: 'TDS — Salary (withheld at issue)',
    defaultPayable: '2040',
    defaultOffset: null,
    blurb: 'Withheld from salary payments at issue (modal + payroll) through the shared salary service.',
  },
  TDS_PAYMENT: {
    label: 'TDS — Payments (withheld on settlements)',
    defaultPayable: '2040',
    defaultOffset: null,
    blurb: 'Withheld when a company-expense payable is settled from Accounts, only when the admin ticks "Deduct TDS" on that settlement.',
  },
}

// ── Rate math (integer-exact; rate has ≤ 4 decimal places) ──────

/** Percent value (Decimal|string|number, ≤4dp) → integer units of
 * 1e-4 percent ('7.5000' → 75000). Digit-parsed, never via floats. */
export function rateUnits(rate: unknown): number {
  if (rate === null || rate === undefined) return 0
  const s = String((rate as any).toString ? (rate as any).toString() : rate)
  const neg = s.startsWith('-')
  const [i, f = ''] = s.replace('-', '').split('.')
  const units = parseInt(i || '0', 10) * 10000 + parseInt((f + '0000').slice(0, 4), 10)
  return neg ? -units : units
}

/** Integer 1e-4-percent units → '7.5000' storage/display string. */
export function formatRate(units: number): string {
  return `${Math.floor(units / 10000)}.${String(units % 10000).padStart(4, '0')}`
}

/** tax = base × rate%, poisha-exact, rounded half-up at the poisha. */
export function computeTaxPoisha(basePoisha: number, units: number): number {
  if (basePoisha <= 0 || units <= 0) return 0
  return Math.floor((basePoisha * units + 500000) / 1000000)
}

const dateStrOf = (d: any): string => {
  if (!d) return ''
  if (typeof d === 'string') return d.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

// ── Settings ──────────────────────────────────────────────────────

async function accountIdByCode(db: Db, code: string): Promise<string | null> {
  const row = await db.chartAccount.findUnique({ where: { code }, select: { id: true } })
  return row?.id ?? null
}

async function accountCodesById(db: Db, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = ids.filter(Boolean) as string[]
  if (!wanted.length) return new Map()
  const rows = await db.chartAccount.findMany({
    where: { id: { in: wanted } },
    select: { id: true, code: true },
  })
  return new Map(rows.map((r: any) => [r.id, r.code]))
}

/** The four config rows with their linked accounts resolved to
 * codes, plus the chart list for the settings screen's selects.
 * A missing row reads as its dormant default (the DDL seeds all
 * four; this is only a safety net). */
export async function listTaxSettings(db: Db): Promise<{ settings: any[]; accounts: any[]; dormant: boolean }> {
  const rows = await db.taxSetting.findMany({})
  const byType = new Map<string, any>(rows.map((r: any) => [r.tax_type, r]))
  const accounts = await db.chartAccount.findMany({
    where: { is_active: true },
    select: { id: true, code: true, name: true, type: true },
    orderBy: { code: 'asc' },
  })
  const nameOf = new Map<string, any>(accounts.map((a: any) => [a.id, a]))
  const settings = TAX_TYPES.map((type) => {
    const meta = TAX_META[type]
    const row = byType.get(type)
    const payable = row?.payable_account_id ? nameOf.get(row.payable_account_id) : null
    const offset = row?.offset_account_id ? nameOf.get(row.offset_account_id) : null
    return {
      tax_type: type,
      kind: TAX_KIND[type],
      label: row?.label ?? meta.label,
      blurb: meta.blurb,
      is_enabled: !!row?.is_enabled,
      rate_percent: row?.rate_percent != null ? formatRate(rateUnits(row.rate_percent)) : null,
      effective_from: row?.effective_from ? dateStrOf(row.effective_from) : null,
      payable_account_id: row?.payable_account_id ?? null,
      payable_code: payable?.code ?? meta.defaultPayable,
      payable_name: payable?.name ?? null,
      offset_account_id: row?.offset_account_id ?? null,
      offset_code: offset?.code ?? meta.defaultOffset,
      offset_name: offset?.name ?? null,
      notes: row?.notes ?? null,
      configured: !!(row && row.is_enabled && row.rate_percent != null && row.effective_from),
    }
  })
  return { settings, accounts, dormant: !settings.some((s) => s.configured) }
}

/**
 * Update one tax type's configuration. Enabling is refused without
 * a rate, an effective-from date and a linked payable account —
 * the system never invents a rate, and a half-configured "enabled"
 * type would silently record nothing, which is worse than a clear
 * refusal at save time.
 */
export async function updateTaxSetting(
  db: Db,
  taxType: string,
  patch: {
    rate_percent?: unknown
    effective_from?: unknown
    is_enabled?: unknown
    payable_account_id?: unknown
    offset_account_id?: unknown
    notes?: unknown
  }
): Promise<{ before: any; after: any }> {
  if (!(TAX_TYPES as readonly string[]).includes(taxType)) {
    throw new TaxError(400, `Unknown tax type ${taxType}`)
  }
  const type = taxType as TaxType
  const meta = TAX_META[type]
  const before = await db.taxSetting.findUnique({ where: { tax_type: type } })

  const data: Record<string, unknown> = {}
  if (patch.rate_percent !== undefined) {
    if (patch.rate_percent === null || patch.rate_percent === '') {
      data.rate_percent = null
    } else {
      const s = String(patch.rate_percent)
      if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) {
        throw new TaxError(400, 'rate_percent must be a percentage with up to 4 decimal places (e.g. 7.5)')
      }
      const units = rateUnits(s)
      if (units < 0 || units > 100 * 10000) throw new TaxError(400, 'rate_percent must be between 0 and 100')
      data.rate_percent = formatRate(units)
    }
  }
  if (patch.effective_from !== undefined) {
    if (patch.effective_from === null || patch.effective_from === '') {
      data.effective_from = null
    } else {
      const s = String(patch.effective_from)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new TaxError(400, 'effective_from must be YYYY-MM-DD')
      data.effective_from = new Date(`${s}T00:00:00Z`)
    }
  }
  if (patch.is_enabled !== undefined) data.is_enabled = !!patch.is_enabled
  for (const key of ['payable_account_id', 'offset_account_id'] as const) {
    if (patch[key] !== undefined) {
      if (patch[key] === null || patch[key] === '') {
        data[key] = null
      } else {
        const acct = await db.chartAccount.findUnique({ where: { id: String(patch[key]) }, select: { id: true } })
        if (!acct) throw new TaxError(400, `${key} does not match a chart account`)
        data[key] = String(patch[key])
      }
    }
  }
  if (patch.notes !== undefined) data.notes = patch.notes === null ? null : String(patch.notes).slice(0, 500)

  // Validate the MERGED state before writing anything.
  const merged = { ...(before ?? {}), ...data }
  if (merged.is_enabled) {
    if (merged.rate_percent === null || merged.rate_percent === undefined || rateUnits(merged.rate_percent) <= 0) {
      throw new TaxError(400, 'Set a rate before enabling — the system never invents a tax rate. Enter the rate your CA confirms.')
    }
    if (!merged.effective_from) {
      throw new TaxError(400, 'Set the effective-from date before enabling.')
    }
    if (!merged.payable_account_id && !before?.payable_account_id) {
      // The seeded default link counts; only a fully unlinked type refuses.
      const def = await accountIdByCode(db, meta.defaultPayable)
      if (!def) throw new TaxError(400, 'Link a payable chart account before enabling.')
      data.payable_account_id = def
    }
  }

  data.updated_at = new Date()
  const after = before
    ? await db.taxSetting.update({ where: { tax_type: type }, data })
    : await db.taxSetting.create({
        data: {
          tax_type: type,
          label: meta.label,
          payable_account_id: await accountIdByCode(db, meta.defaultPayable),
          offset_account_id: meta.defaultOffset ? await accountIdByCode(db, meta.defaultOffset) : null,
          ...data,
        },
      })
  return { before, after }
}

// ── Effective configuration ───────────────────────────────────────

export interface EffectiveTax {
  tax_type: TaxType
  kind: string
  /** Percent as a 4dp string, e.g. '7.5000'. */
  rate_percent: string
  rate_units: number
  payable_code: string
  offset_code: string | null
}

/** The tax a type levies on `dateStr` (YYYY-MM-DD), or null when
 * the type is dormant for that date: disabled, rate unset/zero,
 * no effective-from, or not yet effective. This is the ONLY gate
 * every recorder passes through — dormancy is structural. */
export async function effectiveTax(db: Db, taxType: TaxType, dateStr: string): Promise<EffectiveTax | null> {
  const meta = TAX_META[taxType]
  const s = await db.taxSetting.findUnique({ where: { tax_type: taxType } })
  if (!s || !s.is_enabled) return null
  if (s.rate_percent === null || s.rate_percent === undefined) return null
  const units = rateUnits(s.rate_percent)
  if (units <= 0) return null
  if (!s.effective_from) return null
  if (dateStrOf(s.effective_from) > dateStr) return null
  const codes = await accountCodesById(db, [s.payable_account_id, s.offset_account_id])
  return {
    tax_type: taxType,
    kind: TAX_KIND[taxType],
    rate_percent: formatRate(units),
    rate_units: units,
    payable_code: (s.payable_account_id && codes.get(s.payable_account_id)) || meta.defaultPayable,
    offset_code: (s.offset_account_id && codes.get(s.offset_account_id)) || meta.defaultOffset,
  }
}

/** The TDS a salary of `grossPoisha` issued on `dateStr` bears, or
 * null when TDS_SALARY is dormant. Shared by the salary service
 * (auto-apply) and payroll (explicit deduction input) so both
 * paths compute the identical figure from the identical config. */
export async function salaryTdsFor(
  db: Db,
  grossPoisha: number,
  dateStr: string
): Promise<{ rate_percent: string; rate_units: number; tax_p: number; tax: number; payable_code: string } | null> {
  const cfg = await effectiveTax(db, 'TDS_SALARY', dateStr)
  if (!cfg) return null
  const tax_p = computeTaxPoisha(grossPoisha, cfg.rate_units)
  if (tax_p <= 0) return null
  return { rate_percent: cfg.rate_percent, rate_units: cfg.rate_units, tax_p, tax: tax_p / 100, payable_code: cfg.payable_code }
}

// ── Register lines ────────────────────────────────────────────────

/** The create-data for one register line (shared with the A5
 * settlement flow, which writes its line inside its own
 * transaction against the settlement's journal entry). */
export function registerLineData(f: {
  period: string
  kind: string
  source_table: string
  source_id: string
  base_p: number
  rate_percent: string
  tax_p: number
  counterparty_id?: string | null
  journal_entry_id?: string | null
}) {
  return {
    period: f.period,
    kind: f.kind,
    source_table: f.source_table,
    source_id: f.source_id,
    base_amount: poishaToDecimalString(f.base_p),
    rate: f.rate_percent,
    tax_amount: poishaToDecimalString(f.tax_p),
    counterparty_id: f.counterparty_id ?? null,
    journal_entry_id: f.journal_entry_id ?? null,
    status: 'active',
  }
}

async function reverseTaxLine(db: Db, line: any, opts: { entry_date: string; created_by?: string | null }): Promise<void> {
  if (line.journal_entry_id) {
    await reverseEntry(db, line.journal_entry_id, {
      entry_date: opts.entry_date,
      memo: `Reversal of tax entry (${line.kind}) — source corrected/removed`,
      created_by: opts.created_by ?? null,
    })
  }
  await db.taxRegisterLine.update({ where: { id: line.id }, data: { status: 'reversed' } })
}

/** Reverse every ACTIVE tax posting for a source record (salary
 * void, expense/chalan delete). No-op when the source has none —
 * which, in the dormant state, is always. */
export async function reverseTaxForSource(
  db: Db,
  sourceTable: string,
  sourceId: string,
  opts: { entry_date: string; created_by?: string | null }
): Promise<number> {
  const lines = await db.taxRegisterLine.findMany({
    where: { source_table: sourceTable, source_id: sourceId, status: 'active' },
  })
  for (const line of lines) await reverseTaxLine(db, line, opts)
  return lines.length
}

/**
 * Post a tax entry with the journal's repost-after-reversal
 * family logic (mirrors events.ts postForSource): an already
 * active family member returns as-is; a fully reversed family
 * reposts under a suffixed event type.
 */
async function postTaxEntry(db: Db, input: PostEventInput): Promise<PostResult> {
  if (input.source_table && input.source_id) {
    const prior = await db.journalEntry.findMany({
      where: { source_table: input.source_table, source_id: input.source_id },
      select: { id: true, event_type: true },
    })
    const family = prior.filter(
      (e: any) => e.event_type === input.event_type || e.event_type.startsWith(`${input.event_type}_r`)
    )
    for (const e of family) {
      const reversed = await db.journalEntry.findFirst({
        where: { reverses_entry_id: e.id },
        select: { id: true },
      })
      if (!reversed) return postEvent(db, { ...input, event_type: e.event_type })
    }
    if (family.length) return postEvent(db, { ...input, event_type: `${input.event_type}_r${family.length}` })
  }
  return postEvent(db, input)
}

// ── Desired-state sync for chalan VAT-output / expense VAT-input ──

interface DesiredTax {
  kind: string
  base_p: number
  rate_percent: string
  rate_units: number
  tax_p: number
  entry: PostEventInput
}

async function desiredChalanVat(db: Db, chalanId: string, createdBy?: string | null): Promise<DesiredTax | null> {
  const row = await db.productChalan.findUnique({ where: { id: chalanId } })
  if (!row) return null
  const date = dhakaDateOf(row.created_at)
  const cfg = await effectiveTax(db, 'VAT_OUTPUT', date)
  if (!cfg) return null
  const base_p = toPoishaExact(row.total_amount)
  if (base_p <= 0) return null
  const tax_p = computeTaxPoisha(base_p, cfg.rate_units)
  if (tax_p <= 0) return null
  return {
    kind: cfg.kind,
    base_p,
    rate_percent: cfg.rate_percent,
    rate_units: cfg.rate_units,
    tax_p,
    entry: {
      source_table: 'product_chalans',
      source_id: row.id,
      event_type: 'tax_vat_output',
      entry_date: date,
      memo: `Output VAT — chalan ${row.chalan_ref ?? row.id.slice(0, 8)} sale ৳${taka(base_p)} @ ${cfg.rate_percent}%`,
      created_by: createdBy ?? null,
      lines: [
        {
          account_code: cfg.offset_code ?? '4000',
          branch_id: row.branch_id ?? null,
          debit: tax_p / 100,
          memo: 'VAT portion of the recorded sale value',
        },
        { account_code: cfg.payable_code, credit: tax_p / 100, memo: 'VAT payable' },
      ],
    },
  }
}

async function desiredCompanyVat(db: Db, expenseId: string, createdBy?: string | null): Promise<DesiredTax | null> {
  const row = await db.companyExpense.findUnique({ where: { id: expenseId } })
  if (!row || !row.vat_bearing) return null
  const date = dhakaDateOf(row.created_at)
  const cfg = await effectiveTax(db, 'VAT_INPUT', date)
  if (!cfg) return null
  const base_p = toPoishaExact(row.total_amount)
  if (base_p <= 0) return null
  const tax_p = computeTaxPoisha(base_p, cfg.rate_units)
  if (tax_p <= 0) return null
  const expenseCode = row.expense_kind === 'setup' ? ACCT.companySetup : ACCT.companyOperating
  return {
    kind: cfg.kind,
    base_p,
    rate_percent: cfg.rate_percent,
    rate_units: cfg.rate_units,
    tax_p,
    entry: {
      source_table: 'company_expenses',
      source_id: row.id,
      event_type: 'tax_vat_input',
      entry_date: date,
      memo: `Input VAT — company expense "${row.purpose}" ৳${taka(base_p)} @ ${cfg.rate_percent}%`,
      created_by: createdBy ?? null,
      lines: [
        { account_code: cfg.payable_code, debit: tax_p / 100, memo: 'Input VAT credit' },
        {
          account_code: expenseCode,
          branch_id: row.branch_id ?? null,
          credit: tax_p / 100,
          memo: 'VAT portion reclassified out of the expense',
        },
      ],
    },
  }
}

/**
 * Bring a source record's tax state to what the current config +
 * source figures demand: post when missing, keep when identical,
 * reverse + repost when the figures/rate/flag changed, reverse
 * when the event is no longer taxable. Used by the hooks on the
 * chalan + company-expense post/resync paths. PeriodBlockedError
 * propagates — the calling hook records the posting exception.
 */
export async function syncTaxForSource(
  db: Db,
  sourceTable: string,
  sourceId: string,
  createdBy?: string | null
): Promise<{ action: string }> {
  if (sourceTable !== 'product_chalans' && sourceTable !== 'company_expenses') {
    return { action: 'not_a_tax_source' }
  }
  const desired =
    sourceTable === 'product_chalans'
      ? await desiredChalanVat(db, sourceId, createdBy)
      : await desiredCompanyVat(db, sourceId, createdBy)
  const active = await db.taxRegisterLine.findFirst({
    where: { source_table: sourceTable, source_id: sourceId, status: 'active' },
  })
  if (
    active &&
    desired &&
    active.kind === desired.kind &&
    toPoishaExact(active.base_amount) === desired.base_p &&
    toPoishaExact(active.tax_amount) === desired.tax_p &&
    rateUnits(active.rate) === desired.rate_units
  ) {
    // Figures match — but the line is only truly live while its
    // journal entry stands unreversed (an entry is "reversed" in
    // this journal when a contra entry points at it). If the
    // entry was reversed elsewhere, fall through and repost so
    // the register and the journal can never silently diverge.
    const contra = active.journal_entry_id
      ? await db.journalEntry.findFirst({
          where: { reverses_entry_id: active.journal_entry_id },
          select: { id: true },
        })
      : null
    if (!contra) return { action: 'kept' }
  }
  if (active) {
    await reverseTaxLine(db, active, {
      entry_date: dhakaToday(),
      created_by: createdBy ?? null,
    })
  }
  if (!desired) return { action: active ? 'reversed' : 'noop' }
  const posted = await postTaxEntry(db, desired.entry)
  await db.taxRegisterLine.create({
    data: registerLineData({
      period: desired.entry.entry_date.slice(0, 7),
      kind: desired.kind,
      source_table: sourceTable,
      source_id: sourceId,
      base_p: desired.base_p,
      rate_percent: desired.rate_percent,
      tax_p: desired.tax_p,
      counterparty_id: null,
      journal_entry_id: posted.entry_id,
    }),
  })
  return { action: posted.created ? 'posted' : 'reposted' }
}

// ── Salary TDS recording (the deduction itself happens in the
//    shared salary service; this writes the books) ────────────────

/**
 * Record the TDS a salary issue withheld: the P11 journal leg
 * (Dr 5010 / Cr TDS payable) + the register line. Idempotent — an
 * active line for the payment returns as-is. PeriodBlockedError
 * propagates to the caller's fail-soft hook (exception recorded).
 */
export async function recordSalaryTax(
  db: Db,
  payment: any,
  applied: { base_p: number; rate_percent: string; tax_p: number },
  counterpartyId?: string | null,
  createdBy?: string | null
): Promise<{ entry_id: string; register_id: string; created: boolean }> {
  const existing = await db.taxRegisterLine.findFirst({
    where: { source_table: 'salary_payments', source_id: payment.id, kind: 'tds_salary', status: 'active' },
  })
  if (existing) return { entry_id: existing.journal_entry_id, register_id: existing.id, created: false }
  const date = dhakaDateOf(payment.payment_date)
  const cfg = await effectiveTax(db, 'TDS_SALARY', date)
  const payableCode = cfg?.payable_code ?? ACCT.tdsPayable
  const posted = await postTaxEntry(db, {
    source_table: 'salary_payments',
    source_id: payment.id,
    event_type: 'tax_tds_salary',
    entry_date: date,
    memo: `TDS withheld on salary @ ${applied.rate_percent}% (base ৳${taka(applied.base_p)})`,
    created_by: createdBy ?? null,
    lines: [
      {
        account_code: ACCT.salaryBasic,
        branch_id: payment.branch_id ?? null,
        debit: applied.tax_p / 100,
        memo: 'Gross-up: salary expense carries the gross; P5 carries the net paid',
      },
      { account_code: payableCode, credit: applied.tax_p / 100, memo: 'TDS payable' },
    ],
  })
  const line = await db.taxRegisterLine.create({
    data: registerLineData({
      period: date.slice(0, 7),
      kind: 'tds_salary',
      source_table: 'salary_payments',
      source_id: payment.id,
      base_p: applied.base_p,
      rate_percent: applied.rate_percent,
      tax_p: applied.tax_p,
      counterparty_id: counterpartyId ?? null,
      journal_entry_id: posted.entry_id,
    }),
  })
  return { entry_id: posted.entry_id, register_id: line.id, created: posted.created }
}

// ── Reads: register + per-period return summary ───────────────────

export async function listRegisterLines(
  db: Db,
  filters: { kind?: string | null; period?: string | null; limit?: number }
): Promise<any[]> {
  const rows = await db.taxRegisterLine.findMany({
    where: {
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.period ? { period: filters.period } : {}),
    },
    orderBy: [{ period: 'desc' }, { created_at: 'desc' }],
    take: Math.min(Math.max(filters.limit ?? 200, 1), 500),
  })
  const parties = await db.counterparty.findMany({ select: { id: true, name: true } })
  const nameOf = new Map<string, string>(parties.map((p: any) => [p.id, p.name]))
  return rows.map((r: any) => ({
    id: r.id,
    period: r.period,
    kind: r.kind,
    source_table: r.source_table,
    source_id: r.source_id,
    base_amount: taka(toPoishaExact(r.base_amount)),
    rate: formatRate(rateUnits(r.rate)),
    tax_amount: taka(toPoishaExact(r.tax_amount)),
    counterparty_id: r.counterparty_id,
    counterparty_name: r.counterparty_id ? (nameOf.get(r.counterparty_id) ?? null) : null,
    journal_entry_id: r.journal_entry_id,
    status: r.status,
    created_at: r.created_at,
  }))
}

/** Per-period return view: output VAT − input VAT = net VAT
 * payable; TDS totals alongside. ACTIVE register lines only —
 * display only, no filing integration exists or is implied. */
export async function taxPeriodSummaries(db: Db): Promise<any[]> {
  const rows = await db.taxRegisterLine.findMany({ where: { status: 'active' } })
  const byPeriod = new Map<string, Record<string, number>>()
  for (const r of rows) {
    const cur = byPeriod.get(r.period) ?? { vat_output: 0, vat_input: 0, tds_salary: 0, tds_payment: 0 }
    if (r.kind in cur) cur[r.kind] += toPoishaExact(r.tax_amount)
    byPeriod.set(r.period, cur)
  }
  return [...byPeriod.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([period, v]) => ({
      period,
      vat_output: taka(v.vat_output),
      vat_input: taka(v.vat_input),
      net_vat_payable: taka(v.vat_output - v.vat_input),
      tds_salary: taka(v.tds_salary),
      tds_payment: taka(v.tds_payment),
      tds_total: taka(v.tds_salary + v.tds_payment),
    }))
}
