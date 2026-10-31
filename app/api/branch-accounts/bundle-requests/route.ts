import { NextRequest, NextResponse } from 'next/server'
import { sendBundleRequestEmailToAdmins } from '@/lib/email-service'
import { bundleTotal, bundleValueFor } from '@/lib/bundles'
import { prisma } from '@/lib/db'
import { getCallerProfile, isAdminRole } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// the route's local getCallerProfile is
// replaced by the single role-resolution function
// (lib/server/auth.ts) — same semantics (profile flag/profile_type +
// active-assignment fallback). Service-role reads/writes become
// server-side Prisma.

export async function GET(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)

    if (!profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isAdmin = isAdminRole(profile.role)
    const isManager = profile.is_branch_manager || profile.role === 'branch_manager'

    if (!isAdmin && !isManager) {
      return NextResponse.json({ error: 'Access restricted to Branch Managers and Admins' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const branchFilter = searchParams.get('branch_id')
    const statusFilter = searchParams.get('status')
    const urgencyFilter = searchParams.get('urgency')

    const where: any = {}
    if (isAdmin) {
      if (branchFilter) where.branch_id = branchFilter
    } else {
      // Branch manager only sees their own branch
      if (profile.branch_id) {
        where.branch_id = profile.branch_id
      } else {
        where.manager_id = profile.uid
      }
    }

    if (statusFilter && statusFilter !== 'all') where.status = statusFilter
    if (urgencyFilter && urgencyFilter !== 'all') where.urgency = urgencyFilter

    const data = await prisma.branchBundleRequest.findMany({
      where,
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ requests: toPlain(data) || [] })
  } catch (err: any) {
    console.error('[GET /api/branch-accounts/bundle-requests] Fatal error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await getCallerProfile(req)

    if (!profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isAdmin = isAdminRole(profile.role)
    const isManager = profile.is_branch_manager || profile.role === 'branch_manager'

    if (!isManager && !isAdmin) {
      return NextResponse.json({ error: 'Access restricted to Branch Managers and Admins' }, { status: 403 })
    }

    const body = await req.json()
    const {
      bundle_10_count = 0,
      bundle_20_count = 0,
      bundle_50_count = 0,
      bundle_100_count = 0,
      urgency = 'normal',
      reason = '',
    } = body

    const b10 = Math.max(0, parseInt(bundle_10_count, 10) || 0)
    const b20 = Math.max(0, parseInt(bundle_20_count, 10) || 0)
    const b50 = Math.max(0, parseInt(bundle_50_count, 10) || 0)
    const b100 = Math.max(0, parseInt(bundle_100_count, 10) || 0)

    // Canonical bundle values live in lib/bundles.ts (1 bundle = 100 notes).
    const totalAmount = bundleTotal({ b10, b20, b50, b100 })

    if (totalAmount <= 0) {
      return NextResponse.json({ error: 'Please select at least one note bundle to request.' }, { status: 400 })
    }

    let branchId = isManager ? profile.branch_id : body.branch_id || profile.branch_id
    let branchName = profile.branch || 'Branch'

    if (!branchId) {
      return NextResponse.json(
        {
          error: isAdmin
            ? 'Please select a branch (branch_id is required).'
            : 'Branch is not assigned to this manager.',
        },
        { status: 400 }
      )
    }

    // Resolve branch details
    const bData = await prisma.branch.findFirst({
      where: { id: branchId },
      select: { id: true, name: true },
    })
    if (bData) {
      branchName = bData.name
    }

    const managerName = profile.full_name || (isAdmin ? 'Admin Office' : 'Branch Manager')

    // 1. Insert into branch_bundle_requests
    let bundleReq: any
    try {
      bundleReq = await prisma.branchBundleRequest.create({
        data: {
          branch_id: branchId,
          branch_name: branchName,
          manager_id: profile.uid,
          manager_name: managerName,
          bundle_10_count: b10,
          bundle_20_count: b20,
          bundle_50_count: b50,
          bundle_100_count: b100,
          total_amount: totalAmount,
          urgency: urgency === 'urgent' ? 'urgent' : 'normal',
          reason: reason?.trim() || null,
          status: 'requested',
        },
      })
    } catch (insertErr: any) {
      console.error('[POST /api/branch-accounts/bundle-requests] Insert error:', insertErr)
      return NextResponse.json({ error: insertErr?.message || 'Failed to record bundle requisition' }, { status: 500 })
    }

    // 2. Format breakdown text for task
    const breakdownParts = []
    if (b10 > 0) breakdownParts.push(`• ৳10 Notes: ${b10} bundle(s) [${b10 * 100} pcs] = ৳${bundleValueFor(10, b10).toLocaleString('en-BD')}`)
    if (b20 > 0) breakdownParts.push(`• ৳20 Notes: ${b20} bundle(s) [${b20 * 100} pcs] = ৳${bundleValueFor(20, b20).toLocaleString('en-BD')}`)
    if (b50 > 0) breakdownParts.push(`• ৳50 Notes: ${b50} bundle(s) [${b50 * 100} pcs] = ৳${bundleValueFor(50, b50).toLocaleString('en-BD')}`)
    if (b100 > 0) breakdownParts.push(`• ৳100 Notes: ${b100} bundle(s) [${b100 * 100} pcs] = ৳${bundleValueFor(100, b100).toLocaleString('en-BD')}`)

    const breakdownText = breakdownParts.join('\n')

    // 3. Automatically register task in `tasks` table
    let createdTaskId: string | null = null
    try {
      const taskDeadline = new Date(Date.now() + (urgency === 'urgent' ? 24 : 72) * 60 * 60 * 1000)

      const task = await prisma.task.create({
        data: {
          title: `Cash Bundle Requisition: ${branchName} (৳${totalAmount.toLocaleString('en-BD')})`,
          description: `Cash Change Requisition from ${branchName}\nManager: ${managerName}\nUrgency: ${urgency.toUpperCase()}\n\nRequested Note Bundles (100 pcs/bundle):\n${breakdownText}\n\nTotal Cash Needed: ৳${totalAmount.toLocaleString('en-BD')}\nReason/Remarks: ${reason?.trim() || 'Change for customer cash transactions'}\n\n[Requisition Ref: ${bundleReq.id}]`,
          created_by: profile.uid,
          status: 'pending',
          deadline: taskDeadline,
          note: `Automated bundle requisition [req_id:${bundleReq.id}]`,
        },
        select: { id: true },
      })

      createdTaskId = task.id
      await prisma.branchBundleRequest.update({
        where: { id: bundleReq.id },
        data: { task_id: task.id },
      })
    } catch (taskEx) {
      console.warn('[POST /api/branch-accounts/bundle-requests] Task auto-creation warning:', taskEx)
    }

    // 4. Send email + in-app notifications to admins
    try {
      const admins = await prisma.profile.findMany({
        where: { role: { in: ['admin', 'super_admin'] } },
        select: { id: true },
      })

      if (admins.length > 0) {
        await prisma.notification.createMany({
          data: admins.map((admin) => ({
            user_id: admin.id,
            title: `💵 Change Bundle Requisition: ৳${totalAmount.toLocaleString('en-BD')}`,
            message: `${managerName} (${branchName}) requested ৳${totalAmount.toLocaleString('en-BD')} in note bundles (${urgency.toUpperCase()}). [req_id:${bundleReq.id}]`,
            type: 'task',
            read: false,
          })),
        })
      }

      // Fire email non-blocking
      const baseUrl = req.nextUrl?.origin || req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://www.anchorfashion.shop'
      sendBundleRequestEmailToAdmins({
        branchName,
        managerName,
        managerEmail: profile.email || null,
        totalAmount,
        urgency: urgency === 'urgent' ? 'urgent' : 'normal',
        reason: reason?.trim() || null,
        bundle10: b10,
        bundle20: b20,
        bundle50: b50,
        bundle100: b100,
        baseUrl,
      }).catch((err) => console.error('[Bundle] Email to admins failed:', err))
    } catch (notifEx) {
      console.warn('[POST /api/branch-accounts/bundle-requests] Notification warning:', notifEx)
    }

    return NextResponse.json({
      success: true,
      request: {
        ...toPlain(bundleReq),
        task_id: createdTaskId,
      },
      message: 'Change bundle requisition submitted successfully!',
    })
  } catch (err: any) {
    console.error('[POST /api/branch-accounts/bundle-requests] Fatal error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
