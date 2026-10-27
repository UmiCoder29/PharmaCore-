import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRuntimeConfigPath = path.join(__dirname, 'runtime-config.json');

/**
 * Decodes and parses a JWT payload without signature verification.
 * @param {string} token
 * @returns {Record<string, any>}
 */
export function decodeJwtPayload(token) {
  if (typeof token !== 'string') {
    throw new Error('Invalid token: expected string.');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token: JWT must contain 3 dot-separated segments.');
  }
  try {
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    const jsonStr = Buffer.from(base64, 'base64').toString('utf8');
    const payload = JSON.parse(jsonStr);
    if (!payload || typeof payload !== 'object') {
      throw new Error('JWT payload is not a valid JSON object.');
    }
    return payload;
  } catch (err) {
    throw new Error(`Invalid token payload: ${err.message}`);
  }
}

/**
 * Validates a Supabase project URL.
 * Accepts https://<ref>.supabase.co or http://localhost / http://127.0.0.1 for local dev.
 * @param {string} url
 * @returns {string} Sanitized URL without trailing slash.
 */
export function validateSupabaseUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error('Missing required configuration: SUPABASE_URL');
  }
  const trimmed = url.trim();

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid SUPABASE_URL: must be a valid URL.');
  }

  const isLocalDev = (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
                     (parsed.protocol === 'http:' || parsed.protocol === 'https:');

  if (isLocalDev) {
    return trimmed.replace(/\/+$/, '');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Invalid SUPABASE_URL: must use HTTPS protocol (https://<ref>.supabase.co).');
  }

  const supabaseHostRegex = /^[a-z0-9_-]+\.supabase\.co$/i;
  if (!supabaseHostRegex.test(parsed.hostname)) {
    throw new Error('Invalid SUPABASE_URL: host must match https://<ref>.supabase.co (or http://localhost / http://127.0.0.1 for local dev).');
  }

  if (parsed.pathname && parsed.pathname !== '/') {
    throw new Error('Invalid SUPABASE_URL: project URL must not contain subpaths.');
  }

  return trimmed.replace(/\/+$/, '');
}

/**
 * Validates a Supabase publishable key using an explicit allowlist and secret-key guard.
 * Accepts sb_publishable_ keys or JWTs with role 'anon'.
 * Rejects sb_secret_, service_role JWTs, malformed JWTs, or unknown formats.
 * @param {string} key
 * @returns {string}
 */
export function validatePublishableKey(key) {
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error('Missing required configuration: SUPABASE_PUBLISHABLE_KEY');
  }
  const trimmed = key.trim();

  // Reject secret keys immediately
  if (trimmed.startsWith('sb_secret_')) {
    throw new Error('Security violation: SUPABASE_PUBLISHABLE_KEY starts with "sb_secret_". Secret keys must never be used in the client application.');
  }

  // Allowlist: modern Supabase publishable key
  if (trimmed.startsWith('sb_publishable_')) {
    return trimmed;
  }

  // Allowlist: JWT with role "anon"
  if (trimmed.split('.').length === 3) {
    let payload;
    try {
      payload = decodeJwtPayload(trimmed);
    } catch (err) {
      throw new Error(`Invalid SUPABASE_PUBLISHABLE_KEY: malformed JWT (${err.message}).`);
    }

    if (payload.role === 'service_role') {
      throw new Error('Security violation: SUPABASE_PUBLISHABLE_KEY is a service_role key. Service role keys must never be used in the client application.');
    }

    if (payload.role === 'anon') {
      return trimmed;
    }

    throw new Error(`Invalid SUPABASE_PUBLISHABLE_KEY: unauthorized JWT role "${payload.role}". Only "anon" role or sb_publishable_ keys are accepted.`);
  }

  throw new Error('Invalid SUPABASE_PUBLISHABLE_KEY: unrecognized key format. Only sb_publishable_ keys or anon JWTs are accepted.');
}

/**
 * Validates both Supabase URL and Publishable Key.
 * @param {{ supabaseUrl?: string, supabasePublishableKey?: string }} param0
 * @returns {{ supabaseUrl: string, supabasePublishableKey: string }}
 */
export function validateSupabaseConfig({ supabaseUrl, supabasePublishableKey } = {}) {
  const validUrl = validateSupabaseUrl(supabaseUrl);
  const validKey = validatePublishableKey(supabasePublishableKey);
  return {
    supabaseUrl: validUrl,
    supabasePublishableKey: validKey
  };
}

/**
 * Loads and validates configuration based on environment and package state.
 * @param {{ isPackaged?: boolean, runtimeConfigPath?: string, env?: NodeJS.ProcessEnv }} options
 * @returns {{ supabaseUrl: string, supabasePublishableKey: string }}
 */
export function loadConfig({
  isPackaged = false,
  runtimeConfigPath = defaultRuntimeConfigPath,
  env = process.env
} = {}) {
  let url = null;
  let key = null;

  if (isPackaged) {
    // When PACKAGED: read ONLY electron/runtime-config.json and ignore process.env completely.
    if (!fs.existsSync(runtimeConfigPath)) {
      throw new Error(`Missing build-time runtime configuration file (${runtimeConfigPath}) in packaged application.`);
    }
    try {
      const raw = fs.readFileSync(runtimeConfigPath, 'utf8');
      const parsed = JSON.parse(raw);
      url = parsed.SUPABASE_URL;
      key = parsed.SUPABASE_PUBLISHABLE_KEY;
    } catch (err) {
      throw new Error(`Failed to parse runtime-config.json: ${err.message}`);
    }
  } else {
    // When NOT packaged (dev):
    // Read process.env first (loading .env with dotenv)
    try {
      dotenv.config();
    } catch {
      // Ignore dotenv read error if .env doesn't exist
    }

    url = env.SUPABASE_URL;
    key = env.SUPABASE_PUBLISHABLE_KEY;

    // Fall back to runtime-config.json only if env values are missing
    if ((!url || !key) && fs.existsSync(runtimeConfigPath)) {
      try {
        const raw = fs.readFileSync(runtimeConfigPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!url) url = parsed.SUPABASE_URL;
        if (!key) key = parsed.SUPABASE_PUBLISHABLE_KEY;
      } catch {
        // Ignore fallback read error; validator will report missing fields
      }
    }
  }

  return validateSupabaseConfig({
    supabaseUrl: url,
    supabasePublishableKey: key
  });
}

let _cachedConfig = null;

/**
 * Initializes configuration for the application lifecycle.
 * Must be called from main.js with app.isPackaged.
 * @param {boolean} isPackaged
 * @returns {{ supabaseUrl: string, supabasePublishableKey: string }}
 */
export function initAppConfig(isPackaged = false) {
  _cachedConfig = loadConfig({ isPackaged });
  return _cachedConfig;
}

/**
 * Gets the active, validated configuration.
 * @returns {{ supabaseUrl: string, supabasePublishableKey: string }}
 */
export function getConfig() {
  if (!_cachedConfig) {
    _cachedConfig = loadConfig({ isPackaged: false });
  }
  return _cachedConfig;
}
