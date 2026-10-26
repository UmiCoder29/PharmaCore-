-- ==============================================================================
-- PharmaCore Cross-Tenant RLS & Security Test Suite
-- File: supabase/tests/rls_suite.sql
--
-- INSTRUCTIONS FOR USE:
-- 1. Open Supabase Dashboard -> SQL Editor.
-- 2. Paste this entire file into the editor.
-- 3. Click "Run" (executed as role `postgres`).
-- 4. The script runs the full security audit and intentionally terminates with:
--    RAISE EXCEPTION carrying the complete text report.
--    This guarantees 100% atomic rollback of all test fixtures and statements.
--    Nothing is ever modified or left in the database.
-- ==============================================================================

DO $$
DECLARE
    -- ==========================================================================
    -- CONFIGURATION
    -- ==========================================================================
    v_verbose BOOLEAN := FALSE; -- Set to TRUE for line-by-line test execution log

    -- ==========================================================================
    -- FIXTURE IDENTIFIERS
    -- ==========================================================================
    v_pharm_a UUID := gen_random_uuid();
    v_pharm_b UUID := gen_random_uuid();
    v_branch_a1 UUID := gen_random_uuid();
    v_branch_a2 UUID := gen_random_uuid(); -- Branch A2 for branch isolation tests
    v_branch_b1 UUID := gen_random_uuid();

    v_admin_a UUID := gen_random_uuid();
    v_pharmacist_a UUID := gen_random_uuid();
    v_admin_b UUID := gen_random_uuid();
    v_pharmacist_b UUID := gen_random_uuid();
    v_superadmin UUID := gen_random_uuid();

    -- Table fixture IDs for Pharmacy A and B
    v_cat_a UUID := gen_random_uuid();
    v_cat_b UUID := gen_random_uuid();
    v_supp_a UUID := gen_random_uuid();
    v_supp_b UUID := gen_random_uuid();
    v_med_a_otc UUID := gen_random_uuid();
    v_med_a_rx UUID := gen_random_uuid();
    v_med_b_otc UUID := gen_random_uuid();
    v_med_b_rx UUID := gen_random_uuid();
    v_batch_a_otc UUID := gen_random_uuid();
    v_batch_a_rx UUID := gen_random_uuid();
    v_batch_b_otc UUID := gen_random_uuid();
    v_batch_b_rx UUID := gen_random_uuid();
    v_cust_a1 UUID := gen_random_uuid();
    v_cust_a2 UUID := gen_random_uuid();
    v_cust_b UUID := gen_random_uuid();
    v_rx_a1 UUID := gen_random_uuid();
    v_rx_a2 UUID := gen_random_uuid();
    v_rx_b UUID := gen_random_uuid();
    v_sale_a1 UUID := gen_random_uuid();
    v_sale_a2 UUID := gen_random_uuid();
    v_sale_b UUID := gen_random_uuid();
    v_sale_item_a1 UUID := gen_random_uuid();
    v_sale_item_b UUID := gen_random_uuid();
    v_sale_pay_a1 UUID := gen_random_uuid();
    v_sale_pay_b UUID := gen_random_uuid();
    v_ret_a UUID := gen_random_uuid();
    v_ret_b UUID := gen_random_uuid();
    v_ret_item_a UUID := gen_random_uuid();
    v_ret_item_b UUID := gen_random_uuid();
    v_log_a UUID := gen_random_uuid();
    v_log_b UUID := gen_random_uuid();
    v_setting_a UUID := gen_random_uuid();
    v_setting_b UUID := gen_random_uuid();
    v_inq_a UUID := gen_random_uuid();
    v_inq_b UUID := gen_random_uuid();
    v_plan_active UUID := gen_random_uuid();
    v_plan_inactive UUID := gen_random_uuid();

    -- ==========================================================================
    -- TEST RESULTS TRACKING
    -- ==========================================================================
    v_results JSONB := '[]'::JSONB;
    v_total_tests INTEGER := 0;
    v_passed_tests INTEGER := 0;
    v_failed_tests INTEGER := 0;
    v_known_gaps INTEGER := 0;

    v_report TEXT := '';
    v_cat_report TEXT := '';
    v_matrix_summary TEXT := '';
    v_fail_report TEXT := '';

    -- Runner variables
    v_run_outcome TEXT;
    v_run_sqlstate TEXT;
    v_run_err TEXT;
    v_run_rows INTEGER;

    -- Generic loop variables
    v_rec RECORD;
    v_item JSONB;
    v_count INTEGER;
    v_table TEXT;
    v_all_tables TEXT[] := ARRAY[
        'pharmacies', 'branches', 'app_users', 'categories', 'suppliers',
        'medicines', 'batches', 'customers', 'prescriptions', 'sales',
        'sale_items', 'sale_payments', 'returns', 'return_items', 'activity_logs',
        'settings', 'subscription_inquiries', 'subscription_plans', 'platform_settings'
    ];

    -- ==========================================================================
    -- INTERNAL EXECUTION HELPER: run_statement
    -- Switches to target role & claims, runs statement in isolated savepoint,
    -- captures SQLSTATE and ROW_COUNT, automatically rolls back any writes,
    -- and restores outer session role.
    -- ==========================================================================
    FUNCTION run_statement(
        p_uid UUID,
        p_statement TEXT,
        OUT o_outcome TEXT,     -- 'ALLOWED', 'BLOCKED', or 'TEST_ERROR'
        OUT o_sqlstate TEXT,
        OUT o_err TEXT,
        OUT o_rows INTEGER
    ) AS $func$
    DECLARE
        v_clean_stmt TEXT;
        v_role TEXT;
        v_jwt JSONB;
    BEGIN
        o_outcome := 'BLOCKED';
        o_sqlstate := '00000';
        o_err := '';
        o_rows := 0;

        IF p_uid IS NULL THEN
            v_role := 'anon';
            v_jwt := jsonb_build_object('role', 'anon');
        ELSE
            v_role := 'authenticated';
            v_jwt := jsonb_build_object('sub', p_uid::TEXT, 'role', 'authenticated');
        END IF;

        v_clean_stmt := rtrim(p_statement, '; ' || chr(10) || chr(13) || chr(9));

        -- Set simulated Supabase JWT claims
        PERFORM set_config('request.jwt.claims', v_jwt::TEXT, true);

        BEGIN
            EXECUTE 'SET LOCAL ROLE ' || quote_ident(v_role);

            IF v_clean_stmt ~* '^\s*SELECT\s+' THEN
                EXECUTE 'SELECT count(*) FROM (' || v_clean_stmt || ') AS _sub_query' INTO o_rows;
                IF o_rows > 0 THEN
                    o_outcome := 'ALLOWED';
                ELSE
                    o_outcome := 'BLOCKED';
                    o_err := '0 rows returned (RLS hidden)';
                END IF;
            ELSIF v_clean_stmt ~* '^\s*(INSERT|UPDATE|DELETE)\s+' THEN
                -- Run in sub-transaction and force rollback with sentinel
                BEGIN
                    EXECUTE v_clean_stmt;
                    GET DIAGNOSTICS o_rows = ROW_COUNT;
                    RAISE EXCEPTION '__SENTINEL_ROLLBACK__';
                EXCEPTION
                    WHEN OTHERS THEN
                        IF SQLERRM = '__SENTINEL_ROLLBACK__' THEN
                            IF o_rows > 0 THEN
                                o_outcome := 'ALLOWED';
                            ELSE
                                o_outcome := 'BLOCKED';
                                o_err := '0 rows affected (RLS filtered)';
                            END IF;
                        ELSE
                            o_sqlstate := SQLSTATE;
                            o_err := SQLERRM;
                            IF o_sqlstate = '42501' THEN
                                o_outcome := 'BLOCKED';
                            ELSE
                                o_outcome := 'TEST_ERROR';
                            END IF;
                        END IF;
                END;
            ELSE
                -- Function calls / other statements
                BEGIN
                    EXECUTE v_clean_stmt;
                    GET DIAGNOSTICS o_rows = ROW_COUNT;
                    RAISE EXCEPTION '__SENTINEL_ROLLBACK__';
                EXCEPTION
                    WHEN OTHERS THEN
                        IF SQLERRM = '__SENTINEL_ROLLBACK__' THEN
                            o_outcome := 'ALLOWED';
                        ELSE
                            o_sqlstate := SQLSTATE;
                            o_err := SQLERRM;
                            IF o_sqlstate = '42501' THEN
                                o_outcome := 'BLOCKED';
                            ELSE
                                o_outcome := 'TEST_ERROR';
                            END IF;
                        END IF;
                END;
            END IF;

            EXECUTE 'RESET ROLE';
        EXCEPTION WHEN OTHERS THEN
            EXECUTE 'RESET ROLE';
            o_sqlstate := SQLSTATE;
            o_err := SQLERRM;
            IF o_sqlstate = '42501' THEN
                o_outcome := 'BLOCKED';
            ELSE
                o_outcome := 'TEST_ERROR';
            END IF;
        END;

        PERFORM set_config('request.jwt.claims', '', true);
    END;
    $func$ LANGUAGE plpgsql;

    -- ==========================================================================
    -- INTERNAL ASSERTION HELPER: log_test
    -- ==========================================================================
    PROCEDURE log_test(
        p_category TEXT,
        p_test_name TEXT,
        p_actor TEXT,
        p_expected TEXT,      -- 'ALLOWED' or 'BLOCKED'
        p_actual TEXT,        -- 'ALLOWED', 'BLOCKED', or 'TEST_ERROR'
        p_sqlstate TEXT,
        p_err TEXT,
        p_is_known BOOLEAN DEFAULT FALSE,
        p_expected_err_substring TEXT DEFAULT NULL
    ) AS $proc$
    DECLARE
        v_status TEXT;
        v_detail TEXT := '';
    BEGIN
        v_total_tests := v_total_tests + 1;

        IF p_actual = 'TEST_ERROR' THEN
            v_status := 'FAIL';
            v_failed_tests := v_failed_tests + 1;
            v_detail := 'TEST ERROR: Non-security error SQLSTATE ' || p_sqlstate || ': ' || p_err;
        ELSIF p_expected_err_substring IS NOT NULL AND (p_err IS NULL OR p_err NOT ILIKE '%' || p_expected_err_substring || '%') THEN
            v_status := 'FAIL';
            v_failed_tests := v_failed_tests + 1;
            v_detail := 'ERROR TEXT MISMATCH: Expected substring "' || p_expected_err_substring || '", got: "' || COALESCE(p_err, '') || '"';
        ELSIF p_expected = p_actual THEN
            v_status := 'PASS';
            v_passed_tests := v_passed_tests + 1;
            v_detail := 'Matched expected ' || p_expected || CASE WHEN p_err <> '' THEN ' (' || p_err || ')' ELSE '' END;
        ELSE
            IF p_is_known THEN
                v_status := 'KNOWN';
                v_known_gaps := v_known_gaps + 1;
                v_detail := 'KNOWN ACCEPTED GAP (Milestone 3)';
            ELSE
                v_status := 'FAIL';
                v_failed_tests := v_failed_tests + 1;
                v_detail := 'MISMATCH: Expected ' || p_expected || ' but got ' || p_actual || ' (SQLSTATE: ' || p_sqlstate || ', msg: ' || p_err || ')';
            END IF;
        END IF;

        v_results := v_results || jsonb_build_object(
            'cat', p_category,
            'name', p_test_name,
            'actor', p_actor,
            'expected', p_expected,
            'actual', p_actual,
            'status', v_status,
            'detail', v_detail
        );
    END;
    $proc$ LANGUAGE plpgsql;

BEGIN
    -- ==========================================================================
    -- 0. FIXTURES CREATION (AS POSTGRES)
    -- ==========================================================================

    -- 0.1 Pharmacies
    INSERT INTO public.pharmacies (id, name, slug, plan_tier, subscription_status, max_branches, max_users, is_active)
    VALUES 
        (v_pharm_a, 'Pharmacy A Test', 'pharm-a-test-' || substr(v_pharm_a::TEXT, 1, 8), 'starter', 'active', 5, 10, true),
        (v_pharm_b, 'Pharmacy B Test', 'pharm-b-test-' || substr(v_pharm_b::TEXT, 1, 8), 'starter', 'active', 5, 10, true);

    -- 0.2 Branches
    INSERT INTO public.branches (id, pharmacy_id, name, is_main_branch)
    VALUES 
        (v_branch_a1, v_pharm_a, 'Branch A1 Main', true),
        (v_branch_a2, v_pharm_a, 'Branch A2 Secondary', false),
        (v_branch_b1, v_pharm_b, 'Branch B1 Main', true);

    -- 0.3 Auth Users (auth.users first, then public.app_users)
    INSERT INTO auth.users (id, email)
    VALUES 
        (v_admin_a, 'admin_a_test@pharmacore.local'),
        (v_pharmacist_a, 'pharmacist_a_test@pharmacore.local'),
        (v_admin_b, 'admin_b_test@pharmacore.local'),
        (v_pharmacist_b, 'pharmacist_b_test@pharmacore.local'),
        (v_superadmin, 'superadmin_test@pharmacore.local');

    INSERT INTO public.app_users (id, pharmacy_id, branch_id, username, display_name, role, can_view_all_branches, must_change_password)
    VALUES 
        (v_admin_a, v_pharm_a, v_branch_a1, 'admin_a_' || substr(v_admin_a::TEXT, 1, 6), 'Admin A', 'admin', true, false),
        (v_pharmacist_a, v_pharm_a, v_branch_a1, 'pharm_a_' || substr(v_pharmacist_a::TEXT, 1, 6), 'Pharmacist A', 'pharmacist', false, false),
        (v_admin_b, v_pharm_b, v_branch_b1, 'admin_b_' || substr(v_admin_b::TEXT, 1, 6), 'Admin B', 'admin', true, false),
        (v_pharmacist_b, v_pharm_b, v_branch_b1, 'pharm_b_' || substr(v_pharmacist_b::TEXT, 1, 6), 'Pharmacist B', 'pharmacist', false, false),
        (v_superadmin, NULL, NULL, 'super_' || substr(v_superadmin::TEXT, 1, 6), 'Super Admin', 'superadmin', true, false);

    -- 0.4 Categories & Suppliers
    INSERT INTO public.categories (id, pharmacy_id, name)
    VALUES (v_cat_a, v_pharm_a, 'Cat A'), (v_cat_b, v_pharm_b, 'Cat B');

    INSERT INTO public.suppliers (id, pharmacy_id, name)
    VALUES (v_supp_a, v_pharm_a, 'Supp A'), (v_supp_b, v_pharm_b, 'Supp B');

    -- 0.5 Medicines & Batches
    INSERT INTO public.medicines (id, pharmacy_id, name, prescription_required, is_active)
    VALUES 
        (v_med_a_otc, v_pharm_a, 'Panadol OTC A', false, true),
        (v_med_a_rx, v_pharm_a, 'Xanax Rx A', true, true),
        (v_med_b_otc, v_pharm_b, 'Panadol OTC B', false, true),
        (v_med_b_rx, v_pharm_b, 'Xanax Rx B', true, true);

    INSERT INTO public.batches (id, pharmacy_id, medicine_id, batch_number, quantity_in_stock, selling_price, branch_id)
    VALUES 
        (v_batch_a_otc, v_pharm_a, v_med_a_otc, 'BATCH-A-OTC', 100, 20, v_branch_a1),
        (v_batch_a_rx, v_pharm_a, v_med_a_rx, 'BATCH-A-RX', 100, 100, v_branch_a1),
        (v_batch_b_otc, v_pharm_b, v_med_b_otc, 'BATCH-B-OTC', 100, 20, v_branch_b1),
        (v_batch_b_rx, v_pharm_b, v_med_b_rx, 'BATCH-B-RX', 100, 100, v_branch_b1);

    -- 0.6 Customers & Prescriptions
    INSERT INTO public.customers (id, pharmacy_id, branch_id, full_name, phone)
    VALUES 
        (v_cust_a1, v_pharm_a, v_branch_a1, 'Patient A1', '03001111111'),
        (v_cust_a2, v_pharm_a, v_branch_a2, 'Patient A2 (Branch 2)', '03002222222'),
        (v_cust_b, v_pharm_b, v_branch_b1, 'Patient B', '03003333333');

    INSERT INTO public.prescriptions (id, pharmacy_id, branch_id, customer_id, prescriber_name, prescription_date, status)
    VALUES 
        (v_rx_a1, v_pharm_a, v_branch_a1, v_cust_a1, 'Dr. Alpha 1', CURRENT_DATE, 'verified'),
        (v_rx_a2, v_pharm_a, v_branch_a2, v_cust_a2, 'Dr. Alpha 2', CURRENT_DATE, 'verified'),
        (v_rx_b, v_pharm_b, v_branch_b1, v_cust_b, 'Dr. Beta', CURRENT_DATE, 'verified');

    -- 0.7 Sales, Sale Items & Payments
    INSERT INTO public.sales (id, pharmacy_id, branch_id, subtotal, total_amount, payment_method)
    VALUES 
        (v_sale_a1, v_pharm_a, v_branch_a1, 100, 100, 'cash'),
        (v_sale_a2, v_pharm_a, v_branch_a2, 200, 200, 'cash'),
        (v_sale_b, v_pharm_b, v_branch_b1, 100, 100, 'cash');

    INSERT INTO public.sale_items (id, pharmacy_id, sale_id, medicine_id, batch_id, price_at_sale, subtotal_item, branch_id)
    VALUES 
        (v_sale_item_a1, v_pharm_a, v_sale_a1, v_med_a_otc, v_batch_a_otc, 20, 100, v_branch_a1),
        (v_sale_item_b, v_pharm_b, v_sale_b, v_med_b_otc, v_batch_b_otc, 20, 100, v_branch_b1);

    INSERT INTO public.sale_payments (id, pharmacy_id, sale_id, method, amount)
    VALUES 
        (v_sale_pay_a1, v_pharm_a, v_sale_a1, 'cash', 100),
        (v_sale_pay_b, v_pharm_b, v_sale_b, 'cash', 100);

    -- 0.8 Returns & Return Items
    INSERT INTO public.returns (id, pharmacy_id, branch_id, sale_id, refund_method, total_refund_amount, status)
    VALUES 
        (v_ret_a, v_pharm_a, v_branch_a1, v_sale_a1, 'Cash', 20, 'pending'),
        (v_ret_b, v_pharm_b, v_branch_b1, v_sale_b, 'Cash', 20, 'pending');

    INSERT INTO public.return_items (id, pharmacy_id, return_id, sale_item_id, medicine_id, batch_id, quantity, reason, condition, branch_id)
    VALUES 
        (v_ret_item_a, v_pharm_a, v_ret_a, v_sale_item_a1, v_med_a_otc, v_batch_a_otc, 1, 'Wrong item given', 'unopened', v_branch_a1),
        (v_ret_item_b, v_pharm_b, v_ret_b, v_sale_item_b, v_med_b_otc, v_batch_b_otc, 1, 'Wrong item given', 'unopened', v_branch_b1);

    -- 0.9 Activity Logs & Settings & Subscription Inquiries
    INSERT INTO public.activity_logs (id, pharmacy_id, branch_id, user_id, action)
    VALUES 
        (v_log_a, v_pharm_a, v_branch_a1, v_admin_a, 'login'),
        (v_log_b, v_pharm_b, v_branch_b1, v_admin_b, 'login');

    INSERT INTO public.settings (id, pharmacy_id, branch_id, key, value)
    VALUES 
        (v_setting_a, v_pharm_a, v_branch_a1, 'receipt_header', '{"text": "Pharmacy A"}'),
        (v_setting_b, v_pharm_b, v_branch_b1, 'receipt_header', '{"text": "Pharmacy B"}');

    INSERT INTO public.subscription_inquiries (id, pharmacy_id, sender_id, sender_name, sender_role, message)
    VALUES 
        (v_inq_a, v_pharm_a, v_admin_a, 'Admin A', 'admin', 'Upgrade inquiry A'),
        (v_inq_b, v_pharm_b, v_admin_b, 'Admin B', 'admin', 'Upgrade inquiry B');

    -- 0.10 Platform Tables
    INSERT INTO public.subscription_plans (id, name, slug, price_monthly, is_active)
    VALUES 
        (v_plan_active, 'Plan Active Test', 'plan-active-' || substr(v_plan_active::TEXT, 1, 6), 5000, true),
        (v_plan_inactive, 'Plan Inactive Test', 'plan-inactive-' || substr(v_plan_inactive::TEXT, 1, 6), 9000, false);

    INSERT INTO public.platform_settings (key, value)
    VALUES 
        ('platform_identity', '{"platform_name": "PharmaCore Test"}'::JSONB),
        ('security_policy_test', '{"mfa_required": true}'::JSONB)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;


    -- ==========================================================================
    -- 1. COVERAGE GUARD
    -- ==========================================================================
    -- Verify every table in public schema has RLS enabled and is in the 19 table list
    FOR v_rec IN 
        SELECT c.relname, c.relrowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
    LOOP
        -- Check RLS enabled
        IF v_rec.relrowsecurity THEN
            CALL log_test('1. Coverage Guard', 'RLS enabled on ' || v_rec.relname, 'schema', 'ALLOWED', 'ALLOWED', '00000', '');
        ELSE
            CALL log_test('1. Coverage Guard', 'RLS enabled on ' || v_rec.relname, 'schema', 'ALLOWED', 'BLOCKED', '42501', 'RLS is disabled on ' || v_rec.relname);
        END IF;

        -- Check table is recognized in test suite
        IF v_rec.relname = ANY(v_all_tables) THEN
            CALL log_test('1. Coverage Guard', 'Table coverage: ' || v_rec.relname, 'schema', 'ALLOWED', 'ALLOWED', '00000', '');
        ELSE
            CALL log_test('1. Coverage Guard', 'Table coverage: ' || v_rec.relname, 'schema', 'ALLOWED', 'BLOCKED', '42501', 'Untested public table found: ' || v_rec.relname);
        END IF;
    END LOOP;


    -- ==========================================================================
    -- 2. CROSS-TENANT MATRIX & POSITIVE CONTROLS
    -- ==========================================================================
    -- For each table, test Admin A and Pharmacist A against Pharmacy B (must be BLOCKED).
    -- Simultaneously test Admin A and Pharmacist A against Pharmacy A (positive controls).

    -- 2.1 pharmacies
    -- Cross-tenant
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.pharmacies WHERE id = ''' || v_pharm_b || '''');
    CALL log_test('2. Cross-Tenant', 'pharmacies SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.pharmacies SET name = ''Hacked'' WHERE id = ''' || v_pharm_b || '''');
    CALL log_test('2. Cross-Tenant', 'pharmacies UPDATE cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'SELECT id FROM public.pharmacies WHERE id = ''' || v_pharm_b || '''');
    CALL log_test('2. Cross-Tenant', 'pharmacies SELECT cross-tenant', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- Positive controls (Own pharmacy)
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.pharmacies WHERE id = ''' || v_pharm_a || '''');
    CALL log_test('2. Positive Controls', 'pharmacies SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.pharmacies SET name = ''Valid Rename'' WHERE id = ''' || v_pharm_a || '''');
    CALL log_test('2. Positive Controls', 'pharmacies UPDATE own name', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'SELECT id FROM public.pharmacies WHERE id = ''' || v_pharm_a || '''');
    CALL log_test('2. Positive Controls', 'pharmacies SELECT own', 'pharmacist_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.2 branches
    -- Cross-tenant
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.branches WHERE id = ''' || v_branch_b1 || '''');
    CALL log_test('2. Cross-Tenant', 'branches SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.branches (pharmacy_id, name) VALUES (''' || v_pharm_b || ''', ''Hack Branch'')');
    CALL log_test('2. Cross-Tenant', 'branches INSERT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.branches SET name = ''Hack'' WHERE id = ''' || v_branch_b1 || '''');
    CALL log_test('2. Cross-Tenant', 'branches UPDATE cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'DELETE FROM public.branches WHERE id = ''' || v_branch_b1 || '''');
    CALL log_test('2. Cross-Tenant', 'branches DELETE cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- Positive controls
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.branches WHERE id = ''' || v_branch_a1 || '''');
    CALL log_test('2. Positive Controls', 'branches SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.branches SET name = ''Valid Branch Rename'' WHERE id = ''' || v_branch_a1 || '''');
    CALL log_test('2. Positive Controls', 'branches UPDATE own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.3 categories
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.categories WHERE id = ''' || v_cat_b || '''');
    CALL log_test('2. Cross-Tenant', 'categories SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.categories (pharmacy_id, name) VALUES (''' || v_pharm_b || ''', ''Hack Cat'')');
    CALL log_test('2. Cross-Tenant', 'categories INSERT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.categories SET name = ''Hack'' WHERE id = ''' || v_cat_b || '''');
    CALL log_test('2. Cross-Tenant', 'categories UPDATE cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'DELETE FROM public.categories WHERE id = ''' || v_cat_b || '''');
    CALL log_test('2. Cross-Tenant', 'categories DELETE cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- Positive controls
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.categories WHERE id = ''' || v_cat_a || '''');
    CALL log_test('2. Positive Controls', 'categories SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.categories (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Valid Cat'')');
    CALL log_test('2. Positive Controls', 'categories INSERT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.4 suppliers
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.suppliers WHERE id = ''' || v_supp_b || '''');
    CALL log_test('2. Cross-Tenant', 'suppliers SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.suppliers (pharmacy_id, name) VALUES (''' || v_pharm_b || ''', ''Hack Supp'')');
    CALL log_test('2. Cross-Tenant', 'suppliers INSERT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.suppliers WHERE id = ''' || v_supp_a || '''');
    CALL log_test('2. Positive Controls', 'suppliers SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.5 medicines
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.medicines WHERE id = ''' || v_med_b_otc || '''');
    CALL log_test('2. Cross-Tenant', 'medicines SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.medicines (pharmacy_id, name) VALUES (''' || v_pharm_b || ''', ''Hack Med'')');
    CALL log_test('2. Cross-Tenant', 'medicines INSERT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.medicines SET name = ''Hack'' WHERE id = ''' || v_med_b_otc || '''');
    CALL log_test('2. Cross-Tenant', 'medicines UPDATE cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'DELETE FROM public.medicines WHERE id = ''' || v_med_b_otc || '''');
    CALL log_test('2. Cross-Tenant', 'medicines DELETE cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.medicines WHERE id = ''' || v_med_a_otc || '''');
    CALL log_test('2. Positive Controls', 'medicines SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.6 batches
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.batches WHERE id = ''' || v_batch_b_otc || '''');
    CALL log_test('2. Cross-Tenant', 'batches SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.batches (pharmacy_id, medicine_id, batch_number) VALUES (''' || v_pharm_b || ''', ''' || v_med_b_otc || ''', ''B-HACK'')');
    CALL log_test('2. Cross-Tenant', 'batches INSERT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.batches WHERE id = ''' || v_batch_a_otc || '''');
    CALL log_test('2. Positive Controls', 'batches SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.7 customers
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.customers WHERE id = ''' || v_cust_b || '''');
    CALL log_test('2. Cross-Tenant', 'customers SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.customers (pharmacy_id, full_name) VALUES (''' || v_pharm_b || ''', ''Hack Cust'')');
    CALL log_test('2. Cross-Tenant', 'customers INSERT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.customers WHERE id = ''' || v_cust_a1 || '''');
    CALL log_test('2. Positive Controls', 'customers SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.8 prescriptions
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.prescriptions WHERE id = ''' || v_rx_b || '''');
    CALL log_test('2. Cross-Tenant', 'prescriptions SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.prescriptions (pharmacy_id, customer_id, prescriber_name, prescription_date) VALUES (''' || v_pharm_b || ''', ''' || v_cust_b || ''', ''Dr'', CURRENT_DATE)');
    CALL log_test('2. Cross-Tenant', 'prescriptions INSERT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.prescriptions WHERE id = ''' || v_rx_a1 || '''');
    CALL log_test('2. Positive Controls', 'prescriptions SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.9 sales (Direct INSERT blocked, SELECT scoped)
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.sales WHERE id = ''' || v_sale_b || '''');
    CALL log_test('2. Cross-Tenant', 'sales SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.sales WHERE id = ''' || v_sale_a1 || '''');
    CALL log_test('2. Positive Controls', 'sales SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.10 sale_items
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.sale_items WHERE id = ''' || v_sale_item_b || '''');
    CALL log_test('2. Cross-Tenant', 'sale_items SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.sale_items WHERE id = ''' || v_sale_item_a1 || '''');
    CALL log_test('2. Positive Controls', 'sale_items SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.11 sale_payments
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.sale_payments WHERE id = ''' || v_sale_pay_b || '''');
    CALL log_test('2. Cross-Tenant', 'sale_payments SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.sale_payments WHERE id = ''' || v_sale_pay_a1 || '''');
    CALL log_test('2. Positive Controls', 'sale_payments SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.12 returns
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.returns WHERE id = ''' || v_ret_b || '''');
    CALL log_test('2. Cross-Tenant', 'returns SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.returns WHERE id = ''' || v_ret_a || '''');
    CALL log_test('2. Positive Controls', 'returns SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.13 return_items
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.return_items WHERE id = ''' || v_ret_item_b || '''');
    CALL log_test('2. Cross-Tenant', 'return_items SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.return_items WHERE id = ''' || v_ret_item_a || '''');
    CALL log_test('2. Positive Controls', 'return_items SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.14 activity_logs (INSERT-only, no UPDATE/DELETE)
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.activity_logs WHERE id = ''' || v_log_b || '''');
    CALL log_test('2. Cross-Tenant', 'activity_logs SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.activity_logs (pharmacy_id, action) VALUES (''' || v_pharm_b || ''', ''Hack'')');
    CALL log_test('2. Cross-Tenant', 'activity_logs INSERT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.activity_logs SET action = ''Tamper'' WHERE id = ''' || v_log_a || '''');
    CALL log_test('2. Role Rules', 'activity_logs UPDATE own (blocked for all)', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'DELETE FROM public.activity_logs WHERE id = ''' || v_log_a || '''');
    CALL log_test('2. Role Rules', 'activity_logs DELETE own (blocked for all)', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.activity_logs WHERE id = ''' || v_log_a || '''');
    CALL log_test('2. Positive Controls', 'activity_logs SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.activity_logs (pharmacy_id, action) VALUES (''' || v_pharm_a || ''', ''Audit Note'')');
    CALL log_test('2. Positive Controls', 'activity_logs INSERT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.15 settings
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.settings WHERE id = ''' || v_setting_b || '''');
    CALL log_test('2. Cross-Tenant', 'settings SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.settings (pharmacy_id, key, value) VALUES (''' || v_pharm_b || ''', ''k'', ''{}'')');
    CALL log_test('2. Cross-Tenant', 'settings INSERT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.settings WHERE id = ''' || v_setting_a || '''');
    CALL log_test('2. Positive Controls', 'settings SELECT own', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.16 subscription_inquiries (SELECT, INSERT, UPDATE allowed for own members, NO DELETE)
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.subscription_inquiries WHERE id = ''' || v_inq_b || '''');
    CALL log_test('2. Cross-Tenant', 'subscription_inquiries SELECT cross-tenant', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'DELETE FROM public.subscription_inquiries WHERE id = ''' || v_inq_a || '''');
    CALL log_test('2. Role Rules', 'subscription_inquiries DELETE own (blocked)', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'SELECT id FROM public.subscription_inquiries WHERE id = ''' || v_inq_a || '''');
    CALL log_test('2. Positive Controls', 'subscription_inquiries SELECT own', 'pharmacist_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'INSERT INTO public.subscription_inquiries (pharmacy_id, sender_name, sender_role, message) VALUES (''' || v_pharm_a || ''', ''P'', ''pharmacist'', ''Hello'')');
    CALL log_test('2. Positive Controls', 'subscription_inquiries INSERT own', 'pharmacist_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'UPDATE public.subscription_inquiries SET message = ''Updated'' WHERE id = ''' || v_inq_a || '''');
    CALL log_test('2. Positive Controls', 'subscription_inquiries UPDATE own', 'pharmacist_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 2.17 platform tables: subscription_plans & platform_settings
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.subscription_plans WHERE id = ''' || v_plan_active || '''');
    CALL log_test('2. Platform Tables', 'subscription_plans SELECT active', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.subscription_plans WHERE id = ''' || v_plan_inactive || '''');
    CALL log_test('2. Platform Tables', 'subscription_plans SELECT inactive (non-superadmin)', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.subscription_plans (name, slug) VALUES (''Hack Plan'', ''hack'')');
    CALL log_test('2. Platform Tables', 'subscription_plans INSERT non-superadmin', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT key FROM public.platform_settings');
    CALL log_test('2. Platform Tables', 'platform_settings SELECT authenticated', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.platform_settings (key, value) VALUES (''hack'', ''{}'')');
    CALL log_test('2. Platform Tables', 'platform_settings INSERT non-superadmin', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);


    -- ==========================================================================
    -- 3. ROLE RULES: PHARMACIST CANNOT DO ADMIN-ONLY WRITES
    -- ==========================================================================
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'UPDATE public.pharmacies SET name = ''Pharm Hack'' WHERE id = ''' || v_pharm_a || '''');
    CALL log_test('3. Role Rules', 'pharmacist cannot UPDATE pharmacies', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'INSERT INTO public.branches (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Pharm Branch'')');
    CALL log_test('3. Role Rules', 'pharmacist cannot INSERT branches', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'INSERT INTO public.categories (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Pharm Cat'')');
    CALL log_test('3. Role Rules', 'pharmacist cannot INSERT categories', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'INSERT INTO public.suppliers (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Pharm Supp'')');
    CALL log_test('3. Role Rules', 'pharmacist cannot INSERT suppliers', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'INSERT INTO public.medicines (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Pharm Med'')');
    CALL log_test('3. Role Rules', 'pharmacist cannot INSERT medicines', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'INSERT INTO public.batches (pharmacy_id, medicine_id, batch_number) VALUES (''' || v_pharm_a || ''', ''' || v_med_a_otc || ''', ''B-P'')');
    CALL log_test('3. Role Rules', 'pharmacist cannot INSERT batches', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'INSERT INTO public.settings (pharmacy_id, key, value) VALUES (''' || v_pharm_a || ''', ''p_key'', ''{}'')');
    CALL log_test('3. Role Rules', 'pharmacist cannot INSERT settings', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'UPDATE public.sales SET notes = ''Pharm Note'' WHERE id = ''' || v_sale_a1 || '''');
    CALL log_test('3. Role Rules', 'pharmacist cannot UPDATE sales', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'DELETE FROM public.sales WHERE id = ''' || v_sale_a1 || '''');
    CALL log_test('3. Role Rules', 'pharmacist cannot DELETE sales', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);


    -- ==========================================================================
    -- 4. BRANCH ISOLATION (Pharmacist in A1 vs Branch A2)
    -- ==========================================================================
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'SELECT id FROM public.sales WHERE id = ''' || v_sale_a2 || '''');
    CALL log_test('4. Branch Isolation', 'pharmacist A1 cannot SELECT sales in Branch A2', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'SELECT id FROM public.customers WHERE id = ''' || v_cust_a2 || '''');
    CALL log_test('4. Branch Isolation', 'pharmacist A1 cannot SELECT customers in Branch A2', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'SELECT id FROM public.prescriptions WHERE id = ''' || v_rx_a2 || '''');
    CALL log_test('4. Branch Isolation', 'pharmacist A1 cannot SELECT prescriptions in Branch A2', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- Admin A has can_view_all_branches = true, can see Branch A2
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT id FROM public.sales WHERE id = ''' || v_sale_a2 || '''');
    CALL log_test('4. Branch Isolation', 'admin with can_view_all_branches can SELECT Branch A2 sales', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);


    -- ==========================================================================
    -- 5. ANON LOCKDOWN
    -- ==========================================================================
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(NULL, 'SELECT id FROM public.pharmacies');
    CALL log_test('5. Anon Lockdown', 'anon cannot SELECT pharmacies', 'anon', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(NULL, 'SELECT id FROM public.medicines');
    CALL log_test('5. Anon Lockdown', 'anon cannot SELECT medicines', 'anon', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(NULL, 'SELECT id FROM public.sales');
    CALL log_test('5. Anon Lockdown', 'anon cannot SELECT sales', 'anon', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(NULL, 'SELECT id FROM public.subscription_plans WHERE id = ''' || v_plan_active || '''');
    CALL log_test('5. Anon Lockdown', 'anon CAN SELECT active subscription_plans', 'anon', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(NULL, 'SELECT id FROM public.subscription_plans WHERE id = ''' || v_plan_inactive || '''');
    CALL log_test('5. Anon Lockdown', 'anon cannot SELECT inactive subscription_plans', 'anon', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(NULL, 'SELECT value FROM public.platform_settings WHERE key = ''platform_identity''');
    CALL log_test('5. Anon Lockdown', 'anon CAN SELECT platform_identity setting', 'anon', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(NULL, 'SELECT value FROM public.platform_settings WHERE key = ''security_policy_test''');
    CALL log_test('5. Anon Lockdown', 'anon cannot SELECT security_policy setting', 'anon', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);


    -- ==========================================================================
    -- 6. CATALOG GRANTS & FUNCTION AUDIT
    -- ==========================================================================
    -- Catalog audit for functions: authenticated must have EXECUTE on exactly 9 functions.
    -- anon must have EXECUTE on 0 functions.
    FOR v_rec IN
        SELECT p.proname,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d 
              WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
          )
    LOOP
        -- Check anon EXECUTE is always false
        IF v_rec.anon_exec THEN
            CALL log_test('6. Catalog Audit', 'anon cannot EXECUTE ' || v_rec.proname, 'catalog', 'BLOCKED', 'ALLOWED', '00000', 'Anon has EXECUTE on ' || v_rec.proname);
        ELSE
            CALL log_test('6. Catalog Audit', 'anon cannot EXECUTE ' || v_rec.proname, 'catalog', 'BLOCKED', 'BLOCKED', '00000', '');
        END IF;

        -- Check authenticated EXECUTE matches the 9 approved functions
        IF v_rec.proname IN (
            'is_superadmin', 'is_admin', 'get_user_pharmacy_id', 'get_user_branch_id',
            'can_view_all_branches', 'process_sale', 'process_return', 'approve_return',
            'get_supplier_dashboard_stats'
        ) THEN
            IF v_rec.auth_exec THEN
                CALL log_test('6. Catalog Audit', 'authenticated can EXECUTE ' || v_rec.proname, 'catalog', 'ALLOWED', 'ALLOWED', '00000', '');
            ELSE
                CALL log_test('6. Catalog Audit', 'authenticated can EXECUTE ' || v_rec.proname, 'catalog', 'ALLOWED', 'BLOCKED', '42501', 'Missing EXECUTE on ' || v_rec.proname);
            END IF;
        ELSE
            -- update_expired_batches, trigger functions, etc. MUST NOT be executable
            IF v_rec.auth_exec THEN
                CALL log_test('6. Catalog Audit', 'authenticated cannot EXECUTE ' || v_rec.proname, 'catalog', 'BLOCKED', 'ALLOWED', '00000', 'Unexpected EXECUTE on ' || v_rec.proname);
            ELSE
                CALL log_test('6. Catalog Audit', 'authenticated cannot EXECUTE ' || v_rec.proname, 'catalog', 'BLOCKED', 'BLOCKED', '00000', '');
            END IF;
        END IF;
    END LOOP;

    -- Catalog audit for table privileges:
    -- Authenticated must NEVER have TRUNCATE, REFERENCES, or TRIGGER anywhere
    FOR v_rec IN
        SELECT table_name, privilege_type
        FROM information_schema.role_table_grants
        WHERE grantee = 'authenticated' AND table_schema = 'public'
          AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
    LOOP
        CALL log_test('6. Catalog Audit', 'authenticated has no ' || v_rec.privilege_type || ' on ' || v_rec.table_name, 'catalog', 'BLOCKED', 'ALLOWED', '00000', 'Dangerous grant: ' || v_rec.privilege_type);
    END LOOP;

    -- Anon must only have SELECT on subscription_plans and platform_settings
    FOR v_rec IN
        SELECT table_name, privilege_type
        FROM information_schema.role_table_grants
        WHERE grantee = 'anon' AND table_schema = 'public'
    LOOP
        IF v_rec.privilege_type = 'SELECT' AND v_rec.table_name IN ('subscription_plans', 'platform_settings') THEN
            -- Allowed
            NULL;
        ELSE
            CALL log_test('6. Catalog Audit', 'anon has no ' || v_rec.privilege_type || ' on ' || v_rec.table_name, 'catalog', 'BLOCKED', 'ALLOWED', '00000', 'Illegal anon table grant');
        END IF;
    END LOOP;


    -- ==========================================================================
    -- 7. SUPERADMIN SCOPE & RESTRICTIONS
    -- ==========================================================================
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_superadmin, 'SELECT id FROM public.pharmacies');
    CALL log_test('7. Superadmin Scope', 'superadmin can SELECT all pharmacies', 'superadmin', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_superadmin, 'SELECT id FROM public.medicines');
    CALL log_test('7. Superadmin Scope', 'superadmin can SELECT all medicines', 'superadmin', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- Superadmin ringing sale must be rejected with 'User has no pharmacy assignment'
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(
        v_superadmin,
        'SELECT public.process_sale(gen_random_uuid(), ''[{"medicine_id": "' || v_med_a_otc || '", "batch_id": "' || v_batch_a_otc || '", "quantity": 1, "price_at_sale": 20, "tax_rate_at_sale": 0, "tax_amount": 0, "subtotal_item": 20}]''::JSONB, 20, 0, 20, ''{}''::JSONB)'
    );
    CALL log_test('7. Superadmin Scope', 'process_sale rejects superadmin without pharmacy', 'superadmin', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'User has no pharmacy assignment');


    -- ==========================================================================
    -- 8. REGRESSION TESTS (PROMPT 1.5 FIXES)
    -- ==========================================================================

    -- 8.1 app_users escalation & id protection
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.app_users SET role = ''superadmin'' WHERE id = ''' || v_admin_a || '''');
    CALL log_test('8. Regression 1.5', 'admin cannot escalate role to superadmin', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'Only superadmin can change user roles');

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.app_users SET pharmacy_id = ''' || v_pharm_b || ''' WHERE id = ''' || v_pharmacist_a || '''');
    CALL log_test('8. Regression 1.5', 'admin cannot change staff pharmacy assignment', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'Only superadmin can change pharmacy assignment');

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.app_users SET id = gen_random_uuid() WHERE id = ''' || v_pharmacist_a || '''');
    CALL log_test('8. Regression 1.5', 'admin cannot change user ID', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'Cannot modify user ID');

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.app_users SET display_name = ''Updated Staff'' WHERE id = ''' || v_pharmacist_a || '''');
    CALL log_test('8. Regression 1.5', 'admin CAN update staff display_name', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 8.2 pharmacies billing protection
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.pharmacies SET plan_tier = ''enterprise'' WHERE id = ''' || v_pharm_a || '''');
    CALL log_test('8. Regression 1.5', 'admin cannot change pharmacy plan_tier', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'Only superadmin can modify pharmacy plan tier');

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.pharmacies SET max_branches = 50 WHERE id = ''' || v_pharm_a || '''');
    CALL log_test('8. Regression 1.5', 'admin cannot change pharmacy max_branches', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'Only superadmin can modify branch limits');

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.pharmacies SET id = gen_random_uuid() WHERE id = ''' || v_pharm_a || '''');
    CALL log_test('8. Regression 1.5', 'admin cannot change pharmacy ID', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'Cannot modify pharmacy ID');

    -- 8.3 approve_return
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT public.approve_return(''' || v_ret_b || ''')');
    CALL log_test('8. Regression 1.5', 'approve_return blocked across pharmacies', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'Access denied: Return belongs to another pharmacy');

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_pharmacist_a, 'SELECT public.approve_return(''' || v_ret_a || ''')');
    CALL log_test('8. Regression 1.5', 'approve_return blocked for pharmacist', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'Requires administrator privileges');

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT public.approve_return(''' || v_ret_a || ''')');
    CALL log_test('8. Regression 1.5', 'approve_return succeeds for admin on own pending return', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'SELECT public.approve_return(''' || v_ret_a || ''')');
    CALL log_test('8. Regression 1.5', 'approve_return blocked on double approval', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'Return is not pending approval');

    -- 8.4 process_sale per-item validations
    -- Other pharmacy medicine/batch
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(
        v_pharmacist_a,
        'SELECT public.process_sale(gen_random_uuid(), ''[{"medicine_id": "' || v_med_b_otc || '", "batch_id": "' || v_batch_b_otc || '", "quantity": 1, "price_at_sale": 20, "tax_rate_at_sale": 0, "tax_amount": 0, "subtotal_item": 20}]''::JSONB, 20, 0, 20, ''{}''::JSONB)'
    );
    CALL log_test('8. Regression 1.5', 'process_sale blocks cross-pharmacy medicine/batch', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'Item validation failed');

    -- Mismatched medicine ID paired with Rx batch
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(
        v_pharmacist_a,
        'SELECT public.process_sale(gen_random_uuid(), ''[{"medicine_id": "' || v_med_a_otc || '", "batch_id": "' || v_batch_a_rx || '", "quantity": 1, "price_at_sale": 20, "tax_rate_at_sale": 0, "tax_amount": 0, "subtotal_item": 20}]''::JSONB, 20, 0, 20, ''{}''::JSONB)'
    );
    CALL log_test('8. Regression 1.5', 'process_sale blocks mismatched medicine_id and batch_id', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'Item validation failed');

    -- Rx drug with no prescription / customer
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(
        v_pharmacist_a,
        'SELECT public.process_sale(gen_random_uuid(), ''[{"medicine_id": "' || v_med_a_rx || '", "batch_id": "' || v_batch_a_rx || '", "quantity": 1, "price_at_sale": 100, "tax_rate_at_sale": 0, "tax_amount": 0, "subtotal_item": 100}]''::JSONB, 100, 0, 100, ''{}''::JSONB)'
    );
    CALL log_test('8. Regression 1.5', 'process_sale blocks prescription drug without prescription', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'A verified prescription and customer are required');

    -- Negative quantity
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(
        v_pharmacist_a,
        'SELECT public.process_sale(gen_random_uuid(), ''[{"medicine_id": "' || v_med_a_otc || '", "batch_id": "' || v_batch_a_otc || '", "quantity": -1, "price_at_sale": 20, "tax_rate_at_sale": 0, "tax_amount": 0, "subtotal_item": 20}]''::JSONB, 20, 0, 20, ''{}''::JSONB)'
    );
    CALL log_test('8. Regression 1.5', 'process_sale blocks negative quantity', 'pharmacist_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false, 'Quantity must be greater than zero');

    -- Legitimate sale lowers stock
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(
        v_pharmacist_a,
        'SELECT public.process_sale(gen_random_uuid(), ''[{"medicine_id": "' || v_med_a_otc || '", "batch_id": "' || v_batch_a_otc || '", "quantity": 2, "price_at_sale": 20, "tax_rate_at_sale": 0, "tax_amount": 0, "subtotal_item": 40}]''::JSONB, 40, 0, 40, ''{}''::JSONB)'
    );
    CALL log_test('8. Regression 1.5', 'legitimate sale succeeds', 'pharmacist_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- Check stock was lowered by 2 (from 100 to 98)
    SELECT quantity_in_stock INTO v_count FROM public.batches WHERE id = v_batch_a_otc;
    IF v_count = 98 THEN
        CALL log_test('8. Regression 1.5', 'legitimate sale lowered stock accurately', 'system', 'ALLOWED', 'ALLOWED', '00000', '');
    ELSE
        CALL log_test('8. Regression 1.5', 'legitimate sale lowered stock accurately', 'system', 'ALLOWED', 'BLOCKED', '00000', 'Expected 98, got ' || v_count);
    END IF;

    -- 8.5 Direct INSERTs blocked for sales and returns
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.sales (pharmacy_id, subtotal, total_amount) VALUES (''' || v_pharm_a || ''', 50, 50)');
    CALL log_test('8. Regression 1.5', 'direct INSERT sales blocked for admin', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.sale_items (pharmacy_id, sale_id, price_at_sale, subtotal_item) VALUES (''' || v_pharm_a || ''', ''' || v_sale_a1 || ''', 10, 10)');
    CALL log_test('8. Regression 1.5', 'direct INSERT sale_items blocked for admin', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.sale_payments (pharmacy_id, sale_id, method, amount) VALUES (''' || v_pharm_a || ''', ''' || v_sale_a1 || ''', ''cash'', 10)');
    CALL log_test('8. Regression 1.5', 'direct INSERT sale_payments blocked for admin', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.returns (pharmacy_id, refund_method, status) VALUES (''' || v_pharm_a || ''', ''Cash'', ''pending'')');
    CALL log_test('8. Regression 1.5', 'direct INSERT returns blocked for admin', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'INSERT INTO public.return_items (pharmacy_id, return_id, quantity, reason, condition) VALUES (''' || v_pharm_a || ''', ''' || v_ret_a || ''', 1, ''Reason'', ''unopened'')');
    CALL log_test('8. Regression 1.5', 'direct INSERT return_items blocked for admin', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err);

    -- 8.6 Trusted path (no JWT / direct SQL) can update roles
    UPDATE public.app_users SET role = 'superadmin' WHERE id = v_admin_b;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 1 THEN
        CALL log_test('8. Regression 1.5', 'trusted path without JWT can change roles', 'postgres', 'ALLOWED', 'ALLOWED', '00000', '');
    ELSE
        CALL log_test('8. Regression 1.5', 'trusted path without JWT can change roles', 'postgres', 'ALLOWED', 'BLOCKED', '00000', 'Failed to update');
    END IF;


    -- ==========================================================================
    -- 9. MAX_BRANCHES LIMIT ENFORCEMENT TEST (EXPECTED TO FAIL ON FIRST RUN)
    -- ==========================================================================
    -- Set max_branches = 1 on Pharmacy A (which already has 2 branches)
    UPDATE public.pharmacies SET max_branches = 1 WHERE id = v_pharm_a;

    -- As Admin A, attempt to insert another branch (exceeds max_branches)
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(
        v_admin_a,
        'INSERT INTO public.branches (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Branch Over Limit'')'
    );
    -- We EXPECT this to be BLOCKED. In current schema, it succeeds (ALLOWED), so this test FAILS.
    CALL log_test('9. Limits Enforcement', 'admin cannot insert branch beyond max_branches', 'admin_a', 'BLOCKED', v_run_outcome, v_run_sqlstate, v_run_err, false);


    -- ==========================================================================
    -- 10. KNOWN ACCEPTED GAPS (MILESTONE 3)
    -- ==========================================================================
    -- Gap 1: Admin can UPDATE sales rows in own pharmacy
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(v_admin_a, 'UPDATE public.sales SET notes = ''Admin Update Notes'' WHERE id = ''' || v_sale_a1 || '''');
    CALL log_test('10. Known Gaps', 'admin can UPDATE sales in own pharmacy', 'admin_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err, true);

    -- Gap 2: Same sale item can be returned more than once via process_return
    SELECT * INTO v_run_outcome, v_run_sqlstate, v_run_err, v_run_rows FROM run_statement(
        v_pharmacist_a,
        'SELECT public.process_return(gen_random_uuid(), ''' || v_sale_a1 || ''', ''[{"sale_item_id": "' || v_sale_item_a1 || '", "quantity": 1, "reason": "Wrong item given", "condition": "unopened"}]''::JSONB, ''Store Credit'')'
    );
    CALL log_test('10. Known Gaps', 'process_return allows duplicate return of same sale_item', 'pharmacist_a', 'ALLOWED', v_run_outcome, v_run_sqlstate, v_run_err, true);


    -- ==========================================================================
    -- 11. COMPILE REPORT & RAISE EXCEPTION (ROLLBACK)
    -- ==========================================================================
    IF v_failed_tests = 0 THEN
        v_report := 'SUITE_RESULT: PASS (Total: ' || v_total_tests || ', Passed: ' || v_passed_tests || ', Failed: ' || v_failed_tests || ', Known Gaps: ' || v_known_gaps || ')' || E'\n';
    ELSE
        v_report := 'SUITE_RESULT: FAIL (Total: ' || v_total_tests || ', Passed: ' || v_passed_tests || ', Failed: ' || v_failed_tests || ', Known Gaps: ' || v_known_gaps || ')' || E'\n';
    END IF;

    v_report := v_report || '================================================================================' || E'\n';
    v_report := v_report || 'PHARMACORE RLS & SECURITY TEST SUITE AUDIT REPORT' || E'\n';
    v_report := v_report || '================================================================================' || E'\n\n';

    -- Summary table
    v_report := v_report || 'SUMMARY COUNTS:' || E'\n';
    v_report := v_report || '  Total Tests Checked : ' || v_total_tests || E'\n';
    v_report := v_report || '  Passed              : ' || v_passed_tests || E'\n';
    v_report := v_report || '  Failed              : ' || v_failed_tests || E'\n';
    v_report := v_report || '  Known Accepted Gaps : ' || v_known_gaps || E'\n\n';

    -- List all failures (if any)
    IF v_failed_tests > 0 THEN
        v_report := v_report || '--------------------------------------------------------------------------------' || E'\n';
        v_report := v_report || 'FAILED TESTS DETAILS (' || v_failed_tests || ' failure(s)):' || E'\n';
        v_report := v_report || '--------------------------------------------------------------------------------' || E'\n';
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_results)
        LOOP
            IF v_item->>'status' = 'FAIL' THEN
                v_report := v_report || '  [FAIL] ' || (v_item->>'cat') || ' -> ' || (v_item->>'name') || E'\n';
                v_report := v_report || '         Actor   : ' || (v_item->>'actor') || E'\n';
                v_report := v_report || '         Details : ' || (v_item->>'detail') || E'\n';
            END IF;
        END LOOP;
        v_report := v_report || E'\n';
    END IF;

    -- Known Accepted Gaps
    IF v_known_gaps > 0 THEN
        v_report := v_report || '--------------------------------------------------------------------------------' || E'\n';
        v_report := v_report || 'KNOWN ACCEPTED GAPS (Milestone 3 Scope):' || E'\n';
        v_report := v_report || '--------------------------------------------------------------------------------' || E'\n';
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_results)
        LOOP
            IF v_item->>'status' = 'KNOWN' THEN
                v_report := v_report || '  [KNOWN] ' || (v_item->>'name') || ' (' || (v_item->>'detail') || ')' || E'\n';
            END IF;
        END LOOP;
        v_report := v_report || E'\n';
    END IF;

    -- Compact category summary
    v_report := v_report || '--------------------------------------------------------------------------------' || E'\n';
    v_report := v_report || 'CATEGORY AUDIT BREAKDOWN:' || E'\n';
    v_report := v_report || '--------------------------------------------------------------------------------' || E'\n';
    FOR v_rec IN 
        SELECT (value->>'cat') AS cat,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE value->>'status' = 'PASS') AS passed,
               COUNT(*) FILTER (WHERE value->>'status' = 'FAIL') AS failed,
               COUNT(*) FILTER (WHERE value->>'status' = 'KNOWN') AS known
        FROM jsonb_array_elements(v_results)
        GROUP BY 1
        ORDER BY 1
    LOOP
        v_report := v_report || rpad(v_rec.cat, 26) || ' | Total: ' || lpad(v_rec.total::TEXT, 3) 
                             || ' | Pass: ' || lpad(v_rec.passed::TEXT, 3) 
                             || ' | Fail: ' || lpad(v_rec.failed::TEXT, 2) 
                             || ' | Known: ' || lpad(v_rec.known::TEXT, 2) || E'\n';
    END LOOP;

    -- Verbose individual test output if enabled
    IF v_verbose THEN
        v_report := v_report || E'\n' || '--------------------------------------------------------------------------------' || E'\n';
        v_report := v_report || 'VERBOSE INDIVIDUAL TEST LOG:' || E'\n';
        v_report := v_report || '--------------------------------------------------------------------------------' || E'\n';
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_results)
        LOOP
            v_report := v_report || '[' || rpad(v_item->>'status', 5) || '] ' || rpad(v_item->>'cat', 22) || ' | ' || (v_item->>'name') || E'\n';
        END LOOP;
    END IF;

    v_report := v_report || E'\n' || '================================================================================' || E'\n';
    v_report := v_report || 'END OF AUDIT REPORT -- ALL TRANSACTIONS ROLLED BACK SAFELY' || E'\n';
    v_report := v_report || '================================================================================' || E'\n';

    -- Terminate and rollback everything
    RAISE EXCEPTION E'\n%', v_report;
END;
$$;
