import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildCertificatePDF, certificateNumber, verifyCertificateEligibility } from '../certificate.js';
import { parseYouTubeUrl, sharedRecordedVideos, sharedDeletedVideoIds, SYLLABUS_TRACKS, matchesStudentDomain } from '../logic.js';
import { mountAdmin, enrichBatchesWithEnrollmentCounts } from '../admin.js';
import { registerStudentRoutes } from '../student.js';

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

test('parseYouTubeUrl handles watch, youtu.be, shorts, live, and rejects non-YouTube URLs', () => {
  const w = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12');
  assert.equal(w.videoId, 'dQw4w9WgXcQ');
  assert.equal(w.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');

  const s = parseYouTubeUrl('https://youtu.be/M7lc1UVf-VE?si=abc');
  assert.equal(s.videoId, 'M7lc1UVf-VE');

  const sh = parseYouTubeUrl('https://youtube.com/shorts/aqz-KE-bpKQ');
  assert.equal(sh.videoId, 'aqz-KE-bpKQ');

  const lv = parseYouTubeUrl('https://www.youtube.com/live/5qap5aO4i9A');
  assert.equal(lv.videoId, '5qap5aO4i9A');

  assert.equal(parseYouTubeUrl('https://vimeo.com/123456'), null);
  assert.equal(parseYouTubeUrl('not a url'), null);
});

test('all 13 curriculum tracks match PDF 10-day 30h structure and strict domain video matching', () => {
  assert.equal(SYLLABUS_TRACKS.length, 13);
  for (const t of SYLLABUS_TRACKS) {
    assert.ok(t.overview && t.overview.length > 20, `Expected PDF overview for ${t.title}`);
    assert.ok(Array.isArray(t.toolsCovered) && t.toolsCovered.length >= 3, `Expected toolsCovered for ${t.title}`);
    assert.equal(t.modules.length, 10, `Expected 10 modules for ${t.title}`);
    assert.equal(t.modules.reduce((s, m) => s + m.hours, 0), 30, `Expected 30h for ${t.title}`);
    t.modules.forEach((m, i) => {
      assert.equal(m.day, i + 1, `Expected sequential Day ${i + 1} for ${t.title}`);
      assert.ok(m.title && m.description && m.project, `Expected PDF title, description, project on Day ${m.day} of ${t.title}`);
      assert.ok(Array.isArray(m.topics) && m.topics.length >= 3, `Expected topics on Day ${m.day} of ${t.title}`);
    });
  }
  assert.equal(SYLLABUS_TRACKS.find(t => t.id === 'tech-web')?.modules[0]?.title, 'Introduction to Web Development & HTML');
  assert.equal(SYLLABUS_TRACKS.find(t => t.id === 'nontech-sales')?.modules[9]?.title, 'Sales Mini Project & Review');
  assert.equal(matchesStudentDomain('Marketing', 'Digital Marketing'), false);
  assert.equal(matchesStudentDomain('Digital Marketing', 'Digital Marketing'), true);
  assert.equal(matchesStudentDomain('Python Programming', ''), false);
  assert.equal(matchesStudentDomain('all', 'Python Programming'), false);
});

test('admin recorded video upload via YouTube link publishes strictly to chosen domain and supports deletion', async () => {
  const prevVids = [...sharedRecordedVideos];
  const prevDeleted = new Set(sharedDeletedVideoIds);
  sharedRecordedVideos.length = 0;
  sharedDeletedVideoIds.clear();

  const recordedTable = [];
  const auditLogs = [];
  const makeQuery = (table) => {
    const q = {
      _filters: [], _op: 'select', _payload: null,
      select() { return q; },
      eq(c, v) { q._filters.push(r => r[c] === v); return q; },
      neq() { return q; },
      in() { return q; },
      order() { return q; },
      limit() { return q; },
      insert(p) { q._op = 'insert'; q._payload = p; return q; },
      delete() { q._op = 'delete'; return q; },
      async maybeSingle() { const res = await q._exec(); return { data: res.data?.[0] || null, error: null }; },
      async single() { const res = await q._exec(); return { data: res.data?.[0] || null, error: null }; },
      then(resolve) { return q._exec().then(resolve); },
      async _exec() {
        if (table === 'recorded_videos') {
          if (q._op === 'insert') { recordedTable.unshift(q._payload); return { data: [q._payload], error: null }; }
          if (q._op === 'delete') {
            for (let i = recordedTable.length - 1; i >= 0; i--) {
              if (q._filters.every(fn => fn(recordedTable[i]))) recordedTable.splice(i, 1);
            }
            return { data: [], error: null };
          }
          return { data: [...recordedTable], error: null };
        }
        if (table === 'admin_audit_logs' && q._op === 'insert') { auditLogs.push(q._payload); return { data: [q._payload], error: null }; }
        if (table === 'profiles') return { data: [{ id: 'admin-1', role: 'admin', full_name: 'Admin' }], error: null };
        if (table === 'internship_applications') return { data: [{ email: 'stu@test.edu', domain_name: 'Python Programming', mode: 'Online' }], error: null };
        return { data: [], error: null };
      }
    };
    return q;
  };
  const fakeDb = { from: makeQuery, auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } } };

  const app = express();
  app.use(express.json());
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const wrap = f => (req, res, next) => f(req, res, next).catch(e => res.status(e.status || 400).json({ error: e.message }));
  const auth = (req, _res, next) => { req.user = { id: 'admin-1', email: 'stu@test.edu', user_metadata: {} }; next(); };
  mountAdmin({ app, db: fakeDb, auth, wrap, fail, reportData: async () => ({}), sendPdf: () => {}, buildReportPDF: async () => Buffer.alloc(0), reportId: () => 'R1' });
  registerStudentRoutes(app, { db: fakeDb, auth, wrap, fail, localApplications: new Map(), onAuth: () => {} });

  const srv = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const bad = await fetch(`${base}/api/admin/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bad Link', youtubeUrl: 'https://example.com/video.mp4', track: 'Python Programming' })
    });
    assert.equal(bad.status, 400);

    const badAll = await fetch(`${base}/api/admin/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No Domain', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', track: 'all' })
    });
    assert.equal(badAll.status, 400);

    const addPy = await (await fetch(`${base}/api/admin/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Python Functions Workshop',
        youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
        track: 'Python Programming',
        mode: 'Online',
        sessionNumber: 'Module 02',
        duration: '45 mins'
      })
    })).json();
    assert.equal(addPy.ok, true);
    assert.equal(addPy.video.youtube_id, 'dQw4w9WgXcQ');

    await fetch(`${base}/api/admin/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Marketing Only Lecture',
        youtubeUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
        track: 'Digital Marketing',
        mode: 'Online'
      })
    });

    const adminList = await (await fetch(`${base}/api/admin/videos`)).json();
    assert.equal(adminList.length, 2);

    const mat = await (await fetch(`${base}/api/student/materials`)).json();
    assert.equal(mat.recordings.length, 1);
    assert.equal(mat.recordings[0].title, 'Python Functions Workshop');
    assert.equal(mat.recordings[0].embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');

    const del = await (await fetch(`${base}/api/admin/videos/${encodeURIComponent(addPy.video.id)}`, { method: 'DELETE' })).json();
    assert.equal(del.ok, true);
    assert.equal((await (await fetch(`${base}/api/admin/videos`)).json()).length, 1);
  } finally {
    srv.close();
    sharedRecordedVideos.length = 0;
    sharedRecordedVideos.push(...prevVids);
    sharedDeletedVideoIds.clear();
    prevDeleted.forEach(x => sharedDeletedVideoIds.add(x));
  }
});

test('batch enrollment counts aggregate real enrollments and exclude test/cancelled rows', async () => {
  const batches = [
    { id: 'b-vj', name: 'Vijayadashami', slug: 'vijayadashami', seats_limit: 60, enrolled_count: 0 },
    { id: 'b-dw', name: 'Diwali', slug: 'diwali', seats_limit: 60, enrolled_count: 0 },
    { id: 'b-wi', name: 'Winter Internship 2026', slug: 'winter-2026', seats_limit: 60, enrolled_count: 0 }
  ];
  const enrollments = [
    { id: 'e1', user_id: 'u1', batch_id: 'b-vj', status: 'active', is_test: false, amount_paise: 99900 },
    { id: 'e2', user_id: 'u2', batch_id: 'b-vj', status: 'active', is_test: false, amount_paise: 119900 },
    { id: 'e2-dup', user_id: 'u2', batch_id: 'b-vj', status: 'active', is_test: false, amount_paise: 119900 },
    { id: 'e3', user_id: 'u3', batch_id: 'b-vj', status: 'cancelled', is_test: false, amount_paise: 99900 },
    { id: 'e4', user_id: 'u4', batch_id: 'b-wi', status: 'active', is_test: false, amount_paise: 0 },
    { id: 'e5', user_id: 'u5', batch_id: 'b-wi', status: 'active', is_test: true, coupon_code: 'PGITEST1', amount_paise: 100 },
    { id: 'e6', user_id: 'u6', batch_id: 'b-wi', status: 'active', is_test: true, coupon_code: 'PGITEST1', amount_paise: 100 }
  ];

  const enriched = enrichBatchesWithEnrollmentCounts(batches, enrollments);
  assert.equal(enriched[0].enrolled_count, 2);
  assert.equal(enriched[0].test_enrolled_count, 0);
  assert.equal(enriched[1].enrolled_count, 0);
  assert.equal(enriched[2].enrolled_count, 1);
  assert.equal(enriched[2].test_enrolled_count, 2);

  const mockDb = {
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        order() {
          return Promise.resolve({ data: table === 'batches' ? batches : enrollments, error: null });
        },
        single() {
          return Promise.resolve({ data: { role: 'admin' }, error: null });
        },
        then(resolve, reject) {
          return Promise.resolve({ data: table === 'batches' ? batches : enrollments, error: null }).then(resolve, reject);
        }
      };
    }
  };

  const app = express();
  mountAdmin({
    app,
    db: mockDb,
    auth: (req, _res, next) => { req.user = { id: 'admin-1', email: 'admin@plantgreeninertia.com' }; next(); },
    wrap: fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
    fail: (code, msg) => Object.assign(new Error(msg), { status: code }),
    reportData: async () => ({}),
    sendPdf: () => {},
    buildReportPDF: async () => Buffer.alloc(0),
    reportId: () => 'R1'
  });

  const srv = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const res = await fetch(`${base}/api/admin/batches`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.length, 3);
    assert.equal(data[0].enrolled_count, 2);
    assert.equal(data[1].enrolled_count, 0);
    assert.equal(data[2].enrolled_count, 1);
    assert.equal(data[2].test_enrolled_count, 2);
  } finally {
    srv.close();
  }
});
