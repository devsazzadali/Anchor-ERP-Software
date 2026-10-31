'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Check, Copy, Landmark } from 'lucide-react'

// PaymentAccountCard — the ONE shared "send money here" display for
// every payout surface (salary, house rent, utility, expense
// requests, partner payouts, …). Give it labelled fields; it renders
// one row per field with the value as selectable text and a small
// per-field copy button. A missing/empty value renders "—" and NO
// copy button, so an admin can never copy a placeholder by mistake.
//
// Display + clipboard ONLY: this component never posts, books, or
// mutates anything.
//
// Props:
//   title?: string — header line (default "Payment Account (Send money here)")
//   fields: Array<{ label: string; value?: string | number | null }>

export interface PaymentAccountField {
  label: string
  value?: string | number | null
}

export interface PaymentAccountCardProps {
  title?: string
  fields: PaymentAccountField[]
}

export function isEmptyAccountValue(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'number') return Number.isNaN(value)
  return String(value).trim() === ''
}

// Writes text to the clipboard: the async Clipboard API first, the
// legacy textarea + execCommand('copy') path as fallback (insecure
// contexts / older browsers). Resolves true only when a write
// actually happened, so callers show "Copied" feedback honestly.
export async function writeTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
    throw new Error('Clipboard API unavailable')
  } catch {
    try {
      if (typeof document === 'undefined') return false
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return !!ok
    } catch {
      return false
    }
  }
}

export default function PaymentAccountCard({ title, fields }: PaymentAccountCardProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const handleCopy = async (index: number, value: string | number) => {
    const ok = await writeTextToClipboard(String(value))
    if (!ok) return
    setCopiedIndex(index)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopiedIndex(null), 1500)
  }

  return (
    <div className="bg-[#1ca34c]/10 border border-[#1ca34c]/30 rounded-xl p-3 my-2">
      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-2 flex items-center gap-1.5">
        <Landmark className="w-3.5 h-3.5 text-[#15803d]" />
        {title || 'Payment Account (Send money here)'}
      </p>
      <div className="space-y-1">
        {fields.map((field, i) => {
          const empty = isEmptyAccountValue(field.value)
          const copied = copiedIndex === i
          return (
            <div key={`${field.label}-${i}`} className="flex items-center justify-between gap-3 py-1">
              <span className="text-[11px] text-slate-500 font-medium shrink-0">{field.label}</span>
              {empty ? (
                <span className="text-xs text-slate-400 font-medium">—</span>
              ) : (
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs text-slate-900 font-semibold font-mono select-all truncate">{String(field.value)}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(i, field.value as string | number)}
                    title={`Copy ${field.label}`}
                    className={`shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-bold transition-colors ${copied ? 'text-[#15803d] bg-[#1ca34c]/15' : 'text-slate-500 hover:text-[#15803d] hover:bg-[#1ca34c]/10'}`}
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
