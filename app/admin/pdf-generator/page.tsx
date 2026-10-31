'use client'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */


import React, { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileOutput, Download, Printer, Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered,
  ChevronDown, Type, Quote, Heading1, Heading2, Heading3,
  FileText, Undo, Redo, Palette, X, Check, Wand2, ZoomIn, ZoomOut,
  RefreshCw, Settings2, Table as TableIcon, Minus, Eye, Edit3, Maximize2,
  Columns, Sliders
} from 'lucide-react'

// ─── Document Templates (Bengali & English Corporate ERP Standards) ──────────
const TEMPLATES: Record<string, { name: string; icon: string; title: string; content: string }> = {
  blank: {
    name: 'Blank Document / ফাঁকা নথি',
    icon: '📄',
    title: 'OFFICIAL DOCUMENT',
    content: '<p style="font-size:14px; color:#1e293b; line-height:2">এখানে আপনার ডকুমেন্টের বিষয়বস্তু লিখুন...</p>',
  },
  notice: {
    name: 'Notice / নোটিশ',
    icon: '📢',
    title: 'OFFICIAL NOTICE / নোটিশ',
    content: `
      <p style="text-align:center; font-size:15px; margin-bottom:14px;"><strong>বিষয়: &nbsp;ঈদুল ফিতর উপলক্ষে অফিস ছুটি সংক্রান্ত নোটিশ</strong></p>
      <p style="text-align:justify; line-height:2.0; margin-bottom:12px;">এতদ্বারা Anchor Fashion-এর প্রধান কার্যালয়সহ সকল শাখা অফিসের সর্বস্তরের কর্মকর্তা ও কর্মচারীদের অবগতির জন্য জানানো যাচ্ছে যে, পবিত্র ঈদুল ফিতর উপলক্ষে আগামী [তারিখ উল্লেখ করুন] হতে [তারিখ উল্লেখ করুন] পর্যন্ত প্রতিষ্ঠানের সকল কার্যক্রম বন্ধ থাকবে।</p>
      <p style="text-align:justify; line-height:2.0; margin-bottom:12px;">ছুটি শেষে আগামী [তারিখ উল্লেখ করুন] রোজ [বারের নাম] সকাল ৯:০০ ঘটিকা হতে যথারীতি অফিস কার্যক্রম পুনরায় চালু হবে। ছুটির পূর্বে সকল শাখার হিসাব-নিকাশ ও ক্যাশ ক্লোজিং সম্পন্ন করার জন্য শাখা ব্যবস্থাপকদের অনুরোধ জানানো হলো।</p>
      <p style="margin-top:16px; line-height:2.0;">কর্তৃপক্ষের অনুমোদনক্রমে এই নোটিশ জারি করা হলো এবং সকলের প্রতি ঈদের শুভেচ্ছা জ্ঞাপন করা হলো।</p>
    `.trim(),
  },
  order: {
    name: 'Office Order / অফিস আদেশ',
    icon: '📋',
    title: 'OFFICE ORDER / অফিস আদেশ',
    content: `
      <p style="text-align:center; font-size:15px; margin-bottom:14px;"><strong>বিষয়: &nbsp;শাখা হিসাব ব্যবস্থাপনা ও দৈনিক রিপোর্ট প্রদান সংক্রান্ত নির্দেশনা</strong></p>
      <p style="text-align:justify; line-height:2.0; margin-bottom:12px;">প্রতিষ্ঠানের অভ্যন্তরীণ হিসাবরক্ষণ প্রক্রিয়া আরও সুশৃঙ্খল ও জবাবদিহিতামূলক করার স্বার্থে যথাযথ কর্তৃপক্ষের নির্দেশক্রমে নিম্নরূপ নির্দেশনা জারি করা হলো:</p>
      <ol style="line-height:2.1; margin-left:24px; margin-bottom:14px;">
        <li>প্রতিদিন রাত ৮:০০ ঘটিকার মধ্যে সকল শাখাকে তাদের দৈনিক বিক্রয়, নগদ জমা ও খরচের হিসাব Anchor ERP সিস্টেমে এন্ট্রি করতে হবে।</li>
        <li>অনুমোদিত ভাউচার ব্যতীত কোনো প্রকার শাখা ব্যয় বা অগ্রিম প্রদান সম্পূর্ণরূপে নিষিদ্ধ।</li>
        <li>ব্যাংক ডিপোজিট স্লিপ সংশ্লিষ্ট শাখায় তাৎক্ষণিকভাবে স্ক্যান করে সিস্টেমে আপলোড নিশ্চিত করতে হবে।</li>
      </ol>
      <p style="text-align:justify; line-height:2.0;">উপরোক্ত নির্দেশনাসমূহ অবিলম্বে কার্যকর হবে। সংশ্লিষ্ট সকলকে এ আদেশ কঠোরভাবে অনুসরণের নির্দেশ দেওয়া হলো।</p>
    `.trim(),
  },
  certificate: {
    name: 'Certificate / প্রত্যয়নপত্র',
    icon: '🏅',
    title: 'CERTIFICATE / প্রত্যয়নপত্র',
    content: `
      <p style="text-align:center; font-size:16px; font-weight:bold; margin-bottom:18px; letter-spacing:0.04em;">প্রত্যয়নপত্র (TO WHOM IT MAY CONCERN)</p>
      <p style="text-align:justify; line-height:2.1; margin-bottom:14px;">এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, জনাব / জনাবা <strong>[কর্মকর্তার পূর্ণ নাম]</strong>, পিতা: [পিতার নাম], মাতা: [মাতার নাম], আমাদের প্রতিষ্ঠানে <strong>[পদবী]</strong> হিসেবে গত [যোগদানের তারিখ] হতে অদ্যাবধি সততা ও নিষ্ঠার সাথে কর্মরত আছেন।</p>
      <p style="text-align:justify; line-height:2.1; margin-bottom:14px;">কর্মকালীন সময়ে তাঁর আচরণ ও দায়িত্বপালন অত্যন্ত প্রশংসনীয়। আমাদের জানামতে তিনি কোনো প্রতিষ্ঠান-বিরোধী বা শৃঙ্খলা-পরিপন্থী কর্মকাণ্ডে কখনোই জড়িত ছিলেন না। তাঁর বর্তমান মাসিক বেতন ও ভাতাদি নিয়মিত পরিশোধ করা হয়।</p>
      <p style="text-align:justify; line-height:2.1;">তাঁর ভবিষ্যৎ জীবনের সার্বিক উন্নতি ও সাফল্য কামনা করা যাচ্ছে। এই প্রত্যয়নপত্র তাঁর ব্যক্তিগত/অফিসিয়াল প্রয়োজনে কর্তৃপক্ষের অনুরোধে প্রদান করা হলো।</p>
    `.trim(),
  },
  memo: {
    name: 'Internal Memo / স্মারকপত্র',
    icon: '📝',
    title: 'INTERNAL MEMO / স্মারকপত্র',
    content: `
      <div style="border-bottom:1px solid #d0d6e0; padding-bottom:10px; margin-bottom:16px; line-height:1.9;">
        <p><strong>প্রতি (To):</strong> &nbsp;সকল বিভাগীয় প্রধান ও শাখা ব্যবস্থাপক</p>
        <p><strong>থেকে (From):</strong> &nbsp;অর্থ ও প্রশাসন বিভাগ, প্রধান কার্যালয়</p>
        <p><strong>বিষয় (Subject):</strong> &nbsp;মাসিক আর্থিক ক্লোজিং এবং ভাউচার নিরীক্ষা সংক্রান্ত</p>
      </div>
      <p style="text-align:justify; line-height:2.0; margin-bottom:12px;">চলতি মাসের হিসাব ক্লোজিং প্রক্রিয়ার অংশ হিসেবে সকল শাখার মাসিক ব্যয় বিবরণী, ভাউচার ফাইল এবং ব্যাংক বিবরণী আগামী [তারিখ উল্লেখ করুন] তারিখের মধ্যে প্রধান কার্যালয়ের অডিট বিভাগে প্রেরণের নির্দেশ দেওয়া যাচ্ছে।</p>
      <p style="text-align:justify; line-height:2.0;">কোনো প্রকার গরমিল বা অমিল পরিলক্ষিত হলে শাখা হিসাবরক্ষককে তাৎক্ষণিকভাবে জবাবদিহি করতে হবে। এ বিষয়ে সকলের সহযোগিতা একান্ত কাম্য।</p>
    `.trim(),
  },
  salary: {
    name: 'Salary Approval / বেতন অনুমোদন',
    icon: '💰',
    title: 'SALARY DISBURSEMENT / বেতন অনুমোদন পত্র',
    content: `
      <p style="text-align:center; font-size:15px; margin-bottom:14px;"><strong>বিষয়: &nbsp;কর্মকর্তা ও কর্মচারীদের মাসিক বেতন ও ভাতাদি প্রদান অনুমোদন</strong></p>
      <p style="text-align:justify; line-height:2.0; margin-bottom:14px;">হিসাব বিভাগ কর্তৃক প্রস্তুতকৃত চলতি মাসের বেতন বিল যথাযথভাবে নিরীক্ষাপূর্বক উপযুক্ত কর্তৃপক্ষের অনুমোদনক্রমে নিম্নরূপভাবে অর্থ ছাড় করার নির্দেশ প্রদান করা হলো:</p>
      <table style="width:100%; border-collapse:collapse; margin:14px 0; font-size:12px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:center; width:40px;">ক্র.</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:left;">কর্মকর্তা / কর্মচারীর নাম</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:left;">পদবী ও শাখা</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:right;">মূল বেতন (BDT)</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:right;">মোট প্রদেয় (BDT)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:center;">০১</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">[কর্মকর্তার নাম ০১]</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">শাখা ব্যবস্থাপক (মিরপুর)</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:right;">৪৫,০০০.০০</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:right; font-weight:bold; color:#0f3057;">৪৫,০০০.০০</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:center;">০২</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">[কর্মকর্তার নাম ০২]</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">হিসাব কর্মকর্তা (উত্তরা)</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:right;">৩৫,০০০.০০</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:right; font-weight:bold; color:#0f3057;">৩৫,০০০.০০</td>
          </tr>
        </tbody>
      </table>
      <p style="text-align:justify; line-height:2.0; margin-top:12px;">ট্রেজারি ও ব্যাংক অ্যাকাউন্ট হতে সরাসরি সংশ্লিষ্ট কর্মকর্তা-কর্মচারীদের ব্যাংক একাউন্টে বিএফটিএন / অনলাইন ট্রান্সফারের মাধ্যমে অর্থ প্রেরণের জন্য অনুরোধ করা যাচ্ছে।</p>
    `.trim(),
  },
  expense: {
    name: 'Expense Approval / খরচ অনুমোদন',
    icon: '📑',
    title: 'EXPENSE APPROVAL / খরচ অনুমোদন ভাউচার',
    content: `
      <p style="text-align:center; font-size:15px; margin-bottom:14px;"><strong>বিষয়: &nbsp;শাখা পরিচালন ও রক্ষণাবেক্ষণ ব্যয় অনুমোদন প্রসঙ্গে</strong></p>
      <p style="text-align:justify; line-height:2.0; margin-bottom:14px;">শাখা কার্যালয় কর্তৃক জমাকৃত নিম্নবর্ণিত জরুরি পরিচালন ব্যয়ের রসিদ ও ভাউচারাদি নিরীক্ষান্তে উপযুক্ত কর্তৃপক্ষের সিদ্ধান্ত মোতাবেক অনুমোদন প্রদান করা হলো:</p>
      <table style="width:100%; border-collapse:collapse; margin:14px 0; font-size:12px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:center; width:40px;">ক্র.</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:left;">ব্যয়ের খাত ও বিবরণ</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:left;">অনুরোধকারী শাখা</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:center;">তারিখ</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:right;">অনুমোদিত অর্থ (BDT)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:center;">০১</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">অফিস বিদ্যুৎ ও ইউটিলিটি বিল</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">বনানী শাখা</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:center;">[তারিখ]</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:right; font-weight:bold; color:#0f3057;">১২,৫০০.০০</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:center;">০২</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">জরুরি স্টেশনারি ও প্রিন্টিং মালামাল ক্রয়</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">ধানমন্ডি শাখা</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:center;">[তারিখ]</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:right; font-weight:bold; color:#0f3057;">৪,২০০.০০</td>
          </tr>
        </tbody>
      </table>
      <p style="text-align:justify; line-height:2.0; margin-top:12px;">অনুমোদিত অর্থ অবিলম্বে পেটি ক্যাশ অথবা ব্যাংক হতে পরিশোধের ব্যবস্থা গ্রহণের নির্দেশ দেওয়া হলো।</p>
    `.trim(),
  },
}

// ─── Font Options with Proper CSS Variables for Bengali ──────────────────────
const FONT_FAMILIES = [
  {
    label: 'Hind Siliguri (বাংলা)',
    value: "var(--font-hind-siliguri), 'Hind Siliguri', 'Noto Sans Bengali', sans-serif",
  },
  {
    label: 'Noto Sans Bengali (বাংলা)',
    value: "var(--font-noto-sans-bengali), 'Noto Sans Bengali', 'Hind Siliguri', sans-serif",
  },
  {
    label: 'Inter (English)',
    value: "'Inter', sans-serif",
  },
  {
    label: 'Times New Roman',
    value: "'Times New Roman', serif",
  },
  {
    label: 'Georgia',
    value: "Georgia, serif",
  },
]

const FONT_SIZES = ['11px', '12px', '13px', '14px', '15px', '16px', '18px', '20px', '22px', '24px', '28px', '32px']

const COLORS = [
  { label: 'Navy', value: '#0f3057' },
  { label: 'Black', value: '#16171a' },
  { label: 'Slate', value: '#1e293b' },
  { label: 'Gold', value: '#d4af37' },
  { label: 'Red', value: '#b92626' },
  { label: 'Green', value: '#127338' },
  { label: 'Gray', value: '#64748b' },
  { label: 'Blue', value: '#1d4ed8' },
]

// ─── Helper: Generate Crystal Clear Watermark SVG Data URL ───────────────────
const getWatermarkSvgDataUrl = (text: string, opacity: number = 0.14) => {
  const cleanText = (text || 'ANCHOR FASHION').trim().toUpperCase()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
    <text x="120" y="60" fill="#0f3057" fill-opacity="${opacity}" font-size="13" font-weight="700" font-family="Helvetica, Arial, sans-serif" text-anchor="middle" transform="rotate(-30 120 60)" letter-spacing="2.5">
      ${cleanText}
    </text>
  </svg>`
  if (typeof window !== 'undefined') {
    try {
      return `url("data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(svg)))}")`
    } catch {
      return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
    }
  }
  return ''
}

// ─── Live Mirror Component ───────────────────────────────────────────────────
function LiveMirror({
  editorRef,
  fontFamily,
}: {
  editorRef: React.RefObject<HTMLDivElement | null>
  fontFamily: string
}) {
  const mirrorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const editor = editorRef.current
    const mirror = mirrorRef.current
    if (!editor || !mirror) return

    const sync = () => {
      mirror.innerHTML =
        editor.innerHTML ||
        '<p style="color:#94a3b8; font-size:13px; font-style:italic">এখানে আপনার ডকুমেন্টের বিষয়বস্তু দেখা যাবে — বাম পাশে লিখুন বা টেমপ্লেট নির্বাচন করুন।</p>'
    }
    sync()
    editor.addEventListener('input', sync)
    return () => editor.removeEventListener('input', sync)
  }, [editorRef])

  return (
    <div
      ref={mirrorRef}
      style={{
        fontFamily,
        lineHeight: 1.95,
        fontSize: '13.5px',
        color: '#16171a',
        minHeight: '340px',
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
      }}
      className="[&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-[#0f3057] [&_h1]:mt-3 [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-[#0f3057] [&_h2]:mt-2.5 [&_h2]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:mb-2.5 [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:mb-2.5 [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:mb-2.5 [&_li]:mb-1 [&_blockquote]:border-l-4 [&_blockquote]:border-[#d4af37] [&_blockquote]:pl-4 [&_blockquote]:py-2 [&_blockquote]:bg-[#fdf8ec] [&_blockquote]:rounded-r [&_blockquote]:italic [&_blockquote]:my-3 [&_strong]:font-bold [&_em]:italic [&_u]:underline [&_hr]:border-[#d0d6e0] [&_hr]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_th]:border [&_th]:border-[#cbd5e1] [&_th]:p-2 [&_th]:bg-[#f1f5f9] [&_td]:border [&_td]:border-[#cbd5e1] [&_td]:p-2"
    />
  )
}

// ─── Main PDF Generator Page ─────────────────────────────────────────────────
export default function PdfGeneratorPage() {
  const editorRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const previewContainerRef = useRef<HTMLDivElement>(null)

  // Document State
  const [activeTemplate, setActiveTemplate] = useState('notice')
  const [docTitle, setDocTitle] = useState('OFFICIAL NOTICE / নোটিশ')
  const [docRef, setDocRef] = useState(`REF-${Date.now().toString().slice(-8)}`)
  const [docBranch, setDocBranch] = useState('All Branches')
  const [docPreparedBy, setDocPreparedBy] = useState('Operations Management')
  const [docDate, setDocDate] = useState(
    new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  )

  // Watermark Settings (Prominent & Adjustable)
  const [showWatermark, setShowWatermark] = useState(true)
  const [watermarkText, setWatermarkText] = useState('ANCHOR FASHION')
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.14)

  // Section Toggles
  const [showAddressCard, setShowAddressCard] = useState(true)
  const [showSignature, setShowSignature] = useState(true)
  const [showNotesBox, setShowNotesBox] = useState(false)
  const [notesText, setNotesText] = useState('Please retain this document for official corporate records and compliance audit.')

  // UI & Viewport State
  const [activeFont, setActiveFont] = useState(FONT_FAMILIES[0].value)
  const [activeFontSize, setActiveFontSize] = useState('13px')
  const [showTemplateMenu, setShowTemplateMenu] = useState(false)
  const [showFontMenu, setShowFontMenu] = useState(false)
  const [showSizeMenu, setShowSizeMenu] = useState(false)
  const [showColorMenu, setShowColorMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(0.85)
  const [viewMode, setViewMode] = useState<'split' | 'editor' | 'preview'>('split')
  const [logoBase64, setLogoBase64] = useState<string | null>(null)

  const printDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const printTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  // ─── Responsive Auto-Fit Zoom Engine ───────────────────────────────────────
  const handleAutoFit = useCallback(() => {
    if (!previewContainerRef.current) return
    const containerW = previewContainerRef.current.clientWidth - 40
    const a4Px = 794 // 210mm in standard 96 DPI CSS pixels
    if (containerW > 0) {
      const fitZoom = Math.min(1.0, Math.max(0.35, containerW / a4Px))
      setZoomLevel(Number(fitZoom.toFixed(2)))
    }
  }, [])

  useEffect(() => {
    handleAutoFit()
    window.addEventListener('resize', handleAutoFit)
    return () => window.removeEventListener('resize', handleAutoFit)
  }, [handleAutoFit])

  // Screen-size adaptation: default to editor on mobile (<1024px)
  useEffect(() => {
    const handleInitialLayout = () => {
      if (window.innerWidth < 1024) {
        setViewMode('editor')
      } else {
        setViewMode('split')
      }
    }
    handleInitialLayout()
  }, [])

  // Pre-load logo as base64 on client mount for 100% reliable canvas export
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || img.width
        canvas.height = img.naturalHeight || img.height
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0)
          setLogoBase64(canvas.toDataURL('image/png'))
        }
      } catch {
        setLogoBase64('/logo.png')
      }
    }
    img.onerror = () => {
      setLogoBase64('/logo.png')
    }
    img.src = '/logo.png'
  }, [])

  // Initialize with Notice template on mount
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = TEMPLATES.notice.content
    }
  }, [])

  const applyTemplate = useCallback((key: string) => {
    setActiveTemplate(key)
    setDocTitle(TEMPLATES[key].title)
    if (editorRef.current) {
      editorRef.current.innerHTML = TEMPLATES[key].content
      editorRef.current.focus()
    }
    setShowTemplateMenu(false)
  }, [])

  const exec = useCallback((cmd: string, val?: string) => {
    document.execCommand(cmd, false, val)
    editorRef.current?.focus()
  }, [])

  const applyFont = (font: string) => {
    setActiveFont(font)
    if (editorRef.current) {
      editorRef.current.style.fontFamily = font
    }
    setShowFontMenu(false)
  }

  const applyFontSize = (size: string) => {
    setActiveFontSize(size)
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed) {
      const range = sel.getRangeAt(0)
      const span = document.createElement('span')
      span.style.fontSize = size
      try {
        range.surroundContents(span)
      } catch {
        exec('insertHTML', `<span style="font-size:${size}">${sel.toString()}</span>`)
      }
    }
    setShowSizeMenu(false)
    editorRef.current?.focus()
  }

  const applyColor = (color: string) => {
    exec('foreColor', color)
    setShowColorMenu(false)
  }

  const insertTable = () => {
    const tableHtml = `
      <table style="width:100%; border-collapse:collapse; margin:12px 0; font-size:12.5px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="border:1px solid #cbd5e1; padding:6px 10px; text-align:left;">আইটেম / বিবরণ</th>
            <th style="border:1px solid #cbd5e1; padding:6px 10px; text-align:center; width:80px;">পরিমাণ</th>
            <th style="border:1px solid #cbd5e1; padding:6px 10px; text-align:right; width:120px;">মূল্য (BDT)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #cbd5e1; padding:6px 10px;">বিবরণ লিখুন</td>
            <td style="border:1px solid #cbd5e1; padding:6px 10px; text-align:center;">১</td>
            <td style="border:1px solid #cbd5e1; padding:6px 10px; text-align:right;">০.০০</td>
          </tr>
        </tbody>
      </table>
    `
    exec('insertHTML', tableHtml)
  }

  // ─── High-Fidelity Official A4 PDF Export Engine ──────────────────────────
  const handleExportPdf = async () => {
    if (isExporting || !previewRef.current) return
    setIsExporting(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const jsPDF = (await import('jspdf')).default

      if (document.fonts) {
        await document.fonts.ready
      }

      // 1. Create an unscaled off-screen clone with exact standard A4 dimensions (794px x 1123px at 96 DPI)
      const a4WidthPx = 794
      const a4HeightPx = 1123

      const sourceEl = previewRef.current
      const cloneWrapper = document.createElement('div')
      cloneWrapper.style.position = 'fixed'
      cloneWrapper.style.left = '-9999px'
      cloneWrapper.style.top = '0'
      cloneWrapper.style.width = `${a4WidthPx}px`
      cloneWrapper.style.minHeight = `${a4HeightPx}px`
      cloneWrapper.style.zIndex = '-9999'
      cloneWrapper.style.background = '#ffffff'
      cloneWrapper.style.overflow = 'visible'

      const clonedSheet = sourceEl.cloneNode(true) as HTMLElement
      clonedSheet.style.width = `${a4WidthPx}px`
      clonedSheet.style.minHeight = `${a4HeightPx}px`
      clonedSheet.style.transform = 'none'
      clonedSheet.style.boxShadow = 'none'
      clonedSheet.style.borderRadius = '0'
      clonedSheet.style.margin = '0'
      clonedSheet.style.overflow = 'visible'

      cloneWrapper.appendChild(clonedSheet)
      document.body.appendChild(cloneWrapper)

      // Allow 1 frame for layout rendering
      await new Promise((resolve) => setTimeout(resolve, 150))

      // 2. High resolution rasterization (scale 2.5 for crisp 240+ DPI print resolution)
      const canvas = await html2canvas(clonedSheet, {
        scale: 2.5,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: a4WidthPx,
      })

      // Clean up the off-screen copy
      document.body.removeChild(cloneWrapper)

      // 3. Construct jsPDF standard A4 document
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true,
      })

      const pdfW = 210
      const pdfH = 297
      const imgData = canvas.toDataURL('image/png', 1.0)
      const canvasRatio = canvas.height / canvas.width
      const totalImgH = pdfW * canvasRatio

      if (totalImgH <= pdfH + 4) {
        pdf.addImage(imgData, 'PNG', 0, 0, pdfW, Math.min(pdfH, totalImgH), undefined, 'FAST')
      } else {
        let remainingH = totalImgH
        let pos = 0
        pdf.addImage(imgData, 'PNG', 0, pos, pdfW, totalImgH, undefined, 'FAST')
        remainingH -= pdfH
        while (remainingH > 2) {
          pos -= pdfH
          pdf.addPage()
          pdf.addImage(imgData, 'PNG', 0, pos, pdfW, totalImgH, undefined, 'FAST')
          remainingH -= pdfH
        }
      }

      const cleanName = docTitle.replace(/[^\w\u0980-\u09FF]+/g, '_')
      pdf.save(`${cleanName}_${docRef}.pdf`)
    } catch (err) {
      console.error('PDF export error:', err)
      alert('PDF generation encountered an error. You can also use the Print button to Save as PDF.')
    } finally {
      setIsExporting(false)
    }
  }

  const TBtn = ({
    onClick,
    title,
    children,
    active,
    danger,
  }: {
    onClick: () => void
    title: string
    children: React.ReactNode
    active?: boolean
    danger?: boolean
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg transition-all text-xs flex items-center justify-center shrink-0 ${
        danger
          ? 'text-slate-500 hover:text-rose-600 hover:bg-rose-500/10'
          : active
          ? 'bg-[#d4af37]/20 text-[#8a6d1f] border border-[#d4af37]/30'
          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.05]'
      }`}
    >
      {children}
    </button>
  )

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans">
      {/* ═══════════════════════════════════════════════════════════════════════
          TOP EXECUTIVE ACTION BAR (Fully Responsive)
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="border-b border-slate-900/8 bg-slate-900/[0.05] backdrop-blur-xl sticky top-0 z-40">
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          {/* Brand & Title */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-white to-white border border-[#d4af37]/30 flex items-center justify-center shadow-lg shadow-slate-900/40 shrink-0">
              <FileOutput className="w-4 h-4 text-[#8a6d1f]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-slate-900 tracking-tight">Official PDF Generator</h1>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#d4af37]/15 text-[#8a6d1f] border border-[#d4af37]/25 hidden sm:inline-block">
                  A4 Corporate
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5">Anchor ERP Executive Designer</p>
            </div>
          </div>

          {/* Action Buttons & Responsive Mode Switcher */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* View Mode Switcher (Desktop + Mobile) */}
            <div className="flex rounded-lg bg-slate-900/[0.04] p-0.5 border border-slate-900/10">
              <button
                onClick={() => setViewMode('editor')}
                className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-all ${
                  viewMode === 'editor' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
                title="Editor Mode"
              >
                <Edit3 className="w-3 h-3" />
                <span className="hidden sm:inline">Editor</span>
              </button>
              <button
                onClick={() => {
                  setViewMode('split')
                  setTimeout(handleAutoFit, 100)
                }}
                className={`hidden lg:flex px-2.5 py-1 rounded text-xs font-medium items-center gap-1.5 transition-all ${
                  viewMode === 'split' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
                title="Split Side-by-Side"
              >
                <Columns className="w-3 h-3" />
                <span>Split</span>
              </button>
              <button
                onClick={() => {
                  setViewMode('preview')
                  setTimeout(handleAutoFit, 100)
                }}
                className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-all ${
                  viewMode === 'preview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
                title="A4 Sheet Preview"
              >
                <Eye className="w-3 h-3" />
                <span>Preview</span>
              </button>
            </div>

            {/* Template Selector Dropdown */}
            <div className="relative">
              <button
                id="pdf-template-btn"
                onClick={() => setShowTemplateMenu((p) => !p)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 hover:bg-slate-900/[0.07] text-xs font-medium text-slate-700 transition-all hover:border-[#d4af37]/30"
              >
                <Wand2 className="w-3.5 h-3.5 text-[#8a6d1f]" />
                <span className="hidden md:inline">Template:</span>
                <span className="truncate max-w-[110px] sm:max-w-none">
                  {TEMPLATES[activeTemplate]?.icon} {TEMPLATES[activeTemplate]?.name}
                </span>
                <ChevronDown className="w-3 h-3 opacity-50" />
              </button>

              <AnimatePresence>
                {showTemplateMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="absolute right-0 mt-2 w-72 bg-white border border-slate-900/12 rounded-xl shadow-2xl z-50 py-1.5 overflow-hidden divide-y divide-slate-900/5"
                  >
                    <div className="px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Select Document Format
                    </div>
                    <div>
                      {Object.keys(TEMPLATES).map((key) => (
                        <button
                          key={key}
                          onClick={() => applyTemplate(key)}
                          className={`w-full flex items-center gap-3 px-3.5 py-2 text-xs hover:bg-slate-900/[0.05] transition-colors text-left ${
                            activeTemplate === key ? 'text-[#8a6d1f] bg-[#d4af37]/10 font-semibold' : 'text-slate-600'
                          }`}
                        >
                          <span className="text-base">{TEMPLATES[key].icon}</span>
                          <span className="flex-1">{TEMPLATES[key].name}</span>
                          {activeTemplate === key && <Check className="w-3.5 h-3.5 ml-auto text-[#8a6d1f]" />}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Settings Toggle Button */}
            <button
              id="pdf-settings-btn"
              onClick={() => setShowSettings((p) => !p)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                showSettings
                  ? 'bg-white border-[#d4af37]/40 text-[#8a6d1f] shadow-sm'
                  : 'bg-slate-900/[0.04] border-slate-900/10 text-slate-600 hover:bg-slate-900/[0.07] hover:border-slate-900/20'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </button>

            {/* Print / Save Vector PDF */}
            <button
              id="pdf-print-btn"
              onClick={() => window.print()}
              title="Print directly or save via browser PDF engine"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/[0.04] border border-slate-900/10 hover:bg-slate-900/[0.07] text-xs font-medium text-slate-700 transition-all hover:border-slate-900/20"
            >
              <Printer className="w-3.5 h-3.5 text-sky-600" />
              <span className="hidden sm:inline">Print</span>
            </button>

            {/* Export Official PDF Download */}
            <button
              id="pdf-export-pdf-btn"
              onClick={handleExportPdf}
              disabled={isExporting}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-gradient-to-r from-[#d4af37] via-[#d4af37] to-[#e5c158] border border-[#d4af37]/35 text-xs font-bold text-black transition-all shadow-lg shadow-slate-900/40 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isExporting ? (
                <div className="w-3.5 h-3.5 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5 text-[#8a6d1f]" />
              )}
              <span>{isExporting ? 'Rendering...' : 'Export PDF'}</span>
            </button>
          </div>
        </div>

        {/* ─── Settings Panel (Responsive Drawer) ─────────────────────────── */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-slate-900/8 bg-white"
            >
              <div className="px-5 py-4 space-y-4">
                {/* Row 1: Document Metadata */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <div className="sm:col-span-2 lg:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Document Title (ডকুমেন্টের শিরোনাম)
                    </label>
                    <input
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50"
                      placeholder="OFFICIAL NOTICE"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Reference No (স্মারক নম্বর)
                    </label>
                    <input
                      value={docRef}
                      onChange={(e) => setDocRef(e.target.value)}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50"
                      placeholder="REF-2026-0001"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Branch / Scope (শাখা বা পরিধি)
                    </label>
                    <input
                      value={docBranch}
                      onChange={(e) => setDocBranch(e.target.value)}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50"
                      placeholder="All Branches"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Prepared By (প্রস্তুতকারী)
                    </label>
                    <input
                      value={docPreparedBy}
                      onChange={(e) => setDocPreparedBy(e.target.value)}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/50"
                      placeholder="Operations Management"
                    />
                  </div>
                </div>

                {/* Row 2: Watermark & Section Controls */}
                <div className="pt-3 border-t border-slate-900/5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Watermark Controls */}
                  <div className="bg-slate-900/[0.04] p-3 rounded-xl border border-slate-900/10 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        Watermark (ওয়াটারমার্ক)
                      </span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showWatermark}
                          onChange={(e) => setShowWatermark(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-8 h-4 rounded-full transition-colors ${
                            showWatermark ? 'bg-white border border-[#d4af37]/40' : 'bg-slate-900/[0.07]'
                          }`}
                        >
                          <div
                            className={`w-3 h-3 bg-white rounded-full transition-transform mt-0.5 ml-0.5 ${
                              showWatermark ? 'translate-x-4 bg-[#d4af37]' : ''
                            }`}
                          />
                        </div>
                      </label>
                    </div>

                    {showWatermark && (
                      <div className="space-y-2 pt-1">
                        <div>
                          <label className="block text-[9px] text-slate-500 uppercase">Text</label>
                          <input
                            value={watermarkText}
                            onChange={(e) => setWatermarkText(e.target.value)}
                            className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40"
                            placeholder="ANCHOR FASHION"
                          />
                        </div>
                        <div>
                          <div className="flex justify-between text-[9px] text-slate-500 uppercase">
                            <span>Visibility / Opacity</span>
                            <span className="text-amber-600 font-semibold">{Math.round(watermarkOpacity * 100)}%</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {[0.08, 0.14, 0.20, 0.26].map((op) => (
                              <button
                                key={op}
                                onClick={() => setWatermarkOpacity(op)}
                                className={`flex-1 py-1 rounded text-[10px] font-medium border transition-all ${
                                  watermarkOpacity === op
                                    ? 'bg-[#d4af37]/20 border-[#d4af37] text-[#8a6d1f]'
                                    : 'bg-slate-900/[0.04] border-slate-900/10 text-slate-500 hover:text-slate-900'
                                }`}
                              >
                                {op === 0.08 ? 'Faint' : op === 0.14 ? 'Normal' : op === 0.20 ? 'Bold' : 'Vivid'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Address Card Toggle */}
                  <div className="bg-slate-900/[0.04] p-3 rounded-xl border border-slate-900/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">Address Card (ঠিকানা)</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showAddressCard}
                          onChange={(e) => setShowAddressCard(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-8 h-4 rounded-full transition-colors ${
                            showAddressCard ? 'bg-white border border-[#d4af37]/40' : 'bg-slate-900/[0.07]'
                          }`}
                        >
                          <div
                            className={`w-3 h-3 bg-white rounded-full transition-transform mt-0.5 ml-0.5 ${
                              showAddressCard ? 'translate-x-4 bg-[#d4af37]' : ''
                            }`}
                          />
                        </div>
                      </label>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2">
                      Shows the official Anchor Fashion department address box.
                    </p>
                  </div>

                  {/* Signature Block Toggle */}
                  <div className="bg-slate-900/[0.04] p-3 rounded-xl border border-slate-900/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">Signature Block (স্বাক্ষর)</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showSignature}
                          onChange={(e) => setShowSignature(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-8 h-4 rounded-full transition-colors ${
                            showSignature ? 'bg-white border border-[#d4af37]/40' : 'bg-slate-900/[0.07]'
                          }`}
                        >
                          <div
                            className={`w-3 h-3 bg-white rounded-full transition-transform mt-0.5 ml-0.5 ${
                              showSignature ? 'translate-x-4 bg-[#d4af37]' : ''
                            }`}
                          />
                        </div>
                      </label>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2">
                      3-column executive sign-off: Prepared, Verified, Authorized.
                    </p>
                  </div>

                  {/* Document Date & Notes Toggle */}
                  <div className="bg-slate-900/[0.04] p-3 rounded-xl border border-slate-900/10 space-y-2">
                    <div>
                      <label className="block text-[9px] text-slate-500 uppercase mb-1">Document Date</label>
                      <input
                        type="text"
                        value={docDate}
                        onChange={(e) => setDocDate(e.target.value)}
                        className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-900/5">
                      <span className="text-[11px] text-slate-600">Notes Box</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showNotesBox}
                          onChange={(e) => setShowNotesBox(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-8 h-4 rounded-full transition-colors ${
                            showNotesBox ? 'bg-white border border-[#d4af37]/40' : 'bg-slate-900/[0.07]'
                          }`}
                        >
                          <div
                            className={`w-3 h-3 bg-white rounded-full transition-transform mt-0.5 ml-0.5 ${
                              showNotesBox ? 'translate-x-4 bg-[#d4af37]' : ''
                            }`}
                          />
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                {showNotesBox && (
                  <div className="pt-2 border-t border-slate-900/5">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Special Notes / Instructions Text
                    </label>
                    <input
                      value={notesText}
                      onChange={(e) => setNotesText(e.target.value)}
                      className="w-full bg-slate-900/[0.04] border border-slate-900/10 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-[#d4af37]/40"
                      placeholder="Special instructions or compliance note..."
                    />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          MAIN WORKSPACE: RESPONSIVE SPLIT / DUAL VIEW
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        {/* LEFT PANE: RICH TEXT EDITOR */}
        {(viewMode === 'split' || viewMode === 'editor') && (
          <div
            className={`border-r border-slate-900/8 flex flex-col shrink-0 bg-white transition-all ${
              viewMode === 'editor' ? 'w-full' : 'w-full lg:w-[460px] xl:w-[500px]'
            }`}
          >
            {/* Enhanced Toolbar Groupings */}
            <div className="bg-white border-b border-slate-900/8 px-2.5 py-2 flex items-center gap-1.5 flex-wrap">
              {/* History */}
              <div className="flex items-center bg-slate-900/[0.04] rounded-lg p-0.5">
                <TBtn onClick={() => exec('undo')} title="Undo (পূর্বাবস্থায়)">
                  <Undo className="w-3.5 h-3.5" />
                </TBtn>
                <TBtn onClick={() => exec('redo')} title="Redo (পুনরায়)">
                  <Redo className="w-3.5 h-3.5" />
                </TBtn>
              </div>

              {/* Headings */}
              <div className="flex items-center bg-slate-900/[0.04] rounded-lg p-0.5">
                <TBtn onClick={() => exec('formatBlock', 'h1')} title="Heading 1">
                  <Heading1 className="w-3.5 h-3.5" />
                </TBtn>
                <TBtn onClick={() => exec('formatBlock', 'h2')} title="Heading 2">
                  <Heading2 className="w-3.5 h-3.5" />
                </TBtn>
                <TBtn onClick={() => exec('formatBlock', 'h3')} title="Heading 3">
                  <Heading3 className="w-3.5 h-3.5" />
                </TBtn>
                <TBtn onClick={() => exec('formatBlock', 'p')} title="Paragraph">
                  <Type className="w-3.5 h-3.5" />
                </TBtn>
                <TBtn onClick={() => exec('formatBlock', 'blockquote')} title="Blockquote">
                  <Quote className="w-3.5 h-3.5" />
                </TBtn>
              </div>

              {/* Inline Formatting */}
              <div className="flex items-center bg-slate-900/[0.04] rounded-lg p-0.5">
                <TBtn onClick={() => exec('bold')} title="Bold">
                  <Bold className="w-3.5 h-3.5" />
                </TBtn>
                <TBtn onClick={() => exec('italic')} title="Italic">
                  <Italic className="w-3.5 h-3.5" />
                </TBtn>
                <TBtn onClick={() => exec('underline')} title="Underline">
                  <Underline className="w-3.5 h-3.5" />
                </TBtn>
                <TBtn onClick={() => exec('strikeThrough')} title="Strikethrough">
                  <Strikethrough className="w-3.5 h-3.5" />
                </TBtn>
              </div>

              {/* Alignments */}
              <div className="flex items-center bg-slate-900/[0.04] rounded-lg p-0.5">
                <TBtn onClick={() => exec('justifyLeft')} title="Align Left">
                  <AlignLeft className="w-3.5 h-3.5" />
                </TBtn>
                <TBtn onClick={() => exec('justifyCenter')} title="Align Center">
                  <AlignCenter className="w-3.5 h-3.5" />
                </TBtn>
                <TBtn onClick={() => exec('justifyRight')} title="Align Right">
                  <AlignRight className="w-3.5 h-3.5" />
                </TBtn>
                <TBtn onClick={() => exec('justifyFull')} title="Justify">
                  <AlignJustify className="w-3.5 h-3.5" />
                </TBtn>
              </div>

              {/* Lists & Table */}
              <div className="flex items-center bg-slate-900/[0.04] rounded-lg p-0.5">
                <TBtn onClick={() => exec('insertUnorderedList')} title="Bullet List">
                  <List className="w-3.5 h-3.5" />
                </TBtn>
                <TBtn onClick={() => exec('insertOrderedList')} title="Numbered List">
                  <ListOrdered className="w-3.5 h-3.5" />
                </TBtn>
                <TBtn onClick={insertTable} title="Insert Table">
                  <TableIcon className="w-3.5 h-3.5 text-amber-600" />
                </TBtn>
                <TBtn onClick={() => exec('insertHorizontalRule')} title="Horizontal Divider">
                  <Minus className="w-3.5 h-3.5" />
                </TBtn>
              </div>

              {/* Font Family Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowFontMenu((p) => !p)
                    setShowSizeMenu(false)
                    setShowColorMenu(false)
                  }}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.05] text-xs border border-transparent hover:border-slate-900/10 transition-all bg-slate-900/[0.04]"
                  title="Font Family"
                >
                  <span className="font-bangla font-bold text-sm text-[#8a6d1f]">অ</span>
                  <span className="text-[11px] hidden sm:inline">ফন্ট</span>
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </button>

                <AnimatePresence>
                  {showFontMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      className="absolute top-full left-0 mt-1.5 w-64 bg-white border border-slate-900/12 rounded-xl shadow-2xl z-50 py-1.5"
                    >
                      <div className="px-3 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                        Select Typography
                      </div>
                      {FONT_FAMILIES.map((f) => (
                        <button
                          key={f.label}
                          onClick={() => applyFont(f.value)}
                          className={`w-full text-left px-3.5 py-2 text-xs hover:bg-slate-900/[0.05] transition-colors flex items-center justify-between ${
                            activeFont === f.value ? 'text-[#8a6d1f] font-semibold bg-[#d4af37]/10' : 'text-slate-600'
                          }`}
                          style={{ fontFamily: f.value }}
                        >
                          <span>{f.label}</span>
                          {activeFont === f.value && <Check className="w-3 h-3 text-[#8a6d1f]" />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Font Size Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowSizeMenu((p) => !p)
                    setShowFontMenu(false)
                    setShowColorMenu(false)
                  }}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.05] text-xs border border-transparent hover:border-slate-900/10 transition-all bg-slate-900/[0.04]"
                  title="Font Size"
                >
                  <FileText className="w-3.5 h-3.5 text-sky-600" />
                  <span className="text-[11px]">{activeFontSize}</span>
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </button>

                <AnimatePresence>
                  {showSizeMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      className="absolute top-full left-0 mt-1.5 w-28 bg-white border border-slate-900/12 rounded-xl shadow-2xl z-50 py-1 max-h-48 overflow-y-auto"
                    >
                      {FONT_SIZES.map((sz) => (
                        <button
                          key={sz}
                          onClick={() => applyFontSize(sz)}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-900/[0.05] transition-colors ${
                            activeFontSize === sz ? 'text-[#8a6d1f] font-bold bg-[#d4af37]/10' : 'text-slate-600'
                          }`}
                        >
                          {sz}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Color Picker */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowColorMenu((p) => !p)
                    setShowFontMenu(false)
                    setShowSizeMenu(false)
                  }}
                  className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.05] transition-all bg-slate-900/[0.04]"
                  title="Text Color"
                >
                  <Palette className="w-3.5 h-3.5 text-emerald-600" />
                </button>

                <AnimatePresence>
                  {showColorMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      className="absolute top-full right-0 mt-1.5 p-2.5 bg-white border border-slate-900/12 rounded-xl shadow-2xl z-50"
                    >
                      <div className="grid grid-cols-4 gap-2">
                        {COLORS.map((c) => (
                          <button
                            key={c.value}
                            onClick={() => applyColor(c.value)}
                            title={c.label}
                            className="w-6 h-6 rounded-full border border-slate-900/20 hover:scale-115 transition-transform"
                            style={{ background: c.value }}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <TBtn onClick={() => exec('removeFormat')} title="Clear Formatting" danger>
                <X className="w-3.5 h-3.5" />
              </TBtn>
            </div>

            {/* Editable Canvas */}
            <div className="flex-1 overflow-auto p-4 flex flex-col">
              <div className="mb-2 flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  এখানে টাইপ বা পেস্ট করুন (বাংলা ও English)
                </span>
                <span className="text-[#8a6d1f]">Rich Text Editor</span>
              </div>

              <div
                ref={editorRef}
                id="pdf-text-editor"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                className="pdf-content-editable pdf-editor-zone flex-1 min-h-[380px] w-full bg-white border border-slate-900/10 rounded-xl p-5 text-slate-800 focus:border-[#d4af37]/40 focus:ring-1 focus:ring-[#d4af37]/30 transition-all shadow-inner overflow-auto"
                style={{
                  fontFamily: activeFont,
                  lineHeight: '1.95',
                  fontSize: '13.5px',
                  outline: 'none',
                }}
                onPaste={(e) => {
                  e.preventDefault()
                  const text = e.clipboardData.getData('text/plain')
                  document.execCommand('insertText', false, text)
                }}
              />

              <div className="mt-2 text-[10px] text-slate-500 flex items-center justify-between">
                <span>* বাংলা যুক্তবর্ণ ও ফন্ট স্বয়ংক্রিয়ভাবে নিখুঁত রেন্ডার হবে।</span>
                <span>A4 Corporate Standards</span>
              </div>
            </div>

            {/* Footer Status Bar with Auto-Fit */}
            <div className="border-t border-slate-900/8 px-4 py-2 flex items-center gap-3 bg-white text-slate-500">
              <button
                onClick={() => setZoomLevel((z) => Math.max(0.35, Number((z - 0.1).toFixed(2))))}
                className="p-2 rounded hover:text-slate-900 transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono w-12 text-center tabular-nums font-semibold text-slate-600">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                onClick={() => setZoomLevel((z) => Math.min(1.5, Number((z + 0.1).toFixed(2))))}
                className="p-2 rounded hover:text-slate-900 transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleAutoFit}
                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-900/[0.04] hover:bg-slate-900/[0.07] text-[#8a6d1f] border border-[#d4af37]/30 transition-all ml-1 flex items-center gap-1"
                title="Auto-Fit A4 to Screen"
              >
                <Maximize2 className="w-3 h-3" />
                <span>Auto Fit</span>
              </button>

              <button
                onClick={() => setZoomLevel(1.0)}
                className="p-2 rounded hover:text-slate-900 transition-colors text-[10px]"
                title="Actual 100% Size"
              >
                100%
              </button>

              <div className="ml-auto text-[10px] text-slate-500">
                Live Preview Sync
              </div>
            </div>
          </div>
        )}

        {/* RIGHT PANE: 1:1 OFFICIAL CORPORATE A4 SHEET PREVIEW */}
        {(viewMode === 'split' || viewMode === 'preview') && (
          <div
            ref={previewContainerRef}
            id="pdf-print-area"
            className="flex-1 overflow-auto bg-white flex items-start justify-center py-8 px-2 sm:px-4 lg:px-6"
          >
            <div
              style={{
                transform: `scale(${zoomLevel})`,
                transformOrigin: 'top center',
                width: '210mm',
                transition: 'transform 0.15s ease-out',
              }}
              className="shrink-0"
            >
              {/* The Actual A4 Official Corporate Sheet */}
              <div
                ref={previewRef}
                className="pdf-a4-sheet"
                style={{
                  fontFamily: activeFont,
                  width: '210mm',
                  minHeight: '297mm',
                  background: '#ffffff',
                  position: 'relative',
                  overflow: 'hidden',
                  color: '#16171a',
                  display: 'flex',
                  flexDirection: 'column',
                  boxSizing: 'border-box',
                }}
              >
                {/* ─────────────────────────────────────────────────────────────
                    1. REPEATING DIAGONAL WATERMARK (Unmistakably Visible & Crisp)
                ───────────────────────────────────────────────────────────── */}
                {showWatermark && (
                  <div
                    className="pdf-watermark-layer"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      backgroundImage: getWatermarkSvgDataUrl(watermarkText, watermarkOpacity),
                      backgroundRepeat: 'repeat',
                      pointerEvents: 'none',
                      zIndex: 0,
                    }}
                  />
                )}

                {/* ─────────────────────────────────────────────────────────────
                    2. BRAND HEADER (Exact Match with Official Statement PDF)
                ───────────────────────────────────────────────────────────── */}
                <div
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    background: 'transparent',
                    padding: '24px 36px 14px 36px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      minHeight: '74px',
                    }}
                  >
                    {/* Left: Official Logo with Fallback */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      {logoBase64 ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={logoBase64}
                          alt="Anchor Fashion"
                          style={{
                            height: '62px',
                            maxWidth: '240px',
                            objectFit: 'contain',
                            display: 'block',
                          }}
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div
                            style={{
                              width: '58px',
                              height: '58px',
                              borderRadius: '8px',
                              background: '#0f3057',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#ffffff',
                              fontWeight: 'bold',
                              fontSize: '18px',
                              boxShadow: '0 2px 8px rgba(15,48,87,0.25)',
                            }}
                          >
                            AF
                          </div>
                          <div>
                            <div
                              style={{
                                fontSize: '16px',
                                fontWeight: 'bold',
                                color: '#0f3057',
                                letterSpacing: '0.04em',
                              }}
                            >
                              ANCHOR FASHION
                            </div>
                            <div style={{ fontSize: '9px', color: '#64748b', marginTop: '2px' }}>
                              Enterprise Resource Planning System
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right: Document Heading + Navy Scope Tag */}
                    <div style={{ textAlign: 'right' }}>
                      <div
                        style={{
                          fontSize: docTitle.length > 28 ? '16px' : '22px',
                          fontWeight: 'bold',
                          color: '#7d8594',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          maxWidth: '280px',
                          lineHeight: 1.2,
                          wordBreak: 'break-word',
                        }}
                      >
                        {docTitle}
                      </div>

                      <div
                        style={{
                          display: 'inline-block',
                          marginTop: '8px',
                          background: '#0f3057',
                          padding: '4px 14px',
                          borderRadius: '3px',
                          fontSize: '8.5px',
                          fontWeight: 'bold',
                          color: '#ffffff',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          boxShadow: '0 2px 6px rgba(15,48,87,0.18)',
                        }}
                      >
                        {docBranch.toUpperCase().slice(0, 36)}
                      </div>
                    </div>
                  </div>

                  {/* Header Separator Line */}
                  <div
                    style={{
                      height: '1px',
                      background: '#d0d6e0',
                      marginTop: '16px',
                      width: '100%',
                    }}
                  />
                </div>

                {/* ─────────────────────────────────────────────────────────────
                    3. INFORMATION & SCOPE GRID (Exact Match)
                ───────────────────────────────────────────────────────────── */}
                {showAddressCard && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '16px',
                      padding: '0 36px 14px 36px',
                      position: 'relative',
                      zIndex: 1,
                      background: 'transparent',
                    }}
                  >
                    {/* Left: Official Company Address Card */}
                    <div
                      style={{
                        border: '1px solid #d0d6e0',
                        borderRadius: '4px',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.92)',
                        width: '210px',
                        flexShrink: 0,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 'bold',
                          fontSize: '9.5px',
                          color: '#0f3057',
                          letterSpacing: '0.06em',
                          marginBottom: '4px',
                          textTransform: 'uppercase',
                        }}
                      >
                        ANCHOR FASHION
                      </div>
                      <div
                        style={{
                          fontSize: '8px',
                          color: '#3c4452',
                          lineHeight: 1.7,
                        }}
                      >
                        Operations &amp; Finance Department<br />
                        Dhaka, Bangladesh<br />
                        anchorfashionsupport@gmail.com
                      </div>
                    </div>

                    {/* Right: Metadata Grid */}
                    <div
                      style={{
                        flex: 1,
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '8px 16px',
                        alignContent: 'center',
                        background: 'rgba(248, 250, 253, 0.7)',
                        border: '1px solid #e2e8f0',
                        borderRadius: '4px',
                        padding: '8px 14px',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: '6.5px',
                            fontWeight: 'bold',
                            color: '#788291',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                          }}
                        >
                          DOCUMENT REF.
                        </div>
                        <div style={{ fontSize: '8.5px', color: '#161a22', fontWeight: 600, marginTop: '1px' }}>
                          {docRef}
                        </div>
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: '6.5px',
                            fontWeight: 'bold',
                            color: '#788291',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                          }}
                        >
                          BRANCH / SCOPE
                        </div>
                        <div style={{ fontSize: '8.5px', color: '#161a22', fontWeight: 600, marginTop: '1px' }}>
                          {docBranch}
                        </div>
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: '6.5px',
                            fontWeight: 'bold',
                            color: '#788291',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                          }}
                        >
                          DATE
                        </div>
                        <div style={{ fontSize: '8.5px', color: '#161a22', fontWeight: 600, marginTop: '1px' }}>
                          {docDate}
                        </div>
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: '6.5px',
                            fontWeight: 'bold',
                            color: '#788291',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                          }}
                        >
                          PREPARED BY
                        </div>
                        <div style={{ fontSize: '8.5px', color: '#161a22', fontWeight: 600, marginTop: '1px' }}>
                          {docPreparedBy}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ─────────────────────────────────────────────────────────────
                    4. DOCUMENT BODY (Bengali & English Flawless Content)
                ───────────────────────────────────────────────────────────── */}
                <div
                  style={{
                    flex: 1,
                    padding: '16px 36px 20px 36px',
                    position: 'relative',
                    zIndex: 1,
                    background: 'transparent',
                  }}
                >
                  <LiveMirror editorRef={editorRef} fontFamily={activeFont} />
                </div>

                {/* ─────────────────────────────────────────────────────────────
                    5. SPECIAL INSTRUCTIONS / NOTES BOX (Toggleable)
                ───────────────────────────────────────────────────────────── */}
                {showNotesBox && (
                  <div
                    style={{
                      padding: '0 36px 16px 36px',
                      position: 'relative',
                      zIndex: 1,
                      background: 'transparent',
                    }}
                  >
                    <div
                      style={{
                        border: '1px solid #d0d6e0',
                        borderRadius: '4px',
                        padding: '10px 14px',
                        background: 'rgba(248, 250, 253, 0.85)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '8.5px',
                          fontWeight: 'bold',
                          color: '#0f3057',
                          letterSpacing: '0.06em',
                          marginBottom: '4px',
                          textTransform: 'uppercase',
                        }}
                      >
                        SPECIAL INSTRUCTIONS / NOTES:
                      </div>
                      <div style={{ fontSize: '8px', color: '#3c4452', lineHeight: 1.7 }}>
                        {notesText}
                      </div>
                    </div>
                  </div>
                )}

                {/* ─────────────────────────────────────────────────────────────
                    6. SIGNATURE BLOCK (Corporate 3-Column Standard)
                ───────────────────────────────────────────────────────────── */}
                {showSignature && (
                  <div
                    style={{
                      padding: '14px 36px 12px 36px',
                      position: 'relative',
                      zIndex: 1,
                      background: 'transparent',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        gap: '24px',
                        marginTop: '8px',
                      }}
                    >
                      {['Prepared By', 'Verified By', 'Authorized By'].map((lbl) => (
                        <div key={lbl} style={{ textAlign: 'center' }}>
                          <div
                            style={{
                              borderBottom: '1px solid #b4bcd0',
                              marginBottom: '6px',
                              paddingBottom: '24px',
                            }}
                          />
                          <div
                            style={{
                              fontSize: '8.5px',
                              fontWeight: 'bold',
                              color: '#0f3057',
                              letterSpacing: '0.06em',
                              textTransform: 'uppercase',
                            }}
                          >
                            {lbl}
                          </div>
                          <div style={{ fontSize: '7px', color: '#788291', marginTop: '2px' }}>
                            Name &amp; Designation
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Electronic Document Disclaimer */}
                    <div
                      style={{
                        marginTop: '16px',
                        textAlign: 'center',
                        fontSize: '7.5px',
                        color: '#64748b',
                        lineHeight: 1.6,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>Generation Date:</span> {printDate} {printTime}
                      <br />
                      This is a computer-generated electronic document and does not require a physical signature.
                    </div>
                  </div>
                )}

                {/* ─────────────────────────────────────────────────────────────
                    7. OFFICIAL DOCUMENT FOOTER
                ───────────────────────────────────────────────────────────── */}
                <div
                  style={{
                    borderTop: '1px solid #d0d6e0',
                    padding: '10px 36px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    position: 'relative',
                    zIndex: 1,
                    background: 'transparent',
                    marginTop: 'auto',
                  }}
                >
                  <div
                    style={{
                      fontSize: '7.5px',
                      color: '#788291',
                      letterSpacing: '0.04em',
                    }}
                  >
                    ANCHOR FASHION ERP &nbsp;·&nbsp; Confidential &amp; Proprietary &nbsp;·&nbsp; {printDate}
                  </div>
                  <div
                    style={{
                      fontSize: '8px',
                      fontWeight: 'bold',
                      color: '#0f3057',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Page 1 of 1
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
