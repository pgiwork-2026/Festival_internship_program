(async () => {
const $ = id => document.getElementById(id);
const show = id => { document.querySelectorAll('main > section, #loading').forEach(e => e.classList.add('hidden')); const b = $('bookroot');
  if (id in BOOK || id === 's-test') { b.classList.remove('hidden'); if (id === 's-test') $('s-test').classList.remove('hidden'); else bk.step(id); } else { b && b.classList.add('hidden'); $(id).classList.remove('hidden'); } };
const msg = (id, t, ok) => { const e = $(id); e.textContent = t; e.className = 'msg ' + (ok ? 'ok' : 'err'); };
const inr = p => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let lastCoupon = null, me2 = null, cfg, sb, token, stream, micStream = null, attempt, skew = 0, timerH, faceH, lastViol = {}, mode = 'register', proctor = null, enrolled = false, attemptId = null, warnings = 0;
const LABEL = { blocked_shortcut: 'Blocked keyboard shortcut used', multiple_faces: 'More than one person detected', no_face: 'Your face is not visible', looking_away: 'Your head is turned away from the screen', face_mismatch: 'Your face does not match the verified candidate', camera_unavailable: 'Your camera is unavailable or switched off', tab_switch: 'You left the test tab or window', fullscreen_exit: 'You exited full-screen mode', copy_paste: 'Copy / paste is not allowed', phone_detected: 'A mobile phone was detected in the camera view', looking_down: 'You were looking down for a long time', noise_detected: 'Voices or loud noise were detected' };
const live = () => !$('s-test').classList.contains('hidden') && !finishing;

try { cfg = await (await fetch('/api/config')).json(); } catch { $('loading').textContent = 'Cannot reach the server. Please try again later.'; return; }
sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
async function api(path, body, method) {
  const r = await fetch('/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), { status: r.status }); return j;
}
function authMode(m) { mode = m; const reg = m === 'register';
  $('auth-title').textContent = reg ? 'Register for the Scholarship Assessment' : 'Log in to continue';
  $('f-name').classList.toggle('hidden', !reg); $('f-phone').classList.toggle('hidden', !reg);
  $('auth-go').textContent = reg ? 'Register' : 'Log in'; $('auth-toggle').textContent = reg ? 'I already have an account' : 'Create a new account'; msg('auth-msg', ''); }
$('auth-toggle').onclick = () => authMode(mode === 'register' ? 'login' : 'register');
$('auth-go').onclick = async () => {
  const email = $('email').value.trim(), pw = $('pw').value; if (!email || pw.length < 8) return msg('auth-msg', 'Enter a valid email and a password of at least 8 characters.');
  $('auth-go').disabled = true; msg('auth-msg', 'Please wait…', true);
  try {
    if (mode === 'register') {
      const name = $('name').value.trim(), phone = $('phone').value.trim();
      if (name.length < 2 || !/^[0-9+\-\s]{10,15}$/.test(phone)) throw new Error('Enter your full name and a valid mobile number.');
      localStorage.setItem('pendingProfile', JSON.stringify({ name, phone }));
      const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: { full_name: name } } });
      if (error) throw error;
      if (!data.session) { msg('auth-msg', 'Account created. Check your email to confirm, then log in.', true); authMode('login'); return; }
    } else { const { error } = await sb.auth.signInWithPassword({ email, password: pw }); if (error) throw error; }
    await boot();
  } catch (e) { msg('auth-msg', e.message); } finally { $('auth-go').disabled = false; }
};
$('logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
$('p-save').onclick = async () => { try { $('p-save').disabled = true; await api('/profile', { fullName: $('p-name').value.trim(), phone: $('p-phone').value.trim() }); await boot(); } catch (e) { msg('p-msg', e.message); } finally { $('p-save').disabled = false; } };
async function startCamera() {
  if (stream) return true;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }); stream.getVideoTracks()[0].addEventListener('ended', () => live() && violation('camera_unavailable')); $('prev').srcObject = stream; $('pvid').srcObject = stream; $('prev').classList.remove('hidden'); try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } }); } catch { micStream = null; }
    msg('cam-msg', 'Camera is working.' + (micStream ? ' Microphone is on (used only to detect voices or loud noise; nothing is recorded).' : ' Microphone not available, so the voice check is off.'), true); return true; }
  catch { msg('cam-msg', cfg.requireCamera ? 'Camera access is required for this test. Allow camera permission in your browser settings, then click the button again.' : 'Camera unavailable. You may continue, but this will be logged and reviewed by admins.'); return false; }
}
const gate = () => $('begin').disabled = !($('agree').checked && (enrolled || !cfg.requireCamera));
async function verifyFace() { if (enrolled) return; $('cam-go').disabled = true; msg('face-msg', 'Loading face verification…', true);
  try { proctor ||= await (await import('/static/js/proctor.js')).createProctor($('prev')); msg('face-msg', 'Look straight at the camera and stay still…', true);
    enrolled = await proctor.enroll(t => msg('face-msg', t, true)); msg('face-msg', enrolled ? 'Face verified ✓ You can start the test.' : 'Could not verify your face. Improve the lighting and try again.', enrolled);
  } catch (e) { msg('face-msg', cfg.requireCamera ? 'Face verification could not start (' + e.message + ') Check your connection and try again.' : 'Face detection is unavailable; the test will continue with limited monitoring.', !cfg.requireCamera); }
  $('cam-go').disabled = false; gate(); }
$('cam-go').onclick = async () => { if (await startCamera()) verifyFace(); };
$('agree').onchange = gate;
$('begin').onclick = async () => {
  try { document.fullscreenEnabled && document.documentElement.requestFullscreen().catch(() => {}); } catch {} // needs the click gesture, so before any await
  $('begin').disabled = true; const ok = await startCamera(); if (!ok && cfg.requireCamera) { $('begin').disabled = false; return; }
  try { attempt = await api('/attempts/start', {}); runTest(); if (!ok) violation('camera_unavailable'); }
  catch (e) { msg('inst-msg', e.message); $('begin').disabled = false; }
};
function clean(html) { const d = new DOMParser().parseFromString(html, 'text/html'), out = document.createDocumentFragment();
  (function walk(n, to) { n.childNodes.forEach(c => { if (c.nodeType === 3) to.appendChild(document.createTextNode(c.textContent)); else if (['PRE', 'CODE', 'B', 'I', 'BR'].includes(c.nodeName)) { const e = document.createElement(c.nodeName); to.appendChild(e); walk(c, e); } else walk(c, to); }); })(d.body, out); return out; }
function runTest() {
  attemptId = attempt.attemptId; warnings = attempt.violations || 0; updWarn(); show('s-test'); $('pvid').classList.remove('hidden'); skew = new Date(attempt.serverTime) - Date.now();
  bk.startTest();
  updProg(); tick(); timerH = setInterval(tick, 500);
  if (proctor && enrolled) proctor.start(violation, (t, ok) => { $('mon').textContent = t; $('mon').className = ok ? 'ok' : 'err'; }, micStream);
}

// ---- Book UI: every assessment step is a page. Presentation only; existing handlers/logic are untouched. ----
let bk = null;
const BOOK = { 's-auth': 'auth', 's-profile': 'profile', 's-inst': 'rules', 's-res': 'res' };
function initBook() {
  const E = (t, c, p) => { const e = document.createElement(t); if (c) e.className = c; if (p) p.appendChild(e); return e; };
  const root = E('div', 'hidden'); root.id = 'bookroot'; $('s-test').after(root);
  const wrap = E('div', 'book-wrap', root), stage = E('div', 'book', wrap), nav = E('div', 'book-nav', wrap);
  const prev = E('button', 'alt', nav), info = E('span', 'book-info', nav), next = E('button', '', nav);
  nav.insertBefore($('pvid'), next); prev.textContent = '‹ Previous'; next.textContent = 'Next ›'; info.setAttribute('aria-live', 'polite');
  const q = E('span'); q.id = 'qpos'; $('prog').before(q);
  const lb = E('div', 'lbase', stage); lb.innerHTML = '<div class="verso"><div class="orn">❖ ✦ ❖</div><div class="vt">Vijayadashami<br>Scholarship Assessment</div><div class="orn">❖ ✦ ❖</div></div>'; E('div', 'spine', stage);
  const two = matchMedia('(min-width:900px)'), sync = () => stage.classList.toggle('spread', two.matches);
  const rmq = matchMedia('(prefers-reduced-motion: reduce)'), B = bk = { L: [], cur: 0, busy: false, drag: null, shown: false, N: 0 };
  const mk = (key, title, nodes) => { const el = E('div', 'leaf off', stage), f = E('div', 'face front', el); el.dataset.key = key; const bf = E('div', 'face back', el); bf.innerHTML = '<div class="verso"><div class="orn">❖</div><div class="vt"></div><div class="orn">✦ ✦ ✦</div></div>'; E('div', 'shade', bf); const shade = E('div', 'shade', f);
    const pg = E('div', 'pg', f), foot = E('div', 'folio', f); nodes.forEach(n => pg.appendChild(n)); return { key, title, el, pg, foot, shade, avail: false }; };
  const sec = id => { const e = $(id); e.className = 'bpage'; return [e]; };
  const si = $('s-inst'), h1 = si.querySelector('h1'), ul = si.querySelector('ul'), rest = [...si.children].filter(c => c !== h1 && c !== ul), ch = E('h2'); ch.textContent = 'Camera & face verification';
  const rv = E('div'); rv.innerHTML = '<h2>Review &amp; submit</h2><p id="bk-rev"></p><div class="chips" id="bk-chips"></div>'; rv.append($('submit'), $('t-msg'));
  B.L = [mk('auth', 'Registration', sec('s-auth')), mk('profile', 'Student profile', sec('s-profile')), mk('rules', 'Instructions', [h1, ul]), mk('camera', 'Camera & verification', [ch, ...rest]), mk('review', 'Review & submit', [rv]), mk('res', 'Result', sec('s-res'))];
  const ang = (l, a, d) => { l.el.style.transform = a ? `rotateY(${-a}deg)` : 'none'; l.shade.style.opacity = d ? Math.sin(a / 180 * Math.PI) * .5 : ''; };
  const pvOf = i => { for (let j = i - 1; j >= 0; j--) if (B.L[j].avail) return j; return -1; };
  const T = () => B.L.length, idx = k => B.L.findIndex(l => l.key === k);
  const nb = d => { for (let i = B.cur + d; i >= 0 && i < T(); i += d) if (B.L[i].avail) return i; return -1; };
  B.ui = () => { const l = B.L[B.cur], n = B.N, isq = l.key === 'q'; prev.disabled = nb(-1) < 0; next.disabled = nb(1) < 0;
    info.textContent = isq ? `Question ${l.qi + 1} of ${n}` : l.title; $('qpos').textContent = isq ? `Q ${l.qi + 1}/${n}` : ''; B.L.forEach((x, i) => { x.el.toggleAttribute('inert', i !== B.cur); x.el.setAttribute('aria-hidden', i !== B.cur); x.el.querySelector('.vt').textContent = x.key === 'q' ? `Question ${x.qi + 1}` : x.title; x.foot.textContent = x.key === 'q' ? `Question ${x.qi + 1} of ${n}` : '✦'; }); };
  B.settle = () => { const pv = two.matches ? nb(-1) : -1; B.L.forEach((l, i) => { const e = l.el; e.classList.remove('turning', 'hold', 'drag', 'rise', 'sink'); e.style.transitionDelay = e.style.transitionDuration = ''; e.style.zIndex = i < B.cur ? i + 1 : T() - i; e.classList.toggle('off', !l.avail || (i < B.cur && i !== pv)); ang(l, i < B.cur ? 180 : 0); }); B.busy = false; B.ui(); };
  B.go = (t, o = {}) => { if (t === B.cur || t < 0 || t >= T()) return; const from = B.cur, fwd = t > from, fast = rmq.matches, flip = [];
    for (let i = fwd ? from : t; i < (fwd ? t : from); i++) if (B.L[i].avail || i === from || i === t) flip.push(i);
    if (!fwd) flip.reverse(); B.cur = t; B.busy = true; const dur = fast ? 0 : o.dur || 1.05; if (!fwd && two.matches && pvOf(t) >= 0) B.L[pvOf(t)].el.classList.add('hold');
    flip.forEach((i, k) => { const e = B.L[i].el; e.classList.remove('drag'); e.classList.add('turning'); e.style.zIndex = 1000 - k; e.style.transitionDuration = dur + 's'; e.style.setProperty('--dur', dur + 's'); e.style.transitionDelay = fast ? '' : Math.min(k, 3) * .09 + 's'; });
    B.L[fwd ? t : from].el.classList.add(fwd ? 'rise' : 'sink', 'hold'); void stage.offsetWidth;
    B.L.forEach((l, i) => ang(l, i < t ? 180 : 0)); B.ui(); setTimeout(B.settle, fast ? 0 : dur * 1000 + Math.min(flip.length - 1, 3) * 90 + 60); };
  B.step = id => { const key = BOOK[id], keys = key === 'rules' ? ['rules', 'camera'] : [key]; B.L.forEach(l => l.avail = keys.includes(l.key)); const t = idx(key);
    if (B.shown) return B.go(t); B.shown = true; B.cur = t; B.settle();
    if (!rmq.matches) { const c = E('div', 'cover', stage); c.innerHTML = '<div class="ctitle">Vijayadashami<br>Scholarship Assessment</div><div class="orn">❖ ✦ ❖</div>'; stage.classList.add('opening');
      requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add('opened'))); setTimeout(() => { c.remove(); stage.classList.remove('opening'); }, 1700); } };
  B.startTest = () => { B.L = B.L.filter(l => l.key !== 'q'); const qs = attempt.questions; B.N = qs.length; const ri = idx('review');
    const ql = qs.map((qq, i) => { const d = E('div', 'q'), h = E('div', 'qtext', d); h.append(`${i + 1}. `, clean(qq.text));
      qq.options.forEach(o => { const l = E('label', 'opt', d), r = document.createElement('input'); r.type = 'radio'; r.name = qq.id; r.checked = attempt.saved[qq.id] === o.id; r.onchange = () => save(qq.id, o.id); l.append(r, ' ', o.text); });
      const L = mk('q', '', [d]); L.qi = i; L.el.dataset.qi = i; return L; });
    B.L.splice(ri, 0, ...ql); B.L.forEach(l => l.avail = l.key === 'q' || l.key === 'review');
    const f = qs.findIndex(x => !attempt.saved[x.id]); B.L.forEach((l, i) => { l.el.style.zIndex = T() - i; });
    B.go(idx('review') > 0 ? (Object.keys(attempt.saved).length ? (f < 0 ? idx('review') : idx('q') + f) : idx('q')) : 0); };
  B.review = () => { if (!B.N || !attempt) return; const miss = attempt.questions.map((x, i) => attempt.saved[x.id] ? 0 : i + 1).filter(Boolean);
    $('bk-rev').textContent = miss.length ? `Unanswered: ${miss.length} of ${B.N}. Tap a number to go back to it.` : 'All questions answered. You may submit.';
    const c = $('bk-chips'); c.innerHTML = ''; attempt.questions.forEach((x, i) => { const b = document.createElement('button'); b.textContent = i + 1; b.className = 'chip' + (attempt.saved[x.id] ? ' done' : ''); b.onclick = () => !B.busy && B.go(idx('q') + i); c.appendChild(b); }); };
  prev.onclick = () => { if (!B.busy && nb(-1) >= 0) B.go(nb(-1)); }; next.onclick = () => { if (!B.busy && nb(1) >= 0) B.go(nb(1)); };
  // drag / swipe
  let sx = 0, sy = 0, st = 0, pid = null, swallow = false;
  stage.addEventListener('pointerdown', e => { if (e.button > 0 || pid !== null || B.busy || /INPUT|TEXTAREA|SELECT|VIDEO/.test(e.target.tagName) && e.target.type !== 'radio') return; pid = e.pointerId; sx = e.clientX; sy = e.clientY; st = e.timeStamp; B.drag = null; });
  stage.addEventListener('pointermove', e => { if (e.pointerId !== pid) return; const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!B.drag) { if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return; const fwd = dx < 0, n = nb(fwd ? 1 : -1); if (n < 0) return; const l = B.L[fwd ? B.cur : n]; B.drag = { fwd, n, l, p: 0 };
      l.el.classList.add('drag', 'turning'); l.el.style.zIndex = 1000; if (!fwd && two.matches && pvOf(n) >= 0) B.L[pvOf(n)].el.classList.add('hold'); B.L[fwd ? n : B.cur].el.classList.add('hold'); try { stage.setPointerCapture(pid); } catch {} }
    const p = Math.min(1, Math.max(0, (B.drag.fwd ? -dx : dx) / (B.L[B.cur].el.clientWidth * .9))); B.drag.p = p; B.drag.v = (B.drag.fwd ? -dx : dx) / Math.max(1, e.timeStamp - st); ang(B.drag.l, B.drag.fwd ? p * 180 : 180 - p * 180, true); });
  const end = (e, ok) => { if (e.pointerId !== pid) return; pid = null; const d = B.drag; if (!d) return; B.drag = null; swallow = true; setTimeout(() => swallow = false, 0);
    if (ok && (d.p > .25 || d.v > .5 && d.p > .06)) { d.l.el.classList.remove('drag'); B.go(d.n, { dur: Math.max(.4, 1.05 * (1 - d.p)) }); }
    else { B.busy = true; const e2 = d.l.el; e2.classList.remove('drag'); e2.style.transitionDuration = '.35s'; ang(d.l, d.fwd ? 0 : 180); setTimeout(B.settle, 400); } };
  stage.addEventListener('pointerup', e => end(e, true)); stage.addEventListener('pointercancel', e => end(e, false));
  stage.addEventListener('click', e => { if (swallow) { e.preventDefault(); e.stopPropagation(); } }, true);
  let acc = 0; stage.addEventListener('wheel', e => { if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) { const sc = e.target.closest && e.target.closest('.pg'); if (sc && sc.scrollHeight > sc.clientHeight) { sc.scrollTop += e.deltaY * (e.deltaMode === 1 ? 16 : 1); e.preventDefault(); } return; } if (!e.deltaX) return; e.preventDefault(); if (B.busy) return; acc += e.deltaX;
    if (Math.abs(acc) > 70) { const n = nb(acc > 0 ? 1 : -1); acc = 0; if (n >= 0) B.go(n); } }, { passive: false });
  two.addEventListener('change', () => { sync(); B.shown && B.settle(); }); sync();
}
initBook();
const updProg = () => { $('prog').textContent = `Answered ${Object.keys(attempt.saved).length}/${attempt.questions.length}`; bk && bk.review && bk.review(); };
async function save(qid, oid) {
  attempt.saved[qid] = oid; updProg(); $('saved').textContent = 'Saving…';
  for (let i = 0; i < 4; i++) { try { await api(`/attempts/${attempt.attemptId}/answer`, { questionId: qid, optionId: oid }); $('saved').textContent = 'Saved ✓'; return; }
    catch (e) { if (e.status === 410) return finish(); await new Promise(r => setTimeout(r, 800 * (i + 1))); } }
  $('saved').textContent = ''; msg('t-msg', 'Could not save your last answer. Check your connection; it will retry when you pick again.');
}
function tick() { const left = Math.max(0, Math.floor((new Date(attempt.expiresAt) - (Date.now() + skew)) / 1000));
  $('timer').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; if (left === 0) finish(); }
const updWarn = () => $('wcount').textContent = `Warnings ${Math.min(warnings, 3)}/3`;
// Small still frame (about 10 KB) sent with a flagged event so admins can review it. Only kept for the program team; never shown to other students.
const snapCv = document.createElement('canvas');
function snap() { try { const v = $('prev'); if (!v || v.readyState < 2 || !v.videoWidth) return null; snapCv.width = 256; snapCv.height = Math.round(256 * v.videoHeight / v.videoWidth); snapCv.getContext('2d').drawImage(v, 0, 0, snapCv.width, snapCv.height); return snapCv.toDataURL('image/jpeg', 0.55); } catch { return null; } }
let modalTok = 0; const ADVISORY = ['looking_down', 'noise_detected'];
async function violation(type) { if (!attempt || !live()) return; const now = Date.now(); if (now - (lastViol[type] || 0) < 3000) return; lastViol[type] = now;
  // Show the warning straight away; the server (which does the counting) then fills in "Warning N of 3". A duplicate or error removes it again.
  const quick = !ADVISORY.includes(type) && $('viol-modal').classList.contains('hidden'), tok = quick ? ++modalTok : 0, undo = () => { if (quick && tok === modalTok) $('viol-modal').classList.add('hidden'); };
  if (quick) { $('vm-title').textContent = 'Warning'; $('vm-body').textContent = `${LABEL[type] || type}. Recording this violation…`; $('viol-modal').classList.remove('hidden'); }
  const img = snap(); // grab the frame now, at the moment of the violation
  try { const r = await api(`/attempts/${attempt.attemptId}/violation`, { type, snapshot: img }); if (r.advisory) return undo(); warnings = r.total; updWarn();
    if (r.autoSubmitted) { finishing = true; endTest(); $('viol-modal').classList.add('hidden'); return showResult(r.result); }
    if (r.counted) warnModal(type, r); else undo(); } catch { undo(); } }
function warnModal(type, r) { $('vm-title').textContent = `Warning ${r.total} of ${r.maxWarnings}`;
  $('vm-body').textContent = `${LABEL[type] || type}. ` + (r.warningsLeft ? `You have ${r.warningsLeft} warning${r.warningsLeft > 1 ? 's' : ''} left. ` : 'This was your last warning. ') + 'The next violation will submit your test automatically.';
  $('viol-modal').classList.remove('hidden'); }
$('vm-ok').onclick = () => { $('viol-modal').classList.add('hidden'); if (document.fullscreenEnabled && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); };
document.addEventListener('visibilitychange', () => { if (document.hidden && live()) violation('tab_switch'); });
window.addEventListener('blur', () => setTimeout(() => { if (live() && !document.hasFocus()) violation('tab_switch'); }, 700));
document.addEventListener('fullscreenchange', () => { if (live() && document.fullscreenEnabled && !document.fullscreenElement) violation('fullscreen_exit'); });
['copy', 'cut', 'paste'].forEach(ev => document.addEventListener(ev, e => { if (live()) { e.preventDefault(); violation('copy_paste'); } }));
document.addEventListener('contextmenu', e => { if (live()) e.preventDefault(); });
document.addEventListener('keydown', e => { if (!live()) return; const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
  if (c && ['c', 'x', 'v', 'a'].includes(k)) { if (!/INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); violation('copy_paste'); } }
  else if (k === 'f12' || (c && e.shiftKey && ['i', 'j', 'c'].includes(k)) || (c && ['u', 's', 'p'].includes(k)) || k === 'printscreen') { e.preventDefault(); violation('blocked_shortcut'); } });
document.addEventListener('keyup', e => { if (live() && e.key === 'PrintScreen') { try { navigator.clipboard.writeText(''); } catch {} violation('blocked_shortcut'); } });
['dragstart', 'selectstart'].forEach(ev => document.addEventListener(ev, e => { if (live() && !/INPUT|TEXTAREA/.test(e.target.tagName || e.target.parentElement?.tagName)) e.preventDefault(); }));
let finishing = false;
async function finish() { if (finishing) return; finishing = true; clearInterval(timerH); $('submit').disabled = true; msg('t-msg', 'Submitting…', true);
  for (let i = 0; i < 5; i++) { try { const r = await api(`/attempts/${attempt.attemptId}/submit`, {}); endTest(); return showResult(r); } catch { await new Promise(r => setTimeout(r, 1500)); } }
  finishing = false; $('submit').disabled = false; msg('t-msg', 'Submission failed. Check your connection and press Submit again.'); }
$('submit').onclick = () => { if (confirm('Submit your test now? You cannot change answers afterwards.')) finish(); };
const stopCam = () => { stream && stream.getTracks().forEach(t => t.stop()); stream = null; micStream && micStream.getTracks().forEach(t => t.stop()); micStream = null; $('pvid').classList.add('hidden'); };
function endTest() { clearInterval(timerH); proctor && proctor.stop(); proctor = null; enrolled = false; stopCam(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
function showResult(r) { show('s-res'); const c = r.coupon, box = $('res'); box.innerHTML = '';
  const p = t => { const e = document.createElement('p'); e.textContent = t; box.appendChild(e); return e; };
  p(`Score: ${r.correct_count}/${r.total_questions} (${r.score_percent}%)` + (r.status === 'timed_out' ? ' — auto-submitted at timeout' : r.status === 'auto_submitted' ? ' — auto-submitted: violation limit exceeded' : ''));
  addReport(box);
  if (!c) return p('Your coupon is being generated. Please refresh in a moment.');
  const code = p(c.code); code.className = 'code';
  p(`Scholarship: ${c.discountPercent}% off the ₹9,999 internship fee`); p(`Payable amount: ${inr(c.payablePaise)}`);
  const cd = p(''); const t = () => { const s = Math.floor((new Date(c.expiresAt) - Date.now()) / 1000); cd.textContent = c.state === 'redeemed' ? 'Coupon already redeemed.' : s <= 0 ? 'This coupon has expired.' : `Expires in ${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m ${s % 60}s`; }; t(); setInterval(t, 1000);
  lastCoupon = c;
  if (c.state === 'active' && new Date(c.expiresAt) > Date.now()) { const b = document.createElement('button'); b.textContent = 'Choose internship course'; b.onclick = showCourses; box.appendChild(b); }
  else p('This coupon can no longer be used for a new payment.'); }
function addReport(box) { const w = el(box, 'div', null, 'rep'); el(w, 'h2', 'Assessment report'); const row = el(w, 'div', null, 'btnrow');
  const dl = el(row, 'button', 'Download report (PDF)'), wa = el(row, 'button', 'Share on WhatsApp', 'alt'), li = el(row, 'button', 'Share on LinkedIn', 'alt'), m = el(w, 'div', null, 'msg');
  el(w, 'p', 'Sharing attaches a one-page image of your report (and a public link) showing only your name, score and result. Your contact details and coupon are not included.', 'small');
  const bad = e => { m.textContent = e.message; m.className = 'msg err'; };
  dl.onclick = async () => { dl.disabled = true; m.textContent = '';
    try { const r = await fetch(`/api/attempts/${attemptId}/report.pdf`, { headers: { Authorization: 'Bearer ' + token } }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Report unavailable (HTTP ' + r.status + ')');
      const u = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = u; a.download = 'Assessment-Report.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 10000); } catch (e) { bad(e); } dl.disabled = false; };
  // Share = image of the one-page report + post text. Phones: native share sheet attaches the image (pick WhatsApp / LinkedIn).
  // Desktop fallback: image is downloaded, text copied, and the app opened so the image can be attached.
  const share = async target => { m.textContent = ''; m.className = 'msg';
    try { const s = await api(`/attempts/${attemptId}/share`, {});
      const ir = await fetch(`/api/attempts/${attemptId}/report.png`, { headers: { Authorization: 'Bearer ' + token } }); if (!ir.ok) throw new Error('Report image unavailable (HTTP ' + ir.status + ')');
      const blob = await ir.blob(), file = new File([blob], 'Assessment-Report.png', { type: 'image/png' }), parts = s.text.split('\n\n#'), tags = '#' + parts[1];
      const text = target === 'wa' ? parts[0] + '\n\n\u{1F4C4} Full report (PDF): ' + s.pdf + '\n\n' + tags : parts[0] + '\n\n\u{1F4C4} My assessment report: ' + s.url + '\n\n' + tags;
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = 'Assessment-Report.png'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 10000);
      try { await navigator.clipboard.writeText(text); } catch {}
      m.textContent = 'Report image downloaded and post text copied. Attach the image' + (target === 'wa' ? ' in the WhatsApp chat (text is pre-filled).' : ' and paste the text in the LinkedIn post.'); m.className = 'msg';
      window.open(target === 'wa' ? 'https://wa.me/?text=' + encodeURIComponent(text) : 'https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(text), '_blank');
    } catch (e) { bad(e); } };
  wa.onclick = () => share('wa');
  // LinkedIn cannot receive an attached file from a web link. The post text carries the public report link; LinkedIn unfurls it into a card showing the report image (og:image).
  li.onclick = async () => { const win = window.open('about:blank', '_blank'); m.textContent = ''; m.className = 'msg';
    try { const s = await api(`/attempts/${attemptId}/share`, {}), parts = s.text.split('\n\n#'), text = parts[0] + '\n\n\u{1F4C4} My assessment report: ' + s.url + '\n\n#' + parts[1];
      try { await navigator.clipboard.writeText(text); } catch {}
      const u = 'https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(text); win ? (win.location.href = u) : (location.href = u);
      m.textContent = 'Opening LinkedIn with your post ready. The report image appears as the link preview (text is also copied in case you need to paste it).';
    } catch (e) { win && win.close(); bad(e); } }; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const payable = (base, d) => Math.floor((base * (100 - d) + 50) / 100); // display only; the server is authoritative
function el(parent, tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; parent.appendChild(e); return e; }
async function showCourses() {
  show('s-courses'); const c = lastCoupon; $('c-coupon').textContent = `Coupon ${c.code}: ${c.discountPercent}% scholarship applied automatically at checkout.`; msg('c-msg', '');
  const list = $('course-list'); list.innerHTML = 'Loading courses…';
  try { const cs = await api('/courses'); list.innerHTML = ''; if (!cs.length) list.textContent = 'No courses are open right now.';
    cs.forEach(k => { const d = el(list, 'div', null, 'card'); el(d, 'h2', k.title); if (k.description) el(d, 'p', k.description); if (k.duration) el(d, 'p', 'Duration: ' + k.duration);
      if (k.skills?.length) el(d, 'p', 'Skills: ' + k.skills.join(', ')); (k.benefits || []).forEach(x => el(d, 'p', '• ' + x));
      const pay = payable(k.base_price_paise, c.discountPercent); el(d, 'p', `Fee: ${inr(k.base_price_paise)} → you pay ${inr(pay)}`);
      const b = el(d, 'button', pay === 0 ? 'Enroll for free' : `Pay ${inr(pay)} & enroll`); b.onclick = () => checkout(k, b); });
  } catch (e) { list.textContent = e.message; } }
async function checkout(k, btn) {
  btn.disabled = true; msg('c-msg', 'Preparing your order…', true);
  try { const o = await api('/checkout/create', { courseId: k.id }); if (o.status === 'enrolled') return boot();
    if (typeof Razorpay === 'undefined') throw new Error('Payment window could not load. Check your connection and retry.');
    const rz = new Razorpay({ key: o.keyId, amount: o.amount, currency: o.currency, order_id: o.orderId, name: 'Vijayadashami Internship Fair', description: k.title,
      handler: resp => verifyPayment(resp), modal: { ondismiss: () => { msg('c-msg', 'Payment cancelled. You can retry; you will not be charged twice.'); btn.disabled = false; } } });
    rz.on('payment.failed', r => { msg('c-msg', 'Payment failed: ' + (r.error?.description || 'please try again') + '. You can retry.'); btn.disabled = false; });
    rz.open(); msg('c-msg', '');
  } catch (e) { msg('c-msg', e.message); btn.disabled = false; } }
async function verifyPayment(resp) {
  msg('c-msg', 'Verifying your payment… please do not close this page.', true);
  for (let i = 0; i < 10; i++) { try { const v = await api('/checkout/verify', resp); if (v.status === 'enrolled') return boot(); if (v.status === 'failed') return msg('c-msg', 'Payment failed. Please retry.'); }
    catch (e) { if (e.status === 400 || e.status === 404) return msg('c-msg', e.message); } await sleep(3000); }
  msg('c-msg', 'Your payment is still being confirmed. If you were charged, your enrollment will appear on this page automatically within a few minutes — refresh to check.', true); }
function showDash(d) { show('s-dash'); const b = $('dash'); b.innerHTML = ''; const e = d.enrollment, row = (l, v) => { const p = el(b, 'p'); el(p, 'b', l + ': '); p.append(String(v)); };
  row('Student', `${d.profile.full_name} (${d.email}, ${d.profile.phone})`);
  if (d.attempt) row('Assessment', `${d.attempt.correct_count}/${d.attempt.total_questions} (${d.attempt.score_percent}%) — ${d.attempt.status}`);
  if (d.coupon) row('Coupon', `${d.coupon.code}, ${d.coupon.discountPercent}% off, ${d.coupon.state}, expires ${new Date(d.coupon.expiresAt).toLocaleString()}`);
  if (d.attempt) addReport(b);
  el(b, 'h2', 'Your internship'); row('Course', `${e.course.title}${e.course.duration ? ' (' + e.course.duration + ')' : ''}`);
  row('Enrollment', `${e.status} — ${e.kind === 'free' ? 'free (100% scholarship)' : 'paid ' + inr(e.amountPaise)}`); row('Transaction reference', e.transactionRef); row('Enrolled on', new Date(e.enrolledAt).toLocaleString());
  const lb = el(b, 'button', 'Offer letter'); lb.onclick = async () => { const r = await fetch('/api/offer-letter', { headers: { Authorization: 'Bearer ' + token } }); if (!r.ok) return alert('Offer letter unavailable'); const u = URL.createObjectURL(await r.blob()); window.open(u); };
  if (e.course.accessUrl) { const a = el(b, 'a', 'Open course access'); a.href = e.course.accessUrl; a.target = '_blank'; a.rel = 'noopener'; a.style.cssText = 'display:inline-block;margin-left:12px;color:#138a3d;font-weight:700'; }
  else el(b, 'p', 'Course access details will be shared by the program team.');
  el(b, 'h2', 'Next steps'); el(b, 'p', 'Keep your transaction reference and offer letter safe. The program team will contact you on your registered email or mobile number.'); }
async function boot() {
  const { data } = await sb.auth.getSession(); if (!data.session) { $('logout').classList.add('hidden'); authMode('register'); return show('s-auth'); }
  token = data.session.access_token; $('logout').classList.remove('hidden');
  try { const me = await api('/me'); attemptId = me.attempt?.id || null;
    if (!me.profile.full_name || !me.profile.phone) { const pp = JSON.parse(localStorage.getItem('pendingProfile') || 'null');
      if (pp) { try { await api('/profile', { fullName: pp.name, phone: pp.phone }); localStorage.removeItem('pendingProfile'); return boot(); } catch {} }
      $('p-name').value = me.profile.full_name || ''; return show('s-profile'); }
    const d = await api('/dashboard'); if (d.enrollment) return showDash(d);
    if (me.attempt && me.attempt.status !== 'in_progress' && !me.canRetry) return showResult(await api(`/attempts/${me.attempt.id}/result`));
    show('s-inst'); if (me.canRetry) msg('inst-msg', 'Your 6-month wait is over — you can attempt the assessment again.', true); else if (me.attempt) msg('inst-msg', 'You have a test in progress. Start the camera and click Start test to resume — the timer kept running.', true);
  } catch (e) { if (e.status === 401) { await sb.auth.signOut(); return boot(); } $('loading').textContent = e.message; show('loading'); }
}
await boot();
})();