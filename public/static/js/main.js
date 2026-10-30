// Every START SCHOLARSHIP TEST button opens the scholarship portal (portal.html) in the same tab.
document.querySelectorAll("[data-start]").forEach(a => a.setAttribute("href", INTERNSHIP_PAGE_URL));


const links = [["Email", CONTACTS.email && "mailto:" + CONTACTS.email], ["Phone", CONTACTS.phone && "tel:" + CONTACTS.phone],
  ["Instagram", CONTACTS.instagram], ["LinkedIn", CONTACTS.linkedin], ["Website", CONTACTS.website]].filter(x => x[1]);
const box = document.getElementById("contacts");
links.forEach(([t, h]) => { const a = document.createElement("a"); a.textContent = t; a.href = h; a.rel = "noopener noreferrer"; box.appendChild(a); });

// Hero sparks
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!reduce) document.querySelectorAll(".dh-sparks").forEach(s => {
  for (let i = 0; i < 26; i++) { const b = document.createElement("b");
    b.style.cssText = `left:${(i * 37) % 100}%;width:${2 + i % 4}px;height:${2 + i % 4}px;animation-delay:${(i * 1.3) % 9}s;animation-duration:${8 + (i % 7) * 2}s`; s.appendChild(b); }
});

// Mobile menu
const burger = document.querySelector(".burger"), nav = document.querySelector(".nav nav");
burger.addEventListener("click", () => burger.setAttribute("aria-expanded", nav.classList.toggle("open")));
nav.querySelectorAll("a").forEach(a => a.addEventListener("click", () => { nav.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); }));

// Image fallback
document.querySelectorAll("img[data-fallback]").forEach(img => img.addEventListener("error", () => {
  if (!img.src.endsWith(img.dataset.fallback)) img.src = img.dataset.fallback; }));

// Sample certificate modal
(() => {
  const o = document.getElementById("certOpen"), m = document.getElementById("certModal"), c = document.getElementById("certClose"), big = document.getElementById("certBig");
  if (!o || !m) return;
  const open = () => { big.replaceChildren(document.querySelector(".cert-prev .cert").cloneNode(true)); m.hidden = false; document.documentElement.style.overflow = "hidden"; c.focus(); };
  const close = () => { m.hidden = true; document.documentElement.style.overflow = ""; o.focus(); };
  o.addEventListener("click", open); c.addEventListener("click", close);
  m.addEventListener("click", e => { if (e.target === m) close(); });
  document.addEventListener("keydown", e => { if (!m.hidden && e.key === "Escape") close(); });
})();
