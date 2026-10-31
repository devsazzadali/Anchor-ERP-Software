import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { hashPassword, validatePasswordPolicy } from '@/lib/server/passwords'
import { logAudit } from '@/lib/server/audit'

// POST /api/auth/change-password { password } — the signed-in user
// changes their OWN password (the replacement for
// the legacy auth update call). Like the admin reset route, the new
// hash replaces BOTH hash fields so exactly one credential is valid.
export async function POST(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { password } = await req.json()
    // S3 (R2 Security Round): the shared password policy replaces
    // the old 6-characters-only check (min 10 + mixed classes +
    // common-password blocklist).
    const policy = validatePasswordPolicy(String(password ?? ''))
    if (!password || !policy.ok) {
      return NextResponse.json(
        { error: policy.error ?? 'Password is required.' },
        { status: 400 }
      )
    }

    const passwordHash = await hashPassword(String(password))
    await prisma.authUser.update({
      where: { id: caller.id },
      data: { password_hash: passwordHash, legacy_bcrypt_hash: null },
    })

    // S3: unified audit event (S1 helper; value never recorded).
    await logAudit({
      caller,
      req,
      action: 'password.change',
      eventType: 'auth',
      entityTable: 'auth_users',
      entityId: caller.id,
      branchId: caller.branch_id,
      fieldChanges: [{ field: 'password', old: '[redacted]', new: '[redacted]' }],
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[POST /api/auth/change-password] Error:', err)
    return NextResponse.json({ error: 'Failed to update password' }, { status: 500 })
  }
}
