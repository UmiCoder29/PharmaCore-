import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

import {
  loginUser,
  logoutUser,
  changeOwnPassword,
  createUserAccount,
  updateUsername,
  updateUserBranch,
  _setCurrentUserForTesting,
  getCurrentUser,
  _getPasswordAlreadyChangedForTesting,
  _setPasswordAlreadyChangedForTesting
} from '../electron/auth.js';

import { _setSupabaseClientForTesting, clearSupabase } from '../electron/supabaseClient.js';

const traverse = traverseModule.default || traverseModule;

function createMockClient({
  signInError = null,
  user = null,
  session = null,
  appUser = null,
  appUserError = null,
  pharmacy = null,
  updateUserError = null,
  rpcResult = { data: true, error: null }
} = {}) {
  let updateUserCalls = 0;
  let lastUpdateUserArg = null;
  let rpcCalls = 0;
  let lastRpcArg = null;

  const client = {
    auth: {
      signInWithPassword: async () => {
        if (signInError) return { data: null, error: signInError };
        return {
          data: {
            user: user || { id: 'usr-default', email: 'user@pharmacore.com' },
            session: session || { access_token: 'mock-access-token', refresh_token: 'mock-refresh-token' }
          },
          error: null
        };
      },
      setSession: async () => ({ data: { user }, error: null }),
      signOut: async () => {},
      updateUser: async (arg) => {
        updateUserCalls++;
        lastUpdateUserArg = arg;
        if (updateUserError) return { data: null, error: updateUserError };
        return { data: { user: { id: user?.id || 'usr-default' } }, error: null };
      }
    },
    rpc: async (fnName, args) => {
      rpcCalls++;
      lastRpcArg = { fnName, args };
      return typeof rpcResult === 'function' ? rpcResult(fnName, args) : rpcResult;
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'app_users') {
              if (appUserError) return { data: null, error: appUserError };
              return { data: appUser, error: null };
            }
            if (table === 'pharmacies') {
              return { data: pharmacy, error: null };
            }
            return { data: null, error: null };
          },
          limit: async () => ({ data: [], error: null }),
          ilike: () => ({
            neq: () => ({
              limit: async () => ({ data: [], error: null })
            })
          })
        }),
        ilike: () => ({
          neq: () => ({
            limit: async () => ({ data: [], error: null })
          })
        })
      }),
      insert: async () => ({ data: null, error: null }),
      update: () => ({
        eq: async () => ({ data: null, error: null })
      })
    }),
    getUpdateUserCalls: () => updateUserCalls,
    getLastUpdateUserArg: () => lastUpdateUserArg,
    getRpcCalls: () => rpcCalls,
    getLastRpcArg: () => lastRpcArg
  };

  return client;
}

describe('First-Login Password Flow & Security Verification', () => {
  afterEach(() => {
    _setCurrentUserForTesting(null);
    _setSupabaseClientForTesting(null);
    clearSupabase();
  });

  // ─── 1. Login & Flag Discovery ─────────────────────────────────────────────
  describe('Login & Flag Detection', () => {
    it('forces password change when app_users.must_change_password is true', async () => {
      const mock = createMockClient({
        user: { id: 'usr-1', email: 'admin@test.com', user_metadata: {} },
        appUser: {
          id: 'usr-1',
          username: 'admin1',
          role: 'admin',
          pharmacy_id: 'ph-1',
          branch_id: 'br-1',
          must_change_password: true
        }
      });
      _setSupabaseClientForTesting(mock);

      const res = await loginUser('admin@test.com', 'TemporaryPass1');
      assert.equal(res.success, true);
      assert.equal(res.mustChangePassword, true);
      const current = getCurrentUser();
      assert.equal(current.mustChangePassword, true);
    });

    it('metadata flag alone does NOT trigger forced change when app_users flag is false', async () => {
      const mock = createMockClient({
        user: {
          id: 'usr-2',
          email: 'admin2@test.com',
          user_metadata: { must_change_password: true }
        },
        appUser: {
          id: 'usr-2',
          username: 'admin2',
          role: 'admin',
          pharmacy_id: 'ph-1',
          branch_id: 'br-1',
          must_change_password: false
        }
      });
      _setSupabaseClientForTesting(mock);

      const res = await loginUser('admin2@test.com', 'ValidPassword123');
      assert.equal(res.success, true);
      assert.equal(res.mustChangePassword, false);
      const current = getCurrentUser();
      assert.equal(current.mustChangePassword, false);
    });

    it('rejects invalid login credentials without setting session', async () => {
      const mock = createMockClient({
        signInError: { message: 'Invalid login credentials' }
      });
      _setSupabaseClientForTesting(mock);

      const res = await loginUser('bad@test.com', 'wrongpassword');
      assert.equal(res.success, false);
      assert.equal(res.error, 'Invalid email or password.');
      assert.equal(getCurrentUser(), null);
    });
  });

  // ─── 2. Password Validation Rules ──────────────────────────────────────────
  describe('Password Validation Rules in changeOwnPassword', () => {
    beforeEach(() => {
      _setCurrentUserForTesting({
        id: 'usr-test',
        username: 'testuser',
        role: 'pharmacist',
        pharmacyId: 'ph-1',
        branchId: 'br-1',
        mustChangePassword: true
      });
    });

    it('rejects non-string password argument', async () => {
      const mock = createMockClient();
      _setSupabaseClientForTesting(mock);

      for (const invalid of [123456789012, null, undefined, {}, []]) {
        const res = await changeOwnPassword(invalid);
        assert.equal(res.success, false);
        assert.match(res.error, /valid string/i);
        assert.equal(mock.getUpdateUserCalls(), 0);
      }
    });

    it('rejects passwords shorter than 10 characters', async () => {
      const mock = createMockClient();
      _setSupabaseClientForTesting(mock);

      const res = await changeOwnPassword('Short1234');
      assert.equal(res.success, false);
      assert.match(res.error, /at least 10 characters/i);
      assert.equal(mock.getUpdateUserCalls(), 0);
    });

    it('accepts password of exactly 72 bytes', async () => {
      const mock = createMockClient();
      _setSupabaseClientForTesting(mock);

      const exact72Bytes = 'A'.repeat(72);
      assert.equal(Buffer.byteLength(exact72Bytes, 'utf8'), 72);

      const res = await changeOwnPassword(exact72Bytes);
      assert.equal(res.success, true);
      assert.equal(mock.getUpdateUserCalls(), 1);
    });

    it('rejects password exceeding 72 bytes (ASCII and multi-byte UTF-8)', async () => {
      const mock = createMockClient();
      _setSupabaseClientForTesting(mock);

      // 73 ASCII bytes
      const pass73Bytes = 'A'.repeat(73);
      assert.equal(Buffer.byteLength(pass73Bytes, 'utf8'), 73);
      const res1 = await changeOwnPassword(pass73Bytes);
      assert.equal(res1.success, false);
      assert.match(res1.error, /cannot exceed 72 bytes/i);
      assert.equal(mock.getUpdateUserCalls(), 0);

      // Multi-byte UTF-8: '€' is 3 bytes in UTF-8. 25 * 3 = 75 bytes (only 25 characters)
      const multiBytePass = '€'.repeat(25);
      assert.equal(Buffer.byteLength(multiBytePass, 'utf8'), 75);
      const res2 = await changeOwnPassword(multiBytePass);
      assert.equal(res2.success, false);
      assert.match(res2.error, /cannot exceed 72 bytes/i);
      assert.equal(mock.getUpdateUserCalls(), 0);
    });

    it('rejects a password of ten spaces', async () => {
      const mock = createMockClient();
      _setSupabaseClientForTesting(mock);

      const res = await changeOwnPassword('          ');
      assert.equal(res.success, false);
      assert.equal(res.error, 'Password cannot be blank or made only of spaces.');
      assert.equal(mock.getUpdateUserCalls(), 0);
    });

    it('accepts password with real characters and leading or trailing spaces and sends it unchanged', async () => {
      const mock = createMockClient();
      _setSupabaseClientForTesting(mock);

      const untrimmed = '  ValidPassword2026!  ';
      const res = await changeOwnPassword(untrimmed);
      assert.equal(res.success, true);
      assert.equal(mock.getUpdateUserCalls(), 1);
      assert.equal(mock.getLastUpdateUserArg().password, untrimmed);
    });

    it('rejects common weak passwords from blocklist', async () => {
      const mock = createMockClient();
      _setSupabaseClientForTesting(mock);

      const weakPasswords = [
        'password123',
        'Password123',
        'PASSWORD1234',
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

      for (const weak of weakPasswords) {
        const res = await changeOwnPassword(weak);
        assert.equal(res.success, false);
        assert.match(res.error, /too common or weak/i);
        assert.equal(mock.getUpdateUserCalls(), 0);
      }
    });
  });

  // ─── 3. Flag Clearing RPC & Retry Flow ─────────────────────────────────────
  describe('RPC Execution & Retry Resilience', () => {
    it('pharmacist flow: RPC returning false leaves flag true and returns passwordAlreadyChanged: true', async () => {
      _setCurrentUserForTesting({
        id: 'pharm-1',
        username: 'pharmacist_user',
        role: 'pharmacist',
        pharmacyId: 'ph-1',
        branchId: 'br-1',
        mustChangePassword: true
      });

      const mock = createMockClient({
        rpcResult: { data: false, error: null }
      });
      _setSupabaseClientForTesting(mock);

      const res = await changeOwnPassword('AValidStrongPass123');
      assert.equal(res.success, false);
      assert.equal(res.passwordAlreadyChanged, true);
      assert.match(res.error, /failed to complete setup/i);
      assert.equal(mock.getUpdateUserCalls(), 1);
      assert.equal(mock.getRpcCalls(), 1);
      assert.equal(getCurrentUser().mustChangePassword, true);
      assert.equal(_getPasswordAlreadyChangedForTesting(), true);
    });

    it('retry after flag failure: skips updateUser, skips validation, and calls only RPC', async () => {
      _setCurrentUserForTesting({
        id: 'admin-1',
        username: 'admin_user',
        role: 'admin',
        pharmacyId: 'ph-1',
        branchId: 'br-1',
        mustChangePassword: true
      });

      let rpcAttempt = 0;
      const mock = createMockClient({
        rpcResult: () => {
          rpcAttempt++;
          if (rpcAttempt === 1) {
            return { data: false, error: null }; // First call fails
          }
          return { data: true, error: null };  // Retry succeeds
        }
      });
      _setSupabaseClientForTesting(mock);

      // Attempt 1: Auth updateUser succeeds, RPC returns false
      const res1 = await changeOwnPassword('StrongPassword2026!');
      assert.equal(res1.success, false);
      assert.equal(res1.passwordAlreadyChanged, true);
      assert.equal(mock.getUpdateUserCalls(), 1);
      assert.equal(mock.getRpcCalls(), 1);
      assert.equal(_getPasswordAlreadyChangedForTesting(), true);

      // Attempt 2 (Retry): password validation skipped (even an empty or different string doesn't fail validation),
      // updateUser is skipped, and RPC is called.
      const res2 = await changeOwnPassword('');
      assert.equal(res2.success, true);
      assert.equal(mock.getUpdateUserCalls(), 1); // Still 1! updateUser was NOT called on retry
      assert.equal(mock.getRpcCalls(), 2);         // RPC was called a second time
      assert.equal(getCurrentUser().mustChangePassword, false);
      assert.equal(_getPasswordAlreadyChangedForTesting(), false); // Marker cleared on success
    });

    it('happy path: updateUser succeeds and RPC returns true -> flag cleared', async () => {
      _setCurrentUserForTesting({
        id: 'usr-happy',
        username: 'happyuser',
        role: 'admin',
        pharmacyId: 'ph-1',
        branchId: 'br-1',
        mustChangePassword: true
      });

      const mock = createMockClient({
        rpcResult: { data: true, error: null }
      });
      _setSupabaseClientForTesting(mock);

      const res = await changeOwnPassword('SuperSecurePass2026!');
      assert.equal(res.success, true);
      assert.equal(mock.getUpdateUserCalls(), 1);
      assert.equal(mock.getRpcCalls(), 1);
      assert.equal(mock.getLastRpcArg().fnName, 'fn_clear_own_must_change_password');
      assert.equal(getCurrentUser().mustChangePassword, false);
      assert.equal(_getPasswordAlreadyChangedForTesting(), false);
    });

    it('auth failure resilience: updateUser fails -> RPC never called, flag stays true', async () => {
      _setCurrentUserForTesting({
        id: 'usr-fail',
        username: 'failuser',
        role: 'admin',
        pharmacyId: 'ph-1',
        branchId: 'br-1',
        mustChangePassword: true
      });

      const mock = createMockClient({
        updateUserError: { message: 'Supabase Auth network error' }
      });
      _setSupabaseClientForTesting(mock);

      const res = await changeOwnPassword('ValidPassword123');
      assert.equal(res.success, false);
      assert.equal(res.error, 'Supabase Auth network error');
      assert.equal(mock.getUpdateUserCalls(), 1);
      assert.equal(mock.getRpcCalls(), 0); // RPC NOT called
      assert.equal(getCurrentUser().mustChangePassword, true);
      assert.equal(_getPasswordAlreadyChangedForTesting(), false);
    });

    it('thrown error after marker is set returns passwordAlreadyChanged: true and does not leak err.message', async () => {
      _setCurrentUserForTesting({
        id: 'usr-throw-after',
        username: 'throw_after_user',
        role: 'admin',
        pharmacyId: 'ph-1',
        branchId: 'br-1',
        mustChangePassword: true
      });

      const mock = createMockClient({
        rpcResult: () => {
          throw new Error('Supabase RPC connection reset violently');
        }
      });
      _setSupabaseClientForTesting(mock);

      const res = await changeOwnPassword('StrongPassword2026!');
      assert.equal(res.success, false);
      assert.equal(res.passwordAlreadyChanged, true);
      assert.equal(res.error, 'Password was updated, but setup did not finish. Please click Finish Setup to retry.');
      assert.equal(res.error.includes('violently'), false);
      assert.equal(mock.getUpdateUserCalls(), 1);
      assert.equal(mock.getRpcCalls(), 1);
      assert.equal(_getPasswordAlreadyChangedForTesting(), true);
    });

    it('thrown error before marker is set does not return passwordAlreadyChanged and does not leak err.message', async () => {
      _setCurrentUserForTesting({
        id: 'usr-throw-before',
        username: 'throw_before_user',
        role: 'admin',
        pharmacyId: 'ph-1',
        branchId: 'br-1',
        mustChangePassword: true
      });

      const mock = createMockClient();
      mock.auth.updateUser = async () => {
        throw new Error('Supabase Auth network socket exploded');
      };
      _setSupabaseClientForTesting(mock);

      const res = await changeOwnPassword('StrongPassword2026!');
      assert.equal(res.success, false);
      assert.equal(res.passwordAlreadyChanged, undefined);
      assert.equal(res.error, 'Failed to update password.');
      assert.equal(res.error.includes('exploded'), false);
      assert.equal(getCurrentUser().mustChangePassword, true);
      assert.equal(_getPasswordAlreadyChangedForTesting(), false);
    });

    it('retry with an empty password still reaches the flag step', async () => {
      _setCurrentUserForTesting({
        id: 'usr-retry-empty',
        username: 'retry_empty_user',
        role: 'pharmacist',
        pharmacyId: 'ph-1',
        branchId: 'br-1',
        mustChangePassword: true
      });

      let rpcCallCount = 0;
      const mock = createMockClient({
        rpcResult: () => {
          rpcCallCount++;
          if (rpcCallCount === 1) {
            return { data: false, error: null }; // First call fails
          }
          return { data: true, error: null };  // Retry succeeds
        }
      });
      _setSupabaseClientForTesting(mock);

      // Attempt 1: Password set, flag RPC returns false
      const res1 = await changeOwnPassword('InitialStrongPassword123');
      assert.equal(res1.success, false);
      assert.equal(res1.passwordAlreadyChanged, true);
      assert.equal(mock.getUpdateUserCalls(), 1);
      assert.equal(mock.getRpcCalls(), 1);
      assert.equal(_getPasswordAlreadyChangedForTesting(), true);

      // Attempt 2: Retry with empty string '' as password (from hidden field)
      const res2 = await changeOwnPassword('');
      assert.equal(res2.success, true);
      assert.equal(mock.getUpdateUserCalls(), 1); // Not called again
      assert.equal(mock.getRpcCalls(), 2);         // RPC was called
      assert.equal(getCurrentUser().mustChangePassword, false);
      assert.equal(_getPasswordAlreadyChangedForTesting(), false);
    });
  });

  // ─── 4. Guarded Administrative Handlers ────────────────────────────────────
  describe('Administrative IPC Handler mustChangePassword Checks', () => {
    it('createUserAccount, updateUsername, updateUserBranch refuse when mustChangePassword is true', async () => {
      _setCurrentUserForTesting({
        id: 'adm-guarded',
        username: 'guarded_admin',
        role: 'admin',
        pharmacyId: 'ph-1',
        branchId: 'br-1',
        canViewAllBranches: true,
        mustChangePassword: true
      });

      const resCreate = await createUserAccount('newuser', 'New User', 'Pass12345678', 'pharmacist', 'br-1');
      assert.equal(resCreate.success, false);
      assert.equal(resCreate.error, 'Unauthorized: Password change required.');

      const resUpdateUser = await updateUsername('usr-2', 'newname', 'New Display');
      assert.equal(resUpdateUser.success, false);
      assert.equal(resUpdateUser.error, 'Unauthorized: Password change required.');

      const resUpdateBranch = await updateUserBranch('usr-2', 'br-2');
      assert.equal(resUpdateBranch.success, false);
      assert.equal(resUpdateBranch.error, 'Unauthorized: Password change required.');
    });

    it('createUserAccount, updateUsername, updateUserBranch proceed past mustChangePassword check when false', async () => {
      _setCurrentUserForTesting({
        id: 'adm-cleared',
        username: 'cleared_admin',
        role: 'admin',
        pharmacyId: 'ph-1',
        branchId: 'br-1',
        canViewAllBranches: true,
        mustChangePassword: false
      });

      const mock = createMockClient();
      _setSupabaseClientForTesting(mock);

      // createUserAccount passes auth check and reaches the server-side function notice
      const resCreate = await createUserAccount('newuser', 'New User', 'Pass12345678', 'pharmacist', 'br-1');
      assert.equal(resCreate.success, false);
      assert.match(resCreate.error, /server-side function/i);

      // updateUsername passes auth check and succeeds with mock
      const resUpdateUser = await updateUsername('usr-2', 'newname', 'New Display');
      assert.equal(resUpdateUser.success, true);

      // updateUserBranch passes auth check and succeeds with mock
      const resUpdateBranch = await updateUserBranch('usr-2', 'br-2');
      assert.equal(resUpdateBranch.success, true);
    });
  });

  // ─── 5. UI AST Verification ───────────────────────────────────────────────
  describe('LoginScreen UI AST & Form Structure Verification', () => {
    it('verifies LoginScreen handles passwordAlreadyChanged state and hides password fields', () => {
      const code = fs.readFileSync(path.resolve('src/components/LoginScreen.jsx'), 'utf-8');
      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator']
      });

      let hasState = false;
      let hasSetStateCall = false;
      let hasConditionalInputs = false;
      let hasFinishSetupText = false;
      let hasWeakPasswordList = false;
      let hasTrimValidation = false;

      traverse(ast, {
        Identifier(path) {
          if (path.node.name === 'passwordAlreadyChanged') {
            hasState = true;
          }
          if (path.node.name === 'setPasswordAlreadyChanged') {
            hasSetStateCall = true;
          }
          if (path.node.name === 'COMMON_WEAK_PASSWORDS') {
            hasWeakPasswordList = true;
          }
        },
        MemberExpression(path) {
          if (path.node.property?.name === 'trim') {
            hasTrimValidation = true;
          }
        },
        StringLiteral(path) {
          if (path.node.value.includes('Finish Setup & Continue') || path.node.value.includes('Finish Account Setup')) {
            hasFinishSetupText = true;
          }
        },
        UnaryExpression(path) {
          if (path.node.operator === '!' && path.node.argument?.name === 'passwordAlreadyChanged') {
            hasConditionalInputs = true;
          }
        }
      });

      assert.equal(hasState, true, 'LoginScreen must declare passwordAlreadyChanged state');
      assert.equal(hasSetStateCall, true, 'LoginScreen must update passwordAlreadyChanged state when response carries passwordAlreadyChanged');
      assert.equal(hasTrimValidation, true, 'LoginScreen must check trim() on new password to reject whitespace-only passwords');
      assert.equal(hasWeakPasswordList, true, 'LoginScreen must declare COMMON_WEAK_PASSWORDS');
      assert.equal(hasFinishSetupText, true, 'LoginScreen must render Finish Setup on retry');
      assert.equal(hasConditionalInputs, true, 'LoginScreen must conditionally render input fields using !passwordAlreadyChanged');
    });
  });
});
