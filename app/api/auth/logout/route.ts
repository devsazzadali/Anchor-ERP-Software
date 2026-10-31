import { NextResponse } from 'next/server'
import { clearSessionCookieHeader, clearCookieHeader } from '@/lib/server/session'

// POST /api/auth/logout — clears the app session (and any 2FA
// verification cookie, mirroring the old sign-out behaviour).
export async function POST() {
  const res = NextResponse.json({ success: true })
  res.headers.append('Set-Cookie', clearSessionCookieHeader())
  res.headers.append('Set-Cookie', clearCookieHeader('2fa_verified'))
  return res
}
