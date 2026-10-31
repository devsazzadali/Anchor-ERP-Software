/**
 * fetchAllRows — exhaust a PostgREST query instead of silently
 * truncating at the 1000-row default cap.
 *
 * Many screens fetched whole tables with a bare `.select()` and summed
 * the result in JS; once a table passed 1000 rows every total was
 * silently wrong. (Audit B26/C37/C38.)
 *
 * Usage: pass a factory that builds the query for one page. The factory
 * receives (from, to) and must apply `.range(from, to)`. Pages are
 * fetched until a short page comes back. The underlying query MUST have
 * a deterministic ORDER BY (add a unique tiebreaker such as id) or rows
 * can repeat/vanish between pages.
 *
 * Returns the full row array. Throws on a page error — callers are
 * routes/handlers whose try/catch turns that into a 500, which is the
 * honest outcome (a silently partial total is worse than an error).
 */
export const POSTGREST_PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function fetchAllRows<T>(
  makePageQuery: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + POSTGREST_PAGE_SIZE - 1;
    const { data, error } = await makePageQuery(from, to);
    if (error) throw new Error(`fetchAllRows page fetch failed: ${error.message}`);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < POSTGREST_PAGE_SIZE) return all;
    from += POSTGREST_PAGE_SIZE;
  }
}
