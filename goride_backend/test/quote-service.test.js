const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const load = Module._load;
let saved;
Module._load = function (name, parent, isMain) {
  if (
    parent?.filename.endsWith("/services/quoteService.js") &&
    name === "../config/serviceClient"
  )
    return {
      getServiceClient: () => ({
        from: () => ({
          insert: (rows) => {
            saved = rows;
            return {
              select: async () => ({
                data: rows.map((r, i) => ({
                  id: `q-${i}`,
                  payload: r.payload,
                  expires_at: "later",
                })),
              }),
            };
          },
        }),
      }),
    };
  return load.call(this, name, parent, isMain);
};
const { quote } = require("../src/services/quoteService");
Module._load = load;
const input = {
  pickupLocation: "Connaught Place",
  dropLocation: "India Gate",
  pickupLatitude: 28.63,
  pickupLongitude: 77.22,
  dropLatitude: 28.61,
  dropLongitude: 77.23,
};
test("unconfigured routing is explicitly a straight-line estimate; all fares are server-derived", async () => {
  delete process.env.ROUTING_BASE_URL;
  const data = await quote("actor", { ...input, fare: 1 });
  assert.deepEqual(
    data.map((q) => q.category),
    ["Bike", "Auto", "Car"],
  );
  assert.ok(
    data.every(
      (q) =>
        q.routeSource === "straight_line_estimate" &&
        q.durationSeconds === null &&
        q.fare === q.baseFare + q.distanceFare &&
        q.fare > 1,
    ),
  );
  assert.ok(saved.every((q) => q.user_id === "actor"));
});
test("configured routing uses provider distance/duration with bounded timeout and no invented fallback on error", async () => {
  process.env.ROUTING_BASE_URL = "https://routing.example.test";
  let seen;
  const data = await quote(
    "actor",
    { ...input, category: "Bike" },
    async (url, options) => {
      seen = { url, options };
      return {
        ok: true,
        text: async () =>
          JSON.stringify({ routes: [{ distance: 4000, duration: 900 }] }),
      };
    },
  );
  assert.equal(data[0].fare, 60);
  assert.equal(data[0].routeSource, "road_route");
  assert.equal(data[0].durationSeconds, 900);
  assert.equal(seen.options.redirect, "error");
  assert.equal(seen.url.protocol, "https:");
  await assert.rejects(
    quote("actor", input, async () => {
      throw Error();
    }),
    /routing is temporarily unavailable/,
  );
  delete process.env.ROUTING_BASE_URL;
});
test("invalid coordinates, unsupported categories and outside operating-area requests fail before persistence", async () => {
  for (const request of [
    { ...input, pickupLatitude: NaN },
    { ...input, category: "Helicopter" },
    { ...input, pickupLatitude: 19.07 },
    { ...input, dropLatitude: 28.63, dropLongitude: 77.22 },
  ])
    await assert.rejects(quote("actor", request));
});
