/**
 * File storage — replaces the legacy object storage.
 *
 * Objects keep their STABLE KEYS: <bucket>/<path> exactly as the old
 * system addressed them, so carried data references stay meaningful
 * and the load-time URL rewrite is a pure prefix swap:
 *   https://<legacy-host>/storage/v1/object/public/<bucket>/<path>
 *   https://<legacy-host>/storage/v1/object/sign/<bucket>/<path>?token=<redacted>
 *     -> /api/files/<bucket>/<path>
 *
 * The serving route enforces the bucket privacy map below — most
 * importantly `kyc-documents` is NEVER public in the app (the old
 * system's signed-URL handling is replaced by a session check:
 * owner or admin only).
 *
 * Driver: selected by the STORAGE_DRIVER env var, behind this same
 * interface (putObject / getObject / deleteObject / objectUrl), so
 * no caller changes when the driver switches.
 *  - unset or 'local' (the default): objects are stored on disk
 *    under STORAGE_ROOT (default ./storage) — the original
 *    behaviour, unchanged.
 *  - 'vercel-blob': objects are stored in Vercel Blob under the
 *    SAME stable pathname <bucket>/<path>, as PRIVATE blobs. This
 *    mode requires BLOB_READ_WRITE_TOKEN; a MissingBlobTokenError
 *    is thrown without it. getObject() fetches the bytes
 *    server-side with that token, and objectUrl() returns
 *    '/api/files/<bucket>/<path>' in BOTH modes — the raw blob URL
 *    is never exposed to clients, so all serving still goes
 *    through the /api/files route, which enforces the
 *    BUCKET_READ_ACCESS privacy map below (kyc + kyc-documents
 *    stay owner-or-admin only).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

// The buckets evidenced in the old system — code call sites
// (kyc, branch-deposits, payment_proofs, invoices, expense-invoices),
// live data references (branch-deposits ×18 public, kyc ×63 signed)
// and the DDL storage policies (kyc, kyc-documents, invoices,
// salaries). Seven in total.
export const BUCKETS = [
  'branch-deposits',
  'expense-invoices',
  'invoices',
  'kyc',
  'kyc-documents',
  'payment_proofs',
  'salaries',
] as const

export type BucketName = (typeof BUCKETS)[number]

/** Who may READ an object: 'public' | 'authenticated' | 'owner-or-admin'. */
export const BUCKET_READ_ACCESS: Record<string, 'public' | 'authenticated' | 'owner-or-admin'> = {
  // Deposit slips were public URLs in the old system; every page
  // that renders them sits behind login, so requiring a session
  // changes nothing visible and stops public enumeration.
  'branch-deposits': 'authenticated',
  'expense-invoices': 'authenticated',
  invoices: 'authenticated',
  // KYC documents were effectively exposed through long-lived signed
  // URLs in the old system; in the app they are owner-or-admin ONLY
  // (the one deliberate privacy tightening).
  kyc: 'owner-or-admin',
  'kyc-documents': 'owner-or-admin',
  payment_proofs: 'authenticated',
  salaries: 'authenticated',
}

export function isKnownBucket(bucket: string): boolean {
  return (BUCKETS as readonly string[]).includes(bucket)
}

function storageRoot(): string {
  return process.env.STORAGE_ROOT || path.join(process.cwd(), 'storage')
}

/** Normalise an object path: no leading slash, no traversal. */
export function safeObjectPath(p: string): string | null {
  const cleaned = p.replace(/^\/+/, '')
  if (!cleaned || cleaned.split('/').some((seg) => seg === '..' || seg === '')) return null
  return cleaned
}

function objectFilePath(bucket: string, objectPath: string): string {
  return path.join(storageRoot(), bucket, objectPath)
}

/** Thrown when STORAGE_DRIVER=vercel-blob but no blob token is set. */
export class MissingBlobTokenError extends Error {
  constructor() {
    super(
      'BLOB_READ_WRITE_TOKEN is required when STORAGE_DRIVER=vercel-blob. ' +
        'Create a Vercel Blob store for this project and connect it so Vercel ' +
        'sets BLOB_READ_WRITE_TOKEN, or set the token manually in the environment.'
    )
    this.name = 'MissingBlobTokenError'
  }
}

/** Thrown when STORAGE_DRIVER is set to a value that is not a known driver. */
export class UnknownStorageDriverError extends Error {
  constructor(value: string) {
    super(`Unknown STORAGE_DRIVER "${value}" — expected "local" or "vercel-blob".`)
    this.name = 'UnknownStorageDriverError'
  }
}

type StorageDriverName = 'local' | 'vercel-blob'

function storageDriver(): StorageDriverName {
  const raw = (process.env.STORAGE_DRIVER || 'local').trim().toLowerCase()
  if (raw === '' || raw === 'local') return 'local'
  if (raw === 'vercel-blob') return 'vercel-blob'
  throw new UnknownStorageDriverError(raw)
}

function requireBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) throw new MissingBlobTokenError()
  return token
}

/** Blob pathname for an object: the same stable key, <bucket>/<path>. */
function blobPathname(bucket: string, objectPath: string): string {
  return bucket + '/' + objectPath
}

export async function putObject(
  bucket: string,
  objectPath: string,
  data: Buffer,
  contentType?: string
): Promise<void> {
  if (storageDriver() === 'vercel-blob') {
    const token = requireBlobToken()
    const { put } = await import('@vercel/blob')
    await put(blobPathname(bucket, objectPath), data, {
      // Private: the blob is only reachable server-side with the
      // token; clients always go through /api/files (see header).
      access: 'private',
      token,
      // Keep the stable key exactly — no suffix — and match the
      // local driver, which overwrites an existing object silently.
      addRandomSuffix: false,
      allowOverwrite: true,
      ...(contentType ? { contentType } : {}),
    })
    return
  }
  const fp = objectFilePath(bucket, objectPath)
  await fs.mkdir(path.dirname(fp), { recursive: true })
  await fs.writeFile(fp, data)
}

export async function getObject(bucket: string, objectPath: string): Promise<Buffer | null> {
  if (storageDriver() === 'vercel-blob') {
    const token = requireBlobToken()
    const { get } = await import('@vercel/blob')
    // Fetches the bytes server-side with the token; the SDK returns
    // null when the object does not exist. The blob URL in the
    // result is deliberately never returned to callers/clients.
    const result = await get(blobPathname(bucket, objectPath), { access: 'private', token })
    if (!result || result.statusCode !== 200 || !result.stream) return null
    const chunks: Uint8Array[] = []
    const reader = result.stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    return Buffer.concat(chunks)
  }
  try {
    return await fs.readFile(objectFilePath(bucket, objectPath))
  } catch {
    return null
  }
}

export async function deleteObject(bucket: string, objectPath: string): Promise<void> {
  if (storageDriver() === 'vercel-blob') {
    const token = requireBlobToken()
    const { del } = await import('@vercel/blob')
    await del(blobPathname(bucket, objectPath), { token })
    return
  }
  await fs.rm(objectFilePath(bucket, objectPath), { force: true })
}

/** The canonical file URL for an object — what new writes store. */
export function objectUrl(bucket: string, objectPath: string): string {
  return '/api/files/' + bucket + '/' + objectPath
}

/**
 * Rewrite an old-system storage URL to the app URL. Returns the
 * input unchanged when it is not an old-system storage URL (callers
 * in the loader report leftovers; the post-load scan for the old
 * host must find zero).
 */
export function rewriteStorageUrl(value: string): string {
  if (typeof value !== 'string') return value
  const m = value.match(
    /^https?:\/\/[^/]+\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/
  )
  if (!m) return value
  return objectUrl(decodeURIComponent(m[1]), decodeURIComponent(m[2]))
}
