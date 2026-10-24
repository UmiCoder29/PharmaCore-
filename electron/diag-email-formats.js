/* eslint-disable */
// Quick diagnostic: test multiple email formats against user's REAL Supabase GoTrue
// to find the first format that passes "email_address_invalid".

process.on('uncaughtException', (e) => { console.error('[uncaughtException]', e.message); process.exit(99); });
process.on('unhandledRejection', (r) => { console.error('[unhandledRejection]', r); process.exit(98); });

const TIMEOUT_MS = 45000;
const hardTimeout = setTimeout(() => {
  console.error('\n⛔ HARD TIMEOUT (' + TIMEOUT_MS + 'ms)');
  process.exit(2);
}, TIMEOUT_MS);

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const REAL_URL = process.env.SUPABASE_URL;
const REAL_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!REAL_URL || !REAL_KEY) {
  console.error('[diag-email-formats] Error: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set in your .env file or environment.');
  process.exit(1);
}

const CANDIDATES = [
  { label: '(A) simple @gmail.com',           email: 'test.br78e246fc52f946eba09878bb996e5247@gmail.com' },
  { label: '(B) simple @example.com (IANA reserved)', email: 'br78e246fc52f946eba09878bb996e5247@example.com' },
  { label: '(C) uuid @example.com with dots', email: 'br.78e246fc.52f9.46eb.a098.78bb996e5247@example.com' },
  { label: '(D) uuid @outlook.com (no hyphen)', email: 'br78e246fc52f946eba09878bb996e5247@outlook.com' },
  { label: '(E) branch uuid @proton.me',       email: 'br78e246fc52f946eba09878bb996e5247@proton.me' },
  { label: '(F) original w/ hyphen @example.com', email: 'branch-78e246fc-52f9-46eb-a098-78bb996e5247@example.com' },
];

(async () => {
  console.log('\n═══ Email format diagnostics against REAL Supabase GoTrue ═══');
  console.log('URL: ' + REAL_URL + '\n');

  const client = createClient(REAL_URL, REAL_KEY, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
  });

  let passed = [];
  for (let i = 0; i < CANDIDATES.length; i++) {
    const c = CANDIDATES[i];
    process.stdout.write(`  Trying ${c.label.padEnd(40)}  →  email = ${c.email} ... `);
    const t0 = Date.now();
    try {
      // Use an invalid unique password so this can never actually create a usable account
      // (we only need to know email_address_invalid vs. other errors)
      const pw = 'Diag-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      const r = await client.auth.signUp({ email: c.email, password: pw });
      const dt = Date.now() - t0;
      if (r.error) {
        const code = r.error.code || 'NONE';
        const msg = r.error.message || '';
        if (code === 'email_address_invalid') {
          console.log(`❌ REJECTED [${dt}ms] code=${code}`);
        } else if (msg.includes('password') || code === 'weak_password' || code === 'validation_failed') {
          console.log(`✅ EMAIL ACCEPTED (but ${code}) [${dt}ms]`);
          passed.push(c);
        } else {
          console.log(`✅ EMAIL ACCEPTED (other: ${code}:${msg.slice(0,60)}) [${dt}ms]`);
          passed.push(c);
        }
      } else {
        console.log(`✅✅ FULL SIGNUP SUCCESS! user=${r.user?.id || 'null'} session=${!!r.session} [${dt}ms]`);
        passed.push(c);
      }
    } catch (e) {
      const dt = Date.now() - t0;
      console.log(`⚠  THREW: ${e.message} [${dt}ms]`);
    }
  }

  clearTimeout(hardTimeout);
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PASSED candidates (' + passed.length + '/' + CANDIDATES.length + '):');
  passed.forEach(c => console.log('  ✅ ' + c.label + '  →  ' + c.email));
  if (passed.length === 0) {
    console.log('  ⚠  NO PASS — Supabase project may have custom email validator or blocklist.');
    process.exit(5);
  }
  console.log('\n═══ END OF DIAGNOSTIC ═══\n');
  process.exit(0);
})();
