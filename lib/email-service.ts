import { Resend } from 'resend';
import { bundleValueFor } from '@/lib/bundles';
import { prisma } from '@/lib/db';
import { isPartnerAccount } from '@/lib/server/auth';

/**
 * Fetches dynamic system settings from the database.
 *
 * The Resend API key is a SECRET: it is read ONLY from the server
 * environment (RESEND_API_KEY). It previously lived as a plaintext row
 * in system_settings and was returned in full by the admin settings
 * API to any admin session (audit Part D). The sender email is not a
 * secret and still comes from system_settings.
 *
 * system_settings is read via Prisma; no service-role
 * client exists in the app.
 */
async function getEmailSettings() {
  let data: { key: string; value: string }[] | null = null;
  try {
    data = await prisma.systemSetting.findMany({
      where: { key: { in: ['sender_email'] } },
      select: { key: true, value: true },
    });
  } catch (error) {
    console.error('Error fetching email settings:', error);
    return { apiKey: process.env.RESEND_API_KEY || null, senderEmail: null };
  }

  const settings = data?.reduce((acc, curr) => {
    acc[curr.key] = curr.value;
    return acc;
  }, {} as Record<string, string>);

  return {
    apiKey: process.env.RESEND_API_KEY || null,
    senderEmail: settings?.sender_email || null,
  };
}

/**
 * Core function to send an email using Resend dynamically.
 */
export async function sendPremiumEmail({
  to,
  subject,
  html,
  attachments,
}: {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer | string }[];
}) {
  const { apiKey, senderEmail } = await getEmailSettings();

  if (!apiKey || !senderEmail) {
    console.warn('Email sending aborted: Resend API Key or Sender Email is missing in System Settings.');
    return { success: false, error: 'Missing Email Configuration' };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: `Anchor ERP <${senderEmail}>`,
      to,
      subject,
      html,
      attachments: attachments as any,
    });

    if (error) {
      console.error('Resend API Error:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err: any) {
    console.error('Unexpected error sending email:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Generates the dark-mode executive receipt email wrapper matching banking standards.
 */
function getPremiumReceiptEmailHtml({
  greeting,
  amountFormatted,
  transactionId,
  boxTitle,
  statusBadge = '✓ Success',
  fromAccount,
  toAccount,
  amountValue,
  transactionType,
  paymentMethod,
  dateTime,
  helplineUrl = '#',
}: {
  greeting: string;
  amountFormatted: string;
  transactionId: string;
  boxTitle: string;
  statusBadge?: string;
  fromAccount: string;
  toAccount: string;
  amountValue: string;
  transactionType: string;
  paymentMethod: string;
  dateTime: string;
  helplineUrl?: string;
}) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${boxTitle}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #0f1115; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0f1115; min-height: 100vh; padding: 40px 15px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" style="max-width: 560px; text-align: left;" cellspacing="0" cellpadding="0" border="0">
              
              <!-- Greeting & Main Sentence -->
              <tr>
                <td style="padding-bottom: 24px;">
                  <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">${greeting}</h1>
                  <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #cbd5e1;">
                    Your transaction of <strong style="color: #ffffff; font-weight: 700;">${amountFormatted}</strong> with Transaction ID 
                    <span style="display: inline-block; background-color: #1e222d; color: #f8fafc; font-family: monospace; font-size: 14px; font-weight: 600; padding: 2px 8px; border-radius: 4px; border: 1px solid #334155;">${transactionId}</span> 
                    has been successfully processed.
                  </p>
                </td>
              </tr>

              <!-- Receipt Box -->
              <tr>
                <td>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #161922; border: 1px solid #282d3c; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                    
                    <!-- Box Header Bar -->
                    <tr>
                      <td style="padding: 20px 24px; background-color: #161922; border-bottom: 1px solid #232836;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td width="36" valign="middle">
                              <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); border-radius: 8px; text-align: center; line-height: 32px; color: #ffffff; font-weight: bold; font-size: 16px;">
                                &#8801;
                              </div>
                            </td>
                            <td valign="middle" style="padding-left: 12px;">
                              <span style="font-size: 17px; font-weight: 700; color: #ffffff;">${boxTitle}</span>
                            </td>
                            <td align="right" valign="middle">
                              <span style="display: inline-block; background-color: #064e3b; border: 1px solid #059669; color: #34d399; font-size: 13px; font-weight: 600; padding: 4px 12px; border-radius: 20px;">
                                ${statusBadge}
                              </span>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <!-- Box Body Content -->
                    <tr>
                      <td style="padding: 28px 24px;">
                        
                        <!-- FROM ACCOUNT -->
                        <div style="margin-bottom: 22px;">
                          <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 5px;">FROM ACCOUNT</div>
                          <div style="font-size: 15px; font-weight: 600; color: #f8fafc;">${fromAccount}</div>
                        </div>

                        <!-- TO ACCOUNT -->
                        <div style="margin-bottom: 22px;">
                          <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 5px;">TO ACCOUNT</div>
                          <div style="font-size: 15px; font-weight: 600; color: #f8fafc; line-height: 1.4;">${toAccount}</div>
                        </div>

                        <!-- TRANSACTION ID -->
                        <div style="margin-bottom: 22px;">
                          <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 5px;">TRANSACTION ID</div>
                          <div style="font-size: 15px; font-weight: 600; color: #ffffff; font-family: monospace;">${transactionId}</div>
                        </div>

                        <!-- AMOUNT -->
                        <div style="margin-bottom: 22px;">
                          <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 5px;">AMOUNT</div>
                          <div style="font-size: 16px; font-weight: 700; color: #38bdf8;">${amountValue}</div>
                        </div>

                        <!-- TRANSACTION TYPE -->
                        <div style="margin-bottom: 22px;">
                          <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 5px;">TRANSACTION TYPE</div>
                          <div style="font-size: 15px; font-weight: 600; color: #e2e8f0;">${transactionType}</div>
                        </div>

                        <!-- PAYMENT METHOD -->
                        <div style="margin-bottom: 22px;">
                          <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 5px;">DISBURSEMENT METHOD</div>
                          <div style="font-size: 15px; font-weight: 600; color: #e2e8f0;">${paymentMethod}</div>
                        </div>

                        <!-- DATE & TIME -->
                        <div>
                          <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 5px;">DATE &amp; TIME</div>
                          <div style="font-size: 15px; font-weight: 600; color: #e2e8f0;">${dateTime}</div>
                        </div>

                      </td>
                    </tr>

                  </table>
                </td>
              </tr>

              <!-- Footer Warning & Helpline Note -->
              <tr>
                <td style="padding-top: 24px; text-align: center;">
                  <p style="margin: 0 0 12px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
                    If this transaction was not processed by you, please immediately contact our <a href="${helplineUrl}" style="color: #ef4444; text-decoration: underline; font-weight: 600;">helpline</a>.
                  </p>
                  <p style="margin: 0 0 24px 0; font-size: 13px; color: #64748b;">
                    📎 An official PDF statement &amp; receipt is attached to this email for your accounting records.
                  </p>
                  <p style="margin: 0; font-size: 12px; color: #475569;">
                    &copy; ${new Date().getFullYear()} Anchor Fashion ERP. All rights reserved.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

/**
 * Helper to build uniform data rows for notifications
 */
function buildDataRow(label: string, value: string, isHighlighted = false, color?: string) {
  const textColor = color || (isHighlighted ? '#38bdf8' : '#f8fafc');
  return `
    <div style="margin-bottom: 22px;">
      <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 5px;">${label}</div>
      <div style="font-size: ${isHighlighted ? '18px' : '15px'}; font-weight: ${isHighlighted ? '700' : '600'}; color: ${textColor};">${value}</div>
    </div>
  `;
}

/**
 * Returns current date/time formatted in Bangladesh Standard Time (UTC+6).
 */
function bdTime(date?: Date | string | null): string {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }) + ' BST';
}

/**
 * Generates the premium dark-mode notification HTML wrapper.
 */
function getPremiumNotificationHtml({
  title,
  greeting,
  introText,
  boxTitle,
  boxIcon = '&#8801;',
  badgeText = 'Notice',
  badgeColor = '#38bdf8',
  badgeBg = '#0c4a6e',
  badgeBorder = '#0284c7',
  contentHtml,
  footerNote = 'This is an automated notification. Please do not reply directly to this email.'
}: {
  title: string;
  greeting: string;
  introText: string;
  boxTitle: string;
  boxIcon?: string;
  badgeText?: string;
  badgeColor?: string;
  badgeBg?: string;
  badgeBorder?: string;
  contentHtml: string;
  footerNote?: string;
}) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #0f1115; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0f1115; min-height: 100vh; padding: 40px 15px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" style="max-width: 560px; text-align: left;" cellspacing="0" cellpadding="0" border="0">
              
              <!-- Greeting & Main Sentence -->
              <tr>
                <td style="padding-bottom: 24px;">
                  <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">${greeting}</h1>
                  <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #cbd5e1;">
                    ${introText}
                  </p>
                </td>
              </tr>

              <!-- Receipt Box -->
              <tr>
                <td>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #161922; border: 1px solid #282d3c; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                    
                    <!-- Box Header Bar -->
                    <tr>
                      <td style="padding: 20px 24px; background-color: #161922; border-bottom: 1px solid #232836;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td width="36" valign="middle">
                              <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); border-radius: 8px; text-align: center; line-height: 32px; color: #ffffff; font-weight: bold; font-size: 16px;">
                                ${boxIcon}
                              </div>
                            </td>
                            <td valign="middle" style="padding-left: 12px;">
                              <span style="font-size: 17px; font-weight: 700; color: #ffffff;">${boxTitle}</span>
                            </td>
                            <td align="right" valign="middle">
                              <span style="display: inline-block; background-color: ${badgeBg}; border: 1px solid ${badgeBorder}; color: ${badgeColor}; font-size: 13px; font-weight: 600; padding: 4px 12px; border-radius: 20px;">
                                ${badgeText}
                              </span>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <!-- Box Body Content -->
                    <tr>
                      <td style="padding: 28px 24px; color: #e2e8f0; font-size: 15px; line-height: 1.6;">
                        ${contentHtml}
                      </td>
                    </tr>

                  </table>
                </td>
              </tr>

              <!-- Footer Note -->
              <tr>
                <td style="padding-top: 24px; text-align: center;">
                  <p style="margin: 0 0 12px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
                    ${footerNote}
                  </p>
                  <p style="margin: 0; font-size: 12px; color: #475569;">
                    &copy; ${new Date().getFullYear()} Anchor Fashion ERP. All rights reserved.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

// Specific email templates.

export async function sendLoginNotification(userEmail: string, userName: string, ipAddress: string = 'Unknown', location: string = 'Unknown') {
  const html = getPremiumNotificationHtml({
    title: 'New Login Alert - Anchor ERP',
    greeting: `Dear ${userName || 'User'},`,
    introText: 'We have detected a recent login to your Anchor ERP account. For your security, the details of this session are provided below.',
    boxTitle: 'Login Session Details',
    boxIcon: '🔒',
    badgeText: 'Security Alert',
    badgeBg: '#450a0a', badgeBorder: '#7f1d1d', badgeColor: '#f87171',
    contentHtml: `
      ${buildDataRow('Date & Time', bdTime())}
      ${buildDataRow('IP Address', ipAddress)}
      ${buildDataRow('Device / Location', location)}
    `,
    footerNote: 'If you authorized this login, no further action is required. If you do not recognize this activity, please secure your account immediately and contact IT administration.'
  });
  return sendPremiumEmail({ to: userEmail, subject: 'Security Alert: New Login Detected - Anchor ERP', html });
}

export async function sendKycSubmissionToAdmins(adminEmails: string[], partnerName: string) {
  const html = getPremiumNotificationHtml({
    title: 'New KYC Submission',
    greeting: 'Hello Administration Team,',
    introText: `A new KYC (Know Your Customer) verification request has been securely submitted by <strong>${partnerName}</strong> and is currently awaiting your review.`,
    boxTitle: 'KYC Request Details',
    boxIcon: '📄',
    badgeText: 'Action Required',
    badgeBg: '#422006', badgeBorder: '#713f12', badgeColor: '#facc15',
    contentHtml: `
      ${buildDataRow('Partner Name', partnerName)}
      ${buildDataRow('Submission Date', bdTime())}
      ${buildDataRow('Current Status', 'Pending Verification', true)}
    `,
    footerNote: 'Please log in to the secure administrative portal to review the submitted documents and process this request.'
  });
  return sendPremiumEmail({ to: adminEmails, subject: `Action Required: New KYC Submission from ${partnerName}`, html });
}

export async function sendKycApprovalToUser(userEmail: string, userName: string) {
  const html = getPremiumNotificationHtml({
    title: 'KYC Verification Approved',
    greeting: `Dear ${userName},`,
    introText: 'We are pleased to inform you that your KYC verification has been successfully processed and approved by our compliance team.',
    boxTitle: 'Account Status Update',
    boxIcon: '✅',
    badgeText: 'Approved',
    badgeBg: '#064e3b', badgeBorder: '#059669', badgeColor: '#34d399',
    contentHtml: `
      <div style="margin-bottom: 22px; font-size: 15px; color: #e2e8f0; line-height: 1.6;">
        Your profile is now fully verified. You have been granted complete access to the partner dashboard, enabling you to request payouts, receive tasks, and utilize all platform features.
      </div>
      ${buildDataRow('Approval Date', new Date().toLocaleDateString())}
      ${buildDataRow('Account Tier', 'Verified Partner')}
    `,
    footerNote: 'Welcome aboard! If you have any further questions, our support team is always here to help.'
  });
  return sendPremiumEmail({ to: userEmail, subject: 'Welcome! Your KYC Verification is Approved', html });
}

export async function sendTaskAssignmentToUser(userEmail: string, userName: string, taskTitle: string, dueDate: string, description: string) {
  const html = getPremiumNotificationHtml({
    title: 'New Task Assigned',
    greeting: `Dear ${userName},`,
    introText: 'A new operational task has been assigned to your profile. Please review the details below and ensure completion by the specified deadline.',
    boxTitle: 'Task Details',
    boxIcon: '📋',
    badgeText: 'Assigned',
    badgeBg: '#1e3a8a', badgeBorder: '#1d4ed8', badgeColor: '#60a5fa',
    contentHtml: `
      ${buildDataRow('Task Title', taskTitle, true)}
      ${buildDataRow('Due Date', new Date(dueDate).toLocaleDateString())}
      ${buildDataRow('Task Description', description)}
    `,
    footerNote: 'Please log in to your operational dashboard to view comprehensive details and track your progress.'
  });
  return sendPremiumEmail({ to: userEmail, subject: `New Task Assignment: ${taskTitle}`, html });
}

export async function sendTaskCompletionToAdmins(adminEmails: string[], userName: string, taskTitle: string) {
  const html = getPremiumNotificationHtml({
    title: 'Task Completed',
    greeting: 'Hello Administration Team,',
    introText: `Please be advised that partner <strong>${userName}</strong> has formally marked an assigned task as completed.`,
    boxTitle: 'Completion Summary',
    boxIcon: '☑️',
    badgeText: 'Review Required',
    badgeBg: '#422006', badgeBorder: '#713f12', badgeColor: '#facc15',
    contentHtml: `
      ${buildDataRow('Task Title', taskTitle)}
      ${buildDataRow('Assigned Partner', userName)}
      ${buildDataRow('Time of Completion', bdTime())}
    `,
    footerNote: 'You may log in to the admin panel to verify the completion of this task.'
  });
  return sendPremiumEmail({ to: adminEmails, subject: `Task Completed Notification: ${taskTitle}`, html });
}

export async function sendPayoutRequestToAdmins(adminEmails: string[], partnerName: string, amount: number, currency: string) {
  const html = getPremiumNotificationHtml({
    title: 'New Payout Request',
    greeting: 'Hello Administration Team,',
    introText: 'A new financial payout request has been initiated and requires your review and authorization.',
    boxTitle: 'Payout Request Details',
    boxIcon: '💰',
    badgeText: 'Action Required',
    badgeBg: '#422006', badgeBorder: '#713f12', badgeColor: '#facc15',
    contentHtml: `
      ${buildDataRow('Requesting Partner', partnerName)}
      ${buildDataRow('Requested Amount', `${amount.toFixed(2)} ${currency}`, true)}
      ${buildDataRow('Submission Date', bdTime())}
    `,
    footerNote: 'Please access the Admin Payments dashboard to review and process this transaction.'
  });
  return sendPremiumEmail({ to: adminEmails, subject: `Financial Alert: Payout Request from ${partnerName}`, html });
}

export async function sendPayoutCompletedToUser(userEmail: string, userName: string, amount: number, currency: string = 'BDT', transactionId: string, extra?: any) {
  const amountStr = `${currency} ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dateTimeStr = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
  const methodStr = extra?.paymentMethod || 'Bank / Mobile Banking';
  const trxId = transactionId || extra?.transactionId || `PAY-${Date.now().toString().slice(-8)}`;

  const html = getPremiumReceiptEmailHtml({
    greeting: `Dear ${userName},`,
    amountFormatted: amountStr,
    transactionId: trxId,
    boxTitle: 'Payout Transaction Details',
    statusBadge: '✓ Success',
    fromAccount: 'Anchor Fashion ERP Disbursement Ledger',
    toAccount: `${methodStr}<br/><span style="color:#94a3b8; font-size:13px;">${userName}</span>`,
    amountValue: amountStr,
    transactionType: extra?.invoiceTitle || 'Partner Earnings Payout',
    paymentMethod: methodStr,
    dateTime: dateTimeStr,
  });

  // Generate official PDF attachment
  let attachments = undefined;
  try {
    const { generatePdfBuffer } = await import('./pdf-generator');
    const pdfBuf = await generatePdfBuffer(
      'OFFICIAL PAYOUT RECEIPT',
      ['#', 'Transaction Description', 'Disbursement Method', 'Date & Time', 'Status', 'Amount (BDT)'],
      [
        ['1', extra?.invoiceTitle || 'Partner Earnings Payout', methodStr, new Date().toLocaleDateString('en-GB'), 'SUCCESS', Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })]
      ],
      {
        subtitle: 'PARTNER DISBURSEMENT STATEMENT',
        reportRef: trxId,
        preparedBy: 'Anchor Finance & Accounts',
        branch: 'Main Operations',
        summaryData: [
          { label: 'Gross Approved Payout', value: Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) },
          { label: 'Platform & Processing Fee', value: '0.00' },
          { label: 'Net Disbursed Amount', value: Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) }
        ]
      }
    );
    attachments = [{ filename: `Anchor_Payout_Receipt_${trxId}.pdf`, content: pdfBuf }];
  } catch (pdfErr) {
    console.warn('Fallback to server PDF voucher for payout:', pdfErr);
    try {
      const { generateServerPaymentVoucher } = await import('./server/pdf-voucher');
      const pdfBuf = await generateServerPaymentVoucher({
        voucherNo: trxId,
        date: new Date().toLocaleDateString('en-GB'),
        recipientName: userName,
        recipientEmail: userEmail,
        paymentType: 'Partner Payout',
        title: extra?.invoiceTitle || 'Partner Earnings Payout',
        amount: amount,
        currency: currency,
        paymentMethod: methodStr,
        trxId: trxId
      });
      attachments = [{ filename: `Anchor_Payout_Receipt_${trxId}.pdf`, content: pdfBuf }];
    } catch (fallbackErr) {
      console.error('Error generating payout PDF attachment:', fallbackErr);
    }
  }

  return sendPremiumEmail({ to: userEmail, subject: `Receipt: Your Payout of ${amountStr} has been processed`, html, attachments });
}

export async function sendBranchChangeToUser(userEmail: string, userName: string, newBranch: string) {
  const html = getPremiumNotificationHtml({
    title: 'Branch Allocation Updated',
    greeting: `Dear ${userName},`,
    introText: 'This is an official notification regarding a modification to your branch allocation within our systems.',
    boxTitle: 'Allocation Details',
    boxIcon: '🏢',
    badgeText: 'Updated',
    badgeBg: '#1e3a8a', badgeBorder: '#1d4ed8', badgeColor: '#60a5fa',
    contentHtml: `
      ${buildDataRow('New Branch Allocation', newBranch, true)}
      ${buildDataRow('Effective Date', new Date().toLocaleDateString())}
    `,
    footerNote: 'If you have any inquiries regarding this organizational change, please reach out to the Human Resources department.'
  });
  return sendPremiumEmail({ to: userEmail, subject: 'Official Notice: Branch Allocation Updated', html });
}

export async function sendSalaryPaidToUser(userEmail: string, userName: string, month: string, amount: number, currency: string = 'BDT', extra?: any) {
  const amountStr = `${currency} ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dateTimeStr = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
  const methodStr = extra?.paymentMethod || 'Bank Transfer / Payroll Account';
  const trxId = extra?.transactionId || `SAL-${Date.now().toString().slice(-8)}`;
  const branchStr = extra?.branchName || 'Head Office';

  const html = getPremiumReceiptEmailHtml({
    greeting: `Dear ${userName},`,
    amountFormatted: amountStr,
    transactionId: trxId,
    boxTitle: 'Salary Received Receipt',
    statusBadge: '✓ Salary Received',
    fromAccount: 'Anchor Fashion ERP Payroll Ledger',
    toAccount: `${methodStr}<br/><span style="color:#94a3b8; font-size:13px;">${userName}</span>`,
    amountValue: amountStr,
    transactionType: `Monthly Salary - ${month}`,
    paymentMethod: `${methodStr} (${branchStr})`,
    dateTime: dateTimeStr,
  });

  // Generate official PDF attachment
  let attachments = undefined;
  try {
    const { generatePdfBuffer } = await import('./pdf-generator');
    const pdfRows = [
      ['1', `Basic Salary for ${month}`, month, new Date().toLocaleDateString('en-GB'), 'SUCCESS', Number(extra?.base_salary || amount).toLocaleString('en-US', { minimumFractionDigits: 2 })]
    ];
    let rowCounter = 2;
    if (extra?.overtime > 0) pdfRows.push([(rowCounter++).toString(), 'Overtime Allowance', month, new Date().toLocaleDateString('en-GB'), 'SUCCESS', Number(extra.overtime).toLocaleString('en-US', { minimumFractionDigits: 2 })]);
    if (extra?.bonus > 0) pdfRows.push([(rowCounter++).toString(), 'Bonus', month, new Date().toLocaleDateString('en-GB'), 'SUCCESS', Number(extra.bonus).toLocaleString('en-US', { minimumFractionDigits: 2 })]);
    if (extra?.sales_commission > 0) pdfRows.push([(rowCounter++).toString(), 'Sales Commission', month, new Date().toLocaleDateString('en-GB'), 'SUCCESS', Number(extra.sales_commission).toLocaleString('en-US', { minimumFractionDigits: 2 })]);
    if (extra?.tiffin_bill > 0) pdfRows.push([(rowCounter++).toString(), 'Tiffin Bill', month, new Date().toLocaleDateString('en-GB'), 'SUCCESS', Number(extra.tiffin_bill).toLocaleString('en-US', { minimumFractionDigits: 2 })]);

    const pdfBuf = await generatePdfBuffer(
      'OFFICIAL SALARY STATEMENT',
      ['#', 'Disbursement Item', 'Salary Cycle', 'Payment Date', 'Status', 'Net Amount (BDT)'],
      pdfRows,
      {
        subtitle: 'EMPLOYEE PAYSLIP & DISBURSEMENT RECEIPT',
        reportRef: trxId,
        preparedBy: 'Anchor Human Resources & Payroll',
        branch: branchStr,
        summaryData: [
          { label: 'Basic Salary', value: Number(extra?.base_salary || amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) },
          { label: 'Allowances & Comm', value: Number((extra?.overtime || 0) + (extra?.bonus || 0) + (extra?.sales_commission || 0) + (extra?.tiffin_bill || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 }) },
          { label: 'Net Disbursed Salary', value: Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) }
        ]
      }
    );
    attachments = [{ filename: `Anchor_Salary_Payslip_${month.replace(/\s+/g, '_')}.pdf`, content: pdfBuf }];
  } catch (pdfErr) {
    console.warn('Fallback to server PDF voucher for salary:', pdfErr);
    try {
      const { generateServerPaymentVoucher } = await import('./server/pdf-voucher');
      const pdfBuf = await generateServerPaymentVoucher({
        voucherNo: trxId,
        date: new Date().toLocaleDateString('en-GB'),
        recipientName: userName,
        recipientEmail: userEmail,
        paymentType: 'Salary Payment',
        title: `Monthly Salary - ${month}`,
        amount: amount,
        currency: currency,
        paymentMethod: methodStr,
        trxId: trxId
      });
      attachments = [{ filename: `Anchor_Salary_Payslip_${month.replace(/\s+/g, '_')}.pdf`, content: pdfBuf }];
    } catch (fallbackErr) {
      console.error('Error generating salary PDF attachment:', fallbackErr);
    }
  }

  return sendPremiumEmail({ to: userEmail, subject: `Salary Received: Your salary for ${month} has been disbursed`, html, attachments });
}

export async function sendValueTransferToUser(userEmail: string, userName: string, amount: number, currency: string = 'BDT', extra?: any) {
  const amountStr = `${currency} ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dateTimeStr = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
  const methodStr = extra?.paymentMethod || 'Bank Transfer / Payroll Account';
  const trxId = extra?.transactionId || `TRX-${Date.now().toString().slice(-8)}`;
  const branchStr = extra?.branchName || 'Head Office';

  const html = getPremiumReceiptEmailHtml({
    greeting: `Dear ${userName},`,
    amountFormatted: amountStr,
    transactionId: trxId,
    boxTitle: 'Value Transfer Receipt',
    statusBadge: '✓ Value Transfer',
    fromAccount: 'Anchor Fashion ERP Ledger',
    toAccount: `${methodStr}<br/><span style="color:#94a3b8; font-size:13px;">${userName}</span>`,
    amountValue: amountStr,
    transactionType: `Partner Value Transfer`,
    paymentMethod: `${methodStr} (${branchStr})`,
    dateTime: dateTimeStr,
  });

  // Generate official PDF attachment
  let attachments = undefined;
  try {
    const { generatePdfBuffer } = await import('./pdf-generator');
    const pdfBuf = await generatePdfBuffer(
      'OFFICIAL VALUE TRANSFER STATEMENT',
      ['#', 'Disbursement Item', 'Payment Date', 'Status', 'Net Amount (BDT)'],
      [
        ['1', `Value Transfer`, new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' }), 'SUCCESS', Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })]
      ],
      {
        subtitle: 'PARTNER DISBURSEMENT RECEIPT',
        reportRef: trxId,
        preparedBy: 'Anchor Finance & Accounts',
        branch: branchStr,
        summaryData: [
          { label: 'Net Disbursed Amount', value: Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) }
        ]
      }
    );
    attachments = [{ filename: `Anchor_Value_Transfer_Receipt_${trxId}.pdf`, content: pdfBuf }];
  } catch (pdfErr) {
    console.warn('Fallback to server PDF voucher for value transfer:', pdfErr);
    try {
      const { generateServerPaymentVoucher } = await import('./server/pdf-voucher');
      const pdfBuf = await generateServerPaymentVoucher({
        voucherNo: trxId,
        date: new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' }),
        recipientName: userName,
        recipientEmail: userEmail,
        paymentType: 'Money Transaction',
        title: `Partner Value Transfer`,
        amount: amount,
        currency: currency,
        paymentMethod: methodStr,
        trxId: trxId
      });
      attachments = [{ filename: `Anchor_Value_Transfer_Receipt_${trxId}.pdf`, content: pdfBuf }];
    } catch (fallbackErr) {
      console.error('Error generating value transfer PDF attachment:', fallbackErr);
    }
  }

  return sendPremiumEmail({ to: userEmail, subject: `Value Transfer: An amount of ${amountStr} has been transferred`, html, attachments });
}

export async function sendSalaryUpdatedToUser(userEmail: string, userName: string, newSalary: number, currency: string) {
  const html = getPremiumNotificationHtml({
    title: 'Salary Structure Updated',
    greeting: `Dear ${userName},`,
    introText: 'We are writing to officially inform you that your compensation structure has been reviewed and updated by the administration.',
    boxTitle: 'Compensation Details',
    boxIcon: '📈',
    badgeText: 'Revised',
    badgeBg: '#064e3b', badgeBorder: '#059669', badgeColor: '#34d399',
    contentHtml: `
      ${buildDataRow('Revised Basic Salary', `${newSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${currency}`, true)}
      ${buildDataRow('Effective Date', new Date().toLocaleDateString())}
    `,
    footerNote: 'This is a confidential communication. Should you have any questions regarding these changes, please contact the HR or Finance administration.'
  });
  return sendPremiumEmail({ to: userEmail, subject: 'Confidential Notice: Salary Structure Updated', html });
}

export async function sendPasswordResetOTP(userEmail: string, userName: string, otpCode: string) {
  const html = getPremiumNotificationHtml({
    title: 'Password Reset Authorization',
    greeting: `Dear ${userName},`,
    introText: 'We received a request to securely reset the password associated with your account. To proceed, please utilize the authorization code below.',
    boxTitle: 'One-Time Password (OTP)',
    boxIcon: '🔑',
    badgeText: 'Secure',
    badgeBg: '#1e3a8a', badgeBorder: '#1d4ed8', badgeColor: '#60a5fa',
    contentHtml: `
      <div style="text-align: center; margin: 32px 0;">
        <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px;">AUTHORIZATION CODE</div>
        <div style="font-size: 38px; font-weight: 800; letter-spacing: 12px; color: #38bdf8; font-family: monospace;">${otpCode}</div>
      </div>
      <div style="margin-bottom: 10px; font-size: 14px; color: #94a3b8; text-align: center;">
        This secure code is valid for exactly <strong>10 minutes</strong>.
      </div>
    `,
    footerNote: 'For your security, never share this code with anyone, including Anchor ERP staff. If you did not initiate this request, please safely ignore this email.'
  });
  return sendPremiumEmail({ to: userEmail, subject: 'Secure Authorization: Password Reset Code', html });
}

export async function sendRegistrationOTP(userEmail: string, userName: string, otpCode: string) {
  const html = getPremiumNotificationHtml({
    title: 'Registration Verification',
    greeting: `Dear ${userName},`,
    introText: 'Welcome to Anchor ERP. To complete your registration and verify your email address, please use the authorization code provided below.',
    boxTitle: 'Verification Code',
    boxIcon: '🛡️',
    badgeText: 'Action Required',
    badgeBg: '#422006', badgeBorder: '#713f12', badgeColor: '#facc15',
    contentHtml: `
      <div style="text-align: center; margin: 32px 0;">
        <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px;">AUTHORIZATION CODE</div>
        <div style="font-size: 38px; font-weight: 800; letter-spacing: 12px; color: #38bdf8; font-family: monospace;">${otpCode}</div>
      </div>
      <div style="margin-bottom: 10px; font-size: 14px; color: #94a3b8; text-align: center;">
        This secure code is valid for exactly <strong>10 minutes</strong>.
      </div>
    `,
    footerNote: 'Please enter this code on the registration screen to finalize your account setup. If you did not request this, please disregard this email.'
  });
  return sendPremiumEmail({ to: userEmail, subject: 'Action Required: Verify Your Registration', html });
}

export async function send2FAOTP(userEmail: string, userName: string, otpCode: string) {
  const html = getPremiumNotificationHtml({
    title: 'Two-Factor Authentication (2FA)',
    greeting: `Dear ${userName},`,
    introText: 'An attempt to log into your account requires secondary verification. Please use the highly secure, time-sensitive code below to authenticate your session.',
    boxTitle: 'Authentication Code',
    boxIcon: '🛡️',
    badgeText: 'High Security',
    badgeBg: '#450a0a', badgeBorder: '#7f1d1d', badgeColor: '#f87171',
    contentHtml: `
      <div style="text-align: center; margin: 32px 0;">
        <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px;">AUTHORIZATION CODE</div>
        <div style="font-size: 38px; font-weight: 800; letter-spacing: 12px; color: #38bdf8; font-family: monospace;">${otpCode}</div>
      </div>
      <div style="margin-bottom: 10px; font-size: 14px; color: #94a3b8; text-align: center;">
        This secure code expires in <strong>2 minutes</strong>.
      </div>
    `,
    footerNote: 'If you are not currently attempting to log in, please secure your account and contact administration immediately.'
  });
  return sendPremiumEmail({ to: userEmail, subject: 'Security Notice: Login Authentication Code (2FA)', html });
}

export async function sendExpenseSubmissionToAdmins(adminEmails: string[], userName: string, branchName: string, title: string, amount: number) {
  const html = getPremiumNotificationHtml({
    title: 'Expense Request Submitted',
    greeting: 'Hello Administration Team,',
    introText: 'A formal employee expense reimbursement request has been submitted and is currently awaiting administrative evaluation.',
    boxTitle: 'Expense Summary',
    boxIcon: '🧾',
    badgeText: 'Review Pending',
    badgeBg: '#422006', badgeBorder: '#713f12', badgeColor: '#facc15',
    contentHtml: `
      ${buildDataRow('Employee Name', userName)}
      ${buildDataRow('Branch / Department', branchName)}
      ${buildDataRow('Expense Title', title)}
      ${buildDataRow('Claimed Amount', `${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} BDT`, true)}
    `,
    footerNote: 'Please utilize the Anchor ERP Admin Panel to systematically review, approve, or reject this reimbursement request.'
  });
  return sendPremiumEmail({ to: adminEmails, subject: `Administrative Alert: New Expense Claim from ${userName}`, html });
}

export async function sendExpenseStatusUpdateToUser(userEmail: string, userName: string, title: string, status: string, amount: number, adminNotes?: string | null, trxId?: string | null) {
  let badgeBg = '#1e3a8a';
  let badgeBorder = '#1d4ed8';
  let badgeColor = '#60a5fa'; // Blue (Approved)
  
  if (status === 'paid') {
    badgeBg = '#064e3b'; badgeBorder = '#059669'; badgeColor = '#34d399'; // Green (Paid)
  } else if (status === 'rejected') {
    badgeBg = '#450a0a'; badgeBorder = '#7f1d1d'; badgeColor = '#f87171'; // Red (Rejected)
  }

  const html = getPremiumNotificationHtml({
    title: `Expense Claim ${status.charAt(0).toUpperCase() + status.slice(1)}`,
    greeting: `Dear ${userName},`,
    introText: 'This is an official update regarding the status of your recent expense reimbursement claim.',
    boxTitle: 'Claim Status Update',
    boxIcon: status === 'paid' ? '💸' : (status === 'rejected' ? '❌' : '✅'),
    badgeText: status.toUpperCase(),
    badgeBg, badgeBorder, badgeColor,
    contentHtml: `
      ${buildDataRow('Expense Title', title)}
      ${buildDataRow('Claimed Amount', `${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} BDT`)}
      ${trxId ? buildDataRow('Transaction ID', `<span style="font-family: monospace;">${trxId}</span>`) : ''}
      ${adminNotes ? buildDataRow('Administrative Note', adminNotes) : ''}
    `,
    footerNote: 'Thank you for your cooperation and for using Anchor ERP.'
  });

  let attachments = undefined;
  if (status === 'paid') {
    try {
      const { generateServerPaymentVoucher } = await import('./server/pdf-voucher');
      const pdfBuf = await generateServerPaymentVoucher({
        voucherNo: trxId || `EXP-${Date.now().toString().slice(-8)}`,
        date: new Date().toLocaleDateString('en-GB'),
        recipientName: userName,
        recipientEmail: userEmail,
        paymentType: 'Expense Reimbursement',
        title: title,
        amount: amount,
        currency: 'BDT',
        trxId: trxId || undefined,
        notes: adminNotes
      });
      attachments = [{ filename: `Anchor_Expense_Voucher_${title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)}.pdf`, content: pdfBuf }];
    } catch (err) {
      console.error('Failed to attach expense voucher PDF:', err);
    }
  }

  return sendPremiumEmail({ to: userEmail, subject: `Expense Claim ${status.toUpperCase()}: ${title}`, html, attachments });
}

export async function sendPositionChangeToUser(
  userEmail: string,
  userName: string,
  oldPosition: string,
  newPosition: string,
  effectiveDate: string,
  note?: string
) {
  const html = getPremiumNotificationHtml({
    title: 'Position Change Notification',
    greeting: `Dear ${userName},`,
    introText: 'This is a formal notification from Human Resources regarding an update to your role and organizational position within Anchor ERP.',
    boxTitle: 'Role Designation Update',
    boxIcon: '👔',
    badgeText: 'Official Notice',
    badgeBg: '#1e3a8a', badgeBorder: '#1d4ed8', badgeColor: '#60a5fa',
    contentHtml: `
      ${buildDataRow('Previous Designation', oldPosition)}
      ${buildDataRow('New Designation', newPosition, true)}
      ${buildDataRow('Effective Date', effectiveDate)}
      ${note ? buildDataRow('Administrative Note', note) : ''}
    `,
    footerNote: 'We appreciate your continued contributions. For any inquiries regarding this modification, please contact HR Administration.'
  });
  return sendPremiumEmail({
    to: userEmail,
    subject: 'Official Notice: Position Change Notification - Anchor ERP',
    html
  });
}

export async function getAdminEmails(): Promise<string[]> {
  // Admin emails from profiles; the fallback reads
  // auth_users (was auth.admin.listUsers).
  // FR-1.1: partner accounts are NOT admin recipients — the filter
  // below applies the resolver's shared predicate (isPartnerAccount
  // in lib/server/auth.ts): profile_type 'partner' with no
  // admin_users row is excluded even when its role column is
  // 'admin'/'super_admin'.
  let adminUserIds = new Set<string>();
  try {
    const rows = await prisma.adminUser.findMany({ select: { id: true } });
    adminUserIds = new Set(rows.map((r: any) => r.id));
  } catch {
    adminUserIds = new Set<string>();
  }
  let data: { id: string; email: string | null; profile_type: string | null }[] = [];
  try {
    data = await prisma.profile.findMany({
      where: { role: { in: ['admin', 'super_admin'] }, email: { not: null } },
      select: { id: true, email: true, profile_type: true },
    });
  } catch (error) {
    console.error('Error fetching admin emails from profiles:', error);
    return [];
  }

  const emails = (data || [])
    .filter((p: any) => !isPartnerAccount(p.profile_type, adminUserIds.has(p.id)))
    .map((p: any) => p.email)
    .filter(Boolean) as string[];

  if (emails.length === 0) {
    const authUsers = await prisma.authUser.findMany({
      select: { id: true, email: true },
      take: 50,
    });
    const adminProfiles = await prisma.profile.findMany({
      where: { role: { in: ['admin', 'super_admin'] } },
      select: { id: true, profile_type: true },
    });
    const adminIds = new Set(
      (adminProfiles || [])
        .filter((p: any) => !isPartnerAccount(p.profile_type, adminUserIds.has(p.id)))
        .map((p: any) => p.id)
    );
    return (authUsers || [])
      .filter((u: any) => adminIds.has(u.id) && u.email)
      .map((u: any) => u.email as string);
  }

  return emails;
}

/**
 * Sends a rich executive dark-mode notification email to all admins
 * when a Branch Manager submits a bank deposit, complete with deposit slip image.
 */
export async function sendDepositSubmissionEmailToAdmins({
  depositId,
  branchName,
  managerName,
  managerEmail,
  depositDate,
  salesFromDate,
  salesToDate,
  amount,
  bankAccountName,
  bankAccountNumber,
  depositSlipNumber,
  bankTransactionId,
  depositedByName,
  slipAttachmentUrl,
  bankStatementUrl,
  notes,
  dailyBreakdown,
  baseUrl,
}: {
  depositId: string;
  branchName: string;
  managerName: string;
  managerEmail?: string | null;
  depositDate: string;
  salesFromDate?: string | null;
  salesToDate?: string | null;
  amount: number;
  bankAccountName: string;
  bankAccountNumber?: string | null;
  depositSlipNumber?: string | null;
  bankTransactionId?: string | null;
  depositedByName?: string | null;
  slipAttachmentUrl?: string | null;
  bankStatementUrl?: string | null;
  notes?: string | null;
  dailyBreakdown?: Record<string, number> | null;
  baseUrl?: string;
}) {
  const adminEmails = await getAdminEmails();
  if (!adminEmails || adminEmails.length === 0) {
    console.warn('No admin emails found to receive deposit submission notification.');
    return { success: false, error: 'No admin emails found' };
  }

  const appUrl = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://www.anchorfashion.shop';
  const approvalUrl = `${appUrl.replace(/\/$/, '')}/admin/branch-accounts/deposit-approvals`;
  const formattedAmount = `৳${Number(amount).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const salesPeriod = (salesFromDate && salesToDate)
    ? (salesFromDate === salesToDate ? salesFromDate : `${salesFromDate} → ${salesToDate}`)
    : depositDate;

  const slipImageSection = slipAttachmentUrl ? `
    <div style="margin-top: 24px; padding: 18px; background-color: #0b0d13; border: 1px solid #282d3c; border-radius: 10px;">
      <div style="font-size: 11px; font-weight: 700; color: #d4af37; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 12px;">
        📸 BANK DEPOSIT SLIP / BOOK PHOTO
      </div>
      <div style="text-align: center; background-color: #000000; border-radius: 8px; overflow: hidden; padding: 8px; border: 1px solid #1e222d;">
        <a href="${slipAttachmentUrl}" target="_blank" style="text-decoration: none;">
          <img src="${slipAttachmentUrl}" alt="Bank Deposit Slip" style="max-width: 100%; max-height: 380px; object-fit: contain; border-radius: 6px; display: block; margin: 0 auto;" />
        </a>
      </div>
      <div style="text-align: center; margin-top: 12px;">
        <a href="${slipAttachmentUrl}" target="_blank" style="display: inline-block; background-color: #1e222d; color: #38bdf8; font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px; border: 1px solid #334155; text-decoration: none;">
          🔍 Open Full Resolution Slip Photo
        </a>
      </div>
    </div>
  ` : '';

  const statementSection = bankStatementUrl ? `
    <div style="margin-top: 12px; padding: 12px 16px; background-color: #0b0d13; border: 1px solid #282d3c; border-radius: 8px;">
      <span style="font-size: 13px; color: #cbd5e1;">📄 Supporting Statement: </span>
      <a href="${bankStatementUrl}" target="_blank" style="color: #38bdf8; font-size: 13px; font-weight: 600; text-decoration: underline;">View Bank Statement</a>
    </div>
  ` : '';

  const breakdownEntries = (dailyBreakdown && typeof dailyBreakdown === 'object')
    ? Object.entries(dailyBreakdown).sort(([a], [b]) => a.localeCompare(b))
    : [];

  const dailyBreakdownSection = breakdownEntries.length > 0 ? `
    <div style="margin-top: 18px; padding: 14px; background-color: #0b0d13; border: 1px solid #282d3c; border-radius: 8px;">
      <div style="font-size: 11px; font-weight: 700; color: #d4af37; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px;">
        📅 DAILY SALES BREAKDOWN (${breakdownEntries.length} DAYS)
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 13px;">
        ${breakdownEntries.map(([dt, amt]) => `
          <tr style="border-bottom: 1px solid #1e222d;">
            <td style="padding: 6px 8px; font-family: monospace; color: #cbd5e1;">${dt}</td>
            <td align="right" style="padding: 6px 8px; font-weight: 700; color: #d4af37; font-family: monospace;">৳${Number(amt).toLocaleString('en-BD')}</td>
          </tr>
        `).join('')}
        <tr style="border-top: 2px solid #334155;">
          <td style="padding: 8px 8px 4px 8px; font-weight: 700; color: #ffffff;">Total Aggregated</td>
          <td align="right" style="padding: 8px 8px 4px 8px; font-weight: 800; color: #d4af37; font-size: 14px;">${formattedAmount}</td>
        </tr>
      </table>
    </div>
  ` : '';

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New Bank Deposit Submission</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #08090c; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #08090c; min-height: 100vh; padding: 35px 15px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" style="max-width: 580px; text-align: left;" cellspacing="0" cellpadding="0" border="0">
              
              <!-- Brand Header -->
              <tr>
                <td style="padding-bottom: 20px; text-align: center;">
                  <div style="font-size: 11px; font-weight: 800; letter-spacing: 2px; color: #d4af37; text-transform: uppercase;">
                    ANCHOR FASHION ERP
                  </div>
                  <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
                    Branch Cash &amp; Bank Accounts Management
                  </div>
                </td>
              </tr>

              <!-- Greeting & Main Banner -->
              <tr>
                <td style="padding-bottom: 20px;">
                  <h1 style="margin: 0 0 10px 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">
                    🏦 New Bank Deposit Submitted
                  </h1>
                  <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #cbd5e1;">
                    Manager <strong style="color: #f8fafc;">${managerName}</strong> (<span style="color: #d4af37; font-weight: 600;">${branchName}</span>) has submitted physical cash sales to the company bank account. Awaiting admin review and approval.
                  </p>
                </td>
              </tr>

              <!-- Deposit Box Card -->
              <tr>
                <td>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #12151d; border: 1px solid #232836; border-radius: 14px; overflow: hidden; box-shadow: 0 15px 35px rgba(0,0,0,0.6);">
                    
                    <!-- Box Header Bar -->
                    <tr>
                      <td style="padding: 18px 24px; background: linear-gradient(90deg, #181c27 0%, #12151d 100%); border-bottom: 1px solid #232836;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td width="36" valign="middle">
                              <div style="width: 34px; height: 34px; background: linear-gradient(135deg, #d4af37 0%, #aa7c11 100%); border-radius: 8px; text-align: center; line-height: 34px; color: #000000; font-weight: bold; font-size: 17px;">
                                ৳
                              </div>
                            </td>
                            <td valign="middle" style="padding-left: 12px;">
                              <span style="font-size: 16px; font-weight: 700; color: #ffffff;">Bank Deposit Submission</span>
                            </td>
                            <td align="right" valign="middle">
                              <span style="display: inline-block; background-color: #3b2505; border: 1px solid #ca8a04; color: #fde047; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px;">
                                ⏳ PENDING APPROVAL
                              </span>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <!-- Amount Highlight Box -->
                    <tr>
                      <td style="padding: 24px 24px 16px 24px; background-color: #151923; border-bottom: 1px solid #1e222d; text-align: center;">
                        <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 6px;">
                          TOTAL DEPOSIT AMOUNT
                        </div>
                        <div style="font-size: 32px; font-weight: 800; color: #d4af37; letter-spacing: -0.5px;">
                          ${formattedAmount}
                        </div>
                        <div style="font-size: 13px; color: #94a3b8; margin-top: 6px;">
                          Deposit Date: <strong style="color: #f1f5f9;">${depositDate}</strong> &bull; Sales Period: <strong style="color: #f1f5f9;">${salesPeriod}</strong>
                        </div>
                      </td>
                    </tr>

                    <!-- Box Body Content -->
                    <tr>
                      <td style="padding: 24px;">
                        
                        <!-- 2-Column Grid Details -->
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td width="50%" valign="top" style="padding-right: 12px; padding-bottom: 18px;">
                              <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px;">BRANCH</div>
                              <div style="font-size: 14px; font-weight: 600; color: #ffffff;">🏬 ${branchName}</div>
                            </td>
                            <td width="50%" valign="top" style="padding-left: 12px; padding-bottom: 18px;">
                              <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px;">SUBMITTED BY</div>
                              <div style="font-size: 14px; font-weight: 600; color: #ffffff;">👤 ${managerName}</div>
                              ${managerEmail ? `<div style="font-size: 12px; color: #64748b;">${managerEmail}</div>` : ''}
                            </td>
                          </tr>

                          <tr>
                            <td colspan="2" valign="top" style="padding-bottom: 18px;">
                              <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px;">DEPOSIT TARGET BANK &amp; ACCOUNT</div>
                              <div style="font-size: 14px; font-weight: 600; color: #f8fafc;">${bankAccountName}</div>
                              ${bankAccountNumber ? `<div style="font-size: 13px; color: #38bdf8; font-family: monospace; margin-top: 2px;">A/C: ${bankAccountNumber}</div>` : ''}
                            </td>
                          </tr>

                          <tr>
                            <td width="50%" valign="top" style="padding-right: 12px; padding-bottom: 18px;">
                              <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px;">DEPOSIT SLIP / BOOK NO</div>
                              <div style="font-size: 14px; font-weight: 600; color: #f8fafc; font-family: monospace;">${depositSlipNumber || '—'}</div>
                            </td>
                            <td width="50%" valign="top" style="padding-left: 12px; padding-bottom: 18px;">
                              <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px;">BANK TRANSACTION / REF ID</div>
                              <div style="font-size: 14px; font-weight: 600; color: #f8fafc; font-family: monospace;">${bankTransactionId || '—'}</div>
                            </td>
                          </tr>

                          <tr>
                            <td colspan="2" valign="top" style="padding-bottom: 18px;">
                              <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px;">PHYSICALLY DEPOSITED BY</div>
                              <div style="font-size: 14px; font-weight: 600; color: #f8fafc;">${depositedByName || managerName}</div>
                            </td>
                          </tr>

                          ${notes ? `
                          <tr>
                            <td colspan="2" valign="top" style="padding-bottom: 18px;">
                              <div style="font-size: 11px; font-weight: 700; color: #8492a6; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px;">MANAGER REMARKS / NOTES</div>
                              <div style="font-size: 13px; color: #cbd5e1; background-color: #0b0d13; border: 1px solid #1e222d; padding: 10px 14px; border-radius: 6px; line-height: 1.5;">${notes}</div>
                            </td>
                          </tr>
                          ` : ''}
                        </table>

                        <!-- Daily Breakdown Section -->
                        ${dailyBreakdownSection}

                        <!-- Deposit Slip Photo -->
                        ${slipImageSection}

                        <!-- Statement Link -->
                        ${statementSection}

                        <!-- Action Button (CTA) -->
                        <div style="margin-top: 28px; text-align: center;">
                          <a href="${approvalUrl}" style="display: block; background: linear-gradient(135deg, #d4af37 0%, #aa7c11 100%); color: #000000; text-align: center; padding: 15px 28px; border-radius: 8px; font-size: 15px; font-weight: 800; text-decoration: none; letter-spacing: 0.5px; box-shadow: 0 4px 18px rgba(212, 175, 55, 0.35);">
                            👉 Review &amp; Approve Deposit in Admin Panel
                          </a>
                        </div>

                      </td>
                    </tr>

                  </table>
                </td>
              </tr>

              <!-- Footer Warning & Note -->
              <tr>
                <td style="padding-top: 24px; text-align: center;">
                  <p style="margin: 0 0 10px 0; font-size: 13px; color: #64748b; line-height: 1.6;">
                    You are receiving this high-priority administrative alert because an employee submitted branch funds for executive approval.
                  </p>
                  <p style="margin: 0; font-size: 12px; color: #475569;">
                    &copy; ${new Date().getFullYear()} Anchor Fashion ERP &bull; Financial Operations System
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return sendPremiumEmail({
    to: adminEmails,
    subject: `🏦 Bank Deposit Submitted: ${formattedAmount} — ${branchName} (${depositDate})`,
    html,
  });
}

/**
 * Sends official notification email to manager when deposit is approved or rejected by admin.
 */
export async function sendDepositDecisionEmailToManager({
  managerEmail,
  managerName,
  branchName,
  depositDate,
  amount,
  status,
  rejectionReason,
  reviewedByName,
  baseUrl,
}: {
  managerEmail: string;
  managerName: string;
  branchName: string;
  depositDate: string;
  amount: number;
  status: 'approved' | 'rejected';
  rejectionReason?: string | null;
  reviewedByName?: string;
  baseUrl?: string;
}) {
  const isApproved = status === 'approved';
  const formattedAmount = `৳${Number(amount).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const appUrl = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://www.anchorfashion.shop';
  const historyUrl = `${appUrl.replace(/\/$/, '')}/dashboard/branch-accounts/deposit-history`;

  const badgeBg = isApproved ? '#064e3b' : '#450a0a';
  const badgeBorder = isApproved ? '#059669' : '#7f1d1d';
  const badgeColor = isApproved ? '#34d399' : '#f87171';

  const html = getPremiumNotificationHtml({
    title: isApproved ? 'Bank Deposit Approved' : 'Bank Deposit Rejected',
    greeting: `Dear ${managerName},`,
    introText: isApproved
      ? `Your submitted bank deposit of <strong style="color: #ffffff;">${formattedAmount}</strong> for <strong style="color: #d4af37;">${branchName}</strong> has been officially approved and verified by administration.`
      : `Your submitted bank deposit of <strong style="color: #ffffff;">${formattedAmount}</strong> for <strong style="color: #d4af37;">${branchName}</strong> was rejected by administration. Please review the reason below and resubmit if appropriate.`,
    boxTitle: isApproved ? 'Deposit Approved' : 'Deposit Rejected',
    boxIcon: isApproved ? '✅' : '❌',
    badgeText: isApproved ? 'APPROVED' : 'REJECTED',
    badgeBg,
    badgeBorder,
    badgeColor,
    contentHtml: `
      ${buildDataRow('Branch', branchName)}
      ${buildDataRow('Deposit Date', depositDate)}
      ${buildDataRow('Deposit Amount', formattedAmount, true)}
      ${buildDataRow('Reviewed By', reviewedByName || 'System Administrator')}
      ${!isApproved && rejectionReason ? buildDataRow('Rejection Reason', rejectionReason) : ''}
      <div style="margin-top: 24px; text-align: center;">
        <a href="${historyUrl}" style="display: inline-block; background-color: #1e293b; color: #f8fafc; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 6px; border: 1px solid #334155; text-decoration: none;">
          View in Deposit History &rarr;
        </a>
      </div>
    `,
    footerNote: isApproved
      ? 'This deposit has been credited and recorded into the official branch financial ledger.'
      : 'If you have questions regarding this rejection, please contact Head Office Accounts.',
  });

  return sendPremiumEmail({
    to: managerEmail,
    subject: isApproved
      ? `✅ Bank Deposit Approved: ${formattedAmount} (${depositDate})`
      : `❌ Bank Deposit Rejected: ${formattedAmount} (${depositDate})`,
    html,
  });
}

/**
 * Sends official notification email to admins when branch manager completes daily closing
 */
export async function sendDailyClosingEmailToAdmins({
  branchName,
  managerName,
  ledgerDate,
  openingCash,
  cashSales,
  digitalSales = 0,
  totalSales,
  bkashSales = 0,
  nagadSales = 0,
  rocketSales = 0,
  cardSales = 0,
  bankTransferSales = 0,
  otherCashIn = 0,
  actualCash,
  cashExpenses = 0,
  bankDepositsOut = 0,
  expectedClosingCash,
  difference,
  differenceNotes,
}: {
  branchName: string;
  managerName: string;
  ledgerDate: string;
  openingCash: number;
  cashSales: number;
  digitalSales?: number;
  totalSales?: number;
  bkashSales?: number;
  nagadSales?: number;
  rocketSales?: number;
  cardSales?: number;
  bankTransferSales?: number;
  otherCashIn?: number;
  actualCash: number;
  cashExpenses?: number;
  bankDepositsOut?: number;
  expectedClosingCash?: number;
  difference: number;
  differenceNotes?: string | null;
}) {
  const adminEmails = await getAdminEmails();
  if (!adminEmails || adminEmails.length === 0) return { success: false };

  const formattedAmount = (n: number) => `৳${Number(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  
  const computedDigital = digitalSales > 0 ? digitalSales : (Number(bkashSales) + Number(nagadSales) + Number(rocketSales) + Number(cardSales) + Number(bankTransferSales));
  const computedTotalSales = totalSales !== undefined && totalSales !== null ? totalSales : (Number(cashSales) + computedDigital);

  const expectedCash = expectedClosingCash !== undefined && expectedClosingCash !== null && !isNaN(expectedClosingCash)
    ? expectedClosingCash
    : (Number(openingCash) + Number(cashSales) + Number(otherCashIn) - Number(cashExpenses || 0) - Number(bankDepositsOut || 0));

  const isShortage = difference < 0;
  const isExcess = difference > 0;
  const diffStatusText = isShortage ? 'SHORTAGE' : isExcess ? 'EXCESS' : 'BALANCED';
  const diffColor = isShortage ? '#f87171' : isExcess ? '#34d399' : '#10b981';

  const html = getPremiumNotificationHtml({
    title: 'Daily Cash Closing Report',
    greeting: `Hello Administration Team,`,
    introText: `Branch <strong style="color: #d4af37;">${branchName}</strong> has completed the Daily Cash Closing for <strong style="color: #ffffff;">${ledgerDate}</strong>.`,
    boxTitle: 'Daily Financial & Drawer Closing Summary',
    boxIcon: isShortage ? '⚠️' : isExcess ? '💰' : '📊',
    badgeText: diffStatusText,
    badgeBg: isShortage ? '#450a0a' : isExcess ? '#064e3b' : '#064e3b',
    badgeBorder: isShortage ? '#7f1d1d' : isExcess ? '#059669' : '#059669',
    badgeColor: isShortage ? '#f87171' : isExcess ? '#34d399' : '#34d399',
    contentHtml: `
      ${buildDataRow('Branch & Manager', `${branchName} &bull; ${managerName}`)}
      ${buildDataRow('Closing Date', ledgerDate)}

      <!-- 1. Total Daily Sales Section -->
      <div style="margin-top: 16px; padding: 14px; background-color: #0b0d13; border: 1px solid #282d3c; border-radius: 8px;">
        <div style="font-size: 11px; font-weight: 700; color: #d4af37; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px;">
          🛍️ GROSS SALES REVENUE (মোট বিক্রয়)
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 13px;">
          <tr style="border-bottom: 1px solid #1e222d;">
            <td style="padding: 5px 0; color: #cbd5e1;">💵 Pure Cash Sales</td>
            <td align="right" style="padding: 5px 0; font-weight: 600; color: #ffffff; font-family: monospace;">${formattedAmount(cashSales)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #1e222d;">
            <td style="padding: 5px 0; color: #cbd5e1;">📱 Digital / MFS (bKash/Nagad/Card)</td>
            <td align="right" style="padding: 5px 0; font-weight: 600; color: #38bdf8; font-family: monospace;">${formattedAmount(computedDigital)}</td>
          </tr>
          <tr style="border-top: 2px solid #334155;">
            <td style="padding: 8px 0 4px 0; font-weight: 700; color: #ffffff;">Total Daily Sales</td>
            <td align="right" style="padding: 8px 0 4px 0; font-weight: 800; color: #d4af37; font-size: 15px; font-family: monospace;">${formattedAmount(computedTotalSales)}</td>
          </tr>
        </table>
      </div>

      <!-- 2. Physical Drawer Cash Reconciliation -->
      <div style="margin-top: 14px; padding: 14px; background-color: #0b0d13; border: 1px solid #282d3c; border-radius: 8px;">
        <div style="font-size: 11px; font-weight: 700; color: #94a3b8; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px;">
          💼 PHYSICAL DRAWER CASH RECONCILIATION
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 13px;">
          <tr>
            <td style="padding: 4px 0; color: #cbd5e1;">Opening Drawer Float (সকালের ক্যাশ)</td>
            <td align="right" style="padding: 4px 0; font-weight: 600; color: #cbd5e1; font-family: monospace;">${formattedAmount(openingCash)}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #cbd5e1;">(+) Pure Cash Sales (নগদ বিক্রি)</td>
            <td align="right" style="padding: 4px 0; font-weight: 600; color: #34d399; font-family: monospace;">+${formattedAmount(cashSales)}</td>
          </tr>
          ${otherCashIn > 0 ? `
          <tr>
            <td style="padding: 4px 0; color: #cbd5e1;">(+) Other Cash In</td>
            <td align="right" style="padding: 4px 0; font-weight: 600; color: #34d399; font-family: monospace;">+${formattedAmount(otherCashIn)}</td>
          </tr>
          ` : ''}
          ${cashExpenses > 0 ? `
          <tr>
            <td style="padding: 4px 0; color: #cbd5e1;">(-) Drawer Cash Expenses (খরচ)</td>
            <td align="right" style="padding: 4px 0; font-weight: 600; color: #f87171; font-family: monospace;">-${formattedAmount(cashExpenses)}</td>
          </tr>
          ` : ''}
          ${bankDepositsOut > 0 ? `
          <tr>
            <td style="padding: 4px 0; color: #cbd5e1;">(-) Bank Deposits Remitted (ব্যাংক জমা)</td>
            <td align="right" style="padding: 4px 0; font-weight: 600; color: #38bdf8; font-family: monospace;">-${formattedAmount(bankDepositsOut)}</td>
          </tr>
          ` : ''}
          <tr style="border-top: 1px dashed #334155;">
            <td style="padding: 6px 0; font-weight: 600; color: #94a3b8;">= Expected Drawer Cash</td>
            <td align="right" style="padding: 6px 0; font-weight: 700; color: #f8fafc; font-family: monospace;">${formattedAmount(expectedCash)}</td>
          </tr>
          <tr style="border-top: 2px solid #334155;">
            <td style="padding: 8px 0 4px 0; font-weight: 700; color: #ffffff;">Actual Counted Cash (ড্রয়ার ক্যাশ)</td>
            <td align="right" style="padding: 8px 0 4px 0; font-weight: 800; color: #d4af37; font-size: 15px; font-family: monospace;">${formattedAmount(actualCash)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: 700; color: ${diffColor};">Discrepancy / Variance</td>
            <td align="right" style="padding: 6px 0; font-weight: 800; color: ${diffColor}; font-family: monospace;">${difference > 0 ? '+' : ''}${formattedAmount(difference)} (${diffStatusText})</td>
          </tr>
        </table>
      </div>

      ${differenceNotes ? `
      <div style="margin-top: 12px; padding: 10px 14px; background-color: #0b0d13; border: 1px solid #1e222d; border-radius: 6px;">
        <div style="font-size: 11px; font-weight: 700; color: #8492a6; text-transform: uppercase; margin-bottom: 2px;">Manager Notes:</div>
        <div style="font-size: 13px; color: #cbd5e1;">${differenceNotes}</div>
      </div>
      ` : ''}
    `,
    footerNote: 'Daily closing records have been locked into the Anchor ERP branch financial ledger.',
  });

  return sendPremiumEmail({
    to: adminEmails,
    subject: `📊 Daily Closing: ${branchName} (${ledgerDate}) — Sales: ${formattedAmount(computedTotalSales)} | Retained: ${formattedAmount(actualCash)} [${diffStatusText}]`,
    html,
  });
}

/**
 * Sends email to all admins when a branch manager submits a cash bundle requisition.
 */
export async function sendBundleRequestEmailToAdmins({
  branchName,
  managerName,
  managerEmail,
  totalAmount,
  urgency,
  reason,
  bundle10, bundle20, bundle50, bundle100,
  baseUrl,
}: {
  branchName: string;
  managerName: string;
  managerEmail?: string | null;
  totalAmount: number;
  urgency: 'normal' | 'urgent';
  reason?: string | null;
  bundle10: number; bundle20: number; bundle50: number; bundle100: number;
  baseUrl?: string;
}) {
  const adminEmails = await getAdminEmails();
  if (!adminEmails || adminEmails.length === 0) return { success: false };

  const appUrl = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://www.anchorfashion.shop';
  const reviewUrl = `${appUrl.replace(/\/$/, '')}/admin/bundle-requests`;
  const fmtAmt = (n: number) => `৳${Number(n).toLocaleString('en-BD', { minimumFractionDigits: 0 })}`;

  const breakdownRows = [
    bundle10  > 0 ? `<tr style="border-bottom:1px solid #1e222d;"><td style="padding:6px 8px;color:#cbd5e1;">৳10 Notes</td><td style="padding:6px 8px;color:#cbd5e1;">${bundle10} bundle(s) × 100 pcs</td><td align="right" style="padding:6px 8px;font-weight:700;color:#d4af37;font-family:monospace;">${fmtAmt(bundleValueFor(10, bundle10))}</td></tr>` : '',
    bundle20  > 0 ? `<tr style="border-bottom:1px solid #1e222d;"><td style="padding:6px 8px;color:#cbd5e1;">৳20 Notes</td><td style="padding:6px 8px;color:#cbd5e1;">${bundle20} bundle(s) × 100 pcs</td><td align="right" style="padding:6px 8px;font-weight:700;color:#d4af37;font-family:monospace;">${fmtAmt(bundleValueFor(20, bundle20))}</td></tr>` : '',
    bundle50  > 0 ? `<tr style="border-bottom:1px solid #1e222d;"><td style="padding:6px 8px;color:#cbd5e1;">৳50 Notes</td><td style="padding:6px 8px;color:#cbd5e1;">${bundle50} bundle(s) × 100 pcs</td><td align="right" style="padding:6px 8px;font-weight:700;color:#d4af37;font-family:monospace;">${fmtAmt(bundleValueFor(50, bundle50))}</td></tr>` : '',
    bundle100 > 0 ? `<tr style="border-bottom:1px solid #1e222d;"><td style="padding:6px 8px;color:#cbd5e1;">৳100 Notes</td><td style="padding:6px 8px;color:#cbd5e1;">${bundle100} bundle(s) × 100 pcs</td><td align="right" style="padding:6px 8px;font-weight:700;color:#d4af37;font-family:monospace;">${fmtAmt(bundleValueFor(100, bundle100))}</td></tr>` : '',
  ].filter(Boolean).join('');

  const contentHtml = `
    ${buildDataRow('Branch', branchName)}
    ${buildDataRow('Requested By', managerName + (managerEmail ? ` &lt;${managerEmail}&gt;` : ''))}
    ${buildDataRow('Submission Time', bdTime())}
    ${buildDataRow('Urgency', urgency === 'urgent' ? '🚨 URGENT' : '🟢 Normal', false, urgency === 'urgent' ? '#f87171' : '#34d399')}
    ${buildDataRow('Total Amount Requested', fmtAmt(totalAmount), true)}
    <div style="margin-top:16px;">
      <div style="font-size:11px;font-weight:700;color:#8492a6;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">NOTE BUNDLE BREAKDOWN</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:13px;border:1px solid #1e222d;border-radius:6px;overflow:hidden;">
        <tr style="background-color:#0b0d13;"><th style="padding:6px 8px;text-align:left;color:#8492a6;font-size:11px;">Denomination</th><th style="padding:6px 8px;text-align:left;color:#8492a6;font-size:11px;">Quantity</th><th style="padding:6px 8px;text-align:right;color:#8492a6;font-size:11px;">Value</th></tr>
        ${breakdownRows}
        <tr style="border-top:2px solid #334155;"><td colspan="2" style="padding:8px;font-weight:700;color:#ffffff;">Total</td><td align="right" style="padding:8px;font-weight:800;color:#d4af37;font-size:14px;">${fmtAmt(totalAmount)}</td></tr>
      </table>
    </div>
    ${reason ? buildDataRow('Reason / Remarks', reason) : ''}
    <div style="margin-top:24px;text-align:center;">
      <a href="${reviewUrl}" style="display:inline-block;background:linear-gradient(135deg,#d4af37 0%,#aa7c11 100%);color:#000000;font-size:14px;font-weight:800;padding:13px 26px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">👉 Review Request in Admin Panel</a>
    </div>
  `;

  const html = getPremiumNotificationHtml({
    title: 'Cash Bundle Requisition Submitted',
    greeting: 'Hello Administration Team,',
    introText: `Branch Manager <strong style="color:#f8fafc;">${managerName}</strong> (<span style="color:#d4af37;font-weight:600;">${branchName}</span>) has submitted a cash change bundle requisition${urgency === 'urgent' ? ' marked as <strong style="color:#f87171;">URGENT</strong>' : ''}.`,
    boxTitle: '💵 Cash Bundle Requisition',
    boxIcon: '💵',
    badgeText: urgency === 'urgent' ? '🚨 URGENT' : 'Action Required',
    badgeBg: urgency === 'urgent' ? '#450a0a' : '#422006',
    badgeBorder: urgency === 'urgent' ? '#7f1d1d' : '#713f12',
    badgeColor: urgency === 'urgent' ? '#f87171' : '#facc15',
    contentHtml,
    footerNote: 'Please log in to the Admin Panel to process this cash bundle requisition.',
  });

  return sendPremiumEmail({
    to: adminEmails,
    subject: `💵 Bundle Requisition${urgency === 'urgent' ? ' 🚨 URGENT' : ''}: ${fmtAmt(totalAmount)} — ${branchName}`,
    html,
  });
}

/**
 * Sends email to branch manager when admin updates their bundle requisition status.
 */
export async function sendBundleStatusEmailToManager({
  managerEmail,
  managerName,
  branchName,
  totalAmount,
  status,
  adminNotes,
  adminName,
  baseUrl,
}: {
  managerEmail: string;
  managerName: string;
  branchName: string;
  totalAmount: number;
  status: 'processing' | 'completed' | 'rejected';
  adminNotes?: string | null;
  adminName?: string | null;
  baseUrl?: string;
}) {
  const appUrl = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://www.anchorfashion.shop';
  const historyUrl = `${appUrl.replace(/\/$/, '')}/dashboard/branch-accounts/bundle-requests`;
  const fmtAmt = (n: number) => `৳${Number(n).toLocaleString('en-BD', { minimumFractionDigits: 0 })}`;

  const statusConfig: Record<string, { label: string; icon: string; badgeBg: string; badgeBorder: string; badgeColor: string }> = {
    processing: { label: 'In-Transit / Processing', icon: '🚚', badgeBg: '#1e3a8a', badgeBorder: '#1d4ed8', badgeColor: '#60a5fa' },
    completed:  { label: 'Fulfilled & Completed',   icon: '✅', badgeBg: '#064e3b', badgeBorder: '#059669', badgeColor: '#34d399' },
    rejected:   { label: 'Request Declined',         icon: '❌', badgeBg: '#450a0a', badgeBorder: '#7f1d1d', badgeColor: '#f87171' },
  };
  const cfg = statusConfig[status] || statusConfig.processing;

  const html = getPremiumNotificationHtml({
    title: `Bundle Requisition ${cfg.label}`,
    greeting: `Dear ${managerName},`,
    introText: `Your cash bundle requisition of <strong style="color:#ffffff;">${fmtAmt(totalAmount)}</strong> for <strong style="color:#d4af37;">${branchName}</strong> has been updated by Head Office.`,
    boxTitle: `${cfg.icon} Bundle Requisition Update`,
    boxIcon: cfg.icon,
    badgeText: cfg.label.toUpperCase(),
    badgeBg: cfg.badgeBg,
    badgeBorder: cfg.badgeBorder,
    badgeColor: cfg.badgeColor,
    contentHtml: `
      ${buildDataRow('Branch', branchName)}
      ${buildDataRow('Total Amount', fmtAmt(totalAmount), true)}
      ${buildDataRow('New Status', cfg.label, false, cfg.badgeColor)}
      ${buildDataRow('Updated By', adminName || 'Head Office Administrator')}
      ${buildDataRow('Update Time', bdTime())}
      ${adminNotes ? buildDataRow('Head Office Note', adminNotes) : ''}
      <div style="margin-top:24px;text-align:center;">
        <a href="${historyUrl}" style="display:inline-block;background-color:#1e293b;color:#f8fafc;font-size:13px;font-weight:600;padding:10px 20px;border-radius:6px;border:1px solid #334155;text-decoration:none;">View My Requisitions &rarr;</a>
      </div>
    `,
    footerNote: status === 'rejected'
      ? 'If you have questions regarding this decision, please contact Head Office.'
      : 'Your change bundles are being processed. Please check your dashboard for the latest status.',
  });

  return sendPremiumEmail({
    to: managerEmail,
    subject: `${cfg.icon} Bundle Requisition ${cfg.label}: ${fmtAmt(totalAmount)} — ${branchName}`,
    html,
  });
}
