# PharmaCore Database & Security Setup Guide

This guide describes how to provision, migrate, configure, and verify the Supabase backend for PharmaCore from scratch. It is written for a solo developer or operations engineer to establish an identical, hardened environment using only the repository files.

---

## 1. Create the Supabase Project

1. Log in to [Supabase](https://supabase.com) and click **New project**.
2. **Organization**: Select your organization.
3. **Name**: `PharmaCore-Production` (or appropriate environment name).
4. **Database Password**: Generate a high-entropy, strong password (at least 20 alphanumeric and special characters) using a password manager.
   > [!CAUTION]
   > Store the database password securely in your password manager. Never commit it to git, never place it in `.env`, and never distribute it in client builds.
5. **Region**: Select the region closest to your pharmacy customers (e.g., Singapore `ap-southeast-1` or Middle East / South Asia regions).
6. **Postgres Version**: Use the current default version (the live project runs PostgreSQL 17).
7. Click **Create new project** and wait for provisioning to complete.

---

## 2. Apply Migrations in Filename Order

The repository contains 5 sequential migration files in [`supabase/migrations/`](file:///e:/POSsystem/supabase/migrations). They build the relational schema, establish extensions, seed baseline pricing and platform branding, and harden database privileges, functions, and tenant boundaries.

Apply the migrations in **exact filename order**:

1. [`20261025000001_baseline.sql`](file:///e:/POSsystem/supabase/migrations/20261025000001_baseline.sql)
2. [`20261025000002_harden_privileges.sql`](file:///e:/POSsystem/supabase/migrations/20261025000002_harden_privileges.sql)
3. [`20261026000001_split_plans_read_policy.sql`](file:///e:/POSsystem/supabase/migrations/20261026000001_split_plans_read_policy.sql)
4. [`20261026000002_definer_and_escalation_hardening.sql`](file:///e:/POSsystem/supabase/migrations/20261026000002_definer_and_escalation_hardening.sql)
5. [`20261026000003_enforce_branch_limit.sql`](file:///e:/POSsystem/supabase/migrations/20261026000003_enforce_branch_limit.sql)

> [!NOTE]
> Migration timestamps in the repository and those in the live `supabase_migrations.schema_migrations` table may differ if applied via the dashboard or across environments. That is completely normal as long as the sequential ordering is maintained.
> Note: Do not claim or assume the migrations have been tested from a blank project until you execute the verification steps in Section 6.

### How to Apply:

#### Option A: Supabase Dashboard SQL Editor (Recommended for Solo Setup)
1. In the Supabase Dashboard, open **SQL Editor**.
2. For each migration file in sequence:
   - Click **New query**.
   - Copy the entire SQL content from the repository file.
   - Click **Run** (or `Ctrl+Enter`).
   - Confirm the query executes with `Success. No rows returned`.

#### Option B: Supabase CLI
If using the Supabase CLI linked to your project:
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### How to Confirm Each Migration Succeeded:

- **Migration 1 (Baseline)**:
  - In **Table Editor**, confirm 19 tables exist under `public`: `pharmacies`, `branches`, `app_users`, `categories`, `suppliers`, `medicines`, `batches`, `customers`, `prescriptions`, `sales`, `sale_items`, `sale_payments`, `returns`, `return_items`, `activity_logs`, `settings`, `subscription_inquiries`, `subscription_plans`, and `platform_settings`.
  - In **Database > Extensions**, confirm `pgcrypto` and `uuid-ossp` are enabled.
  - In `subscription_plans`, confirm 4 baseline tiers are seeded (`trial`, `starter`, `professional`, `enterprise`).
  - In `platform_settings`, confirm 3 rows exist (`platform_identity`, `trial_policy`, `security_policy`).
- **Migration 2 (Privilege Hardening)**:
  - Run `SELECT * FROM information_schema.role_table_grants WHERE grantee = 'anon';` in SQL Editor.
  - Confirm `anon` has table permissions **only** for `SELECT` on `subscription_plans` and `platform_settings`.
- **Migration 3 (Split Plans Read Policy)**:
  - Confirm policies on `subscription_plans` include `anon_read_active_plans` and `authenticated_read_plans`.
- **Migration 4 (Definer & Escalation Hardening)**:
  - In **Database > Triggers**, confirm `trg_protect_app_users_escalation` on `app_users` and `trg_protect_pharmacy_billing` on `pharmacies`.
  - In **Authentication > Policies**, confirm direct `INSERT` on `sales`, `sale_items`, `sale_payments`, `returns`, and `return_items` is restricted to `superadmin`.
- **Migration 5 (Branch Limit Enforcement)**:
  - In **Database > Triggers**, confirm `trg_enforce_branch_limit` on `branches`.
  - In `activity_logs`, confirm SELECT is restricted to admins and superadmins (`read_activity_logs`).

---

## 3. Configure Supabase Dashboard Settings

Open the Supabase Dashboard for your project and configure the following settings:

### a) Authentication > Providers > Email
- **Enable Email Provider**: `ON`
- **Confirm email**: `ON`
  - *Protection*: Ensures users own the email address used for their account. Prevents unauthorized account claiming and identity spoofing.
- **Secure email change**: `ON`
  - *Protection*: Requires confirmation from both the old and new email addresses when updating an email. Prevents account takeover in the event of temporary workstation access.

### b) Authentication > URL Configuration
- **Site URL**: Set to your primary application origin (e.g. `http://localhost:5173` for development, or your packaged application protocol scheme).
- **Redirect URLs**: Explicitly whitelist only legitimate client callback URLs.
  - *Protection*: Strictly reject wildcard (`*`) redirect URLs. Prevents open-redirect vulnerabilities where authentication tokens or magic link hashes could be leaked to an attacker-controlled host.

### c) Authentication > Sign In / Sign Up
- **Allow new users to sign up**: `OFF` (Disabled)
  - *Protection*: PharmaCore is a closed SaaS platform. Tenants, branches, and staff users are provisioned exclusively by administrators. Disabling public registrations blocks unauthorized actors from creating arbitrary accounts in your Supabase Auth user directory.

### d) Authentication > Security and Protection (Password Policy)
- **Minimum password length**: Set to `10` characters (conforms to PharmaCore Prompt 1.9 security standards).
  - *Protection*: Enforces adequate entropy to resist dictionary and brute-force attacks against staff credentials.
  - *Note on Plan-Dependent Features*: Some advanced protection controls (such as automated leaked-password / HaveIBeenPwned database checks or enterprise SSO) depend on your Supabase subscription tier. Do not assume or rely on them if operating on a free tier.

---

## 4. API Keys & Local Environment Configuration

1. In the Supabase Dashboard, navigate to **Project Settings > API**.
2. Locate the following values:
   - **Project URL**: `https://<your-project-ref>.supabase.co`
   - **Publishable Key**: Look under **Project API keys** for `anon` / `public` (begins with `sb_publishable_` or a standard `anon` public JWT).
3. Create a `.env` file in the project root:
   ```env
   SUPABASE_URL=https://<your-project-ref>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_<your-key>
   ```

> [!CAUTION]
> **STRICT SECURITY REQUIREMENT: NEVER USE THE SERVICE ROLE KEY**
> - The `service_role` key and `sb_secret_` keys bypass PostgreSQL Row Level Security completely.
> - The PharmaCore desktop application is an untrusted client environment. Bundling or referencing a service role key in `.env`, client code, or git commits exposes full database read/write access to anyone who inspects the application.
> - The repository's configuration validator ([`electron/config.js`](file:///e:/POSsystem/electron/config.js)) will fail-fast and terminate startup immediately if a service role or secret key is detected.

---

## 5. Create the First Superadmin Securely

Because Migration 4 (`fn_protect_app_users_escalation`) actively blocks regular users and pharmacy admins from creating superadmins or escalating roles, the initial superadmin **cannot be created through the desktop app**. It must be provisioned through a trusted administrative channel (the Supabase Dashboard and SQL Editor).

### Step 1: Create the Auth User in the Dashboard
1. Go to **Authentication > Users** in the Supabase Dashboard.
2. Click **Add user** -> **Create user**.
3. Enter:
   - **User Email**: `<EMAIL>` (e.g., `superadmin@pharmacore.pk`)
   - **User Password**: `<INITIAL_PASSWORD>` (generate a strong temporary password)
   - **Auto Confirm User**: Checked / Enabled.
4. Click **Create user**.
5. Find the newly created user in the list and copy the **User UID** (`<USER_UUID>`).

### Step 2: Insert the Superadmin Profile via SQL Editor
Open the **SQL Editor** in the Supabase Dashboard (runs as the `postgres` superuser with `auth.uid() IS NULL`, which bypasses the escalation trigger) and execute:

```sql
INSERT INTO public.app_users (
    id,
    username,
    display_name,
    role,
    pharmacy_id,
    branch_id,
    can_view_all_branches,
    must_change_password
) VALUES (
    '<USER_UUID>',
    '<SUPERADMIN_USERNAME>',
    '<SUPERADMIN_DISPLAY_NAME>',
    'superadmin',
    NULL,
    NULL,
    TRUE,
    TRUE
);
```

### Safety & Integrity Rules for Superadmin Creation:
- Replace `<USER_UUID>` with the actual UUID copied from Step 1.
- Replace `<SUPERADMIN_USERNAME>` and `<SUPERADMIN_DISPLAY_NAME>` with descriptive administrative identifiers (e.g., `sysadmin`, `System Superadmin`).
- Notice that every NOT NULL column (`id`, `username`, `role`), plus `display_name`, `pharmacy_id`, `branch_id`, `can_view_all_branches`, and `must_change_password`, is explicitly provided.
- `pharmacy_id` and `branch_id` **must be NULL** for a superadmin account.
- `must_change_password` is set to `TRUE` so the user is required to reset their password upon first login.
- **NEVER** write real passwords or real user UUIDs into repository documentation or migration scripts.

---

## 6. Verify the Setup Worked

Verification consists of two complementary procedures: an external read-only black-box test, followed by an internal catalog and multi-tenant RLS test suite.

### Step 1: Run the External Verification Script
From the repository root, run:
```bash
npm run verify-setup
```

This executes [`scripts/verify-setup.mjs`](file:///e:/POSsystem/scripts/verify-setup.mjs) against the live PostgREST API using the anonymous role (`anon`) with the configured publishable key.

#### Expected Output:
- Validates configuration (fails fast if a secret or service role key is present).
- Confirms `anon` cannot `SELECT`, `INSERT`, `PATCH`, or `DELETE` on any of the 17 tenant tables (each blocked with HTTP 401/403).
- Confirms `anon` can read active `subscription_plans` with HTTP 200, and cannot mutate plans.
- Confirms `anon` can read only the `platform_identity` row of `platform_settings` with HTTP 200, and cannot mutate settings.
- Confirms `anon` cannot call any RPC functions (`process_sale`, `process_return`, `approve_return`, `get_supplier_dashboard_stats`).
- Exits with return code `0`.

> [!NOTE]
> **Honest Note on Vacuous Cases**:
> - The check verifying that inactive subscription plans (`is_active=false`) return an empty list is currently vacuous on a fresh database, because all 4 baseline plans are seeded with `is_active=true`. It will actively filter once an inactive plan is introduced.
> - The check verifying that non-identity platform settings keys return an empty list is **non-vacuous**: `trial_policy` and `security_policy` exist in the database, but RLS successfully prevents `anon` from reading them.

### Step 2: Run the SQL Editor RLS Test Suite
1. In the Supabase Dashboard, open the **SQL Editor**.
2. Open [`supabase/tests/rls_suite.sql`](file:///e:/POSsystem/supabase/tests/rls_suite.sql).
3. Copy the entire file content into a new query window and click **Run**.

#### Expected Output:
The query will finish with an intentional exception displaying the report:
```text
SUITE_RESULT: PASS (Total: ..., Passed: ..., Failed: 0, Known Gaps: 2)

FAILURES: None

KNOWN GAPS (2):
  [KNOWN] duplicate return of same sale item blocked (returns)
  [KNOWN] admin cannot UPDATE sales in own pharmacy (sales)

MATRIX (19 tables, S I U D):
...
SUITE_RESULT: PASS (Total: ..., Passed: ..., Failed: 0, Known Gaps: 2)
END OF SUITE
```

#### Why it rolls back:
The test suite executes inside an anonymous PL/pgSQL block (`DO $$ ... $$`) that creates mock pharmacies, branches, and users across tenants, runs cross-tenant security assertions, and culminates in `RAISE EXCEPTION E'\n%', v_report;`. This deliberate exception ensures that PostgreSQL **atomically rolls back all changes**, leaving zero test artifacts or mock users in your database.

---

## 7. Troubleshooting: 5 Common Failures & Fixes

### 1. HTTP 401/403 or Permission Denied when Reading `subscription_plans`
- **Symptom**: `npm run verify-setup` reports a failure on public plans read, or the desktop app pricing screen fails to load.
- **Cause**: Migration 3 ([`20261026000001_split_plans_read_policy.sql`](file:///e:/POSsystem/supabase/migrations/20261026000001_split_plans_read_policy.sql)) was skipped or executed before Migration 2. The older policy called `is_superadmin()`, which `anon` cannot execute.
- **Fix**: Re-run Migration 3 in the SQL Editor. Afterward, force PostgREST to reload its schema cache:
  ```sql
  NOTIFY pgrst, 'reload schema';
  ```

### 2. Superadmin Creation Blocked by Trigger
- **Symptom**: `INSERT INTO public.app_users` fails with `ERROR: Only superadmin can create superadmin accounts`.
- **Cause**: The insert was executed through a client API call or a tool carrying an authenticated user's JWT instead of direct administrative SQL.
- **Fix**: Run the `INSERT` directly in the Supabase Dashboard SQL Editor as the `postgres` user. In that context, `auth.uid() IS NULL`, which allows the migration and superadmin bootstrapping to succeed.

### 3. Verification Script Refuses Key with "Security violation"
- **Symptom**: `npm run verify-setup` outputs `Security violation: SUPABASE_PUBLISHABLE_KEY is a service_role key` or `starts with "sb_secret_"`.
- **Cause**: The `service_role` secret key was copied into `.env`.
- **Fix**: Open **Project Settings > API** in the Supabase Dashboard, copy the `anon` / `public` key (`sb_publishable_...`), and paste it into `.env`.

### 4. Application Startup Fails with "Invalid SUPABASE_URL"
- **Symptom**: Desktop app displays "Configuration Error: host must match https://<ref>.supabase.co" on launch.
- **Cause**: The `SUPABASE_URL` in `.env` contains leading/trailing whitespace, a trailing slash (e.g., `https://xyz.supabase.co/`), a path prefix, or credentials.
- **Fix**: Format `SUPABASE_URL` strictly as `https://<ref>.supabase.co` with no path, query parameters, or trailing slashes.

### 5. RLS Suite Reports FAIL on Branch Limits or Activity Logs
- **Symptom**: Running `rls_suite.sql` fails with errors in category `11. Limits Enforcement` or `Activity Logs`.
- **Cause**: Migration 5 ([`20261026000003_enforce_branch_limit.sql`](file:///e:/POSsystem/supabase/migrations/20261026000003_enforce_branch_limit.sql)) was not applied.
- **Fix**: Run Migration 5 in the SQL Editor and re-run `rls_suite.sql`.
