import XLSX from 'xlsx-js-style';

export interface ExcelMeta {
  key: string;
  value: string | number;
}

export interface ExcelOptions {
  filename?: string;
  sheetName?: string;
  meta?: ExcelMeta[];
  totals?: (string | number)[];
}

// Colour palette.
const C_NAVY      = "0F3057"; // Primary Brand Executive Navy
const C_GOLD      = "D4AF37"; // Luxury Gold Accent
const C_WHITE     = "FFFFFF";
const C_TEXT_DARK = "161A22"; // Deep Charcoal
const C_MUTED     = "64748B"; // Muted Slate Grey
const C_BORDER    = "D0D6E0"; // Razor thin cell borders
const C_BG_ALT    = "F4F7FA"; // Zebra row striping
const C_GREEN     = "127338"; // Financial Settled / Credit
const C_RED       = "B92626"; // Financial Due / Debit
const C_BG_TOTAL  = "EBF0F8"; // Totals highlight background

/** Spreadsheet generator (xlsx-js-style) for bank and audit reports. */
export function generateExcel(
  title: string,
  columns: string[],
  rows: (string | number)[][],
  options?: ExcelOptions,
) {
  const wb = XLSX.utils.book_new();
  const sheetData: any[][] = [];
  const merges: XLSX.Range[] = [];
  const rowHeights: { hpt: number }[] = [];

  const maxColIdx = Math.max(columns.length - 1, 5);

  // 1. Title banner (row 0) and gold ribbon (row 1).
  const bannerRow: any[] = Array(maxColIdx + 1).fill("");
  bannerRow[0] = {
    v: title.toUpperCase(),
    t: 's',
    s: {
      fill: { fgColor: { rgb: C_NAVY } },
      font: { name: "Calibri", sz: 16, bold: true, color: { rgb: C_WHITE } },
      alignment: { horizontal: "center", vertical: "center" }
    }
  };
  sheetData.push(bannerRow);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: maxColIdx } });
  rowHeights.push({ hpt: 36 });

  // Gold Ribbon Row
  const ribbonRow: any[] = Array(maxColIdx + 1).fill({
    v: "", t: 's', s: { fill: { fgColor: { rgb: C_GOLD } } }
  });
  sheetData.push(ribbonRow);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: maxColIdx } });
  rowHeights.push({ hpt: 4 });

  sheetData.push(Array(maxColIdx + 1).fill("")); // Spacer
  rowHeights.push({ hpt: 10 });

  // 2. Metadata grid.
  const now = new Date();
  const printDate = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const printTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const defaultMeta = [
    { key: "STATEMENT REF", value: `EXP-${Date.now().toString().slice(-8)}` },
    { key: "PRINT DATE",    value: `${printDate} (${printTime})` },
    { key: "TOTAL RECORDS", value: `${rows.length} verified entries` }
  ];
  const allMeta = options?.meta ? [...options.meta, ...defaultMeta] : defaultMeta;

  // Format metadata into clean 2-column key-value cells
  for (let i = 0; i < allMeta.length; i += 2) {
    const m1 = allMeta[i];
    const m2 = allMeta[i + 1];
    const metaRow: any[] = Array(maxColIdx + 1).fill("");

    // Col A & B: Meta 1
    metaRow[0] = { v: m1.key + ":", t: 's', s: { font: { sz: 9.5, bold: true, color: { rgb: C_MUTED } }, alignment: { horizontal: "right", vertical: "center" } } };
    metaRow[1] = { v: String(m1.value), t: 's', s: { font: { sz: 10.5, bold: true, color: { rgb: C_NAVY } }, alignment: { horizontal: "left", vertical: "center" } } };

    // Col D & E: Meta 2
    if (m2) {
      metaRow[3] = { v: m2.key + ":", t: 's', s: { font: { sz: 9.5, bold: true, color: { rgb: C_MUTED } }, alignment: { horizontal: "right", vertical: "center" } } };
      metaRow[4] = { v: String(m2.value), t: 's', s: { font: { sz: 10.5, bold: true, color: { rgb: C_NAVY } }, alignment: { horizontal: "left", vertical: "center" } } };
    }

    sheetData.push(metaRow);
    rowHeights.push({ hpt: 22 });
  }

  sheetData.push(Array(maxColIdx + 1).fill("")); // Spacer
  rowHeights.push({ hpt: 14 });

  // 3. Table headers.
  const headerRowFormatted = columns.map((col) => {
    const name = col.toLowerCase();
    let align = "left";
    if (name === "#" || name.includes("sl") || name.includes("date") || name.includes("time") || name === "no") align = "center";
    if (name.includes("bdt") || name.includes("tk") || name.includes("amount") || name.includes("paid") || name.includes("due") || name.includes("total") || name.includes("salary") || name.includes("balance")) align = "right";

    return {
      v: col,
      t: 's',
      s: {
        fill: { fgColor: { rgb: C_NAVY } },
        font: { name: "Calibri", sz: 11, bold: true, color: { rgb: C_WHITE } },
        alignment: { horizontal: align, vertical: "center" },
        border: {
          top: { style: "medium", color: { rgb: C_NAVY } },
          bottom: { style: "medium", color: { rgb: C_GOLD } }
        }
      }
    };
  });
  sheetData.push(headerRowFormatted);
  rowHeights.push({ hpt: 28 });

  // 4. Data rows (zebra striping, financial colour coding).
  rows.forEach((row, rIdx) => {
    const bg = rIdx % 2 === 1 ? C_BG_ALT : C_WHITE;

    const formattedRow = row.map((cell, cIdx) => {
      const colName = columns[cIdx]?.toLowerCase() || "";
      let align = "left";
      if (colName === "#" || colName.includes("sl") || colName.includes("date") || colName.includes("time") || colName === "no") align = "center";
      
      const isFin = colName.includes("bdt") || colName.includes("tk") || colName.includes("amount") || colName.includes("paid") || colName.includes("due") || colName.includes("total") || colName.includes("salary") || colName.includes("balance");
      if (isFin) align = "right";

      let fontCol = C_TEXT_DARK;
      let isBold = false;
      const numVal = typeof cell === 'number' ? cell : parseFloat(String(cell || '').replace(/[^\d.-]/g, ''));

      if (isFin && !isNaN(numVal) && numVal > 0) {
        if (colName.includes("paid") || colName.includes("received")) { fontCol = C_GREEN; isBold = true; }
        if (colName.includes("due") || colName.includes("payable"))   { fontCol = C_RED;   isBold = true; }
      }

      const baseStyle = {
        fill: { fgColor: { rgb: bg } },
        font: { name: "Calibri", sz: 10, bold: isBold, color: { rgb: fontCol } },
        alignment: { horizontal: align, vertical: "center" },
        border: { bottom: { style: "thin", color: { rgb: C_BORDER } } }
      };

      if (isFin && typeof cell === 'number' && !isNaN(cell)) {
        // C48: money keeps its poisha — screens/PDFs show 2 decimals,
        // so Excel must too ('#,##0' silently rounded them away and
        // Excel totals diverged from every other format).
        return { v: cell, t: 'n', z: '#,##0.00', s: baseStyle };
      }
      return { v: cell ?? "", t: typeof cell === 'number' ? 'n' : 's', s: baseStyle };
    });

    sheetData.push(formattedRow);
    rowHeights.push({ hpt: 24 });
  });

  // 5. Grand totals row.
  if (options?.totals && options.totals.length > 0) {
    sheetData.push(Array(maxColIdx + 1).fill("")); // Spacer
    rowHeights.push({ hpt: 6 });

    const totalRowFormatted = options.totals.map((val, idx) => {
      const colName = columns[idx]?.toLowerCase() || "";
      let align = idx === 1 || String(val).includes("TOTAL") ? "left" : "right";
      
      let fontCol = C_NAVY;
      if (colName.includes("paid")) fontCol = C_GREEN;
      if (colName.includes("due"))  fontCol = C_RED;

      const totStyle = {
        fill: { fgColor: { rgb: C_BG_TOTAL } },
        font: { name: "Calibri", sz: 11, bold: true, color: { rgb: fontCol } },
        alignment: { horizontal: align, vertical: "center" },
        border: {
          top: { style: "thin", color: { rgb: C_NAVY } },
          bottom: { style: "double", color: { rgb: C_NAVY } }
        }
      };

      if (typeof val === 'number' && !isNaN(val)) {
        return { v: val, t: 'n', z: '#,##0.00', s: totStyle };
      }
      return { v: val ?? "", t: 's', s: totStyle };
    });

    sheetData.push(totalRowFormatted);
    rowHeights.push({ hpt: 28 });
  }

  // 6. Disclaimer footer.
  sheetData.push(Array(maxColIdx + 1).fill("")); // Spacer
  rowHeights.push({ hpt: 20 });

  const rGenIdx = sheetData.length;
  const genRow = Array(maxColIdx + 1).fill("");
  genRow[0] = { v: `Generation Date: ${printDate}`, t: 's', s: { font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: C_TEXT_DARK } }, alignment: { horizontal: "center" } } };
  sheetData.push(genRow);
  merges.push({ s: { r: rGenIdx, c: 0 }, e: { r: rGenIdx, c: maxColIdx } });
  rowHeights.push({ hpt: 18 });

  const rDiscIdx = sheetData.length;
  const discRow = Array(maxColIdx + 1).fill("");
  discRow[0] = { v: "This is a computer-generated electronic statement and does not require a signature.", t: 's', s: { font: { name: "Calibri", sz: 9, italic: true, color: { rgb: C_MUTED } }, alignment: { horizontal: "center" } } };
  sheetData.push(discRow);
  merges.push({ s: { r: rDiscIdx, c: 0 }, e: { r: rDiscIdx, c: maxColIdx } });
  rowHeights.push({ hpt: 18 });

  // 7. Compile the sheet and set column widths.
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!merges'] = merges;
  ws['!rows']   = rowHeights;

  const colWidths = columns.map((col, cIdx) => {
    let maxLen = col.length;
    rows.forEach(r => {
      const cellVal = String(r[cIdx] ?? '');
      if (cellVal.length > maxLen) maxLen = cellVal.length;
    });
    return { wch: Math.min(Math.max(maxLen + 5, 14), 45) };
  });
  ws['!cols'] = colWidths;

  const sheetName = options?.sheetName ?? 'Statement';
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  const filename = options?.filename ?? `${title.replace(/\s+/g, '_')}.xlsx`;
  XLSX.writeFile(wb, filename);
}
