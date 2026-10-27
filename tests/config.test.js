import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  decodeJwtPayload,
  validateSupabaseUrl,
  validatePublishableKey,
  validateSupabaseConfig,
  loadConfig,
  initAppConfig,
  getConfig,
  resetConfig
} from '../electron/config.js';

// Helper to construct base64url JWTs
function createMockJwt(payloadObj) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const signature = 'fake_signature_hash_123';
  return `${header}.${payload}.${signature}`;
}

const VALID_ANON_JWT = createMockJwt({
  role: 'anon',
  iss: 'supabase',
  exp: 1893456000
});

const SERVICE_ROLE_JWT = createMockJwt({
  role: 'service_role',
  iss: 'supabase',
  exp: 1893456000
});

const MALFORMED_JWT = 'invalid.payload_is_not_json.signature';

describe('Supabase Configuration Validator', () => {
  describe('validateSupabaseUrl', () => {
    it('fails when URL is missing or empty', () => {
      assert.throws(
        () => validateSupabaseUrl(''),
        /Missing required configuration: SUPABASE_URL/
      );
      assert.throws(
        () => validateSupabaseUrl(null),
        /Missing required configuration: SUPABASE_URL/
      );
      assert.throws(
        () => validateSupabaseUrl('   '),
        /Missing required configuration: SUPABASE_URL/
      );
    });

    it('rejects a bad or non-https URL', () => {
      assert.throws(
        () => validateSupabaseUrl('not-a-valid-url'),
        /Invalid SUPABASE_URL: must be a valid URL/
      );
      assert.throws(
        () => validateSupabaseUrl('ftp://project.supabase.co'),
        /Invalid SUPABASE_URL: must use HTTPS protocol/
      );
      assert.throws(
        () => validateSupabaseUrl('http://project.supabase.co'),
        /Invalid SUPABASE_URL: must use HTTPS protocol/
      );
      assert.throws(
        () => validateSupabaseUrl('https://evil-site.com'),
        /Invalid SUPABASE_URL: host must match https:\/\/<ref>\.supabase\.co/
      );
      assert.throws(
        () => validateSupabaseUrl('https://project.supabase.co/rest/v1'),
        /Invalid SUPABASE_URL: project URL must not contain subpaths/
      );
    });

    it('rejects URLs containing credentials, query strings, or hashes', () => {
      assert.throws(
        () => validateSupabaseUrl('https://user:password@project.supabase.co'),
        /Invalid SUPABASE_URL: URL must not contain credentials/
      );
      assert.throws(
        () => validateSupabaseUrl('https://project.supabase.co?token=secret'),
        /Invalid SUPABASE_URL: URL must not contain a query string/
      );
      assert.throws(
        () => validateSupabaseUrl('https://project.supabase.co#fragment'),
        /Invalid SUPABASE_URL: URL must not contain a hash fragment/
      );
    });

    it('accepts valid https://<ref>.supabase.co URLs and returns parsed.origin', () => {
      const url1 = validateSupabaseUrl('https://abcdefghijklm.supabase.co');
      assert.equal(url1, 'https://abcdefghijklm.supabase.co');

      const url2 = validateSupabaseUrl('https://xyz-123_proj.supabase.co/');
      assert.equal(url2, 'https://xyz-123_proj.supabase.co');
    });

    it('rejects localhost when allowLocal is false (default)', () => {
      assert.throws(
        () => validateSupabaseUrl('http://localhost:54321', { allowLocal: false }),
        /Invalid SUPABASE_URL: localhost is only allowed in unpackaged development mode/
      );
      assert.throws(
        () => validateSupabaseUrl('http://127.0.0.1:54321', { allowLocal: false }),
        /Invalid SUPABASE_URL: localhost is only allowed in unpackaged development mode/
      );
    });

    it('allows localhost and 127.0.0.1 when allowLocal is true', () => {
      const url1 = validateSupabaseUrl('http://localhost:54321', { allowLocal: true });
      assert.equal(url1, 'http://localhost:54321');

      const url2 = validateSupabaseUrl('http://127.0.0.1:54321/', { allowLocal: true });
      assert.equal(url2, 'http://127.0.0.1:54321');
    });
  });

  describe('validatePublishableKey', () => {
    it('fails when key is missing or empty', () => {
      assert.throws(
        () => validatePublishableKey(''),
        /Missing required configuration: SUPABASE_PUBLISHABLE_KEY/
      );
      assert.throws(
        () => validatePublishableKey(null),
        /Missing required configuration: SUPABASE_PUBLISHABLE_KEY/
      );
      assert.throws(
        () => validatePublishableKey('   '),
        /Missing required configuration: SUPABASE_PUBLISHABLE_KEY/
      );
    });

    it('rejects any key starting with sb_secret_', () => {
      assert.throws(
        () => validatePublishableKey('sb_secret_abcdef1234567890'),
        /Security violation: SUPABASE_PUBLISHABLE_KEY starts with "sb_secret_"/
      );
    });

    it('rejects a service_role JWT', () => {
      assert.throws(
        () => validatePublishableKey(SERVICE_ROLE_JWT),
        /Security violation: SUPABASE_PUBLISHABLE_KEY is a service_role key/
      );
    });

    it('rejects malformed JWTs and unknown key formats', () => {
      assert.throws(
        () => validatePublishableKey(MALFORMED_JWT),
        /Invalid SUPABASE_PUBLISHABLE_KEY: malformed JWT/
      );
      assert.throws(
        () => validatePublishableKey('random-plain-string-key'),
        /Invalid SUPABASE_PUBLISHABLE_KEY: unrecognized key format/
      );
      assert.throws(
        () => validatePublishableKey(createMockJwt({ role: 'authenticated' })),
        /unauthorized JWT role "authenticated"/
      );
    });

    it('accepts sb_publishable_ keys and anon JWTs', () => {
      const pubKey = 'sb_publishable_abcdef1234567890';
      assert.equal(validatePublishableKey(pubKey), pubKey);

      assert.equal(validatePublishableKey(VALID_ANON_JWT), VALID_ANON_JWT);
    });
  });

  describe('validateSupabaseConfig', () => {
    it('validates both URL and key together', () => {
      const valid = validateSupabaseConfig({
        supabaseUrl: 'https://demo-project.supabase.co',
        supabasePublishableKey: 'sb_publishable_my_key_123'
      });
      assert.deepEqual(valid, {
        supabaseUrl: 'https://demo-project.supabase.co',
        supabasePublishableKey: 'sb_publishable_my_key_123'
      });
    });

    it('build script validation rejects localhost (allowLocal = false)', () => {
      assert.throws(
        () => validateSupabaseConfig({
          supabaseUrl: 'http://localhost:54321',
          supabasePublishableKey: 'sb_publishable_test',
          allowLocal: false
        }),
        /Invalid SUPABASE_URL: localhost is only allowed in unpackaged development mode/
      );
    });
  });

  describe('loadConfig Source Order and Packaging', () => {
    it('when packaged, reads ONLY runtime-config.json and ignores process.env completely', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacore-test-'));
      const runtimeConfigPath = path.join(tempDir, 'runtime-config.json');

      fs.writeFileSync(
        runtimeConfigPath,
        JSON.stringify({
          SUPABASE_URL: 'https://packaged-app.supabase.co',
          SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_packaged_key_123'
        }),
        'utf8'
      );

      const hostileEnv = {
        SUPABASE_URL: 'https://hostile-override.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'sb_secret_should_be_ignored'
      };

      const result = loadConfig({
        isPackaged: true,
        runtimeConfigPath,
        env: hostileEnv
      });

      assert.equal(result.supabaseUrl, 'https://packaged-app.supabase.co');
      assert.equal(result.supabasePublishableKey, 'sb_publishable_packaged_key_123');

      // Clean up
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('when packaged, rejects http://localhost even if specified in runtime-config.json', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacore-test-'));
      const runtimeConfigPath = path.join(tempDir, 'runtime-config.json');

      fs.writeFileSync(
        runtimeConfigPath,
        JSON.stringify({
          SUPABASE_URL: 'http://localhost:54321',
          SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_packaged_key_123'
        }),
        'utf8'
      );

      assert.throws(
        () => loadConfig({ isPackaged: true, runtimeConfigPath }),
        /Invalid SUPABASE_URL: localhost is only allowed in unpackaged development mode/
      );

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('when packaged, fails if runtime-config.json is missing', () => {
      const missingPath = path.join(os.tmpdir(), 'non-existent-runtime-config.json');
      assert.throws(
        () => loadConfig({ isPackaged: true, runtimeConfigPath: missingPath }),
        /Missing build-time runtime configuration file/
      );
    });

    it('when dev (not packaged), prefers env over runtime-config.json and allows localhost', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacore-test-'));
      const runtimeConfigPath = path.join(tempDir, 'runtime-config.json');

      fs.writeFileSync(
        runtimeConfigPath,
        JSON.stringify({
          SUPABASE_URL: 'https://build-time.supabase.co',
          SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_build_key'
        }),
        'utf8'
      );

      const devEnv = {
        SUPABASE_URL: 'http://localhost:54321',
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_dev_key'
      };

      const result = loadConfig({
        isPackaged: false,
        runtimeConfigPath,
        env: devEnv
      });

      assert.equal(result.supabaseUrl, 'http://localhost:54321');
      assert.equal(result.supabasePublishableKey, 'sb_publishable_dev_key');

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('getConfig and initAppConfig Lifecycle', () => {
    it('getConfig() before init throws "Configuration not initialized"', () => {
      resetConfig();
      assert.throws(
        () => getConfig(),
        /Configuration not initialized/
      );
    });

    it('failed init followed by getConfig() still throws even if credentials exist in environment', () => {
      resetConfig();
      const oldUrl = process.env.SUPABASE_URL;
      const oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;

      try {
        process.env.SUPABASE_URL = 'https://valid-in-env.supabase.co';
        process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_valid_in_env_123';

        const missingPath = path.join(os.tmpdir(), 'missing-runtime-config-for-test.json');
        if (fs.existsSync(missingPath)) fs.unlinkSync(missingPath);

        // Attempt packaged initialization with missing runtime-config.json
        assert.throws(
          () => initAppConfig(true, { runtimeConfigPath: missingPath }),
          /Missing build-time runtime configuration file/
        );

        // getConfig() must still throw and NOT load from process.env
        assert.throws(
          () => getConfig(),
          /Configuration not initialized/
        );
      } finally {
        process.env.SUPABASE_URL = oldUrl;
        process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
        resetConfig();
      }
    });
  });
});
