import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectReportPDF } from '../project_report.js';
import { buildPasswordResetEmailHtml, buildPasswordResetEmailText } from '../email.js';

test('password recovery email template rendering', () => {
  const data = {
    name: 'Priya Sundaram',
    studentId: 'PGI-S26-0042',
    email: 'priya.s@example.com',
    resetUrl: 'https://plantgreeninertia.com/login.html?token=test_reset_token_123&email=priya.s%40example.com'
  };

  const html = buildPasswordResetEmailHtml(data);
  assert.ok(html.includes('Priya Sundaram'));
  assert.ok(html.includes('PGI-S26-0042'));
  assert.ok(html.includes('test_reset_token_123'));
  assert.ok(html.includes('Reset My Password'));
  assert.ok(html.includes('1 hour'));

  const text = buildPasswordResetEmailText(data);
  assert.ok(text.includes('Priya Sundaram'));
  assert.ok(text.includes('PGI-S26-0042'));
  assert.ok(text.includes('test_reset_token_123'));
});

test('attendance calculation: present/absent days, percentage, and 30-hour progress', () => {
  const sampleRecords = [
    { day_number: 1, hours_logged: 3.0, status: 'present' },
    { day_number: 2, hours_logged: 3.0, status: 'present' },
    { day_number: 3, hours_logged: 3.0, status: 'present' },
    { day_number: 4, hours_logged: 0.0, status: 'absent' },
    { day_number: 5, hours_logged: 3.0, status: 'present' },
    { day_number: 6, hours_logged: 3.0, status: 'present' },
    { day_number: 7, hours_logged: 3.0, status: 'present' },
    { day_number: 8, hours_logged: 3.0, status: 'present' }
  ];

  const presentDays = sampleRecords.filter(r => r.status === 'present').length;
  const absentDays = sampleRecords.filter(r => r.status === 'absent').length;
  const completedHours = sampleRecords.filter(r => r.status === 'present').reduce((acc, r) => acc + r.hours_logged, 0);
  const totalDays = sampleRecords.length;
  const attendancePct = Math.round((presentDays / (presentDays + absentDays)) * 100);
  const progressPct = Math.min(100, Math.round((completedHours / 30.0) * 100));

  assert.equal(presentDays, 7);
  assert.equal(absentDays, 1);
  assert.equal(totalDays, 8);
  assert.equal(completedHours, 21.0);
  assert.equal(attendancePct, 88); // 7/8 = 87.5% -> 88%
  assert.equal(progressPct, 70); // 21/30 = 70%
  assert.ok(completedHours <= 30.0);
  assert.ok(attendancePct >= 75); // Meets 75% certificate qualification threshold
});

test('1-page project report PDF generation', async () => {
  const sampleReportData = {
    documentId: 'REP-PGI-W26-0042',
    studentId: 'PGI-S26-0042',
    name: 'Priya Sundaram',
    email: 'priya.s@example.com',
    college: 'PSG College of Technology',
    department: 'Information Technology',
    domainName: 'Full-Stack Web Development & Cloud Architecture',
    domainType: 'Technical',
    mode: 'Online (4:00 PM – 6:00 PM)',
    duration: '30 Hours',
    title: 'Cloud-Native E-Commerce & Secure Razorpay Payment Gateway Pipeline',
    mentorName: 'Dr. K. Ravindran, Lead Academic Architect',
    abstract: 'Engineered an end-to-end full-stack web application featuring reactive user interfaces, cryptographic payment verification via Razorpay HMAC-SHA256 signatures, automated PDF receipt dispatch, and production deployment on Render.',
    technologies: ['HTML5', 'CSS3 Flexbox/Grid', 'JavaScript ES6+', 'Node.js Express', 'PostgreSQL RLS', 'Razorpay API', 'Render Cloud'],
    methodologies: ['REST API Microservices Architecture', 'Idempotent Webhook Processing', 'Row-Level Security Sandboxing', 'Lighthouse Accessibility Audit']
  };

  const pdfBuffer = await buildProjectReportPDF(sampleReportData);
  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 1000);
  // Verify PDF header magic bytes "%PDF-"
  assert.equal(pdfBuffer.slice(0, 5).toString('ascii'), '%PDF-');
});

test('student identifier resolution logic: email vs student ID format', () => {
  const isEmail = ident => String(ident || '').includes('@');
  const isStudentId = ident => /^PGI-[S|W]\d{2}-\d{4}$/i.test(String(ident || '').trim());

  assert.equal(isEmail('student@example.com'), true);
  assert.equal(isEmail('PGI-S26-0001'), false);
  assert.equal(isStudentId('PGI-S26-0001'), true);
  assert.equal(isStudentId('pgi-s26-0042'), true);
  assert.equal(isStudentId('PGI-W26-0001'), true);
  assert.equal(isStudentId('student@example.com'), false);
});

test('curriculum structure: 30 hours per track across 10 modules', () => {
  const sampleTrack = {
    id: 'tech-web',
    domainType: 'Technical',
    title: 'Full-Stack Web Development Track',
    duration: '30 Hours (10 Modules)',
    modules: [
      { day: 1, hours: 3, title: 'Web Fundamentals & Semantic HTML5' },
      { day: 2, hours: 3, title: 'Modern CSS3, Flexbox & Grid Systems' },
      { day: 3, hours: 3, title: 'JavaScript ES6+ & Asynchronous Pipelines' },
      { day: 4, hours: 3, title: 'Git & Distributed Version Control' },
      { day: 5, hours: 3, title: 'Node.js & Express API Microservices' },
      { day: 6, hours: 3, title: 'Database Schema & Relational Integrity' },
      { day: 7, hours: 3, title: 'Component Engineering & UI Frameworks' },
      { day: 8, hours: 3, title: 'Payment Gateways & Webhook Security' },
      { day: 9, hours: 3, title: 'Capstone Real-World Project Sprint' },
      { day: 10, hours: 3, title: 'Project Report Defense & Certification' }
    ]
  };

  assert.equal(sampleTrack.modules.length, 10);
  const totalHours = sampleTrack.modules.reduce((sum, m) => sum + m.hours, 0);
  assert.equal(totalHours, 30);
});
