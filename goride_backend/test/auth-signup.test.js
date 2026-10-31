const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
let request;
let signupResult;
Module._load = function (name, parent, isMain) {
  if (parent?.filename.endsWith('/services/authService.js')) {
    if (name === '../config/supabase') return {
      supabase: { auth: { signUp: async (payload) => {
        request = payload;
        return signupResult;
      } } },
    };
    if (name === './storageService') return {};
  }
  return originalLoad.call(this, name, parent, isMain);
};
const service = require('../src/services/authService');
Module._load = originalLoad;

test('unconfirmed signup retains null session and uses public HTTPS redirect', async () => {
  signupResult = { data: { user: { id: 'test' }, session: null }, error: null };
  const result = await service.signup('test@example.com', 'test-password', 'Test', 'driver');
  assert.equal(result.session, null);
  assert.equal(request.options.emailRedirectTo, 'https://goride-phjs.onrender.com/');
  assert.equal(request.options.data.user_type, 'driver');
});

test('signup propagates provider error instead of authenticating', async () => {
  signupResult = { data: null, error: { message: 'Email rate limit exceeded' } };
  await assert.rejects(service.signup('test@example.com', 'test-password', 'Test'),
    /Email rate limit exceeded/);
});
