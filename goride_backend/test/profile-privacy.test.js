const test = require("node:test");
const assert = require("node:assert/strict");
const { database, ids } = require("./helpers/tripDatabase");
let db;
test.before(async () => {
  db = await database();
  await db.query(
    "insert into transactions(user_id,amount,type) values($1,10,'credit'),($2,20,'credit')",
    [ids.rider, ids.other],
  );
});
test.after(async () => await db?.close());
async function asRider(fn) {
  await db.exec(
    `set role authenticated;set request.jwt.claim.sub='${ids.rider}'`,
  );
  try {
    await fn();
  } finally {
    await db.exec("reset role");
  }
}
test("RLS exposes only own profile and transactions", async () => {
  await asRider(async () => {
    const rows = (await db.query("select id from profiles")).rows;
    assert.deepEqual(
      rows.map((r) => r.id),
      [ids.rider],
    );
    assert.deepEqual(
      (await db.query("select user_id from transactions")).rows.map(
        (r) => r.user_id,
      ),
      [ids.rider],
    );
  });
});
test("client cannot manufacture wallet credits, transfer ownership or edit ledger", async () => {
  await asRider(async () => {
    for (const sql of [
      "update profiles set wallet_balance=999999",
      `update profiles set id='${ids.other}'`,
      "insert into transactions(user_id,amount) values('" +
        ids.rider +
        "',99999)",
      "delete from transactions",
    ])
      await assert.rejects(db.exec(sql), /permission denied/);
  });
});
test("own display-name/device-token edits work, cross-account edits affect no rows", async () => {
  await asRider(async () => {
    await db.query("update profiles set full_name=$1 where id=$2", [
      "Own name",
      ids.rider,
    ]);
    const result = await db.query(
      "update profiles set full_name=$1 where id=$2 returning id",
      ["Hijack", ids.other],
    );
    assert.equal(result.rows.length, 0);
    assert.equal(
      (
        await db.query("select full_name from profiles where id=$1", [
          ids.rider,
        ])
      ).rows[0].full_name,
      "Own name",
    );
  });
});
test("anonymous role cannot read profiles or financial records", async () => {
  await db.exec("set role anon");
  try {
    await assert.rejects(
      db.query("select * from profiles"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from transactions"),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
});

test("legacy payout cannot debit or fabricate wallet credit for any API role", async () => {
  for (const role of ["anon", "authenticated", "service_role"])
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'request_payout(uuid,numeric)','execute') as allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  await assert.rejects(
    db.query("select request_payout($1,-9999)", [ids.rider]),
    /not configured/,
  );
  assert.equal(
    Number(
      (
        await db.query("select wallet_balance from profiles where id=$1", [
          ids.rider,
        ])
      ).rows[0].wallet_balance,
    ),
    1000,
  );
});
