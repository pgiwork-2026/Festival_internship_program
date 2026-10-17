import { couponState, payablePaise } from './logic.js';
import { buildOfferPDF, offerId } from './offer.js';
import { createOrder, fetchPayment, verifySignature, verifyWebhook } from './razorpay.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function registerPayments(app, { db, auth, wrap, fail }) {
  app.get('/api/courses', auth, wrap(async (_q, res) => {
    const { data } = await db.from('courses').select('id,title,description,duration,skills,benefits,base_price_paise').eq('active', true); res.json(data);
  }));

  async function eligibleCoupon(userId) {
    const { data: c } = await db.from('scholarship_coupons').select('*').eq('user_id', userId).maybeSingle();
    if (!c) throw fail(403, 'No scholarship coupon. Complete the assessment first.');
    const { data: e } = await db.from('enrollments').select('id').eq('user_id', userId).maybeSingle();
    if (e) throw fail(409, 'You are already enrolled');
    return c;
  }
  // Single controlled enrollment path (paid + free). DB uniqueness on coupon_id/user_id makes it idempotent.
  async function enroll({ userId, course, coupon, kind, orderId, amount, txRef }) {
    const { data, error } = await db.from('enrollments').insert({ user_id: userId, course_id: course.id, coupon_id: coupon.id, payment_order_id: orderId || null, amount_paise: amount, kind, transaction_ref: txRef }).select().single();
    let enr = data;
    if (error) { const { data: ex } = await db.from('enrollments').select('*').eq('user_id', userId).maybeSingle(); if (!ex) throw fail(500, 'Enrollment failed'); enr = ex; }
    await db.from('scholarship_coupons').update({ status: 'redeemed', redeemed_at: new Date().toISOString(), course_id: course.id }).eq('id', coupon.id).eq('status', 'active');
    // Privacy: once the student is enrolled (payment done), delete their proctoring evidence images. Violation records (type/time/counts) are kept; failures here never block enrollment.
    try {
      const { data: atts } = await db.from('assessment_attempts').select('id').eq('user_id', userId);
      const ids = (atts || []).map(a => a.id);
      if (ids.length) await db.from('proctoring_violations').update({ snapshot: null }).in('attempt_id', ids).not('snapshot', 'is', null);
    } catch (e) { console.error('evidence cleanup failed', e?.message || e); }
    return enr;
  }

  app.post('/api/checkout/create', auth, wrap(async (req, res) => {
    const coupon = await eligibleCoupon(req.user.id);
    if (couponState(coupon) !== 'active') throw fail(410, 'Your coupon has expired or was already used');
    const { data: course } = await db.from('courses').select('*').eq('id', String(req.body?.courseId || '')).eq('active', true).maybeSingle();
    if (!course) throw fail(404, 'Course not found');
    const amount = payablePaise(course.base_price_paise, coupon.discount_percent); // server-side only
    if (amount === 0) { // free enrollment only for a verified 100% score
      if (coupon.discount_percent !== 100 || Number(coupon.score_percent) !== 100) throw fail(403, 'Not eligible for free enrollment');
      const enr = await enroll({ userId: req.user.id, course, coupon, kind: 'free', amount: 0, txRef: 'FREE-' + coupon.code });
      return res.json({ status: 'enrolled', enrollmentId: enr.id });
    }
    const { data: open } = await db.from('payment_orders').select('*').eq('coupon_id', coupon.id).eq('status', 'created');
    const same = open.find(o => o.course_id === course.id && o.amount_paise === amount);
    for (const o of open) if (o !== same) await db.from('payment_orders').update({ status: 'cancelled' }).eq('id', o.id).eq('status', 'created');
    let order = same;
    if (!order) { // retries reuse the open order => no duplicate orders/charges
      const rz = await createOrder({ amount, receipt: 'c_' + coupon.id.slice(0, 30), notes: { coupon: coupon.code, course: course.id } });
      const { data, error } = await db.from('payment_orders').insert({ user_id: req.user.id, course_id: course.id, coupon_id: coupon.id, amount_paise: amount, razorpay_order_id: rz.id }).select().single();
      if (error) throw fail(409, 'Could not create the order, please retry');
      order = data;
    }
    res.json({ status: 'payment_required', orderId: order.razorpay_order_id, amount: order.amount_paise, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID });
  }));

  async function confirmWithRazorpay(order, paymentId) { // trusted server-to-server status check
    const p = await fetchPayment(paymentId);
    if (p.order_id !== order.razorpay_order_id || p.amount !== order.amount_paise || p.currency !== 'INR') throw fail(400, 'Payment details do not match the order');
    return p.status;
  }
  async function completePaid(order, paymentId) { // idempotent: only one caller can claim the order
    const { data: claimed } = await db.from('payment_orders').update({ status: 'paid', razorpay_payment_id: paymentId, paid_at: new Date().toISOString() }).eq('id', order.id).in('status', ['created', 'cancelled']).select().maybeSingle();
    if (!claimed) { const { data: e } = await db.from('enrollments').select('*').eq('payment_order_id', order.id).maybeSingle(); return e; }
    const { data: course } = await db.from('courses').select('*').eq('id', order.course_id).single();
    const { data: coupon } = await db.from('scholarship_coupons').select('*').eq('id', order.coupon_id).single();
    const enr = await enroll({ userId: order.user_id, course, coupon, kind: 'paid', orderId: order.id, amount: order.amount_paise, txRef: paymentId });
    if (enr.payment_order_id !== order.id) await db.from('payment_orders').update({ status: 'needs_refund' }).eq('id', order.id); // paid twice: flag for manual refund
    return enr;
  }

  app.post('/api/checkout/verify', auth, wrap(async (req, res) => {
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body || {};
    if (![oid, pid, sig].every(x => typeof x === 'string' && x.length < 100)) throw fail(400, 'Bad input');
    const { data: order } = await db.from('payment_orders').select('*').eq('razorpay_order_id', oid).eq('user_id', req.user.id).maybeSingle();
    if (!order) throw fail(404, 'Order not found');
    if (!verifySignature(oid, pid, sig, process.env.RAZORPAY_KEY_SECRET)) throw fail(400, 'Invalid payment signature');
    const st = await confirmWithRazorpay(order, pid);
    if (st === 'captured') { const enr = await completePaid(order, pid); return res.json({ status: enr ? 'enrolled' : 'pending' }); }
    res.json({ status: st === 'failed' ? 'failed' : 'pending' });
  }));

  app.post('/api/webhooks/razorpay', wrap(async (req, res) => {
    if (!verifyWebhook(req.rawBody, req.headers['x-razorpay-signature'], process.env.RAZORPAY_WEBHOOK_SECRET)) throw fail(400, 'Bad signature');
    const ev = req.body, pay = ev?.payload?.payment?.entity;
    if (['payment.captured', 'order.paid'].includes(ev?.event) && pay) {
      const { data: order } = await db.from('payment_orders').select('*').eq('razorpay_order_id', pay.order_id).maybeSingle();
      if (order && (await confirmWithRazorpay(order, pay.id)) === 'captured') await completePaid(order, pay.id);
    }
    // log after processing so a failed run is retried by Razorpay; duplicates are harmless (idempotent) and de-duplicated here
    await db.from('payment_events').insert({ event_id: req.headers['x-razorpay-event-id'] || null, type: ev?.event, razorpay_order_id: pay?.order_id || null, payload: ev });
    res.json({ ok: true });
  }));

  app.get('/api/dashboard', auth, wrap(async (req, res) => {
    const u = req.user.id;
    const [p, a, c, e] = await Promise.all([
      db.from('profiles').select('full_name,phone').eq('id', u).single(),
      db.from('assessment_attempts').select('id,status,correct_count,total_questions,score_percent,submitted_at').eq('user_id', u).order('started_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('scholarship_coupons').select('*').eq('user_id', u).maybeSingle(),
      db.from('enrollments').select('*, courses(title,description,duration,skills,benefits,access_url)').eq('user_id', u).maybeSingle()]);
    const enr = e.data; const course = enr?.courses;
    res.json({ email: req.user.email, profile: p.data, attempt: a.data,
      coupon: c.data && { code: c.data.code, discountPercent: c.data.discount_percent, issuedAt: c.data.issued_at, expiresAt: c.data.expires_at, state: couponState(c.data) },
      enrollment: enr && { id: enr.id, kind: enr.kind, status: enr.status, amountPaise: enr.amount_paise, transactionRef: enr.transaction_ref, enrolledAt: enr.enrolled_at,
        course: { title: course.title, description: course.description, duration: course.duration, skills: course.skills, benefits: course.benefits, accessUrl: enr.status === 'active' ? course.access_url : null } } });
  }));

  app.get('/api/offer-letter', auth, wrap(async (req, res) => { // only for active enrollments
    const { data: e } = await db.from('enrollments').select('id,kind,amount_paise,transaction_ref,enrolled_at,courses(title,duration)').eq('user_id', req.user.id).eq('status', 'active').maybeSingle();
    if (!e) throw fail(403, 'No active enrollment');
    const { data: p } = await db.from('profiles').select('full_name,phone').eq('id', req.user.id).single();
    const buf = await buildOfferPDF({ name: p.full_name, email: req.user.email, phone: p.phone, course: e.courses.title, duration: e.courses.duration, enrollmentId: e.id, transactionRef: e.transaction_ref, enrolledAt: e.enrolled_at, kind: e.kind, amountPaise: e.amount_paise });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${offerId(e.id)}.pdf"`, 'Cache-Control': 'private, no-store' }).send(buf);
  }));
}