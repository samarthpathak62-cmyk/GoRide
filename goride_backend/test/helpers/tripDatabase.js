const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../../../supabase");
const ids = {
  rider: "11111111-1111-4111-8111-111111111111",
  captain: "22222222-2222-4222-8222-222222222222",
  other: "33333333-3333-4333-8333-333333333333",
};
async function database() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema extensions;create domain extensions.geography as text;create domain public.geography as text;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 `);
  let tables = fs.readFileSync(
    path.join(root, "tables/all_tables.sql"),
    "utf8",
  );
  tables = tables
    .slice(0, tables.indexOf("CREATE EXTENSION"))
    .replace(/GEOGRAPHY\(POINT, 4326\)/g, "public.geography")
    .replace(/^CREATE INDEX.*USING GIST.*$/gm, "");
  await db.exec(tables);
  await db.exec(
    "alter table rides add category text;alter table drivers add operationally_enabled boolean default false;",
  );
  for (const file of [
    "functions/complete_ride_transaction.sql",
    "functions/get_nearby_drivers.sql",
    "functions/get_user_conversations.sql",
    ...[
      "006_secure_ride_lifecycle",
      "007_ride_access_cutover",
      "008_trip_start_pin",
      "009_trip_pin_cutover",
      "010_profile_privacy",
      "011_disable_legacy_payout",
      "012_profile_photos",
    ].map((n) => `migrations/202610310${n}.sql`),
  ])
    await db.exec(fs.readFileSync(path.join(root, file), "utf8"));
  for (const id of Object.values(ids)) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query("insert into profiles(id,wallet_balance) values($1,1000)", [
      id,
    ]);
  }
  await db.query(
    "insert into drivers(user_id,status,is_online,operationally_enabled,vehicle_type) values($1,'approved',true,true,'Bike')",
    [ids.captain],
  );
  return db;
}
async function trip(db) {
  const payload = {
    pickupLocation: "Connaught Place",
    dropLocation: "India Gate",
    category: "Bike",
    fare: 100,
    pickupLatitude: 28.63,
    pickupLongitude: 77.22,
    dropLatitude: 28.61,
    dropLongitude: 77.23,
    pickupCoords: "POINT(77.22 28.63)",
    dropCoords: "POINT(77.23 28.61)",
  };
  const id = (
    await db.query("select request_ride_secure($1,$2) as r", [
      ids.rider,
      JSON.stringify(payload),
    ])
  ).rows[0].r.id;
  for (const [actor, action] of [
    [ids.captain, "accept"],
    [ids.rider, "confirm"],
    [ids.captain, "arrive"],
  ])
    await db.query("select ride_action_secure($1,$2,$3)", [id, actor, action]);
  return id;
}
module.exports = { database, ids, trip };
