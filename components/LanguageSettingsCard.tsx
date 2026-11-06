'use client'

// i18n — the per-user Language selector for the profile/settings
// area. Exactly two options (English / বাংলা). The labels and all
// feedback text resolve at render from the active dictionary, so the
// card itself switches language the moment the user picks one.
// Persistence goes through the LanguageProvider (PUT /api/me/language
// → profiles.language), never localStorage — the preference follows
// the user across devices.
import React, { useState } from 'react'
import { Check, Globe, Loader2, ShieldAlert } from 'lucide-react'
import { useLanguage, type Locale } from '@/lib/i18n/provider'

const OPTIONS: { value: Locale; labelKey: 'english' | 'bangla' }[] = [
  { value: 'en', labelKey: 'english' },
  { value: 'bn', labelKey: 'bangla' },
]

export default function LanguageSettingsCard() {
  const { locale, setLocale, t } = useLanguage()
  const [saving, setSaving] = useState(false)
  // Only the outcome is kept in state — the message text itself is
  // resolved at render from the active dictionary (the `t` captured
  // inside pick() would still be the pre-switch locale).
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' } | null>(null)

  const pick = async (next: Locale) => {
    if (next === locale || saving) return
    setSaving(true)
    setFeedback(null)
    const ok = await setLocale(next)
    setSaving(false)
    setFeedback({ type: ok ? 'success' : 'error' })
  }

  return (
    <div className="glass-panel p-6 rounded-2xl relative shadow-xl mb-6">
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#1ca34c]/20 to-transparent" />
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-2">
        <Globe className="w-3.5 h-3.5" /> {t.settings.languageTitle}
      </span>
      <p className="text-xs text-slate-500 mb-5">{t.settings.languageHint}</p>

      <div className="flex flex-wrap items-center gap-3">
        {OPTIONS.map((opt) => {
          const active = locale === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => pick(opt.value)}
              disabled={saving}
              aria-pressed={active}
              className={`px-5 py-2.5 rounded-full text-sm font-semibold border transition-all cursor-pointer disabled:opacity-60 ${
                active
                  ? 'bg-[#1ca34c] border-[#1ca34c] text-white shadow-md'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-[#1ca34c]/50 hover:text-slate-900'
              }`}
            >
              {t.settings[opt.labelKey]}
            </button>
          )
        })}
        {saving && (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t.settings.saving}
          </span>
        )}
      </div>

      {feedback && (
        <div
          className={`mt-4 p-3 rounded-xl text-xs flex gap-2 border ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-600'
          }`}
        >
          {feedback.type === 'success' ? <Check className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
          <span>{feedback.type === 'success' ? t.settings.saved : t.settings.saveFailed}</span>
        </div>
      )}
    </div>
  )
}
