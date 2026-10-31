import { NextRequest, NextResponse } from 'next/server'
import { sendBundleStatusEmailToManager } from '@/lib/email-service'
import { prisma } from '@/lib/db'
import { getCallerProfile, isAdminRole } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// caller via the single role-resolution
// function; service-role reads/writes become server-side Prisma.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const profile = await getCallerProfile(req)

    if (!profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const request = await prisma.branchBundleRequest.findFirst({ where: { id } })

    if (!request) {
      return NextResponse.json({ error: 'Requisition not found' }, { status: 404 })
    }

    const isAdmin = isAdminRole(profile.role)
    if (!isAdmin && request.manager_id !== profile.uid && request.branch_id !== profile.branch_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json({ request: toPlain(request) })
  } catch (err: any) {
    console.error('[GET /api/branch-accounts/bundle-requests/[id]] Fatal error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const profile = await getCallerProfile(req)

    if (!profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isAdmin = isAdminRole(profile.role)

    // Fetch existing requisition
    const existing = await prisma.branchBundleRequest.findFirst({ where: { id } })

    if (!existing) {
      return NextResponse.json({ error: 'Requisition not found' }, { status: 404 })
    }

    const body = await req.json()
    const { status, admin_notes } = body

    const validStatuses = ['requested', 'processing', 'completed', 'rejected']
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, { status: 400 })
    }

    // Branch managers can only cancel their own request if it's still 'requested'
    if (!isAdmin) {
      if (existing.manager_id !== profile.uid && existing.branch_id !== profile.branch_id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (status !== 'rejected') {
        return NextResponse.json({ error: 'Only admins can approve or process requisitions' }, { status: 403 })
      }
    }

    const now = new Date()
    const updatePayload: Record<string, any> = {
      updated_at: now,
    }

    if (status) {
      updatePayload.status = status
      if (status === 'processing') {
        updatePayload.processed_by = profile.uid
        updatePayload.processed_by_name = profile.full_name || 'Admin'
        updatePayload.processed_at = now
      } else if (status === 'completed') {
        updatePayload.completed_at = now
        if (!existing.processed_by) {
          updatePayload.processed_by = profile.uid
          updatePayload.processed_by_name = profile.full_name || 'Admin'
          updatePayload.processed_at = now
        }
      }
    }

    if (admin_notes !== undefined) {
      updatePayload.admin_notes = admin_notes?.trim() || null
    }

    let updated: any
    try {
      updated = await prisma.branchBundleRequest.update({ where: { id }, data: updatePayload })
    } catch (updateErr: any) {
      console.error('[PATCH /api/branch-accounts/bundle-requests/[id]] Update error:', updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    // 1. Sync corresponding task in `tasks` table
    if (existing.task_id && status) {
      try {
        let taskStatus = 'pending'
        if (status === 'processing') taskStatus = 'in_progress'
        if (status === 'completed') taskStatus = 'completed'
        if (status === 'rejected') taskStatus = 'cancelled'

        await prisma.task.update({
          where: { id: existing.task_id },
          data: {
            status: taskStatus,
            note: admin_notes ? `Bundle Requisition ${status}: ${admin_notes}` : `Bundle Requisition updated to ${status}`,
          },
        })
      } catch (taskEx) {
        console.warn('[PATCH /api/branch-accounts/bundle-requests/[id]] Task sync warning:', taskEx)
      }
    }

    // 2. Notify requesting branch manager of status transition (in-app + email)
    if (existing.manager_id && status && status !== existing.status) {
      try {
        const statusLabels: Record<string, string> = {
          processing: '🟡 Change Bundles In-Transit / Processing',
          completed: '✅ Change Bundles Ready / Completed',
          rejected: '❌ Change Bundle Request Declined',
        }

        const title = statusLabels[status] || `Change Bundle Requisition: ${status}`
        const amountFmt = `৳${Number(existing.total_amount).toLocaleString('en-BD')}`
        const message = `Your change bundle request of ${amountFmt} has been marked as ${status.toUpperCase()} by Head Office.${admin_notes ? ` Note: "${admin_notes}"` : ''}`

        // In-app notification
        await prisma.notification.create({
          data: {
            user_id: existing.manager_id,
            title,
            message,
            type: 'task',
            read: false,
          },
        })

        // Email to manager (non-blocking) — fetch manager email first
        if (['processing', 'completed', 'rejected'].includes(status)) {
          const mgr = await prisma.profile.findFirst({
            where: { id: existing.manager_id },
            select: { email: true, full_name: true },
          })

          if (mgr?.email) {
            const baseUrl = req.nextUrl?.origin || req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://www.anchorfashion.shop'
            sendBundleStatusEmailToManager({
              managerEmail: mgr.email,
              managerName: existing.manager_name || mgr.full_name || 'Branch Manager',
              branchName: existing.branch_name || 'Branch',
              totalAmount: Number(existing.total_amount),
              status: status as 'processing' | 'completed' | 'rejected',
              adminNotes: admin_notes || null,
              adminName: profile.full_name || 'Admin',
              baseUrl,
            }).catch((err) => console.error('[Bundle] Email to manager failed:', err))
          }
        }
      } catch (notifEx) {
        console.warn('[PATCH /api/branch-accounts/bundle-requests/[id]] Notification warning:', notifEx)
      }
    }

    return NextResponse.json({
      success: true,
      request: toPlain(updated),
      message: `Bundle requisition updated to ${status}`,
    })
  } catch (err: any) {
    console.error('[PATCH /api/branch-accounts/bundle-requests/[id]] Fatal error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
