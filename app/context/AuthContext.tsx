"use client";
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';

// identity comes from /api/auth/me (the app session), not
// from a browser database client. State shape, the localStorage
// cache contract ('anchor_auth_cache') and the refresh() API are
// unchanged, so every consumer keeps working as-is.

interface AuthState {
  role: string;
  profileType: string;
  verificationStatus: string;
  isAuthenticated: boolean;
  /** True when the user is assigned as a branch manager */
  isBranchManager: boolean;
  /** UUID of the branch this manager is assigned to (null otherwise) */
  branchId: string | null;
}

interface AuthContextProps extends AuthState {
  loading: boolean;
  refresh: () => Promise<void>;
}

const AUTH_CACHE_KEY = 'anchor_auth_cache';

const AuthContext = createContext<AuthContextProps>({
  role: '',
  profileType: '',
  verificationStatus: '',
  isAuthenticated: false,
  isBranchManager: false,
  branchId: null,
  loading: true,
  refresh: async () => {},
});

/**
 * Read cached auth state from localStorage.
 * Returns immediately on page refresh so sidebar doesn't flash.
 */
function getCachedAuth(): AuthState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.role === 'string') return parsed;
  } catch { /* ignore */ }
  return null;
}

function setCachedAuth(state: AuthState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

function clearCachedAuth() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_CACHE_KEY);
  } catch { /* ignore */ }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // Initialise from cache so sidebar renders instantly on refresh
  const cached = getCachedAuth();

  const [role, setRole] = useState<string>(cached?.role ?? '');
  const [profileType, setProfileType] = useState<string>(cached?.profileType ?? '');
  const [verificationStatus, setVerificationStatus] = useState<string>(cached?.verificationStatus ?? '');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(cached?.isAuthenticated ?? false);
  const [isBranchManager, setIsBranchManager] = useState<boolean>((cached as any)?.isBranchManager ?? false);
  const [branchId, setBranchId] = useState<string | null>((cached as any)?.branchId ?? null);
  // If we have cached state, skip loading so sidebar appears immediately
  const [loading, setLoading] = useState<boolean>(!cached);

  /**
   * Fetch the session profile from /api/auth/me — single source of truth.
   */
  const loadProfile = async () => {
    try {
      // The app's /api/auth/me server-verifies the session cookie
      // (the BUG-R03 rule — never trust a client-side token read).
      const res = await fetch('/api/auth/me');

      if (!res.ok) {
        setRole('');
        setProfileType('');
        setVerificationStatus('');
        setIsAuthenticated(false);
        clearCachedAuth();
        return;
      }

      const { profile: data } = await res.json();

      if (!data) {
        console.error('Error loading profile: no profile for session user');
        // Do NOT clear the role here. If there's a temporary network error
        // fetching the profile, we keep the cached state so the sidebar doesn't vanish.
        return;
      }

      const newState: AuthState = {
        role: data.role ?? '',
        profileType: data.profile_type ?? '',
        verificationStatus: data.verification_status ?? '',
        isAuthenticated: true,
        isBranchManager: data.is_branch_manager ?? false,
        branchId: data.branch_id ?? null,
      };

      setRole(newState.role);
      setProfileType(newState.profileType);
      setVerificationStatus(newState.verificationStatus);
      setIsAuthenticated(newState.isAuthenticated);
      setIsBranchManager(newState.isBranchManager);
      setBranchId(newState.branchId);
      setCachedAuth(newState);
    } catch (e) {
      console.error('Unexpected error in loadProfile:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Always fetch fresh profile (will update cache)
    loadProfile();

    // The app has no client auth library emitting state changes;
    // sign-in writes the cache on the login page before navigating,
    // and sign-out clears it (see the sidebar logout handler). A
    // cross-tab storage event keeps other tabs in sync.
    const onStorage = (e: StorageEvent) => {
      if (e.key === AUTH_CACHE_KEY) {
        if (!e.newValue) {
          setRole('');
          setProfileType('');
          setVerificationStatus('');
          setIsAuthenticated(false);
          setIsBranchManager(false);
          setBranchId(null);
          setLoading(false);
        } else {
          loadProfile();
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    await loadProfile();
  };

  return (
    <AuthContext.Provider value={{ role, profileType, verificationStatus, isAuthenticated, isBranchManager, branchId, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
