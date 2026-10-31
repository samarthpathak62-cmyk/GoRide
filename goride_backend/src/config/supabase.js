const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('MISSING SUPABASE CREDENTIALS IN .ENV');
}

const createAuthClient = () => createClient(supabaseUrl,supabaseKey,{auth:{persistSession:false,autoRefreshToken:false}});
const supabase = createAuthClient();

const getScopedClient = async (token) => {
  if (!token) throw new (require('../utils/AppError'))('Sign in to continue.',401);
  
  return createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  });
};

module.exports = { supabase, getScopedClient, createAuthClient };
