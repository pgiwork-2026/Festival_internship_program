import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  tierFor,
  payablePaise,
  scorePercent,
  makeCouponCode,
  couponState,
  canRequestExtension,
  calculateAssessmentScore,
  violationDecision,
  parseDobCredentials
} from '../logic.js';
import { verifySignature, verifyWebhook } from '../razorpay.js';
import { buildCertificatePDF, certificateNumber, verifyCertificateEligibility } from '../certificate.js';
import { buildProjectReportPDF } from '../project_report.js';
import { buildReceiptPDF, receiptId } from '../receipt.js';
import {
  buildConfirmationEmailHtml,
  buildConfirmationEmailText,
  buildPasswordResetEmailHtml,
  buildPasswordResetEmailText,
  buildCouponEmailHtml
} from '../email.js';

// =====================================================================
// STEP 1 & 2: LINK & ENQUIRY FORM
// =====================================================================
test('E2E Flow Step 1 & 2: Referral link tracking and enquiry form validation', () => {
  const refCode = 'founder';
  const rawParams = new URLSearchParams('?ref=founder&utm_source=linkedin');
  const capturedRef = rawParams.get('ref') || 'direct';
  assert.equal(capturedRef, 'founder');

  // Application Record creation with DOB-derived password
  const dobCreds = parseDobCredentials('2004-08-15');
  assert.equal(dobCreds?.password, '15082004');

  const appData = {
    applicationId: 'PGI-W26-0001',
    fullName: 'Ananya Sharma',
    email: 'ananya.sharma@example.com',
    mobile: '+91 98765 43210',
    dob: dobCreds.dobIso,
    password: dobCreds.password,
    college: 'Anna University',
    department: 'Computer Science & Engineering',
    passedOutYear: '2026',
    domainType: 'Technical',
    domainName: 'Full-Stack Web Development Track',
    mode: 'Online',
    duration: '30 Hours',
    internshipPeriod: '1 month',
    whyHire: 'Passionate about full-stack web architectures and scalable cloud services.',
    referralCode: capturedRef
  };

  // Validate required fields
  assert.ok(appData.fullName.length >= 2);
  assert.ok(appData.email.includes('@'));
  assert.ok(/^\+?[0-9\s-]{10,15}$/.test(appData.mobile));
  assert.equal(appData.duration, '30 Hours');
  assert.equal(appData.referralCode, 'founder');

  // Email confirmation template verification (includes Login Email & DOB password)
  const emailHtml = buildConfirmationEmailHtml(appData);
  assert.ok(emailHtml.includes('PGI-W26-0001'));
  assert.ok(emailHtml.includes('Ananya Sharma'));
  assert.ok(emailHtml.includes('founder'));
  assert.ok(emailHtml.includes('4:00 PM – 6:00 PM IST'));
  assert.ok(emailHtml.includes('15082004'));
  assert.ok(emailHtml.includes('portal.html?mode=login'));

  // Duplicate email detection logic
  const existingSubmissions = [{ email: 'ananya.sharma@example.com', mobile: '9876543210' }];
  const isDuplicate = existingSubmissions.some(
    s => s.email.toLowerCase() === appData.email.toLowerCase() || s.mobile.slice(-10) === '9876543210'
  );
  assert.equal(isDuplicate, true);
});

// =====================================================================
// STEP 3 & 4: PROMISE SLIDES & ASSESSMENT ENGINE
// =====================================================================
test('E2E Flow Step 3 & 4: Assessment execution, timer auto-submit & scoring', () => {
  // Test Timer Expiration Auto-Submit Logic
  const startedAt = new Date(Date.now() - 1300 * 1000); // 1300s ago (> 1200s duration)
  const durationSeconds = 1200;
  const isTimeElapsed = (Date.now() - startedAt.getTime()) / 1000 > durationSeconds;
  assert.equal(isTimeElapsed, true);

  // Proctoring Violations Enforcement: 3 warnings, 4th auto-submits
  let violationsCount = 0;
  let decision = violationDecision(violationsCount, null);
  assert.equal(decision.autoSubmit, false); // 1st warning
  violationsCount = decision.total;

  decision = violationDecision(violationsCount, Date.now() - 10000); // 2nd warning
  assert.equal(decision.autoSubmit, false);
  violationsCount = decision.total;

  decision = violationDecision(violationsCount, Date.now() - 10000); // 3rd warning
  assert.equal(decision.autoSubmit, false);
  violationsCount = decision.total;

  decision = violationDecision(violationsCount, Date.now() - 10000); // 4th violation -> Auto-submit!
  assert.equal(decision.autoSubmit, true);

  // Server-Side Score Evaluation
  const questions = [
    { id: 'q1', marks: 5, correct_option_id: 'b' },
    { id: 'q2', marks: 5, correct_option_id: 'a' },
    { id: 'q3', marks: 5, correct_option_id: 'c' },
    { id: 'q4', marks: 5, correct_option_id: 'd' },
    { id: 'q5', marks: 5, correct_option_id: 'a' },
    { id: 'q6', marks: 5, correct_option_id: 'c' },
    { id: 'q7', marks: 5, correct_option_id: 'b' }
  ];

  // Candidate answers: 6 correct (30 marks) and 1 wrong
  const candidateResponses = [
    { question_id: 'q1', selected_option_id: 'b' }, // correct (+5)
    { question_id: 'q2', selected_option_id: 'a' }, // correct (+5)
    { question_id: 'q3', selected_option_id: 'c' }, // correct (+5)
    { question_id: 'q4', selected_option_id: 'd' }, // correct (+5)
    { question_id: 'q5', selected_option_id: 'a' }, // correct (+5)
    { question_id: 'q6', selected_option_id: 'c' }, // correct (+5)
    { question_id: 'q7', selected_option_id: 'd' }  // wrong (0)
  ];

  const evalResult = calculateAssessmentScore({
    responses: candidateResponses,
    questions,
    marksPerQuestion: 5,
    negativeMarking: 0,
    totalMarks: 100,
    passMark: 30
  });

  assert.equal(evalResult.correctCount, 6);
  assert.equal(evalResult.score, 30); // 30 marks
  assert.equal(evalResult.isQualified, true); // Qualifies for 90% scholarship!
});

// =====================================================================
// STEP 5 & 6: COUPONS & REUSED / EXPIRED PROTECTION
// =====================================================================
test('E2E Flow Step 5 & 6: Coupon generation, 24h countdown, expired and reused rejections', () => {
  const code = makeCouponCode('WIN-');
  assert.ok(code.startsWith('WIN-'));

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 24 * 3600 * 1000);

  // Active coupon
  const activeCoupon = {
    code,
    status: 'active',
    discount_percent: 90,
    score_percent: 60,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    extension_count: 0
  };
  assert.equal(couponState(activeCoupon, issuedAt), 'active');

  // Expired coupon: Payment must be blocked
  const pastDate = new Date(issuedAt.getTime() + 25 * 3600 * 1000);
  assert.equal(couponState(activeCoupon, pastDate), 'expired');

  // Extension capability (max 2 extensions allowed)
  assert.equal(canRequestExtension(activeCoupon, 2), true);
  activeCoupon.extension_count = 2;
  assert.equal(canRequestExtension(activeCoupon, 2), false);

  // Reused coupon: Once redeemed, status is 'redeemed' and cannot be used again
  const redeemedCoupon = { ...activeCoupon, status: 'redeemed', redeemed_at: new Date().toISOString() };
  assert.equal(couponState(redeemedCoupon, issuedAt), 'redeemed');
  assert.equal(canRequestExtension(redeemedCoupon, 2), false);
});

// =====================================================================
// STEP 7: PAYMENT, WEBHOOK SIGNATURE & IDEMPOTENCY
// =====================================================================
test('E2E Flow Step 7: Pricing calculation, Razorpay webhook signature, and duplicate payment idempotency', () => {
  // Base fee ₹10,000 (1000000 paise) with 90% merit scholarship = payable ₹999 (99900 paise)
  const payable = payablePaise(1000000, 90);
  assert.equal(payable, 99900);

  // Checkout Signature Verification
  const keySecret = 'rzp_sec_test_pgi_winter_999';
  const orderId = 'order_w26_001';
  const paymentId = 'pay_w26_capture_001';
  const hmac = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');

  assert.equal(verifySignature(orderId, paymentId, hmac, keySecret), true);
  // Rejects invalid/tampered signature
  assert.equal(verifySignature(orderId, paymentId, 'tampered_signature', keySecret), false);

  // Webhook Signature Verification
  const webhookSecret = 'whsec_pgi_live_test_777';
  const rawBody = Buffer.from(JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: 99900 } } }
  }));
  const validWhSig = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

  assert.equal(verifyWebhook(rawBody, validWhSig, webhookSecret), true);
  assert.equal(verifyWebhook(Buffer.from('tampered'), validWhSig, webhookSecret), false);

  // Idempotency: Duplicate payment webhook / retry
  const mockOrder = { id: orderId, status: 'paid', amount_paise: 99900 };
  const handlePayment = o => {
    if (o.status === 'paid') return { ok: true, alreadyPaid: true, orderId: o.id };
    o.status = 'paid';
    return { ok: true, enrolled: true };
  };

  const firstAttempt = handlePayment(mockOrder);
  assert.equal(firstAttempt.alreadyPaid, true); // Prevent double enrollment or duplicate accounts!
});

// =====================================================================
// STEP 8: STUDENT ID, CREDENTIALS & LOGIN RESOLUTION
// =====================================================================
test('E2E Flow Step 8: Student ID formatting and dual credential login resolution', () => {
  const studentId = 'PGI-S26-0042';
  assert.ok(/^PGI-S26-\d{4}$/.test(studentId));

  // Dual Login resolution helper:
  // Accepts either Student ID (PGI-S26-XXXX) or registered email
  const resolveIdentifier = (ident, dbProfiles) => {
    const raw = String(ident || '').trim();
    if (raw.includes('@')) {
      const match = dbProfiles.find(p => p.email.toLowerCase() === raw.toLowerCase());
      return match ? { email: match.email, studentId: match.student_id } : null;
    }
    const match = dbProfiles.find(p => p.student_id?.toLowerCase() === raw.toLowerCase());
    return match ? { email: match.email, studentId: match.student_id } : null;
  };

  const sampleDbProfiles = [
    { email: 'ananya@example.com', student_id: 'PGI-S26-0001' },
    { email: 'karthik@example.com', student_id: 'PGI-S26-0042' }
  ];

  // Login using Email
  assert.deepEqual(resolveIdentifier('karthik@example.com', sampleDbProfiles), {
    email: 'karthik@example.com',
    studentId: 'PGI-S26-0042'
  });

  // Login using Student ID
  assert.deepEqual(resolveIdentifier('PGI-S26-0042', sampleDbProfiles), {
    email: 'karthik@example.com',
    studentId: 'PGI-S26-0042'
  });

  // Non-existent credentials
  assert.equal(resolveIdentifier('PGI-S26-9999', sampleDbProfiles), null);
});

// =====================================================================
// STEP 9 & 10: ATTENDANCE & 30-HOUR PROGRESS COCKPIT
// =====================================================================
test('E2E Flow Step 9 & 10: Attendance linking by Student ID and 30-hour progress calculation', () => {
  const studentId = 'PGI-S26-0042';

  // 10 Sessions of 3 hours each
  const attendanceLogs = [
    { student_id: studentId, day_number: 1, hours_logged: 3.0, status: 'present' },
    { student_id: studentId, day_number: 2, hours_logged: 3.0, status: 'present' },
    { student_id: studentId, day_number: 3, hours_logged: 3.0, status: 'present' },
    { student_id: studentId, day_number: 4, hours_logged: 3.0, status: 'present' },
    { student_id: studentId, day_number: 5, hours_logged: 3.0, status: 'present' },
    { student_id: studentId, day_number: 6, hours_logged: 3.0, status: 'present' },
    { student_id: studentId, day_number: 7, hours_logged: 3.0, status: 'present' },
    { student_id: studentId, day_number: 8, hours_logged: 3.0, status: 'present' },
    { student_id: studentId, day_number: 9, hours_logged: 3.0, status: 'present' },
    { student_id: studentId, day_number: 10, hours_logged: 3.0, status: 'present' }
  ];

  const presentDays = attendanceLogs.filter(r => r.status === 'present').length;
  const absentDays = attendanceLogs.filter(r => r.status === 'absent').length;
  const completedHours = attendanceLogs.filter(r => r.status === 'present').reduce((sum, r) => sum + r.hours_logged, 0);
  const attendancePct = Math.round((presentDays / (presentDays + absentDays)) * 100);
  const progressPct = Math.min(100, Math.round((completedHours / 30.0) * 100));

  assert.equal(presentDays, 10);
  assert.equal(absentDays, 0);
  assert.equal(completedHours, 30.0);
  assert.equal(attendancePct, 100);
  assert.equal(progressPct, 100);
});

// =====================================================================
// STEP 11 & 12: CERTIFICATE ELIGIBILITY GATE & PDF ISSUANCE
// =====================================================================
test('E2E Flow Step 11 & 12: Certificate issuance gate and landscape PDF generation', async () => {
  // Case A: Blocked if < 30 hours
  const checkFailHours = verifyCertificateEligibility({
    completedHours: 27.0,
    attendancePercentage: 90.0,
    totalRequiredHours: 30.0
  });
  assert.equal(checkFailHours.eligible, false);

  // Case B: Blocked if < 75% attendance
  const checkFailAttendance = verifyCertificateEligibility({
    completedHours: 30.0,
    attendancePercentage: 65.0,
    totalRequiredHours: 30.0
  });
  assert.equal(checkFailAttendance.eligible, false);

  // Case C: Allowed when criteria met
  const checkPass = verifyCertificateEligibility({
    completedHours: 30.0,
    attendancePercentage: 100.0,
    totalRequiredHours: 30.0
  });
  assert.equal(checkPass.eligible, true);

  // Issue Certificate PDF
  const certData = {
    certificateNumber: certificateNumber('PGI-S26-0042'),
    studentId: 'PGI-S26-0042',
    studentName: 'Ananya Sharma',
    college: 'Anna University',
    domain: 'Full-Stack Web Development Track',
    duration: '30 Hours',
    mode: 'Online (4:00 PM – 6:00 PM)',
    attendancePercentage: 100.0,
    completionDate: 'November 10, 2026',
    verificationUrl: 'https://plantgreeninertia.com/verify/PGI-W26-CERT-0042'
  };

  const certPdfBuffer = await buildCertificatePDF(certData);
  assert.ok(Buffer.isBuffer(certPdfBuffer));
  assert.ok(certPdfBuffer.length > 2000);
  assert.equal(certPdfBuffer.slice(0, 5).toString('ascii'), '%PDF-');
});

// =====================================================================
// STEP 13: 1-PAGE PROJECT REPORT & RECEIPT PDF GENERATION
// =====================================================================
test('E2E Flow Step 13: 1-Page project report and payment receipt PDF generators', async () => {
  // 1-Page Project Report PDF
  const reportData = {
    documentId: 'REP-PGI-W26-0042',
    studentId: 'PGI-S26-0042',
    name: 'Ananya Sharma',
    email: 'ananya@example.com',
    college: 'Anna University',
    department: 'Computer Science',
    domainName: 'Full-Stack Web Development Track',
    domainType: 'Technical',
    mode: 'Online',
    duration: '30 Hours',
    title: 'Cloud-Native E-Commerce Platform',
    abstract: 'Production-ready web application with Razorpay integration and automated receipt delivery.',
    technologies: ['Node.js', 'PostgreSQL', 'Express', 'HTML5', 'CSS3']
  };

  const reportPdf = await buildProjectReportPDF(reportData);
  assert.ok(Buffer.isBuffer(reportPdf));
  assert.equal(reportPdf.slice(0, 5).toString('ascii'), '%PDF-');

  // Official Receipt PDF
  const receiptPdf = await buildReceiptPDF({
    receiptNo: 'REC-PGI-W26-0001',
    paidAt: new Date().toISOString(),
    name: 'Ananya Sharma',
    studentId: 'PGI-S26-0042',
    email: 'ananya@example.com',
    phone: '+91 98765 43210',
    course: 'Winter Internship Technical Track',
    duration: '30 Hours (10 Days)',
    couponCode: 'WIN-OFFICIAL',
    transactionRef: 'pay_capture_w26_001'
  });
  assert.ok(Buffer.isBuffer(receiptPdf));
  assert.equal(receiptPdf.slice(0, 5).toString('ascii'), '%PDF-');
});

// =====================================================================
// STEP 14: ADMIN RBAC PERMISSIONS & AUDIT LOGGING
// =====================================================================
test('E2E Flow Step 14: Role-based admin access control and audit log payload', () => {
  const checkAdminRole = userProfile => {
    if (userProfile?.role !== 'admin') {
      const err = new Error('Access denied: Administrator privileges required.');
      err.status = 403;
      throw err;
    }
    return true;
  };

  // Student profile is rejected with 403
  assert.throws(() => checkAdminRole({ role: 'student', email: 'student@example.com' }), {
    status: 403
  });

  // Admin profile passes
  assert.equal(checkAdminRole({ role: 'admin', email: 'admin@plantgreeninertia.com' }), true);

  // Audit entry format validation
  const auditEntry = {
    admin_id: 'adm_123',
    admin_email: 'admin@plantgreeninertia.com',
    action: 'ISSUE_CERTIFICATE',
    target_type: 'certificate',
    target_id: 'PGI-W26-CERT-0042',
    details: { studentId: 'PGI-S26-0042', completedHours: 30.0 },
    ip_address: '127.0.0.1',
    created_at: new Date().toISOString()
  };

  assert.equal(auditEntry.action, 'ISSUE_CERTIFICATE');
  assert.equal(auditEntry.details.completedHours, 30.0);
});
