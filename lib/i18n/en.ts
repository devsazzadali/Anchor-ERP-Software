export type Locale = 'en' | 'bn'

// i18n — English dictionary (the DEFAULT locale).
//
// This file defines the shape of every locale dictionary:
// lib/i18n/bn.ts is typed as `Dictionary = typeof en`, so tsc fails
// the build if the Bangla dictionary is missing a key or adds one.
// Every user-visible string in the converted surfaces lives here and
// is resolved AT RENDER from the active dictionary (never captured
// into useState initializers or module-level constants — the locale
// can switch after mount and stale strings must not stick).
export const en = {
  settings: {
    languageTitle: 'Language',
    languageHint: 'Choose the language for the whole website. It is saved to your profile and applies on every device you sign in with.',
    english: 'English',
    bangla: 'বাংলা',
    saving: 'Saving…',
    saved: 'Language saved.',
    saveFailed: 'Could not save the language. Please try again.',
  },
  auth: {
    lockedTitle: 'Account Temporarily Locked',
    lockedMessage: 'Your account has been temporarily deactivated because of too many wrong password attempts.',
    lockedRetryMinutes: 'Please try again after {minutes} minutes.',
    lockedRetryOneMinute: 'Please try again after a few moments.',
  },
  nav: {
    brandTagline: 'Enterprise Resource Planning',
    adminPanel: 'Admin Panel',
    partnerPortal: 'Partner Portal',
    branchManager: 'Branch Manager',
    headOfficePortal: 'Head Office Portal',
    employeePortalBadge: 'Employee Portal',
    signOut: 'Sign Out',
    loading: 'Loading…',
    aiWidgetTitle: 'Anchor ERP AI Fraud Risk',
    aiWidgetText: 'Verification node secure. Zero structural anomalies detected.',
    systemTelemetry: 'System Telemetry',
    userDirectory: 'User Directory',
    branchManagement: 'Branch Management',
    masterSalaryLedger: 'Master Salary Ledger',
    unifiedFinSummary: 'Unified Fin Summary',
    financialReports: 'Financial Reports',
    paymentProofs: 'Payment Proofs & Payouts',
    branchChalans: 'Branch Chalans',
    kycVerifications: 'KYC Verifications',
    userSettingsPanel: 'User Settings Panel',
    securityAuditLog: 'Security Audit Log',
    activeSessions: 'Active Sessions',
    ledgerHeads: 'Ledger Heads',
    expenseRequests: 'Expense Requests',
    generalExpenses: 'General Expenses',
    taskManagement: 'Task Management',
    pdfGenerator: 'PDF Generator',
    branchAccounts: 'Branch Accounts',
    accountsOverview: 'Accounts Overview',
    depositApprovals: 'Deposit Approvals',
    changeRequisitions: 'Change Requisitions',
    reconciliation: 'Reconciliation',
    branchPerformance: 'Branch Performance',
    accounts: 'Accounts',
    accountsAtAGlance: 'Accounts at a Glance',
    needsAttention: 'Needs Attention',
    moneyCategories: 'Money Categories',
    allEntries: 'All Entries',
    startingFigures: 'Starting Figures',
    monthOpenClose: 'Month Open / Close',
    matchWithBank: 'Match with Bank',
    peopleCompanies: 'People & Companies',
    toPay: 'To Pay',
    salaryAccounts: 'Salary Accounts',
    vatTax: 'VAT & Tax',
    cheques: 'Cheques',
    statements: 'Statements',
    booksCheck: 'Books Check',
    profitLoss: 'Profit & Loss',
    whatWeOwnOwe: 'What We Own & Owe',
    auditorReport: 'Auditor Report',
    systemSettings: 'System Settings',
    partnerDashboard: 'Partner Dashboard',
    profileSettings: 'Profile Settings',
    branchExpenses: 'Branch Expenses',
    salaryLedger: 'Salary Ledger',
    assignedTasks: 'Assigned Tasks',
    employeePortal: 'Employee Portal',
    corporatePortal: 'Corporate Portal',
    branchDashboard: 'Branch Dashboard',
    dailyClosing: 'Daily Closing',
    cashLedger: 'Cash Ledger',
    bankDeposit: 'Bank Deposit',
    depositHistory: 'Deposit History',
    changeRequisition: 'Change Requisition',
    bankStatements: 'Bank Statements',
    salesSummary: 'Sales Summary',
    monthlyReport: 'Monthly Report',
  },
  accounts: {
    head: {
      auditor: { title: 'Auditor Report', sub: 'All reports for the auditor in one file', tech: 'Auditor Package' },
      bank: { title: 'Match with Bank', sub: 'Matching our books with the bank statement', tech: 'Bank Reconciliation' },
      bankDetailSub: 'Matching our books with the bank statement',
      chart: { title: 'Money Categories', sub: 'Which categories money goes into', tech: 'Chart of Accounts' },
      cheques: { title: 'Cheques', sub: 'Cheques issued and received, and which ones have cleared', tech: 'Cheque Register' },
      exceptions: { title: 'Needs Attention', sub: 'Where there is a mismatch or problem', tech: 'Exceptions Inbox' },
      journal: { title: 'All Entries', sub: 'Record of every transaction', tech: 'Journal — append-only' },
      opening: { title: 'Starting Figures', sub: 'The position when the books were started', tech: 'Opening Position' },
      parties: { title: 'People & Companies', sub: 'People and companies we transact with', tech: 'Counterparties' },
      payables: { title: 'To Pay', sub: 'Who has to be paid, and how much', tech: 'Payables & Ageing' },
      payroll: { title: 'Salary Accounts', sub: 'All salary accounts in one place', tech: 'Payroll' },
      payrollDetail: { title: 'Salary Accounts', sub: 'All salary accounts in one place', tech: 'Payroll run detail' },
      periods: { title: 'Month Open / Close', sub: 'Which months are closed or still open', tech: 'Accounting Periods & Fiscal Years' },
      tax: { title: 'VAT & Tax', sub: 'Government VAT and tax accounts', tech: 'VAT / TDS' },
      pl: { title: 'Profit & Loss', sub: 'What remains after expenses are deducted from income', tech: 'Profit & Loss' },
      trialBalance: { title: 'Books Check', sub: 'Check whether the books balance', tech: 'Trial Balance' },
      balanceSheet: { title: 'What We Own & Owe', sub: 'Assets and liabilities position', tech: 'Balance Sheet' },
      statements: { title: 'Statements', sub: 'Three big reports — whether the books balance, profit & loss, and assets & liabilities', tech: 'Financial Statements' },
    },
    statementsIndex: {
      booksCheckText: 'Every account with its debit, credit and balance for the period — the books balance to ৳0.00 or the badge says so.',
      plText: 'Company result and per-branch result from the journal — income, expenses, and the coverage notes that qualify them.',
      balanceSheetText: 'Assets, liabilities and equity as of a date. Provisional until the owner confirms the opening position.',
    },
    trialBalance: {
      balanced: 'Books Balanced ✓',
      difference: 'Difference:',
    },
    home: {
      title: 'Accounts at a Glance',
      sub: "The whole business's accounts on one page",
      tech: 'Accounts Overview',
      detailsLink: 'Details →',
      incomeSub: 'Total income this month, including sales',
      expensesSub: 'Total expenses this month',
      profitWord: 'Profit',
      lossWord: 'Loss',
      profitSub: 'What remains after expenses are deducted from income',
      cashSub: 'Cash in hand under different heads — as per the books',
      headOfficeNote: "The Head Office account is negative — the owner's own money came into the company, with no separate record of it (see Starting Figures for details).",
      bankSub: 'Deposited in bank accounts — as per our books',
      bankUnconfirmed: 'Not yet matched against the actual bank statement',
      toPaySub: 'Who has to be paid, and how much',
      payablesOutstanding: '{count} payables outstanding',
      receivableLabel: 'Receivable from others:',
      receivableNote: '(what others owe us / will pay us)',
      booksBalanced: 'Books Balanced ✓',
      booksBalancedSub: 'All accounts have balanced properly',
      difference: 'Difference:',
      pleaseNote: 'Please Note',
      allFine: 'Everything is fine ✓ — no problems',
      items: '{count} items',
      viewAll: 'View all →',
      attention: {
        DEPOSIT_DRIFT: 'Mismatch in the bank deposit accounts',
        CLOSING_SHORTAGES: 'Cash came up short on some days',
        PAYABLE_OVERDUE: 'Overdue payables',
        CHALAN_COST_MISSING: 'Costs not recorded on some chalans',
        DUPLICATE_RECORD: 'The same money may have been recorded twice',
        TXN_ID_REUSED: 'The same bank transaction number was used more than once',
        UNBOOKED_PAID_REQUEST: 'Money was paid out but not entered in the books',
        CASH_NOT_RECORDED: 'Cash in hand is not recorded for some branches',
        KYC_PENDING: 'Identity verification is pending for some people',
        PENDING_REQUESTS: 'Some expense requests are awaiting a decision',
        PERIOD_CLOSE_PENDING: 'Some earlier months have not been closed yet',
        SALARY_HEAD_QUIRK: 'Mismatch between the two salary accounts',
      },
    },
    payrollAttendance: {
      title: 'Attendance — draft help for this run',
      sub: 'Read live from the attendance system for this run’s month. It never adds a line or pays anyone — “Use days” only fills the form above; check it and add the line yourself.',
      notConfigured: 'Attendance is not connected on this server, so there is nothing to show here. Add lines by hand, as before.',
      unavailable: 'The attendance system could not be read just now. Nothing is blocked — add lines by hand, or reload to try again.',
      loading: 'Reading attendance…',
      colEmployee: 'Employee',
      colDays: 'Present · Absent · Late · Half · Leave',
      colWorked: 'Worked',
      colOt: 'Approved overtime',
      colHoliday: 'Holiday duty',
      colPayable: 'Suggested payable days',
      useDays: 'Use days →',
      matchedBy: 'Matched by {via}',
      viaEmail: 'email',
      viaPhone: 'phone',
      viaEmployeeId: 'employee ID',
      unmatchedTitle: 'In the attendance system but not matched to any employee here',
      unmatchedNote: 'Unmatched people are never merged automatically. Fix their email, phone or employee ID on one side if they should match.',
      daysValue: '{present} · {absent} · {late} · {half} · {leave}',
      filled: 'Form filled for {name} — check the amounts, then add the line.',
    },
  },
  branch: {
    dailyDepositDetails: 'Daily Deposit Details',
    depositApprovalsTitle: 'Daily Deposit Details · Daily Sales Breakdown',
    adminCards: {
      totalGrossSales: 'Total Gross Sales',
      bankDepositsHandled: 'Bank Deposits Handled',
      closingCashRetained: 'Closing Cash Retained',
      shortageAlerts: 'Shortage Alerts',
      khuchra: 'Khuchra',
      khuchraFloatLabel: 'Khuchra / Change Float (৳)',
    },
    performanceCards: {
      totalGrossSales: 'Total Gross Sales',
      bankRemitted: 'Bank Remitted',
      closingCashRetained: 'Closing Cash Retained',
      cashSales: 'Cash Sales',
      digitalSales: 'Digital Sales',
      totalRevenue: 'Total Revenue',
      storeExpenses: 'Store Expenses',
      closingCash: 'Closing Cash',
    },
    financialReports: {
      totalSales: 'Total Sales',
    },
    dashboardCards: {
      executiveSummary: "Today's Executive Summary",
      totalSales: 'Total Sales',
      bankDeposits: 'Bank Deposits',
      closingCash: 'Closing Cash',
      auditStatus: 'Audit Status',
      monthPerformance: 'This Month — Financial Performance',
    },
    monthlyReport: {
      totalSales: 'Total Sales',
      bankDeposits: 'Bank Deposits',
      cashExpenses: 'Cash Expenses',
      drawerCash: 'Drawer Cash',
      bankWiseBreakdown: 'Bank-Wise Deposit Breakdown',
      cashDiscrepancies: 'Cash Count Discrepancies',
    },
    dailyClosing: {
      totalDaysSales: "Total Day's Sales",
      bankDeposits: 'Bank Deposits',
      countedClosingCash: 'Counted Closing Cash',
      reconciliationStatus: 'Reconciliation Status',
      exactMatch: 'Exact Match',
      shortage: 'Shortage',
      excess: 'Excess',
      openingFloat: 'Opening Cash / Khuchra Float',
      cashSalesDay: 'Physical Cash Sales',
      otherCashIn: 'Other Cash In',
      totalCashHandled: 'Total Cash Handled',
      cashExpensesPaid: 'Cash Expenses Paid',
      depositsTakenToBank: 'Bank Deposits Taken to Bank',
      depositsPendingHq: 'Bank Deposits Pending HQ Approval',
      depositsPendingHqMemo: 'Bank Deposits Pending HQ Approval — memo',
      expectedClosingCash: 'Expected Closing Cash',
      countedPhysicalCash: 'Counted Physical Cash',
      variance: 'Variance / Discrepancy',
      khuchraFloatLabel: 'Khuchra / Change Float (৳)',
      khuchraHint: 'Enter here the change / small notes kept in the drawer, apart from the cash sales money.',
      countedTotalLabel: 'Total Counted Physical Cash in Drawer (৳)',
      countedTotalHint: 'Count all the cash in the drawer (sales + change) together and enter it.',
      khuchraFloatShort: 'Khuchra / Float',
      otherCashInShort: 'Other Cash In',
      cashExpensesDaily: 'Cash Expenses Paid',
      depositsTakenCash: 'Bank Deposits Taken to Bank',
      depositsPendingApproval: 'Bank Deposits Pending Approval',
      expectedCashInDrawer: 'Expected Cash in Drawer',
      discrepancyLabel: 'Discrepancy:',
      exactMatchFull: 'Exact Match',
      shortageShort: 'Shortage',
      excessShort: 'Excess',
      khuchra: 'Khuchra',
    },
    bankDeposit: {
      otherBank: 'Other / Custom Bank',
      rejectedTitle: 'Previous Deposit Rejected',
      dateLabel: 'Date:',
      adminReasonLabel: "Admin's reason:",
      rejectedReasonFallback: 'Error in the information or slip',
      rejectedHint: 'You can correct the information in the form below, attach the correct slip image, and resubmit the application for this date.',
      existingTitle: 'A deposit is already active for this date',
      amountLabel: 'Amount:',
      statusLabel: 'Status:',
      existingRule: 'As per the rules, a maximum of 1 active bank deposit per branch per day is allowed. A new application can only be made if the previous deposit is rejected.',
      khuchraNote: '{amount} in small notes will remain in the branch drawer as change (khuchra).',
      selectBankLabel: 'Select Bank *',
      selectBankPlaceholder: '-- Select Bank --',
    },
    depositHistory: {
      bankDepositTag: 'Bank Deposit',
      khuchraRemainTag: 'Khuchra remaining in drawer',
      totalSalesLine: 'Total Sales',
      khuchraNote: '(20 taka of khuchra will remain in the drawer and be added as the next day\'s opening balance)',
      dailyBreakdown: 'Daily Sales Breakdown',
      editSubmission: 'Edit Submission',
      resubmit: 'Resubmit',
      saveChanges: 'Save Changes',
    },
    expenseNotes: {
      adminDeduct: "This will be deducted from the branch's daily cash closing.",
      adminCashAutoDeduct: "The cash expense will be automatically deducted from the recipient's daily closing cash.",
      dashDeduct: "This amount will be automatically deducted from the branch's daily cash closing.",
      dashNoAccount: 'No account number is needed.',
      dashDeductShort: 'This will be deducted from the branch daily cash.',
    },
  },
  email: {
    dailySummary: {
      grossSales: 'GROSS SALES REVENUE',
      openingFloat: 'Opening Drawer Float',
      pureCashSales: '(+) Pure Cash Sales',
      drawerExpenses: '(-) Drawer Cash Expenses',
      bankDeposits: '(-) Bank Deposits Remitted',
      actualCounted: 'Actual Counted Cash',
    },
  },
  pdf: {
    templates: {
      blank: {
        name: 'Blank Document',
        title: 'OFFICIAL DOCUMENT',
        content: '<p style="font-size:14px; color:#1e293b; line-height:2">Write your document content here...</p>',
      },
      notice: {
        name: 'Notice',
        title: 'OFFICIAL NOTICE',
        content: `
      <p style="text-align:center; font-size:15px; margin-bottom:14px;"><strong>Subject: &nbsp;Notice regarding office holiday on the occasion of Eid-ul-Fitr</strong></p>
      <p style="text-align:justify; line-height:2.0; margin-bottom:12px;">This is to inform all officers and employees of Anchor Fashion, including the head office and all branch offices, that on the occasion of the holy Eid-ul-Fitr, all activities of the organisation will remain closed from [Enter date] to [Enter date].</p>
      <p style="text-align:justify; line-height:2.0; margin-bottom:12px;">After the holiday, office activities will resume as usual from [Enter date], [Day name], at 9:00 AM. Branch managers are requested to complete all branch accounts and cash closing before the holiday.</p>
      <p style="margin-top:16px; line-height:2.0;">This notice is issued with the approval of the authority, and Eid greetings are extended to everyone.</p>
    `,
      },
      order: {
        name: 'Office Order',
        title: 'OFFICE ORDER',
        content: `
      <p style="text-align:center; font-size:15px; margin-bottom:14px;"><strong>Subject: &nbsp;Instructions regarding branch account management and daily report submission</strong></p>
      <p style="text-align:justify; line-height:2.0; margin-bottom:12px;">In order to make the organisation's internal accounting process more orderly and accountable, the following instructions are issued by order of the appropriate authority:</p>
      <ol style="line-height:2.1; margin-left:24px; margin-bottom:14px;">
        <li>Every day by 8:00 PM, all branches must enter their daily sales, cash deposits and expense accounts into the Anchor ERP system.</li>
        <li>Any kind of branch expense or advance payment without an approved voucher is completely prohibited.</li>
        <li>Bank deposit slips must be scanned at the respective branch and uploaded to the system immediately.</li>
      </ol>
      <p style="text-align:justify; line-height:2.0;">The above instructions will take effect immediately. All concerned are directed to strictly follow this order.</p>
    `,
      },
      certificate: {
        name: 'Certificate',
        title: 'CERTIFICATE',
        content: `
      <p style="text-align:center; font-size:16px; font-weight:bold; margin-bottom:18px; letter-spacing:0.04em;">Certificate (TO WHOM IT MAY CONCERN)</p>
      <p style="text-align:justify; line-height:2.1; margin-bottom:14px;">This is to certify that Mr. / Ms. <strong>[Full name of the officer]</strong>, son/daughter of: [Father's name], mother: [Mother's name], has been working at our organisation as <strong>[Designation]</strong> since [Date of joining] with honesty and dedication.</p>
      <p style="text-align:justify; line-height:2.1; margin-bottom:14px;">During his/her tenure, his/her conduct and performance of duties have been highly commendable. To our knowledge, he/she has never been involved in any anti-organisational or disciplinary activity. His/her current monthly salary and allowances are paid regularly.</p>
      <p style="text-align:justify; line-height:2.1;">We wish him/her overall progress and success in his/her future life. This certificate is issued at the request of the authority for his/her personal/official use.</p>
    `,
      },
      memo: {
        name: 'Internal Memo',
        title: 'INTERNAL MEMO',
        content: `
      <div style="border-bottom:1px solid #d0d6e0; padding-bottom:10px; margin-bottom:16px; line-height:1.9;">
        <p><strong>To:</strong> &nbsp;All Department Heads and Branch Managers</p>
        <p><strong>From:</strong> &nbsp;Finance &amp; Administration Department, Head Office</p>
        <p><strong>Subject:</strong> &nbsp;Regarding monthly financial closing and voucher audit</p>
      </div>
      <p style="text-align:justify; line-height:2.0; margin-bottom:12px;">As part of this month's account closing process, all branches are directed to send their monthly expense statements, voucher files and bank statements to the Audit Department of the head office by [Enter date].</p>
      <p style="text-align:justify; line-height:2.0;">If any discrepancy or mismatch is observed, the branch accountant will have to provide an immediate explanation. Everyone's cooperation in this matter is highly appreciated.</p>
    `,
      },
      salary: {
        name: 'Salary Approval',
        title: 'SALARY DISBURSEMENT',
        content: `
      <p style="text-align:center; font-size:15px; margin-bottom:14px;"><strong>Subject: &nbsp;Approval for payment of monthly salary and allowances of officers and employees</strong></p>
      <p style="text-align:justify; line-height:2.0; margin-bottom:14px;">After due audit of this month's salary bill prepared by the Accounts Department, and with the approval of the appropriate authority, instructions are hereby given to release the funds as follows:</p>
      <table style="width:100%; border-collapse:collapse; margin:14px 0; font-size:12px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:center; width:40px;">SL.</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:left;">Officer / Employee Name</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:left;">Designation &amp; Branch</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:right;">Basic Salary (BDT)</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:right;">Total Payable (BDT)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:center;">01</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">[Officer Name 01]</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">Branch Manager (Mirpur)</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:right;">45,000.00</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:right; font-weight:bold; color:#0f3057;">45,000.00</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:center;">02</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">[Officer Name 02]</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">Accounts Officer (Uttara)</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:right;">35,000.00</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:right; font-weight:bold; color:#0f3057;">35,000.00</td>
          </tr>
        </tbody>
      </table>
      <p style="text-align:justify; line-height:2.0; margin-top:12px;">It is requested to send the money directly from the treasury and bank accounts to the respective officers' and employees' bank accounts via BEFTN / online transfer.</p>
    `,
      },
      expense: {
        name: 'Expense Approval',
        title: 'EXPENSE APPROVAL',
        content: `
      <p style="text-align:center; font-size:15px; margin-bottom:14px;"><strong>Subject: &nbsp;Regarding approval of branch operation and maintenance expenses</strong></p>
      <p style="text-align:justify; line-height:2.0; margin-bottom:14px;">After audit of the receipts and vouchers of the following urgent operational expenses submitted by the branch office, approval is granted in accordance with the decision of the appropriate authority:</p>
      <table style="width:100%; border-collapse:collapse; margin:14px 0; font-size:12px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:center; width:40px;">SL.</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:left;">Expense Head &amp; Description</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:left;">Requesting Branch</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:center;">Date</th>
            <th style="border:1px solid #cbd5e1; padding:8px; text-align:right;">Approved Amount (BDT)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:center;">01</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">Office Electricity &amp; Utility Bills</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">Banani Branch</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:center;">[Date]</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:right; font-weight:bold; color:#0f3057;">12,500.00</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:center;">02</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">Purchase of Urgent Stationery &amp; Printing Materials</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">Dhanmondi Branch</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:center;">[Date]</td>
            <td style="border:1px solid #cbd5e1; padding:8px; text-align:right; font-weight:bold; color:#0f3057;">4,200.00</td>
          </tr>
        </tbody>
      </table>
      <p style="text-align:justify; line-height:2.0; margin-top:12px;">Instructions are given to arrange payment of the approved amount immediately from petty cash or the bank.</p>
    `,
      },
    },
    ui: {
      previewPlaceholder: 'Your document content will appear here — write on the left side or select a template.',
      fieldDocTitle: 'Document Title',
      fieldRefNo: 'Reference No',
      fieldBranch: 'Branch / Scope',
      fieldPreparedBy: 'Prepared By',
      fieldWatermark: 'Watermark',
      addressCard: 'Address Card',
      signatureBlock: 'Signature Block',
      undo: 'Undo',
      redo: 'Redo',
      fontLabel: 'Font',
      fontHindSiliguri: 'Hind Siliguri (Bengali)',
      fontNotoSans: 'Noto Sans Bengali (Bengali)',
      editorPlaceholder: 'Type or paste here (Bengali & English)',
      renderNote: '* Bengali conjunct characters and fonts will render perfectly automatically.',
      itemHeader: 'Item / Description',
      qtyHeader: 'Quantity',
      priceHeader: 'Price (BDT)',
      itemPlaceholder: 'Write a description',
      qtySample: '1',
      priceSample: '0.00',
    },
  },
}

// The shape every locale dictionary must match exactly.
export type Dictionary = typeof en
