const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
// Constructor-only fake configuration. Tests never call a remote Supabase endpoint.
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_ANON_KEY='test-public-key';
const app=express();app.use(express.json());
app.use('/api/auth',require('../src/routes/authRoutes'));
app.use('/api/drivers',require('../src/routes/driverRoutes'));
app.use('/api/admin',require('../src/routes/adminRoutes'));
app.use('/api/wallet',require('../src/routes/walletRoutes'));
app.use((err,_req,res,_next)=>res.status(err.statusCode||500).json({message:err.message}));
test('public checklist and protected captain/admin/payment endpoints',async()=>{
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 try{
  const spec=await fetch(`${origin}/api/drivers/requirements`);assert.equal(spec.status,200);
  const body=await spec.json();assert.deepEqual(body.data.vehicles.map(v=>v.id),['Bike','Auto','Car']);
  for(const path of ['/api/drivers/draft','/api/admin/applications','/api/wallet/methods','/api/auth/mfa/factors']){
   const response=await fetch(origin+path);assert.equal(response.status,401,path);
  }
  for(const path of ['/api/auth/mfa/enroll','/api/auth/update-fcm-token','/api/auth/logout']){const response=await fetch(origin+path,{method:'POST'});assert.equal(response.status,401,path);}
  const invalid=await fetch(`${origin}/api/admin/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(invalid.status,400);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
