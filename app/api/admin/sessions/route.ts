import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin, isPartnerAccount } from '@/lib/server/auth'
import { getSecuritySettings, idleRoleFor, type IdleRole } from '@/lib/server/session-registry'
import { SESSION_TTL_SECONDS } from '@/lib/server/session'
import { toPlain } from '@/lib/server/respond'

// GET /api/admin/sessions — S2 (R2 Security Round): the active
// session registry for admins.
//
// "ACTIVE" DEFINITION (also stated on /admin/sessions): a registry
// row counts as active when it is NOT revoked, its token has not
// hit the absolute 7-day cap (created_at + 7d > now), and its
// last_seen_at is within the owner's role idle window (admin 2h,
// manager 8h, employee 12h, partner 8h — settings-overridable).
// Rows that fail the idle/absolute tests are returned too, flagged
// active: false, so admins can see stale sessions.
//
// LEGACY TRANSITION: tokens minted before S2 carry no jti and have
// NO registry row — they cannot be enumerated here. They stay valid
// until natural expiry, but "Revoke all" for a user bumps their
// session_epoch and kills legacy tokens at their next request.
// That caveat is returned as `legacySessionNote` and shown on the page.

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const now = new Date()
    const horizon = new Date(now.getTime() - SESSION_TTL_SECONDS * 1000)
    const rows = await prisma.userSession.findMany({
      where: { created_at: { gte: horizon } },
      orderBy: { last_seen_at: 'desc' },
      take: 500,
    })

    const userIds = [...new Set(rows.map((r) => r.user_id))]
    const [profiles, authUsers, adminRows] = await Promise.all([
      prisma.profile.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true, full_name: true, email: true, role: true, profile_type: true,
          branch: true, branch_id: true, is_branch_manager: true,
        },
      }),
      prisma.authUser.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true },
      }),
      prisma.adminUser.findMany({ select: { id: true } }),
    ])
    const profileById = new Map(profiles.map((p) => [p.id, p]))
    const emailById = new Map(authUsers.map((u) => [u.id, u.email]))
    const adminRowIds = new Set(adminRows.map((a) => a.id))
    const { idleHours } = await getSecuritySettings()

    const sessions = rows.map((row) => {
      const profile = profileById.get(row.user_id)
      const isAdminUser =
        !!profile &&
        !isPartnerAccount(profile.profile_type, adminRowIds.has(profile.id)) &&
        (profile.role === 'admin' || profile.role === 'super_admin' || adminRowIds.has(profile.id))
      const idleRole: IdleRole = !profile
        ? 'employee'
        : idleRoleFor({
            sessionEpoch: 0,
            isAdmin: isAdminUser,
            isPartner: isPartnerAccount(profile.profile_type, adminRowIds.has(profile.id)),
            isBranchManager:
              profile.is_branch_manager === true || profile.profile_type === 'branch_manager',
          })
      const idleMs = idleHours[idleRole] * 60 * 60 * 1000
      const active =
        !row.revoked_at &&
        row.created_at.getTime() + SESSION_TTL_SECONDS * 1000 > now.getTime() &&
        now.getTime() - row.last_seen_at.getTime() <= idleMs
      return {
        id: row.id,
        user_id: row.user_id,
        user_name: profile?.full_name ?? null,
        user_email: profile?.email ?? emailById.get(row.user_id) ?? null,
        role: profile?.role ?? null,
        profile_type: profile?.profile_type ?? null,
        branch: profile?.branch ?? null,
        branch_id: profile?.branch_id ?? null,
        created_at: row.created_at,
        last_seen_at: row.last_seen_at,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        revoked_at: row.revoked_at,
        revoke_reason: row.revoke_reason,
        active,
      }
    })

    return NextResponse.json({
      sessions: toPlain(sessions),
      activeDefinition:
        'Active = not revoked, token within its absolute 7-day cap, and last activity within the role idle window (admin 2h, branch manager 8h, employee 12h, partner 8h).',
      legacySessionNote:
        'Sessions started before the session registry shipped use legacy tokens with no registry row — they do not appear here, stay valid until their natural 7-day expiry, and are killed by "Revoke all" (session epoch bump) at their next request.',
    })
  } catch (err: any) {
    console.error('[GET /api/admin/sessions] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
