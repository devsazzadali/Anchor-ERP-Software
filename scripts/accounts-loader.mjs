/**
 * ESM resolve hook for the Accounts proof/backfill scripts: the app
 * codebase uses Next-style '@/…' aliases and bundler-style
 * extensionless relative imports, which raw Node ESM cannot
 * resolve. This hook maps '@/x' to the clone tree root and retries
 * extensionless relative specifiers with a '.ts' suffix, so the
 * strip-types scripts import the app's own modules unmodified
 * (same pattern as the closing-fix harness loader).
 *
 * Use: node --experimental-strip-types --loader ./scripts/accounts-loader.mjs …
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const TREE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (err) {
    if (specifier.startsWith('@/')) {
      const base = path.join(TREE, specifier.slice(2))
      for (const candidate of [`${base}.ts`, `${base}.tsx`, base]) {
        try {
          return await next(pathToFileURL(candidate).href, context)
        } catch { /* try next candidate */ }
      }
    }
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.(ts|tsx|mts|cts|js|mjs|cjs|json)$/.test(specifier)
    ) {
      try {
        return await next(`${specifier}.ts`, context)
      } catch { /* fall through to the original error */ }
    }
    throw err
  }
}
