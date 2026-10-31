// Never log credentials, MFA codes, identity documents, payment signatures or URL queries.
module.exports = (req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path.startsWith('/s/')||req.path.startsWith('/api/trip-share/')?'[private-trip-share]':req.path}`);
  next();
};
