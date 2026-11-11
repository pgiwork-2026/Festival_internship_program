-- =====================================================================
-- Plant Green Inertia — Combined Winter Internship Migrations (009-015)
-- Open a fresh Supabase SQL Editor tab, paste this entire file, and Run.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 009: Activate Winter 2026 Cohort Batch & Seed Missing Course Tracks
-- ---------------------------------------------------------------------
UPDATE public.batches
SET status = 'completed'
WHERE status = 'active' AND slug <> 'winter-2026';

INSERT INTO public.batches (slug, name, status, starts_on, ends_on, description)
VALUES (
  'winter-2026',
  'Winter Internship 2026',
  'active',
  '2026-12-01',
  '2026-12-15',
  'Winter Internship and Training Program at Plant Green Inertia Pvt. Ltd. (Online & Offline Cohorts)'
)
ON CONFLICT (slug) DO UPDATE SET
  status = 'active',
  starts_on = '2026-12-01',
  ends_on = '2026-12-15',
  name = 'Winter Internship 2026',
  updated_at = now();

INSERT INTO public.courses (title, description, duration, skills, benefits)
SELECT v.title, v.description, v.duration, v.skills::text[], v.benefits::text[]
FROM (VALUES
  (
    'Web Development & Cloud Deployment',
    'Learn how responsive web applications are structured, styled, built interactively, and published live.',
    '10 Days (30 Hours)',
    '{HTML5,CSS3 Flexbox & Grid,JavaScript ES6+,DOM Manipulation,Git & GitHub,GitHub Pages Deployment}',
    '{Live Project Hosting,Portfolio Review,Code Mentorship}'
  ),
  (
    'Mobile App Development',
    'Master mobile interface architecture, app logic, cloud data storage, device sensors, and Android APK packaging.',
    '10 Days (30 Hours)',
    '{Mobile UI/UX Design,MIT App Inventor,App Logic & Event Blocks,CloudDB Storage,Device Sensors,Android APK Packaging}',
    '{Real-World App Build,Mobile Testing,Deployment Guide}'
  ),
  (
    'Digital Operations & Agile Management',
    'Agile delivery lifecycle, sprint planning, workflow automation, quality assurance, and team communication.',
    '10 Days (30 Hours)',
    '{Agile & Scrum,Sprint Planning,Jira & Trello Workflows,Process Quality Assurance,Cross-Functional Communication}',
    '{Industry Case Studies,Workflow Templates,Managerial Review}'
  ),
  (
    'Business Analysis & Tech Communication',
    'Requirements engineering, BRD/FRD documentation, process flowcharts, wireframing, and client presentations.',
    '10 Days (30 Hours)',
    '{BRD & FRD Authoring,Process Flowcharts,Wireframing,Data Analysis with Excel,Executive Presentation}',
    '{Real-World Case Study,Requirements Dossier,Executive Feedback}'
  )
) AS v(title, description, duration, skills, benefits)
WHERE NOT EXISTS (
  SELECT 1 FROM public.courses c WHERE lower(c.title) = lower(v.title)
);

-- ---------------------------------------------------------------------
-- 010 & 015: Enquiry / Internship Applications Table + DOB Column
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.pgi_application_seq START 1;

CREATE TABLE IF NOT EXISTS public.internship_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id text UNIQUE NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  phone_norm text NOT NULL,
  dob date,
  college text NOT NULL,
  department text NOT NULL,
  passed_out_year text NOT NULL,
  domain_type text NOT NULL CHECK (domain_type IN ('Technical', 'Non-Technical')),
  domain_name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('Online', 'Offline')),
  duration text NOT NULL DEFAULT '30 Hours',
  internship_period text NOT NULL CHECK (internship_period IN ('1 week', '2 weeks', '1 month', '3 months', '6 months')),
  address text NOT NULL,
  why_hire text NOT NULL,
  referral_code text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'assessment_started', 'assessment_completed', 'enrolled', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applications_email ON public.internship_applications(lower(email));
CREATE INDEX IF NOT EXISTS idx_applications_phone_norm ON public.internship_applications(phone_norm);
CREATE INDEX IF NOT EXISTS idx_applications_ref ON public.internship_applications(referral_code);
CREATE INDEX IF NOT EXISTS idx_applications_created ON public.internship_applications(created_at DESC);

CREATE OR REPLACE FUNCTION public.next_pgi_application_id()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  next_val bigint;
BEGIN
  next_val := nextval('public.pgi_application_seq');
  RETURN 'PGI-W26-' || lpad(next_val::text, 4, '0');
END;
$$;

ALTER TABLE public.internship_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_insert_policy ON public.internship_applications;
CREATE POLICY app_insert_policy ON public.internship_applications FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS app_select_policy ON public.internship_applications;
CREATE POLICY app_select_policy ON public.internship_applications FOR SELECT USING (true);

-- ---------------------------------------------------------------------
-- 011: Assessment Engine Upgrade
-- ---------------------------------------------------------------------
ALTER TABLE public.test_settings
  ADD COLUMN IF NOT EXISTS total_marks int NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS pass_mark numeric(5,2) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS negative_marking numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempt_limit int NOT NULL DEFAULT 1;

UPDATE public.test_settings SET
  question_count = 25,
  duration_seconds = 1200,
  marks_per_question = 4,
  total_marks = 100,
  pass_mark = 30,
  negative_marking = 0,
  attempt_limit = 1,
  coupon_valid_hours = 24
WHERE id = 1;

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS marks numeric(5,2) NOT NULL DEFAULT 4;

ALTER TABLE public.scholarship_coupons
  DROP CONSTRAINT IF EXISTS scholarship_coupons_discount_percent_check;
ALTER TABLE public.scholarship_coupons
  ADD CONSTRAINT scholarship_coupons_discount_percent_check
  CHECK (discount_percent IN (0, 85, 88, 90, 100));

ALTER TABLE public.assessment_attempts
  ADD COLUMN IF NOT EXISTS total_score numeric(5,2),
  ADD COLUMN IF NOT EXISTS total_marks int NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS pass_mark numeric(5,2) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS is_qualified bool NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS application_id text;

CREATE INDEX IF NOT EXISTS idx_attempts_app_id ON public.assessment_attempts(application_id);

ALTER TABLE public.scholarship_coupons
  ADD COLUMN IF NOT EXISTS application_id text,
  ADD COLUMN IF NOT EXISTS student_email text,
  ADD COLUMN IF NOT EXISTS extension_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reissued_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_coupons_app_id ON public.scholarship_coupons(application_id);
CREATE INDEX IF NOT EXISTS idx_coupons_email ON public.scholarship_coupons(student_email);

-- ---------------------------------------------------------------------
-- 012 & 015: Razorpay Payments, Student IDs, Receipts & Profile DOB
-- ---------------------------------------------------------------------
ALTER TABLE public.payment_orders DROP CONSTRAINT IF EXISTS payment_orders_status_check;
ALTER TABLE public.payment_orders ADD CONSTRAINT payment_orders_status_check
  CHECK (status IN ('created', 'paid', 'failed', 'cancelled', 'needs_refund'));

ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS student_id text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_norm text,
  ADD COLUMN IF NOT EXISTS student_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS dob date;

ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS student_id text,
  ADD COLUMN IF NOT EXISTS receipt_no text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_enrollments_student_id ON public.enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_receipt_no ON public.enrollments(receipt_no);

CREATE SEQUENCE IF NOT EXISTS public.pgi_student_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS public.pgi_receipt_seq START 1001;

CREATE OR REPLACE FUNCTION public.next_student_id() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN 'PGI-S26-' || lpad(nextval('public.pgi_student_seq')::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.next_receipt_no() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN 'REC-PGI-W26-' || lpad(nextval('public.pgi_receipt_seq')::text, 4, '0');
END;
$$;

-- ---------------------------------------------------------------------
-- 013: Student Dashboard, Attendance, Assignments, Projects & Resets
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  day_number int NOT NULL,
  session_title text NOT NULL,
  mode text DEFAULT 'Online' CHECK (mode IN ('Online', 'Offline')),
  status text NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'late', 'excused', 'holiday')),
  hours_logged numeric(4,1) NOT NULL DEFAULT 2.0,
  check_in timestamptz,
  check_out timestamptz,
  verification_method text DEFAULT 'session_log',
  remarks text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_attendance_student_id ON public.student_attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_student_attendance_user_id ON public.student_attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_student_attendance_date ON public.student_attendance(date);

ALTER TABLE public.student_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students can view own attendance" ON public.student_attendance;
CREATE POLICY "Students can view own attendance" ON public.student_attendance
  FOR SELECT USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "Admin manage attendance" ON public.student_attendance;
CREATE POLICY "Admin manage attendance" ON public.student_attendance
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE TABLE IF NOT EXISTS public.student_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  track text NOT NULL DEFAULT 'Technical',
  description text,
  due_date date NOT NULL,
  submission_url text,
  submission_notes text,
  submitted_at timestamptz,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'reviewed')),
  score int,
  max_score int DEFAULT 100,
  feedback text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_assignments_student_id ON public.student_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_student_assignments_user_id ON public.student_assignments(user_id);

ALTER TABLE public.student_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students can view and submit assignments" ON public.student_assignments;
CREATE POLICY "Students can view and submit assignments" ON public.student_assignments
  FOR ALL USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE TABLE IF NOT EXISTS public.student_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  domain text NOT NULL DEFAULT 'Web Development',
  problem_statement text,
  repo_url text,
  demo_url text,
  status text DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'approved', 'revision_requested')),
  report_url text,
  mentor_review text,
  grade text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_projects_student_id ON public.student_projects(student_id);
ALTER TABLE public.student_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students can view own project" ON public.student_projects;
CREATE POLICY "Students can view own project" ON public.student_projects
  FOR ALL USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE TABLE IF NOT EXISTS public.password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON public.password_resets(token);
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin manage password resets" ON public.password_resets;
CREATE POLICY "Admin manage password resets" ON public.password_resets
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE OR REPLACE FUNCTION public.seed_student_attendance(p_student_id text, p_user_id uuid, p_mode text DEFAULT 'Online')
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inserted int := 0;
  v_base_date date := current_date - 8;
  v_daily_hours numeric := CASE WHEN p_mode = 'Offline' THEN 6.0 ELSE 2.0 END;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.student_attendance WHERE student_id = p_student_id) THEN
    INSERT INTO public.student_attendance (student_id, user_id, date, day_number, session_title, mode, status, hours_logged, check_in, check_out)
    VALUES
      (p_student_id, p_user_id, v_base_date + 0, 1, 'Cohort Orientation & Winter Internship Toolchain Setup', p_mode, 'present', v_daily_hours, (v_base_date + 0 + time '16:00:00')::timestamptz, (v_base_date + 0 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 1, 2, 'Core Foundations & Architecture Overview', p_mode, 'present', v_daily_hours, (v_base_date + 1 + time '16:00:00')::timestamptz, (v_base_date + 1 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 2, 3, 'Hands-on Lab: Component Development & State Engineering', p_mode, 'present', v_daily_hours, (v_base_date + 2 + time '16:00:00')::timestamptz, (v_base_date + 2 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 3, 4, 'Version Control Workflows, Branching & GitHub Collaboration', p_mode, 'present', v_daily_hours, (v_base_date + 3 + time '16:00:00')::timestamptz, (v_base_date + 3 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 4, 5, 'Asynchronous Data Pipelines & RESTful API Architecture', p_mode, 'present', v_daily_hours, (v_base_date + 4 + time '16:00:00')::timestamptz, (v_base_date + 4 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 5, 6, 'Database Schema Modeling & Relational Integrity', p_mode, 'present', v_daily_hours, (v_base_date + 5 + time '16:00:00')::timestamptz, (v_base_date + 5 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 6, 7, 'Mid-Cohort Project Review & Code Quality Audit', p_mode, 'present', v_daily_hours, (v_base_date + 6 + time '16:00:00')::timestamptz, (v_base_date + 6 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 7, 8, 'Industry Best Practices, Testing & Deployment on Cloud', p_mode, 'present', v_daily_hours, (v_base_date + 7 + time '16:00:00')::timestamptz, (v_base_date + 7 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 8, 9, 'Capstone Project Sprint: Real-world Client Specifications', p_mode, 'present', v_daily_hours, (v_base_date + 8 + time '16:00:00')::timestamptz, (v_base_date + 8 + time '18:00:00')::timestamptz);
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;
  RETURN v_inserted;
END;
$$;

-- ---------------------------------------------------------------------
-- 014: Secure Admin Portal (Audit Logs, Mentors, Certificates, Notifications)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_email text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  details jsonb DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON public.admin_audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_target ON public.admin_audit_logs (target_type, target_id);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin audit logs viewable by admins only" ON public.admin_audit_logs;
CREATE POLICY "Admin audit logs viewable by admins only"
  ON public.admin_audit_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
DROP POLICY IF EXISTS "Admin audit logs insertable by admins only" ON public.admin_audit_logs;
CREATE POLICY "Admin audit logs insertable by admins only"
  ON public.admin_audit_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE TABLE IF NOT EXISTS public.mentors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text,
  domain text NOT NULL,
  title text NOT NULL DEFAULT 'Senior Academic Mentor',
  bio text,
  avatar_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mentors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Mentors readable by authenticated users" ON public.mentors;
CREATE POLICY "Mentors readable by authenticated users"
  ON public.mentors FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Mentors manageable by admins only" ON public.mentors;
CREATE POLICY "Mentors manageable by admins only"
  ON public.mentors FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

INSERT INTO public.mentors (name, email, phone, domain, title, bio)
VALUES
  ('Dr. K. Ravindran', 'ravindran.k@plantgreeninertia.com', '+91 94440 12345', 'Web Development & Cloud Architecture', 'Lead Academic Architect & Principal Mentor', '18+ years in distributed systems, full-stack enterprise architecture, and student mentorship.'),
  ('Prof. Meenakshi Sundaram', 'meenakshi.s@plantgreeninertia.com', '+91 94440 23456', 'Android & Mobile Development', 'Mobile Systems Specialist', 'Ex-Samsung lead engineer, specializing in Android OS internals, MIT App Inventor, and edge mobile computing.'),
  ('Arunachalam S.', 'arunachalam.s@plantgreeninertia.com', '+91 94440 34567', 'Digital Marketing & Growth', 'Head of Growth Engineering', 'Digital marketing director with expertise in SEO, analytics funnels, and enterprise acquisition campaigns.'),
  ('Divya Bharathi', 'divya.b@plantgreeninertia.com', '+91 94440 45678', 'Business Analytics & Data', 'Senior Data Strategist', 'Analytics consultant focused on PowerBI, SQL warehousing, and predictive market modeling.')
ON CONFLICT (email) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id text UNIQUE NOT NULL,
  student_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  student_name text NOT NULL,
  domain text NOT NULL,
  duration text NOT NULL DEFAULT '30 Hours',
  completed_hours numeric(5,2) NOT NULL,
  attendance_percentage numeric(5,2) NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verification_url text NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cert_student_id ON public.certificates (student_id);
CREATE INDEX IF NOT EXISTS idx_cert_number ON public.certificates (certificate_id);

ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Certificates readable by anyone (public verification)" ON public.certificates;
CREATE POLICY "Certificates readable by anyone (public verification)"
  ON public.certificates FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Certificates manageable by admins only" ON public.certificates;
CREATE POLICY "Certificates manageable by admins only"
  ON public.certificates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  target_track text NOT NULL DEFAULT 'all',
  target_mode text NOT NULL DEFAULT 'all',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Notifications readable by authenticated students" ON public.notifications;
CREATE POLICY "Notifications readable by authenticated students"
  ON public.notifications FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Notifications manageable by admins only" ON public.notifications;
CREATE POLICY "Notifications manageable by admins only"
  ON public.notifications FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

INSERT INTO public.notifications (title, message, target_track, target_mode, priority)
SELECT n.title, n.message, n.target_track, n.target_mode, n.priority
FROM (VALUES
  ('Winter Cohort 2026 Orientation', 'Welcome to Plant Green Inertia Winter Internship! Orientation begins promptly at your scheduled time. Please review the 30-hour curriculum syllabus in your portal.', 'all', 'all', 'high'),
  ('Daily Attendance Verification Notice', 'Attendance must be verified for all 10 sessions (3 hours/day) to qualify for your official completion certificate and 1-page project report.', 'all', 'all', 'normal')
) AS n(title, message, target_track, target_mode, priority)
WHERE NOT EXISTS (
  SELECT 1 FROM public.notifications existing WHERE existing.title = n.title
);

ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS mode text DEFAULT 'Online & Offline';
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS timings text DEFAULT 'Online: 4-6 PM | Offline: 9 AM-6 PM';
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS seats_limit int DEFAULT 60;
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS enrolled_count int DEFAULT 0;

ALTER TABLE public.internship_applications ADD COLUMN IF NOT EXISTS dob date;
ALTER TABLE public.internship_applications ADD COLUMN IF NOT EXISTS assigned_batch_id uuid REFERENCES public.batches(id);
ALTER TABLE public.internship_applications ADD COLUMN IF NOT EXISTS assigned_mentor_id uuid REFERENCES public.mentors(id);
ALTER TABLE public.internship_applications ADD COLUMN IF NOT EXISTS admin_notes text;

-- 016: Temporary Reusable Test Coupon (PGITEST1) & Test Payment Isolation
ALTER TABLE public.scholarship_coupons
  ALTER COLUMN attempt_id DROP NOT NULL,
  ALTER COLUMN user_id DROP NOT NULL;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.scholarship_coupons'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) ILIKE '%discount_percent%'
        OR pg_get_constraintdef(oid) ILIKE '%status%'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.scholarship_coupons DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.scholarship_coupons
  ADD CONSTRAINT scholarship_coupons_discount_percent_check
    CHECK (discount_percent >= 0 AND discount_percent <= 100),
  ADD CONSTRAINT scholarship_coupons_status_check
    CHECK (status IN ('active', 'redeemed', 'revoked', 'disabled'));

ALTER TABLE public.scholarship_coupons
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_reusable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fixed_payable_paise int CHECK (fixed_payable_paise IS NULL OR fixed_payable_paise >= 0);

CREATE INDEX IF NOT EXISTS idx_scholarship_coupons_is_test ON public.scholarship_coupons(is_test);

ALTER TABLE public.payment_orders
  ALTER COLUMN coupon_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coupon_code text;

ALTER TABLE public.payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_coupon_id_fkey;
ALTER TABLE public.payment_orders
  ADD CONSTRAINT payment_orders_coupon_id_fkey
    FOREIGN KEY (coupon_id) REFERENCES public.scholarship_coupons(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS one_open_order;
CREATE UNIQUE INDEX IF NOT EXISTS one_open_order
  ON public.payment_orders(user_id, coupon_id)
  WHERE status = 'created' AND coupon_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_orders_is_test ON public.payment_orders(is_test);

ALTER TABLE public.enrollments
  ALTER COLUMN coupon_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coupon_code text;

ALTER TABLE public.enrollments
  DROP CONSTRAINT IF EXISTS enrollments_coupon_id_fkey,
  DROP CONSTRAINT IF EXISTS enrollments_coupon_id_key;

ALTER TABLE public.enrollments
  ADD CONSTRAINT enrollments_coupon_id_fkey
    FOREIGN KEY (coupon_id) REFERENCES public.scholarship_coupons(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS enrollments_coupon_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS enrollments_single_use_coupon_idx
  ON public.enrollments(coupon_id)
  WHERE NOT is_test AND coupon_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enrollments_is_test ON public.enrollments(is_test);

INSERT INTO public.scholarship_coupons (
  code, attempt_id, user_id, score_percent, discount_percent,
  fixed_payable_paise, is_test, is_reusable, issued_at, expires_at, status
)
VALUES (
  'PGITEST1', NULL, NULL, 100, 99,
  100, true, true, now(), '2099-12-31T23:59:59Z', 'active'
)
ON CONFLICT (code) DO UPDATE
SET
  fixed_payable_paise = 100,
  discount_percent = 99,
  is_test = true,
  is_reusable = true,
  expires_at = '2099-12-31T23:59:59Z';

COMMIT;

NOTIFY pgrst, 'reload schema';
