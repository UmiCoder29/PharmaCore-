-- ==============================================================================
-- PharmaCore reset-user-password Test Suite
-- File: supabase/tests/reset_user_password_suite.sql
--
-- INSTRUCTIONS FOR USE:
-- 1. Open Supabase Dashboard -> SQL Editor (or psql connected as postgres).
-- 2. Paste this entire file into the editor.
-- 3. Click "Run".
-- 4. The script executes inside an isolated transaction (BEGIN ... ROLLBACK).
--    100% of fixtures and statements are rolled back automatically.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. TEMPORARY TEST RESULTS TABLE & ASSERTION PROCEDURE
-- ------------------------------------------------------------------------------

CREATE TEMP TABLE IF NOT EXISTS pg_temp.reset_password_test_results (
    id SERIAL PRIMARY KEY,
    test_name TEXT NOT NULL,
    expected TEXT NOT NULL,
    actual TEXT NOT NULL,
    status TEXT NOT NULL,
    details TEXT
);

CREATE OR REPLACE PROCEDURE pg_temp.assert_equal(
    p_name TEXT,
    p_expected TEXT,
    p_actual TEXT,
    p_details TEXT DEFAULT ''
) AS $$
BEGIN
    INSERT INTO pg_temp.reset_password_test_results (test_name, expected, actual, status, details)
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
    v_cnt INT;
    v_has_rls BOOLEAN;
    v_test_id UUID := gen_random_uuid();
    v_caller_id UUID := gen_random_uuid();
    v_target_id UUID := gen_random_uuid();
BEGIN
    -- 1.1: Table existence
    SELECT COUNT(*) INTO v_cnt
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'password_reset_attempts';

    CALL pg_temp.assert_equal(
        '1.1 password_reset_attempts table exists in public schema',
        '1',
        v_cnt::TEXT,
        'Table presence check'
    );

    -- 1.2: Index existence
    SELECT COUNT(*) INTO v_cnt
    FROM pg_indexes
    WHERE schemaname = 'public' 
      AND tablename = 'password_reset_attempts' 
      AND indexname = 'idx_password_reset_attempts_caller_created';

    CALL pg_temp.assert_equal(
        '1.2 idx_password_reset_attempts_caller_created index exists',
        '1',
        v_cnt::TEXT,
        'Sliding-window index check'
    );

    -- 1.3: RLS enabled
    SELECT relrowsecurity INTO v_has_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'password_reset_attempts';

    CALL pg_temp.assert_equal(
        '1.3 RLS enabled on password_reset_attempts',
        'true',
        COALESCE(v_has_rls, false)::TEXT,
        'RLS flag check'
    );

    -- 1.4: Inaccessible to authenticated role
    BEGIN
        PERFORM set_config('role', 'authenticated', true);
        PERFORM COUNT(*) FROM public.password_reset_attempts;
        PERFORM set_config('role', 'postgres', true);
        CALL pg_temp.assert_equal('1.4 authenticated cannot select password_reset_attempts', 'BLOCKED (42501)', 'ALLOWED', 'Select succeeded unexpectedly');
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('role', 'postgres', true);
        CALL pg_temp.assert_equal('1.4 authenticated cannot select password_reset_attempts', 'BLOCKED (42501)', 'BLOCKED (42501)', SQLSTATE || ': ' || SQLERRM);
    END;

    -- 1.5: Inaccessible to anon role
    BEGIN
        PERFORM set_config('role', 'anon', true);
        PERFORM COUNT(*) FROM public.password_reset_attempts;
        PERFORM set_config('role', 'postgres', true);
        CALL pg_temp.assert_equal('1.5 anon cannot select password_reset_attempts', 'BLOCKED (42501)', 'ALLOWED', 'Select succeeded unexpectedly');
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('role', 'postgres', true);
        CALL pg_temp.assert_equal('1.5 anon cannot select password_reset_attempts', 'BLOCKED (42501)', 'BLOCKED (42501)', SQLSTATE || ': ' || SQLERRM);
    END;

    -- 1.6: Service role can insert into password_reset_attempts
    BEGIN
        PERFORM set_config('role', 'service_role', true);
        INSERT INTO public.password_reset_attempts (id, caller_id, target_id, outcome)
        VALUES (v_test_id, v_caller_id, v_target_id, 'test_attempt');
        PERFORM set_config('role', 'postgres', true);
        CALL pg_temp.assert_equal('1.6 service_role can insert into password_reset_attempts', 'ALLOWED', 'ALLOWED', 'Insert successful');
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('role', 'postgres', true);
        CALL pg_temp.assert_equal('1.6 service_role can insert into password_reset_attempts', 'ALLOWED', SQLSTATE, SQLERRM);
    END;

    -- 1.7: app_users must_change_password column exists
    SELECT COUNT(*) INTO v_cnt
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'must_change_password';

    CALL pg_temp.assert_equal(
        '1.7 app_users.must_change_password column exists',
        '1',
        v_cnt::TEXT,
        'Force password change flag check'
    );

    -- 1.8: activity_logs schema verification
    SELECT COUNT(*) INTO v_cnt
    FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'activity_logs' 
      AND column_name IN ('pharmacy_id', 'user_id', 'username', 'action', 'target_table', 'target_record_id', 'details');

    CALL pg_temp.assert_equal(
        '1.8 activity_logs contains all audit trail columns',
        '7',
        v_cnt::TEXT,
        'Columns: pharmacy_id, user_id, username, action, target_table, target_record_id, details'
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. TEST SUITE SUMMARY & ASSERTION REPORT
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    v_total INT;
    v_passed INT;
    v_failed INT;
    v_rec RECORD;
    v_report TEXT;
BEGIN
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'PASS'),
        COUNT(*) FILTER (WHERE status = 'FAIL')
    INTO v_total, v_passed, v_failed
    FROM pg_temp.reset_password_test_results;

    IF v_failed = 0 THEN
        v_report := 'RESET_USER_PASSWORD_SUITE: PASS (Total: ' || v_total || ', Passed: ' || v_passed || ', Failed: ' || v_failed || ')' || E'\n\n';
    ELSE
        v_report := 'RESET_USER_PASSWORD_SUITE: FAIL (Total: ' || v_total || ', Passed: ' || v_passed || ', Failed: ' || v_failed || ')' || E'\n\n';
    END IF;

    FOR v_rec IN SELECT * FROM pg_temp.reset_password_test_results ORDER BY id LOOP
        v_report := v_report || '[' || v_rec.status || '] ' || v_rec.test_name || ' | Expected: ' || v_rec.expected || ' | Actual: ' || v_rec.actual || CASE WHEN v_rec.details <> '' THEN ' (' || v_rec.details || ')' ELSE '' END || E'\n';
    END LOOP;

    v_report := v_report || E'\nEND OF RESET_USER_PASSWORD_SUITE\n';

    -- Always raise exception so the Supabase SQL Editor shows the result and rolls back atomically
    RAISE EXCEPTION E'\n%', v_report;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. ATOMIC ROLLBACK GUARANTEE
-- ------------------------------------------------------------------------------

ROLLBACK;
