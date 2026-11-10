-- Migration 015: Store candidate Date of Birth (DOB) on applications and profiles
-- Supports using DOB (DDMMYYYY) as the candidate's assessment login password.

ALTER TABLE public.internship_applications
  ADD COLUMN IF NOT EXISTS dob DATE;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dob DATE;
