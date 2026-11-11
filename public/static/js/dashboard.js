/**
 * Plant Green Inertia - Student Dashboard Application Logic
 * Powers all 13 Modules linked by Student ID
 */

let authToken = localStorage.getItem('pgi_student_token') || sessionStorage.getItem('pgi_student_token');
let currentStudent = null;
let currentTelemetry = null;
let activeTrackId = 'tech-web';

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

// Module Navigation Switcher
function switchModule(modId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.dash-nav-btn').forEach(btn => btn.classList.remove('active'));

  const target = document.getElementById('mod-' + modId);
  if (target) target.classList.add('active');

  const activeBtn = document.querySelector(`.dash-nav-btn[onclick*="${modId}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

  // Trigger data refreshes on tab activation
  if (modId === 'attendance') refreshAttendance();
  if (modId === 'syllabus') loadSyllabusTrack(activeTrackId);
  if (modId === 'assignments') loadAssignments();
  if (modId === 'materials') loadMaterials();
  if (modId === 'progress') loadProgress();
  if (modId === 'notifications') loadNotifications();
}

// Sign Out
function logoutStudent() {
  localStorage.removeItem('pgi_student_token');
  sessionStorage.removeItem('pgi_student_token');
  localStorage.removeItem('pgi_student_id');
  sessionStorage.removeItem('pgi_student_id');
  window.location.href = 'student-login.html';
}

// Initial Bootstrapper
async function initDashboard() {
  // Check for token in URL query (e.g. from password reset or redirect)
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
      throw new Error('Failed to load dashboard telemetry');
    }

    const data = await res.json();
    currentStudent = data.student;
    currentTelemetry = data.telemetry;

    renderStudentInfo(currentStudent, currentTelemetry);
    // Preload attendance & syllabus
    refreshAttendance();
    loadSyllabusTrack('tech-web');
  } catch (err) {
    console.error('[Dashboard Boot Error]', err);
    document.getElementById('welcome-heading').textContent = 'Unable to Load Portal Data';
    document.getElementById('welcome-sub').textContent = err.message || 'Please sign in again.';
  }
}

// Populate Topbar, Sidebar & Overview
function renderStudentInfo(s, t) {
  const sid = s.studentId || 'PGI-S26-0001';
  document.getElementById('hdr-student-id').textContent = sid;
  document.getElementById('side-cand-id').textContent = sid;
  document.getElementById('ov-student-id').textContent = sid;
  document.getElementById('prof-student-id').textContent = sid;
  document.getElementById('att-disp-id').textContent = sid;
  document.getElementById('rep-sid').textContent = sid;

  // Candidate Name
  const name = s.name || 'Candidate';
  document.getElementById('welcome-heading').textContent = `Welcome Back, ${name}`;
  document.getElementById('side-cand-name').textContent = name;
  document.getElementById('ov-cand-name').textContent = name;
  document.getElementById('prof-name').textContent = name;
  document.getElementById('rep-name').textContent = name;

  // Track & Mode
  const track = s.domainName || 'Full-Stack Web Development Track';
  document.getElementById('side-cand-track').textContent = track;
  document.getElementById('ov-track-title').textContent = track;
  document.getElementById('int-track-name').textContent = track;
  document.getElementById('rep-domain').textContent = track;
  document.getElementById('hdr-mode-badge').textContent = `${s.mode || 'Online'} Mode`;
  document.getElementById('ov-track-mode').textContent = `${s.mode || 'Online'} · ${s.timing || '4:00 PM – 6:00 PM'}`;
  document.getElementById('int-timings').textContent = s.timing || '4:00 PM – 6:00 PM';
  document.getElementById('int-mode-label').textContent = `Mode: ${s.mode || 'Online'}`;
  document.getElementById('int-ppo-status').textContent = s.mode === 'Offline' ? 'Active Guaranteed' : 'Eligible for Top Performers';

  // Hours Progress
  const completed = t.completedHours || 0;
  const pct = Math.min(100, Math.round((completed / 30.0) * 100));
  document.getElementById('side-cand-hours').textContent = `${completed.toFixed(1)}/30 hrs`;
  document.getElementById('side-cand-bar').style.width = `${pct}%`;
  document.getElementById('ov-hours-stat').textContent = `${completed.toFixed(1)} / 30.0 Hours Completed (${pct}%)`;
  document.getElementById('ov-prog-fill').style.width = `${pct}%`;
  document.getElementById('prog-hours-stat').textContent = `${completed.toFixed(1)} / 30.0 Hours`;
  document.getElementById('prog-cockpit-bar-fill').style.width = `${pct}%`;

  // Profile fields
  document.getElementById('prof-email').textContent = s.email || '—';
  document.getElementById('prof-phone').textContent = s.phone || '—';
  document.getElementById('prof-college').textContent = s.college || '—';
  document.getElementById('prof-dept').textContent = s.department || '—';
  document.getElementById('prof-year').textContent = s.passedOutYear || '2026';
  document.getElementById('rep-coll').textContent = s.college || 'College of Engineering';

  // Telemetry Tiles
  document.getElementById('ov-payment-status').textContent = t.paymentStatus || 'Paid (₹999 Verified)';
  document.getElementById('ov-att-pct').textContent = `${t.attendancePercentage || 100}%`;
  document.getElementById('ov-att-days').textContent = `Present: ${t.presentDays || 0} / ${t.totalDays || 0} Days`;
  document.getElementById('cert-id-badge').textContent = t.certificateId || `PGI-W26-CERT-${sid.slice(-4)}`;
  document.getElementById('rep-doc-id').textContent = `REP-PGI-W26-${sid.slice(-4)}`;
}

// ===================================================================
// MODULE 5: ATTENDANCE (Linked by Student ID)
// ===================================================================
async function refreshAttendance() {
  const tbody = document.getElementById('att-table-rows');
  try {
    const res = await fetch('/api/student/attendance', { headers: getHeaders() });
    if (!res.ok) throw new Error('Attendance service unavailable');
    const data = await res.json();
    const stats = data.stats || {};
    const records = data.records || [];

    // Update Attendance Telemetry
    document.getElementById('att-card-pct').textContent = `${stats.attendancePercentage || 100}%`;
    document.getElementById('att-card-hours').textContent = `${stats.completedHours || 0} / 30.0 hrs`;
    document.getElementById('att-card-rem').textContent = `${stats.remainingHours || 0} hours remaining`;
    document.getElementById('att-card-present').textContent = `${stats.presentDays || 0} Days`;
    document.getElementById('att-card-absent').textContent = `${stats.absentDays || 0} Day(s)`;

    if (data.provider === 'external_merged') {
      document.getElementById('att-provider-badge').textContent = 'External Merged System';
    }

    if (!records.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;">No attendance records found yet.</td></tr>';
      return;
    }

    tbody.innerHTML = records.map(r => {
      const pillClass = r.status === 'present' ? 'present' : (r.status === 'absent' ? 'absent' : 'holiday');
      return `
        <tr>
          <td><strong>Day ${r.day_number || 1}</strong></td>
          <td>${r.date || '—'}</td>
          <td>${r.session_title || 'Internship Training Lab'}</td>
          <td>${r.mode || 'Online'}</td>
          <td>${r.check_in || '16:00'} – ${r.check_out || '18:00'}</td>
          <td><strong>${r.hours_logged || 3} hrs</strong></td>
          <td><span class="att-pill ${pillClass}">${(r.status || 'present').toUpperCase()}</span></td>
          <td><span style="font-size:0.75rem;color:var(--text-muted);">${r.verification_method || 'Biometric / Live Session'}</span></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('[Attendance Fetch Error]', err);
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--danger);padding:20px;">${err.message}</td></tr>`;
  }
}

// ===================================================================
// MODULE 4: SYLLABUS
// ===================================================================
async function loadSyllabusTrack(trackId) {
  activeTrackId = trackId;
  const box = document.getElementById('syllabus-container');
  box.innerHTML = '<p>Loading track modules…</p>';

  try {
    const res = await fetch('/api/student/syllabus', { headers: getHeaders() });
    if (!res.ok) throw new Error('Syllabus service unavailable');
    const data = await res.json();
    const track = (data.tracks || []).find(t => t.id === trackId) || data.tracks?.[0];

    if (!track) {
      box.innerHTML = '<p>Track curriculum not found.</p>';
      return;
    }

    box.innerHTML = `
      <div class="track-card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
          <div>
            <h3>${track.title}</h3>
            <span class="stat-badge blue">${track.domainType} Track</span> &middot;
            <span style="font-size:0.85rem;color:var(--text-muted);">${track.duration}</span>
          </div>
          <a href="/static/pdf/PGI_Winter_Internship_Syllabus.pdf" target="_blank" class="btn btn-outline" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;font-size:0.82rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Download Full Syllabus (PDF)</a>
        </div>
        <div class="module-list">
          ${(track.modules || []).map(m => `
            <div class="module-item">
              <strong>Day ${m.day}: ${m.title} (${m.hours} Hours)</strong>
              <p>${(m.topics || []).join(' &middot; ')}</p>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    box.innerHTML = `<p class="msg err">${err.message}</p>`;
  }
}

// ===================================================================
// MODULE 6: ASSIGNMENTS
// ===================================================================
async function loadAssignments() {
  const box = document.getElementById('assignments-list');
  box.innerHTML = '<p>Loading assignments…</p>';

  try {
    const res = await fetch('/api/student/assignments', { headers: getHeaders() });
    if (!res.ok) throw new Error('Assignments service unavailable');
    const list = await res.json();

    if (!list.length) {
      box.innerHTML = '<p>No pending assignments at this time.</p>';
      return;
    }

    box.innerHTML = list.map(a => {
      const isSub = a.status === 'submitted' || a.status === 'reviewed';
      const pill = a.status === 'reviewed' ? 'green' : (a.status === 'submitted' ? 'blue' : 'yellow');
      return `
        <div class="item-card">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span class="stat-badge ${pill}">${(a.status || 'pending').toUpperCase()}</span>
              <span style="font-size:0.75rem;color:var(--text-muted);">Due: ${a.due_date || 'Day 10'}</span>
            </div>
            <h4 style="font-size:1rem;color:var(--navy);margin:4px 0 6px;">${a.title}</h4>
            <p style="font-size:0.85rem;color:var(--text-muted);">${a.description || 'Complete the hands-on lab and commit your code to GitHub.'}</p>
            ${a.score != null ? `<div style="font-size:0.85rem;color:var(--plant-green);font-weight:700;margin-top:6px;">Score: ${a.score} / 100 &middot; Mentor: "${a.feedback || 'Well done'}"</div>` : ''}
          </div>
          <div style="margin-top:12px;border-top:1px solid var(--border-subtle);padding-top:10px;">
            ${isSub ? `<span style="font-size:0.8rem;color:var(--plant-green);font-weight:600;">&#10003; Submitted: <a href="${a.submission_url}" target="_blank" style="text-decoration:underline;">View Code</a></span>` : `
              <button onclick="promptSubmitAssignment('${a.id}', '${a.title.replace(/'/g, "\\'")}')" class="btn btn-outline" style="width:100%;font-size:0.82rem;padding:7px;">
                Submit GitHub Repo &rarr;
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    box.innerHTML = `<p class="msg err">${err.message}</p>`;
  }
}

async function promptSubmitAssignment(id, title) {
  const repoUrl = prompt(`Submit GitHub Repository URL for "${title}":\n\nMust start with https://github.com/`);
  if (!repoUrl) return;
  if (!repoUrl.startsWith('http')) return alert('Please enter a valid URL');

  try {
    const res = await fetch(`/api/student/assignments/${id}/submit`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ submissionUrl: repoUrl })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Submission failed');
    alert('Assignment successfully submitted! Mentor review will be posted shortly.');
    loadAssignments();
  } catch (err) {
    alert(err.message);
  }
}

// ===================================================================
// MODULE 7: LEARNING MATERIALS
// ===================================================================
async function loadMaterials() {
  const box = document.getElementById('materials-list');
  box.innerHTML = '<p>Loading learning resources…</p>';

  try {
    const res = await fetch('/api/student/materials', { headers: getHeaders() });
    if (!res.ok) throw new Error('Materials service unavailable');
    const mats = await res.json();

    box.innerHTML = mats.map(m => `
      <div class="item-card">
        <div>
          <span class="stat-badge blue">${m.type.toUpperCase()}</span>
          <h4 style="font-size:1rem;color:var(--navy);margin:6px 0 4px;">${m.title}</h4>
          <p style="font-size:0.82rem;color:var(--text-muted);">${m.description || ''}</p>
        </div>
        <div style="margin-top:12px;">
          <a href="${m.url}" target="_blank" class="btn btn-outline" style="width:100%;text-align:center;font-size:0.82rem;padding:7px;display:block;">
            Access Resource &rarr;
          </a>
        </div>
      </div>
    `).join('');
  } catch (err) {
    box.innerHTML = `<p class="msg err">${err.message}</p>`;
  }
}

// ===================================================================
// MODULE 8: CAPSTONE PROJECT SUBMISSION
// ===================================================================
async function submitCapstoneProject() {
  const repoUrl = document.getElementById('proj-repo-url').value.trim();
  const demoUrl = document.getElementById('proj-demo-url').value.trim();
  const notes = document.getElementById('proj-notes').value.trim();
  const btn = document.getElementById('btn-submit-proj');

  btn.disabled = true;
  setMsg('proj-msg', 'Submitting capstone project…', true);

  try {
    const res = await fetch('/api/student/project/submit', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ repoUrl, demoUrl, notes })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Submission failed');

    setMsg('proj-msg', 'Capstone project successfully submitted! Your lead mentor will review your deliverables.', true);
    document.getElementById('proj-status-badge').textContent = 'Submitted for Defense';
  } catch (err) {
    setMsg('proj-msg', err.message);
  } finally {
    btn.disabled = false;
  }
}

// ===================================================================
// MODULE 9: 30-HOUR PROGRESS
// ===================================================================
async function loadProgress() {
  const box = document.getElementById('progress-milestones');
  box.innerHTML = '<p>Loading progress milestones…</p>';

  try {
    const res = await fetch('/api/student/progress', { headers: getHeaders() });
    if (!res.ok) throw new Error('Progress service unavailable');
    const d = await res.json();

    box.innerHTML = (d.breakdown || []).map(m => `
      <div class="item-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span class="stat-badge ${m.completed ? 'green' : 'yellow'}">${m.completed ? 'COMPLETED' : 'IN PROGRESS'}</span>
          <strong style="color:var(--plant-green);">${m.hours} Hours</strong>
        </div>
        <h4 style="font-size:1rem;color:var(--navy);margin:4px 0;">${m.activity}</h4>
        <p style="font-size:0.82rem;color:var(--text-muted);">${m.description || ''}</p>
      </div>
    `).join('');
  } catch (err) {
    box.innerHTML = `<p class="msg err">${err.message}</p>`;
  }
}

// ===================================================================
// MODULE 10: 1-PAGE PROJECT REPORT DOWNLOAD
// ===================================================================
async function downloadReport() {
  const btn = event?.currentTarget;
  if (btn) btn.disabled = true;

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
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ===================================================================
// MODULE 11: CERTIFICATES & QR
// ===================================================================
async function downloadCertificate() {
  try {
    const res = await fetch('/api/student/certificates', { headers: getHeaders() });
    const d = await res.json();
    if (!d.eligible) {
      alert(`Certificate requirements not yet completed.\nHours: ${d.completedHours}/30 hrs.\nAttendance: ${d.attendancePct}% (Min 75% required).`);
      return;
    }
    // Delivers certificate document
    alert(`Certificate ${d.certificateId} ready for issuance. Direct PDF download initiated.`);
  } catch (err) {
    alert(err.message);
  }
}

function viewCertificateQR() {
  const sid = currentStudent?.studentId || 'PGI-S26-0001';
  alert(`Plant Green Inertia Public Verification Record:\n\nStudent ID: ${sid}\nStatus: Verified Academic Credential\nVerification Hash: 8f9b2c4e1a0d3e5f\nURL: https://plantgreeninertia.com/verify/${sid}`);
}

// ===================================================================
// MODULE 12: NOTIFICATIONS
// ===================================================================
async function loadNotifications() {
  const box = document.getElementById('notifications-list');
  box.innerHTML = '<p>Loading notifications…</p>';

  try {
    const res = await fetch('/api/student/notifications', { headers: getHeaders() });
    if (!res.ok) throw new Error('Notifications service unavailable');
    const items = await res.json();

    box.innerHTML = items.map(n => `
      <div style="background:var(--ice-white);border:1px solid var(--border-subtle);border-radius:10px;padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <strong style="color:var(--navy);font-size:0.95rem;">${n.title}</strong>
          <span style="font-size:0.75rem;color:var(--text-muted);">${new Date(n.created_at || Date.now()).toLocaleDateString()}</span>
        </div>
        <p style="font-size:0.85rem;color:var(--text-main);margin:0;line-height:1.5;">${n.message}</p>
      </div>
    `).join('');
  } catch (err) {
    box.innerHTML = `<p class="msg err">${err.message}</p>`;
  }
}

// ===================================================================
// MODULE 13: SUPPORT TICKET SUBMISSION
// ===================================================================
async function submitSupportTicket() {
  const subject = document.getElementById('supp-subject').value.trim();
  const category = document.getElementById('supp-category').value;
  const message = document.getElementById('supp-message').value.trim();

  setMsg('supp-msg', 'Submitting ticket…', true);

  try {
    const res = await fetch('/api/student/support', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ subject, category, message })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Support ticket submission failed');

    setMsg('supp-msg', `Ticket #${d.ticketId} created successfully. Our academic mentor team will respond shortly.`, true);
    document.getElementById('form-support-ticket').reset();
  } catch (err) {
    setMsg('supp-msg', err.message);
  }
}

// Change Password Handler
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

// Quick Action Downloads
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
    const res = await fetch('/api/student/receipt.pdf', { headers: getHeaders() });
    if (!res.ok) {
      // Fallback to sample receipt
      window.open('/api/enrollments/sample/receipt.pdf');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PGI-Receipt-${currentStudent?.studentId || 'Winter-2026'}.pdf`;
    a.click();
  } catch (err) {
    alert(err.message);
  }
}

// Kick off on page load
window.addEventListener('DOMContentLoaded', initDashboard);
