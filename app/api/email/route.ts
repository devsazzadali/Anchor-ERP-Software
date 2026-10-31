import { NextResponse } from 'next/server'
import {
  sendLoginNotification,
  sendKycSubmissionToAdmins,
  sendKycApprovalToUser,
  sendTaskAssignmentToUser,
  sendTaskCompletionToAdmins,
  sendPayoutRequestToAdmins,
  sendPayoutCompletedToUser,
  sendBranchChangeToUser,
  sendSalaryPaidToUser,
  sendSalaryUpdatedToUser,
  sendExpenseSubmissionToAdmins,
  sendExpenseStatusUpdateToUser,
  sendValueTransferToUser,
  getAdminEmails,
} from '@/lib/email-service'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin, isPartnerAccount } from '@/lib/server/auth'

// caller via the app session; helper
// lookups (user email by id, admin notifications) via Prisma. The
// A7 rules are unchanged: every action requires an authenticated
// session, admin actions require an admin, actor identity comes
// from the CALLER's profile, never the request body.

// Helper to fetch user email by ID
async function getUserEmailById(userId: string) {
  const authUser = await prisma.authUser.findFirst({
    where: { id: userId },
    select: { email: true },
  })
  return authUser?.email ?? null
}

// Helper to create an in-app notification securely via backend
async function createUserNotification(userId: string | undefined, title: string, message: string, type: string) {
  if (!userId) return
  try {
    await prisma.notification.create({
      data: { user_id: userId, title, message, type, read: false },
    })
    console.log('Successfully created notification for user:', userId, 'Title:', title)
  } catch (error) {
    console.error('Failed to create internal notification for user:', userId, error)
  }
}

// Helper to create an in-app notification securely for all admins via backend.
// FR-1.1 residue: partner accounts (profile_type 'partner' with no
// admin_users row) are excluded via the resolver's shared predicate,
// exactly as getAdminEmails does.
async function createAdminNotification(title: string, message: string, type: string) {
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
  if (!admins || admins.length === 0) return
  const notificationsToInsert = admins.map((a) => ({
    user_id: a.id,
    title: title.trim(),
    message: message.trim(),
    type,
    read: false,
  }))
  try {
    await prisma.notification.createMany({ data: notificationsToInsert })
    console.log('Successfully created notification for admins. Title:', title)
  } catch (error) {
    console.error('Failed to create internal notification for admins:', error)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, payload } = body

    // A7: the former public OTP actions (SEND_REGISTRATION_OTP /
    // SEND_OTP / SEND_2FA_OTP) were an unauthenticated relay that
    // emailed a CALLER-SUPPLIED code to a CALLER-SUPPLIED address,
    // a spoofed-OTP phishing channel, decoupled from the codes the
    // dedicated OTP routes generate and store. Nothing in the app
    // called them (registration/2FA/reset flows use
    // /api/auth/send-registration-otp, /api/auth/send-2fa-otp and
    // /api/auth/request-reset). They are removed: every action on
    // this route now requires an authenticated session, and unknown
    // actions fall through to "Invalid action".
    const caller = await getCallerProfile(request)

    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 })
    }
    const user = caller

    const adminActions = ['KYC_APPROVED', 'TASK_ASSIGNED', 'PAYOUT_COMPLETED', 'BRANCH_CHANGED', 'SALARY_PAID', 'VALUE_TRANSFER_COMPLETED', 'SALARY_UPDATED', 'EXPENSE_STATUS_UPDATED']
    if (adminActions.includes(action)) {
      if (!callerIsAdmin(user)) {
        return NextResponse.json({ error: 'Forbidden: Admin role required' }, { status: 403 })
      }
    }

    // A7: actor identity for user-triggered admin notifications is
    // derived from the CALLER's own profile, never from the request
    // body (payload.userName was spoofable: any user could make an
    // admin notification appear to come from someone else).
    const actorName: string = user.full_name || 'A user'

    let result

    switch (action) {
      case 'LOGIN':
        result = await sendLoginNotification(payload.email, payload.userName, payload.ip, payload.location)
        break

      case 'KYC_SUBMITTED': {
        const adminEmails = await getAdminEmails()
        if (adminEmails.length > 0) {
          result = await sendKycSubmissionToAdmins(adminEmails, actorName)
        } else {
          result = { success: false, error: 'No admin emails found' }
        }
        await createAdminNotification(
          'New KYC Submission',
          actorName + ' has submitted KYC documents for review.' + (payload.reqId ? ' [req_id:' + payload.reqId + ']' : '') + ' [user_id:' + user.id + ']',
          'kyc_request'
        )
        break
      }

      case 'KYC_APPROVED': {
        const email = payload.email || (await getUserEmailById(payload.userId))
        if (email) result = await sendKycApprovalToUser(email, payload.userName)
        await createUserNotification(
          payload.userId,
          'KYC Verification Approved',
          'Your identity verification request has been approved. You now have full access to your profile. [req_id:' + payload.userId + ']',
          'kyc'
        )
        break
      }

      case 'TASK_ASSIGNED': {
        const email = payload.email || (await getUserEmailById(payload.userId))
        if (email) result = await sendTaskAssignmentToUser(email, payload.userName, payload.taskTitle, payload.dueDate, payload.description)
        const reqIdStr = payload.taskId ? ' [req_id:' + payload.taskId + ']' : payload.id ? ' [req_id:' + payload.id + ']' : ''
        await createUserNotification(
          payload.userId,
          'New Task Assigned',
          'You have been assigned a new task: "' + payload.taskTitle + '". Deadline: ' + payload.dueDate + reqIdStr,
          'task'
        )
        break
      }

      case 'TASK_COMPLETED': {
        const adminEmails = await getAdminEmails()
        if (adminEmails.length > 0) {
          result = await sendTaskCompletionToAdmins(adminEmails, payload.userName, payload.taskTitle)
        }
        break
      }

      case 'PAYOUT_REQUESTED': {
        const adminEmails = await getAdminEmails()
        if (adminEmails.length > 0) {
          result = await sendPayoutRequestToAdmins(adminEmails, actorName, payload.amount, payload.currency)
        }
        await createAdminNotification(
          'New Payout Request',
          'A new payout request of ' + (payload.currency || 'BDT') + ' ' + payload.amount + ' has been submitted.' + (payload.reqId ? ' [req_id:' + payload.reqId + ']' : ''),
          'payout'
        )
        break
      }

      case 'PAYOUT_COMPLETED': {
        const email = payload.email || (await getUserEmailById(payload.userId))
        if (email) result = await sendPayoutCompletedToUser(email, payload.userName, payload.amount, payload.currency, payload.transactionId, payload)
        const reqIdStr = payload.payoutId ? ' [req_id:' + payload.payoutId + ']' : payload.id ? ' [req_id:' + payload.id + ']' : ''
        await createUserNotification(
          payload.userId,
          'Payout Request Completed',
          'Your payout request of ' + Number(payload.amount).toLocaleString() + ' ' + (payload.currency || 'BDT') + ' has been successfully processed and transferred to your account.' + reqIdStr,
          'payout'
        )
        break
      }

      case 'BRANCH_CHANGED': {
        const email = payload.email || (await getUserEmailById(payload.userId))
        if (email) result = await sendBranchChangeToUser(email, payload.userName, payload.newBranch)
        await createUserNotification(
          payload.userId,
          'Branch Changed',
          'Your branch has been changed to ' + payload.newBranch + '.',
          'profile'
        )
        break
      }

      case 'SALARY_PAID': {
        const email = payload.email || (await getUserEmailById(payload.userId))
        if (email) result = await sendSalaryPaidToUser(email, payload.userName, payload.month, payload.amount, payload.currency, payload)
        const reqIdStr = payload.transactionId ? ' [req_id:' + payload.transactionId + ']' : ''
        await createUserNotification(
          payload.userId,
          'Salary Disbursed',
          'Your salary of ' + Number(payload.amount).toLocaleString() + ' ' + (payload.currency || 'BDT') + ' for ' + payload.month + ' has been disbursed.' + reqIdStr,
          'transaction'
        )
        break
      }

      case 'VALUE_TRANSFER_COMPLETED': {
        const email = payload.email || (await getUserEmailById(payload.userId))
        if (email) result = await sendValueTransferToUser(email, payload.userName, payload.amount, payload.currency, payload)
        const reqIdStr = payload.transactionId ? ' [req_id:' + payload.transactionId + ']' : ''
        await createUserNotification(
          payload.userId,
          'Value Transfer Received',
          'A value transfer of ' + Number(payload.amount).toLocaleString() + ' ' + (payload.currency || 'BDT') + ' has been credited to your account.' + reqIdStr,
          'transaction'
        )
        break
      }

      case 'SALARY_UPDATED': {
        const email = payload.email || (await getUserEmailById(payload.userId))
        if (email) result = await sendSalaryUpdatedToUser(email, payload.userName, payload.newSalary, payload.currency)
        await createUserNotification(
          payload.userId,
          'Profile Updated',
          'Your profile settings or employment details have been updated by the administration.',
          'profile'
        )
        break
      }

      case 'EXPENSE_SUBMITTED': {
        const adminEmails = await getAdminEmails()
        if (adminEmails.length > 0) {
          result = await sendExpenseSubmissionToAdmins(adminEmails, actorName, payload.branchName, payload.title, payload.amount)
        }
        await createAdminNotification(
          'New Expense Request',
          actorName + ' (' + (payload.branchName || 'Branch') + ') requested ' + payload.amount.toLocaleString() + ' BDT for "' + payload.title + '"' + (payload.branchId ? ' [branch_id:' + payload.branchId + ']' : ''),
          'expense'
        )
        break
      }

      case 'EXPENSE_STATUS_UPDATED': {
        const email = payload.email || (await getUserEmailById(payload.userId))
        if (email) {
          result = await sendExpenseStatusUpdateToUser(email, payload.userName, payload.title, payload.status, payload.amount, payload.adminNotes, payload.trxId)
        }
        const reqIdStr = payload.expenseId ? ' [req_id:' + payload.expenseId + ']' : ''
        await createUserNotification(
          payload.userId,
          'Expense Status Updated',
          'Your expense request "' + payload.title + '" for ' + Number(payload.amount).toLocaleString() + ' BDT has been ' + payload.status + '.' + reqIdStr,
          'expense'
        )
        break
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
