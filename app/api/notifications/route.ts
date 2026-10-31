import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// GET /api/notifications — the signed-in user's notification list
// (own notifications plus admin broadcasts with user_id NULL),
// newest first. Replaces the browser-direct notifications query +
// realtime channel in NotificationDropdown (poll/refetch).
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const limitParam = Number(req.nextUrl.searchParams.get('limit') || '50')
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50

    const rows = await prisma.notification.findMany({
      where: {
        OR: callerIsAdmin(caller)
          ? [{ user_id: caller.id }, { user_id: null }]
          : [{ user_id: caller.id }],
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    })

    return NextResponse.json({ notifications: toPlain(rows) })
  } catch (err: any) {
    console.error('[GET /api/notifications] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
