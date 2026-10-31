/**
 * Relation attachment — replaces PostgREST embedded selects
 * (`branch:branches(id, name)`, `closed_by_user:profiles!closed_by(...)`)
 * with explicit batched lookups attached under the SAME keys, so
 * response shapes are byte-identical to the old API. (This is the
 * pattern the Anchor Fashion rounds proved: never trust an embed to
 * attach — fetch explicitly and attach yourself.)
 */
import { prisma } from '@/lib/db'

interface LedgerRowLike {
  branch_id: string
  closed_by?: string | null
  [k: string]: unknown
}

/** Attach `branch: {id, name}` and `closed_by_user: {id, full_name}` to ledger rows. */
export async function attachLedgerRelations<T extends LedgerRowLike>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows
  const branchIds = [...new Set(rows.map((r) => r.branch_id).filter(Boolean))]
  const closerIds = [...new Set(rows.map((r) => r.closed_by).filter(Boolean))] as string[]
  const [branches, closers] = await Promise.all([
    prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }),
    closerIds.length
      ? prisma.profile.findMany({ where: { id: { in: closerIds } }, select: { id: true, full_name: true } })
      : Promise.resolve([] as { id: string; full_name: string | null }[]),
  ])
  const branchMap = new Map(branches.map((b) => [b.id, b]))
  const closerMap = new Map(closers.map((p) => [p.id, p]))
  return rows.map((r) => ({
    ...r,
    branch: branchMap.get(r.branch_id) ?? null,
    closed_by_user: r.closed_by ? closerMap.get(r.closed_by) ?? null : null,
  }))
}

/** Attach `branch: {name}` (or the requested columns) to deposit rows. */
export async function attachDepositBranch<T extends { branch_id: string }>(
  rows: T[]
): Promise<(T & { branch: { name: string } | null })[]> {
  if (rows.length === 0) return rows as (T & { branch: { name: string } | null })[]
  const branchIds = [...new Set(rows.map((r) => r.branch_id).filter(Boolean))]
  const branches = await prisma.branch.findMany({
    where: { id: { in: branchIds } },
    select: { id: true, name: true },
  })
  const map = new Map(branches.map((b) => [b.id, b]))
  return rows.map((r) => ({ ...r, branch: map.get(r.branch_id) ? { name: map.get(r.branch_id)!.name } : null }))
}

/** Attach `ledger_heads: {id, code_number, name, ledger_type}` to expense rows. */
export async function attachExpenseLedgerHead<T extends { ledger_head_id?: string | null }>(
  rows: T[]
): Promise<(T & { ledger_heads: { id: string; code_number: string | null; name: string; ledger_type: string | null } | null })[]> {
  const headIds = [...new Set(rows.map((r) => r.ledger_head_id).filter(Boolean))] as string[]
  const heads = headIds.length
    ? await prisma.ledgerHead.findMany({
        where: { id: { in: headIds } },
        select: { id: true, code_number: true, name: true, ledger_type: true },
      })
    : []
  const map = new Map(heads.map((h) => [h.id, h]))
  return rows.map((r) => ({
    ...r,
    ledger_heads: r.ledger_head_id ? map.get(r.ledger_head_id) ?? null : null,
  }))
}
