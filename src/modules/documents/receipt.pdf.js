'use strict';

// A small, dependency-free PDF 1.4 writer for 80 mm thermal-style receipts.
// Uses the standard-14 Courier fonts (no embedding, fixed 600/1000 glyph
// width, so right-aligned amounts line up exactly). Text is limited to
// WinAnsi/Latin-1: anything else is replaced with '?' rather than emitting
// a corrupt file. Correctness is checked in tests/stage12 by extracting the
// text back out with `pdftotext` and validating the structure with `pdfinfo`.

const COLS = 40;                  // characters per line
const FONT_SIZE = 8.5;            // pt
const CHAR_W = 0.6 * FONT_SIZE;   // Courier advance width
const MARGIN = 11;                // pt
const LEADING = 11;               // pt between lines
const PAGE_W = Math.round(COLS * CHAR_W + 2 * MARGIN); // ~226pt = 80mm

function winAnsi(text) {
  let out = '';
  for (const ch of String(text === null || text === undefined ? '' : text)) {
    const c = ch.codePointAt(0);
    out += (c >= 32 && c <= 126) || (c >= 160 && c <= 255) ? ch : '?';
  }
  return out;
}

function escapePdf(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrap(text, width) {
  const words = winAnsi(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (let w of words) {
    while (w.length > width) { // hard-split a single over-long token
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

const center = (t) => { const s = winAnsi(t).slice(0, COLS); return ' '.repeat(Math.floor((COLS - s.length) / 2)) + s; };
const lr = (l, r) => {
  const left = winAnsi(l); const right = winAnsi(r);
  const gap = COLS - left.length - right.length;
  if (gap >= 1) return left + ' '.repeat(gap) + right;
  return left.slice(0, Math.max(0, COLS - right.length - 1)) + ' ' + right;
};
const rule = () => '-'.repeat(COLS);

function fmt(n) {
  const v = Number(n);
  return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Builds the receipt body as [{text, bold}] lines.
function layout(receipt) {
  const L = [];
  const add = (text, bold = false) => L.push({ text, bold });
  const cur = receipt.currency || '';
  wrap(receipt.business.name, COLS).forEach((t) => add(center(t), true));
  if (receipt.business.address) wrap(receipt.business.address, COLS).forEach((t) => add(center(t)));
  if (receipt.business.phone) add(center(`Tel: ${receipt.business.phone}`));
  if (receipt.business.taxId) add(center(`TIN: ${receipt.business.taxId}`));
  add(rule());
  add(`Receipt: ${receipt.receiptNumber}`.slice(0, COLS));
  add(`Date: ${receipt.issuedAt}`.slice(0, COLS));
  wrap(`Customer: ${receipt.customer.name}`, COLS).forEach((t) => add(t));
  add(rule());
  for (const it of receipt.items) {
    wrap(it.productName, COLS).forEach((t) => add(t));
    add(lr(`  ${fmt(it.quantity)} x ${fmt(it.unitPrice)}`, fmt(it.quantity * it.unitPrice)));
    if (it.lineDiscountAmount) add(lr('  discount', `-${fmt(it.lineDiscountAmount)}`));
  }
  add(rule());
  add(lr('Subtotal', fmt(receipt.subtotal)));
  if (receipt.discountAmount) add(lr('Discount', `-${fmt(receipt.discountAmount)}`));
  if (receipt.taxRate) add(lr(`Tax ${receipt.taxRate}%`, fmt(receipt.taxAmount)));
  add(lr(`TOTAL ${cur}`.trim(), fmt(receipt.total)), true);
  add(rule());
  add(lr('Payment', `${receipt.paymentMethod}${receipt.paymentStatus ? ' (' + receipt.paymentStatus + ')' : ''}`));
  if (receipt.paymentReference) add(lr('Ref', receipt.paymentReference));
  if (receipt.paymentMethod === 'Cash') {
    add(lr('Cash received', fmt(receipt.cashReceived)));
    add(lr('Change', fmt(receipt.changeDue)));
  }
  add(rule());
  add(center('Thank you!'));
  return L;
}

function buildReceiptPdf(receipt) {
  const lines = layout(receipt);
  const pageH = Math.max(180, Math.ceil(lines.length * LEADING + 2 * MARGIN + 8));

  let content = '';
  let y = pageH - MARGIN - FONT_SIZE;
  for (const ln of lines) {
    content += `BT /${ln.bold ? 'F2' : 'F1'} ${FONT_SIZE} Tf ${MARGIN} ${y.toFixed(2)} Td (${escapePdf(ln.text)}) Tj ET\n`;
    y -= LEADING;
  }

  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${pageH}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');
  const contentBuf = Buffer.from(content, 'latin1');
  objs.push(`<< /Length ${contentBuf.length} >>\nstream\n${content}endstream`);
  objs.push(`<< /Title (${escapePdf(winAnsi('Receipt ' + receipt.receiptNumber))}) /Producer (XR Business Management System) >>`);

  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const b = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
    parts.push(b);
    pos += b.length;
  });
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

module.exports = { buildReceiptPdf, layout, winAnsi, COLS };
