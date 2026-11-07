# Milestone 1 Security Checklist & Audit Report

**Date**: 2026-11-02  
**Updated**: 2026-11-07 (updated after live runs reported by reviewer)  
**Repository**: PharmaCore (`UmiCoder29/PharmaCore-`)  
**Commit Inspected**: `597017356b01912c1097662265943512955c10ec`  
**Auditor**: Antigravity Automated Verification Agent  

---

## 1. Security Verification Matrix

| Check | How it was checked | Result (PASS, FAIL, or NOT RUN) | Evidence |
| :--- | :--- | :---: | :--- |
| **Secrets: `sb_secret_`** | `git log -p -S "sb_secret_"` across all commits & `git grep -n "sb_secret_"` | **PASS** | Zero real secret keys found in git history or working tree. Occurrences are strictly documentation placeholders (`SETUP.md`, `skills.md`), key type validator guards throwing security errors (`electron/config.js:116`, `scripts/verify-setup.mjs:130`), and rejection test fixtures (`tests/config.test.js`, `tests/verify-setup.test.js`). |
| **Secrets: `sb_publishable_`** | `git log -p -G "sb_publishable_"` across all commits & `git grep -n "sb_publishable_"` | **PASS** | Zero real live publishable keys committed. Occurrences are test fixtures (`'sb_publishable_abcdef1234567890'`) and documentation examples (`SETUP.md`). The live Supabase publishable key is public by design (client-side anonymous access token) and is expected, not a finding. |
| **Secrets: JWT Strings** | `git log -p -G "eyJ[a-zA-Z0-9_\-]{30,}"` across all commits & `git grep -E "eyJ[a-zA-Z0-9_\-]{30,}"` | **PASS** | Zero JWT credentials exist in git history or working tree (both commands returned 0 output). All test JWT tokens in unit tests are synthesized dynamically in-memory via test helpers (`makeMockJwt`). |
| **Secrets: Private Key Headers** | `git log -p -G "BEGIN.*PRIVATE KEY"` across all commits & `git grep -i "PRIVATE KEY"` | **PASS** | Zero private key headers or blocks found in git history or tree (command returned 0 output; grep matched only the `.gitignore` category header comment). |
| **Secrets: `service_role` as value** | `git log -S "service_role"` across all commits & `git grep -n "service_role"` | **PASS** | `service_role` appears exclusively as a PostgreSQL role name in SQL migrations (`GRANT ... TO service_role`), RLS bypass checks (`auth.role() = 'service_role'`), config validation rejection guards (`electron/config.js:134`), and the Edge Function environment variable name `SUPABASE_SERVICE_ROLE_KEY`. Never used as a secret credential value in client code. |
| **Old Project IDs (`*.supabase.co`)** | `git log --all -p` extraction of all `*.supabase.co` hostnames | **PASS** | The reviewer independently enumerated every *.supabase.co hostname from the git history and confirmed all 14 are placeholders or test fixtures, and that the live host guomtiflloytteecjtcp.supabase.co was never committed. |
| **Secrets: `Admin@12345`** | `git log -p -S "Admin@12345"` across all commits & `git grep "Admin@12345"` | **PASS** | Zero occurrences in commit history or working tree (commands returned empty output). |
| **Secrets: `password123`** | `git log -S "password123"` across all commits & `git grep -n "password123"` | **PASS** | Appears strictly in commit `cdc6a28` as an entry in `COMMON_WEAK_PASSWORDS` blocklists (`electron/auth.js:33`, `src/components/LoginScreen.jsx:6`, `tests/first-login-password.test.js:268`) to reject weak user passwords during account setup and password change. Never used as a credential. |
| **Secrets: Email/Password Pairs** | `git grep -i -E "email.*password\|password.*email"` across history & tree | **PASS** | No plaintext email + password credentials pair found. Matches are limited to UI login error strings (`'Invalid email or password.'`), unit test payload mocks, and legacy database seed scripts using `crypt(gen_random_uuid()::text, gen_salt('bf'))`. |
| **Service Role Isolation: App Bundle & Shipping Files** | `Get-ChildItem -Path dist -Recurse -File \| Select-String` and `git grep -n -E "service_role\|SUPABASE_SERVICE_ROLE_KEY\|sb_secret" -- src/ electron/ scripts/ main.js preload.js package.json` | **PASS** | `dist/` exists in the repository. Full regex inspection across `dist/**/*`, `electron/**/*`, `main.js`, `preload.js`, `package.json`, `src/`, and `scripts/` proved zero service role keys, secret keys, or JWT secrets exist in shipping code. |
| **Service Role Isolation: `getAdminClient()`** | Inspected `electron/supabaseClient.js` lines 111–113 | **PASS** | `export function getAdminClient() { return null; }` explicitly returns `null`. |
| **Service Role Isolation: Environment Variables** | `git grep -n "SUPABASE_SERVICE_ROLE_KEY"` | **PASS** | `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` is called exclusively in `supabase/functions/provision-pharmacy/index.ts:85`. Zero occurrences in Electron main process, preload, or renderer. |
| **Clean Dependency Install: `npm ci`** | Executed `npm ci` on clean working tree | **PASS** | Exited with code 0 (`added 532 packages, and audited 533 packages in 2m`). |
| **Automated Test Suite: `npm test`** | Executed `npm test` (`node --test`) | **PASS** | 81 tests passing across 25 suites, 0 failures, 0 skipped, 0 cancelled, duration ~1067ms. |
| **AST Identifier Scan: `npm run scan`** | Executed `npm run scan` (`node scripts/scan-undefined-identifiers.mjs`) | **PASS** | Exited with code 0, raw AST output: `[]` (zero undefined identifiers across UI components). |
| **Dependency Vulnerability Audit: `npm audit`** | Executed `npm audit --json` | **FAIL (Audit Findings)** | 41 vulnerabilities reported (3 Critical, 20 High, 18 Moderate across 23 packages). Grouped below into Fix Now, Fix Later, and No Action. |
| **Repo Hygiene: Sensitive Files Tracked** | `git ls-files` checking `.env*`, `electron/runtime-config.json`, installers, DBs, keys | **PASS** | Zero sensitive or binary artifacts tracked in git index (only `.env.example` template is tracked). |
| **Repo Hygiene: `.gitignore` Coverage** | Inspected `.gitignore` lines 1–60 | **PASS** | Explicit ignore rules for `dist/`, `release/`, `*.exe`, `*.msi`, `*.dmg`, `.env`, `.env.*`, `*.db`, `*.sqlite`, `runtime-config.json`, `electron/runtime-config.json`, `*.pem`, `*.key`. |
| **Repo Hygiene: Large Files (>5 MB)** | File size audit across all `git ls-files` and shipping bundle files | **PASS** | Zero tracked or shipping files over 5 MB. Largest tracked file is `package-lock.json` (277 KB). `dist/` exists in the repo and its largest file is `dist/assets/index-nhQ4XGxT.js` (604 KB). |
| **Database: Migration Inventory** | `Get-ChildItem -File supabase/migrations/*.sql` sorted by name | **PASS** | Exactly 9 sequential migrations present in repository in filename order. |
| **Database: SECURITY DEFINER Search Paths** | Inspected all 15 `SECURITY DEFINER` functions across migrations | **PASS** | 100% of `SECURITY DEFINER` functions declare a fixed search_path (`SET search_path = public` or `SET search_path = public, pg_temp`). The reviewer queried the live project and found 16 SECURITY DEFINER functions, all with a fixed search_path and none executable by anon; the 16th, rls_auto_enable, is a Supabase platform built-in that is not in the repo migrations and is executable by the service role only; the functions executable by authenticated are exactly the 11 approved ones. |
| **Database: Authenticated Grants vs Audit List** | Compared migration `GRANT EXECUTE ... TO authenticated` with `supabase/tests/rls_suite.sql:1050-1054` | **PASS** | Exactly 11 functions granted to `authenticated`, matching the 11 approved routines in `rls_suite.sql` with 0 mismatches. |
| **Edge Function: JWT Verification Enabled** | Inspected `supabase/config.toml` lines 3–4 | **PASS** | `[functions.provision-pharmacy]` configures `verify_jwt = true`. |
| **Edge Function: SuperAdmin Authorization** | Inspected `supabase/functions/provision-pharmacy/index.ts` lines 160–185 | **PASS** | Validates session JWT via `auth.getUser()`, queries `app_users` under caller token, and rejects non-superadmins with HTTP 403. |
| **Edge Function: Secret & Password Logging** | Inspected all `console.` calls in `provision-pharmacy/index.ts` | **PASS** | Temporary password and service keys are never passed to logger in any branch (success, failure, or compensating rollback). |
| **Edge Function: Email Enumeration Prevention** | Inspected `provision-pharmacy/index.ts` lines 372–381 | **PASS** | Returns uniform generic error `Unable to provision pharmacy with the provided information. Please verify input details and try again.` when user creation fails. |
| **Live Database: Cross-Tenant RLS Suite** | Execution of `supabase/tests/rls_suite.sql` against live PostgreSQL | **PASS** | SUITE_RESULT PASS, 402 checks, 400 passed, 0 failed, 2 known accepted gaps (duplicate return of the same sale item, and an admin updating sales in their own pharmacy; both belong to Milestone 3). All 19 tables blocked cross-tenant for both admin and pharmacist. Everything rolled back (reported by the reviewer, run live at repo commit 8d66c31). |
| **Live Database: First-Login Flag Suite** | Execution of `supabase/tests/first_login_flag_suite.sql` against live PostgreSQL | **PASS** | 19 of 19 passed. Everything rolled back (reported by the reviewer, run live at repo commit 5970173). |
| **Live Database: Provisioning RPC Suite** | Execution of `supabase/tests/provision_pharmacy_suite.sql` against live PostgreSQL | **PASS** | 34 of 34 passed. Everything rolled back (reported by the reviewer, run live at repo commit 8d66c31). |
| **Live Database: Verify Setup Script** | Execution of `npm run verify-setup` with live environment credentials | **PASS** | 81 of 81 passed, 0 failed or inconclusive (reported by the reviewer, run live on reviewer's machine). |

---

## 2. Reviewer Notes

### Note: hostnames found in git history
Every distinct `*.supabase.co` hostname appearing anywhere in git history was extracted along with the earliest commit in which it appears. All 14 hostnames differ from the live project ID (`guomtiflloytteecjtcp.supabase.co`):

| Hostname | First Commit | Description | Status |
| :--- | :--- | :--- | :---: |
| `abcdefghij.supabase.co` | `84563df` | Initial UI mockup placeholder | Placeholder / test fixture |
| `abcdefghijklm.supabase.co` | `206ad24` | Config validation test fixture | Placeholder / test fixture |
| `build-time.supabase.co` | `206ad24` | Config packaging test fixture | Placeholder / test fixture |
| `demo-project.supabase.co` | `206ad24` | Config validation test fixture | Placeholder / test fixture |
| `dev-env.supabase.co` | `206ad24` | Config packaging test fixture | Placeholder / test fixture |
| `hostile-override.supabase.co` | `206ad24` | Config security override test | Placeholder / test fixture |
| `packaged-app.supabase.co` | `206ad24` | Config packaging test fixture | Placeholder / test fixture |
| `project.supabase.co` | `84563df` | Documentation / test URL | Placeholder / test fixture |
| `testproject.supabase.co` | `ead3647` | verify-setup mock test fixture | Placeholder / test fixture |
| `valid-in-env.supabase.co` | `752e526` | Startup lifecycle test fixture | Placeholder / test fixture |
| `xyz.supabase.co` | `81e9255` | SETUP.md CLI placeholder example | Placeholder / test fixture |
| `xyz-123_proj.supabase.co` | `206ad24` | Config validation test fixture | Placeholder / test fixture |
| `xyzcompany.supabase.co` | `84563df` | Initial UI mockup placeholder | Placeholder / test fixture |
| `your-project.supabase.co` | `84563df` | README / TESTS.md placeholder | Placeholder / test fixture |

*Reviewer Verification Command*:
```bash
git log --all -p | grep -oE "[a-zA-Z0-9_\-]+\.supabase\.co" | sort -u
```
*Note*: The live project hostname `guomtiflloytteecjtcp.supabase.co` has never been committed to git history (0 occurrences).

---

### FAIL 2: NPM Dependency Audit Vulnerabilities
`npm audit` reported 41 vulnerabilities (3 Critical, 20 High, 18 Moderate across 23 packages):

#### Group A: Fix Now (Safe Semver Update)
- `proxy-addr` (Critical, transitive via `express@5.2.1`): Ships in packaged app. Safe update available via `npm audit fix`.
- `body-parser` (High, transitive via `express@5.2.1`): Ships in packaged app. Safe update available via `npm audit fix`.

#### Group B: Fix Later (Breaking Major Semver Change)
- `tar` (Critical, transitive via `electron-builder` -> `app-builder-lib`): Dev-only packaging tool. Requires `electron-builder@26.18.0` (`npm audit fix --force`).
- `electron` (High, direct `devDependencies`): Dev-only. Requires `electron@45.2.1`.
- `electron-builder` (High, direct `devDependencies`): Dev-only. Requires `electron-builder@26.18.0`.
- `app-builder-lib` (High, transitive via `electron-builder`): Dev-only. Requires `electron-builder@26.18.0`.
- `builder-util` (High, transitive via `electron-builder`): Dev-only. Requires `electron-builder@26.18.0`.
- `builder-util-runtime` (High, transitive via `electron-builder`): Dev-only. Requires `electron-builder@26.18.0`.
- `dmg-builder` (High, transitive via `electron-builder`): Dev-only. Requires `electron-builder@26.18.0`.
- `extract-zip` (High, transitive via `electron`): Dev-only. Requires `electron@45.2.1`.
- `vite` (High, direct `devDependencies`): Dev-only build tool. Requires `vite@8.3.5`.

#### Group C: No Action (Dev-Only Tooling, Unreachable in Production App)
- `shell-quote` (Critical, transitive via `concurrently@8.2.2`): Dev orchestration runner. Never bundled into desktop binary.
- `@xmldom/xmldom` (High, transitive via `electron-builder` -> `app-builder-lib` -> `@electron/osx-sign` -> `plist`): macOS code signing utility on developer machines.
- `axios` (High, transitive via `wait-on@7.2.0`): Dev test runner polling utility.
- `follow-redirects` (High, transitive via `wait-on@7.2.0` -> `axios`): Dev test runner polling utility.
- `joi` (High, transitive via `wait-on@7.2.0`): Dev test runner schema validator.
- `brace-expansion` (High, transitive via `electron-builder`): Build packaging utility.
- `browserslist` (High, transitive via `autoprefixer` and `@vitejs/plugin-react`): CSS/JS bundling tool.
- `electron-builder-squirrel-windows` (High, transitive via `electron-builder`): Windows Squirrel installer utility.
- `electron-publish` (High, transitive via `electron-builder`): Artifact release publishing tool.
- `js-yaml` (High, transitive via `electron-builder`): Config parser for builder.
- `nanoid` (High, transitive via `postcss@8.5.19`): CSS pre-processor tool.
- `source-map-js` (High, transitive via `postcss@8.5.19`): Source map parser for build tool.

*Reviewer Verification Command*:
```bash
npm audit
```

---

All verification checks have now been run.

---

## 3. Open findings

- **Unused production dependencies**: `express`, `cors`, and `pg` remain listed as production dependencies in `package.json`. They cause all three production vulnerabilities reported by `npm audit` (1 critical in `proxy-addr` via `express`, 1 high in `body-parser` via `express`, 1 moderate).
- **RLS test suite known accepted gaps**: 2 known accepted gaps reported by the reviewer in `supabase/tests/rls_suite.sql` (duplicate return of the same sale item, and an admin updating sales in their own pharmacy; both belong to Milestone 3).
- **Dev-only vulnerabilities**: Breaking changes from `npm audit` in developer and packaging dependencies (Group B: `tar`, `electron`, `electron-builder`, `app-builder-lib`, `builder-util`, `builder-util-runtime`, `dmg-builder`, `extract-zip`, `vite`) and dev tooling (Group C: `shell-quote`, `@xmldom/xmldom`, `axios`, `follow-redirects`, `joi`, etc.) to be resolved in a future dependency update.
