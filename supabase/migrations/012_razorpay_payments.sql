-- 012: Razorpay Payments, Unique Student IDs, and Payment Receipts
-- Expands payment_orders status check for failure tracking, adds student_id and receipt_no.

-- 1. Update payment_orders table
alter table payment_orders drop constraint if exists payment_orders_status_check;
alter table payment_orders add constraint payment_orders_status_check
  check (status in ('created', 'paid', 'failed', 'cancelled', 'needs_refund'));

alter table payment_orders
  add column if not exists failure_reason text,
  add column if not exists student_id text;

-- 2. Add student_id to profiles table
alter table profiles
  add column if not exists student_id text unique;

-- 3. Update enrollments table with student_id and receipt_no
alter table enrollments
  add column if not exists student_id text,
  add column if not exists receipt_no text unique;

create index if not exists idx_enrollments_student_id on enrollments(student_id);
create index if not exists idx_enrollments_receipt_no on enrollments(receipt_no);

-- 4. Sequences and generator functions for sequential unique IDs
create sequence if not exists pgi_student_seq start 1001;
create sequence if not exists pgi_receipt_seq start 1001;

create or replace function next_student_id() returns text language plpgsql as $$
begin
  return 'PGI-S26-' || lpad(nextval('pgi_student_seq')::text, 4, '0');
end;
$$;

create or replace function next_receipt_no() returns text language plpgsql as $$
begin
  return 'REC-PGI-W26-' || lpad(nextval('pgi_receipt_seq')::text, 4, '0');
end;
$$;
