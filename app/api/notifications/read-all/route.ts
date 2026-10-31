import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, isAdminRole } from '@/lib/server/auth'

// caller via the single role-resolution
// function. Admin scope = own + broadcast (user_id NULL)
// notifications, as before.

export async function POST(request: Request) {
  try {
    const caller = await getCallerProfile(request)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isAdmin = isAdminRole(caller.role)

    const where: any = { read: false }
    if (isAdmin) {
      where.OR = [{ user_id: caller.id }, { user_id: null }]
    } else {
      where.user_id = caller.id
    }

    try {
      await prisma.notification.updateMany({ where, data: { read: true } })
    } catch (updateError) {
      console.error('Failed to mark all notifications as read:', updateError)
      return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'All notifications marked as read' }, { status: 200 })
  } catch (err) {
    console.error('Unexpected error marking all read:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
