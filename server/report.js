import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_WARNINGS, VIOLATION_LABELS, STATUS_TEXT, formatINR } from './logic.js';

const D = path.dirname(fileURLToPath(import.meta.url)), A = f => path.join(D, 'assets', f), FNT = f => path.join(D, 'fonts', f);
const GREEN = '#2f5d3c', LEFT = 72, W = 612 - 2 * LEFT, BOTTOM = 725; // Letter page, 1" side margins like the template
const IST = { timeZone: 'Asia/Kolkata' };
export const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { ...IST, day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtTime = d => new Date(d).toLocaleTimeString('en-IN', { ...IST, hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const reportId = id => 'PGI-AR-' + String(id).replace(/-/g, '').slice(0, 8).toUpperCase();
const dur = (a, b) => { const s = Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000)); return `${Math.floor(s / 60)} min ${s % 60} sec`; };

// Warning label for each counted violation: Warning 1..3, then "Auto-submitted".
export function violationRows(vs) {
  let n = 0; return vs.map(v => ({ time: fmtTime(v.occurred_at), event: VIOLATION_LABELS[v.type] || v.type,
    action: !v.counted ? 'Duplicate (not counted)' : ++n <= MAX_WARNINGS ? `Warning ${n} of ${MAX_WARNINGS}` : 'Test auto-submitted' }));
}

// r = { profile, email, attempt, coupon, answered, violations }. pub=true omits contact details, coupon and anything private.
export function buildReportPDF(r, pub = false) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 168, bottom: 60, left: LEFT, right: LEFT }, info: { Title: 'Assessment Report - ' + r.profile.full_name, Author: 'Plant Green Inertia Pvt. Ltd.' } });
    const bufs = []; doc.on('data', b => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs))); doc.on('error', reject);
    doc.registerFont('R', FNT('FreeSerif.ttf')); doc.registerFont('B', FNT('FreeSerif-Bold.ttf'));
    const deco = () => { doc.image(A('header.png'), 0, 0, { width: 612 }); doc.image(A('footer.png'), 0, 792 - 612 * 111 / 1700 - 14, { width: 612 }); doc.x = LEFT; doc.y = 168; };
    doc.on('pageAdded', deco); deco();
    const a = r.attempt, c = r.coupon;
    const T = (t, o = {}) => doc.font(o.b ? 'B' : 'R').fontSize(o.size || 11).fillColor('#000').text(t, o.x ?? LEFT, o.y, { width: W, align: o.align || 'left', lineGap: 2, ...o.opts });
    const gap = n => { doc.y += n; };
    const need = h => { if (doc.y + h > BOTTOM) doc.addPage(); };
    const H = t => { need(60); gap(8); T(t, { b: 1, size: 12 }); gap(3); };
    const table = (rows, cols = [0.4, 0.6], head) => { // simple bordered table in the letterhead green
      const ws = cols.map(p => p * W);
      const draw = (cells, bold) => {
        const hs = cells.map((t, i) => doc.font(i === 0 || bold ? 'B' : 'R').fontSize(10.5).heightOfString(String(t), { width: ws[i] - 12 })), h = Math.max(...hs) + 10;
        need(h); const y = doc.y; let x = LEFT;
        cells.forEach((t, i) => { if (bold) doc.rect(x, y, ws[i], h).fill(GREEN); doc.lineWidth(0.6).strokeColor(GREEN).rect(x, y, ws[i], h).stroke();
          doc.font(i === 0 || bold ? 'B' : 'R').fontSize(10.5).fillColor(bold ? '#fff' : '#000').text(String(t), x + 6, y + 5, { width: ws[i] - 12, lineBreak: true }); x += ws[i]; });
        doc.y = y + h; };
      if (head) draw(head, true); rows.forEach(x => draw(x)); gap(6); doc.x = LEFT; };

    T('ASSESSMENT REPORT', { b: 1, size: 13, align: 'center' }); gap(8);
    { const d = fmtDate(new Date()), wl = doc.font('B').fontSize(11).widthOfString('Date: '), wd = doc.font('R').widthOfString(d), x = LEFT + W - wl - wd, y = doc.y;
      doc.font('B').text('Date: ', x, y, { lineBreak: false }); doc.font('R').text(d, x + wl, y, { lineBreak: false }); doc.y = y + 14; doc.x = LEFT; } gap(10);
    if (!pub) { T('To:', { b: 1 }); T(r.profile.full_name, { b: 1 }); T(r.email); if (r.profile.phone) T(r.profile.phone); gap(10); }
    else { T('Candidate: ' + r.profile.full_name, { b: 1 }); gap(10); }
    T('Subject: Scholarship Assessment Report \u2013 Vijayadashami Special Internship and Training Program', { b: 1 }); gap(10);
    if (!pub) { T(`Dear ${r.profile.full_name},`); gap(8); }
    T(`${pub ? 'This report records' : 'Thank you for attending'} the Scholarship Assessment conducted by Plant Green Inertia Pvt. Ltd. as part of the Vijayadashami Special Internship and Training Program. ${pub ? 'The outcome of the assessment is' : 'Please find the report of your assessment'} below.`);

    H('Assessment Summary');
    const wrong = r.answered - a.correct_count;
    table([
      ['Candidate', r.profile.full_name], ['Report ID', reportId(a.id)], ['Assessment date', `${fmtDate(a.started_at)}, ${fmtTime(a.started_at)} IST`],
      ['Time taken', a.submitted_at ? dur(a.started_at, a.submitted_at) : '-'], ['Completion', STATUS_TEXT[a.status] || a.status],
      ['Questions', `${a.total_questions} total: ${r.answered} attempted, ${a.correct_count} correct, ${wrong} incorrect, ${a.total_questions - r.answered} not attempted`],
      ['Final score', `${a.correct_count} / ${a.total_questions}  (${Number(a.score_percent).toFixed(2)}%)`] ]);

    need(230); H('Performance Overview');
    { const y0 = doc.y + 4, cx = LEFT + 70, cy = y0 + 70, R = 50, pct = Math.max(0, Math.min(100, Number(a.score_percent) || 0)), tot = a.total_questions || 1, cnt = Math.min(r.violations.filter(v => v.counted).length, MAX_WARNINGS);
      doc.lineWidth(14).strokeColor('#e3ebe5').circle(cx, cy, R).stroke();
      if (pct > 0) { const n = Math.max(2, Math.ceil(pct * 1.5)); for (let i = 0; i <= n; i++) { const t = -Math.PI / 2 + (pct / 100) * 2 * Math.PI * i / n, x = cx + R * Math.cos(t), y = cy + R * Math.sin(t); i ? doc.lineTo(x, y) : doc.moveTo(x, y); } doc.lineWidth(14).strokeColor(GREEN).stroke(); }
      doc.font('B').fontSize(20).fillColor(GREEN).text(pct.toFixed(0) + '%', cx - 40, cy - 14, { width: 80, align: 'center', lineBreak: false });
      doc.font('R').fontSize(8.5).fillColor('#000').text('FINAL SCORE', cx - 40, cy + 9, { width: 80, align: 'center', lineBreak: false });
      const used = a.submitted_at ? (new Date(a.submitted_at) - new Date(a.started_at)) / 1000 : 0, allot = a.expires_at ? (new Date(a.expires_at) - new Date(a.started_at)) / 1000 : 0, m = s => Math.round(s / 60);
      const rows = [['Correct', a.correct_count, tot, GREEN, `${a.correct_count} / ${tot}`], ['Incorrect', wrong, tot, '#b3402f', `${wrong} / ${tot}`], ['Not attempted', tot - r.answered, tot, '#8a948f', `${tot - r.answered} / ${tot}`]];
      if (allot > 0) rows.push(['Time used', Math.min(used, allot), allot, '#c99a14', `${m(used)} / ${m(allot)} min`]);
      rows.push(['Warnings', cnt, MAX_WARNINGS, '#b3402f', `${cnt} / ${MAX_WARNINGS}`]);
      const bx = LEFT + 160, lw = 90, bw = W - 160 - lw - 62;
      rows.forEach(([l, v, mx, col, txt], i) => { const y = y0 + 8 + i * 28;
        doc.font('B').fontSize(9.5).fillColor('#000').text(l, bx, y, { width: lw, lineBreak: false });
        doc.rect(bx + lw, y, bw, 11).fill('#e3ebe5'); if (v > 0) doc.rect(bx + lw, y, bw * Math.min(1, v / mx), 11).fill(col);
        doc.font('R').fontSize(9.5).fillColor('#000').text(txt, bx + lw + bw + 6, y, { width: 60, lineBreak: false }); });
      doc.x = LEFT; doc.y = y0 + 148; }
    if (c) { H('Scholarship Outcome');
      const rows = [['Scholarship earned', `${c.discount_percent}% off the \u20B99,999 internship fee`]];
      if (!pub) rows.push(['Coupon code', c.code], ['Coupon valid until', `${fmtDate(c.expires_at)}, ${fmtTime(c.expires_at)} IST`], ['Payable course fee', formatINR(c.payable_paise)]);
      table(rows); }

    H('Proctoring Summary');
    const counted = r.violations.filter(v => v.counted).length;
    table([['Warnings issued', `${Math.min(counted, MAX_WARNINGS)} of ${MAX_WARNINGS} allowed`], ['Violations recorded', r.violations.length],
      ['Integrity status', a.status === 'auto_submitted' ? 'Test auto-submitted after the 4th violation' : counted ? 'Completed with warnings' : 'Completed with no violations']]);
    if (r.violations.length) { T('Violation log', { b: 1, size: 11 }); gap(3); table(violationRows(r.violations).map(v => [v.time, v.event, v.action]), [0.2, 0.52, 0.28], ['Time (IST)', 'Event', 'Action']); }

    need(130); gap(4);
    T(a.status === 'auto_submitted' ? 'Your assessment was submitted automatically because the proctoring violation limit was exceeded. Answers saved up to that point were evaluated.' : 'We appreciate your participation and wish you the very best for your internship journey with Plant Green Inertia Pvt. Ltd.');
    gap(14); T('Warm Regards,', { b: 1 }); T('Plant Green Inertia Pvt. Ltd.', { b: 1 }); gap(22); T('Authorized Signatory', { b: 1 }); gap(10);
    T('This is a system-generated report. Scores are calculated on the server; proctoring events are automated flags that may be reviewed by the program team.', { size: 8.5 });
    doc.end();
  });
}