import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin, isPartnerAccount } from '@/lib/server/auth'

// caller via the single role-resolution
// function; the service-role client is gone — notifications are
// inserted server-side with Prisma.

export async function POST(request: Request) {
  // SEC-02 FIX: Require authentication for ALL notifications
  const caller = await getCallerProfile(request)
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 })
  }
  const isAdmin = callerIsAdmin(caller)
  // A7: NOTHING in the app calls this route — the broadcast path let
  // ANY authenticated user push arbitrary "admin" notifications
  // (spoofing). The route is admin-only now, both paths.
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden: Admin role required' }, { status: 403 })
  }

  try {
    const { title, message, type, target_user_id } = await request.json()
    if (!title || typeof title !== 'string' || !message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid required fields' }, { status: 400 })
    }
    if (title.length > 200 || message.length > 2000) {
      return NextResponse.json({ error: 'Payload exceeds allowed length' }, { status: 400 })
    }
    const allowedTypes = ['expense', 'payout', 'kyc', 'kyc_request', 'system', 'security', 'task', 'general', 'transaction', 'profile']
    const cleanType = type && typeof type === 'string' && allowedTypes.includes(type) ? type : 'system'

    let notificationsToInsert: any[] = []

    if (target_user_id) {
      // SEC-02 FIX: Only admins can send notifications to arbitrary target_user_id values.
      // This prevents partners/employees from social-engineering other users.
      if (!isAdmin) {
        return NextResponse.json({ error: 'Forbidden: Admin role required to target specific users' }, { status: 403 })
      }
      notificationsToInsert.push({
        user_id: target_user_id,
        title: title.trim(),
        message: message.trim(),
        type: cleanType,
        read: false,
      })
    } else {
      // No target_user_id → broadcast to all admins (e.g. for expense/payout submissions).
      // FR-1.1 residue: partner accounts (profile_type 'partner' with no
      // admin_users row) are not admins — apply the resolver's shared
      // predicate, exactly as getAdminEmails does.
      const adminCandidates = await prisma.profile.findMany({
        where: { role: { in: ['admin', 'super_admin'] } },
        select: { id: true, profile_type: true },
      })
      const adminUserIds = new Set(
        (await prisma.adminUser.findMany({ select: { id: true } })).map((a) => a.id)
      )
      const admins = adminCandidates.filter(
        (p) => !isPartnerAccount(p.profile_type, adminUserIds.has(p.id))
      )

      if (admins.length === 0) {
        return NextResponse.json({ message: 'No admins found to notify' }, { status: 200 })
      }

      notificationsToInsert = admins.map((a) => ({
        user_id: a.id,
        title: title.trim(),
        message: message.trim(),
        type: cleanType,
        read: false,
      }))
    }

    // Insert notifications
    try {
      await prisma.notification.createMany({ data: notificationsToInsert })
    } catch (insertError) {
      console.error('Failed to send admin notifications:', insertError)
      return NextResponse.json({ error: 'Failed to send notifications' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Notifications sent successfully' }, { status: 200 })
  } catch (err) {
    console.error('Unexpected error in admin/notify route:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
