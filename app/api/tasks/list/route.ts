import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// full task rows for the dashboard
// tasks page. BUG-A1 rule enforced server-side: admins (the
// unified callerIsAdmin definition, FR-1.2) see all tasks;
// everyone else sees only tasks assigned
// to them — via tasks.assigned_to_id OR a task_assignments row.
// (Distinct from GET /api/tasks, whose trimmed payload serves the
// admin task manager and the assignment-based employee view.)
export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (callerIsAdmin(caller)) {
      const tasks = await prisma.task.findMany({ orderBy: { created_at: 'desc' } })
      return NextResponse.json({ tasks: toPlain(tasks) })
    }

    const assignments = await prisma.taskAssignment.findMany({
      where: { assignee_id: caller.id },
      select: { task_id: true },
    })
    const assignedIds = assignments.map((a) => a.task_id)
    const tasks = await prisma.task.findMany({
      where: {
        OR: [{ assigned_to_id: caller.id }, ...(assignedIds.length ? [{ id: { in: assignedIds } }] : [])],
      },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ tasks: toPlain(tasks) })
  } catch (err: any) {
    console.error('[GET /api/tasks/list] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
