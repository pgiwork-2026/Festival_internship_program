import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mountAdmin } from './admin.js';
import { createClient } from '@supabase/supabase-js';
import { registerPayments } from './payments.js';
import { tierFor, payablePaise, scorePercent, shuffle, makeCouponCode, couponState, validateAnswer, BASE_PRICE_PAISE, VIOLATION_TYPES, violationDecision, MAX_WARNINGS, STATUS_TEXT, ADVISORY_TYPES, MAX_SNAPSHOTS, ADVISORY_GAP_MS, cleanSnapshot } from './logic.js';
import { buildReportPDF, reportId, fmtDate } from './report.js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const app = express(); app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
const VIOLATIONS = VIOLATION_TYPES;
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const wrap = f => (req, res) => f(req, res).catch(e => { console.error(req.method, req.url, e); res.status(e.status || 400).json({ error: e.message }); });
const fail = (status, message) => Object.assign(new Error(message), { status });

const authCache = new Map(); // token -> { user, exp }: skips the Supabase Auth round trip on every request (30 s)
async function auth(req, _res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', ''), hit = authCache.get(t);
  if (hit && hit.exp > Date.now()) { req.user = hit.user; return next(); }
  const { data, error } = await db.auth.getUser(t);
  if (error || !data.user) return next(fail(401, 'unauthorized'));
  if (authCache.size > 500) authCache.clear(); authCache.set(t, { user: data.user, exp: Date.now() + 30000 });
  req.user = data.user; next();
}
const settings = async () => (await db.from('test_settings').select('*').single()).data;
async function ownAttempt(req) { // ownership enforced server-side
  const { data } = await db.from('assessment_attempts').select('*').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (!data) throw fail(404, 'attempt not found'); return data;
}
async function view(a) { // questions WITHOUT correct answers, in the stored shuffled order
  const { data: qs } = await db.from('questions').select('id,text,options').in('id', a.question_order.map(x => x.q));
  const { data: rs } = await db.from('responses').select('question_id,selected_option_id').eq('attempt_id', a.id);
  const byId = Object.fromEntries(qs.map(q => [q.id, q]));
  const { count: vc } = await db.from('proctoring_violations').select('id', { count: 'exact', head: true }).eq('attempt_id', a.id).eq('counted', true);
  return { attemptId: a.id, expiresAt: a.expires_at, serverTime: new Date().toISOString(), violations: vc || 0, maxWarnings: MAX_WARNINGS,
    questions: a.question_order.map(o => ({ id: o.q, text: byId[o.q].text, options: o.opts.map(id => byId[o.q].options.find(x => x.id === id)) })),
    saved: Object.fromEntries(rs.map(r => [r.question_id, r.selected_option_id])) };
}

app.get('/api/config', (_q, res) => res.json({ supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_ANON_KEY, requireCamera: process.env.REQUIRE_CAMERA !== 'false', razorpayConfigured: !!process.env.RAZORPAY_KEY_ID }));
app.get('/api/me', auth, wrap(async (req, res) => {
  const { data: profile } = await db.from('profiles').select('full_name,phone,role').eq('id', req.user.id).single();
  const { data: attempt } = await db.from('assessment_attempts').select('id,status').eq('user_id', req.user.id).order('started_at', { ascending: false }).limit(1).maybeSingle();
  res.json({ profile, email: req.user.email, attempt });
}));
app.post('/api/profile', auth, wrap(async (req, res) => {
  const n = String(req.body?.fullName || '').trim(), p = String(req.body?.phone || '').trim();
  if (n.length < 2 || n.length > 100 || !/^[0-9+\-\s]{10,15}$/.test(p)) throw fail(400, 'Enter a valid name and mobile number');
  await db.from('profiles').update({ full_name: n, phone: p }).eq('id', req.user.id); res.json({ ok: true });
}));
app.post('/api/attempts/start', auth, wrap(async (req, res) => {
  const { data: prof } = await db.from('profiles').select('full_name,phone').eq('id', req.user.id).single();
  if (!prof?.full_name || !prof?.phone) throw fail(403, 'Complete registration before starting the test');
  const { data: existing } = await db.from('assessment_attempts').select('*').eq('user_id', req.user.id);
  const active = existing.find(a => a.status === 'in_progress');
  if (active && new Date(active.expires_at) > new Date()) return res.json(await view(active)); // refresh recovery
  if (active) await finalize(active, 'timed_out');
  if (existing.some(a => a.status !== 'in_progress')) throw fail(409, 'attempt already used'); // one scholarship attempt per student
  const s = await settings();
  const { data: pool } = await db.from('questions').select('id,options').eq('active', true);
  if (pool.length < s.question_count) throw fail(500, 'not enough questions configured');
  const order = shuffle(pool).slice(0, s.question_count).map(q => ({ q: q.id, opts: shuffle(q.options).map(o => o.id) }));
  const { data, error } = await db.from('assessment_attempts').insert({ user_id: req.user.id, question_order: order, total_questions: order.length, expires_at: new Date(Date.now() + s.duration_seconds * 1000).toISOString() }).select().single();
  if (error) throw fail(409, 'attempt already active');
  res.json(await view(data));
}));

app.post('/api/attempts/:id/answer', auth, wrap(async (req, res) => {
  validateAnswer(req.body); const a = await ownAttempt(req);
  if (a.status !== 'in_progress') throw fail(409, 'attempt closed');
  if (new Date(a.expires_at) <= new Date()) { await finalize(a, 'timed_out'); throw fail(410, 'time expired'); }
  const o = a.question_order.find(x => x.q === req.body.questionId);
  if (!o || !o.opts.includes(req.body.optionId)) throw fail(400, 'invalid question/option');
  await db.from('responses').upsert({ attempt_id: a.id, question_id: o.q, selected_option_id: req.body.optionId, saved_at: new Date().toISOString() });
  res.json({ ok: true });
}));

app.post('/api/attempts/:id/violation', auth, wrap(async (req, res) => {
  const type = req.body?.type; if (!VIOLATIONS.includes(type)) throw fail(400, 'invalid');
  const advisory = ADVISORY_TYPES.includes(type), V = () => db.from('proctoring_violations'); let snapshot = cleanSnapshot(req.body?.snapshot); // evidence still for admins, at most MAX_SNAPSHOTS per attempt
  // one parallel round of reads instead of three in a row: ownership, snapshot quota, and the prior events used for counting
  const [a, sc, prior] = await Promise.all([ownAttempt(req),
    snapshot ? V().select('id', { count: 'exact', head: true }).eq('attempt_id', req.params.id).not('snapshot', 'is', null) : null,
    advisory ? V().select('occurred_at').eq('attempt_id', req.params.id).eq('type', type).order('occurred_at', { ascending: false }).limit(1)
      : V().select('occurred_at').eq('attempt_id', req.params.id).eq('counted', true).order('occurred_at', { ascending: false })]);
  if (a.status !== 'in_progress') throw fail(400, 'invalid');
  if (snapshot && (sc?.count || 0) >= MAX_SNAPSHOTS) snapshot = null;
  if (advisory) { // logged for review only; at most one per type every ADVISORY_GAP_MS
    const last = prior.data?.[0];
    if (!last || Date.now() - new Date(last.occurred_at).getTime() >= ADVISORY_GAP_MS) { const { error } = await V().insert({ attempt_id: a.id, type, counted: false, snapshot }); if (error) throw fail(500, 'could not record violation'); }
    return res.json({ counted: false, advisory: true });
  }
  const rows = prior.data || [], d = violationDecision(rows.length, rows[0]?.occurred_at); // counting is server-side: the browser cannot reset or skip it
  const { error } = await V().insert({ attempt_id: a.id, type, counted: d.counted, snapshot }); if (error) throw fail(500, 'could not record violation');
  if (d.autoSubmit) { await finalize(a, 'auto_submitted'); return res.json({ ...d, autoSubmitted: true, result: await result(a) }); }
  res.json({ ...d, autoSubmitted: false, maxWarnings: MAX_WARNINGS });
}));

// Idempotent: atomic status flip guarantees one scoring + one coupon per attempt.
async function finalize(a, status) {
  const { data: claimed } = await db.from('assessment_attempts').update({ status, submitted_at: new Date().toISOString() }).eq('id', a.id).eq('status', 'in_progress').select().maybeSingle();
  if (!claimed) return;
  const { data: rs } = await db.from('responses').select('question_id,selected_option_id').eq('attempt_id', a.id);
  const { data: qs } = await db.from('questions').select('id,correct_option_id').in('id', a.question_order.map(x => x.q));
  const key = Object.fromEntries(qs.map(q => [q.id, q.correct_option_id]));
  const correct = rs.filter(r => key[r.question_id] === r.selected_option_id).length, total = a.question_order.length;
  const s = await settings(), now = Date.now();
  await db.from('assessment_attempts').update({ correct_count: correct, total_questions: total, score_percent: scorePercent(correct, total) }).eq('id', a.id);
  await db.from('scholarship_coupons').insert({ code: makeCouponCode(), attempt_id: a.id, user_id: a.user_id, score_percent: scorePercent(correct, total), discount_percent: tierFor(correct, total), issued_at: new Date(now).toISOString(), expires_at: new Date(now + s.coupon_valid_hours * 3600e3).toISOString() });
}
const result = async a => {
  const { data: c } = await db.from('scholarship_coupons').select('*').eq('attempt_id', a.id).maybeSingle();
  const { data: at } = await db.from('assessment_attempts').select('status,correct_count,total_questions,score_percent').eq('id', a.id).single();
  return { ...at, coupon: c && { code: c.code, discountPercent: c.discount_percent, payablePaise: payablePaise(BASE_PRICE_PAISE, c.discount_percent), issuedAt: c.issued_at, expiresAt: c.expires_at, state: couponState(c) } };
};
app.post('/api/attempts/:id/submit', auth, wrap(async (req, res) => {
  const a = await ownAttempt(req);
  await finalize(a, new Date(a.expires_at) <= new Date() ? 'timed_out' : 'submitted');
  res.json(await result(a)); // repeat calls return same result; no duplicate coupon
}));
app.get('/api/attempts/:id/result', auth, wrap(async (req, res) => {
  const a = await ownAttempt(req);
  if (a.status === 'in_progress') { if (new Date(a.expires_at) <= new Date()) await finalize(a, 'timed_out'); else throw fail(403, 'result not available'); }
  res.json(await result(a));
}));

// ---- Assessment report (PDF in the Plant Green Inertia letterhead) + share links ----
async function reportData(a, user) {
  const [{ data: profile }, { data: c }, { data: vs }, { count: answered }] = await Promise.all([
    db.from('profiles').select('full_name,phone').eq('id', a.user_id).single(), db.from('scholarship_coupons').select('*').eq('attempt_id', a.id).maybeSingle(),
    db.from('proctoring_violations').select('id,attempt_id,type,counted,occurred_at').eq('attempt_id', a.id).order('occurred_at'), db.from('responses').select('question_id', { count: 'exact', head: true }).eq('attempt_id', a.id)]);
  const { data: at } = await db.from('assessment_attempts').select('*').eq('id', a.id).single();
  if (!profile) throw fail(404, 'Profile not found');
  let email = user?.email; if (!email) email = (await db.auth.admin.getUserById(a.user_id)).data?.user?.email;
  return { profile, email, attempt: at, answered: answered || 0, violations: (vs || []).map(v => ({ ...v, counted: v.counted !== false })), coupon: c && { code: c.code, discount_percent: c.discount_percent, payable_paise: payablePaise(BASE_PRICE_PAISE, c.discount_percent), expires_at: c.expires_at } };
}
async function closedAttempt(req) { const a = await ownAttempt(req); if (a.status === 'in_progress') throw fail(403, 'Report is available after the test ends'); return a; }
const sendPdf = (res, buf, name) => { res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'private, no-store' }).send(buf); };
app.get('/api/attempts/:id/report.pdf', auth, wrap(async (req, res) => {
  const a = await closedAttempt(req); sendPdf(res, await buildReportPDF(await reportData(a, req.user)), reportId(a.id) + '.pdf');
}));
app.post('/api/attempts/:id/share', auth, wrap(async (req, res) => { // student opts in; link shows name, score and integrity only
  const a = await closedAttempt(req); let t = a.share_token;
  if (!t) { t = crypto.randomBytes(12).toString('base64url'); await db.from('assessment_attempts').update({ share_token: t }).eq('id', a.id); }
  const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const { data: p } = await db.from('profiles').select('full_name').eq('id', a.user_id).single();
  res.json({ url: `${base}/r/${t}`, pdf: `${base}/r/${t}/report.pdf`, text: `\u{1F389} I just completed the Scholarship Assessment at Plant Green Inertia (Vijayadashami Internship Fair) and scored ${Number(a.score_percent).toFixed(0)}%! \u{1F3C6}\n\n#PlantGreenInertia #Vijayadashami #Internship` });
}));
const sharedAttempt = async t => { if (!/^[\w-]{10,40}$/.test(t)) throw fail(404, 'not found'); const { data } = await db.from('assessment_attempts').select('*').eq('share_token', t).maybeSingle(); if (!data) throw fail(404, 'Report not found'); return data; };
app.get('/r/:token/report.pdf', wrap(async (req, res) => { const a = await sharedAttempt(req.params.token); sendPdf(res, await buildReportPDF(await reportData(a), true), reportId(a.id) + '.pdf'); }));
app.get('/r/:token', wrap(async (req, res) => {
  const a = await sharedAttempt(req.params.token), { data: p } = await db.from('profiles').select('full_name').eq('id', a.user_id).single();
  const title = `${p.full_name}: Scholarship Assessment Report`, desc = `Scored ${a.correct_count}/${a.total_questions} (${Number(a.score_percent).toFixed(0)}%) on ${fmtDate(a.started_at)}. ${STATUS_TEXT[a.status]}. Plant Green Inertia Pvt. Ltd.`;
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><link rel="stylesheet" href="/static/css/portal.css"></head><body><main><div class="card"><h1>${esc(title)}</h1><p>${esc(desc)}</p><p>Report ID: ${reportId(a.id)}</p><a href="/r/${esc(req.params.token)}/report.pdf"><button>Open report (PDF)</button></a></div></main></body></html>`);
}));

registerPayments(app, { db, auth, wrap, fail });
mountAdmin({ app, db, auth, wrap, fail, reportData, sendPdf, buildReportPDF, reportId });
app.get('/admin', (_q, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.use(express.static(PUBLIC, { setHeaders: (r, f) => { if (f.endsWith('.wasm')) r.type('application/wasm'); else if (f.endsWith('.mjs')) r.type('text/javascript'); } }));
app.use((e, _req, res, _n) => res.status(e.status || 500).json({ error: e.message }));
app.listen(process.env.PORT || 8787, () => console.log('API up'));