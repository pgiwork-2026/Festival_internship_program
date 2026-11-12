-- Desktop-Only Assessment Enforcement & Per-Student Mobile Override
ALTER TABLE public.test_settings
  ADD COLUMN IF NOT EXISTS desktop_only boolean NOT NULL DEFAULT true;

ALTER TABLE public.internship_applications
  ADD COLUMN IF NOT EXISTS allow_mobile_assessment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mobile_override_reason text;
