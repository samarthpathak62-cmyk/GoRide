const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');const fs=require('node:fs');
const {PaymentService}=require('../src/services/paymentService');const {database,ids}=require('./helpers/tripDatabase');
const secret='unit-test-signature-secret';
const env={PAYMENTS_ENABLED:'true',PAYMENT_MODE:'test',RAZORPAY_KEY_ID:'rzp_test_mock',RAZORPAY_KEY_SECRET:'mock',RAZORPAY_WEBHOOK_SECRET:secret};
test('test configuration rejects live keys and unsupported mode, without hitting a provider',()=>{
 for(const extra of [{PAYMENT_MODE:'bad'},{RAZORPAY_KEY_ID:'rzp_live_mock'}])assert.throws(()=>new PaymentService({env:{...env,...extra},db:{}}).requireConfig(),/not configured/);
 new PaymentService({env,db:{}}).requireConfig();
});
test('captured test webhook routes to isolated test ledger only; cannot cross into a live order',async()=>{
 const event=Buffer.from(JSON.stringify({event:'payment_link.paid',payload:{payment_link:{entity:{id:'plink_test'}},payment:{entity:{id:'pay_test'}}}}));
 const sig=crypto.createHmac('sha256',secret).update(event).digest('hex');
 let mode='test',credited=0;
 const db={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{id:'sandbox-order',amount_paise:10000,mode}})})})}),rpc:async name=>{assert.equal(name,'credit_verified_test_payment');credited++;return {};}};
 const service=new PaymentService({env,db,fetchImpl:async url=>({ok:true,json:async()=>url.includes('payment_links/')?{status:'paid',reference_id:'sandbox-order',currency:'INR',amount:10000,amount_paid:10000,payments:[{payment_id:'pay_test'}]}:{status:'captured',currency:'INR',amount:10000}})});
 await service.webhook(event,sig);assert.equal(credited,1);
 mode='live';await assert.rejects(service.webhook(event,sig),/mode does not match/);assert.equal(credited,1);
});
test('SQL test credits are idempotent, denied to clients and never change real wallet or transactions',async()=>{
 const db=await database();
 try{
 const base=fs.readFileSync('../supabase/migrations/202610310002_user_wallet_repairs.sql','utf8');await db.exec(base.slice(base.indexOf('create table if not exists public.payment_orders')));
 await db.exec(fs.readFileSync('../supabase/migrations/202610310015_payment_sandbox.sql','utf8'));
 await db.query("insert into payment_orders(user_id,amount_paise,gateway_link_id,mode) values($1,10000,'plink_test','test')",[ids.rider]);
 for(let i=0;i<2;i++)assert.equal(Number((await db.query("select credit_verified_test_payment('plink_test','pay_test') as n")).rows[0].n),10000);
 await assert.rejects(db.query("select credit_verified_payment('plink_test','pay_test')"),/Test funds/);
 await assert.rejects(db.query("select credit_verified_test_payment('plink_test','pay_other')"),/conflict/);
 assert.equal(Number((await db.query('select wallet_balance as n from profiles where id=$1',[ids.rider])).rows[0].n),1000);
 assert.equal((await db.query('select count(*)::int as n from transactions')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int as n from sandbox_payment_credits')).rows[0].n,1);
 await db.exec('set role authenticated');
 try {await assert.rejects(db.query("select credit_verified_test_payment('plink_test','pay_test')"),/permission denied/);}finally{await db.exec('reset role');}
 }finally{await db.close();}
});
