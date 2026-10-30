-- One mobile number = one candidate. phone_norm holds the last 10 digits of profiles.phone.
alter table profiles add column if not exists phone_norm text;
update profiles set phone_norm = right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10) where phone is not null;
create index if not exists profiles_phone_norm_idx on profiles(phone_norm);
-- Review existing duplicates (same number, several emails):
--   select phone_norm, count(*), array_agg(id) from profiles where phone_norm <> '' group by 1 having count(*) > 1;
-- After cleaning them up, enforce at database level too:
--   create unique index profiles_phone_norm_uq on profiles(phone_norm) where phone_norm <> '';