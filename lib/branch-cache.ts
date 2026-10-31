/**
 * In-memory client-side cache with Stale-While-Revalidate (SWR) support.
 * Enables instant (0ms) page renders when navigating between branch account tabs.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  inflight?: Promise<T>;
}

const cacheStore = new Map<string, CacheEntry<any>>();

/** Default TTL: 60 seconds */
const DEFAULT_TTL_MS = 60 * 1000;

export function getCachedData<T = any>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | null {
  const entry = cacheStore.get(key);
  if (!entry) return null;
  const isExpired = Date.now() - entry.timestamp > ttlMs;
  return isExpired ? null : (entry.data as T);
}

export function setCachedData<T = any>(key: string, data: T, _ttlMs?: number): void {
  const existing = cacheStore.get(key);
  cacheStore.set(key, {
    data,
    timestamp: Date.now(),
    inflight: existing?.inflight,
  });
}

export type FetcherOrUrl<T> = string | (() => Promise<T>);

export interface FetchWithCacheOptions<T> {
  ttlMs?: number;
  forceRefresh?: boolean;
  onBackgroundUpdate?: (freshData: T) => void;
}

async function executeFetcher<T>(fetcherOrUrl: FetcherOrUrl<T>): Promise<T> {
  if (typeof fetcherOrUrl === 'function') {
    return await fetcherOrUrl();
  }
  const res = await fetch(fetcherOrUrl);
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}: Failed to fetch ${fetcherOrUrl}`;
    try {
      const errJson = await res.json();
      if (errJson?.error) errorMsg = errJson.error;
    } catch {}
    throw new Error(errorMsg);
  }
  return (await res.json()) as T;
}

/**
 * Fetch with Stale-While-Revalidate (SWR) mechanics:
 * 1. If fresh data is in cache, return immediately (0ms).
 * 2. If stale data is in cache, return cached data immediately and refresh in background.
 * 3. Inflight requests are deduplicated so parallel requests don't duplicate network calls.
 * 4. Supports passing either an async fetcher function OR a URL string directly.
 * 5. Options can be a number (TTL ms) or an options object.
 */
export async function fetchWithCache<T = any>(
  key: string,
  fetcherOrUrl: FetcherOrUrl<T>,
  optionsOrTtl?: number | FetchWithCacheOptions<T>
): Promise<T> {
  const options: FetchWithCacheOptions<T> =
    typeof optionsOrTtl === 'number'
      ? { ttlMs: optionsOrTtl }
      : optionsOrTtl || {};

  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const entry = cacheStore.get(key);

  // 1. If forceRefresh is requested, bypass cache hit
  if (!options.forceRefresh && entry) {
    const age = Date.now() - entry.timestamp;

    // Fresh cache hit: return immediately
    if (age < ttl && entry.data !== undefined) {
      return entry.data as T;
    }

    // Stale cache hit: return stale data immediately, revalidate in background
    if (entry.data !== undefined) {
      if (!entry.inflight) {
        entry.inflight = (async () => {
          try {
            const fresh = await executeFetcher(fetcherOrUrl);
            entry.data = fresh;
            entry.timestamp = Date.now();
            if (options.onBackgroundUpdate) {
              options.onBackgroundUpdate(fresh);
            }
            return fresh;
          } catch (e) {
            console.warn(`[BranchCache] Background revalidate failed for ${key}:`, e);
            return entry.data;
          } finally {
            entry.inflight = undefined;
          }
        })();
      }
      return entry.data as T;
    }
  }

  // 2. Deduplicate simultaneous inflight requests
  if (entry?.inflight) {
    return entry.inflight;
  }

  // 3. Perform network fetch
  const fetchPromise = (async () => {
    try {
      const data = await executeFetcher(fetcherOrUrl);
      cacheStore.set(key, {
        data,
        timestamp: Date.now(),
        inflight: undefined,
      });
      return data;
    } catch (err) {
      const existing = cacheStore.get(key);
      if (existing) {
        existing.inflight = undefined;
      }
      throw err;
    }
  })();

  const existing = cacheStore.get(key);
  if (existing) {
    existing.inflight = fetchPromise;
  } else {
    cacheStore.set(key, {
      data: undefined as any,
      timestamp: 0,
      inflight: fetchPromise,
    });
  }

  return fetchPromise;
}

/**
 * Invalidate all or matching cached branch data after mutations
 * (e.g. daily closing submission, bank deposit created, expense recorded).
 */
export function invalidateBranchCache(keyPrefix?: string): void {
  if (!keyPrefix) {
    cacheStore.clear();
    return;
  }
  for (const key of cacheStore.keys()) {
    if (key.startsWith(keyPrefix)) {
      cacheStore.delete(key);
    }
  }
}
