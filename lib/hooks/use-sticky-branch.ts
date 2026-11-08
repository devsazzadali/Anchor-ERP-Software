'use client'

import { useCallback, useEffect, useState } from 'react'

// Accounts Simplification (plan §5.1) — ONE branch selection for the
// whole ERP: whichever page picks a branch, every other page that
// honours the switch opens on the same branch. The value lives in
// localStorage (survives navigation) and is mirrored into the page
// URL as ?branch= (survives refresh and can be shared). '' means
// "all branches (company)". Head Office is an ordinary branch row,
// so it needs no special case anywhere.

const KEY = 'erp.stickyBranch.v1'
export const STICKY_BRANCH_EVENT = 'erp:sticky-branch'

export function readStickyBranch(): string {
  if (typeof window === 'undefined') return ''
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('branch')
    if (fromUrl) return fromUrl
    return window.localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

/** Storage + event only — for pages that manage their own URL
 * (e.g. branch-chalans, whose ?branch= IS the selection). */
export function persistStickyBranch(v: string) {
  if (typeof window === 'undefined') return
  try {
    if (v) window.localStorage.setItem(KEY, v)
    else window.localStorage.removeItem(KEY)
    window.dispatchEvent(new CustomEvent(STICKY_BRANCH_EVENT, { detail: v }))
  } catch {
    /* storage unavailable — the in-memory state still applies */
  }
}

export function writeStickyBranch(v: string) {
  if (typeof window === 'undefined') return
  persistStickyBranch(v)
  try {
    const url = new URL(window.location.href)
    if (v) url.searchParams.set('branch', v)
    else url.searchParams.delete('branch')
    window.history.replaceState(null, '', url.toString())
  } catch {
    /* storage unavailable — the in-memory state still applies */
  }
}

export function useStickyBranch(): [string, (v: string) => void] {
  const [value, setValue] = useState<string>('')
  useEffect(() => {
    setValue(readStickyBranch())
    const on = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setValue(typeof detail === 'string' ? detail : readStickyBranch())
    }
    window.addEventListener(STICKY_BRANCH_EVENT, on)
    return () => window.removeEventListener(STICKY_BRANCH_EVENT, on)
  }, [])
  const set = useCallback((v: string) => {
    setValue(v)
    writeStickyBranch(v)
  }, [])
  return [value, set]
}
