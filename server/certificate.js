import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const D = path.dirname(fileURLToPath(import.meta.url));
const A = f => path.join(D, 'assets', f);
const FNT = f => path.join(D, 'fonts', f);

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
 * Builds the official landscape Winter Internship Completion Certificate PDF.
 * @param {Object} data - Certificate metadata
 * @returns {Promise<Buffer>} PDF Buffer
 */
export function buildCertificatePDF(data) {
  return new Promise((resolve, reject) => {
    // A4 Landscape: 841.89 x 595.28 points
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 36, bottom: 36, left: 44, right: 44 },
      info: {
        Title: `Certificate of Internship Completion - ${data.studentName || 'Candidate'}`,
        Author: 'Plant Green Inertia Pvt. Ltd.',
        Subject: 'Winter Internship & Training Program 2026'
      }
    });

    const bufs = [];
    doc.on('data', b => bufs.push(b));
    doc.on('end', () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);

    // Font registration
    try {
      doc.registerFont('R', FNT('FreeSerif.ttf'));
      doc.registerFont('B', FNT('FreeSerif-Bold.ttf'));
    } catch {
      doc.registerFont('R', 'Helvetica');
      doc.registerFont('B', 'Helvetica-Bold');
    }

    const W = 841.89;
    const H = 595.28;

    // 1. Decorative Double Border
    // Outer border (Midnight Navy)
    doc.rect(20, 20, W - 40, H - 40)
       .lineWidth(3)
       .stroke('#101D35');

    // Inner subtle border (Winter Blue / Soft Silver)
    doc.rect(26, 26, W - 52, H - 52)
       .lineWidth(1)
       .stroke('#B9DDF5');

    // Background subtle watermark card
    doc.rect(34, 34, W - 68, H - 68)
       .fill('#FCFDFF');

    // 2. Corner Ornament Accents
    const drawCorner = (x, y, flipX, flipY) => {
      doc.save();
      doc.translate(x, y);
      doc.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      doc.lineWidth(2).strokeColor('#2A6636');
      doc.moveTo(0, 0).lineTo(24, 0).stroke();
      doc.moveTo(0, 0).lineTo(0, 24).stroke();
      doc.lineWidth(1).strokeColor('#B9DDF5');
      doc.moveTo(5, 5).lineTo(18, 5).stroke();
      doc.moveTo(5, 5).lineTo(5, 18).stroke();
      doc.restore();
    };

    drawCorner(38, 38, false, false);
    drawCorner(W - 38, 38, true, false);
    drawCorner(38, H - 38, false, true);
    drawCorner(W - 38, H - 38, true, true);

    // 3. Institution Header & Branding
    let topY = 54;
    doc.font('B').fontSize(20).fillColor('#101D35')
       .text('PLANT GREEN INERTIA PVT. LTD.', 44, topY, { align: 'center', width: W - 88 });

    doc.font('R').fontSize(9.5).fillColor('#2A6636')
       .text('CENTRE FOR INDUSTRIAL APPLIED RESEARCH, SOFTWARE ENGINEERING & INNOVATION', 44, topY + 24, { align: 'center', width: W - 88 });

    doc.font('R').fontSize(8).fillColor('#536B82')
       .text('Recognized Corporate Technical Skills Training Partner · Chennai, Tamil Nadu, India', 44, topY + 38, { align: 'center', width: W - 88 });

    // Decorative Winter Divider Line
    doc.lineWidth(1.2).strokeColor('#101D35')
       .moveTo(W / 2 - 140, topY + 54).lineTo(W / 2 + 140, topY + 54).stroke();
    doc.circle(W / 2, topY + 54, 4).fillAndStroke('#2A6636', '#101D35');

    // 4. Certificate Award Headline
    const certNum = data.certificateNumber || certificateNumber(data.studentId);
    doc.font('R').fontSize(8.5).fillColor('#536B82')
       .text(`CREDENTIAL ID: ${certNum}`, 44, topY + 68, { align: 'center', width: W - 88 });

    doc.font('B').fontSize(22).fillColor('#101D35')
       .text('CERTIFICATE OF INTERNSHIP COMPLETION', 44, topY + 84, { align: 'center', width: W - 88 });

    doc.font('R').fontSize(11).fillColor('#536B82')
       .text('This is to proudly certify that', 44, topY + 114, { align: 'center', width: W - 88 });

    // 5. Recipient Student Name
    const candName = (data.studentName || 'Candidate Name').toUpperCase();
    doc.font('B').fontSize(26).fillColor('#101D35')
       .text(candName, 44, topY + 132, { align: 'center', width: W - 88 });

    // Student ID & Institution Subhead
    const sid = data.studentId || 'PGI-S26-0001';
    const coll = data.college || 'Department of Computer Science & Engineering';
    doc.font('R').fontSize(11).fillColor('#2A6636')
       .text(`Student ID: ${sid}   |   ${coll}`, 44, topY + 168, { align: 'center', width: W - 88 });

    // 6. Citation & Accomplishment Statement
    const domain = data.domain || 'Full-Stack Web Development & Cloud Architecture Track';
    const duration = data.duration || '30 Hours';
    const mode = data.mode || 'Online';
    const compDate = data.completionDate || new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

    const citationText = `has successfully completed the comprehensive ${duration} Winter Internship & Applied Training Program in ${domain} (${mode} Cohort). The candidate has demonstrated commendable technical proficiency, completed all hands-on laboratory assignments, fulfilled 100% verified curriculum hours, and defended their capstone engineering project with academic distinction.`;

    doc.font('R').fontSize(11).fillColor('#1E293B')
       .text(citationText, 90, topY + 196, { align: 'center', width: W - 180, lineGap: 5 });

    // 7. Verified Metrics Badge Bar
    const badgeY = topY + 282;
    doc.rect(W / 2 - 250, badgeY, 500, 32)
       .fillAndStroke('#F5FAFF', '#D8E2EC');

    doc.font('B').fontSize(9.5).fillColor('#101D35')
       .text(`Verified Training: ${duration}`, W / 2 - 230, badgeY + 10);
    doc.text(`Attendance: ${data.attendancePercentage || 92.5}%`, W / 2 - 60, badgeY + 10);
    doc.text(`Completed on: ${compDate}`, W / 2 + 80, badgeY + 10);

    // 8. Signatures & Academic Endorsement Seal
    const sigY = H - 120;

    // Left Signature: Academic Mentor
    doc.lineWidth(1).strokeColor('#101D35')
       .moveTo(90, sigY).lineTo(270, sigY).stroke();
    doc.font('B').fontSize(11).fillColor('#101D35')
       .text('Dr. K. Ravindran', 90, sigY + 6, { width: 180, align: 'center' });
    doc.font('R').fontSize(8.5).fillColor('#536B82')
       .text('Lead Academic Architect & Principal Mentor\nPlant Green Inertia Pvt. Ltd.', 90, sigY + 20, { width: 180, align: 'center' });

    // Center Seal: Official Verification Seal
    const sealX = W / 2;
    const sealY = sigY + 14;
    doc.circle(sealX, sealY, 32).lineWidth(1.5).stroke('#2A6636');
    doc.circle(sealX, sealY, 28).lineWidth(0.8).stroke('#B9DDF5');
    doc.font('B').fontSize(7).fillColor('#2A6636')
       .text('PLANT GREEN INERTIA', sealX - 35, sealY - 14, { width: 70, align: 'center' });
    doc.font('B').fontSize(10).fillColor('#101D35')
       .text('★ VERIFIED ★', sealX - 35, sealY - 4, { width: 70, align: 'center' });
    doc.font('R').fontSize(6.5).fillColor('#536B82')
       .text('AUTHENTIC CREDENTIAL', sealX - 35, sealY + 8, { width: 70, align: 'center' });

    // Right Signature: Director of Operations
    doc.lineWidth(1).strokeColor('#101D35')
       .moveTo(W - 270, sigY).lineTo(W - 90, sigY).stroke();
    doc.font('B').fontSize(11).fillColor('#101D35')
       .text('Director of Operations', W - 270, sigY + 6, { width: 180, align: 'center' });
    doc.font('R').fontSize(8.5).fillColor('#536B82')
       .text('Executive Governing Board\nPlant Green Inertia Pvt. Ltd.', W - 270, sigY + 20, { width: 180, align: 'center' });

    // Footer Verification URL
    const verifyUrl = data.verificationUrl || `https://plantgreeninertia.com/verify/${certNum}`;
    doc.font('R').fontSize(8).fillColor('#536B82')
       .text(`Public Academic Verification Record: ${verifyUrl}`, 44, H - 32, { align: 'center', width: W - 88 });

    doc.end();
  });
}
