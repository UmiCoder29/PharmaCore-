# PharmaCore Cross-Tenant RLS & Security Test Suite

This directory contains the automated security and Row Level Security (RLS) test suite for PharmaCore.

---

## 1. How It Works

The test suite is implemented in [`rls_suite.sql`](file:///e:/POSsystem/supabase/tests/rls_suite.sql).

- **Zero-Persistence Atomic Rollback**: The entire test suite executes in a single PL/pgSQL statement batch as the `postgres` role. At the end of the script, it prints the audit report by raising an intentional exception:
  ```sql
  RAISE EXCEPTION E'\n%', v_report;
  ```
  PostgreSQL aborts and rolls back the transaction completely. **Zero fixtures, test accounts, or test records are ever saved to the database.**
- **Sub-Transaction Test Isolation**: Every test write is executed in an isolated sub-block with an internal rollback sentinel, ensuring tests never interfere with one another.
- **Strict Block Verification (No False Passes)**: Only PostgreSQL error `42501` (`insufficient_privilege`) or `ROW_COUNT = 0` (RLS `USING` filter) counts as a security `BLOCK`. Any syntax error or constraint error (`23502`, `23503`, `22P02`, etc.) is flagged as a `TEST_ERROR` and causes a test failure.

---

## 2. How to Run by Hand

1. Log in to your **Supabase Dashboard**.
2. Select your project and navigate to the **SQL Editor** tab.
3. Open [`supabase/tests/rls_suite.sql`](file:///e:/POSsystem/supabase/tests/rls_suite.sql), copy its entire contents, and paste it into a new query window.
4. Click **Run**.
5. The query will finish with an error status containing the formatted text report. This is the intended behavior.

---

## 3. Interpreting the Report Output

The top line of the output displays the overall result and summary counts:

```text
SUITE_RESULT: FAIL (Total: 84, Passed: 81, Failed: 1, Known Gaps: 2)
================================================================================
PHARMACORE RLS & SECURITY TEST SUITE AUDIT REPORT
================================================================================

SUMMARY COUNTS:
  Total Tests Checked : 84
  Passed              : 81
  Failed              : 1
  Known Accepted Gaps : 2
```

### Expected Failure on First Run
On the current schema, exactly **1 test is expected to fail**:
- `[FAIL] 9. Limits Enforcement -> admin cannot insert branch beyond max_branches`
  - **Reason**: The `branches` table currently lacks a check or trigger enforcing the pharmacy's `max_branches` quota. This will be addressed in a subsequent migration.

### Known Accepted Gaps (Milestone 3)
Two known gaps are documented and counted under `Known Accepted Gaps` without failing the suite:
1. `admin can UPDATE sales in own pharmacy`: Direct UPDATE on sales by pharmacy admin (scheduled for lock down in Milestone 3).
2. `process_return allows duplicate return of same sale_item`: Quantity tracking across returns (scheduled for Milestone 3).

---

## 4. Configuration Options

At the top of [`supabase/tests/rls_suite.sql`](file:///e:/POSsystem/supabase/tests/rls_suite.sql), you can toggle the verbose logging flag:

```sql
v_verbose BOOLEAN := FALSE; -- Change to TRUE for a full line-by-line test execution log
```
When `v_verbose := FALSE`, the report remains compact (under 10 KB).
