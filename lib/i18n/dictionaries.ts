// i18n — pure dictionary access (no React, server-safe).
//
// Client code usually goes through LanguageProvider/useLanguage in
// ./provider; server code (email templates, API routes) imports
// dictionaryFor from here directly.
import { en, type Dictionary, type Locale } from './en'
import { bn } from './bn'

export type { Locale, Dictionary }

const DICTIONARIES: Record<Locale, Dictionary> = { en, bn }

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? en
}

/** Fill `{name}` placeholders in a dictionary string. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`))
}
