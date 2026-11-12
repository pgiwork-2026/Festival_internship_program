import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import {
  assessAssessmentDevice,
  normalizeClientDeviceSignals,
  sharedDevicePolicyState
} from '../logic.js';
import { buildAssessmentLinkEmailHtml } from '../email.js';
import { mountAdmin } from '../admin.js';
import { bustBatchCache } from '../batches.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('device detection: blocks Android Chrome, iPhone Safari, iPad Safari, Android tablet, and DevTools emulation', () => {
  const blockedCases = [
    {
      name: 'Android Chrome',
      headers: {
        'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
        'sec-ch-ua-mobile': '?1'
      },
      clientSignals: { userAgentDataMobile: true, maxTouchPoints: 5, pointerCoarse: true, hoverNone: true, screenWidth: 412 }
    },
    {
      name: 'iPhone Safari',
      headers: {
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      },
      clientSignals: { userAgentDataMobile: false, maxTouchPoints: 5, pointerCoarse: true, hoverNone: true, screenWidth: 390 }
    },
    {
      name: 'iPad Safari (default)',
      headers: {
        'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      },
      clientSignals: { userAgentDataMobile: false, maxTouchPoints: 5, pointerCoarse: true, hoverNone: true, screenWidth: 810 }
    },
    {
      name: 'iPad Safari (Request Desktop Site)',
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
      },
      clientSignals: { userAgentDataMobile: false, maxTouchPoints: 5, pointerCoarse: false, hoverNone: false, screenWidth: 1024 }
    },
    {
      name: 'Android tablet',
      headers: {
        'user-agent': 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      },
      clientSignals: { userAgentDataMobile: false, maxTouchPoints: 10, pointerCoarse: true, hoverNone: true, screenWidth: 800 }
    },
    {
      name: 'Chrome DevTools device emulation (client signals / Sec-CH-UA-Mobile)',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'sec-ch-ua-mobile': '?1'
      },
      clientSignals: { userAgentDataMobile: true, maxTouchPoints: 5, pointerCoarse: true, hoverNone: true, screenWidth: 390 }
    },
    {
      name: 'Chrome DevTools emulation spoofing coarse+no-hover & narrow physical screen without UA override',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      clientSignals: { userAgentDataMobile: false, maxTouchPoints: 5, pointerCoarse: true, hoverNone: true, screenWidth: 1280 }
    },
    {
      name: 'Direct API call with mobile User-Agent only (no clientSignals)',
      headers: {
        'user-agent': 'curl/8.0 (Mobile; Android 14)'
      },
      clientSignals: null
    }
  ];

  for (const c of blockedCases) {
    const res = assessAssessmentDevice({ headers: c.headers, clientSignals: c.clientSignals, desktopOnly: true, mobileOverride: false });
    assert.equal(res.allowed, false, `Expected ${c.name} to be blocked`);
    assert.equal(res.code, 'DEVICE_NOT_ALLOWED', `Expected DEVICE_NOT_ALLOWED for ${c.name}`);
  }
});

test('device detection: allows Windows touchscreen laptop, MacBook, Linux desktop, and narrow desktop windows', () => {
  const allowedCases = [
    {
      name: 'Windows laptop with touchscreen',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'sec-ch-ua-mobile': '?0'
      },
      clientSignals: { userAgentDataMobile: false, maxTouchPoints: 10, pointerCoarse: false, hoverNone: false, screenWidth: 1920 }
    },
    {
      name: 'MacBook',
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      },
      clientSignals: { userAgentDataMobile: false, maxTouchPoints: 0, pointerCoarse: false, hoverNone: false, screenWidth: 1440 }
    },
    {
      name: 'Linux desktop',
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      },
      clientSignals: { userAgentDataMobile: false, maxTouchPoints: 0, pointerCoarse: false, hoverNone: false, screenWidth: 1920 }
    },
    {
      name: 'Narrow desktop browser window (screen.width stays >= 1024 even if viewport < 600px)',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      },
      clientSignals: { userAgentDataMobile: false, maxTouchPoints: 0, pointerCoarse: false, hoverNone: false, screenWidth: 1366 }
    }
  ];

  for (const c of allowedCases) {
    const res = assessAssessmentDevice({ headers: c.headers, clientSignals: c.clientSignals, desktopOnly: true, mobileOverride: false });
    assert.equal(res.allowed, true, `Expected ${c.name} to be allowed, got reason: ${res.reason}`);
  }
});

test('device detection: honors desktopOnly=false global setting and per-student mobileOverride=true', () => {
  const mobileReq = {
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148', 'sec-ch-ua-mobile': '?1' },
    clientSignals: { userAgentDataMobile: true, maxTouchPoints: 5, pointerCoarse: true, hoverNone: true, screenWidth: 390 }
  };

  assert.equal(assessAssessmentDevice({ ...mobileReq, desktopOnly: true, mobileOverride: false }).allowed, false);
  assert.equal(assessAssessmentDevice({ ...mobileReq, desktopOnly: false, mobileOverride: false }).allowed, true);
  assert.equal(assessAssessmentDevice({ ...mobileReq, desktopOnly: true, mobileOverride: true }).allowed, true);
});

test('normalizeClientDeviceSignals ignores invalid non-object payloads safely', () => {
  assert.equal(normalizeClientDeviceSignals(null), null);
  assert.equal(normalizeClientDeviceSignals({ unrelated: 1 }), null);
  const sig = normalizeClientDeviceSignals({ screenWidth: '390', pointerCoarse: true, hoverNone: true, maxTouchPoints: '5' });
  assert.deepEqual(sig, { ua: '', userAgentDataMobile: false, maxTouchPoints: 5, pointerCoarse: true, hoverNone: true, screenWidth: 390 });
});

test('blocked screen HTML & assessment-link email follow minimal no-emoji copy and include Application ID', () => {
  const portalHtml = fs.readFileSync(path.join(ROOT, 'public', 'portal.html'), 'utf8');
  const startIdx = portalHtml.indexOf('id="s-device-blocked"');
  assert.ok(startIdx !== -1, 'Blocked section s-device-blocked should exist in portal.html');
  const section = portalHtml.slice(startIdx, portalHtml.indexOf('</section>', startIdx));

  assert.ok(section.includes('Use a laptop or desktop'));
  assert.ok(section.includes('The assessment can only be taken on a laptop or desktop computer.'));
  assert.ok(section.includes('Copy link'));
  assert.ok(section.includes('Send link to my email'));
  assert.ok(section.includes('Application ID:'));
  assert.equal(/request.*desktop|desktop site|workaround/i.test(section), false);
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(section), false);

  const emailHtml = buildAssessmentLinkEmailHtml({
    fullName: 'Arun Kumar',
    email: 'arun@college.edu',
    applicationId: 'PGI-W26-0042',
    assessmentUrl: 'https://pgi.example/portal.html?mode=login&appId=PGI-W26-0042&email=arun%40college.edu'
  });
  assert.ok(emailHtml.includes('PGI-W26-0042'));
  assert.ok(emailHtml.includes('https://pgi.example/portal.html?mode=login'));
});

test('admin desktop-only toggle, per-student mobile override, and blocked-attempt audit analytics work end-to-end', async () => {
  const prevDesktopOverride = sharedDevicePolicyState.desktopOnlyOverride;
  const prevBlockedLen = sharedDevicePolicyState.blockedEvents.length;
  sharedDevicePolicyState.desktopOnlyOverride = null;
  sharedDevicePolicyState.mobileOverrides.clear();

  const state = {
    test_settings: [{ id: 1, question_count: 25, duration_seconds: 1200, marks_per_question: 4, total_marks: 100, pass_mark: 30, negative_marking: 0, attempt_limit: 1, coupon_valid_hours: 24, desktop_only: true }],
    admin_audit_logs: [],
    internship_applications: [{ id: 'app-uuid-1', application_id: 'PGI-W26-0777', full_name: 'Meera S', email: 'meera@test.edu', domain_name: 'Python Programming', mode: 'Online' }],
    profiles: [
      { id: 'admin-1', full_name: 'Admin User', phone: '9999999999', role: 'admin' },
      { id: 'stu-1', full_name: 'Meera S', phone: '9876543210', role: 'student', student_id: 'PGI-S26-0777' }
    ],
    assessment_attempts: [],
    payment_orders: [],
    scholarship_coupons: [],
    enrollments: [],
    batches: [{ id: 'b1', name: 'Winter 2026', slug: 'winter-2026', status: 'active' }],
    mentors: []
  };
  bustBatchCache();

  function makeQuery(table) {
    let rows = [...(state[table] || [])];
    const q = {
      _filters: [],
      _order: null,
      _limit: null,
      _op: 'select',
      _payload: null,
      select() { return q; },
      eq(col, val) { q._filters.push(r => r[col] === val); return q; },
      ilike(col, val) { q._filters.push(r => String(r[col] || '').toLowerCase() === String(val || '').toLowerCase()); return q; },
      in(col, vals) { q._filters.push(r => vals.includes(r[col])); return q; },
      not(col, op, val) { if (op === 'is' && val === null) q._filters.push(r => r[col] !== null && r[col] !== undefined); return q; },
      order(col, { ascending = true } = {}) { q._order = { col, ascending }; return q; },
      limit(n) { q._limit = n; return q; },
      insert(payload) { q._op = 'insert'; q._payload = payload; return q; },
      update(payload) { q._op = 'update'; q._payload = payload; return q; },
      async maybeSingle() {
        const res = await q._exec();
        return { data: res.data?.[0] || null, error: null };
      },
      async single() {
        const res = await q._exec();
        return { data: res.data?.[0] || null, error: null };
      },
      then(resolve) {
        return q._exec().then(resolve);
      },
      async _exec() {
        if (q._op === 'insert') {
          const item = { ...(Array.isArray(q._payload) ? q._payload[0] : q._payload) };
          state[table].push(item);
          return { data: [item], error: null };
        }
        if (q._op === 'update') {
          const matched = rows.filter(r => q._filters.every(fn => fn(r)));
          matched.forEach(m => Object.assign(m, q._payload));
          return { data: matched, error: null };
        }
        let out = rows.filter(r => q._filters.every(fn => fn(r)));
        if (q._order) {
          out.sort((a, b) => q._order.ascending
            ? String(a[q._order.col] || '').localeCompare(String(b[q._order.col] || ''))
            : String(b[q._order.col] || '').localeCompare(String(a[q._order.col] || '')));
        }
        if (q._limit !== null) out = out.slice(0, q._limit);
        return { data: out, error: null };
      }
    };
    return q;
  }

  const fakeDb = {
    from: table => makeQuery(table),
    auth: {
      admin: {
        async listUsers() {
          return { data: { users: [{ id: 'stu-1', email: 'meera@test.edu', user_metadata: { application_id: 'PGI-W26-0777' } }] }, error: null };
        },
        async getUserById(id) {
          if (id === 'stu-1') return { data: { user: { id: 'stu-1', email: 'meera@test.edu', user_metadata: state._stuMeta || { application_id: 'PGI-W26-0777' } } }, error: null };
          return { data: { user: null }, error: null };
        },
        async updateUserById(id, attrs) {
          if (id === 'stu-1') state._stuMeta = { ...(state._stuMeta || {}), ...(attrs.user_metadata || {}) };
          return { data: { user: { id } }, error: null };
        }
      }
    }
  };

  // Seed one blocked device attempt
  const blockedEvent = {
    id: 'blk-1',
    admin_id: 'stu-1',
    admin_email: 'meera@test.edu',
    action: 'ASSESSMENT_DEVICE_BLOCKED',
    target_type: 'assessment_device',
    target_id: 'PGI-W26-0777',
    details: {
      application_id: 'PGI-W26-0777',
      email: 'meera@test.edu',
      time: new Date().toISOString(),
      user_agent: 'iPhone',
      reason: 'user_agent_mobile_or_tablet',
      endpoint: '/api/attempts/start'
    },
    created_at: new Date().toISOString()
  };
  state.admin_audit_logs.push(blockedEvent);
  sharedDevicePolicyState.blockedEvents.unshift(blockedEvent);

  const app = express();
  app.use(express.json());
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const wrap = f => (req, res, next) => f(req, res, next).catch(e => res.status(e.status || 400).json({ error: e.message }));
  const auth = (req, _res, next) => { req.user = { id: 'admin-1', email: 'admin@plantgreeninertia.com' }; next(); };
  mountAdmin({ app, db: fakeDb, auth, wrap, fail, reportData: async () => ({}), sendPdf: () => {}, buildReportPDF: async () => Buffer.alloc(0), reportId: () => 'R1' });

  const srv = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${srv.address().port}`;

  try {
    // 1. Overview & Analytics include blockedDeviceCount
    const ov = await (await fetch(`${base}/api/admin/overview`)).json();
    assert.equal(ov.blockedDeviceCount, 1);
    assert.equal(ov.desktopOnly, true);

    // 2. Toggle Desktop Only OFF then ON
    const offRes = await (await fetch(`${base}/api/admin/settings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ desktop_only: false })
    })).json();
    assert.equal(offRes.settings.desktop_only, false);

    const onRes = await (await fetch(`${base}/api/admin/settings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ desktop_only: true })
    })).json();
    assert.equal(onRes.settings.desktop_only, true);

    // 3. Per-student mobile override requires reason when enabling, then enables & logs in audit logs
    const badOv = await fetch(`${base}/api/admin/students/stu-1/mobile-override`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed: true, reason: '' })
    });
    assert.equal(badOv.status, 400);

    const okOv = await (await fetch(`${base}/api/admin/students/stu-1/mobile-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed: true, reason: 'Student has no computer access', email: 'meera@test.edu', applicationId: 'PGI-W26-0777' })
    })).json();
    assert.equal(okOv.allowed, true);
    assert.equal(state._stuMeta.allow_mobile_assessment, true);

    const studentsList = await (await fetch(`${base}/api/admin/students`)).json();
    assert.equal(studentsList[0].mobileOverride, true);
    assert.equal(studentsList[0].mobileOverrideReason, 'Student has no computer access');

    const logs = await (await fetch(`${base}/api/admin/audit-logs`)).json();
    assert.ok(logs.some(l => l.action === 'ASSESSMENT_MOBILE_OVERRIDE' && l.details?.reason === 'Student has no computer access'));
    assert.ok(logs.some(l => l.action === 'ASSESSMENT_DEVICE_BLOCKED' && l.details?.application_id === 'PGI-W26-0777'));
  } finally {
    srv.close();
    bustBatchCache();
    sharedDevicePolicyState.desktopOnlyOverride = prevDesktopOverride;
    sharedDevicePolicyState.blockedEvents.length = prevBlockedLen;
    sharedDevicePolicyState.mobileOverrides.clear();
  }
});

test('assessment HTTP guard pattern: rejects mobile start/questions/answer/submit with 403 DEVICE_NOT_ALLOWED and preserves saved progress', async () => {
  const attempts = [];
  const responses = [{ attempt_id: 'att-1', question_id: 'q1', selected_option_id: 'a' }];
  const logs = [];
  let desktopOnly = true;
  let mobileOverride = false;

  const app = express();
  app.use(express.json());
  const deviceGuard = (endpoint) => (req, res, next) => {
    const hdrSignals = req.headers['x-pgi-device-signals'] ? JSON.parse(String(req.headers['x-pgi-device-signals'])) : null;
    const verdict = assessAssessmentDevice({
      headers: req.headers,
      clientSignals: req.body?.deviceSignals || hdrSignals,
      desktopOnly,
      mobileOverride
    });
    if (!verdict.allowed) {
      logs.push({ application_id: 'PGI-W26-0888', time: new Date().toISOString(), user_agent: req.headers['user-agent'] || '', reason: verdict.reason, endpoint });
      return res.status(403).json({
        error: 'The assessment can only be taken on a laptop or desktop computer.',
        code: 'DEVICE_NOT_ALLOWED',
        reason: verdict.reason,
        applicationId: 'PGI-W26-0888'
      });
    }
    next();
  };

  app.post('/api/attempts/start', deviceGuard('/api/attempts/start'), (_req, res) => {
    let active = attempts.find(a => a.status === 'in_progress');
    if (!active) {
      active = { id: 'att-1', status: 'in_progress', started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1200e3).toISOString() };
      attempts.push(active);
    }
    res.json({ attemptId: active.id, saved: Object.fromEntries(responses.map(r => [r.question_id, r.selected_option_id])) });
  });
  app.get('/api/attempts/:id/questions', deviceGuard('/api/attempts/:id/questions'), (_req, res) => {
    res.json({ attemptId: 'att-1', questions: [{ id: 'q1' }], saved: { q1: 'a' } });
  });
  app.post('/api/attempts/:id/answer', deviceGuard('/api/attempts/:id/answer'), (req, res) => {
    responses.push({ attempt_id: 'att-1', question_id: req.body.questionId, selected_option_id: req.body.optionId });
    res.json({ ok: true });
  });
  app.post('/api/attempts/:id/submit', deviceGuard('/api/attempts/:id/submit'), (_req, res) => {
    if (attempts[0]) attempts[0].status = 'submitted';
    res.json({ status: 'submitted' });
  });

  const srv = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const desktopHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36'
  };
  const mobileHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148 Safari/604.1',
    'Sec-CH-UA-Mobile': '?1'
  };

  try {
    // 1. Mobile cannot start assessment: timer NOT started, 0 attempts created
    const startMob = await fetch(`${base}/api/attempts/start`, { method: 'POST', headers: mobileHeaders, body: '{}' });
    assert.equal(startMob.status, 403);
    const startMobJson = await startMob.json();
    assert.equal(startMobJson.code, 'DEVICE_NOT_ALLOWED');
    assert.equal(attempts.length, 0);

    // 2. Desktop starts attempt cleanly
    const startDesk = await fetch(`${base}/api/attempts/start`, { method: 'POST', headers: desktopHeaders, body: '{}' });
    assert.equal(startDesk.status, 200);
    assert.equal(attempts.length, 1);

    // 3. Switching to phone later cannot load questions, save answer, or submit, AND keeps saved progress intact
    for (const [m, url, body] of [
      ['GET', '/api/attempts/att-1/questions', undefined],
      ['POST', '/api/attempts/att-1/answer', JSON.stringify({ questionId: 'q2', optionId: 'b' })],
      ['POST', '/api/attempts/att-1/submit', '{}']
    ]) {
      const r = await fetch(`${base}${url}`, { method: m, headers: mobileHeaders, body });
      assert.equal(r.status, 403);
      const j = await r.json();
      assert.equal(j.code, 'DEVICE_NOT_ALLOWED');
    }
    assert.equal(attempts[0].status, 'in_progress');
    assert.equal(responses.length, 1);
    assert.equal(logs.length, 4);

    // 4. Returning to desktop resumes same in_progress attempt with saved answer q1='a'
    const resumeDesk = await fetch(`${base}/api/attempts/start`, { method: 'POST', headers: desktopHeaders, body: '{}' });
    assert.equal(resumeDesk.status, 200);
    const resumeJson = await resumeDesk.json();
    assert.equal(resumeJson.attemptId, 'att-1');
    assert.equal(resumeJson.saved.q1, 'a');

    // 5. With admin override ON, mobile succeeds
    mobileOverride = true;
    const ovRes = await fetch(`${base}/api/attempts/att-1/questions`, { method: 'GET', headers: mobileHeaders });
    assert.equal(ovRes.status, 200);

    // 6. With override OFF and desktopOnly=false, mobile also succeeds
    mobileOverride = false;
    desktopOnly = false;
    const globalOffRes = await fetch(`${base}/api/attempts/att-1/questions`, { method: 'GET', headers: mobileHeaders });
    assert.equal(globalOffRes.status, 200);
  } finally {
    srv.close();
  }
});
