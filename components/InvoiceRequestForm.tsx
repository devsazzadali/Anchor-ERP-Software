"use client"
import React, { useState } from 'react';

interface InvoiceRequestFormProps {
  onSubmit: (data: {
    title: string;
    description?: string;
    amount: number;
    currency?: string;
  }) => Promise<void>;
}

export default function InvoiceRequestForm({ onSubmit }: InvoiceRequestFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('BDT');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title || !amount) {
      setError('Title and amount are required');
      return;
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setError('Amount must be a positive number');
      return;
    }
    setLoading(true);
    try {
      await onSubmit({ title, description, amount: amt, currency });
      // reset fields
      setTitle('');
      setDescription('');
      setAmount('');
      setCurrency('BDT');
    } catch (err: any) {
      setError(err.message || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="glass-card p-4 rounded-xl space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">Create Invoice Request</h2>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div>
        <label className="block text-sm text-slate-600 mb-1">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-transparent border-b border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none"
          placeholder="Invoice title"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-600 mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-transparent border-b border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none"
          placeholder="Optional description"
        />
      </div>
      <div className="flex space-x-2">
        <div className="flex-1">
          <label className="block text-sm text-slate-600 mb-1">Amount</label>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-transparent border-b border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none"
            placeholder="0.00"
          />
        </div>
        <div className="w-24">
          <label className="block text-sm text-slate-600 mb-1">Currency</label>
          <input
            type="text"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className="w-full bg-transparent border-b border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none"
            placeholder="BDT"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-gradient-to-r from-[#d4af37] to-white text-black font-medium py-2 rounded-lg hover:opacity-90 transition"
      >
        {loading ? 'Submitting…' : 'Submit Request'}
      </button>
    </form>
  );
}
