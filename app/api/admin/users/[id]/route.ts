import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { hashPassword, validatePasswordPolicy } from '@/lib/server/passwords'
import { logAudit, diffFields } from '@/lib/server/audit'

// auth.admin.updateUserById/deleteUser
// become direct auth_users work. An admin-set password replaces
// BOTH hash fields (native set, legacy cleared) — after an admin
// reset there is exactly one valid credential.

async function requireAdmin(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), caller: null }
  if (!callerIsAdmin(caller)) {
    return {
      error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }),
      caller: null,
    }
  }
  return { error: null, caller }
}

export async function PUT(req: Request, context: any) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const { password, phone_number, role, profile_type } = await req.json()
    const params = await Promise.resolve(context.params)
    const id = params.id

    const beforeProfile = await prisma.profile.findUnique({ where: { id } }).catch(() => null)

    // Update password if provided
    if (password) {
      // S3 (R2 Security Round, Writer B — the only S3 change to this
      // S1 file): admin-set passwords go through the shared policy.
      const policy = validatePasswordPolicy(String(password))
      if (!policy.ok) {
        return NextResponse.json({ error: policy.error }, { status: 400 })
      }
      const passwordHash = await hashPassword(password)
      await prisma.authUser.update({
        where: { id },
        data: { password_hash: passwordHash, legacy_bcrypt_hash: null },
      })
    }

    // Update Profile
    const updateData: any = {}
    if (phone_number !== undefined) updateData.phone_number = phone_number
    if (role !== undefined) updateData.role = role
    if (profile_type !== undefined) updateData.profile_type = profile_type

    if (Object.keys(updateData).length > 0) {
      await prisma.profile.update({ where: { id }, data: updateData })
    }

    const roleChanged = updateData.role !== undefined || updateData.profile_type !== undefined
    await logAudit({
      caller: gate.caller, req,
      action: password ? 'user.update_with_password_reset' : 'user.update',
      eventType: roleChanged ? 'role_change' : 'update',
      entityTable: 'profiles', entityId: id,
      branchId: (beforeProfile as any)?.branch_id ?? null,
      fieldChanges: [
        ...diffFields(beforeProfile as any, { ...(beforeProfile as any), ...updateData }, ['phone_number', 'role', 'profile_type']),
        ...(password ? [{ field: 'password', old: '[redacted]', new: '[redacted]' }] : []),
      ],
    })

    return NextResponse.json({ message: 'User updated successfully' })
  } catch (error: any) {
    // SEC-12 FIX: Log full error server-side; return generic message to avoid leaking DB internals
    console.error('[PUT /api/admin/users/[id]] Error:', error)
    return NextResponse.json({ error: 'Failed to update user. Please try again.' }, { status: 400 })
  }
}

export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, context: any) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error
    const caller = gate.caller!

    const params = await Promise.resolve(context.params)
    const id = params.id

    if (caller.id === id) {
      return NextResponse.json({ error: 'You cannot delete your own admin account.' }, { status: 400 })
    }

    const beforeProfile = await prisma.profile.findUnique({ where: { id } }).catch(() => null)

    // Deleting the auth user cascades to the profile (the app's FK
    // design mirrors the legacy behaviour).
    await prisma.$transaction(async (tx) => {
      await tx.profile.deleteMany({ where: { id } })
      await tx.authUser.delete({ where: { id } })
    })

    await logAudit({
      caller, req, action: 'user.delete', eventType: 'delete',
      entityTable: 'profiles', entityId: id,
      branchId: (beforeProfile as any)?.branch_id ?? null,
      oldValue: beforeProfile ? { email: beforeProfile.email, full_name: beforeProfile.full_name, role: beforeProfile.role } as any : null,
    })

    return NextResponse.json({ message: 'User deleted successfully' })
  } catch (error: any) {
    // SEC-12 FIX: Log full error server-side; return generic message to avoid leaking DB internals
    console.error('[DELETE /api/admin/users/[id]] Error:', error)
    return NextResponse.json({ error: 'Failed to delete user. Please try again.' }, { status: 400 })
  }
}
