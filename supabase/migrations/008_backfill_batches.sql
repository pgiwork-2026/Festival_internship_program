-- 008: Map historical rows to batches. NOT SAFE TO RUN BLIND. Fill in the cutoff, run STEP 1, check the numbers, then STEP 2.
-- Rule: attempts started BEFORE the cutoff (Diwali launch time) = Vijayadashami, at/after = Diwali. Coupons, orders and
-- enrollments inherit the batch of their attempt/coupon. Only rows with batch_id IS NULL are touched; nothing is overwritten.
-- STEP 1 - verify (read only). Replace the timestamp in each query.
select count(*) filter (where started_at <  '2026-01-01T00:00:00+05:30') as vijayadashami_attempts,
       count(*) filter (where started_at >= '2026-01-01T00:00:00+05:30') as diwali_attempts, count(*) filter (where batch_id is not null) as already_mapped
from assessment_attempts;
select count(*) as coupons_without_attempt from scholarship_coupons c where not exists (select 1 from assessment_attempts a where a.id=c.attempt_id);
select count(*) as orders_without_coupon from payment_orders o where not exists (select 1 from scholarship_coupons c where c.id=o.coupon_id);
select count(*) as enrollments_without_coupon from enrollments e where not exists (select 1 from scholarship_coupons c where c.id=e.coupon_id);
-- STEP 2 - apply (replace the cutoff, then run as one transaction).
begin;
update assessment_attempts a set batch_id=(select id from batches where slug=case when a.started_at < '2026-01-01T00:00:00+05:30' then 'vijayadashami' else 'diwali' end) where a.batch_id is null;
update scholarship_coupons c set batch_id=a.batch_id from assessment_attempts a where a.id=c.attempt_id and c.batch_id is null and a.batch_id is not null;
update payment_orders o set batch_id=c.batch_id from scholarship_coupons c where c.id=o.coupon_id and o.batch_id is null and c.batch_id is not null;
update enrollments e set batch_id=c.batch_id from scholarship_coupons c where c.id=e.coupon_id and e.batch_id is null and c.batch_id is not null;
-- registrations: everyone with an attempt joins that attempt's batch; students with none who signed up before the cutoff join Vijayadashami
insert into batch_registrations(user_id,batch_id,registered_at) select distinct on (a.user_id,a.batch_id) a.user_id,a.batch_id,a.started_at from assessment_attempts a where a.batch_id is not null order by a.user_id,a.batch_id,a.started_at on conflict do nothing;
insert into batch_registrations(user_id,batch_id,registered_at) select p.id,(select id from batches where slug='vijayadashami'),p.created_at from profiles p where p.role='student' and p.created_at < '2026-01-01T00:00:00+05:30' on conflict do nothing;
-- check: select count(*) from assessment_attempts where batch_id is null;  (expect 0) then commit; otherwise rollback.
commit;
