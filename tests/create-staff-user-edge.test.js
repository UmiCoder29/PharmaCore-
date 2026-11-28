import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAFF_EMAIL_DOMAIN,
  STAFF_USERNAME_REGEX,
  UNIFORM_FORBIDDEN_ERROR,
  UNIFORM_BRANCH_ERROR,
  DUPLICATE_USERNAME_ERROR,
  QUOTA_REACHED_ERROR,
  SUSPENDED_PHARMACY_ERROR,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_COUNTED_OUTCOME,
  buildStaffEmail,
  validateCreateStaffInput,
  evaluateCreateStaffPermission,
  evaluateBranchAssignment,
  countRateLimitedAttempts,
  isRateLimitExceeded,
  classifyStaffAuthCreateError,
  generateTemporaryPassword,
  processCreateStaffRequest
} from '../supabase/functions/create-staff-user/logic.ts';
import { validatePassword } from '../electron/passwordPolicy.js';
import { STAFF_EMAIL_DOMAIN as AUTH_STAFF_EMAIL_DOMAIN, STAFF_USERNAME_REGEX as AUTH_STAFF_USERNAME_REGEX } from '../electron/auth.js';

function createBaseDeps(overrides = {}) {
  const recordedAttempts = [];
  const deletedAuthIds = [];
  const loggedErrors = [];

  const caller = {
    id: 'admin-1',
    username: 'owner_admin',
    role: 'admin',
    pharmacy_id: 'pharm-1',
    branch_id: '11111111-1111-4111-8111-111111111111',
    can_view_all_branches: true,
    must_change_password: false
  };

  const deps = {
    getEnv: () => ({ url: 'https://test.supabase.co', serviceRoleKey: 'srv', anonKey: 'anon' }),
    verifyToken: async () => ({ userId: caller.id }),
    getCallerProfile: async () => caller,
    countAttempts: async () => ({ count: 0 }),
    recordAttempt: async (callerId, targetUsername, outcome) => {
      recordedAttempts.push({ callerId, targetUsername, outcome });
    },
    getPharmacy: async () => ({
      id: 'pharm-1',
      is_active: true,
      subscription_status: 'trial',
      max_users: 3
    }),
    getBranch: async (branchId) => ({ id: branchId, pharmacy_id: 'pharm-1' }),
    findUserByUsername: async () => null,
    createAuthUser: async () => ({ userId: 'new-auth-uuid-1' }),
    deleteAuthUser: async (id) => {
      deletedAuthIds.push(id);
      return { error: null };
    },
    callCreateStaffRpc: async (params) => ({
      data: {
        id: params.p_new_user_id,
        username: params.p_username,
        display_name: params.p_display_name,
        role: 'pharmacist',
        pharmacy_id: params.p_pharmacy_id,
        branch_id: params.p_branch_id,
        must_change_password: true
      },
      error: null
    }),
    findAppUserById: async () => ({ data: null, error: null }),
    sleep: async () => {},
    logError: (msg) => loggedErrors.push(msg),
    ...overrides
  };

  return { deps, recordedAttempts, deletedAuthIds, loggedErrors };
}

const VALID_BRANCH = '11111111-1111-4111-8111-111111111111';
const FOREIGN_BRANCH = '22222222-2222-4222-8222-222222222222';

describe('create-staff-user Edge Function Logic & Orchestration Suite', () => {
  describe('1. Input Validation & Staff Email Domain Constant', () => {
    it('defines single staff domain constant matching electron/auth.js and builds deterministic staff email', () => {
      assert.equal(STAFF_EMAIL_DOMAIN, 'staff.pharmacore.invalid');
      assert.equal(STAFF_EMAIL_DOMAIN, AUTH_STAFF_EMAIL_DOMAIN);
      assert.equal(STAFF_USERNAME_REGEX.source, AUTH_STAFF_USERNAME_REGEX.source);
      assert.equal(buildStaffEmail(' Pharmacist_Ali '), 'pharmacist_ali@staff.pharmacore.invalid');
      assert.equal(STAFF_USERNAME_REGEX.test('pharmacist_ali_1'), true);
      assert.equal(STAFF_USERNAME_REGEX.test('ab'), false);
    });

    it('rejects extra keys (including forged pharmacyId, id, password) and missing keys', () => {
      const extraPayloads = [
        { username: 'staff_1', displayName: 'Staff One', role: 'pharmacist', branchId: VALID_BRANCH, pharmacyId: 'other-pharm' },
        { username: 'staff_1', displayName: 'Staff One', role: 'pharmacist', branchId: VALID_BRANCH, password: 'MyPassword123' },
        { username: 'staff_1', displayName: 'Staff One', role: 'pharmacist' },
        { username: 'staff_1', role: 'pharmacist', branchId: VALID_BRANCH }
      ];
      for (const body of extraPayloads) {
        const res = validateCreateStaffInput(body);
        assert.equal(res.valid, false);
      }
    });

    it('rejects bad usernames cleanly', () => {
      for (const bad of ['ab', 'a'.repeat(51), 'bad-user', 'bad user', 'bad!user', '']) {
        const res = validateCreateStaffInput({
          username: bad,
          displayName: 'Valid Name',
          role: 'pharmacist',
          branchId: VALID_BRANCH
        });
        assert.equal(res.valid, false, `Expected bad username "${bad}" to be rejected`);
      }
    });
  });

  describe('2. Permission Matrix & Branch Restrictions', () => {
    it('refuses pharmacist, superadmin, must_change_password caller, and non-pharmacist target roles with 403', () => {
      assert.equal(evaluateCreateStaffPermission({ id: 'p1', username: 'p', role: 'pharmacist', pharmacy_id: 'ph1', branch_id: VALID_BRANCH }, 'pharmacist').httpStatus, 403);
      assert.equal(evaluateCreateStaffPermission({ id: 's1', username: 's', role: 'superadmin', pharmacy_id: null, branch_id: null }, 'pharmacist').httpStatus, 403);
      assert.equal(evaluateCreateStaffPermission({ id: 'a1', username: 'a', role: 'admin', pharmacy_id: 'ph1', branch_id: VALID_BRANCH, must_change_password: true }, 'pharmacist').httpStatus, 403);

      const owner = { id: 'a1', username: 'a', role: 'admin', pharmacy_id: 'ph1', branch_id: VALID_BRANCH, can_view_all_branches: true };
      assert.equal(evaluateCreateStaffPermission(owner, 'admin').error, UNIFORM_FORBIDDEN_ERROR);
      assert.equal(evaluateCreateStaffPermission(owner, 'superadmin').error, UNIFORM_FORBIDDEN_ERROR);
      assert.equal(evaluateCreateStaffPermission(owner, 'pharmacist').allowed, true);
    });

    it('foreign branch, unknown branch, and missing branch return the identical uniform error', () => {
      const owner = { id: 'a1', username: 'a', role: 'admin', pharmacy_id: 'ph1', branch_id: VALID_BRANCH, can_view_all_branches: true };
      const foreign = evaluateBranchAssignment(owner, { id: FOREIGN_BRANCH, pharmacy_id: 'ph2' });
      const unknown = evaluateBranchAssignment(owner, null);
      const missingInput = validateCreateStaffInput({ username: 'staff_1', displayName: 'Staff One', role: 'pharmacist', branchId: '' });

      assert.equal(foreign.error, UNIFORM_BRANCH_ERROR);
      assert.equal(unknown.error, UNIFORM_BRANCH_ERROR);
      assert.equal(missingInput.error, UNIFORM_BRANCH_ERROR);
    });

    it('restricts single-branch admin (can_view_all_branches=false) to their own branch', () => {
      const singleBranchAdmin = { id: 'a2', username: 'a2', role: 'admin', pharmacy_id: 'ph1', branch_id: VALID_BRANCH, can_view_all_branches: false };
      const otherOwnBranch = evaluateBranchAssignment(singleBranchAdmin, { id: FOREIGN_BRANCH, pharmacy_id: 'ph1' });
      assert.equal(otherOwnBranch.valid, false);
      assert.equal(otherOwnBranch.error, UNIFORM_BRANCH_ERROR);

      const sameBranch = evaluateBranchAssignment(singleBranchAdmin, { id: VALID_BRANCH, pharmacy_id: 'ph1' });
      assert.equal(sameBranch.valid, true);
    });
  });

  describe('3. Full Handler Failure & Rollback Paths', () => {
    const validBody = { ok: true, body: { username: 'staff_ali', displayName: 'Ali Raza', role: 'pharmacist', branchId: VALID_BRANCH } };

    it('blocks pharmacist caller end-to-end with 403 and records permission_denied', async () => {
      const { deps, recordedAttempts } = createBaseDeps({
        getCallerProfile: async () => ({
          id: 'p1',
          username: 'p1',
          role: 'pharmacist',
          pharmacy_id: 'pharm-1',
          branch_id: VALID_BRANCH
        })
      });
      const res = await processCreateStaffRequest('POST', 'Bearer tok', validBody, deps);
      assert.equal(res.status, 403);
      assert.equal(res.body.error, UNIFORM_FORBIDDEN_ERROR);
      assert.equal(recordedAttempts[0]?.outcome, 'permission_denied');
    });

    it('rejects creating admin or superadmin with 403 without touching Auth or DB', async () => {
      let authCalled = false;
      const { deps } = createBaseDeps({
        createAuthUser: async () => {
          authCalled = true;
          return { userId: 'x' };
        }
      });

      const res = await processCreateStaffRequest(
        'POST',
        'Bearer tok',
        { ok: true, body: { username: 'new_admin', displayName: 'New Admin', role: 'admin', branchId: VALID_BRANCH } },
        deps
      );
      assert.equal(res.status, 403);
      assert.equal(res.body.error, UNIFORM_FORBIDDEN_ERROR);
      assert.equal(authCalled, false);
    });

    it('ignores forged pharmacyId (extra key rejected) and uses caller pharmacy_id only', async () => {
      const { deps } = createBaseDeps();
      const res = await processCreateStaffRequest(
        'POST',
        'Bearer tok',
        { ok: true, body: { username: 'staff_x', displayName: 'Staff X', role: 'pharmacist', branchId: VALID_BRANCH, pharmacyId: 'pharm-other' } },
        deps
      );
      assert.equal(res.status, 400);
    });

    it('rejects duplicate username across platform cleanly with 409', async () => {
      const { deps, recordedAttempts } = createBaseDeps({
        findUserByUsername: async () => ({ id: 'existing-other-pharm-user' })
      });
      const res = await processCreateStaffRequest('POST', 'Bearer tok', validBody, deps);
      assert.equal(res.status, 409);
      assert.equal(res.body.error, DUPLICATE_USERNAME_ERROR);
      assert.deepEqual(
        recordedAttempts.map((a) => a.outcome),
        ['attempted', 'username_taken']
      );
    });

    it('rejects suspended pharmacy subscription with 403', async () => {
      const { deps } = createBaseDeps({
        getPharmacy: async () => ({ id: 'pharm-1', is_active: true, subscription_status: 'suspended', max_users: 5 })
      });
      const res = await processCreateStaffRequest('POST', 'Bearer tok', validBody, deps);
      assert.equal(res.status, 403);
      assert.equal(res.body.error, SUSPENDED_PHARMACY_ERROR);
    });

    it('rejects when max_users quota is reached in DB RPC and rolls back Auth user', async () => {
      const { deps, deletedAuthIds, recordedAttempts } = createBaseDeps({
        callCreateStaffRpc: async () => ({ error: { message: 'User limit reached for this plan.', code: 'P0001' } })
      });
      const res = await processCreateStaffRequest('POST', 'Bearer tok', validBody, deps);
      assert.equal(res.status, 403);
      assert.equal(res.body.error, QUOTA_REACHED_ERROR);
      assert.deepEqual(deletedAuthIds, ['new-auth-uuid-1']);
      assert.ok(recordedAttempts.some((a) => a.outcome === 'rpc_failed'));
    });

    it('returns Auth error (never "username taken") when auth.admin.createUser fails', async () => {
      const { deps } = createBaseDeps({
        createAuthUser: async () => ({ error: { message: 'User already registered', status: 422 } })
      });
      const res = await processCreateStaffRequest('POST', 'Bearer tok', validBody, deps);
      assert.equal(res.status, 409);
      assert.notEqual(res.body.error, DUPLICATE_USERNAME_ERROR);
      assert.match(res.body.error, /authentication account/i);
    });

    it('handles rollback failure safely without leaking passwords', async () => {
      let deleteCalls = 0;
      const { deps, loggedErrors, recordedAttempts } = createBaseDeps({
        callCreateStaffRpc: async () => ({ error: { message: 'DB failure', code: 'P0001' } }),
        deleteAuthUser: async () => {
          deleteCalls++;
          return { error: { message: 'Network error during delete' } };
        }
      });

      const res = await processCreateStaffRequest('POST', 'Bearer tok', validBody, deps);
      assert.equal(res.status, 500);
      assert.equal(deleteCalls, 3);
      assert.ok(recordedAttempts.some((a) => a.outcome === 'rollback_failed'));
      assert.ok(loggedErrors.some((m) => m.includes('ORPHAN_AUTH_USER_CREATION_FAILURE')));
    });

    it('handles ambiguous RPC failure without premature Auth deletion if row exists', async () => {
      let deleteCalled = false;
      const { deps, loggedErrors } = createBaseDeps({
        callCreateStaffRpc: async () => ({ error: { message: 'upstream timeout' } }), // no Postgres error code
        findAppUserById: async () => ({ data: { id: 'new-auth-uuid-1' }, error: null }),
        deleteAuthUser: async () => {
          deleteCalled = true;
          return { error: null };
        }
      });

      const res = await processCreateStaffRequest('POST', 'Bearer tok', validBody, deps);
      assert.equal(res.status, 500);
      assert.equal(deleteCalled, false, 'Must NOT delete Auth user when app_users record exists');
      assert.ok(loggedErrors.some((m) => m.includes('STAFF_CREATION_UNCERTAIN_COMPLETED')));
    });

    it('returns 200 with temporary password meeting passwordPolicy and records success', async () => {
      const { deps, recordedAttempts } = createBaseDeps();
      const res = await processCreateStaffRequest('POST', 'Bearer tok', validBody, deps);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(typeof res.body.temporaryPassword, 'string');
      assert.equal(res.body.temporaryPassword.length, 16);
      assert.equal(validatePassword(res.body.temporaryPassword).valid, true);
      assert.equal(res.body.user.username, 'staff_ali');
      assert.equal(res.body.user.role, 'pharmacist');
      assert.equal(recordedAttempts[0]?.outcome, 'attempted');
      assert.equal(recordedAttempts[1]?.outcome, 'success');
    });
  });

  describe('4. Exact Hourly Rate-Limit Counting (outcome = "attempted" only)', () => {
    it('10 attempted rows block the 11th request while success/denied/failure rows do not count', async () => {
      const winStart = '2026-11-27T00:00:00.000Z';
      const inWin = '2026-11-27T00:20:00.000Z';
      const rows = [
        ...Array.from({ length: 5 }, () => ({ caller_id: 'admin-1', outcome: 'attempted', created_at: inWin })),
        ...Array.from({ length: 5 }, () => ({ caller_id: 'admin-1', outcome: 'success', created_at: inWin })),
        { caller_id: 'admin-1', outcome: 'permission_denied', created_at: inWin },
        { caller_id: 'admin-1', outcome: 'rpc_failed', created_at: inWin },
        { caller_id: 'admin-1', outcome: 'rate_limited', created_at: inWin }
      ];
      const count = countRateLimitedAttempts(rows, 'admin-1', winStart);
      assert.equal(count, 5);
      assert.equal(isRateLimitExceeded(count), false);

      const fullRows = Array.from({ length: RATE_LIMIT_MAX_ATTEMPTS }, () => ({
        caller_id: 'admin-1',
        outcome: RATE_LIMIT_COUNTED_OUTCOME,
        created_at: inWin
      }));
      assert.equal(isRateLimitExceeded(countRateLimitedAttempts(fullRows, 'admin-1', winStart)), true);

      const { deps } = createBaseDeps({ countAttempts: async () => ({ count: 10 }) });
      const res = await processCreateStaffRequest(
        'POST',
        'Bearer tok',
        { ok: true, body: { username: 'staff_11', displayName: 'Staff 11', role: 'pharmacist', branchId: VALID_BRANCH } },
        deps
      );
      assert.equal(res.status, 429);
    });

    it('generates 16-char temporary passwords satisfying policy across 50 samples', () => {
      for (let i = 0; i < 50; i++) {
        const pass = generateTemporaryPassword();
        assert.equal(pass.length, 16);
        assert.equal(validatePassword(pass).valid, true);
      }
    });

    it('10 duplicate-username probes consume 10 attempted slots and block the 11th request with 429', async () => {
      const attemptStore = [];
      const { deps } = createBaseDeps({
        findUserByUsername: async () => ({ id: 'taken-user' }),
        countAttempts: async (callerId, windowStartIso) => ({
          count: countRateLimitedAttempts(attemptStore, callerId, windowStartIso)
        }),
        recordAttempt: async (callerId, targetUsername, outcome) => {
          attemptStore.push({
            caller_id: callerId,
            target_username: targetUsername,
            outcome,
            created_at: new Date().toISOString()
          });
        }
      });

      for (let i = 1; i <= 10; i++) {
        const res = await processCreateStaffRequest(
          'POST',
          'Bearer tok',
          { ok: true, body: { username: `probe_user_${i}`, displayName: 'Probe User', role: 'pharmacist', branchId: VALID_BRANCH } },
          deps
        );
        assert.equal(res.status, 409, `Probe ${i} must return 409 duplicate username`);
      }

      assert.equal(attemptStore.filter((r) => r.outcome === 'attempted').length, 10);
      assert.equal(attemptStore.filter((r) => r.outcome === 'username_taken').length, 10);

      const res11 = await processCreateStaffRequest(
        'POST',
        'Bearer tok',
        { ok: true, body: { username: 'probe_user_11', displayName: 'Probe User', role: 'pharmacist', branchId: VALID_BRANCH } },
        deps
      );
      assert.equal(res11.status, 429, '11th request after 10 username probes must be blocked with 429');
    });
  });

  describe('5. Staff Auth Error Classification (classifyStaffAuthCreateError)', () => {
    it('returns generic auth_create_failed (never already exists) on 422 or 400 invalid-email errors', () => {
      const res422 = classifyStaffAuthCreateError({
        status: 422,
        message: 'Unable to validate email address: invalid format'
      });
      assert.equal(res422.httpStatus, 500);
      assert.equal(res422.code, 'auth_create_failed');
      assert.doesNotMatch(res422.error, /already exists|already taken/i);

      const res400 = classifyStaffAuthCreateError({
        status: 400,
        message: 'Email address is invalid'
      });
      assert.equal(res400.httpStatus, 500);
      assert.equal(res400.code, 'auth_create_failed');

      const resDup = classifyStaffAuthCreateError({
        status: 400,
        message: 'duplicate key value in unexpected field'
      });
      assert.equal(resDup.httpStatus, 500);
      assert.equal(resDup.code, 'auth_create_failed');
    });

    it('returns 409 auth_account_exists when error.code is email_exists', () => {
      const res = classifyStaffAuthCreateError({
        code: 'email_exists',
        status: 422,
        message: 'A user with this email address has already been registered'
      });
      assert.equal(res.httpStatus, 409);
      assert.equal(res.code, 'auth_account_exists');

      const resCodeOnly = classifyStaffAuthCreateError({ code: 'email_exists', message: 'conflict' });
      assert.equal(resCodeOnly.httpStatus, 409);
      assert.equal(resCodeOnly.code, 'auth_account_exists');
    });

    it('returns 500 auth_create_failed on unknown errors', () => {
      const res = classifyStaffAuthCreateError({ message: 'Unexpected GoTrue gateway failure', status: 502 });
      assert.equal(res.httpStatus, 500);
      assert.equal(res.code, 'auth_create_failed');
    });
  });
});
