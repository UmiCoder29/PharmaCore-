require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const { app } = require('electron');

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error('[test-websocket] Error: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set in your .env file or environment.');
  process.exit(1);
}

app.whenReady().then(() => {
  console.log('Testing Supabase Client Initialization inside ELECTRON...');

  try {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { WebSocket },
      realtime: { transport: WebSocket }
    });

    console.log('Client created without throwing errors!');

    console.log('Testing realtime WebSocket connection...');
    const channel = client.channel('test-channel');
    
    channel.subscribe((status, err) => {
      console.log('Realtime status:', status);
      if (status === 'SUBSCRIBED') {
        console.log('✅ WEBSOCKET CONNECTED SUCCESSFULLY IN ELECTRON!');
        process.exit(0);
      }
      if (err) {
        console.error('WebSocket Error:', err);
        process.exit(1);
      }
    });

    setTimeout(() => {
      console.error('Timeout waiting for realtime connection.');
      process.exit(1);
    }, 10000);

  } catch (err) {
    console.error('Initialization Error:', err.message);
    process.exit(1);
  }
});
