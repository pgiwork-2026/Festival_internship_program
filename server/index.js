import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mountAdmin } from './admin.js';
import { createClient } from '@supabase/supabase-js';
import { registerPayments } from './payments.js';
import { registerStudentRoutes } from './student.js';
import { batchTools } from './batches.js';
import { tierFor, winterTierFor, winterPayablePaise, payablePaise, scorePercent, shuffle, pickQuestions, makeCouponCode, couponState, validateAnswer, BASE_PRICE_PAISE, WINTER_PRICE_PAISE, VIOLATION_TYPES, violationDecision, MAX_WARNINGS, STATUS_TEXT, ADVISORY_TYPES, MAX_SNAPSHOTS, ADVISORY_GAP_MS, cleanSnapshot, calculateAssessmentScore, canRequestExtension, parseDobCredentials, isTestCoupon, isTestCouponEnabled, TEST_COUPON_CODE } from './logic.js';
import { validateCouponCode } from './test-coupon.js';
import { buildReportPDF, buildReportPNG, reportId, fmtDate } from './report.js';
import { sendApplicationConfirmation, sendCouponEmail } from './email.js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const app = express(); app.disable('x-powered-by');
app.set('trust proxy', 1); // Render & reverse proxy compatibility (accurate HTTPS protocol & client IPs)
app.use((_q, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()' }); next(); });
// small in-memory rate limiter (per IP): 240 API calls/min overall, 20/min for the sensitive writes
const hits = new Map(), SENSITIVE = /^\/api\/(profile|attempts\/start|checkout\/create|checkout\/verify|attempts\/[^/]+\/share|applications)$/;
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); }, 60e3).unref();
app.use('/api', (req, res, next) => {
  if (req.path === '/webhooks/razorpay' || req.path === '/checkout/failed') return next();
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

const authCache = new Map(); // token -> { user, exp }: skips Supabase Auth round trip on subsequent requests (30 s)
const authInFlight = new Map(); // token -> Promise: deduplicates concurrent requests with same JWT
function cacheAuthUser(token, user) {
  if (!token || !user) return;
  if (authCache.size > 500) authCache.clear();
  authCache.set(token, { user, exp: Date.now() + 30000 });
}
async function auth(req, _res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', ''), hit = authCache.get(t);
  if (hit && hit.exp > Date.now()) { req.user = hit.user; return next(); }
  let pending = authInFlight.get(t);
  if (!pending) {
    pending = db.auth.getUser(t).finally(() => authInFlight.delete(t));
    authInFlight.set(t, pending);
  }
  const { data, error } = await pending;
  if (error || !data.user) return next(fail(401, 'unauthorized'));
  cacheAuthUser(t, data.user);
  req.user = data.user; next();
}
const RETRY_MONTHS = 6, QUALIFY_PERCENT = 30; // default pass mark is 30%
const qualified = a => Boolean(a.is_qualified) || (a.total_score != null ? Number(a.total_score) >= (a.pass_mark || 30) : Number(a.score_percent) >= (a.pass_mark || QUALIFY_PERCENT));
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
const isSchemaErr = err => /column|does not exist|schema cache|PGRST204/i.test(err?.message || '');

async function selectQuestionsSafe(colsWithMarks, colsBase, filterFn) {
  let { data, error } = await filterFn(db.from('questions').select(colsWithMarks));
  if (error && isSchemaErr(error)) {
    ({ data, error } = await filterFn(db.from('questions').select(colsBase)));
  }
  if (error) throw error;
  return data || [];
}

async function view(a) { // questions WITHOUT correct answers, in the stored shuffled order
  const [qs, { data: rs }, { count: vc }, s] = await Promise.all([
    selectQuestionsSafe('id,text,options,marks,question_set', 'id,text,options,question_set', q => q.in('id', a.question_order.map(x => x.q))),
    db.from('responses').select('question_id,selected_option_id').eq('attempt_id', a.id),
    db.from('proctoring_violations').select('id', { count: 'exact', head: true }).eq('attempt_id', a.id).eq('counted', true),
    settings().catch(() => null)
  ]);
  const byId = Object.fromEntries(qs.map(q => [q.id, q]));
  const marksPerQ = Number(s?.marks_per_question) || 5;
  return {
    attemptId: a.id,
    startedAt: a.started_at,
    expiresAt: a.expires_at,
    durationSeconds: Number(s?.duration_seconds) || 1200,
    totalMarks: Number(a.total_marks || s?.total_marks) || 100,
    passMark: Number(a.pass_mark || s?.pass_mark) || 30,
    negativeMarking: Number(s?.negative_marking) || 0,
    serverTime: new Date().toISOString(),
    violations: vc || 0,
    maxWarnings: MAX_WARNINGS,
    questions: a.question_order.map(o => ({
      id: o.q,
      text: byId[o.q].text,
      marks: byId[o.q].marks || marksPerQ,
      questionSet: byId[o.q].question_set || null,
      options: o.opts.map(id => byId[o.q].options.find(x => x.id === id))
    })),
    saved: Object.fromEntries((rs || []).map(r => [r.question_id, r.selected_option_id]))
  };
}

app.get('/api/config', (_q, res) => res.json({ supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_ANON_KEY, requireCamera: process.env.REQUIRE_CAMERA !== 'false', razorpayConfigured: !!process.env.RAZORPAY_KEY_ID }));
app.get('/api/program', wrap(async (_req, res) => {
  let b = null;
  try { b = await activeBatch(true); } catch {}
  let courses = [];
  try {
    const { data } = await db.from('courses').select('id,title,description,duration,skills,benefits').eq('active', true);
    if (data && data.length) courses = data;
  } catch {}
  res.json({
    batch: b ? { id: b.id, name: b.name, slug: b.slug, startsOn: b.starts_on, endsOn: b.ends_on, description: b.description } : null,
    timings: { online: '4:00 PM – 6:00 PM IST', offline: '9:00 AM – 6:00 PM IST' },
    scholarship: { value: 10000, marks: 100, studentContribution: 999, durationHours: 30, modes: ['Online', 'Offline'] },
    courses
  });
}));

// Fallback in-memory application store for development and testing
const localApplications = new Map();

async function getNextApplicationId(db) {
  try {
    const { data, error } = await db.rpc('next_pgi_application_id');
    if (!error && data) return data;
  } catch {}
  try {
    const { count, error } = await db.from('internship_applications').select('*', { count: 'exact', head: true });
    if (!error && typeof count === 'number') {
      return `PGI-W26-${String(count + 1).padStart(4, '0')}`;
    }
  } catch {}
  return `PGI-W26-${String(localApplications.size + 1).padStart(4, '0')}`;
}

async function findExistingCandidate(db, email, phoneNorm) {
  try {
    let q = db.from('internship_applications').select('id,application_id,email,phone_norm');
    if (email && phoneNorm.length === 10) {
      q = q.or(`email.ilike.${email},phone_norm.eq.${phoneNorm}`);
    } else if (email) {
      q = q.ilike('email', email);
    } else if (phoneNorm.length === 10) {
      q = q.eq('phone_norm', phoneNorm);
    } else {
      q = null;
    }
    if (q) {
      const { data, error } = await q.limit(1).maybeSingle();
      if (!error && data) {
        return { applicationId: data.application_id, email: data.email };
      }
    }
  } catch {}

  for (const app of localApplications.values()) {
    if ((email && app.email === email) || (phoneNorm.length === 10 && app.phoneNorm === phoneNorm)) {
      return { applicationId: app.application_id || app.applicationId, email: app.email };
    }
  }

  try {
    if (phoneNorm.length === 10) {
      const { data: prof } = await db.from('profiles')
        .select('id,student_id,phone_norm')
        .eq('phone_norm', phoneNorm)
        .limit(1)
        .maybeSingle();
      if (prof) {
        const { data: u } = await db.auth.admin.getUserById(prof.id);
        return {
          applicationId: u?.user?.user_metadata?.application_id || prof.student_id || 'REGISTERED',
          email: u?.user?.email || null
        };
      }
    }
    if (email) {
      const { data: uList } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const matched = (uList?.users || []).find(u => u.email?.toLowerCase() === email);
      if (matched) {
        return {
          applicationId: matched.user_metadata?.application_id || 'REGISTERED',
          email: matched.email
        };
      }
    }
  } catch {}

  return null;
}

app.post('/api/applications', wrap(async (req, res) => {
  const b = req.body || {};
  const fullName = String(b.fullName || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const phone = String(b.mobile || b.phone || '').trim();
  const phoneNorm = phone.replace(/\D/g, '').slice(-10);
  const dobCreds = parseDobCredentials(b.dob || b.dateOfBirth);
  const college = String(b.college || '').trim();
  const department = String(b.department || '').trim();
  const passedOutYear = String(b.passedOutYear || '').trim();
  const domainType = String(b.domainType || '').trim();
  const domainName = String(b.domainName || '').trim();
  const mode = String(b.mode || '').trim();
  const duration = '30 Hours';
  const internshipPeriod = String(b.internshipPeriod || '').trim();
  const address = String(b.address || '').trim();
  const whyHire = String(b.whyHire || '').trim();
  const referralCode = String(b.referralCode || b.ref || '').trim().slice(0, 50);

  // Field validations
  if (fullName.length < 2 || fullName.length > 120) throw fail(400, 'Please enter a valid full name (minimum 2 characters).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Please enter a valid email address.');
  if (phoneNorm.length !== 10) throw fail(400, 'Please enter a valid 10-digit mobile number.');
  if (!dobCreds) throw fail(400, 'Please enter a valid Date of Birth.');
  if (!college) throw fail(400, 'Please enter your college name.');
  if (!department) throw fail(400, 'Please enter your department/degree.');
  if (!/^\d{4}$/.test(passedOutYear) || Number(passedOutYear) < 1980 || Number(passedOutYear) > 2050) {
    throw fail(400, 'Please enter a valid 4-digit passed-out year.');
  }
  if (!['Technical', 'Non-Technical'].includes(domainType)) throw fail(400, 'Select a valid domain type (Technical or Non-Technical).');
  if (!domainName) throw fail(400, 'Please select a specialization domain.');
  if (!['Online', 'Offline'].includes(mode)) throw fail(400, 'Select a valid training mode (Online or Offline).');
  if (!['1 week', '2 weeks', '1 month', '3 months', '6 months'].includes(internshipPeriod)) {
    throw fail(400, 'Select a valid internship period.');
  }
  if (!address || address.length < 4) throw fail(400, 'Please enter your address.');
  if (!whyHire || whyHire.length < 10) throw fail(400, 'Please share a brief note on why we should hire you (minimum 10 characters).');

  // Prevent duplicate applications by email or mobile across DB, memory & existing student accounts
  const duplicate = await findExistingCandidate(db, email, phoneNorm);

  if (duplicate) {
    return res.status(409).json({
      error: 'An application with this email address or mobile number already exists.',
      applicationId: duplicate.applicationId,
      alreadyApplied: true
    });
  }

  // Generate unique Application ID
  const appId = await getNextApplicationId(db);

  const newApp = {
    application_id: appId,
    full_name: fullName,
    email,
    phone,
    phone_norm: phoneNorm,
    dob: dobCreds.dobIso,
    college,
    department,
    passed_out_year: passedOutYear,
    domain_type: domainType,
    domain_name: domainName,
    mode,
    duration,
    internship_period: internshipPeriod,
    address,
    why_hire: whyHire,
    referral_code: referralCode || null,
    status: 'submitted'
  };

  try {
    let { error: insertError } = await db.from('internship_applications').insert(newApp);
    if (insertError && /dob/i.test(insertError.message || '')) {
      const { dob: _ignoredDob, ...withoutDob } = newApp;
      ({ error: insertError } = await db.from('internship_applications').insert(withoutDob));
    }
    if (insertError) {
      console.warn('DB insert fell back to in-memory store:', insertError.message);
      localApplications.set(appId, { ...newApp, applicationId: appId, phoneNorm });
    }
  } catch (err) {
    console.warn('DB unavailable, saving to local store:', err.message);
    localApplications.set(appId, { ...newApp, applicationId: appId, phoneNorm });
  }

  // Provision Supabase Auth account using registered email + DOB password (DDMMYYYY)
  let userId = null;
  try {
    const { data: created, error: authErr } = await db.auth.admin.createUser({
      email,
      password: dobCreds.password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        phone,
        dob: dobCreds.dobIso,
        application_id: appId
      }
    });
    if (!authErr && created?.user) {
      userId = created.user.id;
    } else if (authErr && /already|exists|registered/i.test(authErr.message || '')) {
      const { data: uList } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = (uList?.users || []).find(u => u.email?.toLowerCase() === email);
      if (existing) {
        userId = existing.id;
        const { data: exProf } = await db.from('profiles').select('role').eq('id', existing.id).maybeSingle();
        if (exProf?.role !== 'admin') {
          const { data: exAtt } = await db.from('assessment_attempts').select('id').eq('user_id', existing.id).limit(1).maybeSingle();
          if (!exAtt) {
            await db.auth.admin.updateUserById(existing.id, {
              password: dobCreds.password,
              email_confirm: true,
              user_metadata: { ...(existing.user_metadata || {}), full_name: fullName, phone, dob: dobCreds.dobIso, application_id: appId }
            }).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Auth Provision Warning]', err.message);
  }

  if (userId) {
    try {
      const { error: pErr } = await db.from('profiles').upsert({
        id: userId,
        full_name: fullName,
        phone,
        phone_norm: phoneNorm,
        role: 'student'
      }, { onConflict: 'id' });
      if (pErr && isSchemaErr(pErr)) {
        await db.from('profiles').upsert({
          id: userId,
          full_name: fullName,
          phone,
          role: 'student'
        }, { onConflict: 'id' });
      }
    } catch (err) {
      console.warn('[Profile Upsert Warning]', err.message);
    }
  }

  // Send confirmation email (with Email + DOB Password login credentials)
  const appForEmail = {
    applicationId: appId,
    fullName,
    email,
    phone,
    dob: dobCreds.dobIso,
    password: dobCreds.password,
    college,
    department,
    passedOutYear,
    domainType,
    domainName,
    mode,
    duration,
    internshipPeriod,
    referralCode
  };
  sendApplicationConfirmation(appForEmail).catch(err => console.error('[Email Error]', err));

  res.json({
    ok: true,
    applicationId: appId,
    fullName,
    email,
    dob: dobCreds.dobIso,
    password: dobCreds.password,
    mode,
    domainName,
    referralCode
  });
}));

app.get('/api/applications/check', wrap(async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  const phone = String(req.query.phone || req.query.mobile || '').trim();
  const phoneNorm = phone.replace(/\D/g, '').slice(-10);

  if (!email && phoneNorm.length !== 10) return res.json({ exists: false });

  const existing = await findExistingCandidate(db, email, phoneNorm);
  if (existing) {
    return res.json({ exists: true, applicationId: existing.applicationId });
  }
  return res.json({ exists: false });
}));
function resolveMeFromRows(user, profileRow, B, attempt) {
  const profile = profileRow || (user.user_metadata?.full_name
    ? { full_name: user.user_metadata.full_name, phone: user.user_metadata.phone || '', role: 'student' }
    : null);
  let applicationId = user.user_metadata?.application_id || null;
  if (!applicationId && user.email) {
    const emailLower = user.email.toLowerCase();
    for (const appRec of localApplications.values()) {
      if (appRec.email === emailLower) {
        applicationId = appRec.application_id || appRec.applicationId;
        break;
      }
    }
  }
  if (B && profile?.role !== 'admin') {
    db.from('batch_registrations').upsert({ user_id: user.id, batch_id: B.id }, { onConflict: 'user_id,batch_id', ignoreDuplicates: true }).then(() => {}, () => {});
  }
  const nx = attempt && attempt.status !== 'in_progress' ? nextEligible([attempt]) : null;
  return { profile, email: user.email, applicationId, attempt, canRetry: !!nx && nx <= new Date(), nextEligibleAt: nx };
}

app.get('/api/me', auth, wrap(async (req, res) => {
  const [{ data: profileRow }, B] = await Promise.all([
    db.from('profiles').select('full_name,phone,role').eq('id', req.user.id).maybeSingle(),
    activeBatch(true)
  ]);
  const { data: attempt } = B
    ? await db.from('assessment_attempts').select('id,status,started_at,score_percent').eq('user_id', req.user.id).eq('batch_id', B.id).order('started_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  res.json(resolveMeFromRows(req.user, profileRow, B, attempt));
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
  let { data: prof } = await db.from('profiles').select('full_name,phone').eq('id', req.user.id).maybeSingle();
  if ((!prof?.full_name || !prof?.phone) && req.user.user_metadata?.full_name && req.user.user_metadata?.phone) {
    prof = { full_name: req.user.user_metadata.full_name, phone: req.user.user_metadata.phone };
    const pnMeta = String(prof.phone).replace(/\D/g, '').slice(-10);
    await db.from('profiles').upsert({ id: req.user.id, full_name: prof.full_name, phone: prof.phone, phone_norm: pnMeta || null, role: 'student' }, { onConflict: 'id' });
  }
  if (!prof?.full_name || !prof?.phone) throw fail(403, 'Complete registration before starting the test');
  const pn = String(prof.phone).replace(/\D/g, '').slice(-10), { data: twins } = await db.from('profiles').select('id').eq('phone_norm', pn).neq('id', req.user.id);
  if (twins?.length) { const { data: used } = await db.from('assessment_attempts').select('id').in('user_id', twins.map(t => t.id)).limit(1); if (used?.length) throw fail(403, 'This mobile number has already been used for the assessment under another account.'); }
  const B = await activeBatch(); // server-chosen batch; the client never sends one
  const { data: existingRows } = await db.from('assessment_attempts').select('*').eq('user_id', req.user.id).eq('batch_id', B.id);
  const existing = existingRows || [];
  const active = existing.find(a => a.status === 'in_progress');
  if (active && new Date(active.expires_at) > new Date()) return res.json(await view(active)); // refresh recovery
  if (active) await finalize(active, 'timed_out');
  if (existing.some(a => a.status !== 'in_progress' && qualified(a))) throw fail(409, 'You have already qualified in the assessment.');
  const s = await settings();
  const attemptLimit = Number(s?.attempt_limit) || 1;
  const completedAttempts = existing.filter(a => a.status !== 'in_progress');
  if (completedAttempts.length >= attemptLimit) {
    const nx = nextEligible(existing);
    const dateStr = nx ? nx.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'the next cohort cycle';
    throw fail(409, `You have reached the maximum attempt limit (${attemptLimit}) for this assessment. Next opportunity opens in ${dateStr}.`);
  }
  const nx = nextEligible(existing); if (nx && nx > new Date()) throw fail(409, `You did not qualify. You can retry only after ${nx.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.`); // retry after 6 months
  const questionCount = Number(s?.question_count) || 25;
  const pool = await selectQuestionsSafe('id,text,options,question_set,marks', 'id,text,options,question_set', q => q.eq('active', true));
  if (pool.length < questionCount) throw fail(500, 'not enough questions configured');
  const seen = new Set(existing.flatMap(a => (a.question_order || []).map(o => o.q)));
  const order = pickQuestions(pool, questionCount, seen).map(q => ({ q: q.id, opts: shuffle(q.options).map(o => o.id) }));
  // same person on another account: block reused devices outright, flag matching device profile + network
  const dev = String(req.body?.device || '').slice(0, 64), fp = String(req.body?.fp || '').slice(0, 64), ip = clientIp(req);
  const sig = async (col, val, extra = q => q) => { const { data: d, error: e } = await extra(db.from('attempt_signals').select('user_id').eq(col, val).neq('user_id', req.user.id)).limit(20); if (e) { console.error('attempt_signals lookup failed (run device_signals.sql?):', e.message); return []; } return [...new Set(d.map(x => x.user_id))]; };
  if (dev && (await sig('device_id', dev)).length) throw fail(403, 'This device has already been used for the assessment under another account.');
  let flag = null; // matching device profile on the same network, or several accounts sharing one network
  if (fp && ip && (await sig('fp', fp, q => q.eq('ip', ip))).length) flag = 'same device profile and network as another account';
  else if (ip && (await sig('ip', ip)).length >= 2) flag = 'three or more accounts on the same network';
  const appId = String(req.body?.applicationId || '').trim();
  const durationSec = Number(s?.duration_seconds) || 1200;
  const baseAttemptRow = {
    user_id: req.user.id,
    batch_id: B.id,
    question_order: order,
    total_questions: order.length,
    expires_at: new Date(Date.now() + durationSec * 1000).toISOString()
  };
  let { data, error } = await db.from('assessment_attempts').insert({
    ...baseAttemptRow,
    total_marks: Number(s?.total_marks) || 100,
    pass_mark: Number(s?.pass_mark) || 30,
    application_id: appId || null
  }).select().single();
  if (error && isSchemaErr(error)) {
    ({ data, error } = await db.from('assessment_attempts').insert(baseAttemptRow).select().single());
  }
  if (error || !data) throw fail(error?.code === '23505' ? 409 : 500, error?.code === '23505' ? 'attempt already active' : (error?.message || 'could not start assessment'));
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

async function issueCouponForAttempt({ attempt, score, scorePercent, discountPercent, validHours, studentName, studentEmail }) {
  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + validHours * 3600e3).toISOString();
  const code = makeCouponCode();

  const baseCoupon = {
    batch_id: attempt.batch_id || null,
    code,
    attempt_id: attempt.id,
    user_id: attempt.user_id,
    score_percent: scorePercent,
    discount_percent: discountPercent,
    issued_at: issuedAt,
    expires_at: expiresAt
  };
  const fullCoupon = {
    ...baseCoupon,
    application_id: attempt.application_id || null,
    student_email: studentEmail || null,
    extension_count: 0
  };

  let { data: inserted, error: cErr } = await db.from('scholarship_coupons').insert(fullCoupon).select().maybeSingle();
  if (cErr && isSchemaErr(cErr)) {
    ({ data: inserted, error: cErr } = await db.from('scholarship_coupons').insert(baseCoupon).select().maybeSingle());
  }
  if (cErr && cErr.code === '23514' && discountPercent === 88) {
    const legacyFull = { ...fullCoupon, discount_percent: 85 };
    const legacyBase = { ...baseCoupon, discount_percent: 85 };
    ({ data: inserted, error: cErr } = await db.from('scholarship_coupons').insert(legacyFull).select().maybeSingle());
    if (cErr && isSchemaErr(cErr)) {
      ({ data: inserted, error: cErr } = await db.from('scholarship_coupons').insert(legacyBase).select().maybeSingle());
    }
  }
  if (!cErr && studentEmail) {
    sendCouponEmail(
      { fullName: studentName || 'Candidate', email: studentEmail, score },
      inserted || fullCoupon
    ).catch(err => console.error('[Coupon Email Dispatch Error]', err));
  }
  return inserted || (!cErr ? fullCoupon : null);
}

// Idempotent: atomic status flip guarantees one scoring + one coupon per attempt.
async function finalize(a, status) {
  const { data: claimed } = await db.from('assessment_attempts').update({ status, submitted_at: new Date().toISOString() }).eq('id', a.id).eq('status', 'in_progress').select().maybeSingle();
  if (!claimed) return;
  const [{ data: rs }, qs, s] = await Promise.all([
    db.from('responses').select('question_id,selected_option_id').eq('attempt_id', a.id),
    selectQuestionsSafe('id,correct_option_id,marks', 'id,correct_option_id', q => q.in('id', a.question_order.map(x => x.q))),
    settings().catch(() => null)
  ]);
  const totalMarks = Number(s?.total_marks) || 100;
  const passMark = Number(s?.pass_mark) || 30;
  const qLen = Math.max(1, a.question_order.length);
  const rawMarksPerQ = Number(s?.marks_per_question);
  const marksPerQ = (rawMarksPerQ && rawMarksPerQ * qLen === totalMarks)
    ? rawMarksPerQ
    : (totalMarks / qLen);
  const negMarking = Number(s?.negative_marking) || 0;

  const scoreRes = calculateAssessmentScore({
    responses: rs || [],
    questions: qs || [],
    marksPerQuestion: marksPerQ,
    negativeMarking: negMarking,
    totalMarks,
    passMark
  });

  // 0–3 correct out of 25 (<=12%) -> ₹1,199 (88%); 4–25 (16%–100%) -> ₹999 (90%).
  const disc = winterTierFor(scoreRes.correctCount, qLen);

  const baseAttemptUpdate = {
    correct_count: scoreRes.correctCount,
    total_questions: a.question_order.length,
    score_percent: scoreRes.scorePercent
  };
  let { error: uErr } = await db.from('assessment_attempts').update({
    ...baseAttemptUpdate,
    total_score: scoreRes.score,
    total_marks: totalMarks,
    pass_mark: passMark,
    is_qualified: scoreRes.isQualified
  }).eq('id', a.id);
  if (uErr && isSchemaErr(uErr)) {
    await db.from('assessment_attempts').update(baseAttemptUpdate).eq('id', a.id);
  }

  let studentEmail = null, studentName = 'Candidate';
  try {
    const { data: prof } = await db.from('profiles').select('full_name').eq('id', a.user_id).maybeSingle();
    if (prof?.full_name) studentName = prof.full_name;
    const { data: u } = await db.auth.admin.getUserById(a.user_id);
    if (u?.user?.email) studentEmail = u.user.email;
    if (studentName === 'Candidate' && u?.user?.user_metadata?.full_name) studentName = u.user.user_metadata.full_name;
  } catch {}

  await issueCouponForAttempt({
    attempt: a,
    score: scoreRes.score,
    scorePercent: scoreRes.scorePercent,
    discountPercent: disc,
    validHours: Number(s?.coupon_valid_hours) || 24,
    studentName,
    studentEmail
  });
}

const result = async (a, pre = {}) => {
  const [couponRow, attendedCount, profRow, authUser, atRow] = await Promise.all([
    pre.coupon !== undefined ? pre.coupon : db.from('scholarship_coupons').select('*').eq('attempt_id', a.id).maybeSingle().then(r => r.data),
    db.from('responses').select('question_id', { count: 'exact', head: true }).eq('attempt_id', a.id).then(r => r.count),
    pre.profile !== undefined ? pre.profile : db.from('profiles').select('full_name').eq('id', a.user_id).maybeSingle().then(r => r.data),
    pre.user !== undefined ? pre.user : db.auth.admin.getUserById(a.user_id).then(r => r.data?.user || null).catch(() => null),
    pre.attemptRow !== undefined ? pre.attemptRow : (async () => {
      let { data: at, error: atErr } = await db.from('assessment_attempts')
        .select('id,batch_id,user_id,status,correct_count,total_questions,score_percent,total_score,total_marks,pass_mark,is_qualified,started_at,submitted_at,application_id')
        .eq('id', a.id).maybeSingle();
      if (atErr && isSchemaErr(atErr)) {
        ({ data: at } = await db.from('assessment_attempts')
          .select('id,batch_id,user_id,status,correct_count,total_questions,score_percent,started_at,submitted_at')
          .eq('id', a.id).maybeSingle());
      }
      return at;
    })()
  ]);
  const row = atRow || a;
  const totalQuestions = Number(row.total_questions || a.question_order?.length) || 20;
  const correctCount = Number(row.correct_count) || 0;
  const answeredCount = typeof attendedCount === 'number' ? attendedCount : correctCount;
  const unansweredCount = Math.max(0, totalQuestions - answeredCount);
  const wrongCount = Math.max(0, answeredCount - correctCount);
  const totalMarks = Number(row.total_marks) || 100;
  const passMark = row.pass_mark != null ? Number(row.pass_mark) : 30;
  const totalScore = row.total_score != null ? Number(row.total_score) : Number(row.score_percent ?? 0);
  const scorePercent = totalMarks > 0 ? Math.round((totalScore / totalMarks) * 1000) / 10 : Number(row.score_percent ?? 0);
  const isQualified = row.is_qualified ?? (totalScore >= passMark);

  const candidateName = profRow?.full_name || authUser?.user_metadata?.full_name || 'Candidate';
  const studentEmail = authUser?.email || null;
  const appId = row.application_id || authUser?.user_metadata?.application_id || 'PGI-W26';

  let c = couponRow;
  if (!c && row.status && row.status !== 'in_progress') {
    const disc = winterTierFor(correctCount, totalQuestions);
    c = await issueCouponForAttempt({
      attempt: { ...row, application_id: appId },
      score: totalScore,
      scorePercent,
      discountPercent: disc,
      validHours: 24,
      studentName: candidateName,
      studentEmail
    });
  }

  let timeTakenSeconds = null;
  if (row.started_at && row.submitted_at) {
    timeTakenSeconds = Math.max(1, Math.round((new Date(row.submitted_at) - new Date(row.started_at)) / 1000));
  }

  const rawDisc = c ? Number(c.discount_percent) : null;
  const effectiveDisc = c ? (rawDisc === 85 ? 88 : (rawDisc === 100 ? 90 : rawDisc)) : null;

  return {
    attemptId: a.id,
    status: row.status,
    correct_count: correctCount,
    total_questions: totalQuestions,
    answeredCount,
    unansweredCount,
    wrongCount,
    totalScore,
    totalMarks,
    passMark,
    scorePercent,
    isQualified,
    timeTakenSeconds,
    candidateName,
    applicationId: appId,
    nextOpportunityMessage: isQualified
      ? null
      : 'Your assessment score has been recorded and your Winter 2026 enrollment voucher is active for 24 hours.',
    coupon: c && {
      code: c.code,
      discountPercent: effectiveDisc,
      basePricePaise: BASE_PRICE_PAISE,
      payablePaise: winterPayablePaise(c),
      issuedAt: c.issued_at,
      expiresAt: c.expires_at,
      state: couponState(c),
      extensionCount: c.extension_count || 0,
      canExtend: canRequestExtension(c, 2)
    }
  };
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

app.get('/api/assessment/payment-eligibility', auth, wrap(async (req, res) => {
  const { data: enrollment } = await db.from('enrollments').select('id').eq('user_id', req.user.id).limit(1).maybeSingle();
  if (enrollment) return res.json({ completed: true, enrolled: true });

  const { data: attempts } = await db.from('assessment_attempts')
    .select('*')
    .eq('user_id', req.user.id)
    .order('started_at', { ascending: false })
    .limit(10);

  const list = attempts || [];
  let completed = list.find(a => a.status && a.status !== 'in_progress');

  if (!completed) {
    const expired = list.find(a => a.status === 'in_progress' && new Date(a.expires_at) <= new Date());
    if (expired) {
      await finalize(expired, 'timed_out');
      completed = expired;
    }
  }

  if (!completed) {
    let testCouponAvailable = false;
    if (isTestCouponEnabled()) {
      const tc = await validateCouponCode(db, { code: TEST_COUPON_CODE, email: '' });
      testCouponAvailable = Boolean(tc?.valid);
    }
    const acct = req.user?.email ? ` (${req.user.email})` : '';
    return res.json({
      completed: false,
      enrolled: false,
      testCouponAvailable,
      message: `No completed assessment found for this account${acct}. If you completed the test using a different email or Candidate UID, sign out and log in with that account — or complete Proctor Verification and submit the assessment here first.`
    });
  }

  res.json({ completed: true, enrolled: false, result: await result(completed) });
}));

// Student coupon extension request (max 2 extensions allowed)
app.post('/api/coupons/request-extension', auth, wrap(async (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  let q = db.from('scholarship_coupons').select('*').eq('user_id', req.user.id);
  if (code) q = q.eq('code', code);
  const { data: c } = await q.order('issued_at', { ascending: false }).limit(1).maybeSingle();
  if (!c) throw fail(404, 'No scholarship coupon found.');
  if (c.status === 'redeemed') throw fail(409, 'This coupon has already been redeemed.');
  if (!canRequestExtension(c, 2)) {
    throw fail(403, 'Maximum extension limit (2 times) reached. Please contact administration for reissue.');
  }

  const currentExp = new Date(c.expires_at).getTime();
  const newExp = new Date(Math.max(Date.now(), currentExp) + 24 * 3600e3).toISOString();
  const updatedCount = (Number(c.extension_count) || 0) + 1;

  const { error } = await db.from('scholarship_coupons').update({
    expires_at: newExp,
    extension_count: updatedCount,
    reissued_at: new Date().toISOString()
  }).eq('id', c.id);
  if (error) throw fail(500, 'Could not extend coupon. Please try again.');

  // Notify student via email
  const { data: prof } = await db.from('profiles').select('full_name').eq('id', req.user.id).maybeSingle();
  sendCouponEmail(
    { fullName: prof?.full_name || 'Candidate', email: req.user.email },
    { ...c, expires_at: newExp, extension_count: updatedCount }
  ).catch(err => console.error('[Coupon Extension Email Error]', err));

  res.json({
    ok: true,
    code: c.code,
    expiresAt: newExp,
    extensionCount: updatedCount,
    extensionsLeft: 2 - updatedCount
  });
}));

// Server-side coupon verification endpoint
app.post('/api/coupons/validate', wrap(async (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!code) throw fail(400, 'Coupon code is required');
  const result = await validateCouponCode(db, { code, email });
  res.json(result);
}));

// ---- Assessment report (PDF in the Plant Green Inertia letterhead) + share links ----
async function reportData(a, user) {
  const [{ data: profile }, { data: c }, { data: vs }, { count: answered }] = await Promise.all([
    db.from('profiles').select('full_name,phone').eq('id', a.user_id).single(), db.from('scholarship_coupons').select('*').eq('attempt_id', a.id).maybeSingle(),
    db.from('proctoring_violations').select('id,attempt_id,type,counted,occurred_at').eq('attempt_id', a.id).order('occurred_at'), db.from('responses').select('question_id', { count: 'exact', head: true }).eq('attempt_id', a.id)]);
  const { data: at } = await db.from('assessment_attempts').select('*').eq('id', a.id).single();
  if (!profile) throw fail(404, 'Profile not found');
  let email = user?.email; if (!email) email = (await db.auth.admin.getUserById(a.user_id)).data?.user?.email;
  const cDisc = c ? Number(c.discount_percent) : 0;
  const normCDisc = cDisc === 85 ? 88 : (cDisc === 100 ? 90 : cDisc);
  return { profile, email, attempt: at, answered: answered || 0, violations: (vs || []).map(v => ({ ...v, counted: v.counted !== false })), coupon: c && { code: c.code, discount_percent: normCDisc, payable_paise: winterPayablePaise(c), expires_at: c.expires_at } };
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
  res.json({ url: `${base}/r/${t}`, pdf: `${base}/r/${t}/report.pdf`, image: `${base}/r/${t}/report.png`, text: `\u{1F389} I just completed the Scholarship Assessment at Plant Green Inertia (Winter Internship & Training Program) and scored ${Number(a.score_percent).toFixed(0)}%! \u{1F3C6}\n\n#PlantGreenInertia #WinterInternship #Internship` });
}));
const sharedAttempt = async t => { if (!/^[\w-]{10,40}$/.test(t)) throw fail(404, 'not found'); const { data } = await db.from('assessment_attempts').select('*').eq('share_token', t).maybeSingle(); if (!data) throw fail(404, 'Report not found'); return data; };
app.get('/r/:token/report.png', wrap(async (req, res) => { const a = await sharedAttempt(req.params.token); sendPng(res, await buildReportPNG(await reportData(a), true), reportId(a.id) + '.png'); }));
app.get('/r/:token/report.pdf', wrap(async (req, res) => { const a = await sharedAttempt(req.params.token); sendPdf(res, await buildReportPDF(await reportData(a), true), reportId(a.id) + '.pdf'); }));
app.get('/r/:token', wrap(async (req, res) => {
  const a = await sharedAttempt(req.params.token), { data: p } = await db.from('profiles').select('full_name').eq('id', a.user_id).single();
  const title = `${p.full_name}: Scholarship Assessment Report`, desc = `Scored ${a.correct_count}/${a.total_questions} (${Number(a.score_percent).toFixed(0)}%) on ${fmtDate(a.started_at)}. ${STATUS_TEXT[a.status]}. Plant Green Inertia Pvt. Ltd.`;
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:image" content="${esc((process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, ''))}/r/${esc(req.params.token)}/report.png"><meta name="twitter:card" content="summary_large_image"><link rel="stylesheet" href="/static/css/portal.css"></head><body><main><div class="card"><h1>${esc(title)}</h1><p>${esc(desc)}</p><p>Report ID: ${reportId(a.id)}</p><a href="/r/${esc(req.params.token)}/report.pdf"><button>Open report (PDF)</button></a></div></main></body></html>`);
}));

const { buildDashboardPayload } = registerPayments(app, { db, auth, wrap, fail, localApplications });
registerStudentRoutes(app, { db, auth, wrap, fail, localApplications, onAuth: cacheAuthUser });

app.get('/api/portal/boot', auth, wrap(async (req, res) => {
  const u = req.user.id;
  const [B, profRes, attRes, coupRes, enrRes] = await Promise.all([
    activeBatch(true).catch(() => null),
    db.from('profiles').select('full_name,phone,role,student_id').eq('id', u).maybeSingle(),
    db.from('assessment_attempts').select('*').eq('user_id', u).order('started_at', { ascending: false }).limit(5),
    db.from('scholarship_coupons').select('*').eq('user_id', u).order('issued_at', { ascending: false }).limit(3),
    db.from('enrollments').select('*, courses(title,description,duration,skills,benefits,access_url)').eq('user_id', u).limit(3)
  ]);

  const bid = B?.id;
  const attempts = attRes.data || [];
  const batchAtt = bid ? (attempts.find(a => a.batch_id === bid) || null) : null;
  const coupons = coupRes.data || [];
  const batchCoup = bid ? (coupons.find(c => c.batch_id === bid) || coupons[0] || null) : (coupons[0] || null);
  const enrs = enrRes.data || [];
  const batchEnr = bid ? (enrs.find(e => e.batch_id === bid) || enrs[0] || null) : (enrs[0] || null);

  const me = resolveMeFromRows(req.user, profRes.data, B, batchAtt ? {
    id: batchAtt.id,
    status: batchAtt.status,
    started_at: batchAtt.started_at,
    score_percent: batchAtt.score_percent
  } : null);

  const dashboard = await buildDashboardPayload(req.user, {
    prefetched: true,
    batch: B,
    prof: profRes.data,
    att: batchAtt,
    coup: batchCoup,
    enr: batchEnr
  });

  let completedResult = null;
  if (!dashboard.enrollment && me.profile?.full_name && me.profile?.phone && me.attempt && me.attempt.status !== 'in_progress' && !me.canRetry) {
    completedResult = await result(batchAtt, {
      user: req.user,
      profile: profRes.data,
      coupon: coupons.find(c => c.attempt_id === batchAtt.id) || null,
      attemptRow: batchAtt
    });
  }

  res.json({ me, dashboard, completedResult });
}));
mountAdmin({ app, db, auth, wrap, fail, reportData, sendPdf, buildReportPDF, reportId });
app.get('/admin', (_q, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.use(express.static(PUBLIC, {
  setHeaders: (r, f) => {
    if (f.endsWith('.wasm')) r.type('application/wasm');
    else if (f.endsWith('.mjs')) r.type('text/javascript');
    if (/\.(html|js|css)$/i.test(f)) r.setHeader('Cache-Control', 'no-store');
  }
}));
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
activeBatch(true).catch(() => {});
app.get("/", (req, res) => res.send("API up"));
app.listen(process.env.PORT || 8787, () => console.log('API up'));