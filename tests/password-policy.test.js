import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validatePassword,
  COMMON_WEAK_PASSWORDS,
  BLOCKED_WORDS
} from '../electron/passwordPolicy.js';
import {
  changeOwnPassword,
  _setCurrentUserForTesting,
  loginUser
} from '../electron/auth.js';
import { _setSupabaseClientForTesting, clearSupabase } from '../electron/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

describe('PharmaCore Password Policy Comprehensive Suite', () => {
  let mockSupabase;
  let updateUserCalls = [];
  let signInCalls = [];

  beforeEach(() => {
    updateUserCalls = [];
    signInCalls = [];

    mockSupabase = {
      auth: {
        updateUser: async (arg) => {
          updateUserCalls.push(arg);
          return { data: { user: { id: 'usr-1' } }, error: null };
        },
        signInWithPassword: async (credentials) => {
          signInCalls.push(credentials);
          return {
            data: {
              user: { id: 'usr-1', email: credentials.email },
              session: { access_token: 'fake-token', refresh_token: 'fake-refresh' }
            },
            error: null
          };
        },
        setSession: async () => ({ data: {}, error: null }),
        signOut: async () => {}
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: 'usr-1',
                username: 'dr_tariq',
                role: 'admin',
                pharmacy_id: 'ph-1',
                must_change_password: false
              },
              error: null
            })
          })
        }),
        insert: async () => ({ data: null, error: null })
      }),
      rpc: async () => ({ data: true, error: null })
    };

    _setSupabaseClientForTesting(mockSupabase);
    _setCurrentUserForTesting({
      id: 'usr-1',
      username: 'dr_tariq',
      email: 'tariq@shifa.test',
      pharmacyName: 'Al-Shifa Pharmacy',
      role: 'admin',
      mustChangePassword: true
    });
  });

  afterEach(() => {
    _setCurrentUserForTesting(null);
    _setSupabaseClientForTesting(null);
    clearSupabase();
  });

  // ─── 1. Problem Verification (Failing-Before Fixed) ──────────────────────────
  describe('1. Problem Verification: Digits-Only Password Rejected', () => {
    it('digits-only password 12345678910 is rejected by changeOwnPassword and validatePassword with exact no-letter message', async () => {
      // Main process handler
      const res = await changeOwnPassword('12345678910');
      assert.equal(res.success, false, '12345678910 must NOT be accepted');
      assert.equal(
        res.error,
        'Password must include at least one letter. A password with only numbers is not allowed.'
      );
      assert.equal(updateUserCalls.length, 0, 'auth.updateUser must not be called');

      // Shared policy
      const policyRes = validatePassword('12345678910');
      assert.equal(policyRes.valid, false);
      assert.equal(
        policyRes.error,
        'Password must include at least one letter. A password with only numbers is not allowed.'
      );
    });

    it('blank string, empty string and spaces-only are rejected with exact blank message in both main process and shared module', async () => {
      const blankInputs = ['', '   ', '          ', '\t\n  '];
      for (const blank of blankInputs) {
        // Shared module
        const policyRes = validatePassword(blank);
        assert.equal(policyRes.valid, false, `Shared policy should reject blank input '${blank}'`);
        assert.equal(
          policyRes.error,
          'Password cannot be blank or made only of spaces.',
          `Shared policy error mismatch for blank input '${blank}'`
        );

        // Main process handler
        const mainRes = await changeOwnPassword(blank);
        assert.equal(mainRes.success, false, `Main process should reject blank input '${blank}'`);
        assert.equal(
          mainRes.error,
          'Password cannot be blank or made only of spaces.',
          `Main process error mismatch for blank input '${blank}'`
        );
        assert.equal(updateUserCalls.length, 0);
      }
    });
  });

  // ─── 2. Table of Test Cases for Shared Module ──────────────────────────────
  describe('2. Shared Module Policy Rules (Table of Cases)', () => {
    it('too short (11 characters with letters and numbers) fails with too-short message', () => {
      const res = validatePassword('ShortPass12');
      assert.equal(res.valid, false);
      assert.equal(res.error, 'Password must be at least 12 characters long.');
    });

    it('exactly 12 valid characters passes', () => {
      const res = validatePassword('ValidPass202');
      assert.equal(res.valid, true);
      assert.equal(res.error, undefined);
    });

    it('exactly 72 bytes valid passes', () => {
      const pass72 = 'SecurePass2026!' + 'A'.repeat(57);
      assert.equal(new TextEncoder().encode(pass72).length, 72);
      const res = validatePassword(pass72);
      assert.equal(res.valid, true);
    });

    it('73 bytes too long fails with 72-byte message', () => {
      const pass73 = 'SecurePass2026!' + 'A'.repeat(58);
      assert.equal(new TextEncoder().encode(pass73).length, 73);
      const res = validatePassword(pass73);
      assert.equal(res.valid, false);
      assert.equal(
        res.error,
        'Password cannot exceed 72 bytes in length. Non-English letters use more than one byte each.'
      );
    });

    it('multi-byte Urdu password under 72 characters but over 72 bytes fails with 72-byte message', () => {
      // 'Secure2026_' is 11 ASCII chars/bytes.
      // 'دواخانہ' is 6 characters and 12 UTF-8 bytes.
      // 6 repetitions = 36 characters and 72 bytes.
      // Total = 47 characters (< 72 characters), but 83 bytes (> 72 bytes).
      const urduPass = 'Secure2026_' + 'دواخانہ'.repeat(6);
      assert.ok(urduPass.length < 72, 'Character length must be under 72');
      assert.ok(new TextEncoder().encode(urduPass).length > 72, 'Byte length must exceed 72');

      const res = validatePassword(urduPass);
      assert.equal(res.valid, false);
      assert.equal(
        res.error,
        'Password cannot exceed 72 bytes in length. Non-English letters use more than one byte each.'
      );
    });

    it('digits only (12 or more digits) fails with no-letter message', () => {
      const res = validatePassword('123456789012');
      assert.equal(res.valid, false);
      assert.equal(
        res.error,
        'Password must include at least one letter. A password with only numbers is not allowed.'
      );
    });

    it('letters only (12 or more letters) fails with no-number message', () => {
      const res = validatePassword('abcdefghijkl');
      assert.equal(res.valid, false);
      assert.equal(
        res.error,
        'Password must include at least one number as well as letters.'
      );
    });

    it('one repeated character plus a digit (fewer than 6 distinct characters) fails with repetitive message', () => {
      const res = validatePassword('aaaaaaaaaaaa1');
      assert.equal(res.valid, false);
      assert.equal(res.error, 'Password is too repetitive. Use a wider mix of characters.');
    });

    it('each blocked word in any case fails with too-easy-to-guess message', () => {
      const blockedCases = [
        'MyPassword2026!',
        'MYPASSWORD2026!',
        'pAsSwOrD2026xyz',
        'PharmaCore2026!',
        'PHARMACORE2026!',
        'phArmacore2026!',
        'Qwerty2026Test!',
        'QWERTY2026Test!',
        'my_qwerty_pass1'
      ];

      for (const pass of blockedCases) {
        const res = validatePassword(pass);
        assert.equal(res.valid, false, `Failed to reject blocked word in: ${pass}`);
        assert.equal(
          res.error,
          'That password is too easy to guess. Choose something less common.',
          `Incorrect error for: ${pass}`
        );
      }
    });

    it('each qualifying blocklist entry (length >= 12) in any case fails with too-easy-to-guess message', () => {
      const qualifyingBlocklistCases = [
        'password1234',
        'PASSWORD1234',
        'Password1234',
        'pharmacore123',
        'PHARMACORE123',
        'adminpassword1' // includes 'password' substring
      ];

      for (const pass of qualifyingBlocklistCases) {
        const res = validatePassword(pass);
        assert.equal(res.valid, false, `Failed to reject blocklist entry: ${pass}`);
        assert.equal(
          res.error,
          'That password is too easy to guess. Choose something less common.',
          `Incorrect error for: ${pass}`
        );
      }
    });

    it('extended weak passwords reach the exact-match check without failing earlier rules', () => {
      // These passwords have >= 12 characters, >= 6 distinct characters, letters and numbers,
      // and do NOT contain 'password', 'pharmacore', or 'qwerty'.
      // They prove that the exact-match COMMON_WEAK_PASSWORDS check is active and reachable.
      const reachableExactMatchCases = [
        'welcome12345',
        'Welcome12345',
        'WELCOME12345',
        'letmein12345',
        'LetMeIn12345',
        'changeme1234',
        'ChangeMe1234',
        'iloveyou1234',
        'ILoveYou1234',
        'admin1234567',
        'Admin1234567'
      ];

      for (const pass of reachableExactMatchCases) {
        // Verify it passes earlier checks:
        assert.equal(typeof pass, 'string');
        assert.ok(pass.trim().length > 0, 'Not blank');
        assert.ok(/\p{L}/u.test(pass), 'Has letters');
        assert.ok(/[0-9]/.test(pass), 'Has digits');
        assert.ok(pass.length >= 12, 'Length >= 12');
        assert.ok(new TextEncoder().encode(pass).length <= 72, 'Byte length <= 72');
        assert.ok(new Set(pass).size >= 6, '>= 6 distinct characters');
        const lower = pass.toLowerCase();
        assert.ok(!lower.includes('password'), 'Does not contain password');
        assert.ok(!lower.includes('pharmacore'), 'Does not contain pharmacore');
        assert.ok(!lower.includes('qwerty'), 'Does not contain qwerty');

        // Verify validation reaches exact-match and returns the too-easy-to-guess error
        const res = validatePassword(pass);
        assert.equal(res.valid, false, `Should reject ${pass}`);
        assert.equal(
          res.error,
          'That password is too easy to guess. Choose something less common.',
          `Error mismatch for ${pass}`
        );
      }
    });

    it('COMMON_WEAK_PASSWORDS contains all 11 original legacy entries plus extended reachable entries in lowercase', () => {
      assert.equal(COMMON_WEAK_PASSWORDS.size, 16);
      const originalLegacy = [
        'password123',
        'password1234',
        '1234567890',
        'admin12345',
        'adminpassword',
        'pharmacore1',
        'pharmacore123',
        'welcome1234',
        'letmein1234',
        'changeme123',
        'iloveyou123'
      ];
      for (const entry of originalLegacy) {
        assert.ok(COMMON_WEAK_PASSWORDS.has(entry), `Must contain legacy entry ${entry}`);
      }

      const extendedReachable = [
        'welcome12345',
        'letmein12345',
        'changeme1234',
        'iloveyou1234',
        'admin1234567'
      ];
      for (const entry of extendedReachable) {
        assert.ok(COMMON_WEAK_PASSWORDS.has(entry), `Must contain extended entry ${entry}`);
      }
    });

    it('contains username fails with personal info message', () => {
      const context = { username: 'dr_tariq' };
      const res = validatePassword('MyDr_Tariq2026!', context);
      assert.equal(res.valid, false);
      assert.equal(
        res.error,
        'Password must not contain your username, email name or pharmacy name.'
      );
    });

    it('contains email name before @ fails with personal info message', () => {
      const context = { email: 'tariq.khan@pharma.com' };
      // Email name before @ is 'tariq.khan', normalized to 'tariqkhan'
      const res = validatePassword('MyTariqKhan2026!', context);
      assert.equal(res.valid, false);
      assert.equal(
        res.error,
        'Password must not contain your username, email name or pharmacy name.'
      );
    });

    it('contains pharmacy name with spaces and punctuation fails with personal info message', () => {
      const context = { pharmacyName: 'Al-Shifa & Co. (Pvt) Ltd' };
      // Normalized target is 'alshifacopvtltd'
      const res = validatePassword('Al-Shifa & Co. (Pvt) Ltd 2026!', context);
      assert.equal(res.valid, false);
      assert.equal(
        res.error,
        'Password must not contain your username, email name or pharmacy name.'
      );
    });

    it('a name shorter than 4 characters is ignored in personal info check', () => {
      const context = { username: 'ali', email: 'a@b.com', pharmacyName: 'ABC' };
      // 'ali' (3 chars), 'a' (1 char), 'abc' (3 chars) are all < 4 chars and ignored
      const res = validatePassword('AliPharmacy2026!', context);
      assert.equal(res.valid, true);
    });

    it('non-string types fail with valid string message', () => {
      const invalidTypes = [null, undefined, 123456789012, {}, [], true, NaN, Symbol('p')];
      for (const inv of invalidTypes) {
        const res = validatePassword(inv);
        assert.equal(res.valid, false);
        assert.equal(res.error, 'Password must be a valid string.');
      }
    });

    it('valid password with Unicode letters passes', () => {
      // Urdu / Arabic Unicode characters with English numbers
      const unicodePass = 'دواخانہ2026Secure!';
      const res = validatePassword(unicodePass);
      assert.equal(res.valid, true);
      assert.equal(res.error, undefined);
    });
  });

  // ─── 3. Parity Between Main Process & Renderer ─────────────────────────────
  describe('3. Main Process & Renderer Parity', () => {
    it('main process and shared module return identical result and exact message for diverse inputs', async () => {
      const testCases = [
        { pass: '          ', expectedError: 'Password cannot be blank or made only of spaces.' },
        { pass: '12345678910', expectedError: 'Password must include at least one letter. A password with only numbers is not allowed.' },
        { pass: 'abcdefghijkl', expectedError: 'Password must include at least one number as well as letters.' },
        { pass: 'ShortPass12', expectedError: 'Password must be at least 12 characters long.' },
        { pass: 'aaaaaaaaaaaa1', expectedError: 'Password is too repetitive. Use a wider mix of characters.' },
        { pass: 'pharmacore2026x', expectedError: 'That password is too easy to guess. Choose something less common.' },
        { pass: 'password1234', expectedError: 'That password is too easy to guess. Choose something less common.' },
        { pass: 'welcome12345', expectedError: 'That password is too easy to guess. Choose something less common.' },
        { pass: 'Dr_Tariq2026!', expectedError: 'Password must not contain your username, email name or pharmacy name.' },
        { pass: 999999999999, expectedError: 'Password must be a valid string.' },
        { pass: 'SecurePharma2026!', expectedError: null }, // valid
        { pass: 'دواخانہ2026Sec!', expectedError: null }   // valid unicode
      ];

      const context = {
        username: 'dr_tariq',
        email: 'tariq@shifa.test',
        pharmacyName: 'Al-Shifa Pharmacy'
      };

      for (const tc of testCases) {
        // Shared module result
        const policyRes = validatePassword(tc.pass, context);

        // Main process result
        const mainRes = await changeOwnPassword(tc.pass);

        if (tc.expectedError) {
          assert.equal(policyRes.valid, false, `Policy should be invalid for ${tc.pass}`);
          assert.equal(policyRes.error, tc.expectedError, `Policy error mismatch for ${tc.pass}`);
          assert.equal(mainRes.success, false, `Main process should fail for ${tc.pass}`);
          assert.equal(mainRes.error, tc.expectedError, `Main process error mismatch for ${tc.pass}`);
        } else {
          assert.equal(policyRes.valid, true, `Policy should be valid for ${tc.pass}`);
          assert.equal(mainRes.success, true, `Main process should succeed for ${tc.pass}`);
        }
      }
    });
  });

  // ─── 4. Login Isolation (Login Does NOT Call Policy) ─────────────────────────
  describe('4. Login Isolation', () => {
    it('login does NOT call the policy, so an existing account with a short/legacy password can still sign in', async () => {
      // Legacy 6-character password that would fail the new policy
      const legacyShortPassword = 'pass1';
      assert.equal(validatePassword(legacyShortPassword).valid, false);

      const loginRes = await loginUser('owner@shifa.test', legacyShortPassword);
      assert.equal(loginRes.success, true, 'Login must succeed with legacy password');
      assert.equal(signInCalls.length, 1);
      assert.equal(signInCalls[0].password, legacyShortPassword);
    });

    it('login succeeds with digits-only password 12345678910', async () => {
      const loginRes = await loginUser('owner@shifa.test', '12345678910');
      assert.equal(loginRes.success, true, 'Login must succeed with digits-only password');
      assert.equal(signInCalls.length, 1);
      assert.equal(signInCalls[0].password, '12345678910');
    });
  });

  // ─── 5. Structural Checks ──────────────────────────────────────────────────
  describe('5. Structural Checks (Codebase Integrity)', () => {
    it('Structural check: LoginScreen.jsx does NOT define its own COMMON_WEAK_PASSWORDS set (structural check only)', () => {
      const code = fs.readFileSync(path.join(projectRoot, 'src', 'components', 'LoginScreen.jsx'), 'utf-8');
      assert.doesNotMatch(
        code,
        /const\s+COMMON_WEAK_PASSWORDS\s*=\s*new\s+Set/,
        'LoginScreen.jsx must not declare its own COMMON_WEAK_PASSWORDS set'
      );
      assert.match(
        code,
        /import\s*\{\s*validatePassword\s*\}\s*from\s*['"]\.\.\/\.\.\/electron\/passwordPolicy\.js['"]/,
        'LoginScreen.jsx must import validatePassword from electron/passwordPolicy.js'
      );
    });

    it('Structural check: electron/auth.js imports validatePassword and does NOT declare its own COMMON_WEAK_PASSWORDS (structural check only)', () => {
      const code = fs.readFileSync(path.join(projectRoot, 'electron', 'auth.js'), 'utf-8');
      assert.doesNotMatch(
        code,
        /const\s+COMMON_WEAK_PASSWORDS\s*=\s*new\s+Set/,
        'electron/auth.js must not declare its own COMMON_WEAK_PASSWORDS set'
      );
      assert.match(
        code,
        /import\s*\{[^}]*validatePassword[^}]*\}\s*from\s*['"]\.\/passwordPolicy\.js['"]/,
        'electron/auth.js must import validatePassword from ./passwordPolicy.js'
      );
    });

    it('Structural check: LoginScreen.jsx renders permanent hint under new password field (structural check only)', () => {
      const code = fs.readFileSync(path.join(projectRoot, 'src', 'components', 'LoginScreen.jsx'), 'utf-8');
      assert.match(
        code,
        /At least 12 characters, with letters and numbers\./,
        'LoginScreen.jsx must render permanent password hint text'
      );
    });
  });

  // ─── 6. Three Break Attempts (Attack Your Own Work) ─────────────────────────
  describe('6. Three Break Attempts', () => {
    it('Break attempt 1 (policy applied to login): proves loginUser bypasses password validation', async () => {
      // Passing non-compliant passwords into loginUser must not trigger passwordPolicy errors
      const invalidPolicyPasswords = ['123', 'short', 'aaaaaaaaaaaa1', 'password123'];
      for (const p of invalidPolicyPasswords) {
        signInCalls = [];
        const res = await loginUser('owner@shifa.test', p);
        assert.equal(res.success, true);
        assert.equal(signInCalls[0].password, p);
      }
    });

    it('Break attempt 2 (renderer and main disagreeing): verified through parity test above', () => {
      // Handled and proven in suite 3 (Main Process & Renderer Parity)
      assert.ok(true);
    });

    it('Break attempt 3 (hostile non-string payload): changeOwnPassword safely rejects without unhandled crash or stack trace leak', async () => {
      const hostileInputs = [
        null,
        undefined,
        123456789,
        { __proto__: { admin: true } },
        ['DROP TABLE app_users;'],
        () => {},
        NaN
      ];

      for (const input of hostileInputs) {
        const res = await changeOwnPassword(input);
        assert.equal(res.success, false);
        assert.equal(res.error, 'Password must be a valid string.');
      }
    });
  });
});
