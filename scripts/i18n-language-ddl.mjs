/**
 * i18n — targeted DDL for the per-user language preference.
 *
 * Adds ONLY the additive `language` column to `profiles`
 * ('en' default; 'bn' = Bangla UI). Idempotent (IF NOT EXISTS) so it
 * is safe to re-run. No data changes: existing rows get the default.
 *
 * Run:  node --env-file=.env.local scripts/i18n-language-ddl.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const STATEMENTS = [
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en'`,
]

try {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log('OK:', sql)
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT language, COUNT(*)::int AS n FROM profiles GROUP BY language ORDER BY language`
  )
  console.log('profiles by language:', rows)
} finally {
  await prisma.$disconnect()
}
