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

export const reportDocId = (studentId, seq) => seq || ('REP-PGI-W26-' + String(studentId || 'STUDENT').replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase());

/**
 * Builds the complimentary 1-Page Official Internship Project Report PDF.
 * @param {Object} data - Project report data
 * @returns {Promise<Buffer>} PDF Buffer
 */
export function buildProjectReportPDF(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: TOP, bottom: 60, left: LEFT, right: LEFT },
      info: {
        Title: 'Official Internship Project Report - ' + (data.studentId || 'PGI'),
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

    addLetterhead();

    // Document Title & Metadata
    doc.font('B').fontSize(15).fillColor('#101D35').text('OFFICIAL INTERNSHIP PROJECT REPORT', LEFT, TOP, { align: 'center', width: W });
    doc.font('R').fontSize(9).fillColor('#536B82').text('Plant Green Inertia Pvt. Ltd. · Winter Internship Program 2026', { align: 'center', width: W });
    doc.y += 10;

    const repNo = data.reportId || reportDocId(data.studentId);
    const metaY = doc.y;
    doc.rect(LEFT, metaY, W, 38).fillAndStroke('#F5FAFF', '#D8E2EC');

    doc.font('B').fontSize(8.5).fillColor('#101D35').text('DOCUMENT ID:', LEFT + 12, metaY + 7);
    doc.font('B').fontSize(9.5).fillColor('#296934').text(repNo, LEFT + 12, metaY + 20);

    doc.font('B').fontSize(8.5).fillColor('#101D35').text('COMPLETION DATE:', LEFT + 175, metaY + 7);
    doc.font('R').fontSize(9).fillColor('#101D35').text(fmtDate(data.date || new Date()), LEFT + 175, metaY + 20);

    doc.font('B').fontSize(8.5).fillColor('#101D35').text('EVALUATION GRADE:', LEFT + 335, metaY + 7);
    doc.font('B').fontSize(9.5).fillColor('#296934').text('GRADE A (EXEMPLARY) ✓', LEFT + 335, metaY + 20);

    doc.y = metaY + 48;

    // Student & Program Information
    doc.font('B').fontSize(10.5).fillColor('#101D35').text('CANDIDATE & COHORT CREDENTIALS', LEFT, doc.y);
    doc.y += 3;
    doc.moveTo(LEFT, doc.y).lineTo(LEFT + W, doc.y).strokeColor('#296934').lineWidth(1.2).stroke();
    doc.y += 6;

    const rowY1 = doc.y;
    doc.font('B').fontSize(9).fillColor('#536B82').text('Candidate Name:', LEFT, rowY1);
    doc.font('B').fontSize(9).fillColor('#101D35').text(data.name || '-', LEFT + 95, rowY1);

    doc.font('B').fontSize(9).fillColor('#536B82').text('Student ID:', LEFT + 260, rowY1);
    doc.font('B').fontSize(9.5).fillColor('#296934').text(data.studentId || '-', LEFT + 345, rowY1);

    doc.y = rowY1 + 16;
    const rowY2 = doc.y;
    doc.font('B').fontSize(9).fillColor('#536B82').text('Domain Track:', LEFT, rowY2);
    doc.font('R').fontSize(9).fillColor('#101D35').text(data.courseTitle || 'Winter Internship Track', LEFT + 95, rowY2);

    doc.font('B').fontSize(9).fillColor('#536B82').text('Training Mode:', LEFT + 260, rowY2);
    doc.font('R').fontSize(9).fillColor('#101D35').text(`${data.mode || 'Online'} (30 Hours)`, LEFT + 345, rowY2);

    doc.y = rowY2 + 20;

    // Project Details Box
    doc.font('B').fontSize(10.5).fillColor('#101D35').text('CAPSTONE PROJECT DETAILS', LEFT, doc.y);
    doc.y += 3;
    doc.moveTo(LEFT, doc.y).lineTo(LEFT + W, doc.y).strokeColor('#296934').lineWidth(1.2).stroke();
    doc.y += 6;

    const projTitle = data.projectTitle || 'Autonomous Web Infrastructure & Service Delivery Portal';
    doc.font('B').fontSize(9.5).fillColor('#101D35').text('Project Title: ' + projTitle, LEFT, doc.y);
    doc.y += 14;

    doc.font('B').fontSize(9).fillColor('#101D35').text('Executive Abstract:');
    doc.y += 2;
    const abstractText = data.abstract ||
      'This capstone project was conceptualized and engineered during the 30-hour Plant Green Inertia Winter Internship Program. ' +
      'The candidate developed an end-to-end scalable application addressing industrial service architecture, responsive design principles, ' +
      'secure credential verification, and automated workflows. The solution integrates structured databases, robust error boundaries, and modern design tokens.';
    doc.font('R').fontSize(8.5).fillColor('#101D35').text(abstractText, LEFT, doc.y, { width: W, lineGap: 1.5 });
    doc.y += 10;

    // Technical Architecture & Deliverables
    doc.font('B').fontSize(9).fillColor('#101D35').text('Tools & Core Technologies Utilized:');
    doc.y += 2;
    doc.font('R').fontSize(8.5).fillColor('#101D35').text('HTML5 Semantic Standards, CSS3 Custom Properties, Modern JavaScript (ES6+), Git & GitHub Collaborative Workflows, RESTful API Integration, Supabase Backend Services, and Automated Verification.', LEFT, doc.y, { width: W });
    doc.y += 10;

    doc.font('B').fontSize(9).fillColor('#101D35').text('Key Methodologies & Milestones Achieved:');
    doc.y += 3;
    const bullets = [
      'Engineered responsive, accessible user interfaces following corporate brand guidelines and typography hierarchies.',
      'Implemented transactional database schemas with relational data constraints and automated state auditing.',
      'Successfully delivered a verifiable production artifact compliant with 30-hour curriculum specifications.'
    ];
    bullets.forEach(b => {
      doc.font('B').fontSize(8.5).fillColor('#296934').text('• ', LEFT + 8, doc.y, { continued: true });
      doc.font('R').fontSize(8.5).fillColor('#101D35').text(b, { width: W - 14, lineGap: 1 });
      doc.y += 2;
    });

    doc.y += 14;

    // Verification Seal & Signatures
    const sealY = doc.y;
    doc.rect(LEFT, sealY, W, 48).fillAndStroke('#F5FAFF', '#D8E2EC');

    doc.font('B').fontSize(8.5).fillColor('#296934').text('OFFICIAL ACADEMIC VERIFICATION & ENDORSEMENT', LEFT + 12, sealY + 7);
    doc.font('R').fontSize(7.8).fillColor('#536B82').text(
      'This 1-page report is an authentic record of the capstone project completed under mentorship at Plant Green Inertia Pvt. Ltd., ' +
      'Official Training Partner of TN Skills, TNSDC. Validated for institutional academic credit.',
      LEFT + 12, sealY + 19, { width: W - 24, lineGap: 1 }
    );

    doc.end();
  });
}
