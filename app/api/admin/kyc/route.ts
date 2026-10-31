import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// GET /api/admin/kyc — admin-only KYC queue: every
// verification_requests row, newest first (the admin KYC review
// bench). ?status=pending narrows to one status (the lightweight
// approval page). This is also where the admin KYC views land
// in code: employee_verifications / partner_verifications are this
// same set filtered by the joined profile's profile_type — pass
// ?profile_type=employee|partner for that view.
export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const profileType = searchParams.get('profile_type')
    const userId = searchParams.get('user_id')

    const where: any = {}
    if (status) where.status = status
    if (userId) where.user_id = userId
    if (profileType) {
      // View semantics: filter by the JOINED profile's profile_type,
      // not the request's own column.
      const profs = await prisma.profile.findMany({
        where: { profile_type: profileType },
        select: { id: true },
      })
      where.user_id = { in: profs.map((p) => p.id) }
    }

    const requests = await prisma.verificationRequest.findMany({
      where,
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ requests: toPlain(requests) })
  } catch (err: any) {
    console.error('[GET /api/admin/kyc] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch KYC requests' }, { status: 500 })
  }
}
