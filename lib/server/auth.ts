/**
 * THE role-resolution function.
 *
 * On the old stack, role facts were split across `profiles.role`,
 * `profile_type`, `is_branch_manager`, `branch_id` and
 * `branch_manager_assignments`, and every route re-implemented its
 * own (divergent) resolution on top of RLS. The app resolves the
 * caller ONCE, here, and every route consumes this result:
 *
 *  - the session cookie (lib/server/session.ts) identifies the user;
 *  - profiles + the active branch_manager_assignments row supply the
 *    role facts (including the live quirks: branch managers carry
 *    role='employee' + profile_type='branch_manager');
 *  - Part A enforcement lives here: A4 — a banned user
 *    (is_banned) or a non-approved user (verification_status not
 *    'approved', for non-admin roles) resolves to NO caller, on
 *    every route, not just the ones that remembered to check.
 *
 * A1 note: profile self-update in the app is a server action with a
 * column whitelist (see the profile actions); role-bearing columns
 * (role, profile_type, is_branch_manager, branch_id) are never
 * client-writable — the job the old prevent_profile_privilege_escalation
 * trigger only half did.
 */
import { prisma } from '@/lib/db'
import { sessionTokenFromRequest, verifySessionToken } from './session'

export interface CallerProfile {
  id: string
  uid: string
  email: string | null
  role: string | null
  profile_type: string | null
  is_branch_manager: boolean
  /** role is admin/super_admin OR the user is an admin_users member
   *  (the deposits helper's A1 rule: admin status comes ONLY from the
   *  role column or admin_users membership — never from the
   *  user-writable profile_type) — EXCEPT partner accounts (FR-1.1):
   *  a partner-type profile with NO admin_users row is never admin,
   *  whatever the role column says. */
  is_admin: boolean
  /** FR-1.1: true when this caller is a partner account
   *  (profile_type === 'partner' with no admin_users row). Partner
   *  accounts use the partner surfaces, never the admin ones. */
  is_partner: boolean
  branch_id: string | null
  branch: string | null
  full_name: string | null
}

/**
 * FR-1.1 — the partner-account test, shared by the resolver,
 * /api/auth/me and getAdminEmails() (lib/email-service.ts expresses
 * the same rule in its Prisma filter): a profile is a partner
 * ACCOUNT when its profile_type is 'partner' AND it holds no
 * admin_users row. admin_users membership is the deliberate
 * carve-out: a partner-type profile the owner has explicitly made
 * an admin_users member stays admin.
 */
export function isPartnerAccount(
  profileType: string | null | undefined,
  hasAdminRow: boolean
): boolean {
  return profileType === 'partner' && !hasAdminRow
}

/** Admin test used by converted routes (role column or admin_users). */
export function callerIsAdmin(caller: CallerProfile): boolean {
  return caller.is_admin
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin'
}

/** Resolve the signed-in user's id from the session cookie, or null. */
export async function getSessionUserId(req: { headers: Headers }): Promise<string | null> {
  return verifySessionToken(sessionTokenFromRequest(req))
}

/**
 * The full caller resolution used by every converted route.
 * Returns null when there is no valid session, no profile, or the
 * account is banned / not approved (A4) — routes answer 401.
 */
export async function getCallerProfile(req: { headers: Headers }): Promise<CallerProfile | null> {
  const userId = await getSessionUserId(req)
  if (!userId) return null

  const profile = await prisma.profile.findUnique({ where: { id: userId } })
  if (!profile) return null

  const adminRow = await prisma.adminUser
    .findFirst({ where: { id: userId }, select: { id: true } })
    .catch(() => null)

  // FR-1.1: the partner boundary is computed BEFORE the approval
  // gate so the gate uses the FINAL admin determination. A partner
  // account (partner type, no admin_users row) is never admin, even
  // when its role column says 'admin'.
  const isPartner = isPartnerAccount(profile.profile_type, !!adminRow)
  const isAdmin = !isPartner && (isAdminRole(profile.role) || !!adminRow)

  // A4: ban + approval state are enforced here, for every route.
  if ((profile as { is_banned?: boolean | null }).is_banned === true) return null
  const verificationStatus = (profile as { verification_status?: string | null }).verification_status
  // FR-1.7: non-admin callers resolve ONLY on an exact 'approved'
  // status — a NULL/missing legacy status no longer slips through.
  if (!isAdmin && verificationStatus !== 'approved') {
    return null
  }

  let branchId = profile.branch_id ?? null
  let isManager =
    profile.is_branch_manager === true || profile.profile_type === 'branch_manager'

  // Same fallback as the old routes: an active assignment supplies a
  // missing branch_id / manager flag.
  if (!branchId || !isManager) {
    const assignment = await prisma.branchManagerAssignment.findFirst({
      where: { employee_id: userId, is_active: true },
      select: { branch_id: true },
    })
    if (assignment?.branch_id) {
      branchId = assignment.branch_id
      isManager = true
    }
  }

  return {
    id: profile.id,
    uid: userId,
    email: profile.email ?? null,
    role: profile.role ?? null,
    profile_type: profile.profile_type ?? null,
    is_branch_manager: isManager,
    is_admin: isAdmin,
    is_partner: isPartner,
    branch_id: branchId,
    branch: (profile as { branch?: string | null }).branch ?? null,
    full_name: profile.full_name ?? null,
  }
}

