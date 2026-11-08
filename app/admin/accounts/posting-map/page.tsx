'use client'

import React from 'react'
import { Map as MapIcon } from 'lucide-react'
import { PageHead } from '../ui'
import { useLanguage } from '@/lib/i18n/provider'

// Posting Map — the read-only map of how each kind of work becomes a
// journal entry (classes P1–P13). Lives under Accounts → Advanced.
// The English columns are the posting engine's contract, kept
// verbatim; the Bangla column is a plain-language summary.

const POSTING_MAP: Array<{ id: string; event: string; debit: string; credit: string; status: string; bangla: string }> = [
  { id: 'P1', event: 'Daily closing saved/closed', debit: 'Cash — Branch (cash sales + other cash-in); MFS & Card Clearing (digital sales)', credit: 'Sales Revenue; Other Income (other cash-in / counted excess); Cash Shortage is Dr on shortage', status: 'Live (A1)', bangla: 'দিনের বিক্রি ও নগদ লেনদেন খাতায় ওঠে; ঘাটতি হলে ঘাটতির এন্ট্রিও বসে।' },
  { id: 'P2', event: 'Branch cash expense (branch stream only)', debit: 'Branch Operating Expenses / mapped head account', credit: 'Cash — Branch (the drawer that bore it)', status: 'Live (A1)', bangla: 'শাখার drawer থেকে খরচ হলে ওই drawer-এর নগদ কমে, খরচের খাতে ওঠে।' },
  { id: 'P3', event: 'Ledger-head branch expense', debit: 'Expense account mapped from the ledger head', credit: 'Cash — Head Office (settled centrally; never the drawer)', status: 'Live (A1)', bangla: 'Head Office থেকে মেটানো শাখার খরচ — টাকা যায় Head Office-এর নগদ থেকে, drawer থেকে নয়।' },
  { id: 'P4', event: 'Company expense created / paid', debit: 'Company Operating / Setup Expenses (accrual); Accounts Payable (settlement)', credit: 'Accounts Payable (accrual); Cash — Head Office (settlement)', status: 'Live (A1)', bangla: 'খরচ তৈরি হলে দেনা জমে; শোধ হলে দেনা কমে, টাকা যায় Head Office-এর নগদ থেকে।' },
  { id: 'P5', event: 'Salary issued / voided', debit: 'Salary - Basic (5010)', credit: 'Cash — Head Office', status: 'Live (A1)', bangla: 'বেতন দিলে বেতনের খাতে খরচ ওঠে, টাকা যায় Head Office-এর নগদ থেকে; void হলে উল্টো এন্ট্রি বসে।' },
  { id: 'P6', event: 'Expense request paid', debit: 'Employee Expense Requests (5350)', credit: 'Cash — Branch (cash / mirror-booked) or MFS & Card Clearing', status: 'Live (A1)', bangla: 'কর্মীর খরচের আবেদন শোধ হলে সেই খাতে ওঠে; টাকা শাখার নগদ বা ডিজিটাল clearing থেকে যায়।' },
  { id: 'P7', event: 'Deposit approved / reversed', debit: 'Bank — <account> (lump on deposit date)', credit: 'Cash — Branch', status: 'Live (A1)', bangla: 'শাখার জমা অনুমোদন হলেই টাকা ব্যাংক খাতে ওঠে, শাখার নগদ কমে; ফেরত হলে উল্টো এন্ট্রি।' },
  { id: 'P8', event: 'Chalan created (costed only)', debit: 'Inventory — receiving branch (at cost)', credit: 'Inventory — head-office pool (at cost)', status: 'Live (A1)', bangla: 'cost বসানো chalan-এ মজুদ পাঠানো জায়গা থেকে পাওয়া শাখায় সরে — দামে নয়, cost-এ।' },
  { id: 'P9', event: 'Partner payout completed', debit: 'Partner Drawings — <partner>', credit: 'Cash — Head Office', status: 'Live (A1), no historical rows', bangla: 'partner-এর পাওনা শোধ হলে তাঁর drawings খাতে ওঠে, টাকা যায় Head Office-এর নগদ থেকে।' },
  { id: 'P10', event: 'Bundle request completed', debit: 'Cash in Transit', credit: 'Cash — Head Office', status: 'Live (A1), no historical rows', bangla: 'bundle-এর টাকা Head Office থেকে পথে (in transit) যায়।' },
  { id: 'P11', event: 'VAT / TDS on flagged events', debit: '—', credit: '—', status: 'Staged — A7 (register tables exist; dormant until rates are configured)', bangla: 'rate বসানো না থাকায় এখনো বন্ধ — rate এলে চিহ্নিত লেনদেনে ভ্যাট/টিডিএস-এর এন্ট্রি বসবে।' },
  { id: 'P12', event: 'Opening entry (one-time)', debit: 'Assets as confirmed', credit: 'Liabilities + Equity (balancing figure shown explicitly)', status: 'Live (A3) — confirming the opening position posts this entry, dated the cutover (1st of the month after the as-of month)', bangla: 'শুরুর অবস্থা confirm হলেই সম্পদ-দেনার শুরুর এন্ট্রি বসে — একবারই।' },
  { id: 'P13', event: 'Period-end adjustments', debit: 'As entered', credit: 'As entered', status: 'Live (A3) — fiscal-year rollover carries P&L balances to Retained Earnings from Accounts → Periods; other adjustments via manual entries in a later stage', bangla: 'বছর বন্ধে লাভ-ক্ষতি Retained Earnings-এ যায়; বাকি সমন্বয় manual এন্ট্রিতে বসে।' },
]

export default function PostingMapPage() {
  const { t } = useLanguage()
  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <PageHead
        icon={<MapIcon className="w-6 h-6 text-emerald-600" />}
        title={t.accounts.head.postingMap.title}
        bangla={t.accounts.head.postingMap.sub}
        tech={t.accounts.head.postingMap.tech} purpose={t.accounts.head.postingMap.purpose}
      />

      <div className="rounded-2xl border border-slate-200 overflow-x-auto bg-white">
        <table className="w-full text-sm min-w-[1080px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <th className="px-4 py-3 font-semibold">Map</th>
              <th className="px-4 py-3 font-semibold">Source event</th>
              <th className="px-4 py-3 font-semibold">Debit</th>
              <th className="px-4 py-3 font-semibold">Credit</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">সহজ ব্যাখ্যা</th>
            </tr>
          </thead>
          <tbody>
            {POSTING_MAP.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 align-top">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-500">{r.id}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{r.event}</td>
                <td className="px-4 py-3 text-slate-600">{r.debit}</td>
                <td className="px-4 py-3 text-slate-600">{r.credit}</td>
                <td className="px-4 py-3 text-slate-500">{r.status}</td>
                <td className="px-4 py-3 text-slate-600 font-bangla">{r.bangla}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
