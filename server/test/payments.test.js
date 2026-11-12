import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifySignature, verifyWebhook } from '../razorpay.js';
import { payablePaise } from '../logic.js';
import { buildReceiptPDF, receiptId } from '../receipt.js';
import { buildOfferPDF, offerId } from '../offer.js';
import { buildEnrollmentReceiptEmailHtml, buildEnrollmentReceiptEmailText } from '../email.js';

const h = (k, m) => crypto.createHmac('sha256', k).update(m).digest('hex');

test('checkout signature verification', () => {
  const secret = 'rzp_test_secret_key_123';
  const orderId = 'order_test_1001';
  const paymentId = 'pay_test_5001';
  const validSig = h(secret, `${orderId}|${paymentId}`);

  assert.equal(verifySignature(orderId, paymentId, validSig, secret), true);
  assert.equal(verifySignature(orderId, 'pay_diff_9999', validSig, secret), false);
  assert.equal(verifySignature(orderId, paymentId, validSig, 'wrong_secret'), false);
  assert.equal(verifySignature(orderId, paymentId, 'invalid_sig', secret), false);
  assert.equal(verifySignature(orderId, paymentId, validSig, undefined), false);
  assert.equal(verifySignature(orderId, paymentId, undefined, secret), false);
});

test('webhook signature verification', () => {
  const webhookSecret = 'whsec_pgi_winter_live_888';
  const rawPayload = Buffer.from(JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_capture_999',
          order_id: 'order_test_1001',
          amount: 99900,
          currency: 'INR',
          status: 'captured'
        }
      }
    }
  }));

  const validHeader = h(webhookSecret, rawPayload);
  assert.equal(verifyWebhook(rawPayload, validHeader, webhookSecret), true);
  assert.equal(verifyWebhook(Buffer.from('{"tampered":true}'), validHeader, webhookSecret), false);
  assert.equal(verifyWebhook(rawPayload, 'wrong_header', webhookSecret), false);
  assert.equal(verifyWebhook(rawPayload, undefined, webhookSecret), false);
});

test('pricing: base fee ₹10,000 (1000000 paise) with 90% scholarship yields exactly ₹999 (99900 paise)', () => {
  const basePaise = 1000000; // ₹10,000
  const discountPercent = 90; // 90% Merit grant
  const payable = payablePaise(basePaise, discountPercent);
  assert.equal(payable, 99900); // Exactly ₹999.00
});

test('pricing: base fee ₹10,000 (1000000 paise) with 88% foundation scholarship yields exactly ₹1,199 (119900 paise)', () => {
  const basePaise = 1000000;
  const discountPercent = 88;
  const payable = payablePaise(basePaise, discountPercent);
  assert.equal(payable, 119900);
});

test('receipt ID format generator', () => {
  const r1 = receiptId(null, 'REC-PGI-W26-0042');
  assert.equal(r1, 'REC-PGI-W26-0042');

  const r2 = receiptId('a1b2c3d4-e5f6-7890-1234-567890abcdef');
  assert.match(r2, /^REC-PGI-W26-[0-9A-Z]{6}$/);
});

test('official payment receipt PDF buffer generation', async () => {
  const pdfBuffer = await buildReceiptPDF({
    studentId: 'PGI-S26-0042',
    receiptNo: 'REC-PGI-W26-0042',
    name: 'Aarav Sharma',
    email: 'aarav@example.com',
    phone: '9876543210',
    courseTitle: 'Full-Stack Web Development Track',
    duration: '30 Hours',
    amountPaise: 99900,
    transactionRef: 'pay_rzp_mock_12345',
    paidAt: new Date().toISOString()
  });

  assert.ok(pdfBuffer instanceof Buffer);
  assert.ok(pdfBuffer.length > 1000, 'PDF buffer must contain binary document content');
  // Standard PDF magic byte header check: %PDF-1.
  assert.equal(pdfBuffer.subarray(0, 5).toString('ascii'), '%PDF-');
});

test('enrollment and receipt email templates render student ID, temporary credentials, and transaction breakdown', () => {
  const params = {
    studentName: 'Aarav Sharma',
    studentId: 'PGI-S26-0042',
    email: 'aarav@example.com',
    password: 'PGI-TEMP-PASS!26',
    courseTitle: 'Full-Stack Web Development Track',
    duration: '30 Hours',
    receiptNo: 'REC-PGI-W26-0042',
    transactionRef: 'pay_test_rzp_8989',
    enrollmentId: 'enr_test_mock_123'
  };

  const html = buildEnrollmentReceiptEmailHtml(params);
  const text = buildEnrollmentReceiptEmailText(params);

  // Assert essential fields in HTML
  assert.ok(html.includes('PGI-S26-0042'), 'HTML must contain Student ID');
  assert.ok(html.includes('REC-PGI-W26-0042'), 'HTML must contain Receipt Number');
  assert.ok(html.includes('pay_test_rzp_8989'), 'HTML must contain Razorpay Transaction ID');
  assert.ok(html.includes('PGI-TEMP-PASS!26'), 'HTML must contain Temporary Password');
  assert.ok(html.includes('₹10,000'), 'HTML must contain base fee ₹10,000');
  assert.ok(html.includes('9,001'), 'HTML must contain scholarship discount');
  assert.ok(html.includes('₹999.00'), 'HTML must contain net payable ₹999');

  // Assert essential fields in plain text
  assert.ok(text.includes('PGI-S26-0042'), 'Text must contain Student ID');
  assert.ok(text.includes('PGI-TEMP-PASS!26'), 'Text must contain Temporary Password');
  assert.ok(text.includes('REC-PGI-W26-0042'), 'Text must contain Receipt Number');
  assert.ok(text.includes('pay_test_rzp_8989'), 'Text must contain Transaction Reference');
});

test('idempotent order state transition logic prevents double enrollment', () => {
  // Simulate an order store
  const orderStore = new Map();
  orderStore.set('ord_test_1', {
    id: 'ord_test_1',
    status: 'created',
    amount_paise: 99900,
    user_id: 'user_1'
  });

  // Atomic transition helper simulating DB CAS condition: update ... where id = ? and status in ('created', 'cancelled')
  function claimOrder(orderId, paymentId) {
    const o = orderStore.get(orderId);
    if (!o) return null;
    if (['created', 'cancelled'].includes(o.status)) {
      o.status = 'paid';
      o.razorpay_payment_id = paymentId;
      o.paid_at = new Date().toISOString();
      return o;
    }
    return null; // Already claimed/paid
  }

  // First caller (e.g. client verification) claims successfully
  const firstClaim = claimOrder('ord_test_1', 'pay_first_123');
  assert.ok(firstClaim, 'First attempt must successfully claim the order');
  assert.equal(firstClaim.status, 'paid');
  assert.equal(firstClaim.razorpay_payment_id, 'pay_first_123');

  // Second simultaneous or retry caller (e.g. webhook) tries to claim
  const secondClaim = claimOrder('ord_test_1', 'pay_second_456');
  assert.equal(secondClaim, null, 'Second attempt must be rejected by CAS lock to prevent duplicate enrollment');
  assert.equal(orderStore.get('ord_test_1').razorpay_payment_id, 'pay_first_123', 'Payment ID remains immutable');
});


test('Winter 2026 remittance pricing: default ₹9,999 without coupon vs ₹1,199 / ₹999 with coupon', async () => {
  const { winterPayablePaise, payablePaise } = await import('../logic.js');

  assert.equal(winterPayablePaise(null), 999900);
  assert.equal(winterPayablePaise(undefined), 999900);
  assert.equal(winterPayablePaise({ discount_percent: 88 }), 119900);
  assert.equal(winterPayablePaise({ discount_percent: 85 }), 119900);
  assert.equal(winterPayablePaise({ discount_percent: 90 }), 99900);
  assert.equal(winterPayablePaise({ discount_percent: 100 }), 99900);
  assert.equal(payablePaise(999900, 88), 119900);
});


test('payment receipt PDF builds cleanly across ₹9,999, ₹1,199, ₹999, and ₹1 test amounts', async () => {
  for (const [amountPaise, couponCode] of [
    [999900, null],
    [119900, 'WIN-LOW123'],
    [99900, 'WIN-MID456'],
    [100, 'PGITEST1']
  ]) {
    const pdfBuffer = await buildReceiptPDF({
      studentId: 'PGI-S26-TEST',
      receiptNo: 'REC-PGI-W26-TEST',
      name: 'Test Candidate',
      email: 'test@example.com',
      phone: '+918220699083',
      course: 'Full-Stack Web Development',
      duration: '30 Hours',
      couponCode,
      amountPaise,
      transactionRef: 'pay_test_123',
      paidAt: new Date().toISOString()
    });
    assert.ok(pdfBuffer instanceof Buffer);
    assert.equal(pdfBuffer.subarray(0, 5).toString('ascii'), '%PDF-');
  }
});

test('1-page offer letter PDF builds cleanly matching official template fields', async () => {
  const id = offerId('PGI-S26-1002');
  assert.match(id, /^PGI-OL-[A-Z0-9]+$/);
  const pdfBuffer = await buildOfferPDF({
    name: 'Dhakshana Moorthy',
    address: 'No. 42, Anna Salai, Teynampet, Chennai - 600018',
    email: 'dhakshana@example.com',
    phone: '9876543210',
    domain: 'Digital Operations & Agile Management',
    mode: 'Offline',
    duration: '30 hours',
    enrollmentId: 'PGI-S26-1002',
    enrolledAt: '2026-11-12T06:00:00Z'
  });
  assert.ok(pdfBuffer instanceof Buffer);
  assert.equal(pdfBuffer.subarray(0, 5).toString('ascii'), '%PDF-');
  const raw = pdfBuffer.toString('latin1');
  const pageCount = (raw.match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
  assert.equal(pageCount, 1, `Expected 1 page, got ${pageCount}`);
});
