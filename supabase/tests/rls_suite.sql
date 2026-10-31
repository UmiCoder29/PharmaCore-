-- ==============================================================================
-- PharmaCore Cross-Tenant RLS & Security Test Suite
-- File: supabase/tests/rls_suite.sql
--
-- INSTRUCTIONS FOR USE:
-- 1. Open Supabase Dashboard -> SQL Editor.
-- 2. Paste this entire file into the editor.
-- 3. Click "Run" (executed under role `postgres`).
-- 4. The script executes as a single batch and terminates with:
--    RAISE EXCEPTION carrying the full text report.
--    This guarantees 100% atomic rollback of all test fixtures and statements.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TEMPORARY SUITE RESULTS TABLE
-- ------------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS pg_temp.suite_results (
    id SERIAL PRIMARY KEY,
    cat TEXT NOT NULL,
    name TEXT NOT NULL,
    actor TEXT NOT NULL,
    tbl TEXT,
    op TEXT,
    expected TEXT NOT NULL,  -- 'ALLOWED' or 'BLOCKED'
    actual TEXT NOT NULL,    -- 'ALLOWED', 'BLOCKED', 'RAISED', 'TEST_ERROR'
    status TEXT NOT NULL,    -- 'PASS', 'FAIL', 'KNOWN'
    err_state TEXT,
    err TEXT,
    detail TEXT
);

TRUNCATE TABLE pg_temp.suite_results;

-- ------------------------------------------------------------------------------
-- 2. RUNNER HELPER: pg_temp.run_statement
-- Runs single statement in an isolated sub-block that is always rolled back.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.run_statement(
    p_uid UUID,
    p_statement TEXT,
    p_is_read_query BOOLEAN DEFAULT FALSE
) RETURNS TABLE (
    outcome TEXT,
    err_state TEXT,
    err TEXT,
    rows_affected INTEGER
) AS $$
DECLARE
    v_clean_stmt TEXT;
    v_db_role TEXT;
    v_jwt_claims JSONB;
BEGIN
    outcome := 'BLOCKED';
    err_state := '00000';
    err := '';
    rows_affected := 0;

    IF p_uid IS NULL THEN
        v_db_role := 'anon';
        v_jwt_claims := jsonb_build_object('role', 'anon');
    ELSE
        v_db_role := 'authenticated';
        v_jwt_claims := jsonb_build_object('sub', p_uid::TEXT, 'role', 'authenticated');
    END IF;

    v_clean_stmt := rtrim(p_statement, '; ' || chr(10) || chr(13) || chr(9));

    -- Set the simulated Supabase request JWT claims
    PERFORM set_config('request.jwt.claims', v_jwt_claims::TEXT, true);

    BEGIN
        EXECUTE 'SET LOCAL ROLE ' || quote_ident(v_db_role);

        IF p_is_read_query THEN
            -- Plain read query: count visible rows under RLS
            EXECUTE 'SELECT count(*) FROM (' || v_clean_stmt || ') AS _sub_query' INTO rows_affected;
            IF rows_affected > 0 THEN
                outcome := 'ALLOWED';
            ELSE
                outcome := 'BLOCKED';
                err := '0 rows returned (RLS filtered)';
            END IF;
        ELSE
            -- Function calls, INSERT, UPDATE, DELETE:
            -- ALWAYS execute inside a sub-block and ALWAYS roll back via sentinel!
            BEGIN
                EXECUTE v_clean_stmt;
                GET DIAGNOSTICS rows_affected = ROW_COUNT;
                RAISE EXCEPTION '__TEST_SENTINEL_ROLLBACK__';
            EXCEPTION
                WHEN OTHERS THEN
                    IF SQLERRM = '__TEST_SENTINEL_ROLLBACK__' THEN
                        IF v_clean_stmt ~* '^\s*(INSERT|UPDATE|DELETE)\s+' THEN
                            IF rows_affected > 0 THEN
                                outcome := 'ALLOWED';
                            ELSE
                                outcome := 'BLOCKED';
                                err := '0 rows affected (RLS filtered)';
                            END IF;
                        ELSE
                            outcome := 'ALLOWED';
                        END IF;
                    ELSE
                        err_state := SQLSTATE;
                        err := SQLERRM;
                        IF err_state = '42501' THEN
                            outcome := 'BLOCKED';
                        ELSE
                            outcome := 'RAISED';
                        END IF;
                    END IF;
            END;
        END IF;

        EXECUTE 'RESET ROLE';
    EXCEPTION WHEN OTHERS THEN
        EXECUTE 'RESET ROLE';
        err_state := SQLSTATE;
        err := SQLERRM;
        IF err_state = '42501' THEN
            outcome := 'BLOCKED';
        ELSE
            outcome := 'RAISED';
        END IF;
    END;

    PERFORM set_config('request.jwt.claims', '', true);
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 3. RUNNER HELPER: pg_temp.run_script
-- Runs multiple statements in ONE rolled-back sub-block, returning last statement's
-- outcome plus check_sql result run as postgres.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.run_script(
    p_uid UUID,
    p_stmts TEXT[],
    p_check_sql TEXT DEFAULT NULL
) RETURNS TABLE (
    outcome TEXT,
    err_state TEXT,
    err TEXT,
    check_result TEXT
) AS $$
DECLARE
    v_db_role TEXT;
    v_jwt_claims JSONB;
    v_stmt TEXT;
    v_rows INTEGER;
BEGIN
    outcome := 'BLOCKED';
    err_state := '00000';
    err := '';
    check_result := NULL;

    IF p_uid IS NULL THEN
        v_db_role := 'anon';
        v_jwt_claims := jsonb_build_object('role', 'anon');
    ELSE
        v_db_role := 'authenticated';
        v_jwt_claims := jsonb_build_object('sub', p_uid::TEXT, 'role', 'authenticated');
    END IF;

    -- Sub-block rolled back via sentinel
    BEGIN
        PERFORM set_config('request.jwt.claims', v_jwt_claims::TEXT, true);
        EXECUTE 'SET LOCAL ROLE ' || quote_ident(v_db_role);

        FOREACH v_stmt IN ARRAY p_stmts
        LOOP
            EXECUTE rtrim(v_stmt, '; ' || chr(10) || chr(13) || chr(9));
            GET DIAGNOSTICS v_rows = ROW_COUNT;
        END LOOP;

        -- Reset to postgres inside the same sub-transaction to run check_sql
        EXECUTE 'RESET ROLE';
        PERFORM set_config('request.jwt.claims', '', true);

        IF p_check_sql IS NOT NULL THEN
            EXECUTE p_check_sql INTO check_result;
        END IF;

        outcome := 'ALLOWED';
        err_state := '00000';
        err := '';

        RAISE EXCEPTION '__SCRIPT_SENTINEL_ROLLBACK__';
    EXCEPTION
        WHEN OTHERS THEN
            EXECUTE 'RESET ROLE';
            PERFORM set_config('request.jwt.claims', '', true);
            IF SQLERRM = '__SCRIPT_SENTINEL_ROLLBACK__' THEN
                -- Succeeded and rolled back
                NULL;
            ELSE
                err_state := SQLSTATE;
                err := SQLERRM;
                IF err_state = '42501' THEN
                    outcome := 'BLOCKED';
                ELSE
                    outcome := 'RAISED';
                END IF;
            END IF;
    END;

    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 4. ASSERTION LOGGER: pg_temp.log_result
-- ------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE pg_temp.log_result(
    p_cat TEXT,
    p_name TEXT,
    p_actor TEXT,
    p_tbl TEXT,
    p_op TEXT,
    p_expected TEXT,
    p_actual TEXT,
    p_err_state TEXT,
    p_err TEXT,
    p_is_known BOOLEAN DEFAULT FALSE,
    p_expected_err_substring TEXT DEFAULT NULL
) AS $$
DECLARE
    v_final_actual TEXT := p_actual;
    v_status TEXT;
    v_detail TEXT := '';
BEGIN
    -- Evaluate error matching according to Rule 2:
    IF p_expected_err_substring IS NOT NULL THEN
        IF p_err ILIKE '%' || p_expected_err_substring || '%' THEN
            v_final_actual := 'BLOCKED';
            v_detail := 'Expected error caught: ' || p_err;
        ELSIF p_actual = 'BLOCKED' THEN
            v_final_actual := 'BLOCKED';
            v_detail := 'Security block: ' || COALESCE(p_err, p_err_state);
        ELSE
            v_final_actual := 'TEST_ERROR';
            IF p_actual = 'ALLOWED' THEN
                v_detail := 'FAILED TO RAISE: Expected error containing "' || p_expected_err_substring || '" but statement succeeded';
            ELSE
                v_detail := 'ERROR MISMATCH: Expected "' || p_expected_err_substring || '" but got [' || p_err_state || '] ' || COALESCE(p_err, 'NONE');
            END IF;
        END IF;
    ELSIF p_actual = 'RAISED' THEN
        v_final_actual := 'TEST_ERROR';
        v_detail := 'TEST ERROR: Non-security error SQLSTATE ' || p_err_state || ': ' || p_err;
    END IF;

    -- Evaluate Known Accepted Gaps (Milestone 3)
    IF p_is_known THEN
        IF v_final_actual = 'BLOCKED' THEN
            v_status := 'PASS';
            v_detail := 'Secure outcome achieved (gap closed)';
        ELSIF v_final_actual = 'ALLOWED' THEN
            v_status := 'KNOWN';
            v_detail := 'KNOWN ACCEPTED GAP (Milestone 3)';
        ELSE
            v_status := 'FAIL';
            v_detail := 'TEST ERROR in known gap check: ' || p_err;
        END IF;
    ELSE
        -- Normal Tests
        IF v_final_actual = 'TEST_ERROR' THEN
            v_status := 'FAIL';
        ELSIF v_final_actual = p_expected THEN
            v_status := 'PASS';
            v_detail := 'Matched expected ' || p_expected || CASE WHEN p_err <> '' AND v_detail = '' THEN ' (' || p_err || ')' ELSE '' END;
        ELSE
            v_status := 'FAIL';
            v_detail := 'MISMATCH: Expected ' || p_expected || ' but got ' || v_final_actual || CASE WHEN p_err <> '' THEN ' (' || p_err || ')' ELSE '' END;
        END IF;
    END IF;

    INSERT INTO pg_temp.suite_results (cat, name, actor, tbl, op, expected, actual, status, err_state, err, detail)
    VALUES (p_cat, p_name, p_actor, p_tbl, p_op, p_expected, v_final_actual, v_status, p_err_state, p_err, v_detail);
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 5. EXPECTED-ACCESS MAP HELPER: pg_temp.get_expected_access
-- Maps (table, operation, actor) to 'ALLOWED' or 'BLOCKED' for own-pharmacy tests
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.get_expected_access(
    p_tbl TEXT,
    p_op TEXT,
    p_actor TEXT
) RETURNS TEXT AS $$
BEGIN
    IF p_actor = 'admin_a' THEN
        -- Special Cases for Admin A
        IF p_tbl = 'pharmacies' THEN
            -- pharmacies allows admin UPDATE only
            IF p_op IN ('SELECT', 'UPDATE') THEN RETURN 'ALLOWED'; ELSE RETURN 'BLOCKED'; END IF;
        ELSIF p_tbl = 'sales' THEN
            -- sales has superadmin-only INSERT; admin can SELECT, UPDATE (known gap), DELETE
            IF p_op = 'INSERT' THEN RETURN 'BLOCKED'; ELSE RETURN 'ALLOWED'; END IF;
        ELSIF p_tbl IN ('sale_items', 'sale_payments', 'returns', 'return_items') THEN
            -- Superadmin-only INSERT; no UPDATE or DELETE policies
            IF p_op = 'SELECT' THEN RETURN 'ALLOWED'; ELSE RETURN 'BLOCKED'; END IF;
        ELSIF p_tbl = 'activity_logs' THEN
            -- activity_logs is INSERT-only (UPDATE and DELETE blocked)
            IF p_op IN ('SELECT', 'INSERT') THEN RETURN 'ALLOWED'; ELSE RETURN 'BLOCKED'; END IF;
        ELSIF p_tbl = 'subscription_inquiries' THEN
            -- subscription_inquiries allows SELECT, INSERT, UPDATE; no DELETE
            IF p_op = 'DELETE' THEN RETURN 'BLOCKED'; ELSE RETURN 'ALLOWED'; END IF;
        ELSIF p_tbl IN ('subscription_plans', 'platform_settings') THEN
            -- Platform tables: SELECT active/all allowed; writes superadmin only
            IF p_op = 'SELECT' THEN RETURN 'ALLOWED'; ELSE RETURN 'BLOCKED'; END IF;
        ELSE
            -- branches, app_users, categories, suppliers, medicines, batches, customers, prescriptions, settings:
            -- Admin A has full CRUD (SELECT, INSERT, UPDATE, DELETE)
            RETURN 'ALLOWED';
        END IF;

    ELSIF p_actor = 'pharmacist_a' THEN
        -- Special Cases for Pharmacist A
        IF p_tbl IN ('categories', 'suppliers', 'medicines', 'batches', 'settings', 'branches', 'pharmacies', 'app_users') THEN
            -- Read-only access for staff
            IF p_op = 'SELECT' THEN RETURN 'ALLOWED'; ELSE RETURN 'BLOCKED'; END IF;
        ELSIF p_tbl IN ('customers', 'prescriptions') THEN
            -- customers and prescriptions are writable by pharmacists only in their own branch: full CRUD
            RETURN 'ALLOWED';
        ELSIF p_tbl = 'sales' THEN
            -- Pharmacist can read own-branch sales; cannot INSERT, UPDATE, DELETE
            IF p_op = 'SELECT' THEN RETURN 'ALLOWED'; ELSE RETURN 'BLOCKED'; END IF;
        ELSIF p_tbl IN ('sale_items', 'sale_payments', 'returns', 'return_items') THEN
            -- Pharmacist can read own-pharmacy line items; cannot write
            IF p_op = 'SELECT' THEN RETURN 'ALLOWED'; ELSE RETURN 'BLOCKED'; END IF;
        ELSIF p_tbl = 'activity_logs' THEN
            -- activity_logs is INSERT-only; admin-only read
            IF p_op = 'INSERT' THEN RETURN 'ALLOWED'; ELSE RETURN 'BLOCKED'; END IF;
        ELSIF p_tbl = 'subscription_inquiries' THEN
            -- subscription_inquiries allows SELECT, INSERT, UPDATE for any member; no DELETE
            IF p_op = 'DELETE' THEN RETURN 'BLOCKED'; ELSE RETURN 'ALLOWED'; END IF;
        ELSIF p_tbl IN ('subscription_plans', 'platform_settings') THEN
            -- Platform tables: SELECT active/all allowed; writes superadmin only
            IF p_op = 'SELECT' THEN RETURN 'ALLOWED'; ELSE RETURN 'BLOCKED'; END IF;
        ELSE
            RETURN 'BLOCKED';
        END IF;
    END IF;

    RETURN 'BLOCKED';
END;
$$ LANGUAGE plpgsql;


-- ------------------------------------------------------------------------------
-- 6. MAIN TEST SUITE (DO BLOCK)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_verbose BOOLEAN := FALSE; -- Toggle to TRUE for line-by-line test execution log

    -- Fixture IDs
    v_pharm_a UUID := gen_random_uuid();
    v_pharm_b UUID := gen_random_uuid();
    v_branch_a1 UUID := gen_random_uuid();
    v_branch_a2 UUID := gen_random_uuid();
    v_branch_b1 UUID := gen_random_uuid();

    v_admin_a UUID := gen_random_uuid();
    v_pharmacist_a UUID := gen_random_uuid();
    v_admin_b UUID := gen_random_uuid();
    v_pharmacist_b UUID := gen_random_uuid();
    v_superadmin UUID := gen_random_uuid();

    v_new_auth_a UUID := gen_random_uuid();
    v_new_auth_b UUID := gen_random_uuid();

    -- Table fixture IDs
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

    -- Disposable fixtures for DELETE positive controls (prevent 23503 FK errors)
    v_branch_a_del UUID := gen_random_uuid();
    v_user_a_del UUID := gen_random_uuid();
    v_cat_a_del UUID := gen_random_uuid();
    v_supp_a_del UUID := gen_random_uuid();
    v_med_a_del UUID := gen_random_uuid();
    v_batch_a_del UUID := gen_random_uuid();
    v_cust_a_del UUID := gen_random_uuid();
    v_rx_a_del UUID := gen_random_uuid();
    v_sale_a_del UUID := gen_random_uuid();
    v_setting_a_del UUID := gen_random_uuid();

    -- Reporting & Loop variables
    v_total INTEGER := 0;
    v_passed INTEGER := 0;
    v_failed INTEGER := 0;
    v_known INTEGER := 0;

    v_report TEXT := '';
    v_matrix_line TEXT;
    v_rec RECORD;
    v_item RECORD;

    v_outcome TEXT;
    v_err_state TEXT;
    v_err TEXT;
    v_rows INTEGER;
    v_script_res RECORD;

    -- 19 Public Tables List
    v_all_tables TEXT[] := ARRAY[
        'pharmacies', 'branches', 'app_users', 'categories', 'suppliers',
        'medicines', 'batches', 'customers', 'prescriptions', 'sales',
        'sale_items', 'sale_payments', 'returns', 'return_items', 'activity_logs',
        'settings', 'subscription_inquiries', 'subscription_plans', 'platform_settings'
    ];
    v_tbl TEXT;
    v_op TEXT;
    v_actor_label TEXT;
    v_actor_uid UUID;

    -- Matrix table metadata
    v_target_b_id TEXT;
    v_stmt_select_b TEXT;
    v_stmt_insert_b TEXT;
    v_stmt_update_b TEXT;
    v_stmt_delete_b TEXT;

    -- Positive controls statements
    v_stmt_select_a TEXT;
    v_stmt_insert_a TEXT;
    v_stmt_update_a TEXT;
    v_stmt_delete_a TEXT;
    v_target_stmt TEXT;
    v_is_read BOOLEAN;
    v_expected_pos TEXT;

BEGIN
    -- ==========================================================================
    -- 0. FIXTURES CREATION (AS POSTGRES)
    -- ==========================================================================

    -- 0.1 Pharmacies
    INSERT INTO public.pharmacies (id, name, slug, plan_tier, subscription_status, max_branches, max_users, is_active)
    VALUES 
        (v_pharm_a, 'Pharmacy A Test', 'pharm-a-' || substr(v_pharm_a::TEXT, 1, 8), 'starter', 'active', 5, 10, true),
        (v_pharm_b, 'Pharmacy B Test', 'pharm-b-' || substr(v_pharm_b::TEXT, 1, 8), 'starter', 'active', 5, 10, true);

    -- 0.2 Branches
    INSERT INTO public.branches (id, pharmacy_id, name, is_main_branch)
    VALUES 
        (v_branch_a1, v_pharm_a, 'Branch A1 Main', true),
        (v_branch_a2, v_pharm_a, 'Branch A2 Secondary', false),
        (v_branch_b1, v_pharm_b, 'Branch B1 Main', true),
        (v_branch_a_del, v_pharm_a, 'Branch A Del', false);

    -- 0.3 Auth Users & App Users
    INSERT INTO auth.users (id, email)
    VALUES 
        (v_admin_a, 'admin_a@pharmacore.local'),
        (v_pharmacist_a, 'pharmacist_a@pharmacore.local'),
        (v_admin_b, 'admin_b@pharmacore.local'),
        (v_pharmacist_b, 'pharmacist_b@pharmacore.local'),
        (v_superadmin, 'superadmin@pharmacore.local'),
        (v_new_auth_a, 'new_staff_a@pharmacore.local'),
        (v_new_auth_b, 'new_staff_b@pharmacore.local'),
        (v_user_a_del, 'del_user_a@pharmacore.local');

    INSERT INTO public.app_users (id, pharmacy_id, branch_id, username, display_name, role, can_view_all_branches, must_change_password)
    VALUES 
        (v_admin_a, v_pharm_a, v_branch_a1, 'admin_a_' || substr(v_admin_a::TEXT, 1, 6), 'Admin A', 'admin', true, false),
        (v_pharmacist_a, v_pharm_a, v_branch_a1, 'pharm_a_' || substr(v_pharmacist_a::TEXT, 1, 6), 'Pharmacist A', 'pharmacist', false, false),
        (v_admin_b, v_pharm_b, v_branch_b1, 'admin_b_' || substr(v_admin_b::TEXT, 1, 6), 'Admin B', 'admin', true, false),
        (v_pharmacist_b, v_pharm_b, v_branch_b1, 'pharm_b_' || substr(v_pharmacist_b::TEXT, 1, 6), 'Pharmacist B', 'pharmacist', false, false),
        (v_superadmin, NULL, NULL, 'super_' || substr(v_superadmin::TEXT, 1, 6), 'Super Admin', 'superadmin', true, false),
        (v_user_a_del, v_pharm_a, v_branch_a1, 'del_a_' || substr(v_user_a_del::TEXT, 1, 6), 'Del Staff A', 'pharmacist', false, false);

    -- 0.4 Categories & Suppliers
    INSERT INTO public.categories (id, pharmacy_id, name)
    VALUES 
        (v_cat_a, v_pharm_a, 'Cat A'),
        (v_cat_b, v_pharm_b, 'Cat B'),
        (v_cat_a_del, v_pharm_a, 'Cat A Del');

    INSERT INTO public.suppliers (id, pharmacy_id, name)
    VALUES 
        (v_supp_a, v_pharm_a, 'Supp A'),
        (v_supp_b, v_pharm_b, 'Supp B'),
        (v_supp_a_del, v_pharm_a, 'Supp A Del');

    -- 0.5 Medicines & Batches
    INSERT INTO public.medicines (id, pharmacy_id, name, prescription_required, is_active)
    VALUES 
        (v_med_a_otc, v_pharm_a, 'Panadol OTC A', false, true),
        (v_med_a_rx, v_pharm_a, 'Xanax Rx A', true, true),
        (v_med_b_otc, v_pharm_b, 'Panadol OTC B', false, true),
        (v_med_b_rx, v_pharm_b, 'Xanax Rx B', true, true),
        (v_med_a_del, v_pharm_a, 'Med A Del', false, true);

    INSERT INTO public.batches (id, pharmacy_id, medicine_id, batch_number, quantity_in_stock, selling_price, branch_id)
    VALUES 
        (v_batch_a_otc, v_pharm_a, v_med_a_otc, 'BATCH-A-OTC', 100, 20, v_branch_a1),
        (v_batch_a_rx, v_pharm_a, v_med_a_rx, 'BATCH-A-RX', 100, 100, v_branch_a1),
        (v_batch_b_otc, v_pharm_b, v_med_b_otc, 'BATCH-B-OTC', 100, 20, v_branch_b1),
        (v_batch_b_rx, v_pharm_b, v_med_b_rx, 'BATCH-B-RX', 100, 100, v_branch_b1),
        (v_batch_a_del, v_pharm_a, v_med_a_otc, 'BATCH-A-DEL', 10, 20, v_branch_a1);

    -- 0.6 Customers & Prescriptions
    INSERT INTO public.customers (id, pharmacy_id, branch_id, full_name, phone)
    VALUES 
        (v_cust_a1, v_pharm_a, v_branch_a1, 'Patient A1', '03001111111'),
        (v_cust_a2, v_pharm_a, v_branch_a2, 'Patient A2', '03002222222'),
        (v_cust_b, v_pharm_b, v_branch_b1, 'Patient B', '03003333333'),
        (v_cust_a_del, v_pharm_a, v_branch_a1, 'Patient A Del', '03004444444');

    INSERT INTO public.prescriptions (id, pharmacy_id, branch_id, customer_id, prescriber_name, prescription_date, status)
    VALUES 
        (v_rx_a1, v_pharm_a, v_branch_a1, v_cust_a1, 'Dr. Alpha 1', CURRENT_DATE, 'verified'),
        (v_rx_a2, v_pharm_a, v_branch_a2, v_cust_a2, 'Dr. Alpha 2', CURRENT_DATE, 'verified'),
        (v_rx_b, v_pharm_b, v_branch_b1, v_cust_b, 'Dr. Beta', CURRENT_DATE, 'verified'),
        (v_rx_a_del, v_pharm_a, v_branch_a1, v_cust_a1, 'Dr. Alpha Del', CURRENT_DATE, 'verified');

    -- 0.7 Sales, Line Items & Payments
    INSERT INTO public.sales (id, pharmacy_id, branch_id, subtotal, total_amount, payment_method)
    VALUES 
        (v_sale_a1, v_pharm_a, v_branch_a1, 40, 40, 'cash'),
        (v_sale_a2, v_pharm_a, v_branch_a2, 200, 200, 'cash'),
        (v_sale_b, v_pharm_b, v_branch_b1, 40, 40, 'cash'),
        (v_sale_a_del, v_pharm_a, v_branch_a1, 10, 10, 'cash');

    INSERT INTO public.sale_items (id, pharmacy_id, sale_id, medicine_id, batch_id, quantity, price_at_sale, subtotal_item, branch_id)
    VALUES 
        (v_sale_item_a1, v_pharm_a, v_sale_a1, v_med_a_otc, v_batch_a_otc, 2, 20, 40, v_branch_a1),
        (v_sale_item_b, v_pharm_b, v_sale_b, v_med_b_otc, v_batch_b_otc, 2, 20, 40, v_branch_b1);

    INSERT INTO public.sale_payments (id, pharmacy_id, sale_id, method, amount)
    VALUES 
        (v_sale_pay_a1, v_pharm_a, v_sale_a1, 'cash', 40),
        (v_sale_pay_b, v_pharm_b, v_sale_b, 'cash', 40);

    -- 0.8 Returns & Return Items
    INSERT INTO public.returns (id, pharmacy_id, branch_id, sale_id, refund_method, total_refund_amount, status)
    VALUES 
        (v_ret_a, v_pharm_a, v_branch_a1, v_sale_a1, 'Cash', 20, 'pending'),
        (v_ret_b, v_pharm_b, v_branch_b1, v_sale_b, 'Cash', 20, 'pending');

    INSERT INTO public.return_items (id, pharmacy_id, return_id, sale_item_id, medicine_id, batch_id, quantity, reason, condition, branch_id)
    VALUES 
        (v_ret_item_a, v_pharm_a, v_ret_a, v_sale_item_a1, v_med_a_otc, v_batch_a_otc, 1, 'Wrong item given', 'unopened', v_branch_a1),
        (v_ret_item_b, v_pharm_b, v_ret_b, v_sale_item_b, v_med_b_otc, v_batch_b_otc, 1, 'Wrong item given', 'unopened', v_branch_b1);

    -- 0.9 Activity Logs, Settings & Inquiries
    INSERT INTO public.activity_logs (id, pharmacy_id, branch_id, user_id, action)
    VALUES 
        (v_log_a, v_pharm_a, v_branch_a1, v_admin_a, 'login'),
        (v_log_b, v_pharm_b, v_branch_b1, v_admin_b, 'login');

    INSERT INTO public.settings (id, pharmacy_id, branch_id, key, value)
    VALUES 
        (v_setting_a, v_pharm_a, v_branch_a1, 'receipt_header', '{"text": "Pharmacy A"}'),
        (v_setting_b, v_pharm_b, v_branch_b1, 'receipt_header', '{"text": "Pharmacy B"}'),
        (v_setting_a_del, v_pharm_a, v_branch_a1, 'del_setting', '{"text": "Del"}');

    INSERT INTO public.subscription_inquiries (id, pharmacy_id, sender_id, sender_name, sender_role, message)
    VALUES 
        (v_inq_a, v_pharm_a, v_admin_a, 'Admin A', 'admin', 'Inquiry A'),
        (v_inq_b, v_pharm_b, v_admin_b, 'Admin B', 'admin', 'Inquiry B');

    -- 0.10 Platform Tables
    INSERT INTO public.subscription_plans (id, name, slug, price_monthly, is_active)
    VALUES 
        (v_plan_active, 'Plan Active', 'plan-act-' || substr(v_plan_active::TEXT, 1, 6), 5000, true),
        (v_plan_inactive, 'Plan Inactive', 'plan-inact-' || substr(v_plan_inactive::TEXT, 1, 6), 9000, false);

    INSERT INTO public.platform_settings (key, value)
    VALUES 
        ('platform_identity', '{"platform_name": "PharmaCore Test"}'::JSONB),
        ('security_policy_test', '{"mfa_required": true}'::JSONB)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;


    -- ==========================================================================
    -- 1. CROSS-TENANT MATRIX (TABLE-DRIVEN: 19 tables x 4 ops x 2 actors = 152)
    -- ==========================================================================
    FOR v_tbl IN SELECT unnest(v_all_tables)
    LOOP
        -- Define table-specific Pharmacy B target queries and templates
        IF v_tbl = 'pharmacies' THEN
            v_target_b_id := v_pharm_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.pharmacies WHERE id = ''' || v_pharm_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.pharmacies (name, slug) VALUES (''Hack'', ''hack-slug-' || substr(gen_random_uuid()::TEXT, 1, 6) || ''')';
            v_stmt_update_b := 'UPDATE public.pharmacies SET name = ''Hack'' WHERE id = ''' || v_pharm_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.pharmacies WHERE id = ''' || v_pharm_b || '''';
        ELSIF v_tbl = 'branches' THEN
            v_target_b_id := v_branch_b1::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.branches WHERE id = ''' || v_branch_b1 || '''';
            v_stmt_insert_b := 'INSERT INTO public.branches (pharmacy_id, name) VALUES (''' || v_pharm_b || ''', ''Hack Branch'')';
            v_stmt_update_b := 'UPDATE public.branches SET name = ''Hack'' WHERE id = ''' || v_branch_b1 || '''';
            v_stmt_delete_b := 'DELETE FROM public.branches WHERE id = ''' || v_branch_b1 || '''';
        ELSIF v_tbl = 'app_users' THEN
            v_target_b_id := v_pharmacist_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.app_users WHERE id = ''' || v_pharmacist_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.app_users (id, pharmacy_id, branch_id, username, role) VALUES (''' || v_new_auth_b || ''', ''' || v_pharm_b || ''', ''' || v_branch_b1 || ''', ''u_' || substr(gen_random_uuid()::TEXT, 1, 6) || ''', ''pharmacist'')';
            v_stmt_update_b := 'UPDATE public.app_users SET display_name = ''Hack'' WHERE id = ''' || v_pharmacist_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.app_users WHERE id = ''' || v_pharmacist_b || '''';
        ELSIF v_tbl = 'categories' THEN
            v_target_b_id := v_cat_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.categories WHERE id = ''' || v_cat_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.categories (pharmacy_id, name) VALUES (''' || v_pharm_b || ''', ''Hack Cat'')';
            v_stmt_update_b := 'UPDATE public.categories SET name = ''Hack'' WHERE id = ''' || v_cat_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.categories WHERE id = ''' || v_cat_b || '''';
        ELSIF v_tbl = 'suppliers' THEN
            v_target_b_id := v_supp_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.suppliers WHERE id = ''' || v_supp_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.suppliers (pharmacy_id, name) VALUES (''' || v_pharm_b || ''', ''Hack Supp'')';
            v_stmt_update_b := 'UPDATE public.suppliers SET name = ''Hack'' WHERE id = ''' || v_supp_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.suppliers WHERE id = ''' || v_supp_b || '''';
        ELSIF v_tbl = 'medicines' THEN
            v_target_b_id := v_med_b_otc::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.medicines WHERE id = ''' || v_med_b_otc || '''';
            v_stmt_insert_b := 'INSERT INTO public.medicines (pharmacy_id, name) VALUES (''' || v_pharm_b || ''', ''Hack Med'')';
            v_stmt_update_b := 'UPDATE public.medicines SET name = ''Hack'' WHERE id = ''' || v_med_b_otc || '''';
            v_stmt_delete_b := 'DELETE FROM public.medicines WHERE id = ''' || v_med_b_otc || '''';
        ELSIF v_tbl = 'batches' THEN
            v_target_b_id := v_batch_b_otc::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.batches WHERE id = ''' || v_batch_b_otc || '''';
            v_stmt_insert_b := 'INSERT INTO public.batches (pharmacy_id, medicine_id, batch_number) VALUES (''' || v_pharm_b || ''', ''' || v_med_b_otc || ''', ''B-HACK'')';
            v_stmt_update_b := 'UPDATE public.batches SET batch_number = ''Hack'' WHERE id = ''' || v_batch_b_otc || '''';
            v_stmt_delete_b := 'DELETE FROM public.batches WHERE id = ''' || v_batch_b_otc || '''';
        ELSIF v_tbl = 'customers' THEN
            v_target_b_id := v_cust_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.customers WHERE id = ''' || v_cust_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.customers (pharmacy_id, full_name) VALUES (''' || v_pharm_b || ''', ''Hack Cust'')';
            v_stmt_update_b := 'UPDATE public.customers SET full_name = ''Hack'' WHERE id = ''' || v_cust_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.customers WHERE id = ''' || v_cust_b || '''';
        ELSIF v_tbl = 'prescriptions' THEN
            v_target_b_id := v_rx_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.prescriptions WHERE id = ''' || v_rx_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.prescriptions (pharmacy_id, customer_id, prescriber_name, prescription_date) VALUES (''' || v_pharm_b || ''', ''' || v_cust_b || ''', ''Dr'', CURRENT_DATE)';
            v_stmt_update_b := 'UPDATE public.prescriptions SET prescriber_name = ''Hack'' WHERE id = ''' || v_rx_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.prescriptions WHERE id = ''' || v_rx_b || '''';
        ELSIF v_tbl = 'sales' THEN
            v_target_b_id := v_sale_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.sales WHERE id = ''' || v_sale_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.sales (pharmacy_id, subtotal, total_amount) VALUES (''' || v_pharm_b || ''', 10, 10)';
            v_stmt_update_b := 'UPDATE public.sales SET notes = ''Hack'' WHERE id = ''' || v_sale_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.sales WHERE id = ''' || v_sale_b || '''';
        ELSIF v_tbl = 'sale_items' THEN
            v_target_b_id := v_sale_item_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.sale_items WHERE id = ''' || v_sale_item_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.sale_items (pharmacy_id, sale_id, price_at_sale, subtotal_item) VALUES (''' || v_pharm_b || ''', ''' || v_sale_b || ''', 10, 10)';
            v_stmt_update_b := 'UPDATE public.sale_items SET price_at_sale = 99 WHERE id = ''' || v_sale_item_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.sale_items WHERE id = ''' || v_sale_item_b || '''';
        ELSIF v_tbl = 'sale_payments' THEN
            v_target_b_id := v_sale_pay_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.sale_payments WHERE id = ''' || v_sale_pay_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.sale_payments (pharmacy_id, sale_id, method, amount) VALUES (''' || v_pharm_b || ''', ''' || v_sale_b || ''', ''cash'', 10)';
            v_stmt_update_b := 'UPDATE public.sale_payments SET amount = 99 WHERE id = ''' || v_sale_pay_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.sale_payments WHERE id = ''' || v_sale_pay_b || '''';
        ELSIF v_tbl = 'returns' THEN
            v_target_b_id := v_ret_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.returns WHERE id = ''' || v_ret_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.returns (pharmacy_id, refund_method, status) VALUES (''' || v_pharm_b || ''', ''Cash'', ''pending'')';
            v_stmt_update_b := 'UPDATE public.returns SET refund_method = ''Store Credit'' WHERE id = ''' || v_ret_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.returns WHERE id = ''' || v_ret_b || '''';
        ELSIF v_tbl = 'return_items' THEN
            v_target_b_id := v_ret_item_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.return_items WHERE id = ''' || v_ret_item_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.return_items (pharmacy_id, return_id, quantity, reason, condition) VALUES (''' || v_pharm_b || ''', ''' || v_ret_b || ''', 1, ''Reason'', ''unopened'')';
            v_stmt_update_b := 'UPDATE public.return_items SET quantity = 99 WHERE id = ''' || v_ret_item_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.return_items WHERE id = ''' || v_ret_item_b || '''';
        ELSIF v_tbl = 'activity_logs' THEN
            v_target_b_id := v_log_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.activity_logs WHERE id = ''' || v_log_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.activity_logs (pharmacy_id, action) VALUES (''' || v_pharm_b || ''', ''Hack'')';
            v_stmt_update_b := 'UPDATE public.activity_logs SET action = ''Hack'' WHERE id = ''' || v_log_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.activity_logs WHERE id = ''' || v_log_b || '''';
        ELSIF v_tbl = 'settings' THEN
            v_target_b_id := v_setting_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.settings WHERE id = ''' || v_setting_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.settings (pharmacy_id, key, value) VALUES (''' || v_pharm_b || ''', ''hack_k'', ''{}'')';
            v_stmt_update_b := 'UPDATE public.settings SET value = ''{}'' WHERE id = ''' || v_setting_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.settings WHERE id = ''' || v_setting_b || '''';
        ELSIF v_tbl = 'subscription_inquiries' THEN
            v_target_b_id := v_inq_b::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.subscription_inquiries WHERE id = ''' || v_inq_b || '''';
            v_stmt_insert_b := 'INSERT INTO public.subscription_inquiries (pharmacy_id, sender_name, sender_role, message) VALUES (''' || v_pharm_b || ''', ''H'', ''admin'', ''Hack'')';
            v_stmt_update_b := 'UPDATE public.subscription_inquiries SET message = ''Hack'' WHERE id = ''' || v_inq_b || '''';
            v_stmt_delete_b := 'DELETE FROM public.subscription_inquiries WHERE id = ''' || v_inq_b || '''';
        ELSIF v_tbl = 'subscription_plans' THEN
            v_target_b_id := v_plan_inactive::TEXT;
            v_stmt_select_b := 'SELECT id FROM public.subscription_plans WHERE id = ''' || v_plan_inactive || '''';
            v_stmt_insert_b := 'INSERT INTO public.subscription_plans (name, slug) VALUES (''Hack'', ''hack-p'')';
            v_stmt_update_b := 'UPDATE public.subscription_plans SET name = ''Hack'' WHERE id = ''' || v_plan_active || '''';
            v_stmt_delete_b := 'DELETE FROM public.subscription_plans WHERE id = ''' || v_plan_active || '''';
        ELSIF v_tbl = 'platform_settings' THEN
            v_target_b_id := 'security_policy_test';
            v_stmt_select_b := 'SELECT key FROM public.platform_settings WHERE key = ''security_policy_test''';
            v_stmt_insert_b := 'INSERT INTO public.platform_settings (key, value) VALUES (''hack_k'', ''{}'')';
            v_stmt_update_b := 'UPDATE public.platform_settings SET value = ''{}'' WHERE key = ''platform_identity''';
            v_stmt_delete_b := 'DELETE FROM public.platform_settings WHERE key = ''platform_identity''';
        END IF;

        -- Loop actors: admin_a and pharmacist_a
        FOR v_actor_label, v_actor_uid IN 
            SELECT 'admin_a', v_admin_a UNION ALL SELECT 'pharmacist_a', v_pharmacist_a
        LOOP
            -- SELECT
            -- Authenticated users CAN read all platform_settings keys by design (they hold no secrets).
            -- Anon stays blocked except for the platform_identity key.
            IF v_tbl = 'platform_settings' THEN
                SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_actor_uid, v_stmt_select_b, true);
                CALL pg_temp.log_result('1. Cross-Tenant', v_tbl || ' SELECT authenticated', v_actor_label, v_tbl, 'SELECT', 'ALLOWED', v_outcome, v_err_state, v_err);
            ELSE
                SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_actor_uid, v_stmt_select_b, true);
                CALL pg_temp.log_result('1. Cross-Tenant', v_tbl || ' SELECT cross-tenant', v_actor_label, v_tbl, 'SELECT', 'BLOCKED', v_outcome, v_err_state, v_err);
            END IF;

            -- INSERT
            SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_actor_uid, v_stmt_insert_b, false);
            CALL pg_temp.log_result('1. Cross-Tenant', v_tbl || ' INSERT cross-tenant', v_actor_label, v_tbl, 'INSERT', 'BLOCKED', v_outcome, v_err_state, v_err, false, CASE WHEN v_tbl = 'app_users' THEN 'Cannot create user for another pharmacy' ELSE NULL END);

            -- UPDATE
            SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_actor_uid, v_stmt_update_b, false);
            CALL pg_temp.log_result('1. Cross-Tenant', v_tbl || ' UPDATE cross-tenant', v_actor_label, v_tbl, 'UPDATE', 'BLOCKED', v_outcome, v_err_state, v_err);

            -- DELETE
            SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_actor_uid, v_stmt_delete_b, false);
            CALL pg_temp.log_result('1. Cross-Tenant', v_tbl || ' DELETE cross-tenant', v_actor_label, v_tbl, 'DELETE', 'BLOCKED', v_outcome, v_err_state, v_err);
        END LOOP;
    END LOOP;


    -- ==========================================================================
    -- 2. POSITIVE CONTROLS (OWN-PHARMACY TABLE-DRIVEN MATRIX)
    -- ==========================================================================
    -- EXPECTED-ACCESS MAP FOR OWN PHARMACY (POSITIVE CONTROLS):
    -- Table                  | Admin A (S, I, U, D)               | Pharmacist A (S, I, U, D)
    -- -----------------------+------------------------------------+--------------------------
    -- pharmacies             | ALLOWED, BLOCKED, ALLOWED, BLOCKED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- branches               | ALLOWED, ALLOWED, ALLOWED, ALLOWED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- app_users              | ALLOWED, ALLOWED, ALLOWED, ALLOWED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- categories             | ALLOWED, ALLOWED, ALLOWED, ALLOWED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- suppliers              | ALLOWED, ALLOWED, ALLOWED, ALLOWED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- medicines              | ALLOWED, ALLOWED, ALLOWED, ALLOWED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- batches                | ALLOWED, ALLOWED, ALLOWED, ALLOWED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- customers              | ALLOWED, ALLOWED, ALLOWED, ALLOWED | ALLOWED, ALLOWED, ALLOWED, ALLOWED
    -- prescriptions          | ALLOWED, ALLOWED, ALLOWED, ALLOWED | ALLOWED, ALLOWED, ALLOWED, ALLOWED
    -- sales                  | ALLOWED, BLOCKED, ALLOWED, ALLOWED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- sale_items             | ALLOWED, BLOCKED, BLOCKED, BLOCKED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- sale_payments          | ALLOWED, BLOCKED, BLOCKED, BLOCKED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- returns                | ALLOWED, BLOCKED, BLOCKED, BLOCKED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- return_items           | ALLOWED, BLOCKED, BLOCKED, BLOCKED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- activity_logs          | ALLOWED, ALLOWED, BLOCKED, BLOCKED | BLOCKED, ALLOWED, BLOCKED, BLOCKED
    -- settings               | ALLOWED, ALLOWED, ALLOWED, ALLOWED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- subscription_inquiries | ALLOWED, ALLOWED, ALLOWED, BLOCKED | ALLOWED, ALLOWED, ALLOWED, BLOCKED
    -- subscription_plans     | ALLOWED, BLOCKED, BLOCKED, BLOCKED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- platform_settings      | ALLOWED, BLOCKED, BLOCKED, BLOCKED | ALLOWED, BLOCKED, BLOCKED, BLOCKED
    -- --------------------------------------------------------------------------
    FOR v_tbl IN SELECT unnest(v_all_tables)
    LOOP
        -- Define Pharmacy A own-pharmacy/own-branch statements with matching shapes
        IF v_tbl = 'pharmacies' THEN
            v_stmt_select_a := 'SELECT id FROM public.pharmacies WHERE id = ''' || v_pharm_a || '''';
            v_stmt_insert_a := 'INSERT INTO public.pharmacies (name, slug) VALUES (''Own Pharm'', ''own-slug-' || substr(gen_random_uuid()::TEXT, 1, 6) || ''')';
            v_stmt_update_a := 'UPDATE public.pharmacies SET name = ''Valid Rename'' WHERE id = ''' || v_pharm_a || '''';
            v_stmt_delete_a := 'DELETE FROM public.pharmacies WHERE id = ''' || v_pharm_a || '''';
        ELSIF v_tbl = 'branches' THEN
            v_stmt_select_a := 'SELECT id FROM public.branches WHERE id = ''' || v_branch_a1 || '''';
            v_stmt_insert_a := 'INSERT INTO public.branches (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Branch A3 Added'')';
            v_stmt_update_a := 'UPDATE public.branches SET name = ''Branch A1 Updated'' WHERE id = ''' || v_branch_a1 || '''';
            v_stmt_delete_a := 'DELETE FROM public.branches WHERE id = ''' || v_branch_a_del || '''';
        ELSIF v_tbl = 'app_users' THEN
            v_stmt_select_a := 'SELECT id FROM public.app_users WHERE id = ''' || v_pharmacist_a || '''';
            v_stmt_insert_a := 'INSERT INTO public.app_users (id, pharmacy_id, branch_id, username, role) VALUES (''' || v_new_auth_a || ''', ''' || v_pharm_a || ''', ''' || v_branch_a1 || ''', ''u_own_' || substr(gen_random_uuid()::TEXT, 1, 6) || ''', ''pharmacist'')';
            v_stmt_update_a := 'UPDATE public.app_users SET display_name = ''Updated Staff'' WHERE id = ''' || v_pharmacist_a || '''';
            v_stmt_delete_a := 'DELETE FROM public.app_users WHERE id = ''' || v_user_a_del || '''';
        ELSIF v_tbl = 'categories' THEN
            v_stmt_select_a := 'SELECT id FROM public.categories WHERE id = ''' || v_cat_a || '''';
            v_stmt_insert_a := 'INSERT INTO public.categories (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Cat A New'')';
            v_stmt_update_a := 'UPDATE public.categories SET name = ''Cat A Updated'' WHERE id = ''' || v_cat_a || '''';
            v_stmt_delete_a := 'DELETE FROM public.categories WHERE id = ''' || v_cat_a_del || '''';
        ELSIF v_tbl = 'suppliers' THEN
            v_stmt_select_a := 'SELECT id FROM public.suppliers WHERE id = ''' || v_supp_a || '''';
            v_stmt_insert_a := 'INSERT INTO public.suppliers (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Supp A New'')';
            v_stmt_update_a := 'UPDATE public.suppliers SET name = ''Supp A Updated'' WHERE id = ''' || v_supp_a || '''';
            v_stmt_delete_a := 'DELETE FROM public.suppliers WHERE id = ''' || v_supp_a_del || '''';
        ELSIF v_tbl = 'medicines' THEN
            v_stmt_select_a := 'SELECT id FROM public.medicines WHERE id = ''' || v_med_a_otc || '''';
            v_stmt_insert_a := 'INSERT INTO public.medicines (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Valid Med'')';
            v_stmt_update_a := 'UPDATE public.medicines SET name = ''Med Updated'' WHERE id = ''' || v_med_a_otc || '''';
            v_stmt_delete_a := 'DELETE FROM public.medicines WHERE id = ''' || v_med_a_del || '''';
        ELSIF v_tbl = 'batches' THEN
            v_stmt_select_a := 'SELECT id FROM public.batches WHERE id = ''' || v_batch_a_otc || '''';
            v_stmt_insert_a := 'INSERT INTO public.batches (pharmacy_id, medicine_id, batch_number) VALUES (''' || v_pharm_a || ''', ''' || v_med_a_otc || ''', ''B-OWN'')';
            v_stmt_update_a := 'UPDATE public.batches SET batch_number = ''B-UPDATED'' WHERE id = ''' || v_batch_a_otc || '''';
            v_stmt_delete_a := 'DELETE FROM public.batches WHERE id = ''' || v_batch_a_del || '''';
        ELSIF v_tbl = 'customers' THEN
            v_stmt_select_a := 'SELECT id FROM public.customers WHERE id = ''' || v_cust_a1 || '''';
            v_stmt_insert_a := 'INSERT INTO public.customers (pharmacy_id, branch_id, full_name) VALUES (''' || v_pharm_a || ''', ''' || v_branch_a1 || ''', ''Valid Cust'')';
            v_stmt_update_a := 'UPDATE public.customers SET full_name = ''Cust Updated'' WHERE id = ''' || v_cust_a1 || '''';
            v_stmt_delete_a := 'DELETE FROM public.customers WHERE id = ''' || v_cust_a_del || '''';
        ELSIF v_tbl = 'prescriptions' THEN
            v_stmt_select_a := 'SELECT id FROM public.prescriptions WHERE id = ''' || v_rx_a1 || '''';
            v_stmt_insert_a := 'INSERT INTO public.prescriptions (pharmacy_id, branch_id, customer_id, prescriber_name, prescription_date) VALUES (''' || v_pharm_a || ''', ''' || v_branch_a1 || ''', ''' || v_cust_a1 || ''', ''Dr. Valid'', CURRENT_DATE)';
            v_stmt_update_a := 'UPDATE public.prescriptions SET prescriber_name = ''Dr. Updated'' WHERE id = ''' || v_rx_a1 || '''';
            v_stmt_delete_a := 'DELETE FROM public.prescriptions WHERE id = ''' || v_rx_a_del || '''';
        ELSIF v_tbl = 'sales' THEN
            v_stmt_select_a := 'SELECT id FROM public.sales WHERE id = ''' || v_sale_a1 || '''';
            v_stmt_insert_a := 'INSERT INTO public.sales (pharmacy_id, branch_id, subtotal, total_amount) VALUES (''' || v_pharm_a || ''', ''' || v_branch_a1 || ''', 10, 10)';
            v_stmt_update_a := 'UPDATE public.sales SET notes = ''Valid Note'' WHERE id = ''' || v_sale_a1 || '''';
            v_stmt_delete_a := 'DELETE FROM public.sales WHERE id = ''' || v_sale_a_del || '''';
        ELSIF v_tbl = 'sale_items' THEN
            v_stmt_select_a := 'SELECT id FROM public.sale_items WHERE id = ''' || v_sale_item_a1 || '''';
            v_stmt_insert_a := 'INSERT INTO public.sale_items (pharmacy_id, sale_id, medicine_id, batch_id, price_at_sale, subtotal_item) VALUES (''' || v_pharm_a || ''', ''' || v_sale_a1 || ''', ''' || v_med_a_otc || ''', ''' || v_batch_a_otc || ''', 10, 10)';
            v_stmt_update_a := 'UPDATE public.sale_items SET price_at_sale = 99 WHERE id = ''' || v_sale_item_a1 || '''';
            v_stmt_delete_a := 'DELETE FROM public.sale_items WHERE id = ''' || v_sale_item_a1 || '''';
        ELSIF v_tbl = 'sale_payments' THEN
            v_stmt_select_a := 'SELECT id FROM public.sale_payments WHERE id = ''' || v_sale_pay_a1 || '''';
            v_stmt_insert_a := 'INSERT INTO public.sale_payments (pharmacy_id, sale_id, method, amount) VALUES (''' || v_pharm_a || ''', ''' || v_sale_a1 || ''', ''cash'', 10)';
            v_stmt_update_a := 'UPDATE public.sale_payments SET amount = 99 WHERE id = ''' || v_sale_pay_a1 || '''';
            v_stmt_delete_a := 'DELETE FROM public.sale_payments WHERE id = ''' || v_sale_pay_a1 || '''';
        ELSIF v_tbl = 'returns' THEN
            v_stmt_select_a := 'SELECT id FROM public.returns WHERE id = ''' || v_ret_a || '''';
            v_stmt_insert_a := 'INSERT INTO public.returns (pharmacy_id, refund_method, status) VALUES (''' || v_pharm_a || ''', ''Cash'', ''pending'')';
            v_stmt_update_a := 'UPDATE public.returns SET refund_method = ''Store Credit'' WHERE id = ''' || v_ret_a || '''';
            v_stmt_delete_a := 'DELETE FROM public.returns WHERE id = ''' || v_ret_a || '''';
        ELSIF v_tbl = 'return_items' THEN
            v_stmt_select_a := 'SELECT id FROM public.return_items WHERE id = ''' || v_ret_item_a || '''';
            v_stmt_insert_a := 'INSERT INTO public.return_items (pharmacy_id, return_id, quantity, reason, condition) VALUES (''' || v_pharm_a || ''', ''' || v_ret_a || ''', 1, ''Reason'', ''unopened'')';
            v_stmt_update_a := 'UPDATE public.return_items SET quantity = 99 WHERE id = ''' || v_ret_item_a || '''';
            v_stmt_delete_a := 'DELETE FROM public.return_items WHERE id = ''' || v_ret_item_a || '''';
        ELSIF v_tbl = 'activity_logs' THEN
            v_stmt_select_a := 'SELECT id FROM public.activity_logs WHERE id = ''' || v_log_a || '''';
            v_stmt_insert_a := 'INSERT INTO public.activity_logs (pharmacy_id, action) VALUES (''' || v_pharm_a || ''', ''Audit Note'')';
            v_stmt_update_a := 'UPDATE public.activity_logs SET action = ''Hack'' WHERE id = ''' || v_log_a || '''';
            v_stmt_delete_a := 'DELETE FROM public.activity_logs WHERE id = ''' || v_log_a || '''';
        ELSIF v_tbl = 'settings' THEN
            v_stmt_select_a := 'SELECT id FROM public.settings WHERE id = ''' || v_setting_a || '''';
            v_stmt_insert_a := 'INSERT INTO public.settings (pharmacy_id, key, value) VALUES (''' || v_pharm_a || ''', ''own_k'', ''{}'')';
            v_stmt_update_a := 'UPDATE public.settings SET value = ''{"updated": true}'' WHERE id = ''' || v_setting_a || '''';
            v_stmt_delete_a := 'DELETE FROM public.settings WHERE id = ''' || v_setting_a_del || '''';
        ELSIF v_tbl = 'subscription_inquiries' THEN
            v_stmt_select_a := 'SELECT id FROM public.subscription_inquiries WHERE id = ''' || v_inq_a || '''';
            v_stmt_insert_a := 'INSERT INTO public.subscription_inquiries (pharmacy_id, sender_name, sender_role, message) VALUES (''' || v_pharm_a || ''', ''Valid Sender'', ''admin'', ''Own Inq'')';
            v_stmt_update_a := 'UPDATE public.subscription_inquiries SET message = ''Updated Msg'' WHERE id = ''' || v_inq_a || '''';
            v_stmt_delete_a := 'DELETE FROM public.subscription_inquiries WHERE id = ''' || v_inq_a || '''';
        ELSIF v_tbl = 'subscription_plans' THEN
            v_stmt_select_a := 'SELECT id FROM public.subscription_plans WHERE id = ''' || v_plan_active || '''';
            v_stmt_insert_a := 'INSERT INTO public.subscription_plans (name, slug) VALUES (''Plan Own'', ''plan-own'')';
            v_stmt_update_a := 'UPDATE public.subscription_plans SET name = ''Plan Own Upd'' WHERE id = ''' || v_plan_active || '''';
            v_stmt_delete_a := 'DELETE FROM public.subscription_plans WHERE id = ''' || v_plan_active || '''';
        ELSIF v_tbl = 'platform_settings' THEN
            v_stmt_select_a := 'SELECT key FROM public.platform_settings WHERE key = ''platform_identity''';
            v_stmt_insert_a := 'INSERT INTO public.platform_settings (key, value) VALUES (''own_plat_k'', ''{}'')';
            v_stmt_update_a := 'UPDATE public.platform_settings SET value = ''{}'' WHERE key = ''platform_identity''';
            v_stmt_delete_a := 'DELETE FROM public.platform_settings WHERE key = ''platform_identity''';
        END IF;

        -- Loop actors: admin_a and pharmacist_a
        FOR v_actor_label, v_actor_uid IN 
            SELECT 'admin_a', v_admin_a UNION ALL SELECT 'pharmacist_a', v_pharmacist_a
        LOOP
            FOREACH v_op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
            LOOP
                IF v_op = 'SELECT' THEN
                    v_target_stmt := v_stmt_select_a;
                    v_is_read := TRUE;
                ELSIF v_op = 'INSERT' THEN
                    v_target_stmt := v_stmt_insert_a;
                    v_is_read := FALSE;
                ELSIF v_op = 'UPDATE' THEN
                    v_target_stmt := v_stmt_update_a;
                    v_is_read := FALSE;
                ELSIF v_op = 'DELETE' THEN
                    v_target_stmt := v_stmt_delete_a;
                    v_is_read := FALSE;
                END IF;

                v_expected_pos := pg_temp.get_expected_access(v_tbl, v_op, v_actor_label);

                SELECT * INTO v_outcome, v_err_state, v_err, v_rows 
                FROM pg_temp.run_statement(v_actor_uid, v_target_stmt, v_is_read);

                CALL pg_temp.log_result(
                    '2. Positive Controls',
                    v_tbl || ' ' || v_op || ' own pharmacy',
                    v_actor_label,
                    v_tbl,
                    v_op,
                    v_expected_pos,
                    v_outcome,
                    v_err_state,
                    v_err
                );
            END LOOP;
        END LOOP;
    END LOOP;


    -- ==========================================================================
    -- 3. COVERAGE GUARD (VERIFY ALL MATRIX CELLS WERE EXECUTED)
    -- ==========================================================================
    -- Check that every public table has RLS enabled
    FOR v_rec IN 
        SELECT c.relname, c.relrowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
    LOOP
        IF v_rec.relrowsecurity THEN
            CALL pg_temp.log_result('3. Coverage Guard', 'RLS enabled on ' || v_rec.relname, 'schema', v_rec.relname, 'RLS', 'ALLOWED', 'ALLOWED', '00000', '');
        ELSE
            CALL pg_temp.log_result('3. Coverage Guard', 'RLS enabled on ' || v_rec.relname, 'schema', v_rec.relname, 'RLS', 'ALLOWED', 'BLOCKED', '42501', 'RLS is disabled on ' || v_rec.relname);
        END IF;
    END LOOP;

    -- Fail if any table x operation x actor cell has no recorded result in cross-tenant matrix
    FOR v_tbl IN SELECT unnest(v_all_tables)
    LOOP
        FOREACH v_op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
        LOOP
            FOREACH v_actor_label IN ARRAY ARRAY['admin_a', 'pharmacist_a']
            LOOP
                IF NOT EXISTS (
                    SELECT 1 FROM pg_temp.suite_results 
                    WHERE cat = '1. Cross-Tenant' 
                      AND tbl = v_tbl 
                      AND op = v_op 
                      AND actor = v_actor_label
                ) THEN
                    CALL pg_temp.log_result('3. Coverage Guard', 'Matrix missing cell: ' || v_tbl || ' ' || v_op || ' ' || v_actor_label, v_actor_label, v_tbl, v_op, 'ALLOWED', 'BLOCKED', '00000', 'Missing execution in cross-tenant matrix');
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;


    -- ==========================================================================
    -- 4. BRANCH ISOLATION (PHARMACIST A1 VS BRANCH A2)
    -- ==========================================================================
    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_pharmacist_a, 'SELECT id FROM public.sales WHERE id = ''' || v_sale_a2 || '''', true);
    CALL pg_temp.log_result('4. Branch Isolation', 'pharmacist A1 cannot read Branch A2 sales', 'pharmacist_a', 'sales', 'SELECT', 'BLOCKED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_pharmacist_a, 'SELECT id FROM public.customers WHERE id = ''' || v_cust_a2 || '''', true);
    CALL pg_temp.log_result('4. Branch Isolation', 'pharmacist A1 cannot read Branch A2 customers', 'pharmacist_a', 'customers', 'SELECT', 'BLOCKED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_pharmacist_a, 'SELECT id FROM public.prescriptions WHERE id = ''' || v_rx_a2 || '''', true);
    CALL pg_temp.log_result('4. Branch Isolation', 'pharmacist A1 cannot read Branch A2 prescriptions', 'pharmacist_a', 'prescriptions', 'SELECT', 'BLOCKED', v_outcome, v_err_state, v_err);


    -- ==========================================================================
    -- 5. ROLE RULES: PHARMACIST CANNOT DO ADMIN-ONLY WRITES
    -- ==========================================================================
    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_pharmacist_a, 'UPDATE public.pharmacies SET name = ''Hack'' WHERE id = ''' || v_pharm_a || '''', false);
    CALL pg_temp.log_result('5. Role Rules', 'pharmacist cannot UPDATE pharmacies', 'pharmacist_a', 'pharmacies', 'UPDATE', 'BLOCKED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_pharmacist_a, 'INSERT INTO public.branches (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Hack'')', false);
    CALL pg_temp.log_result('5. Role Rules', 'pharmacist cannot INSERT branches', 'pharmacist_a', 'branches', 'INSERT', 'BLOCKED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_pharmacist_a, 'INSERT INTO public.medicines (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Hack'')', false);
    CALL pg_temp.log_result('5. Role Rules', 'pharmacist cannot INSERT medicines', 'pharmacist_a', 'medicines', 'INSERT', 'BLOCKED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_pharmacist_a, 'INSERT INTO public.batches (pharmacy_id, medicine_id, batch_number) VALUES (''' || v_pharm_a || ''', ''' || v_med_a_otc || ''', ''B-P'')', false);
    CALL pg_temp.log_result('5. Role Rules', 'pharmacist cannot INSERT batches', 'pharmacist_a', 'batches', 'INSERT', 'BLOCKED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_pharmacist_a, 'DELETE FROM public.sales WHERE id = ''' || v_sale_a1 || '''', false);
    CALL pg_temp.log_result('5. Role Rules', 'pharmacist cannot DELETE sales', 'pharmacist_a', 'sales', 'DELETE', 'BLOCKED', v_outcome, v_err_state, v_err);


    -- ==========================================================================
    -- 6. ANON LOCKDOWN
    -- ==========================================================================
    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(NULL, 'SELECT id FROM public.pharmacies', true);
    CALL pg_temp.log_result('6. Anon Lockdown', 'anon cannot SELECT pharmacies', 'anon', 'pharmacies', 'SELECT', 'BLOCKED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(NULL, 'SELECT id FROM public.medicines', true);
    CALL pg_temp.log_result('6. Anon Lockdown', 'anon cannot SELECT medicines', 'anon', 'medicines', 'SELECT', 'BLOCKED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(NULL, 'SELECT id FROM public.subscription_plans WHERE id = ''' || v_plan_active || '''', true);
    CALL pg_temp.log_result('6. Anon Lockdown', 'anon CAN SELECT active subscription_plans', 'anon', 'subscription_plans', 'SELECT', 'ALLOWED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(NULL, 'SELECT id FROM public.subscription_plans WHERE id = ''' || v_plan_inactive || '''', true);
    CALL pg_temp.log_result('6. Anon Lockdown', 'anon cannot SELECT inactive subscription_plans', 'anon', 'subscription_plans', 'SELECT', 'BLOCKED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(NULL, 'SELECT value FROM public.platform_settings WHERE key = ''platform_identity''', true);
    CALL pg_temp.log_result('6. Anon Lockdown', 'anon CAN SELECT platform_identity setting', 'anon', 'platform_settings', 'SELECT', 'ALLOWED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(NULL, 'SELECT value FROM public.platform_settings WHERE key = ''security_policy_test''', true);
    CALL pg_temp.log_result('6. Anon Lockdown', 'anon cannot SELECT security_policy setting', 'anon', 'platform_settings', 'SELECT', 'BLOCKED', v_outcome, v_err_state, v_err);


    -- ==========================================================================
    -- 7. CATALOG AUDIT (FUNCTION & TABLE GRANTS)
    -- ==========================================================================
    -- Catalog audit for functions: authenticated must have EXECUTE on exactly 11 functions.
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
        IF v_rec.anon_exec THEN
            CALL pg_temp.log_result('7. Catalog Audit', 'anon cannot EXECUTE ' || v_rec.proname, 'catalog', 'pg_proc', 'EXECUTE', 'BLOCKED', 'ALLOWED', '00000', 'Anon has EXECUTE on ' || v_rec.proname);
        ELSE
            CALL pg_temp.log_result('7. Catalog Audit', 'anon cannot EXECUTE ' || v_rec.proname, 'catalog', 'pg_proc', 'EXECUTE', 'BLOCKED', 'BLOCKED', '00000', '');
        END IF;

        IF v_rec.proname IN (
            'is_superadmin', 'is_admin', 'get_user_pharmacy_id', 'get_user_branch_id',
            'can_view_all_branches', 'process_sale', 'process_return', 'approve_return',
            'get_supplier_dashboard_stats', 'fn_clear_own_must_change_password',
            'get_platform_sales_revenue'
        ) THEN
            IF v_rec.auth_exec THEN
                CALL pg_temp.log_result('7. Catalog Audit', 'authenticated can EXECUTE ' || v_rec.proname, 'catalog', 'pg_proc', 'EXECUTE', 'ALLOWED', 'ALLOWED', '00000', '');
            ELSE
                CALL pg_temp.log_result('7. Catalog Audit', 'authenticated can EXECUTE ' || v_rec.proname, 'catalog', 'pg_proc', 'EXECUTE', 'ALLOWED', 'BLOCKED', '42501', 'Missing EXECUTE on ' || v_rec.proname);
            END IF;
        ELSE
            IF v_rec.auth_exec THEN
                CALL pg_temp.log_result('7. Catalog Audit', 'authenticated cannot EXECUTE ' || v_rec.proname, 'catalog', 'pg_proc', 'EXECUTE', 'BLOCKED', 'ALLOWED', '00000', 'Unexpected EXECUTE on ' || v_rec.proname);
            ELSE
                CALL pg_temp.log_result('7. Catalog Audit', 'authenticated cannot EXECUTE ' || v_rec.proname, 'catalog', 'pg_proc', 'EXECUTE', 'BLOCKED', 'BLOCKED', '00000', '');
            END IF;
        END IF;
    END LOOP;

    -- Authenticated must NEVER have TRUNCATE, REFERENCES, or TRIGGER anywhere
    FOR v_rec IN
        SELECT table_name, privilege_type
        FROM information_schema.role_table_grants
        WHERE grantee = 'authenticated' AND table_schema = 'public'
          AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
    LOOP
        CALL pg_temp.log_result('7. Catalog Audit', 'authenticated has no ' || v_rec.privilege_type || ' on ' || v_rec.table_name, 'catalog', v_rec.table_name, v_rec.privilege_type, 'BLOCKED', 'ALLOWED', '00000', 'Dangerous grant: ' || v_rec.privilege_type);
    END LOOP;


    -- ==========================================================================
    -- 8. SUPERADMIN & REGRESSION TESTS (PROMPT 1.5 FIXES)
    -- ==========================================================================
    -- Superadmin without pharmacy rejected by process_sale
    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(
        v_superadmin,
        'SELECT public.process_sale(gen_random_uuid(), ''[{"medicine_id": "' || v_med_a_otc || '", "batch_id": "' || v_batch_a_otc || '", "quantity": 1, "price_at_sale": 20, "tax_rate_at_sale": 0, "tax_amount": 0, "subtotal_item": 20}]''::JSONB, 20, 0, 20, ''{}''::JSONB)',
        false
    );
    CALL pg_temp.log_result('8. Regression 1.5', 'process_sale rejects superadmin without pharmacy', 'superadmin', 'rpc', 'EXECUTE', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'User has no pharmacy assignment');

    -- Admin escalation triggers
    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_admin_a, 'UPDATE public.app_users SET role = ''superadmin'' WHERE id = ''' || v_admin_a || '''', false);
    CALL pg_temp.log_result('8. Regression 1.5', 'admin cannot escalate role to superadmin', 'admin_a', 'app_users', 'UPDATE', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'Only superadmin can change user roles');

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_admin_a, 'UPDATE public.app_users SET pharmacy_id = ''' || v_pharm_b || ''' WHERE id = ''' || v_pharmacist_a || '''', false);
    CALL pg_temp.log_result('8. Regression 1.5', 'admin cannot change staff pharmacy assignment', 'admin_a', 'app_users', 'UPDATE', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'Only superadmin can change pharmacy assignment');

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_admin_a, 'UPDATE public.app_users SET id = gen_random_uuid() WHERE id = ''' || v_pharmacist_a || '''', false);
    CALL pg_temp.log_result('8. Regression 1.5', 'admin cannot change user ID', 'admin_a', 'app_users', 'UPDATE', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'Cannot modify user ID');

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_admin_a, 'UPDATE public.pharmacies SET plan_tier = ''enterprise'' WHERE id = ''' || v_pharm_a || '''', false);
    CALL pg_temp.log_result('8. Regression 1.5', 'admin cannot change pharmacy plan_tier', 'admin_a', 'pharmacies', 'UPDATE', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'Only superadmin can modify pharmacy plan tier');

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_admin_a, 'UPDATE public.pharmacies SET max_branches = 50 WHERE id = ''' || v_pharm_a || '''', false);
    CALL pg_temp.log_result('8. Regression 1.5', 'admin cannot change pharmacy max_branches', 'admin_a', 'pharmacies', 'UPDATE', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'Only superadmin can modify branch limits');

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_admin_a, 'UPDATE public.pharmacies SET id = gen_random_uuid() WHERE id = ''' || v_pharm_a || '''', false);
    CALL pg_temp.log_result('8. Regression 1.5', 'admin cannot change pharmacy ID', 'admin_a', 'pharmacies', 'UPDATE', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'Cannot modify pharmacy ID');

    -- approve_return permissions
    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_admin_a, 'SELECT public.approve_return(''' || v_ret_b || ''')', false);
    CALL pg_temp.log_result('8. Regression 1.5', 'approve_return blocked across pharmacies', 'admin_a', 'rpc', 'EXECUTE', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'Access denied: Return belongs to another pharmacy');

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_pharmacist_a, 'SELECT public.approve_return(''' || v_ret_a || ''')', false);
    CALL pg_temp.log_result('8. Regression 1.5', 'approve_return blocked for pharmacist', 'pharmacist_a', 'rpc', 'EXECUTE', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'Requires administrator privileges');

    -- process_sale validations
    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(
        v_pharmacist_a,
        'SELECT public.process_sale(gen_random_uuid(), ''[{"medicine_id": "' || v_med_b_otc || '", "batch_id": "' || v_batch_b_otc || '", "quantity": 1, "price_at_sale": 20, "tax_rate_at_sale": 0, "tax_amount": 0, "subtotal_item": 20}]''::JSONB, 20, 0, 20, ''{}''::JSONB)',
        false
    );
    CALL pg_temp.log_result('8. Regression 1.5', 'process_sale blocks cross-pharmacy medicine/batch', 'pharmacist_a', 'rpc', 'EXECUTE', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'Item validation failed');

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(
        v_pharmacist_a,
        'SELECT public.process_sale(gen_random_uuid(), ''[{"medicine_id": "' || v_med_a_otc || '", "batch_id": "' || v_batch_a_rx || '", "quantity": 1, "price_at_sale": 20, "tax_rate_at_sale": 0, "tax_amount": 0, "subtotal_item": 20}]''::JSONB, 20, 0, 20, ''{}''::JSONB)',
        false
    );
    CALL pg_temp.log_result('8. Regression 1.5', 'process_sale blocks mismatched medicine_id and batch_id', 'pharmacist_a', 'rpc', 'EXECUTE', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'Item validation failed');

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(
        v_pharmacist_a,
        'SELECT public.process_sale(gen_random_uuid(), ''[{"medicine_id": "' || v_med_a_rx || '", "batch_id": "' || v_batch_a_rx || '", "quantity": 1, "price_at_sale": 100, "tax_rate_at_sale": 0, "tax_amount": 0, "subtotal_item": 100}]''::JSONB, 100, 0, 100, ''{}''::JSONB)',
        false
    );
    CALL pg_temp.log_result('8. Regression 1.5', 'process_sale blocks prescription drug without prescription', 'pharmacist_a', 'rpc', 'EXECUTE', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'A verified prescription and customer are required');

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(
        v_pharmacist_a,
        'SELECT public.process_sale(gen_random_uuid(), ''[{"medicine_id": "' || v_med_a_otc || '", "batch_id": "' || v_batch_a_otc || '", "quantity": -1, "price_at_sale": 20, "tax_rate_at_sale": 0, "tax_amount": 0, "subtotal_item": 20}]''::JSONB, 20, 0, 20, ''{}''::JSONB)',
        false
    );
    CALL pg_temp.log_result('8. Regression 1.5', 'process_sale blocks negative quantity', 'pharmacist_a', 'rpc', 'EXECUTE', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'Quantity must be greater than zero');

    -- Direct table INSERT blocks
    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_admin_a, 'INSERT INTO public.sales (pharmacy_id, subtotal, total_amount) VALUES (''' || v_pharm_a || ''', 50, 50)', false);
    CALL pg_temp.log_result('8. Regression 1.5', 'direct INSERT sales blocked for admin', 'admin_a', 'sales', 'INSERT', 'BLOCKED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_admin_a, 'INSERT INTO public.sale_items (pharmacy_id, sale_id, price_at_sale, subtotal_item) VALUES (''' || v_pharm_a || ''', ''' || v_sale_a1 || ''', 10, 10)', false);
    CALL pg_temp.log_result('8. Regression 1.5', 'direct INSERT sale_items blocked for admin', 'admin_a', 'sale_items', 'INSERT', 'BLOCKED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_admin_a, 'INSERT INTO public.sale_payments (pharmacy_id, sale_id, method, amount) VALUES (''' || v_pharm_a || ''', ''' || v_sale_a1 || ''', ''cash'', 10)', false);
    CALL pg_temp.log_result('8. Regression 1.5', 'direct INSERT sale_payments blocked for admin', 'admin_a', 'sale_payments', 'INSERT', 'BLOCKED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_admin_a, 'INSERT INTO public.returns (pharmacy_id, refund_method, status) VALUES (''' || v_pharm_a || ''', ''Cash'', ''pending'')', false);
    CALL pg_temp.log_result('8. Regression 1.5', 'direct INSERT returns blocked for admin', 'admin_a', 'returns', 'INSERT', 'BLOCKED', v_outcome, v_err_state, v_err);

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_admin_a, 'INSERT INTO public.return_items (pharmacy_id, return_id, quantity, reason, condition) VALUES (''' || v_pharm_a || ''', ''' || v_ret_a || ''', 1, ''Reason'', ''unopened'')', false);
    CALL pg_temp.log_result('8. Regression 1.5', 'direct INSERT return_items blocked for admin', 'admin_a', 'return_items', 'INSERT', 'BLOCKED', v_outcome, v_err_state, v_err);

    -- Trusted path without JWT can change role
    UPDATE public.app_users SET role = 'superadmin' WHERE id = v_admin_b;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 1 THEN
        CALL pg_temp.log_result('8. Regression 1.5', 'trusted path without JWT can change roles', 'postgres', 'app_users', 'UPDATE', 'ALLOWED', 'ALLOWED', '00000', '');
    ELSE
        CALL pg_temp.log_result('8. Regression 1.5', 'trusted path without JWT can change roles', 'postgres', 'app_users', 'UPDATE', 'ALLOWED', 'BLOCKED', '00000', 'Failed to update');
    END IF;


    -- ==========================================================================
    -- 9. MULTI-STEP TESTS (pg_temp.run_script)
    -- ==========================================================================
    -- 9.1 Double approval (second approval must be blocked with 'Return is not pending approval')
    SELECT * INTO v_script_res FROM pg_temp.run_script(
        v_admin_a,
        ARRAY[
            'SELECT public.approve_return(''' || v_ret_a || ''')',
            'SELECT public.approve_return(''' || v_ret_a || ''')'
        ],
        NULL
    );
    CALL pg_temp.log_result('9. Multi-Step', 'double approval blocked on second call', 'admin_a', 'returns', 'EXECUTE', 'BLOCKED', v_script_res.outcome, v_script_res.err_state, v_script_res.err, false, 'Return is not pending approval');

    -- 9.2 Legitimate sale lowers stock by 2 (checked as postgres via check_sql: 100 to 98)
    SELECT * INTO v_script_res FROM pg_temp.run_script(
        v_pharmacist_a,
        ARRAY[
            'SELECT public.process_sale(gen_random_uuid(), ''[{"medicine_id": "' || v_med_a_otc || '", "batch_id": "' || v_batch_a_otc || '", "quantity": 2, "price_at_sale": 20, "tax_rate_at_sale": 0, "tax_amount": 0, "subtotal_item": 40}]''::JSONB, 40, 0, 40, ''{}''::JSONB)'
        ],
        'SELECT quantity_in_stock::text FROM public.batches WHERE id = ''' || v_batch_a_otc || ''''
    );
    IF v_script_res.outcome = 'ALLOWED' AND v_script_res.check_result = '98' THEN
        CALL pg_temp.log_result('9. Multi-Step', 'legitimate sale lowered stock from 100 to 98', 'pharmacist_a', 'batches', 'UPDATE', 'ALLOWED', 'ALLOWED', '00000', 'Stock checked: 98');
    ELSE
        CALL pg_temp.log_result('9. Multi-Step', 'legitimate sale lowered stock from 100 to 98', 'pharmacist_a', 'batches', 'UPDATE', 'ALLOWED', 'BLOCKED', v_script_res.err_state, 'Stock check result: ' || COALESCE(v_script_res.check_result, 'NULL'));
    END IF;

    -- 9.3 Duplicate return of same sale item (KNOWN GAP - expects BLOCKED, flagged known)
    SELECT * INTO v_script_res FROM pg_temp.run_script(
        v_pharmacist_a,
        ARRAY[
            'SELECT public.process_return(gen_random_uuid(), ''' || v_sale_a1 || ''', ''[{"sale_item_id": "' || v_sale_item_a1 || '", "quantity": 1, "reason": "Wrong item given", "condition": "unopened"}]''::JSONB, ''Store Credit'')',
            'SELECT public.process_return(gen_random_uuid(), ''' || v_sale_a1 || ''', ''[{"sale_item_id": "' || v_sale_item_a1 || '", "quantity": 1, "reason": "Wrong item given", "condition": "unopened"}]''::JSONB, ''Store Credit'')'
        ],
        NULL
    );
    CALL pg_temp.log_result('10. Known Gaps', 'duplicate return of same sale item blocked', 'pharmacist_a', 'returns', 'EXECUTE', 'BLOCKED', v_script_res.outcome, v_script_res.err_state, v_script_res.err, true);

    -- Gap: Admin UPDATE on sales in own pharmacy (expects BLOCKED, flagged known)
    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(v_admin_a, 'UPDATE public.sales SET notes = ''Admin Update Notes'' WHERE id = ''' || v_sale_a1 || '''', false);
    CALL pg_temp.log_result('10. Known Gaps', 'admin cannot UPDATE sales in own pharmacy', 'admin_a', 'sales', 'UPDATE', 'BLOCKED', v_outcome, v_err_state, v_err, true);


    -- ==========================================================================
    -- 11. MAX_BRANCHES LIMIT ENFORCEMENT TESTS
    -- ==========================================================================
    -- 11.1 Admin CAN insert a branch while under max_branches
    UPDATE public.pharmacies SET max_branches = 5 WHERE id = v_pharm_a;

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(
        v_admin_a,
        'INSERT INTO public.branches (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Branch Under Limit'')',
        false
    );
    CALL pg_temp.log_result('11. Limits Enforcement', 'admin can insert branch while under max_branches', 'admin_a', 'branches', 'INSERT', 'ALLOWED', v_outcome, v_err_state, v_err, false);

    -- 11.2 Admin CANNOT insert a branch beyond max_branches
    UPDATE public.pharmacies SET max_branches = 3 WHERE id = v_pharm_a;

    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(
        v_admin_a,
        'INSERT INTO public.branches (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Branch Exceeding Limit'')',
        false
    );
    CALL pg_temp.log_result('11. Limits Enforcement', 'admin cannot insert branch beyond max_branches', 'admin_a', 'branches', 'INSERT', 'BLOCKED', v_outcome, v_err_state, v_err, false, 'Branch limit reached');

    -- 11.3 Superadmin CAN insert a branch beyond max_branches (bypasses limit trigger)
    SELECT * INTO v_outcome, v_err_state, v_err, v_rows FROM pg_temp.run_statement(
        v_superadmin,
        'INSERT INTO public.branches (pharmacy_id, name) VALUES (''' || v_pharm_a || ''', ''Superadmin Branch Exceeding Limit'')',
        false
    );
    CALL pg_temp.log_result('11. Limits Enforcement', 'superadmin can insert branch beyond max_branches', 'superadmin', 'branches', 'INSERT', 'ALLOWED', v_outcome, v_err_state, v_err, false);

    -- Note on 11.4: branches table has no is_active column; re-activation quota check not applicable.


    -- ==========================================================================
    -- 12. COMPILE REPORT & RAISE EXCEPTION (SAFE ATOMIC ROLLBACK)
    -- ==========================================================================
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'PASS'),
        COUNT(*) FILTER (WHERE status = 'FAIL'),
        COUNT(*) FILTER (WHERE status = 'KNOWN')
    INTO v_total, v_passed, v_failed, v_known
    FROM pg_temp.suite_results;

    IF v_failed = 0 THEN
        v_report := 'SUITE_RESULT: PASS (Total: ' || v_total || ', Passed: ' || v_passed || ', Failed: ' || v_failed || ', Known Gaps: ' || v_known || ')' || E'\n\n';
    ELSE
        v_report := 'SUITE_RESULT: FAIL (Total: ' || v_total || ', Passed: ' || v_passed || ', Failed: ' || v_failed || ', Known Gaps: ' || v_known || ')' || E'\n\n';
    END IF;

    -- Failures first
    IF v_failed > 0 THEN
        v_report := v_report || 'FAILURES (' || v_failed || '):' || E'\n';
        FOR v_item IN 
            SELECT * FROM pg_temp.suite_results WHERE status = 'FAIL' ORDER BY id
        LOOP
            v_report := v_report || '  [FAIL] ' || v_item.cat || ' -> ' || v_item.name || ' (' || v_item.actor || '): ' || v_item.detail || E'\n';
        END LOOP;
        v_report := v_report || E'\n';
    ELSE
        v_report := v_report || 'FAILURES: None' || E'\n\n';
    END IF;

    -- KNOWN gaps
    IF v_known > 0 THEN
        v_report := v_report || 'KNOWN GAPS (' || v_known || '):' || E'\n';
        FOR v_item IN 
            SELECT * FROM pg_temp.suite_results WHERE status = 'KNOWN' ORDER BY id
        LOOP
            v_report := v_report || '  [KNOWN] ' || v_item.name || ' (' || v_item.detail || ')' || E'\n';
        END LOOP;
        v_report := v_report || E'\n';
    END IF;

    -- Compact 19-table matrix (one compact line per table: e.g. "medicines A:.... P:....")
    v_report := v_report || 'MATRIX (19 tables, S I U D):' || E'\n';
    FOR v_tbl IN SELECT unnest(v_all_tables)
    LOOP
        v_matrix_line := rpad(v_tbl, 23) || ' A:';

        -- Admin operations
        FOREACH v_op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
        LOOP
            SELECT CASE 
                WHEN actual = 'BLOCKED' THEN '.' 
                WHEN actual = 'ALLOWED' THEN 'x' 
                ELSE '!' 
            END INTO v_outcome
            FROM pg_temp.suite_results
            WHERE cat = '1. Cross-Tenant' AND tbl = v_tbl AND op = v_op AND actor = 'admin_a'
            LIMIT 1;

            v_matrix_line := v_matrix_line || COALESCE(v_outcome, '?');
        END LOOP;

        v_matrix_line := v_matrix_line || ' P:';

        -- Pharmacist operations
        FOREACH v_op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
        LOOP
            SELECT CASE 
                WHEN actual = 'BLOCKED' THEN '.' 
                WHEN actual = 'ALLOWED' THEN 'x' 
                ELSE '!' 
            END INTO v_outcome
            FROM pg_temp.suite_results
            WHERE cat = '1. Cross-Tenant' AND tbl = v_tbl AND op = v_op AND actor = 'pharmacist_a'
            LIMIT 1;

            v_matrix_line := v_matrix_line || COALESCE(v_outcome, '?');
        END LOOP;

        v_report := v_report || v_matrix_line || E'\n';
    END LOOP;

    -- Repeat SUITE_RESULT totals line plus END marker as very last line
    v_report := v_report || E'\n' || 'SUITE_RESULT: ' || CASE WHEN v_failed = 0 THEN 'PASS' ELSE 'FAIL' END 
                || ' (Total: ' || v_total || ', Passed: ' || v_passed || ', Failed: ' || v_failed || ', Known Gaps: ' || v_known || ')' || E'\n';
    v_report := v_report || 'END OF SUITE' || E'\n';

    -- Raise report exception to abort and roll back all changes
    RAISE EXCEPTION E'\n%', v_report;
END;
$$;
