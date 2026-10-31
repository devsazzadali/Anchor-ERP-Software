import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { getCallerProfile, isAdminRole } from '@/lib/server/auth'
import { hashPassword } from '@/lib/server/passwords'
import { toPlain } from '@/lib/server/respond'

// admin user management is direct
// work on the auth_users table. Creating a
// user inserts the auth row (bcrypt password_hash) AND the profile
// row in one transaction (the old handle_new_user trigger + profile
// update, made atomic). Admin gate = role column only.

async function requireAdmin(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdminRole(caller.role)) {
    return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  }
  return { caller }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    const { email, password, full_name, phone_number, role, profile_type } = await req.json()

    const passwordHash = await hashPassword(password)
    const userId = randomUUID()

    const created = await prisma.$transaction(async (tx) => {
      const authUser = await tx.authUser.create({
        data: {
          id: userId,
          email,
          password_hash: passwordHash,
          email_confirmed_at: new Date(),
          raw_user_meta_data: { full_name } as any,
        },
      })
      await tx.profile.create({
        data: {
          id: userId,
          email,
          full_name,
          phone_number,
          role: role || 'employee',
          profile_type: profile_type || 'employee',
        },
      })
      return authUser
    })

    return NextResponse.json({
      message: 'User created successfully',
      user: { id: created.id, email: created.email, user_metadata: { full_name } },
    })
  } catch (error: any) {
    // SEC-12 FIX: Log full error, return generic message
    console.error('[POST /api/admin/users] Error:', error)
    return NextResponse.json({ error: 'Failed to create user. Please check the details and try again.' }, { status: 400 })
  }
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req)
    if (gate.error) return gate.error

    // Fetch all auth users + all profiles, merge (auth wins for
    // email/created_at), exactly like the original.
    const [authUsers, profiles] = await Promise.all([
      prisma.authUser.findMany({ select: { id: true, email: true, created_at: true } }),
      prisma.profile.findMany(),
    ])
    const authById = new Map(authUsers.map((u) => [u.id, u]))

    const mergedUsers = toPlain(
      profiles.map((p) => {
        const authUser = authById.get(p.id)
        return {
          ...p,
          email: authUser?.email || p.email || null,
          created_at: authUser?.created_at || p.created_at,
        }
      })
    )

    // Sort by created_at descending
    mergedUsers.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json({ users: mergedUsers })
  } catch (error: any) {
    // SEC-12 FIX: Log full error, return generic message
    console.error('[GET /api/admin/users] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch users. Please try again.' }, { status: 400 })
  }
}
