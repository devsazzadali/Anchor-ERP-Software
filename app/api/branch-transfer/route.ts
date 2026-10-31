import { NextResponse } from 'next/server'
import { sendBranchChangeToUser } from '@/lib/email-service'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'

// admin gate via the single
// role-resolution function; transfer record + profile update +
// notification in ONE transaction (the original sequence of
// service-role statements could half-apply). The employee email
// comes from auth_users (was auth.admin.getUserById).

export async function POST(request: Request) {
  try {
    const caller = await getCallerProfile(request)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { userId, newBranchId, joinDate, note } = await request.json()

    if (!userId || !newBranchId || !joinDate) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 2. Fetch employee's current profile to get old branch details
    const profile = await prisma.profile.findFirst({
      where: { id: userId },
      select: { full_name: true, branch_id: true, branch: true },
    })

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    let newBranchName = 'Head Office'
    let finalBranchId: string | null = null

    if (newBranchId !== 'head_office') {
      // 3. Fetch new branch details
      const newBranch = await prisma.branch.findFirst({
        where: { id: newBranchId },
        select: { name: true },
      })

      if (!newBranch) {
        return NextResponse.json({ error: 'New branch not found' }, { status: 404 })
      }
      newBranchName = newBranch.name
      finalBranchId = newBranchId
    }

    const oldBranchId = profile.branch_id
    const oldBranchName = profile.branch || 'Not Assigned'

    // 4. Get employee's email from auth users
    const authUser = await prisma.authUser.findFirst({
      where: { id: userId },
      select: { email: true },
    })
    if (!authUser || !authUser.email) {
      return NextResponse.json({ error: 'Employee email not found' }, { status: 404 })
    }
    const employeeEmail = authUser.email

    // 5-7. Transfer record + profile update + notification, atomic.
    const notificationMessage =
      'Your branch has been transferred from "' + oldBranchName + '" to "' + newBranchName +
      '" effective from ' + new Date(joinDate).toLocaleDateString() + '. Note: ' + (note || 'N/A')
    try {
      await prisma.$transaction(async (tx) => {
        await tx.branchTransfer.create({
          data: {
            user_id: userId,
            old_branch_id: oldBranchId || null,
            old_branch_name: oldBranchName,
            // FR-6 #19 (type-level only): branch_transfers.new_branch_id
            // is NOT NULL in both the Prisma schema and the DB, so the
            // payload field is typed to the schema's nullability. No
            // runtime change — the head-office case (finalBranchId
            // null) behaves exactly as before.
            new_branch_id: finalBranchId as string,
            new_branch_name: newBranchName,
            join_date: new Date(joinDate),
            note: note || '',
          },
        })

        await tx.profile.update({
          where: { id: userId },
          data: {
            branch_id: finalBranchId,
            branch: newBranchName,
          },
        })

        await tx.notification
          .create({
            data: {
              user_id: userId,
              title: 'Branch Transfer Notification',
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
      console.error('Failed to log branch transfer:', transferError)
      return NextResponse.json({ error: 'Failed to record branch transfer in database' }, { status: 500 })
    }

    // 8. Send Email via Resend dynamically
    await sendBranchChangeToUser(employeeEmail, profile.full_name, newBranchName).catch((emailErr) =>
      console.error('Resend email failed to send:', emailErr)
    )

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Branch transfer API error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
