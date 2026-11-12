-- 017: Set PGITEST1 Rs 1 test coupon validity to 24 hours from issue/reissue
INSERT INTO public.scholarship_coupons (
  code,
  attempt_id,
  user_id,
  score_percent,
  discount_percent,
  fixed_payable_paise,
  is_test,
  is_reusable,
  issued_at,
  expires_at,
  status
)
VALUES (
  'PGITEST1',
  NULL,
  NULL,
  100,
  99,
  100,
  true,
  true,
  now(),
  now() + interval '24 hours',
  'active'
)
ON CONFLICT (code) DO UPDATE
SET
  fixed_payable_paise = 100,
  discount_percent = 99,
  is_test = true,
  is_reusable = true,
  issued_at = now(),
  reissued_at = now(),
  expires_at = now() + interval '24 hours',
  status = 'active';

NOTIFY pgrst, 'reload schema';
