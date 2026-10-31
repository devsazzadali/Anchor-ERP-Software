import { generatePdfBuffer } from '../pdf-generator';

export interface VoucherData {
  voucherNo: string;
  date: string;
  recipientName: string;
  recipientEmail?: string;
  paymentType: 'Salary Payment' | 'Partner Payout' | 'Expense Reimbursement' | 'Money Transaction';
  title: string;
  amount: number;
  currency?: string;
  paymentMethod?: string;
  accountNumber?: string;
  trxId?: string;
  notes?: string | null;
}

/**
 * Generates a unified Bank Statement / Payment Voucher PDF on the server side (Node.js).
 * Uses the standard Anchor ERP designer PDF template (with logo & repeating watermark).
 * Returns a Buffer that can be attached directly to Resend emails.
 */
export async function generateServerPaymentVoucher(data: VoucherData): Promise<Buffer> {
  const currency = data.currency || 'BDT';
  const statusStr = data.trxId ? `Paid\nTRX: ${data.trxId}` : 'Paid';
  const amountStr = `${Number(data.amount).toLocaleString()} ${currency}`;

  const columns = ['Recipient', 'Description / Title', 'Payment Method', 'Account Number', 'Status', 'Date', 'Amount'];
  const rows = [
    [
      `${data.recipientName}${data.recipientEmail ? `\n(${data.recipientEmail})` : ''}`,
      `${data.title}${data.notes ? `\nNote: ${data.notes}` : ''}`,
      data.paymentMethod || 'Bank / Mobile Transfer',
      data.accountNumber || '—',
      statusStr,
      data.date,
      amountStr
    ]
  ];

  return await generatePdfBuffer(
    data.paymentType.toUpperCase(),
    columns,
    rows,
    {
      reportRef: data.voucherNo,
      branch: data.paymentType,
      dateRange: data.date,
      preparedBy: 'Anchor ERP Treasury & Accounts'
    }
  );
}
