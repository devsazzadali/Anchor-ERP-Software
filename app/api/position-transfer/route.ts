import { NextResponse } from 'next/server'
// BUG-R06 FIX: Use shared email-service instead of inline Resend instantiation
import { sendPositionChangeToUser } from '@/lib/email-service'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'

// admin gate via the single
// role-resolution function; transfer record + profile update +
// notification in ONE transaction. Employee email from auth_users.

export async function POST(request: Request) {
  try {
    const caller = await getCallerProfile(request)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { userId, newPositionId, joinDate, note } = await request.json()

    if (!userId || !newPositionId || !joinDate) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 2. Fetch employee's current profile to get old position details
    const profile = await prisma.profile.findFirst({
      where: { id: userId },
      select: { full_name: true, position_id: true, position: true },
    })

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // 3. Fetch new position details
    const newPosition = await prisma.position.findFirst({
      where: { id: newPositionId },
      select: { name: true },
    })

    if (!newPosition) {
      return NextResponse.json({ error: 'New position not found' }, { status: 404 })
    }

    const oldPositionId = profile.position_id
    const oldPositionName = profile.position || 'Not Assigned'
    const newPositionName = newPosition.name

    // 4. Get employee's email from auth users
    const authUser = await prisma.authUser.findFirst({
      where: { id: userId },
      select: { email: true },
    })
    if (!authUser || !authUser.email) {
      return NextResponse.json({ error: 'Employee email not found' }, { status: 404 })
    }
    const employeeEmail = authUser.email
    const effectiveDate = new Date(joinDate).toLocaleDateString()

    // 5-7. Transfer record + profile update + notification, atomic.
    const notificationMessage =
      'Your position has been changed from "' + oldPositionName + '" to "' + newPositionName +
      '" effective from ' + effectiveDate + '. Note: ' + (note || 'N/A')
    try {
      await prisma.$transaction(async (tx) => {
        await tx.positionTransfer.create({
          data: {
            user_id: userId,
            old_position_id: oldPositionId || null,
            old_position_name: oldPositionName,
            new_position_id: newPositionId,
            new_position_name: newPositionName,
            join_date: new Date(joinDate),
            note: note || '',
          },
        })

        await tx.profile.update({
          where: { id: userId },
          data: {
            position_id: newPositionId,
            position: newPositionName,
          },
        })

        await tx.notification
          .create({
            data: {
              user_id: userId,
              title: 'Position Change Notification',
              message: notificationMessage,
              type: 'general',
              read: false,
            },
          })
          .catch((notificationError) => {
            console.error('Failed to create in-app notification:', notificationError)
          })
      })
    } catch (transferError) {
      console.error('Failed to log position transfer:', transferError)
      return NextResponse.json({ error: 'Failed to record position transfer in database' }, { status: 500 })
    }

    // 8. BUG-R06 FIX: Use shared sendPositionChangeToUser (was inline Resend with hardcoded HTML)
    await sendPositionChangeToUser(
      employeeEmail,
      profile.full_name,
      oldPositionName,
      newPositionName,
      effectiveDate,
      note
    ).catch((emailErr) => console.error('Position change email failed to send:', emailErr))

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Position transfer API error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
