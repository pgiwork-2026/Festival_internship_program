// Pure proctoring maths (no DOM) so it can be unit-tested with `npm test`.
export const THRESH = { yaw: 28, pitch: 22, sig: 0.16, hold: { no_face: 4000, multiple_faces: 2000, looking_away: 3000, face_mismatch: 0, phone_detected: 1500 }, repeatMs: 15000 };
const deg = r => r * 180 / Math.PI;
// MediaPipe facialTransformationMatrix (4x4, column-major) -> head yaw/pitch in degrees.
export function poseFromMatrix(m) {
  if (!m || m.length < 16) return { yaw: 0, pitch: 0 };
  const R = (r, c) => m[c * 4 + r];
  return { yaw: deg(Math.atan2(-R(2, 0), Math.hypot(R(0, 0), R(1, 0)))), pitch: deg(Math.atan2(R(2, 1), R(2, 2))) };
}
// Identity signature: pose-robust ratios between stable facial landmarks, normalised by eye distance.
const PAIRS = [[33, 133], [362, 263], [133, 362], [1, 168], [1, 152], [61, 291], [10, 152], [234, 454], [98, 327], [70, 300], [1, 61], [1, 291], [168, 152], [10, 1], [33, 61], [263, 291]];
export function signature(lm, w = 1, h = 1) {
  const d = (i, j) => Math.hypot((lm[i].x - lm[j].x) * w, (lm[i].y - lm[j].y) * h, ((lm[i].z || 0) - (lm[j].z || 0)) * w), ref = d(33, 263) || 1;
  return PAIRS.map(([i, j]) => d(i, j) / ref);
}
export const sigDistance = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]) / (b[i] || 1), 0) / a.length;
export const median = xs => { const s = [...xs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
export const medianSig = sigs => sigs[0].map((_, i) => median(sigs.map(s => s[i])));
// A condition fires once after it has persisted `hold` ms, then again every repeatMs while it keeps persisting; it re-arms when it clears.
export function makeTracker(hold = THRESH.hold, repeatMs = THRESH.repeatMs) {
  const st = {};
  return (key, active, now) => {
    const s = st[key] ||= { since: null, last: 0 };
    if (!active) { s.since = null; s.last = 0; return false; }
    s.since ??= now;
    if (now - s.since >= (hold[key] ?? 2000) && (!s.last || now - s.last >= repeatMs)) { s.last = now; return true; }
    return false;
  };
}