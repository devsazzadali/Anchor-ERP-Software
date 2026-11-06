/* i18n dictionary parity check.
   Loads lib/i18n/en.ts and lib/i18n/bn.ts via the TypeScript transpile
   hook and verifies:
     1. identical key sets in both directions (no key missing either side)
     2. identical leaf types (string vs object) at every path
   Prints the total leaf-key count. Exit 1 on any mismatch.
   Run: node scripts/i18n-parity-check.mjs */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(ROOT, 'package.json'))
const ts = require('typescript')

function loadTs(file) {
  const src = fs.readFileSync(file, 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file,
  })
  const mod = { exports: {} }
  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', outputText)
  fn(require, mod, mod.exports, file, path.dirname(file))
  return mod.exports
}

const { en } = loadTs(path.join(ROOT, 'lib/i18n/en.ts'))
const { bn } = loadTs(path.join(ROOT, 'lib/i18n/bn.ts'))

let leaves = 0
const problems = []
function walk(a, b, trail) {
  if (typeof a !== typeof b || (a === null) !== (b === null) || Array.isArray(a) !== Array.isArray(b)) {
    problems.push(`type mismatch at ${trail}`)
    return
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a).sort()
    const kb = Object.keys(b).sort()
    for (const k of ka) if (!(k in b)) problems.push(`missing in bn: ${trail}.${k}`)
    for (const k of kb) if (!(k in a)) problems.push(`missing in en: ${trail}.${k}`)
    for (const k of ka) if (k in b) walk(a[k], b[k], `${trail}.${k}`)
    return
  }
  leaves++
  if (typeof a !== 'string') problems.push(`non-string leaf at ${trail}`)
  if (a === '' || b === '') problems.push(`empty string at ${trail}`)
}
walk(en, bn, 'dict')

console.log(`leaf keys: ${leaves}`)
if (problems.length) {
  console.log(`PARITY FAIL — ${problems.length} problem(s):`)
  for (const p of problems) console.log(' -', p)
  process.exit(1)
}
console.log('PARITY OK — en and bn have identical key sets and leaf types')
