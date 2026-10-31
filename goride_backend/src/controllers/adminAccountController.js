const { getServiceClient }=require('../config/serviceClient');
const { credentials,newClient,bindSession }=require('../services/adminSessions');
const AppError=require('../utils/AppError');
const catchAsync=require('../utils/catchAsync');
const redirect=()=>`${(process.env.PUBLIC_APP_ORIGIN||'https://goride-phjs.onrender.com').replace(/\/$/,'')}/admin/`;
exports.registerOwner=catchAsync(async(req,res)=>{
 const input=credentials(req.body);
 if(input.password.length<12) throw new AppError('Use a password with at least 12 characters.',400);
 const {data:allowed,error}=await newClient().rpc('admin_signup_allowed',{p_email:input.email});
 if(error) throw new AppError('Administrator setup is not installed on this server.',503);
 if(!allowed) throw new AppError('This email has no pending owner/admin invitation. Use Sign in or ask an existing administrator.',403);
 const {error:signupError}=await newClient().auth.signUp({...input,options:{emailRedirectTo:redirect(),data:{user_type:'rider'}}});
 if(signupError) throw new AppError('Account could not be registered. Try Sign in, or request a new email later.',400);
 res.status(202).json({message:'Check your email and confirm ownership. Then sign in here and set up your authenticator. No shared default password is used.'});
});
exports.activate=catchAsync(async(req,res)=>{
 if(typeof req.body.password!=='string'||req.body.password.length<12||req.body.password.length>256) throw new AppError('Use a password of 12–256 characters.',400);
 const client=await bindSession(req);
 const {error}=await client.auth.updateUser({password:req.body.password});
 if(error) throw new AppError('Could not set password. Request a new invitation/recovery email.',400);
 res.json({message:'Password saved. Sign in with this email in your GoRide app. Administrators can sign in here and set up their authenticator.'});
});
exports.list=catchAsync(async(req,res)=>{
 const page=Number(req.query.page||1);
 if(!Number.isInteger(page)||page<1||page>10000) throw new AppError('Invalid page.',400);
 const {data,error}=await getServiceClient().auth.admin.listUsers({page,perPage:50});
 if(error) throw new AppError('Could not load accounts. Check the backend service-role configuration.',503);
 res.json({data:data.users.map(u=>({id:u.id,email:u.email,role:u.app_metadata?.role==='admin'?'admin':u.user_metadata?.user_type==='driver'?'driver':'rider',verified:!!u.email_confirmed_at,createdAt:u.created_at})),page,hasMore:data.users.length===50});
});
exports.create=catchAsync(async(req,res)=>{
 const email=typeof req.body.email==='string'?req.body.email.trim().toLowerCase():'';
 const role=req.body.role;
 if(email.length>254||!/^\S+@\S+\.\S+$/.test(email)||!['rider','driver','admin'].includes(role)) throw new AppError('Enter a valid email and role.',400);
 const db=getServiceClient();
 const {data:existing,error:lookupError}=await db.rpc('admin_lookup_account',{p_email:email});
 if(lookupError) throw new AppError('Account management migration is missing.',503);
 if(existing&&role!=='admin') throw new AppError('Account already exists. Existing accounts are not overwritten.',409);
 if(role==='admin') {
  const {error}=await db.from('admin_access_grants').upsert({email,user_id:existing?.id||null,status:'pending',granted_by:req.user.id});
  if(error) throw new AppError('Could not reserve admin access.',503);
 }
 if(existing) {
  if(existing.verified) {
   const {error}=await db.auth.admin.updateUserById(existing.id,{app_metadata:{...(existing.app_metadata||{}),role:'admin'}});
   if(error) throw new AppError('Could not grant admin access.',503);
   const {error:saveError}=await db.from('admin_access_grants').update({status:'active',user_id:existing.id}).eq('email',email);
   if(saveError) throw new AppError('Access changed but grant confirmation failed; contact support.',503);
  }
 } else {
  const {error}=await db.auth.admin.inviteUserByEmail(email,{redirectTo:redirect(),data:{user_type:role==='driver'?'driver':'rider'}});
  if(error) throw new AppError('Invitation could not be sent. Verify email/SMTP and retry.',503);
 }
 const {error:auditError}=await db.from('admin_account_audit').insert({actor_id:req.user.id,target_email:email,action:existing?'admin_access_granted':`invited_${role}`});
 if(auditError) throw new AppError('Account operation succeeded but audit recording failed; contact support.',503);
 res.status(201).json({message:existing?(existing.verified?'Admin access granted. Sign out and sign in again; MFA remains mandatory.':'Admin access reserved. The user must verify ownership of the email before it activates.'):'Invitation sent. The recipient chooses their own password through the email link.'});
});
