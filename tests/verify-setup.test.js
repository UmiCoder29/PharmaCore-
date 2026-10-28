import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getKeyType,
  classifySelectTenantTable,
  classifyMutation,
  classifyPublicPlans,
  classifyPlatformSettings,
  classifyRpc,
  runChecks,
  TENANT_TABLES,
  RPC_DEFINITIONS
} from '../scripts/verify-setup.mjs';

function makeMockJwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role, exp: 1893456000 })).toString('base64url');
  return `${header}.${payload}.mockSignature`;
}

describe('Setup Verification Pure Logic & Classifiers (No Network)', () => {
  describe('getKeyType', () => {
    it('identifies modern sb_publishable_ keys', () => {
      const type = getKeyType('sb_publishable_example1234567890');
      assert.match(type, /modern publishable key/);
    });

    it('identifies legacy anon JWTs', () => {
      const anonJwt = makeMockJwt('anon');
      const type = getKeyType(anonJwt);
      assert.match(type, /legacy anon JWT/);
    });

    it('identifies service_role JWTs', () => {
      const serviceJwt = makeMockJwt('service_role');
      const type = getKeyType(serviceJwt);
      assert.match(type, /service_role/);
    });

    it('identifies sb_secret_ keys as secret keys', () => {
      const type = getKeyType('sb_secret_example_999');
      assert.match(type, /SECRET KEY/);
    });

    it('identifies unrecognized key strings', () => {
      const type = getKeyType('unrecognized_raw_string');
      assert.match(type, /unrecognized/);
    });
  });

  describe('classifySelectTenantTable', () => {
    it('passes on HTTP 401 and 403', () => {
      const res401 = classifySelectTenantTable(401, { message: 'permission denied' });
      assert.strictEqual(res401.pass, true);
      assert.strictEqual(res401.statusLabel, 'PASS');

      const res403 = classifySelectTenantTable(403, { message: 'permission denied' });
      assert.strictEqual(res403.pass, true);
      assert.strictEqual(res403.statusLabel, 'PASS');
    });

    it('fails on HTTP 200 even if rows array is empty (privilege exists)', () => {
      const res200Empty = classifySelectTenantTable(200, []);
      assert.strictEqual(res200Empty.pass, false);
      assert.strictEqual(res200Empty.statusLabel, 'FAIL');
      assert.match(res200Empty.detail, /privilege/);

      const res200Data = classifySelectTenantTable(200, [{ id: '1' }]);
      assert.strictEqual(res200Data.pass, false);
      assert.strictEqual(res200Data.statusLabel, 'FAIL');
    });

    it('reports unexpected status as INCONCLUSIVE', () => {
      const res404 = classifySelectTenantTable(404, { message: 'not found' });
      assert.strictEqual(res404.pass, false);
      assert.strictEqual(res404.statusLabel, 'INCONCLUSIVE');

      const res500 = classifySelectTenantTable(500, { message: 'internal error' });
      assert.strictEqual(res500.pass, false);
      assert.strictEqual(res500.statusLabel, 'INCONCLUSIVE');
    });
  });

  describe('classifyMutation', () => {
    it('passes on HTTP 401 and 403', () => {
      const res401 = classifyMutation(401, 'INSERT');
      assert.strictEqual(res401.pass, true);
      assert.strictEqual(res401.statusLabel, 'PASS');

      const res403 = classifyMutation(403, 'PATCH');
      assert.strictEqual(res403.pass, true);
      assert.strictEqual(res403.statusLabel, 'PASS');
    });

    it('fails on 200, 201, and 204 successful mutation codes', () => {
      assert.strictEqual(classifyMutation(200, 'PATCH').pass, false);
      assert.strictEqual(classifyMutation(201, 'INSERT').pass, false);
      assert.strictEqual(classifyMutation(204, 'DELETE').pass, false);
    });

    it('fails on HTTP 400 validation error (indicates table permission exists)', () => {
      const res400 = classifyMutation(400, 'INSERT');
      assert.strictEqual(res400.pass, false);
      assert.strictEqual(res400.statusLabel, 'FAIL');
      assert.match(res400.detail, /table privilege/);
    });

    it('reports unexpected status as INCONCLUSIVE', () => {
      assert.strictEqual(classifyMutation(404, 'PATCH').statusLabel, 'INCONCLUSIVE');
      assert.strictEqual(classifyMutation(500, 'DELETE').statusLabel, 'INCONCLUSIVE');
    });
  });

  describe('classifyPublicPlans', () => {
    it('passes when 200 returned with only active plans and empty inactive query', () => {
      const activePlans = [
        { id: '1', name: 'Starter', is_active: true },
        { id: '2', name: 'Pro', is_active: true }
      ];
      const inactivePlans = [];
      const res = classifyPublicPlans(200, activePlans, inactivePlans);
      assert.strictEqual(res.pass, true);
      assert.strictEqual(res.statusLabel, 'PASS');
    });

    it('fails if any inactive plan is returned in active list', () => {
      const activePlans = [
        { id: '1', name: 'Starter', is_active: true },
        { id: '2', name: 'Old Plan', is_active: false }
      ];
      const res = classifyPublicPlans(200, activePlans, []);
      assert.strictEqual(res.pass, false);
      assert.strictEqual(res.statusLabel, 'FAIL');
      assert.match(res.detail, /Inactive subscription plans/);
    });

    it('fails if inactive plans query returns rows to anon', () => {
      const activePlans = [{ id: '1', name: 'Starter', is_active: true }];
      const inactivePlans = [{ id: '99', name: 'Secret Plan', is_active: false }];
      const res = classifyPublicPlans(200, activePlans, inactivePlans);
      assert.strictEqual(res.pass, false);
      assert.strictEqual(res.statusLabel, 'FAIL');
    });

    it('fails if HTTP status is not 200', () => {
      assert.strictEqual(classifyPublicPlans(403, [], []).pass, false);
      assert.strictEqual(classifyPublicPlans(500, [], []).pass, false);
    });
  });

  describe('classifyPlatformSettings', () => {
    it('passes when only platform_identity is returned and non-identity query is empty', () => {
      const allRows = [{ key: 'platform_identity', value: { platformName: 'PharmaCore' } }];
      const nonIdentityRows = [];
      const res = classifyPlatformSettings(200, allRows, nonIdentityRows);
      assert.strictEqual(res.pass, true);
      assert.strictEqual(res.statusLabel, 'PASS');
    });

    it('fails if trial_policy or security_policy is returned in select=*', () => {
      const allRows = [
        { key: 'platform_identity', value: {} },
        { key: 'trial_policy', value: {} }
      ];
      const res = classifyPlatformSettings(200, allRows, []);
      assert.strictEqual(res.pass, false);
      assert.strictEqual(res.statusLabel, 'FAIL');
      assert.match(res.detail, /trial_policy/);
    });

    it('fails if non-identity query returns rows', () => {
      const allRows = [{ key: 'platform_identity', value: {} }];
      const nonIdentityRows = [{ key: 'security_policy', value: {} }];
      const res = classifyPlatformSettings(200, allRows, nonIdentityRows);
      assert.strictEqual(res.pass, false);
      assert.strictEqual(res.statusLabel, 'FAIL');
    });

    it('fails if HTTP status is not 200', () => {
      assert.strictEqual(classifyPlatformSettings(401, [], []).pass, false);
      assert.strictEqual(classifyPlatformSettings(500, [], []).pass, false);
    });
  });

  describe('classifyRpc', () => {
    it('passes on HTTP 401 and 403', () => {
      assert.strictEqual(classifyRpc(401, 'process_sale').pass, true);
      assert.strictEqual(classifyRpc(403, 'process_sale').pass, true);
    });

    it('fails with INCONCLUSIVE on HTTP 404 (indicates route/parameter mismatch, not guaranteed block)', () => {
      const res404 = classifyRpc(404, 'process_sale');
      assert.strictEqual(res404.pass, false);
      assert.strictEqual(res404.statusLabel, 'INCONCLUSIVE');
      assert.match(res404.detail, /HTTP 404/);
    });

    it('fails if RPC succeeds with HTTP 200', () => {
      const res200 = classifyRpc(200, 'process_sale');
      assert.strictEqual(res200.pass, false);
      assert.strictEqual(res200.statusLabel, 'FAIL');
      assert.match(res200.detail, /EXECUTE privilege/);
    });
  });

  describe('runChecks Config Refusal and Pure Mock Runner', () => {
    it('refuses secret keys starting with sb_secret_', async () => {
      const res = await runChecks({
        supabaseUrl: 'https://testproject.supabase.co',
        supabasePublishableKey: 'sb_secret_unauthorized_token_12345'
      });
      assert.strictEqual(res.allPassed, false);
      assert.strictEqual(res.checks[0].pass, false);
      assert.match(res.checks[0].detail, /sb_secret_/);
    });

    it('refuses service_role JWTs', async () => {
      const serviceRoleJwt = makeMockJwt('service_role');
      const res = await runChecks({
        supabaseUrl: 'https://testproject.supabase.co',
        supabasePublishableKey: serviceRoleJwt
      });
      assert.strictEqual(res.allPassed, false);
      assert.strictEqual(res.checks[0].pass, false);
      assert.match(res.checks[0].detail, /service_role/);
    });

    it('refuses invalid non-https URLs', async () => {
      const res = await runChecks({
        supabaseUrl: 'http://insecure-endpoint.com',
        supabasePublishableKey: 'sb_publishable_goodkey123456789'
      });
      assert.strictEqual(res.allPassed, false);
      assert.strictEqual(res.checks[0].pass, false);
    });

    it('completes entire suite with passing results using mock fetch', async () => {
      const mockFetch = async (url, options = {}) => {
        const method = options.method || 'GET';
        // Public subscription plans
        if (url.includes('/rest/v1/subscription_plans')) {
          if (method === 'GET') {
            if (url.includes('is_active=eq.false')) {
              return { status: 200, text: async () => '[]' };
            }
            return {
              status: 200,
              text: async () => JSON.stringify([{ id: '1', name: 'Plan', is_active: true }])
            };
          }
          // Mutations must be blocked
          return { status: 401, text: async () => '{"message":"permission denied"}' };
        }

        // Public platform settings
        if (url.includes('/rest/v1/platform_settings')) {
          if (method === 'GET') {
            if (url.includes('key=neq.platform_identity')) {
              return { status: 200, text: async () => '[]' };
            }
            return {
              status: 200,
              text: async () => JSON.stringify([{ key: 'platform_identity', value: {} }])
            };
          }
          // Mutations must be blocked
          return { status: 401, text: async () => '{"message":"permission denied"}' };
        }

        // Tenant tables (both SELECT and mutations must return 401/403)
        if (url.includes('/rest/v1/rpc/')) {
          return { status: 401, text: async () => '{"message":"permission denied for function"}' };
        }

        return { status: 401, text: async () => '{"message":"permission denied for table"}' };
      };

      const result = await runChecks({
        supabaseUrl: 'https://testproject.supabase.co',
        supabasePublishableKey: 'sb_publishable_valid_demo_key_12345',
        fetchFn: mockFetch
      });

      assert.strictEqual(result.allPassed, true);
      // Verify check count coverage:
      // 1 config check
      // 17 tenant tables * 4 operations (SELECT, INSERT, PATCH, DELETE) = 68
      // subscription_plans: 1 read + 3 mutations = 4
      // platform_settings: 1 read + 3 mutations = 4
      // 4 RPC checks = 4
      // Total = 1 + 68 + 4 + 4 + 4 = 81 checks
      assert.strictEqual(result.checks.length, 81);
      assert.strictEqual(result.checks.every(c => c.pass), true);
    });
  });
});
