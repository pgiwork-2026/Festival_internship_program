alter table courses add column if not exists access_url text; -- admin-configured; only returned to enrolled students
create table payment_orders(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id), course_id uuid not null references courses(id), coupon_id uuid not null references scholarship_coupons(id), amount_paise int not null check(amount_paise>0), currency text not null default 'INR', razorpay_order_id text unique not null, razorpay_payment_id text unique, status text not null default 'created' check(status in('created','paid','cancelled','needs_refund')), created_at timestamptz default now(), paid_at timestamptz);
create unique index one_open_order on payment_orders(coupon_id) where status='created';
create index on payment_orders(user_id);
create table payment_events(id bigserial primary key, event_id text unique, type text, razorpay_order_id text, payload jsonb, created_at timestamptz default now());
create table enrollments(id uuid primary key default gen_random_uuid(), user_id uuid unique not null references profiles(id), course_id uuid not null references courses(id), coupon_id uuid unique not null references scholarship_coupons(id), payment_order_id uuid references payment_orders(id), kind text not null check(kind in('paid','free')), amount_paise int not null check(amount_paise>=0), transaction_ref text not null, status text not null default 'active' check(status in('active','cancelled')), enrolled_at timestamptz default now());
alter table payment_orders enable row level security; alter table payment_events enable row level security; alter table enrollments enable row level security;
create policy o_own on payment_orders for select using(user_id=auth.uid() or is_admin());
create policy e_admin on payment_events for select using(is_admin());
create policy en_own on enrollments for select using(user_id=auth.uid() or is_admin());
-- all writes happen on the server with the service role
