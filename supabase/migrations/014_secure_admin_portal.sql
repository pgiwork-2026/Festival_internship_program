-- Migration 014: Secure Admin Portal (Role-based, Analytics, Audit Logs, Mentors, Certificates)

-- 1. Admin Audit Logs
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON public.admin_audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_target ON public.admin_audit_logs (target_type, target_id);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin audit logs viewable by admins only"
  ON public.admin_audit_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admin audit logs insertable by admins only"
  ON public.admin_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 2. Mentors Registry
CREATE TABLE IF NOT EXISTS public.mentors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  domain TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Senior Academic Mentor',
  bio TEXT,
  avatar_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mentors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Mentors readable by authenticated users"
  ON public.mentors
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Mentors manageable by admins only"
  ON public.mentors
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- Seed Initial Mentors
INSERT INTO public.mentors (name, email, phone, domain, title, bio)
VALUES
  ('Dr. K. Ravindran', 'ravindran.k@plantgreeninertia.com', '+91 94440 12345', 'Web Development & Cloud Architecture', 'Lead Academic Architect & Principal Mentor', '18+ years in distributed systems, full-stack enterprise architecture, and student mentorship.'),
  ('Prof. Meenakshi Sundaram', 'meenakshi.s@plantgreeninertia.com', '+91 94440 23456', 'Android & Mobile Development', 'Mobile Systems Specialist', 'Ex-Samsung lead engineer, specializing in Android OS internals, MIT App Inventor, and edge mobile computing.'),
  ('Arunachalam S.', 'arunachalam.s@plantgreeninertia.com', '+91 94440 34567', 'Digital Marketing & Growth', 'Head of Growth Engineering', 'Digital marketing director with expertise in SEO, analytics funnels, and enterprise acquisition campaigns.'),
  ('Divya Bharathi', 'divya.b@plantgreeninertia.com', '+91 94440 45678', 'Business Analytics & Data', 'Senior Data Strategist', 'Analytics consultant focused on PowerBI, SQL warehousing, and predictive market modeling.')
ON CONFLICT (email) DO NOTHING;

-- 3. Issued Certificates Registry
CREATE TABLE IF NOT EXISTS public.certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id TEXT UNIQUE NOT NULL,
  student_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  student_name TEXT NOT NULL,
  domain TEXT NOT NULL,
  duration TEXT NOT NULL DEFAULT '30 Hours',
  completed_hours NUMERIC(5,2) NOT NULL,
  attendance_percentage NUMERIC(5,2) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verification_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cert_student_id ON public.certificates (student_id);
CREATE INDEX IF NOT EXISTS idx_cert_number ON public.certificates (certificate_id);

ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Certificates readable by anyone (public verification)"
  ON public.certificates
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Certificates manageable by admins only"
  ON public.certificates
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 4. Cohort Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_track TEXT NOT NULL DEFAULT 'all',
  target_mode TEXT NOT NULL DEFAULT 'all',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Notifications readable by authenticated students"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Notifications manageable by admins only"
  ON public.notifications
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- Seed initial broadcast notifications
INSERT INTO public.notifications (title, message, target_track, target_mode, priority)
VALUES
  ('Winter Cohort 2026 Orientation', 'Welcome to Plant Green Inertia Winter Internship! Orientation begins promptly at your scheduled time. Please review the 30-hour curriculum syllabus in your portal.', 'all', 'all', 'high'),
  ('Daily Attendance Verification Notice', 'Attendance must be verified for all 10 sessions (3 hours/day) to qualify for your official completion certificate and 1-page project report.', 'all', 'all', 'normal')
ON CONFLICT DO NOTHING;

-- 5. Extend Batches with Winter Program Mode, Timings & Seats
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'Online & Offline';
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS timings TEXT DEFAULT 'Online: 4-6 PM | Offline: 9 AM-6 PM';
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS seats_limit INT DEFAULT 60;
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS enrolled_count INT DEFAULT 0;

-- 6. Extend Internship Applications with Assigned Mentor & Batch
ALTER TABLE public.internship_applications ADD COLUMN IF NOT EXISTS assigned_batch_id UUID REFERENCES public.batches(id);
ALTER TABLE public.internship_applications ADD COLUMN IF NOT EXISTS assigned_mentor_id UUID REFERENCES public.mentors(id);
ALTER TABLE public.internship_applications ADD COLUMN IF NOT EXISTS admin_notes TEXT;
