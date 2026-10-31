const test = require("node:test");
const assert = require("node:assert/strict");
process.env.TRIP_PIN_SECRET = "test-only-root-".repeat(4);
const { digest, seal, open } = require("../src/services/tripPinService");
test("PIN digests are ride-bound, keyed, case-normalised and never contain the PIN", () => {
  const d = digest("RIDE", "0123");
  assert.equal(d.length, 64);
  assert.equal(d, digest("ride", "0123"));
  assert.notEqual(d, digest("other", "0123"));
  assert.notEqual(d, digest("ride", "0124"));
});
test("encrypted PIN can be recovered only in its authenticated trip context", () => {
  const v = seal("0123", "trip:passenger:captain");
  assert.equal(open(v, "trip:passenger:captain"), "0123");
  assert.notEqual(v, seal("0123", "trip:passenger:captain"));
  assert.throws(() => open(v, "another-trip"), /cannot be recovered/);
  const parts = v.split(".");
  parts[2] = Buffer.alloc(16).toString("base64url");
  assert.throws(
    () => open(parts.join("."), "trip:passenger:captain"),
    /cannot be recovered/,
  );
});
