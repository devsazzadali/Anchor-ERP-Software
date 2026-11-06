/**
 * Attendance → payroll service: one month of attendance-system
 * data, aggregated and matched onto ERP employees, shaped for
 * the payroll run screen.
 *
 * Everything here is a READ. Nothing in this module writes to
 * any database, and nothing creates salary payments — the
 * summaries are DRAFT INPUTS for the payroll line form, which a
 * human reviews, edits and submits through the existing A6
 * line flow (and, at issue time, the ONE salary service in
 * lib/server/salary-issue.ts).
 *
 * Fail-soft by contract: unconfigured → { configured: false };
 * upstream read failure → { configured: true, available: false }.
 * The payroll run screen renders a dictionary message for both
 * and keeps working exactly as before.
 */
import { attendanceConfig, fetchAttendanceMonth, AttendanceFetchError } from './client'
import {
  aggregateMonthlySummary,
  matchEmployees,
  type MonthlySummary,
} from './summary'

export interface AttendanceDraftSummary extends MonthlySummary {
  /** Clone (ERP) profile id — the payroll line's employee. */
  employee_id: string
  employee_name: string
  branch_id: string | null
  matched_via: 'email' | 'phone' | 'employee_id'
}

export interface AttendanceDrafts {
  configured: boolean
  available: boolean
  month: string
  summaries: AttendanceDraftSummary[]
  /** Attendance-system people with no ERP match — reported,
   * never merged. */
  unmatched: Array<{ name: string; employee_code: string | null }>
}

const zeroSummary = (): MonthlySummary => ({
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

export async function getAttendanceDrafts(db: any, month: string): Promise<AttendanceDrafts> {
  const cfg = attendanceConfig()
  if (!cfg) {
    return { configured: false, available: false, month, summaries: [], unmatched: [] }
  }

  // The payroll population (same set as the line form's employee
  // picker), with the identity fields matching needs.
  const cloneProfiles = await db.profile.findMany({
    where: { profile_type: { in: ['employee', 'head_office', 'branch_manager'] } },
    select: { id: true, full_name: true, email: true, phone_number: true, employee_id: true, branch_id: true },
    orderBy: { full_name: 'asc' },
  })

  let data
  try {
    data = await fetchAttendanceMonth(cfg, month)
  } catch (err) {
    if (err instanceof AttendanceFetchError) {
      console.error('[attendance] monthly read failed:', err.message)
      return { configured: true, available: false, month, summaries: [], unmatched: [] }
    }
    throw err
  }

  const summariesByAttendance = aggregateMonthlySummary(data.records, data.leaveRequests, month)
  const { matches, unmatched_attendance } = matchEmployees(
    cloneProfiles.map((p: any) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email ?? null,
      phone_number: p.phone_number ?? null,
      employee_id: p.employee_id ?? null,
    })),
    data.profiles.map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email ?? null,
      phone: p.phone ?? null,
      employee_id: p.employee_id ?? null,
    }))
  )

  const cloneById = new Map<string, any>(cloneProfiles.map((p: any) => [p.id, p]))
  const summaries: AttendanceDraftSummary[] = matches.map((mtc) => {
    const clone = cloneById.get(mtc.clone_id)
    const s = summariesByAttendance.get(mtc.attendance_id) ?? zeroSummary()
    return {
      ...s,
      employee_id: mtc.clone_id,
      employee_name: clone?.full_name ?? 'Employee',
      branch_id: clone?.branch_id ?? null,
      matched_via: mtc.via,
    }
  })
  summaries.sort((a, b) => a.employee_name.localeCompare(b.employee_name))

  return {
    configured: true,
    available: true,
    month,
    summaries,
    unmatched: unmatched_attendance.map((p) => ({ name: p.full_name, employee_code: p.employee_id ?? null })),
  }
}
