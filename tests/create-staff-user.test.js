import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import * as authModule from '../electron/auth.js';
const {
  createUserAccount,
  loginUser,
  updateUsername,
  _setCurrentUserForTesting,
  STAFF_EMAIL_DOMAIN
} = authModule;
import { _setSupabaseClientForTesting, clearSupabase } from '../electron/supabaseClient.js';
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

describe('PharmaCore Staff Creation, Staff Sign-In & User Limit Suite (Desktop & UI)', () => {
  const validBranchId = 'b1234567-89ab-4cde-8f01-23456789abcd';
  const adminUser = {
    id: 'admin-uuid-1',
    username: 'pharmacy_owner',
    role: 'admin',
    pharmacyId: 'pharm-uuid-1',
    branchId: validBranchId,
    canViewAllBranches: true,
    mustChangePassword: false
  };

  beforeEach(() => {
    _setCurrentUserForTesting({ ...adminUser });
  });

  afterEach(() => {
    _setCurrentUserForTesting(null);
    _setSupabaseClientForTesting(null);
    clearSupabase();
  });

  describe('1. createUserAccount() Desktop Client & Edge Function Invocation', () => {
    it('calls create-staff-user Edge Function with caller Bearer token and exact 4 whitelisted keys', async () => {
      let capturedFn = null;
      let capturedHeaders = null;
      let capturedBody = null;
      const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.admin-session-token';
      const mockTempPass = 'StaffTemp99!Abcd';

      _setSupabaseClientForTesting({
        auth: {
          getSession: async () => ({ data: { session: { access_token: mockToken } } })
        },
        functions: {
          invoke: async (fnName, opts) => {
            capturedFn = fnName;
            capturedHeaders = opts.headers;
            capturedBody = opts.body;
            return {
              data: {
                success: true,
                temporaryPassword: mockTempPass,
                user: {
                  id: 'u-new-1',
                  username: 'pharmacist_ali',
                  displayName: 'Ali Raza',
                  role: 'pharmacist',
                  branchId: validBranchId
                }
              },
              error: null
            };
          }
        }
      });

      const res = await createUserAccount('  Pharmacist_Ali ', ' Ali Raza ', 'pharmacist', validBranchId);
      assert.equal(res.success, true, `Expected createUserAccount to succeed, got: ${res.error}`);
      assert.equal(res.temporaryPassword, mockTempPass);
      assert.equal(res.user?.username, 'pharmacist_ali');
      assert.equal(capturedFn, 'create-staff-user');
      assert.equal(capturedHeaders?.Authorization, `Bearer ${mockToken}`);
      assert.deepEqual(capturedBody, {
        username: 'pharmacist_ali',
        displayName: 'Ali Raza',
        role: 'pharmacist',
        branchId: validBranchId
      });
      assert.equal(validatePassword(res.temporaryPassword).valid, true);
    });

    it('rejects unauthenticated, mustChangePassword, pharmacist, and superadmin callers locally without network calls', async () => {
      let invoked = false;
      _setSupabaseClientForTesting({
        auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
        functions: {
          invoke: async () => {
            invoked = true;
            return { data: null, error: null };
          }
        }
      });

      _setCurrentUserForTesting(null);
      const unauth = await createUserAccount('staff_one', 'Staff One', 'pharmacist', validBranchId);
      assert.equal(unauth.success, false);

      _setCurrentUserForTesting({ ...adminUser, mustChangePassword: true });
      const mustChange = await createUserAccount('staff_one', 'Staff One', 'pharmacist', validBranchId);
      assert.equal(mustChange.success, false);
      assert.match(mustChange.error, /Password change required/i);

      _setCurrentUserForTesting({ ...adminUser, role: 'pharmacist' });
      const pharm = await createUserAccount('staff_one', 'Staff One', 'pharmacist', validBranchId);
      assert.equal(pharm.success, false);
      assert.match(pharm.error, /Unauthori|admin|Only pharmacy owners/i);

      _setCurrentUserForTesting({ ...adminUser, role: 'superadmin', pharmacyId: null });
      const superCaller = await createUserAccount('staff_one', 'Staff One', 'pharmacist', validBranchId);
      assert.equal(superCaller.success, false);

      assert.equal(invoked, false, 'Edge Function must not be called when local auth/role checks fail');
    });

    it('rejects role admin/superadmin, invalid username, and invalid branchId locally', async () => {
      let invoked = false;
      _setSupabaseClientForTesting({
        auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
        functions: {
          invoke: async () => {
            invoked = true;
            return { data: null, error: null };
          }
        }
      });

      const adminRoleRes = await createUserAccount('staff_one', 'Staff One', 'admin', validBranchId);
      assert.equal(adminRoleRes.success, false);

      const superRoleRes = await createUserAccount('staff_one', 'Staff One', 'superadmin', validBranchId);
      assert.equal(superRoleRes.success, false);

      const shortUser = await createUserAccount('ab', 'Staff One', 'pharmacist', validBranchId);
      assert.equal(shortUser.success, false);

      const badCharsUser = await createUserAccount('bad-user!', 'Staff One', 'pharmacist', validBranchId);
      assert.equal(badCharsUser.success, false);

      const badBranch = await createUserAccount('staff_one', 'Staff One', 'pharmacist', 'not-a-uuid');
      assert.equal(badBranch.success, false);

      assert.equal(invoked, false, 'Edge Function must not be called on invalid local arguments');
    });

    it('surfaces Edge Function error messages cleanly (e.g. duplicate username or quota reached)', async () => {
      _setSupabaseClientForTesting({
        auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
        functions: {
          invoke: async () => ({
            data: null,
            error: {
              message: 'Edge Function returned a non-2xx status code',
              context: {
                status: 409,
                json: async () => ({ success: false, error: 'Username is already taken. Please choose a different username.' })
              }
            }
          })
        }
      });

      const res = await createUserAccount('staff_one', 'Staff One', 'pharmacist', validBranchId);
      assert.equal(res.success, false);
      assert.equal(res.error, 'Username is already taken. Please choose a different username.');
    });
  });

  describe('2. Option B Staff Username Sign-In (loginUser & STAFF_EMAIL_DOMAIN)', () => {
    it('exports STAFF_EMAIL_DOMAIN constant as staff.pharmacore.invalid', () => {
      assert.equal(STAFF_EMAIL_DOMAIN, 'staff.pharmacore.invalid');
    });

    it('maps bare valid staff username locally to @staff.pharmacore.invalid without any DB lookup', async () => {
      let signInEmail = null;
      let dbQueries = 0;

      _setSupabaseClientForTesting({
        auth: {
          signInWithPassword: async ({ email }) => {
            signInEmail = email;
            return {
              data: {
                user: { id: 'staff-1', email },
                session: { access_token: 'tok', refresh_token: 'ref' }
              },
              error: null
            };
          },
          setSession: async () => ({ data: {}, error: null })
        },
        from: (table) => {
          dbQueries++;
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  if (table === 'app_users') {
                    return {
                      data: {
                        id: 'staff-1',
                        username: 'pharmacist_ali',
                        display_name: 'Ali Raza',
                        role: 'pharmacist',
                        pharmacy_id: 'pharm-1',
                        branch_id: validBranchId,
                        can_view_all_branches: false,
                        must_change_password: true
                      },
                      error: null
                    };
                  }
                  if (table === 'pharmacies') {
                    return {
                      data: {
                        name: 'Karachi Meds',
                        plan_tier: 'trial',
                        subscription_status: 'trial',
                        max_branches: 1,
                        max_users: 3,
                        is_active: true
                      },
                      error: null
                    };
                  }
                  return { data: null, error: null };
                }
              })
            }),
            insert: async () => ({ data: null, error: null })
          };
        }
      });

      const res = await loginUser('  Pharmacist_Ali  ', 'StaffTemp99!Abcd');
      assert.equal(res.success, true);
      assert.equal(signInEmail, `pharmacist_ali@${STAFF_EMAIL_DOMAIN}`);
      assert.equal(res.mustChangePassword, true);
      assert.equal(res.role, 'pharmacist');
      // Only post-auth profile, pharmacy, and login_success audit insert should happen; zero pre-auth lookup
      assert.equal(dbQueries, 3);
    });

    it('rejects malformed inputs without @ that fail ^[a-z0-9_]{3,50}$ locally without calling Supabase Auth', async () => {
      let authCalled = false;
      _setSupabaseClientForTesting({
        auth: {
          signInWithPassword: async () => {
            authCalled = true;
            return { data: null, error: new Error('should not be called') };
          }
        }
      });

      for (const badInput of ['ab', 'user name', 'user-name', 'user!123', 'a'.repeat(51)]) {
        const res = await loginUser(badInput, 'Secret123456');
        assert.deepEqual(res, { success: false, error: 'Invalid email or password.' });
      }
      assert.equal(authCalled, false, 'Supabase Auth must not be called for malformed identifiers');
    });
  });

  describe('3. Pharmacist Username Immutability (updateUsername)', () => {
    it('blocks changing username when target user is a pharmacist', async () => {
      let updateCalled = false;
      _setSupabaseClientForTesting({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'staff-1', username: 'pharmacist_ali', role: 'pharmacist' },
                error: null
              })
            }),
            ilike: () => ({ neq: () => ({ limit: async () => ({ data: [], error: null }) }) })
          }),
          update: () => ({
            eq: async () => {
              updateCalled = true;
              return { error: null };
            }
          }),
          insert: async () => ({ error: null })
        })
      });

      const res = await updateUsername('staff-1', 'pharmacist_newname', 'Ali Raza');
      assert.equal(res.success, false);
      assert.match(res.error, /cannot be changed|immutable|login identifier/i);
      assert.equal(updateCalled, false);
    });

    it('allows updating display name for a pharmacist when username is unchanged', async () => {
      let updatedPayload = null;
      _setSupabaseClientForTesting({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'staff-1', username: 'pharmacist_ali', role: 'pharmacist' },
                error: null
              })
            }),
            ilike: () => ({ neq: () => ({ limit: async () => ({ data: [], error: null }) }) })
          }),
          update: (payload) => {
            updatedPayload = payload;
            return { eq: async () => ({ error: null }) };
          },
          insert: async () => ({ error: null })
        })
      });

      const res = await updateUsername('staff-1', 'pharmacist_ali', 'Ali Raza Updated');
      assert.equal(res.success, true);
      assert.deepEqual(updatedPayload, { username: 'pharmacist_ali', display_name: 'Ali Raza Updated' });
    });
  });

  describe('4. Preload, IPC, UsersScreen.jsx & LoginScreen.jsx Structural Checks', () => {
    it('preload.js createUser accepts 4 args (no password) and auth:create-user forwards 4 args', () => {
      const preload = readRepoFile('preload.js');
      assert.match(
        preload,
        /createUser:\s*\(username,\s*displayName,\s*role,\s*branchId\)\s*=>\s*ipcRenderer\.invoke\('auth:create-user',\s*\{\s*username,\s*displayName,\s*role,\s*branchId\s*\}\)/
      );

      const authSrc = readRepoFile('electron/auth.js');
      assert.match(
        authSrc,
        /ipcMain\.handle\('auth:create-user',\s*async\s*\(_event,\s*\{\s*username,\s*displayName,\s*role,\s*branchId\s*\}\)\s*=>\s*createUserAccount\(username,\s*displayName,\s*role,\s*branchId\)\s*\)/
      );
    });

    it('UsersScreen.jsx removes password field and admin role option, shows generated credentials, and locks pharmacist username in Edit modal', () => {
      const src = readRepoFile('src/components/UsersScreen.jsx');
      assert.equal(src.includes('Initial Password (min 8 chars)'), false, 'UsersScreen must remove initial password field');
      assert.equal(src.includes('<option value="admin">'), false, 'UsersScreen must remove Branch Administrator option');
      assert.match(src, /createdCredentials|createdTemporaryPassword|createCredentials/, 'UsersScreen must show created temporary password');
      assert.match(src, /editTarget\.role === 'pharmacist'/, 'UsersScreen Edit modal must handle pharmacist username immutability');
    });

    it('LoginScreen.jsx uses Email or Username label, type="text", autoComplete="username"', () => {
      const src = readRepoFile('src/components/LoginScreen.jsx');
      const ast = parseJsxAst(src);

      let foundIdentifierInput = false;
      traverse(ast, {
        JSXElement(p) {
          if (p.node.openingElement.name?.name === 'input') {
            const attrs = Object.fromEntries(
              p.node.openingElement.attributes
                .filter((a) => a.type === 'JSXAttribute' && a.name)
                .map((a) => [a.name.name, a.value?.value ?? a.value?.expression?.name])
            );
            if (attrs.value === 'username') {
              foundIdentifierInput = true;
              assert.equal(attrs.type, 'text', 'LoginScreen sign-in input must be type="text"');
              assert.equal(attrs.autoComplete, 'username', 'LoginScreen sign-in input must have autoComplete="username"');
            }
          }
        }
      });

      assert.equal(foundIdentifierInput, true, 'Must locate identifier input in LoginScreen.jsx');
      assert.equal(src.includes('Email or Username'), true, 'Label must say "Email or Username"');
    });
  });
});
