const test=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
const rider='11111111-1111-4111-8111-111111111111',captain='22222222-2222-4222-8222-222222222222';
let status='accepted';const original=Module._load;
Module._load=function(name,parent,isMain){
 if(name==='../config/serviceClient'&&parent?.filename.endsWith('/services/rideAccess.js'))return{getServiceClient:()=>({from(table){
  let statuses=[];const q={select(){return q;},in(column,values){if(column==='status')statuses=values;return q;},
   then(resolve,reject){return Promise.resolve({data:[{id:'driver',user_id:captain}]}).then(resolve,reject);},
   limit:async()=>({data:statuses.includes(status)?[{user_id:rider,driver_id:'driver'}]:[]})};return q;
 }})};return original.call(this,name,parent,isMain);
};
const {peers}=require('../src/services/rideAccess');Module._load=original;
test('cancelled/completed peers retain history access but cannot send messages, typing or call signaling',async()=>{
 for(const ended of ['cancelled','completed']){status=ended;
  await assert.rejects(peers(captain,rider),e=>e.statusCode===403);
  await assert.rejects(peers(rider,captain),e=>e.statusCode===403);
  await peers(captain,rider,{allowHistory:true});
 }
});
test('active assigned participants may communicate but unrelated users and pending searches cannot',async()=>{
 for(const active of ['driver_assigned','accepted','driver_arrived','started']){status=active;await peers(rider,captain);await peers(captain,rider);}
 await assert.rejects(peers(rider,'33333333-3333-4333-8333-333333333333'),e=>e.statusCode===403);
 status='pending';await assert.rejects(peers(captain,rider),e=>e.statusCode===403);
});
