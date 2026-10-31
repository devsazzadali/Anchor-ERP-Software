import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { toPlain } from '@/lib/server/respond'
import { parseMoneyAmount } from '@/lib/money'

export const dynamic = 'force-dynamic'

// the branch-expense SETTINGS registries
// — house_rent_accounts, utility_meters, developer_payment_methods —
// plus the branch list, in the exact shapes the settings page and
// the issue modals (house rent / utility / developer) read:
// rows carry the PostgREST-style `branches: { name }` embed,
// attached explicitly (lib/server/attach pattern). Admin-gated;
// the old pages wrote these tables straight from the browser.
//
// kind keys: 'house_rent_accounts' | 'utility_meters' |
//            'developer_payment_methods'

const KINDS = ['house_rent_accounts', 'utility_meters', 'developer_payment_methods'] as const
type Kind = (typeof KINDS)[number]

function isKind(v: unknown): v is Kind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v)
}

async function attachBranchName<T extends { branch_id?: string | null }>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.branch_id).filter(Boolean))] as string[]
  const branches = ids.length
    ? await prisma.branch.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : []
  const map = new Map(branches.map((b) => [b.id, b]))
  return rows.map((r) => ({
    ...r,
    branches: r.branch_id ? (map.get(r.branch_id) ? { name: map.get(r.branch_id)!.name } : null) : null,
  }))
}

// GET /api/admin/branch-settings
//   (default)            — branches + ACTIVE rows of all three
//                          registries (the settings page's fetch).
//   ?kind=<kind>         — rows of one registry; house_rent_accounts
//                          returns ALL rows (the house-rent page
//                          shows inactive accounts too).
//   ?branch_id=<uuid>    — with kind: filter rows to that branch
//                          (the issue modals' per-branch fetch).
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const kind = searchParams.get('kind')
    const branchId = searchParams.get('branch_id')

    if (kind) {
      if (!isKind(kind)) return NextResponse.json({ error: 'Unknown kind' }, { status: 400 })
      const where: any = {}
      if (branchId) where.branch_id = branchId
      // The settings page and the issue modals only ever offer
      // ACTIVE rows; the house-rent page lists every account.
      if (kind !== 'house_rent_accounts') where.is_active = true
      else if (branchId) where.is_active = true

      let rows: any[]
      if (kind === 'house_rent_accounts') {
        rows = await prisma.houseRentAccount.findMany({
          where,
          orderBy: branchId ? undefined : [{ created_at: 'desc' }, { id: 'asc' }],
        })
        rows = await attachBranchName(rows as any)
      } else if (kind === 'utility_meters') {
        rows = await prisma.utilityMeter.findMany({ where })
        rows = await attachBranchName(rows as any)
      } else {
        rows = await prisma.developerPaymentMethod.findMany({ where })
      }
      return NextResponse.json({ rows: toPlain(rows) || [] })
    }

    const [branches, rentRaw, meterRaw, devMethods] = await Promise.all([
      prisma.branch.findMany({ select: { id: true, name: true } }),
      prisma.houseRentAccount.findMany({ where: { is_active: true } }),
      prisma.utilityMeter.findMany({ where: { is_active: true } }),
      prisma.developerPaymentMethod.findMany({ where: { is_active: true } }),
    ])
    const [rentAccounts, utilityMeters] = await Promise.all([
      attachBranchName(rentRaw as any),
      attachBranchName(meterRaw as any),
    ])
    return NextResponse.json({
      branches: toPlain(branches) || [],
      house_rent_accounts: toPlain(rentAccounts) || [],
      utility_meters: toPlain(utilityMeters) || [],
      developer_payment_methods: toPlain(devMethods) || [],
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/admin/branch-settings — create one registry row.
// Body: { kind, ...fields } — fields whitelisted per kind, exactly
// the columns the fixed pages inserted.
export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const { kind, ...fields } = body
    if (!isKind(kind)) return NextResponse.json({ error: 'Unknown kind' }, { status: 400 })

    let data: any
    if (kind === 'house_rent_accounts') {
      if (!fields.branch_id || !fields.bank_name || !fields.account_name || !fields.account_number) {
        return NextResponse.json({ error: 'branch_id, bank_name, account_name and account_number are required' }, { status: 400 })
      }
      const payload: any = {
        branch_id: fields.branch_id,
        bank_name: String(fields.bank_name).trim(),
        account_name: String(fields.account_name).trim(),
        account_number: String(fields.account_number).trim(),
        is_active: true,
      }
      if (fields.routing_number && String(fields.routing_number).trim()) {
        payload.routing_number = String(fields.routing_number).trim()
      }
      if (fields.rent_amount !== undefined && fields.rent_amount !== null && fields.rent_amount !== '') {
        const rent = parseMoneyAmount(fields.rent_amount)
        if (rent === null) return NextResponse.json({ error: 'Invalid rent amount.' }, { status: 400 })
        payload.rent_amount = rent
      }
      data = await prisma.houseRentAccount.create({ data: payload })
    } else if (kind === 'utility_meters') {
      if (!fields.branch_id || !fields.meter_number || !fields.meter_type) {
        return NextResponse.json({ error: 'branch_id, meter_number and meter_type are required' }, { status: 400 })
      }
      const payload: any = {
        branch_id: fields.branch_id,
        meter_number: String(fields.meter_number).trim(),
        meter_type: fields.meter_type,
      }
      if (fields.account_number && String(fields.account_number).trim()) {
        payload.account_number = String(fields.account_number).trim()
      }
      data = await prisma.utilityMeter.create({ data: payload })
    } else {
      if (!fields.method_type) {
        return NextResponse.json({ error: 'method_type is required' }, { status: 400 })
      }
      data = await prisma.developerPaymentMethod.create({
        data: { method_type: fields.method_type, details: fields.details ?? {} },
      })
    }
    return NextResponse.json({ row: toPlain(data) }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/admin/branch-settings?kind=<kind>&id=<uuid>
// The settings page's remove action: soft-deactivate only
// (is_active = false), as before — rows are never hard-deleted.
export async function PATCH(req: NextRequest) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!callerIsAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const kind = searchParams.get('kind')
    const id = searchParams.get('id')
    if (!isKind(kind)) return NextResponse.json({ error: 'Unknown kind' }, { status: 400 })
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    if (kind === 'house_rent_accounts') {
      await prisma.houseRentAccount.update({ where: { id }, data: { is_active: false } })
    } else if (kind === 'utility_meters') {
      await prisma.utilityMeter.update({ where: { id }, data: { is_active: false } })
    } else {
      await prisma.developerPaymentMethod.update({ where: { id }, data: { is_active: false } })
    }
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
