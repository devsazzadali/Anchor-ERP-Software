'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import StatsCard from '@/components/stats-card'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  CheckCircle2, Clock, ListTodo, Calendar, Search, Check, 
  ShieldAlert, Loader2, RefreshCw, User, MessageSquare, 
  AlertTriangle, Play, SlidersHorizontal, X
} from 'lucide-react'

// identity from /api/auth/me; the task
// list from /api/tasks/list (BUG-A1 scoping enforced server-side);
// status/note updates already used the converted /api/tasks routes.

export default function UserTasksWrapper() {
  return (
    <Suspense fallback={<div>Loading tasks...</div>}>
      <UserTasks />
    </Suspense>
  )
}

function UserTasks() {
  const [tasks, setTasks] = useState<any[]>([])
  const [currentTab, setCurrentTab] = useState<'my' | 'all'>('my')
  const [userName, setUserName] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  
  // Search & Filter
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // Edit / Add note overlay
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingNoteValue, setEditingNoteValue] = useState('')

  const [isLoading, setIsLoading] = useState(false);
  const channelRef = useRef<any>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const searchParams = useSearchParams();
  const highlightId = searchParams?.get('id');

  useEffect(() => {
    if (highlightId && tasks.length > 0) {
      setTimeout(() => {
        const el = document.getElementById(`item-${highlightId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-[#1ca34c]', 'ring-offset-2', 'ring-offset-white');
          setTimeout(() => {
            el.classList.remove('ring-2', 'ring-[#1ca34c]', 'ring-offset-2', 'ring-offset-white');
          }, 3000);
        }
      }, 100);
    }
  }, [highlightId, tasks]);

  // Read from localStorage synchronously so there's no flicker on first render
  const [profileType, setProfileType] = useState<'partner' | 'employee' | 'admin' | 'super_admin' | 'head_office'>(() => {
    try {
      if (typeof window !== 'undefined') {
        const s = localStorage.getItem('aura_session')
        if (s) {
          const parsed = JSON.parse(s)
          return parsed.profile?.profile_type || parsed.user?.profile_type || 'partner'
        }
      }
    } catch (e) {}
    return 'partner'
  })

  useEffect(() => {
    const initUser = async () => {
      try {
        const res = await fetch('/api/auth/me')
        if (res.ok) {
          const me = await res.json()
          const user = me.user
          if (user) {
            setUserId(user.id)
            setUserName(me.profile?.full_name || user.email || 'Sazzad Ali')
            
            const profile = me.profile
            if (profile) {
               if (profile.profile_type) setProfileType(profile.profile_type)
               if (profile.full_name) setUserName(profile.full_name)
            }
          }
        }
      } catch (e) {
        console.error('Auth check failed:', e)
      }
    }
    initUser()
  }, [])

  // Fetch tasks — scoped by role:
  // admin/super_admin → all tasks
  // employee/partner  → only tasks assigned to them
  const fetchTasks = async () => {
    setIsLoading(true)
    try {
      // BUG-A1 FIX: Only admins see all tasks; everyone else sees only assigned tasks
      // (enforced server-side by /api/tasks/list from the session role)
      const res = await fetch('/api/tasks/list')
      if (!res.ok) throw new Error('Failed to fetch tasks')
      const { tasks: data } = await res.json()
      setTasks(data || [])
    } catch (err: any) {
      console.error('Error fetching tasks:', err.message)
      setTasks([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Initial data load
    fetchTasks();

    // Use polling as a stable alternative to the legacy realtime channel in React Strict Mode
    const interval = setInterval(fetchTasks, 15000);
    return () => clearInterval(interval);
  }, []);

  // Update status (Pending ➔ Processing ➔ Completed)
  const handleUpdateStatus = async (id: string, newStatus: 'pending' | 'processing' | 'completed') => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/tasks/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus })
      })

      const result = await response.json()
      if (!response.ok) {
        console.error('API Error:', result);
        alert(`API Error: ${result.error || JSON.stringify(result)}`);
        throw new Error(result.error || 'Failed to update status');
      }
      
      // Success: update the local state so the UI changes immediately
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: newStatus } : t))
      setFeedback({ type: 'success', message: `Task status updated to ${newStatus.toUpperCase()}` })
    } catch (err: any) {
      console.error('Catch Error:', err);
      setFeedback({ type: 'error', message: err.message || 'Status update failed.' })
    } finally {
      setIsLoading(false)
    }
  }

  // Inline Note Editor Submit
  const handleUpdateNote = async (id: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/tasks/${id}/note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: editingNoteValue })
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to update note')

      // Success: update the local state
      setTasks(prev => prev.map(t => t.id === id ? { ...t, note: editingNoteValue } : t))
      setFeedback({ type: 'success', message: 'Remarks note updated.' })
      setEditingTaskId(null)
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Notes update failed.' })
    } finally {
      setIsLoading(false)
    }
  }

  const checkOverdue = (task: any) => {
    if (!task.deadline) return false
    return new Date(task.deadline) < new Date() && task.status !== 'completed'
  }

  // Filter tasks based on search, status filter, and current tab (my vs all)
  const filteredTasks = tasks.filter(t => {
    const titleMatch = (t.title || '').toLowerCase().includes(search.toLowerCase())
    const nameMatch = (t.assigned_to_name || '').toLowerCase().includes(search.toLowerCase())
    const matchesSearch = titleMatch || nameMatch
    
    // BUG-B3 FIX: Overdue filter was passing all tasks when 'overdue' was selected.
    // Now correctly shows only tasks that are actually overdue.
    let matchesStatus: boolean
    if (statusFilter === 'all') {
      matchesStatus = true
    } else if (statusFilter === 'overdue') {
      matchesStatus = checkOverdue(t)
    } else {
      matchesStatus = t.status === statusFilter
    }
    
    // Tab match: filter ONLY by ID (names are not unique)
    const matchesTab = currentTab === 'all' || (t.assigned_to_id && t.assigned_to_id === userId)
                       
    return matchesSearch && matchesStatus && matchesTab
  })

  // Counters for logged-in user specifically
  const myTasksCount = tasks.filter(t => t.assigned_to_id === userId).length
  const myCompletedCount = tasks.filter(t => t.assigned_to_id === userId && t.status === 'completed').length
  const myOverdueCount = tasks.filter(t => t.assigned_to_id === userId && checkOverdue(t)).length
  const myProcessingCount = tasks.filter(t => t.assigned_to_id === userId && t.status === 'processing').length

  return (
    <div className="min-h-screen flex bg-white text-slate-900 font-sans md:ml-64">
      
      {/* Background glow effects */}
      <div className="absolute top-[-10%] right-[-5%] w-[45%] h-[45%] bg-[#1ca34c]/3 rounded-full filter blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[20%] w-[50%] h-[50%] bg-[#10b981]/3 rounded-full filter blur-[150px] pointer-events-none" />

{/* Sidebar removed – global layout provides it */}

      {/* Main Core Dashboard panel */}
      <div className="flex-1 flex flex-col p-6 overflow-y-auto max-h-screen relative z-10">
        
        {/* UPPER STATUS BAR */}
        <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-900/5">
          <div className="flex items-start gap-3">
            <span className="w-1.5 h-9 rounded-full bg-[#1ca34c] shrink-0" />
            <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                <ListTodo className="w-3.5 h-3.5" />
                Dossier Verified
              </span>
            </div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 font-serif">
              Assigned Tasks & <span className="premium-text-gradient">To-Dos</span>
            </h2>
            <p className="text-[11px] text-slate-500">Task center panel. Update operations completion and log operational notes.</p>
            </div>
          </div>

          <button 
            onClick={fetchTasks}
            className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isLoading ? 'animate-spin text-[#15803d]' : ''}`}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

          {/* Notification UI removed per user request */}

        {/* 4 STUNNING FLOATING METRIC CARDS FOR CURRENT USER */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          <StatsCard
            title="My Total Tasks"
            value={`${myTasksCount}`}
            subtext="Assigned specifically to you"
            icon={ListTodo}
            sparklineColor="gold"
            sparklineData={[0, 1, 1, 2, 2, 3, myTasksCount]}
          />
          <StatsCard
            title="My Processing Tasks"
            value={`${myProcessingCount}`}
            subtext="Work currently underway"
            icon={Clock}
            sparklineColor="amber"
            sparklineData={[0, 1, 0, 1, 1, 2, myProcessingCount]}
          />
          <StatsCard
            title="My Completed Tasks"
            value={`${myCompletedCount}`}
            subtext="Archived completed deliverables"
            icon={CheckCircle2}
            sparklineColor="emerald"
            sparklineData={[0, 0, 1, 1, 2, 1, myCompletedCount]}
          />
          <StatsCard
            title="My Overdue Tasks"
            value={`${myOverdueCount}`}
            subtext="Critical timeline alarms"
            icon={AlertTriangle}
            sparklineColor="rose"
            sparklineData={[0, 0, 1, 0, 1, 0, myOverdueCount]}
            trend={{ value: myOverdueCount > 0 ? 'CRITICAL ALERT' : 'Secure', isPositive: myOverdueCount === 0 }}
          />
        </div>

        {/* NAVIGATION TABS WITH GLIDING HIGHLIGHT PILL */}
        <div className="flex w-full max-w-md bg-white p-1.5 rounded-xl border border-slate-900/5 mb-8 relative">
          <button
            onClick={() => setCurrentTab('my')}
            className={`flex-1 text-center py-2.5 rounded-lg text-xs font-semibold tracking-wide transition-all z-10 ${
              currentTab === 'my' ? 'text-white font-bold' : 'text-slate-500'
            }`}
          >
            Assigned to Me ({myTasksCount})
          </button>
          <button
            onClick={() => setCurrentTab('all')}
            className={`flex-1 text-center py-2.5 rounded-lg text-xs font-semibold tracking-wide transition-all z-10 ${
              currentTab === 'all' ? 'text-white font-bold' : 'text-slate-500'
            }`}
          >
            All Team Tasks ({tasks.length})
          </button>
          
          <motion.div
            layout
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className="absolute top-1.5 bottom-1.5 left-1.5 rounded-lg bg-[#1ca34c] shadow"
            style={{
              width: 'calc(50% - 12px)',
              x: currentTab === 'my' ? 0 : '100%',
            }}
          />
        </div>

        {/* FILTERS PANEL */}
        <div className="glass-panel p-4 rounded-2xl relative shadow-xl flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
          <div className="relative w-full sm:flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search by title or operator..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-900/[0.04] border border-slate-900/5 hover:border-slate-900/10 rounded-xl py-2.5 pl-10 pr-3.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1ca34c]/45 transition-all"
            />
          </div>

          <div className="flex gap-2 w-full sm:w-auto relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-slate-900/5 rounded-xl py-2.5 pl-3 pr-8 text-xs text-slate-500 focus:outline-none focus:border-[#1ca34c]/40 cursor-pointer w-full sm:w-36 appearance-none"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="overdue">Overdue Only</option>
            </select>
            <SlidersHorizontal className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>
        </div>

        {/* TASK CARDS HUB */}
        <div className="space-y-4">
          {filteredTasks
            .filter(t => statusFilter !== 'overdue' || checkOverdue(t))
            .map((task) => {
              const isOverdue = checkOverdue(task)
              const isAssignedToMe = task.assigned_to_id === userId
              const isEditable = true

              const statusColors = {
                pending: 'bg-slate-100 text-slate-500 border border-slate-300',
                processing: 'bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20',
                completed: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
              }[task.status as 'pending' | 'processing' | 'completed'] || 'bg-slate-100 text-slate-500'

              return (
                <motion.div
                  layout
                  key={task.id}
                  id={`item-${task.id}`}
                  className={`glass-panel p-5 rounded-2xl relative shadow-xl border transition-all ${
                    isOverdue 
                      ? 'border-rose-500/50 shadow-[0_0_15px_rgba(239,68,68,0.25)] animate-pulse' 
                      : 'border-slate-900/5 hover:border-slate-900/10'
                  }`}
                >
                  {/* Status Indicator Bar */}
                  <div className={`absolute top-0 left-0 bottom-0 w-[3.5px] rounded-l-2xl ${
                    isOverdue ? 'bg-rose-500' : task.status === 'completed' ? 'bg-emerald-500' : task.status === 'processing' ? 'bg-[#1ca34c]' : 'bg-slate-400'
                  }`} />

                  {/* Title and control row */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-3 pl-2.5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className={`px-2.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider ${statusColors}`}>
                          {task.status}
                        </span>

                        {isOverdue && (
                          <span className="px-2 py-0.5 rounded-full text-[8.5px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-600 border border-rose-500/30 flex items-center gap-1 font-sans">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-600 stroke-[3]" />
                            ALERT: Overdue
                          </span>
                        )}

                        {isAssignedToMe ? (
                          <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-600 border border-blue-500/20 font-sans">
                            Assigned to me
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-300 font-sans">
                            Assigned to: {task.assigned_to_name || 'Unassigned'}
                          </span>
                        )}
                      </div>
                      
                      <h4 className="text-sm font-bold text-slate-900 font-serif">{task.title}</h4>
                    </div>

                    {/* Quick status change controls (only for assignee) */}
                    {isAssignedToMe && isEditable && (
                      <div className="flex items-center gap-1.5">
                        {task.status === 'pending' && (
                          <button
                            onClick={() => handleUpdateStatus(task.id, 'processing')}
                            className="bg-[#1ca34c]/10 border border-[#1ca34c]/20 text-[#15803d] px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase hover:bg-[#1ca34c]/25 transition-all flex items-center gap-1 cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5" /> Start Work
                          </button>
                        )}
                        {task.status === 'processing' && (
                          <>
                            <button
                              onClick={() => handleUpdateStatus(task.id, 'completed')}
                              className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-500/25 transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" /> Complete
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(task.id, 'pending')}
                              className="bg-rose-500/10 border border-rose-500/20 text-rose-600 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase hover:bg-rose-500/25 transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" /> Cancel Work
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  {task.description && (
                    <p className="text-xs text-slate-500 pl-2.5 mb-4 leading-relaxed font-sans">{task.description}</p>
                  )}

                  {/* Details matrix */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3.5 rounded-xl bg-white border border-slate-900/5 text-[11px] font-sans pl-3">
                    <div className="flex items-center gap-2 text-slate-500">
                      <User className="w-4 h-4 text-slate-500 shrink-0" />
                      <div>
                        <span className="block text-[8px] uppercase tracking-wider text-slate-600">Assignee:</span>
                        <span className="text-slate-900 font-semibold">{task.assigned_to_name}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-slate-500">
                      <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
                      <div>
                        <span className="block text-[8px] uppercase tracking-wider text-slate-600">Deadline Schedule:</span>
                        <span className={`font-semibold ${isOverdue ? 'text-rose-600 font-bold' : 'text-slate-900'}`}>
                          {new Date(task.deadline).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-slate-500">
                      <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                      <div>
                        <span className="block text-[8px] uppercase tracking-wider text-slate-600">Given Timestamp:</span>
                        <span className="text-slate-900 font-semibold">
                          {new Date(task.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Notes / Remarks section */}
                  <div className="mt-4 pt-3 border-t border-slate-900/5 pl-2.5">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[9.5px] uppercase tracking-widest text-[#15803d] font-semibold flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-[#15803d]" />
                        Notes & Remarks
                      </span>

                      {isAssignedToMe && (
                        <button
                          onClick={() => {
                            setEditingTaskId(task.id)
                            setEditingNoteValue(task.note || '')
                          }}
                          className="text-[10px] text-slate-500 hover:text-[#15803d] underline transition-colors"
                        >
                          Modify note
                        </button>
                      )}
                    </div>

                    {editingTaskId === task.id ? (
                      <div className="mt-2 space-y-2">
                        <textarea
                          rows={2}
                          value={editingNoteValue}
                          onChange={(e) => setEditingNoteValue(e.target.value)}
                          placeholder="Explain what steps you did or update status remarks..."
                          className="w-full bg-white border border-[#1ca34c]/30 rounded-xl py-2 px-3 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c] resize-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleUpdateNote(task.id)}
                            className="px-3 py-1 bg-[#1ca34c] hover:bg-[#15803d] text-white font-semibold rounded-full text-[10px] uppercase cursor-pointer"
                          >
                            Save Note
                          </button>
                          <button
                            onClick={() => setEditingTaskId(null)}
                            className="px-3 py-1 bg-white text-slate-500 rounded-lg text-[10px] cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic">
                        {task.note ? task.note : 'No operational notes attached to task.'}
                      </p>
                    )}
                  </div>

                </motion.div>
              )
            })}

          {filteredTasks.length === 0 && (
            <div className="glass-panel p-12 rounded-2xl text-center text-slate-500 italic text-xs">
              No tasks match the active filters.
            </div>
          )}
        </div>

      </div>

    </div>
  )
}
