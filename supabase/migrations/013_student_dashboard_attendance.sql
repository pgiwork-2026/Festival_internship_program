-- ===================================================================
-- Migration 013: Student Dashboard, Attendance & Academic Modules
-- Plant Green Inertia — Winter Internship Program
-- ===================================================================

-- 1. Student Attendance Table
create table if not exists public.student_attendance (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  user_id uuid references auth.users(id) on delete cascade,
  date date not null,
  day_number int not null,
  session_title text not null,
  mode text default 'Online' check (mode in ('Online', 'Offline')),
  status text not null default 'present' check (status in ('present', 'absent', 'late', 'excused', 'holiday')),
  hours_logged numeric(4,1) not null default 2.0,
  check_in timestamptz,
  check_out timestamptz,
  verification_method text default 'session_log',
  remarks text,
  created_at timestamptz default now()
);

create index if not exists idx_student_attendance_student_id on public.student_attendance(student_id);
create index if not exists idx_student_attendance_user_id on public.student_attendance(user_id);
create index if not exists idx_student_attendance_date on public.student_attendance(date);

alter table public.student_attendance enable row level security;
drop policy if exists "Students can view own attendance" on public.student_attendance;
create policy "Students can view own attendance" on public.student_attendance
  for select using (auth.uid() = user_id or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "Admin manage attendance" on public.student_attendance;
create policy "Admin manage attendance" on public.student_attendance
  for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- 2. Student Assignments Table
create table if not exists public.student_assignments (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  track text not null default 'Technical',
  description text,
  due_date date not null,
  submission_url text,
  submission_notes text,
  submitted_at timestamptz,
  status text default 'pending' check (status in ('pending', 'submitted', 'reviewed')),
  score int,
  max_score int default 100,
  feedback text,
  created_at timestamptz default now()
);

create index if not exists idx_student_assignments_student_id on public.student_assignments(student_id);
create index if not exists idx_student_assignments_user_id on public.student_assignments(user_id);

alter table public.student_assignments enable row level security;
drop policy if exists "Students can view and submit assignments" on public.student_assignments;
create policy "Students can view and submit assignments" on public.student_assignments
  for all using (auth.uid() = user_id or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- 3. Student Capstone Projects Table
create table if not exists public.student_projects (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  domain text not null default 'Web Development',
  problem_statement text,
  repo_url text,
  demo_url text,
  status text default 'in_progress' check (status in ('in_progress', 'submitted', 'approved', 'revision_requested')),
  report_url text,
  mentor_review text,
  grade text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_student_projects_student_id on public.student_projects(student_id);
alter table public.student_projects enable row level security;
drop policy if exists "Students can view own project" on public.student_projects;
create policy "Students can view own project" on public.student_projects
  for all using (auth.uid() = user_id or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- 4. Password Recovery Tokens Table
create table if not exists public.password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  token text not null unique,
  expires_at timestamptz not null,
  used boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_password_resets_token on public.password_resets(token);
alter table public.password_resets enable row level security;
drop policy if exists "Admin manage password resets" on public.password_resets;
create policy "Admin manage password resets" on public.password_resets
  for all using (true);

-- 5. Seed Initial Attendance Template Helper RPC
create or replace function public.seed_student_attendance(p_student_id text, p_user_id uuid, p_mode text default 'Online')
returns int language plpgsql security definer as $$
declare
  v_inserted int := 0;
  v_base_date date := current_date - 8;
  v_daily_hours numeric := case when p_mode = 'Offline' then 6.0 else 2.0 end;
begin
  if not exists (select 1 from public.student_attendance where student_id = p_student_id) then
    insert into public.student_attendance (student_id, user_id, date, day_number, session_title, mode, status, hours_logged, check_in, check_out)
    values
      (p_student_id, p_user_id, v_base_date + 0, 1, 'Cohort Orientation & Winter Internship Toolchain Setup', p_mode, 'present', v_daily_hours, (v_base_date + 0 + time '16:00:00')::timestamptz, (v_base_date + 0 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 1, 2, 'Core Foundations & Architecture Overview', p_mode, 'present', v_daily_hours, (v_base_date + 1 + time '16:00:00')::timestamptz, (v_base_date + 1 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 2, 3, 'Hands-on Lab: Component Development & State Engineering', p_mode, 'present', v_daily_hours, (v_base_date + 2 + time '16:00:00')::timestamptz, (v_base_date + 2 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 3, 4, 'Version Control Workflows, Branching & GitHub Collaboration', p_mode, 'present', v_daily_hours, (v_base_date + 3 + time '16:00:00')::timestamptz, (v_base_date + 3 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 4, 5, 'Asynchronous Data Pipelines & RESTful API Architecture', p_mode, 'present', v_daily_hours, (v_base_date + 4 + time '16:00:00')::timestamptz, (v_base_date + 4 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 5, 6, 'Database Schema Modeling & Relational Integrity', p_mode, 'present', v_daily_hours, (v_base_date + 5 + time '16:00:00')::timestamptz, (v_base_date + 5 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 6, 7, 'Mid-Cohort Project Review & Code Quality Audit', p_mode, 'present', v_daily_hours, (v_base_date + 6 + time '16:00:00')::timestamptz, (v_base_date + 6 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 7, 8, 'Industry Best Practices, Testing & Deployment on Cloud', p_mode, 'present', v_daily_hours, (v_base_date + 7 + time '16:00:00')::timestamptz, (v_base_date + 7 + time '18:00:00')::timestamptz),
      (p_student_id, p_user_id, v_base_date + 8, 9, 'Capstone Project Sprint: Real-world Client Specifications', p_mode, 'present', v_daily_hours, (v_base_date + 8 + time '16:00:00')::timestamptz, (v_base_date + 8 + time '18:00:00')::timestamptz);
    get diagnostics v_inserted = row_count;
  end if;
  return v_inserted;
end;
$$;
