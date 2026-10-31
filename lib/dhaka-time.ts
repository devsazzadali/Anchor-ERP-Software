/**
 * Asia/Dhaka date helpers — single source of truth for "today" and
 * month/day windows.
 *
 * The business runs on Dhaka time (UTC+6, no DST). Code across the app
 * used `new Date().toISOString().split('T')[0]` — a UTC date — so from
 * 00:00 to 05:59 Dhaka every "today" was yesterday, and month windows
 * built with `new Date(y, m + 1, 0).toISOString()` silently dropped the
 * last day of the month. (Audit B9/B10/B33/B56, C42.)
 *
 * All windows here are half-open [start, end) on YYYY-MM-DD strings,
 * which compare correctly against DATE columns with gte/lt.
 */

export const DHAKA_TIME_ZONE = 'Asia/Dhaka';

const datePartFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DHAKA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in Asia/Dhaka as YYYY-MM-DD. */
export function dhakaToday(): string {
  // en-CA formats as YYYY-MM-DD.
  return datePartFmt.format(new Date());
}

/** The Dhaka calendar date (YYYY-MM-DD) of an arbitrary instant. */
export function dhakaDateOf(instant: Date): string {
  return datePartFmt.format(instant);
}

/** Add whole days to a YYYY-MM-DD string (pure calendar math, UTC-based). */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Half-open month window [start, endExclusive) for a 1-based month.
 * Query with `.gte(col, start).lt(col, endExclusive)` — every day of the
 * month is included, including the last one.
 */
export function dhakaMonthWindow(year: number, month1to12: number): { start: string; endExclusive: string } {
  const start = `${year}-${String(month1to12).padStart(2, '0')}-01`;
  const endExclusive = month1to12 === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month1to12 + 1).padStart(2, '0')}-01`;
  return { start, endExclusive };
}

/** Half-open window for the month containing a YYYY-MM-DD date. */
export function monthWindowOf(dateStr: string): { start: string; endExclusive: string } {
  const [y, m] = dateStr.split('-').map(Number);
  return dhakaMonthWindow(y, m);
}

/** Current Dhaka month window. */
export function currentDhakaMonthWindow(): { start: string; endExclusive: string } {
  return monthWindowOf(dhakaToday());
}

/**
 * UTC ISO instants bounding a Dhaka calendar day, for filtering
 * timestamptz columns (e.g. completed_at) by the Dhaka day the user
 * picked. Dhaka is always UTC+6, so the day runs 18:00Z → 18:00Z.
 * Use with `.gte(col, startIso).lt(col, endIso)`. (Audit B40/B41.)
 */
export function dhakaDayUtcWindow(dateStr: string): { startIso: string; endIso: string } {
  const start = new Date(`${dateStr}T00:00:00+06:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** UTC ISO window for a Dhaka date range [fromDate, toDate] inclusive. */
export function dhakaRangeUtcWindow(fromDate: string, toDate: string): { startIso: string; endIso: string } {
  const start = new Date(`${fromDate}T00:00:00+06:00`);
  const end = new Date(`${toDate}T00:00:00+06:00`);
  end.setTime(end.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
