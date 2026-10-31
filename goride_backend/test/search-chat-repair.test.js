const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {database,ids}=require('./helpers/tripDatabase');
let db;
test.before(async()=>{db=await database();});
test.after(async()=>db?.close());
test('legacy NULL deadlines expire, duplicates are blocked, and an owner can cancel before assignment',async()=>{
 const old=(await db.query("insert into rides(user_id,status,fare,category,created_at) values($1,'pending',20,'Bike',now()-interval '1 hour') returning id",[ids.rider])).rows[0].id;
 await db.exec(fs.readFileSync('../supabase/migrations/202610310014_search_and_chat_repair.sql','utf8'));
 assert.equal((await db.query('select status from rides where id=$1',[old])).rows[0].status,'cancelled');
 assert.equal((await db.query("select count(*)::int as n from ride_events where ride_id=$1 and actor_type='system'",[old])).rows[0].n,1);
 const fresh=(await db.query("insert into rides(user_id,status,fare,category) values($1,'pending',20,'Bike') returning id,matching_expires_at",[ids.rider])).rows[0];
 assert.ok(fresh.matching_expires_at);
 await assert.rejects(db.query("insert into rides(user_id,status,fare) values($1,'pending',20)",[ids.rider]),/active trip/);
 await assert.rejects(db.query("select ride_action_secure($1,$2,'cancel')",[fresh.id,ids.other]));
 await db.query("select ride_action_secure($1,$2,'cancel')",[fresh.id,ids.rider]);
 assert.equal((await db.query('select wallet_balance from profiles where id=$1',[ids.rider])).rows[0].wallet_balance,'1000');
});
test('database denies new messages after cancellation/completion and denies direct client inserts',async()=>{
 const d=(await db.query('select id from drivers where user_id=$1',[ids.captain])).rows[0].id;
 const id=(await db.query("insert into rides(user_id,driver_id,status,fare,category) values($1,$2,'accepted',20,'Bike') returning id",[ids.rider,d])).rows[0].id;
 await db.query('insert into messages(sender_id,receiver_id,text) values($1,$2,$3)',[ids.captain,ids.rider,'Allowed while active']);
 await db.query("update rides set status='cancelled' where id=$1",[id]);
 await assert.rejects(db.query('insert into messages(sender_id,receiver_id,text) values($1,$2,$3)',[ids.captain,ids.rider,'Denied after cancellation']),/active trip/);
 await db.query("update rides set status='completed' where id=$1",[id]);
 await assert.rejects(db.query('insert into messages(sender_id,receiver_id,text) values($1,$2,$3)',[ids.rider,ids.captain,'Denied after completion']),/active trip/);
 await db.exec('set role authenticated');
 try{await assert.rejects(db.query('insert into messages(sender_id,receiver_id,text) values($1,$2,$3)',[ids.captain,ids.rider,'Direct bypass']),/permission denied/);}finally{await db.exec('reset role');}
 assert.equal((await db.query('select count(*)::int as n from messages')).rows[0].n,1);
});
