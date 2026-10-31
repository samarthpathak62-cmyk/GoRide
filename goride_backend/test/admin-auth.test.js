const test=require('node:test');
const assert=require('node:assert/strict');
const {isAdmin,requireAdmin}=require('../src/middlewares/adminAuth');
function req(user,aal){return{user,headers:{authorization:`Bearer x.${Buffer.from(JSON.stringify({aal})).toString('base64url')}.signature`}};}
test('client-editable user metadata cannot grant administrator privileges',()=>{
 assert.equal(isAdmin({user_metadata:{role:'admin'}}),false);
 assert.equal(isAdmin({app_metadata:{role:'admin'}}),true);
});
test('admin middleware rejects non-admins and low-assurance sessions',()=>{
 for(const r of [req({app_metadata:{role:'driver'}},'aal2'),req({app_metadata:{role:'admin'}},'aal1')]){
  let error;requireAdmin(r,{},e=>error=e);assert.equal(error.statusCode,403);
 }
 let error;requireAdmin(req({app_metadata:{role:'admin'}},'aal2'),{},e=>error=e);assert.equal(error,undefined);
});
