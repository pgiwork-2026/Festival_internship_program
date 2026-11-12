(async () => {
  const $ = id => document.getElementById(id);
  function resetScrollTop() {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    } catch {
      window.scrollTo(0, 0);
    }
    document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }

  const show = id => {
    document.querySelectorAll('main > section, #loading').forEach(e => e.classList.add('hidden'));
    const target = $(id);
    if (target) target.classList.remove('hidden');
    document.body.classList.toggle('auth-stage', id === 's-auth');
    document.body.classList.toggle('exam-fullscreen', id === 's-test');
    if (id !== 's-checkout' && checkoutExpiryInterval) {
      clearInterval(checkoutExpiryInterval);
      checkoutExpiryInterval = null;
    }
    const navPayBtn = $('nav-payment-btn');
    if (navPayBtn) navPayBtn.classList.toggle('hidden', !['s-auth', 's-profile', 's-inst'].includes(id));
    resetScrollTop();
    requestAnimationFrame(() => resetScrollTop());
  };

  function requestExamFullscreen() {
    try {
      if (document.fullscreenEnabled && !document.fullscreenElement) {
        return document.documentElement.requestFullscreen()
          .then(() => { resetScrollTop(); })
          .catch(() => {});
      }
    } catch {}
    return Promise.resolve();
  }
  document.addEventListener('fullscreenchange', () => {
    if (document.body.classList.contains('exam-fullscreen')) {
      resetScrollTop();
      requestAnimationFrame(() => resetScrollTop());
    }
  });

  const msg = (id, text, isOk = false) => {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'msg ' + (isOk ? 'ok' : 'err');
  };

  const DEFAULT_TUITION_PAISE = 999900;
  const inr = p => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const inrDecimal = p => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const escHtml = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const formatDuration = sec => {
    const total = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  };

  let cfg = null;
  let sb = null;
  let token = null;
  let stream = null;
  let micStream = null;
  let attempt = null;
  let currentQIndex = 0;
  let skew = 0;
  let timerInterval = null;
  let couponInterval = null;
  let checkoutExpiryInterval = null;
  let warnings = 0;
  let finishing = false;
  let proctor = null;
  let enrolledFace = false;
  let authModeState = 'register';
  let lastCoupon = null;
  let lastResult = null;
  let currentUser = null;
  let pendingPaymentRedirect = false;
  let manualAuthCompleted = false;

  const VIOLATION_LABELS = {
    blocked_shortcut: 'Blocked keyboard shortcut used',
    multiple_faces: 'More than one person detected',
    no_face: 'Your face is not visible',
    looking_away: 'Your head is turned away from the screen',
    face_mismatch: 'Face does not match verified candidate',
    camera_unavailable: 'Camera unavailable or switched off',
    tab_switch: 'You left the test window or switched tabs',
    fullscreen_exit: 'You exited full-screen mode',
    copy_paste: 'Copy/paste is strictly restricted',
    phone_detected: 'A mobile phone was detected in view',
    looking_down: 'Looked down for extended period',
    noise_detected: 'Sustained voices or background noise detected'
  };

  const isLive = () => !$('s-test').classList.contains('hidden') && !finishing;

  function hasAnyStoredAuth() {
    try {
      if (sessionStorage.getItem('pgi_student_token') || localStorage.getItem('pgi_student_token')) return true;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('sb-') && k.endsWith('-auth-token') && localStorage.getItem(k)) return true;
      }
    } catch {}
    return false;
  }

  let razorpayPromise = null;
  function ensureRazorpay() {
    if (typeof Razorpay !== 'undefined') return Promise.resolve(true);
    if (razorpayPromise) return razorpayPromise;
    razorpayPromise = new Promise(res => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.onload = () => res(typeof Razorpay !== 'undefined');
      s.onerror = () => { razorpayPromise = null; res(false); };
      document.head.appendChild(s);
    });
    return razorpayPromise;
  }

  // Show login immediately if no cached session exists so nav clicks don't stall on external scripts/API config
  const qInit = new URLSearchParams(window.location.search);
  const hasCachedSession = hasAnyStoredAuth();
  if (!hasCachedSession) {
    const qEm = qInit.get('email');
    const qAp = qInit.get('appId');
    if (qInit.get('ref')) {
      try {
        sessionStorage.setItem('pgi_referral', qInit.get('ref'));
        localStorage.setItem('pgi_referral', qInit.get('ref'));
      } catch {}
    }
    if ((qEm || qAp) && $('email') && !$('email').value) {
      $('email').value = qEm || qAp;
    }
    if (qAp) {
      try {
        sessionStorage.setItem('pgi_application_id', qAp);
        localStorage.setItem('pgi_application_id', qAp);
      } catch {}
    }
    setAuthMode(qInit.get('mode') === 'register' ? 'register' : 'login');
    if (qInit.get('mode') !== 'register' && (qAp || qEm)) {
      msg('auth-msg', 'Enter your Date of Birth (DD/MM/YYYY) to verify and proceed to Proctor Check.', true);
    }
    show('s-auth');
  }

  // Initialize configuration immediately; Supabase CDN loads asynchronously so it never blocks first paint
  const initReady = (async () => {
    cfg = await (window.__pgiConfigPromise || fetch('/api/config').then(r => r.json()));
    if (typeof supabase !== 'undefined') {
      sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    }
    return true;
  })().catch(() => false);

  async function ensureSb() {
    if (sb) return sb;
    await initReady;
    if (sb) return sb;
    if (typeof supabase !== 'undefined' && cfg) {
      sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      return sb;
    }
    for (let i = 0; i < 40; i++) {
      if (typeof supabase !== 'undefined') {
        if (!cfg) cfg = await (window.__pgiConfigPromise || fetch('/api/config').then(r => r.json()));
        sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        return sb;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }

  if (hasCachedSession && !window.__pgiBootPromise) {
    const ok = await initReady;
    if (!ok) {
      $('loading-text').textContent = 'Cannot connect to the server. Please verify your internet connection and refresh.';
      return;
    }
  }

  async function deviceInfo() {
    let device = '';
    try {
      device = localStorage.getItem('dv_id') || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
      localStorage.setItem('dv_id', device);
    } catch {}
    const raw = [
      navigator.userAgent, screen.width, screen.height, screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.language, navigator.hardwareConcurrency, navigator.deviceMemory
    ].join('|');
    let fp = '';
    try {
      fp = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))]
        .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    } catch {}
    return { device, fp };
  }

  async function api(path, body, method) {
    const res = await fetch('/api' + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return json;
  }

  // Auth Mode Toggle
  function setAuthMode(mode) {
    authModeState = mode;
    const isReg = mode === 'register';
    const titleEl = $('auth-title');
    const subEl = $('auth-sub');
    const chipEl = $('auth-step-chip');
    const emailEl = $('email');
    const emailLbl = $('email-label');
    const emailHlp = $('email-helper');
    const findUidBtn = $('btn-find-uid');
    const pwEl = $('pw');
    const pwLbl = $('pw-label');
    const pwFmt = $('pw-format-hint');
    const pwHlp = $('pw-helper');

    if (titleEl) titleEl.textContent = isReg ? 'Candidate Registration' : 'Candidate Assessment Login';
    if (subEl) {
      subEl.textContent = isReg
        ? 'Create an account manually if you have not applied through the Winter 2026 form.'
        : 'Enter your Candidate UID or registered institutional email along with your Date of Birth to access the monitored examination session.';
    }
    if (chipEl) {
      chipEl.innerHTML = `<span class="auth-cohort-dot"></span><span>${isReg ? 'MANUAL REGISTRATION' : 'WINTER 2026 COHORT'}</span>`;
    }
    if (emailLbl) {
      emailLbl.innerHTML = isReg
        ? 'Email Address <span class="req">*</span>'
        : 'Candidate UID or Institutional Email <span class="req">*</span>';
    }
    if (emailEl) {
      emailEl.placeholder = isReg ? 'e.g. student@uni.edu' : 'e.g. PGI-W26-0001 or student@uni.edu';
    }
    if (emailHlp) {
      emailHlp.textContent = isReg
        ? 'Official email used for certificate issuance.'
        : 'Sent in your initial Winter 2026 Application Confirmation receipt.';
    }
    if (findUidBtn) findUidBtn.classList.toggle('hidden', isReg);

    if (pwLbl) {
      pwLbl.innerHTML = isReg
        ? 'Create Password <span class="req">*</span>'
        : 'Date of Birth (Examination Key) <span class="req">*</span>';
    }
    if (pwFmt) pwFmt.textContent = isReg ? 'Min 8 characters' : 'Format: DD/MM/YYYY';
    if (pwEl) pwEl.placeholder = isReg ? 'Minimum 8 characters' : 'DD / MM / YYYY';
    if (pwHlp) {
      pwHlp.textContent = isReg
        ? 'Choose at least 8 characters for your portal password.'
        : 'Must match registered application documents exactly.';
    }

    $('f-name').classList.toggle('hidden', !isReg);
    $('f-phone').classList.toggle('hidden', !isReg);
    $('auth-go').innerHTML = isReg
      ? '<span>Register &amp; Start Assessment</span><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>'
      : '<span>Verify &amp; Proceed to Proctor Check</span><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
    $('auth-toggle').textContent = isReg ? 'Already have a Candidate UID? Sign in' : 'New candidate? Register manually';
    msg('auth-msg', '');
  }

  $('auth-toggle').onclick = () => setAuthMode(authModeState === 'register' ? 'login' : 'register');

  // Find UID & Recovery Drawer Triggers
  function openRecoveryDrawer() {
    const panel = $('panel-portal-forgot');
    if (!panel) return;
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (isHidden) {
      const fid = $('forgot-portal-id');
      if (fid && $('email')?.value.trim()) fid.value = $('email').value.trim();
      if (fid) fid.focus();
      msg('portal-forgot-msg', '');
    }
  }
  const linkForgot = $('link-forgot-pw');
  if (linkForgot) linkForgot.onclick = openRecoveryDrawer;
  const btnFindUid = $('btn-find-uid');
  if (btnFindUid) btnFindUid.onclick = openRecoveryDrawer;

  const btnForgotCancel = $('btn-portal-forgot-cancel');
  if (btnForgotCancel) {
    btnForgotCancel.onclick = () => {
      const panel = $('panel-portal-forgot');
      if (panel) panel.classList.add('hidden');
    };
  }

  const btnLookupUid = $('btn-portal-lookup-uid');
  if (btnLookupUid) {
    btnLookupUid.onclick = async () => {
      const raw = ($('forgot-portal-id').value || $('email').value).trim();
      if (!raw) return msg('portal-forgot-msg', 'Enter your registered email or 10-digit mobile number.');
      btnLookupUid.disabled = true;
      msg('portal-forgot-msg', 'Looking up Candidate UID…', true);
      try {
        const param = raw.includes('@')
          ? `email=${encodeURIComponent(raw.toLowerCase())}`
          : `phone=${encodeURIComponent(raw)}`;
        const res = await fetch(`/api/applications/check?${param}`);
        const data = await res.json();
        if (data.exists && data.applicationId) {
          if ($('email')) $('email').value = data.applicationId;
          msg('portal-forgot-msg', `Candidate UID found: ${data.applicationId} (pre-filled above).`, true);
        } else {
          msg('portal-forgot-msg', 'No matching application found. Check your email/mobile or apply first.');
        }
      } catch (err) {
        msg('portal-forgot-msg', 'Lookup failed. Please try again.');
      } finally {
        btnLookupUid.disabled = false;
      }
    };
  }

  const btnForgotSend = $('btn-portal-forgot-send');
  if (btnForgotSend) {
    btnForgotSend.onclick = async () => {
      const ident = ($('forgot-portal-id').value || $('email').value).trim();
      if (!ident) return msg('portal-forgot-msg', 'Please enter your Candidate UID or Registered Email.');
      btnForgotSend.disabled = true;
      msg('portal-forgot-msg', 'Sending password recovery instructions…', true);
      try {
        const res = await fetch('/api/student/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: ident })
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Recovery request failed');
        msg('portal-forgot-msg', d.message || 'Check your email inbox for recovery link.', true);
      } catch (err) {
        msg('portal-forgot-msg', err.message);
      } finally {
        btnForgotSend.disabled = false;
      }
    };
  }

  // Password visibility SVG toggle
  const EYE_SHOW_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  const EYE_HIDE_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

  const toggleEye = $('toggle-portal-pw');
  if (toggleEye) {
    toggleEye.onclick = () => {
      const pwInput = $('pw');
      if (!pwInput) return;
      if (pwInput.type === 'password') {
        pwInput.type = 'text';
        toggleEye.innerHTML = EYE_HIDE_SVG;
        toggleEye.setAttribute('aria-label', 'Hide password');
      } else {
        pwInput.type = 'password';
        toggleEye.innerHTML = EYE_SHOW_SVG;
        toggleEye.setAttribute('aria-label', 'Show password');
      }
    };
  }

  function normalizeDobKey(rawPw) {
    const raw = String(rawPw || '');
    const m = raw.trim().match(/^(\d{2})\s*[/-]\s*(\d{2})\s*[/-]\s*(\d{4})$/);
    if (!m) return raw;
    return `${m[1]}${m[2]}${m[3]}`;
  }

  [$('email'), $('pw')].forEach(inp => {
    if (!inp) return;
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('auth-go')?.click();
      }
    });
  });

  $('auth-go').onclick = async () => {
    const rawIdentifier = $('email').value.trim();
    const rawPw = $('pw').value;
    const pw = authModeState === 'login' ? normalizeDobKey(rawPw) : rawPw;
    if (!rawIdentifier || pw.length < 8) {
      return msg('auth-msg', 'Enter your Candidate UID/Email and Date of Birth (DD/MM/YYYY) or 8+ character password.');
    }
    $('auth-go').disabled = true;
    msg('auth-msg', 'Verifying credentials…', true);

    try {
      if (!(await initReady)) {
        throw new Error('Cannot connect to the server. Please check your connection and try again.');
      }
      if (authModeState === 'register') {
        const client = await ensureSb();
        if (!client) throw new Error('Registration client is still loading. Please try again in a moment.');
        const email = rawIdentifier.toLowerCase();
        const name = $('name').value.trim();
        const phone = $('phone').value.trim();
        if (name.length < 2 || !/^[0-9+\-\s]{10,15}$/.test(phone)) {
          throw new Error('Please enter your full name and a valid 10-digit mobile number.');
        }
        localStorage.setItem('pendingProfile', JSON.stringify({ name, phone }));
        const { data, error } = await client.auth.signUp({
          email,
          password: pw,
          options: { data: { full_name: name, phone } }
        });
        if (error) throw error;
        if (!data.session) {
          msg('auth-msg', 'Account registered. Check your email inbox to verify, then sign in.', true);
          setAuthMode('login');
          return;
        }
        if (data.session?.access_token) {
          localStorage.setItem('pgi_student_token', data.session.access_token);
          sessionStorage.setItem('pgi_student_token', data.session.access_token);
          localStorage.setItem('pgi_student_email', email);
          sessionStorage.setItem('pgi_student_email', email);
        }
      } else {
        // Dual Login via /api/student/login supporting Student ID or Email
        const res = await fetch('/api/student/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: rawIdentifier, password: pw })
        });
        const loginData = await res.json();
        if (!res.ok) throw new Error(loginData.error || 'Authentication failed');

        if (loginData.token) {
          localStorage.setItem('pgi_student_token', loginData.token);
          sessionStorage.setItem('pgi_student_token', loginData.token);
          if (loginData.student?.email) {
            sessionStorage.setItem('pgi_student_email', loginData.student.email.toLowerCase());
            localStorage.setItem('pgi_student_email', loginData.student.email.toLowerCase());
          }
          if (loginData.student?.studentId) {
            localStorage.setItem('pgi_student_id', loginData.student.studentId);
          }
          if (loginData.student?.applicationId) {
            sessionStorage.setItem('pgi_application_id', loginData.student.applicationId);
            localStorage.setItem('pgi_application_id', loginData.student.applicationId);
          }
          if (sb && loginData.refreshToken) {
            sb.auth.setSession({
              access_token: loginData.token,
              refresh_token: loginData.refreshToken
            }).catch(() => {});
          }
          if (loginData.student?.enrolled) {
            // Directly forward enrolled student to dedicated full-featured dashboard
            window.location.href = 'dashboard.html';
            return;
          }
        }
      }
      manualAuthCompleted = true;
      try {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('email');
        cleanUrl.searchParams.delete('appId');
        window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search);
      } catch {}
      await boot();
    } catch (err) {
      msg('auth-msg', err.message);
    } finally {
      $('auth-go').disabled = false;
    }
  };

  function clearStoredAuth() {
    token = null;
    window.__pgiBootPromise = null;
    window.__pgiBootToken = null;
    ['pgi_student_token', 'pgi_student_email', 'pgi_student_id'].forEach(k => {
      try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch {}
    });
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k);
      }
    } catch {}
  }

  $('logout').onclick = async () => {
    pendingPaymentRedirect = false;
    manualAuthCompleted = false;
    lastResult = null;
    clearStoredAuth();
    if (sb) await sb.auth.signOut().catch(() => {});
    location.reload();
  };

  function setPvPaymentAlert(text = '') {
    const box = $('pv-payment-alert');
    const txt = $('pv-payment-alert-text');
    if (!box || !txt) return;
    if (!text) {
      box.classList.add('hidden');
      txt.textContent = '';
    } else {
      txt.textContent = text;
      box.classList.remove('hidden');
    }
  }

  async function checkCompletedAndOpenPayment() {
    if (!token) {
      pendingPaymentRedirect = true;
      setAuthMode('login');
      show('s-auth');
      msg('auth-msg', 'Sign in with your Candidate UID/Email and Date of Birth (DD/MM/YYYY) to verify your completed assessment and go to payment.', true);
      ($('email')?.value.trim() ? $('pw') : $('email'))?.focus();
      return;
    }

    const navBtn = $('nav-payment-btn');
    if (navBtn) navBtn.disabled = true;
    setPvPaymentAlert('');
    try {
      const res = await api('/assessment/payment-eligibility');
      if (res.enrolled) {
        await boot();
        return;
      }
      if (res.completed && res.result) {
        endMonitoring();
        lastResult = res.result;
        lastCoupon = res.result.coupon;
        if (res.result.coupon?.state === 'active') {
          await showCourses();
        } else {
          showResult(res.result);
        }
        return;
      }
      if (res.testCouponAvailable) {
        endMonitoring();
        await showCourses();
        msg('c-msg', 'No completed assessment yet — you can apply an active test coupon at checkout.', true);
        return;
      }
      const notice = res.message || 'No completed assessment found for your account yet. Complete Proctor Verification and submit the assessment first.';
      setPvPaymentAlert(notice);
      msg('inst-msg', notice, false);
      msg('p-msg', notice, false);
    } catch (err) {
      const notice = err.message || 'Could not verify assessment completion status.';
      setPvPaymentAlert(notice);
      msg('inst-msg', notice, false);
      msg('p-msg', notice, false);
    } finally {
      if (navBtn) navBtn.disabled = false;
    }
  }

  if ($('nav-payment-btn')) $('nav-payment-btn').onclick = checkCompletedAndOpenPayment;
  if ($('pv-payment-alert-close')) $('pv-payment-alert-close').onclick = () => setPvPaymentAlert('');
  if ($('btn-back-result')) {
    $('btn-back-result').onclick = () => {
      if (lastResult) showResult(lastResult);
    };
  }

  $('p-save').onclick = async () => {
    try {
      $('p-save').disabled = true;
      await api('/profile', {
        fullName: $('p-name').value.trim(),
        phone: $('p-phone').value.trim()
      });
      await boot();
    } catch (err) {
      msg('p-msg', err.message);
    } finally {
      $('p-save').disabled = false;
    }
  };

  // Pre-Flight Hardware & Latency Diagnostics
  async function initPreFlightProctor(me) {
    const candNameEl = $('pv-cand-name');
    const candUidEl = $('pv-cand-uid');
    const appId = me?.applicationId
      || sessionStorage.getItem('pgi_application_id')
      || localStorage.getItem('pgi_application_id')
      || me?.studentId
      || 'PGI-W26-ACTIVE';

    if (appId && !appId.endsWith('-ACTIVE')) {
      try {
        sessionStorage.setItem('pgi_application_id', appId);
        localStorage.setItem('pgi_application_id', appId);
      } catch {}
    }

    if (candNameEl) candNameEl.textContent = me?.profile?.full_name || 'Candidate';
    if (candUidEl) candUidEl.textContent = appId;

    // Screen lock capability check
    const fsOk = !!document.fullscreenEnabled;
    if ($('pv-top-fs')) $('pv-top-fs').textContent = fsOk ? 'Enabled' : 'Browser Limited';
    if ($('pv-pill-fs')) $('pv-pill-fs').classList.toggle('ok', fsOk);
    if ($('diag-fs')) {
      $('diag-fs').textContent = fsOk ? '✓ Confirmed' : 'Standard';
      $('diag-fs').className = fsOk ? 'ok' : '';
    }

    // Measure live server latency
    try {
      const t0 = performance.now();
      await fetch('/api/config', { cache: 'no-store' });
      const ms = Math.max(1, Math.round(performance.now() - t0));
      if ($('diag-net')) {
        $('diag-net').textContent = `✓ ${ms}ms Low`;
        $('diag-net').className = 'ok';
      }
    } catch {
      if ($('diag-net')) {
        $('diag-net').textContent = 'Alert: Check link';
        $('diag-net').className = 'err';
      }
    }

    // Immediately initiate webcam & face proctor verification upon entering Proctor Check
    updateGate();
    if (!enrolledFace) {
      if (await startCamera()) {
        await verifyFace();
      }
    }
  }

  // Camera & Face Verification
  async function startCamera() {
    if (stream) return true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      const vTrack = stream.getVideoTracks()[0];
      vTrack.addEventListener('ended', () => isLive() && recordViolation('camera_unavailable'));
      $('prev').srcObject = stream;
      $('pvid').srcObject = stream;
      $('prev').classList.remove('hidden');
      if ($('pv-placeholder')) $('pv-placeholder').classList.add('hidden');

      const settings = vTrack.getSettings ? vTrack.getSettings() : {};
      const resLabel = settings.width && settings.height
        ? `${settings.frameRate ? Math.round(settings.frameRate) + ' FPS · ' : ''}${settings.width}×${settings.height}`
        : '30 FPS · HD';
      if ($('pv-res')) $('pv-res').textContent = resLabel;
      if ($('pv-sensor-id')) {
        $('pv-sensor-id').textContent = (vTrack.label || 'CAM-HD').slice(0, 26);
      }

      if ($('pv-top-cam')) $('pv-top-cam').textContent = 'Connected';
      if ($('pv-pill-cam')) $('pv-pill-cam').classList.add('ok');
      if ($('diag-cam')) {
        $('diag-cam').textContent = '✓ Verified';
        $('diag-cam').className = 'ok';
      }
      if ($('pv-lighting')) {
        $('pv-lighting').textContent = 'Optimal';
        $('pv-lighting').className = 'ok';
      }

      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
      } catch {
        micStream = null;
      }

      if ($('pv-top-mic')) $('pv-top-mic').textContent = micStream ? 'Calibrated' : 'Muted/None';
      if ($('pv-pill-mic')) $('pv-pill-mic').classList.toggle('ok', !!micStream);
      if ($('diag-mic')) {
        $('diag-mic').textContent = micStream ? '✓ Active' : 'Unavailable';
        $('diag-mic').className = micStream ? 'ok' : '';
      }

      msg('cam-msg', 'Webcam connected.' + (micStream ? ' Microphone calibrated for integrity check.' : ''), true);
      return true;
    } catch {
      if ($('pv-top-cam')) $('pv-top-cam').textContent = 'Blocked';
      if ($('diag-cam')) {
        $('diag-cam').textContent = '✕ Blocked';
        $('diag-cam').className = 'err';
      }
      msg('cam-msg', cfg.requireCamera
        ? 'Camera access is required for proctored assessment. Please allow permissions in your browser.'
        : 'Camera not detected. Test will proceed with flagged integrity review.');
      return false;
    }
  }

  const updateGate = () => {
    $('begin').disabled = !($('agree').checked && (enrolledFace || !cfg.requireCamera));
  };

  async function verifyFace(forceRetest = false) {
    if (enrolledFace && !forceRetest) return;
    if (forceRetest) {
      enrolledFace = false;
      updateGate();
    }
    $('cam-go').disabled = true;
    if ($('pv-face-badge')) {
      $('pv-face-badge').textContent = 'Scanning…';
      $('pv-face-badge').className = 'warn';
    }
    msg('face-msg', 'Loading facial alignment model…', true);
    try {
      proctor ||= await (await import('/static/js/proctor.js')).createProctor($('prev'));
      msg('face-msg', 'Center your face inside TARGET FRAME and stay steady…', true);
      enrolledFace = await proctor.enroll(t => msg('face-msg', t, true));
      if (enrolledFace) {
        if ($('pv-face-badge')) {
          $('pv-face-badge').textContent = 'Detected ✓';
          $('pv-face-badge').className = 'ok';
        }
        if ($('pv-reticle')) $('pv-reticle').style.opacity = '0.35';
        msg('face-msg', '✓ Facial alignment synchronized. Ready to start assessment.', true);
      } else {
        if ($('pv-face-badge')) {
          $('pv-face-badge').textContent = 'Not Clear';
          $('pv-face-badge').className = 'warn';
        }
        msg('face-msg', 'Could not detect face clearly. Adjust room lighting and click Retest Camera.', false);
      }
    } catch (err) {
      if ($('pv-face-badge')) $('pv-face-badge').textContent = 'Unavailable';
      msg('face-msg', cfg.requireCamera
        ? 'Face verification failed (' + err.message + '). Check connection and retry.'
        : 'Face verification unavailable; proceeding with standard monitoring.', !cfg.requireCamera);
    }
    $('cam-go').disabled = false;
    updateGate();
  }

  $('cam-go').onclick = async () => {
    if (await startCamera()) verifyFace(enrolledFace);
  };
  if ($('pv-quick-cam')) {
    $('pv-quick-cam').onclick = () => $('cam-go').click();
  }

  $('agree').onchange = updateGate;

  let reviewSet = new Set();

  $('begin').onclick = async () => {
    requestExamFullscreen();
    $('begin').disabled = true;
    const camOk = await startCamera();
    if (!camOk && cfg.requireCamera) {
      $('begin').disabled = false;
      return;
    }

    try {
      const dev = await deviceInfo();
      const appId = sessionStorage.getItem('pgi_application_id') || localStorage.getItem('pgi_application_id') || null;
      attempt = await api('/attempts/start', { ...dev, applicationId: appId });
      runTest();
      if (!camOk) recordViolation('camera_unavailable');
    } catch (err) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      msg('inst-msg', err.message);
      $('begin').disabled = false;
    }
  };

  // Run Test Setup
  function runTest() {
    reviewSet = new Set();
    warnings = attempt.violations || 0;
    updateWarnings();
    if ($('proctor-warning-banner')) $('proctor-warning-banner').classList.add('hidden');
    show('s-test');
    requestExamFullscreen();

    currentQIndex = 0;
    skew = new Date(attempt.serverTime) - Date.now();

    const storedAppId = sessionStorage.getItem('pgi_application_id') || localStorage.getItem('pgi_application_id') || 'PGI-W26';
    const candName = currentUser?.profile?.full_name || 'Candidate';
    if ($('app-id-disp')) $('app-id-disp').textContent = storedAppId;
    if ($('feed-uid-disp')) $('feed-uid-disp').textContent = storedAppId;
    if ($('feed-name-disp')) $('feed-name-disp').textContent = candName;
    if ($('feed-pill-cam')) $('feed-pill-cam').textContent = stream ? '✓ Webcam: OK' : 'Alert: Webcam Off';
    if ($('feed-pill-mic')) $('feed-pill-mic').textContent = micStream ? '✓ Mic: Sync' : 'Alert: Mic Muted';

    if ($('protocol-notice-text')) {
      const passMark = attempt.passMark || 30;
      const totalMarks = attempt.totalMarks || 100;
      const negLabel = attempt.negativeMarking ? `-${attempt.negativeMarking} mark per wrong answer` : 'disabled';
      $('protocol-notice-text').textContent = `Unanswered items receive 0 marks. Passing threshold is ${passMark}/${totalMarks} (negative marking: ${negLabel}). Leaving fullscreen, switching tabs, or leaving the frame logs a strike (auto-submits after ${attempt.maxWarnings || 3} strikes).`;
    }

    if (stream && $('pvid')) {
      if ($('pvid').srcObject !== stream) $('pvid').srcObject = stream;
      $('pvid').play?.().catch(() => {});
    }
    if (proctor?.setVideo && $('pvid')) {
      proctor.setVideo($('pvid'));
    }

    renderNavigator();
    showQuestion(0);
    updateProgress();

    tickTimer();
    clearInterval(timerInterval);
    timerInterval = setInterval(tickTimer, 500);

    if (proctor && enrolledFace) {
      proctor.start(recordViolation, (statusText, isOk) => {
        if ($('mon')) {
          $('mon').textContent = statusText;
          $('mon').className = 'cam-status ' + (isOk ? 'ok' : 'err');
        }
        if ($('feed-video-stage')) $('feed-video-stage').classList.toggle('alert', !isOk);
        if ($('feed-pill-cam')) $('feed-pill-cam').textContent = isOk ? '✓ Webcam: OK' : 'Alert: Check Frame';
      }, micStream);
    } else if ($('mon')) {
      $('mon').textContent = stream ? 'Monitoring: Active' : 'Camera Required';
      $('mon').className = 'cam-status ' + (stream ? 'ok' : 'err');
    }
  }

  function updateProgress() {
    const answeredCount = Object.keys(attempt.saved || {}).length;
    const totalCount = (attempt.questions || []).length || 20;
    const reviewCount = reviewSet.size;
    const pendingCount = Math.max(0, totalCount - answeredCount);
    const pct = totalCount ? Math.round((answeredCount / totalCount) * 100) : 0;
    const pad2 = n => String(n).padStart(2, '0');

    if ($('prog-badge')) $('prog-badge').textContent = `${pad2(currentQIndex + 1)} / ${pad2(totalCount)}`;
    if ($('nav-summary')) $('nav-summary').textContent = `${answeredCount} of ${totalCount} Completed`;
    if ($('exam-velocity-fill')) $('exam-velocity-fill').style.width = `${pct}%`;
    if ($('exam-velocity-status')) $('exam-velocity-status').textContent = `${pct}% Answered`;
    if ($('stat-answered')) $('stat-answered').textContent = answeredCount;
    if ($('stat-review')) $('stat-review').textContent = reviewCount;
    if ($('stat-pending')) $('stat-pending').textContent = pendingCount;
    renderNavigator();
  }

  function updateWarnings() {
    const wEl = $('wcount');
    if (wEl) wEl.textContent = `Strike ${Math.min(warnings, 3)} of ${attempt?.maxWarnings || 3}`;
  }

  function renderNavigator() {
    const grid = $('nav-chips-grid');
    if (!grid || !attempt || !attempt.questions) return;
    grid.innerHTML = '';
    attempt.questions.forEach((q, idx) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'q-chip';
      chip.textContent = String(idx + 1).padStart(2, '0');
      if (attempt.saved[q.id]) chip.classList.add('answered');
      if (reviewSet.has(q.id)) chip.classList.add('review');
      if (idx === currentQIndex) chip.classList.add('current');
      chip.onclick = () => showQuestion(idx);
      grid.appendChild(chip);
    });
  }

  function cleanHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const frag = document.createDocumentFragment();
    (function walk(n, target) {
      n.childNodes.forEach(c => {
        if (c.nodeType === 3) target.appendChild(document.createTextNode(c.textContent));
        else if (['PRE', 'CODE', 'B', 'I', 'BR', 'SPAN'].includes(c.nodeName)) {
          const el = document.createElement(c.nodeName);
          target.appendChild(el);
          walk(c, el);
        } else {
          walk(c, target);
        }
      });
    })(doc.body, frag);
    return frag;
  }

  function showQuestion(idx) {
    if (!attempt || !attempt.questions || idx < 0 || idx >= attempt.questions.length) return;
    currentQIndex = idx;
    const q = attempt.questions[idx];
    const total = attempt.questions.length;
    const pad2 = n => String(n).padStart(2, '0');

    if ($('q-num-label')) $('q-num-label').textContent = `ITEM SEQUENCE ${pad2(idx + 1)} OF ${pad2(total)}`;
    if ($('prog-badge')) $('prog-badge').textContent = `${pad2(idx + 1)} / ${pad2(total)}`;
    if ($('q-domain-pill')) {
      $('q-domain-pill').textContent = q.questionSet
        ? `DOMAIN: ${String(q.questionSet).toUpperCase()}`
        : 'DOMAIN: WINTER COHORT BENCHMARK';
    }
    if ($('q-marks-label')) {
      const negTxt = attempt.negativeMarking ? `-${attempt.negativeMarking}` : '0';
      $('q-marks-label').textContent = `Mark: +${q.marks || 5} / ${negTxt}`;
    }

    const qBody = $('q-text-body');
    qBody.innerHTML = '';
    qBody.appendChild(cleanHtml(q.text));

    const optionsBox = $('q-options-container');
    optionsBox.innerHTML = '';

    (q.options || []).forEach(opt => {
      const isSelected = attempt.saved[q.id] === opt.id;
      const label = document.createElement('label');
      label.className = 'option-label' + (isSelected ? ' selected' : '');

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'question_' + q.id;
      radio.value = opt.id;
      radio.checked = isSelected;

      radio.onchange = () => {
        document.querySelectorAll('.option-label').forEach(l => l.classList.remove('selected'));
        label.classList.add('selected');
        saveAnswer(q.id, opt.id);
      };

      const leftGroup = document.createElement('span');
      leftGroup.className = 'opt-left';

      const optBadge = document.createElement('span');
      optBadge.className = 'opt-id';
      optBadge.textContent = opt.id.toUpperCase();

      const textSpan = document.createElement('span');
      textSpan.textContent = opt.text;
      leftGroup.append(optBadge, textSpan);

      const rightGroup = document.createElement('span');
      rightGroup.className = 'opt-right';

      const choiceTag = document.createElement('span');
      choiceTag.className = 'opt-choice-tag';
      choiceTag.textContent = 'ACTIVE CHOICE';

      const radioMark = document.createElement('span');
      radioMark.className = 'opt-radio-mark';
      radioMark.innerHTML = '&#10003;';
      rightGroup.append(choiceTag, radioMark);

      label.append(radio, leftGroup, rightGroup);
      optionsBox.appendChild(label);
    });

    const revBtn = $('btn-mark-review');
    if (revBtn) {
      const marked = reviewSet.has(q.id);
      revBtn.classList.toggle('is-marked', marked);
      const revSpan = revBtn.querySelector('span');
      if (revSpan) revSpan.textContent = marked ? 'Marked for Review' : 'Mark for Review';
    }

    $('btn-prev-q').disabled = (idx === 0);
    $('btn-next-q').textContent = (idx === total - 1) ? 'Review & Submit' : 'Next Question →';

    renderNavigator();
    resetScrollTop();
  }

  $('btn-mark-review')?.addEventListener('click', () => {
    const q = attempt?.questions?.[currentQIndex];
    if (!q) return;
    if (reviewSet.has(q.id)) reviewSet.delete(q.id);
    else reviewSet.add(q.id);
    const marked = reviewSet.has(q.id);
    const revBtn = $('btn-mark-review');
    if (revBtn) {
      revBtn.classList.toggle('is-marked', marked);
      const revSpan = revBtn.querySelector('span');
      if (revSpan) revSpan.textContent = marked ? 'Marked for Review' : 'Mark for Review';
    }
    updateProgress();
  });

  $('btn-prev-q').onclick = () => {
    if (currentQIndex > 0) showQuestion(currentQIndex - 1);
  };

  $('btn-next-q').onclick = () => {
    if (currentQIndex < (attempt.questions || []).length - 1) {
      showQuestion(currentQIndex + 1);
    } else {
      openSubmitModal();
    }
  };

  $('btn-submit-q').onclick = () => openSubmitModal();

  async function saveAnswer(qid, oid) {
    attempt.saved[qid] = oid;
    updateProgress();
    const savedText = $('saved-text');
    const savedBox = $('saved');
    if (savedText) savedText.textContent = 'Saving to Vault…';
    if (savedBox) savedBox.className = 'exam-bottom-right';

    for (let i = 0; i < 4; i++) {
      try {
        await api(`/attempts/${attempt.attemptId}/answer`, { questionId: qid, optionId: oid });
        if (savedText) savedText.textContent = 'Answers Autosaved to Vault';
        if (savedBox) savedBox.className = 'exam-bottom-right';
        return;
      } catch (err) {
        if (err.status === 410) return finishTest(true);
        await new Promise(r => setTimeout(r, 600 * (i + 1)));
      }
    }
    if (savedText) savedText.textContent = 'Sync issue (retrying)';
    if (savedBox) savedBox.className = 'exam-bottom-right warn';
  }

  function tickTimer() {
    if (!attempt || !attempt.expiresAt) return;
    const totalDur = Number(attempt.durationSeconds) || 1200;
    const remainingSeconds = Math.max(0, Math.floor((new Date(attempt.expiresAt) - (Date.now() + skew)) / 1000));
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    $('timer').textContent = display;

    const timerChip = $('timer-chip');
    if (remainingSeconds <= 180) {
      timerChip.classList.add('urgent');
    } else {
      timerChip.classList.remove('urgent');
    }

    const elapsed = Math.max(0, Math.min(totalDur, totalDur - remainingSeconds));
    const eMins = Math.floor(elapsed / 60);
    const eSecs = elapsed % 60;
    if ($('time-consumed-label')) {
      $('time-consumed-label').textContent = `${eMins}m ${String(eSecs).padStart(2, '0')}s consumed`;
    }
    if ($('time-consumed-fill')) {
      const pct = Math.min(100, Math.round((elapsed / totalDur) * 100));
      $('time-consumed-fill').style.width = `${pct}%`;
    }

    if (remainingSeconds === 0) {
      finishTest(true);
    }
  }

  // Snapshot capture for violation evidence (uses visible #pvid feed during live test)
  const snapCanvas = document.createElement('canvas');
  function captureSnapshot() {
    try {
      const v = ($('pvid')?.readyState >= 2 && $('pvid')?.videoWidth) ? $('pvid') : $('prev');
      if (!v || v.readyState < 2 || !v.videoWidth) return null;
      snapCanvas.width = 256;
      snapCanvas.height = Math.round(256 * v.videoHeight / v.videoWidth);
      snapCanvas.getContext('2d').drawImage(v, 0, 0, snapCanvas.width, snapCanvas.height);
      return snapCanvas.toDataURL('image/jpeg', 0.55);
    } catch {
      return null;
    }
  }

  let lastViolTime = {};
  async function recordViolation(type) {
    if (!attempt || !isLive()) return;
    const now = Date.now();
    if (now - (lastViolTime[type] || 0) < 3000) return;
    lastViolTime[type] = now;

    const img = captureSnapshot();
    try {
      const res = await api(`/attempts/${attempt.attemptId}/violation`, { type, snapshot: img });
      if (res.advisory) return;
      warnings = res.total;
      updateWarnings();

      if (res.autoSubmitted) {
        finishing = true;
        endMonitoring();
        if ($('proctor-warning-banner')) $('proctor-warning-banner').classList.add('hidden');
        $('viol-modal').classList.add('hidden');
        return showResult(res.result);
      }

      if (res.counted) {
        const label = VIOLATION_LABELS[type] || type;
        if ($('warn-banner-title')) $('warn-banner-title').textContent = `PROCTOR WARNING: ${label.toUpperCase()}`;
        if ($('warn-banner-body')) {
          $('warn-banner-body').textContent = `${label}. You have ${res.warningsLeft} strike(s) remaining. Exceeding ${res.maxWarnings || 3} strikes triggers immediate assessment lock and automated submission.`;
        }
        if ($('proctor-warning-banner')) {
          $('proctor-warning-banner').classList.remove('hidden');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        $('vm-title').textContent = `Proctoring Warning (${res.total} of ${res.maxWarnings})`;
        $('vm-body').textContent = `${label}. You have ${res.warningsLeft} warning(s) remaining. Further violations will cause automatic assessment submission.`;
      }
    } catch {}
  }

  function resumeFromWarning() {
    if ($('proctor-warning-banner')) $('proctor-warning-banner').classList.add('hidden');
    $('viol-modal').classList.add('hidden');
    requestExamFullscreen();
  }
  $('warn-resume-btn')?.addEventListener('click', resumeFromWarning);
  $('vm-ok').onclick = resumeFromWarning;

  // Proctoring event listeners
  document.addEventListener('visibilitychange', () => { if (document.hidden && isLive()) recordViolation('tab_switch'); });
  window.addEventListener('blur', () => setTimeout(() => { if (isLive() && !document.hasFocus()) recordViolation('tab_switch'); }, 700));
  document.addEventListener('fullscreenchange', () => { if (isLive() && document.fullscreenEnabled && !document.fullscreenElement) recordViolation('fullscreen_exit'); });
  ['copy', 'cut', 'paste'].forEach(ev => document.addEventListener(ev, e => { if (isLive()) { e.preventDefault(); recordViolation('copy_paste'); } }));
  document.addEventListener('contextmenu', e => { if (isLive()) e.preventDefault(); });
  document.addEventListener('keydown', e => {
    if (!isLive()) return;
    const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
    if (c && ['c', 'x', 'v', 'a'].includes(k)) {
      if (!/INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); recordViolation('copy_paste'); }
    } else if (k === 'f12' || (c && e.shiftKey && ['i', 'j', 'c'].includes(k)) || (c && ['u', 's', 'p'].includes(k)) || k === 'printscreen') {
      e.preventDefault();
      recordViolation('blocked_shortcut');
    }
  });

  // Submission Flow
  function openSubmitModal() {
    const answeredCount = Object.keys(attempt.saved || {}).length;
    const totalCount = (attempt.questions || []).length;
    const unanswered = totalCount - answeredCount;
    $('sm-body').textContent = `You have answered ${answeredCount} of ${totalCount} questions (${unanswered} unanswered).`;
    $('submit-modal').classList.remove('hidden');
  }

  $('sm-cancel').onclick = () => $('submit-modal').classList.add('hidden');

  $('sm-confirm').onclick = () => {
    $('submit-modal').classList.add('hidden');
    finishTest(false);
  };

  async function finishTest(isAutoTimeout = false) {
    if (finishing) return;
    finishing = true;
    clearInterval(timerInterval);
    $('btn-submit-q').disabled = true;
    msg('t-msg', isAutoTimeout ? 'Time elapsed. Evaluating your assessment…' : 'Submitting assessment to grading server…', true);

    for (let i = 0; i < 5; i++) {
      try {
        const res = await api(`/attempts/${attempt.attemptId}/submit`, {});
        endMonitoring();
        return showResult(res);
      } catch {
        await new Promise(r => setTimeout(r, 1200));
      }
    }
    finishing = false;
    $('btn-submit-q').disabled = false;
    msg('t-msg', 'Submission failed. Please check connection and click submit again.');
  }

  function endMonitoring() {
    clearInterval(timerInterval);
    document.body.classList.remove('exam-fullscreen');
    if (proctor) { proctor.stop(); proctor = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // ===================================================================
  // RESULT SCREEN RENDERING
  // ===================================================================

  function showResult(r) {
    lastResult = r;
    show('s-res');
    endMonitoring();
    const box = $('res-container');
    box.innerHTML = '';

    const totalQ = Number(r.total_questions ?? 25);
    const correctQ = Number(r.correct_count ?? 0);
    const totalMarks = Number(r.totalMarks || 100);
    const totalScore = Number(r.totalScore ?? (correctQ * (totalMarks / Math.max(totalQ, 1))));
    const passMark = Number(r.passMark || 30);
    const isQual = Boolean(r.isQualified ?? (totalScore >= passMark));

    const attendedQ = Math.min(totalQ, Math.max(0, Number(r.answeredCount ?? Object.keys(attempt?.answers || {}).length ?? correctQ)));
    const wrongQ = Number(r.wrongCount ?? Math.max(0, attendedQ - correctQ));
    const skippedQ = Number(r.unansweredCount ?? Math.max(0, totalQ - attendedQ));

    const scorePct = Math.max(0, Math.min(100, Math.round(Number(r.scorePercent ?? (totalMarks > 0 ? (totalScore / totalMarks) * 100 : 0)))));
    const attendedPct = totalQ > 0 ? Math.min(100, Math.round((attendedQ / totalQ) * 100)) : 0;
    const accuracyPct = attendedQ > 0 ? Math.min(100, Math.round((correctQ / attendedQ) * 100)) : 0;

    const ringRadius = 27;
    const ringCircumference = 2 * Math.PI * ringRadius;
    const ringOffset = ringCircumference * (1 - scorePct / 100);

    const candName = escHtml(r.candidateName || currentUser?.user_metadata?.full_name || currentUser?.email || 'Candidate');
    const candUid = escHtml(r.applicationId || 'PGI-W26');
    const curAttemptId = r.attemptId || attempt?.attemptId || attempt?.id || '';
    const attemptBadge = escHtml(String(curAttemptId || 'verified').slice(0, 18));
    const timeFmt = escHtml(formatDuration(r.timeTakenSeconds));

    const coupon = r.coupon || null;
    lastCoupon = coupon;
    const payableText = coupon ? inr(coupon.payablePaise) : '₹9,999';
    const subsidyPct = coupon
      ? Number(coupon.effectiveDiscountPercent ?? (coupon.payablePaise === 119900 ? 88 : (coupon.discountPercent === 100 ? 90 : coupon.discountPercent || 0)))
      : 0;

    box.innerHTML = `
      <div class="res-top-bar">
        <div>
          <div class="res-verified-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M9 12l2 2 4-4"></path>
            </svg>
            <span>WINTER COHORT 2026 EVALUATION VERIFIED</span>
          </div>
          <h1 class="res-title">${isQual ? 'Institutional Assessment Qualified' : 'Institutional Assessment Completed'}</h1>
          <p class="res-sub">
            Candidate <strong>${candName}</strong> (UID: <span class="res-uid">${candUid}</span>)
            &bull; Attended: <strong>${attendedQ} / ${totalQ} Questions</strong>
            &bull; Qualifying Mark: ${passMark}/${totalMarks}
          </p>
        </div>
        ${coupon ? `
          <div class="res-offer-pill" aria-live="polite">
            <span class="res-offer-dot" aria-hidden="true"></span>
            <span>OFFER WINDOW:</span>
            <span class="res-offer-time" id="res-offer-countdown">--:--:--</span>
          </div>
        ` : ''}
      </div>

      <div class="res-two-col">
        <div class="res-col-left">
          <div class="res-card res-index-card">
            <div class="res-index-head">
              <div>
                <div class="res-kicker">OVERALL ASSESSMENT SCORE</div>
                <div class="res-big-score">
                  <span class="res-big-score-num">${totalScore}</span>
                  <span class="res-big-score-den">/ ${totalMarks}</span>
                </div>
              </div>
              <div class="res-ring-wrap" aria-label="Score percentage ${scorePct}%">
                <svg class="res-ring-svg" viewBox="0 0 68 68">
                  <circle class="res-ring-track" cx="34" cy="34" r="${ringRadius}"></circle>
                  <circle class="res-ring-fill" cx="34" cy="34" r="${ringRadius}"
                    stroke-dasharray="${ringCircumference.toFixed(2)}"
                    stroke-dashoffset="${ringOffset.toFixed(2)}"></circle>
                </svg>
                <span class="res-ring-label">${scorePct}%</span>
              </div>
            </div>

            <div class="res-sub-stats">
              <div class="res-stat-box">
                <div class="res-stat-box-label">QUESTIONS ATTENDED</div>
                <div class="res-stat-box-val is-green">${attendedQ} / ${totalQ}</div>
                <div class="res-stat-box-sub">${skippedQ} Unanswered</div>
              </div>
              <div class="res-stat-box">
                <div class="res-stat-box-label">ACCURACY &amp; TIME</div>
                <div class="res-stat-box-val">${timeFmt}</div>
                <div class="res-stat-box-sub">${correctQ} Correct, ${wrongQ} Wrong</div>
              </div>
            </div>

            <div class="res-bars">
              <div class="res-bar-item">
                <div class="res-bar-meta"><span>Questions Attended (${attendedQ}/${totalQ})</span><strong>${attendedPct}%</strong></div>
                <div class="res-bar-track"><div class="res-bar-fill" style="width:${attendedPct}%"></div></div>
              </div>
              <div class="res-bar-item">
                <div class="res-bar-meta"><span>Total Score (${totalScore}/${totalMarks})</span><strong>${scorePct}%</strong></div>
                <div class="res-bar-track"><div class="res-bar-fill" style="width:${scorePct}%"></div></div>
              </div>
              <div class="res-bar-item">
                <div class="res-bar-meta"><span>Attempted Accuracy (${correctQ}/${Math.max(attendedQ, 1)})</span><strong>${accuracyPct}%</strong></div>
                <div class="res-bar-track"><div class="res-bar-fill is-blue" style="width:${accuracyPct}%"></div></div>
              </div>
            </div>
          </div>

          <div class="res-card res-auth-card">
            <div class="res-auth-seal">
              <img src="static/images/pgi-logo-sq.png" alt="Plant Green Inertia" onerror="this.src='static/images/pgi-logo.jpg'">
            </div>
            <div class="res-auth-text">
              <h4>
                <span>EVALUATION AUTHENTICITY</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#296934" stroke-width="2.5" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
              </h4>
              <p>Attempt: ${attemptBadge} &middot; verified by PGI Academic Engine</p>
            </div>
          </div>
        </div>

        <div class="res-col-right">
          ${coupon ? `
            <div class="res-card res-voucher-card">
              <div class="res-voucher-top">
                <span class="res-kicker res-kicker-green">INSTITUTIONAL GRANT ALLOTMENT</span>
                <span class="res-subsidy-pill">&bull; ${subsidyPct}% Fellowship Subsidy Applied</span>
              </div>

              <h2 class="res-voucher-title">Institutional Scholarship Voucher Granted</h2>
              <p class="res-voucher-desc">
                Subsidized cohort matriculation voucher unlocked for your Winter 2026 Internship assessment completion. Complete enrollment below within 24 hours.
              </p>

              <div class="res-fee-grid">
                <div class="res-fee-col">
                  <div class="res-kicker">STANDARD TUITION FEE</div>
                  <div class="res-fee-strike">₹9,999</div>
                </div>
                <div class="res-fee-col">
                  <div class="res-kicker res-kicker-green">FELLOWSHIP SUBSIDIZED RATE</div>
                  <div class="res-fee-final">${payableText}<span class="res-fee-unit">INR (All Inclusive)</span></div>
                </div>
              </div>

              <div class="res-token-box">
                <div>
                  <div class="res-kicker">GRANTED TOKEN</div>
                  <div class="res-token-code" id="res-coupon-code">${escHtml(coupon.code)}</div>
                </div>
                <div class="res-token-right">
                  <span class="res-token-valid">&#10003; Verified Valid</span>
                  <button type="button" class="res-btn-copy" id="res-copy-coupon">Copy Code</button>
                </div>
              </div>

              <div class="res-cta-row">
                <div id="coupon-actions-wrap"></div>
                <button type="button" class="res-btn-pdf" id="res-dl-pdf">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  <span>Download Score Report (PDF)</span>
                </button>
              </div>

              <p class="res-voucher-foot-note">
                Voucher tied exclusively to UID <strong>${candUid}</strong>. Valid strictly for 24 hours from completion.
              </p>
              <div class="res-share-links">
                <button type="button" class="res-share-btn" id="res-share-wa">Share on WhatsApp</button>
                <button type="button" class="res-share-btn" id="res-share-li">Share on LinkedIn</button>
              </div>
              <div id="res-rep-msg" class="msg"></div>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="res-card res-track-footer">
        <div class="res-track-left">
          <div class="res-track-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
              <path d="M2 17l10 5 10-5"></path>
              <path d="M2 12l10 5 10-5"></path>
            </svg>
          </div>
          <div>
            <h4>Plant Green Inertia Winter Research Track</h4>
            <p>Proceed to payment above to select your internship track and unlock your cohort dashboard.</p>
          </div>
        </div>
        <div class="res-track-right">
          <span>Batch Capacity: 40 Seats</span>
          <span class="res-seats-pill">Enrollment Open</span>
        </div>
      </div>
    `;

    // Bind PDF & social share using shared helpers
    const pdfBtn = box.querySelector('#res-dl-pdf');
    if (pdfBtn) pdfBtn.onclick = () => downloadReportPdf(curAttemptId, pdfBtn, 'res-rep-msg');
    const waBtn = box.querySelector('#res-share-wa');
    if (waBtn) waBtn.onclick = () => shareAttemptResult(curAttemptId, 'whatsapp', 'res-rep-msg');
    const liBtn = box.querySelector('#res-share-li');
    if (liBtn) liBtn.onclick = () => shareAttemptResult(curAttemptId, 'linkedin', 'res-rep-msg');

    if (coupon) {
      const copyBtn = box.querySelector('#res-copy-coupon');
      if (copyBtn) {
        copyBtn.onclick = () => {
          try {
            navigator.clipboard.writeText(coupon.code);
            copyBtn.textContent = 'Copied ✓';
            setTimeout(() => { copyBtn.textContent = 'Copy Code'; }, 2000);
          } catch {}
        };
      }

      const timerDisp = box.querySelector('#res-offer-countdown');
      const actionWrap = box.querySelector('#coupon-actions-wrap');
      clearInterval(couponInterval);

      const updateCouponTimer = () => {
        const remaining = Math.floor((new Date(coupon.expiresAt) - Date.now()) / 1000);
        if (coupon.state === 'redeemed') {
          if (timerDisp) timerDisp.textContent = 'REDEEMED';
          actionWrap.style.flex = '';
          actionWrap.innerHTML = '<span class="res-subsidy-pill">Enrolled in Cohort</span>';
          return;
        }
        if (remaining <= 0) {
          if (timerDisp) {
            timerDisp.textContent = 'EXPIRED';
            timerDisp.style.color = '#dc2626';
          }
          renderExpiredState(coupon, actionWrap);
          clearInterval(couponInterval);
        } else {
          const h = Math.floor(remaining / 3600);
          const m = Math.floor((remaining % 3600) / 60);
          const s = remaining % 60;
          if (timerDisp) {
            timerDisp.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          }
          if (!actionWrap.querySelector('#btn-choose-course')) {
            renderActiveState(coupon, actionWrap);
          }
        }
      };

      updateCouponTimer();
      couponInterval = setInterval(updateCouponTimer, 1000);
    }
  }

  function renderActiveState(coupon, wrap) {
    wrap.style.flex = '';
    wrap.innerHTML = '';
    const enrollBtn = document.createElement('button');
    enrollBtn.type = 'button';
    enrollBtn.id = 'btn-choose-course';
    enrollBtn.className = 'res-btn-pay';
    const priceLbl = inr(coupon.payablePaise);
    enrollBtn.innerHTML = `<span>Proceed to Subsidized Payment &bull; ${priceLbl}</span><span aria-hidden="true">&rarr;</span>`;
    enrollBtn.onclick = showCourses;
    wrap.appendChild(enrollBtn);
  }

  function renderExpiredState(coupon, wrap) {
    wrap.style.flex = '1 1 100%';
    wrap.innerHTML = '';
    const alertBox = document.createElement('div');
    alertBox.className = 'expired-alert';
    const extUsed = coupon.extensionCount || 0;
    const canExt = coupon.canExtend && extUsed < 2;

    alertBox.innerHTML = `
      <h3>Coupon Validity Ended</h3>
      <p style="color:var(--text-muted);font-size:0.9rem;">
        Payment checkout is locked because the 24-hour window has lapsed.
      </p>
      <div class="extension-box">
        <p style="font-size:0.85rem;font-weight:600;margin-bottom:8px;">
          Extension requests used: <strong>${extUsed} of 2 allowed</strong>
        </p>
        ${canExt
          ? `<button id="btn-req-ext" class="btn btn-outline" style="border-color:var(--danger);color:var(--danger);">Request 24-Hour Extension (${2 - extUsed} remaining)</button>`
          : `<p style="color:var(--danger);font-size:0.85rem;font-weight:700;">Maximum student extensions reached. Please contact administration for manual reissue.</p>`}
      </div>
      <div id="ext-msg" class="msg"></div>
    `;
    wrap.appendChild(alertBox);

    const extBtn = alertBox.querySelector('#btn-req-ext');
    if (extBtn) {
      extBtn.onclick = async () => {
        extBtn.disabled = true;
        msg('ext-msg', 'Requesting 24-hour extension…', true);
        try {
          const res = await api('/coupons/request-extension', { code: coupon.code });
          coupon.expiresAt = res.expiresAt;
          coupon.extensionCount = res.extensionCount;
          coupon.canExtend = (res.extensionsLeft > 0);
          coupon.state = 'active';
          msg('ext-msg', 'Extension granted! 24 hours added. Updated voucher emailed to you.', true);
          setTimeout(() => location.reload(), 1500);
        } catch (err) {
          msg('ext-msg', err.message);
          extBtn.disabled = false;
        }
      };
    }
  }

  async function downloadReportPdf(curAttemptId, btn, msgId) {
    if (!curAttemptId) return msg(msgId, 'Report document unavailable');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/attempts/${curAttemptId}/report.pdf`, {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!res.ok) throw new Error('Report document unavailable');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'PGI-Winter-Assessment-Report.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      msg(msgId, err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function shareAttemptResult(curAttemptId, platform, msgId) {
    if (!curAttemptId) return msg(msgId, 'Share link unavailable');
    try {
      const s = await api(`/attempts/${curAttemptId}/share`, {});
      if (platform === 'whatsapp') {
        const text = `${s.text}\n\nOfficial Assessment Report: ${s.url}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      } else {
        const text = `${s.text}\n\nVerification Link: ${s.url}`;
        window.open(`https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`, '_blank');
      }
    } catch (err) {
      msg(msgId, err.message);
    }
  }

  // Report & Sharing (used in Dashboard fallback)
  function addReport(box) {
    const reportCard = document.createElement('div');
    reportCard.className = 'card';
    reportCard.style.marginTop = '24px';
    reportCard.innerHTML = `
      <div class="card-head" style="margin-bottom:14px;padding-bottom:10px;">
        <h3 style="color:var(--navy);font-size:1.15rem;">Official Assessment Documentation</h3>
        <p class="subtitle" style="font-size:0.85rem;">Download your verified Plant Green Inertia score transcript with proctoring integrity seal.</p>
      </div>
      <div class="report-row">
        <button id="btn-dl-pdf" class="btn btn-outline">Download PDF Report</button>
        <button id="btn-share-wa" class="btn btn-outline">Share on WhatsApp</button>
        <button id="btn-share-li" class="btn btn-outline">Share on LinkedIn</button>
      </div>
      <div id="rep-msg" class="msg" style="text-align:center;"></div>
    `;
    box.appendChild(reportCard);

    const curAttemptId = attempt?.attemptId || attempt?.id;
    const dlBtn = reportCard.querySelector('#btn-dl-pdf');
    dlBtn.onclick = () => downloadReportPdf(curAttemptId, dlBtn, 'rep-msg');
    reportCard.querySelector('#btn-share-wa').onclick = () => shareAttemptResult(curAttemptId, 'whatsapp', 'rep-msg');
    reportCard.querySelector('#btn-share-li').onclick = () => shareAttemptResult(curAttemptId, 'linkedin', 'rep-msg');
  }

  // ===================================================================
  // COURSE SELECTION & CHECKOUT (STITCH REMITTANCE)
  // ===================================================================

  const RAZORPAY_METHOD_LABELS = {
    upi: 'UPI',
    card: 'Cards',
    netbanking: 'Netbanking',
    wallet: 'Wallets'
  };

  function payButtonMarkup(label) {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg><span>${escHtml(label)}</span>`;
  }

  function resolveCheckoutPricing(coupon) {
    const basePaise = DEFAULT_TUITION_PAISE;
    if (!coupon) {
      return { basePaise, payablePaise: basePaise, discountPaise: 0, subsidyPct: 0, isTest: false };
    }
    const isTest = Boolean(coupon.isTest || coupon.code === 'PGITEST1');
    const rawPayable = isTest
      ? 100
      : (Number.isFinite(coupon.payablePaise) && Number(coupon.payablePaise) > 0
        ? Number(coupon.payablePaise)
        : (Number(coupon.discountPercent) >= 90 ? 99900 : 119900));
    const payablePaise = Math.max(100, rawPayable);
    const discountPaise = Number.isFinite(coupon.discountPaise)
      ? Math.max(0, Number(coupon.discountPaise))
      : Math.max(0, basePaise - payablePaise);
    const subsidyPct = isTest
      ? 99
      : Number(coupon.effectiveDiscountPercent ?? (payablePaise === 99900 ? 90 : 88));
    return { basePaise, payablePaise, discountPaise, subsidyPct, isTest };
  }

  function startCheckoutExpiryTimer(expiresAtIso) {
    if (checkoutExpiryInterval) {
      clearInterval(checkoutExpiryInterval);
      checkoutExpiryInterval = null;
    }
    const wrap = $('co-expiry-wrap');
    const timerEl = $('co-expiry-timer');
    if (!wrap || !timerEl) return;

    const endMs = expiresAtIso ? new Date(expiresAtIso).getTime() : NaN;
    if (!Number.isFinite(endMs)) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');

    const tick = () => {
      const rem = Math.max(0, Math.floor((endMs - Date.now()) / 1000));
      const h = Math.floor(rem / 3600);
      const m = Math.floor((rem % 3600) / 60);
      const s = rem % 60;
      timerEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      if (rem <= 0 && checkoutExpiryInterval) {
        clearInterval(checkoutExpiryInterval);
        checkoutExpiryInterval = null;
      }
    };
    tick();
    checkoutExpiryInterval = setInterval(tick, 1000);
  }

  async function showCourses() {
    show('s-courses');
    ensureRazorpay();
    if ($('btn-back-result')) $('btn-back-result').classList.toggle('hidden', !lastResult);
    const c = lastCoupon;
    $('c-coupon').textContent = c?.code
      ? `Voucher ${c.code} ready (${inr(c.payablePaise)}). Select your internship domain below — default checkout fee is ₹9,999 until you apply your coupon.`
      : 'Standard cohort tuition is ₹9,999. Select your internship domain below to proceed to remittance.';
    msg('c-msg', '');

    const list = $('course-list');
    list.innerHTML = '<div class="loading-card"><div class="spinner"></div><p>Loading course curricula…</p></div>';

    try {
      const courses = await api('/courses');
      list.innerHTML = '';
      if (!courses.length) {
        list.innerHTML = '<p>No training tracks are currently open for registration.</p>';
        return;
      }

      courses.forEach(k => {
        const card = document.createElement('div');
        card.className = 'course-card';

        const voucherLine = c?.code
          ? `<div style="font-size:0.84rem;color:var(--text-muted);margin-top:4px;">With voucher <code>${escHtml(c.code)}</code>: <strong style="color:var(--plant-green);">${inr(c.payablePaise)}</strong></div>`
          : '';

        card.innerHTML = `
          <div>
            <span class="step-chip">${escHtml(k.duration || '30 Hours')}</span>
            <h2>${escHtml(k.title)}</h2>
            <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:12px;">${escHtml(k.description || '')}</p>
            ${k.skills?.length ? `<p style="font-size:0.85rem;color:var(--navy);margin-bottom:8px;"><strong>Curriculum:</strong> ${escHtml(k.skills.join(', '))}</p>` : ''}
            <div class="course-fee">
              Tuition Fee: <strong>₹9,999</strong>
              ${voucherLine}
            </div>
          </div>
        `;

        const enrollBtn = document.createElement('button');
        enrollBtn.type = 'button';
        enrollBtn.className = 'btn btn-primary';
        enrollBtn.style.width = '100%';
        enrollBtn.textContent = 'Select Domain & Proceed to Payment →';
        enrollBtn.onclick = () => openCheckoutModal(k);

        card.appendChild(enrollBtn);
        list.appendChild(card);
      });
    } catch (err) {
      list.innerHTML = `<p class="err">${escHtml(err.message)}</p>`;
    }
  }

  function openCheckoutModal(course) {
    if (!$('s-checkout') || !course) return;
    ensureRazorpay();
    show('s-checkout');

    let appliedCoupon = null;
    let selectedMethod = 'upi';
    let lastOrderId = null;

    const candName = currentUser?.profile?.full_name
      || currentUser?.user_metadata?.full_name
      || lastResult?.candidateName
      || currentUser?.email
      || 'Candidate';
    const candEmail = currentUser?.email || $('user-display')?.textContent || '';
    const candUid = lastResult?.applicationId
      || currentUser?.applicationId
      || currentUser?.batchRegistration?.application_id
      || 'PGI-W26';

    $('co-cand-name').textContent = candName;
    $('co-cand-uid').textContent = `UID: ${candUid}`;
    $('cm-course-title').textContent = course.title || 'Winter Internship Track';
    $('cm-course-duration').textContent = course.duration || '30 Hours';
    $('co-rzp-user-info').textContent = candEmail ? `${candName} · ${candEmail}` : candName;

    const couponInput = $('co-coupon-input');
    const applyBtn = $('co-coupon-apply');
    const removeBtn = $('co-coupon-remove');
    const hintEl = $('co-coupon-hint');
    const payBtn = $('cm-pay-now');
    const methodsList = $('co-methods-list');

    if (couponInput) couponInput.value = '';
    msg('co-coupon-msg', '');
    msg('cm-msg', '');
    if (payBtn) payBtn.disabled = false;

    if (hintEl) {
      const hasHint = Boolean(lastCoupon?.code);
      hintEl.classList.toggle('hidden', !hasHint);
      hintEl.innerHTML = hasHint
        ? `Have your scholarship coupon (<code>${escHtml(lastCoupon.code)}</code>)? Enter it above and click Apply.`
        : '';
    }

    const methodItems = methodsList ? Array.from(methodsList.querySelectorAll('.remit-method-item')) : [];
    const syncMethodSelection = method => {
      selectedMethod = RAZORPAY_METHOD_LABELS[method] ? method : 'upi';
      methodItems.forEach(item => {
        const active = item.dataset.method === selectedMethod;
        item.classList.toggle('is-selected', active);
        const radio = item.querySelector('input[type="radio"]');
        if (radio) radio.checked = active;
      });
      if (!lastOrderId && $('co-order-ref')) {
        $('co-order-ref').textContent = `Gateway: Razorpay · Method: ${RAZORPAY_METHOD_LABELS[selectedMethod]}`;
      }
    };

    methodItems.forEach(item => {
      item.onclick = () => syncMethodSelection(item.dataset.method);
      const radio = item.querySelector('input[type="radio"]');
      if (radio) {
        radio.onchange = () => syncMethodSelection(item.dataset.method);
      }
    });

    const renderCheckoutPricing = () => {
      const p = resolveCheckoutPricing(appliedCoupon);
      const pill = $('co-subsidy-pill');
      if (pill) {
        pill.classList.toggle('is-applied', Boolean(appliedCoupon));
        pill.textContent = p.isTest
          ? `Test Coupon Applied (${appliedCoupon.code}) · ₹1`
          : (appliedCoupon ? `${p.subsidyPct}% Scholarship Applied` : 'Standard Tuition · No Coupon Applied');
      }

      $('cm-base-price').textContent = inr(p.basePaise);
      $('cm-base-price').classList.toggle('is-struck', Boolean(appliedCoupon));
      $('cm-coupon-code').textContent = appliedCoupon
        ? `(${appliedCoupon.code})`
        : '';
      $('cm-discount').textContent = appliedCoupon
        ? `-${inr(p.discountPaise)}`
        : '₹0';
      $('cm-payable').textContent = inr(p.payablePaise);
      $('co-rzp-payable').textContent = inrDecimal(p.payablePaise);

      if (removeBtn) removeBtn.classList.toggle('hidden', !appliedCoupon);
      if (payBtn) {
        payBtn.innerHTML = payButtonMarkup(`Pay ${inr(p.payablePaise)}`);
      }

      if (!lastOrderId && $('co-order-ref')) {
        $('co-order-ref').textContent = `Gateway: Razorpay · Method: ${RAZORPAY_METHOD_LABELS[selectedMethod]}`;
      }

      startCheckoutExpiryTimer(p.isTest ? null : (appliedCoupon?.expiresAt || lastCoupon?.expiresAt || null));
    };

    const applyCouponHandler = async () => {
      const code = String(couponInput?.value || '').trim().toUpperCase();
      if (!code) {
        msg('co-coupon-msg', 'Please enter a valid scholarship coupon code.');
        return;
      }
      if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = 'Applying…';
      }
      msg('co-coupon-msg', '');
      try {
        const res = await api('/coupons/validate', { code, email: candEmail });
        if (!res.valid) {
          msg('co-coupon-msg', res.reason || 'Coupon code is invalid or expired for your account.');
          return;
        }
        appliedCoupon = res;
        lastOrderId = null;
        if (couponInput) couponInput.value = res.code || code;
        renderCheckoutPricing();
        const payableTxt = inr(res.payablePaise);
        msg('co-coupon-msg', `Coupon ${res.code} applied! Payable fee updated to ${payableTxt}.`, true);
      } catch (err) {
        msg('co-coupon-msg', err.message || 'Unable to validate coupon right now.');
      } finally {
        if (applyBtn) {
          applyBtn.disabled = false;
          applyBtn.textContent = 'Apply';
        }
      }
    };

    if (applyBtn) applyBtn.onclick = applyCouponHandler;
    if (couponInput) {
      couponInput.onkeydown = e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyCouponHandler();
        }
      };
    }

    if (removeBtn) {
      removeBtn.onclick = () => {
        appliedCoupon = null;
        lastOrderId = null;
        if (couponInput) couponInput.value = '';
        msg('co-coupon-msg', 'Coupon removed. Fee reverted to standard ₹9,999.', true);
        renderCheckoutPricing();
      };
    }

    $('cm-cancel').onclick = () => {
      if (checkoutExpiryInterval) {
        clearInterval(checkoutExpiryInterval);
        checkoutExpiryInterval = null;
      }
      showCourses();
    };

    syncMethodSelection('upi');
    renderCheckoutPricing();

    payBtn.onclick = async () => {
      payBtn.disabled = true;
      msg('cm-msg', 'Initializing secure Razorpay gateway…', true);

      try {
        const payload = { courseId: course.id };
        if (appliedCoupon?.code) payload.couponCode = appliedCoupon.code;
        const ord = await api('/checkout/create', payload);

        if (ord.status === 'enrolled') {
          if (checkoutExpiryInterval) {
            clearInterval(checkoutExpiryInterval);
            checkoutExpiryInterval = null;
          }
          saveRecentPayment({
            enrollmentId: ord.enrollmentId,
            studentId: ord.studentId,
            receiptNo: ord.receiptNo,
            portalPassword: ord.portalPassword || null,
            orderId: null,
            paymentId: ord.paymentId,
            methodLabel: 'Verified Online'
          });
          window.__pgiBootPromise = null;
          window.__pgiBootToken = null;
          return boot();
        }

        lastOrderId = ord.orderId;
        if ($('co-order-ref')) $('co-order-ref').textContent = `Order ID: ${ord.orderId}`;

        if (!(await ensureRazorpay())) {
          throw new Error('Payment gateway failed to load. Check your internet connection.');
        }

        const chosenMethodLabel = RAZORPAY_METHOD_LABELS[selectedMethod] || 'Razorpay';
        const prefillProfile = currentUser?.profile || {};
        const rz = new Razorpay({
          key: ord.keyId,
          amount: ord.amount,
          currency: ord.currency,
          order_id: ord.orderId,
          name: 'Plant Green Inertia',
          description: `Winter Internship: ${course.title}`,
          prefill: {
            name: prefillProfile.full_name || candName || '',
            email: candEmail,
            contact: prefillProfile.phone || '',
            method: selectedMethod
          },
          theme: { color: '#0F1B33' },
          handler: resp => {
            verifyPayment(resp, chosenMethodLabel);
          },
          modal: {
            ondismiss: () => {
              msg('cm-msg', 'Payment window closed. You can switch method or retry below.');
              payBtn.disabled = false;
            }
          }
        });

        rz.on('payment.failed', async r => {
          const desc = r.error?.description || 'Payment failed. Please retry with another payment method.';
          msg('cm-msg', desc);
          payBtn.disabled = false;
          try {
            await api('/checkout/failed', {
              razorpay_order_id: ord.orderId,
              payment_id: r.error?.metadata?.payment_id,
              error: r.error
            });
          } catch {}
        });

        rz.open();
        msg('cm-msg', '');
      } catch (err) {
        msg('cm-msg', err.message || 'Could not start checkout.');
        payBtn.disabled = false;
      }
    };
  }

  function saveRecentPayment(info) {
    try {
      sessionStorage.setItem('pgi_recent_payment', JSON.stringify(info || {}));
    } catch {}
  }

  function loadRecentPayment() {
    try {
      return JSON.parse(sessionStorage.getItem('pgi_recent_payment') || 'null');
    } catch {
      return null;
    }
  }

  function bindCopyButton(btn, value, idleText = 'Copy') {
    if (!btn) return;
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(String(value || ''));
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = idleText; }, 1600);
      } catch {
        btn.textContent = 'Copy';
      }
    };
  }

  async function verifyPayment(resp, methodLabel = 'Razorpay') {
    show('loading');
    $('loading-text').textContent = 'Verifying payment with banking servers… please keep this window open.';
    for (let i = 0; i < 10; i++) {
      try {
        const v = await api('/checkout/verify', resp);
        if (v.status === 'enrolled') {
          saveRecentPayment({
            enrollmentId: v.enrollmentId,
            studentId: v.studentId,
            receiptNo: v.receiptNo,
            portalPassword: v.portalPassword || null,
            orderId: v.orderId || resp.razorpay_order_id || null,
            paymentId: v.paymentId || resp.razorpay_payment_id || null,
            methodLabel
          });
          window.__pgiBootPromise = null;
          window.__pgiBootToken = null;
          return boot();
        }
        if (v.status === 'failed') {
          show('s-courses');
          return msg('c-msg', 'Payment verification failed. Please contact support or retry.');
        }
      } catch (err) {
        if (err.status === 400 || err.status === 404) {
          show('s-courses');
          return msg('c-msg', err.message);
        }
      }
      await new Promise(r => setTimeout(r, 2500));
    }
    show('s-courses');
    msg('c-msg', 'Payment verification queued. If debited, your enrollment will reflect shortly. Refresh to view.', true);
  }

  // Student Seat Confirmation & Dashboard
  async function showDashboard(d) {
    show('s-dash');
    const box = $('dash');
    box.innerHTML = '';
    const e = d.enrollment;
    const studentId = e.studentId || d.studentId || 'Assigned';
    const receiptNo = e.receiptNo || 'REC-PGI-W26';

    try {
      if (token) {
        localStorage.setItem('pgi_student_token', token);
        sessionStorage.setItem('pgi_student_token', token);
      }
      if (studentId) {
        localStorage.setItem('pgi_student_id', studentId);
        sessionStorage.setItem('pgi_student_id', studentId);
      }
    } catch {}

    const recent = loadRecentPayment();
    const matchesRecent = recent && (recent.enrollmentId === e.id || recent.receiptNo === receiptNo);
    const portalPassword = (matchesRecent ? recent.portalPassword : null)
      || e.portalAccessKey
      || d.portalAccessKey
      || null;
    const orderId = e.orderId || (matchesRecent ? recent.orderId : null) || receiptNo;
    const txRef = e.transactionRef || (matchesRecent ? recent.paymentId : null) || receiptNo;

    const basePaise = Number(e.basePricePaise || DEFAULT_TUITION_PAISE);
    const paidPaise = Math.max(0, Number(e.amountPaise ?? 0));
    const discountPaise = Math.max(0, basePaise - paidPaise);
    const couponTag = e.couponCode || d.coupon?.code || '';
    const methodText = matchesRecent?.methodLabel
      ? `Razorpay (${matchesRecent.methodLabel})`
      : 'Razorpay Online';

    const candName = escHtml(d.profile?.full_name || 'Candidate');
    const candEmail = escHtml(d.email || '');
    const courseTitle = escHtml(e.course?.title || 'Winter Internship Track');
    const duration = escHtml(e.course?.duration || '30 Hours');
    const paidDateFmt = escHtml(
      e.enrolledAt
        ? new Date(e.enrolledAt).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          })
        : 'Confirmed'
    );

    const dashContainer = document.createElement('div');
    dashContainer.innerHTML = `
      <div class="confirm-hero">
        <div class="confirm-check-circle" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div class="confirm-status-kicker">
          <span>PAYMENT COMPLETE</span>
          <span aria-hidden="true">&bull;</span>
          <span class="ref">#${escHtml(receiptNo)}</span>
        </div>
        <h1>Seat Confirmed</h1>
        <p class="confirm-hero-sub">Welcome to Winter Cohort 2026.</p>
        <div class="confirm-hero-chips">
          <span class="confirm-chip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>
            Razorpay Verified
          </span>
          <span class="confirm-chip is-amt">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
            ${escHtml(inrDecimal(paidPaise))} INR Settled
          </span>
        </div>
      </div>

      <div class="confirm-two-col">
        <!-- Left Card: Official Receipt -->
        <div class="confirm-card">
          <div class="confirm-card-head">
            <div class="confirm-head-left">
              <div class="confirm-doc-ico" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="8" y1="13" x2="16" y2="13"></line>
                  <line x1="8" y1="17" x2="13" y2="17"></line>
                </svg>
              </div>
              <div>
                <h2>Official Receipt</h2>
                <span class="confirm-head-sub">Invoice #${escHtml(receiptNo)}</span>
              </div>
            </div>
            <span class="confirm-pill">&#10003; Paid</span>
          </div>

          <div class="confirm-meta-box">
            <div>
              <span class="confirm-meta-lbl">Payment ID</span>
              <span class="confirm-meta-val">
                <code id="conf-tx-ref">${escHtml(txRef)}</code>
                <button type="button" class="confirm-copy-btn" id="copy-tx-btn" title="Copy Payment ID">Copy</button>
              </span>
            </div>
            <div>
              <span class="confirm-meta-lbl">Order ID</span>
              <span class="confirm-meta-val"><code>${escHtml(orderId)}</code></span>
            </div>
            <div>
              <span class="confirm-meta-lbl">Date</span>
              <span class="confirm-meta-val">${paidDateFmt}</span>
            </div>
            <div>
              <span class="confirm-meta-lbl">Payment Method</span>
              <span class="confirm-meta-val">${escHtml(methodText)}</span>
            </div>
          </div>

          <div class="confirm-mini-pair">
            <div class="confirm-mini-box">
              <span class="confirm-meta-lbl">Fellow</span>
              <strong>${candName}</strong>
              <small>${candEmail}</small>
            </div>
            <div class="confirm-mini-box">
              <span class="confirm-meta-lbl">Track</span>
              <strong class="is-track">${courseTitle}</strong>
              <small class="is-green">Confirmed Seat &bull; ${duration}</small>
            </div>
          </div>

          <div class="confirm-ledger">
            <div class="confirm-ledger-row">
              <span class="lbl">Fellowship Tuition</span>
              <span class="val">${escHtml(inrDecimal(basePaise))}</span>
            </div>
            <div class="confirm-ledger-row ${discountPaise > 0 ? 'is-sub' : ''}">
              <span class="lbl">Merit Grant Voucher${couponTag ? ` (${escHtml(couponTag)})` : ''}</span>
              <span class="val">${discountPaise > 0 ? `-${escHtml(inrDecimal(discountPaise))}` : '₹0.00'}</span>
            </div>
            <div class="confirm-ledger-row">
              <span class="lbl">GST (Included)</span>
              <span class="val">₹0.00</span>
            </div>
            <div class="confirm-total-row">
              <strong>AMOUNT PAID</strong>
              <strong>${escHtml(inrDecimal(paidPaise))}</strong>
            </div>
          </div>

          <div class="confirm-receipt-foot">
            <button type="button" id="btn-receipt-pdf" class="confirm-btn-pdf">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>Download PDF</span>
            </button>
            <span class="confirm-emailed-note">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"></rect><polyline points="22,6 12,13 2,6"></polyline></svg>
              Receipt Emailed
            </span>
          </div>
        </div>

        <!-- Right Column Stack: Portal Credentials + Next Steps -->
        <div class="confirm-right-stack">
          <div class="confirm-card">
            <div class="confirm-card-head">
              <h2>Portal Credentials</h2>
              <span class="confirm-pill">&bull; Active</span>
            </div>

            <div class="confirm-cred-grid">
              <div class="confirm-cred-box">
                <span class="confirm-meta-lbl">Student ID</span>
                <div class="confirm-cred-val-row">
                  <strong id="conf-student-id">${escHtml(studentId)}</strong>
                  <button type="button" class="confirm-copy-btn" id="copy-uid-btn" title="Copy Student ID">Copy</button>
                </div>
              </div>
              <div class="confirm-cred-box">
                <span class="confirm-meta-lbl">Access Key</span>
                <div class="confirm-cred-val-row">
                  <strong id="conf-access-key" class="is-green">${portalPassword ? escHtml(portalPassword) : 'Sent via Email'}</strong>
                  ${portalPassword ? '<button type="button" class="confirm-copy-btn" id="copy-pass-btn" title="Copy Access Key">Copy</button>' : ''}
                </div>
              </div>
            </div>

            <p class="confirm-cred-note">
              ${portalPassword
                ? `Temporary access key issued above and emailed to ${candEmail}. Use Student ID (${escHtml(studentId)}) at Student Portal login.`
                : `Portal session is active. Sign in anytime using Student ID (${escHtml(studentId)}) or ${candEmail} with your emailed password.`}
            </p>

            <a href="student-login.html${studentId && studentId !== 'Assigned' ? `?uid=${encodeURIComponent(studentId)}` : ''}" class="confirm-open-btn" id="conf-open-portal">
              <span>Open Portal</span>
              <span aria-hidden="true">&rarr;</span>
            </a>
          </div>

          <div class="confirm-card">
            <div class="confirm-card-head">
              <h2>Next Steps</h2>
              <span class="confirm-pill">4 of 4 Ready</span>
            </div>

            <div class="confirm-step-list">
              <div class="confirm-step-item">
                <span class="confirm-step-left"><span class="confirm-step-ico">&#10003;</span> Fee Remitted</span>
                <span class="confirm-step-right is-muted">${escHtml(inr(paidPaise))}</span>
              </div>
              <div class="confirm-step-item">
                <span class="confirm-step-left"><span class="confirm-step-ico">&#10003;</span> Student ID Provisioned</span>
                <span class="confirm-step-right">${escHtml(studentId)}</span>
              </div>
              <div class="confirm-step-item">
                <span class="confirm-step-left"><span class="confirm-step-ico">&#10003;</span> Offer Letter &amp; Receipt</span>
                <span class="confirm-step-right">Ready Below</span>
              </div>
              <div class="confirm-step-item">
                <span class="confirm-step-left"><span class="confirm-step-ico" style="display:inline-flex;align-items:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span> Winter Cohort Curriculum</span>
                <span class="confirm-step-right">Active Now</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="confirm-help-bar">
        <div class="confirm-help-left">
          <div class="confirm-help-ico" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>
          </div>
          <div>
            <strong>Need Help?</strong>
            <span>Admissions &amp; Academic Desk &bull; +91 82206 99083</span>
          </div>
        </div>
        <div class="confirm-help-actions">
          <a href="mailto:admissions@plantgreeninertia.com" class="confirm-mail-pill">admissions@plantgreeninertia.com</a>
          <a href="https://wa.me/918220699083" target="_blank" rel="noopener" class="confirm-wa-pill">WhatsApp Help</a>
        </div>
      </div>

      <div class="card confirm-docs-card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
          <div>
            <h3 style="font-family:var(--font-display);font-size:1.1rem;color:var(--navy);margin:0 0 4px;">Official Credentials &amp; Attendance Register</h3>
            <p style="font-size:0.84rem;color:var(--text-muted);margin:0;">Linked strictly by <strong>Student ID (<code style="color:var(--plant-green);">${escHtml(studentId)}</code>)</strong></p>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button type="button" id="btn-offer-letter" class="btn btn-outline" style="display:inline-flex;align-items:center;gap:6px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg> Official Offer Letter (PDF)</button>
            <button type="button" id="btn-portal-report" class="btn btn-outline" style="display:inline-flex;align-items:center;gap:6px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> 1-Page Project Report (PDF)</button>
          </div>
        </div>
        <div id="dash-doc-msg" class="msg" style="margin-bottom:12px;"></div>
        <div class="telemetry-grid" style="margin-bottom:16px;">
          <div class="telemetry-tile">
            <span class="tile-title">Attendance Ratio</span>
            <span class="tile-val" id="portal-att-pct" style="color:var(--plant-green);">100%</span>
            <span class="tile-sub">Min 75% required</span>
          </div>
          <div class="telemetry-tile">
            <span class="tile-title">Completed Hours</span>
            <span class="tile-val" id="portal-att-hours">0 / 30 hrs</span>
            <span class="tile-sub">Authoritative DB clock</span>
          </div>
          <div class="telemetry-tile">
            <span class="tile-title">Present Days</span>
            <span class="tile-val" id="portal-att-present" style="color:var(--plant-green);">0 Days</span>
            <span class="tile-sub">Biometric verified</span>
          </div>
          <div class="telemetry-tile">
            <span class="tile-title">Absent Days</span>
            <span class="tile-val" id="portal-att-absent" style="color:var(--danger);">0 Days</span>
            <span class="tile-sub">Total records</span>
          </div>
        </div>

        <div class="attendance-table-wrap">
          <table class="attendance-table">
            <thead>
              <tr>
                <th>Day #</th>
                <th>Date</th>
                <th>Session Title</th>
                <th>Mode</th>
                <th>Hours</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="portal-att-table-body">
              <tr><td colspan="6" style="text-align:center;padding:16px;">Loading verified attendance records…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    box.appendChild(dashContainer);

    bindCopyButton(dashContainer.querySelector('#copy-tx-btn'), txRef);
    bindCopyButton(dashContainer.querySelector('#copy-uid-btn'), studentId);
    if (portalPassword) {
      bindCopyButton(dashContainer.querySelector('#copy-pass-btn'), portalPassword);
    }

    // Event listeners
    dashContainer.querySelector('#btn-receipt-pdf').onclick = async () => {
      const btn = dashContainer.querySelector('#btn-receipt-pdf');
      btn.disabled = true;
      msg('dash-doc-msg', 'Generating official payment receipt PDF…', true);
      try {
        const res = await fetch(`/api/enrollments/${e.id}/receipt.pdf`, {
          headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('Receipt document unavailable');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `PGI-Payment-Receipt-${receiptNo}.pdf`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        msg('dash-doc-msg', 'Receipt downloaded successfully.', true);
      } catch (err) {
        msg('dash-doc-msg', err.message);
      } finally {
        btn.disabled = false;
      }
    };

    dashContainer.querySelector('#btn-offer-letter').onclick = async () => {
      const res = await fetch('/api/offer-letter', { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) return alert('Offer letter document unavailable');
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      window.open(u);
    };

    dashContainer.querySelector('#btn-portal-report').onclick = async () => {
      const btn = dashContainer.querySelector('#btn-portal-report');
      btn.disabled = true;
      msg('dash-doc-msg', 'Generating complimentary 1-page project report…', true);
      try {
        const res = await fetch('/api/student/project-report.pdf', {
          headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('Report generation failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `PGI-Project-Report-${studentId}.pdf`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        msg('dash-doc-msg', '1-Page Project Report downloaded successfully.', true);
      } catch (err) {
        msg('dash-doc-msg', err.message);
      } finally {
        btn.disabled = false;
      }
    };

    // Load Attendance into table
    try {
      const attRes = await fetch('/api/student/attendance', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (attRes.ok) {
        const attData = await attRes.json();
        const stats = attData.stats || {};
        $('portal-att-pct').textContent = `${stats.attendancePercentage || 100}%`;
        $('portal-att-hours').textContent = `${stats.completedHours || 0} / 30 hrs`;
        $('portal-att-present').textContent = `${stats.presentDays || 0} Days`;
        $('portal-att-absent').textContent = `${stats.absentDays || 0} Days`;

        const rows = (attData.records || []).map(r => `
          <tr>
            <td><strong>Day ${r.day_number || 1}</strong></td>
            <td>${r.date || '—'}</td>
            <td>${r.session_title || 'Internship Training Lab'}</td>
            <td>${r.mode || 'Online'}</td>
            <td><strong>${r.hours_logged || 3} hrs</strong></td>
            <td><span class="att-pill ${r.status === 'present' ? 'present' : 'absent'}">${(r.status || 'present').toUpperCase()}</span></td>
          </tr>
        `).join('');

        const tBody = $('portal-att-table-body');
        if (tBody) tBody.innerHTML = rows || '<tr><td colspan="6" style="text-align:center;">No records.</td></tr>';
      }
    } catch (err) {
      console.warn('[Portal Attendance Load]', err);
    }

    if (d.attempt) addReport(box);
  }

  // ===================================================================
  // BOOTSTRAPPER
  // ===================================================================

  async function boot() {
    const qParams = new URLSearchParams(window.location.search);
    const qEmail = qParams.get('email');
    const qAppId = qParams.get('appId');
    const qRef = qParams.get('ref');

    if (qRef) {
      sessionStorage.setItem('pgi_referral', qRef);
      localStorage.setItem('pgi_referral', qRef);
    }
    if (!manualAuthCompleted) {
      if ((qEmail || qAppId) && $('email') && !$('email').value) {
        $('email').value = qEmail || qAppId;
      }
      if (qAppId) {
        sessionStorage.setItem('pgi_application_id', qAppId);
        localStorage.setItem('pgi_application_id', qAppId);
      }
    }

    let activeSession = null;
    let bootData = null;

    if (!manualAuthCompleted && window.__pgiBootPromise && window.__pgiBootToken) {
      token = window.__pgiBootToken;
      activeSession = { access_token: window.__pgiBootToken, user: { email: window.__pgiBootEmail || '' } };
      $('logout').classList.remove('hidden');
      if (activeSession.user.email) $('user-display').textContent = activeSession.user.email;
      try {
        bootData = await window.__pgiBootPromise;
      } catch (statusOrErr) {
        window.__pgiBootPromise = null;
        window.__pgiBootToken = null;
        activeSession = null;
        token = null;
        if (statusOrErr === 401) clearStoredAuth();
      }
    }

    if (!activeSession) {
      const storedToken = sessionStorage.getItem('pgi_student_token') || localStorage.getItem('pgi_student_token');
      const storedEmail = (sessionStorage.getItem('pgi_student_email') || localStorage.getItem('pgi_student_email') || '').toLowerCase();
      if (storedToken && (manualAuthCompleted || !qEmail || storedEmail === qEmail.trim().toLowerCase())) {
        activeSession = { access_token: storedToken, user: { email: storedEmail } };
      }
    }

    if (!activeSession) {
      const client = await ensureSb();
      if (client) {
        const { data } = await client.auth.getSession();
        activeSession = data.session;
        if (!manualAuthCompleted && activeSession && qEmail && activeSession.user?.email?.toLowerCase() !== qEmail.trim().toLowerCase()) {
          clearStoredAuth();
          await client.auth.signOut().catch(() => {});
          activeSession = null;
        }
      }
    }

    if (!activeSession) {
      $('logout').classList.add('hidden');
      $('user-display').textContent = '';
      const preferRegister = qParams.get('mode') === 'register';
      setAuthMode(preferRegister ? 'register' : 'login');
      if (!preferRegister && (qAppId || qEmail)) {
        msg('auth-msg', 'Enter your Date of Birth (DD/MM/YYYY) to verify and proceed to Proctor Check.', true);
      }
      return show('s-auth');
    }

    token = activeSession.access_token;
    $('logout').classList.remove('hidden');
    if (activeSession.user?.email) $('user-display').textContent = activeSession.user.email;

    try {
      const { me, dashboard: d, completedResult } = bootData || await api('/portal/boot');
      currentUser = me;
      if (me.email) $('user-display').textContent = me.email;
      if (!me.profile?.full_name || !me.profile?.phone) {
        const pp = JSON.parse(localStorage.getItem('pendingProfile') || 'null');
        if (pp) {
          try {
            await api('/profile', { fullName: pp.name, phone: pp.phone });
            localStorage.removeItem('pendingProfile');
            window.__pgiBootPromise = null;
            return boot();
          } catch {}
        }
        $('p-name').value = me.profile?.full_name || '';
        return show('s-profile');
      }

      if (d.enrollment) {
        pendingPaymentRedirect = false;
        return showDashboard(d);
      }

      if (pendingPaymentRedirect) {
        pendingPaymentRedirect = false;
        if (completedResult) {
          endMonitoring();
          lastResult = completedResult;
          lastCoupon = completedResult.coupon;
          if (completedResult.coupon?.state === 'active') return showCourses();
          return showResult(completedResult);
        }
        const payRes = await api('/assessment/payment-eligibility');
        if (payRes.completed && payRes.result) {
          endMonitoring();
          lastResult = payRes.result;
          lastCoupon = payRes.result.coupon;
          if (payRes.result.coupon?.state === 'active') return showCourses();
          return showResult(payRes.result);
        }
        if (payRes.testCouponAvailable) {
          endMonitoring();
          await showCourses();
          msg('c-msg', 'No completed assessment yet — you can apply an active test coupon at checkout.', true);
          return;
        }
        show('s-inst');
        initPreFlightProctor(me);
        const notice = payRes.message || 'No completed assessment found for your account yet. Complete Proctor Verification and submit the assessment first.';
        setPvPaymentAlert(notice);
        msg('inst-msg', notice, false);
        return;
      }

      if (me.attempt && me.attempt.status !== 'in_progress' && !me.canRetry) {
        return showResult(completedResult || await api(`/attempts/${me.attempt.id}/result`));
      }

      setPvPaymentAlert('');
      show('s-inst');
      initPreFlightProctor(me);
      if (me.canRetry) {
        msg('inst-msg', 'Your cohort retry period is now open — you may attempt the assessment.', true);
      } else if (me.attempt && me.attempt.status === 'in_progress') {
        msg('inst-msg', 'You have an active assessment in progress. Verify your camera and click start to resume.', true);
      }
    } catch (err) {
      if (err.status === 401) {
        clearStoredAuth();
        if (sb) await sb.auth.signOut().catch(() => {});
        return boot();
      }
      $('loading-text').textContent = err.message;
      show('loading');
    }
  }

  if (hasCachedSession) {
    await boot();
  }
})();
