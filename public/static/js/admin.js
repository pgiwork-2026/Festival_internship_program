/* ============================================================================
   Plant Green Inertia — Admin Operations Console Controller (Stitch Shell)
   Cohesive Light Winter theme controller for /admin.html
   ============================================================================ */
'use strict';

let sb = null;
let tk = null;
let curUser = null;
let curTab = 'overview';
const curSubTab = {
  assessments: 'attempts',
  submissions: 'submissions',
  curriculum: 'syllabus',
  mentors: 'queries',
  settings: 'exam'
};

// Cached datasets prevent putting raw strings inside inline onclick handlers
let cacheStudents = [];
let cacheAttempts = [];
let cacheQuestions = [];
let cachePayments = [];
let cacheCoupons = [];
let cacheBatches = [];
let cacheMentors = [];
let cacheAttendance = [];
let cacheSubmissions = [];
let cacheCertificates = [];
let cacheQueries = [];
let cacheCurriculum = { tracks: [], courses: [] };
let cacheSettings = {};
let cacheVideos = [];
let cacheBlockedDevices = [];
let cacheBlockedDeviceCount = 0;

const TAB_META = {
  overview:     { eyebrow: 'WINTER COHORT 2026 // OPERATIONS',      title: 'Overview',                   loader: 'Loading cohort overview & pending actions...' },
  students:     { eyebrow: 'COHORT & ROSTER // CANDIDATES',         title: 'Students & Candidates',      loader: 'Loading applicants & enrolled interns...' },
  assessments:  { eyebrow: 'ADMISSIONS // EXAM & PROCTORING',       title: 'Assessment & Proctoring',    loader: 'Loading exam attempts & question bank...' },
  submissions:  { eyebrow: 'ACADEMICS // GRADING & 30H ATTENDANCE', title: 'Submissions & Grading',      loader: 'Loading submissions & attendance ledger...' },
  certificates: { eyebrow: 'CERTIFICATION // 30H & 75% GATE',       title: 'Certificates & Issuance',    loader: 'Loading certificate gate & registry...' },
  curriculum:   { eyebrow: 'PROGRAM // 30H SYLLABUS & MODULES',     title: 'Modules & Curriculum',       loader: 'Loading 30-hour tracks & module syllabus...' },
  batches:      { eyebrow: 'COHORT SCHEDULING // INTAKES',          title: 'Batches',                    loader: 'Loading cohort batches & seat capacity...' },
  mentors:      { eyebrow: 'FACULTY // MENTORS & SUPPORT',          title: 'Mentors & Queries',          loader: 'Loading mentors, student queries & broadcasts...' },
  settings:     { eyebrow: 'SYSTEM // CONFIG, FINANCE & AUDIT',     title: 'Platform Settings',          loader: 'Loading settings, payments, coupons & audit logs...' }
};

const TAB_ALIAS = {
  overview:      { tab: 'overview' },
  analytics:     { tab: 'overview' },
  students:      { tab: 'students' },
  assessments:   { tab: 'assessments' },
  attempts:      { tab: 'assessments', sub: 'attempts' },
  questions:     { tab: 'assessments', sub: 'questions' },
  submissions:   { tab: 'submissions', sub: 'submissions' },
  academics:     { tab: 'submissions', sub: 'attendance' },
  attendance:    { tab: 'submissions', sub: 'attendance' },
  certificates:  { tab: 'certificates' },
  curriculum:    { tab: 'curriculum' },
  syllabus:      { tab: 'curriculum',  sub: 'syllabus' },
  batches:       { tab: 'batches' },
  program:       { tab: 'batches' },
  mentors:       { tab: 'mentors' },
  queries:       { tab: 'mentors',     sub: 'queries' },
  notifications: { tab: 'mentors',     sub: 'broadcasts' },
  governance:    { tab: 'mentors',     sub: 'broadcasts' },
  settings:      { tab: 'settings' },
  exam:          { tab: 'settings',    sub: 'exam' },
  finance:       { tab: 'settings',    sub: 'payments' },
  payments:      { tab: 'settings',    sub: 'payments' },
  coupons:       { tab: 'settings',    sub: 'coupons' },
  audit:         { tab: 'settings',    sub: 'audit' }
};

const STUDENT_STATUSES = ['applied', 'eligible', 'enrolled', 'active', 'completed', 'dropped'];

const EYE_OPEN_SVG = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF_SVG  = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';

// ----------------------------------------------------------------------------
// Core Security, Formatting & UI Helpers
// ----------------------------------------------------------------------------
function $(id) {
  return document.getElementById(id);
}

function escHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(url) {
  const s = String(url || '').trim();
  if (/^https?:\/\//i.test(s) || (s.startsWith('/') && !s.startsWith('//'))) {
    return escHtml(s);
  }
  return '#';
}

function safeImageSrc(src) {
  const s = String(src || '').trim();
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(s) || /^https?:\/\//i.test(s) || (s.startsWith('/') && !s.startsWith('//'))) {
    return escHtml(s);
  }
  return '';
}

function fmtDate(val, withTime = false) {
  if (!val) return '—';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return escHtml(String(val));
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  });
}

function fmtRupees(val) {
  return '₹' + Math.round(Number(val || 0)).toLocaleString('en-IN');
}

function getInitials(name) {
  const parts = String(name || 'PG').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] || 'PG').slice(0, 2).toUpperCase();
}

function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (['active', 'paid', 'completed', 'submitted', 'reviewed', 'eligible', 'enrolled', 'present', 'valid', 'resolved'].includes(s)) return 'green';
  if (['in_progress', 'created', 'pending', 'late', 'upcoming', 'applied', 'high', 'open', 'draft'].includes(s)) return 'yellow';
  if (['failed', 'revoked', 'expired', 'absent', 'dropped', 'auto_submitted', 'urgent', 'inactive'].includes(s)) return 'red';
  if (['online', 'offline', 'normal', 'excused', 'core', 'special', 'technical', 'non-technical'].includes(s)) return 'blue';
  return 'gray';
}

function pillBadge(text, tone) {
  const t = tone || statusTone(text);
  return `<span class="pill ${escHtml(t)}">${escHtml(text || '—')}</span>`;
}

function showToast(msg, isErr = false) {
  const stack = $('adm-toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'adm-toast' + (isErr ? ' err' : '');
  el.textContent = String(msg || '');
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function renderAdminLoader(label) {
  const view = $('admin-view');
  if (!view) return;
  view.innerHTML = `
    <div class="hub-loader-center" role="status" aria-live="polite">
      <div class="hub-loader-ring" aria-hidden="true"></div>
      <p class="hub-loader-text">${escHtml(label || 'Loading console data...')}</p>
    </div>`;
}

function openModal(html) {
  const box = $('modal-inner-content');
  const ov = $('modal-container');
  if (!box || !ov) return;
  box.innerHTML = html;
  ov.classList.remove('hidden');
}

function closeModal() {
  const ov = $('modal-container');
  const box = $('modal-inner-content');
  if (ov) ov.classList.add('hidden');
  if (box) box.innerHTML = '';
}

function renderSubTabs(tabKey, tabs) {
  const active = curSubTab[tabKey] || tabs[0].key;
  curSubTab[tabKey] = active;
  return `
    <div class="adm-subtabs" role="tablist">
      ${tabs.map(t => `
        <button type="button" role="tab" aria-selected="${active === t.key ? 'true' : 'false'}"
          class="adm-subtab${active === t.key ? ' active' : ''}"
          onclick="switchSubTab('${escHtml(tabKey)}','${escHtml(t.key)}')">
          ${escHtml(t.label)}
        </button>`).join('')}
    </div>`;
}

function switchSubTab(tabKey, subKey) {
  curSubTab[tabKey] = subKey;
  showTab(tabKey, subKey);
}

function emptyTableRow(colspan, text) {
  return `<tr><td colspan="${colspan}" style="text-align:center;color:var(--adm-muted);padding:26px 14px;">${escHtml(text)}</td></tr>`;
}

function kpiCard(title, value, sub, iconSvg, icoTone = '', onclickCode = '', barPct = null, barTone = '') {
  const interactive = onclickCode ? ` style="cursor:pointer;" onclick="${onclickCode}"` : '';
  const valTone = icoTone === 'red' ? ' style="color:var(--adm-red);"' : '';
  const barHtml = barPct !== null && barPct !== undefined
    ? `<div class="kpi-bar ${escHtml(barTone)}"><span style="width:${Math.min(100, Math.max(4, Number(barPct || 0)))}%;"></span></div>`
    : '';
  return `
    <div class="kpi-card"${interactive}>
      <div class="kpi-head">
        <span class="kpi-title">${escHtml(title)}</span>
        <span class="kpi-ico ${escHtml(icoTone)}" aria-hidden="true">${iconSvg}</span>
      </div>
      <div class="kpi-val"${valTone}>${escHtml(value)}</div>
      <div class="kpi-sub">${escHtml(sub)}</div>
      ${barHtml}
    </div>`;
}

// ----------------------------------------------------------------------------
// Authenticated Fetch & File Downloads
// ----------------------------------------------------------------------------
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (tk) headers.Authorization = `Bearer ${tk}`;
  if (opts.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, { ...opts, headers });
  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { message: raw };
  }

  if (!res.ok) {
    if (res.status === 401 && tk) {
      showToast('Session expired. Please sign in again.', true);
      doAdminLogout();
    }
    throw new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
  }
  return data;
}

async function downloadWithAuth(url, filename) {
  if (!tk) {
    showToast('Please sign in first.', true);
    return;
  }
  try {
    showToast(`Preparing ${filename}...`);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${tk}` } });
    if (!res.ok) {
      let msg = `Download failed (${res.status})`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
  } catch (err) {
    showToast(err.message || 'Download failed', true);
  }
}

// ----------------------------------------------------------------------------
// Auth & Shell Lifecycle
// ----------------------------------------------------------------------------
function setLoginMessage(text, isErr = true) {
  const el = $('login-err');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'adm-login-msg' + (text ? (isErr ? ' err' : ' ok') : '');
}

function togglePw() {
  const inp = $('admin-password');
  const ico = $('adm-eye-icon');
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  if (ico) ico.innerHTML = show ? EYE_OFF_SVG : EYE_OPEN_SVG;
}

function toggleAdminDrawer(open) {
  const side = $('admSidebar');
  const bd = $('admBackdrop');
  if (side) side.classList.toggle('open', Boolean(open));
  if (bd) bd.classList.toggle('show', Boolean(open));
}

async function initAuth() {
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
      setLoginMessage('Supabase client configuration unavailable.', true);
      return;
    }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const { data } = await sb.auth.getSession();
    if (data?.session?.access_token) {
      await enterSession(data.session.access_token, data.session.user, true);
    }
  } catch (err) {
    setLoginMessage(err.message || 'Could not initialize authentication.', true);
  }
}

async function doAdminLogin() {
  const email = ($('admin-email')?.value || '').trim();
  const password = $('admin-password')?.value || '';
  const btn = $('btn-login');

  if (!email || !password) {
    setLoginMessage('Please enter both administrator email and password.', true);
    return;
  }
  if (!sb) {
    setLoginMessage('Authentication client not ready yet. Please retry.', true);
    return;
  }

  if (btn) btn.disabled = true;
  setLoginMessage('Verifying credentials and role...', false);

  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data?.session?.access_token) {
      throw new Error(error?.message || 'Invalid administrator credentials');
    }
    await enterSession(data.session.access_token, data.user, false);
  } catch (err) {
    setLoginMessage(err.message || 'Sign-in failed', true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function enterSession(token, user, silent = false) {
  tk = token;
  curUser = user;
  try {
    await api('/api/admin/overview');
  } catch (err) {
    tk = null;
    curUser = null;
    if (sb) {
      try { await sb.auth.signOut(); } catch {}
    }
    if (!silent) {
      setLoginMessage('Access denied: administrator role (profiles.role = admin) is required.', true);
    }
    return;
  }

  const email = user?.email || 'System Administrator';
  const disp = $('admin-user-disp');
  if (disp) {
    disp.textContent = 'System Administrator';
    disp.title = email;
  }

  setLoginMessage('', false);
  $('login-screen')?.classList.add('hidden');
  $('app-container')?.classList.remove('hidden');
  await showTab(curTab || 'overview');
}

async function doAdminLogout() {
  tk = null;
  curUser = null;
  cacheStudents = [];
  cacheAttempts = [];
  cacheQuestions = [];
  cachePayments = [];
  cacheCoupons = [];
  cacheBatches = [];
  cacheMentors = [];
  cacheAttendance = [];
  cacheSubmissions = [];
  cacheCertificates = [];
  cacheQueries = [];
  closeModal();
  toggleAdminDrawer(false);

  if (sb) {
    try { await sb.auth.signOut(); } catch {}
  }
  if ($('admin-password')) $('admin-password').value = '';
  $('app-container')?.classList.add('hidden');
  $('login-screen')?.classList.remove('hidden');
  setLoginMessage('Signed out cleanly.', false);
}

async function showTab(rawTab, explicitSubTab) {
  const mapped = TAB_ALIAS[rawTab] || { tab: 'overview' };
  const tab = mapped.tab;
  const sub = explicitSubTab || mapped.sub;
  curTab = tab;
  if (sub) curSubTab[tab] = sub;

  toggleAdminDrawer(false);
  document.querySelectorAll('#admin-nav button[data-tab]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tab);
  });

  const meta = TAB_META[tab] || TAB_META.overview;
  if ($('topbar-eyebrow')) $('topbar-eyebrow').textContent = meta.eyebrow;
  if ($('topbar-title')) $('topbar-title').textContent = meta.title;

  renderAdminLoader(meta.loader);

  try {
    if (tab === 'overview') await loadOverview();
    else if (tab === 'students') await loadStudents();
    else if (tab === 'assessments') await loadAssessments();
    else if (tab === 'submissions') await loadSubmissionsView();
    else if (tab === 'certificates') await loadCertificates();
    else if (tab === 'curriculum') await loadCurriculumView();
    else if (tab === 'batches') await loadBatchesView();
    else if (tab === 'mentors') await loadMentorsView();
    else if (tab === 'settings') await loadSettingsView();
  } catch (err) {
    $('admin-view').innerHTML = `
      <div class="adm-panel" style="border-color:#FECACA;background:#FEF2F2;">
        <h3 style="margin:0 0 6px;color:#991B1B;">Could not load view</h3>
        <p style="margin:0 0 12px;color:#7F1D1D;">${escHtml(err.message || 'Unexpected error')}</p>
        <button type="button" class="btn btn-outline btn-sm" onclick="refreshCurrentTab()">Retry</button>
      </div>`;
  }
}

function refreshCurrentTab() {
  showTab(curTab);
}

// ----------------------------------------------------------------------------
// VIEW 1: Overview (Stitch Bento KPIs + Recent Activity Feed + Telemetry)
// ----------------------------------------------------------------------------
function buildRecentActivityItems(students, submissions, attempts, certs, queries) {
  const certSet = new Set((certs || []).map(c => String(c.student_id || '').toUpperCase()));
  const items = [];

  for (let i = 0; i < (submissions || []).length; i++) {
    const s = submissions[i];
    if (s.status !== 'reviewed') {
      items.push({
        name: s.studentName || 'Student Candidate',
        subtitle: `${s.title || 'Project Submission'} (${s.status === 'submitted' ? 'Ready for Grading' : 'Draft / Pending'})`,
        badge: s.status || 'pending',
        ctaLabel: 'Review',
        ctaClass: 'btn-outline',
        action: `openOverviewSubmission(${i})`
      });
    }
  }

  for (let i = 0; i < (students || []).length; i++) {
    const st = students[i];
    const sid = String(st.studentId || '').toUpperCase();
    if (sid && st.attendance?.meetsCriteria && !certSet.has(sid)) {
      items.push({
        name: st.name || sid,
        subtitle: `30h Gate Met (${Number(st.attendance.completedHours || 0).toFixed(1)}h · ${st.attendance.percentage || 0}%) — Eligible for Certificate`,
        badge: 'eligible',
        ctaLabel: 'Issue Certificate',
        ctaClass: 'btn-green',
        action: `jumpToIssueCert('${escHtml(sid)}')`
      });
    }
  }

  for (let i = 0; i < (attempts || []).length; i++) {
    const a = attempts[i];
    if (Number(a.strikes || 0) > 0 || a.status === 'auto_submitted') {
      items.push({
        name: a.name || 'Candidate',
        subtitle: `Assessment Proctoring Log · ${a.strikes || 0} strike(s) · ${a.scorePercent ?? 0}%`,
        badge: a.strikes >= 3 ? 'flagged' : 'review',
        ctaLabel: 'Review',
        ctaClass: 'btn-outline',
        action: `openOverviewViolation(${i})`
      });
    }
  }

  for (let i = 0; i < (queries || []).length; i++) {
    const q = queries[i];
    if (String(q.status || '').toLowerCase() !== 'resolved') {
      items.push({
        name: q.email || 'Student Query',
        subtitle: `Support Ticket ${q.id}: ${q.subject}`,
        badge: 'open',
        ctaLabel: 'Answer Query',
        ctaClass: 'btn-outline',
        action: `showTab('mentors', 'queries')`
      });
    }
  }

  return items;
}

function openOverviewSubmission(idx) {
  curSubTab.submissions = 'submissions';
  openSubmissionModal(idx);
}

async function openOverviewViolation(idx) {
  await openViolationModal(idx);
}

function jumpToIssueCert(sid) {
  window.__prefillCertSid = sid;
  showTab('certificates');
}

async function loadOverview() {
  const [a, submissions, attempts, students, certs, queries] = await Promise.all([
    api('/api/admin/analytics'),
    api('/api/admin/submissions').catch(() => []),
    api('/api/admin/attempts').catch(() => []),
    api('/api/admin/students').catch(() => []),
    api('/api/admin/certificates').catch(() => []),
    api('/api/admin/queries').catch(() => [])
  ]);

  cacheSubmissions = Array.isArray(submissions) ? submissions : [];
  cacheAttempts = Array.isArray(attempts) ? attempts : [];
  cacheStudents = Array.isArray(students) ? students : [];
  cacheCertificates = Array.isArray(certs) ? certs : [];
  cacheQueries = Array.isArray(queries) ? queries : [];

  const apps = a.applications || {};
  const assm = a.assessments || {};
  const pay = a.payments || {};
  const ints = a.interns || {};
  const coup = a.coupons || {};
  const domains = apps.domains || [];
  const referrals = apps.referrals || [];
  cacheBlockedDeviceCount = Number(assm.blockedDeviceCount || 0);
  cacheBlockedDevices = Array.isArray(assm.recentBlockedDevices) ? assm.recentBlockedDevices : [];

  const pendingItems = buildRecentActivityItems(cacheStudents, cacheSubmissions, cacheAttempts, cacheCertificates, cacheQueries);

  const barRows = (list, labelKey, subFn) => {
    if (!list.length) return '<p style="color:var(--adm-muted);margin:0;">No data recorded yet.</p>';
    return list.map(item => `
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:0.92rem;margin-bottom:5px;">
          <strong style="color:var(--adm-navy);">${escHtml(item[labelKey])}</strong>
          <span style="color:var(--adm-slate);font-weight:700;">${escHtml(subFn(item))}</span>
        </div>
        <div class="adm-prog-track"><div class="adm-prog-fill" style="width:${Math.min(100, Math.max(2, Number(item.percentage || 0)))}%;"></div></div>
      </div>`).join('');
  };

  $('admin-view').innerHTML = `
    <div class="kpi-grid">
      ${kpiCard('Total Applications', String(apps.total ?? 0), `Online ${apps.online ?? 0} · Offline ${apps.offline ?? 0}`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>', 'blue', "showTab('students')")}
      ${kpiCard('Assessments Completed', `${assm.completed ?? 0} / ${assm.totalStarted ?? 0}`, `Eligible ${assm.eligible ?? 0} · Pass Rate ${assm.passRate ?? 0}% (Cutoff ${assm.passMark ?? 30}%)`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>', 'green', "showTab('assessments', 'attempts')")}
      ${kpiCard('Blocked Mobile Attempts', String(cacheBlockedDeviceCount), `${assm.desktopOnly === false ? 'Desktop-only OFF' : 'Desktop-only ON'} · Click to inspect logs`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>', cacheBlockedDeviceCount > 0 ? 'red' : 'blue', 'openBlockedDevicesModal()')}
      ${kpiCard('Enrolled Interns', String(ints.totalEnrolled ?? 0), `Active ${ints.active ?? 0} · Completed ${ints.completed ?? 0} · Offline ${ints.offline ?? 0}`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/></svg>', 'blue', "showTab('submissions', 'attendance')")}
      ${kpiCard('Tuition Collected', fmtRupees(pay.revenueRupees), `${pay.completedCount ?? 0} Paid · ${pay.pendingCount ?? 0} Pending · Coupons Used ${coup.used ?? 0}/${coup.issued ?? 0}`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>', 'green', "showTab('settings', 'payments')")}
    </div>

    <section class="adm-panel">
      <div class="adm-panel-head">
        <h3>Recent Activity</h3>
        <span style="font-size:0.88rem;font-weight:700;color:var(--adm-muted);">${pendingItems.length} pending action${pendingItems.length === 1 ? '' : 's'}</span>
      </div>
      ${pendingItems.length ? `
        <div class="adm-act-list">
          ${pendingItems.slice(0, 8).map(item => `
            <div class="adm-act-row">
              <div class="adm-act-left">
                <span class="adm-act-ini">${escHtml(getInitials(item.name))}</span>
                <div class="adm-act-meta">
                  <strong>${escHtml(item.name)}</strong>
                  <span>${escHtml(item.subtitle)}</span>
                </div>
              </div>
              <div class="adm-act-right">
                ${pillBadge(item.badge)}
                <button type="button" class="btn ${escHtml(item.ctaClass)} btn-sm" onclick="${item.action}">${escHtml(item.ctaLabel)}</button>
              </div>
            </div>`).join('')}
        </div>` : `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:6px 0;">
          <p style="margin:0;color:var(--adm-muted);font-size:0.86rem;">No urgent unreviewed submissions, flagged proctor logs, or pending certificate issuances right now.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm" onclick="showTab('submissions', 'attendance')">Log 3h Attendance</button>
            <button type="button" class="btn btn-green btn-sm" onclick="showTab('students')">Manage Cohort Roster</button>
          </div>
        </div>`}
    </section>

    <div class="adm-grid-2">
      <section class="adm-panel">
        <div class="adm-panel-head">
          <h3>Domain Track Distribution</h3>
          <span class="pill blue">${domains.length} Tracks</span>
        </div>
        ${barRows(domains, 'domain', d => `${d.count} (${d.percentage}%) · ${d.domainType || 'Track'}`)}
      </section>

      <section class="adm-panel">
        <div class="adm-panel-head">
          <h3>Referral &amp; Scholarship Vouchers</h3>
          <button type="button" class="btn btn-outline btn-sm" onclick="showTab('settings', 'coupons')">Manage Coupons</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:16px;text-align:center;">
          <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:10px 6px;">
            <div style="font-size:1.15rem;font-weight:800;">${coup.issued ?? 0}</div>
            <div style="font-size:0.78rem;color:var(--adm-muted);font-weight:700;">ISSUED</div>
          </div>
          <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:10px 6px;">
            <div style="font-size:1.15rem;font-weight:800;color:var(--adm-green);">${coup.active ?? 0}</div>
            <div style="font-size:0.78rem;color:var(--adm-green);font-weight:700;">ACTIVE</div>
          </div>
          <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:10px 6px;">
            <div style="font-size:1.15rem;font-weight:800;color:#0369A1;">${coup.used ?? 0}</div>
            <div style="font-size:0.78rem;color:#0369A1;font-weight:700;">REDEEMED</div>
          </div>
          <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:10px 6px;">
            <div style="font-size:1.15rem;font-weight:800;color:#991B1B;">${coup.expired ?? 0}</div>
            <div style="font-size:0.78rem;color:#991B1B;font-weight:700;">EXPIRED</div>
          </div>
        </div>
        ${barRows(referrals, 'code', r => `${r.count} (${r.percentage}%)`)}
      </section>
    </div>`;
}

// ----------------------------------------------------------------------------
// VIEW 2: Students & Candidates (Stitch Registry Design + Pagination & Add)
// ----------------------------------------------------------------------------
let stuSegment = 'all';
let stuPage = 1;
const STU_PAGE_SIZE = 10;

async function loadStudents() {
  const [students, batches, mentors] = await Promise.all([
    api('/api/admin/students'),
    api('/api/admin/batches').catch(() => []),
    api('/api/admin/mentors').catch(() => [])
  ]);
  cacheStudents = Array.isArray(students) ? students : [];
  cacheBatches = Array.isArray(batches) ? batches : [];
  cacheMentors = Array.isArray(mentors) ? mentors : [];
  stuPage = 1;

  const domains = [...new Set(cacheStudents.map(s => s.domainName).filter(Boolean))].sort();
  const enrolledCnt = cacheStudents.filter(s => Boolean(s.enrolled)).length;
  const awaitingCnt = cacheStudents.filter(s => !s.enrolled && (s.testStatus === 'not_attempted' || s.score === null || s.score === undefined)).length;
  const testedList = cacheStudents.filter(s => s.score !== null && s.score !== undefined);
  const passedCnt = testedList.filter(s => Number(s.score) >= 30).length;
  const passRatePct = testedList.length ? (Math.round((passedCnt / testedList.length) * 1000) / 10) : 0;
  const gateMetCnt = cacheStudents.filter(s => s.attendance?.meetsCriteria).length;

  $('admin-view').innerHTML = `
    <div class="adm-stu-hero">
      <div>
        <div>
          <span class="adm-hero-pill">COHORT 2026 REGISTRY</span>
          <span class="adm-sync-note">&bull; Live Synchronization</span>
        </div>
        <h2>Students &amp; Candidates</h2>
        <p>Manage enrolled cohort fellows, candidate assessment pipelines, and certification eligibility.</p>
      </div>
      <div class="adm-hero-actions">
        <button type="button" class="btn btn-outline btn-sm" onclick="showTab('settings', 'payments')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
          Payment &amp; Invoices
        </button>
        <button type="button" class="btn btn-outline btn-sm" onclick="exportStudentsCsv()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </button>
        <button type="button" class="btn btn-green btn-sm" onclick="openAddStudentModal()">
          + Add Student
        </button>
        <button type="button" class="btn btn-danger btn-sm" onclick="openRemoveAllStudentsModal()">
          Remove All Student Details
        </button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard('TOTAL ENROLLED', String(enrolledCnt), `${cacheStudents.length} total candidates · ${gateMetCnt} at 30h gate`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>', 'green')}
      ${kpiCard('AWAITING ASSESSMENT', String(awaitingCnt), 'Active proctor window open', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg>', 'blue')}
      ${kpiCard('AVG PASS RATE', `${passRatePct}%`, `${passedCnt} of ${testedList.length} tested >= 30% cutoff`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>', 'green')}
    </div>

    <div class="adm-seg-bar">
      <div class="adm-seg-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="f-stu-q" type="search" placeholder="Search by candidate name, UID, or email..." oninput="stuPage=1; renderStudentsTable()">
      </div>
      <div class="adm-seg-controls">
        <select id="f-stu-dom" class="adm-seg-select" aria-label="Filter by domain" onchange="stuPage=1; renderStudentsTable()">
          <option value="">All Tracks</option>
          ${domains.map(d => `<option value="${escHtml(d)}">${escHtml(d)}</option>`).join('')}
        </select>
        <select id="f-stu-mode" class="adm-seg-select" aria-label="Filter by mode" onchange="stuPage=1; renderStudentsTable()">
          <option value="">All Modes</option>
          <option value="Online">Online</option>
          <option value="Offline">Offline</option>
        </select>
        <div class="adm-seg-pills" role="group" aria-label="Candidate segments">
          <button type="button" class="adm-seg-pill${stuSegment === 'all' ? ' active' : ''}" data-seg="all" onclick="setStudentSegment('all')">All (${cacheStudents.length})</button>
          <button type="button" class="adm-seg-pill${stuSegment === 'enrolled' ? ' active' : ''}" data-seg="enrolled" onclick="setStudentSegment('enrolled')">Enrolled Fellows (${enrolledCnt})</button>
          <button type="button" class="adm-seg-pill${stuSegment === 'pending' ? ' active' : ''}" data-seg="pending" onclick="setStudentSegment('pending')">Pending Assessment (${awaitingCnt})</button>
          <button type="button" class="adm-seg-pill${stuSegment === 'gate' ? ' active' : ''}" data-seg="gate" onclick="setStudentSegment('gate')">30h Gate Met (${gateMetCnt})</button>
        </div>
      </div>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Candidate UID</th>
            <th>Full Name &amp; Contact</th>
            <th>Cohort Track</th>
            <th>Assessment Status</th>
            <th>Payment</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="stu-tbody"></tbody>
      </table>
      <div id="stu-table-foot" class="adm-table-foot"></div>
    </div>`;

  renderStudentsTable();
}

function setStudentSegment(seg) {
  stuSegment = seg;
  stuPage = 1;
  document.querySelectorAll('.adm-seg-pill[data-seg]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-seg') === seg);
  });
  renderStudentsTable();
}

function setStudentPage(p) {
  stuPage = Math.max(1, Number(p || 1));
  renderStudentsTable();
}

function getFilteredStudents() {
  const q = ($('f-stu-q')?.value || '').trim().toLowerCase();
  const dom = $('f-stu-dom')?.value || '';
  const mode = ($('f-stu-mode')?.value || '').toLowerCase();

  return cacheStudents.map((s, idx) => ({ s, idx })).filter(({ s }) => {
    if (stuSegment === 'enrolled' && !s.enrolled) return false;
    if (stuSegment === 'pending' && (s.enrolled || (s.score !== null && s.score !== undefined && s.testStatus !== 'not_attempted'))) return false;
    if (stuSegment === 'gate' && !s.attendance?.meetsCriteria) return false;
    if (dom && s.domainName !== dom) return false;
    if (mode && String(s.mode || '').toLowerCase() !== mode) return false;
    if (q) {
      const hay = [s.name, s.email, s.phone, s.applicationId, s.studentId, s.college, s.domainName, s.referralCode, s.receiptNo]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderStudentsTable() {
  const tbody = $('stu-tbody');
  const foot = $('stu-table-foot');
  if (!tbody) return;

  const rows = getFilteredStudents();
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / STU_PAGE_SIZE));
  if (stuPage > totalPages) stuPage = totalPages;

  if (!total) {
    tbody.innerHTML = emptyTableRow(6, 'No matching candidates or enrolled fellows found.');
    if (foot) foot.innerHTML = '<span>Showing 0 candidates</span><span></span>';
    return;
  }

  const startIdx = (stuPage - 1) * STU_PAGE_SIZE;
  const pageRows = rows.slice(startIdx, startIdx + STU_PAGE_SIZE);

  tbody.innerHTML = pageRows.map(({ s, idx }) => {
    const att = s.attendance || { presentDays: 0, absentDays: 0, completedHours: 0, percentage: 0, meetsCriteria: false };
    const uidLabel = s.applicationId || s.studentId || 'PGI-W26';
    const hasScore = s.score !== null && s.score !== undefined;

    let assessBadge = '<span class="adm-dot-pill gray"><i></i>Pending Test</span>';
    if (s.enrolled) {
      assessBadge = `<span class="adm-dot-pill green"><i></i>Enrolled &bull; ${escHtml(String(s.enrolled).charAt(0).toUpperCase() + String(s.enrolled).slice(1))}</span>`;
    } else if (hasScore && Number(s.score) >= 30) {
      assessBadge = `<span class="adm-dot-pill green"><i></i>Passed &bull; ${escHtml(Math.round(Number(s.score)))}%</span>`;
    } else if (hasScore) {
      assessBadge = `<span class="adm-dot-pill yellow"><i></i>Attempted &bull; ${escHtml(Math.round(Number(s.score)))}%</span>`;
    }

    const statusOpts = STUDENT_STATUSES.map(st =>
      `<option value="${escHtml(st)}"${String(s.status || '').toLowerCase() === st ? ' selected' : ''}>${escHtml(st)}</option>`
    ).join('');

    return `
      <tr>
        <td>
          <span class="adm-uid-chip">${escHtml(uidLabel)}</span>
          ${s.studentId && s.studentId !== uidLabel ? `<div style="font-family:'JetBrains Mono',monospace;font-size:0.78rem;color:var(--adm-green);font-weight:700;margin-top:4px;">${escHtml(s.studentId)}</div>` : ''}
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:11px;min-width:210px;">
            <span class="adm-act-ini" style="width:34px;height:34px;font-size:0.84rem;">${escHtml(getInitials(s.name))}</span>
            <div style="min-width:0;">
              <div style="font-weight:700;color:var(--adm-navy);">${escHtml(s.name)}</div>
              <div style="font-size:0.88rem;color:var(--adm-muted);">${escHtml(s.email)}</div>
              <div style="font-size:0.84rem;color:var(--adm-slate);">${escHtml(s.phone || '—')} · ${escHtml(s.college || '—')}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight:700;font-size:0.92rem;color:var(--adm-navy);">${escHtml(s.domainName || 'Unassigned Track')}</div>
          <div style="font-size:0.84rem;color:var(--adm-muted);margin-top:2px;">${escHtml(s.assignedBatch || 'Winter Cohort')} &bull; ${escHtml(s.mode || 'Online')} &bull; ${escHtml(s.assignedMentor || 'Unassigned')}</div>
        </td>
        <td>
          <div>${assessBadge}</div>
          <div style="font-size:0.84rem;color:var(--adm-muted);margin-top:4px;">
            ${Number(att.completedHours || 0).toFixed(1)} / 30h (${Number(att.percentage || 0)}%) ${att.meetsCriteria ? '<strong style="color:var(--adm-green);">&bull; Gate Met</strong>' : ''}
          </div>
          ${s.mobileOverride ? '<div style="margin-top:4px;"><span class="pill blue" style="font-size:0.72rem;">Mobile Override ON</span></div>' : ''}
        </td>
        <td>
          ${s.enrolled
            ? `<div style="font-weight:700;font-size:0.92rem;color:var(--adm-navy);">Paid &bull; ${fmtRupees(s.paymentAmount)}</div>
               <div style="font-family:'JetBrains Mono',monospace;font-size:0.82rem;color:var(--adm-muted);">Inv #${escHtml(s.receiptNo || 'PGI-REC')}</div>`
            : `<div style="font-size:0.88rem;color:var(--adm-muted);font-weight:600;">Unpaid</div>
               ${s.coupon ? `<div style="font-family:'JetBrains Mono',monospace;font-size:0.82rem;color:var(--adm-blue);margin-top:2px;">${escHtml(s.coupon)}</div>` : ''}`}
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <select class="adm-seg-select" style="padding:5px 7px;font-size:0.84rem;" aria-label="Status for ${escHtml(s.name)}" onchange="updateStudentStatus(${idx}, this.value)">
              ${statusOpts}
            </select>
            <button type="button" class="btn btn-outline btn-sm" onclick="openStudentModal(${idx})">Manage</button>
            ${s.studentId ? `<button type="button" class="btn btn-green btn-sm" onclick="jumpToStudentAttendance(${idx})">Log Att.</button>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');

  if (foot) {
    const fromN = startIdx + 1;
    const toN = startIdx + pageRows.length;
    const pageButtons = Array.from({ length: totalPages }, (_, i) => i + 1)
      .slice(Math.max(0, stuPage - 3), Math.min(totalPages, stuPage + 2))
      .map(p => `<button type="button" class="adm-page-btn${p === stuPage ? ' active' : ''}" onclick="setStudentPage(${p})">${p}</button>`)
      .join('');

    foot.innerHTML = `
      <span>Showing <strong>${fromN}&ndash;${toN}</strong> of <strong>${total}</strong> candidate${total === 1 ? '' : 's'}</span>
      <div class="adm-pager">
        <button type="button" class="adm-page-btn" ${stuPage <= 1 ? 'disabled' : ''} onclick="setStudentPage(${stuPage - 1})">Previous</button>
        ${pageButtons}
        <button type="button" class="adm-page-btn" ${stuPage >= totalPages ? 'disabled' : ''} onclick="setStudentPage(${stuPage + 1})">Next</button>
      </div>`;
  }
}

function exportStudentsCsv() {
  const rows = getFilteredStudents().map(({ s }) => s);
  if (!rows.length) {
    showToast('No candidate rows to export.', true);
    return;
  }
  const cols = ['Application ID', 'Student ID', 'Name', 'Email', 'Phone', 'College', 'Domain Track', 'Mode', 'Batch', 'Mentor', 'Assessment Score (%)', 'Payment (INR)', 'Receipt No', 'Completed Hours', 'Attendance (%)', 'Status'];
  const escCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.map(escCsv).join(',')].concat(rows.map(s => [
    s.applicationId,
    s.studentId,
    s.name,
    s.email,
    s.phone,
    s.college,
    s.domainName,
    s.mode,
    s.assignedBatch,
    s.assignedMentor,
    s.score ?? '',
    s.enrolled ? s.paymentAmount : 0,
    s.receiptNo || '',
    s.attendance?.completedHours ?? 0,
    s.attendance?.percentage ?? 0,
    s.status
  ].map(escCsv).join(',')));

  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = `pgi-students-${stuSegment}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
  showToast(`Exported ${rows.length} candidate row(s) to CSV.`);
}

function openAddStudentModal() {
  const batchOptions = ['<option value="">-- Default Cohort --</option>'].concat(
    cacheBatches.map(b => `<option value="${escHtml(b.id)}">${escHtml(b.name)}</option>`)
  ).join('');
  const mentorOptions = ['<option value="">-- Assign Later --</option>'].concat(
    cacheMentors.map(m => `<option value="${escHtml(m.id)}">${escHtml(m.name)}</option>`)
  ).join('');

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div>
        <span class="adm-hero-pill">MANUAL ENTRY</span>
        <h3 style="margin:4px 0 0;font-family:'Space Grotesk',sans-serif;font-size:1.18rem;">Add Student / Candidate</h3>
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
    </div>
    <form onsubmit="event.preventDefault(); submitNewStudent();">
      <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
        <div><label class="f-lbl" for="add-name">Full Name *</label><input id="add-name" class="f-ctrl" type="text" placeholder="Candidate Full Name" required></div>
        <div><label class="f-lbl" for="add-email">Email Address *</label><input id="add-email" class="f-ctrl" type="email" placeholder="candidate@college.edu" required></div>
        <div><label class="f-lbl" for="add-phone">Mobile Number (10 digits) *</label><input id="add-phone" class="f-ctrl" type="tel" placeholder="9876543210" required></div>
        <div><label class="f-lbl" for="add-college">College / Institution</label><input id="add-college" class="f-ctrl" type="text" placeholder="College Name"></div>
        <div>
          <label class="f-lbl" for="add-dom-type">Category</label>
          <select id="add-dom-type" class="f-ctrl">
            <option value="Technical">Technical</option>
            <option value="Non-Technical">Non-Technical</option>
          </select>
        </div>
        <div>
          <label class="f-lbl" for="add-dom-name">Cohort Track</label>
          <input id="add-dom-name" class="f-ctrl" list="pgi-track-suggestions" type="text" value="Web Development &amp; Full Stack Development" required>
          <datalist id="pgi-track-suggestions">
            <option value="Web Development &amp; Full Stack Development"></option>
            <option value="App Development"></option>
            <option value="Python Programming"></option>
            <option value="Artificial Intelligence &amp; Machine Learning"></option>
            <option value="Data Science &amp; Analytics"></option>
            <option value="UI/UX Design"></option>
            <option value="IoT &amp; Embedded Systems"></option>
            <option value="Human Resource Management"></option>
            <option value="Marketing"></option>
            <option value="Finance &amp; Accounting"></option>
            <option value="Digital Marketing"></option>
            <option value="Business Development"></option>
            <option value="Sales"></option>
          </datalist>
        </div>
        <div>
          <label class="f-lbl" for="add-mode">Mode</label>
          <select id="add-mode" class="f-ctrl">
            <option value="Online">Online (30 Hours)</option>
            <option value="Offline">Offline (30 Hours)</option>
          </select>
        </div>
        <div>
          <label class="f-lbl" for="add-period">Internship Period</label>
          <select id="add-period" class="f-ctrl">
            <option value="1 month">1 month</option>
            <option value="2 weeks">2 weeks</option>
            <option value="1 week">1 week</option>
            <option value="3 months">3 months</option>
          </select>
        </div>
        <div><label class="f-lbl" for="add-batch">Batch</label><select id="add-batch" class="f-ctrl">${batchOptions}</select></div>
        <div><label class="f-lbl" for="add-mentor">Mentor</label><select id="add-mentor" class="f-ctrl">${mentorOptions}</select></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-green">Register Candidate</button>
      </div>
    </form>`);
}

async function submitNewStudent() {
  const payload = {
    fullName: ($('add-name')?.value || '').trim(),
    email: ($('add-email')?.value || '').trim(),
    phone: ($('add-phone')?.value || '').trim(),
    college: ($('add-college')?.value || '').trim() || 'Engineering College',
    domainType: $('add-dom-type')?.value || 'Technical',
    domainName: ($('add-dom-name')?.value || '').trim(),
    mode: $('add-mode')?.value || 'Online',
    internshipPeriod: $('add-period')?.value || '1 month',
    batchId: $('add-batch')?.value || null,
    mentorId: $('add-mentor')?.value || null
  };
  try {
    const res = await api('/api/admin/students', { method: 'POST', body: JSON.stringify(payload) });
    showToast(`Registered ${payload.fullName} (${res.applicationId || 'Saved'}).`);
    closeModal();
    await loadStudents();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function updateStudentStatus(idx, newStatus) {
  const s = cacheStudents[idx];
  if (!s) return;
  try {
    await api(`/api/admin/students/${encodeURIComponent(s.id)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: newStatus })
    });
    s.status = newStatus;
    showToast(`Updated ${s.name} status to ${newStatus}.`);
  } catch (err) {
    showToast(err.message, true);
    loadStudents();
  }
}

function openRemoveAllStudentsModal() {
  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <div>
        <span class="pill red">DANGER ZONE</span>
        <h3 style="margin:6px 0 0;font-family:'Space Grotesk',sans-serif;font-size:1.18rem;color:var(--adm-red);">Remove All Student Details</h3>
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
    </div>
    <p style="font-size:0.92rem;color:var(--adm-slate);margin:0 0 12px;">
      This permanently deletes <strong>all ${cacheStudents.length} student &amp; candidate records</strong> including applications, assessment attempts, coupons, payment orders, enrollments, attendance logs, submissions, project reports, certificates, and non-admin student login accounts.
    </p>
    <p style="font-size:0.88rem;color:var(--adm-muted);margin:0 0 12px;">
      Admin accounts, mentors, batches, question bank, courses, and platform settings will be preserved.
    </p>
    <form onsubmit="event.preventDefault(); executeRemoveAllStudents();">
      <label class="f-lbl" for="confirm-purge-stu">Type <code>DELETE ALL</code> to confirm permanent removal</label>
      <input id="confirm-purge-stu" class="f-ctrl" type="text" placeholder="DELETE ALL" autocomplete="off" required>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:6px;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" id="btn-confirm-purge-stu" class="btn btn-danger">Permanently Remove All Students</button>
      </div>
    </form>`);
}

async function executeRemoveAllStudents() {
  const confirmText = ($('confirm-purge-stu')?.value || '').trim().toUpperCase();
  if (confirmText !== 'DELETE ALL') {
    showToast('Please type DELETE ALL to confirm.', true);
    return;
  }
  const btn = $('btn-confirm-purge-stu');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Removing...';
  }
  try {
    const res = await api('/api/admin/students', { method: 'DELETE' });
    cacheStudents = [];
    closeModal();
    showToast(`All student details removed (${res.deletedAuthUsers || 0} student login account(s) deleted).`);
    await loadStudents();
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Permanently Remove All Students';
    }
    showToast(err.message, true);
  }
}

function jumpToStudentAttendance(idx) {
  const s = cacheStudents[idx];
  window.__prefillStudentId = s?.studentId || '';
  showTab('submissions', 'attendance');
}

function openStudentModal(idx) {
  const s = cacheStudents[idx];
  if (!s) return;

  const batchOptions = ['<option value="">-- Unassigned --</option>'].concat(
    cacheBatches.map(b => {
      const sel = (s.assignedBatchId && String(s.assignedBatchId) === String(b.id)) || (!s.assignedBatchId && s.assignedBatch === b.name);
      return `<option value="${escHtml(b.id)}"${sel ? ' selected' : ''}>${escHtml(b.name)} (${escHtml(b.mode || 'Online & Offline')})</option>`;
    })
  ).join('');

  const mentorOptions = ['<option value="">-- Unassigned --</option>'].concat(
    cacheMentors.map(m => {
      const sel = (s.assignedMentorId && String(s.assignedMentorId) === String(m.id)) || (!s.assignedMentorId && s.assignedMentor === m.name);
      const roleDesc = m.domain || m.title || m.specialization;
      return `<option value="${escHtml(m.id)}"${sel ? ' selected' : ''}>${escHtml(m.name)}${roleDesc ? ' — ' + escHtml(roleDesc) : ''}</option>`;
    })
  ).join('');

  const domainType = s.domainType === 'Core' ? 'Core' : 'Special';

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;">
      <div>
        <span class="pill blue" style="margin-bottom:6px;">${escHtml(s.studentId || s.applicationId || 'Applicant')}</span>
        <h3 style="margin:0;font-family:'Space Grotesk',sans-serif;font-size:1.18rem;">${escHtml(s.name)}</h3>
        <div style="font-size:0.9rem;color:var(--adm-muted);margin-top:2px;">${escHtml(s.email)} · ${escHtml(s.phone || 'No phone')}</div>
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
    </div>

    <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:11px;padding:12px 14px;margin-bottom:16px;font-size:0.9rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;">
      <div><strong>College:</strong><br>${escHtml(s.college || '—')} (${escHtml(s.department || '—')})</div>
      <div><strong>Period / Duration:</strong><br>${escHtml(s.internshipPeriod || s.duration || '30 Hours')}</div>
      <div><strong>Payment Ref / Receipt:</strong><br>${escHtml(s.paymentRef || '—')} / ${escHtml(s.receiptNo || '—')}</div>
      <div><strong>Address:</strong><br>${escHtml(s.address || '—')}</div>
    </div>
    ${s.whyHire && s.whyHire !== '—' ? `<div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:10px 12px;margin-bottom:16px;font-size:0.9rem;"><strong>Statement of Purpose:</strong> ${escHtml(s.whyHire)}</div>` : ''}

    <form onsubmit="event.preventDefault(); submitStudentAssignment(${idx});">
      <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
        <div>
          <label class="f-lbl" for="m-dom-type">Track Category</label>
          <select id="m-dom-type" class="f-ctrl">
            <option value="Special"${domainType === 'Special' ? ' selected' : ''}>Special</option>
            <option value="Core"${domainType === 'Core' ? ' selected' : ''}>Core</option>
          </select>
        </div>
        <div>
          <label class="f-lbl" for="m-dom-name">Assigned Domain / Track</label>
          <input id="m-dom-name" class="f-ctrl" type="text" value="${escHtml(s.domainName || '')}" placeholder="e.g. Web Development">
        </div>
        <div>
          <label class="f-lbl" for="m-batch">Assign Cohort Batch</label>
          <select id="m-batch" class="f-ctrl">${batchOptions}</select>
        </div>
        <div>
          <label class="f-lbl" for="m-mentor">Assign Mentor</label>
          <select id="m-mentor" class="f-ctrl">${mentorOptions}</select>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-green">Save Track, Batch &amp; Mentor</button>
      </div>
    </form>

    <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--adm-line);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
        <div>
          <strong style="font-size:0.94rem;color:var(--adm-navy);">Assessment Device Override</strong>
          <div style="font-size:0.82rem;color:var(--adm-muted);">Allow this student to take the assessment on a mobile phone or tablet.</div>
        </div>
        ${pillBadge(s.mobileOverride ? 'Mobile Allowed' : 'Desktop Only', s.mobileOverride ? 'blue' : 'gray')}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <input id="m-mobile-reason" class="f-ctrl" style="flex:1;min-width:210px;margin-bottom:0;" type="text" value="${escHtml(s.mobileOverrideReason || '')}" placeholder="Reason (e.g. Student has no computer)">
        <button type="button" class="btn ${s.mobileOverride ? 'btn-danger' : 'btn-outline'} btn-sm" onclick="submitStudentMobileOverride(${idx}, ${s.mobileOverride ? 'false' : 'true'})">
          ${s.mobileOverride ? 'Revoke Mobile Override' : 'Allow Mobile Assessment'}
        </button>
      </div>
    </div>`);
}

async function submitStudentMobileOverride(idx, allow) {
  const s = cacheStudents[idx];
  if (!s) return;
  const reason = ($('m-mobile-reason')?.value || '').trim();
  if (allow && reason.length < 3) {
    showToast('Enter a short reason for allowing mobile assessment (min 3 chars).', true);
    return;
  }
  try {
    const res = await api(`/api/admin/students/${encodeURIComponent(s.id)}/mobile-override`, {
      method: 'POST',
      body: JSON.stringify({
        allowed: Boolean(allow),
        reason: reason || (allow ? 'Approved by admin' : 'Revoked by admin'),
        email: s.email,
        applicationId: s.applicationId
      })
    });
    showToast(res.message || 'Mobile assessment override updated.');
    closeModal();
    await loadStudents();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function submitStudentAssignment(idx) {
  const s = cacheStudents[idx];
  if (!s) return;
  try {
    await api(`/api/admin/students/${encodeURIComponent(s.id)}/assign`, {
      method: 'POST',
      body: JSON.stringify({
        domainType: $('m-dom-type')?.value || s.domainType,
        domainName: $('m-dom-name')?.value.trim() || s.domainName,
        batchId: $('m-batch')?.value || null,
        mentorId: $('m-mentor')?.value || null,
        applicationId: s.applicationId,
        applicationRecordId: s.applicationRecordId,
        email: s.email
      })
    });
    showToast(`Saved cohort assignments for ${s.name}.`);
    closeModal();
    await loadStudents();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ----------------------------------------------------------------------------
// VIEW 3: Assessment & Proctoring (Stitch Surveillance + Question Bank)
// ----------------------------------------------------------------------------
let attpSegment = 'all';
let attpPage = 1;
const ATTP_PAGE_SIZE = 8;

async function loadAssessments() {
  const sub = curSubTab.assessments || 'attempts';
  const tabsHtml = renderSubTabs('assessments', [
    { key: 'attempts', label: 'Active Assessment Streams & Logs' },
    { key: 'questions', label: 'Question Bank' }
  ]);

  if (sub === 'questions') {
    cacheQuestions = await api('/api/admin/questions');
    $('admin-view').innerHTML = `
      <div class="adm-stu-hero">
        <div>
          <div><span class="adm-hero-pill">ITEM REPOSITORY &bull; LIVE BANK</span></div>
          <h2>Assessment &amp; Proctoring</h2>
          <p>Curate randomized scholarship MCQs across question sets, mark weights, and active pool controls.</p>
        </div>
        <div class="adm-hero-actions">
          <button type="button" class="btn btn-outline btn-sm" onclick="showTab('settings', 'exam')">Proctoring Rules / Settings</button>
          <button type="button" class="btn btn-green btn-sm" onclick="openQuestionModal(-1)">+ Add Question</button>
        </div>
      </div>
      ${tabsHtml}
      <div class="adm-panel">
        <div class="adm-panel-head">
          <h3>Assessment Question Bank (${cacheQuestions.length})</h3>
          <span class="pill blue">Randomized Set Mixing Active</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Question</th>
                <th>Set &amp; Marks</th>
                <th>Correct Answer</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${cacheQuestions.length ? cacheQuestions.map((q, idx) => {
                const rawText = String(q.text || q.question || q.prompt || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                const opts = Array.isArray(q.options) ? q.options : [];
                const corrId = String(q.correct_option_id || 'a').toLowerCase();
                const matchedOpt = opts.find(o => String(o?.id || '').toLowerCase() === corrId);
                const optLabel = matchedOpt
                  ? `${corrId.toUpperCase()}: ${matchedOpt.text || ''}`
                  : corrId.toUpperCase();
                const active = q.active !== false && q.is_active !== false;
                return `
                  <tr>
                    <td style="max-width:440px;"><strong>${escHtml(rawText.slice(0, 180))}${rawText.length > 180 ? '...' : ''}</strong></td>
                    <td>${pillBadge('Set ' + (q.question_set ?? 1), 'blue')} <span style="font-size:0.88rem;color:var(--adm-muted);">${escHtml(q.marks ?? 4)} marks</span></td>
                    <td style="font-size:0.88rem;color:var(--adm-green);font-weight:700;max-width:240px;">${escHtml(optLabel)}</td>
                    <td>${pillBadge(active ? 'active' : 'inactive', active ? 'green' : 'gray')}</td>
                    <td>
                      <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        <button type="button" class="btn btn-outline btn-sm" onclick="openQuestionModal(${idx})">Edit</button>
                        <button type="button" class="btn btn-outline btn-sm" onclick="toggleQuestion(${idx})">${active ? 'Disable' : 'Enable'}</button>
                        <button type="button" class="btn btn-danger btn-sm" onclick="deleteQuestion(${idx})">Delete</button>
                      </div>
                    </td>
                  </tr>`;
              }).join('') : emptyTableRow(5, 'No questions in the bank yet.')}
            </tbody>
          </table>
        </div>
      </div>`;
    return;
  }

  const [attempts, settings, blockedLogs] = await Promise.all([
    api('/api/admin/attempts'),
    api('/api/admin/settings').catch(() => cacheSettings || {}),
    api('/api/admin/audit-logs?action=ASSESSMENT_DEVICE_BLOCKED').catch(() => [])
  ]);
  cacheAttempts = Array.isArray(attempts) ? attempts : [];
  cacheSettings = settings || {};
  const blockedArr = Array.isArray(blockedLogs) ? blockedLogs : [];
  cacheBlockedDeviceCount = blockedArr.length;
  cacheBlockedDevices = blockedArr.slice(0, 30).map(b => ({
    id: b.id,
    applicationId: b.details?.application_id || b.target_id || 'UNKNOWN',
    email: b.details?.email || b.admin_email || '',
    time: b.details?.time || b.created_at,
    userAgent: b.details?.user_agent || '',
    reason: b.details?.reason || 'device_not_allowed',
    endpoint: b.details?.endpoint || ''
  }));
  const desktopOnlyOn = cacheSettings.desktop_only !== false;
  attpPage = 1;

  const total = cacheAttempts.length;
  const inProgressCnt = cacheAttempts.filter(a => a.status === 'in_progress').length;
  const flaggedCnt = cacheAttempts.filter(a => Number(a.strikes || 0) > 0 || Number(a.violationEvents || 0) > 0 || a.status === 'auto_submitted').length;
  const completedCnt = cacheAttempts.filter(a => a.status === 'submitted' || a.status === 'auto_submitted').length;
  const avgScore = total
    ? (Math.round((cacheAttempts.reduce((acc, x) => acc + Number(x.scorePercent || 0), 0) / total) * 10) / 10)
    : 0;
  const passMark = Number(cacheSettings.pass_mark ?? 30);
  const passedCnt = cacheAttempts.filter(a => Number(a.scorePercent || 0) >= passMark).length;
  const passRatePct = total ? (Math.round((passedCnt / total) * 1000) / 10) : 0;

  // Aggregate live violation breakdown across all attempts
  const typeTotals = {};
  let totalViolCount = 0;
  for (const a of cacheAttempts) {
    const br = a.violationBreakdown || {};
    for (const [k, v] of Object.entries(br)) {
      typeTotals[k] = (typeTotals[k] || 0) + Number(v || 0);
      totalViolCount += Number(v || 0);
    }
  }
  const topTypes = Object.entries(typeTotals).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const flaggedAttempts = cacheAttempts
    .map((a, idx) => ({ a, idx }))
    .filter(({ a }) => Number(a.strikes || 0) > 0 || Number(a.violationEvents || 0) > 0)
    .slice(0, 3);

  const durMins = Math.max(1, Math.round(Number(cacheSettings.duration_seconds ?? 1200) / 60));

  $('admin-view').innerHTML = `
    <div class="adm-stu-hero">
      <div>
        <div><span class="adm-hero-pill">&bull; LIVE SURVEILLANCE &amp; LOGS &bull; ACTIVE SESSION</span></div>
        <h2>Assessment &amp; Proctoring</h2>
        <p>Monitor live and completed candidate assessment sessions, review proctoring integrity flags, and manage rules.</p>
      </div>
      <div class="adm-hero-actions">
        <label style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border:1px solid var(--adm-line);border-radius:9px;background:#fff;font-size:0.84rem;font-weight:700;cursor:pointer;">
          <input id="assm-desktop-only-toggle" type="checkbox"${desktopOnlyOn ? ' checked' : ''} onchange="toggleDesktopOnlySetting(this.checked)">
          <span>Desktop only</span>
          ${pillBadge(desktopOnlyOn ? 'ON' : 'OFF', desktopOnlyOn ? 'green' : 'gray')}
        </label>
        <button type="button" class="btn btn-outline btn-sm" onclick="showTab('settings', 'exam')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/></svg>
          Proctoring Rules / Settings
        </button>
        <button type="button" class="btn btn-outline btn-sm" onclick="refreshCurrentTab()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Force Refresh
        </button>
        <button type="button" class="btn btn-green btn-sm" onclick="downloadWithAuth('/api/admin/attempts/export.csv', 'assessment-results.csv')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export Proctor Logs
        </button>
      </div>
    </div>

    ${tabsHtml}

    <div class="kpi-grid">
      ${kpiCard('ACTIVE LIVE TESTS', String(inProgressCnt), `${inProgressCnt > 0 ? 'Sessions running now' : 'No candidate in live exam'}`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M4.93 4.93l14.14 14.14M1 12h22M4.93 19.07l14.14-14.14"/></svg>', 'green', '', total ? Math.round((inProgressCnt / total) * 100) : 8, '')}
      ${kpiCard('FLAGGED INFRACTIONS', String(flaggedCnt), `${flaggedCnt > 0 ? 'Requiring admin review' : 'Zero integrity warnings'}`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>', flaggedCnt > 0 ? 'red' : 'green', "setAttemptSegment('flagged')", total ? Math.round((flaggedCnt / total) * 100) : 4, flaggedCnt > 0 ? 'red' : '')}
      ${kpiCard('BLOCKED MOBILE ATTEMPTS', String(cacheBlockedDeviceCount), `${desktopOnlyOn ? 'Phones & tablets rejected' : 'Desktop-only disabled'} · View log`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>', cacheBlockedDeviceCount > 0 ? 'red' : 'blue', 'openBlockedDevicesModal()', '', cacheBlockedDeviceCount > 0 ? 'red' : '')}
      ${kpiCard('TESTS COMPLETED', String(completedCnt), `Avg. Score: ${avgScore}%`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>', 'blue', "setAttemptSegment('completed')", total ? Math.round((completedCnt / total) * 100) : 10, 'slate')}
      ${kpiCard('QUALIFIED PASS RATE', `${passRatePct}%`, `${passedCnt} of ${total} >= ${passMark}% threshold`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>', 'green', '', passRatePct, '')}
    </div>

    <div class="adm-seg-bar">
      <div class="adm-seg-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="f-attp-q" type="search" placeholder="Search candidate by name, email, UID, or voucher..." oninput="attpPage=1; renderAttemptsTable()">
      </div>
      <div class="adm-seg-pills" role="group" aria-label="Assessment stream filters">
        <button type="button" class="adm-seg-pill${attpSegment === 'all' ? ' active' : ''}" data-aseg="all" onclick="setAttemptSegment('all')">All Sessions (${total})</button>
        <button type="button" class="adm-seg-pill${attpSegment === 'flagged' ? ' active' : ''}" data-aseg="flagged" onclick="setAttemptSegment('flagged')">Flagged Only (${flaggedCnt})</button>
        <button type="button" class="adm-seg-pill${attpSegment === 'completed' ? ' active' : ''}" data-aseg="completed" onclick="setAttemptSegment('completed')">Completed (${completedCnt})</button>
        <button type="button" class="adm-seg-pill${attpSegment === 'live' ? ' active' : ''}" data-aseg="live" onclick="setAttemptSegment('live')">In Progress (${inProgressCnt})</button>
      </div>
    </div>

    <div class="table-wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--adm-line);background:#fff;">
        <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:0.9rem;color:var(--adm-navy);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          Active &amp; Completed Assessment Streams
        </div>
        <span style="font-size:0.78rem;font-weight:800;letter-spacing:0.06em;color:var(--adm-green);">&bull; REAL-TIME DB SYNC</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Candidate</th>
            <th>Score &amp; Voucher</th>
            <th>Integrity Status</th>
            <th>Feed Status</th>
            <th>Strikes / Events</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="attp-tbody"></tbody>
      </table>
      <div id="attp-table-foot" class="adm-table-foot"></div>
    </div>

    <div class="adm-grid-3">
      <section class="adm-panel">
        <div class="adm-panel-head">
          <h3>Flag Detection Breakdown</h3>
          <span class="pill blue">${totalViolCount} Events</span>
        </div>
        ${topTypes.length ? topTypes.map(([tKey, cnt]) => {
          const pct = totalViolCount ? Math.round((cnt / totalViolCount) * 100) : 0;
          return `
            <div style="margin-bottom:12px;">
              <div style="display:flex;justify-content:space-between;font-size:0.86rem;margin-bottom:4px;">
                <strong style="text-transform:uppercase;color:var(--adm-slate);">${escHtml(tKey.replace(/_/g, ' '))}</strong>
                <span style="font-weight:700;">${pct}% (${cnt})</span>
              </div>
              <div class="adm-prog-track"><div class="adm-prog-fill" style="width:${Math.max(4, pct)}%;background:${cnt >= 3 ? 'var(--adm-red)' : 'var(--adm-green)'};"></div></div>
            </div>`;
        }).join('') : '<p style="color:var(--adm-muted);font-size:0.92rem;margin:0;">No proctoring infractions detected across recorded attempts.</p>'}
      </section>

      <section class="adm-panel">
        <div class="adm-panel-head">
          <h3>Active Integrity Alerts</h3>
          ${pillBadge('PRIORITY', flaggedAttempts.length ? 'red' : 'gray')}
        </div>
        ${flaggedAttempts.length ? `
          <div style="display:grid;gap:10px;">
            ${flaggedAttempts.map(({ a, idx }) => `
              <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
                <div style="min-width:0;">
                  <strong style="display:block;font-size:0.9rem;color:var(--adm-navy);">${escHtml(a.topViolationLabel || 'Proctoring Event')} (${escHtml(a.name)})</strong>
                  <span style="font-size:0.84rem;color:var(--adm-muted);">${a.strikes ?? 0} strikes &bull; ${a.violationEvents ?? 0} logged events</span>
                </div>
                <button type="button" class="btn btn-outline btn-sm" onclick="openViolationModal(${idx})">Inspect</button>
              </div>`).join('')}
          </div>` : '<p style="color:var(--adm-muted);font-size:0.92rem;margin:0;">Clean proctoring window &mdash; no flagged integrity alerts.</p>'}
      </section>

      <section class="adm-panel">
        <div class="adm-panel-head">
          <h3>Proctor &amp; Exam Policy</h3>
          <span style="font-size:0.82rem;font-weight:800;color:var(--adm-green);">&bull; OPERATIONAL</span>
        </div>
        <div style="display:grid;gap:10px;font-size:0.92rem;">
          <div style="display:flex;justify-content:space-between;">
            <span style="color:var(--adm-muted);">Assessment Duration</span>
            <strong>${durMins} mins (${escHtml(cacheSettings.question_count ?? 25)} MCQs)</strong>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:var(--adm-muted);">Auto-Submit Strike Guard</span>
            <strong>After 3 Strikes</strong>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:var(--adm-muted);">Qualifying Cutoff</span>
            <strong>${passMark} / ${escHtml(cacheSettings.total_marks ?? 100)} Marks</strong>
          </div>
        </div>
      </section>
    </div>`;

  renderAttemptsTable();
}

function setAttemptSegment(seg) {
  attpSegment = seg;
  attpPage = 1;
  document.querySelectorAll('.adm-seg-pill[data-aseg]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-aseg') === seg);
  });
  renderAttemptsTable();
}

function setAttemptPage(p) {
  attpPage = Math.max(1, Number(p || 1));
  renderAttemptsTable();
}

function renderAttemptsTable() {
  const tbody = $('attp-tbody');
  const foot = $('attp-table-foot');
  if (!tbody) return;
  const q = ($('f-attp-q')?.value || '').trim().toLowerCase();

  const rows = cacheAttempts.map((a, idx) => ({ a, idx })).filter(({ a }) => {
    if (attpSegment === 'flagged' && !(Number(a.strikes || 0) > 0 || Number(a.violationEvents || 0) > 0 || a.status === 'auto_submitted')) return false;
    if (attpSegment === 'completed' && !['submitted', 'auto_submitted'].includes(String(a.status || '').toLowerCase())) return false;
    if (attpSegment === 'live' && a.status !== 'in_progress') return false;
    if (q) {
      const hay = [a.name, a.email, a.applicationId, a.couponCode, a.topViolationLabel].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / ATTP_PAGE_SIZE));
  if (attpPage > totalPages) attpPage = totalPages;

  if (!total) {
    tbody.innerHTML = emptyTableRow(6, 'No matching assessment sessions found.');
    if (foot) foot.innerHTML = '<span>Showing 0 sessions</span><span></span>';
    return;
  }

  const startIdx = (attpPage - 1) * ATTP_PAGE_SIZE;
  const pageRows = rows.slice(startIdx, startIdx + ATTP_PAGE_SIZE);

  tbody.innerHTML = pageRows.map(({ a, idx }) => {
    const strikes = Number(a.strikes || 0);
    const evts = Number(a.violationEvents || 0);
    const isFlagged = strikes >= 2 || a.status === 'auto_submitted';
    const isWarn = !isFlagged && (strikes > 0 || evts > 0);

    let integrityHtml = `<span class="adm-integrity-box flag-green">CLEAN &bull; NO FLAGS</span>`;
    if (isFlagged) {
      integrityHtml = `<span class="adm-integrity-box flag-red">FLAGGED: ${escHtml((a.topViolationLabel || 'VIOLATION').slice(0, 26))}</span>`;
    } else if (isWarn) {
      integrityHtml = `<span class="adm-integrity-box flag-amber">NOTICE: ${escHtml((a.topViolationLabel || 'EVENT').slice(0, 26))}</span>`;
    }

    const feedHtml = isFlagged
      ? `<span style="color:var(--adm-red);font-weight:700;font-size:0.88rem;">&bull; Alert (${evts} evt)</span>`
      : (a.status === 'in_progress'
        ? `<span style="color:var(--adm-green);font-weight:700;font-size:0.88rem;">&bull; Camera Active</span>`
        : `<span style="color:var(--adm-slate);font-weight:600;font-size:0.88rem;">&bull; Feed Clear</span>`);

    const iniBg = isFlagged ? 'background:#FEE2E2;color:#991B1B;' : (isWarn ? 'background:#FEF3C7;color:#92400E;' : '');

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;min-width:190px;">
            <span class="adm-act-ini" style="width:34px;height:34px;font-size:0.84rem;${iniBg}">${escHtml(getInitials(a.name))}</span>
            <div style="min-width:0;">
              <strong style="display:block;color:var(--adm-navy);">${escHtml(a.name)}</strong>
              <span style="font-family:'JetBrains Mono',monospace;font-size:0.84rem;color:var(--adm-muted);">${escHtml(a.applicationId || a.email || '—')}</span>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight:700;font-size:0.92rem;">${escHtml(a.scorePercent ?? 0)}% <span style="font-weight:500;color:var(--adm-muted);">(${escHtml(a.correctCount ?? 0)}/${escHtml(a.totalQuestions ?? 25)})</span></div>
          <div style="font-size:0.84rem;color:var(--adm-muted);">${escHtml(a.status || 'in_progress')} &bull; ${fmtDate(a.submittedAt || a.startedAt, true)}</div>
          ${a.couponCode ? `<div style="font-family:'JetBrains Mono',monospace;font-size:0.82rem;color:var(--adm-green);font-weight:700;margin-top:2px;">${escHtml(a.couponCode)} (${escHtml(a.couponDiscount ?? 0)}%)</div>` : ''}
        </td>
        <td>${integrityHtml}</td>
        <td>${feedHtml}</td>
        <td>
          ${pillBadge(`${strikes} strike${strikes === 1 ? '' : 's'}`, strikes >= 3 ? 'red' : (strikes > 0 ? 'yellow' : 'green'))}
          <div style="font-size:0.82rem;color:var(--adm-muted);margin-top:3px;">${evts} total event${evts === 1 ? '' : 's'}</div>
        </td>
        <td>
          <button type="button" class="btn ${strikes > 0 || evts > 0 ? 'btn-green' : 'btn-outline'} btn-sm" onclick="openViolationModal(${idx})">
            ${strikes > 0 || evts > 0 ? 'Review Feed' : 'View Log'}
          </button>
        </td>
      </tr>`;
  }).join('');

  if (foot) {
    const fromN = startIdx + 1;
    const toN = startIdx + pageRows.length;
    const pageButtons = Array.from({ length: totalPages }, (_, i) => i + 1)
      .slice(Math.max(0, attpPage - 3), Math.min(totalPages, attpPage + 2))
      .map(p => `<button type="button" class="adm-page-btn${p === attpPage ? ' active' : ''}" onclick="setAttemptPage(${p})">${p}</button>`)
      .join('');
    foot.innerHTML = `
      <span>Showing <strong>${fromN}&ndash;${toN}</strong> of <strong>${total}</strong> candidate session${total === 1 ? '' : 's'}</span>
      <div class="adm-pager">
        <button type="button" class="adm-page-btn" ${attpPage <= 1 ? 'disabled' : ''} onclick="setAttemptPage(${attpPage - 1})">Previous</button>
        ${pageButtons}
        <button type="button" class="adm-page-btn" ${attpPage >= totalPages ? 'disabled' : ''} onclick="setAttemptPage(${attpPage + 1})">Next</button>
      </div>`;
  }
}

async function openViolationModal(idx) {
  const a = cacheAttempts[idx];
  if (!a) return;
  openModal('<div class="hub-loader-center" style="min-height:180px;"><div class="hub-loader-ring"></div><p class="hub-loader-text">Loading proctoring evidence...</p></div>');
  try {
    const viols = await api(`/api/admin/attempts/${encodeURIComponent(a.id)}/violations`);
    openModal(`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div>
          <h3 style="margin:0;font-family:'Space Grotesk',sans-serif;">Proctoring Evidence Timeline</h3>
          <div style="font-size:0.9rem;color:var(--adm-muted);">${escHtml(a.name)} · ${escHtml(a.email)} · Score ${escHtml(a.scorePercent)}%</div>
        </div>
        <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
      </div>
      ${viols.length ? `
        <div style="display:grid;gap:12px;">
          ${viols.map((v, i) => {
            const imgSrc = safeImageSrc(v.snapshot);
            return `
              <div style="border:1px solid var(--adm-line);border-radius:11px;padding:12px;display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;background:#F8FAFC;">
                <div>
                  <div style="font-weight:700;">#${i + 1} · ${escHtml(v.label || v.type)} ${v.counted ? pillBadge('Strike Counted', 'red') : pillBadge('Logged Notice', 'gray')}</div>
                  <div style="font-size:0.88rem;color:var(--adm-muted);margin-top:4px;">${fmtDate(v.occurred_at, true)}</div>
                </div>
                ${imgSrc ? `<img src="${imgSrc}" alt="Proctor capture" style="width:140px;height:79px;object-fit:cover;border-radius:8px;border:1px solid var(--adm-line);">` : '<span style="font-size:0.84rem;color:var(--adm-muted);">No snapshot attached</span>'}
              </div>`;
          }).join('')}
        </div>` : '<p style="color:var(--adm-muted);margin:12px 0;">Clean session — zero proctoring violations recorded.</p>'}`);
  } catch (err) {
    closeModal();
    showToast(err.message, true);
  }
}

function openQuestionModal(idx) {
  const q = idx >= 0 ? cacheQuestions[idx] : null;
  const opts = q && Array.isArray(q.options) ? q.options : [];
  const optVal = (letter, i) => {
    const found = opts.find(o => String(o?.id || '').toLowerCase() === letter) || opts[i];
    return typeof found === 'object' && found !== null ? (found.text || '') : (found || '');
  };
  const corr = String(q?.correct_option_id || 'a').toLowerCase();

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <h3 style="margin:0;font-family:'Space Grotesk',sans-serif;">${q ? 'Edit Question' : 'Add Assessment Question'}</h3>
      <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
    </div>
    <form onsubmit="event.preventDefault(); saveQuestion(${idx});">
      <label class="f-lbl" for="q-prompt">Question Text *</label>
      <textarea id="q-prompt" class="f-ctrl" rows="3" required>${escHtml(q?.text || q?.question || '')}</textarea>
      <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">
        <div><label class="f-lbl" for="q-set">Question Set #</label><input id="q-set" class="f-ctrl" type="number" min="1" max="20" value="${escHtml(q?.question_set ?? 1)}"></div>
        <div><label class="f-lbl" for="q-marks">Marks</label><input id="q-marks" class="f-ctrl" type="number" min="1" max="25" value="${escHtml(q?.marks ?? 5)}"></div>
        <div>
          <label class="f-lbl" for="q-corr">Correct Option</label>
          <select id="q-corr" class="f-ctrl">
            <option value="a"${corr === 'a' ? ' selected' : ''}>Option A</option>
            <option value="b"${corr === 'b' ? ' selected' : ''}>Option B</option>
            <option value="c"${corr === 'c' ? ' selected' : ''}>Option C</option>
            <option value="d"${corr === 'd' ? ' selected' : ''}>Option D</option>
          </select>
        </div>
      </div>
      <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
        <div><label class="f-lbl" for="q-o0">Option A *</label><input id="q-o0" class="f-ctrl" type="text" value="${escHtml(optVal('a', 0))}" required></div>
        <div><label class="f-lbl" for="q-o1">Option B *</label><input id="q-o1" class="f-ctrl" type="text" value="${escHtml(optVal('b', 1))}" required></div>
        <div><label class="f-lbl" for="q-o2">Option C *</label><input id="q-o2" class="f-ctrl" type="text" value="${escHtml(optVal('c', 2))}" required></div>
        <div><label class="f-lbl" for="q-o3">Option D *</label><input id="q-o3" class="f-ctrl" type="text" value="${escHtml(optVal('d', 3))}" required></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:6px;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-green">Save Question</button>
      </div>
    </form>`);
}

async function saveQuestion(idx) {
  const existing = idx >= 0 ? cacheQuestions[idx] : null;
  const payload = {
    text: ($('q-prompt')?.value || '').trim(),
    question_set: Number($('q-set')?.value || 1),
    marks: Number($('q-marks')?.value || 5),
    options: [
      { id: 'a', text: $('q-o0')?.value.trim() || '' },
      { id: 'b', text: $('q-o1')?.value.trim() || '' },
      { id: 'c', text: $('q-o2')?.value.trim() || '' },
      { id: 'd', text: $('q-o3')?.value.trim() || '' }
    ],
    correct_option_id: $('q-corr')?.value || 'a'
  };
  try {
    const endpoint = existing ? `/api/admin/questions/${encodeURIComponent(existing.id)}` : '/api/admin/questions';
    await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    showToast(existing ? 'Updated question.' : 'Created new question.');
    closeModal();
    await loadAssessments();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function toggleQuestion(idx) {
  const q = cacheQuestions[idx];
  if (!q) return;
  try {
    await api(`/api/admin/questions/${encodeURIComponent(q.id)}/toggle`, { method: 'POST' });
    showToast('Updated question active state.');
    await loadAssessments();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteQuestion(idx) {
  const q = cacheQuestions[idx];
  if (!q || !confirm('Delete this assessment question?')) return;
  try {
    await api(`/api/admin/questions/${encodeURIComponent(q.id)}`, { method: 'DELETE' });
    showToast('Deleted question.');
    await loadAssessments();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ----------------------------------------------------------------------------
// VIEW 4: Submissions & Grading + Daily 30h Attendance Ledger
// ----------------------------------------------------------------------------
async function loadSubmissionsView() {
  const sub = curSubTab.submissions || 'submissions';
  const tabsHtml = renderSubTabs('submissions', [
    { key: 'submissions', label: 'Submissions & Grading' },
    { key: 'attendance', label: 'Daily 3h Attendance Ledger' }
  ]);

  if (sub === 'attendance') {
    const [attRows, stuRows] = await Promise.all([
      api('/api/admin/attendance'),
      cacheStudents.length ? Promise.resolve(cacheStudents) : api('/api/admin/students').catch(() => [])
    ]);
    cacheAttendance = Array.isArray(attRows) ? attRows : [];
    if (Array.isArray(stuRows)) cacheStudents = stuRows;

    const enrolledOptions = cacheStudents
      .filter(s => s.studentId)
      .map(s => `<option value="${escHtml(s.studentId)}">${escHtml(s.studentId)} — ${escHtml(s.name)} (${escHtml(s.mode || 'Online')})</option>`)
      .join('');

    const today = new Date().toISOString().slice(0, 10);
    const prefillId = window.__prefillStudentId || '';
    window.__prefillStudentId = '';

    $('admin-view').innerHTML = `
      ${tabsHtml}
      <section class="adm-panel">
        <div class="adm-panel-head">
          <h3>Log or Update Daily Session Attendance (30-Hour / 75% Gate)</h3>
          <span class="pill blue">3.0h Standard Session</span>
        </div>
        <form onsubmit="event.preventDefault(); submitAttendanceForm();">
          <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;">
            <div>
              <label class="f-lbl" for="att-sid">Student ID *</label>
              <input id="att-sid" class="f-ctrl" list="att-student-list" value="${escHtml(prefillId)}" placeholder="PGI-S26-1001" required>
              <datalist id="att-student-list">${enrolledOptions}</datalist>
            </div>
            <div>
              <label class="f-lbl" for="att-day">Cohort Day (1–30)</label>
              <input id="att-day" class="f-ctrl" type="number" min="1" max="30" value="1" required>
            </div>
            <div>
              <label class="f-lbl" for="att-date">Session Date</label>
              <input id="att-date" class="f-ctrl" type="date" value="${today}" required>
            </div>
            <div>
              <label class="f-lbl" for="att-status">Status &amp; Mode</label>
              <div style="display:flex;gap:6px;">
                <select id="att-status" class="f-ctrl" onchange="syncAttHoursDefault(this.value)">
                  <option value="present">Present (3h)</option>
                  <option value="late">Late (2h)</option>
                  <option value="absent">Absent (0h)</option>
                  <option value="excused">Excused</option>
                  <option value="holiday">Holiday</option>
                </select>
                <select id="att-mode" class="f-ctrl">
                  <option value="Online">Online</option>
                  <option value="Offline">Offline</option>
                </select>
              </div>
            </div>
          </div>
          <div class="adm-form-2col" style="display:grid;grid-template-columns:140px 1fr 1fr;gap:12px;align-items:end;">
            <div>
              <label class="f-lbl" for="att-hrs">Hours Logged</label>
              <input id="att-hrs" class="f-ctrl" type="number" min="0" max="12" step="0.5" value="3.0">
            </div>
            <div>
              <label class="f-lbl" for="att-title">Session Topic / Title</label>
              <input id="att-title" class="f-ctrl" type="text" placeholder="Day 1 Cohort Session">
            </div>
            <div>
              <label class="f-lbl" for="att-remarks">Remarks (Optional)</label>
              <input id="att-remarks" class="f-ctrl" type="text" placeholder="Lab verification / notes">
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;">
            <button type="submit" class="btn btn-green">Save Attendance Record</button>
          </div>
        </form>
      </section>

      <div class="filter-bar">
        <input id="f-att-q" class="f-ctrl" type="search" value="${escHtml(prefillId)}" placeholder="Filter by Student ID, session title, remarks..." oninput="renderAttendanceTable()">
        <select id="f-att-status" class="f-ctrl" onchange="renderAttendanceTable()">
          <option value="">All Statuses</option>
          <option value="present">Present</option>
          <option value="late">Late</option>
          <option value="absent">Absent</option>
          <option value="excused">Excused</option>
        </select>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Student ID</th>
              <th>Day &amp; Date</th>
              <th>Session Title</th>
              <th>Mode</th>
              <th>Hours</th>
              <th>Status</th>
              <th>Remarks</th>
              <th>Edit</th>
            </tr>
          </thead>
          <tbody id="att-tbody"></tbody>
        </table>
      </div>`;

    renderAttendanceTable();
    return;
  }

  const [subs, mentors, students] = await Promise.all([
    api('/api/admin/submissions'),
    api('/api/admin/mentors').catch(() => []),
    cacheStudents.length ? Promise.resolve(cacheStudents) : api('/api/admin/students').catch(() => [])
  ]);
  cacheSubmissions = Array.isArray(subs) ? subs : [];
  cacheMentors = Array.isArray(mentors) ? mentors : [];
  if (Array.isArray(students)) cacheStudents = students;
  subPage = 1;

  const total = cacheSubmissions.length;
  const submittedCnt = cacheSubmissions.filter(x => x.status === 'submitted').length;
  const reviewedList = cacheSubmissions.filter(x => x.status === 'reviewed');
  const reviewedCnt = reviewedList.length;
  const draftPendingCnt = cacheSubmissions.filter(x => x.status !== 'submitted' && x.status !== 'reviewed').length;
  const gradedWithScore = reviewedList.filter(x => x.score !== null && x.score !== undefined);
  const avgGradePct = gradedWithScore.length
    ? (Math.round((gradedWithScore.reduce((acc, x) => acc + Number(x.score || 0), 0) / gradedWithScore.length) * 10) / 10)
    : null;

  const tracks = [...new Set(cacheSubmissions.map(x => x.track).filter(Boolean))].sort();
  const activeMentors = cacheMentors.filter(m => m.active !== false);

  const subLoadByMentor = {};
  for (const st of cacheStudents) {
    if (st.assignedMentorId) subLoadByMentor[st.assignedMentorId] = (subLoadByMentor[st.assignedMentorId] || 0) + 1;
  }

  $('admin-view').innerHTML = `
    <div class="adm-stu-hero">
      <div>
        <div>
          <span class="adm-hero-pill">&bull; COHORT 2026 EVALUATION // BATCH ACTIVE</span>
          <span class="adm-sync-note">GRADING &amp; RUBRIC SYNC</span>
        </div>
        <h2>Submissions &amp; Grading</h2>
        <p>Review student code submissions, GitHub repositories, deployed demo links, and assign rubric scores.</p>
      </div>
      <div class="adm-hero-actions">
        <button type="button" class="btn btn-outline btn-sm" onclick="exportSubmissionsCsv()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export Grades CSV
        </button>
        <button type="button" class="btn btn-green btn-sm" ${submittedCnt === 0 ? 'disabled style="opacity:0.55;cursor:not-allowed;"' : ''} onclick="batchApproveSubmissions()">
          &#10003; Batch Approve Submitted (${submittedCnt})
        </button>
      </div>
    </div>

    ${tabsHtml}

    <div class="kpi-grid">
      ${kpiCard('TOTAL SUBMISSIONS', String(total), `Cohort deliverables · ${reviewedCnt} graded so far`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>', 'blue')}
      ${kpiCard('PENDING GRADING', String(submittedCnt), 'Submitted for manual evaluation', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>', 'green', "setSubSegment('submitted')", total ? Math.round((submittedCnt / total) * 100) : 6, '')}
      ${kpiCard('AVG GRADED SCORE', avgGradePct !== null ? `${avgGradePct}%` : '—', `${gradedWithScore.length} scored by faculty`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>', 'green')}
      ${kpiCard('DRAFTS / INCOMPLETE', String(draftPendingCnt), 'Saved drafts or awaiting upload', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', 'blue')}
    </div>

    <div class="adm-seg-bar">
      <div class="adm-seg-pills" role="group" aria-label="Submission status filters">
        <button type="button" class="adm-seg-pill${subSegment === 'all' ? ' active' : ''}" data-sseg="all" onclick="setSubSegment('all')">All Submissions <span class="adm-count-badge">${total}</span></button>
        <button type="button" class="adm-seg-pill${subSegment === 'submitted' ? ' active' : ''}" data-sseg="submitted" onclick="setSubSegment('submitted')">Pending Review <span class="adm-count-badge">${submittedCnt}</span></button>
        <button type="button" class="adm-seg-pill${subSegment === 'reviewed' ? ' active' : ''}" data-sseg="reviewed" onclick="setSubSegment('reviewed')">Graded <span class="adm-count-badge">${reviewedCnt}</span></button>
        <button type="button" class="adm-seg-pill${subSegment === 'pending' ? ' active' : ''}" data-sseg="pending" onclick="setSubSegment('pending')">Drafts / Incomplete <span class="adm-count-badge">${draftPendingCnt}</span></button>
      </div>
      <div class="adm-seg-controls" style="flex:1 1 280px;justify-content:flex-end;">
        <input id="f-sub-q" class="adm-seg-select" style="flex:1 1 170px;background:#fff;" type="search" placeholder="Search intern, title, repo..." oninput="subPage=1; renderSubmissionsTable()">
        <select id="f-sub-track" class="adm-seg-select" aria-label="Filter by track" onchange="subPage=1; renderSubmissionsTable()">
          <option value="">All Tracks</option>
          ${tracks.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Student / Candidate</th>
            <th>Assignment / Module</th>
            <th>Submitted Assets</th>
            <th>Evaluation Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="sub-tbody"></tbody>
      </table>
      <div id="sub-table-foot" class="adm-table-foot"></div>
    </div>

    <div class="adm-grid-7-5">
      <section class="adm-panel">
        <div class="adm-panel-head">
          <h3>Evaluation Rubric Breakdown</h3>
          <span class="adm-sync-note">COHORT STANDARD</span>
        </div>
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;font-size:0.92rem;margin-bottom:5px;">
            <strong>Functionality &amp; Repository Discipline</strong><strong style="color:var(--adm-green);">40%</strong>
          </div>
          <div class="adm-prog-track"><div class="adm-prog-fill" style="width:40%;"></div></div>
          <div style="font-size:0.84rem;color:var(--adm-muted);margin-top:4px;">Working feature implementation, clean commits, and verifiable repository structure.</div>
        </div>
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;font-size:0.92rem;margin-bottom:5px;">
            <strong>Code Architecture &amp; Technical Execution</strong><strong style="color:var(--adm-green);">30%</strong>
          </div>
          <div class="adm-prog-track"><div class="adm-prog-fill" style="width:30%;"></div></div>
          <div style="font-size:0.84rem;color:var(--adm-muted);margin-top:4px;">Modular code design, error handling, and adherence to selected domain standards.</div>
        </div>
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;font-size:0.92rem;margin-bottom:5px;">
            <strong>Documentation &amp; Live Deployment</strong><strong style="color:var(--adm-green);">30%</strong>
          </div>
          <div class="adm-prog-track"><div class="adm-prog-fill" style="width:30%;"></div></div>
          <div style="font-size:0.84rem;color:var(--adm-muted);margin-top:4px;">Deployed preview URL, README instructions, and 1-page capstone report readiness.</div>
        </div>
        <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:0.88rem;">
          <span style="color:var(--adm-muted);">30-hour curriculum aligned across 10 cohort modules.</span>
          <button type="button" class="btn btn-outline btn-sm" onclick="showTab('curriculum')">View Track Curriculum &rarr;</button>
        </div>
      </section>

      <section class="adm-panel">
        <div class="adm-panel-head">
          <h3>Active Cohort Mentors</h3>
          <span class="pill green">${activeMentors.length} ACTIVE</span>
        </div>
        <p style="margin:0 0 12px;font-size:0.9rem;color:var(--adm-muted);">Assigned track mentors overseeing milestone submissions and reviews.</p>
        <div style="display:grid;gap:10px;">
          ${activeMentors.length ? activeMentors.slice(0, 4).map(m => {
            const cnt = subLoadByMentor[m.id] || 0;
            return `
              <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
                <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                  <span class="adm-act-ini" style="width:32px;height:32px;font-size:0.84rem;">${escHtml(getInitials(m.name))}</span>
                  <div style="min-width:0;">
                    <strong style="display:block;font-size:0.92rem;">${escHtml(m.name)}</strong>
                    <span style="display:block;font-size:0.84rem;color:var(--adm-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(m.domain || m.title || 'Track Mentor')}</span>
                  </div>
                </div>
                ${pillBadge(`${cnt} assigned`, cnt > 0 ? 'green' : 'gray')}
              </div>`;
          }).join('') : '<p style="color:var(--adm-muted);font-size:0.92rem;">No active mentors configured.</p>'}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:10px;border-top:1px solid #F1F5F9;font-size:0.88rem;">
          <span style="color:var(--adm-muted);">Mentor roster synced with student assignments</span>
          <button type="button" class="btn btn-outline btn-sm" onclick="showTab('mentors')">Manage Mentors</button>
        </div>
      </section>
    </div>`;

  renderSubmissionsTable();
}

let subSegment = 'all';
let subPage = 1;
const SUB_PAGE_SIZE = 8;

function setSubSegment(seg) {
  subSegment = seg;
  subPage = 1;
  document.querySelectorAll('.adm-seg-pill[data-sseg]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-sseg') === seg);
  });
  renderSubmissionsTable();
}

function setSubPage(p) {
  subPage = Math.max(1, Number(p || 1));
  renderSubmissionsTable();
}

async function batchApproveSubmissions() {
  const ready = cacheSubmissions.filter(x => x.status === 'submitted' && x.submission_url);
  if (!ready.length) {
    showToast('No submitted pending assignments ready for batch approval.', true);
    return;
  }
  if (!confirm(`Approve and assign default score 90/100 to ${ready.length} submitted assignment(s)?`)) return;
  try {
    const res = await api('/api/admin/submissions/batch-approve', {
      method: 'POST',
      body: JSON.stringify({ defaultScore: 90 })
    });
    showToast(res.message || `Approved ${res.approvedCount || 0} submissions.`);
    await loadSubmissionsView();
  } catch (err) {
    showToast(err.message, true);
  }
}

function exportSubmissionsCsv() {
  if (!cacheSubmissions.length) {
    showToast('No submission records to export.', true);
    return;
  }
  const cols = ['Student ID', 'Student Name', 'Student Email', 'Assignment Title', 'Track', 'Status', 'Score', 'Max Score', 'Submission URL', 'Feedback', 'Submitted At'];
  const escCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.map(escCsv).join(',')].concat(cacheSubmissions.map(x => [
    x.student_id || '',
    x.studentName || '',
    x.studentEmail || '',
    x.title || '',
    x.track || '',
    x.status || 'pending',
    x.score ?? '',
    x.max_score ?? 100,
    x.submission_url || '',
    x.feedback || '',
    x.submitted_at || ''
  ].map(escCsv).join(',')));

  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = 'pgi-submissions-grades.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
  showToast(`Exported ${cacheSubmissions.length} submission record(s).`);
}

function syncAttHoursDefault(st) {
  const el = $('att-hrs');
  if (!el) return;
  if (st === 'present') el.value = '3.0';
  else if (st === 'late') el.value = '2.0';
  else el.value = '0';
}

function renderAttendanceTable() {
  const tbody = $('att-tbody');
  if (!tbody) return;
  const q = ($('f-att-q')?.value || '').trim().toLowerCase();
  const st = ($('f-att-status')?.value || '').toLowerCase();

  const list = cacheAttendance.map((r, idx) => ({ r, idx })).filter(({ r }) => {
    if (st && String(r.status || '').toLowerCase() !== st) return false;
    if (q) {
      const hay = [r.student_id, r.session_title, r.remarks, r.mode].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!list.length) {
    tbody.innerHTML = emptyTableRow(8, 'No attendance records found yet.');
    return;
  }

  tbody.innerHTML = list.map(({ r, idx }) => `
    <tr>
      <td><strong style="font-family:'JetBrains Mono',monospace;">${escHtml(r.student_id)}</strong></td>
      <td>Day ${escHtml(r.day_number)}<br><span style="font-size:0.86rem;color:var(--adm-muted);">${escHtml(r.date || '—')}</span></td>
      <td>${escHtml(r.session_title || 'Cohort Session')}</td>
      <td>${pillBadge(r.mode || 'Online', 'blue')}</td>
      <td><strong>${Number(r.hours_logged || 0).toFixed(1)}h</strong></td>
      <td>${pillBadge(r.status || 'present')}</td>
      <td style="font-size:0.88rem;color:var(--adm-slate);">${escHtml(r.remarks || '—')}</td>
      <td><button type="button" class="btn btn-outline btn-sm" onclick="prefillAttendanceRow(${idx})">Edit</button></td>
    </tr>`).join('');
}

function prefillAttendanceRow(idx) {
  const r = cacheAttendance[idx];
  if (!r) return;
  if ($('att-sid')) $('att-sid').value = r.student_id || '';
  if ($('att-day')) $('att-day').value = r.day_number || 1;
  if ($('att-date') && r.date) $('att-date').value = r.date;
  if ($('att-status')) $('att-status').value = r.status || 'present';
  if ($('att-mode')) $('att-mode').value = r.mode || 'Online';
  if ($('att-hrs')) $('att-hrs').value = r.hours_logged ?? 3.0;
  if ($('att-title')) $('att-title').value = r.session_title || '';
  if ($('att-remarks')) $('att-remarks').value = r.remarks || '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitAttendanceForm() {
  const payload = {
    studentId: ($('att-sid')?.value || '').trim().toUpperCase(),
    dayNumber: Number($('att-day')?.value || 1),
    date: $('att-date')?.value || undefined,
    status: $('att-status')?.value || 'present',
    mode: $('att-mode')?.value || 'Online',
    hoursLogged: Number($('att-hrs')?.value || 0),
    sessionTitle: ($('att-title')?.value || '').trim() || undefined,
    remarks: ($('att-remarks')?.value || '').trim() || undefined
  };
  try {
    await api('/api/admin/attendance', { method: 'POST', body: JSON.stringify(payload) });
    showToast(`Saved Day ${payload.dayNumber} attendance for ${payload.studentId}.`);
    await loadSubmissionsView();
  } catch (err) {
    showToast(err.message, true);
  }
}

function parseSubmissionMeta(rawNotes) {
  if (!rawNotes) return { meta: null, text: '' };
  const str = String(rawNotes).trim();
  if (str.startsWith('{')) {
    try {
      const m = JSON.parse(str);
      if (m && m.__pgiMeta) return { meta: m, text: m.notes || '' };
    } catch {}
  }
  return { meta: null, text: str };
}

function shortLinkLabel(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url;
  }
}

function renderSubmissionsTable() {
  const tbody = $('sub-tbody');
  const foot = $('sub-table-foot');
  if (!tbody) return;

  const q = ($('f-sub-q')?.value || '').trim().toLowerCase();
  const track = $('f-sub-track')?.value || '';

  const rows = cacheSubmissions.map((item, idx) => ({ item, idx })).filter(({ item }) => {
    if (subSegment === 'submitted' && item.status !== 'submitted') return false;
    if (subSegment === 'reviewed' && item.status !== 'reviewed') return false;
    if (subSegment === 'pending' && ['submitted', 'reviewed'].includes(item.status)) return false;
    if (track && item.track !== track) return false;
    if (q) {
      const hay = [item.studentName, item.studentEmail, item.student_id, item.title, item.track, item.submission_url, item.submission_notes]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / SUB_PAGE_SIZE));
  if (subPage > totalPages) subPage = totalPages;

  if (!total) {
    tbody.innerHTML = emptyTableRow(5, 'No matching assignment submissions found.');
    if (foot) foot.innerHTML = '<span>Showing 0 submissions</span><span></span>';
    return;
  }

  const startIdx = (subPage - 1) * SUB_PAGE_SIZE;
  const pageRows = rows.slice(startIdx, startIdx + SUB_PAGE_SIZE);

  tbody.innerHTML = pageRows.map(({ item, idx }) => {
    const repoHref = safeHref(item.submission_url);
    const { meta, text: noteText } = parseSubmissionMeta(item.submission_notes);
    const demoHref = meta?.demoUrl ? safeHref(meta.demoUrl) : '#';
    const isReviewed = item.status === 'reviewed';
    const isSubmitted = item.status === 'submitted';

    const avatarStyle = isReviewed || isSubmitted
      ? 'background:var(--adm-green);color:#fff;border-radius:8px;'
      : (meta?.isDraft ? 'background:#FEF3C7;color:#92400E;border-radius:8px;' : 'background:#EEF2FA;color:#334155;border-radius:8px;');

    let evalCard = '<span class="adm-integrity-box flag-amber">AWAITING UPLOAD</span>';
    if (isReviewed) {
      evalCard = `<span class="adm-integrity-box flag-green">&#10003; GRADED: ${escHtml(item.score ?? 0)} / ${escHtml(item.max_score || 100)}</span>`;
    } else if (isSubmitted) {
      evalCard = `<span class="adm-integrity-box flag-amber">&bull; READY FOR REVIEW</span>`;
    } else if (meta?.isDraft) {
      evalCard = `<span class="adm-integrity-box flag-amber">&#9719; DRAFT SAVED</span>`;
    }

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;min-width:190px;">
            <span class="adm-act-ini" style="width:34px;height:34px;font-size:0.84rem;${avatarStyle}">${escHtml(getInitials(item.studentName || 'ST'))}</span>
            <div style="min-width:0;">
              <strong style="display:block;color:var(--adm-navy);">${escHtml(item.studentName || 'Student')}</strong>
              <span style="font-family:'JetBrains Mono',monospace;font-size:0.82rem;color:var(--adm-muted);">${escHtml(item.student_id || '')}${item.student_id && item.studentEmail ? ' · ' : ''}${escHtml(item.studentEmail || '')}</span>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight:700;color:var(--adm-navy);">${escHtml(item.title || 'Module Assignment')}</div>
          <div style="font-size:0.86rem;color:var(--adm-muted);margin-top:2px;">${escHtml(item.track || 'Track')} &bull; ${item.submitted_at ? 'Submitted ' + fmtDate(item.submitted_at, true) : 'Due ' + fmtDate(item.due_date)}</div>
        </td>
        <td>
          <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-start;">
            ${repoHref !== '#'
              ? `<a href="${repoHref}" target="_blank" rel="noopener noreferrer" class="adm-asset-chip">&lt;/&gt; ${escHtml(shortLinkLabel(item.submission_url))}</a>`
              : '<span style="font-size:0.86rem;color:var(--adm-muted);">No repository link</span>'}
            ${demoHref !== '#'
              ? `<a href="${demoHref}" target="_blank" rel="noopener noreferrer" class="adm-asset-chip">&#127760; ${escHtml(shortLinkLabel(meta.demoUrl))}</a>`
              : ''}
            ${meta?.branch || meta?.commitRef || noteText
              ? `<div style="font-size:0.84rem;color:var(--adm-slate);">${meta?.branch ? `Branch: <code>${escHtml(meta.branch)}</code> ` : ''}${meta?.commitRef ? `Commit: <code>${escHtml(meta.commitRef)}</code> ` : ''}${escHtml(noteText)}</div>`
              : ''}
          </div>
        </td>
        <td>
          <div>${evalCard}</div>
          ${item.feedback ? `<div style="font-size:0.84rem;color:var(--adm-blue);margin-top:4px;max-width:220px;">${escHtml(item.feedback)}</div>` : ''}
        </td>
        <td>
          <button type="button" class="btn ${isSubmitted ? 'btn-green' : 'btn-outline'} btn-sm" onclick="openSubmissionModal(${idx})">
            ${isReviewed ? 'Edit Grade' : 'Review'}
          </button>
        </td>
      </tr>`;
  }).join('');

  if (foot) {
    const fromN = startIdx + 1;
    const toN = startIdx + pageRows.length;
    const pageButtons = Array.from({ length: totalPages }, (_, i) => i + 1)
      .slice(Math.max(0, subPage - 3), Math.min(totalPages, subPage + 2))
      .map(p => `<button type="button" class="adm-page-btn${p === subPage ? ' active' : ''}" onclick="setSubPage(${p})">${p}</button>`)
      .join('');
    foot.innerHTML = `
      <span>Showing <strong>${fromN}&ndash;${toN}</strong> of <strong>${total}</strong> submission${total === 1 ? '' : 's'}</span>
      <div class="adm-pager">
        <button type="button" class="adm-page-btn" ${subPage <= 1 ? 'disabled' : ''} onclick="setSubPage(${subPage - 1})">Previous</button>
        ${pageButtons}
        <button type="button" class="adm-page-btn" ${subPage >= totalPages ? 'disabled' : ''} onclick="setSubPage(${subPage + 1})">Next</button>
      </div>`;
  }
}

function openSubmissionModal(idx) {
  const item = cacheSubmissions[idx];
  if (!item) return;
  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div>
        <h3 style="margin:0;font-family:'Space Grotesk',sans-serif;">Review Submission</h3>
        <div style="font-size:0.9rem;color:var(--adm-muted);">${escHtml(item.studentName)} · ${escHtml(item.title)}</div>
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
    </div>
    <form onsubmit="event.preventDefault(); submitSubmissionReview(${idx});">
      <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
        <div>
          <label class="f-lbl" for="rev-status">Review Status</label>
          <select id="rev-status" class="f-ctrl">
            <option value="reviewed"${item.status === 'reviewed' ? ' selected' : ''}>Reviewed (Graded)</option>
            <option value="submitted"${item.status === 'submitted' ? ' selected' : ''}>Submitted (Keep Pending)</option>
            <option value="pending"${item.status === 'pending' ? ' selected' : ''}>Pending Re-upload</option>
          </select>
        </div>
        <div>
          <label class="f-lbl" for="rev-score">Score (0–${escHtml(item.max_score || 100)})</label>
          <input id="rev-score" class="f-ctrl" type="number" min="0" max="100" value="${item.score ?? 90}">
        </div>
      </div>
      <label class="f-lbl" for="rev-feedback">Mentor Feedback</label>
      <textarea id="rev-feedback" class="f-ctrl" rows="3" placeholder="Constructive review notes for intern...">${escHtml(item.feedback || '')}</textarea>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-green">Save Review &amp; Score</button>
      </div>
    </form>`);
}

async function submitSubmissionReview(idx) {
  const item = cacheSubmissions[idx];
  if (!item) return;
  try {
    await api(`/api/admin/submissions/${encodeURIComponent(item.id)}/review`, {
      method: 'POST',
      body: JSON.stringify({
        status: $('rev-status')?.value || 'reviewed',
        score: $('rev-score')?.value,
        feedback: $('rev-feedback')?.value || ''
      })
    });
    showToast(`Saved grade for ${item.studentName}.`);
    closeModal();
    if (curTab === 'overview') await loadOverview();
    else await loadSubmissionsView();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ----------------------------------------------------------------------------
// VIEW 5: Certificates & Issuance (Stitch Credential Console + 30h Gate)
// ----------------------------------------------------------------------------
let certSegment = 'all';
let certPage = 1;
const CERT_PAGE_SIZE = 8;
let cacheCertRows = [];

function buildCertRegistryRows(certs, students) {
  const certBySid = new Map();
  for (const c of (certs || [])) {
    if (c.student_id) certBySid.set(String(c.student_id).toUpperCase(), c);
  }
  const seenSids = new Set();
  const rows = [];

  for (const c of (certs || [])) {
    const sid = String(c.student_id || '').toUpperCase();
    seenSids.add(sid);
    rows.push({
      kind: 'issued',
      studentId: c.student_id || sid,
      name: c.student_name || 'Student',
      domain: c.domain || 'Winter Internship Program',
      college: c.college || '—',
      mode: c.mode || 'Online (30 Hours)',
      hours: Number(c.completed_hours ?? 30),
      attPct: Number(c.attendance_percentage ?? 100),
      score: null,
      certId: c.certificate_id,
      issuedAt: c.issued_at,
      verifyUrl: c.verification_url || ''
    });
  }

  for (const s of (students || [])) {
    const sid = String(s.studentId || '').toUpperCase();
    if (!sid || seenSids.has(sid)) continue;
    seenSids.add(sid);
    const att = s.attendance || { completedHours: 0, percentage: 0, meetsCriteria: false };
    rows.push({
      kind: att.meetsCriteria ? 'ready' : 'pending',
      studentId: s.studentId,
      name: s.name || 'Candidate',
      domain: s.domainName || 'Winter Internship Program',
      college: s.college || '—',
      mode: String(s.mode || '').toLowerCase() === 'offline' ? 'Offline (30 Hours)' : 'Online (30 Hours)',
      hours: Number(att.completedHours || 0),
      attPct: Number(att.percentage || 0),
      score: s.score ?? null,
      certId: null,
      issuedAt: null,
      verifyUrl: ''
    });
  }

  const order = { ready: 0, issued: 1, pending: 2 };
  rows.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  return rows;
}

async function loadCertificates() {
  const [certs, students] = await Promise.all([
    api('/api/admin/certificates'),
    cacheStudents.length ? Promise.resolve(cacheStudents) : api('/api/admin/students').catch(() => [])
  ]);
  cacheCertificates = Array.isArray(certs) ? certs : [];
  if (Array.isArray(students)) cacheStudents = students;

  cacheCertRows = buildCertRegistryRows(cacheCertificates, cacheStudents);
  certPage = 1;

  const issuedCnt = cacheCertRows.filter(r => r.kind === 'issued').length;
  const readyCnt = cacheCertRows.filter(r => r.kind === 'ready').length;
  const pendingCnt = cacheCertRows.filter(r => r.kind === 'pending').length;
  const eligibleTotal = issuedCnt + readyCnt;
  const tracks = [...new Set(cacheCertRows.map(r => r.domain).filter(Boolean))].sort();
  const preSid = window.__prefillCertSid || '';
  window.__prefillCertSid = '';

  $('admin-view').innerHTML = `
    <div class="adm-stu-hero">
      <div>
        <div>
          <span class="adm-hero-pill">CERTIFICATION ENGINE // 30H &amp; 75% GATE</span>
          <span class="adm-sync-note">&bull; Winter Cohort 2026 Registry</span>
        </div>
        <h2>Certificates &amp; Issuance</h2>
        <p>Enforce 30-hour &amp; &ge;75% attendance gates, issue signed PDF credentials, and dispatch directly to student portals.</p>
      </div>
      <div class="adm-hero-actions">
        <button type="button" class="btn btn-outline btn-sm" onclick="openSingleCertModal('')">
          + Generate Single Certificate
        </button>
        <button type="button" class="btn btn-green btn-sm" ${readyCnt === 0 ? 'disabled style="opacity:0.55;cursor:not-allowed;"' : ''} onclick="batchDispatchCertificates()">
          Batch Dispatch Eligible (${readyCnt})
        </button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard('TOTAL ELIGIBLE', String(eligibleTotal), `${cacheCertRows.length ? Math.round((eligibleTotal / cacheCertRows.length) * 100) : 0}% meet 30h / >=75% gate`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>', 'blue')}
      ${kpiCard('ISSUED & DISPATCHED', String(issuedCnt), 'Live on student portals with QR seal', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>', 'green')}
      ${kpiCard('AWAITING APPROVAL', String(readyCnt), `${pendingCnt} fellow(s) still logging 30h`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><polyline points="9 12 11 14 15 10"/></svg>', 'blue')}
      ${kpiCard('GATE COMPLIANCE', '100%', 'Strict 30.0h & >=75% enforcement', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>', 'green')}
    </div>

    <div class="adm-seg-bar">
      <div class="adm-seg-pills" role="group" aria-label="Certificate filters">
        <button type="button" class="adm-seg-pill${certSegment === 'all' ? ' active' : ''}" data-cseg="all" onclick="setCertSegment('all')">All (${cacheCertRows.length})</button>
        <button type="button" class="adm-seg-pill${certSegment === 'ready' ? ' active' : ''}" data-cseg="ready" onclick="setCertSegment('ready')">Ready to Dispatch (${readyCnt})</button>
        <button type="button" class="adm-seg-pill${certSegment === 'issued' ? ' active' : ''}" data-cseg="issued" onclick="setCertSegment('issued')">Dispatched (${issuedCnt})</button>
        <button type="button" class="adm-seg-pill${certSegment === 'pending' ? ' active' : ''}" data-cseg="pending" onclick="setCertSegment('pending')">Hours Pending (${pendingCnt})</button>
      </div>
      <div class="adm-seg-controls" style="flex:1 1 320px;justify-content:flex-end;">
        <input id="f-cert-q" class="adm-seg-select" style="flex:1 1 170px;background:#fff;" type="search" placeholder="Search student name, UID, cert #..." oninput="certPage=1; renderCertificatesTable()">
        <select id="f-cert-track" class="adm-seg-select" aria-label="Filter by track" onchange="certPage=1; renderCertificatesTable()">
          <option value="">All Cohort Tracks</option>
          ${tracks.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-outline btn-sm" onclick="exportCertificatesCsv()">Export Issuance Registry</button>
      </div>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Student / Fellow</th>
            <th>Completion &amp; Gate</th>
            <th>Certificate Number</th>
            <th>Verification</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="cert-tbody"></tbody>
      </table>
      <div id="cert-table-foot" class="adm-table-foot"></div>
    </div>

    <div class="adm-grid-2" style="margin-top:18px;">
      <section class="adm-panel">
        <div class="adm-panel-head">
          <h3>Certificate Template &amp; Signatory Config</h3>
          <span class="pill gray">PDFKIT LANDSCAPE</span>
        </div>
        <div style="display:flex;gap:16px;align-items:stretch;flex-wrap:wrap;">
          <div style="width:136px;min-height:170px;border:2px solid #D8E2EC;border-radius:10px;background:linear-gradient(180deg,#F5FAFF 0%,#FFFFFF 100%);padding:12px 10px;display:flex;flex-direction:column;justify-content:space-between;text-align:center;flex-shrink:0;">
            <div style="font-size:0.56rem;font-weight:800;letter-spacing:0.08em;color:var(--adm-green);">PGI ACADEMY</div>
            <div>
              <div style="font-size:0.62rem;font-weight:800;color:var(--adm-navy);">CERTIFICATE</div>
              <div style="font-size:0.52rem;color:var(--adm-muted);">OF INTERNSHIP</div>
              <div style="margin:8px 0 4px;border-top:1px solid #E2E8F0;padding-top:6px;font-size:0.58rem;font-weight:700;">[Candidate Name]</div>
            </div>
            <div style="font-size:0.5rem;color:var(--adm-green);font-weight:700;">&#9733; VERIFIED SEAL &#9733;</div>
          </div>
          <div style="flex:1 1 220px;min-width:0;">
            <span style="font-size:0.76rem;font-weight:800;letter-spacing:0.06em;color:var(--adm-green);">ACTIVE PDF LAYOUT</span>
            <h4 style="margin:2px 0 6px;font-family:'Space Grotesk',sans-serif;font-size:1rem;">Winter 2026 Verified Landscape Certificate</h4>
            <p style="margin:0 0 10px;font-size:0.88rem;color:var(--adm-slate);line-height:1.45;">Structured PDFKit credential with attendance hours summary, official PGI verification seal, and public verification URL.</p>
            <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:9px;padding:9px 11px;font-size:0.86rem;">
              <div style="font-size:0.76rem;font-weight:800;color:var(--adm-muted);margin-bottom:3px;">AUTHORIZED SIGNATORIES ON PDF</div>
              <div><strong>Dr. K. Ravindran</strong> &bull; Lead Academic Architect</div>
              <div style="color:var(--adm-slate);"><strong>Director of Operations</strong> &bull; Executive Governing Board</div>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">
          <button type="button" class="btn btn-outline btn-sm" onclick="openSingleCertModal('')">Verify Candidate 30h Gate</button>
          <button type="button" class="btn btn-green btn-sm" onclick="openSingleCertModal('')">Issue Credential PDF</button>
        </div>
      </section>

      <section class="adm-panel">
        <div class="adm-panel-head">
          <h3>Direct Student Portal Delivery Status</h3>
          <span style="font-size:0.82rem;font-weight:800;color:var(--adm-green);">&bull; PORTAL SYNC</span>
        </div>
        <p style="margin:0 0 12px;font-size:0.9rem;color:var(--adm-slate);">Once issued, certificates unlock immediately on the student's dashboard under <strong>Certificates</strong> with instant PDF download and verification URLs.</p>
        <div style="font-size:0.76rem;font-weight:800;letter-spacing:0.06em;color:var(--adm-muted);margin-bottom:8px;">RECENTLY DISPATCHED CREDENTIALS</div>
        <div style="display:grid;gap:8px;">
          ${cacheCertificates.length ? cacheCertificates.slice(0, 3).map(c => `
            <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:9px;padding:9px 11px;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:0.88rem;">
              <span>&#9729; <strong>${escHtml(c.student_name)}</strong> (${escHtml(c.certificate_id)})</span>
              <span style="color:var(--adm-green);font-weight:700;">Issued ${fmtDate(c.issued_at)}</span>
            </div>`).join('') : `
            <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:9px;padding:12px;font-size:0.88rem;color:var(--adm-muted);">
              No credentials dispatched yet &mdash; log 30.0h attendance (&ge;75%) to unlock eligible fellows.
            </div>`}
        </div>
        <div style="margin-top:14px;text-align:right;">
          <button type="button" class="btn btn-outline btn-sm" onclick="showTab('settings', 'audit')">View complete issuance audit log &rarr;</button>
        </div>
      </section>
    </div>`;

  renderCertificatesTable();
  if (preSid) openSingleCertModal(preSid);
}

function setCertSegment(seg) {
  certSegment = seg;
  certPage = 1;
  document.querySelectorAll('.adm-seg-pill[data-cseg]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-cseg') === seg);
  });
  renderCertificatesTable();
}

function setCertPage(p) {
  certPage = Math.max(1, Number(p || 1));
  renderCertificatesTable();
}

function getFilteredCertRows() {
  const q = ($('f-cert-q')?.value || '').trim().toLowerCase();
  const track = $('f-cert-track')?.value || '';
  return cacheCertRows.map((r, idx) => ({ r, idx })).filter(({ r }) => {
    if (certSegment !== 'all' && r.kind !== certSegment) return false;
    if (track && r.domain !== track) return false;
    if (q) {
      const hay = [r.name, r.studentId, r.certId, r.domain, r.college].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderCertificatesTable() {
  const tbody = $('cert-tbody');
  const foot = $('cert-table-foot');
  if (!tbody) return;

  const rows = getFilteredCertRows();
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / CERT_PAGE_SIZE));
  if (certPage > totalPages) certPage = totalPages;

  if (!total) {
    tbody.innerHTML = emptyTableRow(6, 'No matching student credential records found.');
    if (foot) foot.innerHTML = '<span>Showing 0 credentials</span><span></span>';
    return;
  }

  const startIdx = (certPage - 1) * CERT_PAGE_SIZE;
  const pageRows = rows.slice(startIdx, startIdx + CERT_PAGE_SIZE);

  tbody.innerHTML = pageRows.map(({ r, idx }) => {
    const iniTone = r.kind === 'ready' || r.kind === 'issued'
      ? 'background:#DCFCE7;color:#166534;border-radius:8px;'
      : 'background:#EEF2FA;color:#334155;border-radius:8px;';

    let statusPill = '<span class="adm-dot-pill gray"><i></i>Hours Pending</span>';
    if (r.kind === 'ready') statusPill = '<span class="adm-dot-pill green"><i></i>Ready to Dispatch</span>';
    else if (r.kind === 'issued') statusPill = `<span class="adm-dot-pill gray"><i></i>Dispatched ${fmtDate(r.issuedAt)}</span>`;

    let actionBtns = `<button type="button" class="btn btn-outline btn-sm" onclick="openSingleCertModal('${escHtml(r.studentId)}')">Verify Gate</button>
                      <button type="button" class="btn btn-green btn-sm" onclick="window.__prefillStudentId='${escHtml(r.studentId)}'; showTab('submissions','attendance')">Log Att.</button>`;
    if (r.kind === 'ready') {
      actionBtns = `<button type="button" class="btn btn-green btn-sm" onclick="quickIssueCert(${idx})">Dispatch to Portal</button>
                    <button type="button" class="btn btn-outline btn-sm" onclick="openSingleCertModal('${escHtml(r.studentId)}')">Gate</button>`;
    } else if (r.kind === 'issued') {
      actionBtns = `<button type="button" class="btn btn-outline btn-sm" onclick="downloadCertPdfById('${escHtml(r.certId)}')">Download PDF</button>`;
    }

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;min-width:210px;">
            <span class="adm-act-ini" style="width:34px;height:34px;font-size:0.84rem;${iniTone}">${escHtml(getInitials(r.name))}</span>
            <div style="min-width:0;">
              <strong style="display:block;color:var(--adm-navy);">${escHtml(r.name)}</strong>
              <span style="font-size:0.84rem;color:var(--adm-muted);">UID: <code>${escHtml(r.studentId)}</code> &bull; ${escHtml(r.domain)}</span>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight:700;font-size:0.9rem;">${Number(r.hours || 0).toFixed(1)} / 30.0h (${Number(r.attPct || 0)}%)</div>
          <div style="font-size:0.84rem;color:var(--adm-muted);">${r.college && r.college !== '—' ? escHtml(r.college) : escHtml(r.mode)}</div>
        </td>
        <td>
          ${r.certId
            ? `<div style="display:inline-flex;align-items:center;gap:6px;">
                 <span class="adm-uid-chip">${escHtml(r.certId)}</span>
                 <button type="button" class="btn btn-outline btn-sm" style="padding:3px 7px;font-size:0.82rem;" onclick="copyCertId('${escHtml(r.certId)}')" title="Copy Certificate ID">Copy</button>
               </div>`
            : `<span style="font-size:0.86rem;color:var(--adm-muted);">Pending 30h issuance</span>`}
        </td>
        <td>
          ${r.kind === 'issued'
            ? `<span class="adm-dot-pill green"><i></i>Signed PDF</span>`
            : `<span class="adm-dot-pill gray"><i></i>30h / 75% Gate</span>`}
        </td>
        <td>${statusPill}</td>
        <td><div style="display:flex;gap:6px;flex-wrap:wrap;">${actionBtns}</div></td>
      </tr>`;
  }).join('');

  if (foot) {
    const fromN = startIdx + 1;
    const toN = startIdx + pageRows.length;
    const pageButtons = Array.from({ length: totalPages }, (_, i) => i + 1)
      .slice(Math.max(0, certPage - 3), Math.min(totalPages, certPage + 2))
      .map(p => `<button type="button" class="adm-page-btn${p === certPage ? ' active' : ''}" onclick="setCertPage(${p})">${p}</button>`)
      .join('');
    foot.innerHTML = `
      <span>Showing <strong>${fromN}&ndash;${toN}</strong> of <strong>${total}</strong> credential record${total === 1 ? '' : 's'}</span>
      <div class="adm-pager">
        <button type="button" class="adm-page-btn" ${certPage <= 1 ? 'disabled' : ''} onclick="setCertPage(${certPage - 1})">Previous</button>
        ${pageButtons}
        <button type="button" class="adm-page-btn" ${certPage >= totalPages ? 'disabled' : ''} onclick="setCertPage(${certPage + 1})">Next</button>
      </div>`;
  }
}

function openSingleCertModal(prefillSid = '') {
  const enrolledList = cacheStudents.filter(s => s.studentId);
  const stuSelectOpts = ['<option value="">-- Select Intern (optional) --</option>'].concat(
    enrolledList.map((s, i) => `<option value="${i}"${prefillSid && s.studentId === prefillSid ? ' selected' : ''}>${escHtml(s.studentId)} — ${escHtml(s.name)} (${escHtml(s.domainName || '')})</option>`)
  ).join('');

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div>
        <span class="adm-hero-pill">30H &amp; 75% GATE VERIFIER</span>
        <h3 style="margin:4px 0 0;font-family:'Space Grotesk',sans-serif;">Generate &amp; Issue Certificate PDF</h3>
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
    </div>

    <label class="f-lbl" for="cert-pick-stu">Auto-fill from Cohort Roster</label>
    <select id="cert-pick-stu" class="f-ctrl" onchange="fillCertificateStudent(this.value)">
      ${stuSelectOpts}
    </select>

    <form onsubmit="event.preventDefault(); issueCertificateSubmit();">
      <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
        <div><label class="f-lbl" for="cert-sid">Student ID *</label><input id="cert-sid" class="f-ctrl" type="text" placeholder="PGI-S26-1001" required></div>
        <div><label class="f-lbl" for="cert-name">Student Full Name *</label><input id="cert-name" class="f-ctrl" type="text" placeholder="Candidate Full Name" required></div>
        <div><label class="f-lbl" for="cert-domain">Domain / Track</label><input id="cert-domain" class="f-ctrl" type="text" placeholder="Web Development"></div>
        <div><label class="f-lbl" for="cert-college">College / Institution</label><input id="cert-college" class="f-ctrl" type="text" placeholder="Institution Name"></div>
      </div>
      <label class="f-lbl" for="cert-mode">Training Mode</label>
      <select id="cert-mode" class="f-ctrl" onchange="if(($('cert-sid')?.value || '').trim()) checkCertEligibility();">
        <option value="Online (30 Hours)">Online (30 Hours)</option>
        <option value="Offline (30 Hours)">Offline (30 Hours)</option>
        <option value="Completed Offline (30 Hours)">Completed Offline (30 Hours)</option>
      </select>
      <div id="cert-gate-result" style="margin-bottom:12px;"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
        <button type="button" class="btn btn-outline" onclick="checkCertEligibility()">Check 30h / 75% Gate</button>
        <button type="submit" class="btn btn-green">Issue &amp; Dispatch Certificate</button>
      </div>
    </form>`);

  if (prefillSid) {
    const idx = enrolledList.findIndex(s => s.studentId === prefillSid);
    if (idx >= 0) fillCertificateStudent(String(idx));
  }
}

async function quickIssueCert(rowIdx) {
  const r = cacheCertRows[rowIdx];
  if (!r) return;
  try {
    const res = await api('/api/admin/certificates/issue', {
      method: 'POST',
      body: JSON.stringify({
        studentId: r.studentId,
        studentName: r.name,
        domain: r.domain,
        college: r.college,
        mode: r.mode
      })
    });
    showToast(`Issued & dispatched ${res.certificate?.certificate_id || ''} to ${r.name}.`);
    await loadCertificates();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function batchDispatchCertificates() {
  const ready = cacheCertRows.filter(r => r.kind === 'ready');
  if (!ready.length) {
    showToast('No pending fellows have completed the 30h & 75% gate yet.', true);
    return;
  }
  if (!confirm(`Issue and dispatch signed PDF certificates to ${ready.length} eligible fellow(s)?`)) return;
  let issued = 0;
  for (const r of ready) {
    try {
      await api('/api/admin/certificates/issue', {
        method: 'POST',
        body: JSON.stringify({
          studentId: r.studentId,
          studentName: r.name,
          domain: r.domain,
          college: r.college,
          mode: r.mode
        })
      });
      issued++;
    } catch (err) {
      showToast(`${r.studentId}: ${err.message}`, true);
    }
  }
  showToast(`Dispatched ${issued} certificate(s) to student portals.`);
  await loadCertificates();
}

function copyCertId(certId) {
  if (!certId) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(certId).then(() => showToast(`Copied ${certId}`)).catch(() => showToast(certId));
  } else {
    showToast(`Certificate ID: ${certId}`);
  }
}

function exportCertificatesCsv() {
  const rows = getFilteredCertRows().map(({ r }) => r);
  if (!rows.length) {
    showToast('No certificate registry rows to export.', true);
    return;
  }
  const cols = ['Student ID', 'Name', 'Domain Track', 'College', 'Mode', 'Completed Hours', 'Attendance (%)', 'Gate Status', 'Certificate ID', 'Issued At'];
  const escCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.map(escCsv).join(',')].concat(rows.map(r => [
    r.studentId,
    r.name,
    r.domain,
    r.college,
    r.mode,
    r.hours,
    r.attPct,
    r.kind,
    r.certId || '',
    r.issuedAt || ''
  ].map(escCsv).join(',')));

  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = 'pgi-certificates-registry.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
  showToast(`Exported ${rows.length} credential record(s).`);
}

function fillCertificateStudent(indexStr) {
  if (indexStr === '') return;
  const enrolledList = cacheStudents.filter(s => s.studentId);
  const s = enrolledList[Number(indexStr)];
  if (!s) return;
  if ($('cert-sid')) $('cert-sid').value = s.studentId || '';
  if ($('cert-name')) $('cert-name').value = s.name || '';
  if ($('cert-domain')) $('cert-domain').value = s.domainName || '';
  if ($('cert-college')) $('cert-college').value = s.college || '';
  if ($('cert-mode')) $('cert-mode').value = String(s.mode || '').toLowerCase() === 'offline' ? 'Offline (30 Hours)' : 'Online (30 Hours)';
  checkCertEligibility();
}

async function checkCertEligibility() {
  const sid = ($('cert-sid')?.value || '').trim().toUpperCase();
  const mode = ($('cert-mode')?.value || 'Online (30 Hours)').trim();
  const box = $('cert-gate-result');
  if (!sid) {
    showToast('Enter a Student ID first.', true);
    return;
  }
  if (box) box.innerHTML = '<div style="font-size:0.9rem;color:var(--adm-muted);">Checking attendance logs...</div>';
  try {
    const r = await api(`/api/admin/certificates/eligibility/${encodeURIComponent(sid)}?mode=${encodeURIComponent(mode)}`);
    const ok = Boolean(r.eligible);
    const offlineVerified = Boolean(r.completedOffline);
    if (box) {
      box.innerHTML = `
        <div style="border:1px solid ${ok ? '#A7F3D0' : '#FECACA'};background:${ok ? '#ECFDF5' : '#FEF2F2'};border-radius:10px;padding:10px 12px;font-size:0.92rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:8px;flex-wrap:wrap;">
            <strong style="color:${ok ? 'var(--adm-green)' : '#991B1B'};">${offlineVerified ? 'Eligible via Completed Offline Mode' : (ok ? 'Eligible for Official Certificate' : 'Gate Requirements Not Yet Met')}</strong>
            ${pillBadge(`${Number(r.completedHours || 0).toFixed(1)}/30h · ${r.attendancePercentage ?? 0}%`, ok ? 'green' : 'red')}
          </div>
          <div style="color:var(--adm-slate);">${offlineVerified ? 'Completed Offline (30 Hours) selected — portal attendance gate bypassed for direct certificate issuance.' : `Present ${r.presentDays ?? 0}/${r.totalDays ?? 0} days · Min 30.0h &amp; 75% required`}</div>
        </div>`;
    }
  } catch (err) {
    if (box) box.innerHTML = `<div style="color:var(--adm-red);font-size:0.9rem;">${escHtml(err.message)}</div>`;
  }
}

async function issueCertificateSubmit() {
  const payload = {
    studentId: ($('cert-sid')?.value || '').trim().toUpperCase(),
    studentName: ($('cert-name')?.value || '').trim(),
    domain: ($('cert-domain')?.value || '').trim() || 'Winter Internship Program',
    college: ($('cert-college')?.value || '').trim() || '—',
    mode: $('cert-mode')?.value || 'Online (30 Hours)'
  };
  try {
    const res = await api('/api/admin/certificates/issue', { method: 'POST', body: JSON.stringify(payload) });
    showToast(`Issued certificate ${res.certificate?.certificate_id || ''}.`);
    closeModal();
    await loadCertificates();
  } catch (err) {
    showToast(err.message, true);
  }
}

function downloadCertPdfById(certId) {
  if (!certId) return;
  downloadWithAuth(`/api/admin/certificates/${encodeURIComponent(certId)}/download.pdf`, `${certId}.pdf`);
}

// ----------------------------------------------------------------------------
// VIEW 6: Modules & Curriculum + Cohort Batches (Stitch Course Engine)
// ----------------------------------------------------------------------------
let currTrackId = 'tech-web';
let currSegment = 'all';
let currFocusDay = 1;

async function loadCurriculumView() {
  const sub = curSubTab.curriculum || 'syllabus';
  const tabsHtml = renderSubTabs('curriculum', [
    { key: 'syllabus', label: '30-Hour Syllabus & Modules' },
    { key: 'videos', label: 'Recorded Videos (YouTube)' },
    { key: 'batches', label: 'Cohort Batches & Schedule' }
  ]);

  if (sub === 'videos') {
    const videos = await api('/api/admin/videos').catch(() => []);
    cacheVideos = Array.isArray(videos) ? videos : [];
    const allTrackCnt = cacheVideos.filter(v => !v.track || v.track === 'all').length;
    const trackSpecificCnt = cacheVideos.length - allTrackCnt;
    const latestVid = cacheVideos[0] || null;

    $('admin-view').innerHTML = `
      <div class="adm-stu-hero">
        <div>
          <div>
            <span class="adm-hero-pill">VIDEO LIBRARY // YOUTUBE LECTURE LINKS</span>
            <span class="adm-sync-note">&bull; Published to Student Portal</span>
          </div>
          <h2>Recorded Videos</h2>
          <p>Add recorded class sessions via YouTube links. Students see matching track videos automatically under Recorded Videos.</p>
        </div>
        <div class="adm-hero-actions">
          <button type="button" class="btn btn-outline btn-sm" onclick="refreshCurrentTab()">Refresh</button>
          <button type="button" class="btn btn-green btn-sm" onclick="openAddVideoModal()">+ Add Recorded Video</button>
        </div>
      </div>

      ${tabsHtml}

      <div class="kpi-grid">
        ${kpiCard('TOTAL VIDEOS', String(cacheVideos.length), 'YouTube recordings published', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>', 'green')}
        ${kpiCard('ALL-TRACK ACCESS', String(allTrackCnt), 'Visible to every enrolled fellow', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg>', 'blue')}
        ${kpiCard('TRACK-SPECIFIC', String(trackSpecificCnt), 'Targeted to single domain tracks', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/></svg>', 'blue')}
        ${kpiCard('LATEST UPLOAD', latestVid ? (latestVid.session_number || 'NEW') : 'NONE', latestVid ? escHtml(latestVid.title) : 'Upload your first YouTube lecture', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', 'green')}
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Preview &amp; Title</th>
              <th>Track &amp; Mode</th>
              <th>Session &amp; Instructor</th>
              <th>Uploaded</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${cacheVideos.length ? cacheVideos.map((v, idx) => `
              <tr>
                <td>
                  <div style="display:flex;align-items:center;gap:12px;min-width:260px;">
                    <a href="${safeHref(v.youtube_url)}" target="_blank" rel="noopener noreferrer" style="display:block;width:96px;height:54px;border-radius:8px;overflow:hidden;border:1px solid var(--adm-line);flex-shrink:0;background:#0F172A;">
                      ${v.thumbnail_url ? `<img src="${escHtml(v.thumbnail_url)}" alt="${escHtml(v.title)}" style="width:100%;height:100%;object-fit:cover;">` : ''}
                    </a>
                    <div style="min-width:0;">
                      <strong style="display:block;color:var(--adm-navy);">${escHtml(v.title)}</strong>
                      <div style="font-size:0.82rem;color:var(--adm-muted);">${escHtml(v.summary || v.youtube_id || '')}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div>${pillBadge(v.track === 'all' ? 'All Tracks' : v.track, v.track === 'all' ? 'green' : 'blue')}</div>
                  <div style="font-size:0.82rem;color:var(--adm-muted);margin-top:4px;">Mode: ${escHtml(v.mode === 'all' ? 'Online & Offline' : v.mode)}</div>
                </td>
                <td>
                  <strong style="font-size:0.88rem;">${escHtml(v.session_number || 'SESSION')}</strong>
                  <div style="font-size:0.82rem;color:var(--adm-muted);">${escHtml(v.duration || 'YouTube')} &bull; ${escHtml(v.instructor || 'Mentor')}</div>
                </td>
                <td style="font-size:0.84rem;white-space:nowrap;">${fmtDate(v.created_at)}</td>
                <td>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <a href="${safeHref(v.youtube_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm" style="text-decoration:none;">Open YouTube</a>
                    <button type="button" class="btn btn-danger btn-sm" onclick="deleteAdminVideo(${idx})">Delete</button>
                  </div>
                </td>
              </tr>`).join('') : emptyTableRow(5, 'No recorded videos uploaded yet. Click "+ Add Recorded Video" to attach a YouTube link.')}
          </tbody>
        </table>
      </div>`;
    return;
  }

  if (sub === 'batches') {
    cacheBatches = await api('/api/admin/batches');
    $('admin-view').innerHTML = `
      <div class="adm-stu-hero">
        <div>
          <div><span class="adm-hero-pill">COHORT SCHEDULING // LIVE BATCHES</span></div>
          <h2>Modules &amp; Curriculum</h2>
          <p>Manage active Winter Cohort 2026 batches, training mode capacities, and live session schedules.</p>
        </div>
        <div class="adm-hero-actions">
          <button type="button" class="btn btn-green btn-sm" onclick="openBatchModal(-1)">+ Create Batch</button>
        </div>
      </div>
      ${tabsHtml}
      <div class="adm-panel">
        <div class="adm-panel-head">
          <h3>Cohort Batches (${cacheBatches.length})</h3>
          <span class="pill blue">Online &amp; Offline Capacity Tracking</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Batch Name</th>
                <th>Schedule Dates</th>
                <th>Mode &amp; Timings</th>
                <th>Enrollment / Seats</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${cacheBatches.length ? cacheBatches.map((b, idx) => `
                <tr>
                  <td><strong>${escHtml(b.name)}</strong><div style="font-family:'JetBrains Mono',monospace;font-size:0.84rem;color:var(--adm-muted);">${escHtml(b.slug || '')}</div></td>
                  <td style="font-size:0.88rem;">${fmtDate(b.starts_on)} &rarr; ${fmtDate(b.ends_on)}</td>
                  <td>${pillBadge(b.mode || 'Hybrid', 'blue')}<div style="font-size:0.84rem;color:var(--adm-muted);margin-top:3px;">${escHtml(b.timings || 'Standard Cohort Timings')}</div></td>
                  <td><strong>${escHtml(b.enrolled_count ?? 0)} / ${escHtml(b.seats_limit ?? 40)}</strong> seats</td>
                  <td>${pillBadge(b.status || 'upcoming')}</td>
                  <td>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                      <button type="button" class="btn btn-outline btn-sm" onclick="openBatchModal(${idx})">Edit</button>
                      <button type="button" class="btn btn-outline btn-sm" onclick="toggleBatchStatus(${idx})">${b.status === 'active' ? 'Set Upcoming' : 'Set Active'}</button>
                    </div>
                  </td>
                </tr>`).join('') : emptyTableRow(6, 'No cohort batches created yet.')}
            </tbody>
          </table>
        </div>
      </div>`;
    return;
  }

  const [currData, batches] = await Promise.all([
    api('/api/admin/curriculum'),
    api('/api/admin/batches').catch(() => [])
  ]);
  cacheCurriculum = currData || { tracks: [], courses: [] };
  if (Array.isArray(batches)) cacheBatches = batches;

  const tracks = cacheCurriculum.tracks || [];
  const courses = cacheCurriculum.courses || [];
  const track = tracks.find(t => t.id === currTrackId) || tracks[0] || { id: 'tech-web', title: 'Track Syllabus', modules: [] };
  currTrackId = track.id;

  const mods = track.modules || [];
  const totalHours = mods.reduce((s, m) => s + Number(m.hours || 3), 0);
  const focusMod = mods.find(m => Number(m.day) === Number(currFocusDay)) || mods[0] || { day: 1, hours: 3, title: 'Module 01' };
  const focusPct = mods.length ? Math.round((Number(focusMod.day || 1) / mods.length) * 100) : 10;
  const activeBatches = cacheBatches.filter(b => b.status === 'active' || b.is_active);
  const totalSeats = cacheBatches.reduce((sum, b) => sum + Number(b.seats_limit || 40), 0);

  const fndCnt = mods.filter(m => Number(m.day) <= 4).length;
  const coreCnt = mods.filter(m => Number(m.day) >= 5 && Number(m.day) <= 8).length;
  const capCnt = mods.filter(m => Number(m.day) >= 9).length;

  $('admin-view').innerHTML = `
    <div class="adm-stu-hero">
      <div>
        <div>
          <span class="adm-hero-pill">CURRICULUM ENGINE // SYLLABUS &amp; 30H MODULES</span>
          <span class="adm-sync-note">&bull; Student Portal Synced</span>
        </div>
        <h2>Modules &amp; Curriculum</h2>
        <p>Manage 30-hour cohort syllabus structure, pacing milestones, recorded resources, and batch schedules.</p>
      </div>
      <div class="adm-hero-actions">
        <button type="button" class="btn btn-outline btn-sm" onclick="openAddVideoModal()">+ Add Recorded Video</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="openModuleModal(-1)">+ Add New Module</button>
        <a href="/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf" target="_blank" rel="noopener noreferrer" class="btn btn-green btn-sm" style="text-decoration:none;">
          Open Syllabus Handbook PDF &rarr;
        </a>
      </div>
    </div>

    ${tabsHtml}

    <div class="kpi-grid">
      ${kpiCard('TRACK MODULES', String(mods.length), `${totalHours} total contact hours (${track.domainType || 'Technical'})`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>', 'blue')}
      ${kpiCard('ACTIVE COHORT PACING', `Module ${String(focusMod.day).padStart(2, '0')}`, `Day ${focusMod.day} of ${mods.length} · ${focusPct}% sequence`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>', 'green', '', focusPct, '')}
      ${kpiCard('CURRICULUM TRACKS', String(tracks.length), `${courses.length} DB courses configured`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/></svg>', 'blue')}
      ${kpiCard('ACTIVE BATCHES', `${activeBatches.length} / ${cacheBatches.length}`, `${totalSeats} seats across cohort schedules`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>', 'green', "switchSubTab('curriculum','batches')")}
    </div>

    <div class="adm-seg-bar">
      <div class="adm-seg-pills" role="group" aria-label="Curriculum module segments">
        <button type="button" class="adm-seg-pill${currSegment === 'all' ? ' active' : ''}" data-mseg="all" onclick="setCurrSegment('all')">All Modules (${mods.length})</button>
        <button type="button" class="adm-seg-pill${currSegment === 'foundations' ? ' active' : ''}" data-mseg="foundations" onclick="setCurrSegment('foundations')">Foundations (${fndCnt})</button>
        <button type="button" class="adm-seg-pill${currSegment === 'core' ? ' active' : ''}" data-mseg="core" onclick="setCurrSegment('core')">Core Modules (${coreCnt})</button>
        <button type="button" class="adm-seg-pill${currSegment === 'capstone' ? ' active' : ''}" data-mseg="capstone" onclick="setCurrSegment('capstone')">Capstone (${capCnt})</button>
      </div>
      <div class="adm-seg-controls" style="flex:1 1 320px;justify-content:flex-end;">
        <input id="f-curr-q" class="adm-seg-select" style="flex:1 1 160px;background:#fff;" type="search" placeholder="Search module titles or topics..." oninput="renderCurriculumModules()">
        <select class="adm-seg-select" aria-label="Select track syllabus" onchange="selectCurrTrack(this.value)">
          ${tracks.map(t => `<option value="${escHtml(t.id)}"${t.id === track.id ? ' selected' : ''}>${escHtml(t.title)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div id="curr-modules-list" class="adm-mod-stack"></div>

    <div class="adm-grid-2">
      <section class="adm-panel">
        <div class="adm-panel-head">
          <h3>Cohort Batches &amp; Session Pacing</h3>
          <button type="button" class="btn btn-outline btn-sm" onclick="showTab('batches')">Manage Batches &rarr;</button>
        </div>
        <div style="display:grid;gap:9px;">
          ${cacheBatches.length ? cacheBatches.map(b => `
            <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
              <div>
                <strong style="font-size:0.92rem;">${escHtml(b.name)}</strong>
                <div style="font-size:0.84rem;color:var(--adm-muted);">${escHtml(b.timings || 'Online: 4-6 PM | Offline: 9 AM-6 PM')}</div>
              </div>
              <div style="text-align:right;">
                ${pillBadge(b.status || 'upcoming')}
                <div style="font-size:0.82rem;color:var(--adm-slate);margin-top:3px;">${escHtml(b.enrolled_count ?? 0)}/${escHtml(b.seats_limit ?? 60)} seats</div>
              </div>
            </div>`).join('') : '<p style="color:var(--adm-muted);font-size:0.92rem;">No batches configured yet.</p>'}
        </div>
      </section>

      <section class="adm-panel">
        <div class="adm-panel-head">
          <h3>Program Asset Catalog &amp; Classroom Links</h3>
          <span class="pill green">${courses.length} DB COURSES</span>
        </div>
        ${courses.length ? `
          <div style="display:grid;gap:9px;margin-bottom:12px;">
            ${courses.map(c => `
              <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
                <div style="min-width:0;">
                  <strong style="display:block;font-size:0.92rem;">${escHtml(c.title)}</strong>
                  <span style="font-size:0.84rem;color:var(--adm-muted);">${escHtml(c.domain_type || 'Track')} &bull; ${escHtml(c.duration || '30 Hours')}</span>
                </div>
                ${safeHref(c.access_url) !== '#' ? `<a href="${safeHref(c.access_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm" style="text-decoration:none;">Open Link</a>` : pillBadge('Synced', 'gray')}
              </div>`).join('')}
          </div>` : `<p style="color:var(--adm-muted);font-size:0.92rem;margin:0 0 12px;">All ${tracks.length} internship tracks map automatically to the official 30-hour syllabus handbook.</p>`}
        <a href="/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm" style="text-decoration:none;">
          Download Official 30-Hour Syllabus PDF
        </a>
      </section>
    </div>`;

  renderCurriculumModules();
}

function selectCurrTrack(trackId) {
  currTrackId = trackId;
  currFocusDay = 1;
  loadCurriculumView();
}

function setCurrSegment(seg) {
  currSegment = seg;
  document.querySelectorAll('.adm-seg-pill[data-mseg]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mseg') === seg);
  });
  renderCurriculumModules();
}

function setFocusedModule(dayNum) {
  currFocusDay = Number(dayNum || 1);
  loadCurriculumView();
}

function renderCurriculumModules() {
  const wrap = $('curr-modules-list');
  if (!wrap) return;
  const tracks = cacheCurriculum.tracks || [];
  const track = tracks.find(t => t.id === currTrackId) || tracks[0];
  const mods = track?.modules || [];
  const q = ($('f-curr-q')?.value || '').trim().toLowerCase();

  const filtered = mods.map((m, idx) => ({ m, idx })).filter(({ m }) => {
    const d = Number(m.day || 1);
    if (currSegment === 'foundations' && d > 4) return false;
    if (currSegment === 'core' && (d < 5 || d > 8)) return false;
    if (currSegment === 'capstone' && d < 9) return false;
    if (q) {
      const hay = [m.title, ...(m.topics || [])].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    wrap.innerHTML = '<div class="adm-panel" style="text-align:center;color:var(--adm-muted);">No matching syllabus modules found.</div>';
    return;
  }

  wrap.innerHTML = filtered.map(({ m, idx }) => {
    const d = Number(m.day || 1);
    const isFocus = d === Number(currFocusDay);
    const computedStatus = m.status || (d < currFocusDay ? 'completed' : (isFocus ? 'active' : 'scheduled'));
    const statusLabel = computedStatus === 'active'
      ? 'ACTIVE • IN PROGRESS'
      : (computedStatus === 'completed' ? 'COMPLETED • RELEASED' : `SCHEDULED • DAY ${String(d).padStart(2, '0')}`);

    return `
      <article class="adm-mod-card${isFocus ? ' is-focus' : ''}">
        <div class="adm-mod-num">
          <small>MOD</small>
          <span>${String(d).padStart(2, '0')}</span>
        </div>
        <div class="adm-mod-main">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            ${pillBadge(statusLabel, isFocus ? 'green' : (computedStatus === 'completed' ? 'blue' : 'gray'))}
            <span style="font-size:0.84rem;font-weight:700;color:var(--adm-muted);">${escHtml(m.hours || 3)}.0 Hours</span>
          </div>
          <strong style="display:block;font-size:0.98rem;color:var(--adm-navy);">${escHtml(m.title)}</strong>
          <div class="adm-mod-topic-bar">
            <strong style="font-size:0.78rem;letter-spacing:0.05em;color:var(--adm-slate);">KEY TOPICS:</strong>
            ${(m.topics || []).map(escHtml).join(' &bull; ')}
          </div>
        </div>
        <div class="adm-mod-actions">
          ${isFocus ? pillBadge('Cohort Focus', 'green') : `<button type="button" class="btn btn-outline btn-sm" onclick="setFocusedModule(${d})">Set Focus</button>`}
          <button type="button" class="btn ${isFocus ? 'btn-green' : 'btn-outline'} btn-sm" onclick="openModuleModal(${idx})">Edit Syllabus</button>
        </div>
      </article>`;
  }).join('');
}

function openModuleModal(modIdx) {
  const tracks = cacheCurriculum.tracks || [];
  const track = tracks.find(t => t.id === currTrackId) || tracks[0];
  const m = modIdx >= 0 && track?.modules?.[modIdx] ? track.modules[modIdx] : null;
  const nextDay = (track?.modules?.length || 0) + 1;

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div>
        <span class="adm-hero-pill">${escHtml(track?.title || 'TRACK SYLLABUS')}</span>
        <h3 style="margin:4px 0 0;font-family:'Space Grotesk',sans-serif;">${m ? `Edit Module ${String(m.day).padStart(2, '0')}` : 'Add Curriculum Module'}</h3>
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
    </div>
    <form onsubmit="event.preventDefault(); saveCurriculumModule(${modIdx});">
      <div class="adm-form-2col" style="display:grid;grid-template-columns:120px 120px 1fr;gap:10px;">
        <div><label class="f-lbl" for="mod-day">Day #</label><input id="mod-day" class="f-ctrl" type="number" min="1" max="30" value="${escHtml(m?.day ?? nextDay)}" required></div>
        <div><label class="f-lbl" for="mod-hrs">Hours</label><input id="mod-hrs" class="f-ctrl" type="number" min="0.5" max="12" step="0.5" value="${escHtml(m?.hours ?? 3)}" required></div>
        <div>
          <label class="f-lbl" for="mod-status">Status</label>
          <select id="mod-status" class="f-ctrl">
            <option value="">Auto Pacing</option>
            <option value="completed"${m?.status === 'completed' ? ' selected' : ''}>Completed / Released</option>
            <option value="active"${m?.status === 'active' ? ' selected' : ''}>Active / In Progress</option>
            <option value="scheduled"${m?.status === 'scheduled' ? ' selected' : ''}>Scheduled</option>
          </select>
        </div>
      </div>
      <label class="f-lbl" for="mod-title">Module Title *</label>
      <input id="mod-title" class="f-ctrl" type="text" value="${escHtml(m?.title || '')}" placeholder="e.g. REST APIs & Security Headers" required>
      <label class="f-lbl" for="mod-topics">Key Topics &amp; Lab Goals (comma separated)</label>
      <textarea id="mod-topics" class="f-ctrl" rows="3" placeholder="Topic 1, Topic 2, Lab objective">${escHtml((m?.topics || []).join(', '))}</textarea>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-green">Save Module Syllabus</button>
      </div>
    </form>`);
}

async function saveCurriculumModule(modIdx) {
  try {
    await api('/api/admin/curriculum/module', {
      method: 'POST',
      body: JSON.stringify({
        trackId: currTrackId,
        index: modIdx,
        day: Number($('mod-day')?.value || 1),
        hours: Number($('mod-hrs')?.value || 3),
        status: $('mod-status')?.value || undefined,
        title: ($('mod-title')?.value || '').trim(),
        topics: $('mod-topics')?.value || ''
      })
    });
    showToast('Saved curriculum module updates.');
    closeModal();
    await loadCurriculumView();
  } catch (err) {
    showToast(err.message, true);
  }
}

const WINTER_VIDEO_TRACKS = [
  'Web Development & Full Stack Development',
  'App Development',
  'Python Programming',
  'Artificial Intelligence & Machine Learning',
  'Data Science & Analytics',
  'UI/UX Design',
  'IoT & Embedded Systems',
  'Human Resource Management',
  'Marketing',
  'Finance & Accounting',
  'Digital Marketing',
  'Business Development',
  'Sales'
];

function extractYtPreviewId(raw) {
  const m = String(raw || '').trim().match(/(?:youtu\.be\/|[?&]v=|youtube\.com\/(?:embed|shorts|live|v)\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

function updateVideoModalPreview() {
  const ytId = extractYtPreviewId($('vid-yt-url')?.value || '');
  const box = $('vid-yt-preview');
  if (!box) return;
  if (!ytId) {
    box.innerHTML = '<span style="font-size:0.82rem;color:var(--adm-muted);">Paste a YouTube watch, Shorts, live, or youtu.be link to preview thumbnail</span>';
    return;
  }
  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <img src="https://i.ytimg.com/vi/${escHtml(ytId)}/hqdefault.jpg" alt="YouTube thumbnail" style="width:112px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--adm-line);">
      <div>
        <span class="pill green" style="font-size:0.74rem;">VALID YOUTUBE ID</span>
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.84rem;color:var(--adm-navy);margin-top:4px;">${escHtml(ytId)}</div>
      </div>
    </div>`;
}

function openAddVideoModal() {
  const trackOptions = ['<option value="all">All Tracks (Visible to Every Student)</option>']
    .concat(WINTER_VIDEO_TRACKS.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`))
    .join('');

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div>
        <span class="adm-hero-pill">RECORDED SESSIONS // YOUTUBE UPLOAD</span>
        <h3 style="margin:4px 0 0;font-family:'Space Grotesk',sans-serif;">Add Recorded Video</h3>
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
    </div>
    <form onsubmit="event.preventDefault(); saveAdminVideo();">
      <label class="f-lbl" for="vid-title">Session / Video Title *</label>
      <input id="vid-title" class="f-ctrl" type="text" placeholder="e.g. Day 01 — Orientation & Git Architecture" required>

      <label class="f-lbl" for="vid-yt-url">YouTube Video Link *</label>
      <input id="vid-yt-url" class="f-ctrl" type="url" placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..." oninput="updateVideoModalPreview()" required>

      <div id="vid-yt-preview" style="background:#F8FAFC;border:1px dashed var(--adm-line);border-radius:10px;padding:10px 12px;margin-bottom:12px;">
        <span style="font-size:0.82rem;color:var(--adm-muted);">Paste a YouTube watch, Shorts, live, or youtu.be link to preview thumbnail</span>
      </div>

      <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
        <div>
          <label class="f-lbl" for="vid-track">Target Track</label>
          <select id="vid-track" class="f-ctrl">${trackOptions}</select>
        </div>
        <div>
          <label class="f-lbl" for="vid-mode">Batch Mode</label>
          <select id="vid-mode" class="f-ctrl">
            <option value="all">All Modes (Online &amp; Offline)</option>
            <option value="Online">Online Cohort Only</option>
            <option value="Offline">Offline Cohort Only</option>
          </select>
        </div>
        <div>
          <label class="f-lbl" for="vid-session">Session / Module Label</label>
          <input id="vid-session" class="f-ctrl" type="text" value="Module 01" placeholder="e.g. Module 01">
        </div>
        <div>
          <label class="f-lbl" for="vid-duration">Duration</label>
          <input id="vid-duration" class="f-ctrl" type="text" placeholder="e.g. 45 mins">
        </div>
      </div>

      <label class="f-lbl" for="vid-instructor">Mentor / Speaker</label>
      <input id="vid-instructor" class="f-ctrl" type="text" value="Plant Green Inertia Mentor" placeholder="Instructor name">

      <label class="f-lbl" for="vid-summary">Session Summary / Notes</label>
      <textarea id="vid-summary" class="f-ctrl" rows="2" placeholder="Key topics covered in this recorded session"></textarea>

      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-green">Publish YouTube Video</button>
      </div>
    </form>`);
}

async function saveAdminVideo() {
  try {
    const res = await api('/api/admin/videos', {
      method: 'POST',
      body: JSON.stringify({
        title: ($('vid-title')?.value || '').trim(),
        youtubeUrl: ($('vid-yt-url')?.value || '').trim(),
        track: $('vid-track')?.value || 'all',
        mode: $('vid-mode')?.value || 'all',
        sessionNumber: ($('vid-session')?.value || 'SESSION').trim(),
        duration: ($('vid-duration')?.value || 'YouTube').trim(),
        instructor: ($('vid-instructor')?.value || 'Plant Green Inertia Mentor').trim(),
        summary: ($('vid-summary')?.value || '').trim()
      })
    });
    showToast(res.message || 'Recorded YouTube video uploaded.');
    closeModal();
    curSubTab.curriculum = 'videos';
    await loadCurriculumView();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteAdminVideo(idx) {
  const v = cacheVideos[idx];
  if (!v) return;
  if (!confirm(`Delete "${v.title}" from Recorded Videos?`)) return;
  try {
    await api(`/api/admin/videos/${encodeURIComponent(v.id)}`, { method: 'DELETE' });
    showToast(`Deleted "${v.title}".`);
    await loadCurriculumView();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openBatchModal(idx) {
  const b = idx >= 0 ? cacheBatches[idx] : null;
  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <h3 style="margin:0;font-family:'Space Grotesk',sans-serif;">${b ? 'Edit Cohort Batch' : 'Create Cohort Batch'}</h3>
      <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
    </div>
    <form onsubmit="event.preventDefault(); saveBatch(${idx});">
      <label class="f-lbl" for="b-name">Batch Name *</label>
      <input id="b-name" class="f-ctrl" type="text" value="${escHtml(b?.name || '')}" placeholder="Winter 2026 — Batch 2" required>
      <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
        <div><label class="f-lbl" for="b-start">Starts On</label><input id="b-start" class="f-ctrl" type="date" value="${escHtml((b?.starts_on || '').slice(0, 10))}"></div>
        <div><label class="f-lbl" for="b-end">Ends On</label><input id="b-end" class="f-ctrl" type="date" value="${escHtml((b?.ends_on || '').slice(0, 10))}"></div>
        <div>
          <label class="f-lbl" for="b-mode">Mode</label>
          <select id="b-mode" class="f-ctrl">
            <option value="Online & Offline"${b?.mode === 'Online & Offline' || b?.mode === 'Hybrid' ? ' selected' : ''}>Online &amp; Offline</option>
            <option value="Online"${b?.mode === 'Online' ? ' selected' : ''}>Online Live</option>
            <option value="Offline"${b?.mode === 'Offline' ? ' selected' : ''}>Offline (In-Person)</option>
          </select>
        </div>
        <div><label class="f-lbl" for="b-seats">Seat Limit</label><input id="b-seats" class="f-ctrl" type="number" min="1" max="500" value="${escHtml(b?.seats_limit ?? 60)}"></div>
      </div>
      <label class="f-lbl" for="b-timings">Session Timings</label>
      <input id="b-timings" class="f-ctrl" type="text" value="${escHtml(b?.timings || 'Online: 4-6 PM | Offline: 9 AM-6 PM')}">
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-green">${b ? 'Save Changes' : 'Create Batch'}</button>
      </div>
    </form>`);
}

// ----------------------------------------------------------------------------
// DEDICATED VIEW: Cohort Batches (Left Sidebar Tab)
// ----------------------------------------------------------------------------
let batchSegment = 'all';

async function loadBatchesView() {
  const [batches, students] = await Promise.all([
    api('/api/admin/batches'),
    cacheStudents.length ? Promise.resolve(cacheStudents) : api('/api/admin/students').catch(() => [])
  ]);
  cacheBatches = Array.isArray(batches) ? batches : [];
  if (Array.isArray(students)) cacheStudents = students;

  const activeCnt = cacheBatches.filter(b => b.status === 'active' || b.is_active).length;
  const upcomingCnt = cacheBatches.filter(b => b.status === 'upcoming').length;
  const completedCnt = cacheBatches.filter(b => b.status === 'completed').length;
  const totalSeats = cacheBatches.reduce((sum, b) => sum + Number(b.seats_limit || 60), 0);
  const totalEnrolled = cacheBatches.reduce((sum, b) => sum + Number(b.enrolled_count || 0), 0);

  $('admin-view').innerHTML = `
    <div class="adm-stu-hero">
      <div>
        <div>
          <span class="adm-hero-pill">COHORT SCHEDULING // INTAKE MANAGEMENT</span>
          <span class="adm-sync-note">&bull; Winter Cohort 2026</span>
        </div>
        <h2>Batches</h2>
        <p>Create and manage internship batches, start/end dates, training modes, session timings, and seat capacity.</p>
      </div>
      <div class="adm-hero-actions">
        <button type="button" class="btn btn-outline btn-sm" onclick="showTab('students')">Assign Fellows &rarr;</button>
        <button type="button" class="btn btn-green btn-sm" onclick="openBatchModal(-1)">+ Create Batch</button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard('TOTAL BATCHES', String(cacheBatches.length), 'Across Winter & archival cohorts', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>', 'blue')}
      ${kpiCard('ACTIVE COHORTS', String(activeCnt), 'Currently running live intakes', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>', 'green')}
      ${kpiCard('UPCOMING / COMPLETED', `${upcomingCnt} / ${completedCnt}`, 'Scheduled vs concluded cohorts', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', 'blue')}
      ${kpiCard('SEAT CAPACITY', `${totalEnrolled} / ${totalSeats}`, 'Enrolled fellows vs seat limit', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>', 'green')}
    </div>

    <div class="adm-seg-bar">
      <div class="adm-seg-pills" role="group" aria-label="Batch status filters">
        <button type="button" class="adm-seg-pill${batchSegment === 'all' ? ' active' : ''}" data-bseg="all" onclick="setBatchSegment('all')">All (${cacheBatches.length})</button>
        <button type="button" class="adm-seg-pill${batchSegment === 'active' ? ' active' : ''}" data-bseg="active" onclick="setBatchSegment('active')">Active (${activeCnt})</button>
        <button type="button" class="adm-seg-pill${batchSegment === 'upcoming' ? ' active' : ''}" data-bseg="upcoming" onclick="setBatchSegment('upcoming')">Upcoming (${upcomingCnt})</button>
        <button type="button" class="adm-seg-pill${batchSegment === 'completed' ? ' active' : ''}" data-bseg="completed" onclick="setBatchSegment('completed')">Completed (${completedCnt})</button>
      </div>
      <div class="adm-seg-controls" style="flex:1 1 260px;justify-content:flex-end;">
        <input id="f-bat-q" class="adm-seg-select" style="flex:1 1 180px;background:#fff;" type="search" placeholder="Search batch name, slug, timings..." oninput="renderBatchesTable()">
        <select id="f-bat-mode" class="adm-seg-select" aria-label="Filter by mode" onchange="renderBatchesTable()">
          <option value="">All Modes</option>
          <option value="Online & Offline">Online &amp; Offline</option>
          <option value="Online">Online</option>
          <option value="Offline">Offline</option>
        </select>
      </div>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Batch Name &amp; Slug</th>
            <th>Schedule Dates</th>
            <th>Mode &amp; Timings</th>
            <th>Enrollment &amp; Capacity</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="bat-tbody"></tbody>
      </table>
    </div>`;

  renderBatchesTable();
}

function setBatchSegment(seg) {
  batchSegment = seg;
  document.querySelectorAll('.adm-seg-pill[data-bseg]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-bseg') === seg);
  });
  renderBatchesTable();
}

function renderBatchesTable() {
  const tbody = $('bat-tbody');
  if (!tbody) return;
  const q = ($('f-bat-q')?.value || '').trim().toLowerCase();
  const mode = ($('f-bat-mode')?.value || '').toLowerCase();

  const rows = cacheBatches.map((b, idx) => ({ b, idx })).filter(({ b }) => {
    const st = String(b.status || (b.is_active ? 'active' : 'upcoming')).toLowerCase();
    if (batchSegment !== 'all' && st !== batchSegment) return false;
    if (mode && String(b.mode || '').toLowerCase() !== mode) return false;
    if (q) {
      const hay = [b.name, b.slug, b.mode, b.timings].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!rows.length) {
    tbody.innerHTML = emptyTableRow(6, 'No matching cohort batches found.');
    return;
  }

  tbody.innerHTML = rows.map(({ b, idx }) => {
    const assignedCnt = cacheStudents.filter(s => s.assignedBatchId === b.id || s.assignedBatch === b.name).length;
    const seats = Number(b.seats_limit || 60);
    const enrolled = Math.max(Number(b.enrolled_count || 0), assignedCnt);
    const pct = seats ? Math.min(100, Math.round((enrolled / seats) * 100)) : 0;
    const isAct = b.status === 'active' || b.is_active;

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="adm-act-ini" style="width:34px;height:34px;border-radius:8px;${isAct ? 'background:var(--adm-green);color:#fff;' : ''}">${escHtml(getInitials(b.name))}</span>
            <div>
              <strong style="display:block;color:var(--adm-navy);">${escHtml(b.name)}</strong>
              <span class="adm-uid-chip" style="padding:2px 6px;margin-top:2px;">${escHtml(b.slug || 'batch')}</span>
            </div>
          </div>
        </td>
        <td style="font-size:0.88rem;">
          ${b.starts_on || b.ends_on ? `${fmtDate(b.starts_on)} &rarr; ${fmtDate(b.ends_on)}` : '<span style="color:var(--adm-muted);">Flexible Cohort Dates</span>'}
        </td>
        <td>
          ${pillBadge(b.mode || 'Online & Offline', 'blue')}
          <div style="font-size:0.84rem;color:var(--adm-muted);margin-top:4px;">${escHtml(b.timings || 'Standard Cohort Timings')}</div>
        </td>
        <td style="min-width:150px;">
          <div style="font-size:0.9rem;font-weight:700;margin-bottom:4px;">${enrolled} / ${seats} seats (${pct}%)</div>
          <div class="adm-prog-track"><div class="adm-prog-fill" style="width:${Math.max(4, pct)}%;"></div></div>
        </td>
        <td>${pillBadge(b.status || (isAct ? 'active' : 'upcoming'))}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm" onclick="openBatchModal(${idx})">Edit</button>
            <button type="button" class="btn ${isAct ? 'btn-outline' : 'btn-green'} btn-sm" onclick="toggleBatchStatus(${idx})">${isAct ? 'Set Upcoming' : 'Set Active'}</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

async function saveBatch(idx) {
  const b = idx >= 0 ? cacheBatches[idx] : null;
  const payload = {
    name: ($('b-name')?.value || '').trim(),
    starts_on: $('b-start')?.value || null,
    ends_on: $('b-end')?.value || null,
    mode: $('b-mode')?.value || 'Online & Offline',
    seats_limit: Number($('b-seats')?.value || 60),
    timings: ($('b-timings')?.value || '').trim()
  };
  try {
    const endpoint = b ? `/api/admin/batches/${encodeURIComponent(b.id)}` : '/api/admin/batches';
    await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    showToast(b ? `Updated ${payload.name}.` : `Created ${payload.name}.`);
    closeModal();
    if (curTab === 'batches') await loadBatchesView();
    else await loadCurriculumView();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function toggleBatchStatus(idx) {
  const b = cacheBatches[idx];
  if (!b) return;
  const next = b.status === 'active' ? 'upcoming' : 'active';
  try {
    await api(`/api/admin/batches/${encodeURIComponent(b.id)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: next })
    });
    showToast(`Batch ${b.name} is now ${next}.`);
    if (curTab === 'batches') await loadBatchesView();
    else await loadCurriculumView();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ----------------------------------------------------------------------------
// VIEW 7: Mentors, Student Queries & Cohort Broadcasts (Stitch Dispatch)
// ----------------------------------------------------------------------------
async function loadMentorsView() {
  const sub = curSubTab.mentors || 'queries';
  const [mentors, queries, notifs, students] = await Promise.all([
    api('/api/admin/mentors'),
    api('/api/admin/queries').catch(() => []),
    api('/api/admin/notifications').catch(() => []),
    cacheStudents.length ? Promise.resolve(cacheStudents) : api('/api/admin/students').catch(() => [])
  ]);
  cacheMentors = Array.isArray(mentors) ? mentors : [];
  cacheQueries = Array.isArray(queries) ? queries : [];
  if (Array.isArray(students)) cacheStudents = students;

  const activeMentors = cacheMentors.filter(m => m.active !== false);
  const openQueries = cacheQueries.filter(q => String(q.status || '').toLowerCase() !== 'resolved');
  const unassignedOpen = openQueries.filter(q => !q.assignedMentorId);
  const highQueries = openQueries.filter(q => ['high', 'urgent'].includes(String(q.priority || '').toLowerCase()));
  const assignedStudentsCnt = cacheStudents.filter(s => Boolean(s.assignedMentorId) || (s.assignedMentor && s.assignedMentor !== 'Unassigned')).length;
  const distinctDomains = new Set(activeMentors.map(m => m.domain || m.specialization).filter(Boolean)).size;

  const tabsHtml = renderSubTabs('mentors', [
    { key: 'queries', label: `Active Queries Queue (${cacheQueries.length})` },
    { key: 'directory', label: `Assigned Mentors (${cacheMentors.length})` },
    { key: 'broadcasts', label: `Cohort Broadcasts (${notifs.length})` }
  ]);

  const heroHtml = `
    <div class="adm-stu-hero">
      <div>
        <div>
          <span class="adm-hero-pill">&bull; LIVE DISPATCH ACTIVE / MENTOR NETWORK &amp; SUPPORT</span>
          <span class="adm-sync-note">${activeMentors.length} FACULTY MENTORS ACTIVE</span>
        </div>
        <h2>Mentors &amp; Queries</h2>
        <p>Oversee cohort faculty mentors, route student technical queries, assign fellows, and broadcast announcements.</p>
      </div>
      <div class="adm-hero-actions">
        <button type="button" class="btn btn-outline btn-sm" onclick="openMentorModal()">+ Onboard New Mentor</button>
        <button type="button" class="btn btn-green btn-sm" ${unassignedOpen.length === 0 ? 'disabled style="opacity:0.55;cursor:not-allowed;"' : ''} onclick="autoAssignQueries()">
          &#9889; Auto-Assign Unresolved (${unassignedOpen.length})
        </button>
      </div>
    </div>
    ${tabsHtml}
    <div class="kpi-grid">
      ${kpiCard('ACTIVE MENTORS', String(activeMentors.length), `Active across ${distinctDomains || 1} tracks`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>', 'blue', "switchSubTab('mentors','directory')")}
      ${kpiCard('OPEN QUERIES', String(openQueries.length), highQueries.length ? `${highQueries.length} High-priority open` : 'Support queue clear', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>', openQueries.length ? 'red' : 'green', "switchSubTab('mentors','queries')")}
      ${kpiCard('ASSIGNED INTERNS', `${assignedStudentsCnt} / ${cacheStudents.length}`, 'Fellows mapped to cohort mentors', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>', 'green')}
      ${kpiCard('COHORT BROADCASTS', String(notifs.length), 'Announcements live in Student Portal', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>', 'blue', "switchSubTab('mentors','broadcasts')")}
    </div>`;

  if (sub === 'directory') {
    $('admin-view').innerHTML = `
      ${heroHtml}
      <div class="adm-panel">
        <div class="adm-panel-head">
          <h3>Cohort Mentors Directory (${cacheMentors.length})</h3>
          <button type="button" class="btn btn-green btn-sm" onclick="openMentorModal()">+ Add Mentor</button>
        </div>
        <div class="adm-grid-auto">
          ${cacheMentors.length ? cacheMentors.map((m, mIdx) => {
            const stuCnt = cacheStudents.filter(s => s.assignedMentorId === m.id || s.assignedMentor === m.name).length;
            const qCnt = cacheQueries.filter(q => q.assignedMentorId === m.id && q.status !== 'Resolved').length;
            return `
              <div style="border:1px solid var(--adm-line);border-radius:12px;padding:15px;background:#F8FAFC;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
                  <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                    <span class="adm-act-ini" style="width:36px;height:36px;background:var(--adm-green);color:#fff;border-radius:9px;">${escHtml(getInitials(m.name))}</span>
                    <div style="min-width:0;">
                      <strong style="display:block;font-size:0.93rem;">${escHtml(m.name)}</strong>
                      ${m.title ? `<span style="font-size:0.84rem;color:var(--adm-slate);">${escHtml(m.title)}</span>` : ''}
                    </div>
                  </div>
                  ${pillBadge(m.active !== false ? 'ONLINE' : 'INACTIVE', m.active !== false ? 'green' : 'gray')}
                </div>
                <div style="font-size:0.88rem;color:var(--adm-green);font-weight:700;margin-bottom:4px;">${escHtml(m.domain || m.specialization || 'Technical Mentor')}</div>
                ${m.bio ? `<div style="font-size:0.88rem;color:var(--adm-slate);margin-bottom:8px;">${escHtml(m.bio)}</div>` : ''}
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding-top:8px;border-top:1px solid #E2E8F0;font-size:0.84rem;color:var(--adm-muted);">
                  <span>${escHtml(m.email || '')}${m.phone ? ' &bull; ' + escHtml(m.phone) : ''}</span>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <strong style="color:var(--adm-navy);">${stuCnt} fellow${stuCnt === 1 ? '' : 's'} &bull; ${qCnt} open</strong>
                    <button type="button" class="btn btn-danger btn-sm" onclick="removeMentor(${mIdx})">Remove</button>
                  </div>
                </div>
              </div>`;
          }).join('') : '<p style="color:var(--adm-muted);">No mentors added yet.</p>'}
        </div>
      </div>`;
    return;
  }

  if (sub === 'broadcasts') {
    $('admin-view').innerHTML = `
      ${heroHtml}
      <div class="adm-grid-2">
        <section class="adm-panel">
          <div class="adm-panel-head">
            <h3>Publish Cohort Announcement</h3>
            <span class="pill blue">Visible in Student Portal</span>
          </div>
          <form onsubmit="event.preventDefault(); sendNotificationSubmit();">
            <label class="f-lbl" for="n-title">Announcement Title *</label>
            <input id="n-title" class="f-ctrl" type="text" placeholder="e.g. Week 2 Live Project Review Schedule" required>
            <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
              <div>
                <label class="f-lbl" for="n-target">Target Cohort / Track</label>
                <select id="n-target" class="f-ctrl">
                  <option value="All">All Interns</option>
                  <option value="Online">Online Track</option>
                  <option value="Offline">Offline Track</option>
                  <option value="Core">Core Tracks</option>
                  <option value="Special">Special Tracks</option>
                </select>
              </div>
              <div>
                <label class="f-lbl" for="n-prio">Priority</label>
                <select id="n-prio" class="f-ctrl">
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <label class="f-lbl" for="n-msg">Message *</label>
            <textarea id="n-msg" class="f-ctrl" rows="3" placeholder="Write announcement details for candidates..." required></textarea>
            <button type="submit" class="btn btn-green">Send Broadcast</button>
          </form>
        </section>

        <section class="adm-panel">
          <div class="adm-panel-head">
            <h3>Published Broadcast History (${notifs.length})</h3>
          </div>
          <div style="display:grid;gap:10px;max-height:420px;overflow-y:auto;">
            ${notifs.length ? notifs.map(n => `
              <div style="border:1px solid var(--adm-line);border-radius:11px;padding:12px;background:#F8FAFC;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">
                  <strong>${escHtml(n.title)}</strong>
                  ${pillBadge(n.priority || 'normal')}
                </div>
                <p style="margin:0 0 6px;font-size:0.92rem;color:var(--adm-slate);">${escHtml(n.message)}</p>
                <div style="font-size:0.84rem;color:var(--adm-muted);">Target: ${escHtml(n.target_track || n.targetTrack || 'All')} · ${fmtDate(n.created_at, true)}</div>
              </div>`).join('') : '<p style="color:var(--adm-muted);">No announcements sent yet.</p>'}
          </div>
        </section>
      </div>`;
    return;
  }

  // Default sub-tab: Active Queries Queue + Mentor Workload & Quick Broadcasts
  const categories = [...new Set(cacheQueries.map(q => q.category).filter(Boolean))].sort();

  $('admin-view').innerHTML = `
    ${heroHtml}
    <div class="adm-seg-bar">
      <div class="adm-seg-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="f-qry-q" type="search" placeholder="Search queries by student email, ticket ID, subject, or mentor..." oninput="renderQueriesQueue()">
      </div>
      <div class="adm-seg-controls">
        <select id="f-qry-cat" class="adm-seg-select" aria-label="Filter by category" onchange="renderQueriesQueue()">
          <option value="">All Categories</option>
          ${categories.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')}
        </select>
        <select id="f-qry-status" class="adm-seg-select" aria-label="Filter by status" onchange="renderQueriesQueue()">
          <option value="">All Ticket Statuses</option>
          <option value="Open">Open Queue</option>
          <option value="Resolved">Resolved</option>
        </select>
      </div>
    </div>

    <section class="adm-panel">
      <div class="adm-panel-head">
        <div>
          <h3>Student Support &amp; Escalation Dispatch Queue</h3>
          <span style="font-size:0.88rem;color:var(--adm-muted);">Showing unassigned and active student tickets submitted from Student Portal &rarr; Support.</span>
        </div>
        <span class="pill green">REAL-TIME SYNC</span>
      </div>
      <div id="queries-queue-list" class="adm-mod-stack" style="margin-bottom:0;"></div>
    </section>

    <div class="adm-grid-2" style="margin-top:18px;">
      <section class="adm-panel">
        <div class="adm-panel-head">
          <div>
            <h3>Faculty Mentor Roster &amp; Workload</h3>
            <span style="font-size:0.88rem;color:var(--adm-muted);">Live capacity across cohort tracks</span>
          </div>
          <button type="button" class="btn btn-outline btn-sm" onclick="switchSubTab('mentors','directory')">View All ${cacheMentors.length} Members &rarr;</button>
        </div>
        <div style="display:grid;gap:10px;">
          ${activeMentors.length ? activeMentors.slice(0, 4).map(m => {
            const mIdx = cacheMentors.indexOf(m);
            const stuCnt = cacheStudents.filter(s => s.assignedMentorId === m.id || s.assignedMentor === m.name).length;
            const qCnt = openQueries.filter(q => q.assignedMentorId === m.id).length;
            return `
              <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:11px;padding:11px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
                <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                  <span class="adm-act-ini" style="width:36px;height:36px;background:var(--adm-green);color:#fff;border-radius:9px;">${escHtml(getInitials(m.name))}</span>
                  <div style="min-width:0;">
                    <strong style="display:block;font-size:0.86rem;">${escHtml(m.name)}</strong>
                    <span style="display:block;font-size:0.84rem;color:var(--adm-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(m.domain || m.specialization || m.title)}</span>
                  </div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                  <div style="font-size:0.88rem;font-weight:700;color:var(--adm-navy);">${stuCnt} Fellows &bull; ${qCnt} Open</div>
                  <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:4px;">
                    ${pillBadge('ONLINE', 'green')}
                    <button type="button" class="btn btn-outline btn-sm" style="color:var(--adm-red);border-color:#FECACA;" onclick="removeMentor(${mIdx})">Remove</button>
                  </div>
                </div>
              </div>`;
          }).join('') : '<p style="color:var(--adm-muted);font-size:0.92rem;">No active mentors configured.</p>'}
        </div>
      </section>

      <section class="adm-panel">
        <div class="adm-panel-head">
          <div>
            <h3>Quick Cohort Broadcast Dispatch</h3>
            <span style="font-size:0.88rem;color:var(--adm-muted);">Send instant portal notifications to fellows</span>
          </div>
          <button type="button" class="btn btn-outline btn-sm" onclick="switchSubTab('mentors','broadcasts')">History (${notifs.length}) &rarr;</button>
        </div>
        <form onsubmit="event.preventDefault(); sendNotificationSubmit();">
          <label class="f-lbl" for="n-title">Announcement Title *</label>
          <input id="n-title" class="f-ctrl" type="text" placeholder="e.g. Mentor Doubt Clearing Session — 6:00 PM IST" required>
          <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
            <div>
              <label class="f-lbl" for="n-target">Target Cohort</label>
              <select id="n-target" class="f-ctrl">
                <option value="All">All Interns</option>
                <option value="Online">Online Track</option>
                <option value="Offline">Offline Track</option>
                <option value="Technical">Technical Tracks</option>
                <option value="Non-Technical">Non-Technical Tracks</option>
              </select>
            </div>
            <div>
              <label class="f-lbl" for="n-prio">Priority</label>
              <select id="n-prio" class="f-ctrl">
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <label class="f-lbl" for="n-msg">Message *</label>
          <textarea id="n-msg" class="f-ctrl" rows="2" placeholder="Notice visible across Student Portal..." required></textarea>
          <button type="submit" class="btn btn-green btn-sm">Send Broadcast</button>
        </form>
      </section>
    </div>`;

  renderQueriesQueue();
}

function renderQueriesQueue() {
  const wrap = $('queries-queue-list');
  if (!wrap) return;
  const q = ($('f-qry-q')?.value || '').trim().toLowerCase();
  const cat = $('f-qry-cat')?.value || '';
  const st = ($('f-qry-status')?.value || '').toLowerCase();

  const rows = cacheQueries.map((item, idx) => ({ item, idx })).filter(({ item }) => {
    if (cat && item.category !== cat) return false;
    if (st && String(item.status || 'open').toLowerCase() !== st) return false;
    if (q) {
      const hay = [item.id, item.email, item.subject, item.message, item.category, item.assignedMentorName]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!rows.length) {
    wrap.innerHTML = `
      <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:12px;padding:24px;text-align:center;color:var(--adm-muted);">
        No matching student support queries right now. Tickets raised in the Student Portal appear here for mentor assignment and resolution.
      </div>`;
    return;
  }

  wrap.innerHTML = rows.map(({ item, idx }) => {
    const isResolved = String(item.status || '').toLowerCase() === 'resolved';
    const isHigh = ['high', 'urgent'].includes(String(item.priority || '').toLowerCase());
    const iniTone = !isResolved && (isHigh || !item.assignedMentorId)
      ? 'background:#FEE2E2;color:#991B1B;'
      : '';

    return `
      <article class="adm-mod-card${!isResolved && isHigh ? ' is-focus' : ''}" style="padding:14px 16px;">
        <span class="adm-act-ini" style="width:40px;height:40px;border-radius:10px;${iniTone}">${escHtml(getInitials(item.email || 'ST'))}</span>
        <div class="adm-mod-main">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
            <strong style="font-size:0.9rem;color:var(--adm-navy);">${escHtml(item.email || 'Student')}</strong>
            <span class="adm-uid-chip" style="padding:2px 7px;">${escHtml(item.id)}</span>
            ${pillBadge(item.priority || 'Normal')}
            ${pillBadge(item.category || 'Academic', 'blue')}
            ${pillBadge(item.status || 'Open')}
          </div>
          <div style="font-weight:700;font-size:0.88rem;color:var(--adm-navy);">${escHtml(item.subject)}</div>
          <div style="font-size:0.9rem;color:var(--adm-slate);margin-top:3px;">${escHtml(item.message)}</div>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:6px;font-size:0.84rem;color:var(--adm-muted);">
            <span>${item.assignedMentorName ? `Assigned: <strong style="color:var(--adm-navy);">${escHtml(item.assignedMentorName)}</strong>` : '<strong style="color:var(--adm-red);">Unassigned &bull; Pending Mentor Routing</strong>'}</span>
            <span>&bull; Raised ${fmtDate(item.createdAt, true)}</span>
            ${item.adminReply ? `<span style="color:var(--adm-green);font-weight:600;">Reply: ${escHtml(item.adminReply)}</span>` : ''}
          </div>
        </div>
        <div class="adm-mod-actions">
          <button type="button" class="btn ${isResolved ? 'btn-outline' : 'btn-green'} btn-sm" onclick="openQueryModal(${idx})">
            ${isResolved ? 'Edit Reply' : 'Assign / Reply'}
          </button>
        </div>
      </article>`;
  }).join('');
}

async function autoAssignQueries() {
  try {
    const res = await api('/api/admin/queries/auto-assign', { method: 'POST', body: JSON.stringify({}) });
    showToast(res.message || `Assigned ${res.assignedCount || 0} queries.`);
    await loadMentorsView();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openMentorModal() {
  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <h3 style="margin:0;font-family:'Space Grotesk',sans-serif;">Onboard Cohort Mentor</h3>
      <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
    </div>
    <form onsubmit="event.preventDefault(); saveMentor();">
      <label class="f-lbl" for="men-name">Mentor Full Name *</label>
      <input id="men-name" class="f-ctrl" type="text" required>
      <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
        <div><label class="f-lbl" for="men-email">Email *</label><input id="men-email" class="f-ctrl" type="email" required></div>
        <div><label class="f-lbl" for="men-phone">Phone</label><input id="men-phone" class="f-ctrl" type="text"></div>
        <div><label class="f-lbl" for="men-spec">Domain / Track *</label><input id="men-spec" class="f-ctrl" type="text" placeholder="e.g. Web Development & Cloud Architecture" required></div>
        <div><label class="f-lbl" for="men-title">Title / Role</label><input id="men-title" class="f-ctrl" type="text" placeholder="e.g. Principal Mentor"></div>
      </div>
      <label class="f-lbl" for="men-bio">Short Bio</label>
      <textarea id="men-bio" class="f-ctrl" rows="2" placeholder="Experience summary..."></textarea>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-green">Add Mentor</button>
      </div>
    </form>`);
}

async function saveMentor() {
  const payload = {
    name: ($('men-name')?.value || '').trim(),
    email: ($('men-email')?.value || '').trim(),
    phone: ($('men-phone')?.value || '').trim(),
    domain: ($('men-spec')?.value || '').trim(),
    title: ($('men-title')?.value || '').trim() || undefined,
    bio: ($('men-bio')?.value || '').trim() || undefined
  };
  try {
    await api('/api/admin/mentors', { method: 'POST', body: JSON.stringify(payload) });
    showToast(`Added mentor ${payload.name}.`);
    closeModal();
    await loadMentorsView();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function removeMentor(idx) {
  const m = cacheMentors[idx];
  if (!m?.id) return;
  if (!confirm(`Remove mentor "${m.name || m.id}"? Assigned students will be unassigned.`)) return;
  try {
    await api(`/api/admin/mentors/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
    showToast(`Removed mentor ${m.name || m.id}.`);
    await loadMentorsView();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openQueryModal(idx) {
  const q = cacheQueries[idx];
  if (!q) return;
  const mentorOpts = ['<option value="">-- Unassigned --</option>'].concat(
    cacheMentors.map(m => `<option value="${escHtml(m.id)}" data-name="${escHtml(m.name)}"${q.assignedMentorId === m.id ? ' selected' : ''}>${escHtml(m.name)}${m.domain ? ' — ' + escHtml(m.domain) : ''}</option>`)
  ).join('');

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div>
        <h3 style="margin:0;font-family:'Space Grotesk',sans-serif;">Respond to Support Query ${escHtml(q.id)}</h3>
        <div style="font-size:0.88rem;color:var(--adm-muted);">${escHtml(q.email || '')} · ${escHtml(q.subject)}</div>
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
    </div>
    <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:0.92rem;color:var(--adm-slate);">
      ${escHtml(q.message)}
    </div>
    <form onsubmit="event.preventDefault(); resolveQuerySubmit(${idx});">
      <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
        <div>
          <label class="f-lbl" for="qry-mentor">Assign Mentor</label>
          <select id="qry-mentor" class="f-ctrl">${mentorOpts}</select>
        </div>
        <div>
          <label class="f-lbl" for="qry-status">Ticket Status</label>
          <select id="qry-status" class="f-ctrl">
            <option value="Resolved"${q.status === 'Resolved' ? ' selected' : ''}>Resolved</option>
            <option value="Open"${q.status !== 'Resolved' ? ' selected' : ''}>Open</option>
          </select>
        </div>
      </div>
      <label class="f-lbl" for="qry-reply">Coordinator / Mentor Response</label>
      <textarea id="qry-reply" class="f-ctrl" rows="3" placeholder="Resolution note for the student...">${escHtml(q.adminReply || '')}</textarea>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-green">Save Query Assignment &amp; Reply</button>
      </div>
    </form>`);
}

async function resolveQuerySubmit(idx) {
  const q = cacheQueries[idx];
  if (!q) return;
  const menEl = $('qry-mentor');
  const selOpt = menEl?.selectedOptions?.[0];
  try {
    await api(`/api/admin/queries/${encodeURIComponent(q.id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        assignedMentorId: menEl?.value || null,
        assignedMentorName: selOpt?.getAttribute('data-name') || null,
        status: $('qry-status')?.value || 'Resolved',
        reply: $('qry-reply')?.value || ''
      })
    });
    showToast(`Updated ticket ${q.id}.`);
    closeModal();
    await loadMentorsView();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function sendNotificationSubmit() {
  try {
    await api('/api/admin/notifications', {
      method: 'POST',
      body: JSON.stringify({
        title: ($('n-title')?.value || '').trim(),
        message: ($('n-msg')?.value || '').trim(),
        targetTrack: $('n-target')?.value || 'All',
        priority: $('n-prio')?.value || 'normal'
      })
    });
    showToast('Announcement published to Student Portal.');
    await loadMentorsView();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ----------------------------------------------------------------------------
// VIEW 8: Platform Settings, Payments, Coupons & Audit Logs (Stitch Console)
// ----------------------------------------------------------------------------
let payIncludeTest = true;

async function loadSettingsView() {
  const sub = curSubTab.settings || 'exam';
  const tabsHtml = renderSubTabs('settings', [
    { key: 'exam', label: 'General & Assessment Config' },
    { key: 'payments', label: 'Payments & Invoices' },
    { key: 'coupons', label: 'Scholarship Coupons (₹1,199 / ₹999)' },
    { key: 'audit', label: 'Admin Audit Logs' }
  ]);

  const headerHtml = (showSave = false) => `
    <div class="adm-stu-hero">
      <div>
        <div>
          <span class="adm-hero-pill">&bull; SYSTEM CONFIGURATION // GLOBAL CONTROLS</span>
          <span class="adm-sync-note">&bull; Supabase &amp; Audit Sync Active</span>
        </div>
        <h2>Platform Settings</h2>
        <p>Configure cohort assessment rules, scholarship pricing gates, Razorpay ledger visibility, and security audit logs.</p>
      </div>
      <div class="adm-hero-actions">
        <button type="button" class="btn btn-outline btn-sm" onclick="switchSubTab('settings', 'audit')">Audit Change Log</button>
        ${showSave
          ? `<button type="button" class="btn btn-green btn-sm" onclick="saveExamSettings()">&#10003; Save Platform Configuration</button>`
          : `<button type="button" class="btn btn-green btn-sm" onclick="switchSubTab('settings', 'exam')">Assessment Rules Config</button>`}
      </div>
    </div>
    ${tabsHtml}`;

  if (sub === 'payments') {
    cachePayments = await api(`/api/admin/payments${payIncludeTest ? '?includeTest=1' : ''}`);
    const paid = cachePayments.filter(p => p.status === 'paid');
    const paidProd = paid.filter(p => !p.isTest);
    const paidTest = paid.filter(p => p.isTest);
    const totalRev = paid.reduce((sum, p) => sum + Number(p.amountRupees || 0), 0);
    const prodRev = paidProd.reduce((sum, p) => sum + Number(p.amountRupees || 0), 0);
    const testRev = paidTest.reduce((sum, p) => sum + Number(p.amountRupees || 0), 0);
    const revSub = paidTest.length
      ? `${paid.length} settled Razorpay transactions (Prod: ${fmtRupees(prodRev)} · Test: ${fmtRupees(testRev)})`
      : `${paid.length} settled Razorpay transactions`;

    $('admin-view').innerHTML = `
      ${headerHtml(false)}
      <div class="kpi-grid">
        ${kpiCard('COLLECTED REVENUE', fmtRupees(totalRev), revSub, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>', 'green')}
        ${kpiCard('TOTAL PAYMENT ORDERS', String(cachePayments.length), `${paid.length} paid · Paid, initiated & failed checkouts`, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>', 'blue')}
      </div>
      <div class="filter-bar">
        <input id="f-pay-q" class="f-ctrl" type="search" placeholder="Search candidate, email, order ID, payment ID..." oninput="renderPaymentsTable()">
        <select id="f-pay-status" class="f-ctrl" onchange="renderPaymentsTable()">
          <option value="">All Payment Statuses</option>
          <option value="paid">Paid</option>
          <option value="created">Pending / Created</option>
          <option value="failed">Failed</option>
        </select>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.88rem;font-weight:600;color:var(--adm-slate);white-space:nowrap;cursor:pointer;">
          <input id="f-pay-include-test" type="checkbox"${payIncludeTest ? ' checked' : ''} onchange="payIncludeTest = this.checked; loadSettingsView();">
          Include Test (PGITEST1 / ₹1)
        </label>
        <button type="button" class="btn btn-outline btn-sm" onclick="downloadWithAuth('/api/admin/payments/export.csv${payIncludeTest ? '?includeTest=1' : ''}', 'pgi-payments.csv')">Export Payments CSV</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Program / Course</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Razorpay Order &amp; Payment ID</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody id="pay-tbody"></tbody>
        </table>
      </div>`;
    renderPaymentsTable();
    return;
  }

  if (sub === 'coupons') {
    cacheCoupons = await api('/api/admin/coupons');
    $('admin-view').innerHTML = `
      ${headerHtml(false)}
      <div class="filter-bar">
        <input id="f-coup-q" class="f-ctrl" type="search" placeholder="Search coupon code, holder name, email..." oninput="renderCouponsTable()">
        <select id="f-coup-status" class="f-ctrl" onchange="renderCouponsTable()">
          <option value="">All Coupon Statuses</option>
          <option value="active">Active</option>
          <option value="used">Used</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Voucher Code</th>
              <th>Candidate</th>
              <th>Subsidy Tier</th>
              <th>Status &amp; Expiry</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="coup-tbody"></tbody>
        </table>
      </div>`;
    renderCouponsTable();
    return;
  }

  if (sub === 'audit') {
    const logs = await api('/api/admin/audit-logs');
    $('admin-view').innerHTML = `
      ${headerHtml(false)}
      <div class="filter-bar">
        <input id="audit-q" class="f-ctrl" type="search" placeholder="Search admin, action, target ID, metadata..." onkeydown="if(event.key==='Enter') filterAuditLogs()">
        <select id="audit-action" class="f-ctrl" onchange="filterAuditLogs()">
          <option value="">All Actions</option>
          <option value="ASSIGN_STUDENT_DETAILS">ASSIGN_STUDENT_DETAILS</option>
          <option value="CREATE_STUDENT">CREATE_STUDENT</option>
          <option value="UPDATE_STUDENT_STATUS">UPDATE_STUDENT_STATUS</option>
          <option value="LOG_ATTENDANCE">LOG_ATTENDANCE</option>
          <option value="REVIEW_SUBMISSION">REVIEW_SUBMISSION</option>
          <option value="BATCH_APPROVE_SUBMISSIONS">BATCH_APPROVE_SUBMISSIONS</option>
          <option value="ISSUE_CERTIFICATE">ISSUE_CERTIFICATE</option>
          <option value="UPDATE_CURRICULUM">UPDATE_CURRICULUM</option>
          <option value="CREATE_BATCH">CREATE_BATCH</option>
          <option value="UPDATE_SETTINGS">UPDATE_SETTINGS</option>
          <option value="SEND_NOTIFICATION">SEND_NOTIFICATION</option>
          <option value="RESOLVE_QUERY">RESOLVE_QUERY</option>
          <option value="AUTO_ASSIGN_QUERIES">AUTO_ASSIGN_QUERIES</option>
        </select>
        <button type="button" class="btn btn-green btn-sm" onclick="filterAuditLogs()">Apply Filter</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Administrator</th>
              <th>Action</th>
              <th>Target</th>
              <th>Metadata</th>
            </tr>
          </thead>
          <tbody id="audit-tbody">${renderAuditRows(logs)}</tbody>
        </table>
      </div>`;
    return;
  }

  const [settings, mentors, batches] = await Promise.all([
    api('/api/admin/settings'),
    api('/api/admin/mentors').catch(() => []),
    api('/api/admin/batches').catch(() => [])
  ]);
  cacheSettings = settings || {};
  cacheMentors = Array.isArray(mentors) ? mentors : [];
  cacheBatches = Array.isArray(batches) ? batches : [];

  const durMin = Math.max(1, Math.round(Number(cacheSettings.duration_seconds ?? 1200) / 60));
  const qCount = Number(cacheSettings.question_count ?? 25);
  const marksEach = Number(cacheSettings.marks_per_question ?? 4);
  const negMark = Number(cacheSettings.negative_marking ?? 0);
  const attLimit = Number(cacheSettings.attempt_limit ?? 1);
  const passMark = Number(cacheSettings.pass_mark ?? 30);
  const couponHrs = Number(cacheSettings.coupon_valid_hours ?? 24);
  const activeBatches = cacheBatches.filter(b => b.status === 'active' || b.is_active);
  const totalSeats = cacheBatches.reduce((sum, b) => sum + Number(b.seats_limit || 60), 0);

  $('admin-view').innerHTML = `
    ${headerHtml(true)}
    <form onsubmit="event.preventDefault(); saveExamSettings();">
      <div class="adm-grid-7-5" style="margin-top:0;">
        <div>
          <section class="adm-panel">
            <div class="adm-panel-head">
              <div>
                <h3>Cohort &amp; Assessment Configuration</h3>
                <span style="font-size:0.88rem;color:var(--adm-muted);">Core exam runtime parameters persisted in <code>test_settings</code></span>
              </div>
              <span class="pill green">ACTIVE CYCLE</span>
            </div>
            <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
              <div>
                <label class="f-lbl" for="set-qcount">Questions Per Attempt</label>
                <input id="set-qcount" class="f-ctrl" type="number" min="1" max="100" value="${escHtml(qCount)}">
              </div>
              <div>
                <label class="f-lbl" for="set-dur">Assessment Duration (Minutes)</label>
                <input id="set-dur" class="f-ctrl" type="number" min="1" max="240" value="${durMin}">
              </div>
              <div>
                <label class="f-lbl" for="set-marks">Marks Per Question</label>
                <input id="set-marks" class="f-ctrl" type="number" min="1" max="50" value="${escHtml(marksEach)}">
              </div>
              <div>
                <label class="f-lbl" for="set-limit">Attempt Limit / Candidate</label>
                <input id="set-limit" class="f-ctrl" type="number" min="1" max="10" value="${escHtml(attLimit)}">
              </div>
              <div>
                <label class="f-lbl" for="set-neg">Negative Marking Deduction</label>
                <input id="set-neg" class="f-ctrl" type="number" min="0" max="10" step="0.5" value="${escHtml(negMark)}">
              </div>
              <div>
                <label class="f-lbl" for="set-coupon-hrs">Voucher Expiry Window (Hours)</label>
                <input id="set-coupon-hrs" class="f-ctrl" type="number" min="1" max="168" value="${escHtml(couponHrs)}">
              </div>
            </div>
            <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:0.88rem;">
              <span>Computed Total Score: <strong>${qCount * marksEach} Marks</strong> &bull; Active Cohort Batches: <strong>${activeBatches.length}/${cacheBatches.length}</strong> (${totalSeats} total seats)</span>
              <button type="button" class="btn btn-outline btn-sm" onclick="showTab('curriculum','batches')">Manage Batches &rarr;</button>
            </div>
          </section>

          <section class="adm-panel">
            <div class="adm-panel-head">
              <div>
                <h3>Scholarship Tiers &amp; Pricing Policy</h3>
                <span style="font-size:0.88rem;color:var(--adm-muted);">Standard institutional subsidy schedule (Base Fee ₹9,999)</span>
              </div>
              <span class="pill blue">SUBSIDY ENFORCED</span>
            </div>
            <div class="adm-form-2col" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
              <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:11px;padding:12px;">
                <span style="font-size:0.78rem;font-weight:800;color:var(--adm-muted);text-transform:uppercase;">Foundation Scholarship (0–3 Correct)</span>
                <div style="font-family:'Space Grotesk',sans-serif;font-size:1.3rem;font-weight:800;color:var(--adm-navy);margin:4px 0;">₹1,199 <span style="font-size:0.88rem;color:var(--adm-green);">88% Off</span></div>
                <div style="font-size:0.84rem;color:var(--adm-slate);">Automatically issued on assessment completion within 24h voucher window.</div>
              </div>
              <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:11px;padding:12px;">
                <span style="font-size:0.78rem;font-weight:800;color:var(--adm-green);text-transform:uppercase;">Merit Scholarship (4–25 Correct)</span>
                <div style="font-family:'Space Grotesk',sans-serif;font-size:1.3rem;font-weight:800;color:var(--adm-green);margin:4px 0;">₹999 <span style="font-size:0.88rem;color:var(--adm-navy);">90% Off</span></div>
                <div style="font-size:0.84rem;color:var(--adm-slate);">Subsidized tuition grant unlocking full 30-hour cohort &amp; certificate.</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
              <button type="button" class="btn btn-outline btn-sm" onclick="switchSubTab('settings','coupons')">Manage Scholarship Vouchers &rarr;</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="switchSubTab('settings','payments')">Open Razorpay Payments &rarr;</button>
            </div>
          </section>

          <section class="adm-panel">
            <div class="adm-panel-head">
              <div>
                <h3>Admin &amp; Faculty Operators</h3>
                <span style="font-size:0.88rem;color:var(--adm-muted);">Protected via Supabase Auth &amp; <code>profiles.role = admin</code></span>
              </div>
              <button type="button" class="btn btn-outline btn-sm" onclick="showTab('mentors','directory')">Open Mentors Directory &rarr;</button>
            </div>
            <div style="display:grid;gap:8px;">
              <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <span class="adm-act-ini" style="width:32px;height:32px;background:var(--adm-green);color:#fff;">AD</span>
                  <div>
                    <strong style="display:block;font-size:0.92rem;">${escHtml(curUser?.email || 'Administrator')}</strong>
                    <span style="font-size:0.84rem;color:var(--adm-green);font-weight:700;">Signed-in Console Operator</span>
                  </div>
                </div>
                ${pillBadge('SUPERADMIN', 'green')}
              </div>
              ${cacheMentors.slice(0, 3).map(m => `
                <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <span class="adm-act-ini" style="width:32px;height:32px;">${escHtml(getInitials(m.name))}</span>
                    <div>
                      <strong style="display:block;font-size:0.92rem;">${escHtml(m.name)}</strong>
                      <span style="font-size:0.84rem;color:var(--adm-muted);">${escHtml(m.domain || m.title || 'Faculty Mentor')}</span>
                    </div>
                  </div>
                  ${pillBadge(m.active !== false ? 'Active' : 'Inactive', m.active !== false ? 'green' : 'gray')}
                </div>`).join('')}
            </div>
          </section>
        </div>

        <div>
          <section class="adm-panel">
            <div class="adm-panel-head">
              <div>
                <h3>Proctoring Guard &amp; Cutoffs</h3>
                <span style="font-size:0.88rem;color:var(--adm-muted);">Integrity enforcement &amp; qualifying rules</span>
              </div>
              <span class="pill green">ENFORCED</span>
            </div>
            <label class="f-lbl" for="set-pass">Qualifying Pass Cutoff (Marks / 100)</label>
            <input id="set-pass" class="f-ctrl" type="number" min="0" max="100" value="${escHtml(passMark)}">

            <label style="display:flex;align-items:center;gap:10px;background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:10px 12px;margin-bottom:12px;cursor:pointer;">
              <input id="set-desktop-only" type="checkbox"${cacheSettings.desktop_only !== false ? ' checked' : ''}>
              <span>
                <strong style="display:block;font-size:0.88rem;color:var(--adm-navy);">Desktop Only Assessment</strong>
                <span style="font-size:0.8rem;color:var(--adm-muted);">Require a laptop or desktop computer (blocks phones &amp; tablets unless student has an override).</span>
              </span>
            </label>

            <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:11px 12px;margin-bottom:12px;">
              <div style="display:flex;justify-content:space-between;font-size:0.88rem;font-weight:700;margin-bottom:6px;">
                <span>Proctoring Strike Auto-Submit Policy</span>
                <span style="color:var(--adm-green);">Max 3 Warnings</span>
              </div>
              <div class="adm-prog-track"><div class="adm-prog-fill" style="width:75%;"></div></div>
              <div style="font-size:0.84rem;color:var(--adm-muted);margin-top:6px;">Warnings 1–3 log strikes with snapshots; the 4th counted violation auto-submits the attempt cleanly.</div>
            </div>

            <ul style="margin:0 0 12px;padding-left:18px;font-size:0.88rem;color:var(--adm-slate);line-height:1.7;">
              <li>Fullscreen lockout, tab-switch &amp; focus tracking</li>
              <li>5-second burst event deduplication</li>
              <li>16:9 live webcam frame monitoring</li>
            </ul>
            <button type="button" class="btn btn-outline btn-sm" onclick="showTab('assessments','attempts')">Inspect Proctoring Logs &rarr;</button>
          </section>

          <section class="adm-panel">
            <div class="adm-panel-head">
              <div>
                <h3>Certificate Gate &amp; PDF Signatories</h3>
                <span style="font-size:0.88rem;color:var(--adm-muted);">Credential issuance &amp; verification config</span>
              </div>
              <span class="pill gray">PDFKIT</span>
            </div>
            <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:10px 12px;font-size:0.88rem;margin-bottom:10px;">
              <div style="font-size:0.76rem;font-weight:800;color:var(--adm-muted);margin-bottom:4px;">MANDATORY COMPLETION GATE</div>
              <strong>30.0 Verified Contact Hours &amp; &ge;75% Attendance</strong>
            </div>
            <div style="background:#F8FAFC;border:1px solid var(--adm-line);border-radius:10px;padding:10px 12px;font-size:0.88rem;margin-bottom:12px;">
              <div style="font-size:0.76rem;font-weight:800;color:var(--adm-muted);margin-bottom:4px;">OFFICIAL SIGNATORIES</div>
              <div><strong>Dr. K. Ravindran</strong> &bull; Lead Academic Architect</div>
              <div style="color:var(--adm-slate);"><strong>Director of Operations</strong> &bull; Governing Board</div>
            </div>
            <button type="button" class="btn btn-outline btn-sm" onclick="showTab('certificates')">Open Certificates &amp; Gate &rarr;</button>
          </section>

          <section class="adm-panel">
            <div class="adm-panel-head">
              <h3>Platform Runtime Summary</h3>
              <span class="pill green">&bull; LIVE</span>
            </div>
            <div style="display:grid;gap:8px;font-size:0.88rem;">
              <div style="display:flex;justify-content:space-between;"><span style="color:var(--adm-muted);">Auth &amp; DB</span><strong>Supabase Auth + PostgreSQL</strong></div>
              <div style="display:flex;justify-content:space-between;"><span style="color:var(--adm-muted);">Payments Gateway</span><strong>Razorpay Checkout + HMAC</strong></div>
              <div style="display:flex;justify-content:space-between;"><span style="color:var(--adm-muted);">Audit Trail</span><strong>Admin Audit Logs Enabled</strong></div>
            </div>
          </section>
        </div>
      </div>

      <section class="adm-panel" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 18px;">
        <div style="font-size:0.9rem;color:var(--adm-slate);">
          All changes to assessment cutoffs, batch assignments, submissions, and certificates are automatically recorded in the audit log.
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${pillBadge('Production Ready', 'green')}
          <button type="submit" class="btn btn-green btn-sm">Save Platform Configuration</button>
        </div>
      </section>
    </form>`;
}

async function saveExamSettings() {
  const qCount = Number($('set-qcount')?.value || 25);
  const marksEach = Number($('set-marks')?.value || 4);
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({
        question_count: qCount,
        duration_seconds: Math.max(60, Number($('set-dur')?.value || 20) * 60),
        marks_per_question: marksEach,
        total_marks: qCount * marksEach,
        pass_mark: Number($('set-pass')?.value || 30),
        negative_marking: Number($('set-neg')?.value || 0),
        attempt_limit: Number($('set-limit')?.value || 1),
        coupon_valid_hours: Number($('set-coupon-hrs')?.value || 24),
        desktop_only: Boolean($('set-desktop-only')?.checked ?? true)
      })
    });
    showToast('Saved platform & assessment configuration.');
    await loadSettingsView();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function toggleDesktopOnlySetting(enabled) {
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ desktop_only: Boolean(enabled) })
    });
    cacheSettings = { ...(cacheSettings || {}), desktop_only: Boolean(enabled) };
    showToast(`Desktop-only assessment enforcement turned ${enabled ? 'ON' : 'OFF'}.`);
    await loadAssessments();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openBlockedDevicesModal() {
  let rows = cacheBlockedDevices;
  try {
    const fresh = await api('/api/admin/audit-logs?action=ASSESSMENT_DEVICE_BLOCKED');
    if (Array.isArray(fresh)) {
      cacheBlockedDeviceCount = fresh.length;
      rows = fresh.slice(0, 30).map(b => ({
        applicationId: b.details?.application_id || b.target_id || 'UNKNOWN',
        email: b.details?.email || b.admin_email || '',
        time: b.details?.time || b.created_at,
        userAgent: b.details?.user_agent || '',
        reason: b.details?.reason || 'device_not_allowed',
        endpoint: b.details?.endpoint || ''
      }));
      cacheBlockedDevices = rows;
    }
  } catch {}

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;">
      <div>
        <h3 style="margin:0;font-family:'Space Grotesk',sans-serif;">Blocked Mobile &amp; Tablet Attempts (${cacheBlockedDeviceCount})</h3>
        <div style="font-size:0.86rem;color:var(--adm-muted);">Assessment start/resume/submit requests rejected under Desktop-Only policy</div>
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
    </div>
    <div class="table-wrap" style="max-height:420px;overflow:auto;">
      <table class="data-table">
        <thead>
          <tr>
            <th>Application ID</th>
            <th>Candidate</th>
            <th>Reason</th>
            <th>Time</th>
            <th>User-Agent</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map(r => `
            <tr>
              <td><span class="adm-uid-chip">${escHtml(r.applicationId || '—')}</span></td>
              <td style="font-size:0.84rem;">${escHtml(r.email || '—')}</td>
              <td>${pillBadge(r.reason || 'blocked', 'yellow')}</td>
              <td style="font-size:0.82rem;white-space:nowrap;">${escHtml(r.time ? new Date(r.time).toLocaleString('en-IN') : '—')}</td>
              <td style="font-size:0.78rem;color:var(--adm-muted);max-width:260px;word-break:break-word;">${escHtml(r.userAgent || '—')}</td>
            </tr>`).join('') : emptyTableRow(5, 'No blocked mobile/tablet assessment attempts logged yet.')}
        </tbody>
      </table>
    </div>`);
}

function renderPaymentsTable() {
  const tbody = $('pay-tbody');
  if (!tbody) return;
  const q = ($('f-pay-q')?.value || '').trim().toLowerCase();
  const st = ($('f-pay-status')?.value || '').toLowerCase();

  const list = cachePayments.filter(p => {
    if (st && String(p.status || '').toLowerCase() !== st) return false;
    if (q) {
      const hay = [p.name, p.email, p.course, p.orderId, p.paymentId].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!list.length) {
    tbody.innerHTML = emptyTableRow(6, 'No payment orders found.');
    return;
  }

  tbody.innerHTML = list.map(p => `
    <tr>
      <td><strong>${escHtml(p.name || 'Candidate')}</strong><br><span style="font-size:0.86rem;color:var(--adm-muted);">${escHtml(p.email || '')}</span></td>
      <td>${escHtml(p.course || 'Winter Internship')}</td>
      <td><strong>${fmtRupees(p.amountRupees)}</strong></td>
      <td>
        ${pillBadge(p.status || 'created')}
        ${p.isTest ? `<span class="pill blue" style="margin-left:4px;">Test &bull; ${escHtml(p.couponCode || 'PGITEST1')}</span>` : ''}
      </td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:0.86rem;">
        <div>Order: ${escHtml(p.orderId || '—')}</div>
        ${p.paymentId ? `<div style="color:var(--adm-green);">Pay: ${escHtml(p.paymentId)}</div>` : ''}
      </td>
      <td style="font-size:0.88rem;color:var(--adm-slate);">${fmtDate(p.paidAt || p.created, true)}</td>
    </tr>`).join('');
}

function renderCouponsTable() {
  const tbody = $('coup-tbody');
  if (!tbody) return;
  const q = ($('f-coup-q')?.value || '').trim().toLowerCase();
  const st = ($('f-coup-status')?.value || '').toLowerCase();

  const list = cacheCoupons.map((c, idx) => ({ c, idx })).filter(({ c }) => {
    if (st && String(c.status || '').toLowerCase() !== st) return false;
    if (q) {
      const hay = [c.code, c.email, c.name, c.holderEmail].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!list.length) {
    tbody.innerHTML = emptyTableRow(5, 'No scholarship coupons found.');
    return;
  }

  tbody.innerHTML = list.map(({ c, idx }) => {
    const disc = Number(c.discount ?? c.discount_percent ?? 90);
    const fee = c.isTest || disc >= 99
      ? '₹1 Test Voucher'
      : (disc <= 88 ? '₹1,199 (88% Off)' : '₹999 (90% Off)');
    const exp = c.expires || c.expires_at;
    return `
      <tr>
        <td>
          <strong style="font-family:'JetBrains Mono',monospace;color:var(--adm-green);">${escHtml(c.code)}</strong>
          ${c.isReusable ? `<div>${pillBadge('Reusable', 'blue')}</div>` : ''}
        </td>
        <td><strong>${escHtml(c.name || c.holderName || 'Candidate')}</strong><br><span style="font-size:0.86rem;color:var(--adm-muted);">${escHtml(c.email || c.holderEmail || '')}</span></td>
        <td>${pillBadge(fee, c.isTest ? 'yellow' : 'blue')}</td>
        <td>${pillBadge(c.status || 'active')}<br><span style="font-size:0.84rem;color:var(--adm-muted);">${exp ? 'Exp: ' + fmtDate(exp, true) : 'No fixed expiry'}</span></td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${c.isTest ? `<button type="button" class="btn btn-outline btn-sm" onclick="couponAction(${idx}, 'toggle')">${c.status === 'active' ? 'Disable' : 'Enable'}</button>` : `<button type="button" class="btn btn-outline btn-sm" onclick="couponAction(${idx}, 'reissue')">+24h</button>`}
            ${!c.isTest ? `<button type="button" class="btn btn-danger btn-sm" onclick="couponAction(${idx}, 'revoke')">Revoke</button>` : `<button type="button" class="btn btn-danger btn-sm" onclick="deleteCoupon(${idx})">Delete</button>`}
          </div>
        </td>
      </tr>`;
  }).join('');
}

async function couponAction(idx, action) {
  const c = cacheCoupons[idx];
  if (!c?.code) return;
  try {
    await api(`/api/admin/coupons/${encodeURIComponent(c.code)}/${action}`, {
      method: 'POST',
      body: JSON.stringify(action === 'reissue' ? { hours: 24 } : {})
    });
    showToast(`Coupon ${c.code}: ${action} applied.`);
    await loadSettingsView();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteCoupon(idx) {
  const c = cacheCoupons[idx];
  if (!c?.code || !confirm(`Delete coupon ${c.code}?`)) return;
  try {
    await api(`/api/admin/coupons/${encodeURIComponent(c.code)}`, { method: 'DELETE' });
    showToast(`Deleted coupon ${c.code}.`);
    await loadSettingsView();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderAuditRows(logs) {
  if (!Array.isArray(logs) || !logs.length) {
    return emptyTableRow(5, 'No matching audit records found.');
  }
  return logs.map(l => `
    <tr>
      <td style="font-size:0.88rem;white-space:nowrap;">${fmtDate(l.created_at, true)}</td>
      <td style="font-size:0.88rem;">${escHtml(l.admin_email || l.actor_email || 'admin')}</td>
      <td>${pillBadge(l.action || 'EVENT', 'blue')}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:0.84rem;">${escHtml(l.target_type || '')} ${l.target_id ? ': ' + escHtml(l.target_id) : ''}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:0.84rem;color:var(--adm-slate);max-width:340px;word-break:break-word;">${escHtml(l.details ? JSON.stringify(l.details) : '—')}</td>
    </tr>`).join('');
}

async function filterAuditLogs() {
  const q = ($('audit-q')?.value || '').trim();
  const action = ($('audit-action')?.value || '').trim();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (action) params.set('action', action);
  try {
    const qs = params.toString();
    const logs = await api('/api/admin/audit-logs' + (qs ? '?' + qs : ''));
    const tbody = $('audit-tbody');
    if (tbody) tbody.innerHTML = renderAuditRows(logs);
  } catch (err) {
    showToast(err.message, true);
  }
}

// ----------------------------------------------------------------------------
// Global Event Bindings & Boot
// ----------------------------------------------------------------------------
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    toggleAdminDrawer(false);
  }
});

document.addEventListener('DOMContentLoaded', initAuth);
