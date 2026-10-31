import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sendTaskCompletionToAdmins, getAdminEmails } from '@/lib/email-service'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'

// caller via the session; the assignment
// check and status update are server-side Prisma (the old code used
// the service-role client "to bypass RLS" — in the app there is
// no RLS; the assignment check IS the enforcement).

// ---------- PATCH – update status of a task (employee only) ----------
type TaskStatus = 'pending' | 'processing' | 'completed'

export async function PATCH(req: NextRequest, context: any) {
  const { newStatus } = (await req.json()) as { newStatus: TaskStatus }
  const { id } = await context.params

  // get logged‑in user
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
  const user = caller

  // verify that the user is actually assigned to this task
  const task = await prisma.task.findFirst({
    where: { id },
    select: { id: true, title: true, status: true, assigned_to_id: true, assigned_to_name: true },
  })

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  // fetch user's full name from profile
  const profile = await prisma.profile.findFirst({
    where: { id: user.id },
    select: { full_name: true },
  })

  const isAssignedById = task.assigned_to_id === user.id
  if (!isAssignedById) {
    // Also check task_assignments table for multi-assignment support
    const assignment = await prisma.taskAssignment.findFirst({
      where: { task_id: id, assignee_id: user.id },
      select: { assignee_id: true },
    })
    if (!assignment) {
      return NextResponse.json(
        { error: 'Not assigned to this task. task.assigned_to_id=' + task.assigned_to_id + ' vs user.id=' + user.id },
        { status: 403 }
      )
    }
  }

  // only allow valid transitions (aligned with app status values)
  const allowedTransitions: Record<string, readonly TaskStatus[]> = {
    pending: ['processing'],
    processing: ['completed', 'pending'],
    completed: [],
  }
  const currentStatus = task.status as string
  const allowed = allowedTransitions[currentStatus] || []
  if (!allowed.includes(newStatus)) {
    return NextResponse.json(
      { error: 'Invalid status transition from ' + task.status + ' to ' + newStatus },
      { status: 400 }
    )
  }

  // update status
  try {
    await prisma.task.update({ where: { id: task.id }, data: { status: newStatus } })
  } catch (updateErr: any) {
    return NextResponse.json({ error: updateErr.message }, { status: 400 })
  }

  // --- Notify Admins ---
  const userName = profile?.full_name || task.assigned_to_name || 'Unknown User'
  try {
    const admins = await prisma.profile.findMany({
      where: { role: { in: ['admin', 'super_admin'] } },
      select: { id: true },
    })

    if (admins && admins.length > 0) {
      const notificationsToInsert = admins.map((admin) => ({
        user_id: admin.id,
        title: 'Task Status Updated',
        // BUG-010 FIX: Use task.title instead of task.id.slice(0, 8)
        message: userName + ' updated task "' + task.title + '" to ' + newStatus.toUpperCase(),
        type: 'task',
        read: false,
      }))
      await prisma.notification.createMany({ data: notificationsToInsert })
    }

    if (newStatus === 'completed') {
      const adminEmails = await getAdminEmails()
      if (adminEmails.length > 0) {
        await sendTaskCompletionToAdmins(adminEmails, userName, task.title).catch((e) =>
          console.error('Failed to send completion email:', e)
        )
      }
    }
  } catch (e) {
    console.error('Failed to notify admins about task status:', e)
  }
  // ---------------------

  return NextResponse.json({ success: true, newStatus })
}
