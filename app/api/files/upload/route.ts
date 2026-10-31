import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getCallerProfile, getSessionUserId } from '@/lib/server/auth'
import {
  isKnownBucket,
  objectUrl,
  putObjectExclusive,
  validateUpload,
  ObjectAlreadyExistsError,
} from '@/lib/server/storage'
import { checkAndRecordSend } from '@/lib/server/rate-limit'

// S5 (R2 Security Round) — per-user upload cap: 30 uploads / 10 min
// (DB-backed via rate_limit_counters). Fail-soft: a counter outage
// logs and the upload proceeds.
const UPLOAD_CAP = { windowMs: 10 * 60 * 1000, max: 30 }

// POST /api/files/upload — multipart upload into a bucket.
// Requires a signed-in caller (session cookie). Returns the
// canonical file URL to store in the database.
//
// FR-1.8 (audit G6): the object name is SERVER-GENERATED —
// <uploaderId>/<uuid>.<ext> — and the caller-supplied `path` form
// field is IGNORED for new uploads (it is still accepted so
// existing clients don't break; their returned url/path is what
// they store). Writes reject an already-used key, and the file
// must pass the bucket's extension/MIME + size allowlist
// (lib/server/storage.ts BUCKET_UPLOAD_RULES). Existing stored
// files keep their keys and read paths — nothing here renames
// or moves them.
//
// KYC exception: the general caller gate (A4) rejects accounts
// whose verification is still pending — but uploading KYC documents
// is precisely what a pending account must be able to do (the old
// system allowed it). For the KYC buckets only, a valid session is
// sufficient; the object lands under the uploader's own path
// scheme and reads stay owner-or-admin.
const KYC_BUCKETS = new Set(['kyc', 'kyc-documents'])

export async function POST(req: Request) {
  try {
    // S5 (R2 Security Round): a body over the framework's 10MB client
    // body cap arrives truncated and formData() throws — that is an
    // oversize/malformed refusal (400), not a server error (500).
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return NextResponse.json({ error: 'File too large or malformed upload' }, { status: 400 })
    }
    const bucket = String(form.get('bucket') || '')
    const file = form.get('file')

    if (!isKnownBucket(bucket)) {
      return NextResponse.json({ error: 'Unknown bucket' }, { status: 400 })
    }

    let uploaderId: string | null = null
    const caller = await getCallerProfile(req)
    if (caller) {
      uploaderId = caller.id
    } else if (KYC_BUCKETS.has(bucket)) {
      uploaderId = await getSessionUserId(req)
    }
    if (!uploaderId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // S5 per-user upload cap → generic 429.
    try {
      const cap = await checkAndRecordSend('file_upload', `user:${uploaderId}`, UPLOAD_CAP)
      if (!cap.allowed) {
        return NextResponse.json({ error: 'Upload rate limit exceeded. Please try again later.' }, { status: 429 })
      }
    } catch (e) {
      console.error('[POST /api/files/upload] upload-cap counter error (fail-soft):', e)
    }

    if (!file || typeof (file as any).arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }

    const f: any = file
    const buffer = Buffer.from(await f.arrayBuffer())

    const verdict = validateUpload(bucket, f.name, f.type, buffer.length)
    if ('error' in verdict) {
      return NextResponse.json({ error: verdict.error }, { status: 400 })
    }

    // Server-generated key: the uploader's id is the first segment
    // (the read route's segment ownership rule keys on it) and the
    // filename is a UUID — never caller-chosen, never predictable,
    // never colliding with an existing object.
    const objectPath = uploaderId + '/' + randomUUID() + '.' + verdict.ext

    try {
      await putObjectExclusive(bucket, objectPath, buffer, f.type || undefined)
    } catch (err: any) {
      if (err instanceof ObjectAlreadyExistsError) {
        return NextResponse.json({ error: 'File already exists' }, { status: 409 })
      }
      throw err
    }

    return NextResponse.json({ url: objectUrl(bucket, objectPath), path: objectPath, bucket })
  } catch (err: any) {
    console.error('[POST /api/files/upload] Error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
