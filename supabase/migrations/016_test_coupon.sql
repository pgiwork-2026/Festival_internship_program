-- 016: Temporary Reusable Test Coupon (PGITEST1) & Test Payment Isolation
-- Adds is_test tracking, reusable non-expiring test coupon support, and seeds PGITEST1 (₹1 = 100 paise).

-- 1. Extend scholarship_coupons for global/reusable test coupons
ALTER TABLE public.scholarship_coupons
  ALTER COLUMN attempt_id DROP NOT NULL,
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.scholarship_coupons
  DROP CONSTRAINT IF EXISTS scholarship_coupons_discount_percent_check,
  DROP CONSTRAINT IF EXISTS scholarship_coupons_status_check;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.scholarship_coupons'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) ILIKE '%discount_percent%'
        OR pg_get_constraintdef(oid) ILIKE '%status%'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.scholarship_coupons DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.scholarship_coupons
  ADD CONSTRAINT scholarship_coupons_discount_percent_check
    CHECK (discount_percent >= 0 AND discount_percent <= 100),
  ADD CONSTRAINT scholarship_coupons_status_check
    CHECK (status IN ('active', 'redeemed', 'revoked', 'disabled'));

ALTER TABLE public.scholarship_coupons
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_reusable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fixed_payable_paise int CHECK (fixed_payable_paise IS NULL OR fixed_payable_paise >= 0);

CREATE INDEX IF NOT EXISTS idx_scholarship_coupons_is_test ON public.scholarship_coupons(is_test);

-- 2. Extend payment_orders with is_test tracking and per-user open order uniqueness
ALTER TABLE public.payment_orders
  ALTER COLUMN coupon_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coupon_code text;

ALTER TABLE public.payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_coupon_id_fkey;
ALTER TABLE public.payment_orders
  ADD CONSTRAINT payment_orders_coupon_id_fkey
    FOREIGN KEY (coupon_id) REFERENCES public.scholarship_coupons(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS one_open_order;
CREATE UNIQUE INDEX IF NOT EXISTS one_open_order
  ON public.payment_orders(user_id, coupon_id)
  WHERE status = 'created' AND coupon_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_orders_is_test ON public.payment_orders(is_test);

-- 3. Extend enrollments with is_test tracking and allow reusable test coupons across enrollments
ALTER TABLE public.enrollments
  ALTER COLUMN coupon_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coupon_code text;

ALTER TABLE public.enrollments
  DROP CONSTRAINT IF EXISTS enrollments_coupon_id_fkey,
  DROP CONSTRAINT IF EXISTS enrollments_coupon_id_key;

ALTER TABLE public.enrollments
  ADD CONSTRAINT enrollments_coupon_id_fkey
    FOREIGN KEY (coupon_id) REFERENCES public.scholarship_coupons(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS enrollments_coupon_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS enrollments_single_use_coupon_idx
  ON public.enrollments(coupon_id)
  WHERE NOT is_test AND coupon_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enrollments_is_test ON public.enrollments(is_test);

-- 4. Seed PGITEST1 reusable ₹1 (100 paise) test coupon
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
  expires_at = now() + interval '24 hours',
  status = 'active';

NOTIFY pgrst, 'reload schema';
