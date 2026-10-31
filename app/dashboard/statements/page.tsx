'use client'

export const dynamic = 'force-dynamic'

// app/dashboard/statements/page.tsx

import React, { useEffect, useState } from 'react';
// Sidebar import removed (handled by layout)
import { RefreshCw, Download, FileText, FileSpreadsheet } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { generatePdf } from '@/lib/pdf-generator';
import * as XLSX from 'xlsx';

// own payment requests + salary
// payments come from /api/me/financials (caller-scoped server-side).

interface Statement {
  id: string;
  invoice_title: string;
  amount: number;
  created_at: string;
  type: 'payout_request' | 'value_transfer';
}

export default function StatementsPage() {
  const [statements, setStatements] = useState<Statement[]>([]);
  const [activeTab, setActiveTab] = useState<'payout_request' | 'value_transfer'>('payout_request');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [userName, setUserName] = useState('User');

  const fetchStatements = async (userId?: string) => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/me/financials');
      if (!res.ok) throw new Error('Failed to fetch statements');
      const { paymentRequests: payoutData, salaryPayments: salaryData } = await res.json();

      const filteredPayouts = (payoutData as any[]).filter(
        (r) => r.status === 'completed' && r.invoice_title
      ).map(r => ({
        id: r.id,
        invoice_title: r.invoice_title,
        amount: r.amount,
        created_at: r.created_at || new Date().toISOString(),
        type: 'payout_request' as const
      }));

      const formattedSalaries = (salaryData || []).map((s: any) => ({
        id: s.id,
        invoice_title: 'Value Transfer / Direct Payment',
        amount: s.amount,
        created_at: s.payment_date || s.created_at || new Date().toISOString(),
        type: 'value_transfer' as const
      }));

      const combined = [...filteredPayouts, ...formattedSalaries].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setStatements(combined as Statement[]);
    } catch (e) {
      console.error('Error fetching statements:', e);
    }
    setIsRefreshing(false);
    setIsLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const { user } = await res.json();
        if (user) {
          setUserName(user.email?.split('@')[0] ?? 'User');
          fetchStatements(user.id);
          return;
        }
      }
      setIsLoading(false);
    };
    init();
  }, []);

  const handleRefresh = () => {
    if (!isRefreshing) fetchStatements();
  };

  const exportCSV = () => {
    if (statements.length === 0) {
      alert("No completed statements available to export.");
      return;
    }
    const csvContent = [
      ['Title', 'Amount (BDT)', 'Date'],
      ...statements.map(s => [
        `"${s.invoice_title}"`,
        s.amount,
        new Date(s.created_at).toLocaleDateString()
      ])
    ].map(e => e.join(",")).join("\n");
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `statements_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportExcel = () => {
    if (statements.length === 0) {
      alert("No completed statements available to export.");
      return;
    }
    try {
      const worksheet = XLSX.utils.json_to_sheet(statements.map(s => ({
        Title: s.invoice_title,
        'Amount (BDT)': s.amount,
        Date: new Date(s.created_at).toLocaleDateString()
      })));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Statements");
      XLSX.writeFile(workbook, `statements_${new Date().getTime()}.xlsx`);
    } catch (e) {
      console.error("Excel export error:", e);
      alert("Failed to export Excel.");
    }
  };

  const exportPDF = async () => {
    if (statements.length === 0) {
      alert("No completed statements available to export.");
      return;
    }
    try {
      const columns = ['Title', 'Amount (BDT)', 'Date'];
      const rows = statements.map(s => [
        s.invoice_title,
        s.amount.toLocaleString() + ' BDT',
        new Date(s.created_at).toLocaleDateString()
      ]);

      const totalAmount = statements.reduce((sum, s) => sum + Number(s.amount), 0);

      await generatePdf(`Statements History - ${userName}`, columns, rows, {
        summaryData: [
          { label: 'Total Statement Amount', value: `${totalAmount.toLocaleString()} BDT` }
        ],
        filename: `statements_${new Date().getTime()}.pdf`
      });
    } catch (e) {
      console.error("PDF export error:", e);
      alert("Failed to export PDF.");
    }
  };

  const exportIndividualStatementPDF = async (s: Statement) => {
    const rows = [
      ['Statement Title', s.invoice_title],
      ['Amount Disbursed', `${s.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BDT`],
      ['Statement Date', new Date(s.created_at).toLocaleDateString()]
    ];
    await generatePdf('Partner Statement Voucher', ['Specification', 'Details'], rows, {
      subtitle: `Official Statement Record - ID: ${s.id}`,
      preparedBy: 'Anchor ERP Finance',
      summaryData: [
        { label: 'Total Statement Amount', value: `${s.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BDT` }
      ],
      filename: `Statement_Voucher_${s.invoice_title.replace(/\s+/g, '_')}_${s.id}.pdf`
    });
  };

  return (
    <div className="min-h-screen flex bg-white text-slate-900 font-sans md:ml-64">
      {/* Neon gold background */}
      <div className="absolute top-[-10%] left-[20%] w-[50%] h-[50%] bg-[#1ca34c]/3 rounded-full filter blur-[150px] pointer-events-none" />
      
      <div className="flex-1 flex flex-col p-6 overflow-y-auto max-h-screen relative z-10">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 pb-4 border-b border-slate-900/5 gap-4">
          <div className="flex items-start gap-3">
            <span className="w-1.5 h-9 rounded-full bg-[#1ca34c] shrink-0" />
            <div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 font-serif">
              Statements for <span className="premium-text-gradient">{userName}</span>
            </h2>
            <p className="text-[11px] text-slate-500">Historic payment statements.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={exportCSV} className="px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/30 text-slate-500 hover:text-[#15803d] transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" title="Export CSV">
              <FileText className="w-3.5 h-3.5" /> <span className="hidden sm:inline">CSV</span>
            </button>
            <button onClick={exportExcel} className="px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/30 text-slate-500 hover:text-[#15803d] transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" title="Export Excel">
              <FileSpreadsheet className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Excel</span>
            </button>
            <button onClick={exportPDF} className="px-3 py-2 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/30 text-slate-500 hover:text-[#15803d] transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" title="Export PDF">
              <Download className="w-3.5 h-3.5" /> <span className="hidden sm:inline">PDF</span>
            </button>

            <div className="w-[1px] h-8 bg-slate-900/[0.07] mx-1 hidden sm:block"></div>

            <button
              onClick={handleRefresh}
              className={`p-3 rounded-xl bg-slate-900/[0.04] border border-slate-900/5 hover:border-[#1ca34c]/20 text-slate-500 hover:text-slate-900 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[#15803d]' : ''}`}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs for Payout Requests vs Issue Value Transfer */}
        <div className="flex bg-slate-900/[0.04] border border-slate-900/5 rounded-xl p-1 mb-6 w-fit mx-auto md:mx-0">
          <button
            onClick={() => setActiveTab('payout_request')}
            className={`px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all ${
              activeTab === 'payout_request'
                ? 'bg-[#1ca34c] text-white shadow-lg shadow-[#1ca34c]/20'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04]'
            }`}
          >
            Payout Requests
          </button>
          <button
            onClick={() => setActiveTab('value_transfer')}
            className={`px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all ${
              activeTab === 'value_transfer'
                ? 'bg-[#1ca34c] text-white shadow-lg shadow-[#1ca34c]/20'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04]'
            }`}
          >
            Issue Value Transfers
          </button>
        </div>

        <div className="glass-panel p-6 rounded-2xl overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-900/5 text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
                <th className="pb-3.5 pl-2">Title</th>
                <th className="pb-3.5">Amount (BDT)</th>
                <th className="pb-3.5">Date</th>
                <th className="pb-3.5 text-right pr-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/[0.08] text-xs">
              <AnimatePresence>
                {statements.filter(s => s.type === activeTab).map((s) => (
                  <motion.tr
                    key={s.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="hover:bg-slate-900/[0.04] transition-colors"
                  >
                    <td className="py-3 pl-2 font-medium">
                      <div className="font-semibold text-slate-900">{s.invoice_title}</div>
                    </td>
                    <td className="py-3 font-bold text-slate-900">
                      {s.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BDT
                    </td>
                    <td className="py-3 text-slate-500">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 text-right pr-2">
                      <button
                        type="button"
                        onClick={() => exportIndividualStatementPDF(s)}
                        className="px-2.5 py-1 rounded-lg bg-[#1ca34c]/10 hover:bg-[#1ca34c]/20 border border-[#1ca34c]/30 text-[#15803d] text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 transition-all cursor-pointer shadow-sm"
                      >
                        <Download className="w-3 h-3" />
                        Export PDF
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
              {statements.filter(s => s.type === activeTab).length === 0 && !isLoading && (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-500 text-xs italic">No statements found.</td>
                </tr>
              )}
              {isLoading && (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-500 text-xs">Loading statements...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
