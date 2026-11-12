# Diwali Scholarship – Phase 1 (backend + schema)
Contents: `supabase/migrations/001_phase1.sql` (schema + RLS), `server/` (Express API: attempts, autosave, violations, server scoring, coupons).
Setup: create a NEW Supabase project (not Circle of Excellence), run the SQL, add rows to `courses`/`questions` (options as `[{"id":"a","text":"..."}]`, `correct_option_id`), copy `.env.example` to `server/.env`, `cd server && npm i && npm start`.
Endpoints (Bearer Supabase JWT): POST /api/attempts/start, POST /api/attempts/:id/answer {questionId,optionId}, POST /api/attempts/:id/violation {type}, POST /api/attempts/:id/submit, GET /api/attempts/:id/result.
Tested: `npm test` covers tier boundaries, exact paise (149985/99990/0), 24h coupon expiry. NOT tested (needs a live Supabase): endpoints, RLS, concurrency. Not built yet: frontend, Razorpay/payment tables, admin UI, face/phone detection, coupon course-binding at redemption, landing page integration.
Note: Phase 1 keeps one scholarship attempt per student.

## Seed data
Run `supabase/migrations/002_seed_from_coe.sql` after 001: 50 questions, 3 courses (₹9,999 base), test = 20 questions / 20 min, copied as static data from the CoE seed (no link to its database). Question text contains HTML (`<pre>`, `&lt;`), so the frontend must render it safely (sanitised). Review questions and courses before launch.

## Running the whole site (landing page + assessment)
The landing page now lives in `public/` and is served by the same Express server as the API, so one command runs everything.
1. Run both SQL migrations in a NEW Supabase project. In **Authentication → Providers → Email**, turn off "Confirm email" while testing (otherwise students must confirm by email before logging in).
2. `cp .env.example server/.env`, fill `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public anon key) and `SUPABASE_SERVICE_ROLE_KEY` (secret, server only).
3. `cd server && npm install && npm start`, then open http://localhost:8787
4. START SCHOLARSHIP TEST now opens `portal.html` (register/login → profile → rules + camera → test → result/coupon). No link to Circle of Excellence remains.
Camera policy: `REQUIRE_CAMERA=true` blocks the test without a camera; `false` lets it proceed and logs `camera_unavailable`.
Verified: server boots, serves landing page/video/portal, `/api/me` rejects unauthenticated requests, 5 unit tests pass. NOT verified (needs your Supabase and a browser): registration, test flow, camera, face detection (Chromium-only FaceDetector API), result screen.

## Phase: course selection, Razorpay, enrollment, dashboard
Run `supabase/migrations/003_payments_enrollment.sql`. Add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (test-mode keys first, from Razorpay Dashboard → API Keys) to `server/.env`.
Webhook: Dashboard → Webhooks → URL `https://<your-domain>/api/webhooks/razorpay` (needs a public HTTPS URL; use a tunnel such as ngrok locally), events `payment.captured` and `order.paid`, set the same secret in `RAZORPAY_WEBHOOK_SECRET`.
Rules enforced on the server: price = course base price × coupon tier (integer paise, half-up rounding for non-₹9,999 prices); coupon must belong to the student and be unexpired/unredeemed when an order is created; the browser success callback alone never enrolls — enrollment needs a valid signature AND a server-to-server Razorpay status of `captured`; duplicate callbacks/webhooks are idempotent (DB unique constraints on order, coupon and student); a payment captured after coupon expiry is still honoured; a second payment for an already-enrolled student is flagged `needs_refund`; free enrollment only when the stored coupon is 100% with a 100% score.
Admin sets a course's `access_url` (column on `courses`); it is only returned to enrolled students. Offer letter is a simple printable page.
Verified by unit tests: signature checks and rounding (8 tests pass). NOT verified (needs Razorpay test keys, Supabase, browser): real order creation, checkout popup, webhook delivery, end-to-end enrollment, free enrollment.

## Latest changes
Portal theme is now green/yellow/gold/white (matches the landing page). Test duration is 20 minutes (`test_settings.duration_seconds = 1200`; for an existing database run `update test_settings set duration_seconds = 1200;`). Landing page has a new scholarship pricing section after the hero (₹9,999 struck out, FREE*, and the 85% / 90% / 100% tiers).
Never commit or share `server/.env`.

## Proctoring v2 + assessment report
**Run `supabase/migrations/004_proctoring_report.sql`, then `cd server && npm install` (adds `pdfkit`).** Set `PUBLIC_BASE_URL` in `server/.env` to your public https URL.
- **Face verification:** on the rules page the student's face is verified (one face, looking at the camera) and kept in the browser only as a landmark signature. During the test a different face raises `face_mismatch`.
- **Detection (MediaPipe Face Landmarker, runs in the browser, all modern browsers):** `no_face`, `multiple_faces`, `looking_away` (head yaw/pitch vs. the verified baseline), `face_mismatch`, camera switched off, `tab_switch` (tab/window), `fullscreen_exit`, `copy_paste`. Phone detection is still NOT automated.
- **Policy, enforced on the server** (`logic.js: violationDecision`): violations 1-3 show a warning; the **4th counted violation auto-submits** (`status = auto_submitted`, answers saved so far are scored). Events inside 5 s count once. A refresh cannot reset the count.
- **Model file:** `public/static/models/face_landmarker.task` is used if present, otherwise it is downloaded from Google's public MediaPipe bucket. For offline use, download it once: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- **Report:** `GET /api/attempts/:id/report.pdf` (login required) builds the PDF in the Plant Green Inertia letterhead (`server/assets/header.png`, `footer.png`, `server/report.js`). Download / WhatsApp / LinkedIn buttons appear on the result screen and dashboard. Sharing is opt-in: it creates `/r/<token>`, a public page + PDF with name, score, status and proctoring summary only (no email, phone or coupon).
- Thresholds to tune after a pilot: `public/static/js/proctor-core.js` -> `THRESH` (yaw 28 deg, pitch 22 deg, hold times, face-match 0.16).
- Policy choice: an auto-submitted attempt still gets a score-based coupon, flagged in the report. To withhold it, skip the coupon insert in `finalize()` when `status === 'auto_submitted'`.
- Tests: `npm test` (14 pass): warning/auto-submit rule, 5 s de-dupe, head-pose maths, hold/repeat tracker, face-signature comparison, report labels. NOT verified (needs a real browser, camera and Supabase): MediaPipe accuracy and thresholds, fullscreen/tab events per browser, the live endpoints, WhatsApp/LinkedIn opening.
# PGI-Internship
# PGI-Internship

## Temporary Test Coupon (PGITEST1) & Safe Removal

A temporary reusable Rs 1 (`100` paise) test coupon (`PGITEST1`, valid for 24 hours per issue/+24h reissue) is built into the existing coupon pipeline for live Razorpay verification without completing/passing the assessment or email binding.

- **Enable for testing**: Run `supabase/migrations/016_test_coupon.sql` (or `017_pgitest1_24h_validity.sql` to reset a fresh 24-hour window) in Supabase and set `ENABLE_TEST_COUPON=true` in Render (or `server/.env`). You can also click **+24h** next to `PGITEST1` in Admin Dashboard -> Coupons.
- **Isolation**: Server validates `PGITEST1` exclusively via `ENABLE_TEST_COUPON=true`, enforces `100` paise order & verification amounts, and marks generated `payment_orders` / `enrollments` with `is_test = true` so analytics, payment reports, and revenue totals exclude them.

### Removal
1. Set `ENABLE_TEST_COUPON=false` in Render (or delete the environment variable) and redeploy.
2. Delete the `PGITEST1` row from the `scholarship_coupons` table (or click **Delete** next to `PGITEST1` in Admin Dashboard -> Coupons):
   ```sql
   DELETE FROM public.scholarship_coupons WHERE code = 'PGITEST1';
   ```
3. Delete or archive records where `is_test = true`:
   ```sql
   DELETE FROM public.enrollments WHERE is_test = true;
   DELETE FROM public.payment_orders WHERE is_test = true;
   ```

## Winter 3D Ice Wall Entry Gate (`IceWallGate3D` & `IceWallGate`)
Appears once per browser session (`sessionStorage` key `pgi_ice_gate_seen`) on `/` and `/index.html` only, never on login, dashboard, payment, assessment, or admin pages. Preserves `?ref=` referral query parameters.

### Components & Fallbacks
- **`IceWallGate3D` (`public/static/js/ice-wall-gate-3d.js`):** Lazy-loads `three@0.169.0` and `cannon-es@0.20.0` from pinned CDNs; renders a ~1 m thick refractive glacier wall (`MeshPhysicalMaterial`, IOR `1.31`), trapped internal air bubbles, night mountains, aurora, warm portal backlight, and a 3D Norse war hammer cursor (`public/static/models/norse-hammer.glb`). Supports 3 left/right clicks, touch taps, or `Enter`/`Space` hits (wind-up/swing, 60 ms freeze-frame, camera shake, radial crack growth, Hit 1–2 progressive breakage, Hit 3 slow-mo Voronoi shatter + `cannon-es` physics + portal cross-fade).
- **`IceWallGate` (`public/static/js/ice-wall-gate-canvas.js`):** Canvas 2D fallback used automatically when WebGL is unavailable, the device is low-power, or `prefers-reduced-motion: reduce` is enabled. Uses `public/static/images/hammer-cursor.png`.

### How to Disable
- **Server-wide (recommended):** Set `ENABLE_ICE_GATE=false` in `server/.env` or Render environment variables (`/api/config` returns `enableIceGate: false`).
- **URL override:** Append `?gate=0` to skip the gate, or `?icegate=1` to force-preview it again in the same browser session.

### How to Swap Assets
All assets live under `public/static/` (see `CREDITS.md` for licenses):
- **3D Hammer Model:** Replace `public/static/models/norse-hammer.glb` (keep Draco-compressed `.glb` under 1.5 MB).
- **2D Fallback Cursor:** Replace `public/static/images/hammer-cursor.png` (`128x128` PNG, strike face hotspot at `(18, 22)`).
- **Glacier Ice PBR Textures:** Replace `public/static/textures/ice/*.webp` (`ice_color.webp`, `ice_normal.webp`, `ice_roughness.webp`, `ice_bump.webp`) and 1K mobile variants under `public/static/textures/ice/1k/`.
- **Environment HDRI:** Replace `public/static/hdr/blue_lagoon_night_1k.hdr`.
- **Sound Effects (off by default):** Replace `public/static/audio/impact-thud.mp3`, `ice-crack.mp3`, `ice-creak.mp3`, and `ice-shatter.mp3` (keep each `< 150 KB`).
