const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifySignature, amountToPaise, PaymentService } = require('../src/services/paymentService');
const secret = 'test-webhook-secret';
const raw = Buffer.from('{"event":"payment_link.paid"}');
const sign = bytes => crypto.createHmac('sha256', secret).update(bytes).digest('hex');
test('raw webhook signature rejects tampered, missing and malformed signatures', () => {
  assert.equal(verifySignature(raw, sign(raw), secret), true);
  assert.equal(verifySignature(Buffer.from('{}'), sign(raw), secret), false);
  for (const sig of [undefined, '', 'bad', '0'.repeat(64)]) assert.equal(verifySignature(raw, sig, secret), false);
});
test('amount validation uses paise, limits and disallows fractional paise', () => {
  assert.equal(amountToPaise(100), 10000);
  assert.equal(amountToPaise(10.25), 1025);
  for (const amount of ['100', NaN, Infinity, -1, 0, 10000.01, 1.001]) assert.throws(() => amountToPaise(amount));
});
test('unconfigured payments cannot create orders or credit wallets', async () => {
  const service = new PaymentService({ env: {}, db: null });
  await assert.rejects(service.createLink('user', 100), /not configured/);
  await assert.rejects(service.webhook(raw, sign(raw)), /not configured/);
});
const env = { PAYMENTS_ENABLED: 'true', RAZORPAY_KEY_ID: 'rzp_live_mock', RAZORPAY_KEY_SECRET: 'test', RAZORPAY_WEBHOOK_SECRET: secret };
function eventBody() {
  return Buffer.from(JSON.stringify({ event: 'payment_link.paid', payload: {
    payment_link: { entity: { id: 'plink_test' } }, payment: { entity: { id: 'pay_test' } },
  } }));
}
function serviceWith({ mismatch = false, captured = true } = {}) {
  let credits = 0;
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'order-test', amount_paise: 10000 }, error: null }) }) }) }),
    rpc: async (name, params) => {
      assert.equal(name, 'credit_verified_payment');
      assert.deepEqual(params, { p_link_id: 'plink_test', p_payment_id: 'pay_test' });
      credits++; return { error: null };
    },
  };
  const service = new PaymentService({ db, env, fetchImpl: async url => ({ ok: true, json: async () => url.includes('payment_links/')
    ? { status: 'paid', reference_id: 'order-test', currency: 'INR', amount: 10000, amount_paid: 10000, payments: [{ payment_id: 'pay_test' }] }
    : { status: captured ? 'captured' : 'authorized', currency: 'INR', amount: mismatch ? 5000 : 10000 } }) });
  return { service, credits: () => credits };
}
test('valid signature plus matching captured gateway payment reaches atomic credit', async () => {
  const { service, credits } = serviceWith(); const body = eventBody();
  await service.webhook(body, sign(body)); assert.equal(credits(), 1);
});
test('amount mismatch or merely authorized payment cannot credit balance', async () => {
  for (const options of [{ mismatch: true }, { captured: false }]) {
    const { service, credits } = serviceWith(options); const body = eventBody();
    await assert.rejects(service.webhook(body, sign(body)), /does not match/);
    assert.equal(credits(), 0);
  }
});
