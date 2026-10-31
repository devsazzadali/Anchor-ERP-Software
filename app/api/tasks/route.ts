import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sendTaskAssignmentToUser } from '@/lib/email-service'
import { prisma } from '@/lib/db'
import { getCallerProfile, isAdminRole } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// caller via the single role-resolution
// function; task + assignments created in ONE transaction (the
// BUG-012 rollback becomes structural). Embeds attached manually.

// ---------- POST – create a new task (admin only) ----------
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { title, description, assigneeIds } = body

  // BUG-011 FIX: Validate that title is present and non-empty
  if (!title?.trim()) {
    return NextResponse.json({ error: 'Task title is required' }, { status: 400 })
  }

  // verify admin role
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  if (!isAdminRole(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let task: any
  try {
    task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          title: title.trim(),
          description,
          created_by: caller.id,
          assigned_to_id: assigneeIds?.[0] ?? null,
          assigned_to_name: body.assigned_to_name ?? null,
          status: body.status ?? 'pending',
          deadline: body.deadline ? new Date(body.deadline) : null,
          note: body.note ?? null,
        },
      })

      // add assignments if any (BUG-012: a failure here rolls the
      // whole transaction back — no orphan task)
      if (Array.isArray(assigneeIds) && assigneeIds.length) {
        await tx.taskAssignment.createMany({
          data: assigneeIds.map((id: string) => ({ task_id: created.id, assignee_id: id })),
        })
      }
      return created
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }

  // Trigger emails and notifications for assigned users
  if (Array.isArray(assigneeIds) && assigneeIds.length) {
    const notificationsToInsert = assigneeIds.map((id: string) => ({
      user_id: id,
      title: 'New Task Assigned',
      message: 'You have been assigned a new task: "' + task.title + '" [req_id:' + task.id + ']',
      type: 'task',
      read: false,
    }))
    await prisma.notification.createMany({ data: notificationsToInsert })

    for (const assigneeId of assigneeIds) {
      const authUser = await prisma.authUser.findFirst({
        where: { id: assigneeId },
        select: { email: true },
      })
      const email = authUser?.email
      if (email) {
        const userName = body.assigned_to_name || 'Partner'
        await sendTaskAssignmentToUser(
          email,
          userName,
          task.title,
          task.deadline || new Date().toISOString(),
          task.description
        ).catch((err) => console.error('Failed to send task email', err))
      }
    }
  }

  return NextResponse.json({ task: toPlain(task) })
}

// ---------- GET – list tasks (admin: all, employee: own) ----------
export async function GET(req: NextRequest) {
  const caller = await getCallerProfile(req)

  // BUG-013 FIX: Return 401 immediately for unauthenticated requests
  if (!caller) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  // admin: full list with assignments
  if (isAdminRole(caller.role)) {
    try {
      const tasks = await prisma.task.findMany({
        select: { id: true, title: true, description: true, status: true, created_at: true },
        orderBy: { created_at: 'desc' },
      })
      const taskIds = tasks.map((t) => t.id)
      const assignments = taskIds.length
        ? await prisma.taskAssignment.findMany({
            where: { task_id: { in: taskIds } },
            select: { task_id: true, assignee_id: true, status: true },
          })
        : []
      const assigneeIds = [...new Set(assignments.map((a) => a.assignee_id))]
      const profs = assigneeIds.length
        ? await prisma.profile.findMany({
            where: { id: { in: assigneeIds } },
            select: { id: true, full_name: true },
          })
        : []
      const nameById = new Map(profs.map((p) => [p.id, p.full_name]))
      const byTask = new Map<string, any[]>()
      for (const a of assignments) {
        const list = byTask.get(a.task_id) ?? []
        list.push({
          assignee_id: a.assignee_id,
          status: a.status,
          profiles: { full_name: nameById.get(a.assignee_id) ?? null },
        })
        byTask.set(a.task_id, list)
      }
      const data = tasks.map((t) => ({ ...t, task_assignments: byTask.get(t.id) ?? [] }))
      return NextResponse.json({ tasks: toPlain(data) })
    } catch (error) {
      console.error('[GET /api/tasks] Admin query error:', error)
      return NextResponse.json({ error: 'Failed to fetch tasks. Please try again.' }, { status: 400 })
    }
  }

  // employee: only his assignments
  try {
    const rows = await prisma.taskAssignment.findMany({
      where: { assignee_id: caller.id },
      select: { status: true, task_id: true },
    })
    const taskIds = rows.map((r) => r.task_id)
    const taskRows = taskIds.length
      ? await prisma.task.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, title: true, description: true, status: true, created_at: true },
        })
      : []
    const taskById = new Map(taskRows.map((t) => [t.id, t]))
    const tasks = rows
      .filter((r) => taskById.has(r.task_id))
      .map((r) => ({ ...taskById.get(r.task_id), my_status: r.status }))
    return NextResponse.json({ tasks: toPlain(tasks) })
  } catch (error) {
    console.error('[GET /api/tasks] Employee query error:', error)
    return NextResponse.json({ error: 'Failed to fetch tasks. Please try again.' }, { status: 400 })
  }
}
