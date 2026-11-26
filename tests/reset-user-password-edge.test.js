import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateResetInput,
  evaluateResetPermission,
  generateTemporaryPassword,
  countRateLimitedAttempts,
  isRateLimitExceeded,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_COUNTED_OUTCOME,
  UNIFORM_INELIGIBLE_ERROR,
  SELF_RESET_ERROR
} from '../supabase/functions/reset-user-password/logic.ts';
import { validatePassword } from '../electron/passwordPolicy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDGE_INDEX_PATH = path.join(__dirname, '..', 'supabase', 'functions', 'reset-user-password', 'index.ts');

describe('reset-user-password Edge Function Logic Suite (Pure Shared Module)', () => {

  describe('1. Input Validation (validateResetInput)', () => {
    it('accepts valid { userId } with valid UUID format', () => {
      const res = validateResetInput({ userId: 'e7b1a234-5678-4abc-9def-123456789abc' });
      assert.equal(res.valid, true);
      assert.equal(res.userId, 'e7b1a234-5678-4abc-9def-123456789abc');
    });

    it('rejects extra keys (strict whitelist of only userId)', () => {
      const fixtures = [
        { userId: 'e7b1a234-5678-4abc-9def-123456789abc', role: 'superadmin' },
        { userId: 'e7b1a234-5678-4abc-9def-123456789abc', pharmacyId: 'pharm-1' },
        { userId: 'e7b1a234-5678-4abc-9def-123456789abc', newPassword: 'HackedPassword123!' }
      ];
      for (const f of fixtures) {
        const res = validateResetInput(f);
        assert.equal(res.valid, false, 'Expected rejection for extra keys');
        assert.match(res.error, /only the userId key/i);
      }
    });

    it('rejects missing or malformed userId', () => {
      const badInputs = [
        {},
        null,
        undefined,
        [],
        { userId: '' },
        { userId: 'not-a-uuid' },
        { userId: 12345 },
        { id: 'e7b1a234-5678-4abc-9def-123456789abc' }
      ];
      for (const input of badInputs) {
        const res = validateResetInput(input);
        assert.equal(res.valid, false);
      }
    });
  });

  describe('2. Permission Matrix (evaluateResetPermission)', () => {
    const superadmin = { id: 'super-1', role: 'superadmin' };
    const adminA = { id: 'admin-a', role: 'admin', pharmacy_id: 'pharm-a' };
    const adminB = { id: 'admin-b', role: 'admin', pharmacy_id: 'pharm-b' };
    const pharmacistA = { id: 'pharm-a1', role: 'pharmacist', pharmacy_id: 'pharm-a' };
    const pharmacistB = { id: 'pharm-b1', role: 'pharmacist', pharmacy_id: 'pharm-b' };

    it('Superadmin: allowed to reset pharmacy owner (admin)', () => {
      const res = evaluateResetPermission(superadmin, adminA);
      assert.equal(res.allowed, true);
      assert.equal(res.httpStatus, 200);
    });

    it('Superadmin: returns uniform 403 when targeting a pharmacist', () => {
      const res = evaluateResetPermission(superadmin, pharmacistA);
      assert.equal(res.allowed, false);
      assert.equal(res.httpStatus, 403);
      assert.equal(res.error, UNIFORM_INELIGIBLE_ERROR);
    });

    it('Superadmin: returns uniform 403 when targeting another superadmin', () => {
      const anotherSuper = { id: 'super-2', role: 'superadmin' };
      const res = evaluateResetPermission(superadmin, anotherSuper);
      assert.equal(res.allowed, false);
      assert.equal(res.httpStatus, 403);
      assert.equal(res.error, UNIFORM_INELIGIBLE_ERROR);
    });

    it('Superadmin: returns dedicated 403 on self-reset', () => {
      const res = evaluateResetPermission(superadmin, superadmin);
      assert.equal(res.allowed, false);
      assert.equal(res.httpStatus, 403);
      assert.equal(res.error, SELF_RESET_ERROR);
    });

    it('Admin: allowed to reset pharmacist in the SAME pharmacy', () => {
      const res = evaluateResetPermission(adminA, pharmacistA);
      assert.equal(res.allowed, true);
      assert.equal(res.httpStatus, 200);
    });

    it('Admin: returns uniform 403 when targeting pharmacist in ANOTHER pharmacy', () => {
      const res = evaluateResetPermission(adminA, pharmacistB);
      assert.equal(res.allowed, false);
      assert.equal(res.httpStatus, 403);
      assert.equal(res.error, UNIFORM_INELIGIBLE_ERROR);
    });

    it('Admin: returns uniform 403 when targeting another admin', () => {
      const res = evaluateResetPermission(adminA, adminB);
      assert.equal(res.allowed, false);
      assert.equal(res.httpStatus, 403);
      assert.equal(res.error, UNIFORM_INELIGIBLE_ERROR);
    });

    it('Admin: returns uniform 403 when targeting a superadmin', () => {
      const res = evaluateResetPermission(adminA, superadmin);
      assert.equal(res.allowed, false);
      assert.equal(res.httpStatus, 403);
      assert.equal(res.error, UNIFORM_INELIGIBLE_ERROR);
    });

    it('Admin: returns dedicated 403 on self-reset', () => {
      const res = evaluateResetPermission(adminA, adminA);
      assert.equal(res.allowed, false);
      assert.equal(res.httpStatus, 403);
      assert.equal(res.error, SELF_RESET_ERROR);
    });

    it('Pharmacist: returns uniform 403 when attempting to reset anyone', () => {
      assert.equal(evaluateResetPermission(pharmacistA, pharmacistA).error, SELF_RESET_ERROR);
      assert.equal(evaluateResetPermission(pharmacistA, pharmacistB).error, UNIFORM_INELIGIBLE_ERROR);
      assert.equal(evaluateResetPermission(pharmacistA, adminA).error, UNIFORM_INELIGIBLE_ERROR);
      assert.equal(evaluateResetPermission(pharmacistA, superadmin).error, UNIFORM_INELIGIBLE_ERROR);
    });

    it('Nonexistent target: returns uniform 403', () => {
      const res = evaluateResetPermission(adminA, null);
      assert.equal(res.allowed, false);
      assert.equal(res.httpStatus, 403);
      assert.equal(res.error, UNIFORM_INELIGIBLE_ERROR);
    });

    it('Unauthenticated caller: returns 401', () => {
      const res = evaluateResetPermission(null, pharmacistA);
      assert.equal(res.allowed, false);
      assert.equal(res.httpStatus, 401);
    });
  });

  describe('3. Unbiased Temporary Password Generator (generateTemporaryPassword)', () => {
    it('generates a 16-character temporary password meeting PharmaCore password policy', () => {
      for (let i = 0; i < 50; i++) {
        const pass = generateTemporaryPassword();
        assert.equal(pass.length, 16, 'Password must be exactly 16 characters');
        const policy = validatePassword(pass);
        assert.equal(policy.valid, true, `Generated password failed policy: ${policy.error}`);
        // Ensure all 4 character classes are present
        assert.match(pass, /[A-Z]/, 'Must contain uppercase');
        assert.match(pass, /[a-z]/, 'Must contain lowercase');
        assert.match(pass, /[0-9]/, 'Must contain digit');
        assert.match(pass, /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/, 'Must contain symbol');
      }
    });
  });

  describe('4. Hourly Rate-Limit Counting Rule', () => {
    const windowStartIso = '2026-11-26T00:00:00.000Z';
    const inWindowIso = '2026-11-26T00:15:00.000Z';
    const staleIso = '2026-11-25T23:59:59.000Z';
    const callerId = 'admin-1';

    it('counts ONLY outcome = "attempted" in window; success, permission_denied, rate_limited, and failures do not count', () => {
      const rows = [
        // 5 real resets each produce 1 'attempted' + 1 'success'
        ...Array.from({ length: 5 }, () => ({ caller_id: callerId, outcome: 'attempted', created_at: inWindowIso })),
        ...Array.from({ length: 5 }, () => ({ caller_id: callerId, outcome: 'success', created_at: inWindowIso })),
        // Non-counted outcomes for same caller in window
        { caller_id: callerId, outcome: 'permission_denied', created_at: inWindowIso },
        { caller_id: callerId, outcome: 'permission_denied', created_at: inWindowIso },
        { caller_id: callerId, outcome: 'flag_update_failed', created_at: inWindowIso },
        { caller_id: callerId, outcome: 'auth_update_failed', created_at: inWindowIso },
        { caller_id: callerId, outcome: 'rate_limited', created_at: inWindowIso },
        // Old row outside window and row for different caller
        { caller_id: callerId, outcome: 'attempted', created_at: staleIso },
        { caller_id: 'other-admin', outcome: 'attempted', created_at: inWindowIso },
      ];

      const counted = countRateLimitedAttempts(rows, callerId, windowStartIso);
      assert.equal(counted, 5, '5 resets + denied/failure/rate_limited rows must count as 5 attempted slots, not 14');
      assert.equal(isRateLimitExceeded(counted), false, '5 attempted resets must NOT be blocked by a 10-reset limit');
    });

    it('blocks the 11th request once 10 "attempted" rows exist in window', () => {
      const rows = [
        ...Array.from({ length: 10 }, () => ({ caller_id: callerId, outcome: 'attempted', created_at: inWindowIso })),
        ...Array.from({ length: 10 }, () => ({ caller_id: callerId, outcome: 'success', created_at: inWindowIso })),
      ];

      const counted = countRateLimitedAttempts(rows, callerId, windowStartIso);
      assert.equal(counted, RATE_LIMIT_MAX_ATTEMPTS);
      assert.equal(isRateLimitExceeded(counted), true, '10 attempted rows in window must block the 11th request');
    });

    it('index.ts queries password_reset_attempts filtering by outcome = RATE_LIMIT_COUNTED_OUTCOME', () => {
      const source = fs.readFileSync(EDGE_INDEX_PATH, 'utf8');
      assert.match(
        source,
        /\.from\(["']password_reset_attempts["']\)[\s\S]*?\.eq\(["']caller_id["'],\s*callerProfile\.id\)[\s\S]*?\.eq\(["']outcome["'],\s*RATE_LIMIT_COUNTED_OUTCOME\)[\s\S]*?\.gte\(["']created_at["'],\s*oneHourAgo\)/,
        'index.ts rate-limit count query must filter .eq("outcome", RATE_LIMIT_COUNTED_OUTCOME)'
      );
      assert.equal(RATE_LIMIT_COUNTED_OUTCOME, 'attempted');
    });
  });
});
