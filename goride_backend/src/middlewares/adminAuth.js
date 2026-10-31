const AppError = require('../utils/AppError');
function isAdmin(user) { return user?.app_metadata?.role === 'admin'; }
function requireAdmin(req, _res, next) {
 if (!isAdmin(req.user)) return next(new AppError('Administrator access required.',403));
 // protect() must first validate this token with Supabase, not merely decode it.
 try {
  const token=req.headers.authorization.split(' ')[1];
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  if(claims.aal!=='aal2') throw new Error();
 } catch (_) { return next(new AppError('Administrator MFA verification required.',403)); }
 next();
}
module.exports={isAdmin,requireAdmin};
