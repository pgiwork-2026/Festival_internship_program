-- 007: Batch management. ADDITIVE ONLY (no drop table / delete / truncate / data rewrite). Review before running; not auto-applied.
-- Run order: 007 -> 008 (verify, then backfill) -> deploy server code.
create table if not exists batches(
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null,
  status text not null default 'upcoming' check (status in ('upcoming','active','inactive','completed')),
  starts_on date, ends_on date, description text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on));
create unique index if not exists one_active_batch on batches((true)) where status = 'active'; -- student flows need exactly one open batch

-- One row per (student, batch): the shared profile/auth account is reused, registration is per batch.
create table if not exists batch_registrations(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  batch_id uuid not null references batches(id),
  registered_at timestamptz not null default now(),
  unique (user_id, batch_id));
create index if not exists batch_registrations_batch_idx on batch_registrations(batch_id);

-- Nullable on purpose: existing rows stay untouched until 008 maps them after verification.
alter table assessment_attempts add column if not exists batch_id uuid references batches(id);
alter table scholarship_coupons add column if not exists batch_id uuid references batches(id);
alter table payment_orders      add column if not exists batch_id uuid references batches(id);
alter table enrollments         add column if not exists batch_id uuid references batches(id);
create index if not exists assessment_attempts_batch_idx on assessment_attempts(batch_id);
create index if not exists scholarship_coupons_batch_idx on scholarship_coupons(batch_id);
create index if not exists payment_orders_batch_idx on payment_orders(batch_id);
create index if not exists enrollments_batch_idx on enrollments(batch_id);

-- A student may enrol once PER BATCH (was: once ever). Constraint swap only; no rows change. coupon_id stays unique.
alter table enrollments drop constraint if exists enrollments_user_id_key;
create unique index if not exists enrollments_user_batch_uq on enrollments(user_id, batch_id);

-- Seed the two festival batches (dates left empty: set them in Admin > Batches).
insert into batches(slug,name,status) values ('vijayadashami','Vijayadashami','completed'),('diwali','Diwali','active') on conflict (slug) do nothing;

-- RLS: reads only; every write goes through the server (service role) after the admin check.
alter table batches enable row level security; alter table batch_registrations enable row level security;
drop policy if exists b_read on batches; create policy b_read on batches for select to authenticated using (true);
drop policy if exists br_own on batch_registrations; create policy br_own on batch_registrations for select using (user_id = auth.uid() or is_admin());
