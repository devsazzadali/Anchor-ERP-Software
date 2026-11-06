/**
 * Attendance system — server-only, READ-ONLY Supabase REST client.
 *
 * The attendance system (anchorattendence.online) is a SEPARATE
 * Supabase project. This client speaks to it exclusively with
 * HTTP GET (PostgREST) — there is no write method here at all,
 * and none may be added: the attendance database is read-only
 * for the ERP, forever (owner's law).
 *
 * Configuration is env-only, server-side (never NEXT_PUBLIC_):
 *   ATTENDANCE_SUPABASE_URL  — the attendance project's URL
 *   ATTENDANCE_SUPABASE_KEY  — a key allowed to read the tables
 * When either is unset the feature is simply OFF: callers get
 * `attendanceConfigured() === false` and the payroll screens show
 * a clean "not connected" state — no errors anywhere.
 */
import { dhakaMonthWindow, dhakaRangeUtcWindow, addDays } from '../../dhaka-time'
import type { AttendanceRecordLite, LeaveRequestLite } from './summary'

export interface AttendanceConfig {
  url: string
  key: string
}

export function attendanceConfig(): AttendanceConfig | null {
  const url = String(process.env.ATTENDANCE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  const key = String(process.env.ATTENDANCE_SUPABASE_KEY ?? '').trim()
  if (!url || !key) return null
  return { url, key }
}

export function attendanceConfigured(): boolean {
  return attendanceConfig() !== null
}

export class AttendanceFetchError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AttendanceFetchError'
    this.status = status
  }
}

export interface AttendanceProfileRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  employee_id: string | null
  branch_id: string | null
  is_active: boolean | null
}

export interface AttendanceMonthData {
  profiles: AttendanceProfileRow[]
  records: AttendanceRecordLite[]
  leaveRequests: LeaveRequestLite[]
}

const PAGE = 1000

async function getAll<T>(cfg: AttendanceConfig, path: string): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const sep = path.includes('?') ? '&' : '?'
    const res = await fetch(`${cfg.url}/rest/v1/${path}${sep}limit=${PAGE}&offset=${offset}`, {
      method: 'GET',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (!res.ok) {
      throw new AttendanceFetchError(res.status, `Attendance read failed (${res.status}) for ${path.split('?')[0]}`)
    }
    const page = (await res.json()) as T[]
    if (!Array.isArray(page)) {
      throw new AttendanceFetchError(0, `Attendance read returned a non-list for ${path.split('?')[0]}`)
    }
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

/** Fetch everything the payroll summary needs for one month
 * ('YYYY-MM', Dhaka calendar): all attendance profiles, the
 * month's attendance_records (by check_in_time inside the Dhaka
 * month's UTC window), and the month's APPROVED leave_requests
 * (any request overlapping the month). GET-only. */
export async function fetchAttendanceMonth(cfg: AttendanceConfig, month: string): Promise<AttendanceMonthData> {
  const [y, m] = month.split('-').map(Number)
  const { start, endExclusive } = dhakaMonthWindow(y, m)
  const lastDate = addDays(endExclusive, -1)
  const { startIso, endIso } = dhakaRangeUtcWindow(start, lastDate)
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString()

  const [profiles, records, leaveRequests] = await Promise.all([
    getAll<AttendanceProfileRow>(
      cfg,
      `profiles?${q({ select: 'id,full_name,email,phone,employee_id,branch_id,is_active', order: 'full_name.asc' })}`
    ),
    getAll<AttendanceRecordLite>(
      cfg,
      `attendance_records?${q({
        select:
          'employee_id,check_in_time,check_out_time,status,overtime_minutes,approved_overtime_minutes,overtime_approval_status,is_holiday_duty',
        'check_in_time': `gte.${startIso}`,
        order: 'check_in_time.asc',
      })}&check_in_time=lt.${encodeURIComponent(endIso)}`
    ),
    getAll<LeaveRequestLite>(
      cfg,
      `leave_requests?${q({
        select: 'employee_id,start_date,end_date,status',
        status: 'eq.approved',
        start_date: `lte.${lastDate}`,
        end_date: `gte.${start}`,
        order: 'start_date.asc',
      })}`
    ),
  ])
  return { profiles, records, leaveRequests }
}
