const test = require("node:test");
const assert = require("node:assert/strict");
const { database, ids, trip } = require("./helpers/tripDatabase");
let db, id;
const good = "a".repeat(64),
  bad = "b".repeat(64),
  sealed = "opaque-server-encrypted-value";
test.before(async () => {
  db = await database();
  id = await trip(db);
});
test.after(async () => {
  await db?.close();
});
async function issue(actor = ids.rider, rotate = false, hash = good) {
  return (
    await db.query("select issue_trip_pin($1,$2,$3,$4,$5) as p", [
      id,
      actor,
      hash,
      sealed,
      rotate,
    ])
  ).rows[0].p;
}
async function start(actor = ids.captain, hash = good) {
  return (
    await db.query("select start_trip_with_pin($1,$2,$3) as p", [
      id,
      actor,
      hash,
    ])
  ).rows[0].p;
}
test("only passenger can retrieve a PIN; only assigned captain can try it", async () => {
  assert.equal((await issue(ids.captain)).code, "ACCESS_DENIED");
  assert.equal((await issue(ids.other)).code, "ACCESS_DENIED");
  assert.equal((await start()).code, "PIN_REQUIRED");
  const p = await issue();
  assert.equal(p.sealed, sealed);
  assert.equal(p.attemptsRemaining, 5);
  assert.equal((await start(ids.other)).code, "ACCESS_DENIED");
  assert.equal((await start(ids.rider)).code, "ACCESS_DENIED");
});
test("PIN refresh is idempotent; immediate replacement is rate limited", async () => {
  const p = await issue(),
    same = await issue();
  assert.equal(p.expiresAt, same.expiresAt);
  assert.equal((await issue(ids.rider, true)).code, "PIN_COOLDOWN");
});
test("wrong attempts commit across calls; five attempts lock even the correct code", async () => {
  for (let i = 1; i <= 5; i++) {
    const p = await start(ids.captain, bad);
    assert.equal(p.code, i === 5 ? "PIN_LOCKED" : "PIN_INVALID");
    assert.equal(p.attemptsRemaining, 5 - i);
  }
  assert.equal((await start()).code, "PIN_LOCKED");
  assert.equal((await issue()).code, "PIN_LOCKED");
  assert.equal(
    (
      await db.query("select failures from trip_start_pins where ride_id=$1", [
        id,
      ])
    ).rows[0].failures,
    5,
  );
  assert.equal(
    (await db.query("select status from rides where id=$1", [id])).rows[0]
      .status,
    "driver_arrived",
  );
});
test("only rider can replace a locked PIN after cooldown; old code stops working", async () => {
  await db.query(
    "update trip_start_pins set issued_at=now()-interval '61 seconds' where ride_id=$1",
    [id],
  );
  assert.equal((await issue(ids.rider, true, bad)).attemptsRemaining, 5);
  assert.equal((await start(ids.captain, good)).code, "PIN_INVALID");
});
test("expiry blocks start without consuming a successful attempt", async () => {
  await db.query(
    "update trip_start_pins set expires_at=now()-interval '1 second',issued_at=now()-interval '61 seconds' where ride_id=$1",
    [id],
  );
  assert.equal((await start(ids.captain, bad)).code, "PIN_EXPIRED");
  assert.equal((await issue(ids.rider, true, good)).attemptsRemaining, 5);
});
test("PIN start is atomic and idempotent, adds one event, then cannot issue again", async () => {
  assert.equal((await start()).status, "success");
  assert.equal((await start()).status, "already_started");
  assert.equal((await issue()).code, "TRIP_NOT_READY");
  const r = (
    await db.query("select status,started_at from rides where id=$1", [id])
  ).rows[0];
  assert.equal(r.status, "started");
  assert.ok(r.started_at);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from ride_events where ride_id=$1 and action='start_with_pin'",
        [id],
      )
    ).rows[0].n,
    1,
  );
});
test("old RPC start and direct PIN/core access cannot bypass verification", async () => {
  await assert.rejects(
    db.query("select ride_action_secure($1,$2,'start')", [id, ids.captain]),
    /PIN verification/,
  );
  for (const role of ["anon", "authenticated", "service_role"])
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'ride_action_core(uuid,uuid,text)','execute') as allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  for (const role of ["anon", "authenticated"]) {
    assert.equal(
      (
        await db.query(
          "select has_table_privilege($1,'trip_start_pins','select') as allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
    for (const f of [
      "issue_trip_pin(uuid,uuid,text,text,boolean)",
      "start_trip_with_pin(uuid,uuid,text)",
    ])
      assert.equal(
        (
          await db.query(
            "select has_function_privilege($1,$2,'execute') as allowed",
            [role, f],
          )
        ).rows[0].allowed,
        false,
      );
  }
});
