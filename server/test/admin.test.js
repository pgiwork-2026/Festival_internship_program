import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCertificatePDF, certificateNumber, verifyCertificateEligibility } from '../certificate.js';

test('certificate eligibility validation: strictly enforces 30 hours and 75% attendance', () => {
  // Case 1: Less than 30 hours completed
  const failHours = verifyCertificateEligibility({
    completedHours: 24.0,
    attendancePercentage: 90.0,
    totalRequiredHours: 30.0
  });
  assert.equal(failHours.eligible, false);
  assert.ok(failHours.reason.includes('completed only 24.0 of 30.0'));

  // Case 2: Attendance percentage below 75%
  const failAttendance = verifyCertificateEligibility({
    completedHours: 30.0,
    attendancePercentage: 70.0,
    totalRequiredHours: 30.0
  });
  assert.equal(failAttendance.eligible, false);
  assert.ok(failAttendance.reason.includes('falls below the mandatory 75.0% threshold'));

  // Case 3: Exactly 30 hours and >= 75% attendance -> ELIGIBLE
  const passExact = verifyCertificateEligibility({
    completedHours: 30.0,
    attendancePercentage: 75.0,
    totalRequiredHours: 30.0
  });
  assert.equal(passExact.eligible, true);
  assert.equal(passExact.reason, undefined);

  // Case 4: 30 hours and 92.5% attendance -> ELIGIBLE
  const passHigh = verifyCertificateEligibility({
    completedHours: 30.0,
    attendancePercentage: 92.5,
    totalRequiredHours: 30.0
  });
  assert.equal(passHigh.eligible, true);

  // Case 5: Completed Offline bypasses 30h/75% portal attendance check -> ELIGIBLE
  const passOffline = verifyCertificateEligibility({
    completedHours: 1.0,
    attendancePercentage: 0,
    totalRequiredHours: 30.0,
    mode: 'Completed Offline (30 Hours)'
  });
  assert.equal(passOffline.eligible, true);
  assert.equal(passOffline.completedOffline, true);
});

test('certificate number formatting', () => {
  assert.equal(certificateNumber('PGI-S26-0001'), 'PGI-W26-CERT-0001');
  assert.equal(certificateNumber('PGI-S26-0042'), 'PGI-W26-CERT-0042');
  assert.equal(certificateNumber('PGI-W26-0999'), 'PGI-W26-CERT-0999');
  assert.equal(certificateNumber(undefined, 7), 'PGI-W26-CERT-0007');
});

test('official sample-model portrait certificate PDF generation', async () => {
  const sampleCert = {
    certificateNumber: 'PGI-W26-CERT-0042',
    studentId: 'PGI-S26-0042',
    studentName: 'Priya Sundaram',
    college: 'PSG College of Technology',
    domain: 'Full-Stack Web Development Track',
    duration: '30 Hours',
    mode: 'Online',
    attendancePercentage: 92.5,
    startDate: '2026-11-12',
    endDate: '2026-11-22',
    completionDate: '22 Nov 2026',
    verificationUrl: 'https://plantgreeninertia.com/verify/PGI-W26-CERT-0042'
  };

  const pdfBuffer = await buildCertificatePDF(sampleCert);
  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 1000);
  assert.equal(pdfBuffer.slice(0, 5).toString('ascii'), '%PDF-');
  const { default: mupdf } = await import('mupdf');
  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  const [, , w, h] = doc.loadPage(0).getBounds();
  assert.ok(h > w, `Expected portrait certificate PDF matching sample model, got ${w}x${h}`);
});

test('analytics referral breakdown calculation', () => {
  const sampleApps = [
    { referral_code: 'founder' },
    { referral_code: 'founder' },
    { referral_code: 'founder' },
    { referral_code: 'college_rep' },
    { referral_code: null },
    { referral_code: '' }
  ];

  const map = {};
  sampleApps.forEach(a => {
    const code = a.referral_code ? a.referral_code.trim().toLowerCase() : 'direct';
    map[code] = (map[code] || 0) + 1;
  });

  assert.equal(map['founder'], 3);
  assert.equal(map['college_rep'], 1);
  assert.equal(map['direct'], 2);
});
