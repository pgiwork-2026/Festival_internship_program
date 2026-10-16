import test from 'node:test'; import assert from 'node:assert/strict';
import { poseFromMatrix, makeTracker, signature, sigDistance, THRESH } from '../../public/static/js/proctor-core.js';
import { violationDecision, MAX_WARNINGS } from '../logic.js';
import { violationRows } from '../report.js';

test('3 warnings then the 4th counted violation auto-submits', () => {
  let n = 0, t = 0; const out = [];
  for (let i = 0; i < 5; i++) { t += 10000; const d = violationDecision(n, n ? t - 10000 : null, t); if (d.counted) n++; out.push(d); }
  assert.deepEqual(out.map(d => d.autoSubmit), [false, false, false, true, true]);
  assert.deepEqual(out.slice(0, 3).map(d => d.warningsLeft), [2, 1, 0]); assert.equal(MAX_WARNINGS, 3);
});
test('burst of events inside 5 s counts once', () => {
  const a = violationDecision(0, null, 1000), b = violationDecision(1, new Date(1000), 3000);
  assert.equal(a.counted, true); assert.equal(b.counted, false); assert.equal(b.total, 1);
});
test('head pose from rotation matrices', () => {
  const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
  assert.ok(Math.abs(Math.abs(poseFromMatrix(rotY(0.6)).yaw) - 34.4) < 0.5);
  assert.ok(Math.abs(poseFromMatrix(rotY(0)).yaw) < 0.01); assert.deepEqual(poseFromMatrix(null), { yaw: 0, pitch: 0 });
});
test('tracker: hold time, latch, repeat, re-arm', () => {
  const tr = makeTracker({ no_face: 4000 }, 15000);
  assert.equal(tr('no_face', true, 0), false); assert.equal(tr('no_face', true, 3999), false); assert.equal(tr('no_face', true, 4000), true);
  assert.equal(tr('no_face', true, 10000), false); assert.equal(tr('no_face', true, 19000), true);
  tr('no_face', false, 20000); assert.equal(tr('no_face', true, 21000), false); assert.equal(tr('no_face', true, 25000), true);
});
test('face signature: same face ~0, different proportions exceed threshold', () => {
  const mk = k => Array.from({ length: 468 }, (_, i) => ({ x: .5 + Math.sin(i * 1.7) * .15 * k, y: .5 + Math.cos(i * 2.3) * .2, z: Math.sin(i) * .02 })); // k = wider/narrower face
  const a = signature(mk(1)), b = signature(mk(1)), c = signature(mk(2.5));
  assert.ok(sigDistance(a, b) < 1e-9); assert.ok(sigDistance(c, a) > THRESH.sig);
});
test('violation log labels: warnings 1-3, then auto-submit; duplicates flagged', () => {
  const v = [1, 2, 3, 4].map(i => ({ type: 'no_face', counted: true, occurred_at: new Date(i * 1e4) })); v.splice(1, 0, { type: 'tab_switch', counted: false, occurred_at: new Date(15000) });
  assert.deepEqual(violationRows(v).map(r => r.action), ['Warning 1 of 3', 'Duplicate (not counted)', 'Warning 2 of 3', 'Warning 3 of 3', 'Test auto-submitted']);
});

test('advisory events are logged for review but never count toward warnings', () => {
  const v = [{ type: 'noise_detected', counted: false, occurred_at: new Date(1e4) }, { type: 'tab_switch', counted: true, occurred_at: new Date(2e4) }, { type: 'looking_down', counted: false, occurred_at: new Date(3e4) }];
  assert.deepEqual(violationRows(v).map(r => r.action), ['Logged for review (not counted)', 'Warning 1 of 3', 'Logged for review (not counted)']);
});
test('snapshots: only small JPEG data URLs are accepted', async () => {
  const { cleanSnapshot, ADVISORY_TYPES, VIOLATION_TYPES } = await import('../logic.js');
  assert.equal(cleanSnapshot('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='), 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==');
  for (const bad of [null, 5, 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/jpeg;base64,<script>', 'data:image/jpeg;base64,' + 'A'.repeat(70000)]) assert.equal(cleanSnapshot(bad), null);
  assert.ok(ADVISORY_TYPES.every(t => VIOLATION_TYPES.includes(t)));
});
test('mic + eyes-down maths', async () => {
  const { downScore, rms, noiseLimit } = await import('../../public/static/js/proctor-core.js');
  assert.equal(downScore(null), 0);
  assert.ok(Math.abs(downScore([{ categoryName: 'eyeLookDownLeft', score: 0.6 }, { categoryName: 'eyeLookDownRight', score: 0.4 }, { categoryName: 'eyeLookUpLeft', score: 0.9 }]) - 0.5) < 1e-9);
  assert.equal(rms([]), 0); assert.ok(Math.abs(rms([0.5, -0.5, 0.5, -0.5]) - 0.5) < 1e-9);
  assert.equal(noiseLimit(0.004), 0.05); assert.ok(Math.abs(noiseLimit(0.03) - 0.09) < 1e-9);
});
