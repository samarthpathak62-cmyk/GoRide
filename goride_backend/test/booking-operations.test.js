const test = require("node:test");
const assert = require("node:assert/strict");
const { database, ids } = require("./helpers/tripDatabase");
let db, id;
const payload = {
  pickupLocation: "Connaught Place",
  dropLocation: "India Gate",
  category: "Bike",
  fare: 100,
  baseFare: 20,
  distanceFare: 80,
  distanceMeters: 8000,
  pickupLatitude: 28.63,
  pickupLongitude: 77.22,
  dropLatitude: 28.61,
  dropLongitude: 77.23,
};
test.before(async () => {
  db = await database();
});
test.after(async () => await db?.close());
async function q(owner = ids.rider) {
  return (
    await db.query(
      "insert into fare_quotes(user_id,payload) values($1,$2) returning id",
      [owner, JSON.stringify(payload)],
    )
  ).rows[0].id;
}
async function book(quote, method = "cash", actor = ids.rider) {
  return (
    await db.query("select book_quoted_ride($1,$2,$3) as r", [
      actor,
      quote,
      method,
    ])
  ).rows[0].r;
}
async function claim() {
  const d = (
    await db.query("select id from drivers where user_id=$1", [ids.captain])
  ).rows[0].id;
  return (await db.query("select claim_ride_offers($1,$2) as r", [id, [d]]))
    .rows[0].r;
}
async function action(actor, act) {
  return db.query("select ride_action_secure($1,$2,$3)", [id, actor, act]);
}
async function start() {
  for (const [actor, a] of [
    [ids.captain, "accept"],
    [ids.rider, "confirm"],
    [ids.captain, "arrive"],
  ])
    await action(actor, a);
  await db.query("select issue_trip_pin($1,$2,$3,$4,false)", [
    id,
    ids.rider,
    "a".repeat(64),
    "sealed",
  ]);
  await db.query("select start_trip_with_pin($1,$2,$3)", [
    id,
    ids.captain,
    "a".repeat(64),
  ]);
}
async function settle(actor = ids.captain, collected = true) {
  return (
    await db.query("select settle_ride_v2($1,$2,$3) as r", [
      actor,
      id,
      collected,
    ])
  ).rows[0].r;
}
test("cash booking works with zero wallet funds; quote consumption is idempotent and account bound", async () => {
  await db.query("update profiles set wallet_balance=0 where id=$1", [
    ids.rider,
  ]);
  const quote = await q();
  const r = await book(quote);
  id = r.id;
  assert.equal(r.payment_method, "cash");
  assert.equal(r.fare, 100);
  assert.ok(r.matching_expires_at);
  assert.equal((await book(quote)).id, id);
  await assert.rejects(book(quote, "cash", ids.other), /Quote unavailable/);
  await assert.rejects(book(quote, "wallet"), /another payment method/);
  await assert.rejects(book(await q()), /Active trip/);
});
test("unoffered captains cannot accept; dispatch claims prevent duplicate offers", async () => {
  await assert.rejects(action(ids.captain, "accept"), /not offered/);
  assert.equal((await claim()).length, 1);
  assert.deepEqual(await claim(), []);
  await start();
});
test("cash completion requires confirmation and never manufactures wallet credit or bank transfer", async () => {
  await assert.rejects(settle(ids.other, true), /Assigned captain/);
  await assert.rejects(settle(ids.captain, false), /actually been collected/);
  assert.equal((await settle()).ride.payment_status, "cash_collected");
  assert.equal((await settle()).status, "already_completed");
  assert.equal(
    Number(
      (
        await db.query("select wallet_balance from profiles where id=$1", [
          ids.rider,
        ])
      ).rows[0].wallet_balance,
    ),
    0,
  );
  assert.equal(
    Number(
      (
        await db.query("select wallet_balance from profiles where id=$1", [
          ids.captain,
        ])
      ).rows[0].wallet_balance,
    ),
    1000,
  );
  const ledger = (
    await db.query("select * from captain_cash_ledger where ride_id=$1", [id])
  ).rows[0];
  assert.equal(Number(ledger.cash_received), 100);
  assert.equal(Number(ledger.commission_due), 20);
  assert.equal(Number(ledger.captain_net), 80);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from transactions where ride_id=$1",
        [id],
      )
    ).rows[0].n,
    0,
  );
});
test("wallet bookings still require funds, expired quotes fail and successful settlement debits exactly once", async () => {
  await assert.rejects(book(await q(), "wallet"), /Insufficient wallet/);
  const expired = await q();
  await db.query(
    "update fare_quotes set expires_at=now()-interval '1 second' where id=$1",
    [expired],
  );
  await assert.rejects(book(expired), /Quote expired/);
  await db.query("update profiles set wallet_balance=1000 where id=$1", [
    ids.rider,
  ]);
  id = (await book(await q(), "wallet")).id;
  await claim();
  await start();
  await settle();
  await settle();
  assert.equal(
    Number(
      (
        await db.query("select wallet_balance from profiles where id=$1", [
          ids.rider,
        ])
      ).rows[0].wallet_balance,
    ),
    900,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from transactions where ride_id=$1",
        [id],
      )
    ).rows[0].n,
    2,
  );
});
test("matching deadline is authoritative even if the worker is late; expiry is audited and releases active booking", async () => {
  id = (await book(await q())).id;
  await claim();
  await db.query(
    "update rides set matching_expires_at=now()-interval '1 second' where id=$1",
    [id],
  );
  await assert.rejects(
    action(ids.captain, "accept"),
    /Matching window expired/,
  );
  const result = (
    await db.query("select expire_ride_searches($1) as r", [ids.rider])
  ).rows[0].r;
  assert.equal(result[0].status, "cancelled");
  assert.equal(result[0].cancellation_reason, "no_captain");
  assert.equal(
    (
      await db.query(
        "select actor_type from ride_events where ride_id=$1 and action='matching_expired'",
        [id],
      )
    ).rows[0].actor_type,
    "system",
  );
  assert.deepEqual(
    (await db.query("select expire_ride_searches($1) as r", [ids.rider]))
      .rows[0].r,
    [],
  );
});
test("expired captain confirmation resets matching and invalidates the old offer", async () => {
  id = (await book(await q())).id;
  await claim();
  await action(ids.captain, "accept");
  await db.query(
    "update rides set offer_expires_at=now()-interval '1 second' where id=$1",
    [id],
  );
  await assert.rejects(
    action(ids.rider, "confirm"),
    /confirmation window expired/,
  );
  await db.query("select expire_ride_searches($1)", [ids.rider]);
  assert.equal(
    (await db.query("select status from rides where id=$1", [id])).rows[0]
      .status,
    "pending",
  );
  await assert.rejects(action(ids.captain, "accept"), /not offered/);
});
test("quote, cash, support, safety and share tables and RPCs are not public/client writable", async () => {
  for (const role of ["anon", "authenticated"]) {
    for (const table of [
      "fare_quotes",
      "captain_cash_ledger",
      "support_tickets",
      "safety_alerts",
      "trip_share_links",
      "ride_dispatch_offers",
    ])
      assert.equal(
        (
          await db.query("select has_table_privilege($1,$2,'select') as a", [
            role,
            table,
          ])
        ).rows[0].a,
        false,
      );
    for (const fn of [
      "book_quoted_ride(uuid,uuid,text)",
      "settle_ride_v2(uuid,uuid,boolean)",
      "expire_ride_searches(uuid)",
      "claim_ride_offers(uuid,uuid[])",
    ])
      assert.equal(
        (
          await db.query(
            "select has_function_privilege($1,$2,'execute') as a",
            [role, fn],
          )
        ).rows[0].a,
        false,
      );
  }
});
