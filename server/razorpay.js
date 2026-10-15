import crypto from 'node:crypto';
const BASE = 'https://api.razorpay.com/v1';
const authH = () => 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
async function rz(path, opts = {}) {
  const r = await fetch(BASE + path, { ...opts, headers: { Authorization: authH(), 'Content-Type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.description || 'Razorpay error'), { status: 502 });
  return j;
}
export const createOrder = ({ amount, receipt, notes }) => rz('/orders', { method: 'POST', body: JSON.stringify({ amount, currency: 'INR', receipt, notes }) });
export const fetchPayment = id => rz('/payments/' + encodeURIComponent(id));
const safeEq = (a, b) => { const x = Buffer.from(String(a || ''), 'hex'), y = Buffer.from(String(b || ''), 'hex'); return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y); };
export const verifySignature = (orderId, paymentId, sig, secret) => !!secret && safeEq(crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex'), sig);
export const verifyWebhook = (raw, sig, secret) => !!secret && !!raw && safeEq(crypto.createHmac('sha256', secret).update(raw).digest('hex'), sig);
