import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCallerProfile } from '@/lib/server/auth'

// i18n — the signed-in user's own UI language preference.
// GET returns the caller's saved language ('en' default, 'bn').
// PUT accepts exactly { language: 'en' | 'bn' } and saves it on the
// caller's own profile row — self-only by construction (the caller
// is resolved from the session; there is no target-user parameter).
const LOCALES = ['en', 'bn'] as const

export async function GET(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await prisma.profile.findUnique({
      where: { id: caller.id },
      select: { language: true },
    })
    const language = profile?.language === 'bn' ? 'bn' : 'en'
    return NextResponse.json({ language })
  } catch (err: any) {
    console.error('[GET /api/me/language] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const caller = await getCallerProfile(req)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const language = body?.language
    if (!LOCALES.includes(language)) {
      return NextResponse.json({ error: 'Invalid language' }, { status: 400 })
    }

    await prisma.profile.update({
      where: { id: caller.id },
      data: { language },
    })
    return NextResponse.json({ language })
  } catch (err: any) {
    console.error('[PUT /api/me/language] Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
