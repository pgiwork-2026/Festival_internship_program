# Supabase Database Migration & Setup Guide (Render Production)

This guide documents the database schema and migration steps for the **Plant Green Inertia Winter Internship Portal**.

---

## 1. Migration Execution Order
Run the following SQL files in sequence in the **Supabase SQL Editor** (`https://supabase.com/dashboard/project/<your-project-ref>/sql`):

1. `001_phase1.sql`: Core schema (profiles, courses, enrollments, assessment_attempts, proctoring_violations, RLS policies).
2. `002_seed_from_coe.sql`: 100+ Question bank seed and domain categories.
3. `003_payments_enrollment.sql`: Payment orders and scholarship coupon tables.
4. `004_proctoring_report.sql` & `006_evidence_snapshots.sql`: Webcam verification and snapshot capture.
5. `007_batches.sql` & `008_backfill_batches.sql`: Cohort batch scheduling.
6. `009_winter_program.sql`: Winter 2026 courses seed (Full-Stack Web Dev, Android App Dev, Technical and Non-Technical tracks).
7. `010_enquiry_applications.sql`: Internship application registry with referral tracking (`?ref=founder`), anti-duplicate phone/email checks, and sequence IDs (`PGI-W26-XXXX`).
8. `011_assessment_engine.sql`: Configurable assessment engine settings (100 total marks, default 30 pass mark, 20 questions, 20 mins timer, 24h single-use coupons).
9. `012_razorpay_payments.sql`: Razorpay payment orders, signature verification records, and idempotent enrollment triggers.
10. `013_student_dashboard_attendance.sql`: Integrated student attendance registers linked by Student ID, assignments, project capstone, and password recovery tokens.
11. `014_secure_admin_portal.sql`: Admin audit trail (`admin_audit_logs`), faculty mentors, verified completion certificates (`certificates`), and cohort broadcast notifications (`notifications`).

---

## 2. Superadmin Account Setup
To grant administrator access to an admin email address in Supabase:

```sql
-- Replace with the admin's Supabase User UUID
UPDATE public.profiles
SET role = 'admin'
WHERE id = '<auth-user-uuid>';
```
Or by email:
```sql
UPDATE public.profiles
SET role = 'admin'
WHERE id IN (
  SELECT id FROM auth.users WHERE email = 'admin@plantgreeninertia.com'
);
```

---

## 3. Storage Bucket (Optional)
If storing raw evidence snapshots in Supabase Storage instead of database base64 payloads:
* Create a private bucket named `proctoring-evidence` in Supabase Storage.
* Create a public bucket named `certificates` for public PDF downloads.
