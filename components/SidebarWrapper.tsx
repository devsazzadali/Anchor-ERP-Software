"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../app/context/AuthContext';
import SidebarClient from './SidebarClient';
import DesktopSidebar from './DesktopSidebar';

// Routes where the sidebar must NEVER appear (public / auth pages)
const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/register',
  '/signup',
  '/forgot-password',
  '/kyc',          // KYC submission page — no sidebar until approved
  '/kyc/pending',  // BUG-034 FIX: pending sub-route also needs no sidebar
  '/verify-2fa',
];

// BUG-034 FIX: Helper to check if current path is public (handles both exact and prefix matches)
function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) =>
    pathname === route ||
    pathname?.startsWith(route + '/') ||
    pathname?.startsWith(route + '?')
  );
}


export default function SidebarWrapper() {
  const { role, profileType, verificationStatus, loading, refresh, isBranchManager } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
    if (role || profileType) setIsLoggingOut(false);
  }, [role, profileType]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      localStorage.removeItem('aura_session');
      localStorage.removeItem('anchor_auth_cache'); // BUG-036 FIX: clear auth cache on logout
      document.cookie = 'demo_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      document.cookie = 'aura_role=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      // sign-out is the server session route (clears erp_session).
      await fetch('/api/auth/logout', { method: 'POST' });
      await refresh();
    } catch (e) {
      console.error('Logout error:', e);
    } finally {
      router.push('/');
      router.refresh();
    }
  };

  // ── Guards ────────────────────────────────────────────────────────────────

  // 1. Not mounted yet — show nothing
  if (!hasMounted) return null;

  // 2. Public / auth routes — never show sidebar
  if (pathname && isPublicRoute(pathname)) {
    return null;
  }

  // ✅ 3. ADMIN BYPASS - Check this BEFORE loading check
  // Admins don't need verification, show sidebar even if loading
  if (role === 'admin' || role === 'super_admin') {
    return (
      <>
        <SidebarClient onLogout={handleLogout} forcedRole={role as 'admin' | 'super_admin'} />
        <div className="hidden md:flex md:flex-col md:w-64 md:shrink-0">
          <DesktopSidebar onLogout={handleLogout} forcedRole={role as 'admin' | 'super_admin'} />
        </div>
      </>
    );
  }

  // 4. For non-admin users: check loading state
  if (loading || isLoggingOut) return null;

  // 5. Determine effective role for non-admin users
  const isPartner       = role === 'partner'      || profileType === 'partner';
  const isEmployee      = role === 'employee'     || profileType === 'employee';
  const isHeadOffice    = role === 'head_office'  || profileType === 'head_office';
  const isBranchMgr     = isBranchManager        || profileType === 'branch_manager';
  const isApproved      = verificationStatus === 'approved';

  let effectiveRole: 'admin' | 'super_admin' | 'partner' | 'employee' | 'head_office' | 'branch_manager' | null = null;

  if (isBranchMgr) {
    // Branch managers don't need verificationStatus — they are employees flagged by admin
    effectiveRole = 'branch_manager';
  } else if (isPartner    && isApproved) {
    effectiveRole = 'partner';
  } else if (isHeadOffice && isApproved) {
    effectiveRole = 'head_office';
  } else if (isEmployee   && isApproved) {
    effectiveRole = 'employee';
  }

  // 6. No valid role resolved → hide sidebar
  if (!effectiveRole) return null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <SidebarClient onLogout={handleLogout} forcedRole={effectiveRole} />
      <div className="hidden md:flex md:flex-col md:w-64 md:shrink-0">
        <DesktopSidebar onLogout={handleLogout} forcedRole={effectiveRole} />
      </div>
    </>
  );
}
