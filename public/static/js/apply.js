/**
 * Winter Internship Application & Promise Slides Controller (Stitch Design Specification)
 * Handles referral tracking, segmented toggle controls, real-time validation,
 * duplicate detection, and the 4-step promise slides journey.
 */

document.addEventListener('DOMContentLoaded', () => {
  // =========================================================================
  // 1. Referral Tracking
  // =========================================================================
  const urlParams = new URLSearchParams(window.location.search);
  let referral = urlParams.get('ref') || sessionStorage.getItem('pgi_referral') || localStorage.getItem('pgi_referral') || '';
  referral = referral.trim().slice(0, 50);

  if (referral) {
    sessionStorage.setItem('pgi_referral', referral);
    localStorage.setItem('pgi_referral', referral);
    const refInput = document.getElementById('referralCode');
    if (refInput) refInput.value = referral;

    document.querySelectorAll('[data-start]').forEach(btn => {
      btn.setAttribute('href', `apply.html?ref=${encodeURIComponent(referral)}`);
    });

    const refBanner = document.getElementById('referralBanner');
    const refCodeText = document.getElementById('refCodeText');
    if (refBanner && refCodeText) {
      refCodeText.textContent = referral;
      refBanner.style.display = 'block';
    }
  }

  // Mobile navigation toggle (unified with main landing page)
  const burger = document.querySelector('.burger');
  const navMenu = document.querySelector('.nav-menu');
  if (burger && navMenu) {
    burger.addEventListener('click', () => {
      const isOpen = navMenu.classList.toggle('open');
      burger.setAttribute('aria-expanded', isOpen);
    });
    navMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // =========================================================================
  // 2. Domain Type -> Specialized Track Dependent Dropdown
  // =========================================================================
  const DOMAINS = {
    'Technical': [
      'Full-Stack Web Development & Cloud Architecture',
      'Mobile App Development (MIT App Inventor / Android)',
      'Web Development, HTML, CSS, JavaScript & GitHub',
      'Data Analytics & Machine Learning Basics'
    ],
    'Non-Technical': [
      'Digital Operations & Agile Project Management',
      'Business Analytics & Tech Communication',
      'Digital Growth & Product Marketing'
    ]
  };

  const domainTypeInput = document.getElementById('domainType');
  const domainNameSelect = document.getElementById('domainName');

  function updateDomainOptions(type, preserveValue = '') {
    if (!domainNameSelect) return;
    domainNameSelect.innerHTML = '<option value="">-- Select Specialized Track --</option>';
    const options = DOMAINS[type] || [];
    options.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt;
      el.textContent = opt;
      if (opt === preserveValue || (!preserveValue && opt.includes('Web Development'))) {
        el.selected = true;
      }
      domainNameSelect.appendChild(el);
    });
  }

  // Domain Segmented Buttons
  const domainButtons = document.querySelectorAll('#domainTypeGroup .domain-btn');
  domainButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      domainButtons.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const val = btn.getAttribute('data-domain');
      if (domainTypeInput) domainTypeInput.value = val;
      updateDomainOptions(val);
      validateField(domainNameSelect);
    });
  });

  // Default selection
  updateDomainOptions(domainTypeInput?.value || 'Technical');

  // =========================================================================
  // 3. Operational Mode Cards (Online / Offline)
  // =========================================================================
  const modeInput = document.getElementById('mode');
  const modeCards = document.querySelectorAll('#modeCardsGroup .mode-selectable-card');

  modeCards.forEach(card => {
    card.addEventListener('click', () => {
      modeCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const selectedMode = card.getAttribute('data-mode');
      if (modeInput) modeInput.value = selectedMode;
    });
  });

  // =========================================================================
  // 4. Graduation Year Segmented Buttons
  // =========================================================================
  const yearInput = document.getElementById('passedOutYear');
  const yearButtons = document.querySelectorAll('#yearSegmentedGroup .segmented-btn');

  yearButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      yearButtons.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const selectedYear = btn.getAttribute('data-year');
      if (yearInput) yearInput.value = selectedYear;
    });
  });

  // =========================================================================
  // 5. Internship Period Segmented Chips
  // =========================================================================
  const periodInput = document.getElementById('internshipPeriod');
  const periodChips = document.querySelectorAll('#periodChipsGroup .period-chip');

  periodChips.forEach(chip => {
    chip.addEventListener('click', () => {
      periodChips.forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      const selectedPeriod = chip.getAttribute('data-period');
      if (periodInput) periodInput.value = selectedPeriod;
    });
  });

  // =========================================================================
  // 6. Character Counter for "Why should we hire you?"
  // =========================================================================
  const whyHireText = document.getElementById('whyHire');
  const charCounter = document.getElementById('charCount');
  if (whyHireText && charCounter) {
    whyHireText.addEventListener('input', () => {
      const len = whyHireText.value.trim().length;
      charCounter.textContent = `${len} characters`;
      charCounter.style.color = len >= 10 ? 'var(--stitch-emerald)' : 'var(--stitch-muted)';
    });
  }

  // =========================================================================
  // 7. Real-Time Field Validation
  // =========================================================================
  const form = document.getElementById('enquiryForm');
  const fields = {
    fullName: {
      el: document.getElementById('fullName'),
      validate: val => val.trim().length >= 2,
      errorMsg: 'Please enter your full legal name.'
    },
    email: {
      el: document.getElementById('email'),
      validate: val => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim()),
      errorMsg: 'Please enter a valid email address.'
    },
    mobile: {
      el: document.getElementById('mobile'),
      validate: val => val.replace(/\D/g, '').slice(-10).length === 10,
      errorMsg: 'Please enter a valid 10-digit mobile number.'
    },
    dob: {
      el: document.getElementById('dob'),
      validate: val => {
        const m = String(val || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return false;
        const yr = Number(m[1]);
        return yr >= 1960 && yr <= new Date().getFullYear() - 12;
      },
      errorMsg: 'Please select a valid Date of Birth.'
    },
    college: {
      el: document.getElementById('college'),
      validate: val => val.trim().length >= 2,
      errorMsg: 'Please enter your college / university name.'
    },
    department: {
      el: document.getElementById('department'),
      validate: val => val.trim().length >= 2,
      errorMsg: 'Please select or enter your department.'
    },
    domainName: {
      el: document.getElementById('domainName'),
      validate: val => val.trim().length > 0,
      errorMsg: 'Please select a specialized track.'
    },
    address: {
      el: document.getElementById('address'),
      validate: val => val.trim().length >= 4,
      errorMsg: 'Please enter your current residential city & state.'
    }
  };

  function validateField(inputEl) {
    if (!inputEl) return true;
    const key = Object.keys(fields).find(k => fields[k].el === inputEl);
    if (!key) return true;

    const rule = fields[key];
    const val = inputEl.value;
    const isValid = rule.validate(val);
    const feedbackEl = document.getElementById(`${key}Feedback`);

    if (key === 'dob' && feedbackEl) {
      if (val.trim() === '' && !inputEl.dataset.touched) {
        inputEl.classList.remove('is-invalid');
        feedbackEl.style.color = 'var(--stitch-muted)';
        feedbackEl.textContent = 'Used as your assessment login password (DDMMYYYY)';
        return false;
      }
      if (isValid) {
        inputEl.classList.remove('is-invalid');
        const [y, m, d] = val.trim().split('-');
        feedbackEl.style.color = '#0A8A54';
        feedbackEl.textContent = `Password (DDMMYYYY): ${d}${m}${y}`;
        return true;
      }
      inputEl.classList.add('is-invalid');
      feedbackEl.style.color = '';
      feedbackEl.textContent = rule.errorMsg;
      return false;
    }

    if (val.trim() === '' && !inputEl.dataset.touched) {
      inputEl.classList.remove('is-invalid');
      if (feedbackEl) feedbackEl.textContent = '';
      return false;
    }

    if (isValid) {
      inputEl.classList.remove('is-invalid');
      if (feedbackEl) feedbackEl.textContent = '';
      return true;
    } else {
      inputEl.classList.add('is-invalid');
      if (feedbackEl) feedbackEl.textContent = rule.errorMsg;
      return false;
    }
  }

  // Bind live validation events
  Object.values(fields).forEach(({ el }) => {
    if (!el) return;
    el.addEventListener('blur', () => {
      el.dataset.touched = 'true';
      validateField(el);
    });
    el.addEventListener('input', () => {
      if (el.dataset.touched) validateField(el);
    });
    if (el.tagName === 'SELECT' || el.type === 'date') {
      el.addEventListener('change', () => {
        el.dataset.touched = 'true';
        validateField(el);
      });
    }
  });

  // =========================================================================
  // 7B. Already Registered Pop-Up Dialog Box Controller
  // =========================================================================
  let dismissedDupKey = '';

  function hideDuplicateDialog(markKey = '') {
    if (markKey) dismissedDupKey = markKey;
    document.getElementById('duplicateModalOverlay')?.classList.remove('active');
  }

  function showDuplicateDialog({ applicationId, email, message, checkKey = '' }) {
    const overlay = document.getElementById('duplicateModalOverlay');
    const cleanUid = applicationId && applicationId !== 'REGISTERED' ? applicationId : '';
    const portalUrl = `portal.html?mode=login${cleanUid ? '&appId=' + encodeURIComponent(cleanUid) : ''}${email ? '&email=' + encodeURIComponent(email) : ''}${referral ? '&ref=' + encodeURIComponent(referral) : ''}`;

    if (!overlay) {
      window.location.href = portalUrl;
      return;
    }

    const msgEl = document.getElementById('dup-modal-msg');
    const uidBox = document.getElementById('dup-modal-uid-box');
    const uidEl = document.getElementById('dup-modal-uid');
    const contBtn = document.getElementById('dup-modal-continue');
    const closeBtn = document.getElementById('dup-modal-close');
    const dismissBtn = document.getElementById('dup-modal-dismiss');

    if (msgEl) {
      msgEl.textContent = message || 'An application with this email address or mobile number already exists.';
    }
    if (uidBox && uidEl) {
      if (cleanUid) {
        uidEl.textContent = cleanUid;
        uidBox.style.display = 'flex';
      } else {
        uidBox.style.display = 'none';
      }
    }

    if (contBtn) {
      contBtn.onclick = () => {
        if (cleanUid) {
          sessionStorage.setItem('pgi_application_id', cleanUid);
          localStorage.setItem('pgi_application_id', cleanUid);
        }
        if (email) sessionStorage.setItem('pgi_email', email);
        window.location.href = portalUrl;
      };
    }

    const closeHandler = () => hideDuplicateDialog(checkKey);
    if (closeBtn) closeBtn.onclick = closeHandler;
    if (dismissBtn) dismissBtn.onclick = closeHandler;
    overlay.onclick = e => {
      if (e.target === overlay || e.target.parentElement === overlay) closeHandler();
    };

    overlay.classList.add('active');
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('duplicateModalOverlay')?.classList.contains('active')) {
      hideDuplicateDialog(dismissedDupKey);
    }
  });

  // Debounced check for existing duplicate application
  let dupCheckTimeout = null;
  function checkDuplicateLive() {
    clearTimeout(dupCheckTimeout);
    dupCheckTimeout = setTimeout(async () => {
      const email = (fields.email.el?.value || '').trim().toLowerCase();
      const mobile = (fields.mobile.el?.value || '').replace(/\D/g, '').slice(-10);
      if (!email && mobile.length !== 10) return;

      const checkKey = `${email}|${mobile}`;
      try {
        const res = await fetch(`/api/applications/check?email=${encodeURIComponent(email)}&phone=${encodeURIComponent(mobile)}`);
        if (!res.ok) return;
        const data = await res.json();
        const dupBanner = document.getElementById('duplicateAlert');
        if (data.exists) {
          if (data.applicationId && data.applicationId !== 'REGISTERED') {
            document.getElementById('side-uid-disp').textContent = data.applicationId;
            document.getElementById('bar-uid-disp').textContent = data.applicationId;
          }

          if (dupBanner) {
            dupBanner.innerHTML = `
              <strong>Already Registered:</strong> An application with this email address or mobile number already exists.<br>
              Application UID: <strong>${data.applicationId}</strong>.
              <div style="margin-top:8px;">
                <a href="portal.html?mode=login&appId=${encodeURIComponent(data.applicationId)}&email=${encodeURIComponent(email)}" style="font-weight:700;text-decoration:underline;color:#0F172A;">Continue to Assessment &rarr;</a>
              </div>
            `;
            dupBanner.style.display = 'block';
          }

          if (dismissedDupKey !== checkKey) {
            showDuplicateDialog({
              applicationId: data.applicationId,
              email,
              message: 'An application with this email address or mobile number already exists.',
              checkKey
            });
          }
        } else if (dupBanner) {
          dupBanner.style.display = 'none';
        }
      } catch (err) {}
    }, 600);
  }

  fields.email.el?.addEventListener('blur', checkDuplicateLive);
  fields.mobile.el?.addEventListener('blur', checkDuplicateLive);

  // =========================================================================
  // 8. Form Submission & Credentials Confirmation Launch
  // =========================================================================
  const submitBtn = document.getElementById('submitBtn');
  const alertBanner = document.getElementById('formAlert');

  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();

      let allValid = true;
      Object.values(fields).forEach(({ el }) => {
        if (el) {
          el.dataset.touched = 'true';
          if (!validateField(el)) allValid = false;
        }
      });

      if (!allValid) {
        const firstInvalid = document.querySelector('.stitch-input.is-invalid, .stitch-select.is-invalid');
        firstInvalid?.focus();
        return;
      }

      // Default whyHire note if user left optional field blank
      let whyHireVal = fields.whyHire?.el?.value.trim() || document.getElementById('whyHire')?.value.trim();
      if (!whyHireVal || whyHireVal.length < 10) {
        whyHireVal = 'Eager to learn, build practical projects, and complete the 30-hour winter curriculum.';
      }

      const payload = {
        fullName: fields.fullName.el.value.trim(),
        email: fields.email.el.value.trim().toLowerCase(),
        mobile: fields.mobile.el.value.trim(),
        dob: fields.dob.el.value.trim(),
        college: fields.college.el.value.trim(),
        department: fields.department.el.value.trim(),
        passedOutYear: document.getElementById('passedOutYear')?.value || '2026',
        domainType: document.getElementById('domainType')?.value || 'Technical',
        domainName: fields.domainName.el.value.trim(),
        mode: document.getElementById('mode')?.value || 'Online',
        internshipPeriod: document.getElementById('internshipPeriod')?.value || '1 month',
        address: fields.address.el.value.trim(),
        whyHire: whyHireVal,
        referralCode: referral
      };

      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span>Registering Candidate…</span>`;
      if (alertBanner) alertBanner.style.display = 'none';

      try {
        const res = await fetch('/api/applications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.status === 409) {
          // Already registered -> open pop-up dialog box directly
          const appId = data.applicationId || 'PGI-W26-0001';
          if (appId !== 'REGISTERED') {
            document.getElementById('side-uid-disp').textContent = appId;
            document.getElementById('bar-uid-disp').textContent = appId;
          }

          showDuplicateDialog({
            applicationId: appId,
            email: payload.email,
            message: data.error || 'An application with this email address or mobile number already exists.',
            checkKey: `${payload.email}|${payload.mobile.replace(/\D/g, '').slice(-10)}`
          });

          submitBtn.disabled = false;
          submitBtn.innerHTML = `<span>Continue to Assessment &rarr;</span>`;
          return;
        }

        if (!res.ok) {
          throw new Error(data.error || 'Submission failed. Please check inputs.');
        }

        // Successfully generated Application ID
        const generatedId = data.applicationId;
        const issuedEmail = data.email || payload.email;
        const issuedPassword = data.password || formatDobFallback(payload.dob);
        document.getElementById('side-uid-disp').textContent = generatedId;
        document.getElementById('bar-uid-disp').textContent = generatedId;
        document.getElementById('pipe-step1-badge').textContent = 'DONE';

        sessionStorage.setItem('pgi_application_id', generatedId);
        sessionStorage.setItem('pgi_email', issuedEmail);
        localStorage.setItem('pgi_application_id', generatedId);

        submitBtn.innerHTML = `<span>&#10003; Application Confirmed (${generatedId})</span>`;
        showCredentialsModal({
          applicationId: generatedId,
          email: issuedEmail,
          password: issuedPassword,
          refCode: referral
        });
      } catch (err) {
        if (alertBanner) {
          alertBanner.textContent = err.message;
          alertBanner.style.display = 'block';
        }
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Continue to Assessment &rarr;</span>`;
      }
    });
  }

  // =========================================================================
  // 8B. Post-Application Credentials Confirmation Card (Email + DOB Password)
  // =========================================================================
  function formatDobFallback(iso) {
    const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}${m[2]}${m[1]}` : '';
  }

  function bindCopyBtn(btnId, textValue) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(textValue);
        const prev = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = prev || 'Copy'; }, 1600);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = textValue;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); btn.textContent = 'Copied!'; } catch {}
        document.body.removeChild(ta);
        setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
      }
    };
  }

  function showCredentialsModal({ applicationId, email, password, refCode }) {
    const overlay = document.getElementById('credentialsOverlay');
    const portalUrl = `portal.html?mode=login&appId=${encodeURIComponent(applicationId)}&email=${encodeURIComponent(email)}${refCode ? '&ref=' + encodeURIComponent(refCode) : ''}`;

    if (!overlay) {
      window.location.href = portalUrl;
      return;
    }

    const appIdEl = document.getElementById('cred-app-id');
    const emailEl = document.getElementById('cred-email-val');
    const passEl = document.getElementById('cred-pass-val');
    const proceedBtn = document.getElementById('cred-proceed-btn');

    if (appIdEl) appIdEl.textContent = applicationId;
    if (emailEl) emailEl.textContent = email;
    if (passEl) passEl.textContent = password;

    bindCopyBtn('copy-cred-email', email);
    bindCopyBtn('copy-cred-pass', password);

    if (proceedBtn) {
      proceedBtn.onclick = () => {
        window.location.href = portalUrl;
      };
    }

    overlay.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // =========================================================================
  // 9. Promise Slides Controller (Apply Now -> 3 Promises -> Enquiry Form)
  // =========================================================================

  function launchPromiseSlides(applicationId, email, refCode, flowMode = 'post-apply') {
    const overlay = document.getElementById('slidesOverlay');
    const isPreApply = flowMode === 'pre-apply';

    if (!overlay) {
      if (!isPreApply) {
        window.location.href = `portal.html?appId=${encodeURIComponent(applicationId)}&email=${encodeURIComponent(email)}${refCode ? '&ref=' + encodeURIComponent(refCode) : ''}`;
      }
      return;
    }

    const badge = document.getElementById('slideAppIdBadge');
    if (badge) {
      badge.textContent = isPreApply ? 'Winter Admissions 2026' : applicationId;
    }

    const slides = document.querySelectorAll('.slide-item');
    const stepBars = document.querySelectorAll('.slide-step-bar');
    const dots = document.querySelectorAll('#promiseDotsRow .promise-dot');
    const counterEl = document.getElementById('slideCounter');
    const prevBtn = document.getElementById('prevSlideBtn');
    const nextBtn = document.getElementById('nextSlideBtn');
    const startBtn = document.getElementById('startAssessmentBtn');
    const skipBtn = document.getElementById('skipSlidesBtn');

    if (startBtn) {
      startBtn.innerHTML = isPreApply
        ? 'Continue to Application &rarr;'
        : 'Start Assessment &rarr;';
    }
    if (skipBtn) {
      skipBtn.innerHTML = isPreApply
        ? 'Skip Directly to Application &raquo;'
        : 'Skip Directly to Assessment &raquo;';
    }

    let currentSlide = 0;
    const totalSlides = slides.length;
    const pad2 = n => String(n).padStart(2, '0');

    function renderSlide(index) {
      slides.forEach((s, idx) => {
        s.style.display = idx === index ? 'flex' : 'none';
      });
      stepBars.forEach((bar, idx) => {
        bar.classList.toggle('active', idx <= index);
      });
      dots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === index);
      });
      if (counterEl) counterEl.textContent = `Promise ${pad2(index + 1)} / ${pad2(totalSlides)}`;
      if (prevBtn) prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';

      if (index === totalSlides - 1) {
        if (nextBtn) nextBtn.style.display = 'none';
        if (startBtn) startBtn.style.display = 'inline-flex';
      } else {
        if (nextBtn) nextBtn.style.display = 'inline-flex';
        if (startBtn) startBtn.style.display = 'none';
      }
    }

    dots.forEach((dot, idx) => {
      dot.style.cursor = 'pointer';
      dot.onclick = () => {
        currentSlide = idx;
        renderSlide(currentSlide);
      };
    });

    function finishSlides() {
      if (isPreApply) {
        overlay.classList.remove('active');
        const cleanUrl = refCode ? `apply.html?ref=${encodeURIComponent(refCode)}` : 'apply.html';
        try { window.history.replaceState({}, '', cleanUrl); } catch {}
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        window.location.href = `portal.html?appId=${encodeURIComponent(applicationId)}&email=${encodeURIComponent(email)}${refCode ? '&ref=' + encodeURIComponent(refCode) : ''}`;
      }
    }

    if (nextBtn) {
      nextBtn.onclick = () => {
        if (currentSlide < totalSlides - 1) {
          currentSlide++;
          renderSlide(currentSlide);
        }
      };
    }

    if (prevBtn) {
      prevBtn.onclick = () => {
        if (currentSlide > 0) {
          currentSlide--;
          renderSlide(currentSlide);
        }
      };
    }

    if (startBtn) startBtn.onclick = finishSlides;
    if (skipBtn) skipBtn.onclick = finishSlides;

    overlay.classList.add('active');
    renderSlide(0);
  }

  // Show internship promises immediately when arriving from Apply buttons (?promises=1)
  if (urlParams.get('promises') === '1') {
    launchPromiseSlides(null, '', referral, 'pre-apply');
  }
});
