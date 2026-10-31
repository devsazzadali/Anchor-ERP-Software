'use client'

export const dynamic = 'force-dynamic'
import React, { useCallback, useEffect, useState } from 'react'
import { Shield, RefreshCw, LogOut, Ban, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'

// S2 (R2 Security Round) — Active Sessions admin page.
// Data: GET /api/admin/sessions (registry rows from user_sessions).
// Actions: POST /api/admin/sessions/revoke { sessionId } and
// POST /api/admin/sessions/revoke-all { userId } (also bumps the
// user's session epoch, which kills their legacy tokens too).

type SessionRow = {
  id: string
  user_id: string
  user_name: string | null
  user_email: string | null
  role: string | null
  profile_type: string | null
  branch: string | null
  created_at: string
  last_seen_at: string
  ip_address: string | null
  user_agent: string | null
  revoked_at: string | null
  revoke_reason: string | null
  active: boolean
}

function fmt(ts: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString()
}

export default function AdminSessionsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [activeDefinition, setActiveDefinition] = useState('')
  const [legacyNote, setLegacyNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/sessions')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load sessions')
      setSessions(data.sessions ?? [])
      setActiveDefinition(data.activeDefinition ?? '')
      setLegacyNote(data.legacySessionNote ?? '')
    } catch (e: any) {
      setError(e?.message || 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const revoke = async (row: SessionRow) => {
    if (!window.confirm(`Revoke this session for ${row.user_name || row.user_email || row.user_id}? They will be signed out at their next request.`)) return
    setBusyId(row.id)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/sessions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: row.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Revoke failed')
      setNotice('Session revoked. That device will be signed out at its next request.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Revoke failed')
    } finally {
      setBusyId(null)
    }
  }

  const revokeAll = async (row: SessionRow) => {
    if (!window.confirm(`Revoke ALL sessions for ${row.user_name || row.user_email || row.user_id}?\n\nThis also invalidates any older (pre-registry) sign-ins for this user. If this is your own account, YOU will be signed out at your next request.`)) return
    setBusyId(`all:${row.user_id}`)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/sessions/revoke-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: row.user_id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Revoke-all failed')
      setNotice(`All sessions revoked for ${row.user_name || row.user_email || row.user_id} (${data.revokedSessions ?? 0} registry session(s), epoch bumped).`)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Revoke-all failed')
    } finally {
      setBusyId(null)
    }
  }

  const activeCount = sessions.filter((s) => s.active).length

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-emerald-600" /> Active Sessions
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {loading ? 'Loading…' : `${activeCount} active of ${sessions.length} session(s) in the last 7 days.`}
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-4 text-sm text-slate-600 space-y-2">
        <p className="flex gap-2"><Clock className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" /> <span><strong>Active definition:</strong> {activeDefinition}</span></p>
        <p className="flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" /> <span><strong>Legacy sessions:</strong> {legacyNote}</span></p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4 text-sm text-rose-700">{error}</div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4 text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {notice}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
        <table className="w-full text-sm min-w-[980px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Role / Branch</th>
              <th className="px-4 py-3 font-semibold">Login time</th>
              <th className="px-4 py-3 font-semibold">Last active</th>
              <th className="px-4 py-3 font-semibold">IP</th>
              <th className="px-4 py-3 font-semibold">Device / Browser</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!loading && sessions.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No sessions in the registry yet. New logins will appear here.</td></tr>
            )}
            {sessions.map((row) => (
              <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-800">{row.user_name || '—'}</div>
                  <div className="text-xs text-slate-400">{row.user_email || row.user_id}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-slate-700">{row.role || '—'}{row.profile_type ? ` · ${row.profile_type}` : ''}</div>
                  <div className="text-xs text-slate-400">{row.branch || '—'}</div>
                </td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmt(row.created_at)}</td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmt(row.last_seen_at)}</td>
                <td className="px-4 py-3 text-slate-600">{row.ip_address || '—'}</td>
                <td className="px-4 py-3 text-slate-500 max-w-[260px] truncate" title={row.user_agent || ''}>{row.user_agent || '—'}</td>
                <td className="px-4 py-3">
                  {row.revoked_at ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600"><Ban className="w-3.5 h-3.5" /> Revoked{row.revoke_reason ? ` (${row.revoke_reason})` : ''}</span>
                  ) : row.active ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> Active</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400"><Clock className="w-3.5 h-3.5" /> Idle / expired</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {!row.revoked_at && (
                    <button
                      onClick={() => revoke(row)}
                      disabled={busyId === row.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 text-xs font-bold hover:bg-rose-500/20 disabled:opacity-50 mr-2"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Revoke
                    </button>
                  )}
                  <button
                    onClick={() => revokeAll(row)}
                    disabled={busyId === `all:${row.user_id}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900/5 border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-900/10 disabled:opacity-50"
                  >
                    <Ban className="w-3.5 h-3.5" /> Revoke all
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
