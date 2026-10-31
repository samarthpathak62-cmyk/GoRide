'use strict';
// Access token is kept in memory only, never in localStorage or a URL.
let token='',applications=[],selected,setup=null,activation=null,qrUrl=null,accountsPage=1;
const $=id=>document.getElementById(id);
const text=(tag,value,className)=>{const n=document.createElement(tag);n.textContent=value;if(className)n.className=className;return n;};
function notify(message){$('message').textContent=message;}
async function api(path,body,accessToken=token){
 const r=await fetch(`/api/admin${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();
 if(!r.ok){if(r.status===401)signOut();throw Error(data.message||'Request failed');}return data;
}
function clearSetup(){if(qrUrl)URL.revokeObjectURL(qrUrl);qrUrl=null;setup=null;$('mfa-qr').removeAttribute('src');$('mfa-secret').textContent='';$('enroll-code').value='';}
function showSection(id){for(const key of ['login','register','enroll','activate','dashboard'])$(key).hidden=key!==id;}
function signOut(){token='';clearSetup();activation=null;selected=null;applications=[];$('detail').replaceChildren();$('applications').replaceChildren();$('accounts').replaceChildren();$('operations-rides').replaceChildren();$('operations-events').replaceChildren();$('password').value='';showSection('login');$('logout').hidden=true;}
$('logout').onclick=signOut;$('mfa-back').onclick=()=>{signOut();notify('Enter your email and password to continue.');};
$('show-register').onclick=()=>showSection('register');$('back-login').onclick=()=>showSection('login');
async function openDashboard(data){if(typeof data.token!=='string'||!data.token)throw Error('No verified administrator session returned.');token=data.token;clearSetup();$('password').value='';showSection('dashboard');$('logout').hidden=false;accountsPage=1;await load();await loadAccounts();await loadPayments();await loadOperations();}
$('login-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;notify('Checking credentials…');try{
 const data=await api('/session',{email:$('email').value,password:$('password').value});
 if(data.setupRequired||data.mfaRequired){clearSetup();setup=data;showSection('enroll');$('password').value='';$('logout').hidden=false;
  $('mfa-qr').hidden=!data.setupRequired;$('mfa-key-label').hidden=!data.setupRequired;
  $('mfa-title').textContent=data.setupRequired?'Secure your account — one-time setup':'Verify it is you';
  $('mfa-help').textContent=data.setupRequired
   ? 'Install Google Authenticator or Microsoft Authenticator. In that app tap +, then Enter setup key, name it GoRide Admin, and paste the key below (choose Time based). On another device you can scan this QR instead. Then enter the changing six-digit code here. This is NOT an email or SMS OTP. Keep the setup key private.'
   : 'Open the authenticator app you previously linked to GoRide Admin. Enter its current six-digit code below. No email or SMS will be sent. If you lost access to that app, contact the project owner; creating a new account will not reset it.';
  if(data.setupRequired){qrUrl=URL.createObjectURL(new Blob([data.qrCode],{type:'image/svg+xml'}));$('mfa-qr').src=qrUrl;$('mfa-secret').textContent=data.secret;}
  notify('Email and password accepted. Complete the security step above.');
 }else await openDashboard(data);
}catch(e){notify(e.message);}finally{button.disabled=false;}};
$('owner-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{
 const data=await api('/register-owner',{email:$('owner-email').value,password:$('owner-password').value},'');
 $('email').value=$('owner-email').value;$('owner-password').value='';showSection('login');notify(data.message);
}catch(e){notify(e.message);}finally{b.disabled=false;}};
$('enroll-form').onsubmit=async e=>{e.preventDefault();if(!setup)return;const b=e.submitter;b.disabled=true;try{
 const data=await api('/mfa/verify',{factorId:setup.factorId,refreshToken:setup.refreshToken,code:$('enroll-code').value},setup.setupToken);await openDashboard(data);
}catch(e){notify(e.message);}finally{b.disabled=false;}};
$('activate-form').onsubmit=async e=>{e.preventDefault();if(!activation)return;const b=e.submitter;b.disabled=true;try{
 const data=await api('/activate',{refreshToken:activation.refreshToken,password:$('activate-password').value},activation.token);
 activation=null;$('activate-password').value='';showSection('login');notify(data.message);
}catch(e){notify(e.message);}finally{b.disabled=false;}};
$('account-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;
 if($('account-role').value==='admin'&&!confirm('Grant administrator privileges to this email? MFA and email verification are required.'))return;
 b.disabled=true;try{const data=await api('/accounts',{email:$('account-email').value,role:$('account-role').value});$('account-email').value='';await loadAccounts();notify(data.message);}catch(e){notify(e.message);}finally{b.disabled=false;}};
async function loadAccounts(){try{const data=await api(`/accounts?page=${accountsPage}`);$('accounts').replaceChildren(...data.data.map(a=>text('div',`${a.email} · ${a.role} · ${a.verified?'verified':'email pending'}`,'account-row')));$('accounts-next').hidden=!data.hasMore;}catch(e){notify(e.message);}}
$('accounts-next').onclick=()=>{accountsPage++;loadAccounts();};
// Tokens are consumed only in memory and immediately removed from the address bar.
const fragment=new URLSearchParams(location.hash.slice(1));
history.replaceState(null,'',location.pathname);
if(fragment.has('error'))notify(fragment.get('error_description')||'Email link expired. Request a new invitation.');
else if(['invite','recovery'].includes(fragment.get('type'))&&fragment.get('access_token')&&fragment.get('refresh_token')){
 activation={token:fragment.get('access_token'),refreshToken:fragment.get('refresh_token')};showSection('activate');notify('Email link accepted. Choose a new password.');
}else if(fragment.get('access_token'))notify('Email verified. Sign in below to complete administrator setup.');
fragment.delete('access_token');fragment.delete('refresh_token');
async function load(){notify('Loading applications…');try{applications=(await api('/applications')).data;renderQueue();notify('');}catch(e){notify(e.message);}}
$('refresh').onclick=async()=>{accountsPage=1;await load();await loadAccounts();await loadPayments();await loadOperations();};$('filter').onchange=renderQueue;
function renderQueue(){
 $('stats').replaceChildren(...['pending','approved','rejected'].map(status=>{const box=text('div','', 'stat');box.append(text('strong',applications.filter(a=>a.status===status).length),text('span',status));return box;}));
 const list=applications.filter(a=>$('filter').value==='all'||a.status===$('filter').value);
 $('applications').replaceChildren(...list.map(a=>{const b=text('button',a.full_name||'Unnamed applicant','app');b.append(text('small',`${a.vehicle_type||'Unknown vehicle'} · ${a.city||'No city'} · ${a.status}`));b.onclick=()=>detail(a.user_id);return b;}));
 if(!list.length)$('applications').append(text('p','No matching applications.','muted'));
}
async function detail(id){notify('Loading private application…');try{selected=(await api(`/applications/${encodeURIComponent(id)}`)).data;renderDetail();notify('');}catch(e){notify(e.message);}}
function renderDetail(){
 const d=selected,root=$('detail');root.replaceChildren(text('span',d.status,'badge'),text('h2',d.full_name),text('p',`${d.vehicle_type} · ${d.vehicle_model} · ${d.registration_number||'No registration'}`),text('p',`${d.city} ${d.postal_code||''} · DOB ${d.date_of_birth||'not supplied'}`,'muted'));
 const docs=text('div','','documents');
 for(const doc of d.documentLinks){const card=text('div','','document');card.append(text('strong',doc.type.replaceAll('_',' ')));if(doc.url){const a=text('a','Open private document ↗');a.href=doc.url;a.target='_blank';a.rel='noopener noreferrer';card.append(document.createElement('br'),a);}else card.append(text('p','Document unavailable — do not approve.'));card.append(text('small',`Expiry: ${doc.expiresOn||'not applicable'} · link valid for 2 minutes`));docs.append(card);}root.append(docs);
 if(d.status==='pending'){
  const label=text('label','Review reason (required)');const reason=document.createElement('textarea');reason.maxLength=1000;reason.id='reason';label.append(reason);
  const checkLabel=text('label','','check'),check=document.createElement('input');check.type='checkbox';check.id='compliance';checkLabel.append(check,text('span','I verified identity, vehicle ownership/use authorisation, documents/expiries, and applicable city/state transport permissions. Approval is not automatic legal certification.'));
  const actions=text('div','','actions');for(const [status,title]of[['approved','Approve captain'],['rejected','Request corrections']]){const button=text('button',title,status==='approved'?'primary':'danger');button.onclick=()=>review(status);actions.append(button);}root.append(label,checkLabel,actions);
 }
 root.append(text('h2','Review history'));for(const audit of d.audit)root.append(text('div',`${audit.created_at} · ${audit.to_status} · ${audit.reason} · reviewer ${audit.reviewer_id}`,'audit'));
}
async function review(status){const reason=$('reason').value.trim(),compliance=$('compliance').checked;if(reason.length<5){notify('Add a meaningful review reason.');return;}if(status==='approved'&&!compliance){notify('Complete the compliance checks before approving.');return;}if(!confirm(`${status==='approved'?'Approve':'Reject'} this application? This action is recorded.`))return;
 const buttons=$('detail').querySelectorAll('button');buttons.forEach(b=>b.disabled=true);try{await api(`/applications/${encodeURIComponent(selected.user_id)}/review`,{status,reason,compliance,version:selected.review_version});await load();await detail(selected.user_id);notify('Review recorded.');}catch(e){notify(e.message);}finally{buttons.forEach(b=>b.disabled=false);}}

async function loadPayments(){try{const p=await api('/payments/status');$('payment-status').replaceChildren(
 text('p',p.checkoutReady?'Online checkout configured — still requires provider transaction testing':'Online payments are NOT configured / enabled'),
 ...Object.entries(p.checks).map(([key,value])=>text('div',`${value?'✓':'✗'} ${key}`,'account-row')),
 text('p',p.notice,'muted'));}catch(e){$('payment-status').textContent=e.message;}}

async function loadOperations(){try{const r=await api('/operations/rides');$('operations-rides').replaceChildren(...r.data.map(ride=>{const button=text('button',`${ride.category} · INR ${ride.fare} · ${ride.status} · ${ride.id}`,'app');button.onclick=async()=>{try{const events=await api(`/operations/rides/${encodeURIComponent(ride.id)}/events`);$('operations-events').replaceChildren(text('h3',`Trip ${ride.id}`),...events.data.map(e=>text('p',`${e.created_at} · ${e.action}: ${e.from_status||'new'} → ${e.to_status}`)));}catch(e){notify(e.message);}};return button;}));}catch(e){$('operations-rides').textContent=e.message;}}
