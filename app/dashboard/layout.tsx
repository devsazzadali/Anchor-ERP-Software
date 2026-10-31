'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, LogOut } from 'lucide-react';
import { NotificationDropdown } from '@/components/NotificationDropdown';

// identity via /api/auth/me, sign-out via /api/auth/logout.

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isBanned, setIsBanned] = useState(false);
  const [role, setRole] = useState<string>('');

  // Check ban status and auth
  useEffect(() => {
    const checkBanStatus = async () => {
      try {
        const res = await fetch('/api/auth/me');
        // BUG-B2 FIX: Redirect to login if no session found (middleware bypass defense)
        if (!res.ok) {
          router.replace('/');
          return;
        }
        const me = await res.json();
        const data = me.profile;
        if (data?.is_banned) setIsBanned(true);
        if (data?.role) setRole(data.role);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    checkBanStatus();
  }, []);

  // KYC check is now handled securely by the server middleware

  // Redirects are now handled by middleware

  const handleLogout = async () => {
    try {
      localStorage.removeItem('aura_session');
      localStorage.removeItem('anchor_auth_cache'); // BUG-022 FIX: clear auth cache on logout
      document.cookie = 'demo_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      document.cookie = 'aura_role=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      document.cookie = '2fa_verified=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.error(e);
    } finally {
      router.push('/');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center pt-16">
        <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin mb-4" />
        <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Verifying Access...</span>
      </div>
    );
  }

  if (isBanned) {
    return (
      <div className="min-h-screen bg-white text-slate-900 font-sans flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-[-10%] right-[-5%] w-[50%] h-[50%] bg-rose-500/5 rounded-full filter blur-[150px] pointer-events-none" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[50%] h-[50%] bg-rose-500/5 rounded-full filter blur-[150px] pointer-events-none" />
        <div className="max-w-md w-full glass-panel p-8 rounded-3xl text-center shadow-2xl border border-rose-500/20 relative overflow-hidden z-10 bg-white">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-rose-500 to-transparent" />
          <div className="w-20 h-20 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-6 border border-rose-500/20 shadow-[0_0_30px_rgba(244,63,94,0.15)]">
            <ShieldAlert className="w-10 h-10 text-rose-500" />
          </div>
          <h1 className="text-3xl font-serif text-slate-900 mb-3 tracking-wide">Account Suspended</h1>
          <p className="text-slate-500 text-sm leading-relaxed mb-8">
            Your access to the ANCHOR ERP system has been completely restricted by executive administration due to policy violations or security concerns.
          </p>
          <button
            onClick={handleLogout}
            className="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 border border-rose-500/30 py-4 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-rose-500/5"
          >
            <LogOut className="w-4 h-4" /> Terminate Session
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="relative min-h-screen pt-16 md:pt-0">
      {/* Top right utility bar for non-admin users */}
      <div className="absolute top-4 right-4 flex items-center gap-4 z-50">
        <NotificationDropdown />
      </div>
      {children}
    </div>
  );
}
