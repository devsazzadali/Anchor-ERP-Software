import { NextResponse } from 'next/server'
import { getCallerProfile, callerIsAdmin, getSessionUserId } from '@/lib/server/auth'
import {
  BUCKET_READ_ACCESS,
  getObject,
  isKnownBucket,
  safeObjectPath,
} from '@/lib/server/storage'

// /api/files/<bucket>/<path...> — file storage serving + upload
//. Reads enforce the bucket privacy map; KYC
// documents are owner-or-admin only, never public.

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

function contentTypeFor(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() || ''
  return CONTENT_TYPES[ext] || 'application/octet-stream'
}

export async function GET(req: Request, context: any) {
  const { key } = await context.params
  const parts: string[] = Array.isArray(key) ? key : [key]
  const bucket = parts[0]
  const objectPath = safeObjectPath(parts.slice(1).join('/'))
  if (!bucket || !isKnownBucket(bucket) || !objectPath) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const access = BUCKET_READ_ACCESS[bucket] || 'authenticated'
  if (access !== 'public') {
    const caller = await getCallerProfile(req)
    if (!caller && access !== 'owner-or-admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (access === 'owner-or-admin') {
      // Owner = the user whose id appears as a path segment (the KYC
      // layout is <kind>/<userId>/<file>; ids are UUIDs so a segment
      // match is unambiguous), or any admin. A pending-verification
      // owner (rejected by the A4 caller gate) may still read their
      // OWN documents via the bare session — nobody else's.
      const segments = objectPath.split('/')
      if (caller) {
        if (!segments.includes(caller.id) && !callerIsAdmin(caller)) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      } else {
        const sessionUserId = await getSessionUserId(req)
        if (!sessionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        if (!segments.includes(sessionUserId)) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      }
    }
  }

  const data = await getObject(bucket, objectPath)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': contentTypeFor(objectPath),
      'Cache-Control': access === 'public' ? 'public, max-age=3600' : 'private, no-store',
    },
  })
}
