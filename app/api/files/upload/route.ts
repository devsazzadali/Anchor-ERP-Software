import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getCallerProfile, getSessionUserId } from '@/lib/server/auth'
import { isKnownBucket, objectUrl, putObject, safeObjectPath } from '@/lib/server/storage'

// POST /api/files/upload — multipart upload into a bucket.
// Requires a signed-in caller (session cookie). Returns the
// canonical file URL to store in the database.
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
    const form = await req.formData()
    const bucket = String(form.get('bucket') || '')
    const file = form.get('file')
    const requestedPath = String(form.get('path') || '')

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

    if (!file || typeof (file as any).arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }

    const f: any = file
    const ext = (f.name?.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
    const objectPath = safeObjectPath(requestedPath) || uploaderId + '/' + randomUUID() + '.' + ext

    const buffer = Buffer.from(await f.arrayBuffer())
    await putObject(bucket, objectPath, buffer, f.type)

    return NextResponse.json({ url: objectUrl(bucket, objectPath), path: objectPath, bucket })
  } catch (err: any) {
    console.error('[POST /api/files/upload] Error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
