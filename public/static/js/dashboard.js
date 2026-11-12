/**
 * Plant Green Inertia - Student Portal Dashboard Logic
 * Strictly 7 modules driven by authoritative database data only.
 */

let authToken = localStorage.getItem('pgi_student_token') || sessionStorage.getItem('pgi_student_token');
let currentStudent = null;
let currentTelemetry = null;
let activeTrackId = 'tech-web';
let cachedMaterialsPayload = null;
let activePlayerSessionId = null;

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + authToken
  };
}

function setMsg(id, text, isOk = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'msg ' + (isOk ? 'ok' : 'err');
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHubLoader(text) {
  return `<div class="hub-loader-center" role="status" aria-live="polite"><div class="hub-loader-ring" aria-hidden="true"></div><p class="hub-loader-text">${escHtml(text || 'Loading…')}</p></div>`;
}

function toggleMobileSidebar(open) {
  const side = document.getElementById('hubSidebar');
  const back = document.getElementById('hubSideBackdrop');
  if (!side || !back) return;
  side.classList.toggle('open', Boolean(open));
  back.classList.toggle('show', Boolean(open));
}

// 7-Module Switcher: overview, syllabus, materials, assignments, mentors, certificates, support
function switchModule(modId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.dash-nav-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.hub-top-link').forEach(lnk => lnk.classList.remove('is-active'));

  const target = document.getElementById('mod-' + modId);
  if (target) target.classList.add('active');

  const activeBtn = document.querySelector(`.dash-nav-btn[onclick*="'${modId}'"]`);
  if (activeBtn) activeBtn.classList.add('active');
  const activeTop = document.querySelector(`.hub-top-link[onclick*="'${modId}'"]`);
  if (activeTop) activeTop.classList.add('is-active');

  toggleMobileSidebar(false);
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

  if (modId === 'syllabus') loadSyllabusTrack(activeTrackId);
  if (modId === 'materials') loadMaterials();
  if (modId === 'assignments') loadAssignments();
  if (modId === 'mentors') loadMentors();
  if (modId === 'certificates') loadCertificatesStatus();
  if (modId === 'support') loadSupportTickets();
}

function logoutStudent() {
  localStorage.removeItem('pgi_student_token');
  sessionStorage.removeItem('pgi_student_token');
  localStorage.removeItem('pgi_student_id');
  sessionStorage.removeItem('pgi_student_id');
  window.location.href = 'student-login.html';
}

async function initDashboard() {
  const p = new URLSearchParams(window.location.search);
  const qToken = p.get('token');
  if (qToken) {
    authToken = qToken;
    localStorage.setItem('pgi_student_token', qToken);
  }

  if (!authToken) {
    window.location.href = 'student-login.html';
    return;
  }

  try {
    const res = await fetch('/api/student/dashboard', { headers: getHeaders() });
    if (!res.ok) {
      if (res.status === 401) return logoutStudent();
      throw new Error('Failed to load dashboard data');
    }

    const data = await res.json();
    currentStudent = data.student;
    currentTelemetry = data.telemetry;

    renderStudentInfo(currentStudent, currentTelemetry);

    const domLower = String(currentStudent?.domainName || '').toLowerCase();
    const initialTrack = domLower.includes('app') || domLower.includes('mobile')
      ? 'tech-app'
      : (domLower.includes('marketing') || domLower.includes('business') || domLower.includes('operations') ? 'nontech-marketing' : 'tech-web');

    loadSyllabusTrack(initialTrack);
  } catch (err) {
    console.error('[Dashboard Boot Error]', err);
    const h = document.getElementById('welcome-heading');
    const sub = document.getElementById('welcome-sub');
    if (h) h.textContent = 'Unable to Load Portal Data';
    if (sub) sub.textContent = err.message || 'Please sign in again.';
  }
}

function initialsOf(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('') || 'PG';
}

function renderStudentInfo(s, t) {
  const sid = s.studentId || '—';
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setText('hdr-student-id', sid);
  setText('side-cand-id', sid);
  setText('ov-student-id', sid);

  const name = s.name || 'Student';
  const firstName = name.trim().split(/\s+/)[0] || name;
  setText('side-cand-avatar', initialsOf(name));
  setText('welcome-heading', `Welcome, ${firstName}`);
  setText('side-cand-name', name);
  setText('ov-cand-name', name);
  setText('prof-name', name);

  const track = s.domainName || 'Not Assigned';
  const modeShort = `${s.mode || 'Online'} · ${s.timing || 'Schedule TBA'}`;
  setText('side-cand-track', track);
  setText('ov-track-title', track);
  setText('ov-spec-course', track);
  setText('ov-active-track-heading', `${track}`);
  setText('hdr-mode-badge', modeShort);
  setText('ov-track-mode', s.internshipPeriod ? `${s.mode || 'Online'} · ${s.internshipPeriod}` : modeShort);
  setText('ov-mentor-schedule', `${s.batchName || 'Winter Cohort 2026'} · ${s.timing || 'Schedule TBA'}`);

  const completed = Number(t.completedHours || 0);
  const pct = Math.min(100, Math.round((completed / 30.0) * 100));
  setText('side-cand-hours', `${completed.toFixed(1)}/30 hrs`);
  const sideBar = document.getElementById('side-cand-bar');
  if (sideBar) sideBar.style.width = `${pct}%`;

  setText('ov-kpi-pct', `${pct}%`);
  setText('ov-hours-stat', `${completed.toFixed(1)} / 30 hrs`);
  const ovProg = document.getElementById('ov-prog-fill');
  if (ovProg) ovProg.style.width = `${pct}%`;
  setText('ov-prog-status', completed > 0 ? `${pct}% of 30h completed` : 'Awaiting session hours');

  if (t.attendancePercentage !== null && t.attendancePercentage !== undefined) {
    setText('ov-att-pct', `${t.attendancePercentage}%`);
    setText('ov-att-state', 'Recorded');
    const attBar = document.getElementById('ov-att-bar');
    if (attBar) attBar.style.width = `${t.attendancePercentage}%`;
    setText('ov-att-days', `Present: ${t.presentDays || 0} / ${t.totalDays || 0} Days`);
  } else {
    setText('ov-att-pct', '—');
    setText('ov-att-state', 'No logs yet');
    const attBar = document.getElementById('ov-att-bar');
    if (attBar) attBar.style.width = '0%';
    setText('ov-att-days', 'No attendance recorded yet');
  }

  // Remittance & Student Record
  const payBadge = document.getElementById('hdr-scholarship-badge');
  if (payBadge) {
    payBadge.textContent = t.isTest
      ? 'Test Enrollment (PGITEST1)'
      : (t.enrollmentId ? 'Verified Enrollment' : 'Pending Enrollment');
  }
  setText('ov-payment-status', t.paymentAmountLabel || '—');
  setText('ov-payment-badge', t.enrollmentId ? 'Verified' : 'Pending');
  setText('ov-receipt-short', t.receiptNo ? `Receipt: ${t.receiptNo}` : 'No receipt generated');
  setText('ov-spec-receipt', t.receiptNo || '—');
  const instSummary = [s.college, s.passedOutYear].filter(Boolean).join(' · ') || '—';
  setText('ov-spec-cert', instSummary);
  setText('ov-labs-pill', `${t.assignmentsCompleted || 0} / ${t.totalAssignments || 4} Submissions`);

  // Mentor Summary Cards (Authoritative DB mentor or Pending)
  const mentorObj = s.assignedMentorDetails;
  if (mentorObj && mentorObj.name) {
    setText('ov-kpi-mentor-av', initialsOf(mentorObj.name));
    setText('ov-kpi-mentor-name', mentorObj.name);
    setText('ov-kpi-mentor-role', mentorObj.title || mentorObj.domain || 'Cohort Mentor');
    setText('ov-card-mentor-av', initialsOf(mentorObj.name));
    setText('ov-card-mentor-name', mentorObj.name);
    setText('ov-card-mentor-role', mentorObj.title || mentorObj.domain || 'Cohort Mentor');
  } else {
    setText('ov-kpi-mentor-av', 'PG');
    setText('ov-kpi-mentor-name', 'Pending Assignment');
    setText('ov-kpi-mentor-role', 'Assigned prior to start');
    setText('ov-card-mentor-av', 'PG');
    setText('ov-card-mentor-name', 'Mentor Not Assigned Yet');
    setText('ov-card-mentor-role', 'Will be assigned by PGI Coordinator');
  }

  // Hero classroom CTA if real access_url configured
  const heroCta = document.getElementById('ov-hero-cta');
  if (heroCta && s.courseAccessUrl) {
    heroCta.textContent = 'Open Classroom';
    heroCta.onclick = () => window.open(s.courseAccessUrl, '_blank', 'noopener');
  }

  // Profile fields inside Support section
  setText('prof-email', s.email || '—');
  setText('prof-phone', s.phone || '—');
  setText('prof-college', s.college || '—');
  setText('prof-dept', s.department || '—');
  setText('prof-year', s.passedOutYear || '—');
  setText('supp-cohort-timing', s.timing || '4:00 PM – 6:00 PM IST');
  setText('supp-ref-tag', sid && sid !== '—' ? `REF: ${sid}` : 'REF: STUDENT');
  const suppEnroll = document.getElementById('supp-enroll-badge');
  if (suppEnroll) {
    suppEnroll.textContent = t.enrollmentId ? 'Enrolled' : 'Registered';
    suppEnroll.className = `asg-state-badge ${t.enrollmentId ? 'submitted' : 'pending'}`;
  }
  setText('ov-console-id', `$ pgi-verify --student ${sid} --track "${track}"`);
}

function copyFellowId() {
  const sid = currentStudent?.studentId || '';
  if (!sid || sid === '—') return;
  const btn = document.getElementById('ov-copy-id-btn');
  navigator.clipboard?.writeText(sid).then(() => {
    if (btn) {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy ID'; }, 1600);
    }
  }).catch(() => {});
}

// ===================================================================
// MODULE 2: MODULES (SYLLABUS) + OVERVIEW PREVIEW
// ===================================================================
function toggleModuleNotes(day) {
  const drawer = document.getElementById(`mod-notes-${day}`);
  if (!drawer) return;
  drawer.classList.toggle('hidden');
}

function renderOverviewCurriculumPreview(track, completedHours) {
  const modules = track?.modules || [];
  const totalMods = modules.length || 1;
  const doneCount = Math.min(totalMods, Math.floor((completedHours || 0) / 3));
  const currentMod = modules[doneCount < totalMods ? doneCount : totalMods - 1];

  const metaEl = document.getElementById('ov-current-lab-meta');
  const titleEl = document.getElementById('ov-current-lab-title');
  if (metaEl) {
    metaEl.textContent = currentMod
      ? `${doneCount === 0 ? 'Up Next' : 'In Progress'} · Module ${String(currentMod.day).padStart(2, '0')} (${currentMod.hours}h)`
      : '30-Hour Curriculum';
  }
  if (titleEl && currentMod) {
    titleEl.textContent = currentMod.title;
  }

  const listEl = document.getElementById('ov-checklist-rows');
  if (!listEl) return;
  const preview = modules.slice(0, 3);
  listEl.innerHTML = preview.map((m, idx) => {
    const done = idx < doneCount;
    return `
      <div class="hub-check-row">
        <div class="hub-check-left">
          <span class="hub-check-ico" style="color:${done ? 'var(--hub-green)' : 'var(--hub-muted)'};">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/>${done ? '<polyline points="16 8 10 15 8 13"/>' : '<polyline points="12 7 12 12 15 14"/>'}</svg>
          </span>
          <span>Module ${String(m.day).padStart(2, '0')}: ${m.title}</span>
        </div>
        <span class="hub-check-score" style="color:${done ? 'var(--hub-green)' : 'var(--hub-muted)'};">${done ? 'Completed' : `${m.hours}h Scheduled`}</span>
      </div>
    `;
  }).join('');
}

async function loadSyllabusTrack() {
  const box = document.getElementById('syllabus-container');
  if (box) box.innerHTML = renderHubLoader('Loading your track modules…');

  try {
    const res = await fetch('/api/student/syllabus', { headers: getHeaders() });
    if (!res.ok) throw new Error('Syllabus service unavailable');
    const data = await res.json();
    const track = data.tracks?.[0];

    if (!track) {
      if (box) box.innerHTML = '<div class="dash-module"><p style="margin:0;">Track curriculum not found.</p></div>';
      return;
    }

    activeTrackId = track.id;
    const pillEl = document.getElementById('mod-enrolled-track-pill');
    if (pillEl) pillEl.textContent = data.enrolledDomain || currentStudent?.domainName || track.domainType || 'My Track';

    const completedHours = Number(currentTelemetry?.completedHours || 0);
    renderOverviewCurriculumPreview(track, completedHours);

    const subEl = document.getElementById('mod-track-subtitle');
    if (subEl) subEl.textContent = `Winter Cohort 2026 · ${track.title}`;

    const modules = track.modules || [];
    const totalMods = modules.length || 1;
    const doneCount = Math.min(totalMods, Math.floor(completedHours / 3));
    const activeIndex = doneCount < totalMods ? doneCount : totalMods - 1;
    const activeModule = modules[activeIndex] || modules[0];
    const trackPct = Math.min(100, Math.round((doneCount / totalMods) * 100));
    const activeSliceHrs = Math.max(0, completedHours - doneCount * 3);
    const activePct = Math.min(100, Math.max(0, Math.round((activeSliceHrs / 3) * 100)));
    const pad2 = n => String(n).padStart(2, '0');

    const termSprint = document.getElementById('mod-term-sprint');
    if (termSprint) termSprint.textContent = `${totalMods} Modules · ${track.duration || '30 Hours'}`;

    const summaryHtml = `
      <div class="mod-kpi-grid">
        <div class="mod-kpi-card">
          <div>
            <div class="mod-kpi-top">
              <span>Overall Progress</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--hub-green);" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            </div>
            <div style="font-family:'Space Grotesk',sans-serif;font-size:1.35rem;font-weight:700;color:var(--hub-navy);margin:10px 0 8px;">${doneCount} of ${totalMods} Complete</div>
            <div class="hub-bar-track"><div class="hub-bar-fill" style="width:${trackPct}%;"></div></div>
          </div>
          <div class="mod-kpi-foot-row">
            <span>${trackPct}% Track Completion</span>
            <strong>${doneCount > 0 ? 'In Progress' : 'Not Started'}</strong>
          </div>
        </div>

        <div class="mod-kpi-card">
          <div>
            <div class="mod-kpi-top">
              <span>${doneCount > 0 ? 'Current Focus' : 'Starting Module'}</span>
              <span class="mod-active-tag">${doneCount > 0 ? 'Active' : 'Next'}</span>
            </div>
            <div style="font-size:0.72rem;font-weight:800;color:var(--hub-green);letter-spacing:0.06em;text-transform:uppercase;margin:10px 0 4px;">Module ${pad2(activeModule?.day || activeIndex + 1)}</div>
            <div style="font-family:'Space Grotesk',sans-serif;font-size:1.05rem;font-weight:700;color:var(--hub-navy);line-height:1.3;">${activeModule?.title || 'Core Track Module'}</div>
          </div>
          <div class="mod-kpi-foot-row" style="color:var(--hub-slate);justify-content:flex-start;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--hub-green);flex-shrink:0;" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span>${activeModule?.topics?.[0] || 'Track Syllabus'}</span>
          </div>
        </div>

        <div class="mod-kpi-card">
          <div>
            <div class="mod-kpi-top">
              <span>Completion Criteria</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--hub-navy);" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
            </div>
            <div style="font-family:'Space Grotesk',sans-serif;font-size:1.25rem;font-weight:700;color:var(--hub-navy);margin:10px 0 4px;">30 Hours / Project</div>
            <div style="font-size:0.82rem;color:var(--hub-slate);">Final Capstone &amp; 75% Attendance</div>
          </div>
          <div class="mod-kpi-foot-row">
            <span>Verified Hours</span>
            <strong>${completedHours.toFixed(1)} / 30.0h</strong>
          </div>
        </div>
      </div>
    `;

    const cardsHtml = modules.map((m, idx) => {
      const isDone = idx < doneCount;
      const isActive = idx === activeIndex && doneCount < totalMods;
      const stateClass = isDone ? 'done' : (isActive ? 'active' : 'upcoming');
      const stateLabel = isDone ? 'Completed' : (isActive ? 'Up Next' : 'Scheduled');
      const topicsText = (m.topics || []).join(' &middot; ');

      const iconSvg = isDone
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="16 8 10 15 8 13"/></svg>'
        : (isActive
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>');

      return `
        <article class="mod-seq-card ${isActive ? 'is-active' : ''}">
          <div class="mod-seq-main">
            <div class="mod-seq-left">
              <span class="mod-seq-ico ${stateClass}" aria-hidden="true">${iconSvg}</span>
              <div style="flex:1;min-width:0;">
                <div class="mod-seq-meta-row">
                  <span class="mod-num-tag">Day ${pad2(m.day)} &middot; Module ${pad2(m.day)}</span>
                  <span class="mod-state-pill ${stateClass}">${stateLabel}</span>
                </div>
                <h4 class="mod-seq-title">${escHtml(m.title)}</h4>
                <p class="mod-seq-desc">${escHtml(m.description || topicsText)}</p>
                ${m.project ? `<p class="mod-seq-desc" style="margin-top:4px;color:var(--hub-navy);"><strong>Project / Application:</strong> ${escHtml(m.project)}</p>` : ''}
                ${isActive && activePct > 0 ? `
                  <div class="mod-seq-prog-wrap">
                    <div class="hub-bar-track" style="flex:1;"><div class="hub-bar-fill" style="width:${activePct}%;"></div></div>
                    <span style="font-size:0.75rem;font-weight:700;color:var(--hub-green);">${activePct}%</span>
                  </div>
                ` : ''}
              </div>
            </div>

            <div class="mod-seq-right">
              <div class="mod-seq-stat">
                <small>Duration</small>
                <strong>${m.hours} Hours</strong>
              </div>
              <button type="button" class="${isActive ? 'hub-btn-green' : 'mod-notes-btn'}" onclick="toggleModuleNotes(${m.day})">
                ${isActive ? 'View Syllabus Topics' : 'View Notes'}
              </button>
            </div>
          </div>

          <div class="mod-notes-drawer hidden" id="mod-notes-${m.day}">
            <div class="mod-topic-chips">
              ${(m.topics || []).map(t => `<span class="mod-topic-chip">${escHtml(t)}</span>`).join('')}
            </div>
            ${Array.isArray(track.toolsCovered) && track.toolsCovered.length ? `<div style="font-size:0.82rem;color:var(--hub-slate);margin-bottom:8px;"><strong>Tools covered:</strong> ${track.toolsCovered.map(escHtml).join(' &bull; ')}</div>` : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <a href="${track.pdfUrl || '/static/pdf/PGI_Winter_Internship_Complete_Syllabus.pdf'}" target="_blank" class="mod-notes-btn" style="text-decoration:none;">Download Track PDF</a>
              <button type="button" class="mod-notes-btn" onclick="switchModule('assignments')">Open Submissions</button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    box.innerHTML = `
      ${summaryHtml}
      ${track.overview || (Array.isArray(track.toolsCovered) && track.toolsCovered.length) ? `
        <div class="dash-module" style="margin-bottom:14px;padding:14px 16px;">
          ${track.overview ? `<div style="font-size:0.88rem;color:var(--hub-slate);line-height:1.45;"><strong>Course Overview:</strong> ${escHtml(track.overview)}</div>` : ''}
          ${Array.isArray(track.toolsCovered) && track.toolsCovered.length ? `<div style="font-size:0.83rem;color:var(--hub-navy);margin-top:6px;"><strong>Tools Covered:</strong> ${track.toolsCovered.map(escHtml).join(' &middot; ')}</div>` : ''}
        </div>
      ` : ''}
      <div class="mod-seq-header">
        <h3>Structured Sequence</h3>
        <span>Winter 2026 Registry</span>
      </div>
      <div class="mod-seq-list">${cardsHtml}</div>
      <div class="mod-archive-banner">
        <div class="mod-archive-left">
          <span class="mod-archive-ico" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </span>
          <div>
            <strong>Recorded Lectures &amp; Program Documents</strong>
            <small>Session archives &amp; downloadable syllabus guides</small>
          </div>
        </div>
        <button type="button" class="mod-notes-btn" onclick="switchModule('materials')">
          View Recorded Videos &rarr;
        </button>
      </div>
    `;
  } catch (err) {
    if (box) box.innerHTML = `<div class="dash-module"><p class="msg err" style="margin:0;">${err.message}</p></div>`;
  }
}

// ===================================================================
// MODULE 3: RECORDED VIDEOS (REAL DB RECORDINGS OR HONEST EMPTY STATE)
// ===================================================================
function getWatchedSessionIds() {
  try { return new Set(JSON.parse(localStorage.getItem('pgi_watched_sessions') || '[]')); }
  catch { return new Set(); }
}

function saveWatchedSessionId(id) {
  const set = getWatchedSessionIds();
  set.add(id);
  try { localStorage.setItem('pgi_watched_sessions', JSON.stringify([...set])); } catch {}
}

function openLecturePlayer(sessionId) {
  const recs = cachedMaterialsPayload?.recordings || [];
  const rec = recs.find(r => r.id === sessionId);
  if (!rec) return;
  activePlayerSessionId = sessionId;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('vp-tag', rec.sessionNumber || 'RECORDING');
  setText('vp-title', rec.title);
  setText('vp-meta', [rec.instructor, rec.recordedDate, rec.duration].filter(Boolean).join(' · '));
  setText('vp-summary', rec.summary || 'Recorded cohort session.');

  const embedWrap = document.getElementById('vp-embed-wrap');
  const iframeEl = document.getElementById('vp-iframe');
  const fallbackBox = document.getElementById('vp-fallback-box');
  const ytLink = document.getElementById('vp-yt-link');
  if (rec.embedUrl && embedWrap && iframeEl) {
    iframeEl.src = rec.embedUrl;
    embedWrap.classList.remove('hidden');
    if (fallbackBox) fallbackBox.classList.add('hidden');
  } else {
    if (iframeEl) iframeEl.src = '';
    if (embedWrap) embedWrap.classList.add('hidden');
    if (fallbackBox) fallbackBox.classList.remove('hidden');
  }
  if (ytLink) {
    if (rec.url) {
      ytLink.href = rec.url;
      ytLink.classList.remove('hidden');
    } else {
      ytLink.classList.add('hidden');
    }
  }

  const chBox = document.getElementById('vp-chapters');
  if (chBox) {
    chBox.innerHTML = (rec.chapters || []).map(c =>
      `<span style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.18);padding:4px 10px;border-radius:999px;font-size:0.74rem;color:#F8FAFC;">${c}</span>`
    ).join('');
  }
  document.getElementById('vidPlayerModal')?.classList.remove('hidden');
}

function closeLecturePlayer() {
  const iframeEl = document.getElementById('vp-iframe');
  if (iframeEl) iframeEl.src = '';
  document.getElementById('vidPlayerModal')?.classList.add('hidden');
  activePlayerSessionId = null;
}

function markCurrentSessionWatched() {
  if (!activePlayerSessionId) return;
  saveWatchedSessionId(activePlayerSessionId);
  closeLecturePlayer();
  renderMaterialsView();
}

function renderMaterialsView() {
  if (!cachedMaterialsPayload) return;
  const watchedIds = getWatchedSessionIds();
  const query = String(document.getElementById('vid-search')?.value || '').trim().toLowerCase();
  const filter = String(document.getElementById('vid-filter')?.value || 'all');

  const rawRecs = (cachedMaterialsPayload.recordings || []).map(r => {
    const forcedWatched = watchedIds.has(r.id);
    const status = forcedWatched ? 'watched' : (r.status || 'new');
    const progressPct = forcedWatched ? 100 : Number(r.progressPct || 0);
    return { ...r, status, progressPct };
  });

  const totalSessions = rawRecs.length;
  const watchedCount = rawRecs.filter(r => r.status === 'watched').length;
  const watchPct = totalSessions ? Math.round((watchedCount / totalSessions) * 100) : 0;
  const latest = rawRecs[0] || null;

  const kpiBox = document.getElementById('vid-kpi-grid');
  if (kpiBox) {
    kpiBox.innerHTML = `
      <div class="mod-kpi-card">
        <div>
          <div class="mod-kpi-top">
            <span>Recorded Sessions</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--hub-green);" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </div>
          <div style="font-family:'Space Grotesk',sans-serif;font-size:1.35rem;font-weight:700;color:var(--hub-navy);margin:10px 0 4px;">${totalSessions} Uploaded</div>
        </div>
        <div class="mod-kpi-foot-row">
          <span>${cachedMaterialsPayload.track || 'Winter Cohort'}</span>
          <strong>${totalSessions ? 'Available' : 'Awaiting Cohort'}</strong>
        </div>
      </div>

      <div class="mod-kpi-card">
        <div>
          <div class="mod-kpi-top">
            <span>Sessions Watched</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--hub-slate);" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div style="font-family:'Space Grotesk',sans-serif;font-size:1.35rem;font-weight:700;color:var(--hub-navy);margin:10px 0 8px;">${watchedCount} of ${totalSessions}</div>
          <div class="hub-bar-track"><div class="hub-bar-fill" style="width:${watchPct}%;"></div></div>
        </div>
        <div class="mod-kpi-foot-row">
          <span>Completion</span>
          <strong>${watchPct}% Watched</strong>
        </div>
      </div>

      <div class="mod-kpi-card">
        <div>
          <div class="mod-kpi-top">
            <span>Latest Session</span>
            <span class="mod-num-tag">${latest ? 'NEW' : 'PENDING'}</span>
          </div>
          <div style="font-family:'Space Grotesk',sans-serif;font-size:1.05rem;font-weight:700;color:var(--hub-navy);margin:10px 0 4px;">${latest?.title || 'No sessions uploaded yet'}</div>
        </div>
        <div class="mod-kpi-foot-row">
          <span>${latest?.recordedDate || 'Published after live session'}</span>
          <strong>${latest ? 'Ready' : 'Upcoming'}</strong>
        </div>
      </div>
    `;
  }

  const filtered = rawRecs.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (query) {
      const hay = `${r.title} ${r.instructor || ''} ${r.summary || ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const countBadge = document.getElementById('vid-count-badge');
  if (countBadge) countBadge.textContent = `${filtered.length} Session${filtered.length === 1 ? '' : 's'} Uploaded`;

  const listBox = document.getElementById('materials-list');
  if (listBox) {
    if (!filtered.length) {
      listBox.innerHTML = `
        <div class="dash-module" style="text-align:center;padding:28px 20px;">
          <h3 style="font-family:'Space Grotesk',sans-serif;font-size:1.05rem;color:var(--hub-navy);margin:0 0 6px;">No Recorded Videos Uploaded Yet</h3>
          <p style="font-size:0.86rem;color:var(--hub-muted);max-width:480px;margin:0 auto;">
            Recorded sessions for <strong>${cachedMaterialsPayload.track || 'your cohort'}</strong> will appear here once uploaded after your live classes. You can access the official curriculum documents below in the meantime.
          </p>
        </div>
      `;
    } else {
      listBox.innerHTML = filtered.map(r => {
        const isWatched = r.status === 'watched';
        return `
          <article class="vid-session-card">
            <div class="vid-thumb" onclick="openLecturePlayer('${r.id}')" role="button" tabindex="0"${r.thumbnailUrl ? ` style="background:url('${escHtml(r.thumbnailUrl)}') center/cover no-repeat;"` : ''}>
              <span class="vid-play-circle"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="8 5 19 12 8 19 8 5"/></svg></span>
              <span class="vid-dur-badge">${r.duration || 'HD'}</span>
            </div>
            <div class="vid-session-body">
              <div class="vid-tags-row">
                <span class="vid-sess-tag">${r.sessionNumber || 'SESSION'}</span>
                <span class="vid-date-txt">${r.recordedDate || ''}</span>
                ${isWatched ? '<span class="vid-status-pill watched">Watched</span>' : '<span class="vid-status-pill new">Available</span>'}
              </div>
              <h4 class="vid-session-title">${r.title}</h4>
              <div class="vid-meta-line">
                ${r.instructor ? `<span class="vid-meta-item">${r.instructor}</span>` : ''}
              </div>
            </div>
            <button type="button" class="vid-action-btn ${isWatched ? 'outline' : 'primary'}" onclick="openLecturePlayer('${r.id}')">
              ${isWatched ? 'Rewatch Video' : 'Watch Video'}
            </button>
          </article>
        `;
      }).join('');
    }
  }

  const docsGrid = document.getElementById('materials-docs-grid');
  if (docsGrid) {
    const flatDocs = [];
    (cachedMaterialsPayload.categories || []).forEach(cat => {
      (cat.items || []).forEach(item => { if (item.url) flatDocs.push(item); });
    });
    docsGrid.innerHTML = flatDocs.map(d => `
      <div class="hub-spec-box" style="display:flex;flex-direction:column;justify-content:space-between;gap:10px;background:#fff;border:1px solid var(--hub-line);padding:14px;">
        <div>
          <span class="stat-badge blue">${String(d.type || 'doc').toUpperCase()}</span>
          <h4 style="font-size:0.9rem;color:var(--hub-navy);margin:8px 0 4px;">${d.title}</h4>
          <p style="font-size:0.78rem;color:var(--hub-muted);margin:0;">${d.description || ''}</p>
        </div>
        <a href="${d.url}" target="_blank" class="mod-notes-btn" style="text-decoration:none;justify-content:center;">Access Resource &rarr;</a>
      </div>
    `).join('');
  }
}

async function loadMaterials() {
  const listBox = document.getElementById('materials-list');
  if (listBox) listBox.innerHTML = renderHubLoader('Loading recordings…');

  const sEl = document.getElementById('vid-search');
  const fEl = document.getElementById('vid-filter');
  if (sEl && !sEl.dataset.bound) { sEl.dataset.bound = '1'; sEl.addEventListener('input', renderMaterialsView); }
  if (fEl && !fEl.dataset.bound) { fEl.dataset.bound = '1'; fEl.addEventListener('change', renderMaterialsView); }

  try {
    const res = await fetch('/api/student/materials', { headers: getHeaders() });
    if (!res.ok) throw new Error('Materials service unavailable');
    cachedMaterialsPayload = await res.json();
    renderMaterialsView();
  } catch (err) {
    if (listBox) listBox.innerHTML = `<div class="dash-module"><p class="msg err" style="margin:0;">${err.message}</p></div>`;
  }
}

// ===================================================================
// MODULE 4: SUBMISSIONS (STITCH WORKBENCH + ALL SUBMISSIONS LIST)
// ===================================================================
let cachedAssignmentsList = [];
let activeAssignmentId = null;
let assignmentsViewMode = 'detail';

function safeHref(url) {
  const clean = String(url || '').trim();
  return /^https?:\/\//i.test(clean) ? escHtml(clean) : '#';
}

function formatShortDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function statusMeta(status) {
  if (status === 'reviewed') return { cls: 'reviewed', label: 'Reviewed', evalPill: 'REVIEWED' };
  if (status === 'submitted') return { cls: 'submitted', label: 'Submitted', evalPill: 'SUBMITTED FOR REVIEW' };
  if (status === 'draft') return { cls: 'draft', label: 'Draft Saved', evalPill: 'DRAFT IN PROGRESS' };
  return { cls: 'pending', label: 'Pending', evalPill: 'PENDING SUBMISSION' };
}

async function loadAssignments(preserveMsg = false) {
  const listBox = document.getElementById('assignments-list');
  if (listBox && !cachedAssignmentsList.length) {
    listBox.innerHTML = renderHubLoader('Loading submissions…');
  }

  try {
    const res = await fetch('/api/student/assignments', { headers: getHeaders() });
    if (!res.ok) throw new Error('Submissions service unavailable');
    const list = await res.json();
    cachedAssignmentsList = Array.isArray(list) ? list : [];

    if (!cachedAssignmentsList.length) {
      if (listBox) listBox.innerHTML = '<div class="dash-module"><p style="margin:0;color:var(--hub-muted);">No deliverables configured yet.</p></div>';
      return;
    }

    if (!activeAssignmentId || !cachedAssignmentsList.some(t => t.id === activeAssignmentId)) {
      const pick = cachedAssignmentsList.find(t => t.status === 'draft')
        || cachedAssignmentsList.find(t => t.status === 'pending')
        || cachedAssignmentsList[cachedAssignmentsList.length - 1];
      activeAssignmentId = pick.id;
    }

    renderSubmissionsList();
    renderSubmissionWorkbench(activeAssignmentId, preserveMsg);

    if (assignmentsViewMode === 'list') {
      showSubmissionsList(false);
    } else {
      openSubmissionDetail(activeAssignmentId, false, preserveMsg);
    }
  } catch (err) {
    if (listBox) listBox.innerHTML = `<div class="dash-module"><p class="msg err" style="margin:0;">${escHtml(err.message)}</p></div>`;
    const msgEl = document.getElementById('asg-form-msg');
    if (msgEl && !preserveMsg) setMsg('asg-form-msg', err.message, false);
  }
}

function showSubmissionsList(shouldScroll = true) {
  assignmentsViewMode = 'list';
  const det = document.getElementById('asg-detail-view');
  const lst = document.getElementById('asg-list-view');
  if (det) det.classList.add('hidden');
  if (lst) lst.classList.remove('hidden');
  if (shouldScroll) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

function openSubmissionDetail(taskId, shouldScroll = true, preserveMsg = false) {
  activeAssignmentId = taskId;
  assignmentsViewMode = 'detail';
  renderSubmissionWorkbench(taskId, preserveMsg);
  const det = document.getElementById('asg-detail-view');
  const lst = document.getElementById('asg-list-view');
  if (lst) lst.classList.add('hidden');
  if (det) det.classList.remove('hidden');
  if (shouldScroll) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

function openFirstPendingSubmission() {
  if (!cachedAssignmentsList.length) return;
  const pick = cachedAssignmentsList.find(t => t.status === 'draft')
    || cachedAssignmentsList.find(t => t.status === 'pending')
    || cachedAssignmentsList[0];
  openSubmissionDetail(pick.id);
}

function renderSubmissionsList() {
  const listBox = document.getElementById('assignments-list');
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  const total = cachedAssignmentsList.length || 4;
  const doneCount = cachedAssignmentsList.filter(a => a.status === 'submitted' || a.status === 'reviewed').length;
  const draftCount = cachedAssignmentsList.filter(a => a.status === 'draft').length;
  const reviewedCount = cachedAssignmentsList.filter(a => a.status === 'reviewed').length;
  const cap = cachedAssignmentsList.find(a => a.id === 'capstone');
  const pct = Math.round((doneCount / total) * 100);

  setText('asg-kpi-done', `${doneCount} of ${total}`);
  const bar = document.getElementById('asg-kpi-bar');
  if (bar) bar.style.width = `${pct}%`;
  setText('asg-kpi-done-sub', doneCount === total ? 'All completed' : `${pct}% complete`);
  setText('asg-kpi-draft', `${draftCount} Draft${draftCount === 1 ? '' : 's'}`);
  setText('asg-kpi-rev-count', `${reviewedCount} mentor review${reviewedCount === 1 ? '' : 's'}`);
  setText('asg-kpi-capstone', cap ? statusMeta(cap.status).label : 'Pending');
  setText('asg-kpi-track-foot', currentStudent?.domainName || 'Cohort Track');

  if (!listBox) return;

  listBox.innerHTML = cachedAssignmentsList.map((a, idx) => {
    const meta = statusMeta(a.status);
    const isNext = a.id === activeAssignmentId;
    const isSub = a.status === 'submitted' || a.status === 'reviewed';
    const hasDemo = Boolean(a.demo_url && /^https?:\/\//i.test(a.demo_url));
    const hasRepo = Boolean(a.submission_url && /^https?:\/\//i.test(a.submission_url));

    return `
      <div class="mod-seq-card ${isNext ? 'is-active' : ''}">
        <div class="mod-seq-main">
          <div class="mod-seq-left">
            <div class="mod-seq-ico ${isSub ? 'done' : (a.status === 'draft' ? 'active' : '')}">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                ${isSub
                  ? '<polyline points="20 6 9 17 4 12"/>'
                  : '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'}
              </svg>
            </div>
            <div>
              <div class="mod-seq-meta-row">
                <span class="mod-num-tag">${escHtml(a.code || ('TASK 0' + (idx + 1)))}</span>
                <span class="asg-state-badge ${meta.cls}">${meta.label}</span>
                <span style="font-size:0.74rem;color:var(--hub-muted);font-weight:600;">${escHtml(a.dueLabel || '')}</span>
              </div>
              <h4 class="mod-seq-title">${escHtml(a.title)}</h4>
              <p class="mod-seq-desc">${escHtml(a.description || '')}</p>
              ${hasRepo ? `<div style="margin-top:8px;font-size:0.76rem;color:var(--hub-green);font-weight:600;">Repo: <a href="${safeHref(a.submission_url)}" target="_blank" rel="noopener" style="color:var(--hub-green);text-decoration:underline;">${escHtml(a.submission_url)}</a></div>` : ''}
              ${hasDemo ? `<div style="margin-top:3px;font-size:0.75rem;color:var(--hub-blue);font-weight:600;">Demo: <a href="${safeHref(a.demo_url)}" target="_blank" rel="noopener" style="color:var(--hub-blue);text-decoration:underline;">${escHtml(a.demo_url)}</a></div>` : ''}
              ${a.feedback ? `<div style="margin-top:6px;padding:7px 10px;border-radius:8px;background:#F8FAFC;border:1px solid var(--hub-line);font-size:0.76rem;color:var(--hub-navy);"><strong>Mentor Feedback${a.score != null ? ` (${a.score}/${a.max_score || 100})` : ''}:</strong> ${escHtml(a.feedback)}</div>` : ''}
            </div>
          </div>

          <div class="mod-seq-right">
            <button type="button" onclick="openSubmissionDetail('${escHtml(a.id)}')" class="${isSub ? 'mod-notes-btn' : 'hub-btn-green'}">
              ${isSub ? 'Edit Submission' : (a.status === 'draft' ? 'Resume Draft →' : 'Open Workbench →')}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderSubmissionWorkbench(taskId, preserveMsg = false) {
  const task = cachedAssignmentsList.find(t => t.id === taskId) || cachedAssignmentsList[0];
  if (!task) return;

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const meta = statusMeta(task.status);
  const trackName = currentStudent?.domainName || task.track || 'Cohort Track';

  const tabsEl = document.getElementById('asg-milestone-tabs');
  if (tabsEl) {
    tabsEl.innerHTML = cachedAssignmentsList.map((item, i) => {
      const shortLbl = item.id === 'capstone' ? 'Final Capstone' : `Milestone 0${i + 1}`;
      const isAct = item.id === task.id;
      return `<button type="button" class="asg-ms-tab ${isAct ? 'active' : ''}" onclick="openSubmissionDetail('${escHtml(item.id)}')">${shortLbl}</button>`;
    }).join('');
  }

  setText('asg-det-code', `${task.code || 'SUBMISSION'} // SUBMISSION`);
  setText('asg-det-cohort', currentStudent?.batchName || 'Winter Cohort 2026');
  setText('asg-det-title', task.title);
  setText('asg-det-desc', task.description || 'Provide your public code repository and active deployment URL for mentor evaluation.');
  setText('asg-det-window', `Window: ${task.dueLabel || 'Cohort Schedule'}`);
  setText('asg-det-track', trackName);
  setText('asg-spec-track', trackName);
  setText('asg-sub-student-id', `${currentStudent?.studentId || '—'}${currentStudent?.name ? ' · ' + currentStudent.name : ''}`);

  const stateBadge = document.getElementById('asg-det-state');
  if (stateBadge) {
    stateBadge.className = `asg-state-badge ${meta.cls}`;
    stateBadge.textContent = meta.label;
  }
  const updatedEl = document.getElementById('asg-det-updated');
  if (updatedEl) {
    updatedEl.textContent = task.submittedAt ? `Updated ${formatShortDate(task.submittedAt)}` : '';
  }

  const repoInp = document.getElementById('asg-repo-url');
  const branchSel = document.getElementById('asg-branch');
  const commitInp = document.getElementById('asg-commit');
  const demoInp = document.getElementById('asg-demo-url');
  const notesInp = document.getElementById('asg-notes');

  if (repoInp) repoInp.value = task.submission_url || '';
  if (branchSel) branchSel.value = ['main', 'master', 'develop', 'production'].includes(task.branch) ? task.branch : 'main';
  if (commitInp) commitInp.value = task.commit_ref || '';
  if (demoInp) demoInp.value = task.demo_url || '';
  if (notesInp) notesInp.value = task.notes || '';

  const submitBtn = document.getElementById('asg-btn-submit');
  if (submitBtn) {
    submitBtn.innerHTML = (task.status === 'submitted' || task.status === 'reviewed')
      ? 'Update Submission &rarr;'
      : 'Submit Assignment &rarr;';
  }

  if (!preserveMsg) {
    const msgEl = document.getElementById('asg-form-msg');
    if (msgEl) { msgEl.textContent = ''; msgEl.className = ''; }
  }

  updateSubmissionLiveBadges();

  // Evaluation status panel (100% real fields only)
  const evalBadge = document.getElementById('asg-eval-status-badge');
  if (evalBadge) {
    evalBadge.className = `asg-state-badge ${meta.cls}`;
    evalBadge.textContent = meta.evalPill;
  }

  const evalList = document.getElementById('asg-eval-list');
  if (evalList) {
    const hasRepo = Boolean(task.submission_url && /^https?:\/\//i.test(task.submission_url));
    const hasDemo = Boolean(task.demo_url && /^https?:\/\//i.test(task.demo_url));
    const isReviewed = task.status === 'reviewed';
    const isSubmitted = task.status === 'submitted' || isReviewed;

    const evalRows = [
      {
        done: hasRepo && isSubmitted,
        title: 'Repository Link Submission',
        sub: hasRepo
          ? `<a href="${safeHref(task.submission_url)}" target="_blank" rel="noopener" style="color:var(--hub-green);text-decoration:underline;">${escHtml(task.submission_url)}</a>${task.branch ? ` (${escHtml(task.branch)})` : ''}`
          : 'No public GitHub link submitted yet',
        rightTop: isSubmitted ? 'Submitted' : (task.status === 'draft' ? 'Draft' : 'Pending'),
        rightSub: task.submittedAt ? formatShortDate(task.submittedAt) : 'Awaiting submit'
      },
      {
        done: hasDemo,
        title: 'Live Deployment / Demo Endpoint',
        sub: hasDemo
          ? `<a href="${safeHref(task.demo_url)}" target="_blank" rel="noopener" style="color:var(--hub-blue);text-decoration:underline;">${escHtml(task.demo_url)}</a>`
          : 'Optional live preview or demo link not added',
        rightTop: hasDemo ? 'Attached' : 'Optional',
        rightSub: hasDemo ? 'HTTPS Link' : '—'
      },
      {
        done: isReviewed,
        title: 'Mentor Review & Evaluation',
        sub: isReviewed
          ? escHtml(task.feedback || 'Evaluation completed by cohort mentor.')
          : (isSubmitted ? 'Queued for cohort mentor review' : 'Submit deliverable to queue mentor review'),
        rightTop: task.score != null ? `${task.score} / ${task.max_score || 100}` : (isSubmitted ? 'In Review' : 'Pending'),
        rightSub: isReviewed ? 'Evaluated' : 'Not graded yet'
      }
    ];

    evalList.innerHTML = evalRows.map(r => `
      <div class="asg-eval-row">
        <div class="asg-eval-left">
          <span class="asg-eval-ico ${r.done ? 'done' : 'wait'}" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              ${r.done ? '<polyline points="20 6 9 17 4 12"/>' : '<circle cx="12" cy="12" r="7"/>'}
            </svg>
          </span>
          <div>
            <strong>${r.title}</strong>
            <small>${r.sub}</small>
          </div>
        </div>
        <div class="asg-eval-right">
          <div>${escHtml(r.rightTop)}</div>
          <div style="font-weight:500;color:var(--hub-muted);font-size:0.71rem;">${escHtml(r.rightSub)}</div>
        </div>
      </div>
    `).join('');
  }

  // Evaluator Sidebar Card (strictly real DB mentor or honest pending state)
  const mentorBox = document.getElementById('asg-mentor-box');
  if (mentorBox) {
    const m = currentStudent?.assignedMentorDetails;
    if (m && m.name) {
      mentorBox.innerHTML = `
        <div class="asg-card-head" style="margin-bottom:12px;">
          <h3>Assigned Evaluator</h3>
          <span class="asg-state-badge submitted">Assigned</span>
        </div>
        <div class="hub-mentor-row" style="margin-bottom:14px;">
          <div class="hub-mentor-av">${escHtml(initialsOf(m.name))}</div>
          <div>
            <strong style="display:block;font-size:0.9rem;color:var(--hub-navy);">${escHtml(m.name)}</strong>
            <small style="display:block;font-size:0.76rem;color:var(--hub-slate);">${escHtml(m.title || m.domain || 'Cohort Mentor')}</small>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button type="button" class="mod-notes-btn" style="width:100%;justify-content:center;" onclick="switchModule('support')">Ask Mentor / Support</button>
          <button type="button" class="asg-btn-draft" style="width:100%;font-size:0.76rem;padding:7px;" onclick="switchModule('mentors')">View Mentors Directory</button>
        </div>
      `;
    } else {
      mentorBox.innerHTML = `
        <div class="asg-card-head" style="margin-bottom:12px;">
          <h3>Assigned Evaluator</h3>
          <span class="asg-state-badge pending">Unassigned</span>
        </div>
        <div class="hub-mentor-row" style="margin-bottom:14px;">
          <div class="hub-mentor-av unassigned">?</div>
          <div>
            <strong style="display:block;font-size:0.9rem;color:var(--hub-navy);">Pending Assignment</strong>
            <small style="display:block;font-size:0.76rem;color:var(--hub-muted);">A mentor from your track will be assigned to evaluate cohort submissions.</small>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button type="button" class="mod-notes-btn" style="width:100%;justify-content:center;" onclick="switchModule('support')">Ask Support Team</button>
          <button type="button" class="asg-btn-draft" style="width:100%;font-size:0.76rem;padding:7px;" onclick="switchModule('mentors')">View Mentors Directory</button>
        </div>
      `;
    }
  }
}

function updateSubmissionLiveBadges() {
  const repoVal = String(document.getElementById('asg-repo-url')?.value || '').trim();
  const demoVal = String(document.getElementById('asg-demo-url')?.value || '').trim();
  const commitVal = String(document.getElementById('asg-commit')?.value || '').trim();

  const repoBadge = document.getElementById('asg-repo-badge');
  if (repoBadge) {
    if (!repoVal) {
      repoBadge.className = 'asg-live-pill muted';
      repoBadge.textContent = 'REQUIRED';
    } else if (/^https:\/\/\S+\.\S+/i.test(repoVal)) {
      repoBadge.className = 'asg-live-pill ok';
      repoBadge.textContent = 'VALID HTTPS';
    } else if (/^http:\/\/\S+/i.test(repoVal)) {
      repoBadge.className = 'asg-live-pill ok';
      repoBadge.textContent = 'VALID URL';
    } else {
      repoBadge.className = 'asg-live-pill warn';
      repoBadge.textContent = 'INVALID URL';
    }
  }

  const demoBadge = document.getElementById('asg-demo-badge');
  if (demoBadge) {
    if (!demoVal) {
      demoBadge.className = 'asg-live-pill muted';
      demoBadge.textContent = 'OPTIONAL';
    } else if (/^https?:\/\/\S+\.\S+/i.test(demoVal)) {
      demoBadge.className = 'asg-live-pill ok';
      demoBadge.textContent = /^https:\/\//i.test(demoVal) ? 'VALID HTTPS' : 'VALID URL';
    } else {
      demoBadge.className = 'asg-live-pill warn';
      demoBadge.textContent = 'INVALID URL';
    }
  }

  const commitBadge = document.getElementById('asg-commit-badge');
  if (commitBadge) {
    if (!commitVal) {
      commitBadge.className = 'asg-live-pill muted';
      commitBadge.textContent = 'OPTIONAL';
    } else {
      commitBadge.className = 'asg-live-pill ok';
      commitBadge.textContent = 'SET';
    }
  }
}

async function submitActiveAssignment(isDraft) {
  if (!activeAssignmentId) return;
  const repoUrl = String(document.getElementById('asg-repo-url')?.value || '').trim();
  const branch = String(document.getElementById('asg-branch')?.value || 'main').trim();
  const commitRef = String(document.getElementById('asg-commit')?.value || '').trim();
  const demoUrl = String(document.getElementById('asg-demo-url')?.value || '').trim();
  const notes = String(document.getElementById('asg-notes')?.value || '').trim();

  if (!isDraft && !repoUrl) {
    return setMsg('asg-form-msg', 'Public GitHub repository URL is required to submit.', false);
  }
  if (isDraft && !repoUrl && !demoUrl && !notes) {
    return setMsg('asg-form-msg', 'Enter a repository URL, demo link, or notes before saving a draft.', false);
  }
  if (repoUrl && !/^https?:\/\/\S+/i.test(repoUrl)) {
    return setMsg('asg-form-msg', 'Repository URL must start with http:// or https://', false);
  }
  if (demoUrl && !/^https?:\/\/\S+/i.test(demoUrl)) {
    return setMsg('asg-form-msg', 'Live demo URL must start with http:// or https://', false);
  }

  const draftBtn = document.getElementById('asg-btn-draft');
  const submitBtn = document.getElementById('asg-btn-submit');
  if (draftBtn) draftBtn.disabled = true;
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch(`/api/student/assignments/${encodeURIComponent(activeAssignmentId)}/submit`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        submissionUrl: repoUrl || null,
        demoUrl: demoUrl || null,
        branch,
        commitRef: commitRef || null,
        notes: notes || null,
        isDraft: Boolean(isDraft)
      })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Submission failed');

    setMsg('asg-form-msg', d.message || (isDraft ? 'Draft saved.' : 'Submission recorded.'), true);
    await loadAssignments(true);

    // Refresh Overview KPI counts silently
    try {
      const dashRes = await fetch('/api/student/dashboard', { headers: getHeaders() });
      if (dashRes.ok) {
        const dash = await dashRes.json();
        if (dash?.telemetry) {
          currentStudent = dash.student;
          currentTelemetry = dash.telemetry;
          renderStudentInfo(dash.student, dash.telemetry);
        }
      }
    } catch {}
  } catch (err) {
    setMsg('asg-form-msg', err.message, false);
  } finally {
    if (draftBtn) draftBtn.disabled = false;
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ===================================================================
// MODULE 5: MENTORS (COHORT MENTORS & ADVISORS - REAL DB DIRECTORY)
// ===================================================================
function askMentorQuestion(mentorName, mentorDomain) {
  switchModule('support');
  const subj = document.getElementById('supp-subject');
  const cat = document.getElementById('supp-category');
  const msg = document.getElementById('supp-message');
  if (cat) cat.value = 'academic';
  if (subj) subj.value = `Mentor Query (${mentorName}${mentorDomain ? ' · ' + mentorDomain : ''})`;
  if (msg) {
    msg.placeholder = `Write your technical or cohort question for ${mentorName}…`;
    msg.focus();
  }
}

async function loadMentors() {
  const box = document.getElementById('mentors-container');
  const activeCountEl = document.getElementById('mentors-active-count');
  const advCohortEl = document.getElementById('mentors-adv-cohort');
  const batchPill = document.getElementById('mentors-batch-pill');
  if (!box) return;
  box.innerHTML = renderHubLoader('Loading mentors…');

  try {
    const res = await fetch('/api/student/mentors', { headers: getHeaders() });
    if (!res.ok) throw new Error('Mentors directory unavailable');
    const d = await res.json();

    const mentors = Array.isArray(d.mentors) ? d.mentors : [];
    const batchName = d.batchName || 'Winter Cohort 2026';

    if (activeCountEl) {
      activeCountEl.textContent = `${mentors.length} Active Mentor${mentors.length === 1 ? '' : 's'} Available`;
    }
    if (advCohortEl) {
      advCohortEl.textContent = `${batchName.toUpperCase()} // ADVISORY`;
    }
    if (batchPill) {
      batchPill.textContent = `${batchName} · ${d.mode || 'Online'}${d.timings ? ' · ' + d.timings : ''}`;
    }

    const assigned = d.assignedMentor;
    const assignedBanner = assigned
      ? `
        <div class="men-assigned-strip">
          <div>
            <span class="men-tag primary" style="margin-bottom:4px;">Your Assigned Mentor</span>
            <strong style="display:block;font-size:0.95rem;color:var(--hub-navy);margin-top:4px;">${escHtml(assigned.name)}</strong>
            <small style="font-size:0.79rem;color:var(--hub-slate);">${escHtml(assigned.title || '')}${assigned.domain ? ' · ' + escHtml(assigned.domain) : ''}</small>
          </div>
          <button type="button" class="hub-btn-green" style="padding:8px 14px;font-size:0.78rem;" onclick="askMentorQuestion('${escHtml(assigned.name)}', '${escHtml(assigned.domain || '')}')">Ask Assigned Mentor</button>
        </div>
      `
      : `
        <div class="men-assigned-strip pending">
          <div>
            <strong style="font-size:0.88rem;color:var(--hub-navy);">Assigned Mentor: Pending Allocation</strong>
            <p style="margin:3px 0 0;font-size:0.79rem;color:var(--hub-muted);">
              Your primary mentor from the cohort faculty below will be linked prior to batch start (${escHtml(d.timings || 'Schedule TBA')}).
            </p>
          </div>
          <span class="asg-state-badge pending">Pending</span>
        </div>
      `;

    const cardsHtml = mentors.length
      ? `<div class="men-grid">
          ${mentors.map(m => {
            const isMine = Boolean(d.assignedMentorId && m.id === d.assignedMentorId);
            const domainTags = String(m.domain || '')
              .split(/\s*[&,\/·]\s*/)
              .map(s => s.trim())
              .filter(Boolean);

            return `
              <article class="men-card ${isMine ? 'is-assigned' : ''}">
                <div>
                  <div class="men-card-head">
                    <div class="men-avatar-box">
                      <span>${escHtml(initialsOf(m.name))}</span>
                      <span class="men-status-dot" title="Active Cohort Mentor"></span>
                    </div>
                    <div>
                      <div class="men-name-row">
                        <h3>${escHtml(m.name)}</h3>
                        <span class="men-verified-ico" title="Verified PGI Cohort Mentor" aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2l2.4 2.4 3.4-.3 1.2 3.2 2.9 1.7-.7 3.3 2 2.7-2 2.7.7 3.3-2.9 1.7-1.2 3.2-3.4-.3L12 22l-2.4-2.4-3.4.3-1.2-3.2-2.9-1.7.7-3.3-2-2.7 2-2.7-.7-3.3 2.9-1.7 1.2-3.2 3.4.3L12 2z"/><polyline points="9 12 11.2 14.2 15.5 9.8"/></svg>
                        </span>
                      </div>
                      <p class="men-role-txt">${escHtml(m.title || 'Cohort Mentor')}</p>
                    </div>
                  </div>

                  <div class="men-tags-row" style="margin-top:12px;">
                    ${isMine ? '<span class="men-tag primary">Primary Mentor</span>' : ''}
                    ${domainTags.map(tag => `<span class="men-tag">${escHtml(tag)}</span>`).join('')}
                  </div>

                  <p class="men-bio" style="margin-top:12px;">${escHtml(m.bio || 'Cohort faculty mentor guiding student builds, code reviews, and project milestones.')}</p>
                  ${m.email ? `<div class="men-email">${escHtml(m.email)}</div>` : ''}
                </div>

                <button type="button" class="men-ask-btn" onclick="askMentorQuestion('${escHtml(m.name)}', '${escHtml(m.domain || '')}')">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/></svg>
                  Ask a Question
                </button>
              </article>
            `;
          }).join('')}
        </div>`
      : '<div class="dash-module"><p style="margin:0;color:var(--hub-muted);">No active mentors configured yet.</p></div>';

    box.innerHTML = assignedBanner + cardsHtml;
  } catch (err) {
    box.innerHTML = `<div class="dash-module"><p class="msg err" style="margin:0;">${escHtml(err.message)}</p></div>`;
  }
}

// ===================================================================
// MODULE 6: CERTIFICATES (COMPLETION CREDENTIAL + VALIDATION CHECK)
// ===================================================================
let cachedCertPayload = null;

async function loadCertificatesStatus() {
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  try {
    const res = await fetch('/api/student/certificates', { headers: getHeaders() });
    if (!res.ok) return;
    const d = await res.json();
    cachedCertPayload = d;

    const pill = document.getElementById('cert-status-pill');
    const valBadge = document.getElementById('cert-val-badge');
    const idBadge = document.getElementById('cert-id-badge');
    const desc = document.getElementById('cert-eligibility-desc');
    const urlInput = document.getElementById('cert-val-url');
    const wm = document.getElementById('cert-prev-wm');

    const track = d.title || currentStudent?.domainName || 'Winter Internship & Training Program';
    const batch = d.batchName || currentStudent?.batchName || 'Winter Cohort 2026';
    const name = d.studentName || currentStudent?.name || 'Student';

    setText('cert-hero-pill', `${batch.toUpperCase()} // CREDENTIALS`);
    setText('cert-banner-program', track);
    setText('cert-val-cohort', batch);
    setText('cert-val-hours', `${d.completedHours ?? 0} / ${d.requiredHours ?? 30} hrs · ${d.attendancePct ?? 0}% attendance`);

    // Populate real student details in portrait preview
    setText('cert-prev-name', name);
    setText('cert-prev-desc', 'has successfully completed the Winter Internship and Training Program during the student-mentioned dates with Plant Green Inertia. We appreciate their dedication and wish them success in all future endeavours.');
    setText('cert-prev-no', d.certificateId || 'Pending Issuance');
    setText('cert-prev-date', d.issuedOn ? new Date(d.issuedOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Pending Issuance');

    if (d.issued && d.certificateId) {
      if (wm) wm.classList.add('hidden');
      setText('cert-banner-issuer', 'Issued by Admin');
      if (pill) { pill.textContent = 'Ready for Download'; pill.className = 'cert-ready-badge issued'; }
      if (valBadge) { valBadge.textContent = 'Active & Issued'; valBadge.className = 'asg-state-badge submitted'; }
      setText('cert-val-date', d.issuedOn ? new Date(d.issuedOn).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Issued');
      if (idBadge) idBadge.textContent = d.certificateId;
      if (urlInput) urlInput.value = d.verificationUrl || `https://plantgreeninertia.com/verify/${d.certificateId}`;
      if (desc) desc.textContent = `Credential issued. Verified ${d.completedHours} / ${d.requiredHours} hours (${d.attendancePct}% attendance).`;
    } else {
      if (wm) wm.classList.remove('hidden');
      setText('cert-banner-issuer', d.eligible ? 'Eligible for Issuance' : 'Pending Issuance');
      if (pill) {
        pill.textContent = d.eligible ? 'Eligible — Ready for Admin Issuance' : 'In Progress';
        pill.className = `cert-ready-badge ${d.eligible ? 'eligible' : 'pending'}`;
      }
      if (valBadge) {
        valBadge.textContent = d.eligible ? 'Eligible' : 'In Progress';
        valBadge.className = `asg-state-badge ${d.eligible ? 'draft' : 'pending'}`;
      }
      setText('cert-val-date', 'Pending Admin Issuance');
      if (idBadge) idBadge.textContent = 'Not Issued Yet';
      if (urlInput) urlInput.value = 'Not Issued Yet';
      if (desc) {
        desc.textContent = `Verified training hours logged: ${d.completedHours} / ${d.requiredHours} hours (${d.presentDays || 0} present day(s)). Requires 30 hours and ≥ 75% attendance.`;
      }
    }
  } catch {}
}

async function downloadCertificate() {
  try {
    const res = await fetch('/api/student/certificates', { headers: getHeaders() });
    const d = await res.json();
    if (!d.issued || !d.downloadUrl) {
      setMsg('cert-msg', `Certificate not issued yet. Verified hours logged: ${d.completedHours || 0} / 30 hours (${d.attendancePct || 0}% attendance).`);
      return;
    }

    setMsg('cert-msg', 'Preparing your official certificate PDF…', true);
    const pdfRes = await fetch(d.downloadUrl, { headers: getHeaders() });
    if (!pdfRes.ok) {
      const errJson = await pdfRes.json().catch(() => ({}));
      throw new Error(errJson.error || 'Certificate PDF could not be generated');
    }
    const blob = await pdfRes.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${d.certificateId || 'PGI-Certificate'}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
    setMsg('cert-msg', `Downloaded ${d.certificateId}.pdf`, true);
  } catch (err) {
    setMsg('cert-msg', err.message, false);
  }
}

function openCertFullscreen() {
  const srcCert = document.querySelector('#mod-certificates .cert-stage-frame .cert');
  const modal = document.getElementById('certFullModal');
  const slot = document.getElementById('certFullSlot');
  if (!srcCert || !modal || !slot) return;
  const clone = srcCert.cloneNode(true);
  clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  slot.innerHTML = '';
  slot.appendChild(clone);
  modal.classList.remove('hidden');
}

function closeCertFullscreen() {
  const modal = document.getElementById('certFullModal');
  const slot = document.getElementById('certFullSlot');
  if (modal) modal.classList.add('hidden');
  if (slot) slot.innerHTML = '';
}

function copyCredentialLink() {
  const d = cachedCertPayload;
  if (!d?.issued || !d?.certificateId) {
    return setMsg('cert-msg', 'Public verification URL becomes active once Admin issues your certificate.', false);
  }
  const url = d.verificationUrl || `https://plantgreeninertia.com/verify/${d.certificateId}`;
  navigator.clipboard?.writeText(url)
    .then(() => setMsg('cert-msg', `Copied verification URL: ${url}`, true))
    .catch(() => setMsg('cert-msg', `Verification URL: ${url}`, true));
}

// ===================================================================
// MODULE 7: HELP & SUPPORT + PASSWORD SECURITY
// ===================================================================
function updateSuppAttachmentLabel() {
  const fileInp = document.getElementById('supp-attachment');
  const lbl = document.getElementById('supp-attach-name');
  if (!lbl) return;
  const f = fileInp?.files?.[0];
  if (!f) {
    lbl.textContent = 'Optional — reference file up to 10MB';
    return;
  }
  const kb = Math.max(1, Math.round(f.size / 1024));
  lbl.textContent = `${f.name} (${kb} KB)`;
}

async function loadSupportTickets() {
  const listEl = document.getElementById('supp-tickets-list');
  if (!listEl) return;
  try {
    const res = await fetch('/api/student/support', { headers: getHeaders() });
    if (!res.ok) return;
    const d = await res.json();
    const tickets = Array.isArray(d.tickets) ? d.tickets : [];
    if (!tickets.length) {
      listEl.innerHTML = '';
      return;
    }
    listEl.innerHTML = `
      <div style="border-top:1px solid var(--hub-line);padding-top:12px;">
        <div style="font-size:0.72rem;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--hub-muted);margin-bottom:8px;">
          Recent Session Queries (${tickets.length})
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${tickets.slice(0, 5).map(tk => `
            <div style="background:#F8FAFC;border:1px solid var(--hub-line);border-radius:9px;padding:9px 11px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
              <div>
                <strong style="font-size:0.8rem;color:var(--hub-navy);display:block;">${escHtml(tk.subject)}</strong>
                <small style="font-size:0.72rem;color:var(--hub-muted);">${escHtml(tk.id)} · ${escHtml(tk.category || 'Academic')}${tk.attachmentNote ? ' · ' + escHtml(tk.attachmentNote) : ''}</small>
              </div>
              <span class="asg-state-badge submitted">${escHtml(tk.status || 'Open')}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch {}
}

async function submitSupportTicket() {
  const subject = document.getElementById('supp-subject').value.trim();
  const category = document.getElementById('supp-category').value;
  const message = document.getElementById('supp-message').value.trim();
  const fileObj = document.getElementById('supp-attachment')?.files?.[0];
  const attachmentNote = fileObj ? `${fileObj.name} (${Math.max(1, Math.round(fileObj.size / 1024))} KB)` : null;

  setMsg('supp-msg', 'Submitting ticket…', true);

  try {
    const res = await fetch('/api/student/support', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ subject, category, message, attachmentNote })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Support ticket submission failed');

    setMsg('supp-msg', `Ticket #${d.ticketId} submitted. An academic coordinator will respond shortly.`, true);
    document.getElementById('form-support-ticket').reset();
    updateSuppAttachmentLabel();
    loadSupportTickets();
  } catch (err) {
    setMsg('supp-msg', err.message);
  }
}

async function doChangePassword() {
  const currentPassword = document.getElementById('chg-curr-pw').value;
  const newPassword = document.getElementById('chg-new-pw').value;
  const confPassword = document.getElementById('chg-conf-pw').value;

  if (newPassword !== confPassword) {
    return setMsg('chg-pw-msg', 'New passwords do not match');
  }

  setMsg('chg-pw-msg', 'Updating password…', true);

  try {
    const res = await fetch('/api/student/change-password', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Password change failed');

    setMsg('chg-pw-msg', 'Password successfully updated.', true);
    document.getElementById('form-change-pw').reset();
  } catch (err) {
    setMsg('chg-pw-msg', err.message);
  }
}

async function downloadOfferLetter() {
  try {
    const res = await fetch('/api/offer-letter', { headers: getHeaders() });
    if (!res.ok) throw new Error('Offer letter document unavailable');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url);
  } catch (err) {
    alert(err.message);
  }
}

async function downloadReceipt() {
  try {
    const eid = currentTelemetry?.enrollmentId;
    if (!eid) {
      setMsg('ov-action-msg', 'No completed payment enrollment found for receipt download.');
      return;
    }
    const res = await fetch(`/api/enrollments/${encodeURIComponent(eid)}/receipt.pdf`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Unable to download payment receipt PDF.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PGI-Receipt-${currentStudent?.studentId || 'Winter-2026'}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    alert(err.message);
  }
}

async function downloadReport() {
  try {
    const res = await fetch('/api/student/project-report.pdf', { headers: getHeaders() });
    if (!res.ok) throw new Error('Report PDF generation failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PGI-Project-Report-${currentStudent?.studentId || 'Winter-2026'}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    alert(err.message);
  }
}

window.addEventListener('DOMContentLoaded', initDashboard);
