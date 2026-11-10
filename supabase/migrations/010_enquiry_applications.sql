-- 010: Enquiry / Internship Applications table & sequence
-- Supports the Enquiry Form -> Promise Slides -> Assessment student onboarding journey.

create sequence if not exists pgi_application_seq start 1;

create table if not exists internship_applications (
  id uuid primary key default gen_random_uuid(),
  application_id text unique not null,
  full_name text not null,
  email text not null,
  phone text not null,
  phone_norm text not null,
  college text not null,
  department text not null,
  passed_out_year text not null,
  domain_type text not null check (domain_type in ('Technical', 'Non-Technical')),
  domain_name text not null,
  mode text not null check (mode in ('Online', 'Offline')),
  duration text not null default '30 Hours',
  internship_period text not null check (internship_period in ('1 week', '2 weeks', '1 month', '3 months', '6 months')),
  address text not null,
  why_hire text not null,
  referral_code text,
  status text not null default 'submitted' check (status in ('submitted', 'under_review', 'assessment_started', 'assessment_completed', 'enrolled', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for performance & duplicate lookups
create index if not exists idx_applications_email on internship_applications(lower(email));
create index if not exists idx_applications_phone_norm on internship_applications(phone_norm);
create index if not exists idx_applications_ref on internship_applications(referral_code);
create index if not exists idx_applications_created on internship_applications(created_at desc);

-- Function for atomic sequence-based application ID generation
create or replace function next_pgi_application_id()
returns text language plpgsql as $$
declare
  next_val bigint;
begin
  next_val := nextval('pgi_application_seq');
  return 'PGI-W26-' || lpad(next_val::text, 4, '0');
end;
$$;

-- RLS
alter table internship_applications enable row level security;
drop policy if exists app_insert_policy on internship_applications;
create policy app_insert_policy on internship_applications for insert with check (true);
drop policy if exists app_select_policy on internship_applications;
create policy app_select_policy on internship_applications for select using (true);
