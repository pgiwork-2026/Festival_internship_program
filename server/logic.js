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
export function makeCouponCode() { return 'VIJ-' + crypto.randomBytes(6).toString('hex').toUpperCase(); }
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
  tab_switch: 'Left the test tab or window', fullscreen_exit: 'Exited full-screen mode', copy_paste: 'Copy / paste attempt', blocked_shortcut: 'Blocked keyboard shortcut (print / developer tools / save)' };
export const VIOLATION_TYPES = Object.keys(VIOLATION_LABELS);
// A burst of events within DEDUPE_MS (e.g. one Alt-Tab firing blur + visibility + fullscreen) counts once.
export function violationDecision(countedSoFar, lastCountedAt, now = Date.now()) {
  const counted = !(lastCountedAt && now - new Date(lastCountedAt).getTime() < DEDUPE_MS);
  const total = countedSoFar + (counted ? 1 : 0);
  return { counted, total, warningsLeft: Math.max(0, MAX_WARNINGS - total), autoSubmit: total > MAX_WARNINGS };
}
export const STATUS_TEXT = { submitted: 'Submitted by candidate', timed_out: 'Auto-submitted: time elapsed', auto_submitted: 'Auto-submitted: proctoring violation limit exceeded', in_progress: 'In progress' };