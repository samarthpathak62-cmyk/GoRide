const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../src/controllers/walletController');
test('wallet balance uses validated session identity, never the supplied query ID', async () => {
  let result;
  const req = { user: { id: 'signed-in-user' }, query: { userId: 'victim' },
    supabase: { from: () => ({ select: () => ({ eq: (key, value) => {
      assert.equal(key, 'id'); assert.equal(value, 'signed-in-user');
      return { single: async () => ({ data: { wallet_balance: 100 }, error: null }) };
    } }) }) },
  };
  await controller.getBalance(req, { json: data => { result = data; } }, error => { throw error; });
  assert.deepEqual(result, { wallet_balance: 100 });
});
test('unconfigured payout never pretends that a ledger debit is a bank transfer', async () => {
  let status; let message;
  await controller.payout({}, { status: code => { status = code; return { json: body => { message = body.message; } }; } });
  assert.equal(status, 503); assert.match(message, /not been deducted/);
});
