import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'

// POST /api/activity-logs — replacement for the browser's
// direct activity_logs insert (lib/audit-logger.ts posts here).
// The acting user is the SESSION user; a body user_id is honoured
// only when it matches the caller (no logging actions as someone
// else). Requires an authenticated session.
export async function POST(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const { action, details, ip_address, device_info } = body ?? {}
    if (!action || typeof action !== 'string') {
      return NextResponse.json({ error: 'action is required' }, { status: 400 })
    }

    const userId =
      typeof body.user_id === 'string' && body.user_id === caller.id ? body.user_id : caller.id

    await prisma.activityLog.create({
      data: {
        user_id: userId,
        action,
        details: details ?? {},
        ip_address: ip_address ?? null,
        device_info: device_info ?? null,
      },
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[POST /api/activity-logs] Error:', err)
    return NextResponse.json({ error: 'Failed to record activity log' }, { status: 500 })
  }
}
