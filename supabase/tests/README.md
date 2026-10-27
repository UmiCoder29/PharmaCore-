# PharmaCore Cross-Tenant RLS & Security Test Suite

This directory contains the automated Row Level Security (RLS) and tenant isolation test suite for PharmaCore.

---

## 1. Architecture & Design

The test suite is implemented in [rls_suite.sql](rls_suite.sql).

- **Standalone Helper Functions (`pg_temp`)**: Before the main execution block, helper runners (`pg_temp.run_statement` and `pg_temp.run_script`) and the logger procedure (`pg_temp.log_result`) are defined in session-scoped temporary schema `pg_temp`.
- **Session Results Temp Table**: Test outcomes are stored in `pg_temp.suite_results`, inserted under the `postgres` role after `RESET ROLE`.
- **Zero-Persistence Atomic Rollback**: The suite creates test fixtures (pharmacies, branches, auth/app users, medicines, batches, sales, etc.) and tests operations in a single script batch. At completion, it raises an intentional exception carrying the audit report:
  ```sql
  RAISE EXCEPTION E'\n%', v_report;
  ```
  PostgreSQL automatically rolls back the transaction. Zero test records or test accounts persist in the database.
- **Sub-Transaction Test Isolation**: Statements execute in an inner sub-block that always triggers a sentinel rollback exception (`__TEST_SENTINEL_ROLLBACK__`), preventing test side-effects from polluting subsequent assertions.
- **Strict Block Verification (No False Passes)**: Only PostgreSQL error `42501` (`insufficient_privilege`) or `ROW_COUNT = 0` (RLS filter) classifies as a security `BLOCKED`. Triggers and functions raise custom exceptions (SQLSTATE `P0001`); if the test supplies an expected error substring and it matches, it counts as `BLOCKED`. Any unexpected error (e.g. `23502`, `23503`) is classified as `TEST_ERROR` (failure).
- **Multi-Step Runner (`pg_temp.run_script`)**: Executes an array of statements sequentially within a single rolled-back sub-transaction under a simulated user, optionally running a scalar `check_sql` validation query as `postgres` before rollback.
- **Table-Driven 152-Cell Matrix**: Generates cross-tenant assertions across all 19 public tables x 4 operations (SELECT, INSERT, UPDATE, DELETE) x 2 actors (`admin_a`, `pharmacist_a`).
- **Coverage Guard**: Queries `pg_temp.suite_results` to verify all 152 cells in the cross-tenant matrix were executed.
- **Known Accepted Gaps Handling**: Tests covering known gaps expect the secure outcome (`BLOCKED`). If the insecure outcome occurs, the test is classified as `KNOWN` rather than `PASS`. If secured, it becomes `PASS`.

---

## 2. How to Run by Hand

1. Log in to the **Supabase Dashboard**.
2. Navigate to the **SQL Editor** tab.
3. Open [rls_suite.sql](rls_suite.sql), copy its contents, and paste into the editor.
4. Click **Run**.
5. The execution will terminate with an error status displaying the formatted text report. This is the expected mechanism for displaying results while enforcing transaction rollback.

---

## 3. Interpreting the Report Output

> [!NOTE]
> The sample output below is an illustration of what the audit report looks like when executed in the Supabase SQL Editor.

```text
SUITE_RESULT: FAIL (Total: 215, Passed: 210, Failed: 3, Known Gaps: 2)
================================================================================
PHARMACORE RLS & SECURITY TEST SUITE AUDIT REPORT
================================================================================

SUMMARY COUNTS:
  Total Tests Checked : 215
  Passed              : 210
  Failed              : 3
  Known Accepted Gaps : 2

--------------------------------------------------------------------------------
FAILED TESTS DETAILS (3 failure(s)):
--------------------------------------------------------------------------------
  [FAIL] 11. Limits Enforcement -> admin cannot insert branch beyond max_branches
         Actor   : admin_a
         Details : MISMATCH: Expected BLOCKED but got ALLOWED
  ...

--------------------------------------------------------------------------------
KNOWN ACCEPTED GAPS (Milestone 3 Scope):
--------------------------------------------------------------------------------
  [KNOWN] duplicate return of same sale item blocked (KNOWN ACCEPTED GAP (Milestone 3))
  [KNOWN] admin cannot UPDATE sales in own pharmacy (KNOWN ACCEPTED GAP (Milestone 3))

--------------------------------------------------------------------------------
CROSS-TENANT ISOLATION MATRIX (19 Tables x 4 Operations x 2 Roles):
Legend: . = BLOCKED (secure), x = ALLOWED (accessible), ! = TEST_ERROR
--------------------------------------------------------------------------------
TABLE NAME             | ADMIN S I U D | PHARMACIST S I U D
-----------------------+---------------+--------------------
pharmacies             | admin . . . . | pharm . . . . 
branches               | admin . . . . | pharm . . . . 
app_users              | admin . . . . | pharm . . . . 
categories             | admin . . . . | pharm . . . . 
suppliers              | admin . . . . | pharm . . . . 
medicines              | admin . . . . | pharm . . . . 
batches                | admin . . . . | pharm . . . . 
customers              | admin . . . . | pharm . . . . 
prescriptions          | admin . . . . | pharm . . . . 
sales                  | admin . . . . | pharm . . . . 
sale_items             | admin . . . . | pharm . . . . 
sale_payments          | admin . . . . | pharm . . . . 
returns                | admin . . . . | pharm . . . . 
return_items           | admin . . . . | pharm . . . . 
activity_logs          | admin . . . . | pharm . . . . 
settings               | admin . . . . | pharm . . . . 
subscription_inquiries | admin . . . . | pharm . . . . 
subscription_plans     | admin . . . . | pharm . . . . 
platform_settings      | admin x . . . | pharm x . . . 

--------------------------------------------------------------------------------
CATEGORY SUMMARY BREAKDOWN:
--------------------------------------------------------------------------------
2. Cross-Tenant            | Total: 152 | Pass: 150 | Fail:  2 | Known:  0
2. Positive Controls       | Total:  17 | Pass:  17 | Fail:  0 | Known:  0
3. Coverage Guard          | Total:  20 | Pass:  20 | Fail:  0 | Known:  0
4. Branch Isolation        | Total:   3 | Pass:   3 | Fail:  0 | Known:  0
5. Role Rules              | Total:   5 | Pass:   5 | Fail:  0 | Known:  0
6. Anon Lockdown           | Total:   6 | Pass:   6 | Fail:  0 | Known:  0
7. Catalog Audit           | Total:  24 | Pass:  24 | Fail:  0 | Known:  0
8. Regression 1.5          | Total:  14 | Pass:  14 | Fail:  0 | Known:  0
9. Multi-Step              | Total:   2 | Pass:   2 | Fail:  0 | Known:  0
10. Known Gaps             | Total:   2 | Pass:   0 | Fail:  0 | Known:  2
11. Limits Enforcement     | Total:   1 | Pass:   0 | Fail:  1 | Known:  0

================================================================================
END OF AUDIT REPORT -- ALL TRANSACTIONS ROLLED BACK SAFELY
================================================================================
```

### Expected Failure on Limits Enforcement
- `[FAIL] 11. Limits Enforcement -> admin cannot insert branch beyond max_branches`
  - **Reason**: The `branches` table currently lacks a check constraint or trigger enforcing the pharmacy's `max_branches` quota. This enforcement is scheduled for a future migration.

### Known Accepted Gaps (Milestone 3 Scope)
Two gaps are tracked without failing the security suite:
1. `admin cannot UPDATE sales in own pharmacy`: Direct UPDATE on sales by pharmacy admin (scheduled for lock down in Milestone 3).
2. `duplicate return of same sale item blocked`: Quantity tracking across returns in `process_return` (scheduled for Milestone 3).

---

## 4. Configuration

In [rls_suite.sql](rls_suite.sql), verbose logging can be toggled via the variable at the top of the `DO $$` block:

```sql
v_verbose BOOLEAN := FALSE; -- Set to TRUE for individual test logs
```
When `v_verbose := FALSE`, the complete audit report is kept compact (< 10 KB).
