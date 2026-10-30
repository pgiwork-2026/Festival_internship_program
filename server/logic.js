import crypto from 'node:crypto';
export const BASE_PRICE_PAISE = 999900;
// Integer-only tier calc. correct/total compared via cross-multiplication (no floats).
export function tierFor(correct, total) {
  if (!Number.isInteger(correct) || !Number.isInteger(total) || total <= 0 || correct < 0 || correct > total) throw new Error('invalid score');
  if (correct === total) return 100;
  return correct * 100 >= total * 50 ? 90 : 85;
}
export function payablePaise(basePaise, discountPercent) {
  if (![85, 90, 100].includes(discountPercent)) throw new Error('invalid tier');
  if (!Number.isInteger(basePaise) || basePaise < 0) throw new Error('invalid price');
  // integer half-up rounding; for the 999900 base this is exact (149985 / 99990 / 0)
  return Math.floor((basePaise * (100 - discountPercent) + 50) / 100);
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
export function makeCouponCode() { return 'DIW-' + crypto.randomBytes(6).toString('hex').toUpperCase(); }
export function couponState(c, now = new Date()) {
  if (c.status === 'redeemed') return 'redeemed';
  return new Date(c.expires_at) <= now ? 'expired' : 'active';
}
export function validateAnswer(b) {
  if (!b || typeof b.questionId !== 'string' || typeof b.optionId !== 'string' || b.optionId.length > 64) throw new Error('bad input');
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