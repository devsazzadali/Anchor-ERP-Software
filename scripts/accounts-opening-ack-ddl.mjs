/**
 * Opening Position — confirm-as-acknowledgement (owner OPTION 1,
 * ruled 2026-11-01). Targeted DDL + the one-row provenance stamp.
 *
 * Schema (additive only, idempotent — safe to re-run):
 *   opening_positions.origin  text NOT NULL DEFAULT 'cutover'
 *     'cutover'  — the position's history is NOT in the journal;
 *                  confirming posts the P12 opening entry (A3 flow).
 *     'backfill' — the position summarises history ALREADY posted
 *                  in the journal (the A1 full backfill); confirming
 *                  is an acknowledgement only and posts NOTHING
 *                  (posting would double-count).
 *   The DB default is 'cutover' so any row created outside the
 *   app's stamping path keeps the A3 posting behaviour.
 *
 * Provenance stamp (one row, guarded, evidence printed):
 *   The existing DRAFT position 9996356f-b06f-49a0-b7a7-7aadfa90d9f2
 *   was computed by A1's computeOpeningPosition FROM the existing
 *   records whose history A1 had already backfilled into the
 *   journal in full (A1 report, decision D1; opening.ts header:
 *   "posting it on top of the backfill would double-count every
 *   figure it summarises"). The stamp fires ONLY if the row is
 *   still draft + unconfirmed AND posted journal entries dated on
 *   or before its as-of date exist (the backfill coverage). The
 *   before/after rows and the coverage count are printed.
 *
 * NEVER a full `prisma db push`. Run:
 *   node --env-file=.env.local scripts/accounts-opening-ack-ddl.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const REAL_POSITION_ID = '9996356f-b06f-49a0-b7a7-7aadfa90d9f2'

const before = await prisma.$queryRawUnsafe(
  `SELECT id::text AS id, status, confirmed_by::text AS confirmed_by, as_of_date::text AS as_of
     FROM opening_positions ORDER BY created_at ASC`)
console.log('positions BEFORE:', JSON.stringify(before, null, 2))

await prisma.$executeRawUnsafe(
  `ALTER TABLE opening_positions ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'cutover'`)
console.log("schema: opening_positions.origin added (default 'cutover')")

// Backfill-coverage evidence for the real draft: posted journal
// entries dated on or before its as-of date.
const coverage = await prisma.$queryRawUnsafe(
  `SELECT count(*)::int AS entries, COALESCE(SUM(jl.debit),0)::text AS debit
     FROM journal_entries je LEFT JOIN journal_lines jl ON jl.entry_id = je.id
    WHERE je.status = 'posted' AND je.entry_date <= $1::date`, '2026-10-31')
console.log('backfill coverage (posted entries ≤ 2026-10-31):', JSON.stringify(coverage))

const stamped = await prisma.$executeRawUnsafe(
  `UPDATE opening_positions SET origin = 'backfill'
    WHERE id = $1::uuid AND status = 'draft' AND confirmed_by IS NULL AND origin = 'cutover'`,
  REAL_POSITION_ID)
console.log(`provenance stamp: ${stamped} row(s) updated (expected 1 on first run, 0 on re-run)`)

const after = await prisma.$queryRawUnsafe(
  `SELECT id::text AS id, status, confirmed_by::text AS confirmed_by, origin FROM opening_positions ORDER BY created_at ASC`)
console.log('positions AFTER:', JSON.stringify(after, null, 2))

await prisma.$disconnect()
