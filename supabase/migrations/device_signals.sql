-- Anti-duplicate signals captured when an attempt starts.
create table if not exists attempt_signals (
  attempt_id uuid primary key references assessment_attempts(id) on delete cascade,
  user_id uuid not null,
  device_id text, fp text, ip text, flag text,
  created_at timestamptz not null default now()
);
create index if not exists attempt_signals_device_idx on attempt_signals(device_id);
create index if not exists attempt_signals_fp_ip_idx on attempt_signals(fp, ip);
alter table attempt_signals enable row level security;
-- Review flagged attempts:  select * from attempt_signals where flag is not null;