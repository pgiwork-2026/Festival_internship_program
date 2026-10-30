import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mountAdmin } from './admin.js';
import { createClient } from '@supabase/supabase-js';
import { registerPayments } from './payments.js';
import { batchTools } from './batches.js';
import { tierFor, payablePaise, scorePercent, shuffle, pickQuestions, makeCouponCode, couponState, validateAnswer, BASE_PRICE_PAISE, VIOLATION_TYPES, violationDecision, MAX_WARNINGS, STATUS_TEXT, ADVISORY_TYPES, MAX_SNAPSHOTS, ADVISORY_GAP_MS, cleanSnapshot } from './logic.js';
import { buildReportPDF, buildReportPNG, reportId, fmtDate } from './report.js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const app = express(); app.disable('x-powered-by');
app.use((_q, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()' }); next(); });
// small in-memory rate limiter (per IP): 240 API calls/min overall, 20/min for the sensitive writes
const hits = new Map(), SENSITIVE = /^\/api\/(profile|attempts\/start|checkout\/create|checkout\/verify|attempts\/[^/]+\/share)$/;
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); }, 60e3).unref();
app.use('/api', (req, res, next) => {
  if (req.path === '/webhooks/razorpay') return next();
  const sens = req.method === 'POST' && SENSITIVE.test('/api' + req.path), k = clientIp(req) + (sens ? '|s' : ''), n = Date.now(); let h = hits.get(k);
  if (!h || h.reset < n) hits.set(k, h = { c: 0, reset: n + 60e3 }); h.c++;
  if (h.c > (sens ? 20 : 240)) return res.status(429).set('Retry-After', '60').json({ error: 'Too many requests. Please wait a minute and try again.' });
  next();
});
app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
const VIOLATIONS = VIOLATION_TYPES;
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const wrap = f => (req, res) => f(req, res).catch(e => { console.error(req.method, req.url, e); const internal = !e.status && (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError); res.status(internal ? 500 : e.status || 400).json({ error: internal || e.status >= 500 && e.status !== 502 ? 'Something went wrong. Please try again.' : e.message }); });
const fail = (status, message) => Object.assign(new Error(message), { status });
const { activeBatch } = batchTools(db, fail);

const authCache = new Map(); // token -> { user, exp }: skips the Supabase Auth round trip on every request (30 s)
async function auth(req, _res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', ''), hit = authCache.get(t);
  if (hit && hit.exp > Date.now()) { req.user = hit.user; return next(); }
  const { data, error } = await db.auth.getUser(t);
  if (error || !data.user) return next(fail(401, 'unauthorized'));
  if (authCache.size > 500) authCache.clear(); authCache.set(t, { user: data.user, exp: Date.now() + 30000 });
  req.user = data.user; next();
}
const RETRY_MONTHS = 6, QUALIFY_PERCENT = 50; // qualified = score >= 50% (the 90%/100% coupon tiers)
const qualified = a => Number(a.score_percent) >= QUALIFY_PERCENT;
const nextEligible = list => { const d = (list || []).filter(a => a.status !== 'in_progress' && !qualified(a)).map(a => new Date(a.started_at)).sort((a, b) => b - a)[0]; if (!d) return null; const n = new Date(d); n.setMonth(n.getMonth() + RETRY_MONTHS); return n; };
const settings = async () => (await db.from('test_settings').select('*').single()).data;
function clientIp(req) { // first forwarded address, IPv4-mapped IPv6 unwrapped, IPv6 reduced to its /64 network
  let ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().replace(/^::ffff:/i, '');
  if (ip.includes(':') && !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) ip = ip.split(':').slice(0, 4).join(':');
  return ip.slice(0, 64);
}
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
  const B = await activeBatch(true); if (B && profile?.role !== 'admin') await db.from('batch_registrations').upsert({ user_id: req.user.id, batch_id: B.id }, { onConflict: 'user_id,batch_id', ignoreDuplicates: true });
  const { data: attempt } = B ? await db.from('assessment_attempts').select('id,status,started_at,score_percent').eq('user_id', req.user.id).eq('batch_id', B.id).order('started_at', { ascending: false }).limit(1).maybeSingle() : { data: null };
  const nx = attempt && attempt.status !== 'in_progress' ? nextEligible([attempt]) : null;
  res.json({ profile, email: req.user.email, attempt, canRetry: !!nx && nx <= new Date(), nextEligibleAt: nx });
}));
app.post('/api/profile', auth, wrap(async (req, res) => {
  const n = String(req.body?.fullName || '').trim(), p = String(req.body?.phone || '').trim();
  if (n.length < 2 || n.length > 100 || !/^[0-9+\-\s]{10,15}$/.test(p)) throw fail(400, 'Enter a valid name and mobile number');
  const pn = p.replace(/\D/g, '').slice(-10); if (pn.length !== 10) throw fail(400, 'Enter a valid 10-digit mobile number');
  const { data: dup } = await db.from('profiles').select('id').eq('phone_norm', pn).neq('id', req.user.id).limit(1);
  if (dup?.length) throw fail(409, 'This mobile number is already registered with another account. Use that account to take the test.');
  const { error: pe } = await db.from('profiles').update({ full_name: n, phone: p, phone_norm: pn }).eq('id', req.user.id);
  if (pe) { console.error('profile update failed (run phone_unique.sql?):', pe.message); throw fail(500, 'Could not save your profile'); } res.json({ ok: true });
}));
app.post('/api/attempts/start', auth, wrap(async (req, res) => {
  const { data: prof } = await db.from('profiles').select('full_name,phone').eq('id', req.user.id).single();
  if (!prof?.full_name || !prof?.phone) throw fail(403, 'Complete registration before starting the test');
  const pn = String(prof.phone).replace(/\D/g, '').slice(-10), { data: twins } = await db.from('profiles').select('id').eq('phone_norm', pn).neq('id', req.user.id);
  if (twins?.length) { const { data: used } = await db.from('assessment_attempts').select('id').in('user_id', twins.map(t => t.id)).limit(1); if (used?.length) throw fail(403, 'This mobile number has already been used for the assessment under another account.'); }
  const B = await activeBatch(); // server-chosen batch; the client never sends one
  const { data: existing } = await db.from('assessment_attempts').select('*').eq('user_id', req.user.id).eq('batch_id', B.id);
  const active = existing.find(a => a.status === 'in_progress');
  if (active && new Date(active.expires_at) > new Date()) return res.json(await view(active)); // refresh recovery
  if (active) await finalize(active, 'timed_out');
  if (existing.some(a => a.status !== 'in_progress' && qualified(a))) throw fail(409, 'You have already qualified in the assessment.');
  const nx = nextEligible(existing); if (nx && nx > new Date()) throw fail(409, `You did not qualify. You can retry only after ${nx.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.`); // one attempt per registered email, retry after 6 months
  const s = await settings();
  const { data: pool } = await db.from('questions').select('id,text,options,question_set').eq('active', true);
  if (pool.length < s.question_count) throw fail(500, 'not enough questions configured');
  const seen = new Set(existing.flatMap(a => (a.question_order || []).map(o => o.q)));
  const order = pickQuestions(pool, s.question_count, seen).map(q => ({ q: q.id, opts: shuffle(q.options).map(o => o.id) }));
  // same person on another account: block reused devices outright, flag matching device profile + network
  const dev = String(req.body?.device || '').slice(0, 64), fp = String(req.body?.fp || '').slice(0, 64), ip = clientIp(req);
  const sig = async (col, val, extra = q => q) => { const { data: d, error: e } = await extra(db.from('attempt_signals').select('user_id').eq(col, val).neq('user_id', req.user.id)).limit(20); if (e) { console.error('attempt_signals lookup failed (run device_signals.sql?):', e.message); return []; } return [...new Set(d.map(x => x.user_id))]; };
  if (dev && (await sig('device_id', dev)).length) throw fail(403, 'This device has already been used for the assessment under another account.');
  let flag = null; // matching device profile on the same network, or several accounts sharing one network
  if (fp && ip && (await sig('fp', fp, q => q.eq('ip', ip))).length) flag = 'same device profile and network as another account';
  else if (ip && (await sig('ip', ip)).length >= 2) flag = 'three or more accounts on the same network';
  const { data, error } = await db.from('assessment_attempts').insert({ user_id: req.user.id, batch_id: B.id, question_order: order, total_questions: order.length, expires_at: new Date(Date.now() + s.duration_seconds * 1000).toISOString() }).select().single();
  if (error) throw fail(409, 'attempt already active');
  { const { error: se } = await db.from('attempt_signals').insert({ attempt_id: data.id, user_id: req.user.id, device_id: dev || null, fp: fp || null, ip, flag }); if (se) console.error('attempt_signals insert failed (run device_signals.sql?):', se.message); }
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
  const { data: sg } = await db.from('attempt_signals').select('flag').eq('attempt_id', a.id).maybeSingle();
  const disc = sg?.flag ? Math.min(tierFor(correct, total), 90) : tierFor(correct, total); // flagged duplicates can't get the 100% waiver
  await db.from('assessment_attempts').update({ correct_count: correct, total_questions: total, score_percent: scorePercent(correct, total) }).eq('id', a.id);
  await db.from('scholarship_coupons').insert({ batch_id: a.batch_id || null, code: makeCouponCode(), attempt_id: a.id, user_id: a.user_id, score_percent: scorePercent(correct, total), discount_percent: disc, issued_at: new Date(now).toISOString(), expires_at: new Date(now + s.coupon_valid_hours * 3600e3).toISOString() });
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
const sendPng = (res, buf, name) => { res.set({ 'Content-Type': 'image/png', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'private, no-store' }).send(buf); };
const sendPdf = (res, buf, name) => { res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'private, no-store' }).send(buf); };
app.get('/api/attempts/:id/report.pdf', auth, wrap(async (req, res) => {
  const a = await closedAttempt(req); sendPdf(res, await buildReportPDF(await reportData(a, req.user)), reportId(a.id) + '.pdf');
}));
app.get('/api/attempts/:id/report.png', auth, wrap(async (req, res) => { // share image: public version (no contact details / coupon)
  const a = await closedAttempt(req); sendPng(res, await buildReportPNG(await reportData(a, req.user), true), reportId(a.id) + '.png');
}));
app.post('/api/attempts/:id/share', auth, wrap(async (req, res) => { // student opts in; link shows name, score and integrity only
  const a = await closedAttempt(req); let t = a.share_token;
  if (!t) { t = crypto.randomBytes(12).toString('base64url'); await db.from('assessment_attempts').update({ share_token: t }).eq('id', a.id); }
  const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const { data: p } = await db.from('profiles').select('full_name').eq('id', a.user_id).single();
  res.json({ url: `${base}/r/${t}`, pdf: `${base}/r/${t}/report.pdf`, image: `${base}/r/${t}/report.png`, text: `\u{1F389} I just completed the Scholarship Assessment at Plant Green Inertia (Diwali Special Internship and Training Program) and scored ${Number(a.score_percent).toFixed(0)}%! \u{1F3C6}\n\n#PlantGreenInertia #Diwali #Internship` });
}));
const sharedAttempt = async t => { if (!/^[\w-]{10,40}$/.test(t)) throw fail(404, 'not found'); const { data } = await db.from('assessment_attempts').select('*').eq('share_token', t).maybeSingle(); if (!data) throw fail(404, 'Report not found'); return data; };
app.get('/r/:token/report.png', wrap(async (req, res) => { const a = await sharedAttempt(req.params.token); sendPng(res, await buildReportPNG(await reportData(a), true), reportId(a.id) + '.png'); }));
app.get('/r/:token/report.pdf', wrap(async (req, res) => { const a = await sharedAttempt(req.params.token); sendPdf(res, await buildReportPDF(await reportData(a), true), reportId(a.id) + '.pdf'); }));
app.get('/r/:token', wrap(async (req, res) => {
  const a = await sharedAttempt(req.params.token), { data: p } = await db.from('profiles').select('full_name').eq('id', a.user_id).single();
  const title = `${p.full_name}: Scholarship Assessment Report`, desc = `Scored ${a.correct_count}/${a.total_questions} (${Number(a.score_percent).toFixed(0)}%) on ${fmtDate(a.started_at)}. ${STATUS_TEXT[a.status]}. Plant Green Inertia Pvt. Ltd.`;
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:image" content="${esc((process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, ''))}/r/${esc(req.params.token)}/report.png"><meta name="twitter:card" content="summary_large_image"><link rel="stylesheet" href="/static/css/portal.css"></head><body><main><div class="card"><h1>${esc(title)}</h1><p>${esc(desc)}</p><p>Report ID: ${reportId(a.id)}</p><a href="/r/${esc(req.params.token)}/report.pdf"><button>Open report (PDF)</button></a></div></main></body></html>`);
}));

registerPayments(app, { db, auth, wrap, fail });
mountAdmin({ app, db, auth, wrap, fail, reportData, sendPdf, buildReportPDF, reportId });
app.get('/admin', (_q, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.use(express.static(PUBLIC, { setHeaders: (r, f) => { if (f.endsWith('.wasm')) r.type('application/wasm'); else if (f.endsWith('.mjs')) r.type('text/javascript'); } }));
app.use((e, _req, res, _n) => { if (!e.status || e.status >= 500) console.error(e); res.status(e.status || 500).json({ error: !e.status || e.status >= 500 ? 'Something went wrong. Please try again.' : e.message }); });
// Evidence photos are only needed briefly for admin review: wipe them automatically after EVIDENCE_RETENTION_DAYS (default 7)
// so the database stays small. The violation records themselves (type, time, counted) are kept; only the image is removed.
const RETENTION_DAYS = Math.max(1, Number(process.env.EVIDENCE_RETENTION_DAYS) || 7);
async function purgeSnapshots() { // evidence photos are removed RETENTION_DAYS after the attempt started
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 864e5).toISOString();
    const { data: old, error: e1 } = await db.from('assessment_attempts').select('id').lt('started_at', cutoff);
    if (e1) return console.error('snapshot purge failed:', e1.message);
    let n = 0;
    for (let i = 0; i < (old || []).length; i += 200) {
      const { data, error } = await db.from('proctoring_violations').update({ snapshot: null }).in('attempt_id', old.slice(i, i + 200).map(x => x.id)).not('snapshot', 'is', null).select('id');
      if (error) return console.error('snapshot purge failed:', error.message); n += data?.length || 0;
    }
    if (n) console.log(`snapshot purge: removed ${n} evidence photos from attempts older than ${RETENTION_DAYS} days`);
  } catch (e) { console.error('snapshot purge error:', e.message); }
}
purgeSnapshots(); setInterval(purgeSnapshots, 15 * 60e3).unref();
app.get("/", (req, res) => res.send("API up"));
app.listen(process.env.PORT || 8787, () => console.log('API up'));