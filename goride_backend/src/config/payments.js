const { createClient } = require('@supabase/supabase-js');
const { PaymentService } = require('../services/paymentService');
const db = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }) : null;
module.exports = new PaymentService({ db });
