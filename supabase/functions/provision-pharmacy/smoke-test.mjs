#!/usr/bin/env node
/**
 * PharmaCore ERP + POS — provision-pharmacy Smoke Test
 * Node 22 ESM script (no new dependencies).
 *
 * Verifies live behavior of the provision-pharmacy Supabase Edge Function:
 * 1. HTTP method lockdown (405 on GET)
 * 2. Unauthenticated and corrupted token blocks (401)
 * 3. Validation failure paths (400 on null body, unexpected key, bad email, bad plan)
 * 4. Happy-path provisioning on trial plan (200 with temporary password)
 * 5. First-login credentials, app_users profile, and non-superadmin rejection (403)
 * 6. Pre-check username conflict (400)
 * 7. Optional rate-limiting probe (--rate-limit)
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

// ─── 1. Load Environment Variables (same sources as desktop app) ─────────────
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

let supabaseUrl = process.env.SUPABASE_URL;
let supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  const runtimeConfigPath = path.join(rootDir, 'electron', 'runtime-config.json');
  if (fs.existsSync(runtimeConfigPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'));
      supabaseUrl = supabaseUrl || parsed.SUPABASE_URL;
      supabaseAnonKey = supabaseAnonKey || parsed.SUPABASE_ANON_KEY || parsed.SUPABASE_PUBLISHABLE_KEY;
    } catch {
      // Ignore parse failure; validator below catches missing keys
    }
  }
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: Missing required configuration: SUPABASE_URL or SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY.');
  console.error('Please configure .env or electron/runtime-config.json before running smoke-test.mjs.');
  process.exit(1);
}

// Normalize URL (strip trailing slash)
supabaseUrl = supabaseUrl.trim().replace(/\/+$/, '');
const functionUrl = `${supabaseUrl}/functions/v1/provision-pharmacy`;

// ─── 2. Terminal Input Helpers ───────────────────────────────────────────────
function promptInput(promptText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptHidden(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    process.stdout.write(promptText);

    // Suppress echo for hidden credential input
    rl._writeToOutput = function _writeToOutput(stringToWrite) {
      if (stringToWrite.includes('\r') || stringToWrite.includes('\n')) {
        rl.output.write('\n');
      }
    };

    rl.question('', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── 3. Test Runner State & Assertions ────────────────────────────────────────
let totalRan = 0;
let totalFailed = 0;

function logResult(name, passed, detail = '') {
  totalRan++;
  if (passed) {
    console.log(`PASS: ${name}${detail ? ' (' + detail + ')' : ''}`);
  } else {
    totalFailed++;
    console.log(`FAIL: ${name}${detail ? ' (' + detail + ')' : ''}`);
  }
}

// ─── 4. Main Execution ────────────────────────────────────────────────────────
async function runSmokeTests() {
  if (process.env.NODE_TEST_CONTEXT) {
    console.log('# PharmaCore provision-pharmacy Smoke Test: Skipped during automated node --test run (requires interactive credentials and deployed Edge Function).');
    return;
  }

  console.log('================================================================');
  console.log('PharmaCore provision-pharmacy Smoke Test (Live API)');
  console.log(`Target: ${functionUrl}`);
  console.log('================================================================\n');

  // Collect superadmin credentials interactively
  const superadminEmail = await promptInput('Superadmin Email: ');
  if (!superadminEmail) {
    console.error('Error: Superadmin email cannot be empty.');
    process.exit(1);
  }

  const superadminPassword = await promptHidden('Superadmin Password: ');
  if (!superadminPassword) {
    console.error('Error: Superadmin password cannot be empty.');
    process.exit(1);
  }

  // Authenticate against Supabase Auth without printing/logging credentials
  console.log('\nAuthenticating as superadmin...');
  let superadminToken = '';
  try {
    const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({
        email: superadminEmail,
        password: superadminPassword,
      }),
    });

    if (!authRes.ok) {
      const errJson = await authRes.json().catch(() => ({}));
      console.error(`Authentication failed: HTTP ${authRes.status} - ${errJson.error_description || errJson.msg || 'Invalid credentials'}`);
      process.exit(1);
    }

    const authData = await authRes.json();
    superadminToken = authData.access_token;
    if (!superadminToken) {
      throw new Error('Access token not returned by Auth service.');
    }
  } catch (err) {
    console.error(`Sign in error: ${err.message}`);
    process.exit(1);
  }

  console.log('Superadmin session established successfully.\n');
  console.log('--- Running Smoke Test Assertions ---');

  // 4.1: GET gives 405
  try {
    const res = await fetch(functionUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${superadminToken}`,
        'apikey': supabaseAnonKey,
      },
    });
    logResult('GET gives 405', res.status === 405, `HTTP ${res.status}`);
  } catch (err) {
    logResult('GET gives 405', false, err.message);
  }

  // 4.2: no Authorization header gives 401
  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ pharmacyName: 'Smoke Test' }),
    });
    logResult('no Authorization header gives 401', res.status === 401, `HTTP ${res.status}`);
  } catch (err) {
    logResult('no Authorization header gives 401', false, err.message);
  }

  // 4.3: garbage token gives 401
  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer garbage.invalid.token',
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ pharmacyName: 'Smoke Test' }),
    });
    logResult('garbage token gives 401', res.status === 401, `HTTP ${res.status}`);
  } catch (err) {
    logResult('garbage token gives 401', false, err.message);
  }

  // 4.4: body null gives 400
  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superadminToken}`,
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: 'null',
    });
    logResult('body null gives 400', res.status === 400, `HTTP ${res.status}`);
  } catch (err) {
    logResult('body null gives 400', false, err.message);
  }

  // 4.5: unexpected key gives 400
  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superadminToken}`,
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({
        pharmacyName: 'Valid Pharmacy',
        adminEmail: 'valid@example.com',
        adminUsername: 'validuser',
        planTier: 'trial',
        role: 'superadmin', // Unexpected key
      }),
    });
    logResult('unexpected key gives 400', res.status === 400, `HTTP ${res.status}`);
  } catch (err) {
    logResult('unexpected key gives 400', false, err.message);
  }

  // 4.6: bad email gives 400
  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superadminToken}`,
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({
        pharmacyName: 'Valid Pharmacy',
        adminEmail: 'not-an-email',
        adminUsername: 'validuser',
        planTier: 'trial',
      }),
    });
    logResult('bad email gives 400', res.status === 400, `HTTP ${res.status}`);
  } catch (err) {
    logResult('bad email gives 400', false, err.message);
  }

  // 4.7: bad plan gives 400
  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superadminToken}`,
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({
        pharmacyName: 'Valid Pharmacy',
        adminEmail: 'valid@example.com',
        adminUsername: 'validuser',
        planTier: 'nonexistent_tier_xyz',
      }),
    });
    logResult('bad plan gives 400', res.status === 400, `HTTP ${res.status}`);
  } catch (err) {
    logResult('bad plan gives 400', false, err.message);
  }

  // 4.8: Happy path (trial plan)
  const timestamp = Date.now();
  const happyEmail = `smoke.${timestamp}@example.com`;
  const happyUsername = `smoke_${timestamp}`;
  const happyPharmacyName = `Smoke Pharmacy ${timestamp}`;

  let createdPharmacyId = null;
  let createdSlug = null;
  let temporaryPassword = null;
  let newAdminToken = null;
  let newAdminId = null;

  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superadminToken}`,
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({
        pharmacyName: happyPharmacyName,
        adminEmail: happyEmail,
        adminUsername: happyUsername,
        planTier: 'trial',
      }),
    });

    const cacheHeader = res.headers.get('cache-control') || '';
    const body = await res.json().catch(() => ({}));

    const is200 = res.status === 200;
    const isSuccess = body.success === true;
    const hasTempPassword = typeof body.temporaryPassword === 'string' && body.temporaryPassword.length >= 16;
    const hasNoStore = cacheHeader.includes('no-store');

    logResult(
      'happy path gives 200 with success true, temp password >= 16 chars, and Cache-Control: no-store',
      is200 && isSuccess && hasTempPassword && hasNoStore,
      `HTTP ${res.status}, Cache-Control: ${cacheHeader}`
    );

    if (hasTempPassword) {
      console.log(`[info] Temporary password received (length: ${body.temporaryPassword.length})`);
      temporaryPassword = body.temporaryPassword;
      createdPharmacyId = body.pharmacy?.id;
      createdSlug = body.pharmacy?.slug;
      newAdminId = body.admin?.id;
    }
  } catch (err) {
    logResult('happy path gives 200 with success true', false, err.message);
  }

  // 4.9: Sign in as the new admin with temporary password & check profile
  if (temporaryPassword && happyEmail) {
    try {
      const adminAuthRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseAnonKey,
        },
        body: JSON.stringify({
          email: happyEmail,
          password: temporaryPassword,
        }),
      });

      const adminAuthData = await adminAuthRes.json();
      newAdminToken = adminAuthData.access_token;
      newAdminId = adminAuthData.user?.id || newAdminId;

      if (!adminAuthRes.ok || !newAdminToken) {
        logResult('sign in as new admin with temporary password', false, `HTTP ${adminAuthRes.status}`);
      } else {
        logResult('sign in as new admin with temporary password', true, `HTTP ${adminAuthRes.status}`);

        // Read own app_users row
        const profileRes = await fetch(`${supabaseUrl}/rest/v1/app_users?select=*&id=eq.${newAdminId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${newAdminToken}`,
            'apikey': supabaseAnonKey,
          },
        });

        const profiles = await profileRes.json().catch(() => []);
        const profile = Array.isArray(profiles) ? profiles[0] : null;

        const isMustChange = profile?.must_change_password === true;
        const isAdminRole = profile?.role === 'admin';

        logResult(
          'new admin app_users row has must_change_password = true and role = admin',
          isMustChange && isAdminRole,
          `role: ${profile?.role}, must_change_password: ${profile?.must_change_password}`
        );

        // Call provision-pharmacy as that admin (must be rejected with 403)
        const provRes = await fetch(functionUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${newAdminToken}`,
            'Content-Type': 'application/json',
            'apikey': supabaseAnonKey,
          },
          body: JSON.stringify({
            pharmacyName: 'Admin Attempt Pharmacy',
            adminEmail: `admin.attempt.${Date.now()}@example.com`,
            adminUsername: `adminattempt_${Date.now()}`,
            planTier: 'trial',
          }),
        });

        logResult('new admin calling provision-pharmacy gives 403', provRes.status === 403, `HTTP ${provRes.status}`);
      }
    } catch (err) {
      logResult('sign in and verification of new admin', false, err.message);
    }
  }

  // 4.10: Repeat happy-path call with same username and different email gives 400
  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superadminToken}`,
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({
        pharmacyName: 'Duplicate Username Pharmacy',
        adminEmail: `smoke.different.${timestamp}@example.com`,
        adminUsername: happyUsername, // Same username as happy path
        planTier: 'trial',
      }),
    });

    const body = await res.json().catch(() => ({}));
    const is400 = res.status === 400;
    const hasFriendlyMsg = typeof body.error === 'string' && body.error.includes('Admin username is already taken');

    logResult(
      'duplicate username gives 400 with username-taken message',
      is400 && hasFriendlyMsg,
      `HTTP ${res.status}, error: "${body.error || ''}"`
    );
  } catch (err) {
    logResult('duplicate username gives 400', false, err.message);
  }

  // 4.11: Optional flag --rate-limit sends requests until 429
  if (process.argv.includes('--rate-limit')) {
    console.log('\n----------------------------------------------------------------');
    console.log('WARNING: --rate-limit flag detected.');
    console.log('This test sends requests until HTTP 429 is received.');
    console.log('NOTICE: Triggering rate limit blocks provisioning for this caller for 1 hour!');
    console.log('----------------------------------------------------------------');

    let hit429 = false;
    let attempts = 0;
    while (attempts < 15 && !hit429) {
      attempts++;
      try {
        const rlRes = await fetch(functionUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${superadminToken}`,
            'Content-Type': 'application/json',
            'apikey': supabaseAnonKey,
          },
          body: JSON.stringify({
            pharmacyName: 'Rate Limit Probe Pharmacy',
            adminEmail: 'ratelimit@example.com',
            adminUsername: 'rluser',
            planTier: 'trial',
            invalid_probe_param: true, // Counts as attempt
          }),
        });
        if (rlRes.status === 429) {
          hit429 = true;
        }
      } catch {
        break;
      }
    }
    logResult('--rate-limit sends requests until 429', hit429, `Attempt ${attempts}`);
  }

  // ─── 5. Summary & Cleanup Information ─────────────────────────────────────
  console.log('\n================================================================');
  console.log(`SMOKE TEST SUMMARY: ${totalRan} tests, ${totalRan - totalFailed} passed, ${totalFailed} failed.`);
  console.log('================================================================');

  console.log('\n--- Cleanup Information ---');
  console.log(`Created Pharmacy ID:   ${createdPharmacyId || 'N/A'}`);
  console.log(`Created Pharmacy Slug: ${createdSlug || 'N/A'}`);
  console.log(`Created Admin Email:   ${happyEmail || 'N/A'}`);
  console.log('Use Supabase SQL Editor or dashboard to inspect/clean up this smoke-test record if desired.');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runSmokeTests().catch((err) => {
  console.error('Fatal smoke test runner error:', err.message);
  process.exit(1);
});
