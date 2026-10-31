'use client'

export const dynamic = 'force-dynamic'

// app/dashboard/invoice-requests/page.tsx
import React, { useEffect, useState } from 'react';
import InvoiceRequestForm from '@/components/InvoiceRequestForm';

// data flows through the converted
// /api/partner/invoice-request route (own requests only, partner
// gate enforced server-side). The realtime channel is replaced
// with refetch on mount + window focus + a 30s interval.

interface InvoiceRequest {
  id: string;
  title: string;
  description: string | null;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

export default function InvoiceRequestsPage() {
  const [requests, setRequests] = useState<InvoiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const fetchRequests = async () => {
    try {
      const res = await fetch('/api/partner/invoice-request');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to load requests');
      setRequests(body.invoiceRequests as InvoiceRequest[]);
    } catch (e: any) {
      setError(e.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    // Polling replaces the realtime subscription.
    const interval = setInterval(fetchRequests, 30000);
    const onFocus = () => fetchRequests();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const handleCreate = async (data: { title: string; description?: string; amount: number; currency?: string }) => {
    try {
      const res = await fetch('/api/partner/invoice-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: data.title,
          description: data.description,
          amount: data.amount,
          currency: data.currency ?? 'BDT',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to create request');
      // Refresh list
      fetchRequests();
    } catch (e: any) {
      setError(e.message || 'Failed to create request');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Invoice Requests</h1>
      {error && <p className="text-red-600">{error}</p>}
      <InvoiceRequestForm onSubmit={handleCreate} />
      <div className="space-y-4">
        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : (
          requests.map(req => (
            <div key={req.id} className="glass-card p-4 rounded-xl border border-slate-900/5">
              <h2 className="text-lg font-semibold text-slate-900">{req.title}</h2>
              {req.description && <p className="text-slate-600">{req.description}</p>}
              <p className="text-slate-700">{req.amount} {req.currency}</p>
              <p className="text-xs text-slate-500">Status: {req.status}</p>
              <p className="text-xs text-slate-600">Created: {new Date(req.created_at).toLocaleString()}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
