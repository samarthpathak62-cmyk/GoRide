const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../../supabase');
const RIDER='11111111-1111-4111-8111-111111111111',CAPTAIN='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333';
let db;
test.before(async()=>{
 db=new PGlite();
 // Spatial operations are NOT exercised here. Geography is a text domain fixture;
 // lifecycle PL/pgSQL, transactions, permissions and balances run in PostgreSQL.
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);
 create schema extensions;create domain extensions.geography as text;
 create domain public.geography as text;`);
 let tables=fs.readFileSync(path.join(root,'tables/all_tables.sql'),'utf8');
 tables=tables.slice(0,tables.indexOf('CREATE EXTENSION')).replace(/GEOGRAPHY\(POINT, 4326\)/g,'public.geography').replace(/^CREATE INDEX.*USING GIST.*$/gm,'');
 await db.exec(tables);
 await db.exec(`alter table public.rides add category text;alter table public.drivers add operationally_enabled boolean default false;`);
 await db.exec(fs.readFileSync(path.join(root,'functions/complete_ride_transaction.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'migrations/202610310006_secure_ride_lifecycle.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'migrations/202610310007_ride_access_cutover.sql'),'utf8'));
 await db.exec(`insert into auth.users values('${RIDER}'),('${CAPTAIN}'),('${OTHER}');insert into profiles(id,wallet_balance) values('${RIDER}',1000),('${CAPTAIN}',0),('${OTHER}',1000);
 insert into drivers(user_id,status,is_online,operationally_enabled,vehicle_type) values('${CAPTAIN}','approved',true,true,'Bike');`);
});
test.after(async()=>{if(db)await db.close();});
let trip;
const payload={pickupLocation:'Connaught Place',dropLocation:'India Gate',category:'Bike',fare:100,pickupLatitude:28.63,pickupLongitude:77.22,dropLatitude:28.61,dropLongitude:77.23,pickupCoords:'POINT(77.22 28.63)',dropCoords:'POINT(77.23 28.61)'};
async function action(who,event,id=trip){return(await db.query('select ride_action_secure($1,$2,$3) as result',[id,who,event])).rows[0].result;}
test('secure request creates one active ride and prevents duplicate booking',async()=>{
 trip=(await db.query('select request_ride_secure($1,$2) as ride',[RIDER,JSON.stringify(payload)])).rows[0].ride.id;
 await assert.rejects(db.query('select request_ride_secure($1,$2)',[RIDER,JSON.stringify(payload)]),/active ride/);
});
test('unrelated actor cannot cancel, confirm, start or complete another passenger trip',async()=>{
 for(const event of ['cancel','confirm','start','complete'])await assert.rejects(action(OTHER,event),/participant|passenger|captain/);
 assert.equal((await db.query('select status from rides where id=$1',[trip])).rows[0].status,'pending');
});
test('only the passenger confirms and captain cannot skip arrival/start state',async()=>{
 await action(CAPTAIN,'accept');await assert.rejects(action(CAPTAIN,'confirm'),/passenger/);
 await assert.rejects(action(CAPTAIN,'start'),/state/);
 await action(RIDER,'confirm');await assert.rejects(action(CAPTAIN,'complete'),/state/);
 await action(CAPTAIN,'arrive');await action(CAPTAIN,'start');await assert.rejects(action(RIDER,'cancel'),/cannot be cancelled/);
});
test('completion settles once; retry is idempotent and produces exactly two ledger entries',async()=>{
 assert.equal((await action(CAPTAIN,'complete')).status,'success');
 assert.equal((await action(CAPTAIN,'complete')).status,'already_completed');
 const balances=(await db.query('select id,wallet_balance::float8 as balance from profiles order by id')).rows;
 assert.equal(balances.find(r=>r.id===RIDER).balance,900);assert.equal(balances.find(r=>r.id===CAPTAIN).balance,80);
 assert.equal((await db.query('select count(*)::int as n from transactions where ride_id=$1',[trip])).rows[0].n,2);
 assert.equal((await db.query("select count(*)::int as n from ride_events where ride_id=$1 and action='complete'",[trip])).rows[0].n,1);
 await assert.rejects(action(OTHER,'complete'),/captain/);
});
test('anonymous/authenticated roles cannot call mutation RPCs, old settlement or write rides',async()=>{
 for(const role of ['anon','authenticated']){
  for(const fn of ['complete_ride_transaction(uuid)','ride_action_secure(uuid,uuid,text)','request_ride_secure(uuid,jsonb)'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') as allowed',[role,fn])).rows[0].allowed,false);
  assert.equal((await db.query("select has_table_privilege($1,'rides','update') as allowed",[role])).rows[0].allowed,false);
 }
});
test('one captain cannot accept a second concurrent active trip; rejection releases assignment',async()=>{
 const a=(await db.query('select request_ride_secure($1,$2) as ride',[RIDER,JSON.stringify(payload)])).rows[0].ride.id;
 const b=(await db.query('select request_ride_secure($1,$2) as ride',[OTHER,JSON.stringify(payload)])).rows[0].ride.id;
 await action(CAPTAIN,'accept',a);await assert.rejects(action(CAPTAIN,'accept',b),/already assigned/);
 await action(RIDER,'reject',a);await action(CAPTAIN,'accept',b);
 await action(RIDER,'cancel',a);await action(OTHER,'cancel',b);
});
test('insufficient settlement funds roll back completion, ledger and event writes',async()=>{
 const id=(await db.query('select request_ride_secure($1,$2) as ride',[RIDER,JSON.stringify(payload)])).rows[0].ride.id;
 await action(CAPTAIN,'accept',id);await action(RIDER,'confirm',id);await action(CAPTAIN,'arrive',id);await action(CAPTAIN,'start',id);
 await db.query('update profiles set wallet_balance=0 where id=$1',[RIDER]);
 await assert.rejects(action(CAPTAIN,'complete',id),/Insufficient/);
 assert.equal((await db.query('select status from rides where id=$1',[id])).rows[0].status,'started');
 assert.equal((await db.query('select count(*)::int as n from transactions where ride_id=$1',[id])).rows[0].n,0);
});
