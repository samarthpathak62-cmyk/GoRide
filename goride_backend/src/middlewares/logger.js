// Never log credentials, MFA codes, identity documents, payment signatures or URL queries.
module.exports = (req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
};
