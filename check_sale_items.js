import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[check_sale_items] Error: SUPABASE_URL and SUPABASE_SECRET_KEY must be set in your .env file or environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  const { data, error } = await supabase.from('sale_items').select('*').is('batch_id', null);
  if (error) {
    console.error('Error fetching sale items:', error);
  } else {
    console.log(data);
  }
}
run();
