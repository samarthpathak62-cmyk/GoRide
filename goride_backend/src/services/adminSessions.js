const { createClient } = require('@supabase/supabase-js');
const { isAdmin } = require('../middlewares/adminAuth');
const AppError = require('../utils/AppError');
function newClient() {
 if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) throw new AppError('Authentication is not configured on the server.',503);
 return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
function credentials(body = {}) {
 if(typeof body.email!=='string'||body.email.length>254||!/^\S+@\S+\.\S+$/.test(body.email)||typeof body.password!=='string'||body.password.length<1||body.password.length>256) throw new AppError('Enter a valid email and password.',400);
 return {email:body.email.trim().toLowerCase(),password:body.password};
}
async function passwordSession(body) {
 const input=credentials(body),client=newClient();
 const {data,error}=await client.auth.signInWithPassword(input);
 if(error) throw new AppError(error.code==='email_not_confirmed'
  ? 'Please verify your email using the confirmation link before signing in.'
  : 'Email or password is incorrect. Use the password you chose when creating your account.',401);
 if(!isAdmin(data?.user)) throw new AppError('Your login is valid, but administrator access is not active. Contact the project owner to check your admin grant.',403);
 return {client,data};
}
async function bindSession(req) {
 if(typeof req.body.refreshToken!=='string'||req.body.refreshToken.length>8192) throw new AppError('Sign in again to continue.',401);
 const client=newClient();
 const {data,error}=await client.auth.setSession({access_token:req.headers.authorization.split(' ')[1],refresh_token:req.body.refreshToken});
 if(error||data.user?.id!==req.user.id) throw new AppError('Session mismatch. Sign in again.',401);
 return client;
}
module.exports={newClient,credentials,passwordSession,bindSession};
