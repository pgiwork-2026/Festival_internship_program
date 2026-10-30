import { VIOLATION_LABELS } from './logic.js';
import { batchTools, bustBatchCache } from './batches.js';
// Admin API: every route requires a valid login AND profiles.role = 'admin' (checked on the server).
export function mountAdmin({ app, db, auth, wrap, fail, reportData, sendPdf, buildReportPDF, reportId }) {
  const adminOnly = async (req, _res, next) => { try { const { data } = await db.from('profiles').select('role').eq('id', req.user.id).single(); data?.role === 'admin' ? next() : next(fail(403, 'Admin access only')); } catch (e) { next(e); } };
  const A = (m, p, f) => app[m]('/api/admin' + p, auth, adminOnly, wrap(f));
  const rows = async q => { const { data, error } = await q; if (error) throw fail(500, error.message); return data || []; };
  const people = async () => { const ps = await rows(db.from('profiles').select('id,full_name,phone,role,created_at').order('created_at', { ascending: false }).limit(2000));
    const { data: u } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 }); const em = Object.fromEntries((u?.users || []).map(x => [x.id, x.email])); return { ps, em, by: Object.fromEntries(ps.map(p => [p.id, p])) }; };

  const { resolveBatch } = batchTools(db, fail), scope = q => resolveBatch(q.query.batch), S = (B, q) => B ? q.eq('batch_id', B.id) : q; // batch filter lives in the query, validated against the batches table
  const viol = (B, cols) => { let q = db.from('proctoring_violations').select(cols + ',assessment_attempts!inner(batch_id)', { count: 'exact' }).eq('counted', true); return B ? q.eq('assessment_attempts.batch_id', B.id) : q; };
  async function metrics(B) {
    const cnt = async (t, f) => (await f(S(B, db.from(t).select('*', { count: 'exact', head: true })))).count || 0, same = x => x;
    const regs = B ? db.from('batch_registrations').select('*', { count: 'exact', head: true }).eq('batch_id', B.id) : db.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student');
    const [paid, att, students, attempts, submitted, running, coupons, redeemed, enrolled, enrollTotal, pending, failed, refund, v] = await Promise.all([
      rows(S(B, db.from('payment_orders').select('amount_paise').eq('status', 'paid').not('razorpay_payment_id', 'is', null).limit(50000))), rows(S(B, db.from('assessment_attempts').select('user_id').limit(50000))),
      regs.then(r => r.count || 0), cnt('assessment_attempts', same), cnt('assessment_attempts', q => q.neq('status', 'in_progress')), cnt('assessment_attempts', q => q.eq('status', 'in_progress')),
      cnt('scholarship_coupons', same), cnt('scholarship_coupons', q => q.eq('status', 'redeemed')), cnt('enrollments', q => q.eq('status', 'active')), cnt('enrollments', same),
      cnt('payment_orders', q => q.eq('status', 'created')), cnt('payment_orders', q => q.eq('status', 'cancelled')), cnt('payment_orders', q => q.eq('status', 'needs_refund')), viol(B, 'id').limit(1).then(r => r.count || 0)]);
    return { students, attempts, participants: new Set(att.map(a => a.user_id)).size, submitted, running, coupons, redeemed, enrolled, enrollTotal, pending, failed, refund, violations: v, paidOrders: paid.length, revenuePaise: paid.reduce((s, x) => s + x.amount_paise, 0) }; // revenue = verified paid transactions only (razorpay_payment_id set by signature + server-to-server check)
  }
  A('get', '/overview', async (q, res) => { res.json(await metrics(await scope(q))); });

  A('get', '/students', async (q, res) => {
    const B = await scope(q); let { ps, em } = await people(); if (B) { const rg = new Set((await rows(db.from('batch_registrations').select('user_id').eq('batch_id', B.id).limit(50000))).map(r => r.user_id)); ps = ps.filter(p => rg.has(p.id)); }
    const [at, cp, en] = await Promise.all([rows(S(B, db.from('assessment_attempts').select('id,user_id,status,score_percent,started_at')).order('started_at', { ascending: false })), rows(S(B, db.from('scholarship_coupons').select('user_id,code,discount_percent,expires_at,status'))), rows(S(B, db.from('enrollments').select('user_id,status,kind')))]);
    const first = (arr, id) => arr.find(x => x.user_id === id);
    res.json(ps.filter(p => p.role !== 'admin').map(p => { const a = first(at, p.id), c = first(cp, p.id), e = first(en, p.id);
      return { id: p.id, name: p.full_name, email: em[p.id], phone: p.phone, registered: p.created_at, attemptId: a?.id, status: a?.status, score: a?.score_percent, coupon: c && `${c.code} (${c.discount_percent}%)`, couponStatus: c?.status, enrolled: e ? e.status : '' }; }));
  });

  A('get', '/attempts', async (q, res) => {
    const B = await scope(q), { em, by } = await people();
    const [at, vs, cp] = await Promise.all([rows(S(B, db.from('assessment_attempts').select('id,user_id,status,correct_count,total_questions,score_percent,started_at,submitted_at')).order('started_at', { ascending: false }).limit(2000)), rows(viol(B, 'attempt_id').limit(20000)), rows(S(B, db.from('scholarship_coupons').select('attempt_id,expires_at')))]);
    const vc = {}; vs.forEach(v => { vc[v.attempt_id] = (vc[v.attempt_id] || 0) + 1; });
    res.json(at.map(a => ({ ...a, name: by[a.user_id]?.full_name, email: em[a.user_id], violations: vc[a.id] || 0, hasCoupon: cp.some(c => c.attempt_id === a.id) })));
  });

  A('get', '/attempts/:id/evidence', async (req, res) => { // flagged events with their snapshots, for manual review
    const vs = await rows(db.from('proctoring_violations').select('type,counted,occurred_at,snapshot').eq('attempt_id', req.params.id).order('occurred_at'));
    res.json(vs.map(v => ({ label: VIOLATION_LABELS[v.type] || v.type, counted: v.counted !== false, at: v.occurred_at, snapshot: v.snapshot })));
  });

  A('get', '/payments', async (q, res) => {
    const B = await scope(q), { by, em } = await people(); const cs = Object.fromEntries((await rows(db.from('courses').select('id,title'))).map(c => [c.id, c.title]));
    res.json((await rows(S(B, db.from('payment_orders').select('*')).order('created_at', { ascending: false }).limit(2000))).map(o => ({ id: o.id, name: by[o.user_id]?.full_name, email: em[o.user_id], course: cs[o.course_id], amountPaise: o.amount_paise, status: o.status, orderId: o.razorpay_order_id, paymentId: o.razorpay_payment_id, created: o.created_at, paidAt: o.paid_at })));
  });

  A('get', '/enrollments', async (q, res) => {
    const B = await scope(q), { by, em } = await people(); const cs = Object.fromEntries((await rows(db.from('courses').select('id,title'))).map(c => [c.id, c.title]));
    res.json((await rows(S(B, db.from('enrollments').select('*')).order('enrolled_at', { ascending: false }).limit(2000))).map(e => ({ id: e.id, name: by[e.user_id]?.full_name, email: em[e.user_id], phone: by[e.user_id]?.phone, course: cs[e.course_id], kind: e.kind, amountPaise: e.amount_paise, ref: e.transaction_ref, status: e.status, enrolled: e.enrolled_at })));
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

  // ---- Batch management ----
  const slugify = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const dateOk = v => v == null || v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);
  const fields = b => { const name = String(b?.name || '').trim(); if (name.length < 2 || name.length > 80) throw fail(400, 'Enter a batch name'); if (!dateOk(b?.starts_on) || !dateOk(b?.ends_on)) throw fail(400, 'Invalid date');
    if (b.starts_on && b.ends_on && b.ends_on < b.starts_on) throw fail(400, 'End date is before start date'); return { name, starts_on: b.starts_on || null, ends_on: b.ends_on || null, description: String(b?.description || '').slice(0, 500) || null }; };
  const dbErr = e => e ? (e.code === '23505' ? fail(409, /one_active/.test(e.message) ? 'Another batch is already active. Deactivate it first.' : 'A batch with this name already exists') : fail(500, e.message)) : null;
  A('get', '/batches', async (_q, res) => res.json(await rows(db.from('batches').select('*').order('starts_on', { ascending: false, nullsFirst: true }).order('created_at', { ascending: false }))));
  A('post', '/batches', async (req, res) => { const f = fields(req.body); const { data, error } = await db.from('batches').insert({ ...f, slug: slugify(f.name), status: 'upcoming' }).select().single(); if (error) throw dbErr(error); res.json(data); });
  A('post', '/batches/:id', async (req, res) => { const B = await resolveBatch(req.params.id); const { data, error } = await db.from('batches').update({ ...fields(req.body), updated_at: new Date().toISOString() }).eq('id', B.id).select().single(); if (error) throw dbErr(error); bustBatchCache(); res.json(data); });
  A('post', '/batches/:id/status', async (req, res) => { const s = req.body?.status; if (!['upcoming', 'active', 'inactive', 'completed'].includes(s)) throw fail(400, 'invalid status'); const B = await resolveBatch(req.params.id);
    const { data, error } = await db.from('batches').update({ status: s, updated_at: new Date().toISOString() }).eq('id', B.id).select().single(); if (error) throw dbErr(error); bustBatchCache(); res.json(data); });
  A('get', '/batches/:id/summary', async (req, res) => { const B = await resolveBatch(req.params.id); res.json({ batch: B, ...await metrics(B) }); });
  const coupons = async B => { const { by, em } = await people(); return (await rows(S(B, db.from('scholarship_coupons').select('*')).order('issued_at', { ascending: false }).limit(5000))).map(c => ({ name: by[c.user_id]?.full_name, email: em[c.user_id], code: c.code, discount: c.discount_percent, score: c.score_percent, issued: c.issued_at, expires: c.expires_at, status: c.status, redeemed: c.redeemed_at })); };
  A('get', '/coupons', async (q, res) => res.json(await coupons(await scope(q))));
  A('get', '/batches/:id/export.xlsx', async (req, res) => { // every sheet is filtered by this one validated batch id
    const B = await resolveBatch(req.params.id); let ExcelJS; try { ({ default: ExcelJS } = await import('exceljs')); } catch { throw fail(501, 'Excel export needs the exceljs package (run npm install in /server)'); }
    const { ps, em, by } = await people(), cs = Object.fromEntries((await rows(db.from('courses').select('id,title'))).map(c => [c.id, c.title])), m = await metrics(B);
    const [rg, at, od, en] = await Promise.all([rows(db.from('batch_registrations').select('user_id,registered_at').eq('batch_id', B.id).limit(50000)), rows(db.from('assessment_attempts').select('*').eq('batch_id', B.id).limit(50000)), rows(db.from('payment_orders').select('*').eq('batch_id', B.id).limit(50000)), rows(db.from('enrollments').select('*').eq('batch_id', B.id).limit(50000))]);
    const wb = new ExcelJS.Workbook(), sheet = (n, head, data) => { const w = wb.addWorksheet(n); w.addRow(head).font = { bold: true }; data.forEach(r => w.addRow(r)); w.columns.forEach(c => { c.width = 22; }); return w; };
    sheet('Summary', ['Metric', 'Value'], [['Batch', B.name], ['Status', B.status], ['Total registrations', m.students], ['Assessment participants', m.participants], ['Assessments completed', m.submitted], ['Successful payments', m.paidOrders], ['Pending payments', m.pending], ['Failed/cancelled payments', m.failed], ['Money collected (INR)', m.revenuePaise / 100], ['Coupons generated', m.coupons], ['Coupons redeemed', m.redeemed], ['Course enrollments', m.enrollTotal]]);
    sheet('Registrations', ['Name', 'Email', 'Phone', 'Registered'], rg.map(r => [by[r.user_id]?.full_name, em[r.user_id], by[r.user_id]?.phone, r.registered_at]));
    sheet('Assessments', ['Name', 'Email', 'Started', 'Status', 'Correct', 'Total', 'Score %'], at.map(a => [by[a.user_id]?.full_name, em[a.user_id], a.started_at, a.status, a.correct_count, a.total_questions, a.score_percent]));
    sheet('Coupons', ['Name', 'Email', 'Code', 'Discount %', 'Score %', 'Issued', 'Expires', 'Status', 'Redeemed'], (await coupons(B)).map(c => [c.name, c.email, c.code, c.discount, c.score, c.issued, c.expires, c.status, c.redeemed]));
    sheet('Payments', ['Student', 'Email', 'Course', 'Amount (INR)', 'Status', 'Order ID', 'Payment ID', 'Created', 'Paid at'], od.map(o => [by[o.user_id]?.full_name, em[o.user_id], cs[o.course_id], o.amount_paise / 100, o.status, o.razorpay_order_id, o.razorpay_payment_id, o.created_at, o.paid_at]));
    sheet('Enrollments', ['Student', 'Email', 'Course', 'Type', 'Amount (INR)', 'Txn ref', 'Status', 'Enrolled'], en.map(e => [by[e.user_id]?.full_name, em[e.user_id], cs[e.course_id], e.kind, e.amount_paise / 100, e.transaction_ref, e.status, e.enrolled_at]));
    const day = {}; od.filter(o => o.status === 'paid' && o.razorpay_payment_id).forEach(o => { const d = String(o.paid_at).slice(0, 10); (day[d] = day[d] || [0, 0])[0]++; day[d][1] += o.amount_paise / 100; });
    sheet('Revenue', ['Date', 'Verified payments', 'Collected (INR)'], Object.entries(day).sort().map(([d, [n, a]]) => [d, n, a]));
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${B.slug}-report.xlsx"` }).send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
}