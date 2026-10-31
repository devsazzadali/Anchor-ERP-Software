import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// POST /api/admin/kyc/[id]/decision — admin-only KYC decision.
// Body: { action: 'approve' | 'reject' | 'edit', admin_notes?,
//         rejection_reason?, ...editFields }
// The verification_requests update and the profiles sync happen in
// ONE transaction (the old page ran them as two browser writes that
// could half-apply). Approve syncs the full profile incl. bank_info
// built from the request (same field mapping as the old page);
// reject sets verification_status/rejection_reason; edit updates the
// request and merges bank_info into the existing profile bank_info.
const SAFE_ROLES = ['partner', 'employee', 'head_office', 'branch_manager']

function safeRole(profileType: any): string {
  return SAFE_ROLES.includes(profileType) ? profileType : 'employee'
}

export async function POST(req: Request, context: any) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })

    const { id } = await context.params
    const body = await req.json()
    const action = body.action

    const vr = await prisma.verificationRequest.findUnique({ where: { id } })
    if (!vr) return NextResponse.json({ error: 'KYC request not found' }, { status: 404 })

    if (action === 'approve') {
      const role = safeRole(vr.profile_type)
      const updated = await prisma.$transaction(async (tx) => {
        const reqRow = await tx.verificationRequest.update({
          where: { id },
          data: { status: 'approved', admin_notes: body.admin_notes ?? null },
        })
        await tx.profile.update({
          where: { id: vr.user_id },
          data: {
            verification_status: 'approved',
            full_name: vr.full_name,
            phone_number: vr.phone_number,
            address: vr.address,
            country: vr.country,
            role,
            profile_type: role,
            bank_info: {
              bankName: vr.bank_name || '',
              accountName: vr.account_holder_name || '',
              accountNumber: (vr as any).bank_account_number || (vr as any).account_number || '',
              district: vr.district || '',
              mobileBankingProvider: '',
              mobileBankingNumber: '',
            } as any,
          },
        })
        return reqRow
      })
      return NextResponse.json({ request: toPlain(updated) })
    }

    if (action === 'reject') {
      const reason = String(body.rejection_reason || '').trim()
      if (!reason) return NextResponse.json({ error: 'rejection_reason is required' }, { status: 400 })
      const updated = await prisma.$transaction(async (tx) => {
        const reqRow = await tx.verificationRequest.update({
          where: { id },
          data: { status: 'rejected', rejection_reason: reason, admin_notes: body.admin_notes ?? null },
        })
        await tx.profile.update({
          where: { id: vr.user_id },
          data: { verification_status: 'rejected', rejection_reason: reason },
        })
        return reqRow
      })
      return NextResponse.json({ request: toPlain(updated) })
    }

    if (action === 'edit') {
      const fields = [
        'full_name', 'phone_number', 'address', 'country', 'profile_type',
        'bank_name', 'account_holder_name', 'bank_account_number', 'district',
      ] as const
      const vrData: any = {}
      for (const f of fields) if (body[f] !== undefined) vrData[f] = body[f]
      if (!String(vrData.full_name ?? vr.full_name).trim()) {
        return NextResponse.json({ error: 'Full Name is required.' }, { status: 400 })
      }

      const updated = await prisma.$transaction(async (tx) => {
        const reqRow = await tx.verificationRequest.update({ where: { id }, data: vrData })
        if (vr.user_id) {
          const profile = await tx.profile.findUnique({
            where: { id: vr.user_id },
            select: { bank_info: true },
          }).catch(() => null)
          if (profile) {
            const existingBankInfo: any = (profile as any).bank_info || {}
            const role = safeRole(vrData.profile_type ?? vr.profile_type)
            await tx.profile.update({
              where: { id: vr.user_id },
              data: {
                full_name: vrData.full_name ?? vr.full_name,
                phone_number: vrData.phone_number ?? vr.phone_number,
                address: vrData.address ?? vr.address,
                country: vrData.country ?? vr.country,
                profile_type: vrData.profile_type ?? vr.profile_type,
                role,
                bank_info: {
                  ...existingBankInfo,
                  bankName: vrData.bank_name || '',
                  accountName: vrData.account_holder_name || '',
                  accountNumber: vrData.bank_account_number || '',
                  district: vrData.district || '',
                } as any,
              },
            })
          }
        }
        return reqRow
      })
      return NextResponse.json({ request: toPlain(updated) })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    console.error('[POST /api/admin/kyc/[id]/decision] Error:', err)
    return NextResponse.json({ error: 'KYC decision failed' }, { status: 500 })
  }
}
