import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// /api/admin/tasks — admin-only full task management for the admin
// tasks page. (The converted /api/tasks routes serve the employee
// assignment flow: their status/note PATCHes enforce assignee-only
// transitions, so the admin page — which sets any status, edits
// notes and deletes — uses this admin-gated surface instead.)
// GET: full task rows (newest first) + the non-admin profile list
// for the assignee dropdown, the two reads the page made before.
// POST: create a task row (the page fires the TASK_ASSIGNED email
// itself afterwards, as before).
// PATCH { id, status?, note? }: admin status / note update.
// DELETE { id }: delete a task and its assignments.
async function requireAdmin(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!callerIsAdmin(caller)) return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  return { caller }
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const [tasks, profiles] = await Promise.all([
      prisma.task.findMany({ orderBy: { created_at: 'desc' } }),
      prisma.profile.findMany({
        where: { role: { notIn: ['admin', 'super_admin'] } },
        select: { id: true, full_name: true, profile_type: true },
        orderBy: { full_name: 'asc' },
      }),
    ])

    return NextResponse.json({ tasks: toPlain(tasks), profiles: toPlain(profiles) })
  } catch (err: any) {
    console.error('[GET /api/admin/tasks] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const body = await req.json()
    if (!body.title?.trim()) {
      return NextResponse.json({ error: 'Task title is required' }, { status: 400 })
    }

    const task = await prisma.task.create({
      data: {
        title: body.title,
        description: body.description ?? null,
        assigned_to_id: body.assigned_to_id ?? null,
        assigned_to_name: body.assigned_to_name ?? null,
        status: body.status ?? 'pending',
        deadline: body.deadline ? new Date(body.deadline) : null,
        note: body.note ?? null,
        created_by: gate.caller.id,
      },
    })

    return NextResponse.json({ task: toPlain(task) })
  } catch (err: any) {
    console.error('[POST /api/admin/tasks] Error:', err)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const { id, status, note } = await req.json()
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const data: any = {}
    if (status !== undefined) data.status = status
    if (note !== undefined) data.note = note
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided for update' }, { status: 400 })
    }

    const task = await prisma.task.update({ where: { id }, data })
    return NextResponse.json({ task: toPlain(task) })
  } catch (err: any) {
    console.error('[PATCH /api/admin/tasks] Error:', err)
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    await prisma.$transaction(async (tx) => {
      await tx.taskAssignment.deleteMany({ where: { task_id: id } })
      await tx.task.delete({ where: { id } })
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[DELETE /api/admin/tasks] Error:', err)
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })
  }
}
