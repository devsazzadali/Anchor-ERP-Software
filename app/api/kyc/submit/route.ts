import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sessionTokenFromRequest, verifySessionToken } from '@/lib/server/session'
import { toPlain } from '@/lib/server/respond'
import { logAudit } from '@/lib/server/audit'

// Session-only caller resolution (see /api/kyc/status for why KYC
// routes cannot use the A4-gated getCallerProfile).
async function resolveKycCaller(req: Request) {
  const userId = await verifySessionToken(sessionTokenFromRequest(req))
  if (!userId) return null
  const profile = await prisma.profile.findUnique({ where: { id: userId } })
  if (!profile) return null
  if ((profile as { is_banned?: boolean | null }).is_banned === true) return null
  return { userId, profile }
}

// KYC dossier submission. The page
// uploads its documents FIRST via uploadFile (bucket
// 'kyc-documents' — never public in the app) and
// posts the returned file URLs here. Server-side, in ONE
// transaction: the pending-check (the page's rule — an existing
// pending request blocks a new submission), the
// verification_requests insert-or-update of the caller's latest
// request, and the profile update (profile_type = chosen role,
// verification_status back to 'pending'). Identity fields
// (full_name, phone_number) come from the caller's profile,
// never from the body.
const ALLOWED_ROLES = ['employee', 'partner', 'head_office']

export async function POST(req: Request) {
  try {
    const resolved = await resolveKycCaller(req)
    if (!resolved) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId, profile } = resolved

    const body = await req.json().catch(() => ({}))
    const role = ALLOWED_ROLES.includes(body.profile_type) ? body.profile_type : 'employee'

    const existing = await prisma.verificationRequest.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: { id: true, status: true },
    })
    if (existing && existing.status === 'pending') {
      return NextResponse.json(
        { error: 'You already have a pending KYC request. Please wait for approval.' },
        { status: 400 }
      )
    }

    const payload = {
      user_id: userId,
      full_name: profile.full_name || 'User',
      phone_number: profile.phone_number || '',
      address: body.address ? String(body.address) : null,
      bank_name: body.bank_name ? String(body.bank_name) : null,
      account_holder_name: body.account_holder_name ? String(body.account_holder_name) : null,
      bank_account_number: body.bank_account_number ? String(body.bank_account_number) : null,
      district: body.district ? String(body.district) : null,
      nid_front_url: String(body.nid_front_url || ''),
      nid_back_url: String(body.nid_back_url || ''),
      selfie_url: body.selfie_url ? String(body.selfie_url) : null,
      profile_type: role,
      status: 'pending',
    }

    const request = await prisma.$transaction(async (tx) => {
      let row
      if (existing) {
        // Update the existing (rejected) request, as the page did.
        row = await tx.verificationRequest.update({
          where: { id: existing.id },
          data: { ...payload, created_at: new Date() },
        })
      } else {
        row = await tx.verificationRequest.create({ data: payload })
      }
      await tx.profile.update({
        where: { id: userId },
        data: { profile_type: role, verification_status: 'pending' },
      })
      return row
    })

    await logAudit({
      caller: null, actorId: userId, actorName: profile.full_name ?? null, actorRole: profile.role ?? null,
      req, action: existing ? 'kyc.resubmit' : 'kyc.submit', eventType: 'verification',
      entityTable: 'verification_requests', entityId: request.id,
      fieldChanges: [{ field: 'status', old: existing?.status ?? null, new: 'pending' }],
    })
    return NextResponse.json({ request: toPlain(request) }, { status: 201 })
  } catch (err: any) {
    console.error('[POST /api/kyc/submit] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
