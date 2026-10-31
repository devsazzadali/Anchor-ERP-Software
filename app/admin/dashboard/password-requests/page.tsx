'use client';

export const dynamic = 'force-dynamic'
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Check, X, Clock, User, AlertCircle } from 'lucide-react';

interface ResetRequest {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  profiles: {
    full_name: string;
    role: string;
    profile_type: string;
  };
}

export default function PasswordRequestsAdmin() {
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      // requests + their profiles are merged server-side by
      // /api/admin/password-reset-requests (admin-gated).
      const res = await fetch('/api/admin/password-reset-requests');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch requests');
      setRequests(data.requests || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: 'approved' | 'rejected') => {
    setActionLoading(id);
    try {
      const res = await fetch('/api/admin/password-reset-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status');
      await fetchRequests(); // Refresh list
    } catch (err: any) {
      alert('Error updating status: ' + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <ShieldAlert className="w-8 h-8 text-[#8a6d1f]" />
            Password Reset Requests
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            Approve or reject security question-based password reset requests.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <div className="glass-panel p-12 rounded-2xl text-center border border-slate-900/5">
          <ShieldAlert className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">No Requests Found</h3>
          <p className="text-slate-500">There are currently no password reset requests.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {requests.map((req) => (
            <motion.div
              key={req.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-panel p-6 rounded-2xl relative shadow-xl overflow-hidden"
            >
              <div className={`absolute top-0 left-0 right-0 h-1 ${
                req.status === 'pending' ? 'bg-amber-400' :
                req.status === 'approved' ? 'bg-emerald-400' :
                req.status === 'completed' ? 'bg-blue-400' : 'bg-rose-500'
              }`} />

              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-900/[0.04] flex items-center justify-center">
                    <User className="w-5 h-5 text-[#8a6d1f]" />
                  </div>
                  <div>
                    <h3 className="text-slate-900 font-bold text-sm">{req.profiles?.full_name || 'Unknown User'}</h3>
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest">{req.profiles?.profile_type || req.profiles?.role}</span>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-1 rounded-full uppercase tracking-wider font-bold ${
                  req.status === 'pending' ? 'bg-amber-400/10 text-amber-600 border border-amber-400/20' :
                  req.status === 'approved' ? 'bg-emerald-400/10 text-emerald-600 border border-emerald-400/20' :
                  req.status === 'completed' ? 'bg-blue-400/10 text-blue-600 border border-blue-400/20' :
                  'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                }`}>
                  {req.status}
                </span>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Requested:</span>
                  <span className="text-slate-900 font-medium">{new Date(req.created_at).toLocaleString()}</span>
                </div>
              </div>

              {req.status === 'pending' && (
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => handleUpdateStatus(req.id, 'rejected')}
                    disabled={actionLoading === req.id}
                    className="flex-1 px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Reject
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(req.id, 'approved')}
                    disabled={actionLoading === req.id}
                    className="flex-1 px-4 py-2 bg-[#d4af37] hover:bg-[#c4a030] text-black rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    Approve
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
