import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, isAdminRole } from '@/lib/server/auth'
import { hashPassword } from '@/lib/server/passwords'

// auth.admin.updateUserById/deleteUser
// become direct auth_users work. An admin-set password replaces
// BOTH hash fields (native set, legacy cleared) — after an admin
// reset there is exactly one valid credential.

async function requireAdmin(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), caller: null }
  if (!isAdminRole(caller.role)) {
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

    // Update password if provided
    if (password) {
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

    // Deleting the auth user cascades to the profile (the app's FK
    // design mirrors the legacy behaviour).
    await prisma.$transaction(async (tx) => {
      await tx.profile.deleteMany({ where: { id } })
      await tx.authUser.delete({ where: { id } })
    })

    return NextResponse.json({ message: 'User deleted successfully' })
  } catch (error: any) {
    // SEC-12 FIX: Log full error server-side; return generic message to avoid leaking DB internals
    console.error('[DELETE /api/admin/users/[id]] Error:', error)
    return NextResponse.json({ error: 'Failed to delete user. Please try again.' }, { status: 400 })
  }
}
