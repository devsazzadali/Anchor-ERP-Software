"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

// Sign-out control for the KYC shell screens (role selection and the
// dossier form). Those routes deliberately render no sidebar, so
// without this a signed-in pending user has no way to end their
// session. Behaviour mirrors the sidebar's logout handler
// (components/SidebarWrapper.tsx): clear the local session caches,
// call the server sign-out route to drop the erp_session cookie,
// then return to the login screen.
export default function KycSignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      localStorage.removeItem('aura_session');
      localStorage.removeItem('anchor_auth_cache');
      document.cookie = 'demo_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      document.cookie = 'aura_role=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.error('Sign out error:', e);
    } finally {
      router.push('/');
      router.refresh();
    }
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      className="absolute top-4 right-4 z-20 inline-flex items-center gap-2 rounded-full border border-slate-900/10 bg-white/90 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-600 shadow-sm transition-all hover:border-[#1ca34c]/50 hover:text-[#15803d] active:scale-95 disabled:opacity-60 cursor-pointer"
    >
      <LogOut className="w-3.5 h-3.5" />
      {isSigningOut ? 'Signing Out…' : 'Sign Out'}
    </button>
  );
}
