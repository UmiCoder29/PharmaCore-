import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { validateSupabaseConfig } from '../electron/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from project root .env
dotenv.config({ path: path.join(rootDir, '.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;

try {
  const validated = validateSupabaseConfig({
    supabaseUrl: url,
    supabasePublishableKey: key
  });

  const targetPath = path.join(rootDir, 'electron', 'runtime-config.json');

  // ONLY write SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY
  const runtimeConfig = {
    SUPABASE_URL: validated.supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: validated.supabasePublishableKey
  };

  fs.writeFileSync(targetPath, JSON.stringify(runtimeConfig, null, 2), 'utf8');
  console.log('[Build] Successfully generated electron/runtime-config.json with validated Supabase credentials.');
} catch (err) {
  console.error('\n[Build Error] Failed to generate electron/runtime-config.json:');
  console.error(`> ${err.message}`);
  console.error('Please verify that SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are properly configured in your environment or .env file.\n');
  process.exit(1);
}
