import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const D = path.dirname(fileURLToPath(import.meta.url));
const PUB_IMG = f => path.resolve(D, '..', 'public', 'static', 'images', f);
const FNT = f => path.join(D, 'fonts', f);

function existingAsset(...candidates) {
  for (const name of candidates) {
    const p = PUB_IMG(name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function fmtShortDate(raw, fallback) {
  if (!raw) return fallback;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function drawFivePointStar(doc, cx, cy, outerR, innerR) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  doc.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) doc.lineTo(pts[i][0], pts[i][1]);
  doc.closePath().fill('#b8860b');
}

function drawCornerArc(doc, cornerX, cornerY, sx, sy) {
  // Matches SVG: M 1 59 A 58 58 0 0 1 59 1 and M 9 59 A 50 50 0 0 1 59 9
  const k = 0.5522847498;
  const arc = (r, color, lw) => {
    doc.save();
    doc.translate(cornerX, cornerY);
    doc.scale(sx, sy);
    doc.lineWidth(lw).strokeColor(color);
    doc.moveTo(0, r)
      .bezierCurveTo(0, r * (1 - k), r * (1 - k), 0, r, 0)
      .stroke();
    doc.restore();
  };
  arc(45, '#b8860b', 1.8);
  arc(39, '#296934', 1.1);
}

export const certificateNumber = (studentId, seq) => {
  if (seq) return `PGI-W26-CERT-${String(seq).padStart(4, '0')}`;
  const cleanId = String(studentId || '0001').replace(/\D/g, '').slice(-4).padStart(4, '0');
  return `PGI-W26-CERT-${cleanId}`;
};

/**
 * Validates whether a student meets all completion criteria:
 * 1. Exactly 30 verified training hours completed per attendance logs
 * 2. Minimum 75% attendance ratio
 * 
 * @param {Object} stats
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function verifyCertificateEligibility(stats = {}) {
  const modeStr = String(stats.mode || '').toLowerCase();
  if (stats.completedOffline === true || modeStr.includes('completed offline')) {
    return { eligible: true, completedOffline: true };
  }

  const completedHours = Number(stats.completedHours || 0);
  const attendancePct = Number(stats.attendancePercentage || 0);
  const requiredHours = Number(stats.totalRequiredHours || 30.0);

  if (completedHours < requiredHours) {
    return {
      eligible: false,
      reason: `Certificate criteria not met: Candidate has completed only ${completedHours.toFixed(1)} of ${requiredHours.toFixed(1)} mandatory training hours.`
    };
  }

  if (attendancePct < 75.0) {
    return {
      eligible: false,
      reason: `Certificate criteria not met: Attendance is ${attendancePct.toFixed(1)}%, which falls below the mandatory 75.0% threshold.`
    };
  }

  return { eligible: true };
}

/**
 * Builds the official portrait Winter Internship Completion Certificate PDF
 * matching the Gold-Bordered Sample Certificate model.
 * @param {Object} data - Certificate metadata
 * @returns {Promise<Buffer>} PDF Buffer
 */
export function buildCertificatePDF(data = {}) {
  return new Promise((resolve, reject) => {
    // A4 Portrait (1 : 1.414): 595.28 x 841.89 points
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margins: { top: 36, bottom: 36, left: 36, right: 36 },
      info: {
        Title: `Certificate of Internship - ${data.studentName || 'Candidate'}`,
        Author: 'Plant Green Inertia Pvt. Ltd.',
        Subject: 'Winter Internship & Training Program 2026'
      }
    });

    const bufs = [];
    doc.on('data', b => bufs.push(b));
    doc.on('end', () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);

    try {
      doc.registerFont('R', FNT('FreeSerif.ttf'));
      doc.registerFont('B', FNT('FreeSerif-Bold.ttf'));
    } catch {
      doc.registerFont('R', 'Helvetica');
      doc.registerFont('B', 'Helvetica-Bold');
    }

    const W = 595.28;
    const H = 841.89;

    // 1. Gold outer ribbon border (matching linear-gradient 135deg #e0bf55 -> #b8860b -> #d9b44a)
    const goldGrad = doc.linearGradient(0, 0, W, H);
    goldGrad.stop(0, '#e0bf55').stop(0.5, '#b8860b').stop(1, '#d9b44a');
    doc.rect(0, 0, W, H).fill(goldGrad);

    // Crisp white inner canvas inside gold frame
    const frameInset = 50;
    doc.rect(frameInset, frameInset, W - frameInset * 2, H - frameInset * 2).fill('#ffffff');

    // Inner forest-green border (.cert-b1) + gold hairline (.cert-b2)
    doc.rect(frameInset, frameInset, W - frameInset * 2, H - frameInset * 2)
      .lineWidth(3)
      .stroke('#296934');

    doc.rect(frameInset + 7, frameInset + 7, W - (frameInset + 7) * 2, H - (frameInset + 7) * 2)
      .lineWidth(1.6)
      .stroke('#d4a82a');

    // 4 curved corner ornaments (.cc tl, tr, bl, br)
    const cornerOff = frameInset + 11;
    drawCornerArc(doc, cornerOff, cornerOff, 1, 1);
    drawCornerArc(doc, W - cornerOff, cornerOff, -1, 1);
    drawCornerArc(doc, cornerOff, H - cornerOff, 1, -1);
    drawCornerArc(doc, W - cornerOff, H - cornerOff, -1, -1);

    // 2. Five stars row at top (.cert-stars)
    const starsY = 92;
    const starOffsets = [-82, -43, 0, 43, 82];
    starOffsets.forEach((dx, idx) => {
      const isCenter = idx === 2;
      drawFivePointStar(doc, W / 2 + dx, starsY, isCenter ? 13 : 6.8, isCenter ? 5.2 : 2.8);
    });

    // 3. Company Logo (.cert-logo)
    const logoPath = existingAsset('Plant Green Inertia Logo.png', 'pgi-logo-sq.png', 'pgi-logo.jpg');
    if (logoPath) {
      try {
        doc.image(logoPath, W / 2 - 33, 114, { fit: [66, 62], align: 'center', valign: 'center' });
      } catch {}
    }

    const innerLeft = 82;
    const innerWidth = W - innerLeft * 2;

    // 4. Headline ("Certificate of Internship")
    doc.font('B').fontSize(40).fillColor('#101D35')
      .text('Certificate', innerLeft, 194, { align: 'center', width: innerWidth });
    doc.font('B').fontSize(40).fillColor('#101D35')
      .text('of Internship', innerLeft, 236, { align: 'center', width: innerWidth });

    // 5. Subtitle ("THIS CERTIFICATE IS GIVEN TO")
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#b8860b')
      .text('THIS CERTIFICATE IS GIVEN TO', innerLeft, 298, {
        align: 'center',
        width: innerWidth,
        characterSpacing: 2.2
      });

    // 6. Gold divider with centered diamond (.cert-dv)
    const divY = 328;
    doc.lineWidth(1.5).strokeColor('#b8860b')
      .moveTo(W / 2 - 102, divY).lineTo(W / 2 + 102, divY).stroke();
    doc.save();
    doc.translate(W / 2, divY).rotate(45);
    doc.rect(-4.2, -4.2, 8.4, 8.4).fill('#b8860b');
    doc.restore();

    // 7. Student Name (.cert-name) in Plant Green
    const rawName = String(data.studentName || 'Student Name').trim() || 'Student Name';
    const nameSize = rawName.length > 28 ? 25 : (rawName.length > 20 ? 30 : 36);
    doc.font('B').fontSize(nameSize).fillColor('#296934')
      .text(rawName, innerLeft, 348, { align: 'center', width: innerWidth });

    // 8. Body citation matching sample model text
    const domainClean = String(data.domain || '').trim();
    const showDomain = domainClean && !/winter internship/i.test(domainClean);
    const bodyCopy = showDomain
      ? `has successfully completed the Winter Internship and Training Program (${domainClean}) during the student-mentioned dates with Plant Green Inertia. We appreciate their dedication and wish them success in all future endeavours.`
      : 'has successfully completed the Winter Internship and Training Program during the student-mentioned dates with Plant Green Inertia. We appreciate their dedication and wish them success in all future endeavours.';

    doc.font('R').fontSize(13).fillColor('#334155')
      .text(bodyCopy, innerLeft + 26, 412, {
        align: 'center',
        width: innerWidth - 52,
        lineGap: 5
      });

    // 9. Certificate No, From Date, To Date row (.cert-row)
    const certNum = data.certificateNumber || certificateNumber(data.studentId);
    const compDate = data.completionDate || fmtShortDate(new Date(), '2026');
    const fromLabel = fmtShortDate(data.startDate || data.fromDate, compDate);
    const toLabel = fmtShortDate(data.endDate || data.toDate || data.completionDate, compDate);

    const rowTopY = 582;
    doc.lineWidth(1.1).strokeColor('#e2e8f0')
      .moveTo(innerLeft, rowTopY).lineTo(W - innerLeft, rowTopY).stroke();

    const colW = innerWidth / 3;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#101D35')
      .text(`Certificate No: ${certNum}`, innerLeft, rowTopY + 12, { width: colW + 46, align: 'left' })
      .text(`From: ${fromLabel}`, innerLeft + colW + 18, rowTopY + 12, { width: colW - 12, align: 'center' })
      .text(`To: ${toLabel}`, innerLeft + colW * 2, rowTopY + 12, { width: colW, align: 'right' });

    // 10. Footer: Centered Gold Stamp Seal + Right Founder Signature (.cert-foot)
    const sealX = W / 2;
    const sealY = 678;
    doc.circle(sealX, sealY, 41).fill('#e0bf55');
    doc.circle(sealX, sealY, 36).fill('#b8860b');
    doc.circle(sealX, sealY, 33).lineWidth(1.4).stroke('#fff3c4');
    doc.font('Helvetica-Bold').fontSize(8.2).fillColor('#ffffff')
      .text('PLANT\nGREEN\nINERTIA', sealX - 30, sealY - 14.5, { width: 60, align: 'center', lineGap: 1.5 });

    // Right signature block
    const sigBoxW = 148;
    const sigLeft = W - innerLeft - sigBoxW;
    const sigImg = existingAsset('founder-signature.png');
    if (sigImg) {
      try {
        doc.image(sigImg, sigLeft + 10, 632, { fit: [sigBoxW - 20, 42], align: 'center', valign: 'bottom' });
      } catch {}
    }
    doc.lineWidth(1.2).strokeColor('#e0bf55')
      .moveTo(sigLeft, 678).lineTo(sigLeft + sigBoxW, 678).stroke();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#101D35')
      .text('Founder', sigLeft, 685, { width: sigBoxW, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748b')
      .text('Plant Green Inertia', sigLeft, 700, { width: sigBoxW, align: 'center' });

    doc.end();
  });
}
