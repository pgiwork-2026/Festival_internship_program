import crypto from 'node:crypto';
import {
  couponState,
  winterPayablePaise,
  BASE_PRICE_PAISE,
  TEST_COUPON_CODE,
  TEST_COUPON_PAISE,
  isTestCoupon,
  isTestCouponEnabled
} from './logic.js';
import {
  resolveCouponByCode,
  resolveCouponById,
  isSchemaColumnError,
  isTestTransactionRecord
} from './test-coupon.js';
import { buildOfferPDF, offerId } from './offer.js';
import { buildReceiptPDF, receiptId } from './receipt.js';
import { sendEnrollmentReceiptEmail } from './email.js';
import { batchTools } from './batches.js';
import { createOrder, fetchPayment, verifySignature, verifyWebhook } from './razorpay.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Local in-memory fallback stores for tests and offline development
const localOrders = new Map();
const localEnrollments = new Map();

export function clearLocalPaymentStores() {
  localOrders.clear();
  localEnrollments.clear();
}

export function registerPayments(app, { db, auth, wrap, fail, localApplications = new Map() }) {
  const { activeBatch } = batchTools(db, fail);
  const NO_BATCH = '00000000-0000-0000-0000-000000000000';

  app.get('/api/courses', auth, wrap(async (_q, res) => {
    let courses = [];
    try {
      const { data } = await db.from('courses').select('id,title,description,duration,skills,benefits,base_price_paise').eq('active', true);
      if (data && data.length) {
        courses = data.map(c => ({
          ...c,
          base_price_paise: Number(c.base_price_paise) || BASE_PRICE_PAISE
        }));
      }
    } catch {}
    res.json(courses);
  }));

  async function eligibleCoupon(userId, batchId) {
    let c = null;
    try {
      let q = db.from('scholarship_coupons').select('*').eq('user_id', userId);
      if (batchId) q = q.eq('batch_id', batchId);
      const { data } = await q.order('issued_at', { ascending: false }).limit(1).maybeSingle();
      c = data;
      if (!c && batchId) {
        const { data: fallback } = await db.from('scholarship_coupons').select('*').eq('user_id', userId).order('issued_at', { ascending: false }).limit(1).maybeSingle();
        c = fallback;
      }
    } catch {}

    if (!c) throw fail(403, 'No scholarship coupon found. Complete the assessment first.');

    try {
      const { data: e } = await db.from('enrollments').select('id').eq('user_id', userId).maybeSingle();
      if (e) throw fail(409, 'You are already enrolled');
    } catch {}

    return c;
  }

  async function provisionStudentCredentials(userId) {
    let prof = null;
    try {
      const { data } = await db.from('profiles').select('full_name,phone,student_id').eq('id', userId).maybeSingle();
      prof = data;
    } catch {}

    let studentId = prof?.student_id;
    if (!studentId) {
      try {
        const { data: sId, error } = await db.rpc('next_student_id');
        if (!error && sId) studentId = sId;
      } catch {}
      if (!studentId) {
        studentId = `PGI-S26-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      }
      try {
        await db.from('profiles').update({ student_id: studentId }).eq('id', userId);
      } catch {}
    }

    let receiptNo = null;
    try {
      const { data: rNo, error } = await db.rpc('next_receipt_no');
      if (!error && rNo) receiptNo = rNo;
    } catch {}
    if (!receiptNo) {
      receiptNo = `REC-PGI-W26-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    }

    let existingUser = null;
    let userEmail = null;
    try {
      const { data: u } = await db.auth.admin.getUserById(userId);
      existingUser = u?.user || null;
      userEmail = existingUser?.email || null;
    } catch {}

    const existingMeta = existingUser?.user_metadata || {};
    const portalPassword = existingMeta.portal_access_key
      || ('PGI-' + crypto.randomBytes(3).toString('hex').toUpperCase() + '!26');

    try {
      if (db.auth?.admin?.updateUserById && existingUser) {
        const updatePayload = {
          user_metadata: {
            ...existingMeta,
            portal_access_key: portalPassword,
            student_id: studentId
          }
        };
        // Only assign auth password when candidate has no DOB on file; otherwise keep their DOB login working
        if (!existingMeta.dob) {
          updatePayload.password = portalPassword;
        }
        await db.auth.admin.updateUserById(userId, updatePayload);
      }
    } catch (err) {
      console.warn('[Auth Admin Password Provisioning]', err?.message || err);
    }

    return { prof, studentId, receiptNo, portalPassword, userEmail };
  }

  // Idempotent enrollment persistence
  async function enroll({ userId, course, coupon, kind, orderId, amount, txRef, studentId, receiptNo, batchId, isTest }) {
    const testCoupon = isTestCoupon(coupon);
    const testTx = Boolean(isTest || testCoupon || Number(amount) === TEST_COUPON_PAISE);
    const enrRecord = {
      user_id: userId,
      batch_id: batchId ?? coupon.batch_id ?? null,
      course_id: course.id,
      coupon_id: coupon._virtual ? null : coupon.id,
      payment_order_id: orderId || null,
      amount_paise: amount,
      kind,
      transaction_ref: txRef,
      student_id: studentId || null,
      receipt_no: receiptNo || null,
      status: 'active',
      is_test: testTx,
      coupon_code: coupon.code || null
    };

    let enr = null;
    try {
      let res = await db.from('enrollments').insert(enrRecord).select().single();
      if (res.error && isSchemaColumnError(res.error)) {
        const legacyRecord = { ...enrRecord, coupon_id: coupon.id };
        delete legacyRecord.is_test;
        delete legacyRecord.coupon_code;
        res = await db.from('enrollments').insert(legacyRecord).select().single();
      }
      if (!res.error && res.data) {
        enr = { ...res.data, is_test: res.data.is_test ?? testTx, coupon_code: res.data.coupon_code ?? coupon.code };
      } else if (!testTx) {
        const { data: ex } = await db.from('enrollments').select('*').eq('coupon_id', coupon.id).maybeSingle();
        if (ex) enr = ex;
      } else {
        const { data: exUser } = await db.from('enrollments').select('*').eq('user_id', userId).maybeSingle();
        if (exUser) enr = { ...exUser, is_test: exUser.is_test ?? testTx, coupon_code: exUser.coupon_code ?? coupon.code };
      }
    } catch (err) {
      console.warn('DB enrollment insert fell back to local store:', err.message);
    }

    if (!enr) {
      const fallbackId = 'enr_' + crypto.randomUUID();
      enr = { id: fallbackId, ...enrRecord, coupon_id: coupon.id, enrolled_at: new Date().toISOString() };
      localEnrollments.set(userId, enr);
    }

    // Mark normal single-use coupon as redeemed (never exhaust reusable test coupons)
    if (!testCoupon && !coupon._virtual) {
      try {
        await db.from('scholarship_coupons')
          .update({ status: 'redeemed', redeemed_at: new Date().toISOString(), course_id: course.id })
          .eq('id', coupon.id)
          .eq('status', 'active');
      } catch {}
    }

    // Privacy: remove proctoring snapshots once enrolled
    try {
      const { data: atts } = await db.from('assessment_attempts').select('id').eq('user_id', userId);
      const ids = (atts || []).map(a => a.id);
      if (ids.length) {
        await db.from('proctoring_violations').update({ snapshot: null }).in('attempt_id', ids).not('snapshot', 'is', null);
      }
    } catch (e) {
      console.error('evidence cleanup failed', e?.message || e);
    }

    return enr;
  }

  // Create Razorpay Order on Backend (Never trusting frontend pricing)
  app.post('/api/checkout/create', auth, wrap(async (req, res) => {
    let b = null;
    try { b = await activeBatch(); } catch {}

    if (localEnrollments.has(req.user.id)) {
      throw fail(409, 'You are already enrolled');
    }
    try {
      const { data: exEnr } = await db.from('enrollments').select('id').eq('user_id', req.user.id).maybeSingle();
      if (exEnr) throw fail(409, 'You are already enrolled');
    } catch (e) { if (e?.status === 409) throw e; }

    let course = null;
    try {
      const { data } = await db.from('courses').select('*').eq('id', String(req.body?.courseId || '')).eq('active', true).maybeSingle();
      course = data;
    } catch {}
    if (!course) throw fail(404, 'Course track not found');

    const rawCode = String(req.body?.couponCode || '').trim().toUpperCase();
    let appliedCoupon = null;
    if (rawCode) {
      if (rawCode === TEST_COUPON_CODE && !isTestCouponEnabled()) {
        throw fail(400, 'Invalid scholarship coupon code.');
      }
      const found = await resolveCouponByCode(db, rawCode);
      if (!found) throw fail(400, 'Invalid scholarship coupon code.');

      const testCoupon = isTestCoupon(found);
      if (testCoupon) {
        if (!isTestCouponEnabled()) {
          throw fail(400, 'Invalid scholarship coupon code.');
        }
        const st = couponState(found);
        if (st === 'disabled' || st === 'revoked') {
          throw fail(403, 'This coupon has been disabled.');
        }
        if (st !== 'active') {
          throw fail(410, 'Test coupon PGITEST1 has expired (24-hour validity elapsed).');
        }
      } else {
        const userEmail = String(req.user.email || '').toLowerCase();
        if (found.user_id !== req.user.id && (!found.student_email || found.student_email.toLowerCase() !== userEmail)) {
          throw fail(403, 'This coupon belongs to a different candidate account.');
        }
        if (couponState(found) !== 'active') {
          throw fail(410, 'Your scholarship coupon has expired or was already used.');
        }
      }
      appliedCoupon = found;
    }

    const isTestOrder = isTestCoupon(appliedCoupon);

    // DB payment_orders/enrollments require non-null coupon_id FK (except 016+ test coupons)
    const fkCoupon = appliedCoupon || await eligibleCoupon(req.user.id, b?.id);
    const coupon = fkCoupon;

    const basePaise = Number(course.base_price_paise) || BASE_PRICE_PAISE;
    // Server-side authoritative pricing: never trust any amount sent from frontend
    let amount = appliedCoupon ? winterPayablePaise(appliedCoupon) : basePaise;
    if (isTestOrder) {
      if (!isTestCouponEnabled()) throw fail(400, 'Invalid scholarship coupon code.');
      amount = TEST_COUPON_PAISE;
    }

    const effectiveDiscountPercent = isTestOrder
      ? 99
      : (appliedCoupon
        ? (Number(appliedCoupon.discount_percent) === 85
          ? 88
          : (Number(appliedCoupon.discount_percent) === 100 ? 90 : Number(appliedCoupon.discount_percent)))
        : 0);

    if (!Number.isInteger(amount) || amount <= 0) {
      throw fail(400, 'Invalid payable amount.');
    }

    // Reuse existing open order for this user+coupon to prevent double charges on retries
    let openOrders = [];
    try {
      const { data } = await db
        .from('payment_orders')
        .select('*')
        .eq('user_id', req.user.id)
        .eq('coupon_id', coupon.id)
        .eq('status', 'created');
      if (data) openOrders = data;
    } catch {}
    for (const lo of localOrders.values()) {
      if (lo.user_id === req.user.id && lo.coupon_id === coupon.id && lo.status === 'created') {
        openOrders.push(lo);
      }
    }

    const same = openOrders.find(o => o.course_id === course.id && Number(o.amount_paise) === amount && isTestTransactionRecord(o) === isTestOrder);
    for (const o of openOrders) {
      if (o !== same) {
        try {
          await db.from('payment_orders').update({ status: 'cancelled' }).eq('id', o.id).eq('status', 'created');
        } catch {}
        if (localOrders.has(o.razorpay_order_id)) {
          localOrders.get(o.razorpay_order_id).status = 'cancelled';
        }
      }
    }

    let order = same;
    if (!order) {
      // Create Razorpay order via Razorpay API
      let rz = null;
      if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        rz = await createOrder({
          amount,
          receipt: 'c_' + String(coupon.id).slice(0, 30),
          notes: {
            coupon: coupon.code,
            course: course.id,
            userId: req.user.id,
            is_test: isTestOrder ? 'true' : 'false'
          }
        });
      } else {
        // Test/simulated fallback if keys are missing during development
        rz = { id: 'order_sim_' + crypto.randomBytes(8).toString('hex'), amount, currency: 'INR' };
      }

      const orderRow = {
        user_id: req.user.id,
        batch_id: coupon.batch_id || b?.id || null,
        course_id: course.id,
        coupon_id: coupon._virtual ? null : coupon.id,
        amount_paise: amount,
        currency: 'INR',
        razorpay_order_id: rz.id,
        status: 'created',
        is_test: isTestOrder,
        coupon_code: coupon.code
      };

      try {
        let resIns = await db.from('payment_orders').insert(orderRow).select().single();
        if (resIns.error && isSchemaColumnError(resIns.error)) {
          const legacyRow = { ...orderRow, coupon_id: coupon.id };
          delete legacyRow.is_test;
          delete legacyRow.coupon_code;
          resIns = await db.from('payment_orders').insert(legacyRow).select().single();
        }
        if (!resIns.error && resIns.data) {
          order = {
            ...resIns.data,
            is_test: resIns.data.is_test ?? isTestOrder,
            coupon_code: resIns.data.coupon_code ?? coupon.code
          };
        } else {
          localOrders.set(rz.id, { id: 'po_' + rz.id, ...orderRow, coupon_id: coupon.id, created_at: new Date().toISOString() });
          order = localOrders.get(rz.id);
        }
      } catch {
        localOrders.set(rz.id, { id: 'po_' + rz.id, ...orderRow, coupon_id: coupon.id, created_at: new Date().toISOString() });
        order = localOrders.get(rz.id);
      }
    }

    res.json({
      status: 'payment_required',
      orderId: order.razorpay_order_id,
      amount: order.amount_paise,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_simulated',
      summary: {
        basePricePaise: basePaise,
        discountPercent: effectiveDiscountPercent,
        payablePaise: amount,
        couponCode: appliedCoupon ? appliedCoupon.code : null,
        isTest: isTestOrder,
        courseTitle: course.title,
        methods: ['upi', 'card', 'netbanking', 'wallet']
      }
    });
  }));

  async function confirmWithRazorpay(order, paymentId) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || paymentId.startsWith('pay_sim_')) {
      return 'captured';
    }
    const p = await fetchPayment(paymentId);
    const isTestOrder = isTestTransactionRecord(order);
    if (
      p.order_id !== order.razorpay_order_id ||
      Number(p.amount) !== Number(order.amount_paise) ||
      p.currency !== 'INR' ||
      (isTestOrder && Number(p.amount) !== TEST_COUPON_PAISE)
    ) {
      throw fail(400, 'Payment details do not match the order');
    }
    return p.status;
  }

  // Idempotent Payment Completion
  async function completePaid(order, paymentId) {
    // 1. Atomic status transition: only one caller claims the order
    let claimed = null;
    try {
      const { data } = await db.from('payment_orders')
        .update({
          status: 'paid',
          razorpay_payment_id: paymentId,
          paid_at: new Date().toISOString()
        })
        .eq('id', order.id)
        .in('status', ['created', 'cancelled'])
        .select().maybeSingle();
      claimed = data;
    } catch {}

    if (!claimed && localOrders.has(order.razorpay_order_id)) {
      const local = localOrders.get(order.razorpay_order_id);
      if (['created', 'cancelled'].includes(local.status)) {
        local.status = 'paid';
        local.razorpay_payment_id = paymentId;
        local.paid_at = new Date().toISOString();
        claimed = local;
      }
    }

    if (!claimed) {
      // Order already claimed and processed; return existing enrollment idempotently
      try {
        const { data: ex } = await db.from('enrollments')
          .select('*, courses(title,description,duration,skills,benefits,access_url)')
          .eq('payment_order_id', order.id)
          .maybeSingle();
        if (ex) return ex;
      } catch {}
      for (const en of localEnrollments.values()) {
        if (en.payment_order_id === order.id) return en;
      }
      return null;
    }

    // 2-4. Provision Student ID, Receipt No, and Portal Password
    const { prof, studentId, receiptNo, portalPassword, userEmail } = await provisionStudentCredentials(order.user_id);

    // 5. Fetch course and coupon
    let course = null, coupon = null;
    try {
      const { data: cData } = await db.from('courses').select('*').eq('id', order.course_id).single();
      course = cData;
    } catch {}
    coupon = (await resolveCouponById(db, order.coupon_id)) || (order.coupon_code ? await resolveCouponByCode(db, order.coupon_code) : null);

    if (!course) {
      course = { id: order.course_id, title: 'Winter Internship Program Track', duration: '30 Hours' };
    }
    const orderIsTest = isTestTransactionRecord(order) || isTestCoupon(coupon);
    if (!coupon) {
      coupon = orderIsTest
        ? { id: order.coupon_id, code: TEST_COUPON_CODE, is_test: true, discount_percent: 99, fixed_payable_paise: TEST_COUPON_PAISE }
        : { id: order.coupon_id, code: order.coupon_code || 'WIN-OFFICIAL' };
    }

    let resolvedBatchId = order.batch_id || coupon.batch_id || null;
    if (!resolvedBatchId) {
      try {
        const b = await activeBatch();
        resolvedBatchId = b?.id || null;
      } catch {}
    }

    // 6. Complete enrollment
    const enr = await enroll({
      userId: order.user_id,
      course,
      coupon,
      kind: 'paid',
      orderId: order.id,
      amount: order.amount_paise,
      txRef: paymentId,
      studentId,
      receiptNo,
      batchId: resolvedBatchId,
      isTest: orderIsTest
    });

    // 7. Dispatch credentials and payment receipt email
    if (userEmail) {
      sendEnrollmentReceiptEmail({
        studentName: prof?.full_name || 'Candidate',
        studentId,
        email: userEmail,
        password: portalPassword,
        courseTitle: course.title,
        duration: course.duration,
        receiptNo,
        transactionRef: paymentId,
        enrollmentId: enr.id,
        amountPaise: order.amount_paise,
        basePricePaise: Number(course.base_price_paise) || BASE_PRICE_PAISE,
        couponCode: coupon.code
      }).catch(err => console.error('[Enrollment Receipt Email Error]', err));
    }

    return { ...enr, _portalPassword: portalPassword };
  }

  // Frontend Signature Verification Endpoint (Never Trusting Frontend Amount)
  app.post('/api/checkout/verify', auth, wrap(async (req, res) => {
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig, amount: clientAmount } = req.body || {};
    if (!oid || !pid) throw fail(400, 'Order ID and Payment ID are required.');

    let order = null;
    try {
      const { data } = await db.from('payment_orders').select('*').eq('razorpay_order_id', oid).eq('user_id', req.user.id).maybeSingle();
      order = data;
    } catch {}

    if (!order && localOrders.has(oid)) {
      const localOrder = localOrders.get(oid);
      if (localOrder.user_id === req.user.id) order = localOrder;
    }
    if (!order) throw fail(404, 'Order record not found.');

    if (clientAmount !== undefined && Number(clientAmount) !== Number(order.amount_paise)) {
      throw fail(400, 'Payment amount does not match order.');
    }
    if (isTestTransactionRecord(order) && Number(order.amount_paise) !== TEST_COUPON_PAISE) {
      throw fail(400, 'Test coupon order amount mismatch.');
    }

    // Signature verification
    if (process.env.RAZORPAY_KEY_SECRET) {
      if (!sig || !verifySignature(oid, pid, sig, process.env.RAZORPAY_KEY_SECRET)) {
        throw fail(400, 'Invalid payment signature. Verification failed.');
      }
    }

    // Server-to-server Razorpay API confirmation
    const st = await confirmWithRazorpay(order, pid);
    if (st === 'captured') {
      const enr = await completePaid(order, pid);
      return res.json({
        status: enr ? 'enrolled' : 'pending',
        enrollmentId: enr?.id,
        studentId: enr?.student_id,
        receiptNo: enr?.receipt_no,
        portalPassword: enr?._portalPassword || null,
        orderId: oid,
        paymentId: pid,
        amountPaise: order.amount_paise,
        isTest: isTestTransactionRecord(order)
      });
    }

    res.json({ status: st === 'failed' ? 'failed' : 'pending' });
  }));

  // Failed payment recording
  app.post('/api/checkout/failed', auth, wrap(async (req, res) => {
    const { razorpay_order_id: oid, payment_id: pid, error: errDetail } = req.body || {};
    if (!oid || typeof oid !== 'string') throw fail(400, 'Order ID is required');
    const reason = String(errDetail?.description || errDetail?.reason || errDetail || 'Payment failed on Razorpay').slice(0, 255);

    try {
      await db.from('payment_orders')
        .update({
          status: 'failed',
          failure_reason: reason,
          razorpay_payment_id: pid || null
        })
        .eq('razorpay_order_id', oid)
        .eq('user_id', req.user.id)
        .eq('status', 'created');
    } catch {}

    if (localOrders.has(oid)) {
      const o = localOrders.get(oid);
      o.status = 'failed';
      o.failure_reason = reason;
      o.razorpay_payment_id = pid || null;
    }

    res.json({ ok: true, status: 'failed', reason });
  }));

  // Render-Compatible Razorpay Webhook Endpoints
  const webhookHandler = wrap(async (req, res) => {
    if (process.env.RAZORPAY_WEBHOOK_SECRET) {
      if (!verifyWebhook(req.rawBody, req.headers['x-razorpay-signature'], process.env.RAZORPAY_WEBHOOK_SECRET)) {
        throw fail(400, 'Invalid webhook signature');
      }
    }

    const ev = req.body;
    const pay = ev?.payload?.payment?.entity;
    const orderId = pay?.order_id || ev?.payload?.order?.entity?.id;

    if (['payment.captured', 'order.paid'].includes(ev?.event) && pay) {
      let order = null;
      try {
        const { data } = await db.from('payment_orders').select('*').eq('razorpay_order_id', orderId).maybeSingle();
        order = data;
      } catch {}
      if (!order && localOrders.has(orderId)) {
        order = localOrders.get(orderId);
      }

      if (order && (await confirmWithRazorpay(order, pay.id)) === 'captured') {
        await completePaid(order, pay.id);
      }
    } else if (ev?.event === 'payment.failed' && pay) {
      const reason = pay.error_description || pay.error_reason || 'Payment failed via webhook';
      try {
        await db.from('payment_orders')
          .update({ status: 'failed', failure_reason: reason, razorpay_payment_id: pay.id || null })
          .eq('razorpay_order_id', orderId)
          .eq('status', 'created');
      } catch {}
      if (localOrders.has(orderId)) {
        const o = localOrders.get(orderId);
        o.status = 'failed';
        o.failure_reason = reason;
        o.razorpay_payment_id = pay.id || null;
      }
    }

    try {
      await db.from('payment_events').insert({
        event_id: req.headers['x-razorpay-event-id'] || null,
        type: ev?.event,
        razorpay_order_id: orderId || null,
        payload: ev
      });
    } catch {}

    res.json({ ok: true, received: true });
  });

  app.post('/api/webhooks/razorpay', webhookHandler);
  app.post('/webhooks/razorpay', webhookHandler);

  // Official Payment Receipt PDF Download Endpoint
  app.get('/api/enrollments/:id/receipt.pdf', auth, wrap(async (req, res) => {
    let enr = null;
    try {
      const { data } = await db.from('enrollments')
        .select('*, courses(title,duration), payment_orders(razorpay_payment_id,paid_at,amount_paise)')
        .eq('id', req.params.id)
        .maybeSingle();
      enr = data;
    } catch {}

    if (!enr) {
      for (const e of localEnrollments.values()) {
        if (e.id === req.params.id) { enr = e; break; }
      }
    }
    if (!enr) throw fail(404, 'Enrollment not found');

    let prof = null;
    try {
      const { data } = await db.from('profiles').select('role,full_name,phone,student_id').eq('id', req.user.id).single();
      prof = data;
    } catch {}

    if (enr.user_id !== req.user.id && prof?.role !== 'admin') throw fail(403, 'Unauthorized');

    let studentEmail = req.user.email;
    if (enr.user_id !== req.user.id) {
      try {
        const { data: u } = await db.auth.admin.getUserById(enr.user_id);
        studentEmail = u?.user?.email;
      } catch {}
    }

    let couponCode = enr.coupon_code || null;
    if (!couponCode && enr.coupon_id) {
      const coup = await resolveCouponById(db, enr.coupon_id);
      couponCode = coup?.code || null;
    }
    if (!couponCode && Number(enr.amount_paise) === TEST_COUPON_PAISE) {
      couponCode = TEST_COUPON_CODE;
    }

    const pdfBuf = await buildReceiptPDF({
      receiptNo: enr.receipt_no || receiptId(enr.id),
      paidAt: enr.payment_orders?.paid_at || enr.enrolled_at,
      name: prof?.full_name || 'Student Candidate',
      studentId: enr.student_id || prof?.student_id || 'PGI-S26',
      email: studentEmail,
      phone: prof?.phone || '-',
      course: enr.courses?.title || 'Winter Internship Technical Track',
      duration: enr.courses?.duration || '30 Hours (10 Days)',
      couponCode,
      amountPaise: enr.amount_paise ?? 99900,
      basePricePaise: BASE_PRICE_PAISE,
      transactionRef: enr.transaction_ref || enr.payment_orders?.razorpay_payment_id
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Receipt-${enr.receipt_no || enr.id}.pdf"`,
      'Cache-Control': 'private, no-store'
    }).send(pdfBuf);
  }));

  async function buildDashboardPayload(user, pre = {}) {
    const u = user.id;
    let b = pre.batch !== undefined ? pre.batch : null;
    if (pre.batch === undefined) {
      try { b = await activeBatch(true); } catch {}
    }
    const bid = b?.id || NO_BATCH;

    let prof = pre.prof ?? null, att = pre.att ?? null, coup = pre.coup ?? null, enr = pre.enr ?? null;
    if (!pre.prefetched) {
      try {
        const [pRes, aRes, cRes, eRes] = await Promise.all([
          db.from('profiles').select('full_name,phone,student_id').eq('id', u).single(),
          db.from('assessment_attempts').select('id,status,correct_count,total_questions,score_percent,submitted_at').eq('user_id', u).eq('batch_id', bid).order('started_at', { ascending: false }).limit(1).maybeSingle(),
          db.from('scholarship_coupons').select('*').eq('user_id', u).eq('batch_id', bid).maybeSingle(),
          db.from('enrollments').select('*, courses(title,description,duration,skills,benefits,access_url)').eq('user_id', u).order('enrolled_at', { ascending: false }).limit(1).maybeSingle()
        ]);
        prof = pRes.data;
        att = aRes.data;
        coup = cRes.data;
        enr = eRes.data;
      } catch {}
    }

    if (!enr) {
      enr = localEnrollments.get(u) || null;
      if (!enr) {
        for (const e of localEnrollments.values()) {
          if (e.user_id === u) { enr = e; break; }
        }
      }
    }
    if (!coup && enr) {
      coup = (await resolveCouponById(db, enr.coupon_id)) || (enr.coupon_code ? await resolveCouponByCode(db, enr.coupon_code) : null);
    }

    let orderRefId = null;
    if (enr?.payment_order_id) {
      try {
        const { data: po } = await db.from('payment_orders').select('razorpay_order_id').eq('id', enr.payment_order_id).maybeSingle();
        if (po?.razorpay_order_id) orderRefId = po.razorpay_order_id;
      } catch {}
      if (!orderRefId) {
        for (const lo of localOrders.values()) {
          if (lo.id === enr.payment_order_id) { orderRefId = lo.razorpay_order_id; break; }
        }
      }
    }

    const course = enr?.courses || { title: 'Winter Internship Program', duration: '30 Hours' };
    const portalAccessKey = (!user?.user_metadata?.password_customized && user?.user_metadata?.portal_access_key)
      ? user.user_metadata.portal_access_key
      : null;

    return {
      email: user.email,
      profile: prof,
      studentId: enr?.student_id || prof?.student_id || null,
      portalAccessKey,
      attempt: att,
      coupon: coup && {
        code: coup.code,
        discountPercent: Number(coup.discount_percent) === 85
          ? 88
          : (Number(coup.discount_percent) === 100 ? 90 : Number(coup.discount_percent)),
        issuedAt: coup.issued_at,
        expiresAt: coup.expires_at,
        state: couponState(coup)
      },
      enrollment: enr && {
        id: enr.id,
        studentId: enr.student_id || prof?.student_id,
        portalAccessKey,
        receiptNo: enr.receipt_no,
        kind: enr.kind,
        status: enr.status,
        amountPaise: enr.amount_paise,
        basePricePaise: BASE_PRICE_PAISE,
        couponCode: enr.coupon_code || coup?.code || null,
        discountPercent: coup?.discount_percent ?? null,
        orderId: orderRefId,
        transactionRef: enr.transaction_ref,
        enrolledAt: enr.enrolled_at,
        course: {
          title: course.title,
          description: course.description,
          duration: course.duration,
          skills: course.skills,
          benefits: course.benefits,
          accessUrl: enr.status === 'active' ? course.access_url : null
        }
      }
    };
  }

  // Student Dashboard Endpoint
  app.get('/api/dashboard', auth, wrap(async (req, res) => {
    res.json(await buildDashboardPayload(req.user));
  }));

  // Offer Letter PDF Download Endpoint
  app.get('/api/offer-letter', auth, wrap(async (req, res) => {
    let b = null;
    try { b = await activeBatch(true); } catch {}
    const bid = b?.id || NO_BATCH;

    let e = null;
    try {
      const { data } = await db.from('enrollments').select('id,kind,amount_paise,transaction_ref,enrolled_at,courses(title,duration)').eq('user_id', req.user.id).eq('batch_id', bid).eq('status', 'active').maybeSingle();
      e = data;
    } catch {}

    if (!e) {
      for (const en of localEnrollments.values()) {
        if (en.user_id === req.user.id) { e = en; break; }
      }
    }
    if (!e) throw fail(403, 'No active enrollment found');

    let prof = null;
    try {
      const { data } = await db.from('profiles').select('full_name,phone').eq('id', req.user.id).single();
      prof = data;
    } catch {}

    let appRec = null;
    try {
      const { data } = await db
        .from('internship_applications')
        .select('full_name,address,domain_name,mode,duration,phone')
        .ilike('email', req.user.email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      appRec = data;
    } catch {}

    if (!appRec && localApplications) {
      for (const a of localApplications.values()) {
        if (String(a.email || '').toLowerCase() === String(req.user.email || '').toLowerCase()) {
          appRec = a;
          break;
        }
      }
    }

    const buf = await buildOfferPDF({
      name: appRec?.full_name || prof?.full_name || req.user.user_metadata?.full_name || 'Candidate',
      address: appRec?.address || '',
      email: req.user.email,
      phone: appRec?.phone || prof?.phone || '',
      domain: appRec?.domain_name || e.courses?.title || 'Full-Stack Web Development',
      course: e.courses?.title || appRec?.domain_name || 'Winter Internship Program',
      mode: appRec?.mode || 'Online',
      duration: '30 hours',
      enrollmentId: e.id,
      transactionRef: e.transaction_ref,
      enrolledAt: e.enrolled_at,
      kind: e.kind,
      amountPaise: e.amount_paise
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${offerId(e.id)}.pdf"`,
      'Cache-Control': 'private, no-store'
    }).send(buf);
  }));

  return { buildDashboardPayload };
}
