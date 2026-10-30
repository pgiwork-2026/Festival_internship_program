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
