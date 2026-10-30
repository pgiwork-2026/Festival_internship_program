# Audit report – Diwali Internship Portal

Scope: static code review of server, frontend, SQL migrations and config, plus automated tests and a local smoke test with dummy Supabase credentials.
No live Supabase, Razorpay or browser was available, so end-to-end flows were NOT run.

## Overall result
No functional breakage found in the code paths reviewed. One critical secret-handling problem, several hardening gaps, and outdated branding. Fixed what was safe to fix.

## Findings
**Critical**
- C1 `server/.env` is in the project archive and holds real-looking credentials, including a LIVE Razorpay key (`rzp_live…`) and the Supabase service-role key. The root `.gitignore` did not exclude `.env`. **Action required: rotate the Supabase service-role key and anon key, the Razorpay live key and secret, and set a Razorpay webhook secret. Remove `server/.env` from any repo, archive or backup that was shared.** (Fixed in part: `.gitignore` now excludes `.env`; rotation is manual.)

**High**
- H1 `RAZORPAY_WEBHOOK_SECRET` is empty, so every webhook is rejected ("Bad signature"; verified). Payments still complete through the browser-verify path, but webhook safety-net is off. Set the secret in Razorpay and `.env`.
- H2 No rate limiting on any endpoint. Fixed: per-IP limiter (240 API calls/min, 20/min for profile, start, checkout and share). Verified: 21st sensitive call returns 429.
- H3 Profile save ignored database errors, so a missing `phone_norm` column made registration look successful while saving nothing. Fixed: error is now checked and reported.

**Medium**
- M1 No security headers; `X-Powered-By` exposed. Fixed: nosniff, frame-options, referrer-policy, permissions-policy (camera/microphone allowed for this site only); header removed. Verified. A full Content-Security-Policy was not added because pages use inline scripts and CDNs.
- M2 Internal errors (e.g. TypeError, 5xx) returned raw messages to the browser. Fixed: generic message, details logged server-side.
- M3 Face-detection models (`static/models/*`) are not bundled; they download from Google storage at run time. Works online only. Download them into `public/static/models/` for offline or locked-down networks.

**Low**
- L1 Outdated "Vijayadashami" branding in the PDF report, offer letter, share text, OG image, package name and README. Fixed. Coupon prefix changed from `VIJ-` to `DIW-` for new coupons only; existing coupons are unaffected (lookups are by stored code).
- L2 Syllabus PDF link contains spaces in the filename. Works in browsers; consider renaming the file.
- L3 `app.py` (Flask) serves a non-existent root `index.html`; the Express server is the real host. Unused.

## Checked and found sound (code review only)
Auth required on all student, payment and admin routes (verified 401 without a token); admin routes also require `profiles.role = 'admin'`; attempts, coupons and orders are ownership-checked server-side; prices and discounts are calculated on the server; payment signature plus server-to-server capture check; idempotent orders and webhooks; answers are validated and scored on the server; admin page renders data with `textContent`.

## Tests
- Passed: `npm test` – 17 of 17.
- Passed (local smoke test, dummy credentials): all 6 pages and `/admin` return 200; protected APIs return 401; unknown paths 404; webhook with bad signature 400; rate limit 429; security headers present; no missing local files referenced from HTML/CSS/JS except the models noted in M3.
- Blocked (needs live services or a browser): registration/login, profile, assessment flow, timer/autosave/auto-submit, camera and face detection, coupon expiry, Razorpay checkout/webhook/duplicate callbacks, certificate generation, admin dashboard actions, mobile layout, console errors.

## Modified files
.gitignore, server/index.js, server/logic.js, server/offer.js, server/report.js, server/package.json, public/static/images/og.svg, README.md, AUDIT_REPORT.md

## Manual checks still needed
Rotate secrets (C1); set webhook secret (H1); run migrations in order (001–006, then phone_unique, device_signals, questions_set, purge_evidence_snapshots); test one full student journey with Razorpay TEST keys; check mobile layouts and the browser console.
