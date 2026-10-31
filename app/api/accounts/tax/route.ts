import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile, callerIsAdmin } from '@/lib/server/auth'
import { logAudit, diffFields } from '@/lib/server/audit'
import {
  listTaxSettings,
  updateTaxSetting,
  listRegisterLines,
  taxPeriodSummaries,
  TaxError,
} from '@/lib/server/accounting/tax'

// /api/accounts/tax — VAT & TDS configuration + register (A7).
// GET: the four tax-type settings (rate / effective-from /
//   enabled / linked accounts — ALL ship disabled with no rate),
//   the chart-account pick list for the config panel, the
//   per-period summaries (net VAT payable, TDS totals) and the
//   register lines (filter ?kind=&period=&limit=).
// POST action (admin-only, S1-audited):
//   {action:'update_setting', tax_type, rate_percent?,
//    effective_from?, is_enabled?, payable_account_id?,
//    offset_account_id?, notes?}
// Rates are entered by the owner/CA — the system never invents a
// rate, and nothing is recorded while a type is disabled.
export const dynamic = 'force-dynamic'

async function gate(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!callerIsAdmin(caller)) {
    return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  }
  return { caller }
}

export async function GET(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const db = prisma as any
    const { searchParams } = new URL(req.url)
    const [settingsPayload, summaries, register] = await Promise.all([
      listTaxSettings(db),
      taxPeriodSummaries(db),
      listRegisterLines(db, {
        kind: searchParams.get('kind') || null,
        period: searchParams.get('period') || null,
        limit: Number(searchParams.get('limit') ?? 200),
      }),
    ])
    return NextResponse.json({ ...settingsPayload, summaries, register })
  } catch (err: any) {
    console.error('[accounts] tax GET failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const g = await gate(req)
    if (g.error) return g.error
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    const db = prisma as any

    if (action === 'update_setting') {
      const taxType = String(body.tax_type ?? '')
      const res = await updateTaxSetting(db, taxType as any, {
        rate_percent: body.rate_percent,
        effective_from: body.effective_from,
        is_enabled: body.is_enabled,
        payable_account_id: body.payable_account_id,
        offset_account_id: body.offset_account_id,
        notes: body.notes,
      })
      await logAudit({
        caller: g.caller,
        req,
        action: 'accounts.tax_setting_updated',
        eventType: 'settings',
        entityTable: 'tax_settings',
        entityId: res.after.id,
        fieldChanges: diffFields(res.before, res.after, [
          'rate_percent',
          'effective_from',
          'is_enabled',
          'payable_account_id',
          'offset_account_id',
          'notes',
        ]),
        newValue: { tax_type: taxType } as any,
      })
      return NextResponse.json({ ok: true, setting: res.after })
    }

    return NextResponse.json({ error: "action must be 'update_setting'" }, { status: 400 })
  } catch (err: any) {
    if (err instanceof TaxError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[accounts] tax POST failed:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
