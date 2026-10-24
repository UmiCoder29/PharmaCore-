require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error('[test-supabase] Error: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set in your .env file or environment.');
  process.exit(1);
}

try {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { WebSocket }
  });
  console.log('Client created successfully.');
  process.exit(0);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
