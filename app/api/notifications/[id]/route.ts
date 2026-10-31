import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'

// caller via the single role-resolution
// function; ownership scoping (non-admins only touch their own
// notifications) is enforced in the where clause, as before.

export async function DELETE(request: Request, context: any) {
  try {
    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ error: 'Notification ID required' }, { status: 400 })
    }

    const caller = await getCallerProfile(request)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isAdmin = callerIsAdmin(caller)

    const where: any = { id }
    if (!isAdmin) where.user_id = caller.id

    let count = 0
    try {
      const res = await prisma.notification.deleteMany({ where })
      count = res.count
    } catch (deleteError) {
      console.error('Failed to delete notification:', deleteError)
      return NextResponse.json({ error: 'Failed to delete notification' }, { status: 500 })
    }
    if (count === 0) {
      return NextResponse.json({ error: 'Notification not found or access denied' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Notification deleted' }, { status: 200 })
  } catch (err) {
    console.error('Unexpected error deleting notification:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: any) {
  try {
    const { id } = await context.params
    const body = await request.json()

    const caller = await getCallerProfile(request)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isAdmin = callerIsAdmin(caller)

    const updatePayload: Record<string, any> = {}
    if (typeof body.read === 'boolean') updatePayload.read = body.read
    if (isAdmin && typeof body.title === 'string') updatePayload.title = body.title
    if (isAdmin && typeof body.message === 'string') updatePayload.message = body.message

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided for update' }, { status: 400 })
    }

    const where: any = { id }
    if (!isAdmin) where.user_id = caller.id

    let count = 0
    try {
      const res = await prisma.notification.updateMany({ where, data: updatePayload })
      count = res.count
    } catch (updateError) {
      console.error('Failed to update notification:', updateError)
      return NextResponse.json({ error: 'Failed to update notification' }, { status: 500 })
    }
    if (count === 0) {
      return NextResponse.json({ error: 'Notification not found or access denied' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Notification updated' }, { status: 200 })
  } catch (err) {
    console.error('Unexpected error updating notification:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
