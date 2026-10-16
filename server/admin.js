import { VIOLATION_LABELS } from './logic.js';
// Admin API: every route requires a valid login AND profiles.role = 'admin' (checked on the server).
export function mountAdmin({ app, db, auth, wrap, fail, reportData, sendPdf, buildReportPDF, reportId }) {
  const adminOnly = async (req, _res, next) => { try { const { data } = await db.from('profiles').select('role').eq('id', req.user.id).single(); data?.role === 'admin' ? next() : next(fail(403, 'Admin access only')); } catch (e) { next(e); } };
  const A = (m, p, f) => app[m]('/api/admin' + p, auth, adminOnly, wrap(f));
  const rows = async q => { const { data, error } = await q; if (error) throw fail(500, error.message); return data || []; };
  const people = async () => { const ps = await rows(db.from('profiles').select('id,full_name,phone,role,created_at').order('created_at', { ascending: false }).limit(2000));
    const { data: u } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 }); const em = Object.fromEntries((u?.users || []).map(x => [x.id, x.email])); return { ps, em, by: Object.fromEntries(ps.map(p => [p.id, p])) }; };

  A('get', '/overview', async (_q, res) => {
    const cnt = async (t, f) => { let q = db.from(t).select('*', { count: 'exact', head: true }); if (f) q = f(q); return (await q).count || 0; };
    const paid = await rows(db.from('payment_orders').select('amount_paise').eq('status', 'paid'));
    const [students, attempts, submitted, running, coupons, enrolled, pending, refund, viol] = await Promise.all([cnt('profiles', q => q.eq('role', 'student')), cnt('assessment_attempts'), cnt('assessment_attempts', q => q.neq('status', 'in_progress')),
      cnt('assessment_attempts', q => q.eq('status', 'in_progress')), cnt('scholarship_coupons'), cnt('enrollments', q => q.eq('status', 'active')), cnt('payment_orders', q => q.eq('status', 'created')), cnt('payment_orders', q => q.eq('status', 'needs_refund')), cnt('proctoring_violations', q => q.eq('counted', true))]);
    res.json({ students, attempts, submitted, running, coupons, enrolled, pending, refund, violations: viol, paidOrders: paid.length, revenuePaise: paid.reduce((s, x) => s + x.amount_paise, 0) });
  });

  A('get', '/students', async (_q, res) => {
    const { ps, em } = await people();
    const [at, cp, en] = await Promise.all([rows(db.from('assessment_attempts').select('id,user_id,status,score_percent,started_at').order('started_at', { ascending: false })), rows(db.from('scholarship_coupons').select('user_id,code,discount_percent,expires_at,status')), rows(db.from('enrollments').select('user_id,status,kind'))]);
    const first = (arr, id) => arr.find(x => x.user_id === id);
    res.json(ps.filter(p => p.role !== 'admin').map(p => { const a = first(at, p.id), c = first(cp, p.id), e = first(en, p.id);
      return { id: p.id, name: p.full_name, email: em[p.id], phone: p.phone, registered: p.created_at, attemptId: a?.id, status: a?.status, score: a?.score_percent, coupon: c && `${c.code} (${c.discount_percent}%)`, couponStatus: c?.status, enrolled: e ? e.status : '' }; }));
  });

  A('get', '/attempts', async (_q, res) => {
    const { em, by } = await people();
    const [at, vs, cp] = await Promise.all([rows(db.from('assessment_attempts').select('id,user_id,status,correct_count,total_questions,score_percent,started_at,submitted_at').order('started_at', { ascending: false }).limit(2000)), rows(db.from('proctoring_violations').select('attempt_id').eq('counted', true).limit(20000)), rows(db.from('scholarship_coupons').select('attempt_id,expires_at'))]);
    const vc = {}; vs.forEach(v => { vc[v.attempt_id] = (vc[v.attempt_id] || 0) + 1; });
    res.json(at.map(a => ({ ...a, name: by[a.user_id]?.full_name, email: em[a.user_id], violations: vc[a.id] || 0, hasCoupon: cp.some(c => c.attempt_id === a.id) })));
  });

  A('get', '/attempts/:id/evidence', async (req, res) => { // flagged events with their snapshots, for manual review
    const vs = await rows(db.from('proctoring_violations').select('type,counted,occurred_at,snapshot').eq('attempt_id', req.params.id).order('occurred_at'));
    res.json(vs.map(v => ({ label: VIOLATION_LABELS[v.type] || v.type, counted: v.counted !== false, at: v.occurred_at, snapshot: v.snapshot })));
  });

  A('get', '/payments', async (_q, res) => {
    const { by, em } = await people(); const cs = Object.fromEntries((await rows(db.from('courses').select('id,title'))).map(c => [c.id, c.title]));
    res.json((await rows(db.from('payment_orders').select('*').order('created_at', { ascending: false }).limit(2000))).map(o => ({ id: o.id, name: by[o.user_id]?.full_name, email: em[o.user_id], course: cs[o.course_id], amountPaise: o.amount_paise, status: o.status, orderId: o.razorpay_order_id, paymentId: o.razorpay_payment_id, created: o.created_at, paidAt: o.paid_at })));
  });

  A('get', '/enrollments', async (_q, res) => {
    const { by, em } = await people(); const cs = Object.fromEntries((await rows(db.from('courses').select('id,title'))).map(c => [c.id, c.title]));
    res.json((await rows(db.from('enrollments').select('*').order('enrolled_at', { ascending: false }).limit(2000))).map(e => ({ id: e.id, name: by[e.user_id]?.full_name, email: em[e.user_id], phone: by[e.user_id]?.phone, course: cs[e.course_id], kind: e.kind, amountPaise: e.amount_paise, ref: e.transaction_ref, status: e.status, enrolled: e.enrolled_at })));
  });

  A('get', '/attempts/:id/report.pdf', async (req, res) => {
    const { data: a } = await db.from('assessment_attempts').select('*').eq('id', req.params.id).maybeSingle(); if (!a) throw fail(404, 'attempt not found');
    sendPdf(res, await buildReportPDF(await reportData(a)), reportId(a.id) + '.pdf');
  });
  A('post', '/coupons/:attemptId/extend', async (req, res) => {
    const h = Math.min(Math.max(Number(req.body?.hours) || 24, 1), 168); const { data: c } = await db.from('scholarship_coupons').select('id,expires_at,status').eq('attempt_id', req.params.attemptId).maybeSingle();
    if (!c) throw fail(404, 'no coupon for this attempt'); if (c.status === 'redeemed') throw fail(409, 'coupon already redeemed');
    const exp = new Date(Math.max(Date.now(), new Date(c.expires_at).getTime()) + h * 3600e3).toISOString(); await rows(db.from('scholarship_coupons').update({ expires_at: exp }).eq('id', c.id).select('id')); res.json({ expiresAt: exp });
  });
  A('post', '/enrollments/:id/status', async (req, res) => {
    const s = req.body?.status; if (!['active', 'cancelled'].includes(s)) throw fail(400, 'invalid status'); await rows(db.from('enrollments').update({ status: s }).eq('id', req.params.id).select('id')); res.json({ ok: true });
  });
}