const crypto = require('node:crypto');
const AppError = require('../utils/AppError');

function verifySignature(raw, signature, secret) {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
function amountToPaise(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new AppError('Invalid amount', 400);
  const paise = Math.round(amount * 100);
  if (!Number.isSafeInteger(paise) || Math.abs(amount * 100 - paise) > 0.000001 || paise < 100 || paise > 1000000) {
    throw new AppError('Enter INR 1 to 10,000, with at most two decimal places', 400);
  }
  return paise;
}
class PaymentService {
  constructor({ db, env = process.env, fetchImpl = fetch } = {}) {
    this.db = db; this.env = env; this.fetch = fetchImpl;
  }
  get mode() { return this.env.PAYMENT_MODE || 'live'; }
  requireConfig() {
    if (this.env.PAYMENTS_ENABLED !== 'true' || !this.db || !this.env.RAZORPAY_KEY_ID || !this.env.RAZORPAY_KEY_SECRET || !this.env.RAZORPAY_WEBHOOK_SECRET || !['live','test'].includes(this.mode) || !this.env.RAZORPAY_KEY_ID.startsWith(this.mode==='test'?'rzp_test_':'rzp_live_')) {
      throw new AppError('Online payments are not configured yet. No money has been added.', 503);
    }
  }
  async gateway(path, method = 'GET', body) {
    const response = await this.fetch(`https://api.razorpay.com/v1/${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.env.RAZORPAY_KEY_ID}:${this.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new AppError('Payment provider unavailable. Please try again later.', 502);
    return response.json();
  }
  async createLink(userId, amount) {
    this.requireConfig();
    const paise = amountToPaise(amount);
    const { data: order, error } = await this.db.from('payment_orders')
      .insert({ user_id: userId, amount_paise: paise, mode: this.mode }).select().single();
    if (error) throw new AppError('Could not create payment order', 500);
    const link = await this.gateway('payment_links', 'POST', {
      amount: paise, currency: 'INR', accept_partial: false, reference_id: order.id,
      description: this.mode==='test'?'GoRide TEST payment — no real wallet credit':'GoRide wallet top-up', expire_by: Math.floor(Date.now() / 1000) + 1800,
    });
    const url = new URL(link.short_url);
    if (url.protocol !== 'https:' || !['rzp.io', 'rzp.pay', 'razorpay.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
      throw new AppError('Invalid payment checkout URL', 502);
    }
    const { error: saveError } = await this.db.from('payment_orders').update({ gateway_link_id: link.id }).eq('id', order.id);
    if (saveError) throw new AppError('Could not save payment order', 500);
    return { checkoutUrl: url.toString(), orderId: order.id, mode:this.mode, notice:this.mode==='test'?'TEST ONLY. No real money or spendable wallet credit.':'Wallet credits only after verified payment.' };
  }
  async webhook(raw, signature) {
    this.requireConfig();
    if (!Buffer.isBuffer(raw) || !verifySignature(raw, signature, this.env.RAZORPAY_WEBHOOK_SECRET)) {
      throw new AppError('Invalid payment signature', 400);
    }
    const event = JSON.parse(raw.toString('utf8'));
    if (event.event !== 'payment_link.paid') return;
    const linkId = event.payload?.payment_link?.entity?.id;
    const paymentId = event.payload?.payment?.entity?.id;
    if (!/^plink_[a-zA-Z0-9]+$/.test(linkId || '') || !/^pay_[a-zA-Z0-9]+$/.test(paymentId || '')) throw new AppError('Invalid payment event', 400);
    const { data: order, error } = await this.db.from('payment_orders').select('*').eq('gateway_link_id', linkId).single();
    if (error || !order) throw new AppError('Payment order not available; retry webhook', 503);
    if((order.mode||'live')!==this.mode)throw new AppError('Payment mode does not match order',400);
    // A signed event alone is not sufficient: confirm captured funds with the provider.
    const link = await this.gateway(`payment_links/${linkId}`);
    const payment = await this.gateway(`payments/${paymentId}`);
    if ((typeof payment.live==='boolean' && payment.live!==(this.mode==='live')) || link.status !== 'paid' || link.reference_id !== order.id || link.currency !== 'INR' ||
        link.amount !== Number(order.amount_paise) || link.amount_paid !== Number(order.amount_paise) ||
        !link.payments?.some(p => p.payment_id === paymentId) ||
        payment.status !== 'captured' || payment.currency !== 'INR' || payment.amount !== Number(order.amount_paise)) {
      throw new AppError('Payment does not match wallet order', 400);
    }
    const { error: creditError } = await this.db.rpc(this.mode==='test'?'credit_verified_test_payment':'credit_verified_payment', { p_link_id: linkId, p_payment_id: paymentId });
    if (creditError) throw new AppError('Wallet credit failed; retry webhook', 503);
  }
}
module.exports = { PaymentService, verifySignature, amountToPaise };
