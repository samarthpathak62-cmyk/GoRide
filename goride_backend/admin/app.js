'use strict';
// Access token is kept in memory only, never in localStorage or a URL.
let token='',applications=[],selected;
const $=id=>document.getElementById(id);
const text=(tag,value,className)=>{const n=document.createElement(tag);n.textContent=value;if(className)n.className=className;return n;};
function notify(message){$('message').textContent=message;}
async function api(path,body){
 const r=await fetch(`/api/admin${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();
 if(!r.ok){if(r.status===401)signOut();throw Error(data.message||'Request failed');}return data;
}
function signOut(){token='';selected=null;applications=[];$('detail').replaceChildren();$('applications').replaceChildren();$('login').hidden=false;$('dashboard').hidden=true;$('logout').hidden=true;}
$('logout').onclick=signOut;
$('login-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;notify('Checking credentials and MFA…');try{
 const data=await api('/session',{email:$('email').value,password:$('password').value,code:$('code').value});token=data.token;$('password').value='';$('code').value='';$('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;await load();
}catch(e){notify(e.message);}finally{button.disabled=false;}};
async function load(){notify('Loading applications…');try{applications=(await api('/applications')).data;renderQueue();notify('');}catch(e){notify(e.message);}}
$('refresh').onclick=load;$('filter').onchange=renderQueue;
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
