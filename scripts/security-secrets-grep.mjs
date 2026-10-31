#!/usr/bin/env node
/**
 * S5 (R2 Security Round) — secrets regression gate.
 *
 * Scans the tree for committed-secret shapes and exits 1 on any hit:
 *   - PEM private-key blocks
 *   - (api_key|secret|token|password)-style assignments with a literal
 *     string value of 8+ chars  (process.env.X usages are NOT hits)
 *   - JWT-shaped strings (eyJ… . … . …)
 *   - Vercel Blob read/write tokens (vercel_blob_rw_…)
 *   - Resend API keys (re_…)
 *   - postgres:// / postgresql:// URLs embedding a password
 *
 * Excludes: node_modules, .next, .git, storage, and this script itself
 * (it necessarily contains the pattern literals). Env files
 * (.env, .env.local, …) are excluded too — they are the sanctioned
 * secret store and are not committed source; .env.example IS scanned.
 *
 * Usage: node scripts/security-secrets-grep.mjs [rootDir]
 * Exit: 0 = zero hits, 1 = hits found, 2 = usage error.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SELF = fileURLToPath(import.meta.url)

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'storage', '.vercel'])
const SKIP_FILE = /^\.env($|\.(?!example$)[^.]+$)/
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt',
  '.yml', '.yaml', '.toml', '.css', '.html', '.sh', '.prisma', '.example',
])

const PATTERNS = [
  { name: 'private-key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  {
    name: 'literal secret assignment',
    re: /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*['"][^'"\n]{8,}['"]/i,
    // env-templated or placeholder values are not hits
    allow: (m) => /process\.env|example|placeholder|changeme|your[_-]|xxx+|\.\.\.|<[^>]+>|\$\{/i.test(m),
  },
  { name: 'JWT-shaped string', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'vercel blob token', re: /\bvercel_blob_rw_[A-Za-z0-9]{16,}/ },
  { name: 'resend api key', re: /\bre_[A-Za-z0-9_]{20,}\b/ },
  {
    name: 'postgres URL with password',
    re: /\bpostgres(?:ql)?:\/\/[^:\s/@]+:[^@\s/]{3,}@/,
    // template URLs (generic user/password, localhost) are not hits
    allow: (m) => /:\/\/(user|postgres|username):(password|pass|xxx|changeme)@/i.test(m) || /@(localhost|127\.0\.0\.1)[:/]/.test(m),
  },
]

const hits = []
function scanFile(file) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { return }
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const p of PATTERNS) {
      const m = lines[i].match(p.re)
      if (m && !(p.allow && p.allow(m[0]))) {
        hits.push({ file: path.relative(root, file), line: i + 1, pattern: p.name })
      }
    }
  }
}
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      // '_next' anywhere is generated build output (public/_next is
      // gitignored and deleted by the prebuild step), same as .next.
      if (!SKIP_DIRS.has(e.name) && e.name !== '_next') walk(full)
    } else if (e.isFile()) {
      if (full === SELF) continue
      if (SKIP_FILE.test(e.name)) continue
      const ext = path.extname(e.name).toLowerCase()
      if (TEXT_EXT.has(ext) || e.name.startsWith('.env')) scanFile(full)
    }
  }
}
walk(root)
if (hits.length) {
  console.log(`SECRETS GREP: ${hits.length} HIT(S)`)
  for (const h of hits) console.log(`  ${h.file}:${h.line}  [${h.pattern}]`)
  process.exit(1)
}
console.log('SECRETS GREP: 0 hits')
process.exit(0)
