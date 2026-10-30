create extension if not exists pgcrypto;
create table profiles(id uuid primary key references auth.users on delete cascade, full_name text, phone text, role text not null default 'student' check(role in('student','admin')), created_at timestamptz default now());
create table courses(id uuid primary key default gen_random_uuid(), title text not null, description text, duration text, skills text[] default '{}', benefits text[] default '{}', base_price_paise int not null default 999900 check(base_price_paise>=0), active bool default true);
create table test_settings(id int primary key default 1 check(id=1), question_count int not null default 20 check(question_count>0), duration_seconds int not null default 1200 check(duration_seconds>0), marks_per_question int not null default 1, pass_percent int not null default 50, coupon_valid_hours int not null default 24);
insert into test_settings default values;
create table questions(id uuid primary key default gen_random_uuid(), text text not null, options jsonb not null, correct_option_id text not null, active bool default true);
create table assessment_attempts(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id), status text not null default 'in_progress' check(status in('in_progress','submitted','timed_out')), question_order jsonb not null, started_at timestamptz default now(), expires_at timestamptz not null, submitted_at timestamptz, correct_count int, total_questions int, score_percent numeric(5,2));
create unique index one_active_attempt on assessment_attempts(user_id) where status='in_progress';
create table responses(attempt_id uuid references assessment_attempts on delete cascade, question_id uuid references questions, selected_option_id text not null, saved_at timestamptz default now(), primary key(attempt_id,question_id));
create table proctoring_violations(id bigserial primary key, attempt_id uuid not null references assessment_attempts on delete cascade, type text not null check(type in('multiple_faces','no_face','looking_away','phone_detected','camera_unavailable','tab_switch')), occurred_at timestamptz default now());
create index on proctoring_violations(attempt_id);
create table scholarship_coupons(id uuid primary key default gen_random_uuid(), code text unique not null, attempt_id uuid unique not null references assessment_attempts, user_id uuid not null references profiles(id), score_percent numeric(5,2) not null, discount_percent int not null check(discount_percent in(85,90,100)), issued_at timestamptz not null default now(), expires_at timestamptz not null, status text not null default 'active' check(status in('active','redeemed')), redeemed_at timestamptz, course_id uuid references courses);
create index on scholarship_coupons(user_id);
-- RLS: students read only own rows; all writes and answer key via server (service role bypasses RLS)
create function is_admin() returns bool language sql security definer stable as $$ select exists(select 1 from profiles where id=auth.uid() and role='admin') $$;
alter table profiles enable row level security; alter table courses enable row level security; alter table test_settings enable row level security; alter table questions enable row level security; alter table assessment_attempts enable row level security; alter table responses enable row level security; alter table proctoring_violations enable row level security; alter table scholarship_coupons enable row level security;
create policy p_own on profiles for select using(id=auth.uid() or is_admin());
create policy p_upd on profiles for update using(id=auth.uid()) with check(id=auth.uid() and role=(select role from profiles where id=auth.uid()));
create policy c_read on courses for select using(active or is_admin());
create policy s_read on test_settings for select using(true);
create policy q_admin on questions for all using(is_admin()); -- students: no policy => no access to answer key
create policy a_own on assessment_attempts for select using(user_id=auth.uid() or is_admin());
create policy r_admin on responses for select using(is_admin());
create policy v_admin on proctoring_violations for select using(is_admin());
create policy k_own on scholarship_coupons for select using(user_id=auth.uid() or is_admin());
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.profiles(id,full_name) values(new.id,new.raw_user_meta_data->>'full_name') on conflict (id) do nothing; return new; end $$;
create trigger on_auth_user after insert on auth.users for each row execute function public.handle_new_user();
