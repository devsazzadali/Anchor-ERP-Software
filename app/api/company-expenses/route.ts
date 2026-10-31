import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'

// the dashboard company-expenses ledger
// (dashboard/expenses page) — every approved caller reads the full
// company outlays list + branch reference list, exactly the rows
// the page rendered under RLS. The localStorage DATA fallback
// (aura_company_expenses, audit A9/C41) is gone: the API is the
// only source.
export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [expenses, branches] = await Promise.all([
      prisma.companyExpense.findMany({ orderBy: { created_at: 'desc' } }),
      prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])

    return NextResponse.json({ expenses: toPlain(expenses), branches: toPlain(branches) })
  } catch (err: any) {
    console.error('[GET /api/company-expenses] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
