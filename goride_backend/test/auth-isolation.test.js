const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const original = Module._load;
let created = 0;
Module._load = function (name, parent, isMain) {
  if (
    parent?.filename.endsWith("/services/authService.js") &&
    name === "../config/supabase"
  )
    return {
      supabase: {
        auth: {
          signInWithPassword: () => {
            throw Error("Shared client must not be used");
          },
        },
      },
      createAuthClient: () => {
        created++;
        let user;
        return {
          auth: {
            signInWithPassword: async ({ email }) => {
              user = {
                id: email,
                email_confirmed_at: "verified",
                user_metadata: { user_type: "rider" },
              };
              await new Promise((r) => setImmediate(r));
              return {
                data: { user, session: { access_token: email } },
                error: null,
              };
            },
            mfa: { listFactors: async () => ({ data: { all: [] } }) },
          },
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { full_name: user.id } }),
              }),
            }),
          }),
        };
      },
      getScopedClient: async (token) => ({
        auth: { getUser: async () => ({ data: { user: { id: token } } }) },
        from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    };
  return original.call(this, name, parent, isMain);
};
const auth = require("../src/services/authService");
Module._load = original;
test("concurrent logins use independent auth clients and cannot exchange user/profile identity", async () => {
  const [a, b] = await Promise.all([
    auth.login("a@example.com", "password", "rider"),
    auth.login("b@example.com", "password", "rider"),
  ]);
  assert.equal(created, 2);
  assert.equal(a.user.id, "a@example.com");
  assert.equal(a.user.user_metadata.full_name, "a@example.com");
  assert.equal(b.user.id, "b@example.com");
  assert.equal(b.user.user_metadata.full_name, "b@example.com");
});
test("device registration verifies token identity even if called with a forged account ID", async () => {
  await assert.rejects(
    auth.updateFcmToken("actual-user", "other-user", "device-token"),
    /Session expired/,
  );
  assert.deepEqual(
    await auth.updateFcmToken("actual-user", "actual-user", "device-token"),
    { updated: true },
  );
});
