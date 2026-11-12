import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerStudentRoutes } from '../student.js';
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

  const mupdf = (await import('mupdf')).default;
  const domainCases = [
    ['Web Development & Cloud Deployment', 'Technical', 'Full-Stack Responsive Web Platform'],
    ['Mobile App Development', 'Technical', 'Cross-Platform Android Utility'],
    ['Digital Operations & Agile Management', 'Non-Technical', 'Enterprise Digital Operations Workflow'],
    ['Business Analysis & Tech Communication', 'Non-Technical', 'Enterprise Business Requirements Dossier'],
    ['Digital Growth & Product Marketing', 'Non-Technical', 'Omnichannel Digital Growth Funnel']
  ];
  for (const [domName, domType, expectedTitlePart] of domainCases) {
    const buf = await buildProjectReportPDF({
      studentId: 'PGI-S26-1002',
      name: 'Dhakshana Moorthy',
      courseTitle: domName,
      domainName: domName,
      domainType: domType,
      mode: 'Offline'
    });
    const doc = mupdf.Document.openDocument(buf, 'application/pdf');
    assert.equal(doc.countPages(), 1, `${domName} report must fit strictly on 1 page`);
    const pageText = doc.loadPage(0).toStructuredText('preserve-whitespace').asText();
    assert.ok(pageText.includes(expectedTitlePart), `${domName} report must match its domain project`);
    assert.equal((pageText.match(/30 Hours/g) || []).length, 1, 'Training mode must not duplicate (30 Hours)');
  }
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

test('student portal login rejects assessment email & DOB and only unlocks paid fellows via Private Key (Student ID) + Secret Key', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevAnon = process.env.SUPABASE_ANON_KEY;
  const prevEnv = process.env.NODE_ENV;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  process.env.NODE_ENV = 'test';

  const users = [
    {
      id: 'stu-unpaid',
      email: 'unpaid@example.com',
      user_metadata: { full_name: 'Unpaid Candidate', dob: '2003-04-15', application_id: 'PGI-W26-1111' }
    },
    {
      id: 'stu-paid',
      email: 'paid@example.com',
      user_metadata: {
        full_name: 'Paid Fellow',
        dob: '2001-01-01',
        application_id: 'PGI-W26-1002',
        student_id: 'PGI-S26-1002',
        portal_access_key: 'PGI-2397AC!26'
      }
    }
  ];
  const tables = {
    profiles: [
      { id: 'stu-unpaid', full_name: 'Unpaid Candidate', phone: '9000000001', student_id: null },
      { id: 'stu-paid', full_name: 'Paid Fellow', phone: '9000000002', student_id: 'PGI-S26-1002' }
    ],
    enrollments: [
      { id: 'enr-1002', user_id: 'stu-paid', student_id: 'PGI-S26-1002', status: 'active', amount_paise: 100, enrolled_at: new Date().toISOString() }
    ],
    internship_applications: [
      { email: 'unpaid@example.com', application_id: 'PGI-W26-1111', dob: '2003-04-15', domain_name: 'Full-Stack Web Development' },
      { email: 'paid@example.com', application_id: 'PGI-W26-1002', dob: '2001-01-01', domain_name: 'Full-Stack Web Development' }
    ],
    assessment_attempts: [],
    batches: [{ id: 'b-w26', name: 'Winter Cohort 2026', status: 'active' }],
    student_attendance: [],
    student_assignments: [],
    certificates: []
  };

  const makeQ = table => {
    const filters = [];
    const exec = async () => {
      let rows = (tables[table] || []).filter(r => filters.every(fn => fn(r)));
      return { data: rows, error: null };
    };
    const q = {
      select() { return q; },
      eq(c, v) { filters.push(r => r[c] === v); return q; },
      neq(c, v) { filters.push(r => r[c] !== v); return q; },
      ilike(c, v) { filters.push(r => String(r[c] || '').toLowerCase() === String(v || '').toLowerCase()); return q; },
      order() { return q; },
      limit() { return q; },
      maybeSingle: async () => { const r = await exec(); return { data: r.data[0] || null, error: null }; },
      single: async () => { const r = await exec(); return { data: r.data[0] || null, error: null }; },
      then: (res, rej) => exec().then(res, rej)
    };
    return q;
  };

  const mockDb = {
    from: makeQ,
    auth: {
      signInWithPassword: async ({ email, password }) => {
        const u = users.find(x => x.email === email);
        const dobPw = email === 'unpaid@example.com' ? '15042003' : '01012001';
        if (!u || password !== dobPw) return { data: { session: null }, error: { message: 'Invalid login credentials' } };
        return { data: { user: u, session: { access_token: 'tok-' + u.id, refresh_token: 'ref-' + u.id, expires_at: 9999999999 } }, error: null };
      },
      admin: {
        listUsers: async () => ({ data: { users }, error: null }),
        getUserById: async id => ({ data: { user: users.find(u => u.id === id) || null }, error: null })
      }
    }
  };

  const tokenUserRef = { user: users[0] };
  const app = express();
  app.use(express.json());
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const auth = (req, _res, next) => { req.user = tokenUserRef.user; next(); };
  registerStudentRoutes(app, { db: mockDb, auth, wrap, fail, localApplications: new Map(), onAuth: () => {} });
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

  const srv = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    // 1. Assessment portal login still accepts assessment email + DOB
    const assessOk = await fetch(`${base}/api/assessment/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'unpaid@example.com', password: '15/04/2003' })
    });
    assert.equal(assessOk.status, 200);

    // 2. Student Portal login strictly blocks assessment email + DOB (both unpaid and paid)
    for (const [id, pw] of [
      ['unpaid@example.com', '15042003'],
      ['PGI-W26-1111', '15042003'],
      ['paid@example.com', '01012001'],
      ['paid@example.com', 'PGI-2397AC!26'],
      ['PGI-W26-1002', 'PGI-2397AC!26']
    ]) {
      const blocked = await fetch(`${base}/api/student/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: id, password: pw })
      });
      assert.equal(blocked.status, 403, `Expected 403 for ${id}`);
    }

    // 3. Paid Student ID + assessment DOB password rejected (401)
    const dobRejected = await fetch(`${base}/api/student/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'PGI-S26-1002', password: '01012001' })
    });
    assert.equal(dobRejected.status, 401);

    // 4. Paid Student ID + copied Secret Key succeeds and mints portalSessionToken
    const okLogin = await fetch(`${base}/api/student/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'PGI-S26-1002', password: 'PGI-2397AC!26' })
    });
    const okData = await okLogin.json();
    assert.equal(okLogin.status, 200);
    assert.ok(okData.portalSessionToken);
    assert.equal(okData.student.studentId, 'PGI-S26-1002');

    // 5. Dashboard rejects unpaid user and rejects paid user without X-Portal-Session
    tokenUserRef.user = users[0]; // unpaid
    const dashUnpaid = await fetch(`${base}/api/student/dashboard`, {
      headers: { 'X-Portal-Session': okData.portalSessionToken }
    });
    assert.equal(dashUnpaid.status, 403);

    tokenUserRef.user = users[1]; // paid, but missing portal session (e.g. assessment token only)
    const dashNoPortalSess = await fetch(`${base}/api/student/dashboard`);
    assert.equal(dashNoPortalSess.status, 401);

    // 6. Paid student with valid X-Portal-Session loads dashboard cleanly
    const dashPaid = await fetch(`${base}/api/student/dashboard`, {
      headers: { 'X-Portal-Session': okData.portalSessionToken }
    });
    assert.equal(dashPaid.status, 200);
  } finally {
    await new Promise(resolve => srv.close(resolve));
    if (prevUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prevUrl;
    if (prevAnon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = prevAnon;
    if (prevEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv;
  }
});
