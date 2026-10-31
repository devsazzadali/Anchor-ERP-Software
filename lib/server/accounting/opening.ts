/**
 * Accounts A1 — the computed opening position (blueprint §B.3).
 *
 * Computed ENTIRELY from existing records — nothing is invented and
 * nothing is posted by this module. The position is stored as a
 * DRAFT (opening_positions + lines) for the owner to review and
 * confirm; A1 never confirms it. Bank figures are deposit-history
 * hints on DRAFT candidates; the equity line is the explicit
 * balancing figure and is labelled provisional while any component
 * is unconfirmed. Incomplete history (cost-missing chalans, the
 * SOTIBARI deposit drift) is carried as FLAGS, never absorbed.
 *
 * Because ALL history is backfilled into the journal (owner's
 * order), this position is a confirmation artifact over the books —
 * not a P12 posting; posting it on top of the backfill would
 * double-count every figure it summarises.
 */
import { dhakaDateOf } from '../../dhaka-time'
import { type Db } from './post'

const n = (v: unknown): number => (v == null ? 0 : Number((v as any).toString()))
const fmt = (v: number): string => v.toFixed(2)

export interface OpeningFlag {
  code: string
  amount?: number
  count?: number
  text: string
}

export interface OpeningComputation {
  as_of: string
  lines: Array<{
    component: string
    label: string
    amount: number
    side: 'debit' | 'credit'
    branch_id?: string | null
    bank_account_id?: string | null
    source_note: string
    detail?: unknown
  }>
  totals: { debits: number; credits: number; equity: number }
  flags: OpeningFlag[]
}

export async function computeOpeningPosition(db: Db): Promise<OpeningComputation> {
  const lines: OpeningComputation['lines'] = []
  const flags: OpeningFlag[] = []

  // ── Cash per branch: latest CLOSED closing row's counted cash ──
  const branches = await db.branch.findMany({ orderBy: { name: 'asc' } })
  let cashTotal = 0
  let branchesWithoutClosed = 0
  for (const b of branches) {
    const last = await db.branchCashLedger.findFirst({
      where: { branch_id: b.id, is_closed: true, actual_cash: { not: null } },
      orderBy: { ledger_date: 'desc' },
    })
    if (!last) {
      branchesWithoutClosed++
      continue
    }
    const amount = n(last.actual_cash)
    cashTotal += amount
    lines.push({
      component: 'cash_branch',
      label: `Cash in hand — ${b.name}`,
      amount,
      side: 'debit',
      branch_id: b.id,
      source_note: `Latest closed closing ${last.ledger_date.toISOString().slice(0, 10)}: counted ৳${fmt(amount)} (expected ৳${fmt(n(last.expected_closing_cash))}, difference ৳${fmt(n(last.cash_difference))})`,
      detail: { ledger_id: last.id, date: last.ledger_date.toISOString().slice(0, 10) },
    })
  }
  if (branchesWithoutClosed > 0) {
    flags.push({
      code: 'CASH_NOT_RECORDED',
      count: branchesWithoutClosed,
      text: `${branchesWithoutClosed} branches have no closed daily closing — no counted cash figure exists for them in the system.`,
    })
  }

  // ── Bank: DRAFT candidates, deposit-history hints only ─────────
  const banks = await db.bankAccount.findMany({ where: { is_active: true } })
  let bankTotal = 0
  for (const bank of banks) {
    const hint = bank.derived_hint == null ? 0 : n(bank.derived_hint)
    bankTotal += hint
    lines.push({
      component: 'bank_candidate',
      label: bank.label,
      amount: hint,
      side: 'debit',
      bank_account_id: bank.id,
      source_note: bank.is_draft
        ? 'DRAFT candidate — figure is Σ approved deposits from history only (no withdrawals are recorded anywhere). NOT a confirmed balance: confirm against the bank statement.'
        : 'Confirmed bank account.',
      detail: { is_draft: bank.is_draft, opening_balance: bank.opening_balance?.toString() ?? null },
    })
  }
  if (banks.some((b: any) => b.is_draft)) {
    flags.push({
      code: 'BANK_UNCONFIRMED',
      count: banks.filter((b: any) => b.is_draft).length,
      amount: bankTotal,
      text: 'Bank balances are unconfirmed draft candidates derived from deposit history. The equity figure below stays provisional until the owner confirms real balances from statements.',
    })
  }

  // ── Inventory at cost: costed chalans only, coverage flagged ───
  const chalans = await db.productChalan.findMany({
    select: { id: true, total_amount: true, total_cost: true },
  })
  const costed = chalans.filter((c: any) => n(c.total_cost) > 0)
  const uncosted = chalans.filter((c: any) => n(c.total_cost) <= 0)
  const inventoryCost = costed.reduce((a: number, c: any) => a + n(c.total_cost), 0)
  const uncostedSale = uncosted.reduce((a: number, c: any) => a + n(c.total_amount), 0)
  lines.push({
    component: 'inventory_cost',
    label: 'Inventory at cost (partial — costed chalans only)',
    amount: inventoryCost,
    side: 'debit',
    source_note: `Σ recorded cost of the ${costed.length} costed chalans. ${uncosted.length} legacy chalans carry NO recorded cost anywhere in the system, so true stock value is higher — the owner may override with a counted stock value at confirmation.`,
    detail: { costed: costed.length, uncosted: uncosted.length, uncosted_sale_value: uncostedSale },
  })
  flags.push({
    code: 'CHALAN_COST_MISSING',
    count: uncosted.length,
    amount: uncostedSale,
    text: `${uncosted.length} legacy chalans (sale value ৳${fmt(uncostedSale)}) have no recorded purchase cost — they post no inventory entry and their cost is NOT estimated anywhere. "Cost not recorded" stands until real figures are supplied.`,
  })

  // ── Payables: itemised from recorded dues ───────────────────────
  const dueExpenses = await db.companyExpense.findMany({
    where: { due_amount: { gt: 0 } },
    orderBy: { created_at: 'asc' },
  })
  const payablesTotal = dueExpenses.reduce((a: number, c: any) => a + n(c.due_amount), 0)
  lines.push({
    component: 'payables',
    label: 'Accounts Payable — company expense dues',
    amount: payablesTotal,
    side: 'credit',
    source_note: 'Σ unpaid balances on company_expenses, itemised in detail. Branch-cash expenses and expense requests record no open dues; no salary accrual is recorded in the system (proposed ৳0).',
    detail: dueExpenses.map((c: any) => ({
      id: c.id,
      purpose: c.purpose,
      total: n(c.total_amount),
      paid: n(c.paid_amount),
      due: n(c.due_amount),
      date: dhakaDateOf(c.created_at),
    })),
  })

  // ── Known anomalies, carried visibly ────────────────────────────
  flags.push({
    code: 'DEPOSIT_DRIFT',
    amount: -11627,
    text: 'SOTIBARI 2026-09-10: deposit breakdown allocated ৳31,627 to that day but only ৳20,000 reached the ledger — the −৳11,627 difference is carried VISIBLY here and in the reconciliation view, never absorbed into any figure (owner decision OD-1).',
  })
  flags.push({
    code: 'DUPLICATE_RECORD',
    amount: 7110,
    text: 'Nur Renu’s ৳7,110 salary exists in BOTH salary_payments and a paid expense request (and two branch-cash mirror copies, now linked). The books post each source record once, exactly as the operational reports count them — the overlap stays flagged for the owner, it is not silently removed.',
  })
  flags.push({
    code: 'SALARY_HEAD_QUIRK',
    amount: 55785,
    text: '6 historical salary payments (৳55,785) carry ledger_head_id = "House Rent - Branch" in their source rows. The journal follows the financial summary’s verified mapping (all salary → Salary - Basic). Source rows are unchanged.',
  })

  // ── Equity: the explicit balancing figure ───────────────────────
  const debits = cashTotal + bankTotal + inventoryCost
  const equity = debits - payablesTotal
  lines.push({
    component: 'equity',
    label: 'Equity — balancing figure (TO BE CONFIRMED)',
    amount: equity,
    side: 'credit',
    source_note:
      'Assets − Liabilities from the components above. Shown explicitly as a balancing figure — it is provisional while bank balances are unconfirmed drafts, and one CA review of the chart + opening figures at setup is advised (blueprint §B.3).',
    detail: { assets: debits, liabilities: payablesTotal },
  })

  return {
    as_of: dhakaDateOf(new Date()),
    lines,
    totals: { debits, credits: payablesTotal + equity, equity },
    flags,
  }
}

/** Compute + store a new DRAFT position (prior drafts are kept). */
export async function storeOpeningPosition(db: Db): Promise<{ position_id: string; computation: OpeningComputation }> {
  const computation = await computeOpeningPosition(db)
  const position = await db.openingPosition.create({
    data: {
      label: `Opening position — computed ${computation.as_of} (DRAFT)`,
      as_of_date: new Date(`${computation.as_of}T00:00:00Z`),
      status: 'draft',
      notes: computation.flags.map((f) => `[${f.code}] ${f.text}`).join('\n'),
    },
  })
  await db.openingPositionLine.createMany({
    data: computation.lines.map((l) => ({
      position_id: position.id,
      component: l.component,
      label: l.label,
      amount: l.amount.toFixed(2),
      side: l.side,
      branch_id: l.branch_id ?? null,
      bank_account_id: l.bank_account_id ?? null,
      source_note: l.source_note,
      detail: (l.detail ?? null) as any,
    })),
  })
  return { position_id: position.id, computation }
}
