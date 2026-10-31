import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'

// GET /api/admin/pending-kyc-count — badge count for the admin
// layout (pending verification requests). Admin-only.
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const count = await prisma.verificationRequest.count({ where: { status: 'pending' } })
    return NextResponse.json({ count })
  } catch (err: any) {
    console.error('[GET /api/admin/pending-kyc-count] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
