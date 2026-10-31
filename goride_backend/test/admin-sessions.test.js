const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const load=Module._load;
let fakeUser;
Module._load=function(name,parent,isMain){
 if(parent?.filename.endsWith('/services/adminSessions.js')&&name==='@supabase/supabase-js')return{createClient:()=>({auth:{
  signInWithPassword:async()=>({data:{user:fakeUser,session:{}},error:null}),
  setSession:async()=>({data:{user:fakeUser},error:null})
 }})};
 return load.call(this,name,parent,isMain);
};
const sessions=require('../src/services/adminSessions');Module._load=load;
process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_ANON_KEY='test';
test('admin credential validation rejects missing/invalid bodies before any provider call',()=>{
 for(const value of [undefined,{}, {email:'not-an-email',password:'x'},{email:'owner@example.com',password:0}])assert.throws(()=>sessions.credentials(value));
 assert.equal(sessions.credentials({email:'OWNER@example.com',password:'pass'}).email,'owner@example.com');
});
test('a valid password session with only client-editable admin metadata is rejected',async()=>{
 fakeUser={id:'user',user_metadata:{role:'admin'}};
 await assert.rejects(sessions.passwordSession({email:'owner@example.com',password:'pass'}),/administrator access/);
 fakeUser={id:'admin',app_metadata:{role:'admin'}};
 assert.ok((await sessions.passwordSession({email:'owner@example.com',password:'pass'})).client);
});
test('MFA/invitation refresh tokens cannot switch the authenticated account',async()=>{
 fakeUser={id:'another-user',app_metadata:{role:'admin'}};
 const req={body:{refreshToken:'test'},headers:{authorization:'Bearer token'},user:{id:'expected-user'}};
 await assert.rejects(sessions.bindSession(req),/Session mismatch/);
 fakeUser={id:'expected-user'};assert.ok(await sessions.bindSession(req));
});
