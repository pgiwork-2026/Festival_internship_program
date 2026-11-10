# Plant Green Inertia - Production Deployment Checklist (Render)

This checklist provides step-by-step instructions for deploying the **Winter Internship & Training Program Portal** to **Render** with **Supabase PostgreSQL**, **Razorpay Gateway**, and **Resend Transactional Email**.

---

## Pre-Deployment Prerequisites
- [x] Node.js 20+ runtime verified (`node --test` passed 51/51 automated unit & E2E tests).
- [x] Reverse proxy trust enabled (`app.set('trust proxy', 1)` in `server/index.js`).
- [x] Winter theme design tokens implemented across all public pages, portal, dashboard, and certificate PDFs.
- [x] Razorpay HMAC-SHA256 signature verification & idempotent webhook handling implemented.
- [x] Attendance linked strictly by Student ID (`PGI-S26-XXXX`).
- [x] Certificate issuance gated by verified completion criteria (30.0 hours & $\ge 75\%$ attendance).

---

## 1. Supabase Database Setup
1. Open the [Supabase Dashboard](https://supabase.com/dashboard) and navigate to your project.
2. In the **SQL Editor**, execute migrations in sequence from `supabase/migrations/`:
   - `001_phase1.sql` through `014_secure_admin_portal.sql` (see `supabase/MIGRATIONS_GUIDE.md`).
3. Promote your admin account to admin role:
   ```sql
   UPDATE public.profiles
   SET role = 'admin'
   WHERE id IN (SELECT id FROM auth.users WHERE email = 'admin@plantgreeninertia.com');
   ```

---

## 2. Render Web Service Creation
1. Go to [Render Dashboard](https://dashboard.render.com/) and click **New + $\to$ Web Service**.
2. Connect your Git repository (`Festival_internship_program`).
3. Set the following settings:
   * **Name**: `pgi-winter-portal`
   * **Region**: Oregon (US West) or Singapore
   * **Branch**: `main`
   * **Root Directory**: `.` (leave blank or root)
   * **Runtime**: `Node`
   * **Build Command**: `cd server && npm install`
   * **Start Command**: `cd server && node index.js`
   * **Instance Type**: `Starter` ($7/mo) or `Standard`
   * **Health Check Path**: `/api/config`

---

## 3. Environment Variables Configuration (Render)
Under the **Environment** tab in Render, configure the following keys (see `server/.env.example`):

| Variable Name | Required | Description / Example |
|---|---|---|
| `NODE_ENV` | Yes | `production` |
| `PORT` | Auto | Render assigns `10000` automatically |
| `PUBLIC_BASE_URL` | Yes | `https://internship.plantgreeninertia.com` (or your `.onrender.com` URL) |
| `SUPABASE_URL` | Yes | `https://xlxbjaefftxcrgyjncyr.supabase.co` |
| `SUPABASE_ANON_KEY` | Yes | Project Anon Public Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Project Service Role Secret Key (keep secret) |
| `RAZORPAY_KEY_ID` | Yes | `rzp_live_...` (from Razorpay Dashboard) |
| `RAZORPAY_KEY_SECRET` | Yes | Razorpay API Secret |
| `RAZORPAY_WEBHOOK_SECRET` | Yes | Random secret string generated for Razorpay webhook |
| `RESEND_API_KEY` | Recommended | `re_...` from [Resend.com](https://resend.com) |
| `EMAIL_FROM` | Yes | `Plant Green Inertia <admissions@plantgreeninertia.com>` |
| `REQUIRE_CAMERA` | Optional | `true` (enables browser proctoring) |
| `EVIDENCE_RETENTION_DAYS` | Optional | `7` |

---

## 4. Razorpay Webhook Configuration
1. Open the [Razorpay Dashboard](https://dashboard.razorpay.com/) $\to$ **Settings** $\to$ **Webhooks**.
2. Click **Add New Webhook**.
3. Set **Webhook URL**: `https://<your-render-domain>/api/webhooks/razorpay` (or `/webhooks/razorpay`).
4. Set **Secret**: Enter the exact secret string you set in `RAZORPAY_WEBHOOK_SECRET` on Render.
5. Select Active Events:
   * `payment.captured`
   * `payment.failed`
   * `order.paid`
6. Click **Save Webhook**.

---

## 5. Post-Deployment Verification & Smoke Test
After Render completes the build, test the full pipeline in production:

1. **Landing Page**: Open `https://<domain>/index.html?ref=founder`
   - Verify Winter theme (Midnight Navy `#101D35`, Winter Blue `#B9DDF5`, subtle snowfall, and highlight chips).
   - Verify referral parameter persistence in session/local storage.
2. **Enquiry Form (`apply.html`)**:
   - Submit a test application with valid mobile and domain.
   - Verify instant Application ID generation (`PGI-W26-XXXX`).
   - Verify confirmation email dispatched.
3. **Promise Slides**:
   - Click "Next $\to$ Next $\to$ Next" through promise slides.
   - Verify transition to Assessment Portal (`portal.html`).
4. **Assessment Engine**:
   - Answer MCQ questions.
   - Verify timer decrement and proctoring warnings.
   - Verify server-side score calculation and "Scholarship Unlocked" result screen upon scoring $\ge 30$ marks.
5. **Coupon & Payment Flow**:
   - Verify coupon code generated with live 24-hour countdown timer.
   - Click "Proceed to Pay ₹999" and complete Razorpay transaction.
   - Verify receipt PDF generated on corporate letterhead and credentials emailed.
6. **Student Portal & Dashboard (`dashboard.html`)**:
   - Sign in using Student ID (`PGI-S26-XXXX`) or registered email + password.
   - Verify all 13 modules load cleanly: Overview, Profile, Internship, Syllabus, Attendance, Assignments, Materials, Project, 30-Hour Progress Cockpit, 1-Page Report PDF download, and Certificate status.
7. **Attendance & Certificate Gate**:
   - Verify attendance records linked strictly by Student ID.
   - Verify that certificate issuance is strictly blocked until 30 hours and $\ge 75\%$ attendance are completed.
   - Verify official landscape certificate PDF downloads once criteria are fulfilled.
8. **Admin Console (`admin.html`)**:
   - Sign in as admin.
   - Verify live analytics, referral link breakdown, student search/filter, and system audit logs.
