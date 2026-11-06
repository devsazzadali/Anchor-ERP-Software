/**
 * Attendance → payroll: PURE aggregation + employee matching.
 *
 * No I/O, no env, no database — the REST client (client.ts) hands
 * raw rows in, the service (service.ts) hands DTOs out, and the
 * unit tests drive this module with fixtures. Keeping it pure is
 * what makes the payroll draft numbers provable offline.
 *
 * Source-system facts (attendance system DDL, verified from its
 * migration set — see ERP_ATTENDANCE_CONNECT_REPORT.md):
 *  - attendance_records.status is the enum
 *    'present' | 'late' | 'absent' | 'half_day', one row per
 *    employee-day in practice; a record's day is the Dhaka date
 *    of check_in_time.
 *  - Overtime is APPROVED only when
 *    overtime_approval_status = 'approved' (the system's trigger
 *    stamps 'approved' for auto-approved OT, 'pending' when a
 *    manager must decide, 'auto' when there is no OT). The
 *    approved figure lives in approved_overtime_minutes, which
 *    stays NULL on the auto-approved path — so the approved
 *    minutes are approved_overtime_minutes ?? overtime_minutes.
 *  - leave_requests.status 'approved' is the only leave that
 *    counts; its days are the calendar dates start_date..end_date.
 *  - Day counts and working minutes are NOT gated on the
 *    record-level approval_status (a branch-manager check-in
 *    approval stamp): the payroll requirement attaches the
 *    APPROVED qualifier to overtime and leave only.
 */
import { dhakaDateOf, dhakaMonthWindow, addDays } from '../../dhaka-time'

export interface AttendanceRecordLite {
  employee_id: string
  check_in_time: string
  check_out_time: string | null
  status: string
  overtime_minutes?: number | null
  approved_overtime_minutes?: number | null
  overtime_approval_status?: string | null
  is_holiday_duty?: boolean | null
}

export interface LeaveRequestLite {
  employee_id: string
  start_date: string
  end_date: string
  status: string
}

export interface MonthlySummary {
  present: number
  absent: number
  late: number
  half_day: number
  /** Sum of (check_out − check_in) spans, whole minutes. Breaks
   * are not subtracted — the attendance system keeps break rows
   * separately and no verified join rule exists. */
  working_minutes: number
  /** Minutes of overtime whose approval status is 'approved'. */
  approved_overtime_minutes: number
  /** Distinct month dates flagged is_holiday_duty. */
  holiday_duty_days: number
  /** Distinct month dates covered by APPROVED leave requests. */
  approved_leave_days: number
  /** Draft suggestion for a payroll line's total_payable_days:
   * worked-day values (present/late = 1, half_day = 0.5, best
   * record wins per date) + 1 per approved-leave date that has
   * no worked value. A human reviews and edits it in the line
   * form before anything is saved — it never pays anyone. */
  suggested_payable_days: number
}

const emptySummary = (): MonthlySummary => ({
  present: 0,
  absent: 0,
  late: 0,
  half_day: 0,
  working_minutes: 0,
  approved_overtime_minutes: 0,
  holiday_duty_days: 0,
  approved_leave_days: 0,
  suggested_payable_days: 0,
})

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Aggregate one month ('YYYY-MM') of raw attendance rows into
 * per-employee summaries, keyed by ATTENDANCE profile id. */
export function aggregateMonthlySummary(
  records: AttendanceRecordLite[],
  leaveRequests: LeaveRequestLite[],
  month: string
): Map<string, MonthlySummary> {
  const [y, m] = month.split('-').map(Number)
  const { start, endExclusive } = dhakaMonthWindow(y, m)
  const lastDate = addDays(endExclusive, -1)

  const out = new Map<string, MonthlySummary>()
  const worked = new Map<string, Map<string, number>>() // emp -> date -> day value
  const holidayDates = new Map<string, Set<string>>()
  const leaveDates = new Map<string, Set<string>>()
  const get = (emp: string): MonthlySummary => {
    let s = out.get(emp)
    if (!s) { s = emptySummary(); out.set(emp, s) }
    return s
  }

  for (const r of records ?? []) {
    if (!r?.employee_id || !r?.check_in_time) continue
    const date = dhakaDateOf(new Date(r.check_in_time))
    if (date < start || date >= endExclusive) continue
    const s = get(r.employee_id)
    switch (String(r.status ?? '')) {
      case 'present': s.present++; break
      case 'late': s.late++; break
      case 'half_day': s.half_day++; break
      case 'absent': s.absent++; break
      default: break // unknown status: worked minutes/OT below still count
    }
    if (r.check_out_time) {
      const span = Math.floor((new Date(r.check_out_time).getTime() - new Date(r.check_in_time).getTime()) / 60000)
      if (span > 0) s.working_minutes += span
    }
    if (String(r.overtime_approval_status ?? '') === 'approved') {
      s.approved_overtime_minutes += num(r.approved_overtime_minutes ?? r.overtime_minutes)
    }
    if (r.is_holiday_duty) {
      let set = holidayDates.get(r.employee_id)
      if (!set) { set = new Set(); holidayDates.set(r.employee_id, set) }
      set.add(date)
    }
    const dayValue = r.status === 'present' || r.status === 'late' ? 1 : r.status === 'half_day' ? 0.5 : 0
    if (dayValue > 0) {
      let days = worked.get(r.employee_id)
      if (!days) { days = new Map(); worked.set(r.employee_id, days) }
      if (dayValue > (days.get(date) ?? 0)) days.set(date, dayValue)
    }
  }

  for (const l of leaveRequests ?? []) {
    if (!l?.employee_id || String(l.status ?? '') !== 'approved') continue
    const from = String(l.start_date ?? '').slice(0, 10)
    const to = String(l.end_date ?? '').slice(0, 10)
    if (!from || !to || to < start || from > lastDate) continue
    let set = leaveDates.get(l.employee_id)
    if (!set) { set = new Set(); leaveDates.set(l.employee_id, set) }
    let d = from < start ? start : from
    const last = to > lastDate ? lastDate : to
    while (d <= last) { set.add(d); d = addDays(d, 1) }
  }

  for (const [emp, set] of holidayDates) get(emp).holiday_duty_days = set.size
  for (const [emp, set] of leaveDates) get(emp).approved_leave_days = set.size
  for (const [emp, s] of out) {
    let payable = 0
    const days = worked.get(emp)
    if (days) for (const v of days.values()) payable += v
    const leave = leaveDates.get(emp)
    if (leave) for (const d of leave) if (!days?.has(d)) payable += 1
    s.suggested_payable_days = payable
  }
  return out
}

// ── Employee matching ───────────────────────────────────────────

export interface CloneProfileLite {
  id: string
  full_name: string
  email: string | null
  phone_number: string | null
  employee_id: string | null
}

export interface AttendanceProfileLite {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  employee_id: string | null
}

export type MatchVia = 'email' | 'phone' | 'employee_id'

export interface EmployeeMatch {
  clone_id: string
  attendance_id: string
  via: MatchVia
}

export const normalizeEmail = (v: unknown): string => String(v ?? '').trim().toLowerCase()

/** Phone digits in a comparable form: international BD numbers
 * (+8801…) fold to the local 01… form so the attendance app's
 * `phone` and the ERP's `phone_number` meet. */
export function normalizePhone(v: unknown): string {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.startsWith('880') && d.length >= 13) d = '0' + d.slice(3)
  return d
}

export const normalizeEmployeeCode = (v: unknown): string => String(v ?? '').trim().toUpperCase()

/**
 * Match attendance profiles to clone (ERP) profiles. Passes run
 * email → phone → employee_id; each side is claimed at most once
 * (an earlier pass wins), and anyone left over is reported
 * unmatched — never guessed, never merged on name alone.
 */
export function matchEmployees(
  cloneProfiles: CloneProfileLite[],
  attendanceProfiles: AttendanceProfileLite[]
): { matches: EmployeeMatch[]; unmatched_attendance: AttendanceProfileLite[] } {
  const usedClone = new Set<string>()
  const usedAtt = new Set<string>()
  const matches: EmployeeMatch[] = []

  const passes: Array<{
    via: MatchVia
    cloneKey: (p: CloneProfileLite) => string
    attKey: (p: AttendanceProfileLite) => string
  }> = [
    { via: 'email', cloneKey: (p) => normalizeEmail(p.email), attKey: (p) => normalizeEmail(p.email) },
    { via: 'phone', cloneKey: (p) => normalizePhone(p.phone_number), attKey: (p) => normalizePhone(p.phone) },
    { via: 'employee_id', cloneKey: (p) => normalizeEmployeeCode(p.employee_id), attKey: (p) => normalizeEmployeeCode(p.employee_id) },
  ]

  for (const pass of passes) {
    const byKey = new Map<string, CloneProfileLite>()
    for (const c of cloneProfiles) {
      if (usedClone.has(c.id)) continue
      const k = pass.cloneKey(c)
      if (k && !byKey.has(k)) byKey.set(k, c)
    }
    for (const a of attendanceProfiles) {
      if (usedAtt.has(a.id)) continue
      const k = pass.attKey(a)
      if (!k) continue
      const c = byKey.get(k)
      if (!c) continue
      matches.push({ clone_id: c.id, attendance_id: a.id, via: pass.via })
      usedClone.add(c.id)
      usedAtt.add(a.id)
      byKey.delete(k)
    }
  }

  return {
    matches,
    unmatched_attendance: attendanceProfiles.filter((a) => !usedAtt.has(a.id)),
  }
}
