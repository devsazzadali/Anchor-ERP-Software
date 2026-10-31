'use client'

export const dynamic = 'force-dynamic'
import React, { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
// Sidebar import removed (handled by layout)
import { motion } from 'framer-motion'
import { Landmark, Phone, Check, Clock, ShieldAlert, FileText, FileSearch, Download, FileSpreadsheet, Image as ImageIcon, CheckSquare, Square } from 'lucide-react'
import { generatePdf } from '@/lib/pdf-generator';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';

// own payment requests + salary
// payments come from /api/me/financials (caller-scoped server-side).

export default function UserTransactionsWrapper() {
  return (
    <Suspense fallback={<div>Loading transactions...</div>}>
      <UserTransactions />
    </Suspense>
  )
}

function UserTransactions() {
  const [requests, setRequests] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'payout_request' | 'value_transfer'>('payout_request')

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        const res = await fetch('/api/me/financials')
        if (!res.ok) throw new Error('Failed to fetch transactions')
        const { paymentRequests: payoutData, salaryPayments: salaryData } = await res.json()

        const formattedPayouts = (payoutData || []).map((t: any) => ({
          ...t,
          type: 'payout_request'
        }))

        const formattedSalaries = (salaryData || []).map((t: any) => ({
          ...t,
          type: 'value_transfer',
          invoice_title: `Value Transfer - ${t.month || 'Adhoc'}`,
          payment_method: t.payment_method || 'bank_transfer',
          status: 'completed',
          payment_details: {
            account_number: t.bank_account_number || t.bkash_number || '',
            mobile_number: t.bkash_number || ''
          }
        }))

        const combined = [...formattedPayouts, ...formattedSalaries].sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        setRequests(combined)
      } catch (err) {
        console.error('Error fetching transactions:', err)
      } finally {
        setIsLoading(false)
      }
    }
    
    fetchTransactions()
  }, [])

  const searchParams = useSearchParams();
  const highlightId = searchParams?.get('id');

  useEffect(() => {
    if (highlightId && requests.length > 0) {
      setTimeout(() => {
        const el = document.getElementById(`item-${highlightId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-[#d4af37]', 'ring-offset-2', 'ring-offset-white');
          setTimeout(() => {
            el.classList.remove('ring-2', 'ring-[#d4af37]', 'ring-offset-2', 'ring-offset-white');
          }, 3000);
          
          // Switch to the correct tab if it's a value transfer vs payout request
          const req = requests.find(r => r.id === highlightId);
          if (req && req.type) {
            setActiveTab(req.type);
          }
        }
      }, 100);
    }
  }, [highlightId, requests]);

  const displayRequests = requests.filter(r => r.type === activeTab)

  const handleTabChange = (tab: 'payout_request' | 'value_transfer') => {
    setActiveTab(tab)
    setSelectedReqs([])
  }

  const [selectedReqs, setSelectedReqs] = useState<string[]>([])

  const toggleSelection = (id: string) => {
    setSelectedReqs(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleAll = () => {
    if (selectedReqs.length === displayRequests.length && displayRequests.length > 0) {
      setSelectedReqs([])
    } else {
      setSelectedReqs(displayRequests.map(r => r.id))
    }
  }

  const getSelectedData = () => {
    return displayRequests.filter(r => selectedReqs.includes(r.id));
  };

  const exportCSV = () => {
    const data = getSelectedData();
    if (data.length === 0) return alert("Select at least one transaction.");
    const csvContent = [
      ['Title', 'Method', 'Account/Number', 'Amount', 'Currency', 'Status', 'Transaction ID', 'Request Date', 'Process Date', 'Completed Date'],
      ...data.map(s => [
        `"${s.invoice_title}"`,
        s.payment_method,
        `"${s.payment_method === 'bank_transfer' ? (s.payment_details?.account_number || 'N/A') : (s.payment_details?.mobile_number || 'N/A')}"`,
        s.amount,
        s.currency,
        s.status,
        s.transaction_id || 'N/A',
        new Date(s.created_at).toLocaleDateString('en-GB'),
        ['processing', 'completed'].includes(s.status) ? new Date(s.completed_at || s.updated_at || s.created_at).toLocaleDateString('en-GB') : 'N/A',
        s.status === 'completed' ? new Date(s.completed_at || s.updated_at || s.created_at).toLocaleDateString('en-GB') : 'N/A'
      ])
    ].map(e => e.join(",")).join("\n");
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `transactions_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportExcel = () => {
    const data = getSelectedData();
    if (data.length === 0) return alert("Select at least one transaction.");
    try {
      const worksheet = XLSX.utils.json_to_sheet(data.map(s => ({
        Title: s.invoice_title,
        Method: s.payment_method,
        'Account/Number': s.payment_method === 'bank_transfer' ? (s.payment_details?.account_number || 'N/A') : (s.payment_details?.mobile_number || 'N/A'),
        Amount: s.amount,
        Currency: s.currency,
        Status: s.status,
        'Transaction ID': s.transaction_id || 'N/A',
        'Request Date': new Date(s.created_at).toLocaleDateString('en-GB'),
        'Process Date': ['processing', 'completed'].includes(s.status) ? new Date(s.completed_at || s.updated_at || s.created_at).toLocaleDateString('en-GB') : 'N/A',
        'Completed Date': s.status === 'completed' ? new Date(s.completed_at || s.updated_at || s.created_at).toLocaleDateString('en-GB') : 'N/A'
      })));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");
      XLSX.writeFile(workbook, `transactions_${new Date().getTime()}.xlsx`);
    } catch (e) {
      console.error(e);
      alert("Failed to export Excel.");
    }
  };

  const exportPDF = async () => {
    const data = getSelectedData();
    if (data.length === 0) return alert("Select at least one transaction.");
    try {
      const columns = ['Title', 'Account/Number', 'Amount', 'Status', 'Trx ID', 'Request Date', 'Completed Date'];
      const rows = data.map(s => [
        s.invoice_title,
        s.payment_method === 'bank_transfer' ? (s.payment_details?.account_number || 'N/A') : (s.payment_details?.mobile_number || 'N/A'),
        `${s.amount} ${s.currency}`,
        s.status.toUpperCase(),
        s.transaction_id || 'N/A',
        new Date(s.created_at).toLocaleDateString('en-GB'),
        s.status === 'completed' ? new Date(s.completed_at || s.updated_at || s.created_at).toLocaleDateString('en-GB') : 'N/A'
      ]);

      const totalsMap = data.reduce((acc: Record<string, number>, s) => {
        const curr = s.currency || 'BDT';
        acc[curr] = (acc[curr] || 0) + Number(s.amount);
        return acc;
      }, {});

      const summaryData = Object.entries(totalsMap).map(([curr, amt]) => ({
        label: `Total (${curr})`,
        value: `${Number(amt).toLocaleString()} ${curr}`
      }));

      await generatePdf('Transaction Ledger', columns, rows, {
        summaryData,
        filename: `transactions_${new Date().getTime()}.pdf`
      });
    } catch (e) {
      console.error(e);
      alert("Failed to export PDF.");
    }
  };

  const exportPNG = async () => {
    const data = getSelectedData();
    if (data.length === 0) return alert("Select at least one transaction.");
    const el = document.getElementById('png-export-container');
    if (!el) return;
    el.style.display = 'block';
    try {
      const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2 });
      const link = document.createElement('a');
      link.download = `transactions_${new Date().getTime()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error(e);
      alert('Failed to generate PNG snapshot.');
    } finally {
      el.style.display = 'none';
    }
  }

  const exportIndividualVoucherPDF = async (req: any) => {
    const details = req.payment_details || {}
    const rows = [
      ['Title / Description', req.invoice_title],
      ['Payment Method', req.payment_method === 'bank_transfer' ? 'Bank Protocol' : req.payment_method],
      ['Destination Account', req.payment_method === 'bank_transfer' ? (details.account_number || 'N/A') : (details.mobile_number || 'N/A')],
      ['Amount Disbursed', `${Number(req.amount).toLocaleString()} ${req.currency || 'BDT'}`],
      ['Status', req.status.toUpperCase()],
      ['Transaction ID', req.transaction_id || 'N/A'],
      ['Request Date', new Date(req.created_at).toLocaleDateString('en-GB')],
      ['Completed Date', req.status === 'completed' ? new Date(req.completed_at || req.updated_at || req.created_at).toLocaleDateString('en-GB') : 'N/A']
    ]
    await generatePdf('Partner Payout Receipt Voucher', ['Specification', 'Details'], rows, {
      subtitle: `Official Transaction Record - Trx: ${req.transaction_id || req.id}`,
      preparedBy: 'Anchor ERP Finance',
      summaryData: [
        { label: 'Net Disbursed Amount', value: `${Number(req.amount).toLocaleString()} ${req.currency || 'BDT'}` }
      ],
      filename: `Payout_Receipt_${req.invoice_title.replace(/\s+/g, '_')}_${req.transaction_id || req.id}.pdf`
    })
  }

  return (
    <div className="min-h-screen w-full flex flex-col bg-white text-slate-900 font-sans relative overflow-hidden">
      <div className="absolute top-[-10%] right-[-5%] w-[50%] h-[50%] bg-[#d4af37]/5 rounded-full filter blur-[150px] pointer-events-none" />

      <div className="flex-1 p-6 lg:p-10 overflow-y-auto max-h-screen relative z-10 w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 pb-4 border-b border-slate-900/5 gap-4">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-serif">
                Payout <span className="premium-text-gradient">Ledger</span>
              </h2>
              <p className="text-xs text-slate-500 mt-1">Track your clearance requests, completed transactions, and liquidity statuses.</p>
            </div>
            
            <div className="flex items-center gap-2 bg-slate-900/[0.04] border border-slate-900/5 rounded-xl p-1 overflow-x-auto w-fit">
              <button
                onClick={() => handleTabChange('payout_request')}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                  activeTab === 'payout_request'
                    ? 'bg-[#d4af37] text-black shadow-lg shadow-[#d4af37]/20'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04]'
                }`}
              >
                Payout Requests
              </button>
              <button
                onClick={() => handleTabChange('value_transfer')}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                  activeTab === 'value_transfer'
                    ? 'bg-[#d4af37] text-black shadow-lg shadow-[#d4af37]/20'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04]'
                }`}
              >
                Value Transfers
              </button>
            </div>
          </div>

          <div className="flex items-center min-h-[44px]">
            {selectedReqs.length > 0 && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-wrap items-center gap-2 bg-[#d4af37]/10 border border-[#d4af37]/20 p-2 rounded-xl">
                <span className="text-[#8a6d1f] text-xs font-bold px-2">{selectedReqs.length} Selected</span>
              <button onClick={exportCSV} className="px-3 py-1.5 rounded-lg bg-white hover:bg-white text-slate-900 transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-bold uppercase" title="Export CSV">
                <FileText className="w-3.5 h-3.5" /> CSV
              </button>
              <button onClick={exportExcel} className="px-3 py-1.5 rounded-lg bg-white hover:bg-white text-slate-900 transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-bold uppercase" title="Export Excel">
                <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
              </button>
              <button onClick={exportPDF} className="px-3 py-1.5 rounded-lg bg-white hover:bg-white text-slate-900 transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-bold uppercase" title="Export PDF">
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
              <button onClick={exportPNG} className="px-3 py-1.5 rounded-lg bg-white hover:bg-white text-slate-900 transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-bold uppercase" title="Export PNG">
                <ImageIcon className="w-3.5 h-3.5" /> PNG
              </button>
            </motion.div>
          )}
          </div>
        </div>

        {!isLoading && displayRequests.length > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <button onClick={toggleAll} className="flex items-center justify-center text-slate-500 hover:text-[#8a6d1f] transition-colors focus:outline-none">
              {selectedReqs.length === displayRequests.length && displayRequests.length > 0 ? (
                <CheckSquare className="w-5 h-5 text-[#8a6d1f]" />
              ) : (
                <Square className="w-5 h-5" />
              )}
            </button>
            <span className="text-xs text-slate-500 font-semibold cursor-pointer select-none" onClick={toggleAll}>Select All</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin mb-4" />
            <span className="text-xs tracking-wider uppercase">Syncing Ledger...</span>
          </div>
        ) : displayRequests.length === 0 ? (
          <div className="glass-panel p-12 rounded-2xl text-center text-slate-500 italic text-sm shadow-xl flex flex-col items-center gap-3">
            <FileSearch className="w-8 h-8 text-slate-600" />
            No {activeTab === 'value_transfer' ? 'value transfers' : 'payout requests'} found in your ledger.
          </div>
        ) : (
          <div className="space-y-5">
            {displayRequests.map(req => {
              const details = req.payment_details || {}
              
              // Status formatting
              const isCompleted = req.status === 'completed'
              const isPendingOrProcessing = ['pending', 'processing'].includes(req.status)
              const isRejected = req.status === 'rejected'
              const isFlagged = ['hold', 'fraud_flagged'].includes(req.status)

              let statusColor = 'text-slate-500 bg-slate-100 border-slate-300'
              let StatusIcon = Clock

              if (isCompleted) {
                statusColor = 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20'
                StatusIcon = Check
              } else if (isPendingOrProcessing) {
                statusColor = 'text-amber-600 bg-amber-500/10 border-amber-500/20'
                StatusIcon = Clock
              } else if (isRejected || isFlagged) {
                statusColor = 'text-rose-600 bg-rose-500/10 border-rose-500/20'
                StatusIcon = ShieldAlert
              }

              return (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={req.id} 
                  id={`item-${req.id}`}
                  className="glass-panel p-5 rounded-2xl relative shadow-xl hover:border-slate-900/10 transition-all border border-slate-900/5"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => toggleSelection(req.id)}
                        className="flex items-center justify-center text-slate-500 hover:text-[#8a6d1f] transition-colors focus:outline-none shrink-0"
                      >
                        {selectedReqs.includes(req.id) ? (
                          <CheckSquare className="w-5 h-5 text-[#8a6d1f]" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                      </button>
                      <div className="w-12 h-12 rounded-xl bg-white border border-slate-900/5 flex items-center justify-center shrink-0">
                        {req.payment_method === 'bank_transfer' ? (
                          <Landmark className="w-5 h-5 text-[#8a6d1f]" />
                        ) : (
                          <Phone className="w-5 h-5 text-[#8a6d1f]" />
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 mb-0.5">{req.invoice_title}</h4>
                        <p className="text-[10px] text-slate-500 font-mono uppercase">
                          {req.payment_method === 'bank_transfer' ? `${details.bank_name || 'Bank'} • ${details.account_number || ''}` : `${req.payment_method} • ${details.mobile_number || ''}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col md:items-end gap-2">
                      <div className="text-lg font-bold text-slate-900">
                        {Number(req.amount).toLocaleString()} <span className="text-xs text-slate-500">{req.currency}</span>
                      </div>
                      <div className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider flex items-center gap-1.5 border w-fit ${statusColor}`}>
                        <StatusIcon className="w-3 h-3" />
                        {req.status}
                      </div>
                    </div>

                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-900/5 flex flex-wrap gap-x-6 gap-y-2 text-[10px] text-slate-500">
                    <div><span className="font-semibold text-slate-500">Date:</span> {new Date(req.created_at).toLocaleDateString()}</div>
                    <div><span className="font-semibold text-slate-500">Invoice:</span> {req.invoice_number}</div>
                    {req.transaction_id && (
                      <div><span className="font-semibold text-[#8a6d1f]">Trx ID:</span> {req.transaction_id}</div>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => exportIndividualVoucherPDF(req)}
                        className="px-3 py-1.5 rounded-lg bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 text-[#8a6d1f] text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                      >
                        <Download className="w-3 h-3" />
                        Export Voucher (PDF)
                      </button>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        <div id="png-export-container" style={{ display: 'none', padding: '30px', backgroundColor: '#ffffff', color: '#17181c', width: '1000px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '20px', color: '#8a6d1f', fontFamily: 'serif' }}>Transaction Ledger Statement</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontFamily: 'sans-serif' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                <th style={{ padding: '10px' }}>Title</th>
                <th style={{ padding: '10px' }}>Account/Number</th>
                <th style={{ padding: '10px' }}>Amount</th>
                <th style={{ padding: '10px' }}>Status</th>
                <th style={{ padding: '10px' }}>Transaction ID</th>
                <th style={{ padding: '10px' }}>Request Date</th>
                <th style={{ padding: '10px' }}>Completed Date</th>
              </tr>
            </thead>
            <tbody>
              {getSelectedData().map(req => (
                <tr key={req.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                  <td style={{ padding: '10px' }}>{req.invoice_title}</td>
                  <td style={{ padding: '10px' }}>{req.payment_method === 'bank_transfer' ? (req.payment_details?.account_number || 'N/A') : (req.payment_details?.mobile_number || 'N/A')}</td>
                  <td style={{ padding: '10px', fontWeight: 'bold', color: '#17181c' }}>{req.amount} {req.currency}</td>
                  <td style={{ padding: '10px', textTransform: 'uppercase' }}>{req.status}</td>
                  <td style={{ padding: '10px' }}>{req.transaction_id || 'N/A'}</td>
                  <td style={{ padding: '10px', color: '#64748b' }}>{new Date(req.created_at).toLocaleString()}</td>
                  <td style={{ padding: '10px', color: '#64748b' }}>{req.status === 'completed' ? new Date(req.updated_at).toLocaleString() : 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: '30px', fontSize: '10px', color: '#94a3b8', textAlign: 'center' }}>Generated by Anchor ERP Payment Management</p>
        </div>

      </div>
    </div>
  )
}
