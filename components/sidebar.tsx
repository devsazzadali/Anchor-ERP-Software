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
import { useLanguage } from '@/lib/i18n/provider';
import type { Dictionary } from '@/lib/i18n/en';

export type AllowedRole = 'admin' | 'super_admin' | 'partner' | 'employee' | 'head_office' | 'branch_manager';

export interface SidebarProps {
  forcedRole: AllowedRole;           // Required — always passed by SidebarWrapper
  mobile?: boolean;
  closeMenu?: () => void;
  onLogout?: () => void;
}

// ── Navigation definitions ─────────────────────────────────────────────────
// i18n: items carry a dictionary KEY (labelKey), never a display
// string — the label is resolved at render from the active
// dictionary (lib/i18n), so a language switch re-renders the whole
// navigation in the new language with no stale captured strings.

type NavLabelKey = keyof Dictionary['nav'];

type NavSubItem = { labelKey: NavLabelKey; href: string; dividerBefore?: boolean };
/** A sub-menu entry is either a plain link or a nested collapsible group. */
type NavSubEntry = NavSubItem | { groupLabelKey: NavLabelKey; items: NavSubItem[] };

const flatSubHrefs = (items: NavSubEntry[]): string[] =>
  items.flatMap((e) => ('items' in e ? e.items.map((i) => i.href) : [e.href]));

interface NavItem {
  labelKey: NavLabelKey;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  divider?: boolean;
  subItems?: NavSubEntry[];
}

const adminNavigation: NavItem[] = [
  { labelKey: 'systemTelemetry',        icon: LayoutDashboard, href: '/admin/dashboard' },

  { labelKey: 'userDirectory',          icon: User,            href: '/admin/users'     },
  { labelKey: 'branchManagement',       icon: MapPin,          href: '/admin/branches'  },
  { labelKey: 'masterSalaryLedger',    icon: Receipt,         href: '/admin/salaries'  },
  { labelKey: 'unifiedFinSummary',     icon: Calculator,      href: '/admin/financial-summary' },
  { labelKey: 'financialReports',       icon: Banknote,        href: '/admin/branch-financial-reports' },
  { labelKey: 'paymentProofs', icon: FileCheck,       href: '/admin/payments' },
  { labelKey: 'branchChalans',          icon: Package,         href: '/admin/branch-chalans' },
  { labelKey: 'kycVerifications',       icon: ShieldAlert,     href: '/admin/kyc'       },
  { labelKey: 'userSettingsPanel',     icon: UserCog,         href: '/admin/user-settings' },
  { labelKey: 'securityAuditLog',      icon: Shield,          href: '/admin/audit'     },
  { labelKey: 'activeSessions',         icon: Laptop,          href: '/admin/sessions'  },
  { labelKey: 'ledgerHeads',            icon: BookMarked,      href: '/admin/branch-expenses' },
  { labelKey: 'expenseRequests',        icon: Receipt,         href: '/admin/expense-requests' },
  { labelKey: 'generalExpenses',        icon: Wallet,          href: '/admin/expenses'  },
  { labelKey: 'taskManagement',         icon: ListTodo,        href: '/admin/tasks'     },
  { labelKey: 'pdfGenerator',           icon: FileOutput,      href: '/admin/pdf-generator' },
  {
    labelKey: 'branchAccounts',
    icon: Building2,
    href: '#',
    divider: true,
    subItems: [
      { labelKey: 'accountsOverview', href: '/admin/branch-accounts' },
      { labelKey: 'depositApprovals', href: '/admin/branch-accounts/deposit-approvals' },
      // F6: duplicate 'Financial Reports' (/admin/branch-financial-reports)
      // removed from this group — it already has a main-list entry above.
      { labelKey: 'changeRequisitions', href: '/admin/bundle-requests' },
      { labelKey: 'reconciliation',   href: '/admin/branch-accounts/reconciliation' },
      { labelKey: 'branchPerformance', href: '/admin/branch-performance' }
    ]
  },
  {
    // Accounts A1: the double-entry books section (admin-only —
    // this navigation only renders for admins). Separate from
    // Branch Accounts, which stays the branch cash-control module.
    labelKey: 'accounts',
    icon: Landmark,
    href: '#',
    divider: true,
    subItems: [
      { labelKey: 'accountsAtAGlance', href: '/admin/accounts' },
      // Accounts A9: the exceptions inbox — blocked postings with
      // a workflow + every derived data signal. The badge shows
      // the live open-item count (fetched below, admin nav only).
      { labelKey: 'needsAttention', href: '/admin/accounts/exceptions' },
      // Payables register; the counterparties list lives inside it as a tab.
      { labelKey: 'toPay', href: '/admin/accounts/payables' },
      // Accounts A4: bank accounts, statement import + reconciliation.
      { labelKey: 'matchWithBank', href: '/admin/accounts/bank' },
      // Accounts A2: the reports hub (books check, P&L, balance sheet).
      { labelKey: 'statements', href: '/admin/accounts/statements' },
      // Accounts A6: the monthly payroll cycle (disburses through
      // the one shared salary path) — set apart from the daily five.
      { labelKey: 'salaryAccounts', href: '/admin/accounts/payroll', dividerBefore: true },
      // Advanced — the accountant's surfaces, collapsed by default:
      // chart, journal, periods (A3), opening, cheques (A8), VAT/TDS
      // (A7, dormant until rates are set), the posting map, and the
      // one-click auditor package (A10).
      {
        groupLabelKey: 'advancedSection',
        items: [
          { labelKey: 'moneyCategories', href: '/admin/accounts/chart' },
          { labelKey: 'allEntries', href: '/admin/accounts/journal' },
          { labelKey: 'monthOpenClose', href: '/admin/accounts/periods' },
          { labelKey: 'startingFigures', href: '/admin/accounts/opening' },
          { labelKey: 'cheques', href: '/admin/accounts/cheques' },
          { labelKey: 'vatTax', href: '/admin/accounts/tax' },
          { labelKey: 'postingMap', href: '/admin/accounts/posting-map' },
          { labelKey: 'auditorReport', href: '/admin/accounts/auditor' },
        ],
      },
    ]
  },
  { labelKey: 'systemSettings',         icon: Settings,        href: '/admin/settings', divider: true },
];

const partnerNavigation: NavItem[] = [
  { labelKey: 'partnerDashboard',  icon: LayoutDashboard, href: '/dashboard'                    },
  { labelKey: 'profileSettings',   icon: User,            href: '/dashboard/settings'            },
  { labelKey: 'expenseRequests',   icon: Wallet,          href: '/dashboard/expense-requests'    },
  // FR-13: the partner expense-issuance workflow (1,819-line page)
  // existed but was unreachable from navigation — linked, not deleted.
  { labelKey: 'branchExpenses',    icon: Receipt,         href: '/dashboard/branch-expenses'      },
  { labelKey: 'branchChalans',     icon: Package,         href: '/dashboard/branch-chalans'      },
  { labelKey: 'branchPerformance', icon: TrendingUp,      href: '/dashboard/branch-performance'  },
  { labelKey: 'salaryLedger',      icon: Receipt,         href: '/dashboard/salaries'            },
  // Dead link removed: '/dashboard/product-chalans' never existed
  // (404 for partners + employees). Chalan work lives under
  // Branch Chalans above.
  { labelKey: 'assignedTasks',     icon: ListTodo,        href: '/dashboard/tasks'               },
];

const employeeNavigation: NavItem[] = [
  { labelKey: 'employeePortal',    icon: LayoutDashboard, href: '/dashboard'                    },
  { labelKey: 'profileSettings',   icon: User,            href: '/dashboard/settings'            },
  { labelKey: 'salaryLedger',      icon: Receipt,         href: '/dashboard/salaries'            },
  { labelKey: 'branchChalans',     icon: Package,         href: '/dashboard/branch-chalans'      },
  { labelKey: 'assignedTasks',     icon: ListTodo,        href: '/dashboard/tasks'               },
];

const headOfficeNavigation: NavItem[] = [
  { labelKey: 'corporatePortal',   icon: LayoutDashboard, href: '/dashboard'                    },
  { labelKey: 'profileSettings',   icon: User,            href: '/dashboard/settings'            },
  { labelKey: 'salaryLedger',      icon: Receipt,         href: '/dashboard/salaries'            },
  { labelKey: 'branchChalans',     icon: Package,         href: '/dashboard/branch-chalans'      },
  { labelKey: 'branchPerformance', icon: TrendingUp,      href: '/dashboard/branch-performance'  },
  { labelKey: 'assignedTasks',     icon: ListTodo,        href: '/dashboard/tasks'               },
];

// ── Branch Manager navigation (Strictly Branch Accounts & Operations) ────────
const branchManagerNavigation: NavItem[] = [
  { labelKey: 'branchDashboard',   icon: LayoutDashboard, href: '/dashboard/branch-accounts' },
  { labelKey: 'myBranchAccounts',  icon: Landmark,        href: '/dashboard/branch-accounts/my-accounts' },
  { labelKey: 'dailyClosing',      icon: Calendar,        href: '/dashboard/branch-accounts/daily-closing' },
  { labelKey: 'cashLedger',        icon: Banknote,        href: '/dashboard/branch-accounts/cash-ledger' },
  { labelKey: 'bankDeposit',       icon: PiggyBank,       href: '/dashboard/branch-accounts/bank-deposit' },
  { labelKey: 'depositHistory',    icon: History,         href: '/dashboard/branch-accounts/deposit-history' },
  { labelKey: 'changeRequisition', icon: Wallet,          href: '/dashboard/branch-accounts/bundle-requests' },
  { labelKey: 'bankStatements',    icon: FileText,        href: '/dashboard/branch-accounts/bank-statement' },
  { labelKey: 'salesSummary',      icon: TrendingUp,      href: '/dashboard/branch-accounts/sales-summary' },
  { labelKey: 'reconciliation',     icon: BarChart3,       href: '/dashboard/branch-accounts/reconciliation' },
  { labelKey: 'monthlyReport',     icon: FileText,        href: '/dashboard/branch-accounts/monthly-report' },
  { labelKey: 'expenseRequests',   icon: Wallet,          href: '/dashboard/expense-requests', divider: true },
  { labelKey: 'profileSettings',   icon: User,            href: '/dashboard/settings' },
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
  const { t } = useLanguage();

  const [userName, setUserName] = useState<string>('');
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({ 'branchAccounts': true });

  const toggleMenu = (name: string) => { setExpandedMenus(prev => ({ ...prev, [name]: !prev[name] })); };

  const renderSubLink = (item: NavSubItem, activeSubHref: string | null, closeMenu?: () => void) => {
    const isSubActive = item.href === activeSubHref;
    return (
      <Link
        key={item.labelKey}
        href={item.href}
        onClick={() => { closeMenu && closeMenu(); }}
        className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs transition-all relative ${
          isSubActive
            ? 'bg-[#e8f7ee] text-[#15803d] font-semibold'
            : 'text-slate-500 hover:text-slate-600 hover:bg-slate-900/[0.04]'
        }`}
      >
        <span className="min-w-0 break-words leading-snug">{t.nav[item.labelKey]}</span>
        {item.href === '/admin/accounts/exceptions' && exceptionsCount > 0 && (
          <span className="ml-auto shrink-0 min-w-5 h-5 px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold inline-flex items-center justify-center">
            {exceptionsCount}
          </span>
        )}
      </Link>
    );
  };
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
  const hasAccountsNav = navigation.some((n) => n.labelKey === 'accounts');
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
            <p className="text-[7.5px] uppercase tracking-[0.25em] text-[#15803d] font-semibold">{t.nav.brandTagline}</p>
          </div>
        </div>

        {/* Role badge */}
        <div className="mb-4 px-1">
          <span className="text-[9px] uppercase tracking-widest text-[#15803d]/70 font-semibold">
            {forcedRole === 'admin' || forcedRole === 'super_admin' ? t.nav.adminPanel :
             forcedRole === 'partner'        ? t.nav.partnerPortal :
             forcedRole === 'branch_manager' ? t.nav.branchManager :
             forcedRole === 'head_office'    ? t.nav.headOfficePortal : t.nav.employeePortalBadge}
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

            const isMenuExpanded = expandedMenus[node.labelKey] || false;
            const Icon = node.icon;
            const label = t.nav[node.labelKey];

            // If the item has subItems, render a collapsible menu
            if (node.subItems) {
              const subItems = node.subItems;
              const activeSubHref = longestActiveHref(pathname, flatSubHrefs(subItems));
              const isChildActive = activeSubHref !== null;

              return (
                <React.Fragment key={node.labelKey}>
                  {node.divider && <div className="my-3 border-t border-slate-900/[0.08]" />}
                  <button
                    onClick={() => toggleMenu(node.labelKey)}
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
                      <span className="min-w-0 break-words leading-snug">{label}</span>
                    </div>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isMenuExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {isMenuExpanded && (
                    <div className="mt-1 mb-2 ml-4 pl-3 border-l border-slate-900/10 space-y-1">
                      {subItems.map(sub => {
                        if ('items' in sub) {
                          const groupKey = `grp-${sub.groupLabelKey}`;
                          const groupActive = sub.items.some((i) => i.href === activeSubHref);
                          const groupOpen = !!expandedMenus[groupKey] || groupActive;
                          return (
                            <React.Fragment key={sub.groupLabelKey}>
                              <button
                                onClick={() => toggleMenu(groupKey)}
                                className={`w-full flex items-center justify-between px-4 py-2 rounded-full text-xs transition-all cursor-pointer ${
                                  groupActive
                                    ? 'text-[#15803d] font-semibold'
                                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-900/[0.04]'
                                }`}
                              >
                                <span className="min-w-0 break-words leading-snug text-left">{t.nav[sub.groupLabelKey]}</span>
                                <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${groupOpen ? 'rotate-180' : ''}`} />
                              </button>
                              {groupOpen && (
                                <div className="ml-3 pl-2 border-l border-slate-900/10 space-y-1">
                                  {sub.items.map((item) => renderSubLink(item, activeSubHref, closeMenu))}
                                </div>
                              )}
                            </React.Fragment>
                          );
                        }
                        return (
                          <React.Fragment key={sub.labelKey}>
                            {sub.dividerBefore && <div className="my-2 border-t border-slate-900/[0.08]" />}
                            {renderSubLink(sub, activeSubHref, closeMenu)}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </React.Fragment>
              );
            }

            return (
              <React.Fragment key={node.labelKey}>
                {/* Divider before section header items */}
                {node.divider && (
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
                  <span className="min-w-0 break-words leading-snug">{label}</span>
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
            <span className="text-[9px] font-bold text-slate-900 uppercase tracking-wider">{t.nav.aiWidgetTitle}</span>
          </div>
          <p className="text-[10px] text-slate-500 font-sans">{t.nav.aiWidgetText}</p>
        </div>

        {/* Profile capsule */}
        <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/[0.04] border border-slate-900/5">
          <div className="w-8 h-8 rounded-lg bg-white border border-slate-900/10 flex items-center justify-center text-xs font-semibold text-[#15803d]">
            {userName ? userName.charAt(0).toUpperCase() : <User className="w-3 h-3" />}
          </div>
          <div className="overflow-hidden">
            <h4 className="text-[11px] font-bold text-slate-900 truncate">{userName || t.nav.loading}</h4>
            <p className="text-[9px] text-slate-500 truncate">{userEmail || ''}</p>
          </div>
        </div>

        {/* Sign Out */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-full text-rose-600 hover:bg-rose-500/10 font-semibold text-xs transition-all cursor-pointer"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>{t.nav.signOut}</span>
        </button>
      </div>
    </div>
  );
}
