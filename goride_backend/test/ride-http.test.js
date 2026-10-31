const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_ANON_KEY='test';
const app=express();app.use(express.json());app.use('/api',require('../src/routes/rideRoutes'));
app.use((e,_req,res,_next)=>res.status(e.statusCode||500).json({message:e.message}));
test('every ride lifecycle/read endpoint rejects missing authentication before touching data',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const [method,suffix]of[['GET','active'],['GET','history'],...['request','accept','confirm','reject','cancel','arrive','start','complete'].map(s=>['POST',s])]){
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/rides/${suffix}?userId=someone-else`,{method});assert.equal(response.status,401,suffix);
 }}finally{await new Promise(r=>server.close(r));}
});
