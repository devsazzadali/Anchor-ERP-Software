/**
 * Universal helper to record administrative actions and security
 * footprints into public.activity_logs.
 *
 * the browser no longer talks to the database. This helper
 * POSTs to /api/activity-logs; the server resolves the acting user
 * from the session (a caller-supplied userId is only honoured for
 * the caller's own id) and inserts with Prisma. Same exported
 * interface as the original, so callers are unchanged.
 */
export interface ActivityLogPayload {
  action: string
  details?: Record<string, any>
  userId?: string
  ipAddress?: string
  deviceInfo?: string
}

export async function recordActivityLog({
  action,
  details = {},
  userId,
  ipAddress,
  deviceInfo,
}: ActivityLogPayload): Promise<boolean> {
  try {
    const payload = {
      user_id: userId || null,
      action,
      details,
      ip_address:
        ipAddress ||
        (typeof window !== 'undefined' ? window.location.hostname : 'Internal/Secure'),
      device_info:
        deviceInfo || (typeof navigator !== 'undefined' ? navigator.userAgent : 'Server'),
    }

    const res = await fetch('/api/activity-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      console.warn('Could not record activity log:', res.status)
      return false
    }
    return true
  } catch (err: any) {
    console.warn('Error recording activity log:', err?.message || err)
    return false
  }
}
