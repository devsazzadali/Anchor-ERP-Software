/**
 * Accounts A3 — posting exceptions (lib/server/accounting/exceptions.ts).
 *
 * When the posting engine refuses a posting because its period is
 * closed/locked (PeriodBlockedError, post.ts), the operational
 * write that produced the event still stands — fail-soft law
 * (blueprint §B.0.2). What must NOT happen is the blocked posting
 * vanishing silently: it is recorded here, one durable row per
 * (source_table, source_id, event_type), surfaced on the Accounts
 * overview flags, and read by the A9 exceptions inbox when it
 * lands. Resolution is a later, deliberate act (reopen the period
 * and re-fire the hook, or post a correction) — recording never
 * auto-resolves.
 */
import { isPeriodBlockedError, type Db, type PeriodBlockedError } from './post'

/**
 * Record (or refresh) the exception for a blocked posting. Keyed
 * upsert: re-firing the same blocked event refreshes the row
 * instead of piling up duplicates. NEVER throws — it runs inside
 * the hooks' fail-soft catch blocks.
 */
export async function recordPostingException(
  db: Db,
  err: PeriodBlockedError,
  fallback?: { source_table?: string | null; source_id?: string | null; event_type?: string }
): Promise<void> {
  try {
    // The caller's own source ref wins when given (the company-
    // settlement hook posts under a derived state-key id — the
    // exception must point at the real expense row). The error's
    // event_type is the type actually attempted, so it wins there.
    const source_table = fallback?.source_table ?? err.source_table ?? null
    const source_id = fallback?.source_id ?? err.source_id ?? null
    const event_type = err.event_type ?? fallback?.event_type ?? 'unknown'
    if (!source_table || !source_id) {
      console.error('[accounts] blocked posting without a source ref — cannot record exception:', err.message)
      return
    }
    const detail = {
      memo: err.memo ?? null,
      blocked_status: err.status,
      recorded_from: 'period_enforcement',
    }
    const existing = await db.postingException.findFirst({
      where: { source_table, source_id, event_type },
      select: { id: true, status: true },
    })
    if (existing) {
      // A resolved exception whose event blocks AGAIN reopens —
      // and the A9 workflow fields clear with it, so the row goes
      // back to a clean 'open' state (nobody is still shown as
      // having acknowledged/resolved a live problem).
      await db.postingException.update({
        where: { id: existing.id },
        data: {
          entry_date: new Date(`${err.entry_date}T00:00:00Z`),
          period_month: err.month,
          reason: `period_${err.status}`,
          detail: detail as any,
          status: 'open',
          resolved_at: null,
          resolved_by: null,
          resolution_note: null,
          acknowledged_at: null,
          acknowledged_by: null,
        },
      })
    } else {
      await db.postingException.create({
        data: {
          source_table,
          source_id,
          event_type,
          entry_date: new Date(`${err.entry_date}T00:00:00Z`),
          period_month: err.month,
          reason: `period_${err.status}`,
          detail: detail as any,
          status: 'open',
        },
      })
    }
  } catch (e: any) {
    console.error('[accounts] recordPostingException failed (fail-soft):', e?.message || e)
  }
}

/** Convenience for hook catch blocks: record iff the error is a period block. */
export async function recordIfPeriodBlocked(
  db: Db,
  err: unknown,
  fallback?: { source_table?: string | null; source_id?: string | null; event_type?: string }
): Promise<boolean> {
  if (!isPeriodBlockedError(err)) return false
  await recordPostingException(db, err, fallback)
  return true
}

/** Open exceptions, oldest first — the overview flags + A9 feed. */
export async function listOpenExceptions(db: Db): Promise<any[]> {
  return db.postingException.findMany({
    where: { status: 'open' },
    orderBy: { created_at: 'asc' },
  })
}
