/**
 * Money helpers — single source of truth for taka amounts.
 *
 * All money in this app is stored as NUMERIC(15,2) taka, but JS numbers are
 * binary floats: 0.1 + 0.2 !== 0.3, and repeated float addition drifts.
 * These helpers do arithmetic in integer poisha (1 taka = 100 poisha) and
 * round at every boundary, so stored values and summed totals never carry
 * float residue. (Audit C53.)
 */

/** Hard upper bound accepted for any single money input (৳100 crore). */
export const MAX_MONEY_AMOUNT = 1_000_000_000;

/** Convert a taka amount to integer poisha, rounding half-up. */
export function toPoisha(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert integer poisha back to a taka number with at most 2 decimals. */
export function fromPoisha(poisha: number): number {
  return poisha / 100;
}

/** Round a taka amount to exactly 2 decimals via integer poisha. */
export function roundMoney(amount: number): number {
  return fromPoisha(toPoisha(amount));
}

/** Sum taka amounts exactly (integer-poisha arithmetic). */
export function sumMoney(values: Array<number | null | undefined>): number {
  let totalPoisha = 0;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    totalPoisha += toPoisha(n);
  }
  return fromPoisha(totalPoisha);
}

/**
 * Validate and normalise a client-supplied money amount.
 * Returns the rounded amount, or null when the value is not a finite
 * number inside [min, max]. Every money write path must use this —
 * previously amounts were checked only for `> 0` (or not at all), so
 * NaN, negatives and absurd values reached the database. (Part D:
 * input validation.)
 */
export function parseMoneyAmount(
  value: unknown,
  options: { min?: number; max?: number } = {}
): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const min = options.min ?? 0;
  const max = options.max ?? MAX_MONEY_AMOUNT;
  if (n < min || n > max) return null;
  return roundMoney(n);
}

/**
 * Split a total across weights proportionally — largest-remainder
 * method in integer poisha. Guarantees: every share is >= 0 and the
 * shares sum EXACTLY to the total. (Audit B58: the bank-deposit page
 * prorated with per-day Math.round and dumped the remainder on the
 * last day, which could go NEGATIVE when rounded shares overshot —
 * the server then rejected or silently mis-distributed the deposit.)
 * Zero/empty weights put the whole total on the last entry, matching
 * the historical single-day behaviour.
 */
export function allocateProportionally(total: number, weights: Array<number | null | undefined>): number[] {
  const totalPoisha = toPoisha(Math.max(0, Number(total) || 0));
  const n = weights.length;
  if (n === 0) return [];
  const cleanWeights = weights.map(w => {
    const v = Number(w ?? 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
  const weightSum = cleanWeights.reduce((s, v) => s + v, 0);
  if (weightSum <= 0) {
    return cleanWeights.map((_, i) => (i === n - 1 ? fromPoisha(totalPoisha) : 0));
  }
  const rawShares = cleanWeights.map(w => (w / weightSum) * totalPoisha);
  const shares = rawShares.map(r => Math.floor(r));
  let remainder = totalPoisha - shares.reduce((s, v) => s + v, 0);
  const byFraction = rawShares
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < byFraction.length && remainder > 0; k++, remainder--) {
    shares[byFraction[k].i] += 1;
  }
  return shares.map(fromPoisha);
}

export interface BreakdownValidation {
  ok: boolean;
  /** Sum of all breakdown entries (taka, 2dp). */
  sum: number;
  error?: string;
}

/**
 * Validate a deposit daily_breakdown against its deposit amount.
 * The breakdown is the per-sales-day split of the deposit; the ledger
 * trigger distributes exactly these slices, so the slices MUST add up
 * to the deposit amount — previously the client-computed breakdown was
 * trusted verbatim and the two could diverge permanently. (Audit B22.)
 */
export function validateBreakdown(
  amount: number,
  breakdown: unknown
): BreakdownValidation {
  if (breakdown === null || breakdown === undefined) {
    return { ok: true, sum: 0 };
  }
  if (typeof breakdown !== 'object' || Array.isArray(breakdown)) {
    return { ok: false, sum: 0, error: 'daily_breakdown must be an object keyed by date' };
  }
  const entries = Object.entries(breakdown as Record<string, unknown>);
  if (entries.length === 0) return { ok: true, sum: 0 };

  let sumPoisha = 0;
  for (const [date, raw] of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, sum: 0, error: `daily_breakdown has an invalid date key: ${date}` };
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, sum: 0, error: `daily_breakdown[${date}] must be a non-negative number` };
    }
    sumPoisha += toPoisha(value);
  }
  const sum = fromPoisha(sumPoisha);
  if (sumPoisha !== toPoisha(amount)) {
    return {
      ok: false,
      sum,
      error: `daily_breakdown total (৳${sum}) must equal the deposit amount (৳${roundMoney(amount)})`,
    };
  }
  return { ok: true, sum };
}
