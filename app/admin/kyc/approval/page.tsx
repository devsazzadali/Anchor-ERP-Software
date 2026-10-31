'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react';
import { Shield, Check, X, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function KycApprovalPage() {
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [admin, setAdmin] = useState<boolean>(false);

  // Check if current user is admin (identity via /api/auth/me)
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (!res.ok || !data.user) {
          setAdmin(false);
          setLoading(false);
          return;
        }
        setAdmin(!!data.is_admin);
      } catch (e: any) {
        setError(e.message);
        setAdmin(false);
      }
      setLoading(false);
    };
    checkAdmin();
  }, []);

  // Load pending KYC requests for admins
  useEffect(() => {
    if (!admin) return;
    const fetchPending = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/admin/kyc?status=pending');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch KYC requests');
        setPendingRequests(data.requests || []);
      } catch (e: any) {
        setError(e.message);
        setPendingRequests([]);
      }
      setLoading(false);
    };
    fetchPending();
    // realtime channel replaced with refetch on focus + 30s polling.
    const onFocus = () => fetchPending();
    window.addEventListener('focus', onFocus);
    const interval = setInterval(fetchPending, 30000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, [admin]);

  const handleDecision = async (id: string, newStatus: 'approved' | 'rejected') => {
    setLoading(true);
    const reqToUpdate = pendingRequests.find(r => r.id === id);

    // Both decisions go through the transactional decision route
    // (verification_requests + profiles updated together). This
    // lightweight page never collected a rejection reason, so a fixed
    // queue-level reason is recorded server-side.
    try {
      const res = await fetch(`/api/admin/kyc/${id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newStatus === 'approved'
          ? { action: 'approve' }
          : { action: 'reject', rejection_reason: 'Rejected from KYC approval queue' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Decision failed');

      // Optimistically update UI
      setPendingRequests(prev => prev.filter(req => req.id !== id));

      if (newStatus === 'approved' && reqToUpdate) {
        // Trigger email to user
        fetch('/api/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'KYC_APPROVED',
            payload: { userId: reqToUpdate.user_id, userName: reqToUpdate.full_name }
          })
        }).catch(e => console.error('Failed to trigger KYC email', e));
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white text-slate-900">
        <RefreshCw className="animate-spin w-8 h-8 mr-2" /> লোড হচ্ছে…
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white text-slate-900">
        <Shield className="w-6 h-6 mr-2" /> আপনি অ্যাডমিন নন – এই পেজে প্রবেশ করা যায় না।
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6">
      <h1 className="text-2xl font-bold text-center mb-6">KYC অনুরোধ অনুমোদন (Admin)</h1>
      {error && (
        <div className="p-4 mb-4 bg-rose-500/10 border border-rose-500/20 text-rose-600 rounded">
          {error}
        </div>
      )}
      {pendingRequests.length === 0 ? (
        <p className="text-center">অগ্রহীর কোনো pending KYC অনুরোধ নেই।</p>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full table-auto border-collapse min-w-[640px]">
          <thead className="bg-white">
            <tr>
              <th className="p-2 text-left">নাম</th>
              <th className="p-2 text-left">ফোন</th>
              <th className="p-2 text-left">প্রোফাইল টাইপ</th>
              <th className="p-2 text-left">ডকুমেন্ট</th>
              <th className="p-2 text-left">অ্যাকশন</th>
            </tr>
          </thead>
          <tbody>
            {pendingRequests.map(req => (
              <tr key={req.id} className="border-b border-slate-200">
                <td className="p-2">{req.full_name}</td>
                <td className="p-2">{req.phone_number}</td>
                <td className="p-2 capitalize">{req.profile_type}</td>
                <td className="p-2 space-x-2">
                  <a href={req.nid_front_url} target="_blank" rel="noopener" className="text-[#15803d] underline">
                    NID Front
                  </a>
                  <a href={req.nid_back_url} target="_blank" rel="noopener" className="text-[#15803d] underline">
                    NID Back
                  </a>
                  <a href={req.selfie_url} target="_blank" rel="noopener" className="text-[#15803d] underline">
                    Selfie
                  </a>
                </td>
                <td className="p-2 space-x-2">
                  <button
                    onClick={() => handleDecision(req.id, 'approved')}
                    className="px-3 py-2.5 bg-emerald-600 text-white rounded-lg hover:opacity-90 min-h-[40px]"
                  >
                    <Check className="inline w-4 h-4 mr-1" /> অনুমোদন
                  </button>
                  <button
                    onClick={() => handleDecision(req.id, 'rejected')}
                    className="px-3 py-2.5 bg-rose-600 text-white rounded-lg hover:opacity-90 min-h-[40px]"
                  >
                    <X className="inline w-4 h-4 mr-1" /> প্রত্যাখ্যান
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
