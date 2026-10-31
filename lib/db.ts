/**
 * Prisma client — the app's ONLY database handle.
 *
 * Architecture: all database access is
 * server-side Prisma. The browser never talks to the database; there
 * is no service-role key, no anon key, and no RLS — authorisation is
 * enforced in server code (lib/server/auth.ts + the route handlers).
 *
 * The schema (prisma/schema.prisma) is plain Postgres and therefore
 * Neon-portable: DATABASE_URL is the only connection input.
 */
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
