import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Offer letter rendered strictly as 1 crisp LETTER page matching public/static/pdf/offer_letter_template_filled.pdf
const D = path.dirname(fileURLToPath(import.meta.url));
const A = f => path.join(D, 'assets', f);
const LEFT = 63;
const W = 612 - 2 * LEFT; // 486pt printable width matching reference PDF
const TOP = 122;

export const offerId = id => 'PGI-OL-' + String(id || 'W26').replace(/-/g, '').slice(0, 8).toUpperCase();

function fmtOfferDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  }).format(safe);
}

// o = { name, address, email, phone, domain, course, mode, duration, enrollmentId, enrolledAt }
export function buildOfferPDF(o) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: TOP, bottom: 56, left: LEFT, right: LEFT },
      info: {
        Title: `Offer Letter - ${o.name || 'Candidate'}`,
        Author: 'Plant Green Inertia Pvt. Ltd.'
      }
    });
    const bufs = [];
    doc.on('data', b => bufs.push(b));
    doc.on('end', () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);

    // Company Letterhead Header & Footer matching offer_letter_template_filled.pdf
    doc.image(A('header.png'), 0, 0, { width: 612 });
    doc.image(A('footer.png'), 0, 792 - (612 * 111) / 1700 - 10, { width: 612 });

    const candidateName = String(o.name || 'Candidate').trim();
    const candidateAddress = String(o.address || '').trim() || [o.email, o.phone].filter(Boolean).join(' · ') || 'Address on File';
    const domain = String(o.domain || o.course || 'Full-Stack Web Development').trim();
    const mode = String(o.mode || 'Online').trim();
    const duration = String(o.duration || '30 hours').trim();
    const dateStr = fmtOfferDate(o.enrolledAt);

    doc.x = LEFT;
    doc.y = TOP;

    // Title & Right-aligned Date
    doc.font('Helvetica').fontSize(12).fillColor('#111827')
      .text('OFFER LETTER', LEFT, TOP, { width: W, align: 'center' });

    doc.y = 148;
    doc.font('Helvetica').fontSize(10.5).fillColor('#111827')
      .text(`Date: ${dateStr}`, LEFT, doc.y, { width: W, align: 'right' });

    // Recipient Block (To: Name + Address from apply form)
    doc.y = 172;
    doc.font('Helvetica').fontSize(10.5).fillColor('#111827')
      .text('To:', LEFT, doc.y, { width: W })
      .text(candidateName, { width: W })
      .text(candidateAddress, { width: W, lineGap: 2 });

    doc.moveDown(0.75);

    // Subject & Greeting
    doc.font('Helvetica').fontSize(10.5).fillColor('#111827')
      .text(`Subject: Offer of Employment – ${domain}`, { width: W });
    doc.moveDown(0.65);

    doc.font('Helvetica').fontSize(10.5).fillColor('#111827')
      .text(`Dear ${candidateName},`, { width: W });
    doc.moveDown(0.65);

    doc.font('Helvetica').fontSize(10.5).fillColor('#111827')
      .text(`We are pleased to offer you the position of ${domain} at Plant Green Inertia Pvt. Ltd.`, { width: W, lineGap: 2 });
    doc.moveDown(0.8);

    // Terms & Conditions
    doc.font('Helvetica').fontSize(10.5).fillColor('#111827')
      .text('The terms and conditions of your employment are as follows:', { width: W });
    doc.moveDown(0.65);

    const writeTerm = (label, val) => {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#111827')
        .text(`${label}: `, LEFT, doc.y, { width: W, continued: true, lineGap: 2 });
      doc.font('Helvetica').text(val, { width: W, lineGap: 2 });
      doc.moveDown(0.32);
    };

    writeTerm('Internship Duration', duration);
    writeTerm('Mode', mode);
    writeTerm('Work Location', 'Plant Green Inertia Pvt. Ltd., No.4, 1st Floor, Alapakkam Main Road, Maduravoyal, Chennai - 600095');
    writeTerm('Working Days', 'Monday to Saturday');

    doc.moveDown(0.45);

    // Compliance & Welcome Statement
    doc.font('Helvetica').fontSize(10.5).fillColor('#111827')
      .text(
        'You are expected to maintain professional conduct and comply with all company policies, confidentiality requirements, and ethical standards throughout your employment. We are pleased to welcome you to Plant Green Inertia Pvt. Ltd. and look forward to your valuable contributions to our organization.',
        { width: W, lineGap: 2 }
      );
    doc.moveDown(0.6);

    doc.font('Helvetica').fontSize(10.5).fillColor('#111827')
      .text('Kindly confirm your acceptance of this offer by signing below and returning a copy of this letter.', { width: W, lineGap: 2 });
    doc.moveDown(0.5);

    doc.font('Helvetica').fontSize(10.5).fillColor('#111827')
      .text('Warm Regards,', { width: W })
      .text('Plant Green Inertia Pvt. Ltd.', { width: W });

    // Authorized Signatory Line
    doc.moveDown(1.3);
    const sigLineY = doc.y;
    doc.lineWidth(0.75).strokeColor('#475569').moveTo(LEFT, sigLineY).lineTo(612 - LEFT, sigLineY).stroke();
    doc.y = sigLineY + 5;
    doc.font('Helvetica').fontSize(10).fillColor('#111827')
      .text('Authorized Signatory', LEFT, doc.y, { width: W });

    // Candidate Acceptance Section
    doc.moveDown(1.2);
    doc.font('Helvetica').fontSize(10.5).fillColor('#111827')
      .text('Acceptance of Offer', { width: W });
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(10.5).fillColor('#111827')
      .text(
        `I, ${candidateName}, hereby accept the offer of employment as ${domain} and agree to the terms and conditions stated in this letter.`,
        { width: W, lineGap: 2 }
      );

    doc.moveDown(1.0);
    const accY = doc.y;
    doc.font('Helvetica').fontSize(10.5).fillColor('#111827').text('Signature:', LEFT, accY);
    doc.lineWidth(0.75).strokeColor('#475569').moveTo(LEFT + 56, accY + 12).lineTo(LEFT + 236, accY + 12).stroke();

    doc.end();
  });
}