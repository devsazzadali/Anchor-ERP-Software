'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';

export interface BranchProfile {
  id: string;
  role: string;
  is_branch_manager: boolean;
  profile_type?: string;
  branch_id?: string | null;
  branch?: string | null;
  full_name?: string | null;
}

// verification reads /api/auth/me (the app session) instead
// of a browser database client. Cache-first behaviour is unchanged.

/**
 * Fast hook for Branch Accounts authentication.
 * Instantly resolves access from cache (0ms) so data fetching can begin immediately on mount.
 */
export function useBranchAuth() {
  const router = useRouter();
  const authContext = useAuth();

  // Read instant cached profile from aura_session or anchor_auth_cache
  const [profile, setProfile] = useState<BranchProfile | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('aura_session');
      if (raw) {
        const parsed = JSON.parse(raw);
        const p = parsed.profile || parsed.user;
        if (p?.role) {
          return {
            id: p.id || parsed.user?.id,
            role: p.role,
            is_branch_manager: p.is_branch_manager === true || p.profile_type === 'branch_manager',
            profile_type: p.profile_type,
            branch_id: p.branch_id || null,
            branch: p.branch || null,
            full_name: p.full_name || parsed.user?.full_name || null,
          };
        }
      }
    } catch {}
    return null;
  });

  const [ready, setReady] = useState<boolean>(() => !!profile);

  const isAdmin = useMemo(() => {
    const r = profile?.role || authContext.role;
    return r === 'admin' || r === 'super_admin';
  }, [profile?.role, authContext.role]);

  const isManager = useMemo(() => {
    return (
      profile?.is_branch_manager === true ||
      profile?.profile_type === 'branch_manager' ||
      authContext.isBranchManager ||
      authContext.profileType === 'branch_manager'
    );
  }, [profile, authContext]);

  const branchId = useMemo(() => {
    return profile?.branch_id || authContext.branchId || null;
  }, [profile?.branch_id, authContext.branchId]);

  const branchName = useMemo(() => {
    return profile?.branch || null;
  }, [profile?.branch]);

  // Background re-verification without blocking initial page render
  useEffect(() => {
    let isMounted = true;
    async function verify() {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          if (isMounted) router.replace('/');
          return;
        }
        const me = await res.json();
        const prof = me.profile;
        const resolvedAdminFlag = me.is_admin === true;

        if (isMounted && prof) {
          const resolvedAdmin = prof.role === 'admin' || prof.role === 'super_admin' || resolvedAdminFlag;
          const resolvedManager = prof.is_branch_manager === true || prof.profile_type === 'branch_manager';

          if (!resolvedAdmin && !resolvedManager) {
            router.replace('/dashboard');
            return;
          }

          const updated: BranchProfile = {
            id: prof.id,
            role: resolvedAdmin && !['admin', 'super_admin'].includes(prof.role) ? 'admin' : prof.role,
            is_branch_manager: resolvedManager,
            profile_type: prof.profile_type,
            branch_id: prof.branch_id || null,
            branch: prof.branch || null,
            full_name: prof.full_name || null,
          };
          setProfile(updated);
          setReady(true);
        }
      } catch (e) {
        console.warn('[useBranchAuth] verify error:', e);
      }
    }
    verify();
    return () => { isMounted = false; };
  }, [router]);

  return {
    profile,
    isAdmin,
    isManager,
    branchId,
    branchName,
    ready: ready || !authContext.loading,
    // Backwards compatibility for existing branch pages
    user: profile,
    isAuthorized: isAdmin || isManager,
    isLoading: !(ready || !authContext.loading)
  };
}
