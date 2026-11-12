import {
  BASE_PRICE_PAISE,
  TEST_COUPON_CODE,
  TEST_COUPON_PAISE,
  canRequestExtension,
  couponState,
  isTestCoupon,
  isTestCouponEnabled,
  winterPayablePaise
} from './logic.js';

export const VIRTUAL_TEST_COUPON_ID = '00000000-0000-4000-8000-000000000001';

const fallbackTestCouponState = {
  deleted: false,
  status: 'active',
  issued_at: '2026-11-01T00:00:00.000Z'
};

export function resetFallbackTestCoupon(overrides = {}) {
  fallbackTestCouponState.deleted = Boolean(overrides.deleted ?? false);
  fallbackTestCouponState.status = overrides.status || 'active';
  fallbackTestCouponState.issued_at = overrides.issued_at || '2026-11-01T00:00:00.000Z';
}

export function isSchemaColumnError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('column') && (msg.includes('does not exist') || msg.includes('schema cache'));
}

function makeVirtualTestCoupon() {
  return {
    id: VIRTUAL_TEST_COUPON_ID,
    code: TEST_COUPON_CODE,
    attempt_id: null,
    user_id: null,
    batch_id: null,
    student_email: null,
    score_percent: 100,
    discount_percent: 99,
    fixed_payable_paise: TEST_COUPON_PAISE,
    is_test: true,
    is_reusable: true,
    issued_at: fallbackTestCouponState.issued_at,
    expires_at: '2099-12-31T23:59:59.000Z',
    status: fallbackTestCouponState.status,
    _virtual: true
  };
}

/**
 * Checks whether the connected database has migration 016 columns on scholarship_coupons.
 * Returns null if the query errored unexpectedly, true if present, false if pre-016 schema.
 */
export async function hasTestCouponDbSchema(db) {
  try {
    const { error } = await db.from('scholarship_coupons').select('is_test').limit(1);
    if (!error) return true;
    if (isSchemaColumnError(error)) return false;
    return null;
  } catch {
    return false;
  }
}

/**
 * Resolves a coupon row by code from `scholarship_coupons`, falling back cleanly for
 * `PGITEST1` when migration 016 has not yet been applied to the database.
 */
export async function resolveCouponByCode(db, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return null;

  try {
    const { data, error } = await db
      .from('scholarship_coupons')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (!error && data) return data;
  } catch {}

  if (code === TEST_COUPON_CODE) {
    const schemaReady = await hasTestCouponDbSchema(db);
    // Once 016 schema is present in DB, deletion from scholarship_coupons must stay authoritative.
    if (schemaReady === true) return null;
    if (!fallbackTestCouponState.deleted) {
      return makeVirtualTestCoupon();
    }
  }

  return null;
}

/**
 * Resolves a coupon row by ID, including virtual test coupon fallback.
 */
export async function resolveCouponById(db, couponId) {
  if (!couponId) return null;
  if (couponId === VIRTUAL_TEST_COUPON_ID && !fallbackTestCouponState.deleted) {
    return makeVirtualTestCoupon();
  }
  try {
    const { data } = await db.from('scholarship_coupons').select('*').eq('id', couponId).maybeSingle();
    if (data) return data;
  } catch {}
  return null;
}

/**
 * Returns global test coupons (not bound to a batch_id) for admin listing.
 */
export async function fetchTestCouponsForAdmin(db) {
  const schemaReady = await hasTestCouponDbSchema(db);
  if (schemaReady === true) {
    try {
      const { data } = await db
        .from('scholarship_coupons')
        .select('*')
        .or(`is_test.eq.true,code.eq.${TEST_COUPON_CODE}`);
      return data || [];
    } catch {
      return [];
    }
  }

  try {
    const { data } = await db
      .from('scholarship_coupons')
      .select('*')
      .eq('code', TEST_COUPON_CODE);
    if (data && data.length) return data;
  } catch {}

  if (!fallbackTestCouponState.deleted) {
    return [makeVirtualTestCoupon()];
  }
  return [];
}

/**
 * Toggles or sets status ('active' / 'disabled' / 'revoked') on a coupon.
 */
export async function setCouponStatusInStore(db, code, nextStatus) {
  const normCode = String(code || '').trim().toUpperCase();
  try {
    const { data, error } = await db
      .from('scholarship_coupons')
      .update({ status: nextStatus })
      .ilike('code', normCode)
      .select()
      .maybeSingle();

    if (!error && data) return data;
  } catch {}

  if (normCode === TEST_COUPON_CODE && !fallbackTestCouponState.deleted) {
    const schemaReady = await hasTestCouponDbSchema(db);
    if (schemaReady !== true) {
      fallbackTestCouponState.status = nextStatus === 'revoked' ? 'disabled' : nextStatus;
      return makeVirtualTestCoupon();
    }
  }

  return null;
}

/**
 * Deletes a coupon row by code. Returns true if deleted, false if not found.
 */
export async function deleteCouponByCode(db, code) {
  const normCode = String(code || '').trim().toUpperCase();
  const existing = await resolveCouponByCode(db, normCode);
  if (!existing) return { deleted: false, notFound: true };

  if (existing._virtual) {
    fallbackTestCouponState.deleted = true;
    return { deleted: true, virtual: true };
  }

  const { error } = await db.from('scholarship_coupons').delete().eq('id', existing.id);
  if (error) {
    return { deleted: false, error };
  }
  return { deleted: true };
}

/**
 * Detects whether a payment order or enrollment record is a test transaction
 * and should be excluded from analytics, payment reports, and revenue totals.
 */
export function isTestTransactionRecord(row) {
  if (!row) return false;
  if (row.is_test === true || row.isTest === true) return true;
  if (String(row.coupon_code || '').trim().toUpperCase() === TEST_COUPON_CODE) return true;
  if (isTestCoupon(row.scholarship_coupons)) return true;
  if (row.coupon_id === VIRTUAL_TEST_COUPON_ID) return true;
  if (Number(row.amount_paise) === TEST_COUPON_PAISE) return true;
  return false;
}

export function formatTestCouponMeta(c) {
  const test = isTestCoupon(c);
  return {
    isTest: test,
    isReusable: test || Boolean(c?.is_reusable),
    envEnabled: test ? isTestCouponEnabled() : true
  };
}

/**
 * Shared server-side coupon validation used by /api/coupons/validate and tests.
 */
export async function validateCouponCode(db, { code, email }) {
  const normCode = String(code || '').trim().toUpperCase();
  const normEmail = String(email || '').trim().toLowerCase();
  if (!normCode) return { valid: false, reason: 'Coupon code is required.' };

  if (normCode === TEST_COUPON_CODE && !isTestCouponEnabled()) {
    return { valid: false, reason: 'Invalid coupon code.' };
  }

  const c = await resolveCouponByCode(db, normCode);
  if (!c) return { valid: false, reason: 'Invalid coupon code.' };

  const testCoupon = isTestCoupon(c);
  if (testCoupon && !isTestCouponEnabled()) {
    return { valid: false, reason: 'Invalid coupon code.' };
  }

  if (c.status === 'disabled' || c.status === 'revoked') {
    return { valid: false, reason: 'This coupon has been disabled.', state: c.status };
  }

  if (!testCoupon) {
    if (c.status === 'redeemed') {
      return { valid: false, reason: 'Coupon has already been redeemed.', state: 'redeemed' };
    }
    const state = couponState(c);
    if (state === 'expired') {
      return {
        valid: false,
        reason: 'Coupon expired. Valid for exactly 24 hours.',
        state: 'expired',
        canExtend: canRequestExtension(c, 2),
        extensionCount: Number(c.extension_count) || 0
      };
    }
    if (normEmail && c.student_email && c.student_email.toLowerCase() !== normEmail) {
      return { valid: false, reason: 'Coupon is bound to a different email address.' };
    }
  }

  const payAmt = testCoupon ? TEST_COUPON_PAISE : winterPayablePaise(c);
  const rawDisc = Number(c.discount_percent);
  const discountPercent = testCoupon
    ? 99
    : (rawDisc === 85 ? 88 : (rawDisc === 100 ? 90 : rawDisc));

  return {
    valid: true,
    code: c.code,
    discountPercent,
    basePricePaise: BASE_PRICE_PAISE,
    payablePaise: payAmt,
    discountPaise: Math.max(0, BASE_PRICE_PAISE - payAmt),
    scorePercent: Number(c.score_percent ?? 0),
    expiresAt: testCoupon ? null : c.expires_at,
    state: 'active',
    isTest: testCoupon,
    isReusable: testCoupon || Boolean(c.is_reusable)
  };
}
