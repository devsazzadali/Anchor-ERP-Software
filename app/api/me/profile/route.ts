import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// the settings page's own profile.
// GET returns the caller's profile WITHOUT the security_answer
// value (only whether one is saved — the page renders a masked
// placeholder) plus the caller's salary history. PATCH is the A1
// self-update: a strict column whitelist (full_name, address,
// bank_info, security_question, security_answer digest,
// is_2fa_enabled) — role-bearing columns (role, profile_type,
// is_branch_manager, branch_id) are NEVER client-writable here;
// that is the prevent_profile_privilege_escalation trigger's job,
// enforced in code. The BUG-A5 admin broadcast notification is
// created server-side (clients can no longer forge notifications).

const SELF_WRITABLE = [
  'full_name',
  'address',
  'bank_info',
  'security_question',
  'security_answer',
  'is_2fa_enabled',
] as const

export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await prisma.profile.findUnique({ where: { id: caller.id } })
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const salaryHistory = await prisma.salaryPayment.findMany({
      where: { employee_id: caller.id },
      orderBy: { payment_date: 'desc' },
    })

    const { security_answer, ...rest } = profile as any
    return NextResponse.json({
      profile: toPlain({ ...rest, has_security_answer: !!security_answer }),
      salaryHistory: toPlain(salaryHistory),
    })
  } catch (err: any) {
    console.error('[GET /api/me/profile] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const data: Record<string, unknown> = {}
    for (const key of SELF_WRITABLE) {
      if (key in body) data[key] = body[key]
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No writable fields supplied' }, { status: 400 })
    }

    const updated = await prisma.profile.update({ where: { id: caller.id }, data })

    // BUG-A5 FIX: Notify admins about profile update.
    // user_id is null + is_admin_only:true = broadcast to all admins
    // via the NotificationDropdown filter (created server-side now).
    await prisma.notification
      .create({
        data: {
          user_id: null,
          title: `${caller.profile_type === 'partner' ? 'Partner' : caller.profile_type === 'head_office' ? 'Head Office' : 'Employee'} Profile Updated`,
          message: `${(data.full_name as string) || caller.full_name || caller.email || 'A user'} has modified their profile information. [ID: ${caller.id}]`,
          type: 'profile',
          is_admin_only: true,
          read: false,
        },
      })
      .catch((notifErr) => console.error('Failed to notify admin on profile change:', notifErr))

    const { security_answer, ...rest } = updated as any
    return NextResponse.json({
      profile: toPlain({ ...rest, has_security_answer: !!security_answer }),
    })
  } catch (err: any) {
    console.error('[PATCH /api/me/profile] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
