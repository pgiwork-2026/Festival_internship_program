import crypto from 'node:crypto';
export const BASE_PRICE_PAISE = 999900; // Legacy base price (Diwali)
export const WINTER_PRICE_PAISE = 1000000; // ₹10,000 for Winter Internship Program
export const TEST_COUPON_CODE = 'PGITEST1';
export const TEST_COUPON_PAISE = 100; // ₹1 (100 paise)

export function isTestCouponEnabled() {
  return String(process.env.ENABLE_TEST_COUPON || '').trim().toLowerCase() === 'true';
}

export function isTestCoupon(c) {
  if (!c) return false;
  return Boolean(
    c.is_test === true ||
    c.isTest === true ||
    String(c.code || '').trim().toUpperCase() === TEST_COUPON_CODE
  );
}

// Integer-only tier calc. correct/total compared via cross-multiplication (no floats).
export function tierFor(correct, total) {
  if (!Number.isInteger(correct) || !Number.isInteger(total) || total <= 0 || correct < 0 || correct > total) throw new Error('invalid score');
  return correct * 100 >= total * 50 ? 90 : 85;
}

export function payablePaise(basePaise, discountPercent) {
  if (![0, 85, 88, 90].includes(discountPercent)) throw new Error('invalid tier');
  if (!Number.isInteger(basePaise) || basePaise < 0) throw new Error('invalid price');
  if (discountPercent === 0) return basePaise;
  // Winter Internship: ₹9,999/₹10,000 base -> 88% tier = ₹1,199, 90% tier = ₹999
  if (discountPercent === 88 && (basePaise === 999900 || basePaise === 1000000)) return 119900;
  if (basePaise === 1000000 && discountPercent === 90) return 99900;
  // integer half-up rounding; for legacy 999900 base this is exact (149985 / 99990)
  return Math.floor((basePaise * (100 - discountPercent) + 50) / 100);
}

// Winter Cohort tiers: 0–3 correct out of 25 (0%–12%) -> ₹1,199 (88% grant); 4–25 (16%–100%) -> ₹999 (90% grant).
export function winterTierFor(correct, total) {
  if (!Number.isInteger(correct) || !Number.isInteger(total) || total <= 0 || correct < 0 || correct > total) throw new Error('invalid score');
  return correct * 100 <= total * 12 ? 88 : 90;
}

export function winterPayablePaise(coupon) {
  if (!coupon) return BASE_PRICE_PAISE; // ₹9,999 (999900 paise) default when no coupon is applied
  if (isTestCoupon(coupon)) {
    const fixed = coupon.fixed_payable_paise ?? coupon.fixedPayablePaise;
    return fixed !== null && fixed !== undefined && Number.isFinite(Number(fixed))
      ? Number(fixed)
      : TEST_COUPON_PAISE;
  }
  const disc = Number(coupon.discount_percent ?? coupon.discountPercent);
  if (disc === 90 || disc === 100) return 99900;
  if (disc === 88 || disc === 85) return 119900;
  return BASE_PRICE_PAISE;
}

export const formatINR = p => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function scorePercent(correct, total) { return Math.round((correct * 10000) / total) / 100; }
export function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Draw `count` distinct questions for ONE student, mixing all question sets at random.
// Each pick chooses a random set (never the same set twice in a row while another set has questions left),
// then a random unused question from it. Questions the student saw in earlier attempts are skipped when enough unseen remain.
const qKey = q => (q.text ? String(q.text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '') || q.id;
function mixSets(list, count) { // random set per pick, never the same set twice in a row while another set has questions left
  const bySet = new Map();
  for (const q of list) { const k = q.question_set ?? 1; if (!bySet.has(k)) bySet.set(k, []); bySet.get(k).push(q); }
  const queues = [...bySet.values()].map(shuffle), out = []; let last = -1;
  while (out.length < count && queues.some(q => q.length)) {
    const live = queues.map((_, i) => i).filter(i => queues[i].length), cand = live.filter(i => i !== last), from = cand.length ? cand : live;
    last = from[crypto.randomInt(from.length)]; out.push(queues[last].pop());
  }
  return out;
}

// Questions are unique by id AND by wording (the same text stored twice counts once). Questions the student saw before
// (by id or wording) are used last, only when too few unseen questions remain.
export function pickQuestions(pool, count, seen = new Set()) {
  const byKey = new Map(); for (const q of pool) if (!byKey.has(qKey(q))) byKey.set(qKey(q), q);
  const seenKeys = new Set(pool.filter(q => seen.has(q.id)).map(qKey)), uniq = [...byKey.values()];
  const fresh = uniq.filter(q => !seen.has(q.id) && !seenKeys.has(qKey(q)));
  const out = mixSets(fresh, count);
  if (out.length < count) out.push(...mixSets(uniq.filter(q => !out.includes(q)), count - out.length));
  return out;
}

export function makeCouponCode(prefix = 'WIN-') {
  return prefix + crypto.randomBytes(3).toString('hex').toUpperCase();
}

export function couponState(c, now = new Date()) {
  if (!c) return 'none';
  if (c.status === 'revoked' || c.status === 'disabled') return c.status;
  if (isTestCoupon(c) || c.is_reusable) return 'active';
  if (c.status === 'redeemed') return 'redeemed';
  return new Date(c.expires_at) <= now ? 'expired' : 'active';
}

export function canRequestExtension(c, maxExtensions = 2) {
  if (!c) return false;
  if (isTestCoupon(c) || c.is_reusable) return false;
  if (c.status === 'redeemed' || c.status === 'revoked' || c.status === 'disabled') return false;
  return (Number(c.extension_count) || 0) < maxExtensions;
}

export function validateAnswer(b) {
  if (!b || typeof b.questionId !== 'string' || typeof b.optionId !== 'string' || b.optionId.length > 64) throw new Error('bad input');
}

/**
 * Server-side score calculator
 * Supports total_marks 100, pass_mark 30 (default), optional negative marking,
 * and individual question marks.
 */
export function calculateAssessmentScore({
  responses = [],
  questions = [],
  marksPerQuestion = 5,
  negativeMarking = 0,
  totalMarks = 100,
  passMark = 30
}) {
  const key = new Map(questions.map(q => [q.id, {
    correct: q.correct_option_id,
    marks: Number(q.marks) || marksPerQuestion
  }]));

  let rawScore = 0;
  let correctCount = 0;
  let wrongCount = 0;

  for (const r of responses) {
    const qInfo = key.get(r.question_id);
    if (!qInfo) continue;
    if (r.selected_option_id === qInfo.correct) {
      rawScore += qInfo.marks;
      correctCount++;
    } else if (r.selected_option_id) {
      rawScore -= (Number(negativeMarking) || 0);
      wrongCount++;
    }
  }

  const finalScore = Math.max(0, Math.min(totalMarks, Math.round(rawScore * 100) / 100));
  const scorePct = totalMarks > 0 ? Math.round((finalScore / totalMarks) * 10000) / 100 : 0;
  const isQualified = finalScore >= passMark;

  return {
    score: finalScore,
    totalMarks,
    passMark,
    correctCount,
    wrongCount,
    totalQuestions: questions.length,
    scorePercent: scorePct,
    isQualified
  };
}

// ---- Proctoring policy: 3 warnings, the 4th counted violation auto-submits ----
export const MAX_WARNINGS = 3, DEDUPE_MS = 5000;
export const VIOLATION_LABELS = {
  multiple_faces: 'More than one person detected', no_face: 'Face not visible', looking_away: 'Head turned away from the screen',
  face_mismatch: 'Face does not match the verified candidate', camera_unavailable: 'Camera unavailable or switched off', phone_detected: 'Phone detected',
  tab_switch: 'Left the test tab or window', fullscreen_exit: 'Exited full-screen mode', copy_paste: 'Copy / paste attempt', blocked_shortcut: 'Blocked keyboard shortcut (print / developer tools / save)',
  looking_down: 'Looked down for a long time (possible phone or notes)', noise_detected: 'Voices or loud noise detected' };
export const VIOLATION_TYPES = Object.keys(VIOLATION_LABELS);
// Advisory events are logged (with a snapshot) for admin review but never count toward the 3 warnings or auto-submit: they are too easy to trigger innocently.
export const ADVISORY_TYPES = ['looking_down', 'noise_detected'], MAX_SNAPSHOTS = 8, ADVISORY_GAP_MS = 30000;
// Accept only a small base64 JPEG data URL; anything else is dropped (the violation is still recorded).
export const cleanSnapshot = s => typeof s === 'string' && s.length < 60000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(s) ? s : null;
// A burst of events within DEDUPE_MS (e.g. one Alt-Tab firing blur + visibility + fullscreen) counts once.
export function violationDecision(countedSoFar, lastCountedAt, now = Date.now()) {
  const counted = !(lastCountedAt && now - new Date(lastCountedAt).getTime() < DEDUPE_MS);
  const total = countedSoFar + (counted ? 1 : 0);
  return { counted, total, warningsLeft: Math.max(0, MAX_WARNINGS - total), autoSubmit: total > MAX_WARNINGS };
}
export const STATUS_TEXT = { submitted: 'Submitted by candidate', timed_out: 'Auto-submitted: time elapsed', auto_submitted: 'Auto-submitted: proctoring violation limit exceeded', in_progress: 'In progress' };

/**
 * Normalizes a Date of Birth string (YYYY-MM-DD or DD-MM-YYYY) to ISO YYYY-MM-DD
 * and derives the 8-character assessment login password in DDMMYYYY format.
 */
export function parseDobCredentials(rawDob) {
  const s = String(rawDob || '').trim();
  let year, month, day;

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    year = Number(m[1]); month = Number(m[2]); day = Number(m[3]);
  } else {
    m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (m) {
      day = Number(m[1]); month = Number(m[2]); year = Number(m[3]);
    }
  }

  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1960 || year > new Date().getFullYear() - 12) return null;

  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    return null;
  }

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return {
    dobIso: `${year}-${mm}-${dd}`,
    password: `${dd}${mm}${year}`
  };
}

/**
 * Normalizes a DOB-formatted login key (e.g. "15/08/2004", "15 / 08 / 2004", "15-08-2004")
 * to 8-character DDMMYYYY while preserving arbitrary non-DOB passwords untouched.
 */
export function normalizeLoginPassword(rawPw) {
  const raw = String(rawPw || '');
  const m = raw.trim().match(/^(\d{2})\s*[/-]\s*(\d{2})\s*[/-]\s*(\d{4})$/);
  if (!m) return raw;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return raw;
  return `${m[1]}${m[2]}${m[3]}`;
}

export const SYLLABUS_TRACKS = [
  {
    id: 'tech-web',
    domainType: 'Technical',
    title: 'Full-Stack Web Development & Modern Architecture',
    duration: '30 Hours (10 Comprehensive Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    modules: [
      { day: 1, hours: 3, title: 'Web Fundamentals & Semantic HTML5', topics: ['DOM hierarchy', 'Accessibility standards', 'Modern HTML5 APIs', 'Meta viewports'] },
      { day: 2, hours: 3, title: 'Modern CSS3, Flexbox & Grid Systems', topics: ['CSS variables', 'Responsive layout engineering', 'Fluid typography', 'Micro-animations'] },
      { day: 3, hours: 3, title: 'JavaScript ES6+ & Asynchronous Pipelines', topics: ['Promises', 'Async/Await', 'Fetch API', 'Event loop mechanics'] },
      { day: 4, hours: 3, title: 'Git & Distributed Version Control', topics: ['Branching models', 'Pull requests', 'Merge conflict resolution', 'GitHub Actions'] },
      { day: 5, hours: 3, title: 'Node.js & Express API Microservices', topics: ['Middleware pipelines', 'Routing architecture', 'Request validation', 'Security headers'] },
      { day: 6, hours: 3, title: 'Database Schema & Relational Integrity', topics: ['PostgreSQL', 'Supabase integration', 'Row-Level Security (RLS)', 'Indexing'] },
      { day: 7, hours: 3, title: 'Component Engineering & UI Frameworks', topics: ['State management', 'Component lifecycles', 'Form validation', 'Interactive widgets'] },
      { day: 8, hours: 3, title: 'Payment Gateways & Webhook Security', topics: ['Razorpay HMAC signatures', 'Idempotency patterns', 'Transaction handling', 'Receipt PDF generation'] },
      { day: 9, hours: 3, title: 'Capstone Real-World Project Sprint', topics: ['Production deployment on Render', 'Reverse proxy configuration', 'Lighthouse optimization'] },
      { day: 10, hours: 3, title: 'Project Report Defense & Certification', topics: ['1-page technical abstract defense', 'Code audit', 'Certificate verification issuance'] }
    ]
  },
  {
    id: 'tech-app',
    domainType: 'Technical',
    title: 'Android & Cross-Platform App Development',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    modules: [
      { day: 1, hours: 3, title: 'Mobile OS Architecture & App Lifecycle', topics: ['Activity stack', 'Permissions model', 'Screen density adaptation'] },
      { day: 2, hours: 3, title: 'MIT App Inventor & Visual Logic Blocks', topics: ['Event handlers', 'Component tree', 'UI layouts'] },
      { day: 3, hours: 3, title: 'Sensors, Location & Hardware Integration', topics: ['GPS location', 'Accelerometer', 'Camera APIs'] },
      { day: 4, hours: 3, title: 'Local Data Storage & TinyDB Mechanics', topics: ['Key-value stores', 'Offline caching', 'Persistent state'] },
      { day: 5, hours: 3, title: 'RESTful API Connectivity for Mobile', topics: ['Web components', 'JSON parsing', 'Cloud backend sync'] },
      { day: 6, hours: 3, title: 'UI/UX Design Patterns for Mobile', topics: ['Touch targets', 'Gesture navigation', 'Dark/light themes'] },
      { day: 7, hours: 3, title: 'Push Notifications & Background Services', topics: ['Alert managers', 'Broadcast receivers', 'Timer events'] },
      { day: 8, hours: 3, title: 'App Security & Permission Sandboxing', topics: ['Cryptographic storage', 'Secure transport HTTPS', 'Input sanitization'] },
      { day: 9, hours: 3, title: 'APK Compilation, Testing & Debugging', topics: ['Logcat analysis', 'Package signing', 'Performance profiling'] },
      { day: 10, hours: 3, title: 'Mobile Capstone Presentation', topics: ['Published APK demo', '1-page project report submission'] }
    ]
  },
  {
    id: 'nontech-marketing',
    domainType: 'Non-Technical',
    title: 'Digital Operations, Analytics & Growth Strategy',
    duration: '30 Hours (10 Modules)',
    pdfUrl: '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf',
    modules: [
      { day: 1, hours: 3, title: 'Fundamentals of Digital Operations & Brand Funnels', topics: ['Customer journey', 'TOFU/MOFU/BOFU', 'Value proposition'] },
      { day: 2, hours: 3, title: 'Search Engine Optimization (SEO)', topics: ['On-page optimization', 'Technical SEO', 'Keyword research methodologies'] },
      { day: 3, hours: 3, title: 'Content Strategy & Creative Copywriting', topics: ['Editorial calendars', 'B2B storytelling', 'Conversion copywriting'] },
      { day: 4, hours: 3, title: 'Social Media Strategy & Audience Engagement', topics: ['LinkedIn B2B outreach', 'Instagram growth strategies', 'Algorithm patterns'] },
      { day: 5, hours: 3, title: 'Performance Marketing & Paid Ad Campaigns', topics: ['Google Ads search campaigns', 'Meta Ads Manager', 'Budgeting & ROAS'] },
      { day: 6, hours: 3, title: 'Business Analytics & KPI Dashboards', topics: ['Google Analytics 4', 'UTM tracking parameters', 'Conversion funnels'] },
      { day: 7, hours: 3, title: 'Email Marketing & Lead Nurturing Automations', topics: ['Drip sequences', 'Open rate optimization', 'Deliverability protocols'] },
      { day: 8, hours: 3, title: 'Market Research & Competitive Intelligence', topics: ['Competitor benchmarking', 'SWOT analysis', 'Pricing strategy'] },
      { day: 9, hours: 3, title: 'Growth Campaign Capstone Execution', topics: ['Live campaign simulation', 'A/B testing execution', 'Lead report'] },
      { day: 10, hours: 3, title: 'Campaign Defense & Growth Presentation', topics: ['Executive pitch', '1-page campaign report presentation'] }
    ]
  }
];

export const sharedSupportTickets = [];

export const sharedDevicePolicyState = {
  // Explicitly toggled value when DB test_settings.desktop_only column is absent
  desktopOnlyOverride: null,
  // Map of lowercase key (`uid:<id>`, `email:<email>`, `app:<appId>`) -> { allowed: boolean, reason: string, updatedAt: string }
  mobileOverrides: new Map(),
  // Shared in-memory mirror of recent blocked attempts (also persisted to admin_audit_logs)
  blockedEvents: []
};

const MOBILE_UA_RE = /\b(Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Kindle|Silk|PlayBook|Mobile|Tablet|Windows Phone|webOS)\b/i;
const MOBILE_CH_PLATFORM_RE = /^(Android|iOS|iPhone|iPad)$/i;

/**
 * Normalizes untrusted client device signal payload into typed flags.
 */
export function normalizeClientDeviceSignals(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.deviceSignals && typeof raw.deviceSignals === 'object' ? raw.deviceSignals : raw;
  const hasAny = ['ua', 'userAgent', 'userAgentDataMobile', 'maxTouchPoints', 'pointerCoarse', 'hoverNone', 'screenWidth']
    .some(k => src[k] !== undefined);
  if (!hasAny) return null;
  const sw = Number(src.screenWidth);
  const tp = Number(src.maxTouchPoints);
  return {
    ua: typeof (src.ua ?? src.userAgent) === 'string' ? String(src.ua ?? src.userAgent).slice(0, 400) : '',
    userAgentDataMobile: src.userAgentDataMobile === true,
    maxTouchPoints: Number.isFinite(tp) && tp >= 0 ? tp : 0,
    pointerCoarse: src.pointerCoarse === true,
    hoverNone: src.hoverNone === true,
    screenWidth: Number.isFinite(sw) && sw > 0 ? sw : 0
  };
}

/**
 * Evaluates whether a request originates from an allowed laptop/desktop computer.
 * Never rejects touch-capable laptops on touch count alone; rejects mobile/tablet UAs,
 * Sec-CH-UA-Mobile: ?1, coarse+no-hover devices, iPadOS desktop mode, and screens < 1024px.
 */
export function assessAssessmentDevice({
  headers = {},
  clientSignals = null,
  desktopOnly = true,
  mobileOverride = false
} = {}) {
  if (desktopOnly === false) {
    return { allowed: true, code: null, reason: 'desktop_only_disabled', signals: null };
  }
  if (mobileOverride === true) {
    return { allowed: true, code: null, reason: 'admin_mobile_override', signals: null };
  }

  const normalizedHeaders = {};
  for (const [k, v] of Object.entries(headers || {})) {
    normalizedHeaders[String(k).toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }

  const headerUa = String(normalizedHeaders['user-agent'] || '').trim();
  const secChMobile = String(normalizedHeaders['sec-ch-ua-mobile'] || '').trim();
  const secChPlatform = String(normalizedHeaders['sec-ch-ua-platform'] || '').trim().replace(/^"|"$/g, '');
  const sig = normalizeClientDeviceSignals(clientSignals);
  const effectiveUa = headerUa || sig?.ua || '';

  if (secChMobile === '?1') {
    return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'sec_ch_ua_mobile', signals: sig };
  }
  if (MOBILE_UA_RE.test(effectiveUa)) {
    return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'user_agent_mobile_or_tablet', signals: sig };
  }
  if (MOBILE_CH_PLATFORM_RE.test(secChPlatform)) {
    return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'sec_ch_ua_platform', signals: sig };
  }

  if (sig) {
    if (sig.userAgentDataMobile) {
      return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'client_uadata_mobile', signals: sig };
    }
    if (sig.pointerCoarse && sig.hoverNone) {
      return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'coarse_pointer_no_hover', signals: sig };
    }
    // iPadOS "Request Desktop Site" presents a Macintosh UA with multi-touch (>1 touch point)
    if (/Macintosh/i.test(effectiveUa) && sig.maxTouchPoints > 1) {
      return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'ipad_desktop_mode', signals: sig };
    }
    if (sig.screenWidth > 0 && sig.screenWidth < 1024) {
      return { allowed: false, code: 'DEVICE_NOT_ALLOWED', reason: 'small_screen_width', signals: sig };
    }
  }

  return { allowed: true, code: null, reason: 'desktop_verified', signals: sig };
}

/**
 * Resolves the external public base URL for Open Graph share previews, sitemaps,
 * and email links. Prevents a local dev PUBLIC_BASE_URL (e.g. http://localhost:8787)
 * from overriding a real deployed or tunneled request host.
 */
export function resolvePublicBaseUrl({ envBaseUrl = '', headers = {}, protocol = 'https', host = '' } = {}) {
  const isLocalHost = h => /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(String(h || '').trim());
  const isLocalOrigin = u => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(String(u || '').trim());

  const hNorm = {};
  for (const [k, v] of Object.entries(headers || {})) {
    hNorm[String(k).toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }

  const reqHost = String(hNorm['x-forwarded-host'] || hNorm.host || host || '').split(',')[0].trim();
  const reqProtoRaw = String(hNorm['x-forwarded-proto'] || protocol || 'https').split(',')[0].trim().toLowerCase();
  const envClean = String(envBaseUrl || '').trim().replace(/\/$/, '');

  if (envClean && (!isLocalOrigin(envClean) || !reqHost || isLocalHost(reqHost))) {
    return envClean;
  }
  if (reqHost) {
    const proto = isLocalHost(reqHost) ? (reqProtoRaw || 'http') : (reqProtoRaw === 'http' ? 'https' : reqProtoRaw);
    return `${proto}://${reqHost}`;
  }
  return envClean || 'http://localhost:8787';
}

export const sharedRecordedVideos = [];
export const sharedDeletedVideoIds = new Set();

/**
 * Extracts normalized YouTube video metadata from watch, short, live, embed, or youtu.be URLs.
 */
export function parseYouTubeUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return null;
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  let videoId = '';
  if (host === 'youtu.be') {
    videoId = u.pathname.replace(/^\/+/, '').split('/')[0];
  } else if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    if (u.pathname === '/watch') {
      videoId = u.searchParams.get('v') || '';
    } else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) videoId = m[1];
    }
  } else {
    return null;
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return {
    videoId,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  };
}

function normalizeVideoRow(r) {
  if (!r) return null;
  const parsed = parseYouTubeUrl(r.youtube_url || r.youtubeUrl || r.url || r.youtube_id || r.youtubeId);
  const ytId = r.youtube_id || r.youtubeId || parsed?.videoId || '';
  return {
    id: String(r.id),
    title: String(r.title || 'Recorded Session').trim(),
    youtube_url: r.youtube_url || r.youtubeUrl || r.url || parsed?.watchUrl || '',
    youtube_id: ytId,
    embed_url: r.embed_url || r.embedUrl || (ytId ? `https://www.youtube-nocookie.com/embed/${ytId}?rel=0` : ''),
    thumbnail_url: r.thumbnail_url || r.thumbnailUrl || (ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : ''),
    track: String(r.track || 'all').trim(),
    mode: String(r.mode || 'all').trim(),
    session_number: r.session_number || r.sessionNumber || 'RECORDING',
    duration: r.duration || 'YouTube',
    instructor: r.instructor || 'Plant Green Inertia Mentor',
    summary: r.summary || '',
    created_at: r.created_at || new Date().toISOString()
  };
}

export async function loadRecordedVideos(db) {
  try {
    const { data, error } = await db
      .from('recorded_videos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (!error && Array.isArray(data)) {
      const normalized = data.map(normalizeVideoRow).filter(Boolean);
      sharedRecordedVideos.length = 0;
      sharedRecordedVideos.push(...normalized);
      return normalized;
    }
  } catch {}

  const byId = new Map();
  try {
    const { data: logs } = await db
      .from('admin_audit_logs')
      .select('action,target_id,details,created_at')
      .in('action', ['ADD_RECORDED_VIDEO', 'DELETE_RECORDED_VIDEO'])
      .order('created_at', { ascending: true })
      .limit(1000);
    for (const row of logs || []) {
      if (row.action === 'ADD_RECORDED_VIDEO' && row.details?.id) {
        if (!sharedDeletedVideoIds.has(row.details.id)) {
          byId.set(row.details.id, normalizeVideoRow({ ...row.details, created_at: row.details.created_at || row.created_at }));
        }
      } else if (row.action === 'DELETE_RECORDED_VIDEO' && row.target_id) {
        byId.delete(row.target_id);
      }
    }
  } catch {}

  for (const v of sharedRecordedVideos) {
    if (v?.id && !sharedDeletedVideoIds.has(v.id)) {
      byId.set(v.id, normalizeVideoRow(v));
    }
  }
  return [...byId.values()].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

export async function saveRecordedVideo(db, rawRecord) {
  const record = normalizeVideoRow(rawRecord);
  sharedDeletedVideoIds.delete(record.id);
  const idx = sharedRecordedVideos.findIndex(v => v.id === record.id);
  if (idx >= 0) sharedRecordedVideos[idx] = record;
  else sharedRecordedVideos.unshift(record);

  try {
    const { error } = await db.from('recorded_videos').insert(record);
    if (error && !/relation|does not exist|schema cache|PGRST205/i.test(error.message || '')) {
      throw error;
    }
  } catch (err) {
    if (!/relation|does not exist|schema cache|PGRST205/i.test(err?.message || '')) {
      throw err;
    }
  }
  return record;
}

export async function deleteRecordedVideo(db, id) {
  const cleanId = String(id || '').trim();
  sharedDeletedVideoIds.add(cleanId);
  for (let i = sharedRecordedVideos.length - 1; i >= 0; i--) {
    if (sharedRecordedVideos[i]?.id === cleanId) sharedRecordedVideos.splice(i, 1);
  }
  try {
    const { error } = await db.from('recorded_videos').delete().eq('id', cleanId);
    if (error && !/relation|does not exist|schema cache|PGRST205/i.test(error.message || '')) {
      throw error;
    }
  } catch (err) {
    if (!/relation|does not exist|schema cache|PGRST205/i.test(err?.message || '')) {
      throw err;
    }
  }
  return true;
}
