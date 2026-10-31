import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// admin gate = role admin/super_admin OR
// admin_users membership (the original requireAdmin rule, now via
// the single role-resolution function). All writes run in ONE
// transaction — the original sequence of separate service-role
// statements could half-apply (assignment deactivated but profile
// flag not set); the app makes the whole change atomic.

async function requireAdmin(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller || !callerIsAdmin(caller)) return null
  return caller
}

// GET /api/branch-accounts/manager
// List all manager assignments (admin only)
export async function GET(req: NextRequest) {
  try {
    const adminUser = await requireAdmin(req)
    if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const rows = await prisma.branchManagerAssignment.findMany({
      orderBy: { assigned_at: 'desc' },
      select: { id: true, is_active: true, assigned_at: true, notes: true, employee_id: true, branch_id: true },
    })
    const empIds = [...new Set(rows.map((r) => r.employee_id))]
    const branchIds = [...new Set(rows.map((r) => r.branch_id))]
    const [emps, branches] = await Promise.all([
      empIds.length
        ? prisma.profile.findMany({
            where: { id: { in: empIds } },
            select: { id: true, full_name: true, email: true, phone_number: true, profile_photo_url: true },
          })
        : Promise.resolve([]),
      branchIds.length
        ? prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ])
    const empById = new Map(emps.map((e) => [e.id, e]))
    const branchById = new Map(branches.map((b) => [b.id, b]))
    const assignments = rows.map((r) => ({
      id: r.id,
      is_active: r.is_active,
      assigned_at: r.assigned_at,
      notes: r.notes,
      employee: empById.get(r.employee_id) ?? null,
      branch: branchById.get(r.branch_id) ?? null,
    }))

    return NextResponse.json({ assignments: toPlain(assignments) })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/branch-accounts/manager
// Assign an employee as branch manager (admin only)
export async function POST(req: NextRequest) {
  try {
    const adminUser = await requireAdmin(req)
    if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const { employee_id, branch_id, notes } = body

    if (!employee_id || !branch_id) {
      return NextResponse.json({ error: 'employee_id and branch_id are required' }, { status: 400 })
    }

    const now = new Date()
    const result = await prisma.$transaction(async (tx) => {
      // Deactivate any existing active assignment for this employee
      await tx.branchManagerAssignment.updateMany({
        where: { employee_id, is_active: true },
        data: { is_active: false, updated_at: now },
      })

      // Deactivate any existing active manager for this branch
      const existingAssignment = await tx.branchManagerAssignment.findFirst({
        where: { branch_id, is_active: true },
        select: { employee_id: true },
      })

      if (existingAssignment) {
        // Remove manager flag from previous manager
        await tx.profile.updateMany({
          where: { id: existingAssignment.employee_id },
          data: { is_branch_manager: false, profile_type: 'employee', branch_id: null, updated_at: now },
        })

        await tx.branchManagerAssignment.updateMany({
          where: { branch_id, is_active: true },
          data: { is_active: false, updated_at: now },
        })
      }

      // Fetch branch name
      const branch = await tx.branch.findFirst({ where: { id: branch_id }, select: { name: true } })

      // Create new assignment (upsert on employee_id+branch_id, as
      // the original onConflict did)
      const assignment = await tx.branchManagerAssignment.upsert({
        where: { employee_id_branch_id: { employee_id, branch_id } },
        create: {
          employee_id,
          branch_id,
          assigned_by: adminUser.id,
          is_active: true,
          notes: notes || null,
          assigned_at: now,
          updated_at: now,
        },
        update: {
          assigned_by: adminUser.id,
          is_active: true,
          notes: notes || null,
          assigned_at: now,
          updated_at: now,
        },
      })

      // Update employee profile: set branch_manager flag + branch + profile_type
      await tx.profile.update({
        where: { id: employee_id },
        data: {
          is_branch_manager: true,
          profile_type: 'branch_manager',
          branch_id,
          branch: branch?.name ?? null,
          updated_at: now,
        },
      })

      // Audit log
      await tx.branchAuditTrail.create({
        data: {
          branch_id,
          table_name: 'branch_manager_assignments',
          record_id: assignment.id,
          action: 'create',
          performed_by: adminUser.id,
          new_value: { employee_id, branch_id, notes } as any,
          notes: `Manager assigned to ${branch?.name ?? branch_id}`,
        },
      })

      return assignment
    })

    return NextResponse.json({ success: true, assignment: toPlain(result) })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/branch-accounts/manager?employee_id=xxx
// Remove manager assignment (admin only)
export async function DELETE(req: NextRequest) {
  try {
    const adminUser = await requireAdmin(req)
    if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employee_id')
    if (!employeeId) return NextResponse.json({ error: 'employee_id required' }, { status: 400 })

    const now = new Date()
    await prisma.$transaction(async (tx) => {
      // Deactivate assignment (keep the row for the audit INSERT —
      // the original read it back via update().select())
      const active = await tx.branchManagerAssignment.findMany({
        where: { employee_id: employeeId, is_active: true },
        select: { id: true, branch_id: true },
      })
      await tx.branchManagerAssignment.updateMany({
        where: { employee_id: employeeId, is_active: true },
        data: { is_active: false, updated_at: now },
      })
      const assignment = active[0] ?? null

      // Reset profile
      await tx.profile.updateMany({
        where: { id: employeeId },
        data: {
          is_branch_manager: false,
          profile_type: 'employee',
          updated_at: now,
        },
      })

      if (assignment) {
        await tx.branchAuditTrail.create({
          data: {
            branch_id: assignment.branch_id,
            table_name: 'branch_manager_assignments',
            record_id: assignment.id,
            action: 'update',
            performed_by: adminUser.id,
            new_value: { is_active: false } as any,
            notes: 'Manager role removed',
          },
        })
      }
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
