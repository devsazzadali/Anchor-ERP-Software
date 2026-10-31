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
 * Driver: the local build stores objects on disk under STORAGE_ROOT
 * (default ./storage). Production wiring (e.g. Vercel Blob) is
 * owner-account work; it slots in behind this same interface
 * (putObject / getObject / deleteObject) without touching callers.
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

export async function putObject(
  bucket: string,
  objectPath: string,
  data: Buffer,
  _contentType?: string
): Promise<void> {
  const fp = objectFilePath(bucket, objectPath)
  await fs.mkdir(path.dirname(fp), { recursive: true })
  await fs.writeFile(fp, data)
}

export async function getObject(bucket: string, objectPath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(objectFilePath(bucket, objectPath))
  } catch {
    return null
  }
}

export async function deleteObject(bucket: string, objectPath: string): Promise<void> {
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
