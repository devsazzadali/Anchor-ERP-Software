'use client'

// i18n — LanguageProvider + useLanguage().
//
// The provider holds ONLY the active locale in state. Every string
// is resolved AT RENDER from the dictionary for that locale
// (`const { t } = useLanguage()` then `t.nav.…` inline in JSX) —
// dictionary strings are never copied into useState initializers or
// module-level constants, so switching the locale re-renders the
// whole app in the new language immediately, with no stale strings.
//
// Source of truth: the signed-in user's saved preference on their
// profile (profiles.language, exposed by /api/auth/me). Until that
// loads — and for signed-out visitors — the locale is English, the
// default. Switching writes through PUT /api/me/language first,
// then flips local state so the UI follows only what was saved.
import React, { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { en, type Dictionary, type Locale } from './en'
import { dictionaryFor, fill } from './dictionaries'

export type { Locale, Dictionary }
export { dictionaryFor, fill }

interface LanguageContextValue {
  locale: Locale
  /** The active dictionary — read strings from this at render. */
  t: Dictionary
  /** Persist + apply a new locale for the signed-in user. */
  setLocale: (next: Locale) => Promise<boolean>
  /** True once the saved preference has been loaded (or known absent). */
  ready: boolean
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: 'en',
  t: en,
  setLocale: async () => false,
  ready: false,
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en')
  const [ready, setReady] = useState(false)
  const pathname = usePathname()
  // True once a preference load has succeeded for a signed-in session.
  // The provider mounts on the (public) login page too, where
  // /api/auth/me is a 401 — and sign-in is an in-tab SPA transition
  // (no reload, and 'storage' events never fire in the tab that wrote
  // the cache), so without the route-change retry below the saved
  // language would never apply until a manual browser refresh. This
  // mirrors AuthContext's own route-change revalidation pattern.
  const authedLoadedRef = useRef(false)

  // Load the signed-in user's saved preference. Re-runs whenever the
  // auth cache changes (sign-in in another tab / after login refresh)
  // via the same storage signal AuthContext uses.
  const loadPreference = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (!res.ok) {
        authedLoadedRef.current = false
        setLocaleState('en')
        return
      }
      authedLoadedRef.current = true
      const data = await res.json().catch(() => null)
      const saved = data?.profile?.language
      setLocaleState(saved === 'bn' ? 'bn' : 'en')
    } catch {
      /* keep current locale on transient errors */
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    loadPreference()
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'anchor_auth_cache') {
        if (!e.newValue) {
          // Signed out in another tab — forget the loaded preference.
          authedLoadedRef.current = false
          setLocaleState('en')
        } else {
          loadPreference()
        }
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [loadPreference])

  // Route changed into an authed area before any successful load
  // (the normal post-login path) — fetch the preference now. Landing
  // back on the login page means signed out: forget the loaded flag
  // so the next sign-in (possibly a different user) loads afresh.
  useEffect(() => {
    if (pathname === '/') {
      authedLoadedRef.current = false
    } else if (pathname && !authedLoadedRef.current) {
      loadPreference()
    }
  }, [pathname, loadPreference])

  const setLocale = useCallback(async (next: Locale): Promise<boolean> => {
    try {
      const res = await fetch('/api/me/language', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: next }),
      })
      if (!res.ok) return false
    } catch {
      return false
    }
    setLocaleState(next)
    return true
  }, [])

  return (
    <LanguageContext.Provider value={{ locale, t: dictionaryFor(locale), setLocale, ready }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext)
}
