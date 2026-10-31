/**
 * Utility functions for handling multi-day bank deposits and daily sales breakdowns.
 */

export interface DailyBreakdownItem {
  date: string;
  amount: number;
}

/**
 * Parses daily_breakdown from either native column (json/object/string) or from notes tag [DAILY_BREAKDOWN: {...}]
 */
export function parseDailyBreakdown(deposit: any): Record<string, number> | null {
  if (!deposit) return null;

  // 1. Direct object from JSONB column
  if (deposit.daily_breakdown && typeof deposit.daily_breakdown === 'object' && !Array.isArray(deposit.daily_breakdown)) {
    const keys = Object.keys(deposit.daily_breakdown);
    if (keys.length > 0) return deposit.daily_breakdown;
  }

  // 2. Direct string JSON
  if (typeof deposit.daily_breakdown === 'string') {
    try {
      const parsed = JSON.parse(deposit.daily_breakdown);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}
  }

  // 3. Fallback from notes tag: [DAILY_BREAKDOWN: {...}]
  if (deposit.notes && typeof deposit.notes === 'string') {
    const match = deposit.notes.match(/\[DAILY_BREAKDOWN:\s*(\{[\s\S]*?\})\]/);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Converts a daily breakdown map to a sorted array of items with formatted details
 */
export function getDailyBreakdownList(breakdown: Record<string, number> | null | undefined): DailyBreakdownItem[] {
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) return [];
  return Object.entries(breakdown)
    .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .map(([date, amount]) => ({ date, amount: Number(amount || 0) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Parses the khuchra (remaining change) amount from a deposit record.
 * Uses: column value first, then [KHUCHRA_AMOUNT: ...] tag in notes as fallback.
 */
export function parseKhuchraAmount(deposit: any): number {
  if (!deposit) return 0;

  // 1. From dedicated column (post-migration). B61: a stored 0 is a
  // LEGITIMATE value (nothing kept back) — the old `> 0` test treated
  // it as "absent" and fell through to the notes tag, so a stale tag
  // from an earlier edit resurrected a non-zero khuchra.
  if (deposit.khuchra_amount != null && Number.isFinite(Number(deposit.khuchra_amount))) {
    return Number(deposit.khuchra_amount);
  }

  // 2. Fallback from notes tag: [KHUCHRA_AMOUNT: 370]
  if (deposit.notes && typeof deposit.notes === 'string') {
    const match = deposit.notes.match(/\[KHUCHRA_AMOUNT:\s*([\d.]+)\]/);
    if (match && match[1]) {
      const val = parseFloat(match[1]);
      if (!isNaN(val) && val > 0) return val;
    }
  }

  return 0;
}

/**
 * Cleans notes string by removing internal metadata tags ([DAILY_BREAKDOWN: ...], [KHUCHRA_AMOUNT: ...]) for display
 */
export function cleanDepositNotes(notes: string | null | undefined): string {
  if (!notes) return '';
  return notes
    .replace(/\[DAILY_BREAKDOWN:\s*\{[\s\S]*?\}\]\s*/g, '')
    .replace(/\[KHUCHRA_AMOUNT:\s*[\d.]+\]\s*/g, '')
    .trim();
}
