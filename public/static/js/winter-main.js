/**
 * Winter Internship Portal Client Script
 * Handles dynamic curriculum loading, track switcher, batch dates, modal preview, and interactions.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Referral tracking & link binding
  const urlParams = new URLSearchParams(window.location.search);
  const refFromUrl = urlParams.get('ref');
  if (refFromUrl) {
    sessionStorage.setItem('pgi_referral', refFromUrl.trim().slice(0, 50));
    localStorage.setItem('pgi_referral', refFromUrl.trim().slice(0, 50));
  }
  const savedRef = sessionStorage.getItem('pgi_referral') || localStorage.getItem('pgi_referral') || '';

  const baseApplyUrl = typeof INTERNSHIP_PAGE_URL !== 'undefined' ? INTERNSHIP_PAGE_URL : 'apply.html';
  const applyUrlWithRef = savedRef
    ? `${baseApplyUrl}?promises=1&ref=${encodeURIComponent(savedRef)}`
    : `${baseApplyUrl}?promises=1`;

  document.querySelectorAll('[data-start]').forEach(btn => {
    btn.setAttribute('href', applyUrlWithRef);
  });

  // 2. Mobile navigation toggle
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

  // 3. Dynamic Program & Batch Dates loader
  async function loadProgramData() {
    try {
      const res = await fetch('/api/program');
      if (!res.ok) return;
      const data = await res.json();

      // Update batch dates if available
      if (data.batch && data.batch.startsOn && data.batch.endsOn) {
        const dFmt = dStr => {
          const d = new Date(dStr);
          return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        };
        const datesText = `${dFmt(data.batch.startsOn)} – ${dFmt(data.batch.endsOn)}`;
        const batchDatesEl = document.getElementById('dynamicBatchDates');
        if (batchDatesEl) {
          batchDatesEl.textContent = datesText;
        }
        const batchNameEl = document.getElementById('dynamicBatchName');
        if (batchNameEl && data.batch.name) {
          batchNameEl.textContent = data.batch.name;
        }
      }

      // Update DB courses if present and populate skills
      if (Array.isArray(data.courses) && data.courses.length > 0) {
        renderDbCourses(data.courses);
      }
    } catch (e) {
      console.warn('Program data fetch fell back to default static curriculum:', e);
    }
  }

  function renderDbCourses(courses) {
    const container = document.getElementById('syllabusContainer');
    if (!container) return;

    const staticHeadings = Array.from(container.querySelectorAll('.syllabus-card h3'));
    const legacySeedTitles = [
      'web development',
      'app development',
      'digital operations',
      'business analysis',
      'cloud fundamentals',
      'mobile app'
    ];

    const matchesExisting = title => {
      const low = title.trim().toLowerCase();
      if (legacySeedTitles.some(seed => low.includes(seed))) return true;
      return staticHeadings.some(h => {
        const cur = h.textContent.trim().toLowerCase();
        return cur === low || low.includes(cur) || cur.includes(low);
      });
    };

    let added = false;
    courses.forEach(c => {
      if (!c || !c.title || matchesExisting(c.title)) return;
      const skillsArr = Array.isArray(c.skills)
        ? c.skills
        : (typeof c.skills === 'string' ? c.skills.split(/[\n,;]+|\s{2,}/).map(s => s.trim()).filter(Boolean) : []);

      const trackType = String(c.track || '').toLowerCase().includes('non') ? 'non-technical' : 'technical';
      const badgeClass = trackType === 'non-technical' ? 'badge-nontech' : 'badge-tech';
      const badgeLabel = trackType === 'non-technical' ? 'Non-Technical Track' : 'Technical Track';

      const card = document.createElement('article');
      card.className = 'frosted-card syllabus-card';
      card.setAttribute('data-track', trackType);

      const skillsHtml = skillsArr.map(s => `<li class="syllabus-skill"></li>`).join('');
      card.innerHTML = `
        <div class="syllabus-card-top">
          <span class="syllabus-track-badge ${badgeClass}">${badgeLabel}</span>
          <span class="syllabus-duration">10 Days &middot; 30 Hours</span>
        </div>
        <h3></h3>
        <p class="syllabus-desc"></p>
        <ul class="syllabus-skills-list">${skillsHtml}</ul>
      `;
      card.querySelector('h3').textContent = c.title;
      card.querySelector('.syllabus-desc').textContent = c.description || '';
      if (c.duration) card.querySelector('.syllabus-duration').textContent = c.duration;
      const skillEls = card.querySelectorAll('.syllabus-skill');
      skillsArr.forEach((s, i) => {
        if (skillEls[i]) skillEls[i].textContent = s;
      });

      container.appendChild(card);
      added = true;
    });

    if (added && typeof window.__refreshTrackCarousel === 'function') {
      window.__refreshTrackCarousel(false);
    }
  }

  loadProgramData();

  // 4. Horizontal Track Carousel & Track Switcher
  const viewport = document.getElementById('syllabusViewport');
  const track = document.getElementById('syllabusContainer');
  const prevBtn = document.getElementById('syllabusPrevBtn');
  const nextBtn = document.getElementById('syllabusNextBtn');
  const counterEl = document.getElementById('syllabusCounter');
  const dotsEl = document.getElementById('syllabusDots');
  const trackBtns = document.querySelectorAll('.track-btn');

  function getVisibleCards() {
    if (!track) return [];
    return Array.from(track.querySelectorAll('.syllabus-card')).filter(
      card => card.style.display !== 'none'
    );
  }

  function getPerView() {
    if (window.innerWidth <= 640) return 1;
    if (window.innerWidth <= 1120) return 2;
    return 3;
  }

  function getStepWidth(visibleCards) {
    if (!track || visibleCards.length === 0) return 0;
    const cardW = visibleCards[0].getBoundingClientRect().width;
    const styles = window.getComputedStyle(track);
    const gap = parseFloat(styles.columnGap || styles.gap || '21.6') || 21.6;
    return cardW + gap;
  }

  function renderDots(total, perView, activePage) {
    if (!dotsEl) return;
    const pageCount = Math.max(1, Math.ceil(total / perView));
    dotsEl.innerHTML = '';
    for (let i = 0; i < pageCount; i++) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'syllabus-dot' + (i === activePage ? ' active' : '');
      dot.setAttribute('aria-label', `Show tracks page ${i + 1} of ${pageCount}`);
      dot.addEventListener('click', () => {
        if (!viewport) return;
        const visible = getVisibleCards();
        const step = getStepWidth(visible);
        const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
        const targetLeft = Math.min(maxLeft, Math.round(i * perView * step));
        viewport.scrollTo({ left: targetLeft, behavior: 'smooth' });
      });
      dotsEl.appendChild(dot);
    }
  }

  function updateCarouselUI(resetScroll) {
    if (!viewport || !track) return;
    if (resetScroll) {
      viewport.scrollLeft = 0;
    }

    const visible = getVisibleCards();
    const total = visible.length;
    const perView = getPerView();
    const step = getStepWidth(visible);
    const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const scrollLeft = Math.max(0, viewport.scrollLeft);

    if (prevBtn) prevBtn.disabled = scrollLeft <= 2;
    if (nextBtn) nextBtn.disabled = maxLeft <= 2 || scrollLeft >= maxLeft - 2;

    const firstIdx = step > 0 ? Math.min(total, Math.round(scrollLeft / step) + 1) : 1;
    const shownStart = scrollLeft >= maxLeft - 2 && total > perView
      ? total - perView + 1
      : firstIdx;
    const shownEnd = Math.min(total, shownStart + perView - 1);

    if (counterEl) {
      counterEl.textContent = total === 0
        ? 'No tracks found'
        : `Showing ${shownStart}\u2013${shownEnd} of ${total} Tracks`;
    }

    const activePage = Math.min(
      Math.max(0, Math.ceil(total / perView) - 1),
      step > 0 ? Math.round(scrollLeft / (step * perView)) : 0
    );
    renderDots(total, perView, activePage);
  }

  window.__refreshTrackCarousel = updateCarouselUI;

  function slideCarousel(direction) {
    if (!viewport) return;
    const visible = getVisibleCards();
    const step = getStepWidth(visible);
    if (step <= 0) return;
    const perView = getPerView();
    const delta = direction * step * perView;
    viewport.scrollBy({ left: delta, behavior: 'smooth' });
  }

  if (prevBtn) prevBtn.addEventListener('click', () => slideCarousel(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => slideCarousel(1));

  if (viewport) {
    let scrollRaf = null;
    viewport.addEventListener('scroll', () => {
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => updateCarouselUI(false));
    }, { passive: true });

    viewport.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        slideCarousel(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        slideCarousel(1);
      }
    });
  }

  window.addEventListener('resize', () => updateCarouselUI(false));

  trackBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      trackBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.getAttribute('data-filter');
      document.querySelectorAll('#syllabusContainer .syllabus-card').forEach(card => {
        const cardTrack = card.getAttribute('data-track');
        if (filter === 'all' || cardTrack === filter) {
          card.style.display = 'flex';
          card.style.opacity = '1';
        } else {
          card.style.display = 'none';
        }
      });

      updateCarouselUI(true);
    });
  });

  updateCarouselUI(false);

  // 5. Sample Certificate Modal Preview
  const certOpen = document.getElementById('certOpen');
  const certModal = document.getElementById('certModal');
  const certClose = document.getElementById('certClose');
  const certModalBox = document.getElementById('certModalRender');

  if (certOpen && certModal && certClose && certModalBox) {
    certOpen.addEventListener('click', () => {
      const originalCert = document.querySelector('#certificate .cert');
      if (originalCert) {
        certModalBox.innerHTML = '';
        const clone = originalCert.cloneNode(true);
        clone.id = 'certBig';
        certModalBox.appendChild(clone);
      }
      certModal.hidden = false;
      document.body.style.overflow = 'hidden';
      certClose.focus();
    });

    const closeModal = () => {
      certModal.hidden = true;
      document.body.style.overflow = '';
      certOpen.focus();
    };

    certClose.addEventListener('click', closeModal);
    certModal.addEventListener('click', e => {
      if (e.target === certModal) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (!certModal.hidden && e.key === 'Escape') closeModal();
    });
  }

  // 6. Footer year
  const yrEl = document.getElementById('yr');
  if (yrEl) yrEl.textContent = new Date().getFullYear();

  // 7. Optional Google Analytics loader when GA_MEASUREMENT_ID is configured
  fetch('/api/config').then(r => (r.ok ? r.json() : null)).then(cfg => {
    const gaId = String(cfg?.gaMeasurementId || '').trim();
    if (!/^(G|GT|AW)-[A-Z0-9]+$/i.test(gaId)) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', gaId);
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
    document.head.appendChild(s);
  }).catch(() => {});
});
