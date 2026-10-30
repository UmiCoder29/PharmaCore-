# HTTP Test Suite: `provision-pharmacy` Edge Function

This document contains manual HTTP test scenarios for verifying the `provision-pharmacy` Supabase Edge Function once deployed.

> **Safety Warning**: All commands below use placeholder variables (`<SUPABASE_URL>`, `<SUPERADMIN_JWT>`, `<PHARMACIST_JWT>`). Replace them with non-production test credentials. Never execute these tests with live production customer data.

---

## Environment Setup
Set local terminal variables before executing tests:
```bash
export SUPABASE_URL="https://<your-project-ref>.supabase.co"
export FUNCTION_URL="${SUPABASE_URL}/functions/v1/provision-pharmacy"
export SUPERADMIN_JWT="<valid-superadmin-session-jwt>"
export PHARMACIST_JWT="<valid-pharmacist-session-jwt>"
export ANON_KEY="<public-anon-key>"
```

---

## 1. HTTP Method Restriction (POST Only)
Calls using any method other than `POST` must be rejected immediately with HTTP 405.

```bash
curl -i -X GET "${FUNCTION_URL}" \
  -H "Authorization: Bearer ${SUPERADMIN_JWT}" \
  -H "apikey: ${ANON_KEY}"
```
**Expected Response**:
* HTTP Status: `405 Method Not Allowed`
* Header: `Allow: POST`
* Header: `Cache-Control: no-store, no-cache, must-revalidate`
* Body:
  ```json
  {"success":false,"error":"Method Not Allowed. Use POST."}
  ```

---

## 2. Missing Authorization Header
Requests without a bearer token must be rejected.

```bash
curl -i -X POST "${FUNCTION_URL}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${ANON_KEY}" \
  -d '{"pharmacyName":"Test Pharmacy","adminEmail":"owner@test.local","adminUsername":"owneradmin","planTier":"trial"}'
```
**Expected Response**:
* HTTP Status: `401 Unauthorized`
* Body:
  ```json
  {"success":false,"error":"Missing or malformed Authorization header."}
  ```

---

## 3. Invalid or Expired JWT
Requests with forged or expired tokens must be rejected.

```bash
curl -i -X POST "${FUNCTION_URL}" \
  -H "Authorization: Bearer invalid.jwt.token" \
  -H "Content-Type: application/json" \
  -H "apikey: ${ANON_KEY}" \
  -d '{"pharmacyName":"Test Pharmacy","adminEmail":"owner@test.local","adminUsername":"owneradmin","planTier":"trial"}'
```
**Expected Response**:
* HTTP Status: `401 Unauthorized`
* Body:
  ```json
  {"success":false,"error":"Invalid or expired session token."}
  ```

---

## 4. Role Authorization (Pharmacist Calling Provisioning)
Non-superadmin accounts (pharmacist or standard admin) must be rejected with HTTP 403.

```bash
curl -i -X POST "${FUNCTION_URL}" \
  -H "Authorization: Bearer ${PHARMACIST_JWT}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${ANON_KEY}" \
  -d '{"pharmacyName":"Unauthorized Pharmacy","adminEmail":"unauth@test.local","adminUsername":"unauthadmin","planTier":"trial"}'
```
**Expected Response**:
* HTTP Status: `403 Forbidden`
* Body:
  ```json
  {"success":false,"error":"Forbidden: SaaS Platform SuperAdmin access required."}
  ```

---

## 5. Pre-Phase-1 Rate Limiting (Failed Attempts Count)
Execute 11 rapid requests with a superadmin token (even deliberately invalid payloads). The 11th request must trigger rate limiting before any user creation is attempted.

```bash
for i in {1..11}; do
  echo "Request $i:"
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "${FUNCTION_URL}" \
    -H "Authorization: Bearer ${SUPERADMIN_JWT}" \
    -H "Content-Type: application/json" \
    -H "apikey: ${ANON_KEY}" \
    -d '{"pharmacyName":"X"}' # Deliberately invalid payload
done
```
**Expected Response on 11th Request**:
* HTTP Status: `429 Too Many Requests`
* Body:
  ```json
  {"success":false,"error":"Rate limit exceeded. Maximum 10 provisioning attempts per hour."}
  ```
* Database check: Verify `public.provision_attempts` records rows with `outcome: 'validation_failed'` and the 11th row with `outcome: 'rate_limited'`.

---

## 6. Input Validation & Strict Schema Checks
Any payload containing unexpected parameters or failing boundary constraints must return HTTP 400.

### 6.1 Unexpected Parameter Injection
```bash
curl -i -X POST "${FUNCTION_URL}" \
  -H "Authorization: Bearer ${SUPERADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${ANON_KEY}" \
  -d '{
    "pharmacyName": "Valid Pharmacy",
    "adminEmail": "valid@test.local",
    "adminUsername": "validuser",
    "planTier": "trial",
    "role": "superadmin"
  }'
```
**Expected Response**:
* HTTP Status: `400 Bad Request`
* Body:
  ```json
  {"success":false,"error":"Unexpected parameter: role"}
  ```

### 6.2 Pharmacy Name Length Violation (< 2 characters)
```bash
curl -i -X POST "${FUNCTION_URL}" \
  -H "Authorization: Bearer ${SUPERADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${ANON_KEY}" \
  -d '{"pharmacyName":"A","adminEmail":"valid@test.local","adminUsername":"validuser","planTier":"trial"}'
```
**Expected Response**:
* HTTP Status: `400 Bad Request`
* Body:
  ```json
  {"success":false,"error":"Pharmacy name must be between 2 and 100 characters."}
  ```

### 6.3 Malformed Email Address
```bash
curl -i -X POST "${FUNCTION_URL}" \
  -H "Authorization: Bearer ${SUPERADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${ANON_KEY}" \
  -d '{"pharmacyName":"Valid Pharmacy","adminEmail":"not-an-email","adminUsername":"validuser","planTier":"trial"}'
```
**Expected Response**:
* HTTP Status: `400 Bad Request`
* Body:
  ```json
  {"success":false,"error":"Invalid email address format."}
  ```

---

## 7. Pre-Phase-1 Username Uniqueness Check
Submitting an `adminUsername` that already exists (exact lowercase match) must be rejected prior to calling GoTrue Auth.

```bash
# Attempt to provision using an existing username (e.g. "sysadmin")
curl -i -X POST "${FUNCTION_URL}" \
  -H "Authorization: Bearer ${SUPERADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${ANON_KEY}" \
  -d '{
    "pharmacyName": "Unique Pharmacy Ltd",
    "adminEmail": "newemail_not_registered@test.local",
    "adminUsername": "SYSADMIN",
    "planTier": "trial"
  }'
```
**Expected Response**:
* HTTP Status: `400 Bad Request`
* Body:
  ```json
  {"success":false,"error":"Admin username is already taken. Please choose a different username."}
  ```
* Auth check: Verify `auth.users` has **no user** created for `newemail_not_registered@test.local`.

---

## 8. Inactive or Nonexistent Plan Tier
```bash
curl -i -X POST "${FUNCTION_URL}" \
  -H "Authorization: Bearer ${SUPERADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${ANON_KEY}" \
  -d '{
    "pharmacyName": "Unique Pharmacy Ltd",
    "adminEmail": "brand_new_admin@test.local",
    "adminUsername": "brandnewadmin",
    "planTier": "enterprise_gold_unlimited"
  }'
```
**Expected Response**:
* HTTP Status: `400 Bad Request`
* Body:
  ```json
  {"success":false,"error":"Invalid or inactive subscription plan tier."}
  ```

---

## 9. Duplicate Email Handling (Anti-Enumeration)
If an email is already registered in `auth.users`, the error returned must be generic and never leak whether the email exists.

```bash
# Use an email address already registered in your Supabase Auth directory
curl -i -X POST "${FUNCTION_URL}" \
  -H "Authorization: Bearer ${SUPERADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${ANON_KEY}" \
  -d '{
    "pharmacyName": "Duplicate Email Pharmacy",
    "adminEmail": "superadmin@pharmacore.pk",
    "adminUsername": "freshuser999",
    "planTier": "trial"
  }'
```
**Expected Response**:
* HTTP Status: `400 Bad Request`
* Body:
  ```json
  {"success":false,"error":"Unable to provision pharmacy with the provided information. Please verify input details and try again."}
  ```
* Integrity check: Query `public.pharmacies` for `"Duplicate Email Pharmacy"`. Result must be 0 rows.

---

## 10. Happy Path Provisioning (Trial Plan)
```bash
curl -i -X POST "${FUNCTION_URL}" \
  -H "Authorization: Bearer ${SUPERADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${ANON_KEY}" \
  -d '{
    "pharmacyName": "Al-Rehman Pharmacy",
    "city": "Lahore",
    "phone": "0300-9876543",
    "adminEmail": "rehman_admin@test.local",
    "adminUsername": "rehmanadmin",
    "adminDisplayName": "Haji Rehman",
    "branchName": "Main Mall Branch",
    "planTier": "trial"
  }'
```
**Expected Response**:
* HTTP Status: `200 OK`
* Headers:
  * `Cache-Control: no-store, no-cache, must-revalidate`
  * `Pragma: no-cache`
* Body format:
  ```json
  {
    "success": true,
    "pharmacy": {
      "id": "<UUID>",
      "name": "Al-Rehman Pharmacy",
      "slug": "al-rehman-pharmacy"
    },
    "admin": {
      "id": "<UUID>",
      "username": "rehmanadmin",
      "email": "rehman_admin@test.local"
    },
    "temporaryPassword": "<16-char-high-entropy-string>"
  }
  ```
* Database verification:
  1. `public.pharmacies`:
     * `subscription_status` is `'trial'`
     * `trial_ends_at` is ~14 days in future
     * `subscription_ends_at` is `NULL`
     * `contact_email` is `'rehman_admin@test.local'`
     * `contact_phone` is `'0300-9876543'`
     * `city` is `'Lahore'`
  2. `public.branches`:
     * `name` is `'Main Mall Branch'`
     * `is_main_branch` is `TRUE`
  3. `public.app_users`:
     * `username` is `'rehmanadmin'`
     * `role` is `'admin'`
     * `must_change_password` is `TRUE`
  4. `public.activity_logs`:
     * `action` is `'provision_pharmacy'`
     * `pharmacy_id` matches newly created pharmacy

---

## 11. Happy Path Provisioning (Paid Tier Status Mapping)
```bash
curl -i -X POST "${FUNCTION_URL}" \
  -H "Authorization: Bearer ${SUPERADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${ANON_KEY}" \
  -d '{
    "pharmacyName": "Khyber Mediclinic",
    "adminEmail": "khyber_admin@test.local",
    "adminUsername": "khyberadmin",
    "planTier": "professional"
  }'
```
**Expected Response**:
* HTTP Status: `200 OK`
* Database verification:
  * `subscription_status` is `'active'`
  * `trial_ends_at` is `NULL`
  * `subscription_ends_at` is ~365 days in future
  * `max_branches` and `max_users` match `subscription_plans` row for `'professional'`.

---

## 12. End-to-End First Login & Non-Looping Password Change
1. Call Supabase Auth `signInWithPassword` using `rehman_admin@test.local` and `temporaryPassword`.
2. Inspect the returned user session and query `app_users`:
   * Confirm `must_change_password === true`.
3. Call `changeOwnPassword(newSecurePassword)`.
4. Inspect `app_users` table:
   * Confirm `must_change_password` is now `false`.
5. Sign out and sign in again using `newSecurePassword`:
   * Confirm `must_change_password === false`.
   * Confirm the application does **not** loop back to the change-password modal.

---

## 13. Tenant Isolation Verification
1. Sign in as `khyber_admin@test.local` (Admin of Khyber Mediclinic).
2. Attempt to `SELECT * FROM public.medicines WHERE pharmacy_id = '<al-rehman-pharmacy-id>'`.
3. Attempt to `INSERT INTO public.branches (pharmacy_id, name) VALUES ('<al-rehman-pharmacy-id>', 'Hacked Branch')`.
**Expected Result**:
* Both queries return 0 rows or trigger RLS rejection. No cross-tenant visibility or writes.

---

## 14. Slug Collision & Fallback Verification
1. Submit a second request with `pharmacyName: "Al-Rehman Pharmacy"`.
   * Verify it succeeds with slug `al-rehman-pharmacy-<hex>`.
2. Submit a request with `pharmacyName: "!@#$%"`.
   * Verify it succeeds with slug `pharmacy-<hex>`.

---

## 15. Password Logging Audit
Inspect Supabase Edge Function console logs and server stdout:
* Confirm that neither `temporaryPassword` nor plain text credentials ever appear in log streams, exception stack traces, or `activity_logs.details`.

---

## 16. Operational Orphan Detection Query (Detection Only)
In the event of an unrecoverable crash between Auth creation and DB RPC, run this read-only SQL query in the Supabase SQL Editor to detect disconnected Auth users:

```sql
-- DETECTION ONLY: Find auth users created with no corresponding app_users profile
SELECT 
    u.id AS orphan_auth_id,
    u.email,
    u.created_at
FROM auth.users u
LEFT JOIN public.app_users a ON u.id = a.id
WHERE a.id IS NULL
  AND u.created_at < (now() - INTERVAL '15 minutes');
```
*(No automatic delete script is executed; orphaned records are reviewed manually by ops).*
