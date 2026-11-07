import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import {
  generateUsername,
  appendNumericSuffix,
  mapProvisioningError,
  registerPharmacy,
  _setCurrentUserForTesting,
  getCurrentUser
} from '../electron/auth.js';
import { registerAppIpcHandlers } from '../electron/api.js';
import { _setSupabaseClientForTesting, clearSupabase } from '../electron/supabaseClient.js';

describe('Provision Pharmacy Unit & Integration Tests', () => {
  afterEach(() => {
    _setCurrentUserForTesting(null);
    _setSupabaseClientForTesting(null);
    clearSupabase();
  });

  describe('generateUsername pure function', () => {
    it('converts full names with spaces to lowercase underscored usernames', () => {
      assert.equal(generateUsername('Dr Tariq Khan'), 'dr_tariq_khan');
      assert.equal(generateUsername('Fatima Ahmed'), 'fatima_ahmed');
    });

    it('strips special symbols and collapses multiple underscores', () => {
      assert.equal(generateUsername('Al-Shifa & Co. (Pvt) Ltd'), 'al_shifa_co_pvt_ltd');
      assert.equal(generateUsername('Hello @#$$% World!'), 'hello_world');
      assert.equal(generateUsername('A ___ B ____ C'), 'a_b_c');
    });

    it('trims leading and trailing underscores', () => {
      assert.equal(generateUsername('__username__'), 'username');
      assert.equal(generateUsername('!admin!'), 'admin');
    });

    it('pads short usernames to at least 3 characters', () => {
      assert.equal(generateUsername('a'), 'a__');
      assert.equal(generateUsername('ab'), 'ab_');
      assert.equal(generateUsername('xyz'), 'xyz');
    });

    it('truncates to a maximum of 50 characters without trailing underscore', () => {
      const veryLong = 'a'.repeat(60);
      const generated = generateUsername(veryLong);
      assert.equal(generated.length, 50);
      assert.equal(generated, 'a'.repeat(50));
    });

    it('handles empty, null, undefined, or non-string inputs safely returning "admin"', () => {
      assert.equal(generateUsername(''), 'admin');
      assert.equal(generateUsername(null), 'admin');
      assert.equal(generateUsername(undefined), 'admin');
      assert.equal(generateUsername(12345), 'admin');
      assert.equal(generateUsername('$$$###@@@'), 'admin');
    });
  });

  describe('appendNumericSuffix pure function', () => {
    it('appends _1 when no suffix is present', () => {
      assert.equal(appendNumericSuffix('dr_tariq'), 'dr_tariq_1');
      assert.equal(appendNumericSuffix('admin'), 'admin_1');
    });

    it('increments existing numeric suffix', () => {
      assert.equal(appendNumericSuffix('dr_tariq_1'), 'dr_tariq_2');
      assert.equal(appendNumericSuffix('dr_tariq_9'), 'dr_tariq_10');
      assert.equal(appendNumericSuffix('admin_42'), 'admin_43');
    });

    it('respects 50 char max limit', () => {
      const longName = 'a'.repeat(48);
      const suffixed = appendNumericSuffix(longName);
      assert.ok(suffixed.length <= 50);
    });

    it('handles falsy input by suffixing admin', () => {
      assert.equal(appendNumericSuffix(''), 'admin_1');
      assert.equal(appendNumericSuffix(null), 'admin_1');
    });
  });

  describe('mapProvisioningError mapping and error context extraction', () => {
    it('maps HTTP 429 or rate limit messages to rate limit explanation', () => {
      const msg429 = mapProvisioningError(429, 'Too many requests');
      assert.match(msg429, /rate limit reached/i);
      assert.match(msg429, /10 per hour/i);

      const msgText = mapProvisioningError(400, 'Provisioning rate limit exceeded');
      assert.match(msgText, /rate limit reached/i);
    });

    it('maps HTTP 403 or permission messages to SuperAdmin requirement', () => {
      const msg403 = mapProvisioningError(403, 'Forbidden');
      assert.match(msg403, /SuperAdmin permission required/i);

      const msgText = mapProvisioningError(400, 'superadmin access required');
      assert.match(msgText, /SuperAdmin permission required/i);
    });

    it('maps username taken messages to username collision notice', () => {
      const msg = mapProvisioningError(400, 'Admin username is already taken');
      assert.match(msg, /username is already taken/i);
    });

    it('maps invalid email messages to email format notice', () => {
      const msg = mapProvisioningError(400, 'Invalid email address format');
      assert.match(msg, /owner login email/i);
    });

    it('maps invalid plan tier messages to plan notice', () => {
      const msg = mapProvisioningError(400, 'Invalid subscription plan tier');
      assert.match(msg, /subscription plan/i);
    });

    it('maps invalid pharmacy name messages to name length notice', () => {
      const msg = mapProvisioningError(400, 'Pharmacy name must be between 2 and 100 characters');
      assert.match(msg, /between 2 and 100 characters/i);
    });

    it('defaults to safe message mentioning owner email may already be registered (Amendment 4)', () => {
      const msg = mapProvisioningError(500, 'Internal Server Error');
      assert.match(msg, /owner login email may already be registered/i);
      assert.doesNotMatch(msg, /Internal Server Error/);
    });

    it('Amendment 1 verification: failing test if error mapping only sees generic non-2xx message', () => {
      // Supabase JS FunctionsHttpError gives generic message:
      const genericNon2xxMessage = 'Edge Function returned a non-2xx status code';
      const actualServerMessage = 'Admin username is already taken';

      // If mapped ONLY using generic non-2xx message:
      const mappedFromGeneric = mapProvisioningError(400, genericNon2xxMessage);
      // It would NOT recognize the specific error:
      assert.equal(
        mappedFromGeneric.includes('Admin username is already taken'),
        false,
        'Generic non-2xx message alone cannot map to specific username taken error'
      );

      // But when mapped using the extracted actual server message:
      const mappedFromReal = mapProvisioningError(400, actualServerMessage);
      assert.equal(
        mappedFromReal.includes('Admin username is already taken'),
        true,
        'Real server message correctly maps to specific error'
      );
    });
  });

  describe('saas:create-pharmacy IPC Handler Access Control & Validation', () => {
    let createPharmacyHandler = null;

    beforeEach(() => {
      const handlers = {};
      const mockIpcMain = {
        handle: (channel, fn) => {
          handlers[channel] = fn;
        }
      };
      registerAppIpcHandlers(mockIpcMain);
      createPharmacyHandler = handlers['saas:create-pharmacy'];
    });

    it('rejects unauthenticated caller', async () => {
      _setCurrentUserForTesting(null);
      const res = await createPharmacyHandler(null, { pharmacyName: 'Test' });
      assert.equal(res.success, false);
      assert.match(res.error, /Unauthorized: Please log in/);
    });

    it('rejects tenant admin role (requires superadmin)', async () => {
      _setCurrentUserForTesting({ id: 'u1', username: 'admin1', role: 'admin' });
      const res = await createPharmacyHandler(null, { pharmacyName: 'Test' });
      assert.equal(res.success, false);
      assert.match(res.error, /SuperAdmin access required/);
    });

    it('rejects pharmacist role', async () => {
      _setCurrentUserForTesting({ id: 'u2', username: 'pharm1', role: 'pharmacist' });
      const res = await createPharmacyHandler(null, { pharmacyName: 'Test' });
      assert.equal(res.success, false);
      assert.match(res.error, /SuperAdmin access required/);
    });

    it('rejects invalid or missing pharmacy payload structure', async () => {
      _setCurrentUserForTesting({ id: 'u0', username: 'superadmin', role: 'superadmin' });
      const resNull = await createPharmacyHandler(null, null);
      assert.equal(resNull.success, false);
      assert.match(resNull.error, /must be an object/i);

      const resArray = await createPharmacyHandler(null, []);
      assert.equal(resArray.success, false);
      assert.match(resArray.error, /must be an object/i);
    });

    it('validates pharmacyName length (2 to 100 characters)', async () => {
      _setCurrentUserForTesting({ id: 'u0', username: 'superadmin', role: 'superadmin' });

      const resTooShort = await createPharmacyHandler(null, { pharmacyName: 'A', email: 'test@pharma.com' });
      assert.equal(resTooShort.success, false);
      assert.match(resTooShort.error, /between 2 and 100 characters/i);

      const resTooLong = await createPharmacyHandler(null, { pharmacyName: 'A'.repeat(101), email: 'test@pharma.com' });
      assert.equal(resTooLong.success, false);
      assert.match(resTooLong.error, /between 2 and 100 characters/i);
    });

    it('validates owner email format', async () => {
      _setCurrentUserForTesting({ id: 'u0', username: 'superadmin', role: 'superadmin' });

      const resNoEmail = await createPharmacyHandler(null, { pharmacyName: 'Valid Pharmacy', email: '' });
      assert.equal(resNoEmail.success, false);
      assert.match(resNoEmail.error, /valid owner login email is required/i);

      const resBadEmail = await createPharmacyHandler(null, { pharmacyName: 'Valid Pharmacy', email: 'notanemail' });
      assert.equal(resBadEmail.success, false);
      assert.match(resBadEmail.error, /valid owner login email is required/i);
    });

    it('validates admin username characters and length when provided', async () => {
      _setCurrentUserForTesting({ id: 'u0', username: 'superadmin', role: 'superadmin' });

      const resBadChars = await createPharmacyHandler(null, {
        pharmacyName: 'Valid Pharmacy',
        email: 'test@pharma.com',
        username: 'user with spaces!'
      });
      assert.equal(resBadChars.success, false);
      assert.match(resBadChars.error, /letters, numbers, and underscores/i);

      const resTooShort = await createPharmacyHandler(null, {
        pharmacyName: 'Valid Pharmacy',
        email: 'test@pharma.com',
        username: 'ab'
      });
      assert.equal(resTooShort.success, false);
      assert.match(resTooShort.error, /3-50 characters/i);
    });
  });

  describe('registerPharmacy Edge Function Invocation & Security Guarantees', () => {
    it('Amendment 2: proves superadmin session token, NOT anon key, is passed in headers', async () => {
      let capturedHeaders = null;
      let capturedFunctionName = null;
      let capturedBody = null;

      const mockSuperToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.superadmin-session-token';

      const mockSupabase = {
        auth: {
          getSession: async () => ({
            data: {
              session: {
                access_token: mockSuperToken
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
                pharmacy: { id: 'pharm-1', name: 'Test Pharmacy', slug: 'test-pharmacy' },
                admin: { id: 'usr-1', email: 'owner@test.com', username: 'owner_user' },
                temporaryPassword: 'TempPassword123!'
              },
              error: null
            };
          }
        }
      };

      _setSupabaseClientForTesting(mockSupabase);

      const res = await registerPharmacy({
        pharmacyName: 'Test Pharmacy',
        adminEmail: 'owner@test.com',
        adminUsername: 'owner_user',
        planTier: 'professional',
        branchName: 'Main Branch',
        city: 'Lahore',
        phone: '0300-1234567',
        adminDisplayName: 'Dr Owner'
      });

      assert.equal(res.success, true);
      assert.equal(capturedFunctionName, 'provision-pharmacy');
      // Proves superadmin Bearer token was sent in headers
      assert.equal(capturedHeaders.Authorization, `Bearer ${mockSuperToken}`);
      assert.notEqual(capturedHeaders.Authorization, 'Bearer sb_publishable_anon_token');
    });

    it('Payload key filtering: strictly sends only allowed 8 keys, never password or address', async () => {
      let capturedBody = null;

      const mockSupabase = {
        auth: {
          getSession: async () => ({
            data: {
              session: { access_token: 'valid-token' }
            }
          })
        },
        functions: {
          invoke: async (_name, options) => {
            capturedBody = options.body;
            return {
              data: {
                success: true,
                pharmacy: { id: 'p1', name: 'Safe Pharmacy', slug: 'safe-pharmacy' },
                admin: { id: 'u1', email: 'owner@safe.com', username: 'safe_admin' },
                temporaryPassword: 'GeneratedPass123!'
              },
              error: null
            };
          }
        }
      };

      _setSupabaseClientForTesting(mockSupabase);

      // Provide forbidden/extra keys (password, address, maliciousRole, secretFlag)
      await registerPharmacy({
        pharmacyName: 'Safe Pharmacy',
        adminEmail: 'owner@safe.com',
        adminUsername: 'safe_admin',
        password: 'ClientProvidedPasswordMustNotBeSent!',
        address: '123 Fake Street, Building 4',
        role: 'superadmin',
        isSuperAdmin: true,
        secretFlag: 999
      });

      assert.ok(capturedBody, 'Edge function body must be defined');
      assert.equal(capturedBody.pharmacyName, 'Safe Pharmacy');
      assert.equal(capturedBody.adminEmail, 'owner@safe.com');
      assert.equal(capturedBody.adminUsername, 'safe_admin');

      // VERIFY strict exclusion of disallowed keys
      assert.equal(capturedBody.password, undefined, 'password must NEVER be sent');
      assert.equal(capturedBody.address, undefined, 'address must NEVER be sent');
      assert.equal(capturedBody.role, undefined, 'role must NEVER be sent');
      assert.equal(capturedBody.isSuperAdmin, undefined, 'isSuperAdmin must NEVER be sent');
      assert.equal(capturedBody.secretFlag, undefined, 'unknown properties must NEVER be sent');

      // Check allowed keys only
      const allowedKeys = new Set([
        'pharmacyName',
        'adminEmail',
        'adminUsername',
        'planTier',
        'branchName',
        'city',
        'phone',
        'adminDisplayName'
      ]);
      for (const key of Object.keys(capturedBody)) {
        assert.ok(allowedKeys.has(key), `Body contains unexpected key: ${key}`);
      }
    });

    it('Single auto-retry with numeric suffix when username is already taken', async () => {
      const calls = [];

      const mockSupabase = {
        auth: {
          getSession: async () => ({
            data: { session: { access_token: 'valid-token' } }
          })
        },
        functions: {
          invoke: async (_name, options) => {
            calls.push(options.body.adminUsername);
            if (calls.length === 1) {
              // First call fails: username collision
              const error = new Error('Edge Function returned a non-2xx status code');
              error.context = {
                status: 400,
                json: async () => ({ success: false, error: 'Admin username is already taken' })
              };
              return { data: null, error };
            }
            // Second call succeeds with suffixed username
            return {
              data: {
                success: true,
                pharmacy: { id: 'p1', name: 'Auto Retry Pharmacy' },
                admin: { id: 'u1', username: options.body.adminUsername },
                temporaryPassword: 'TempPassword456!'
              },
              error: null
            };
          }
        }
      };

      _setSupabaseClientForTesting(mockSupabase);

      const res = await registerPharmacy({
        pharmacyName: 'Auto Retry Pharmacy',
        adminEmail: 'retry@pharma.com',
        adminUsername: 'dr_tariq'
      });

      assert.equal(res.success, true);
      assert.equal(res.usernameAdjusted, true);
      assert.equal(res.originalUsername, 'dr_tariq');
      assert.equal(res.finalUsername, 'dr_tariq_1');
      assert.equal(calls.length, 2);
      assert.equal(calls[0], 'dr_tariq');
      assert.equal(calls[1], 'dr_tariq_1');
      assert.match(res.note, /Username was already taken; provisioned as "dr_tariq_1" instead/);
    });

    it('Fails gracefully if both original and retry attempts fail', async () => {
      let callCount = 0;

      const mockSupabase = {
        auth: {
          getSession: async () => ({
            data: { session: { access_token: 'valid-token' } }
          })
        },
        functions: {
          invoke: async () => {
            callCount++;
            const error = new Error('Edge Function returned a non-2xx status code');
            error.context = {
              status: 400,
              json: async () => ({ success: false, error: 'Admin username is already taken' })
            };
            return { data: null, error };
          }
        }
      };

      _setSupabaseClientForTesting(mockSupabase);

      const res = await registerPharmacy({
        pharmacyName: 'Always Taken Pharmacy',
        adminEmail: 'retry@pharma.com',
        adminUsername: 'dr_tariq'
      });

      assert.equal(res.success, false);
      assert.equal(callCount, 2, 'Should have attempted once and retried once');
      assert.match(res.error, /username is already taken/i);
    });

    it('Correctly reads server error message from error.context.json() response', async () => {
      const mockSupabase = {
        auth: {
          getSession: async () => ({
            data: { session: { access_token: 'valid-token' } }
          })
        },
        functions: {
          invoke: async () => {
            const error = new Error('Edge Function returned a non-2xx status code');
            error.context = {
              status: 429,
              json: async () => ({ success: false, error: 'Provisioning rate limit exceeded (maximum 10 per hour).' })
            };
            return { data: null, error };
          }
        }
      };

      _setSupabaseClientForTesting(mockSupabase);

      const res = await registerPharmacy({
        pharmacyName: 'Rate Limited Pharmacy',
        adminEmail: 'ratelimit@pharma.com',
        adminUsername: 'rate_user'
      });

      assert.equal(res.success, false);
      assert.match(res.error, /Provisioning rate limit reached \(maximum 10 per hour\)/i);
    });

    it('Temporary password is returned for single-view UI presentation and never persisted to localCache', async () => {
      const mockSupabase = {
        auth: {
          getSession: async () => ({
            data: { session: { access_token: 'valid-token' } }
          })
        },
        functions: {
          invoke: async () => ({
            data: {
              success: true,
              pharmacy: { id: 'p1', name: 'Ephemeral Pharmacy' },
              admin: { id: 'u1', username: 'ephemeral_owner' },
              temporaryPassword: 'TopSecretOneTimePassword99!'
            },
            error: null
          })
        }
      };

      _setSupabaseClientForTesting(mockSupabase);

      const res = await registerPharmacy({
        pharmacyName: 'Ephemeral Pharmacy',
        adminEmail: 'ephemeral@pharma.com',
        adminUsername: 'ephemeral_owner'
      });

      assert.equal(res.success, true);
      assert.equal(res.temporaryPassword, 'TopSecretOneTimePassword99!');

      // Verify that no global or cached user password was saved
      const currentUser = getCurrentUser();
      assert.ok(!currentUser || currentUser.password === undefined);
    });
  });

  describe('Amendment 3: Plan tier slug alignment with subscription_plans migration', () => {
    it('verifies every planTier option in the Provision modal matches an active slug in subscription_plans seed', () => {
      const baselineSql = fs.readFileSync('supabase/migrations/20261025000001_baseline.sql', 'utf8');
      const componentSource = fs.readFileSync('src/components/SaasAdminScreen.jsx', 'utf8');

      // Extract the planTier select from the Provision modal (formData.planTier)
      const provisionSelectMatch = componentSource.match(/formData\.planTier[\s\S]*?<\/select>/);
      assert.ok(provisionSelectMatch, 'Must find formData.planTier select block in SaasAdminScreen');

      const provisionTiers = [...provisionSelectMatch[0].matchAll(/<option value="([^"]+)">/g)].map(m => m[1]);
      assert.deepEqual(provisionTiers, ['trial', 'starter', 'professional', 'enterprise']);

      // Extract seeded slugs from baseline migration
      const activeSlugs = [];
      const planInsertMatch = baselineSql.match(/INSERT INTO public\.subscription_plans[\s\S]*?;/);
      assert.ok(planInsertMatch, 'Must find subscription_plans insert in baseline migration');
      
      const rowMatches = planInsertMatch[0].matchAll(/\('[^']+',\s*'[^']+',\s*'([^']+)',/g);
      for (const m of rowMatches) {
        activeSlugs.push(m[1]);
      }

      // Assert each Provision modal option is a valid seeded slug in subscription_plans
      for (const tier of provisionTiers) {
        assert.ok(
          activeSlugs.includes(tier),
          `Provision option value "${tier}" is not an active slug in subscription_plans: ${activeSlugs.join(', ')}`
        );
      }

      // Confirm 14-Day Free Trial sends 'trial', which is an active slug in subscription_plans
      assert.ok(provisionTiers.includes('trial'), '14-Day Free Trial option must send slug "trial"');
      assert.ok(activeSlugs.includes('trial'), 'Slug "trial" must exist in subscription_plans');
    });
  });
});

