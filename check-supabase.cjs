require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('[check-supabase] Error: SUPABASE_URL and SUPABASE_SECRET_KEY must be set in your .env file or environment.');
  process.exit(1);
}

const client = createClient(url, serviceKey);

async function checkTables() {
  const { data, error } = await client.from('categories').select('*').limit(1);
  if (error) {
    console.error('Error fetching categories:', error);
  } else {
    console.log('Categories table exists! Data:', data);
  }
}

checkTables();
