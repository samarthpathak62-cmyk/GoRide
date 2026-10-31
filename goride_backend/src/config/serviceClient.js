const { createClient } = require('@supabase/supabase-js');
const AppError = require('../utils/AppError');
let client;
function getServiceClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError('Secure server configuration is incomplete. Contact support.', 503);
  }
  client ||= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
module.exports = { getServiceClient };
