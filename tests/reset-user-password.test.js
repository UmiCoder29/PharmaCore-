import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import {
  resetUserPassword,
  _setCurrentUserForTesting,
  registerIpcHandlers
} from '../electron/auth.js';
import { _setSupabaseClientForTesting } from '../electron/supabaseClient.js';
import { validatePassword } from '../electron/passwordPolicy.js';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function parseJsxAst(source) {
  return parse(source, {
    sourceType: 'module',
    plugins: ['jsx']
  });
}

describe('PharmaCore Admin Password Reset Suite (Desktop & IPC)', () => {
  const validUuid = 'c1234567-89ab-4cde-8f01-23456789abcd';
  let originalUser = null;
  let originalClient = null;

  beforeEach(() => {
    _setCurrentUserForTesting({
      id: 'admin-uuid-1',
      username: 'owner_admin',
      role: 'admin',
      pharmacyId: 'pharm-uuid-1'
    });
  });

  afterEach(() => {
    _setCurrentUserForTesting(null);
    _setSupabaseClientForTesting(null);
  });

  describe('1. auth.js resetUserPassword() Desktop Client & Edge Function Invocation', () => {
    it('successfully calls reset-user-password Edge Function with caller session token and returns temporary password', async () => {
      let capturedFunctionName = null;
      let capturedHeaders = null;
      let capturedBody = null;

      const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.caller-admin-token';
      const mockTemporaryPassword = 'TempPass1234!xyz';

      const mockSupabase = {
        auth: {
          getSession: async () => ({
            data: {
              session: {
                access_token: mockToken
              }
            }
          })
        },
        functions: {
          invoke: async (functionName, options) => {
            capturedFunctionName = functionName;
            capturedHeaders = options.headers;
            capturedBody = options.body;
            return {
              data: {
                success: true,
                temporaryPassword: mockTemporaryPassword
              },
              error: null
            };
          }
        }
      };

      _setSupabaseClientForTesting(mockSupabase);

      const res = await resetUserPassword(validUuid);

      assert.equal(res.success, true, 'resetUserPassword must succeed');
      assert.equal(res.temporaryPassword, mockTemporaryPassword);
      assert.equal(capturedFunctionName, 'reset-user-password');
      assert.equal(capturedHeaders?.Authorization, `Bearer ${mockToken}`);
      assert.deepEqual(capturedBody, { userId: validUuid });
    });

    it('rejects unauthenticated callers locally before invoking the network', async () => {
      _setCurrentUserForTesting(null);
      const res = await resetUserPassword(validUuid);
      assert.equal(res.success, false);
      assert.match(res.error, /Unauthorized|log in/i);
    });

    it('rejects pharmacist callers locally before invoking the network', async () => {
      _setCurrentUserForTesting({
        id: 'pharm-1',
        username: 'staff_pharm',
        role: 'pharmacist',
        pharmacyId: 'pharm-uuid-1'
      });
      const res = await resetUserPassword(validUuid);
      assert.equal(res.success, false);
      assert.match(res.error, /Forbidden|Admin access required/i);
    });

    it('rejects invalid or malformed userId before invoking the network', async () => {
      const invalidIds = ['', '   ', 'not-a-uuid', '12345', null, undefined, 12345];
      for (const badId of invalidIds) {
        const res = await resetUserPassword(badId);
        assert.equal(res.success, false, `Expected rejection for bad ID: ${badId}`);
        assert.match(res.error, /Invalid user/i);
      }
    });

    it('temporary password returned meets system password policy (12+ chars, letters and numbers)', async () => {
      const mockTemporaryPassword = 'SecureP@ssw0rd99';
      const mockSupabase = {
        auth: {
          getSession: async () => ({
            data: { session: { access_token: 'mock-token' } }
          })
        },
        functions: {
          invoke: async () => ({
            data: { success: true, temporaryPassword: mockTemporaryPassword },
            error: null
          })
        }
      };
      _setSupabaseClientForTesting(mockSupabase);

      const res = await resetUserPassword(validUuid);
      assert.equal(res.success, true);
      const policyCheck = validatePassword(res.temporaryPassword);
      assert.equal(policyCheck.valid, true, `Temporary password must satisfy password policy: ${policyCheck.error}`);
    });
  });

  describe('2. IPC Handler Consistency & Cleanup (api.js & auth.js)', () => {
    it('electron/auth.js registers auth:reset-user-password handler', () => {
      const registered = [];
      const mockIpcMain = {
        handle: (channel) => registered.push(channel)
      };
      registerIpcHandlers(mockIpcMain);
      assert.equal(registered.includes('auth:reset-user-password'), true);
    });

    it('electron/api.js does not contain duplicate unimported api:reset-user-password handler', () => {
      const source = readRepoFile('electron/api.js');
      assert.equal(
        source.includes("'api:reset-user-password'"),
        false,
        'Duplicate api:reset-user-password handler must be removed from api.js'
      );
    });
  });

  describe('3. UsersScreen.jsx UI Architecture (No Client-Typed Password)', () => {
    it('UsersScreen.jsx source does not contain typed password inputs or 8-character minimum checks in reset modal', () => {
      const source = readRepoFile('src/components/UsersScreen.jsx');
      assert.equal(
        source.includes('New Password (min 8 chars)'),
        false,
        'UsersScreen must not contain 8-character minimum password fields in reset modal'
      );
      assert.equal(
        source.includes('resetNewPassword.length < 8'),
        false,
        'UsersScreen must not validate client-typed 8-character reset passwords'
      );
      assert.equal(
        source.includes('resetNewPassword'),
        false,
        'UsersScreen must not prompt the admin to type a new password'
      );
      assert.equal(
        source.includes('resetConfirmPassword'),
        false,
        'UsersScreen must not prompt for confirm password'
      );
    });

    it('UsersScreen.jsx contains temporary password copy display and next sign-in warning', () => {
      const source = readRepoFile('src/components/UsersScreen.jsx');
      assert.equal(
        source.includes('temporary password') || source.includes('Temporary Password'),
        true,
        'UsersScreen must present generated temporary password'
      );
      assert.match(
        source,
        /change it at next sign-in|must change|next login/i,
        'UsersScreen must warn that password must be changed at next sign-in'
      );
    });

    it('UsersScreen.jsx restricts reset button to admin viewing pharmacist (never self, never admin)', () => {
      const source = readRepoFile('src/components/UsersScreen.jsx');
      assert.match(
        source,
        /user\?\.role === 'admin' && u\.role === 'pharmacist' && u\.id !== user\.id/,
        'UsersScreen reset button must only be shown for pharmacist rows by admin'
      );
    });
  });

  describe('4. SaasAdminScreen.jsx & Superadmin Owner Reset Architecture', () => {
    it('SaasAdminScreen.jsx displays owner reset button only when ownerId exists', () => {
      const source = readRepoFile('src/components/SaasAdminScreen.jsx');
      assert.equal(
        source.includes('handleOpenResetOwner'),
        true,
        'SaasAdminScreen must have owner reset handler'
      );
      assert.equal(
        source.includes('pharm.ownerId'),
        true,
        'SaasAdminScreen must check for pharm.ownerId before rendering reset button'
      );
    });

    it('SaasAdminScreen.jsx invokes resetUserPassword and presents one-time credentials modal', () => {
      const source = readRepoFile('src/components/SaasAdminScreen.jsx');
      assert.equal(
        source.includes('resetUserPassword(resetOwnerTarget.ownerId)'),
        true,
        'SaasAdminScreen must invoke resetUserPassword with ownerId'
      );
      assert.equal(
        source.includes('resetOwnerTempPass'),
        true,
        'SaasAdminScreen must store and display generated temporary password'
      );
    });

    it('electron/api.js saas:get-pharmacies enriches pharmacies with owner in a single query', () => {
      const source = readRepoFile('electron/api.js');
      assert.match(
        source,
        /from\('app_users'\)\s*\.select\('id,\s*username,\s*display_name,\s*pharmacy_id,\s*created_at'\)/,
        'saas:get-pharmacies must query app_users for admins'
      );
      assert.match(
        source,
        /order\('created_at',\s*\{\s*ascending:\s*true\s*\}\)/,
        'saas:get-pharmacies must order app_users by created_at ascending to find oldest admin'
      );
    });
  });
});
