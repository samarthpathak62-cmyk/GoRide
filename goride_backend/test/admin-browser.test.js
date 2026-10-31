const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const script=fs.readFileSync(require.resolve('../admin/app.js'),'utf8');
const html=fs.readFileSync(require.resolve('../admin/index.html'),'utf8');
function browser(hash=''){
 const nodes=new Map();for(const [,id] of html.matchAll(/id="([^"]+)"/g))nodes.set(id,{value:'',hidden:['register','activate','enroll','dashboard','logout'].includes(id),textContent:'',disabled:false,removeAttribute(){},replaceChildren(){},append(){},focus(){}});
 const calls=[];let responses=[];let cleaned=false;
 const context=vm.createContext({document:{getElementById:id=>{assert.ok(nodes.has(id),`Missing element ${id}`);return nodes.get(id);},createElement:()=>({append(){}})},
  fetch:async(url,options)=>{calls.push({url,...options});const next=responses.shift();assert.ok(next,`Unexpected request: ${url}`);return{ok:true,status:200,json:async()=>next};},
  Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},URLSearchParams,history:{replaceState(){cleaned=true;}},location:{hash,pathname:'/admin/'},confirm:()=>true});
 vm.runInContext(script,context);
 return{nodes,calls,context,setResponses:(...values)=>responses=values,isCleaned:()=>cleaned,submit:async id=>nodes.get(id).onsubmit({preventDefault(){},submitter:{disabled:false}})};
}
test('first sign-in shows MFA enrollment without treating HTTP202 as full admin access',async()=>{
 const b=browser();b.setResponses({setupRequired:true,setupToken:'aal1',refreshToken:'refresh',factorId:'factor',qrCode:'<svg/>',secret:'private-key'});
 await b.submit('login-form');assert.equal(b.nodes.get('enroll').hidden,false);assert.equal(b.nodes.get('dashboard').hidden,true);
 assert.equal(vm.runInContext('token',b.context),'');assert.equal(b.nodes.get('mfa-secret').textContent,'private-key');
 b.nodes.get('enroll-code').value='123456';b.setResponses({token:'aal2'},{data:[]},{data:[],hasMore:false},{checkoutReady:false,checks:{},notice:'Not configured'},{data:[]});
 await b.submit('enroll-form');assert.equal(b.nodes.get('dashboard').hidden,false);assert.equal(b.nodes.get('mfa-secret').textContent,'');
 assert.equal(b.calls[1].headers.Authorization,'Bearer aal1');assert.equal(b.calls[2].headers.Authorization,'Bearer aal2');
 b.nodes.get('logout').onclick();assert.equal(vm.runInContext('token',b.context),'');assert.equal(b.nodes.get('dashboard').hidden,true);
});
test('existing authenticator prompt never requests protected dashboard data',async()=>{
 const b=browser();b.setResponses({mfaRequired:true,factorId:'existing',setupToken:'aal1',refreshToken:'refresh'});await b.submit('login-form');
 assert.equal(b.calls.length,1);assert.equal(b.nodes.get('dashboard').hidden,true);assert.equal(b.nodes.get('enroll').hidden,false);assert.equal(b.nodes.get('mfa-qr').hidden,true);assert.equal(b.nodes.get('mfa-key-label').hidden,true);assert.equal(b.nodes.get('mfa-secret').textContent,'');
});
test('invitation fragment is removed and is bound to password activation request only',async()=>{
 const b=browser('#type=invite&access_token=invite-token&refresh_token=invite-refresh');assert.ok(b.isCleaned());assert.equal(b.nodes.get('activate').hidden,false);
 b.nodes.get('activate-password').value='own-private-password';b.setResponses({message:'Password saved'});await b.submit('activate-form');
 assert.equal(b.calls[0].url,'/api/admin/activate');assert.equal(b.calls[0].headers.Authorization,'Bearer invite-token');assert.equal(b.nodes.get('activate-password').value,'');
 assert.equal(vm.runInContext('token',b.context),'');assert.equal(vm.runInContext('activation',b.context),null);
});

test('login has no unexplained OTP field and explains same-phone authenticator setup',()=>{
 assert.ok(!html.includes('id="code"'));
 assert.ok(script.includes('Enter setup key'));
 assert.ok(script.includes('NOT an email or SMS OTP'));
});
