'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState } from 'react'
import StatsCard from '@/components/stats-card'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2, Clock, ListTodo, Plus, Calendar,
  Search, Check, Trash2, ShieldAlert,
  Loader2, RefreshCw, User, MessageSquare, AlertTriangle, Play, X
} from 'lucide-react'

export default function AdminTasks() {
  const [tasks, setTasks] = useState<any[]>([])
  const [profiles, setProfiles] = useState<any[]>([])

  // Task fields
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignedToId, setAssignedToId] = useState('')
  const [assignedToName, setAssignedToName] = useState('')
  const [deadline, setDeadline] = useState('')
  const [note, setNote] = useState('')

  // Search & Filter
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // Edit / Add note overlay
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingNoteValue, setEditingNoteValue] = useState('')

  const [isLoading, setIsLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [adminName, setAdminName] = useState('Operational Manager')
  const [adminId, setAdminId] = useState('demo-admin-001')

  useEffect(() => {
    // SEC-06 FIX: Fetch admin identity from verified session, not from localStorage.
    // localStorage can be tampered by an attacker to spoof identity in the UI.
    // identity via /api/auth/me.
    const loadAdminIdentity = async () => {
      try {
        const res = await fetch('/api/auth/me')
        const data = await res.json()
        const user = data?.user
        if (user) {
          setAdminId(user.id)
          setAdminName(data.profile?.full_name || user.email?.split('@')[0] || 'Admin')
        }
      } catch (e) {
        console.error('[admin/tasks] Failed to load admin identity:', e)
      }
    }
    loadAdminIdentity()
  }, [])

  // Fetch tasks & profiles
  // the API is the only source — the old localStorage DATA
  // fallback (aura_tasks) is deleted (audit A9/C41 class).
  const fetchData = async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/admin/tasks')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch tasks')
      setProfiles(data.profiles || [])
      setTasks(data.tasks || [])
    } catch (err: any) {
      console.error('Error fetching tasks:', err.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData()

    // realtime channel replaced with refetch on focus + 30s polling.
    const onFocus = () => fetchData()
    window.addEventListener('focus', onFocus)
    const interval = setInterval(fetchData, 30000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [])

  // Helper to validate UUID format
  const isValidUUID = (str: string) => {
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return regex.test(str);
  }

  // Sync profile name on ID selection
  const handleAssigneeChange = (id: string) => {
    setAssignedToId(id)
    const prof = profiles.find(p => p.id === id)
    if (prof) {
      setAssignedToName(prof.full_name)
    } else {
      setAssignedToName('')
    }
  }

  // Handle task creation
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !assignedToName || !deadline) {
      setFeedback({ type: 'error', message: 'Title, Assignee Name and Deadline are required.' })
      return
    }

    setIsLoading(true)
    setFeedback(null)

    const cleanAssignedToId = (assignedToId && isValidUUID(assignedToId)) ? assignedToId : null
    const cleanCreatedBy = (adminId && isValidUUID(adminId)) ? adminId : null

    const newTask = {
      title,
      description,
      assigned_to_id: cleanAssignedToId,
      assigned_to_name: assignedToName,
      status: 'pending',
      deadline: new Date(deadline).toISOString(),
      note,
      created_by: cleanCreatedBy
    }

    try {
      const res = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTask)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Database write failed.')
      const insertedTask = data.task

      // Trigger email and real-time notification
      if (insertedTask && insertedTask.assigned_to_id) {
        fetch('/api/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'TASK_ASSIGNED',
            userId: insertedTask.assigned_to_id,
            payload: {
              userId: insertedTask.assigned_to_id,
              taskTitle: insertedTask.title,
              taskId: insertedTask.id,
              dueDate: new Date(insertedTask.deadline).toLocaleDateString(),
              description: insertedTask.description || 'No description provided',
              userName: insertedTask.assigned_to_name
            }
          })
        }).catch(e => console.error('Failed to trigger TASK_ASSIGNED notification:', e))
      }

      setFeedback({ type: 'success', message: 'Task assigned successfully!' })
      resetForm()
      await fetchData()
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Database write failed.' })
    } finally {
      setIsLoading(false)
    }
  }

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setAssignedToId('')
    setAssignedToName('')
    setDeadline('')
    setNote('')
  }

  // Update task status
  const handleUpdateStatus = async (id: string, newStatus: 'pending' | 'processing' | 'completed') => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/admin/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Status update failed.')
      // Bug fix #3: refresh task list so card reflects new status immediately
      await fetchData()
      setFeedback({ type: 'success', message: 'Task status updated.' })
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Status update failed.' })
    } finally {
      setIsLoading(false)
    }
  }

  // Inline Note Editor Submit
  const handleUpdateNote = async (id: string) => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/admin/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, note: editingNoteValue })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Notes update failed.')
      setEditingTaskId(null)
      // Bug fix #5: refresh so displayed note reflects saved value
      await fetchData()
      setFeedback({ type: 'success', message: 'Task notes updated.' })
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Notes update failed.' })
    } finally {
      setIsLoading(false)
    }
  }

  // Delete task
  const handleDeleteTask = async (id: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return
    setIsLoading(true)

    try {
      const res = await fetch('/api/admin/tasks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete task.')
      // Bug fix #4: remove deleted card from UI immediately
      await fetchData()
      setFeedback({ type: 'success', message: 'Task deleted successfully.' })
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to delete task.' })
    } finally {
      setIsLoading(false)
    }
  }

  // Check if deadline is overdue
  const checkOverdue = (task: any) => {
    return new Date(task.deadline) < new Date() && task.status !== 'completed'
  }

  // Metrics
  const totalTasks = tasks.length
  const completedTasks = tasks.filter(t => t.status === 'completed').length
  const processingTasks = tasks.filter(t => t.status === 'processing').length
  const pendingTasks = tasks.filter(t => t.status === 'pending').length
  const overdueTasks = tasks.filter(t => checkOverdue(t)).length

  // Filter tasks
  const filteredTasks = tasks.filter(t => {
    // Bug fix #7: null-safe guard on assigned_to_name
    const matchesSearch =
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      (t.assigned_to_name ?? '').toLowerCase().includes(search.toLowerCase())
    // Bug fix #6: 'overdue' is not a DB status value — handle it explicitly
    const matchesStatus =
      statusFilter === 'all'     ? true :
      statusFilter === 'overdue' ? checkOverdue(t) :
      t.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans">

      {/* Glow Effects */}
      <div className="absolute top-[-10%] right-[-5%] w-[45%] h-[45%] bg-rose-500/3 rounded-full filter blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[20%] w-[50%] h-[50%] bg-[#1ca34c]/3 rounded-full filter blur-[150px] pointer-events-none" />

      {/* Main Core Dashboard panel */}
      <div className="flex-1 flex flex-col p-6 overflow-y-auto max-h-screen relative z-10">

        {/* UPPER STATUS BAR */}
        <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-900/5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] bg-rose-500/10 text-rose-600 border border-rose-500/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                <ListTodo className="w-3.5 h-3.5" />
                Task Center
              </span>
            </div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 font-serif flex items-center gap-3">
              <span className="w-1.5 h-8 rounded-full bg-[#1ca34c] shrink-0" />
              Task & Todo <span className="premium-text-gradient">Manager</span>
            </h2>
            <p className="text-[11px] text-slate-500">Assign operations, schedule deadlines, audit team completions, and monitor warnings.</p>
          </div>

          <button
            onClick={fetchData}
            className="p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Feedback alerts */}
        <AnimatePresence mode="wait">
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`p-4 rounded-xl border mb-6 flex gap-3 text-xs ${
                feedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-600'
              }`}
            >
              {feedback.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
              <span>{feedback.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 4 FLOATING METRIC CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          <StatsCard
            title="Total Logged Tasks"
            value={`${totalTasks}`}
            subtext="Consolidated operations queue"
            icon={ListTodo}
            sparklineColor="gold"
            sparklineData={[3, 5, 4, 6, 5, 7, totalTasks]}
          />
          <StatsCard
            title="Processing Tasks"
            value={`${processingTasks}`}
            subtext="Under active developer cycle"
            icon={Clock}
            sparklineColor="amber"
            sparklineData={[1, 2, 1, 3, 2, 2, processingTasks]}
          />
          <StatsCard
            title="Completed Tasks"
            value={`${completedTasks}`}
            subtext="Fully audited resolutions"
            icon={CheckCircle2}
            sparklineColor="emerald"
            sparklineData={[1, 2, 3, 4, 4, 5, completedTasks]}
          />
          <StatsCard
            title="Overdue Tasks (Alert!)"
            value={`${overdueTasks}`}
            subtext="Expired schedules"
            icon={AlertTriangle}
            sparklineColor="rose"
            sparklineData={[0, 1, 0, 1, 2, 1, overdueTasks]}
            trend={{ value: overdueTasks > 0 ? 'CRITICAL WARN' : 'Secure', isPositive: overdueTasks === 0 }}
          />
        </div>

        {/* WORKSPACE CONTENT GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

          {/* TASK CREATOR COLUMN (col-span-4) */}
          <div className="lg:col-span-4 glass-panel p-6 rounded-2xl relative shadow-xl">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#1ca34c]/30 to-transparent" />

            <h3 className="text-sm font-bold text-slate-900 font-serif mb-5">Create Operation Task</h3>

            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Task Title</label>
                <input
                  required
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Test SSL Certificates validation"
                  className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/50 transition-all"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Description / Target</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe step requirements..."
                  className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/50 transition-all resize-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Assignee</label>
                <select
                  required
                  value={assignedToId}
                  onChange={(e) => handleAssigneeChange(e.target.value)}
                  className="w-full bg-white border border-slate-900/5 rounded-xl py-3 px-3 text-xs text-slate-600 focus:outline-none focus:border-[#1ca34c]/50 appearance-none cursor-pointer"
                >
                  <option value="">Select registered operator...</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}{p.profile_type ? ` (${p.profile_type})` : ''}
                    </option>
                  ))}
                  <option value="custom">-- Custom Name Input --</option>
                </select>
              </div>

              {assignedToId === 'custom' && (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Custom Assignee Name</label>
                  <input
                    required
                    type="text"
                    value={assignedToName}
                    onChange={(e) => setAssignedToName(e.target.value)}
                    placeholder="Enter employee name..."
                    className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-3.5 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c]/50 transition-all"
                  />
                </div>
              )}

              <div>
                <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Schedule Deadline</label>
                <input
                  required
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-3 px-3.5 text-xs text-slate-600 focus:outline-none focus:border-[#1ca34c]/50 transition-all"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-500 tracking-wider uppercase mb-1.5">Admin Note / Remark (Optional)</label>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Additional notes for user..."
                  className="w-full bg-slate-900/[0.04] border border-slate-900/5 rounded-xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/50 transition-all resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#1ca34c] text-white font-semibold py-3 rounded-full text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg shadow-[#1ca34c]/10 hover:shadow-[#1ca34c]/20 transition-all cursor-pointer mt-4"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="w-4 h-4" /> Assign Work Dossier
                  </>
                )}
              </button>
            </form>
          </div>

          {/* TASK BOARD / KANBAN (col-span-8) */}
          <div className="lg:col-span-8 space-y-6">

            {/* SEARCH AND QUICK FILTERS */}
            <div className="glass-panel p-4 rounded-2xl relative shadow-xl flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="relative w-full sm:flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search tasks by title or assignee..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-slate-900/[0.04] border border-slate-900/5 hover:border-slate-900/10 rounded-xl py-2 pl-10 pr-3.5 text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-[#1ca34c]/45 transition-all"
                />
              </div>

              <div className="flex gap-2 w-full sm:w-auto">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-white border border-slate-900/5 rounded-xl py-2 pl-3 pr-8 text-xs text-slate-500 focus:outline-none focus:border-[#1ca34c]/40 cursor-pointer w-full sm:w-36"
                >
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="processing">Processing</option>
                  <option value="completed">Completed</option>
                  <option value="overdue">Overdue Only</option>
                </select>
              </div>
            </div>

            {/* TASK CARDS */}
            <div className="space-y-4">
              {/* Bug fix #6: removed redundant .filter() — overdue handled in filteredTasks above */}
              {filteredTasks
                .map((task) => {
                  const isOverdue = checkOverdue(task)
                  const isAssignedToMe = task.assigned_to_name && (task.assigned_to_name.toLowerCase() === adminName.toLowerCase() || task.assigned_to_id === adminId)

                  const statusColors = {
                    pending: 'bg-slate-100 text-slate-500 border border-slate-700',
                    processing: 'bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20',
                    completed: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                  }[task.status as 'pending' | 'processing' | 'completed'] || 'bg-slate-100 text-slate-500'

                  return (
                    <motion.div
                      layout
                      key={task.id}
                      className={`glass-panel p-5 rounded-2xl relative shadow-xl transition-all border ${
                        isOverdue
                          ? 'border-rose-500/50 shadow-[0_0_15px_rgba(239,68,68,0.25)] animate-pulse'
                          : 'border-slate-900/5 hover:border-slate-900/10'
                      }`}
                    >
                      {/* Accent Line for status */}
                      <div className={`absolute top-0 left-0 bottom-0 w-[3px] rounded-l-2xl ${
                        isOverdue ? 'bg-rose-500' : task.status === 'completed' ? 'bg-emerald-500' : task.status === 'processing' ? 'bg-[#1ca34c]' : 'bg-slate-700'
                      }`} />

                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-3 pl-2.5">
                        <div>
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className={`px-2 py-0.5 rounded-full text-[8.5px] font-bold uppercase tracking-wider ${statusColors}`}>
                              {task.status}
                            </span>

                            {isOverdue && (
                              <span className="px-2 py-0.5 rounded-full text-[8.5px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-600 border border-rose-500/30 flex items-center gap-1 font-sans">
                                <AlertTriangle className="w-3 h-3 text-rose-600 stroke-[3]" />
                                ALERT: Overdue
                              </span>
                            )}

                            {isAssignedToMe ? (
                              <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-600 border border-blue-500/20 font-sans">
                                Assigned to me
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-700 font-sans">
                                Assigned to: {task.assigned_to_name || 'Unassigned'}
                              </span>
                            )}
                          </div>

                          <h4 className="text-sm font-bold text-slate-900 font-serif group-hover:text-[#15803d] transition-colors">{task.title}</h4>
                        </div>

                        {/* Top action: Status Switcher & Delete */}
                        <div className="flex items-center gap-1.5">
                          {isAssignedToMe && task.status === 'pending' && (
                            <button
                              onClick={() => handleUpdateStatus(task.id, 'processing')}
                              title="Start Task"
                              className="p-2.5 rounded-lg bg-[#1ca34c]/10 text-[#15803d] border border-[#1ca34c]/20 hover:bg-[#1ca34c]/20 transition-all cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isAssignedToMe && task.status === 'processing' && (
                            <>
                              <button
                                onClick={() => handleUpdateStatus(task.id, 'completed')}
                                title="Mark Complete"
                                className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleUpdateStatus(task.id, 'pending')}
                                title="Cancel Work"
                                className="p-2.5 rounded-lg bg-rose-500/10 text-rose-600 border border-rose-500/20 hover:bg-rose-500/20 transition-all cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            title="Delete Task"
                            className="p-2.5 rounded-lg bg-rose-500/10 text-rose-600 border border-rose-500/20 hover:bg-rose-500/20 transition-all cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Description */}
                      {task.description && (
                        <p className="text-xs text-slate-500 pl-2.5 mb-4 leading-relaxed font-sans">{task.description}</p>
                      )}

                      {/* Details row */}
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

                      {/* Note / Remarks section */}
                      <div className="mt-4 pt-3 border-t border-slate-900/5 pl-2.5">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[9.5px] uppercase tracking-widest text-[#15803d] font-semibold flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5 text-[#15803d]" />
                            Notes & Remarks
                          </span>

                          <button
                            onClick={() => {
                              setEditingTaskId(task.id)
                              setEditingNoteValue(task.note || '')
                            }}
                            className="text-[10px] text-slate-500 hover:text-[#15803d] underline transition-colors"
                          >
                            Modify note
                          </button>
                        </div>

                        {editingTaskId === task.id ? (
                          <div className="mt-2 space-y-2">
                            <textarea
                              rows={2}
                              value={editingNoteValue}
                              onChange={(e) => setEditingNoteValue(e.target.value)}
                              placeholder="Add task status update details..."
                              className="w-full bg-white border border-[#1ca34c]/30 rounded-xl py-2 px-3 text-xs text-slate-900 focus:outline-none focus:border-[#1ca34c] resize-none"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleUpdateNote(task.id)}
                                className="px-3 py-1 bg-[#1ca34c] text-white font-semibold rounded-full text-[10px] uppercase"
                              >
                                Save Note
                              </button>
                              <button
                                onClick={() => setEditingTaskId(null)}
                                className="px-3 py-1 bg-white text-slate-500 rounded-lg text-[10px]"
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
                  No active operations logged under tasks.
                </div>
              )}
            </div>

          </div>

        </div>

      </div>

    </div>
  )
}
