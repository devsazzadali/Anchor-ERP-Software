import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface SummaryData {
  label: string;
  value: string | number;
}

export interface PdfOptions {
  summaryData?: SummaryData[];
  filename?: string;
  subtitle?: string;
  reportRef?: string;
  preparedBy?: string;
  branch?: string;
  dateRange?: string;
  notes?: string | null;
  orientation?: 'portrait' | 'landscape';
  tableTitle?: string;
}

// Colour palette.
type RGB = [number, number, number];

const NAVY: RGB     = [15,  48,  87];
const GOLD: RGB     = [212, 175, 55];
const SLATE: RGB    = [30,  41,  59];
const BODY: RGB     = [60,  68,  82];
const SUB: RGB      = [120, 130, 145];
const BORDER: RGB   = [208, 214, 224];
const BGLT: RGB     = [238, 243, 250]; // Soft light-blue box fill
const BG_ALT: RGB   = [248, 250, 253]; // Table zebra rows
const WHITE: RGB    = [255, 255, 255];
const BLACK: RGB    = [0,   0,   0]; // Pure black for maximum contrast
const GREEN: RGB    = [18,  115, 56];
const RED: RGB      = [185, 38,  38];

/**
 * Universal Sanitizer for jsPDF Helvetica / WinAnsi compatibility.
 * Replaces unmapped Bengali glyphs (e.g. ৳), unicode minus signs, and strange spaces
 * which corrupt font metrics and cause awkward wide spacing or table overflows.
 */
export function sanitizeForPdf(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/৳/g, 'BDT ')
    .replace(/\u09F3/g, 'BDT ')
    .replace(/\u2212/g, '-')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u0980-\u09FF]/g, '') // Strip Bengali characters to prevent Helvetica spacing/overflow bugs
    .trim();
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/** Draws repeating diagonal watermark pattern across the full sheet (responsive to orientation) */
function drawPageWatermark(doc: jsPDF) {
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(245, 247, 251); // Extremely faint watermark to not interfere with text
  for (let y = 30; y < PH + 80; y += 80) {
    for (let x = -30; x < PW + 120; x += 160) {
      const shiftX = ((Math.floor(y / 80)) % 2) * 80;
      doc.text('ANCHOR FASHION', x + shiftX, y, { angle: 30, align: 'center' });
    }
  }
}

/**
 * Professional Executive Statement PDF Generator.
 * Built to exact Anchor Fashion corporate specifications:
 *  1. Auto-switches to Landscape A4 for wide tables (>= 7 columns) to eliminate clipping.
 *  2. Full character sanitization prevents broken spacing and overlapping numbers.
 *  3. Repeating diagonal ANCHOR FASHION watermark on every page.
 *  4. Executive Summary Card with clean totals.
 *  5. Contained, wrapped Special Instructions / Notes box.
 *  6. Electronic statement verification disclaimer at document bottom.
 */
export async function createPdfDocument(
  title: string,
  columns: string[],
  rows: (string | number)[][],
  options?: PdfOptions,
): Promise<jsPDF> {
  const isWide = columns.length >= 7;
  const orientation = options?.orientation ?? (isWide ? 'landscape' : 'portrait');
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });

  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const LM = orientation === 'landscape' ? 36 : 40; // Left Margin
  const RM = orientation === 'landscape' ? 36 : 40; // Right Margin
  const CW = PW - LM - RM;                          // Usable Content Width

  // Sanitize title & columns
  const cleanTitle = sanitizeForPdf(title);
  const sanitizedColumns = columns.map(c => sanitizeForPdf(c));

  // Sanitize and process rows
  let processedRows: (string | number)[][] = rows.map(r =>
    r.map(cell => typeof cell === 'number' ? cell : sanitizeForPdf(cell))
  );

  // If summaryData is present, remove a raw totals row from the
  // bottom if the caller included one in the data rows.
  // C47: the old check popped the last row when ANY cell merely
  // CONTAINED the substring "total" — a legitimate final data row
  // (e.g. a description "Total stationery bill") was silently
  // deleted from the PDF. Only a row whose FIRST cell is a totals
  // label ('Total' or 'Grand Total…') is treated as a totals row.
  if (options?.summaryData && options.summaryData.length > 0) {
    const lastRow = processedRows[processedRows.length - 1];
    const firstCell = lastRow ? String(lastRow[0] ?? '').trim().toLowerCase() : '';
    if (lastRow && (firstCell === 'total' || firstCell.startsWith('grand total'))) {
      processedRows.pop();
    }
  }

  const fc = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const dc = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const tc = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const f  = (style: 'normal' | 'bold' | 'italic') => doc.setFont('Helvetica', style);
  const sz = (n: number) => doc.setFontSize(n);
  const lw = (n: number) => doc.setLineWidth(n);

  const drawTopHeader = () => {
    fc(NAVY); doc.rect(0, 0, PW, 32, 'F');
    fc(GOLD); doc.rect(0, 31, PW, 2, 'F');
    f('bold'); sz(10); tc(WHITE);
    doc.text('ANCHOR FASHION', LM, 20);
    f('normal'); sz(8); tc([200, 215, 240]);
    doc.text(`${cleanTitle} \u2014 continued`, PW - RM, 20, { align: 'right' });
  };

  const printDate = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  const printTime = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
  });
  const docRef = options?.reportRef ?? `EXP-${Date.now().toString().slice(-8)}`;

  let logo: HTMLImageElement | string | null = null;
  if (typeof window !== 'undefined') {
    try { logo = await loadImage('/logo.png'); } catch {}
  } else {
    try {
      const fs = (await import('f' + 's')).default;
      const path = (await import('p' + 'a' + 't' + 'h')).default;
      const logoPath = path.join(process.cwd(), 'public', 'logo.png');
      if (fs.existsSync(logoPath)) {
        const buf = fs.readFileSync(logoPath);
        logo = `data:image/png;base64,${buf.toString('base64')}`;
      }
    } catch {}
  }

  // Draw Page 1 Background Watermark
  drawPageWatermark(doc);

  // 1. Brand header.
  const BADGE_X = LM;
  const BADGE_Y = 16;
  const BADGE_S = 74;

  if (logo) {
    if (typeof logo === 'string') {
      // Natural logo aspect ratio is 612:408 = 1.5:1
      const logoH = 68;
      const logoW = Math.round(logoH * 1.5);
      doc.addImage(logo, 'PNG', BADGE_X, BADGE_Y, logoW, logoH);
    } else {
      const imgRatio = logo.width && logo.height ? logo.width / logo.height : 1.5;
      const logoH = 68;
      const logoW = Math.min(220, Math.round(logoH * imgRatio));
      doc.addImage(logo, 'PNG', BADGE_X, BADGE_Y, logoW, logoH);
    }
  } else {
    fc(NAVY); doc.roundedRect(BADGE_X, BADGE_Y, BADGE_S, BADGE_S, 7, 7, 'F');
    f('bold'); sz(16); tc(WHITE);
    doc.text('AF', BADGE_X + BADGE_S / 2, BADGE_Y + BADGE_S / 2 + 5, { align: 'center' });

    const nameX = BADGE_X + BADGE_S + 14;
    f('bold'); sz(15); tc(NAVY);
    doc.text('ANCHOR FASHION', nameX, BADGE_Y + 20);
    f('normal'); sz(8.5); tc(SUB);
    doc.text('Enterprise Resource Planning System', nameX, BADGE_Y + 34);
  }

  // Large Document Heading (Right-aligned)
  f('normal'); doc.setTextColor(125, 133, 148);
  if (cleanTitle.length > 30) sz(16);
  else if (cleanTitle.length > 20) sz(20);
  else sz(24);
  doc.text(cleanTitle, PW - RM, BADGE_Y + 34, { align: 'right' });

  // Navy scope pill tag
  const scopeTag = sanitizeForPdf(options?.branch ?? options?.subtitle ?? 'STATEMENT REPORT')
    .toUpperCase()
    .slice(0, 34);
  const TAG_W = 180, TAG_H = 19;
  const TAG_X = PW - RM - TAG_W;
  const TAG_Y = BADGE_Y + 44;
  fc(NAVY); doc.rect(TAG_X, TAG_Y, TAG_W, TAG_H, 'F');
  f('bold'); sz(8); tc(WHITE);
  doc.text(scopeTag, TAG_X + TAG_W / 2, TAG_Y + 12.5, { align: 'center' });

  // Header separator line
  const SEP_Y = 100;
  dc(BORDER); lw(0.6);
  doc.line(LM, SEP_Y, PW - RM, SEP_Y);

  // 2. Information and scope grid.
  const INFO_Y = SEP_Y + 12;
  const ADDR_W = orientation === 'landscape' ? CW * 0.32 : CW * 0.38;
  const ADDR_H = 74;
  const KV_X   = LM + ADDR_W + 20;
  const KV_W   = CW - ADDR_W - 20;

  // Address Card
  fc(WHITE); dc(BORDER); lw(0.8);
  doc.rect(LM, INFO_Y, ADDR_W, ADDR_H, 'FD');
  f('bold'); sz(9.5); tc(BLACK);
  doc.text('ANCHOR FASHION', LM + 12, INFO_Y + 18);
  f('normal'); sz(8); tc(BODY);
  doc.text('Operations & Finance Department', LM + 12, INFO_Y + 32);
  doc.text('Dhaka, Bangladesh', LM + 12, INFO_Y + 46);
  doc.text('anchorfashionsupport@gmail.com', LM + 12, INFO_Y + 60);

  // Metadata Grid
  const metaPairs: [string, string][] = [
    ['STATEMENT REF.', docRef],
    ['BRANCH / SCOPE', sanitizeForPdf(options?.branch ?? 'All Branches')],
    ['PERIOD / DATES', sanitizeForPdf(options?.dateRange ?? 'All Time')],
    ['PRINT DATE',     `${printDate} ${printTime}`],
    ['PREPARED BY',    sanitizeForPdf(options?.preparedBy ?? 'Operations Management')],
    ['TOTAL RECORDS',  `${processedRows.length} entries`],
  ];

  const colsCount = orientation === 'landscape' ? 3 : 2;
  const colW = KV_W / colsCount;
  metaPairs.forEach(([k, v], i) => {
    const col = i % colsCount;
    const row = Math.floor(i / colsCount);
    const kx  = KV_X + col * colW;
    const ky  = INFO_Y + 6 + row * 24;
    f('bold'); sz(6.5); tc(SUB);
    doc.text(k, kx, ky);
    f('normal'); sz(8); tc(BLACK);
    let val = v;
    while (doc.getTextWidth(val) > colW - 6 && val.length > 4) val = val.slice(0, -4) + '\u2026';
    doc.text(val, kx, ky + 13);
  });

  // 3. Statement summary and totals.
  let curY = INFO_Y + ADDR_H + 18;

  if (options?.summaryData && options.summaryData.length > 0) {
    const sanitizedSummary = options.summaryData.map(item => ({
      label: sanitizeForPdf(item.label),
      value: sanitizeForPdf(item.value),
    }));

    const sumLen = sanitizedSummary.length;
    const SUMMARY_H = 32 + (sumLen * 22);
    
    // Draw Box
    fc([242, 246, 252]); dc([208, 214, 224]); lw(0.8);
    doc.rect(LM, curY, CW, SUMMARY_H, 'FD');
    
    // Title
    f('bold'); sz(10); tc(NAVY);
    doc.text('STATEMENT SUMMARY & TOTALS', LM + 12, curY + 20);
    
    // Rows
    sanitizedSummary.forEach((item, idx) => {
      const rowY = curY + 42 + (idx * 22);
      
      // Circle index
      fc([218, 172, 54]); // Goldish mustard
      doc.circle(LM + 20, rowY - 3.5, 7, 'F');
      f('bold'); sz(7.5); tc(WHITE);
      doc.text((idx + 1).toString(), LM + 20, rowY - 1, { align: 'center' });
      
      // Label
      f('normal'); sz(9); tc(BODY);
      doc.text(item.label, LM + 36, rowY);
      
      // Value
      f('bold'); sz(9);
      const lbl = item.label.toLowerCase();
      if (lbl.includes('due') || lbl.includes('payable') || lbl.includes('shortage')) tc(RED);
      else if (lbl.includes('paid') || lbl.includes('received') || lbl.includes('approved') || lbl.includes('inflow') || lbl.includes('sales')) tc(GREEN);
      else tc(NAVY);
      
      doc.text(String(item.value), LM + CW - 14, rowY, { align: 'right' });
      
      // Separator
      if (idx < sumLen - 1) {
        dc([225, 230, 240]); lw(0.5);
        doc.line(LM + 12, rowY + 11, LM + CW - 12, rowY + 11);
      }
    });
    
    curY += SUMMARY_H + 20;
  } else {
    curY += 4;
  }

  // 4. Transaction details table.
  if (curY > PH - 80) { doc.addPage(); drawPageWatermark(doc); drawTopHeader(); curY = 50; }
  f('bold'); sz(11); tc(BLACK);
  doc.text(options?.tableTitle || 'Statement Details', LM, curY);
  const tableStartY = curY + 14;

  const isManyCols = sanitizedColumns.length >= 8;

  // Hack to draw watermark BEFORE autoTable draws the table content on new pages
  const originalAddPage = doc.addPage.bind(doc);
  doc.addPage = function(...args: any[]) {
    originalAddPage(...args);
    drawPageWatermark(doc);
    return doc;
  } as any;

  autoTable(doc, {
    startY: tableStartY,
    head: [sanitizedColumns],
    body: processedRows,
    theme: 'plain',
    styles: {
      font: 'helvetica',
      overflow: 'linebreak',
      fontSize: isManyCols ? 7.5 : 8.5,
      cellPadding: isManyCols ? { top: 6, bottom: 6, left: 5, right: 5 } : { top: 7, bottom: 7, left: 6, right: 6 },
      textColor: [60, 68, 82],
      lineColor: [232, 236, 242],
      lineWidth: { bottom: 0.4 },
    },
    headStyles: {
      fillColor: [235, 240, 250],
      textColor: [15, 48, 87],
      fontStyle: 'bold',
      fontSize: isManyCols ? 7.5 : 8.5,
      lineColor: [208, 214, 224],
      lineWidth: { bottom: 1.2 },
      cellPadding: isManyCols ? { top: 7, bottom: 7, left: 5, right: 5 } : { top: 8, bottom: 8, left: 6, right: 6 },
    },
    alternateRowStyles: { fillColor: BG_ALT },
    margin: { left: LM, right: RM },
    didParseCell: (data) => {
      const headLabel = String(data.table.head[0]?.cells[data.column.index]?.raw ?? '').toLowerCase();

      if (headLabel === '#' || headLabel === 'sl' || headLabel === 'sl no' || headLabel === 'sl.' || headLabel === 'no' || headLabel === 'no.') {
        data.cell.styles.halign = 'center';
        data.cell.styles.cellWidth = 24;
      }
      
      const isDateCol = headLabel.includes('date') || headLabel.includes('day') || headLabel.includes('time') || headLabel.includes('status');
      
      if (isDateCol) {
        data.cell.styles.halign = 'center';
      } else if (headLabel.includes('bdt') || headLabel.includes('tk') || headLabel.includes('amount') ||
          headLabel.includes('paid') || headLabel.includes('due') || headLabel.includes('salary') ||
          headLabel.includes('total') || headLabel.includes('balance') || headLabel.includes('cash') ||
          headLabel.includes('sales') || headLabel.includes('inflow') || headLabel.includes('difference')) {
        data.cell.styles.halign = 'right';

        if (data.section === 'body') {
          const rawText = String(data.cell.raw ?? '');
          const num = parseFloat(rawText.replace(/[^\d.-]/g, ''));
          if (!isNaN(num) && /[0-9]/.test(rawText)) {
            if (headLabel.includes('difference') || headLabel.includes('diff')) {
              if (num > 0) data.cell.styles.textColor = GREEN;
              else if (num < 0) data.cell.styles.textColor = RED;
            } else if (headLabel.includes('paid') || headLabel.includes('sales') || headLabel.includes('inflow')) {
              if (num > 0) data.cell.styles.textColor = GREEN;
            } else if (headLabel.includes('due') || headLabel.includes('payable') || headLabel.includes('expense') || headLabel.includes('shortage')) {
              if (num > 0) data.cell.styles.textColor = RED;
            }
          }
        }
      }
    },
    didDrawPage: (hook) => {
      if (hook.pageNumber > 1) {
        drawTopHeader();
      }
    },
  });

  const lastTab = (doc as any).lastAutoTable;

  // 5. Notes box.
  curY = (lastTab?.finalY ?? curY) + 20;
  if (curY > PH - 160) { doc.addPage(); drawPageWatermark(doc); drawTopHeader(); curY = 50; }

  const customNotesText = options?.notes ? sanitizeForPdf(options.notes) : '';
  f('normal'); sz(8); tc(SUB);
  
  const notesLines: string[] = customNotesText ? doc.splitTextToSize(customNotesText, CW - 28) : [
    'This document is system-generated by Anchor Fashion ERP System.',
    'For official use only. Unauthorized reproduction or modification is strictly prohibited.',
    'Please retain this statement for your official records and audit compliance.'
  ];
  
  const NOTES_H = Math.max(54, 26 + (notesLines.length * 13));
  fc([248, 250, 253]); dc(BORDER); lw(0.6);
  doc.roundedRect(LM, curY, CW, NOTES_H, 3, 3, 'FD');

  f('bold'); sz(8.5); tc(NAVY);
  doc.text(customNotesText ? 'SPECIAL INSTRUCTIONS / NOTES:' : 'NOTES:', LM + 12, curY + 16);
  
  f('normal'); sz(7.5); tc(BODY);
  let noteY = curY + 30;
  notesLines.forEach((line: string) => {
    doc.text(line, LM + 12, noteY);
    noteY += 13;
  });

  curY += NOTES_H + 20;

  // 6. Signature block.
  if (curY > PH - 125) { doc.addPage(); drawPageWatermark(doc); drawTopHeader(); curY = 50; }

  const sigW = CW / 3;
  ['Prepared By', 'Verified By', 'Authorized By'].forEach((lbl, i) => {
    const sx = LM + i * sigW;
    const cx = sx + sigW / 2;
    dc([180, 188, 200]); lw(0.6); doc.line(sx + 20, curY + 28, sx + sigW - 20, curY + 28);
    f('bold'); sz(8); tc(NAVY); doc.text(lbl, cx, curY + 40, { align: 'center' });
    f('normal'); sz(7); tc(SUB);  doc.text('Name & Designation', cx, curY + 50, { align: 'center' });
  });

  // 7. Disclaimer.
  const legalY = curY + 68;
  f('bold'); sz(8); tc(BODY);
  doc.text(`Generation Date: ${printDate} ${printTime}`, PW / 2, legalY, { align: 'center' });
  f('normal'); sz(7.5); tc(SUB);
  doc.text('This is a computer-generated electronic statement and does not require a physical signature.', PW / 2, legalY + 12, { align: 'center' });

  // 8. Page footer (landscape and portrait).
  const totalPages = doc.getNumberOfPages();
  const DOT = '\u00b7';
  const footStr = `ANCHOR FASHION ERP  ${DOT}  Confidential & Proprietary  ${DOT}  ${printDate}`;

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    dc(BORDER); lw(0.5); doc.line(LM, PH - 26, PW - RM, PH - 26);
    f('normal'); sz(7); tc(SUB); doc.text(footStr, LM, PH - 14);
    f('bold'); tc(NAVY); doc.text(`Page ${p} of ${totalPages}`, PW - RM, PH - 14, { align: 'right' });
  }

  return doc;
}

export async function generatePdf(
  title: string,
  columns: string[],
  rows: (string | number)[][],
  options?: PdfOptions,
) {
  const doc = await createPdfDocument(title, columns, rows, options);
  const filename = options?.filename ?? `${title.replace(/[\s\W]+/g, '_')}.pdf`;
  doc.save(filename);
}

export async function generatePdfBuffer(
  title: string,
  columns: string[],
  rows: (string | number)[][],
  options?: PdfOptions,
): Promise<any> {
  const doc = await createPdfDocument(title, columns, rows, options);
  const arrayBuffer = doc.output('arraybuffer');
  
  if (typeof globalThis !== 'undefined' && (globalThis as any).Buffer) {
    return (globalThis as any).Buffer.from(arrayBuffer);
  }
  return new Uint8Array(arrayBuffer);
}

