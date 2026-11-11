import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtDate } from './report.js';

const D = path.dirname(fileURLToPath(import.meta.url));
const A = f => path.join(D, 'assets', f);
const FNT = f => path.join(D, 'fonts', f);
const LEFT = 64;
const W = 612 - 2 * LEFT; // 484
const TOP = 160;
const BOTTOM = 720;

export const receiptId = (id, seq) => seq || ('REC-PGI-W26-' + String(id || '').replace(/-/g, '').slice(0, 6).toUpperCase());

/**
 * Builds an official, branded PDF payment receipt.
 * @param {Object} data - Receipt parameters
 * @returns {Promise<Buffer>} PDF Buffer
 */
export function buildReceiptPDF(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: TOP, bottom: 60, left: LEFT, right: LEFT },
      info: {
        Title: 'Payment Receipt - ' + (data.studentId || 'PGI'),
        Author: 'Plant Green Inertia Pvt. Ltd.'
      }
    });

    const bufs = [];
    doc.on('data', b => bufs.push(b));
    doc.on('end', () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);

    doc.registerFont('R', FNT('FreeSerif.ttf'));
    doc.registerFont('B', FNT('FreeSerif-Bold.ttf'));

    const addLetterhead = () => {
      try {
        doc.image(A('header.png'), 0, 0, { width: 612 });
      } catch {}
      try {
        doc.image(A('footer.png'), 0, 792 - (612 * 111 / 1700) - 14, { width: 612 });
      } catch {}
      doc.x = LEFT;
      doc.y = TOP;
    };

    doc.on('pageAdded', addLetterhead);
    addLetterhead();

    // Document Title & Stamp
    doc.font('B').fontSize(16).fillColor('#101D35').text('OFFICIAL PAYMENT RECEIPT', LEFT, TOP, { align: 'center', width: W });
    doc.font('R').fontSize(9.5).fillColor('#536B82').text('Plant Green Inertia Pvt. Ltd. · Winter Internship Program', { align: 'center', width: W });
    doc.y += 12;

    // Top Metadata Row (Receipt No, Date, Status)
    const metaY = doc.y;
    doc.rect(LEFT, metaY, W, 42).fillAndStroke('#F5FAFF', '#D8E2EC');

    doc.font('B').fontSize(9).fillColor('#101D35').text('RECEIPT NUMBER:', LEFT + 14, metaY + 8);
    doc.font('B').fontSize(10).fillColor('#296934').text(data.receiptNo || 'REC-PGI-W26-0000', LEFT + 14, metaY + 22);

    doc.font('B').fontSize(9).fillColor('#101D35').text('PAYMENT DATE:', LEFT + 180, metaY + 8);
    doc.font('R').fontSize(9.5).fillColor('#101D35').text(fmtDate(data.paidAt || new Date()), LEFT + 180, metaY + 22);

    doc.font('B').fontSize(9).fillColor('#101D35').text('PAYMENT STATUS:', LEFT + 340, metaY + 8);
    doc.font('B').fontSize(10).fillColor('#296934').text('PAID / SUCCESS ✓', LEFT + 340, metaY + 22);

    doc.y = metaY + 54;

    // Student & Application Information
    doc.font('B').fontSize(11).fillColor('#101D35').text('STUDENT & REGISTRATION DETAILS', LEFT, doc.y);
    doc.y += 4;
    doc.moveTo(LEFT, doc.y).lineTo(LEFT + W, doc.y).strokeColor('#296934').lineWidth(1.5).stroke();
    doc.y += 8;

    const rowY1 = doc.y;
    doc.font('B').fontSize(9.5).fillColor('#536B82').text('Candidate Name:', LEFT, rowY1);
    doc.font('B').fontSize(9.5).fillColor('#101D35').text(data.name || '-', LEFT + 110, rowY1);

    doc.font('B').fontSize(9.5).fillColor('#536B82').text('Student ID:', LEFT + 270, rowY1);
    doc.font('B').fontSize(10).fillColor('#296934').text(data.studentId || '-', LEFT + 360, rowY1);

    doc.y = rowY1 + 18;
    const rowY2 = doc.y;
    doc.font('B').fontSize(9.5).fillColor('#536B82').text('Email Address:', LEFT, rowY2);
    doc.font('R').fontSize(9.5).fillColor('#101D35').text(data.email || '-', LEFT + 110, rowY2);

    doc.font('B').fontSize(9.5).fillColor('#536B82').text('Mobile:', LEFT + 270, rowY2);
    doc.font('R').fontSize(9.5).fillColor('#101D35').text(data.phone || '-', LEFT + 360, rowY2);

    doc.y = rowY2 + 22;

    // Course Track Details
    doc.font('B').fontSize(11).fillColor('#101D35').text('ENROLLED PROGRAM & COURSE TRACK', LEFT, doc.y);
    doc.y += 4;
    doc.moveTo(LEFT, doc.y).lineTo(LEFT + W, doc.y).strokeColor('#296934').lineWidth(1.5).stroke();
    doc.y += 8;

    const cRowY1 = doc.y;
    doc.font('B').fontSize(9.5).fillColor('#536B82').text('Program:', LEFT, cRowY1);
    doc.font('B').fontSize(9.5).fillColor('#101D35').text('Winter Internship & Training Program 2026', LEFT + 110, cRowY1);

    doc.font('B').fontSize(9.5).fillColor('#536B82').text('Duration:', LEFT + 320, cRowY1);
    doc.font('R').fontSize(9.5).fillColor('#101D35').text(data.duration || '30 Hours', LEFT + 380, cRowY1);

    doc.y = cRowY1 + 18;
    const cRowY2 = doc.y;
    doc.font('B').fontSize(9.5).fillColor('#536B82').text('Specialization:', LEFT, cRowY2);
    doc.font('B').fontSize(9.5).fillColor('#101D35').text(data.course || 'Technical Track', LEFT + 110, cRowY2);

    doc.font('B').fontSize(9.5).fillColor('#536B82').text('Mode:', LEFT + 320, cRowY2);
    doc.font('R').fontSize(9.5).fillColor('#101D35').text(data.mode || 'Online / Offline', LEFT + 380, cRowY2);

    doc.y = cRowY2 + 24;

    // Payment & Fee Breakdown Table
    doc.font('B').fontSize(11).fillColor('#101D35').text('PAYMENT BREAKDOWN', LEFT, doc.y);
    doc.y += 4;
    doc.moveTo(LEFT, doc.y).lineTo(LEFT + W, doc.y).strokeColor('#296934').lineWidth(1.5).stroke();
    doc.y += 6;

    // Table Header
    const thY = doc.y;
    doc.rect(LEFT, thY, W, 20).fill('#101D35');
    doc.font('B').fontSize(9).fillColor('#FFFFFF');
    doc.text('DESCRIPTION', LEFT + 12, thY + 5);
    doc.text('RATE (INR)', LEFT + 260, thY + 5);
    doc.text('SCHOLARSHIP', LEFT + 340, thY + 5);
    doc.text('AMOUNT (INR)', LEFT + 420, thY + 5, { width: 50, align: 'right' });

    doc.y = thY + 20;

    // Line Item 1
    const paidPaise = Number.isFinite(data.amountPaise) ? Number(data.amountPaise) : 99900;
    const basePaise = Number.isFinite(data.basePricePaise) ? Number(data.basePricePaise) : 999900;
    const fmtInr2 = p => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const paidStr = fmtInr2(paidPaise);
    const rateStr = fmtInr2(basePaise);
    const pctOff = paidPaise === 0 ? 100 : (paidPaise === 119900 ? 88 : (paidPaise === 99900 ? 90 : Math.max(0, Math.round(((basePaise - paidPaise) / Math.max(basePaise, 1)) * 100))));
    const grantLabel = paidPaise === basePaise
      ? 'Standard Tuition'
      : (data.couponCode ? `Coupon: ${data.couponCode} (${pctOff}%)` : `${pctOff}% Merit Grant`);
    const wordsLabel = paidPaise === 0
      ? 'Zero Rupees Only (100% Merit Scholarship)'
      : paidPaise === 99900
        ? 'Nine Hundred and Ninety-Nine Rupees Only'
        : paidPaise === 119900
          ? 'One Thousand One Hundred and Ninety-Nine Rupees Only'
          : paidPaise === 999900
            ? 'Nine Thousand Nine Hundred and Ninety-Nine Rupees Only'
            : `${paidStr} Only`;

    const tr1Y = doc.y;
    doc.rect(LEFT, tr1Y, W, 24).fillAndStroke('#FFFFFF', '#E2ECF5');
    doc.font('R').fontSize(9).fillColor('#101D35').text('Winter Internship Tuition (30 Hours)', LEFT + 12, tr1Y + 7);
    doc.text(rateStr, LEFT + 260, tr1Y + 7);
    doc.font('B').fontSize(9).fillColor('#296934').text(grantLabel, LEFT + 336, tr1Y + 7);
    doc.font('B').fontSize(9.5).fillColor('#101D35').text(paidStr, LEFT + 412, tr1Y + 7, { width: 58, align: 'right' });

    doc.y = tr1Y + 24;

    // Total Row
    const totY = doc.y;
    doc.save().fillOpacity(0.08).rect(LEFT, totY, W, 26).fill('#296934').restore();
    doc.rect(LEFT, totY, W, 26).stroke('#296934');
    doc.font('B').fontSize(10).fillColor('#101D35').text('TOTAL AMOUNT PAID', LEFT + 12, totY + 8);
    doc.font('B').fontSize(11).fillColor('#296934').text(paidStr, LEFT + 400, totY + 8, { width: 70, align: 'right' });

    doc.y = totY + 34;

    // Words & Transaction Ref
    doc.font('R').fontSize(8.5).fillColor('#536B82').text('Amount in words: ', LEFT, doc.y, { continued: true });
    doc.font('B').fontSize(8.5).fillColor('#101D35').text(wordsLabel, { continued: false });
    doc.y += 4;
    doc.font('R').fontSize(8.5).fillColor('#536B82').text('Razorpay Transaction ID: ', LEFT, doc.y, { continued: true });
    doc.font('B').fontSize(8.5).fillColor('#101D35').text(data.transactionRef || '-', { continued: false });

    doc.y += 20;

    // Digital Authentication Footer Box
    const authBoxY = doc.y;
    doc.rect(LEFT, authBoxY, W, 48).fillAndStroke('#F5FAFF', '#D8E2EC');
    doc.font('B').fontSize(8.5).fillColor('#101D35').text('DIGITAL TRANSACTION VERIFICATION', LEFT + 12, authBoxY + 6);
    doc.font('R').fontSize(8).fillColor('#536B82').text(
      'This is an electronically generated and digitally recorded payment receipt issued by Plant Green Inertia Pvt. Ltd. ' +
      'Payment was securely processed via Razorpay (UPI / Cards / Net Banking) under batch Winter 2026. No physical signature is required.',
      LEFT + 12, authBoxY + 18, { width: W - 24, lineGap: 1.5 }
    );

    doc.end();
  });
}
