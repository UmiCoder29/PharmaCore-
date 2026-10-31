-- ==============================================================================
-- PharmaCore First-Login Password Flag Test Suite
-- File: supabase/tests/first_login_flag_suite.sql
--
-- INSTRUCTIONS FOR USE:
-- 1. Open Supabase Dashboard -> SQL Editor (or psql connected as postgres).
-- 2. Paste this entire file into the editor.
-- 3. Click "Run".
-- 4. The script executes as a single batch and terminates with:
--    RAISE EXCEPTION carrying the full text report.
--    This guarantees 100% atomic rollback of all test fixtures and statements.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TEMPORARY TEST RESULTS TABLE & ASSERTION PROCEDURE
-- ------------------------------------------------------------------------------

CREATE TEMP TABLE IF NOT EXISTS pg_temp.flag_test_results (
    id SERIAL PRIMARY KEY,
    test_name TEXT NOT NULL,
    expected TEXT NOT NULL,
    actual TEXT NOT NULL,
    status TEXT NOT NULL,
    details TEXT
);

TRUNCATE TABLE pg_temp.flag_test_results;

CREATE OR REPLACE PROCEDURE pg_temp.assert_equal(
    p_name TEXT,
    p_expected TEXT,
    p_actual TEXT,
    p_details TEXT DEFAULT ''
) AS $$
BEGIN
    INSERT INTO pg_temp.flag_test_results (test_name, expected, actual, status, details)
    VALUES (
        p_name,
        p_expected,
        p_actual,
        CASE WHEN p_expected = p_actual THEN 'PASS' ELSE 'FAIL' END,
        p_details
    );
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 2. MAIN TEST SUITE (DO BLOCK)
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    -- Fixture IDs
    v_pharm_id UUID := gen_random_uuid();
    v_branch_id UUID := gen_random_uuid();
    v_admin_a_id UUID := gen_random_uuid();
    v_pharm_b_id UUID := gen_random_uuid();
    v_victim_c_id UUID := gen_random_uuid();
    v_unknown_user UUID := gen_random_uuid();

    -- Verification records
    v_rec RECORD;
    v_res BOOLEAN;

    -- Report compilation
    v_total INT;
    v_passed INT;
    v_failed INT;
    v_report TEXT;
    v_item RECORD;
BEGIN
    -- --------------------------------------------------------------------------
    -- A. CREATE FIXTURES
    -- --------------------------------------------------------------------------
    INSERT INTO public.pharmacies (id, name, slug, is_active, plan_tier, subscription_status)
    VALUES (v_pharm_id, 'Flag Test Pharmacy', 'flag-test-' || substr(v_pharm_id::text, 1, 8), true, 'trial', 'trialing');

    INSERT INTO public.branches (id, pharmacy_id, name, is_active)
    VALUES (v_branch_id, v_pharm_id, 'Flag Test Branch', true);

    -- Admin user A (must_change_password = true)
    INSERT INTO public.app_users (id, pharmacy_id, branch_id, username, display_name, role, is_active, must_change_password)
    VALUES (v_admin_a_id, v_pharm_id, v_branch_id, 'admin_flag_test', 'Admin Flag Test', 'admin', true, true);

    -- Pharmacist user B (must_change_password = true)
    INSERT INTO public.app_users (id, pharmacy_id, branch_id, username, display_name, role, is_active, must_change_password)
    VALUES (v_pharm_b_id, v_pharm_id, v_branch_id, 'pharm_flag_test', 'Pharm Flag Test', 'pharmacist', true, true);

    -- Victim Pharmacist user C (must_change_password = true)
    INSERT INTO public.app_users (id, pharmacy_id, branch_id, username, display_name, role, is_active, must_change_password)
    VALUES (v_victim_c_id, v_pharm_id, v_branch_id, 'victim_flag_test', 'Victim Flag Test', 'pharmacist', true, true);

    -- --------------------------------------------------------------------------
    -- B. TEST 1: anon cannot execute fn_clear_own_must_change_password()
    -- --------------------------------------------------------------------------
    BEGIN
        PERFORM set_config('role', 'anon', true);
        PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);

        PERFORM public.fn_clear_own_must_change_password();
        CALL pg_temp.assert_equal('1. anon cannot execute fn_clear_own_must_change_password', 'BLOCKED', 'ALLOWED', 'Anon execution should have been denied by privilege check');
    EXCEPTION WHEN insufficient_privilege THEN
        CALL pg_temp.assert_equal('1. anon cannot execute fn_clear_own_must_change_password', 'BLOCKED', 'BLOCKED', 'Caught expected 42501 insufficient privilege');
    WHEN OTHERS THEN
        CALL pg_temp.assert_equal('1. anon cannot execute fn_clear_own_must_change_password', 'BLOCKED', SQLSTATE, 'Unexpected SQL error: ' || SQLERRM);
    END;

    -- Reset role to postgres for subsequent setup/eval
    PERFORM set_config('role', 'postgres', true);

    -- --------------------------------------------------------------------------
    -- C. TEST 2 & 3: Admin A clears only their own flag
    -- --------------------------------------------------------------------------
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_a_id::text, 'role', 'authenticated')::text, true);

    v_res := public.fn_clear_own_must_change_password();
    CALL pg_temp.assert_equal('2. Admin A clears own flag returns true', 'true', v_res::text);

    -- Reset role to evaluate results
    PERFORM set_config('role', 'postgres', true);

    SELECT * INTO v_rec FROM public.app_users WHERE id = v_admin_a_id;
    CALL pg_temp.assert_equal('2.1 Admin A must_change_password cleared', 'false', v_rec.must_change_password::text);
    CALL pg_temp.assert_equal('3.1 Admin A role unchanged', 'admin', v_rec.role);
    CALL pg_temp.assert_equal('3.2 Admin A pharmacy_id unchanged', v_pharm_id::text, v_rec.pharmacy_id::text);
    CALL pg_temp.assert_equal('3.3 Admin A branch_id unchanged', v_branch_id::text, v_rec.branch_id::text);

    -- --------------------------------------------------------------------------
    -- D. TEST 4 & 5: Pharmacist B clears only their own flag
    -- --------------------------------------------------------------------------
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_pharm_b_id::text, 'role', 'authenticated')::text, true);

    v_res := public.fn_clear_own_must_change_password();
    CALL pg_temp.assert_equal('4. Pharmacist B clears own flag returns true', 'true', v_res::text);

    -- Reset role to evaluate results
    PERFORM set_config('role', 'postgres', true);

    SELECT * INTO v_rec FROM public.app_users WHERE id = v_pharm_b_id;
    CALL pg_temp.assert_equal('4.1 Pharmacist B must_change_password cleared', 'false', v_rec.must_change_password::text);
    CALL pg_temp.assert_equal('5.1 Pharmacist B role unchanged', 'pharmacist', v_rec.role);
    CALL pg_temp.assert_equal('5.2 Pharmacist B pharmacy_id unchanged', v_pharm_id::text, v_rec.pharmacy_id::text);
    CALL pg_temp.assert_equal('5.3 Pharmacist B branch_id unchanged', v_branch_id::text, v_rec.branch_id::text);

    -- --------------------------------------------------------------------------
    -- E. TEST 6: Neither can clear anyone else's flag (Victim Pharmacist C remains unchanged)
    -- --------------------------------------------------------------------------
    SELECT * INTO v_rec FROM public.app_users WHERE id = v_victim_c_id;
    CALL pg_temp.assert_equal('6.1 Victim Pharmacist C flag remains true', 'true', v_rec.must_change_password::text);
    CALL pg_temp.assert_equal('6.2 Victim Pharmacist C role unchanged', 'pharmacist', v_rec.role);
    CALL pg_temp.assert_equal('6.3 Victim Pharmacist C pharmacy_id unchanged', v_pharm_id::text, v_rec.pharmacy_id::text);
    CALL pg_temp.assert_equal('6.4 Victim Pharmacist C branch_id unchanged', v_branch_id::text, v_rec.branch_id::text);

    -- --------------------------------------------------------------------------
    -- F. TEST 7: Unknown user id returns false
    -- --------------------------------------------------------------------------
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_unknown_user::text, 'role', 'authenticated')::text, true);

    v_res := public.fn_clear_own_must_change_password();
    CALL pg_temp.assert_equal('7. Unknown user calling function returns false', 'false', v_res::text);

    -- Reset to postgres for report compilation
    PERFORM set_config('role', 'postgres', true);

    -- --------------------------------------------------------------------------
    -- G. COMPILE REPORT & RAISE EXCEPTION (ATOMIC ROLLBACK)
    -- --------------------------------------------------------------------------
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'PASS'),
        COUNT(*) FILTER (WHERE status = 'FAIL')
    INTO v_total, v_passed, v_failed
    FROM pg_temp.flag_test_results;

    IF v_failed = 0 THEN
        v_report := 'FIRST_LOGIN_FLAG_SUITE: PASS (Total: ' || v_total || ', Passed: ' || v_passed || ', Failed: ' || v_failed || ')' || E'\n\n';
    ELSE
        v_report := 'FIRST_LOGIN_FLAG_SUITE: FAIL (Total: ' || v_total || ', Passed: ' || v_passed || ', Failed: ' || v_failed || ')' || E'\n\n';
    END IF;

    FOR v_item IN SELECT * FROM pg_temp.flag_test_results ORDER BY id LOOP
        v_report := v_report || '[' || v_item.status || '] ' || v_item.test_name || ' | Expected: ' || v_item.expected || ' | Actual: ' || v_item.actual || CASE WHEN v_item.details <> '' THEN ' (' || v_item.details || ')' ELSE '' END || E'\n';
    END LOOP;

    v_report := v_report || E'\nEND OF FIRST_LOGIN_FLAG_SUITE\n';

    -- Always raise exception to roll back all temporary fixtures atomically
    RAISE EXCEPTION E'\n%', v_report;
END;
$$;
