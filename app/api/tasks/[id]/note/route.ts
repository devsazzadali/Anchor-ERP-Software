import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'

// caller via the session; assignment
// check + note update are server-side Prisma.

// ---------- PATCH – update note of a task (employee only) ----------
export async function PATCH(req: NextRequest, context: any) {
  const { note } = (await req.json()) as { note: string }
  const { id } = await context.params

  // get logged‑in user
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
  const user = caller

  // verify that the user is actually assigned to this task
  const task = await prisma.task.findFirst({
    where: { id },
    select: { id: true, assigned_to_id: true, assigned_to_name: true },
  })

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const isAssignedById = task.assigned_to_id === user.id
  if (!isAssignedById) {
    // Also check task_assignments table for multi-assignment support
    const assignment = await prisma.taskAssignment.findFirst({
      where: { task_id: id, assignee_id: user.id },
      select: { assignee_id: true },
    })
    if (!assignment) {
      return NextResponse.json({ error: 'Not assigned to this task' }, { status: 403 })
    }
  }

  // update note
  try {
    await prisma.task.update({ where: { id: task.id }, data: { note } })
  } catch (updateErr: any) {
    return NextResponse.json({ error: updateErr.message }, { status: 400 })
  }

  return NextResponse.json({ success: true, note })
}
