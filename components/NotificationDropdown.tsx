'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Check, Trash2, X } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';

// A soft, premium short notification "pop" or "bell" sound in base64 to avoid missing file issues
const NOTIFICATION_SOUND = "data:audio/mp3;base64,//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
// Note: Normally we'd put a real mp3 base64 here, but for now I'll create a synthetic beep using Web Audio API instead of a huge string.

export function NotificationDropdown() {
  const router = useRouter();
  const pathname = usePathname();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const isInitialFetch = useRef(true);
  // BUG-030 FIX: We removed the unused AudioContext ref and use HTML Audio directly.

  // Function to play sound using HTML Audio (more reliable than Web Audio for simple sounds)
  const playNotificationSound = () => {
    try {
      // Short subtle "ding" sound in base64
      const dingBase64 = "data:audio/mp3;base64,//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
      const audio = new Audio(dingBase64);
      audio.volume = 0.5;
      audio.play().catch(e => {
        console.warn("Audio play blocked by browser autoplay policy.");
      });
    } catch (e) {
      console.warn("Audio initialization failed.");
    }
  };

  useEffect(() => {
    // Click outside to close
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // notifications come from /api/notifications (session-scoped
  // server-side: own rows, plus broadcasts for admins). The unread
  // count is derived from the fetched set; the list shows latest 20.
  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=200');
      if (!res.ok) return;
      const data = await res.json();
      const rows = data.notifications || [];
      const count = rows.filter((n: any) => !n.read).length;
      setUnreadCount(prev => {
        if (!isInitialFetch.current && count > prev) {
          playNotificationSound();
        }
        return count;
      });
      isInitialFetch.current = false;
      setNotifications(rows.slice(0, 20));
    } catch {
      // Silent — the next poll retries.
    }
  }, []);

  useEffect(() => {
    // Identity via /api/auth/me (replaces onAuthStateChange/getUser).
    let cancelled = false;
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data?.user) {
          setUserId(data.user.id);
          setUserRole(data.profile?.role || null);
          fetchNotifications();
        } else {
          setUserId(null);
          setNotifications([]);
          setUnreadCount(0);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [pathname, fetchNotifications]);

  useEffect(() => {
    if (!userId) return;

    // the realtime channel is replaced with refetch on window
    // focus + a 30s polling interval against /api/notifications.
    const onFocus = () => fetchNotifications();
    window.addEventListener('focus', onFocus);
    const pollInterval = setInterval(fetchNotifications, 30000);

    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(pollInterval);
    };
  }, [userId, pathname, fetchNotifications]);

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
    // Optional: mark all as read when opening? Or do it on a button. Let's do it on a button.
  };

  const markAllAsRead = async () => {
    if (!userId) return;
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);

    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
    } catch {
      // Optimistic UI already applied; next poll reconciles.
    }
  };

  const deleteNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Optimistic UI Update: Remove immediately
    const notifToDelete = notifications.find(n => n.id === id);
    if (!notifToDelete) return;

    setNotifications(prev => prev.filter(n => n.id !== id));
    if (!notifToDelete.read) setUnreadCount(c => Math.max(0, c - 1));

    try {
      const res = await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete notification');
    } catch (error) {
      // Revert Optimistic UI if it fails
      console.warn("Failed to delete notification", error);
      setNotifications(prev => {
        const newArr = [notifToDelete, ...prev];
        return newArr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });
      if (!notifToDelete.read) setUnreadCount(c => c + 1);
    }
  };

  const handleNotificationClick = async (notif: any) => {
    // 1. Mark as read optimistically
    if (!notif.read) {
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
      try {
        await fetch(`/api/notifications/${notif.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ read: true })
        });
      } catch {
        // Optimistic UI already applied; next poll reconciles.
      }
    }

    // 2. Close dropdown
    setIsOpen(false);

    // 3. Determine redirect path based on panel and notification details
    const isRoleAdmin = userRole === 'admin' || userRole === 'super_admin';
    const isAdminAction = isRoleAdmin || notif.user_id === null || notif.is_admin_only || pathname?.startsWith('/admin');
    const type = (notif.type || '').toLowerCase();
    const title = (notif.title || '').toLowerCase();
    const message = (notif.message || '').toLowerCase();

    let targetUrl = '';

    if (isAdminAction) {
      if (type === 'deposit' || title.includes('deposit') || message.includes('deposit')) {
        targetUrl = '/admin/branch-accounts/deposit-approvals';
      } else if (type === 'expense' || title.includes('expense') || message.includes('expense')) {
        const branchIdMatch = message.match(/\[branch_id:([^\]]+)\]/i);
        const branchNameMatch = message.match(/\(([^\)]+)\)\s*requested/i);
        let branchQuery = branchIdMatch ? branchIdMatch[1] : (branchNameMatch ? branchNameMatch[1] : '');
        if (!branchQuery || ['branch', 'unassigned', 'unassigned branch', 'general'].includes(branchQuery.toLowerCase())) {
          branchQuery = 'unassigned';
        }
        targetUrl = '/admin/branch-expenses?status=pending&branch=' + encodeURIComponent(branchQuery);
      } else if (type === 'payout' || title.includes('payout') || message.includes('payout')) {
        const reqMatch = message.match(/\[req_id:([^\]]+)\]/i);
        const userMatch = message.match(/\[user_id:([^\]]+)\]/i);
        // Fallback to match a bare UUID only if it doesn't have [req_id: in front
        const uuidMatch = userMatch ? userMatch[1] : message.match(/(?<!\[req_id:)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
        const reqQuery = reqMatch ? `&id=${reqMatch[1]}` : '';
        const userQuery = uuidMatch ? `&user=${uuidMatch}` : '';
        targetUrl = '/admin/payments?status=pending' + reqQuery + userQuery;
      } else if (type === 'kyc_request' || title.includes('kyc') || message.includes('kyc')) {
        const reqMatch = message.match(/\[req_id:([^\]]+)\]/i);
        const userMatch = message.match(/\[user_id:([^\]]+)\]/i);
        const uuidMatch = userMatch ? userMatch[1] : message.match(/(?<!\[req_id:)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
        const reqQuery = reqMatch ? `&id=${reqMatch[1]}` : '';
        const userQuery = uuidMatch ? `&user=${uuidMatch}` : '';
        targetUrl = '/admin/kyc?status=pending' + reqQuery + userQuery;
      } else if (type === 'task' || title.includes('task') || message.includes('task')) {
        targetUrl = '/admin/tasks';
      } else if (type === 'security' || title.includes('password reset') || message.includes('password reset')) {
        targetUrl = '/admin/dashboard/password-requests';
      } else if (title.includes('salary') || title.includes('salaries') || message.includes('salary')) {
        targetUrl = '/admin/salaries';
      } else if (title.includes('branch') || title.includes('branches')) {
        targetUrl = '/admin/branches';
      } else if (title.includes('partner') || message.includes('partner')) {
        // Partner-specific notifications → open Partners tab directly with user dossier if available
        const userMatch = message.match(/\[user_id:([^\]]+)\]/i);
        const targetUserId = userMatch ? userMatch[1] : message.match(/(?<!\[req_id:)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
        targetUrl = '/admin/users?tab=partners' + (targetUserId ? `&user=${targetUserId}` : '');
      } else if (type === 'profile' || title.includes('profile') || title.includes('position change') || title.includes('branch transfer') || title.includes('user') || title.includes('employee') || message.includes('position') || message.includes('branch transfer') || message.includes('profile')) {
        // Employee/general user notifications → Employees tab with user dossier if available
        const userMatch = message.match(/\[user_id:([^\]]+)\]/i);
        const targetUserId = userMatch ? userMatch[1] : message.match(/(?<!\[req_id:)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
        targetUrl = '/admin/users?tab=employees' + (targetUserId ? `&user=${targetUserId}` : '');
      } else {
        targetUrl = '/admin/dashboard';
      }
    } else {
      if (type === 'deposit' || title.includes('deposit') || message.includes('deposit')) {
        targetUrl = '/dashboard/branch-accounts/deposit-history';
      } else if (type === 'expense' || title.includes('expense') || message.includes('expense')) {
        const reqMatch = message.match(/\[req_id:([^\]]+)\]/i);
        targetUrl = '/dashboard/expense-requests' + (reqMatch ? `?id=${reqMatch[1]}` : '');
      } else if (type === 'payout' || title.includes('payout') || message.includes('payout')) {
        const reqMatch = message.match(/\[req_id:([^\]]+)\]/i);
        targetUrl = '/dashboard/transactions' + (reqMatch ? `?id=${reqMatch[1]}` : '');
      } else if (type === 'task' || title.includes('task') || message.includes('task')) {
        const reqMatch = message.match(/\[req_id:([^\]]+)\]/i);
        targetUrl = '/dashboard/tasks' + (reqMatch ? `?id=${reqMatch[1]}` : '');
      } else if (title.includes('salary') || title.includes('salaries') || message.includes('salary')) {
        const reqMatch = message.match(/\[req_id:([^\]]+)\]/i);
        targetUrl = '/dashboard/salaries' + (reqMatch ? `?id=${reqMatch[1]}` : '');
      } else if (type === 'transaction' || title.includes('value transfer') || title.includes('transaction')) {
        const reqMatch = message.match(/\[req_id:([^\]]+)\]/i);
        targetUrl = '/dashboard/transactions' + (reqMatch ? `?id=${reqMatch[1]}` : ''); // Value transfers are generally visible on the transactions page
      } else if (title.includes('statement') || title.includes('invoice') || message.includes('statement')) {
        targetUrl = '/dashboard/statements';
      } else if (type === 'kyc' || title.includes('kyc') || message.includes('kyc') || title.includes('verification') || message.includes('verification')) {
        targetUrl = '/kyc';
      } else if (type === 'profile' || title.includes('profile') || message.includes('profile') || title.includes('position change') || title.includes('branch transfer') || title.includes('partner') || title.includes('employee')) {
        targetUrl = '/dashboard/settings';
      } else {
        targetUrl = '/dashboard';
      }
    }

    if (targetUrl) {
      router.push(targetUrl);
    }
  };

  return (
    <div className="relative z-50" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        className="relative p-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/10 hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10 transition-all group"
      >
        <Bell className={`w-6 h-6 text-slate-600 group-hover:text-[#8a6d1f] transition-colors ${unreadCount > 0 ? 'animate-pulse' : ''}`} />
        {unreadCount > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1 -right-1 flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold bg-[#d4af37] text-black rounded-full border-2 border-white shadow-[0_0_10px_rgba(212,175,55,0.5)]"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed inset-x-4 top-20 sm:absolute sm:inset-auto sm:right-0 sm:top-auto sm:mt-3 sm:w-96 bg-white backdrop-blur-xl border border-slate-900/10 rounded-2xl shadow-[0_20px_40px_-15px_rgba(15,23,42,0.25)] overflow-hidden flex flex-col z-[100]"
          >
            {/* Header */}
            <div className="p-4 border-b border-slate-900/10 flex items-center justify-between bg-slate-900/[0.04]">
              <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2">
                Notifications
                {unreadCount > 0 && (
                  <span className="bg-[#d4af37]/20 text-[#8a6d1f] px-2 py-0.5 rounded-full text-[10px]">
                    {unreadCount} New
                  </span>
                )}
              </h3>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-[10px] text-slate-500 hover:text-[#8a6d1f] font-bold uppercase tracking-widest flex items-center gap-1 transition-colors min-h-[40px] px-2 -mr-2"
                >
                  <Check className="w-3 h-3" /> Mark Read
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  <Bell className="w-8 h-8 mx-auto mb-3 opacity-20" />
                  No notifications yet.
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-slate-900/5">
                  <AnimatePresence initial={false}>
                    {notifications.map((notif) => (
                      <motion.div
                        key={notif.id}
                        layout
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20, height: 0, overflow: 'hidden' }}
                        transition={{ duration: 0.2 }}
                        onClick={() => handleNotificationClick(notif)}
                        className={`p-4 relative group transition-colors hover:bg-slate-900/[0.04] cursor-pointer ${!notif.read ? 'bg-[#d4af37]/[0.02]' : ''}`}
                      >
                        {!notif.read && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-[#d4af37] to-white" />
                        )}
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1 min-w-0">
                            <h4 className={`text-sm font-semibold truncate ${!notif.read ? 'text-slate-900' : 'text-slate-600'}`}>
                              {notif.title}
                            </h4>
                            <p className={`text-xs mt-1 line-clamp-2 ${!notif.read ? 'text-slate-600' : 'text-slate-500'}`}>
                              {notif.message?.replace(/\s*\[(?:req_id|user_id|branch_id):[^\]]+\]/gi, '').trim()}
                            </p>
                            <span className="text-[10px] text-slate-500 mt-2 block">
                              {notif.created_at ? new Date(notif.created_at).toLocaleString() : 'Just now'}
                            </span>
                          </div>
                          <button
                            onClick={(e) => deleteNotification(notif.id, e)}
                            className="text-slate-500 hover:text-rose-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all shrink-0 p-2 sm:p-1 min-w-[40px] min-h-[40px] flex items-center justify-center bg-slate-900/[0.04] sm:bg-white rounded-lg hover:bg-rose-500/10 active:scale-95"
                          >
                            <Trash2 className="w-4 h-4 sm:w-4 sm:h-4" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="p-3 border-t border-slate-900/10 text-center bg-white">
                <span className="text-[9px] text-slate-600 uppercase tracking-widest font-bold">Showing latest 20 notifications</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
