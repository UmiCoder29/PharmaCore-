-- ==============================================================================
-- PharmaCore create-staff-user Test Suite
-- File: supabase/tests/create_staff_user_suite.sql
--
-- INSTRUCTIONS FOR USE:
-- 1. Open Supabase Dashboard -> SQL Editor (or psql connected as postgres).
-- 2. Paste this entire file into the editor.
-- 3. Click "Run".
-- 4. Executes inside BEGIN ... ROLLBACK and terminates with RAISE EXCEPTION
--    carrying the summary result line so Supabase SQL Editor shows all results
--    while rolling back 100% of fixtures atomically.
-- ==============================================================================

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS pg_temp.create_staff_test_results (
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
    INSERT INTO pg_temp.create_staff_test_results (test_name, expected, actual, status, details)
    VALUES (
        p_name,
        p_expected,
        p_actual,
        CASE WHEN p_expected = p_actual THEN 'PASS' ELSE 'FAIL' END,
        p_details
    );
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    v_cnt INT;
    v_has_rls BOOLEAN;
    v_prosecdef BOOLEAN;
    v_search_path TEXT;
    v_pharm_a UUID := gen_random_uuid();
    v_pharm_b UUID := gen_random_uuid();
    v_pharm_susp UUID := gen_random_uuid();
    v_branch_a UUID := gen_random_uuid();
    v_branch_b UUID := gen_random_uuid();
    v_branch_susp UUID := gen_random_uuid();
    v_admin_a UUID := gen_random_uuid();
    v_admin_b UUID := gen_random_uuid();
    v_admin_susp UUID := gen_random_uuid();
    v_staff_1 UUID := gen_random_uuid();
    v_staff_2 UUID := gen_random_uuid();
    v_staff_3 UUID := gen_random_uuid();
    v_staff_b1 UUID := gen_random_uuid();
    v_staff_b_ok UUID := gen_random_uuid();
    v_staff_susp UUID := gen_random_uuid();
    v_res JSONB;
    v_role TEXT;
    v_must_change BOOLEAN;
    v_can_all BOOLEAN;
BEGIN
    -- 0. Create test fixtures inside transaction (auth.users -> pharmacies -> branches -> app_users)
    INSERT INTO auth.users (id, email) VALUES
        (v_admin_a, 'csu_admin_a@test.local'),
        (v_admin_b, 'csu_admin_b@test.local'),
        (v_admin_susp, 'csu_admin_susp@test.local'),
        (v_staff_1, 'csu_staff_1@staff.pharmacore.invalid'),
        (v_staff_2, 'csu_staff_2@staff.pharmacore.invalid'),
        (v_staff_3, 'csu_staff_3@staff.pharmacore.invalid'),
        (v_staff_b1, 'csu_staff_b1@staff.pharmacore.invalid'),
        (v_staff_b_ok, 'csu_staff_b_ok@staff.pharmacore.invalid'),
        (v_staff_susp, 'csu_staff_susp@staff.pharmacore.invalid');

    -- Pharmacy A has max_users = 2 (1 admin + 1 pharmacist allowed; 2nd pharmacist hits quota)
    INSERT INTO public.pharmacies (id, name, slug, plan_tier, subscription_status, max_branches, max_users, is_active)
    VALUES
        (v_pharm_a, 'CSU Pharmacy A', 'csu-a-' || substr(v_pharm_a::TEXT, 1, 6), 'trial', 'trial', 1, 2, TRUE),
        (v_pharm_b, 'CSU Pharmacy B', 'csu-b-' || substr(v_pharm_b::TEXT, 1, 6), 'starter', 'active', 2, 5, TRUE),
        (v_pharm_susp, 'CSU Suspended', 'csu-s-' || substr(v_pharm_susp::TEXT, 1, 6), 'trial', 'suspended', 1, 3, FALSE);

    INSERT INTO public.branches (id, pharmacy_id, name, is_main_branch)
    VALUES
        (v_branch_a, v_pharm_a, 'Main Branch A', TRUE),
        (v_branch_b, v_pharm_b, 'Main Branch B', TRUE),
        (v_branch_susp, v_pharm_susp, 'Main Branch S', TRUE);

    INSERT INTO public.app_users (id, pharmacy_id, branch_id, username, display_name, role, can_view_all_branches, must_change_password)
    VALUES
        (v_admin_a, v_pharm_a, v_branch_a, 'csu_owner_a_' || substr(v_admin_a::TEXT, 1, 6), 'Owner A', 'admin', TRUE, FALSE),
        (v_admin_b, v_pharm_b, v_branch_b, 'csu_owner_b_' || substr(v_admin_b::TEXT, 1, 6), 'Owner B', 'admin', TRUE, FALSE),
        (v_admin_susp, v_pharm_susp, v_branch_susp, 'csu_owner_s_' || substr(v_admin_susp::TEXT, 1, 6), 'Owner S', 'admin', TRUE, FALSE);

    -- 1. Security & Schema Lockdown Checks
    SELECT relrowsecurity INTO v_has_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'staff_creation_attempts';
    CALL pg_temp.assert_equal('1.1 RLS enabled on staff_creation_attempts', 'true', COALESCE(v_has_rls, FALSE)::TEXT);

    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM COUNT(*) FROM public.staff_creation_attempts;
        RESET ROLE;
        CALL pg_temp.assert_equal('1.2 authenticated cannot read staff_creation_attempts', 'BLOCKED (42501)', 'ALLOWED');
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('1.2 authenticated cannot read staff_creation_attempts', 'BLOCKED (42501)', 'BLOCKED (' || SQLSTATE || ')');
    END;

    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM public.fn_create_staff_user(v_staff_1, v_pharm_a, v_branch_a, 'blocked_auth', 'Blocked', v_admin_a, 'csu_owner_a');
        RESET ROLE;
        CALL pg_temp.assert_equal('1.3 authenticated cannot execute fn_create_staff_user', 'BLOCKED (42501)', 'ALLOWED');
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('1.3 authenticated cannot execute fn_create_staff_user', 'BLOCKED (42501)', 'BLOCKED (' || SQLSTATE || ')');
    END;

    BEGIN
        SET LOCAL ROLE anon;
        PERFORM public.fn_create_staff_user(v_staff_1, v_pharm_a, v_branch_a, 'blocked_anon', 'Blocked', v_admin_a, 'csu_owner_a');
        RESET ROLE;
        CALL pg_temp.assert_equal('1.4 anon cannot execute fn_create_staff_user', 'BLOCKED (42501)', 'ALLOWED');
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('1.4 anon cannot execute fn_create_staff_user', 'BLOCKED (42501)', 'BLOCKED (' || SQLSTATE || ')');
    END;

    SELECT p.prosecdef, array_to_string(p.proconfig, ',')
    INTO v_prosecdef, v_search_path
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_create_staff_user';
    CALL pg_temp.assert_equal('1.5a fn_create_staff_user is SECURITY DEFINER', 'true', COALESCE(v_prosecdef, FALSE)::TEXT);
    CALL pg_temp.assert_equal('1.5b fn_create_staff_user has fixed search_path', 'true', (COALESCE(v_search_path, '') LIKE '%search_path=public, pg_temp%')::TEXT);

    SELECT p.prosecdef, array_to_string(p.proconfig, ',')
    INTO v_prosecdef, v_search_path
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_enforce_user_limit';
    CALL pg_temp.assert_equal('1.6a fn_enforce_user_limit is SECURITY DEFINER', 'true', COALESCE(v_prosecdef, FALSE)::TEXT);
    CALL pg_temp.assert_equal('1.6b fn_enforce_user_limit has fixed search_path', 'true', (COALESCE(v_search_path, '') LIKE '%search_path=public, pg_temp%')::TEXT);

    -- Verify authenticated executable function count stays exactly 11
    SELECT COUNT(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
    CALL pg_temp.assert_equal('1.7 authenticated executable function count stays 11', '11', v_cnt::TEXT);

    -- 2. Service Role Creation, Forced Attributes & Audit Log
    SET LOCAL ROLE service_role;
    v_res := public.fn_create_staff_user(
        v_staff_1, v_pharm_a, v_branch_a, 'csu_staff_one_' || substr(v_staff_1::TEXT, 1, 6), 'Staff One', v_admin_a, 'csu_owner_a'
    );
    RESET ROLE;

    SELECT role, must_change_password, can_view_all_branches
    INTO v_role, v_must_change, v_can_all
    FROM public.app_users WHERE id = v_staff_1;

    CALL pg_temp.assert_equal('2.1 created staff role is pharmacist', 'pharmacist', v_role);
    CALL pg_temp.assert_equal('2.2 created staff must_change_password is true', 'true', v_must_change::TEXT);
    CALL pg_temp.assert_equal('2.3 created staff can_view_all_branches is false', 'false', v_can_all::TEXT);

    SELECT COUNT(*) INTO v_cnt
    FROM public.activity_logs
    WHERE pharmacy_id = v_pharm_a AND action = 'create_staff_user' AND target_record_id = v_staff_1;
    CALL pg_temp.assert_equal('2.4 activity_logs audit row written', '1', v_cnt::TEXT);

    -- 3. Quota Enforcement (max_users = 2: 1 admin + 1 pharmacist already present)
    BEGIN
        SET LOCAL ROLE service_role;
        PERFORM public.fn_create_staff_user(
            v_staff_2, v_pharm_a, v_branch_a, 'csu_staff_two_' || substr(v_staff_2::TEXT, 1, 6), 'Staff Two', v_admin_a, 'csu_owner_a'
        );
        RESET ROLE;
        CALL pg_temp.assert_equal('3.1 fn_create_staff_user blocks exceeding max_users', 'BLOCKED (P0001)', 'ALLOWED');
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('3.1 fn_create_staff_user blocks exceeding max_users', 'BLOCKED (P0001)', 'BLOCKED (' || SQLSTATE || ')', SQLERRM);
    END;

    -- Direct authenticated REST insert bypass past quota must also be blocked by trg_enforce_user_limit
    BEGIN
        PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_a::TEXT, 'role', 'authenticated')::TEXT, TRUE);
        SET LOCAL ROLE authenticated;
        INSERT INTO public.app_users (id, pharmacy_id, branch_id, username, role)
        VALUES (v_staff_3, v_pharm_a, v_branch_a, 'csu_bypass_' || substr(v_staff_3::TEXT, 1, 6), 'pharmacist');
        RESET ROLE;
        CALL pg_temp.assert_equal('3.2 trg_enforce_user_limit blocks direct authenticated insert at max_users', 'BLOCKED (P0001)', 'ALLOWED');
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('3.2 trg_enforce_user_limit blocks direct authenticated insert at max_users', 'BLOCKED (P0001)', 'BLOCKED (' || SQLSTATE || ')', SQLERRM);
    END;
    PERFORM set_config('request.jwt.claims', '', TRUE);

    -- 3.3: With Pharmacy A at max_users (2), UPDATE of existing user as table owner is ALLOWED
    BEGIN
        UPDATE public.app_users
        SET must_change_password = FALSE
        WHERE id = v_staff_1;
        CALL pg_temp.assert_equal('3.3 UPDATE existing user at max_users allowed as table owner', 'ALLOWED', 'ALLOWED');
    EXCEPTION WHEN OTHERS THEN
        CALL pg_temp.assert_equal('3.3 UPDATE existing user at max_users allowed as table owner', 'ALLOWED', 'BLOCKED (' || SQLSTATE || ')', SQLERRM);
    END;

    -- 3.4: With Pharmacy A at max_users (2), UPDATE of existing user as authenticated admin is ALLOWED
    BEGIN
        PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_a::TEXT, 'role', 'authenticated')::TEXT, TRUE);
        SET LOCAL ROLE authenticated;
        UPDATE public.app_users
        SET must_change_password = TRUE
        WHERE id = v_staff_1;
        RESET ROLE;
        CALL pg_temp.assert_equal('3.4 UPDATE existing user at max_users allowed as authenticated admin', 'ALLOWED', 'ALLOWED');
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('3.4 UPDATE existing user at max_users allowed as authenticated admin', 'ALLOWED', 'BLOCKED (' || SQLSTATE || ')', SQLERRM);
    END;
    PERFORM set_config('request.jwt.claims', '', TRUE);

    -- 3.5: UPDATE changing pharmacy_id into Pharmacy A (at max_users = 2) is BLOCKED (P0001)
    SET LOCAL ROLE service_role;
    PERFORM public.fn_create_staff_user(
        v_staff_b_ok, v_pharm_b, v_branch_b, 'csu_move_b_' || substr(v_staff_b_ok::TEXT, 1, 6), 'Move Test Staff', v_admin_b, 'csu_owner_b'
    );
    RESET ROLE;

    BEGIN
        UPDATE public.app_users
        SET pharmacy_id = v_pharm_a, branch_id = v_branch_a
        WHERE id = v_staff_b_ok;
        CALL pg_temp.assert_equal('3.5 UPDATE moving user into full pharmacy blocked (P0001)', 'BLOCKED (P0001)', 'ALLOWED');
    EXCEPTION WHEN OTHERS THEN
        CALL pg_temp.assert_equal('3.5 UPDATE moving user into full pharmacy blocked (P0001)', 'BLOCKED (P0001)', 'BLOCKED (' || SQLSTATE || ')', SQLERRM);
    END;

    -- 4. Foreign branch, cross-pharmacy username collision, and suspended pharmacy checks
    BEGIN
        PERFORM public.fn_create_staff_user(
            v_staff_b1, v_pharm_b, v_branch_a, 'csu_foreign_br_' || substr(v_staff_b1::TEXT, 1, 6), 'Foreign Branch', v_admin_b, 'csu_owner_b'
        );
        CALL pg_temp.assert_equal('4.1 foreign branch rejected', 'BLOCKED (22023)', 'ALLOWED');
    EXCEPTION WHEN OTHERS THEN
        CALL pg_temp.assert_equal('4.1 foreign branch rejected', 'BLOCKED (22023)', 'BLOCKED (' || SQLSTATE || ')', SQLERRM);
    END;

    BEGIN
        PERFORM public.fn_create_staff_user(
            v_staff_b1, v_pharm_b, v_branch_b, upper('csu_staff_one_' || substr(v_staff_1::TEXT, 1, 6)), 'Duplicate Cross Pharm', v_admin_b, 'csu_owner_b'
        );
        CALL pg_temp.assert_equal('4.2 cross-pharmacy case-insensitive username collision rejected', 'BLOCKED (23505)', 'ALLOWED');
    EXCEPTION WHEN OTHERS THEN
        CALL pg_temp.assert_equal('4.2 cross-pharmacy case-insensitive username collision rejected', 'BLOCKED (23505)', 'BLOCKED (' || SQLSTATE || ')', SQLERRM);
    END;

    BEGIN
        PERFORM public.fn_create_staff_user(
            v_staff_susp, v_pharm_susp, v_branch_susp, 'csu_susp_' || substr(v_staff_susp::TEXT, 1, 6), 'Suspended Staff', v_admin_susp, 'csu_owner_s'
        );
        CALL pg_temp.assert_equal('4.3 suspended pharmacy rejected', 'BLOCKED (P0001)', 'ALLOWED');
    EXCEPTION WHEN OTHERS THEN
        CALL pg_temp.assert_equal('4.3 suspended pharmacy rejected', 'BLOCKED (P0001)', 'BLOCKED (' || SQLSTATE || ')', SQLERRM);
    END;
END;
$$;

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
    FROM pg_temp.create_staff_test_results;

    IF v_failed = 0 THEN
        v_report := 'CREATE_STAFF_USER_SUITE: PASS (Total: ' || v_total || ', Passed: ' || v_passed || ', Failed: ' || v_failed || ')' || E'\n\n';
    ELSE
        v_report := 'CREATE_STAFF_USER_SUITE: FAIL (Total: ' || v_total || ', Passed: ' || v_passed || ', Failed: ' || v_failed || ')' || E'\n\n';
    END IF;

    FOR v_rec IN SELECT * FROM pg_temp.create_staff_test_results ORDER BY id LOOP
        v_report := v_report || '[' || v_rec.status || '] ' || v_rec.test_name || ' | Expected: ' || v_rec.expected || ' | Actual: ' || v_rec.actual || CASE WHEN v_rec.details <> '' THEN ' (' || v_rec.details || ')' ELSE '' END || E'\n';
    END LOOP;

    v_report := v_report || E'\nEND OF CREATE_STAFF_USER_SUITE\n';

    RAISE EXCEPTION E'\n%', v_report;
END;
$$;

ROLLBACK;
