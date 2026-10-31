#!/usr/bin/env node
/**
 * One-off migration: upload the local file-storage tree to Vercel Blob.
 *
 * Walks a local storage root (default ./storage) and uploads every
 * file to Blob at the pathname the app's storage driver expects:
 *
 *     <bucket>/<relative path inside the bucket>
 *
 * Blobs are uploaded as PRIVATE, with no random suffix and with
 * overwrite allowed, so re-running the script is safe (idempotent).
 * The app never exposes raw blob URLs — it reads the bytes
 * server-side via lib/server/storage.ts (STORAGE_DRIVER=vercel-blob)
 * and serves them through /api/files/<bucket>/<path>, which enforces
 * the bucket privacy map (kyc + kyc-documents are owner-or-admin
 * only). This script only fills the store; it grants no access.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=... node scripts/upload-storage-to-blob.mjs [storageRoot]
 *   BLOB_READ_WRITE_TOKEN=... node scripts/upload-storage-to-blob.mjs --root ./storage
 *   STORAGE_ROOT=./storage BLOB_READ_WRITE_TOKEN=... node scripts/upload-storage-to-blob.mjs
 *
 * Storage root resolution order: positional arg / --root > STORAGE_ROOT
 * env > ./storage. No token is embedded in or defaulted by this
 * script: without BLOB_READ_WRITE_TOKEN it exits non-zero.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { put } from '@vercel/blob'

const CONCURRENCY = 8

function parseRootArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--root') return argv[i + 1]
    if (arg.startsWith('--root=')) return arg.slice('--root='.length)
    if (!arg.startsWith('-')) return arg
  }
  return undefined
}

async function walk(dir, out) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, out)
    } else if (entry.isFile()) {
      out.push(full)
    } else if (entry.isSymbolicLink()) {
      const stat = await fs.stat(full).catch(() => null)
      if (stat?.isFile()) out.push(full)
    }
  }
  return out
}

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    console.error(
      'ERROR: BLOB_READ_WRITE_TOKEN is not set.\n' +
        'Create a Vercel Blob store for this project first (Vercel dashboard > ' +
        'Storage > Blob) and connect it to the project — Vercel then provides ' +
        'BLOB_READ_WRITE_TOKEN — or export the token from the store settings:\n' +
        '  BLOB_READ_WRITE_TOKEN=<token> node scripts/upload-storage-to-blob.mjs'
    )
    process.exit(1)
  }

  const root = path.resolve(parseRootArg(process.argv.slice(2)) || process.env.STORAGE_ROOT || './storage')

  const rootStat = await fs.stat(root).catch(() => null)
  if (!rootStat?.isDirectory()) {
    console.error(`ERROR: storage root is not a directory: ${root}`)
    process.exit(1)
  }

  const files = await walk(root, [])
  console.log(`Storage root: ${root}`)
  console.log(`Found ${files.length} file(s). Uploading to Vercel Blob as private blobs...`)

  const perBucket = new Map()
  const failures = []
  let uploaded = 0
  let uploadedBytes = 0

  async function uploadOne(fullPath) {
    // Pathname: <bucket>/<relative path>, always forward slashes.
    const relative = path.relative(root, fullPath).split(path.sep).join('/')
    const bucket = relative.split('/')[0]
    if (!bucket || !relative.includes('/')) {
      failures.push({ relative, error: 'file is not inside a bucket directory — skipped' })
      return
    }
    try {
      const data = await fs.readFile(fullPath)
      await put(relative, data, {
        access: 'private',
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
      })
      uploaded += 1
      uploadedBytes += data.length
      const agg = perBucket.get(bucket) || { files: 0, bytes: 0 }
      agg.files += 1
      agg.bytes += data.length
      perBucket.set(bucket, agg)
      if (uploaded % 25 === 0) console.log(`  ... ${uploaded} uploaded`)
    } catch (err) {
      failures.push({ relative, error: err?.message || String(err) })
    }
  }

  // Small fixed-size worker pool.
  let next = 0
  async function worker() {
    while (next < files.length) {
      const current = files[next]
      next += 1
      await uploadOne(current)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length || 1) }, worker))

  console.log('\n=== Upload summary ===')
  for (const bucket of [...perBucket.keys()].sort()) {
    const agg = perBucket.get(bucket)
    console.log(`  ${bucket}: ${agg.files} file(s), ${agg.bytes} bytes`)
  }
  console.log(`  TOTAL: ${uploaded} file(s), ${uploadedBytes} bytes`)

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):`)
    for (const f of failures) console.error(`  - ${f.relative}: ${f.error}`)
    process.exit(1)
  }

  console.log('\nDone. Next: set STORAGE_DRIVER=vercel-blob in the Vercel project and redeploy.')
}

main().catch((err) => {
  console.error('ERROR: upload failed:', err?.message || err)
  process.exit(1)
})
