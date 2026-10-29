import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

// Import the REAL functions from electron modules
import { requireSuperAdmin } from '../electron/api.js';
import { _setCurrentUserForTesting, getCurrentUser, loginUser } from '../electron/auth.js';

import { _setSupabaseClientForTesting, clearSupabase } from '../electron/supabaseClient.js';

const traverse = traverseModule.default || traverseModule;

function createMockSupabaseClient({
  signInError = null,
  user = null,
  session = null,
  appUser = null,
  appUserError = null,
  pharmacy = null,
  shouldThrow = false
} = {}) {
  if (shouldThrow) {
    return {
      auth: {
        signInWithPassword: async () => {
          throw new Error('Supabase network connection reset');
        }
      }
    };
  }

  return {
    auth: {
      signInWithPassword: async () => {
        if (signInError) return { data: null, error: signInError };
        return {
          data: {
            user: user || { id: 'usr-123', email: 'admin@pharmacore.com' },
            session: session || { access_token: 'mock-access-token', refresh_token: 'mock-refresh-token' }
          },
          error: null
        };
      },
      setSession: async () => ({ data: { user }, error: null }),
      signOut: async () => {}
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
          }
        })
      }),
      insert: async () => ({ data: null, error: null })
    })
  };
}

describe('SuperAdmin Access Control & Handlers', () => {
  afterEach(() => {
    // Clean up test user session & injected clients after each test
    _setCurrentUserForTesting(null);
    _setSupabaseClientForTesting(null);
    clearSupabase();
  });

  describe('requireSuperAdmin (real function from electron/api.js)', () => {
    it('throws "Unauthorized: Please log in." when no user is logged in', () => {
      _setCurrentUserForTesting(null);
      assert.equal(getCurrentUser(), null);

      assert.throws(
        () => requireSuperAdmin(),
        {
          name: 'Error',
          message: 'Unauthorized: Please log in.'
        }
      );
    });

    it('throws "Forbidden: SaaS Platform SuperAdmin access required." for pharmacist role', () => {
      _setCurrentUserForTesting({
        id: 'user-pharm-123',
        username: 'pharmacist1',
        role: 'pharmacist',
        pharmacyId: 'pharm-123'
      });

      assert.throws(
        () => requireSuperAdmin(),
        {
          name: 'Error',
          message: 'Forbidden: SaaS Platform SuperAdmin access required.'
        }
      );
    });

    it('throws "Forbidden: SaaS Platform SuperAdmin access required." for admin (tenant owner) role', () => {
      _setCurrentUserForTesting({
        id: 'user-admin-456',
        username: 'tenant_admin',
        role: 'admin',
        pharmacyId: 'pharm-123'
      });

      assert.throws(
        () => requireSuperAdmin(),
        {
          name: 'Error',
          message: 'Forbidden: SaaS Platform SuperAdmin access required.'
        }
      );
    });

    it('returns the user object and does not throw for superadmin role', () => {
      const superAdminUser = {
        id: 'user-super-789',
        username: 'platform_owner',
        role: 'superadmin',
        pharmacyId: null
      };
      _setCurrentUserForTesting(superAdminUser);

      const result = requireSuperAdmin();
      assert.deepEqual(result, superAdminUser);
    });
  });

  describe('Option A Login Security with Mocked Supabase Client (electron/auth.js)', () => {
    it('returns exact same error "Invalid email or password." for empty email or password without calling client', async () => {
      const mockClient = createMockSupabaseClient();
      _setSupabaseClientForTesting(mockClient);

      const resEmptyEmail = await loginUser('', 'secret123');
      assert.deepEqual(resEmptyEmail, { success: false, error: 'Invalid email or password.' });

      const resEmptyPass = await loginUser('admin@test.com', '');
      assert.deepEqual(resEmptyPass, { success: false, error: 'Invalid email or password.' });

      const resNoAt = await loginUser('invaliduser', 'secret123');
      assert.deepEqual(resNoAt, { success: false, error: 'Invalid email or password.' });
    });

    it('returns exact same error "Invalid email or password." when client auth.signInWithPassword fails', async () => {
      const mockClient = createMockSupabaseClient({
        signInError: new Error('Invalid login credentials')
      });
      _setSupabaseClientForTesting(mockClient);

      const res = await loginUser('nonexistent@example.com', 'wrongpassword');
      assert.deepEqual(res, { success: false, error: 'Invalid email or password.' });
    });

    it('returns exact same error "Invalid email or password." when client returns user but app_users profile is missing', async () => {
      const mockClient = createMockSupabaseClient({
        user: { id: 'usr-999', email: 'orphaned@example.com' },
        appUser: null // No matching row in app_users
      });
      _setSupabaseClientForTesting(mockClient);

      const res = await loginUser('orphaned@example.com', 'correctpassword');
      assert.deepEqual(res, { success: false, error: 'Invalid email or password.' });
    });

    it('returns exact same error "Invalid email or password." when client throws an unexpected error', async () => {
      const mockClient = createMockSupabaseClient({ shouldThrow: true });
      _setSupabaseClientForTesting(mockClient);

      const res = await loginUser('admin@example.com', 'mypassword');
      assert.deepEqual(res, { success: false, error: 'Invalid email or password.' });
    });

    it('returns success: true and initializes session when client returns valid user and app_users record', async () => {
      const mockClient = createMockSupabaseClient({
        user: { id: 'usr-1', email: 'owner@pharmacore.com' },
        appUser: {
          id: 'usr-1',
          username: 'superadmin',
          display_name: 'Platform SuperAdmin',
          role: 'superadmin',
          pharmacy_id: null,
          can_view_all_branches: true
        }
      });
      _setSupabaseClientForTesting(mockClient);

      const res = await loginUser('owner@pharmacore.com', 'valid-password');
      assert.equal(res.success, true);
      assert.equal(res.username, 'superadmin');
      assert.equal(res.role, 'superadmin');

      const currentUser = getCurrentUser();
      assert.equal(currentUser.id, 'usr-1');
      assert.equal(currentUser.role, 'superadmin');
    });
  });
});

describe('Settings Screen Regression Test (fetchSettingsAndDb Bug)', () => {
  const filePath = path.resolve('src/components/SaasSettingsScreen.jsx');

  it('SaasSettingsScreen.jsx file exists and contains no reference to fetchSettingsAndDb', () => {
    assert.ok(fs.existsSync(filePath), 'SaasSettingsScreen.jsx must exist');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Regression: fetchSettingsAndDb was an undeclared identifier causing a white-screen crash
    assert.ok(
      !content.includes('fetchSettingsAndDb'),
      'SaasSettingsScreen.jsx must NOT contain the undefined identifier fetchSettingsAndDb'
    );

    // Verify the correct fetchSettings is referenced in onClick
    assert.ok(
      content.includes('onClick={fetchSettings}'),
      'SaasSettingsScreen.jsx must bind the retry/refresh button to fetchSettings'
    );
  });

  it('SaasSettingsScreen.jsx AST has zero undefined identifier references', () => {
    const code = fs.readFileSync(filePath, 'utf-8');
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator']
    });

    const knownGlobals = new Set([
      'window', 'document', 'console', 'setTimeout', 'setInterval', 'clearInterval', 'clearTimeout',
      'Date', 'Math', 'JSON', 'Promise', 'FileReader', 'URL', 'alert', 'confirm', 'prompt',
      'parseFloat', 'parseInt', 'isNaN', 'isFinite', 'Array', 'Object', 'String', 'Boolean', 'Number',
      'Error', 'React', 'process', 'globalThis', 'Blob', 'File', 'FormData'
    ]);

    const undefinedIdentifiers = [];

    traverse(ast, {
      Identifier(p) {
        if (!p.isReferencedIdentifier()) return;
        const name = p.node.name;
        if (knownGlobals.has(name)) return;
        if (!p.scope.hasBinding(name)) {
          if (name === 'React') return;
          undefinedIdentifiers.push({
            name,
            line: p.node.loc?.start?.line
          });
        }
      }
    });

    assert.deepEqual(
      undefinedIdentifiers,
      [],
      `Expected no undefined identifiers in SaasSettingsScreen.jsx, but found: ${JSON.stringify(undefinedIdentifiers)}`
    );
  });
});
