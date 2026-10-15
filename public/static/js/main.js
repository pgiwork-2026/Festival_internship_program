// Every START SCHOLARSHIP TEST button opens the scholarship portal (portal.html) in the same tab.
document.querySelectorAll("[data-start]").forEach(a => a.setAttribute("href", INTERNSHIP_PAGE_URL));


const links = [["Email", CONTACTS.email && "mailto:" + CONTACTS.email], ["Phone", CONTACTS.phone && "tel:" + CONTACTS.phone],
  ["Instagram", CONTACTS.instagram], ["LinkedIn", CONTACTS.linkedin], ["Website", CONTACTS.website]].filter(x => x[1]);
const box = document.getElementById("contacts");
links.forEach(([t, h]) => { const a = document.createElement("a"); a.textContent = t; a.href = h; a.rel = "noopener noreferrer"; box.appendChild(a); });

// Garland marigolds + sparkles
document.querySelectorAll(".garland").forEach(g => { for (let i = 0; i < 28; i++) g.appendChild(document.createElement("i")); });
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!reduce) document.querySelectorAll(".sparkles").forEach(s => {
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

// Coins falling from Goddess Saraswati's hands (left hand ~20%, right hand ~80%)
const coins = document.querySelector(".coins");
if (coins && !reduce) for (let i = 0; i < 16; i++) {
  const c = document.createElement("span"); c.textContent = "\u20B9";
  const x = (i % 2 ? 78 : 22) + ((i * 7) % 9 - 4);
  c.style.cssText = `left:${x}%;animation-delay:${(i * 0.55).toFixed(2)}s;animation-duration:${3.6 + (i % 4) * 0.5}s`;
  coins.appendChild(c);
}

// Hero video: keep it playing; if the file is missing, show the illustration + coins instead.
const vid = document.querySelector(".video-frame video");
if (vid) {
  const frame = vid.parentElement, src = vid.querySelector("source");
  const fail = () => frame.classList.add("no-video");
  src.addEventListener("error", fail); vid.addEventListener("error", fail);
  vid.muted = true; const p = vid.play(); if (p) p.catch(() => {});
}
