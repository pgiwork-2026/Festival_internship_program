import PDFDocument from 'pdfkit';
import { buildOfferPDF, offerId } from './offer.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatINR } from './logic.js';
import { fmtDate } from './report.js';

// Offer letter on the Plant Green Inertia letterhead (same header/footer images as the assessment report).
const D = path.dirname(fileURLToPath(import.meta.url)), A = f => path.join(D, 'assets', f), FNT = f => path.join(D, 'fonts', f);
const LEFT = 72, W = 612 - 2 * LEFT, BOTTOM = 725, TOP = 168;
export const offerId = id => 'PGI-OL-' + String(id).replace(/-/g, '').slice(0, 8).toUpperCase();

// o = { name, email, phone, course, duration, enrollmentId, transactionRef, enrolledAt, kind, amountPaise }
export function buildOfferPDF(o) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: TOP, bottom: 60, left: LEFT, right: LEFT }, info: { Title: 'Offer Letter - ' + o.name, Author: 'Plant Green Inertia Pvt. Ltd.' } });
    const bufs = []; doc.on('data', b => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs))); doc.on('error', reject);
    doc.registerFont('R', FNT('FreeSerif.ttf')); doc.registerFont('B', FNT('FreeSerif-Bold.ttf'));
    const deco = () => { doc.image(A('header.png'), 0, 0, { width: 612 }); doc.image(A('footer.png'), 0, 792 - 612 * 111 / 1700 - 14, { width: 612 }); doc.x = LEFT; doc.y = TOP; };
    doc.on('pageAdded', deco); deco();

    const gap = n => { doc.y += n; };
    const need = h => { if (doc.y + h > BOTTOM) doc.addPage(); };
    // P([ 'plain', ['bold', true], ... ], { align, size }) writes one paragraph mixing regular and bold runs.
    const P = (parts, opt = {}) => { const size = opt.size || 11, y0 = doc.y;
      parts.forEach((p, i) => { const [t, b] = Array.isArray(p) ? p : [p, false], last = i === parts.length - 1;
        doc.font(b ? 'B' : 'R').fontSize(size).fillColor('#000');
        if (i === 0) doc.text(t, LEFT, y0, { width: W, align: opt.align || 'left', lineGap: 2, continued: !last });
        else doc.text(t, { width: W, align: opt.align || 'left', lineGap: 2, continued: !last }); }); gap(opt.after ?? 9); };

    // Right-aligned "Label: value" line (bold label), placed by measured width so the two runs never overlap.
    const RT = (label, value, after) => { doc.fontSize(11); const lw = doc.font('B').widthOfString(label), vw = doc.font('R').widthOfString(value), x = LEFT + W - lw - vw, y = doc.y;
      doc.font('B').fillColor('#000').text(label, x, y, { lineBreak: false }); doc.font('R').text(value, x + lw, y, { lineBreak: false }); doc.x = LEFT; doc.y = y + 15 + after; };
    const role = `${o.course} Intern`;
    P([['OFFER LETTER', true]], { align: 'center', size: 14, after: 6 });
    RT('Date: ', fmtDate(o.enrolledAt), 0);
    RT('Ref No: ', offerId(o.enrollmentId), 12);

    P([['To:', true]], { after: 0 });
    P([[o.name, true]], { after: 0 });
    P([o.email], { after: 0 });
    P([o.phone || ''], { after: 12 });

    P([[`Subject: Offer of Internship – ${role}`, true]], { after: 12 });
    P([`Dear ${o.name},`], { after: 12 });

    P(['We are pleased to offer you the position of ', [role, true], ' at ', ['Plant Green Inertia Pvt. Ltd.', true], ' under the ', ['Vijayadashami Special Internship and Training Program', true], ', following your successful enrollment on ', [fmtDate(o.enrolledAt), true], '.'], { after: 10 });

    P([['Internship Track: ', true], o.course], { after: 0 });
    if (o.duration) P([['Duration: ', true], o.duration], { after: 0 });
    P([['Enrollment Reference: ', true], String(o.enrollmentId)], { after: 0 });
    P([['Transaction Reference: ', true], String(o.transactionRef || '-')], { after: 0 });
    P([['Program Fee: ', true], o.kind === 'free' ? 'Fully sponsored (100% scholarship)' : `${formatINR(o.amountPaise)} paid`], { after: 10 });

    P(['Further details regarding your schedule, mode of training and course access will be shared by the program team on your registered email address and mobile number.'], { after: 10 });
    P(['You are expected to maintain professional conduct and comply with all company policies, confidentiality requirements, and ethical standards throughout your internship. We are pleased to welcome you to Plant Green Inertia Pvt. Ltd. and look forward to your valuable participation in the program.'], { after: 8 });
    P(['Kindly confirm your acceptance of this offer by signing below and returning a copy of this letter.'], { after: 6 });

    need(76);
    P([['Warm Regards,', true]], { after: 0 });
    P([['Plant Green Inertia Pvt. Ltd.', true]], { after: 30 });
    doc.lineWidth(0.6).strokeColor('#000').moveTo(LEFT, doc.y).lineTo(LEFT + 170, doc.y).stroke(); gap(5);
    P([['Authorized Signatory', true]], { after: 16 });

    need(120);
    P([['Acceptance of Offer', true]], { after: 6 });
    P(['I, ', [o.name, true], `, hereby accept the offer of internship as `, [role, true], ' and agree to the terms and conditions stated in this letter.'], { after: 22 });
    P([['Signature: ', true], '______________________________'], { after: 12 });
    P([['Date: ', true], '______________________________'], { after: 0 });
    doc.end();
  });
}