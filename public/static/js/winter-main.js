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
    const container = document.getElementById('dynamicDbCourses');
    if (!container) return;

    const staticHeadings = Array.from(document.querySelectorAll('#syllabusContainer .syllabus-card h3'));
    const findMatchingStatic = title => {
      const low = title.trim().toLowerCase();
      return staticHeadings.find(h => {
        const cur = h.textContent.trim().toLowerCase();
        if (cur === low || low.includes(cur) || cur.includes(low)) return true;
        if (cur.includes('web development') && low.includes('web development')) return true;
        if (cur.includes('app development') && low.includes('app development')) return true;
        if (cur.includes('digital operations') && low.includes('digital operations')) return true;
        return cur.includes('business analysis') && low.includes('business analysis');
      });
    };

    courses.forEach(c => {
      const existing = findMatchingStatic(c.title || '');
      const skillsArr = Array.isArray(c.skills)
        ? c.skills
        : (typeof c.skills === 'string' ? c.skills.split(/[\n,;]+|\s{2,}/).map(s => s.trim()).filter(Boolean) : []);

      if (existing) {
        const card = existing.closest('.syllabus-card');
        if (card && c.description && c.description.length > 10 && !c.title.includes('& Cloud') && !c.title.startsWith('Mobile ')) {
          const descEl = card.querySelector('.syllabus-desc');
          if (descEl) descEl.textContent = c.description;
        }
      } else {
        const card = document.createElement('article');
        card.className = 'frosted-card syllabus-card';
        card.setAttribute('data-track', 'technical');

        const skillsHtml = skillsArr.map(s => `<li class="syllabus-skill">${s}</li>`).join('');

        card.innerHTML = `
          <div class="syllabus-card-top">
            <span class="syllabus-track-badge badge-tech">Live Course Track</span>
            <span class="syllabus-duration">${c.duration || '10 Days &middot; 30 Hours'}</span>
          </div>
          <h3>${c.title}</h3>
          <p class="syllabus-desc">${c.description || ''}</p>
          <ul class="syllabus-skills-list">${skillsHtml}</ul>
        `;
        container.appendChild(card);
      }
    });
  }

  loadProgramData();

  // 4. Interactive Track Switcher
  const trackBtns = document.querySelectorAll('.track-btn');

  trackBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      trackBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.getAttribute('data-filter');
      document.querySelectorAll('.syllabus-card').forEach(card => {
        const cardTrack = card.getAttribute('data-track');
        if (filter === 'all' || cardTrack === filter) {
          card.style.display = 'flex';
          card.style.opacity = '1';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });

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
});
