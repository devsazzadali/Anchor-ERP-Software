"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  Shield, LayoutDashboard, CreditCard, Receipt,
  FileCheck, LogOut, User, Sparkles, Briefcase,
  ListTodo, MapPin, Settings, ShieldAlert, Wallet, Package, TrendingUp,
  Building2, PiggyBank, Banknote, Calculator, FileText, History, BarChart3, UserCog, ChevronDown, Laptop,
  Calendar, FileOutput, BookMarked, Landmark
} from 'lucide-react';

export type AllowedRole = 'admin' | 'super_admin' | 'partner' | 'employee' | 'head_office' | 'branch_manager';

export interface SidebarProps {
  forcedRole: AllowedRole;           // Required — always passed by SidebarWrapper
  mobile?: boolean;
  closeMenu?: () => void;
  onLogout?: () => void;
}

// ── Navigation definitions ─────────────────────────────────────────────────

const adminNavigation = [
  { name: 'System Telemetry',        icon: LayoutDashboard, href: '/admin/dashboard' },

  { name: 'User Directory',          icon: User,            href: '/admin/users'     },
  { name: 'Branch Management',       icon: MapPin,          href: '/admin/branches'  },
  { name: 'Master Salary Ledger',    icon: Receipt,         href: '/admin/salaries'  },
  { name: 'Unified Fin Summary',     icon: Calculator,      href: '/admin/financial-summary' },
  { name: 'Financial Reports',       icon: Banknote,        href: '/admin/branch-financial-reports' },
  { name: 'Payment Proofs & Payouts',icon: FileCheck,       href: '/admin/payments' },
  { name: 'Branch Chalans',          icon: Package,         href: '/admin/branch-chalans' },
  { name: 'KYC Verifications',       icon: ShieldAlert,     href: '/admin/kyc'       },
  { name: 'User Settings Panel',     icon: UserCog,         href: '/admin/user-settings' },
  { name: 'Security Audit Log',      icon: Shield,          href: '/admin/audit'     },
  { name: 'Active Sessions',         icon: Laptop,          href: '/admin/sessions'  },
  { name: 'Ledger Heads',            icon: BookMarked,      href: '/admin/branch-expenses' },
  { name: 'Expense Requests',        icon: Receipt,         href: '/admin/expense-requests' },
  { name: 'General Expenses',        icon: Wallet,          href: '/admin/expenses'  },
  { name: 'Task Management',         icon: ListTodo,        href: '/admin/tasks'     },
  { name: 'PDF Generator',           icon: FileOutput,      href: '/admin/pdf-generator' },
  {
    name: 'Branch Accounts',
    icon: Building2,
    href: '#',
    divider: true,
    subItems: [
      { name: 'Accounts Overview', href: '/admin/branch-accounts' },
      { name: 'Deposit Approvals', href: '/admin/branch-accounts/deposit-approvals' },
      // F6: duplicate 'Financial Reports' (/admin/branch-financial-reports)
      // removed from this group — it already has a main-list entry above.
      { name: 'Change Requisitions', href: '/admin/bundle-requests' },
      { name: 'Reconciliation',   href: '/admin/branch-accounts/reconciliation' },
      { name: 'Branch Performance', href: '/admin/branch-performance' }
    ]
  },
  {
    // Accounts A1: the double-entry books section (admin-only —
    // this navigation only renders for admins). Separate from
    // Branch Accounts, which stays the branch cash-control module.
    name: 'Accounts',
    icon: Landmark,
    href: '#',
    divider: true,
    subItems: [
      { name: 'Overview', href: '/admin/accounts' },
      // Accounts A9: the exceptions inbox — blocked postings with
      // a workflow + every derived data signal. The badge shows
      // the live open-item count (fetched below, admin nav only).
      { name: 'Exceptions', href: '/admin/accounts/exceptions' },
      { name: 'Chart of Accounts', href: '/admin/accounts/chart' },
      { name: 'Journal', href: '/admin/accounts/journal' },
      { name: 'Opening Position', href: '/admin/accounts/opening' },
      // Accounts A3: period close & lock, FY rollover.
      { name: 'Periods', href: '/admin/accounts/periods' },
      // Accounts A4: bank accounts, statement import + reconciliation.
      { name: 'Bank Reconciliation', href: '/admin/accounts/bank' },
      // Accounts A5: counterparties + payables/receivables register with ageing.
      { name: 'Counterparties', href: '/admin/accounts/parties' },
      { name: 'Payables & Ageing', href: '/admin/accounts/payables' },
      // Accounts A6: the monthly payroll cycle (disburses through
      // the one shared salary path).
      { name: 'Payroll', href: '/admin/accounts/payroll' },
      // Accounts A7: VAT/TDS configuration + register (dormant
      // until the owner/CA enters rates).
      { name: 'VAT & TDS', href: '/admin/accounts/tax' },
      // Accounts A8: cheque register — issued/received lifecycle,
      // clearing posts through the journal; PDC due list.
      { name: 'Cheques', href: '/admin/accounts/cheques' },
      // Accounts A2: statements over the journal.
      { name: 'Statements', href: '/admin/accounts/statements' },
      { name: 'Trial Balance', href: '/admin/accounts/statements/trial-balance' },
      { name: 'Profit & Loss', href: '/admin/accounts/statements/pl' },
      { name: 'Balance Sheet', href: '/admin/accounts/statements/balance-sheet' },
    ]
  },
  { name: 'System Settings',         icon: Settings,        href: '/admin/settings', divider: true },
];

const partnerNavigation = [
  { name: 'Partner Dashboard',  icon: LayoutDashboard, href: '/dashboard'                    },
  { name: 'Profile Settings',   icon: User,            href: '/dashboard/settings'            },
  { name: 'Expense Requests',   icon: Wallet,          href: '/dashboard/expense-requests'    },
  // FR-13: the partner expense-issuance workflow (1,819-line page)
  // existed but was unreachable from navigation — linked, not deleted.
  { name: 'Branch Expenses',    icon: Receipt,         href: '/dashboard/branch-expenses'      },
  { name: 'Branch Chalans',     icon: Package,         href: '/dashboard/branch-chalans'      },
  { name: 'Branch Performance', icon: TrendingUp,      href: '/dashboard/branch-performance'  },
  { name: 'Salary Ledger',      icon: Receipt,         href: '/dashboard/salaries'            },
  // Dead link removed: '/dashboard/product-chalans' never existed
  // (404 for partners + employees). Chalan work lives under
  // Branch Chalans above.
  { name: 'Assigned Tasks',     icon: ListTodo,        href: '/dashboard/tasks'               },
];

const employeeNavigation = [
  { name: 'Employee Portal',    icon: LayoutDashboard, href: '/dashboard'                    },
  { name: 'Profile Settings',   icon: User,            href: '/dashboard/settings'            },
  { name: 'Salary Ledger',      icon: Receipt,         href: '/dashboard/salaries'            },
  { name: 'Branch Chalans',     icon: Package,         href: '/dashboard/branch-chalans'      },
  { name: 'Assigned Tasks',     icon: ListTodo,        href: '/dashboard/tasks'               },
];

const headOfficeNavigation = [
  { name: 'Corporate Portal',   icon: LayoutDashboard, href: '/dashboard'                    },
  { name: 'Profile Settings',   icon: User,            href: '/dashboard/settings'            },
  { name: 'Salary Ledger',      icon: Receipt,         href: '/dashboard/salaries'            },
  { name: 'Branch Chalans',     icon: Package,         href: '/dashboard/branch-chalans'      },
  { name: 'Branch Performance', icon: TrendingUp,      href: '/dashboard/branch-performance'  },
  { name: 'Assigned Tasks',     icon: ListTodo,        href: '/dashboard/tasks'               },
];

// ── Branch Manager navigation (Strictly Branch Accounts & Operations) ────────
const branchManagerNavigation = [
  { name: 'Branch Dashboard',   icon: LayoutDashboard, href: '/dashboard/branch-accounts' },
  { name: 'Daily Closing',      icon: Calendar,        href: '/dashboard/branch-accounts/daily-closing' },
  { name: 'Cash Ledger',        icon: Banknote,        href: '/dashboard/branch-accounts/cash-ledger' },
  { name: 'Bank Deposit',       icon: PiggyBank,       href: '/dashboard/branch-accounts/bank-deposit' },
  { name: 'Deposit History',    icon: History,         href: '/dashboard/branch-accounts/deposit-history' },
  { name: 'Change Requisition', icon: Wallet,          href: '/dashboard/branch-accounts/bundle-requests' },
  { name: 'Bank Statements',    icon: FileText,        href: '/dashboard/branch-accounts/bank-statement' },
  { name: 'Sales Summary',      icon: TrendingUp,      href: '/dashboard/branch-accounts/sales-summary' },
  { name: 'Reconciliation',     icon: BarChart3,       href: '/dashboard/branch-accounts/reconciliation' },
  { name: 'Monthly Report',     icon: FileText,        href: '/dashboard/branch-accounts/monthly-report' },
  { name: 'Expense Requests',   icon: Wallet,          href: '/dashboard/expense-requests', divider: true },
  { name: 'Profile Settings',   icon: User,            href: '/dashboard/settings' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * F6 FIX: Segment-boundary active matching. An item is active only
 * when the pathname is exactly its href or a sub-route of it
 * (href + '/') — never on a mere string prefix, so sibling routes
 * like '/admin/expenses' and '/admin/expense-requests' can never
 * bleed into each other.
 */
function isPathActive(pathname: string | null, href: string): boolean {
  if (!pathname || !href || href === '#') return false;
  return pathname === href || pathname.startsWith(href + '/');
}

/**
 * Among hrefs that match segment-wise, only the LONGEST (most
 * specific) one is active — e.g. on '/admin/branch-accounts/deposit-approvals'
 * the Deposit Approvals item wins over Accounts Overview, and on
 * '/dashboard/settings' Profile Settings wins over '/dashboard'.
 * This guarantees exactly one highlighted item per list.
 */
function longestActiveHref(pathname: string | null, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (isPathActive(pathname, href) && (!best || href.length > best.length)) {
      best = href;
    }
  }
  return best;
}

function getNavigation(role: AllowedRole) {
  if (role === 'admin' || role === 'super_admin') return adminNavigation;
  if (role === 'partner')        return partnerNavigation;
  if (role === 'branch_manager') return branchManagerNavigation;
  if (role === 'employee')       return employeeNavigation;
  if (role === 'head_office')    return headOfficeNavigation;
  return [];
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Sidebar({ forcedRole, mobile, closeMenu, onLogout }: SidebarProps) {
  const router   = useRouter();
  const pathname = usePathname();

  const [userName, setUserName] = useState<string>('');
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({ 'Branch Accounts': true, 'Branch Management': true });

  const toggleMenu = (name: string) => { setExpandedMenus(prev => ({ ...prev, [name]: !prev[name] })); };
  const [userEmail, setUserEmail] = useState<string>('');

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        // identity via /api/auth/me — email + full_name in one call.
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data?.user) {
          setUserEmail(data.user.email ?? '');
          if (data.profile) {
            setUserName(data.profile.full_name ?? '');
          }
        }
      } catch (e) {
        console.error('Profile fetch error:', e);
      }
    };
    fetchProfile();
  }, []);

  const handleLogout = () => {
    if (onLogout) {
      onLogout();
    } else {
      localStorage.removeItem('aura_session');
      document.cookie = 'demo_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      document.cookie = 'aura_role=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/')).catch(console.error);
    }
  };

  const navigation = getNavigation(forcedRole);

  // Accounts A9: live open-item count for the Exceptions badge.
  // Only fetched when the Accounts section is in this nav (admin
  // roles); the API is admin-gated, and any failure just leaves
  // the badge hidden.
  const [exceptionsCount, setExceptionsCount] = useState<number>(0);
  const hasAccountsNav = navigation.some((n) => n.name === 'Accounts');
  useEffect(() => {
    if (!hasAccountsNav) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/accounts/exceptions?count=1');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data?.counts?.total_active === 'number') {
          setExceptionsCount(data.counts.total_active);
        }
      } catch { /* badge is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [hasAccountsNav, pathname]);
  // F6: the single active top-level item for this pathname (longest match)
  const activeTopHref = longestActiveHref(pathname, navigation.map((n) => n.href));

  return (
    <div
      className={
        mobile
          ? 'flex flex-col justify-between h-full p-6 relative overflow-y-auto'
          : 'hidden md:flex md:flex-col md:justify-between md:w-72 md:h-screen md:p-6 md:glass-sidebar md:border-r md:border-slate-900/5 md:sticky md:top-0 md:z-20 md:shrink-0 overflow-y-auto custom-scrollbar'
      }
    >
      {/* Decorative top accent */}
      <div className="absolute top-0 left-5 right-5 h-[1px] bg-gradient-to-r from-transparent via-[#1ca34c]/30 to-transparent" />

      {/* ── Top section ─────────────────────────────────────── */}
      <div>
        {/* Brand */}
        <div className="flex items-center gap-2 mb-8 mt-2 px-1">
          <img src="/logos.png" alt="Anchor ERP Official Logo" className="w-12 h-12 object-contain drop-shadow-md shrink-0" />
          <div>
            <h1 className="text-sm font-extrabold tracking-wider text-slate-900 font-serif">ANCHOR ERP</h1>
            <p className="text-[7.5px] uppercase tracking-[0.25em] text-[#15803d] font-semibold">Enterprise Resource Planning</p>
          </div>
        </div>

        {/* Role badge */}
        <div className="mb-4 px-1">
          <span className="text-[9px] uppercase tracking-widest text-[#15803d]/70 font-semibold">
            {forcedRole === 'admin' || forcedRole === 'super_admin' ? 'Admin Panel' :
             forcedRole === 'partner'        ? 'Partner Portal' :
             forcedRole === 'branch_manager' ? 'Branch Manager' :
             forcedRole === 'head_office'    ? 'Head Office Portal' : 'Employee Portal'}
          </span>
        </div>

        {/* Navigation */}
        <div className="space-y-1">
          {navigation.map((node) => {
            // BUG-026 + F6: segment-boundary matching (see isPathActive)
            // so sub-routes like /admin/dashboard/password-requests stay
            // active, and longest-match-wins so exactly one item is
            // highlighted — this also subsumes the old '/dashboard'
            // exact-match special case (a longer sibling always wins).
            const isActive = node.href !== '#' && node.href === activeTopHref;

            const isMenuExpanded = expandedMenus[node.name] || false;
            const Icon = node.icon;

            // If the item has subItems, render a collapsible menu
            if ((node as any).subItems) {
              const subItems = (node as any).subItems as { name: string, href: string }[];
              const activeSubHref = longestActiveHref(pathname, subItems.map((s) => s.href));
              const isChildActive = activeSubHref !== null;

              return (
                <React.Fragment key={node.name}>
                  {(node as any).divider && <div className="my-3 border-t border-slate-900/[0.08]" />}
                  <button
                    onClick={() => toggleMenu(node.name)}
                    className={`w-full flex items-center justify-between px-4 py-2.5 rounded-full text-xs font-medium transition-all group relative cursor-pointer ${
                      isChildActive
                        ? 'text-[#15803d] bg-[#e8f7ee]'
                        : isMenuExpanded
                          ? 'text-slate-900 bg-slate-900/[0.04]'
                          : 'text-slate-500 hover:text-slate-700 hover:bg-slate-900/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 transition-transform ${isChildActive ? 'text-[#1ca34c]' : 'text-slate-500 group-hover:text-slate-900'}`} />
                      <span className="min-w-0 break-words leading-snug">{node.name}</span>
                    </div>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isMenuExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {isMenuExpanded && (
                    <div className="mt-1 mb-2 ml-4 pl-3 border-l border-slate-900/10 space-y-1">
                      {subItems.map(sub => {
                        const isSubActive = sub.href === activeSubHref;
                        return (
                          <Link
                            key={sub.name}
                            href={sub.href}
                            onClick={() => { closeMenu && closeMenu(); }}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs transition-all relative ${
                              isSubActive
                                ? 'bg-[#e8f7ee] text-[#15803d] font-semibold'
                                : 'text-slate-500 hover:text-slate-600 hover:bg-slate-900/[0.04]'
                            }`}
                          >
                            <span className="min-w-0 break-words leading-snug">{sub.name}</span>
                            {sub.href === '/admin/accounts/exceptions' && exceptionsCount > 0 && (
                              <span className="ml-auto shrink-0 min-w-5 h-5 px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold inline-flex items-center justify-center">
                                {exceptionsCount}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </React.Fragment>
              );
            }

            return (
              <React.Fragment key={node.name}>
                {/* Divider before section header items */}
                {(node as any).divider && (
                  <div className="my-3 border-t border-slate-900/[0.08]" />
                )}
                <Link
                  href={node.href}
                  onClick={() => { closeMenu && closeMenu(); }}
                  className={`flex items-center gap-3.5 px-4 py-2.5 rounded-full text-xs font-medium transition-all group relative cursor-pointer ${
                    isActive
                      ? 'bg-[#e8f7ee] text-[#15803d] font-semibold'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-900/[0.04]'
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-[#1ca34c]" />
                  )}
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${
                      isActive ? 'text-[#1ca34c]' : 'text-slate-500 group-hover:text-[#15803d]'
                    }`}
                  />
                  <span className="min-w-0 break-words leading-snug">{node.name}</span>
                </Link>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────── */}
      <div className="space-y-4 mt-auto pt-6">
        {/* AI widget */}
        <div className="p-3.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 relative overflow-hidden group">
          <div className="absolute -top-10 -right-10 w-20 h-20 bg-[#1ca34c]/5 rounded-full filter blur-xl group-hover:bg-[#1ca34c]/10 transition-all" />
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-3.5 h-3.5 text-[#15803d]" />
            <span className="text-[9px] font-bold text-slate-900 uppercase tracking-wider">Anchor ERP AI Fraud Risk</span>
          </div>
          <p className="text-[10px] text-slate-500 font-sans">Verification node secure. Zero structural anomalies detected.</p>
        </div>

        {/* Profile capsule */}
        <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
          <div className="w-8 h-8 rounded-lg bg-white border border-slate-900/10 flex items-center justify-center text-xs font-semibold text-[#15803d]">
            {userName ? userName.charAt(0).toUpperCase() : <User className="w-3 h-3" />}
          </div>
          <div className="overflow-hidden">
            <h4 className="text-[11px] font-bold text-slate-900 truncate">{userName || 'Loading…'}</h4>
            <p className="text-[9px] text-slate-500 truncate">{userEmail || ''}</p>
          </div>
        </div>

        {/* Sign Out */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-full text-rose-600 hover:bg-rose-500/10 font-semibold text-xs transition-all cursor-pointer"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
}
