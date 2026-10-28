/**
 * PharmaCore ERP + POS — Read-Only Setup & Privilege Verification Script
 *
 * PURPOSE:
 *   Performs external, black-box HTTP checks against Supabase PostgREST
 *   as the unauthenticated anonymous (anon) role using only:
 *     - SUPABASE_URL
 *     - SUPABASE_PUBLISHABLE_KEY
 *
 * HONEST LIMITATIONS (WHAT THIS SCRIPT CANNOT VERIFY):
 *   1. Catalog-level RLS flags: This script tests external HTTP behavior as anon via PostgREST.
 *      It cannot inspect PostgreSQL system catalogs (pg_class.relrowsecurity) to confirm that
 *      RLS is enabled on every table.
 *   2. Trigger & Policy definitions: It cannot verify pg_trigger or pg_policy internals.
 *   3. Multi-tenant isolation between authenticated tenants: It tests only the anon boundary.
 *      Tenant isolation across admin and pharmacist roles requires active user tokens.
 *   These catalog, trigger, and authenticated isolation guarantees are comprehensively verified
 *   by running supabase/tests/rls_suite.sql in the Supabase Dashboard SQL Editor as postgres.
 *
 * SAFETY RULES:
 *   - Read-only checks: no writes are committed.
 *   - Mutation checks on tenant and public tables send either dummy non-matching filters
 *     (e.g., id=eq.00000000-0000-0000-0000-000000000000) or deliberately invalid empty bodies.
 *   - Only the 'apikey' header is sent; the key is never sent in the Authorization header.
 *   - The key value is never printed to console logs or error outputs.
 */

import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import { validateSupabaseConfig, decodeJwtPayload } from '../electron/config.js';

// The 17 tenant tables where anon must have NO SELECT, INSERT, UPDATE, or DELETE privileges
export const TENANT_TABLES = [
  'pharmacies',
  'branches',
  'app_users',
  'categories',
  'suppliers',
  'medicines',
  'batches',
  'customers',
  'prescriptions',
  'sales',
  'sale_items',
  'sale_payments',
  'returns',
  'return_items',
  'activity_logs',
  'settings',
  'subscription_inquiries'
];

// Valid column payloads for PATCH checks (must match existing column to test Postgres privilege rather than schema cache 400)
export const TENANT_TABLE_PATCH_PAYLOADS = {
  pharmacies: { name: 'unauthorized_write' },
  branches: { name: 'unauthorized_write' },
  app_users: { username: 'unauthorized_write' },
  categories: { name: 'unauthorized_write' },
  suppliers: { name: 'unauthorized_write' },
  medicines: { name: 'unauthorized_write' },
  batches: { batch_number: 'unauthorized_write' },
  customers: { full_name: 'unauthorized_write' },
  prescriptions: { prescriber_name: 'unauthorized_write' },
  sales: { notes: 'unauthorized_write' },
  sale_items: { quantity: 1 },
  sale_payments: { method: 'cash' },
  returns: { refund_method: 'Cash' },
  return_items: { quantity: 1 },
  activity_logs: { action: 'unauthorized_write' },
  settings: { key: 'unauthorized_write' },
  subscription_inquiries: { sender_name: 'unauthorized_write' }
};

// RPC functions and their parameter definitions from migrations
export const RPC_DEFINITIONS = [
  {
    name: 'process_sale',
    payload: {
      p_sale_id: '00000000-0000-0000-0000-000000000000',
      p_items: [],
      p_subtotal: 0,
      p_total_tax: 0,
      p_total_amount: 0,
      p_metadata: {}
    }
  },
  {
    name: 'process_return',
    payload: {
      p_return_id: '00000000-0000-0000-0000-000000000000',
      p_sale_id: '00000000-0000-0000-0000-000000000000',
      p_items: [],
      p_refund_method: 'Cash'
    }
  },
  {
    name: 'approve_return',
    payload: {
      p_return_id: '00000000-0000-0000-0000-000000000000'
    }
  },
  {
    name: 'get_supplier_dashboard_stats',
    payload: {}
  }
];

/**
 * Identifies the type of key without disclosing its contents.
 * @param {string} key
 * @returns {string}
 */
export function getKeyType(key) {
  if (!key || typeof key !== 'string') return 'unknown';
  if (key.startsWith('sb_publishable_')) {
    return 'modern publishable key (sb_publishable_)';
  }
  if (key.split('.').length === 3) {
    try {
      const payload = decodeJwtPayload(key);
      if (payload.role === 'anon') {
        return 'legacy anon JWT';
      }
      return `JWT with role "${payload.role}"`;
    } catch {
      return 'malformed JWT';
    }
  }
  if (key.startsWith('sb_secret_')) {
    return 'SECRET KEY (sb_secret_)';
  }
  return 'unrecognized key format';
}

/**
 * Classifies a SELECT response on a tenant table.
 * MUST return 401 or 403 (Postgres 42501).
 * 200 (even empty array) is a FAIL because anon holds no grants on tenant tables.
 * @param {number} status
 * @param {any} body
 * @returns {{ pass: boolean, statusLabel: string, detail: string }}
 */
export function classifySelectTenantTable(status, body) {
  if (status === 401 || status === 403) {
    return {
      pass: true,
      statusLabel: 'PASS',
      detail: `Blocked with HTTP ${status} (privileges revoked)`
    };
  }
  if (status === 200) {
    const rowCount = Array.isArray(body) ? body.length : 'unknown';
    return {
      pass: false,
      statusLabel: 'FAIL',
      detail: `Unexpected HTTP 200 (anon has SELECT privilege! rows returned: ${rowCount})`
    };
  }
  return {
    pass: false,
    statusLabel: 'INCONCLUSIVE',
    detail: `Unexpected HTTP status ${status}`
  };
}

/**
 * Classifies a mutation attempt (INSERT, UPDATE, DELETE).
 * MUST return 401 or 403.
 * Status 400 on INSERT means Postgres attempted validation because anon has INSERT permission.
 * Status 200/201/204 means write succeeded or was evaluated.
 * @param {number} status
 * @param {'INSERT'|'PATCH'|'DELETE'} op
 * @returns {{ pass: boolean, statusLabel: string, detail: string }}
 */
export function classifyMutation(status, op) {
  if (status === 401 || status === 403) {
    return {
      pass: true,
      statusLabel: 'PASS',
      detail: `${op} blocked with HTTP ${status}`
    };
  }
  if (status >= 200 && status < 300) {
    return {
      pass: false,
      statusLabel: 'FAIL',
      detail: `${op} allowed with HTTP ${status} (mutation privilege not revoked!)`
    };
  }
  if (status === 400) {
    return {
      pass: false,
      statusLabel: 'FAIL',
      detail: `${op} returned HTTP 400 (table schema evaluated, anon likely holds table privilege)`
    };
  }
  return {
    pass: false,
    statusLabel: 'INCONCLUSIVE',
    detail: `${op} returned unexpected HTTP status ${status}`
  };
}

/**
 * Classifies subscription_plans read results.
 * @param {number} status
 * @param {any[]} activePlans
 * @param {any[]} inactivePlans
 * @returns {{ pass: boolean, statusLabel: string, detail: string }}
 */
export function classifyPublicPlans(status, activePlans, inactivePlans) {
  if (status !== 200) {
    return {
      pass: false,
      statusLabel: 'FAIL',
      detail: `Expected HTTP 200 for public active plans read, received ${status}`
    };
  }
  if (!Array.isArray(activePlans)) {
    return {
      pass: false,
      statusLabel: 'FAIL',
      detail: 'Expected JSON array for active plans response'
    };
  }
  const hasInactive = activePlans.some(p => p.is_active === false);
  if (hasInactive) {
    return {
      pass: false,
      statusLabel: 'FAIL',
      detail: 'Inactive subscription plans returned to anon (RLS policy violation)'
    };
  }
  if (Array.isArray(inactivePlans) && inactivePlans.length > 0) {
    return {
      pass: false,
      statusLabel: 'FAIL',
      detail: `Query for is_active=false returned ${inactivePlans.length} rows (RLS policy violation)`
    };
  }

  const activeCount = activePlans.length;
  return {
    pass: true,
    statusLabel: 'PASS',
    detail: `HTTP 200, returned ${activeCount} active plan(s); inactive query returned 0 rows`
  };
}

/**
 * Classifies platform_settings read results.
 * @param {number} status
 * @param {any[]} allRows
 * @param {any[]} nonIdentityRows
 * @returns {{ pass: boolean, statusLabel: string, detail: string }}
 */
export function classifyPlatformSettings(status, allRows, nonIdentityRows) {
  if (status !== 200) {
    return {
      pass: false,
      statusLabel: 'FAIL',
      detail: `Expected HTTP 200 for platform_identity read, received ${status}`
    };
  }
  if (!Array.isArray(allRows)) {
    return {
      pass: false,
      statusLabel: 'FAIL',
      detail: 'Expected JSON array for platform_settings response'
    };
  }
  const nonIdentityInAll = allRows.filter(r => r.key !== 'platform_identity');
  if (nonIdentityInAll.length > 0) {
    return {
      pass: false,
      statusLabel: 'FAIL',
      detail: `anon can read non-identity keys (${nonIdentityInAll.map(r => r.key).join(', ')})`
    };
  }
  if (Array.isArray(nonIdentityRows) && nonIdentityRows.length > 0) {
    return {
      pass: false,
      statusLabel: 'FAIL',
      detail: `Query for key!=platform_identity returned ${nonIdentityRows.length} rows (RLS policy violation)`
    };
  }

  return {
    pass: true,
    statusLabel: 'PASS',
    detail: `HTTP 200, returned only platform_identity (${allRows.length} row); non-identity query returned 0 rows`
  };
}

/**
 * Classifies RPC execution attempts.
 * MUST return 401 or 403.
 * 404 is treated as INCONCLUSIVE / FAIL (could be parameter mismatch or route issue).
 * @param {number} status
 * @param {string} rpcName
 * @returns {{ pass: boolean, statusLabel: string, detail: string }}
 */
export function classifyRpc(status, rpcName) {
  if (status === 401 || status === 403) {
    return {
      pass: true,
      statusLabel: 'PASS',
      detail: `RPC ${rpcName} blocked with HTTP ${status}`
    };
  }
  if (status === 404) {
    return {
      pass: false,
      statusLabel: 'INCONCLUSIVE',
      detail: `RPC ${rpcName} returned HTTP 404 (signature mismatch or function missing in cache)`
    };
  }
  if (status >= 200 && status < 300) {
    return {
      pass: false,
      statusLabel: 'FAIL',
      detail: `RPC ${rpcName} executed successfully with HTTP ${status} (anon has EXECUTE privilege!)`
    };
  }
  return {
    pass: false,
    statusLabel: 'INCONCLUSIVE',
    detail: `RPC ${rpcName} returned unexpected HTTP status ${status}`
  };
}

/**
 * Helper to make a fetch call with timeout and anon apikey header only.
 * @param {string} url
 * @param {object} options
 * @param {string} key
 * @param {typeof fetch} fetchFn
 * @returns {Promise<{ status: number, body: any }>}
 */
async function fetchAsAnon(url, { method = 'GET', body = null } = {}, key, fetchFn = fetch) {
  const headers = {
    apikey: key
  };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetchFn(url, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });

  let parsedBody = null;
  const text = await res.text();
  if (text) {
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = text;
    }
  }

  return {
    status: res.status,
    body: parsedBody
  };
}

/**
 * Executes the complete verification check suite.
 * @param {{ supabaseUrl: string, supabasePublishableKey: string, fetchFn?: typeof fetch }} options
 * @returns {Promise<{ allPassed: boolean, checks: Array<{ category: string, name: string, status: string, pass: boolean, detail: string }> }>}
 */
export async function runChecks({ supabaseUrl, supabasePublishableKey, fetchFn = fetch }) {
  const checks = [];

  // 1. Config Validation
  let validConfig;
  try {
    validConfig = validateSupabaseConfig({
      supabaseUrl,
      supabasePublishableKey,
      allowLocal: false
    });
    checks.push({
      category: '1. Configuration',
      name: 'Publishable config validation',
      status: 'PASS',
      pass: true,
      detail: `Valid URL (${new URL(validConfig.supabaseUrl).origin}) and ${getKeyType(validConfig.supabasePublishableKey)}`
    });
  } catch (err) {
    checks.push({
      category: '1. Configuration',
      name: 'Publishable config validation',
      status: 'FAIL',
      pass: false,
      detail: err.message
    });
    return { allPassed: false, checks };
  }

  const { supabaseUrl: baseUrl, supabasePublishableKey: key } = validConfig;

  // 2. Tenant Tables Isolation (17 tables)
  for (const tbl of TENANT_TABLES) {
    // 2.1 SELECT check (must return 401/403, 200 is FAIL)
    try {
      const res = await fetchAsAnon(`${baseUrl}/rest/v1/${tbl}?select=*&limit=1`, { method: 'GET' }, key, fetchFn);
      const resClass = classifySelectTenantTable(res.status, res.body);
      checks.push({
        category: '2. Tenant Tables (SELECT)',
        name: `anon cannot SELECT from ${tbl}`,
        status: resClass.statusLabel,
        pass: resClass.pass,
        detail: resClass.detail
      });
    } catch (err) {
      checks.push({
        category: '2. Tenant Tables (SELECT)',
        name: `anon cannot SELECT from ${tbl}`,
        status: 'FAIL',
        pass: false,
        detail: `Network/Timeout error: ${err.message}`
      });
    }

    // 2.2 INSERT check (deliberately invalid empty body, must return 401/403)
    try {
      const res = await fetchAsAnon(`${baseUrl}/rest/v1/${tbl}`, { method: 'POST', body: {} }, key, fetchFn);
      const resClass = classifyMutation(res.status, 'INSERT');
      checks.push({
        category: '3. Tenant Tables (Mutations)',
        name: `anon cannot INSERT into ${tbl}`,
        status: resClass.statusLabel,
        pass: resClass.pass,
        detail: resClass.detail
      });
    } catch (err) {
      checks.push({
        category: '3. Tenant Tables (Mutations)',
        name: `anon cannot INSERT into ${tbl}`,
        status: 'FAIL',
        pass: false,
        detail: `Network/Timeout error: ${err.message}`
      });
    }

    // 2.3 PATCH check (filtered non-existent row, must return 401/403)
    try {
      const patchPayload = TENANT_TABLE_PATCH_PAYLOADS[tbl] || { id: '00000000-0000-0000-0000-000000000000' };
      const res = await fetchAsAnon(
        `${baseUrl}/rest/v1/${tbl}?id=eq.00000000-0000-0000-0000-000000000000`,
        { method: 'PATCH', body: patchPayload },
        key,
        fetchFn
      );
      const resClass = classifyMutation(res.status, 'PATCH');
      checks.push({
        category: '3. Tenant Tables (Mutations)',
        name: `anon cannot PATCH ${tbl}`,
        status: resClass.statusLabel,
        pass: resClass.pass,
        detail: resClass.detail
      });
    } catch (err) {
      checks.push({
        category: '3. Tenant Tables (Mutations)',
        name: `anon cannot PATCH ${tbl}`,
        status: 'FAIL',
        pass: false,
        detail: `Network/Timeout error: ${err.message}`
      });
    }

    // 2.4 DELETE check (filtered non-existent row, must return 401/403)
    try {
      const res = await fetchAsAnon(
        `${baseUrl}/rest/v1/${tbl}?id=eq.00000000-0000-0000-0000-000000000000`,
        { method: 'DELETE' },
        key,
        fetchFn
      );
      const resClass = classifyMutation(res.status, 'DELETE');
      checks.push({
        category: '3. Tenant Tables (Mutations)',
        name: `anon cannot DELETE from ${tbl}`,
        status: resClass.statusLabel,
        pass: resClass.pass,
        detail: resClass.detail
      });
    } catch (err) {
      checks.push({
        category: '3. Tenant Tables (Mutations)',
        name: `anon cannot DELETE from ${tbl}`,
        status: 'FAIL',
        pass: false,
        detail: `Network/Timeout error: ${err.message}`
      });
    }
  }

  // 3. Public Table Read Allowlist: subscription_plans
  try {
    const activeRes = await fetchAsAnon(`${baseUrl}/rest/v1/subscription_plans?select=*`, { method: 'GET' }, key, fetchFn);
    const inactiveRes = await fetchAsAnon(`${baseUrl}/rest/v1/subscription_plans?is_active=eq.false&select=*`, { method: 'GET' }, key, fetchFn);
    const plansClass = classifyPublicPlans(activeRes.status, activeRes.body, inactiveRes.body);
    checks.push({
      category: '4. Public Tables (Read)',
      name: 'anon can read only active subscription_plans',
      status: plansClass.statusLabel,
      pass: plansClass.pass,
      detail: plansClass.detail
    });
  } catch (err) {
    checks.push({
      category: '4. Public Tables (Read)',
      name: 'anon can read only active subscription_plans',
      status: 'FAIL',
      pass: false,
      detail: `Network/Timeout error: ${err.message}`
    });
  }

  // subscription_plans mutations must be blocked
  try {
    const insRes = await fetchAsAnon(`${baseUrl}/rest/v1/subscription_plans`, { method: 'POST', body: {} }, key, fetchFn);
    const insClass = classifyMutation(insRes.status, 'INSERT');
    checks.push({
      category: '5. Public Tables (Mutations)',
      name: 'anon cannot INSERT subscription_plans',
      status: insClass.statusLabel,
      pass: insClass.pass,
      detail: insClass.detail
    });

    const patchRes = await fetchAsAnon(
      `${baseUrl}/rest/v1/subscription_plans?id=eq.00000000-0000-0000-0000-000000000000`,
      { method: 'PATCH', body: { name: 'unauthorized_plan_update' } },
      key,
      fetchFn
    );
    const patchClass = classifyMutation(patchRes.status, 'PATCH');
    checks.push({
      category: '5. Public Tables (Mutations)',
      name: 'anon cannot PATCH subscription_plans',
      status: patchClass.statusLabel,
      pass: patchClass.pass,
      detail: patchClass.detail
    });

    const delRes = await fetchAsAnon(
      `${baseUrl}/rest/v1/subscription_plans?id=eq.00000000-0000-0000-0000-000000000000`,
      { method: 'DELETE' },
      key,
      fetchFn
    );
    const delClass = classifyMutation(delRes.status, 'DELETE');
    checks.push({
      category: '5. Public Tables (Mutations)',
      name: 'anon cannot DELETE subscription_plans',
      status: delClass.statusLabel,
      pass: delClass.pass,
      detail: delClass.detail
    });
  } catch (err) {
    checks.push({
      category: '5. Public Tables (Mutations)',
      name: 'anon subscription_plans mutation guard',
      status: 'FAIL',
      pass: false,
      detail: `Network/Timeout error: ${err.message}`
    });
  }

  // 4. Public Table Read Allowlist: platform_settings (platform_identity ONLY)
  try {
    const allRes = await fetchAsAnon(`${baseUrl}/rest/v1/platform_settings?select=*`, { method: 'GET' }, key, fetchFn);
    const nonIdentRes = await fetchAsAnon(`${baseUrl}/rest/v1/platform_settings?key=neq.platform_identity&select=*`, { method: 'GET' }, key, fetchFn);
    const setClass = classifyPlatformSettings(allRes.status, allRes.body, nonIdentRes.body);
    checks.push({
      category: '4. Public Tables (Read)',
      name: 'anon can read only platform_identity key of platform_settings',
      status: setClass.statusLabel,
      pass: setClass.pass,
      detail: setClass.detail
    });
  } catch (err) {
    checks.push({
      category: '4. Public Tables (Read)',
      name: 'anon can read only platform_identity key of platform_settings',
      status: 'FAIL',
      pass: false,
      detail: `Network/Timeout error: ${err.message}`
    });
  }

  // platform_settings mutations must be blocked
  try {
    const insRes = await fetchAsAnon(`${baseUrl}/rest/v1/platform_settings`, { method: 'POST', body: {} }, key, fetchFn);
    const insClass = classifyMutation(insRes.status, 'INSERT');
    checks.push({
      category: '5. Public Tables (Mutations)',
      name: 'anon cannot INSERT platform_settings',
      status: insClass.statusLabel,
      pass: insClass.pass,
      detail: insClass.detail
    });

    const patchRes = await fetchAsAnon(
      `${baseUrl}/rest/v1/platform_settings?key=eq.00000000-0000-0000-0000-000000000000`,
      { method: 'PATCH', body: { description: 'unauthorized_setting_update' } },
      key,
      fetchFn
    );
    const patchClass = classifyMutation(patchRes.status, 'PATCH');
    checks.push({
      category: '5. Public Tables (Mutations)',
      name: 'anon cannot PATCH platform_settings',
      status: patchClass.statusLabel,
      pass: patchClass.pass,
      detail: patchClass.detail
    });

    const delRes = await fetchAsAnon(
      `${baseUrl}/rest/v1/platform_settings?key=eq.00000000-0000-0000-0000-000000000000`,
      { method: 'DELETE' },
      key,
      fetchFn
    );
    const delClass = classifyMutation(delRes.status, 'DELETE');
    checks.push({
      category: '5. Public Tables (Mutations)',
      name: 'anon cannot DELETE platform_settings',
      status: delClass.statusLabel,
      pass: delClass.pass,
      detail: delClass.detail
    });
  } catch (err) {
    checks.push({
      category: '5. Public Tables (Mutations)',
      name: 'anon platform_settings mutation guard',
      status: 'FAIL',
      pass: false,
      detail: `Network/Timeout error: ${err.message}`
    });
  }

  // 5. RPC Functions Lockdown (4 functions with exact parameter names)
  for (const rpc of RPC_DEFINITIONS) {
    try {
      const res = await fetchAsAnon(
        `${baseUrl}/rest/v1/rpc/${rpc.name}`,
        { method: 'POST', body: rpc.payload },
        key,
        fetchFn
      );
      const rpcClass = classifyRpc(res.status, rpc.name);
      checks.push({
        category: '6. RPC Functions',
        name: `anon cannot call RPC ${rpc.name}`,
        status: rpcClass.statusLabel,
        pass: rpcClass.pass,
        detail: rpcClass.detail
      });
    } catch (err) {
      checks.push({
        category: '6. RPC Functions',
        name: `anon cannot call RPC ${rpc.name}`,
        status: 'FAIL',
        pass: false,
        detail: `Network/Timeout error: ${err.message}`
      });
    }
  }

  const allPassed = checks.every(c => c.pass);
  return { allPassed, checks };
}

/**
 * Main CLI entry point.
 */
async function main() {
  dotenv.config();

  const rawUrl = process.env.SUPABASE_URL;
  const rawKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  console.log('='.repeat(78));
  console.log('PharmaCore Setup & Privilege Verification (Read-Only Anon Checks)');
  console.log('='.repeat(78));
  console.log('NOTICE ON SCOPE & LIMITATIONS:');
  console.log('  This script performs black-box HTTP verification against PostgREST as anon.');
  console.log('  It CANNOT inspect PostgreSQL system catalogs (pg_class, pg_trigger, pg_policy).');
  console.log('  Internal RLS flags and multi-tenant isolation across admin and pharmacist');
  console.log('  roles must be verified by running supabase/tests/rls_suite.sql in the SQL Editor.');
  console.log('='.repeat(78));

  let host = 'unknown';
  try {
    if (rawUrl) host = new URL(rawUrl).host;
  } catch {
    host = 'invalid URL';
  }

  console.log(`Target Supabase Host: ${host}`);
  console.log(`Configured Key Type : ${getKeyType(rawKey)}`);
  console.log('-'.repeat(78));

  let results;
  try {
    results = await runChecks({
      supabaseUrl: rawUrl,
      supabasePublishableKey: rawKey
    });
  } catch (err) {
    console.error(`\n[FATAL] Execution failed: ${err.message}`);
    process.exit(1);
  }

  let currentCategory = '';
  let passCount = 0;
  let failCount = 0;

  for (const check of results.checks) {
    if (check.category !== currentCategory) {
      currentCategory = check.category;
      console.log(`\n--- ${currentCategory} ---`);
    }

    const badge = check.status === 'PASS' ? '[PASS]' : `[${check.status}]`;
    console.log(`  ${badge.padEnd(16)} ${check.name}`);
    if (!check.pass || check.status !== 'PASS') {
      console.log(`                     -> ${check.detail}`);
      failCount++;
    } else {
      passCount++;
    }
  }

  console.log('\n' + '='.repeat(78));
  console.log(`SUMMARY: Total Checks: ${results.checks.length} | Passed: ${passCount} | Failed/Inconclusive: ${failCount}`);
  console.log('='.repeat(78));

  if (results.allPassed) {
    console.log('RESULT: PASS — Anon privilege boundaries verified successfully.\n');
    process.exit(0);
  } else {
    console.error('RESULT: FAIL — One or more anon privilege checks failed or were inconclusive.\n');
    process.exit(1);
  }
}

const isDirectExecution = process.argv[1] && (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
);

if (isDirectExecution) {
  main();
}
