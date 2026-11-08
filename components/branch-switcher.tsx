'use client'

import React, { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/i18n/provider'

// The shared branch switcher (plan §5.1): same control, same
// behaviour, on every page that can be viewed branch-wise. The
// branch list comes from the caller when it already has one (the
// statements meta, the branch-accounts cache) or is fetched once
// from the branch list endpoint.

export type BranchOption = { id: string; name: string }

export function BranchSwitcher(props: {
  value: string
  onChange: (v: string) => void
  branches?: BranchOption[]
  className?: string
}) {
  const { t } = useLanguage()
  const [fetched, setFetched] = useState<BranchOption[] | null>(null)

  useEffect(() => {
    if (props.branches) return
    let live = true
    fetch('/api/branch-accounts/branches')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && j?.branches) setFetched(j.branches as BranchOption[])
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [props.branches])

  const branches = props.branches ?? fetched ?? []
  return (
    <label className={`inline-flex items-center gap-2 text-sm text-slate-600 ${props.className ?? ''}`}>
      <span className="font-bangla font-semibold">{t.accounts.branchSwitcher.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
      >
        <option value="">{t.accounts.branchSwitcher.allBranches}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  )
}
