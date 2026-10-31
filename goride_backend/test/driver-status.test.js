const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (parent?.filename.endsWith('/services/driverService.js') && name === '../config/supabase') {
    return { supabase: { from() { throw Error('Must use request-scoped client'); } } };
  }
  return originalLoad.call(this, name, parent, isMain);
};
const service = require('../src/services/driverService');
Module._load = originalLoad;
function clientFor(result) {
  return { from(table) {
    assert.equal(table, 'drivers');
    return { select(columns) {
      assert.equal(columns, '*');
      return { eq(column, value) {
        assert.equal(column, 'user_id'); assert.equal(value, 'driver-test');
        return { maybeSingle: async () => result };
      } };
    } };
  } };
}
test('no verification row is a normal new-driver state', async () => {
  assert.equal(await service.getDriverByUserId('driver-test', clientFor({ data: null, error: null })), null);
});
test('existing driver status is preserved', async () => {
  const data = { status: 'approved', is_online: false };
  assert.deepEqual(await service.getDriverByUserId('driver-test', clientFor({ data, error: null })), data);
});
test('database errors are not disguised as missing documents', async () => {
  await assert.rejects(service.getDriverByUserId('driver-test', clientFor({ data: null, error: { message: 'Database unavailable' } })), /Database unavailable/);
});
