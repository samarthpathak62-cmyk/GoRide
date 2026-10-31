const {createClient}=require('@supabase/supabase-js');
const {getServiceClient}=require('../config/serviceClient');
const {isAdmin}=require('../middlewares/adminAuth');
const {validateApplication,ownedPath}=require('../services/onboardingValidation');
const AppError=require('../utils/AppError');
const catchAsync=require('../utils/catchAsync');
exports.login=catchAsync(async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(typeof req.body.email!=='string' || req.body.email.length>254 || typeof req.body.password!=='string' || req.body.password.length>256 || !/^\d{6}$/.test(req.body.code||'')) throw new AppError('Enter email, password and a six-digit authenticator code.',400);
 const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.auth.signInWithPassword({email:req.body.email,password:req.body.password});
 if(error||!isAdmin(data?.user)) throw new AppError('Invalid administrator credentials.',401);
 const {data:factors,error:factorError}=await client.auth.mfa.listFactors();
 const factor=factors?.totp?.find(f=>f.status==='verified');
 if(factorError||!factor) throw new AppError('Enroll administrator TOTP MFA before using this dashboard.',403);
 const {data:challenge,error:challengeError}=await client.auth.mfa.challenge({factorId:factor.id});
 if(challengeError) throw new AppError('Could not create MFA challenge.',401);
 const {data:verified,error:verifyError}=await client.auth.mfa.verify({factorId:factor.id,challengeId:challenge.id,code:req.body.code});
 if(verifyError) throw new AppError('Invalid MFA code.',401);
 res.json({token:verified.access_token});
});
exports.list=catchAsync(async(_req,res)=>{
 const {data,error}=await getServiceClient().from('drivers').select('user_id,full_name,vehicle_type,city,status,review_version,last_updated').order('last_updated',{ascending:false}).limit(100);
 if(error) throw new AppError('Could not load applications.',503);
 res.json({data});
});
exports.detail=catchAsync(async(req,res)=>{
 const db=getServiceClient();
 const {data,error}=await db.from('drivers').select('*').eq('user_id',req.params.userId).single();
 if(error) throw new AppError('Application not found.',404);
 const documents=[];
 for(const [type,doc] of Object.entries(data.documents||{})) {
  if(!ownedPath(doc.path,data.user_id,type)) continue;
  const {data:signed,error:signError}=await db.storage.from('captain-documents').createSignedUrl(doc.path,120);
  documents.push({type,expiresOn:doc.expiresOn||null,url:signError?null:signed.signedUrl});
 }
 const {data:audit}=await db.from('captain_review_audit').select('*').eq('applicant_id',req.params.userId).order('created_at',{ascending:false});
 res.json({data:{...data,documentLinks:documents,audit:audit||[]}});
});
exports.review=catchAsync(async(req,res)=>{
 if(!['approved','rejected'].includes(req.body.status)||!Number.isInteger(req.body.version)||typeof req.body.reason!=='string'||req.body.reason.trim().length<5||req.body.reason.length>1000) throw new AppError('Choose a decision, reason and current review version.',400);
 const db=getServiceClient();
 if(req.body.status==='approved') {
  if(req.body.compliance!==true) throw new AppError('Confirm applicable transport permissions and document checks.',400);
  const {data:d,error}=await db.from('drivers').select('*').eq('user_id',req.params.userId).single();
  if(error) throw new AppError('Application not found.',404);
  validateApplication(d.user_id,{fullName:d.full_name,dateOfBirth:d.date_of_birth,vehicleModel:d.vehicle_model,vehicleType:d.vehicle_type,city:d.city,postalCode:d.postal_code,registrationNumber:d.registration_number,documents:d.documents,consent:true});
 }
 const {data,error}=await db.rpc('review_captain_application',{p_user_id:req.params.userId,p_reviewer_id:req.user.id,p_version:req.body.version,p_status:req.body.status,p_reason:req.body.reason.trim(),p_compliance:req.body.compliance===true});
 if(error) throw new AppError('Application changed or review failed; reload before retrying.',409);
 res.json({data});
});
