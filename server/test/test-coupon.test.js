import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {
  BASE_PRICE_PAISE,
  TEST_COUPON_CODE,
  TEST_COUPON_PAISE,
  couponState,
  isTestCoupon,
  isTestCouponEnabled,
  winterPayablePaise
} from '../logic.js';
import {
  VIRTUAL_TEST_COUPON_ID,
  resetFallbackTestCoupon,
  validateCouponCode
} from '../test-coupon.js';
import { registerPayments, clearLocalPaymentStores } from '../payments.js';
import { mountAdmin } from '../admin.js';
import { bustBatchCache } from '../batches.js';
import { buildReceiptPDF } from '../receipt.js';

function createMockDb(seed = {}) {
  const tables = {
    batches: seed.batches || [{ id: 'batch-w26', slug: 'winter-2026', name: 'Winter 2026', status: 'active' }],
    courses: seed.courses || [{ id: 'course-web', title: 'Web Development Track', duration: '30 Hours', active: true, base_price_paise: BASE_PRICE_PAISE, access_url: 'https://portal.example/web' }],
    profiles: seed.profiles || [
      { id: 'admin-1', full_name: 'Admin User', phone: '9000000000', role: 'admin', student_id: null },
      { id: 'stu-1', full_name: 'Student One', phone: '9000000001', role: 'student', student_id: 'PGI-S26-2001' },
      { id: 'stu-2', full_name: 'Student Two', phone: '9000000002', role: 'student', student_id: 'PGI-S26-2002' }
    ],
    scholarship_coupons: seed.scholarship_coupons || [],
    payment_orders: seed.payment_orders || [],
    enrollments: seed.enrollments || [],
    internship_applications: seed.internship_applications || [],
    assessment_attempts: seed.assessment_attempts || [],
    proctoring_violations: seed.proctoring_violations || [],
    test_settings: seed.test_settings || [{ id: 1, pass_mark: 30 }],
    admin_audit_logs: []
  };

  function makeBuilder(tableName) {
    let op = 'select';
    let payload = null;
    const filters = [];
    let isSingle = false;
    let isMaybeSingle = false;
    let orderCol = null;
    let orderAsc = true;
    let maxRows = null;

    const matchRow = row => {
      for (const f of filters) {
        if (f.type === 'eq' && row[f.col] !== f.val) return false;
        if (f.type === 'ilike' && String(row[f.col] || '').toLowerCase() !== String(f.val || '').toLowerCase()) return false;
        if (f.type === 'in' && !f.vals.includes(row[f.col])) return false;
        if (f.type === 'not_null' && (row[f.col] === null || row[f.col] === undefined)) return false;
        if (f.type === 'or') {
          const ok = String(f.expr).split(',').some(clause => {
            const [c, opName, v] = clause.trim().split('.');
            if (opName === 'eq') return String(row[c]) === String(v);
            return false;
          });
          if (!ok) return false;
        }
      }
      return true;
    };

    const exec = async () => {
      const list = tables[tableName] || [];
      if (op === 'insert') {
        const items = Array.isArray(payload) ? payload : [payload];
        const inserted = items.map(item => {
          const rec = { id: item.id || crypto.randomUUID(), created_at: new Date().toISOString(), enrolled_at: new Date().toISOString(), ...item };
          list.push(rec);
          return { ...rec };
        });
        return { data: (isSingle || isMaybeSingle) ? inserted[0] : inserted, error: null };
      }
      if (op === 'update') {
        const updated = [];
        for (const row of list) {
          if (matchRow(row)) {
            Object.assign(row, payload);
            updated.push({ ...row });
          }
        }
        return { data: (isSingle || isMaybeSingle) ? (updated[0] || null) : updated, error: null };
      }
      if (op === 'delete') {
        tables[tableName] = list.filter(r => !matchRow(r));
        return { data: null, error: null };
      }
      let out = list.filter(matchRow).map(r => {
        const copy = { ...r };
        if (tableName === 'enrollments' && !copy.courses && copy.course_id) {
          copy.courses = tables.courses.find(c => c.id === copy.course_id) || null;
        }
        return copy;
      });
      if (orderCol) {
        out.sort((a, b) => {
          const av = a[orderCol] || '', bv = b[orderCol] || '';
          return orderAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
      }
      if (maxRows !== null) out = out.slice(0, maxRows);
      if (isSingle || isMaybeSingle) return { data: out[0] || null, error: null };
      return { data: out, error: null };
    };

    const q = {
      select() { return q; },
      insert(v) { op = 'insert'; payload = v; return q; },
      update(v) { op = 'update'; payload = v; return q; },
      delete() { op = 'delete'; return q; },
      eq(col, val) { filters.push({ type: 'eq', col, val }); return q; },
      ilike(col, val) { filters.push({ type: 'ilike', col, val }); return q; },
      in(col, vals) { filters.push({ type: 'in', col, vals }); return q; },
      not(col, opName) { if (opName === 'is') filters.push({ type: 'not_null', col }); return q; },
      or(expr) { filters.push({ type: 'or', expr }); return q; },
      order(col, opts = {}) { orderCol = col; orderAsc = opts.ascending !== false; return q; },
      limit(n) { maxRows = n; return q; },
      single() { isSingle = true; return exec(); },
      maybeSingle() { isMaybeSingle = true; return exec(); },
      then(resolve, reject) { return exec().then(resolve, reject); }
    };
    return q;
  }

  return {
    tables,
    from: name => makeBuilder(name),
    rpc: async fn => {
      if (fn === 'next_student_id') return { data: 'PGI-S26-' + crypto.randomInt(1000, 9999), error: null };
      if (fn === 'next_receipt_no') return { data: 'REC-PGI-W26-' + crypto.randomInt(1000, 9999), error: null };
      return { data: null, error: null };
    },
    auth: {
      admin: {
        listUsers: async () => ({
          data: {
            users: [
              { id: 'admin-1', email: 'admin@pgi.test' },
              { id: 'stu-1', email: 'student1@pgi.test' },
              { id: 'stu-2', email: 'student2@pgi.test' }
            ]
          },
          error: null
        }),
        getUserById: async id => ({
          data: { user: { id, email: id === 'stu-1' ? 'student1@pgi.test' : 'student2@pgi.test' } },
          error: null
        }),
        updateUserById: async () => ({ data: {}, error: null })
      }
    }
  };
}

function makeTestApp(db, activeUserRef) {
  const app = express();
  app.use(express.json());
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const auth = (req, _res, next) => {
    req.user = activeUserRef.user;
    next();
  };

  app.post('/api/coupons/validate', wrap(async (req, res) => {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!code) throw fail(400, 'Coupon code is required');
    res.json(await validateCouponCode(db, { code, email }));
  }));

  const { buildDashboardPayload } = registerPayments(app, { db, auth, wrap, fail });
  app.get('/api/dashboard-test', auth, wrap(async (req, res) => {
    res.json(await buildDashboardPayload(req.user));
  }));

  mountAdmin({ app, db, auth, wrap, fail, reportData: async () => ({}), sendPdf: () => {}, buildReportPDF: async () => Buffer.from(''), reportId: () => 'R1' });
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

async function reqJson(server, method, path, body) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, data: json };
}

test('logic: PGITEST1 pricing and reusable non-expiring state while keeping normal pricing untouched', () => {
  const prevEnv = process.env.ENABLE_TEST_COUPON;
  try {
    process.env.ENABLE_TEST_COUPON = 'false';
    assert.equal(isTestCouponEnabled(), false);

    process.env.ENABLE_TEST_COUPON = 'true';
    assert.equal(isTestCouponEnabled(), true);

    const testCoupon = {
      code: 'PGITEST1',
      discount_percent: 99,
      fixed_payable_paise: 100,
      is_test: true,
      is_reusable: true,
      expires_at: '2020-01-01T00:00:00Z',
      status: 'active'
    };

    assert.equal(isTestCoupon(testCoupon), true);
    assert.equal(winterPayablePaise(testCoupon), 100);
    assert.equal(couponState(testCoupon, new Date('2026-12-01T00:00:00Z')), 'active');

    // Normal pricing unchanged
    assert.equal(winterPayablePaise(null), 999900);
    assert.equal(winterPayablePaise({ code: 'WIN-NORMAL', discount_percent: 90 }), 99900);
    assert.equal(winterPayablePaise({ code: 'WIN-BASE', discount_percent: 88 }), 119900);
    assert.equal(winterPayablePaise({ code: 'WIN-FREE', discount_percent: 100 }), 0);
  } finally {
    process.env.ENABLE_TEST_COUPON = prevEnv;
  }
});

test('test coupon end-to-end: env gating, server-only Rs 1 order, verify tamper guard, repeatability, analytics filtering, and admin toggle/delete', async () => {
  const prevEnv = process.env.ENABLE_TEST_COUPON;
  const prevKeySecret = process.env.RAZORPAY_KEY_SECRET;
  const prevKeyId = process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = 'rzp_unit_secret_only';
  bustBatchCache();
  resetFallbackTestCoupon();
  clearLocalPaymentStores();

  const db = createMockDb({
    scholarship_coupons: [
      {
        id: 'pgitest1-uuid',
        code: TEST_COUPON_CODE,
        attempt_id: null,
        user_id: null,
        batch_id: null,
        score_percent: 100,
        discount_percent: 99,
        fixed_payable_paise: 100,
        is_test: true,
        is_reusable: true,
        issued_at: '2026-11-01T00:00:00Z',
        expires_at: '2020-01-01T00:00:00Z', // proves expired date is ignored for reusable test coupon
        status: 'active'
      },
      {
        id: 'normal-coupon-1',
        code: 'WIN-REAL01',
        attempt_id: 'att-real-1',
        user_id: 'stu-real',
        batch_id: 'batch-w26',
        score_percent: 80,
        discount_percent: 90,
        is_test: false,
        issued_at: '2026-11-10T00:00:00Z',
        expires_at: '2099-12-31T00:00:00Z',
        status: 'redeemed'
      }
    ],
    payment_orders: [
      {
        id: 'po-real-1',
        user_id: 'stu-real',
        batch_id: 'batch-w26',
        course_id: 'course-web',
        coupon_id: 'normal-coupon-1',
        amount_paise: 99900,
        razorpay_order_id: 'order_real_1',
        razorpay_payment_id: 'pay_real_1',
        status: 'paid',
        is_test: false,
        created_at: '2026-11-10T01:00:00Z',
        paid_at: '2026-11-10T01:05:00Z'
      }
    ],
    enrollments: [
      {
        id: 'enr-real-1',
        user_id: 'stu-real',
        batch_id: 'batch-w26',
        course_id: 'course-web',
        coupon_id: 'normal-coupon-1',
        payment_order_id: 'po-real-1',
        amount_paise: 99900,
        kind: 'paid',
        transaction_ref: 'pay_real_1',
        status: 'active',
        is_test: false
      }
    ]
  });

  const activeUserRef = { user: { id: 'stu-1', email: 'student1@pgi.test' } };
  const app = makeTestApp(db, activeUserRef);
  const srv = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    // 1. Rejected when ENABLE_TEST_COUPON is not "true"
    process.env.ENABLE_TEST_COUPON = 'false';
    let r = await reqJson(srv, 'POST', '/api/coupons/validate', { code: 'PGITEST1', email: 'any@email.com' });
    assert.equal(r.status, 200);
    assert.equal(r.data.valid, false);

    r = await reqJson(srv, 'POST', '/api/checkout/create', { courseId: 'course-web', couponCode: 'PGITEST1', amount: 1 });
    assert.equal(r.status, 400);

    // 2. Accepted when ENABLE_TEST_COUPON=true without assessment or email match, ignores client amount
    process.env.ENABLE_TEST_COUPON = 'true';
    r = await reqJson(srv, 'POST', '/api/coupons/validate', { code: 'pgitest1', email: 'unbound@different.edu' });
    assert.equal(r.status, 200);
    assert.equal(r.data.valid, true);
    assert.equal(r.data.payablePaise, 100);
    assert.equal(r.data.isTest, true);
    assert.equal(r.data.expiresAt, null);

    // Client tries passing a bogus amount -> ignored by server, order is strictly 100 paise
    const c1 = await reqJson(srv, 'POST', '/api/checkout/create', { courseId: 'course-web', couponCode: 'PGITEST1', amount: 999900 });
    assert.equal(c1.status, 200);
    assert.equal(c1.data.amount, 100);
    assert.equal(c1.data.summary.payablePaise, 100);
    assert.equal(c1.data.summary.isTest, true);

    const oid1 = c1.data.orderId;
    const pid1 = 'pay_sim_test_1';
    const sig1 = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${oid1}|${pid1}`).digest('hex');

    // Tampered amount on verify rejected
    const badVerify = await reqJson(srv, 'POST', '/api/checkout/verify', {
      razorpay_order_id: oid1,
      razorpay_payment_id: pid1,
      razorpay_signature: sig1,
      amount: 999900
    });
    assert.equal(badVerify.status, 400);

    // Valid verify completes enrollment + credentials + dashboard access
    const okVerify1 = await reqJson(srv, 'POST', '/api/checkout/verify', {
      razorpay_order_id: oid1,
      razorpay_payment_id: pid1,
      razorpay_signature: sig1
    });
    assert.equal(okVerify1.status, 200);
    assert.equal(okVerify1.data.status, 'enrolled');
    assert.ok(okVerify1.data.studentId);
    assert.ok(okVerify1.data.receiptNo);
    assert.ok(okVerify1.data.portalPassword);
    assert.equal(okVerify1.data.amountPaise, 100);
    assert.equal(okVerify1.data.isTest, true);

    const dash1 = await reqJson(srv, 'GET', '/api/dashboard-test');
    assert.equal(dash1.status, 200);
    assert.equal(dash1.data.enrollment.amountPaise, 100);
    assert.equal(dash1.data.enrollment.couponCode, 'PGITEST1');
    assert.equal(dash1.data.enrollment.course.accessUrl, 'https://portal.example/web');

    // 3. Reusable: second student can use PGITEST1 without it ever becoming redeemed
    activeUserRef.user = { id: 'stu-2', email: 'student2@pgi.test' };
    const c2 = await reqJson(srv, 'POST', '/api/checkout/create', { courseId: 'course-web', couponCode: 'PGITEST1' });
    assert.equal(c2.status, 200);
    assert.equal(c2.data.amount, 100);
    assert.notEqual(c2.data.orderId, oid1);

    const pid2 = 'pay_sim_test_2';
    const sig2 = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${c2.data.orderId}|${pid2}`).digest('hex');
    const okVerify2 = await reqJson(srv, 'POST', '/api/checkout/verify', {
      razorpay_order_id: c2.data.orderId,
      razorpay_payment_id: pid2,
      razorpay_signature: sig2
    });
    assert.equal(okVerify2.status, 200);
    assert.equal(okVerify2.data.status, 'enrolled');

    const storedTestCoupon = db.tables.scholarship_coupons.find(c => c.code === 'PGITEST1');
    assert.equal(storedTestCoupon.status, 'active');

    // Verify receipt PDF builds cleanly for Rs 1 payment
    const receiptPdf = await buildReceiptPDF({
      studentId: okVerify1.data.studentId,
      receiptNo: okVerify1.data.receiptNo,
      name: 'Student One',
      email: 'student1@pgi.test',
      course: 'Web Development Track',
      couponCode: 'PGITEST1',
      amountPaise: 100,
      basePricePaise: BASE_PRICE_PAISE,
      transactionRef: pid1
    });
    assert.equal(receiptPdf.subarray(0, 5).toString('ascii'), '%PDF-');

    // 4. Admin analytics, revenue & payment reports exclude test orders/enrollments
    activeUserRef.user = { id: 'admin-1', email: 'admin@pgi.test' };
    const analytics = await reqJson(srv, 'GET', '/api/admin/analytics');
    assert.equal(analytics.status, 200);
    assert.equal(analytics.data.payments.completedCount, 1);
    assert.equal(analytics.data.payments.revenuePaise, 99900);
    assert.equal(analytics.data.interns.totalEnrolled, 1);

    const paymentsReport = await reqJson(srv, 'GET', '/api/admin/payments');
    assert.equal(paymentsReport.status, 200);
    assert.equal(paymentsReport.data.length, 1);
    assert.equal(paymentsReport.data[0].orderId, 'order_real_1');

    const csvReport = await reqJson(srv, 'GET', '/api/admin/payments/export.csv');
    assert.equal(csvReport.status, 200);
    assert.ok(csvReport.data.includes('order_real_1'));
    assert.equal(csvReport.data.includes(oid1), false);
    assert.equal(csvReport.data.includes('pay_sim_test_1'), false);

    // 5. Admin coupons list shows PGITEST1 with Test flag, supports disable/enable & delete
    const coupons = await reqJson(srv, 'GET', '/api/admin/coupons');
    assert.equal(coupons.status, 200);
    const pgiRow = coupons.data.find(c => c.code === 'PGITEST1');
    assert.ok(pgiRow);
    assert.equal(pgiRow.isTest, true);
    assert.equal(pgiRow.status, 'active');

    const toggledOff = await reqJson(srv, 'POST', '/api/admin/coupons/PGITEST1/toggle');
    assert.equal(toggledOff.status, 200);
    assert.equal(toggledOff.data.status, 'disabled');

    const valWhenDisabled = await reqJson(srv, 'POST', '/api/coupons/validate', { code: 'PGITEST1' });
    assert.equal(valWhenDisabled.data.valid, false);

    const toggledOn = await reqJson(srv, 'POST', '/api/admin/coupons/PGITEST1/toggle');
    assert.equal(toggledOn.data.status, 'active');

    const deleted = await reqJson(srv, 'DELETE', '/api/admin/coupons/PGITEST1');
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data.deleted, true);

    const afterDelete = await reqJson(srv, 'POST', '/api/coupons/validate', { code: 'PGITEST1' });
    assert.equal(afterDelete.data.valid, false);
  } finally {
    await new Promise(resolve => srv.close(resolve));
    process.env.ENABLE_TEST_COUPON = prevEnv;
    if (prevKeySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = prevKeySecret;
    if (prevKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = prevKeyId;
    resetFallbackTestCoupon();
    clearLocalPaymentStores();
  }
});
