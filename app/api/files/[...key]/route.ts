import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin, getSessionUserId } from '@/lib/server/auth'
import {
  BUCKET_READ_ACCESS,
  RECORD_OWNED_BUCKETS,
  getObject,
  isKnownBucket,
  objectUrl,
  safeObjectPath,
} from '@/lib/server/storage'
import { logAudit } from '@/lib/server/audit'

// /api/files/<bucket>/<path...> — file storage serving.
// Reads enforce the bucket privacy map (lib/server/storage.ts):
// KYC buckets are owner-or-admin via the path-segment rule; the
// FR-1.8 record-owned buckets (salaries, payment_proofs,
// branch-deposits, expense-invoices) are owner-or-admin via the
// OWNING RECORD (see resolveRecordOwnership) or the segment rule,
// and fail closed (404) when ownership cannot be resolved for a
// non-admin caller. Existing stored files keep working: read
// paths and keys are unchanged, only the gate tightened.

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

/** A stored file-reference value matches this object when it is
 *  the canonical URL, the bare object path, or ends with it
 *  (legacy bare-filename salary proofs live directly under the
 *  salaries bucket, so their stored value IS the object path). */
function refMatches(stored: string | null | undefined, bucket: string, objectPath: string): boolean {
  if (!stored) return false
  return (
    stored === objectUrl(bucket, objectPath) ||
    stored === objectPath ||
    stored.endsWith('/' + objectPath)
  )
}

interface Ownership {
  userIds: string[]
  branchIds: string[]
}

/**
 * FR-1.8 — resolve who owns an object in a record-owned bucket by
 * finding the database record that references it. Returns null
 * when no record references the object (caller must then rely on
 * the path-segment rule or be an admin; otherwise fail closed).
 * The referenced tables are small (tens of rows), so matching is
 * done in JS over the non-null reference columns.
 */
async function resolveRecordOwnership(
  bucket: string,
  objectPath: string
): Promise<Ownership | null> {
  const owners: Ownership = { userIds: [], branchIds: [] }
  let found = false
  const take = (userId?: string | null, branchId?: string | null) => {
    found = true
    if (userId) owners.userIds.push(userId)
    if (branchId) owners.branchIds.push(branchId)
  }

  if (bucket === 'salaries' || bucket === 'payment_proofs') {
    const payments = await prisma.salaryPayment.findMany({
      where: { payment_proof_url: { not: null } },
      select: { employee_id: true, payment_proof_url: true },
    })
    for (const p of payments) {
      if (refMatches(p.payment_proof_url, bucket, objectPath)) take(p.employee_id)
    }
  }
  if (bucket === 'payment_proofs') {
    const requests = await prisma.paymentRequest.findMany({
      where: { payment_screenshot_url: { not: null } },
      select: { user_id: true, payment_screenshot_url: true },
    })
    for (const r of requests) {
      if (refMatches(r.payment_screenshot_url, bucket, objectPath)) take(r.user_id)
    }
  }
  if (bucket === 'branch-deposits') {
    const deposits = await prisma.branchBankDeposit.findMany({
      select: {
        manager_id: true,
        branch_id: true,
        slip_attachment_url: true,
        bank_statement_url: true,
      },
    })
    for (const d of deposits) {
      if (
        refMatches(d.slip_attachment_url, bucket, objectPath) ||
        refMatches(d.bank_statement_url, bucket, objectPath)
      ) {
        take(d.manager_id, d.branch_id)
      }
    }
  }
  if (bucket === 'expense-invoices') {
    const requests = await prisma.employeeExpenseRequest.findMany({
      where: { invoice_url: { not: null } },
      select: { employee_id: true, branch_id: true, invoice_url: true },
    })
    for (const r of requests) {
      if (refMatches(r.invoice_url, bucket, objectPath)) take(r.employee_id, r.branch_id)
    }
    const expenses = await prisma.branchCashExpense.findMany({
      where: { receipt_url: { not: null } },
      select: { manager_id: true, branch_id: true, receipt_url: true },
    })
    for (const e of expenses) {
      if (refMatches(e.receipt_url, bucket, objectPath)) take(e.manager_id, e.branch_id)
    }
  }

  return found ? owners : null
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
      const segments = objectPath.split('/')
      if (caller && callerIsAdmin(caller)) {
        // Admin: always allowed.
      } else if (RECORD_OWNED_BUCKETS.has(bucket)) {
        // FR-1.8 record-owned buckets: an approved caller who owns
        // the object — via the path-segment rule (server-generated
        // uploads embed the uploader id) or via the owning record.
        // Everyone else gets 404 (the object's existence is not
        // confirmed to non-owners), and an unresolvable owner
        // fails closed the same way.
        if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        let allowed = segments.includes(caller.id)
        if (!allowed) {
          const ownership = await resolveRecordOwnership(bucket, objectPath).catch(() => null)
          if (ownership) {
            allowed =
              ownership.userIds.includes(caller.id) ||
              (caller.is_branch_manager &&
                !!caller.branch_id &&
                ownership.branchIds.includes(caller.branch_id))
          }
        }
        if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      } else {
        // KYC buckets — the original owner-or-admin rule.
        // Owner = the user whose id appears as a path segment (the KYC
        // layout is <kind>/<userId>/<file>; ids are UUIDs so a segment
        // match is unambiguous), or any admin. A pending-verification
        // owner (rejected by the A4 caller gate) may still read their
        // OWN documents via the bare session — nobody else's.
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
  }

  const data = await getObject(bucket, objectPath)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // S1: record the download (who took what out, when) — never the
  // file contents. The caller is re-resolved only for private
  // buckets; public-bucket downloads log a null actor. Fail-soft.
  {
    let dlCaller: any = null
    if (access !== 'public') {
      dlCaller = await getCallerProfile(req).catch(() => null)
      if (!dlCaller) {
        const sid = await getSessionUserId(req).catch(() => null)
        if (sid) dlCaller = { id: sid, full_name: null, role: null }
      }
    }
    await logAudit({
      caller: dlCaller, req, action: 'file.download', eventType: 'download',
      entityTable: 'files', entityId: `${bucket}/${objectPath}`,
      newValue: { bucket, path: objectPath, bytes: data.length } as any,
    })
  }

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': contentTypeFor(objectPath),
      'Cache-Control': access === 'public' ? 'public, max-age=3600' : 'private, no-store',
    },
  })
}
