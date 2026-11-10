import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAssessmentScore,
  payablePaise,
  winterTierFor,
  winterPayablePaise,
  couponState,
  canRequestExtension,
  makeCouponCode,
  WINTER_PRICE_PAISE,
  BASE_PRICE_PAISE
} from '../logic.js';
import { buildCouponEmailHtml, buildCouponEmailText } from '../email.js';

test('Assessment scoring: 100 marks total, 5 marks per question', () => {
  const dummyQuestions = Array.from({ length: 20 }, (_, i) => ({
    id: `q_${i + 1}`,
    correct_option_id: 'a',
    marks: 5
  }));

  // 6 correct answers = 30 marks -> exactly meets pass mark 30
  const passResponses = Array.from({ length: 6 }, (_, i) => ({
    question_id: `q_${i + 1}`,
    selected_option_id: 'a'
  }));
  const passResult = calculateAssessmentScore({
    responses: passResponses,
    questions: dummyQuestions,
    marksPerQuestion: 5,
    negativeMarking: 0,
    totalMarks: 100,
    passMark: 30
  });
  assert.equal(passResult.score, 30);
  assert.equal(passResult.correctCount, 6);
  assert.equal(passResult.wrongCount, 0);
  assert.equal(passResult.isQualified, true);

  // 5 correct answers = 25 marks -> below pass mark 30
  const failResponses = Array.from({ length: 5 }, (_, i) => ({
    question_id: `q_${i + 1}`,
    selected_option_id: 'a'
  }));
  const failResult = calculateAssessmentScore({
    responses: failResponses,
    questions: dummyQuestions,
    marksPerQuestion: 5,
    negativeMarking: 0,
    totalMarks: 100,
    passMark: 30
  });
  assert.equal(failResult.score, 25);
  assert.equal(failResult.correctCount, 5);
  assert.equal(failResult.isQualified, false);
});

test('Assessment scoring: negative marking deduction', () => {
  const dummyQuestions = Array.from({ length: 20 }, (_, i) => ({
    id: `q_${i + 1}`,
    correct_option_id: 'a',
    marks: 5
  }));

  // 10 correct (50 marks), 4 wrong with 1 mark deduction per wrong answer (-4 marks) -> 46 marks
  const mixedResponses = [
    ...Array.from({ length: 10 }, (_, i) => ({ question_id: `q_${i + 1}`, selected_option_id: 'a' })),
    ...Array.from({ length: 4 }, (_, i) => ({ question_id: `q_${i + 11}`, selected_option_id: 'b' }))
  ];

  const result = calculateAssessmentScore({
    responses: mixedResponses,
    questions: dummyQuestions,
    marksPerQuestion: 5,
    negativeMarking: 1,
    totalMarks: 100,
    passMark: 30
  });

  assert.equal(result.correctCount, 10);
  assert.equal(result.wrongCount, 4);
  assert.equal(result.score, 46);
  assert.equal(result.isQualified, true);
});

test('Assessment scoring: bounds clamping (0 <= score <= 100)', () => {
  const dummyQuestions = Array.from({ length: 5 }, (_, i) => ({
    id: `q_${i + 1}`,
    correct_option_id: 'a',
    marks: 5
  }));

  // All wrong with negative marking 5 -> -25 raw, clamped to 0
  const allWrong = Array.from({ length: 5 }, (_, i) => ({
    question_id: `q_${i + 1}`,
    selected_option_id: 'c'
  }));

  const res = calculateAssessmentScore({
    responses: allWrong,
    questions: dummyQuestions,
    marksPerQuestion: 5,
    negativeMarking: 5,
    totalMarks: 25,
    passMark: 10
  });

  assert.equal(res.score, 0);
  assert.equal(res.isQualified, false);
});

test('Pricing: Winter ₹10,000 fee with 90% scholarship = ₹999 (99900 paise)', () => {
  const payable = payablePaise(WINTER_PRICE_PAISE, 90);
  assert.equal(payable, 99900); // 999.00 INR
  assert.equal(payablePaise(WINTER_PRICE_PAISE, 100), 0); // 100% full scholarship = ₹0
  // Legacy price 999900 paise preserved
  assert.equal(payablePaise(BASE_PRICE_PAISE, 90), 99990);
  assert.equal(payablePaise(BASE_PRICE_PAISE, 85), 149985);
});

test('Coupon 24-hour expiry lifecycle', () => {
  const issued = new Date('2026-12-01T10:00:00Z');
  const expires = new Date('2026-12-02T10:00:00Z').toISOString(); // exactly 24 hours

  const coupon = {
    code: 'WIN-ABC123',
    status: 'active',
    expires_at: expires
  };

  // 1 minute before expiry -> active
  const beforeExpiry = new Date('2026-12-02T09:59:00Z');
  assert.equal(couponState(coupon, beforeExpiry), 'active');

  // Exact expiry second -> expired
  const atExpiry = new Date('2026-12-02T10:00:00Z');
  assert.equal(couponState(coupon, atExpiry), 'expired');

  // After expiry -> expired
  const afterExpiry = new Date('2026-12-02T12:00:00Z');
  assert.equal(couponState(coupon, afterExpiry), 'expired');

  // Redeemed coupon stays redeemed even if not expired
  assert.equal(couponState({ ...coupon, status: 'redeemed' }, beforeExpiry), 'redeemed');
});

test('Coupon extension tracking: max 2 extensions allowed', () => {
  const activeCoupon0 = { status: 'active', extension_count: 0 };
  const activeCoupon1 = { status: 'active', extension_count: 1 };
  const activeCoupon2 = { status: 'active', extension_count: 2 };
  const redeemedCoupon = { status: 'redeemed', extension_count: 0 };

  assert.equal(canRequestExtension(activeCoupon0, 2), true);
  assert.equal(canRequestExtension(activeCoupon1, 2), true);
  assert.equal(canRequestExtension(activeCoupon2, 2), false); // limit reached
  assert.equal(canRequestExtension(redeemedCoupon, 2), false); // already redeemed
});

test('Coupon code generation format', () => {
  const code = makeCouponCode();
  assert.match(code, /^WIN-[A-F0-9]{6}$/);
});

test('Coupon email template formatting', () => {
  const student = { fullName: 'Aarav Sharma', email: 'aarav@example.edu', score: 85 };
  const coupon = {
    code: 'WIN-7F8E9D',
    discount_percent: 90,
    score_percent: 85,
    expires_at: new Date(Date.now() + 864e5).toISOString()
  };

  const html = buildCouponEmailHtml(student, coupon);
  const text = buildCouponEmailText(student, coupon);

  assert.ok(html.includes('WIN-7F8E9D'));
  assert.ok(html.includes('₹999'));
  assert.ok(html.includes('24 hours'));
  assert.ok(text.includes('WIN-7F8E9D'));
  assert.ok(text.includes('₹999'));
});

test('Partial attendance (< 30 passMark) computes exact attended/wrong counts and retains ₹999 cohort voucher pricing', () => {
  const dummyQuestions = Array.from({ length: 20 }, (_, i) => ({
    id: `q_${i + 1}`,
    correct_option_id: 'a',
    marks: 5
  }));

  // 5 questions attended: 3 correct (15 marks), 2 wrong (0 negative marking), 15 unanswered
  const partialResponses = [
    { question_id: 'q_1', selected_option_id: 'a' },
    { question_id: 'q_2', selected_option_id: 'a' },
    { question_id: 'q_3', selected_option_id: 'a' },
    { question_id: 'q_4', selected_option_id: 'b' },
    { question_id: 'q_5', selected_option_id: 'c' }
  ];

  const res = calculateAssessmentScore({
    responses: partialResponses,
    questions: dummyQuestions,
    marksPerQuestion: 5,
    negativeMarking: 0,
    totalMarks: 100,
    passMark: 30
  });

  assert.equal(partialResponses.length, 5);
  assert.equal(res.correctCount, 3);
  assert.equal(res.wrongCount, 2);
  assert.equal(res.score, 15);
  assert.equal(res.isQualified, false);
  // Cohort voucher calculation applies 90% subsidy -> ₹999 (99900 paise)
  assert.equal(payablePaise(WINTER_PRICE_PAISE, 90), 99900);
});


test('Winter 2026 scholarship tiers: 0-3 (0%-12%) -> ₹1,199, 4-24 (16%-96%) -> ₹999, 25 (100%) -> Free', () => {
  for (const c of [0, 1, 2, 3]) {
    assert.equal(winterTierFor(c, 25), 88, `${c}/25 should map to 88 tier (₹1,199)`);
  }
  for (const c of [4, 5, 12, 24]) {
    assert.equal(winterTierFor(c, 25), 90, `${c}/25 should map to 90 tier (₹999)`);
  }
  assert.equal(winterTierFor(25, 25), 100);

  // Legacy 20-question proportional check
  for (const c of [0, 1, 2]) {
    assert.equal(winterTierFor(c, 20), 88, `${c}/20 (0%-10%) should map to 88 tier (₹1,199)`);
  }
  for (const c of [3, 10, 19]) {
    assert.equal(winterTierFor(c, 20), 90, `${c}/20 (15%-95%) should map to 90 tier (₹999)`);
  }
  assert.equal(winterTierFor(20, 20), 100);

  assert.equal(payablePaise(999900, 88), 119900);
  assert.equal(winterPayablePaise({ discount_percent: 88 }), 119900);
});
