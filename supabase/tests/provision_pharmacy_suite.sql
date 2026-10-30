-- ==============================================================================
-- PharmaCore provision-pharmacy Test Suite
-- File: supabase/tests/provision_pharmacy_suite.sql
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

CREATE TEMP TABLE IF NOT EXISTS pg_temp.provision_test_results (
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
    INSERT INTO pg_temp.provision_test_results (test_name, expected, actual, status, details)
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
    -- Test fixtures
    v_super_id UUID := gen_random_uuid();
    v_admin1_id UUID := gen_random_uuid();
    v_admin2_id UUID := gen_random_uuid();
    v_admin3_id UUID := gen_random_uuid();
    v_admin4_id UUID := gen_random_uuid();
    v_admin5_id UUID := gen_random_uuid();
    v_pharm_user UUID := gen_random_uuid();

    v_res JSONB;
    v_pharm_id UUID;
    v_branch_id UUID;
    v_slug1 TEXT;
    v_slug2 TEXT;
    v_slug3 TEXT;
    v_status TEXT;
    v_trial_ends TIMESTAMPTZ;
    v_sub_ends TIMESTAMPTZ;
    v_max_b INT;
    v_max_u INT;
    v_must_change BOOLEAN;
    v_log_count INT;

    v_err_code TEXT;
    v_err_msg TEXT;
BEGIN
    -- 0. Seed test auth & superadmin fixtures (rolled back at end)
    INSERT INTO auth.users (id, email) VALUES
        (v_super_id, 'prov_super@test.local'),
        (v_pharm_user, 'prov_pharmacist@test.local'),
        (v_admin1_id, 'prov_admin1@test.local'),
        (v_admin2_id, 'prov_admin2@test.local'),
        (v_admin3_id, 'prov_admin3@test.local'),
        (v_admin4_id, 'prov_admin4@test.local'),
        (v_admin5_id, 'prov_admin5@test.local');

    INSERT INTO public.app_users (id, username, display_name, role, can_view_all_branches, must_change_password)
    VALUES (v_super_id, 'super_tester', 'Super Tester', 'superadmin', TRUE, FALSE);

    -- ==========================================================================
    -- TEST GROUP 1: PRIVILEGE LOCKDOWN
    -- ==========================================================================

    -- 1.1: Authenticated role calling fn_provision_pharmacy directly is denied
    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM public.fn_provision_pharmacy(
            v_admin1_id, 'Unauthorized Pharmacy', 'Karachi', NULL, 'unauth@test.local',
            'unauth_admin', 'Unauth Admin', 'Main Branch', 'trial', v_super_id, 'super_tester'
        );
        RESET ROLE;
        CALL pg_temp.assert_equal('1.1 authenticated cannot call fn_provision_pharmacy', 'BLOCKED (42501)', 'ALLOWED', 'Function call succeeded unexpectedly');
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('1.1 authenticated cannot call fn_provision_pharmacy', 'BLOCKED (42501)', 'BLOCKED (42501)', 'Correctly blocked with 42501');
    WHEN OTHERS THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('1.1 authenticated cannot call fn_provision_pharmacy', 'BLOCKED (42501)', SQLSTATE, SQLERRM);
    END;

    -- 1.2: Anon role calling fn_provision_pharmacy directly is denied
    BEGIN
        SET LOCAL ROLE anon;
        PERFORM public.fn_provision_pharmacy(
            v_admin1_id, 'Anon Pharmacy', 'Karachi', NULL, 'anon@test.local',
            'anon_admin', 'Anon Admin', 'Main Branch', 'trial', v_super_id, 'super_tester'
        );
        RESET ROLE;
        CALL pg_temp.assert_equal('1.2 anon cannot call fn_provision_pharmacy', 'BLOCKED (42501)', 'ALLOWED', 'Function call succeeded unexpectedly');
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('1.2 anon cannot call fn_provision_pharmacy', 'BLOCKED (42501)', 'BLOCKED (42501)', 'Correctly blocked with 42501');
    WHEN OTHERS THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('1.2 anon cannot call fn_provision_pharmacy', 'BLOCKED (42501)', SQLSTATE, SQLERRM);
    END;

    -- 1.3: provision_attempts table inaccessible to authenticated
    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM COUNT(*) FROM public.provision_attempts;
        RESET ROLE;
        CALL pg_temp.assert_equal('1.3 authenticated cannot select provision_attempts', 'BLOCKED (42501)', 'ALLOWED', 'Select succeeded unexpectedly');
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('1.3 authenticated cannot select provision_attempts', 'BLOCKED (42501)', 'BLOCKED (42501)', 'Select correctly blocked');
    WHEN OTHERS THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('1.3 authenticated cannot select provision_attempts', 'BLOCKED (42501)', SQLSTATE, SQLERRM);
    END;

    -- 1.4: provision_attempts table inaccessible to anon
    BEGIN
        SET LOCAL ROLE anon;
        PERFORM COUNT(*) FROM public.provision_attempts;
        RESET ROLE;
        CALL pg_temp.assert_equal('1.4 anon cannot select provision_attempts', 'BLOCKED (42501)', 'ALLOWED', 'Select succeeded unexpectedly');
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('1.4 anon cannot select provision_attempts', 'BLOCKED (42501)', 'BLOCKED (42501)', 'Select correctly blocked');
    WHEN OTHERS THEN
        RESET ROLE;
        CALL pg_temp.assert_equal('1.4 anon cannot select provision_attempts', 'BLOCKED (42501)', SQLSTATE, SQLERRM);
    END;

    -- ==========================================================================
    -- TEST GROUP 2: STATUS MAPPING & PLAN QUOTAS (EXECUTED AS SERVICE_ROLE)
    -- ==========================================================================

    -- 2.1: Trial plan provisioning: status = 'trial', trial_ends_at set, sub_ends_at is NULL
    v_res := public.fn_provision_pharmacy(
        v_admin1_id, 'Al-Madina Pharmacy', 'Karachi', '0300-1111111', 'admin1@almadina.pk',
        'madina_admin', 'Madina Owner', 'Main Branch', 'trial', v_super_id, 'super_tester'
    );
    v_pharm_id := (v_res->>'pharmacy_id')::UUID;
    v_slug1 := v_res->>'slug';

    SELECT subscription_status, trial_ends_at, subscription_ends_at, max_branches, max_users
    INTO v_status, v_trial_ends, v_sub_ends, v_max_b, v_max_u
    FROM public.pharmacies WHERE id = v_pharm_id;

    CALL pg_temp.assert_equal('2.1a trial status mapping', 'trial', v_status);
    CALL pg_temp.assert_equal('2.1b trial_ends_at is set', 'TRUE', (v_trial_ends IS NOT NULL)::TEXT);
    CALL pg_temp.assert_equal('2.1c subscription_ends_at is NULL for trial', 'TRUE', (v_sub_ends IS NULL)::TEXT);
    CALL pg_temp.assert_equal('2.1d trial max_branches read from plans', '1', v_max_b::TEXT);
    CALL pg_temp.assert_equal('2.1e trial max_users read from plans', '3', v_max_u::TEXT);

    -- 2.2: Paid plan provisioning (professional): status = 'active', trial_ends_at is NULL, sub_ends_at set
    v_res := public.fn_provision_pharmacy(
        v_admin2_id, 'Khyber Medicos', 'Peshawar', '0300-2222222', 'khyber@medicos.pk',
        'khyber_admin', 'Khyber Owner', 'Central Branch', 'professional', v_super_id, 'super_tester'
    );
    v_pharm_id := (v_res->>'pharmacy_id')::UUID;

    SELECT subscription_status, trial_ends_at, subscription_ends_at, max_branches, max_users
    INTO v_status, v_trial_ends, v_sub_ends, v_max_b, v_max_u
    FROM public.pharmacies WHERE id = v_pharm_id;

    CALL pg_temp.assert_equal('2.2a paid status mapping', 'active', v_status);
    CALL pg_temp.assert_equal('2.2b trial_ends_at is NULL for paid tier', 'TRUE', (v_trial_ends IS NULL)::TEXT);
    CALL pg_temp.assert_equal('2.2c subscription_ends_at set for paid tier', 'TRUE', (v_sub_ends IS NOT NULL)::TEXT);
    CALL pg_temp.assert_equal('2.2d professional max_branches read from plans', '5', v_max_b::TEXT);
    CALL pg_temp.assert_equal('2.2e professional max_users read from plans', '15', v_max_u::TEXT);

    -- ==========================================================================
    -- TEST GROUP 3: SLUG GENERATION, COLLISION RETRY & EMPTY FALLBACK
    -- ==========================================================================

    -- 3.1: Normal name produces clean slug
    CALL pg_temp.assert_equal('3.1 clean slug generation', 'al-madina-pharmacy', v_slug1);

    -- 3.2: Duplicate name triggers unique violation catch and appends suffix
    v_res := public.fn_provision_pharmacy(
        v_admin3_id, 'Al-Madina Pharmacy', 'Lahore', NULL, 'admin3@almadina.pk',
        'madina2_admin', 'Madina 2 Owner', 'Main Branch', 'starter', v_super_id, 'super_tester'
    );
    v_slug2 := v_res->>'slug';

    CALL pg_temp.assert_equal('3.2a collision slug is distinct', 'TRUE', (v_slug2 <> v_slug1)::TEXT);
    CALL pg_temp.assert_equal('3.2b collision slug starts with base slug', 'TRUE', (v_slug2 LIKE 'al-madina-pharmacy-%')::TEXT);

    -- 3.3: Pure symbols / non-Latin name falls back to pharmacy-<random>
    v_res := public.fn_provision_pharmacy(
        v_admin4_id, '!@#$%^&*()_+', 'Islamabad', NULL, 'symbols@test.local',
        'symbol_admin', 'Symbol Owner', 'Main Branch', 'starter', v_super_id, 'super_tester'
    );
    v_slug3 := v_res->>'slug';

    CALL pg_temp.assert_equal('3.3 empty slug fallback starts with pharmacy-', 'TRUE', (v_slug3 LIKE 'pharmacy-%')::TEXT);

    -- ==========================================================================
    -- TEST GROUP 4: USERNAME CASE-INSENSITIVITY & UNIQUENESS
    -- ==========================================================================

    -- 4.1: Submitting exact same username with different casing raises friendly error
    BEGIN
        PERFORM public.fn_provision_pharmacy(
            v_admin5_id, 'Duplicate Username Pharmacy', 'Karachi', NULL, 'dupuser@test.local',
            'MADINA_ADMIN', 'Casing Tester', 'Main Branch', 'trial', v_super_id, 'super_tester'
        );
        CALL pg_temp.assert_equal('4.1 case-insensitive username uniqueness', 'BLOCKED (23505)', 'ALLOWED', 'Duplicate username succeeded unexpectedly');
    EXCEPTION WHEN unique_violation THEN
        CALL pg_temp.assert_equal('4.1 case-insensitive username uniqueness', 'BLOCKED (23505)', 'BLOCKED (23505)', 'Correctly blocked duplicate username');
    WHEN OTHERS THEN
        IF SQLERRM LIKE '%Admin username is already taken%' THEN
            CALL pg_temp.assert_equal('4.1 case-insensitive username uniqueness', 'BLOCKED (23505)', 'BLOCKED (23505)', 'Caught friendly message: ' || SQLERRM);
        ELSE
            CALL pg_temp.assert_equal('4.1 case-insensitive username uniqueness', 'BLOCKED (23505)', SQLSTATE, SQLERRM);
        END IF;
    END;

    -- ==========================================================================
    -- TEST GROUP 5: MANDATORY COLUMNS, ATTRIBUTES & AUDIT LOGS
    -- ==========================================================================

    -- 5.1: Check must_change_password is TRUE in app_users
    SELECT must_change_password INTO v_must_change
    FROM public.app_users WHERE id = v_admin1_id;

    CALL pg_temp.assert_equal('5.1 must_change_password is true for new admin', 'TRUE', v_must_change::TEXT);

    -- 5.2: Check activity_logs audit row exists for provisioned pharmacy
    SELECT COUNT(*) INTO v_log_count
    FROM public.activity_logs
    WHERE user_id = v_super_id AND action = 'provision_pharmacy';

    CALL pg_temp.assert_equal('5.2 activity_logs entry created for provisioning', 'TRUE', (v_log_count >= 3)::TEXT);

END;
$$;

-- ------------------------------------------------------------------------------
-- 3. REPORT TEST RESULTS
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    v_total INT;
    v_passed INT;
    v_failed INT;
    v_rec RECORD;
BEGIN
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'PASS'),
        COUNT(*) FILTER (WHERE status = 'FAIL')
    INTO v_total, v_passed, v_failed
    FROM pg_temp.provision_test_results;

    RAISE NOTICE '--------------------------------------------------------------------';
    RAISE NOTICE 'PROVISION-PHARMACY SUITE SUMMARY: % Ran | % Passed | % Failed', v_total, v_passed, v_failed;
    RAISE NOTICE '--------------------------------------------------------------------';

    FOR v_rec IN SELECT * FROM pg_temp.provision_test_results ORDER BY id LOOP
        RAISE NOTICE '[%] % | Expected: % | Actual: % %',
            v_rec.status,
            v_rec.test_name,
            v_rec.expected,
            v_rec.actual,
            CASE WHEN v_rec.details <> '' THEN '(' || v_rec.details || ')' ELSE '' END;
    END LOOP;

    IF v_failed > 0 THEN
        RAISE EXCEPTION 'provision_pharmacy_suite failed with % test failures.', v_failed;
    END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. ATOMIC ROLLBACK GUARANTEE
-- ------------------------------------------------------------------------------

ROLLBACK;
