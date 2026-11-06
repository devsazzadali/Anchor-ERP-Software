// i18n — Bangla dictionary. MUST keep the exact shape of en.ts
// (typed as Dictionary, so tsc enforces identical key sets).
// Sub/explanation strings under accounts.head are the owner's own
// 2026-11-01 plain-Bangla simplification text, kept verbatim.
import type { Dictionary } from './en'

export const bn: Dictionary = {
  settings: {
    languageTitle: 'ভাষা',
    languageHint: 'পুরো ওয়েবসাইটের ভাষা বেছে নিন। এটি আপনার প্রোফাইলে সংরক্ষিত থাকবে এবং আপনি যে ডিভাইসেই সাইন ইন করুন না কেন সেখানেই প্রযোজ্য হবে।',
    english: 'English',
    bangla: 'বাংলা',
    saving: 'সংরক্ষণ হচ্ছে…',
    saved: 'ভাষা সংরক্ষিত হয়েছে।',
    saveFailed: 'ভাষা সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।',
  },
  auth: {
    lockedTitle: 'অ্যাকাউন্ট সাময়িকভাবে নিষ্ক্রিয়',
    lockedMessage: 'অনেকবার ভুল পাসওয়ার্ড দেওয়ার কারণে আপনার অ্যাকাউন্টটি সাময়িকভাবে নিষ্ক্রিয় করা হয়েছে।',
    lockedRetryMinutes: 'অনুগ্রহ করে {minutes} মিনিট পর আবার চেষ্টা করুন।',
    lockedRetryOneMinute: 'অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।',
  },
  nav: {
    brandTagline: 'এন্টারপ্রাইজ রিসোর্স প্ল্যানিং',
    adminPanel: 'অ্যাডমিন প্যানেল',
    partnerPortal: 'পার্টনার পোর্টাল',
    branchManager: 'শাখা ব্যবস্থাপক',
    headOfficePortal: 'প্রধান কার্যালয় পোর্টাল',
    employeePortalBadge: 'কর্মী পোর্টাল',
    signOut: 'সাইন আউট',
    loading: 'লোড হচ্ছে…',
    aiWidgetTitle: 'Anchor ERP AI জালিয়াতি ঝুঁকি',
    aiWidgetText: 'যাচাইকরণ নোড সুরক্ষিত। কোনো কাঠামোগত অসঙ্গতি পাওয়া যায়নি।',
    systemTelemetry: 'সিস্টেম টেলিমেট্রি',
    userDirectory: 'ব্যবহারকারী তালিকা',
    branchManagement: 'শাখা ব্যবস্থাপনা',
    masterSalaryLedger: 'প্রধান বেতন খাতা',
    unifiedFinSummary: 'সমন্বিত আর্থিক সারসংক্ষেপ',
    financialReports: 'আর্থিক প্রতিবেদন',
    paymentProofs: 'পেমেন্ট প্রমাণ ও পেআউট',
    branchChalans: 'শাখা চালান',
    kycVerifications: 'KYC যাচাইকরণ',
    userSettingsPanel: 'ব্যবহারকারী সেটিংস প্যানেল',
    securityAuditLog: 'নিরাপত্তা অডিট লগ',
    activeSessions: 'সক্রিয় সেশন',
    ledgerHeads: 'খাতার শিরোনাম',
    expenseRequests: 'খরচের আবেদন',
    generalExpenses: 'সাধারণ খরচ',
    taskManagement: 'কাজ ব্যবস্থাপনা',
    pdfGenerator: 'PDF জেনারেটর',
    branchAccounts: 'শাখা হিসাব',
    accountsOverview: 'হিসাবের সারসংক্ষেপ',
    depositApprovals: 'জমা অনুমোদন',
    changeRequisitions: 'খুচরা চাহিদাপত্র',
    reconciliation: 'হিসাব মিলকরণ',
    branchPerformance: 'শাখার কর্মদক্ষতা',
    accounts: 'হিসাব',
    accountsAtAGlance: 'এক নজরে হিসাব',
    needsAttention: 'মনোযোগ প্রয়োজন',
    moneyCategories: 'টাকার খাতসমূহ',
    allEntries: 'সব এন্ট্রি',
    startingFigures: 'শুরুর হিসাব',
    monthOpenClose: 'মাস খোলা / বন্ধ',
    matchWithBank: 'ব্যাংকের সাথে মেলানো',
    peopleCompanies: 'ব্যক্তি ও প্রতিষ্ঠান',
    toPay: 'পরিশোধ করতে হবে',
    salaryAccounts: 'বেতনের হিসাব',
    vatTax: 'ভ্যাট ও ট্যাক্স',
    cheques: 'চেক',
    statements: 'বিবরণীসমূহ',
    booksCheck: 'খাতা যাচাই',
    profitLoss: 'লাভ-ক্ষতি',
    whatWeOwnOwe: 'আমাদের সম্পদ ও দেনা',
    auditorReport: 'অডিটর রিপোর্ট',
    systemSettings: 'সিস্টেম সেটিংস',
    partnerDashboard: 'পার্টনার ড্যাশবোর্ড',
    profileSettings: 'প্রোফাইল সেটিংস',
    branchExpenses: 'শাখা খরচ',
    salaryLedger: 'বেতন খাতা',
    assignedTasks: 'নির্ধারিত কাজ',
    employeePortal: 'কর্মী পোর্টাল',
    corporatePortal: 'কর্পোরেট পোর্টাল',
    branchDashboard: 'শাখা ড্যাশবোর্ড',
    dailyClosing: 'দৈনিক ক্লোজিং',
    cashLedger: 'নগদ খাতা',
    bankDeposit: 'ব্যাংক জমা',
    depositHistory: 'জমার ইতিহাস',
    changeRequisition: 'খুচরা চাহিদাপত্র',
    bankStatements: 'ব্যাংক বিবরণী',
    salesSummary: 'বিক্রয় সারসংক্ষেপ',
    monthlyReport: 'মাসিক প্রতিবেদন',
  },
  accounts: {
    head: {
      auditor: { title: 'অডিটর রিপোর্ট', sub: 'অডিটরের জন্য সব রিপোর্ট এক ফাইলে', tech: 'Auditor Package' },
      bank: { title: 'ব্যাংকের সাথে মেলানো', sub: 'ব্যাংকের খাতার সাথে আমাদের হিসাব মেলানো', tech: 'Bank Reconciliation' },
      bankDetailSub: 'ব্যাংকের খাতার সাথে আমাদের হিসাব মেলানো',
      chart: { title: 'টাকার খাতসমূহ', sub: 'টাকা কোন কোন খাতে যায়', tech: 'Chart of Accounts' },
      cheques: { title: 'চেক', sub: 'কোন চেক দেওয়া/পাওয়া, কোনটা পাশ হয়েছে', tech: 'Cheque Register' },
      exceptions: { title: 'মনোযোগ প্রয়োজন', sub: 'যেখানে অমিল বা সমস্যা আছে', tech: 'Exceptions Inbox' },
      journal: { title: 'সব এন্ট্রি', sub: 'প্রতিটা লেনদেনের রেকর্ড', tech: 'Journal — append-only' },
      opening: { title: 'শুরুর হিসাব', sub: 'হিসাব শুরুর সময়ের অবস্থা', tech: 'Opening Position' },
      parties: { title: 'ব্যক্তি ও প্রতিষ্ঠান', sub: 'যাদের সাথে লেনদেন হয়', tech: 'Counterparties' },
      payables: { title: 'পরিশোধ করতে হবে', sub: 'কাকে কত টাকা দিতে হবে', tech: 'Payables & Ageing' },
      payroll: { title: 'বেতনের হিসাব', sub: 'বেতনের হিসাব এক জায়গায়', tech: 'Payroll' },
      payrollDetail: { title: 'বেতনের হিসাব', sub: 'বেতনের হিসাব এক জায়গায়', tech: 'Payroll run detail' },
      periods: { title: 'মাস খোলা / বন্ধ', sub: 'কোন মাসের হিসাব বন্ধ বা খোলা', tech: 'Accounting Periods & Fiscal Years' },
      tax: { title: 'ভ্যাট ও ট্যাক্স', sub: 'সরকারি ভ্যাট আর ট্যাক্সের হিসাব', tech: 'VAT / TDS' },
      pl: { title: 'লাভ-ক্ষতি', sub: 'আয় থেকে খরচ বাদ দিলে যা থাকে', tech: 'Profit & Loss' },
      trialBalance: { title: 'খাতা যাচাই', sub: 'হিসাব মিলেছে কিনা যাচাই', tech: 'Trial Balance' },
      balanceSheet: { title: 'আমাদের সম্পদ ও দেনা', sub: 'সম্পদ আর দেনার অবস্থা', tech: 'Balance Sheet' },
      statements: { title: 'বিবরণীসমূহ', sub: 'তিনটা বড় রিপোর্ট — হিসাব মিলেছে কিনা, লাভ-ক্ষতি, আর সম্পদ-দেনা', tech: 'Financial Statements' },
    },
    statementsIndex: {
      booksCheckText: 'নির্দিষ্ট সময়ের প্রতিটি খাতের ডেবিট, ক্রেডিট ও ব্যালেন্স — খাতা ৳০.০০-তে মিলে যায়, না মিললে ব্যাজে তা দেখায়।',
      plText: 'জার্নাল থেকে কোম্পানির ফলাফল ও শাখাভিত্তিক ফলাফল — আয়, খরচ এবং সেগুলোর ব্যাখ্যামূলক কভারেজ নোট।',
      balanceSheetText: 'একটি তারিখ অনুযায়ী সম্পদ, দায় ও ইকুইটি। মালিক শুরুর অবস্থান নিশ্চিত না করা পর্যন্ত সাময়িক।',
    },
    trialBalance: {
      balanced: 'হিসাব মিলেছে ✓',
      difference: 'অমিল:',
    },
    home: {
      title: 'এক নজরে হিসাব',
      sub: 'পুরো ব্যবসার হিসাব এক পেজে',
      tech: 'Accounts Overview',
      detailsLink: 'বিস্তারিত →',
      incomeSub: 'এই মাসে বিক্রিসহ মোট আয়',
      expensesSub: 'এই মাসে মোট খরচ',
      profitWord: 'লাভ',
      lossWord: 'ক্ষতি',
      profitSub: 'আয় থেকে খরচ বাদ দিলে যা থাকে',
      cashSub: 'বিভিন্ন খাতে হাতে থাকা টাকা — খাতার হিসাব অনুযায়ী',
      headOfficeNote: 'Head Office-এর খাতা মাইনাস — মালিকের নিজের টাকা কোম্পানিতে এসেছে, যার আলাদা রেকর্ড নেই (Starting Figures-এ বিস্তারিত)।',
      bankSub: 'ব্যাংক অ্যাকাউন্টে জমা — আমাদের খাতা অনুযায়ী',
      bankUnconfirmed: 'ব্যাংকের আসল statement দিয়ে এখনো মেলানো হয়নি',
      toPaySub: 'কাকে কত টাকা দিতে হবে',
      payablesOutstanding: '{count}টি পাওনা বাকি',
      receivableLabel: 'কার কাছে পাব:',
      receivableNote: '(অন্যরা আমাদের কাছে যা পায়/দেবে)',
      booksBalanced: 'হিসাব মিলেছে ✓',
      booksBalancedSub: 'সব হিসাব ঠিকঠাক মিলে গেছে',
      difference: 'অমিল:',
      pleaseNote: 'খেয়াল করুন',
      allFine: 'সব ঠিক আছে ✓ — কোনো সমস্যা নেই',
      items: '{count}টি',
      viewAll: 'সব দেখুন →',
      attention: {
        DEPOSIT_DRIFT: 'ব্যাংক জমার হিসাবে অমিল',
        CLOSING_SHORTAGES: 'কিছু দিনের হিসাবে ক্যাশ কম মিলেছে',
        PAYABLE_OVERDUE: 'মেয়াদ পেরিয়ে যাওয়া পাওনা',
        CHALAN_COST_MISSING: 'কিছু চালানে খরচের হিসাব লেখা হয়নি',
        DUPLICATE_RECORD: 'একই টাকা দুইবার লেখা থাকতে পারে',
        TXN_ID_REUSED: 'একই ব্যাংক লেনদেন নম্বর বারবার ব্যবহার হয়েছে',
        UNBOOKED_PAID_REQUEST: 'টাকা দেওয়া হয়েছে কিন্তু খাতায় ওঠেনি',
        CASH_NOT_RECORDED: 'কিছু শাখার হাতের ক্যাশের হিসাব নেই',
        KYC_PENDING: 'কিছু মানুষের পরিচয় যাচাই বাকি',
        PENDING_REQUESTS: 'কিছু খরচের আবেদন সিদ্ধান্তের অপেক্ষায়',
        PERIOD_CLOSE_PENDING: 'আগের কিছু মাস এখনো বন্ধ করা হয়নি',
        SALARY_HEAD_QUIRK: 'বেতনের দুই হিসাবে অমিল',
      },
    },
    payrollAttendance: {
      title: 'হাজিরা — এই রানের খসড়ায় সাহায্য',
      sub: 'এই রানের মাসের হাজিরা সরাসরি হাজিরা সিস্টেম থেকে পড়া হয়। এটি কখনো নিজে থেকে লাইন যোগ করে না বা কাউকে টাকা দেয় না — ‘দিন ব্যবহার করুন’ শুধু উপরের ফর্মটি পূরণ করে; যাচাই করে নিজে লাইন যোগ করুন।',
      notConfigured: 'এই সার্ভারে হাজিরা সিস্টেম যুক্ত নেই, তাই এখানে দেখানোর কিছু নেই। আগের মতো হাতে লাইন যোগ করুন।',
      unavailable: 'এই মুহূর্তে হাজিরা সিস্টেম পড়া যাচ্ছে না। কিছুই আটকে নেই — হাতে লাইন যোগ করুন, অথবা আবার লোড করে চেষ্টা করুন।',
      loading: 'হাজিরা পড়া হচ্ছে…',
      colEmployee: 'কর্মী',
      colDays: 'উপস্থিত · অনুপস্থিত · দেরি · অর্ধেক · ছুটি',
      colWorked: 'কাজের সময়',
      colOt: 'অনুমোদিত ওভারটাইম',
      colHoliday: 'ছুটির দিনে দায়িত্ব',
      colPayable: 'প্রস্তাবিত পাওনা দিন',
      useDays: 'দিন ব্যবহার করুন →',
      matchedBy: '{via} দিয়ে মিলেছে',
      viaEmail: 'ইমেইল',
      viaPhone: 'ফোন',
      viaEmployeeId: 'কর্মী আইডি',
      unmatchedTitle: 'হাজিরা সিস্টেমে আছে কিন্তু এখানকার কোনো কর্মীর সঙ্গে মেলেনি',
      unmatchedNote: 'মেলেনি এমন কাউকে কখনোই নিজে থেকে এক করা হয় না। মেলাতে চাইলে যেকোনো একদিকে তার ইমেইল, ফোন বা কর্মী আইডি ঠিক করুন।',
      daysValue: '{present} · {absent} · {late} · {half} · {leave}',
      filled: 'ফর্মটি {name}-এর জন্য পূরণ করা হয়েছে — অঙ্কগুলো যাচাই করে লাইন যোগ করুন।',
    },
  },
  branch: {
    dailyDepositDetails: 'প্রতিদিনের জমার বিবরণ',
    depositApprovalsTitle: 'প্রতিদিনের জমার বিবরণ · Daily Sales Breakdown',
    adminCards: {
      totalGrossSales: 'মোট বিক্রি',
      bankDepositsHandled: 'ব্যাংকে জমা',
      closingCashRetained: 'ক্লোজিং ক্যাশ',
      shortageAlerts: 'হিসাব স্থিতি',
      khuchra: 'খুচরা',
      khuchraFloatLabel: 'খুচরা টাকা',
    },
    performanceCards: {
      totalGrossSales: 'মোট বিক্রি',
      bankRemitted: 'ব্যাংক জমা',
      closingCashRetained: 'ড্রয়ার ক্যাশ',
      cashSales: 'নগদ',
      digitalSales: 'ডিজিটাল',
      totalRevenue: 'মোট বিক্রি',
      storeExpenses: 'খরচ',
      closingCash: 'ড্রয়ার ক্যাশ',
    },
    financialReports: {
      totalSales: 'মোট বিক্রি',
    },
    dashboardCards: {
      executiveSummary: 'আজকের হিসাব',
      totalSales: 'মোট বিক্রি',
      bankDeposits: 'ব্যাংকে জমা',
      closingCash: 'ড্রয়ার ক্যাশ',
      auditStatus: 'হিসাব স্থিতি',
      monthPerformance: 'মাসিক কর্মক্ষমতা',
    },
    monthlyReport: {
      totalSales: 'মোট বিক্রি',
      bankDeposits: 'ব্যাংকে জমা',
      cashExpenses: 'খরচ',
      drawerCash: 'ক্লোজিং ক্যাশ',
      bankWiseBreakdown: 'ব্যাংক অনুযায়ী জমা',
      cashDiscrepancies: 'অডিট বৈষম্য',
    },
    dailyClosing: {
      totalDaysSales: 'মোট বিক্রি',
      bankDeposits: 'ব্যাংকে জমা',
      countedClosingCash: 'ড্রয়ার ক্যাশ',
      reconciliationStatus: 'হিসাব স্থিতি',
      exactMatch: 'সঠিক',
      shortage: 'ঘাটতি',
      excess: 'উদ্বৃত্ত',
      openingFloat: 'ড্রয়ারে খুচরা টাকা',
      cashSalesDay: 'সারাদিনের ক্যাশ বিক্রি',
      otherCashIn: 'অন্যান্য নগদ গ্রহণ',
      totalCashHandled: 'মোট সংগৃহীত নগদ',
      cashExpensesPaid: 'নগদ খরচ',
      depositsTakenToBank: 'ব্যাংকে জমা',
      depositsPendingHq: 'অনুমোদনাধীন জমা',
      depositsPendingHqMemo: 'অনুমোদনাধীন জমা — memo',
      expectedClosingCash: 'ড্রয়ারে থাকা উচিত',
      countedPhysicalCash: 'ড্রয়ারে গুনে পাওয়া ক্যাশ',
      variance: 'পার্থক্য',
      khuchraFloatLabel: 'ড্রয়ারে থাকা খুচরা টাকা / ভাংতি',
      khuchraHint: 'নগদ বিক্রির টাকার বাইরে ড্রয়ারে যে ভাংতি/খুচরা টাকা রক্ষিত থাকে তা এখানে দিন।',
      countedTotalLabel: 'ড্রয়ারে থাকা মোট ক্যাশ - বিক্রির টাকাসহ',
      countedTotalHint: 'ড্রয়ারে থাকা সমস্ত ক্যাশ (বিক্রি + খুচরা) একসাথে গুনে এন্ট্রি করুন।',
      khuchraFloatShort: 'খুচরা ও ভাংতি টাকা',
      otherCashInShort: 'অন্যান্য জমা',
      cashExpensesDaily: 'দৈনিক খরচ',
      depositsTakenCash: 'ব্যাংকে জমা দেওয়া ক্যাশ',
      depositsPendingApproval: 'ব্যাংকে জমা - অনুমোদনের অপেক্ষায়',
      expectedCashInDrawer: 'ড্রয়ারে থাকা উচিত',
      discrepancyLabel: 'পার্থক্য:',
      exactMatchFull: 'কোনো গরমিল নেই',
      shortageShort: 'ঘাটতি',
      excessShort: 'উদ্বৃত্ত',
      khuchra: 'খুচরা',
    },
    bankDeposit: {
      otherBank: 'অন্য ব্যাংক',
      rejectedTitle: 'পূর্ববর্তী ডিপোজিট প্রত্যাখ্যাত',
      dateLabel: 'তারিখ:',
      adminReasonLabel: 'এডমিনের কারণ:',
      rejectedReasonFallback: 'তথ্য বা স্লিপের ত্রুটি',
      rejectedHint: 'আপনি নিচের ফর্মের তথ্য সংশোধন করে ও সঠিক স্লিপের ছবি সংযুক্ত করে এই তারিখের জন্য পুনরায় আবেদন জমা দিতে পারবেন।',
      existingTitle: 'এই তারিখে ইতোমধ্যে একটি ডিপোজিট সক্রিয় রয়েছে',
      amountLabel: 'পরিমাণ:',
      statusLabel: 'স্ট্যাটাস:',
      existingRule: 'নিয়মানুযায়ী প্রতি ব্রাঞ্চে প্রতিদিন সর্বোচ্চ ১টি সক্রিয় ব্যাংক ডিপোজিট অনুমোদিত। পূর্ববর্তী ডিপোজিটটি রিজেক্ট হলে তবেই নতুন আবেদন করা যাবে।',
      khuchraNote: '{amount} ছোট নোটে ব্রাঞ্চের ড্রয়ারে খুচরা হিসেবে থেকে যাবে।',
      selectBankLabel: 'বাংলাদেশের ব্যাংক নির্বাচন করুন *',
      selectBankPlaceholder: '-- ব্যাংক নির্বাচন করুন --',
    },
    depositHistory: {
      bankDepositTag: 'ব্যাংক জমা',
      khuchraRemainTag: 'ড্রয়ারে অবশিষ্ট খুচরা',
      totalSalesLine: 'মোট বিক্রয়',
      khuchraNote: '(খুচরা ২০ টাকা ড্রয়ারে থেকে যাবে এবং পরের দিনের ওপেনিং ব্যালেন্স হিসেবে যোগ হবে)',
      dailyBreakdown: 'প্রতিদিনের বিক্রির বিবরণ',
      editSubmission: 'তথ্য সংশোধন',
      resubmit: 'পুনরায় পাঠান',
      saveChanges: 'পরিবর্তন সেভ করুন',
    },
    expenseNotes: {
      adminDeduct: 'Branch-এর daily cash closing থেকে deduct হবে।',
      adminCashAutoDeduct: 'Cash expense পায়ের daily closing cash থেকে automatically deduct হবে।',
      dashDeduct: 'এই amount টি branch-এর daily cash closing থেকে automatically deduct হবে।',
      dashNoAccount: 'কোনো account number দরকার নেই।',
      dashDeductShort: 'Branch daily cash থেকে deduct হবে।',
    },
  },
  email: {
    dailySummary: {
      grossSales: 'মোট বিক্রয়',
      openingFloat: 'সকালের ক্যাশ',
      pureCashSales: '(+) নগদ বিক্রি',
      drawerExpenses: '(-) খরচ',
      bankDeposits: '(-) ব্যাংক জমা',
      actualCounted: 'ড্রয়ার ক্যাশ',
    },
  },
  pdf: {
    templates: {
      blank: {
        name: 'ফাঁকা নথি',
        title: 'OFFICIAL DOCUMENT',
        content: '<p style="font-size:14px; color:#1e293b; line-height:2">এখানে আপনার ডকুমেন্টের বিষয়বস্তু লিখুন...</p>',
      },
      notice: {
        name: 'নোটিশ',
        title: 'OFFICIAL NOTICE / নোটিশ',
        content: `
      <p style="text-align:center; font-size:15px; margin-bottom:14px;"><strong>বিষয়: &nbsp;ঈদুল ফিতর উপলক্ষে অফিস ছুটি সংক্রান্ত নোটিশ</strong></p>
      <p style="text-align:justify; line-height:2.0; margin-bottom:12px;">এতদ্বারা Anchor Fashion-এর প্রধান কার্যালয়সহ সকল শাখা অফিসের সর্বস্তরের কর্মকর্তা ও কর্মচারীদের অবগতির জন্য জানানো যাচ্ছে যে, পবিত্র ঈদুল ফিতর উপলক্ষে আগামী [তারিখ উল্লেখ করুন] হতে [তারিখ উল্লেখ করুন] পর্যন্ত প্রতিষ্ঠানের সকল কার্যক্রম বন্ধ থাকবে।</p>
      <p style="text-align:justify; line-height:2.0; margin-bottom:12px;">ছুটি শেষে আগামী [তারিখ উল্লেখ করুন] রোজ [বারের নাম] সকাল ৯:০০ ঘটিকা হতে যথারীতি অফিস কার্যক্রম পুনরায় চালু হবে। ছুটির পূর্বে সকল শাখার হিসাব-নিকাশ ও ক্যাশ ক্লোজিং সম্পন্ন করার জন্য শাখা ব্যবস্থাপকদের অনুরোধ জানানো হলো।</p>
      <p style="margin-top:16px; line-height:2.0;">কর্তৃপক্ষের অনুমোদনক্রমে এই নোটিশ জারি করা হলো এবং সকলের প্রতি ঈদের শুভেচ্ছা জ্ঞাপন করা হলো।</p>
    `,
      },
      order: {
        name: 'অফিস আদেশ',
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
    `,
      },
      certificate: {
        name: 'প্রত্যয়নপত্র',
        title: 'CERTIFICATE / প্রত্যয়নপত্র',
        content: `
      <p style="text-align:center; font-size:16px; font-weight:bold; margin-bottom:18px; letter-spacing:0.04em;">প্রত্যয়নপত্র (TO WHOM IT MAY CONCERN)</p>
      <p style="text-align:justify; line-height:2.1; margin-bottom:14px;">এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, জনাব / জনাবা <strong>[কর্মকর্তার পূর্ণ নাম]</strong>, পিতা: [পিতার নাম], মাতা: [মাতার নাম], আমাদের প্রতিষ্ঠানে <strong>[পদবী]</strong> হিসেবে গত [যোগদানের তারিখ] হতে অদ্যাবধি সততা ও নিষ্ঠার সাথে কর্মরত আছেন।</p>
      <p style="text-align:justify; line-height:2.1; margin-bottom:14px;">কর্মকালীন সময়ে তাঁর আচরণ ও দায়িত্বপালন অত্যন্ত প্রশংসনীয়। আমাদের জানামতে তিনি কোনো প্রতিষ্ঠান-বিরোধী বা শৃঙ্খলা-পরিপন্থী কর্মকাণ্ডে কখনোই জড়িত ছিলেন না। তাঁর বর্তমান মাসিক বেতন ও ভাতাদি নিয়মিত পরিশোধ করা হয়।</p>
      <p style="text-align:justify; line-height:2.1;">তাঁর ভবিষ্যৎ জীবনের সার্বিক উন্নতি ও সাফল্য কামনা করা যাচ্ছে। এই প্রত্যয়নপত্র তাঁর ব্যক্তিগত/অফিসিয়াল প্রয়োজনে কর্তৃপক্ষের অনুরোধে প্রদান করা হলো।</p>
    `,
      },
      memo: {
        name: 'স্মারকপত্র',
        title: 'INTERNAL MEMO / স্মারকপত্র',
        content: `
      <div style="border-bottom:1px solid #d0d6e0; padding-bottom:10px; margin-bottom:16px; line-height:1.9;">
        <p><strong>প্রতি (To):</strong> &nbsp;সকল বিভাগীয় প্রধান ও শাখা ব্যবস্থাপক</p>
        <p><strong>থেকে (From):</strong> &nbsp;অর্থ ও প্রশাসন বিভাগ, প্রধান কার্যালয়</p>
        <p><strong>বিষয় (Subject):</strong> &nbsp;মাসিক আর্থিক ক্লোজিং এবং ভাউচার নিরীক্ষা সংক্রান্ত</p>
      </div>
      <p style="text-align:justify; line-height:2.0; margin-bottom:12px;">চলতি মাসের হিসাব ক্লোজিং প্রক্রিয়ার অংশ হিসেবে সকল শাখার মাসিক ব্যয় বিবরণী, ভাউচার ফাইল এবং ব্যাংক বিবরণী আগামী [তারিখ উল্লেখ করুন] তারিখের মধ্যে প্রধান কার্যালয়ের অডিট বিভাগে প্রেরণের নির্দেশ দেওয়া যাচ্ছে।</p>
      <p style="text-align:justify; line-height:2.0;">কোনো প্রকার গরমিল বা অমিল পরিলক্ষিত হলে শাখা হিসাবরক্ষককে তাৎক্ষণিকভাবে জবাবদিহি করতে হবে। এ বিষয়ে সকলের সহযোগিতা একান্ত কাম্য।</p>
    `,
      },
      salary: {
        name: 'বেতন অনুমোদন',
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
    `,
      },
      expense: {
        name: 'খরচ অনুমোদন',
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
    `,
      },
    },
    ui: {
      previewPlaceholder: 'এখানে আপনার ডকুমেন্টের বিষয়বস্তু দেখা যাবে — বাম পাশে লিখুন বা টেমপ্লেট নির্বাচন করুন।',
      fieldDocTitle: 'ডকুমেন্টের শিরোনাম',
      fieldRefNo: 'স্মারক নম্বর',
      fieldBranch: 'শাখা বা পরিধি',
      fieldPreparedBy: 'প্রস্তুতকারী',
      fieldWatermark: 'ওয়াটারমার্ক',
      addressCard: 'ঠিকানা',
      signatureBlock: 'স্বাক্ষর',
      undo: 'পূর্বাবস্থায়',
      redo: 'পুনরায়',
      fontLabel: 'ফন্ট',
      fontHindSiliguri: 'Hind Siliguri (বাংলা)',
      fontNotoSans: 'Noto Sans Bengali (বাংলা)',
      editorPlaceholder: 'এখানে টাইপ বা পেস্ট করুন (বাংলা ও English)',
      renderNote: '* বাংলা যুক্তবর্ণ ও ফন্ট স্বয়ংক্রিয়ভাবে নিখুঁত রেন্ডার হবে।',
      itemHeader: 'আইটেম / বিবরণ',
      qtyHeader: 'পরিমাণ',
      priceHeader: 'মূল্য (BDT)',
      itemPlaceholder: 'বিবরণ লিখুন',
      qtySample: '১',
      priceSample: '০.০০',
    },
  },
}
