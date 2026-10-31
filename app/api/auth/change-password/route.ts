import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { hashPassword } from '@/lib/server/passwords'

// POST /api/auth/change-password { password } — the signed-in user
// changes their OWN password (the replacement for
// the legacy auth update call). Like the admin reset route, the new
// hash replaces BOTH hash fields so exactly one credential is valid.
export async function POST(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { password } = await req.json()
    if (!password || String(password).length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters long.' }, { status: 400 })
    }

    const passwordHash = await hashPassword(String(password))
    await prisma.authUser.update({
      where: { id: caller.id },
      data: { password_hash: passwordHash, legacy_bcrypt_hash: null },
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[POST /api/auth/change-password] Error:', err)
    return NextResponse.json({ error: 'Failed to update password' }, { status: 500 })
  }
}
