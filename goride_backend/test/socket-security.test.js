const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');const load=Module._load;
const actor='11111111-1111-4111-8111-111111111111';
let participantAllowed=false;
Module._load=function(name,parent,isMain){
 if(parent?.filename.endsWith('/socket/socketHandler.js')){
  if(name==='../config/supabase')return{getScopedClient:async()=>({auth:{getUser:async token=>token.startsWith('valid.')?{data:{user:{id:actor,email_confirmed_at:'2026-10-31'}}}:{data:{},error:Error()}}})};
  if(name==='../services/rideAccess')return{rideMember:async()=>{if(!participantAllowed)throw Error();return{status:'started'};},peers:async()=>{throw Error();}};
  if(name==='../services/notificationService'||name==='../services/messageService')return{};
 }
 return load.call(this,name,parent,isMain);
};
const {initSocket}=require('../src/socket/socketHandler');Module._load=load;
function setup(token){let middleware,connection;const events={},joined=[],emitted=[];
 const io={use:fn=>middleware=fn,on:(_event,fn)=>connection=fn,to:()=>({emit:(...args)=>emitted.push(args)})};
 initSocket(io);const socket={handshake:{auth:{token}},on:(event,fn)=>events[event]=fn,join:id=>joined.push(id),emit:(...args)=>emitted.push(args),disconnect(){}};
 return{io,socket,events,joined,emitted,auth:()=>new Promise(resolve=>middleware(socket,error=>resolve(error))),connect:()=>connection(socket)};
}
const token=()=>`valid.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.verified`;
test('socket handshake rejects missing/invalid sessions and ignores client-supplied identity',async()=>{
 for(const value of [undefined,'invalid'])assert.ok(await setup(value).auth());
 const b=setup(token());assert.equal(await b.auth(),undefined);b.connect();assert.deepEqual(b.joined,[`user_${actor}`]);
 await b.events.register({userId:'someone-else'});assert.equal(b.joined.length,1);
 b.events.disconnect();
});
test('unrelated sockets cannot subscribe to trips, spoof location or message strangers',async()=>{
 const b=setup(token());await b.auth();b.connect();participantAllowed=false;
 await b.events.join_ride('private-trip');assert.equal(b.joined.length,1);
 await b.events.update_location({rideId:'private-trip',lat:28,lng:77});assert.equal(b.emitted.filter(e=>e[0]==='driver_location_update').length,0);
 let result;await b.events.send_message({senderId:'someone-else',receiverId:'stranger',text:'spam'},r=>result=r);assert.equal(result.success,false);
 b.events.disconnect();
});
test('validated assigned captain may send coordinates including zero, but never NaN',async()=>{
 const b=setup(token());await b.auth();b.connect();participantAllowed=true;
 await b.events.update_location({rideId:'private-trip',lat:0,lng:0});assert.equal(b.emitted[0][0],'driver_location_update');
 await b.events.update_location({rideId:'private-trip',lat:NaN,lng:77});assert.equal(b.emitted.filter(e=>e[0]==='driver_location_update').length,1);b.events.disconnect();
});
