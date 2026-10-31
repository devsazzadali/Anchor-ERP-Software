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
   *  user-writable profile_type). */
  is_admin: boolean
  branch_id: string | null
  branch: string | null
  full_name: string | null
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

  // A4: ban + approval state are enforced here, for every route.
  if ((profile as { is_banned?: boolean | null }).is_banned === true) return null
  const verificationStatus = (profile as { verification_status?: string | null }).verification_status
  if (!isAdminRole(profile.role) && verificationStatus && verificationStatus !== 'approved') {
    return null
  }

  const adminRow = await prisma.adminUser
    .findFirst({ where: { id: userId }, select: { id: true } })
    .catch(() => null)
  const isAdmin = isAdminRole(profile.role) || !!adminRow

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
    branch_id: branchId,
    branch: (profile as { branch?: string | null }).branch ?? null,
    full_name: profile.full_name ?? null,
  }
}

/**
 * Branch scoping for repositories/handlers:
 * admins see every branch; everyone else only their resolved branch.
 * Returns the branch filter to apply, or null when the caller has no
 * branch and is not an admin (routes answer 400/403 as before).
 */
export function callerBranchScope(
  caller: CallerProfile,
  requestedBranchId?: string | null
): { branchId: string | null; error: string | null } {
  if (isAdminRole(caller.role)) {
    return { branchId: requestedBranchId ?? null, error: null }
  }
  if (!caller.branch_id) return { branchId: null, error: 'No branch assigned' }
  return { branchId: caller.branch_id, error: null }
}
