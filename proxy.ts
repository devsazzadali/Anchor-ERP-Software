import { NextResponse, type NextRequest } from 'next/server'
import { verifyTwoFactorToken } from '@/lib/two-factor-cookie'
import { sessionTokenFromRequest, verifySessionToken } from '@/lib/server/session'

// The gate logic: the session cookie is verified here (HMAC,
// edge-safe WebCrypto); profile facts come from the app's own
// /api/auth/me with the request's cookies forwarded. API routes
// bypass the gate — they enforce caller rules themselves.

export async function proxy(request: NextRequest) {
  const url = request.nextUrl.clone()
  const pathname = url.pathname

  // Avoid infinite loops
  const isAuthPage = pathname === '/' || pathname === '/login'
  const isKycPendingPage = pathname === '/kyc/pending'
  const isApiRoute = pathname.startsWith('/api')
  const PUBLIC_ROUTES = ['/', '/reset-password', '/auth/callback', '/login', '/register', '/signup', '/forgot-password', '/verify-2fa']

  if (isApiRoute) {
    return NextResponse.next()
  }

  const redirect = (target: string) => {
    url.pathname = target
    return NextResponse.redirect(url)
  }

  const userId = await verifySessionToken(sessionTokenFromRequest(request))

  // If user is authenticated
  if (userId) {
    let profile: any = null
    let meIsAdmin = false
    try {
      const meUrl = new URL('/api/auth/me', request.url)
      // The app server binds 0.0.0.0 (server.js) and Next reports
      // that bind address as request.url's host. 0.0.0.0 is a listen
      // address, not a connectable destination — a fetch to it never
      // reaches this server and hangs, which stalled every
      // authenticated page in this gate. Loop back explicitly when
      // the host is an unspecified bind address; real hostnames
      // (production domains) pass through untouched.
      if (meUrl.hostname === '0.0.0.0' || meUrl.hostname === '::') {
        meUrl.hostname = '127.0.0.1'
      }
      const meRes = await fetch(meUrl, {
        headers: { cookie: request.headers.get('cookie') || '' },
      })
      if (meRes.ok) {
        const me = await meRes.json()
        profile = me.profile
        meIsAdmin = me.is_admin === true
      }
    } catch {
      profile = null
    }

    if (!profile) {
      // Valid session but no profile (or identity lookup failed):
      // treat as signed-out for gating purposes.
      if (!PUBLIC_ROUTES.includes(pathname) && !pathname.startsWith('/api/auth/')) {
        return redirect('/')
      }
      return NextResponse.next()
    }

    // A4 (partial): banned accounts were authenticated and let
    // through everywhere — enforcement existed in only 3 of 22 API
    // routes and nowhere at page level. A banned user is now
    // stopped here for the app areas.
    if (profile?.is_banned === true && (pathname.startsWith('/dashboard') || pathname.startsWith('/admin'))) {
      return redirect('/')
    }

    const role = profile?.role || 'user'
    const status = profile?.verification_status || 'pending'
    const is2faEnabled = profile?.is_2fa_enabled || false
    // A1: profile_type is user-writable during KYC — trusting
    // profile_type === 'admin' here let any registered user promote
    // themselves to admin. Admin = role column or admin_users table
    // (computed by /api/auth/me, as the old proxy checked both).
    const isAdmin = meIsAdmin

    // Check 2FA — the cookie must be a valid HMAC-signed token for
    // this user (it previously just had to equal the raw user id).
    if (is2faEnabled && (pathname.startsWith('/dashboard') || pathname.startsWith('/admin'))) {
      const has2faCookie = await verifyTwoFactorToken(userId, request.cookies.get('2fa_verified')?.value)
      if (!has2faCookie) {
        return redirect('/verify-2fa')
      }
    }

    // Redirect admins away from user pages
    if (isAdmin && !pathname.startsWith('/admin')) {
      return redirect('/admin/dashboard')
    }

    // Redirect non-admins away from admin pages
    if (!isAdmin && pathname.startsWith('/admin')) {
      return redirect('/dashboard')
    }

    // Redirect users to under-verification if not approved
    if (!isAdmin && status !== 'approved' && !isKycPendingPage && pathname.startsWith('/dashboard')) {
      return redirect('/kyc')
    }

    // Redirect approved users away from under-verification
    if (!isAdmin && status === 'approved' && isKycPendingPage) {
      return redirect('/dashboard')
    }

    // Redirect logged-in users away from the login page
    if (isAuthPage) {
      if (isAdmin) {
        return redirect('/admin/dashboard')
      } else {
        return redirect('/dashboard')
      }
    }
  } else {
    // If no user and trying to access a protected route
    if (!PUBLIC_ROUTES.includes(pathname) && !pathname.startsWith('/api/auth/')) {
      return redirect('/')
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
