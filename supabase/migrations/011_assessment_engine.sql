-- 011: Assessment Engine Upgrade
-- Supports 100-mark configurable assessment, pass mark, negative marking, attempt limits,
-- and coupon binding with 24-hour expiry and extension tracking.

-- 1. Upgrade test_settings table
alter table test_settings
  add column if not exists total_marks int not null default 100,
  add column if not exists pass_mark numeric(5,2) not null default 30,
  add column if not exists negative_marking numeric(5,2) not null default 0,
  add column if not exists attempt_limit int not null default 1;

update test_settings set
  question_count = 20,
  duration_seconds = 1200,
  marks_per_question = 5,
  total_marks = 100,
  pass_mark = 30,
  negative_marking = 0,
  attempt_limit = 1,
  coupon_valid_hours = 24
where id = 1;

-- 2. Add marks column to questions table
alter table questions
  add column if not exists marks numeric(5,2) not null default 5;

-- 3. Upgrade assessment_attempts table
alter table assessment_attempts
  add column if not exists total_score numeric(5,2),
  add column if not exists total_marks int not null default 100,
  add column if not exists pass_mark numeric(5,2) not null default 30,
  add column if not exists is_qualified bool not null default false,
  add column if not exists application_id text;

create index if not exists idx_attempts_app_id on assessment_attempts(application_id);

-- 4. Upgrade scholarship_coupons table
alter table scholarship_coupons
  add column if not exists application_id text,
  add column if not exists student_email text,
  add column if not exists extension_count int not null default 0,
  add column if not exists reissued_at timestamptz;

create index if not exists idx_coupons_app_id on scholarship_coupons(application_id);
create index if not exists idx_coupons_email on scholarship_coupons(student_email);
