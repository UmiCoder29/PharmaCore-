-- Migration: 20261026000002_definer_and_escalation_hardening.sql
-- Description:
-- 1. Protect app_users from privilege and tenant escalation (trigger fn_protect_app_users_escalation).
-- 2. Protect pharmacies from billing, quota escalation, and id mutation (trigger fn_protect_pharmacy_billing).
-- 3. Lock returns with FOR UPDATE during approve_return and enforce pharmacy tenant isolation.
-- 4. Harden process_sale and process_return to require user pharmacy assignment and remove all NULL-pharmacy fallbacks.
-- 5. Restrict direct INSERT on sales, sale_items, sale_payments, returns, and return_items to superadmins only.
--
-- Rollback instructions:
-- DROP TRIGGER IF EXISTS trg_protect_app_users_escalation ON public.app_users;
-- DROP FUNCTION IF EXISTS public.fn_protect_app_users_escalation();
-- DROP TRIGGER IF EXISTS trg_protect_pharmacy_billing ON public.pharmacies;
-- DROP FUNCTION IF EXISTS public.fn_protect_pharmacy_billing();
-- DROP POLICY IF EXISTS "superadmin_insert_sales" ON public.sales;
-- CREATE POLICY "write_sales" ON public.sales FOR INSERT TO authenticated WITH CHECK (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id()));
-- DROP POLICY IF EXISTS "superadmin_insert_sale_items" ON public.sale_items;
-- CREATE POLICY "write_sale_items" ON public.sale_items FOR INSERT TO authenticated WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());
-- DROP POLICY IF EXISTS "superadmin_insert_sale_payments" ON public.sale_payments;
-- CREATE POLICY "write_sale_payments" ON public.sale_payments FOR INSERT TO authenticated WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());
-- DROP POLICY IF EXISTS "superadmin_insert_returns" ON public.returns;
-- CREATE POLICY "write_returns" ON public.returns FOR INSERT TO authenticated WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());
-- DROP POLICY IF EXISTS "superadmin_insert_return_items" ON public.return_items;
-- CREATE POLICY "write_return_items" ON public.return_items FOR INSERT TO authenticated WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());
-- (Re-apply approve_return, process_sale, and process_return from 20261025000001_baseline.sql)

-- ==============================================================================
-- 1. APP_USERS ESCALATION & TENANT PROTECTION TRIGGER
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_protect_app_users_escalation()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow direct SQL (migration scripts/psql), service role, postgres, and superadmins
    IF auth.uid() IS NULL 
       OR public.is_superadmin() 
       OR auth.role() = 'service_role' 
       OR current_user = 'postgres' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.role = 'superadmin' THEN
            RAISE EXCEPTION 'Only superadmin can create superadmin accounts';
        END IF;
        IF NEW.pharmacy_id IS DISTINCT FROM public.get_user_pharmacy_id() THEN
            RAISE EXCEPTION 'Cannot create user for another pharmacy';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'Only superadmin can change user roles';
        END IF;
        IF NEW.pharmacy_id IS DISTINCT FROM OLD.pharmacy_id THEN
            RAISE EXCEPTION 'Only superadmin can change pharmacy assignment';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_protect_app_users_escalation ON public.app_users;
CREATE TRIGGER trg_protect_app_users_escalation
    BEFORE INSERT OR UPDATE ON public.app_users
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_protect_app_users_escalation();

-- Tighten RLS policy on app_users with explicit WITH CHECK clause
DROP POLICY IF EXISTS "admin_write_app_users" ON public.app_users;
CREATE POLICY "admin_write_app_users" ON public.app_users 
    FOR ALL TO authenticated 
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()))
    WITH CHECK (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

-- ==============================================================================
-- 2. PHARMACIES BILLING, LIMITS & ID PROTECTION TRIGGER
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_protect_pharmacy_billing()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow direct SQL (migration scripts/psql), service role, postgres, and superadmins
    IF auth.uid() IS NULL 
       OR public.is_superadmin() 
       OR auth.role() = 'service_role' 
       OR current_user = 'postgres' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id THEN
            RAISE EXCEPTION 'Cannot modify pharmacy ID';
        END IF;

        IF NEW.plan_tier IS DISTINCT FROM OLD.plan_tier THEN
            RAISE EXCEPTION 'Only superadmin can modify pharmacy plan tier';
        END IF;

        IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status THEN
            RAISE EXCEPTION 'Only superadmin can modify subscription status';
        END IF;

        IF NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at THEN
            RAISE EXCEPTION 'Only superadmin can modify trial duration';
        END IF;

        IF NEW.subscription_ends_at IS DISTINCT FROM OLD.subscription_ends_at THEN
            RAISE EXCEPTION 'Only superadmin can modify subscription duration';
        END IF;

        IF NEW.max_branches IS DISTINCT FROM OLD.max_branches THEN
            RAISE EXCEPTION 'Only superadmin can modify branch limits';
        END IF;

        IF NEW.max_users IS DISTINCT FROM OLD.max_users THEN
            RAISE EXCEPTION 'Only superadmin can modify user limits';
        END IF;

        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            RAISE EXCEPTION 'Only superadmin can modify pharmacy active status';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_protect_pharmacy_billing ON public.pharmacies;
CREATE TRIGGER trg_protect_pharmacy_billing
    BEFORE UPDATE ON public.pharmacies
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_protect_pharmacy_billing();

-- Revoke execute on trigger functions from untrusted roles
REVOKE EXECUTE ON FUNCTION public.fn_protect_app_users_escalation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_protect_pharmacy_billing() FROM PUBLIC, anon, authenticated;

-- ==============================================================================
-- 3. APPROVE RETURN CONCURRENCY & TENANT HARDENING
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.approve_return(
    p_return_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_status TEXT;
    v_pharmacy_id UUID;
    v_caller_pharmacy_id UUID := public.get_user_pharmacy_id();
    v_item RECORD;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Requires administrator privileges';
    END IF;

    -- Row-level lock on returns row to prevent double-approval race conditions
    SELECT status, pharmacy_id INTO v_status, v_pharmacy_id 
    FROM public.returns 
    WHERE id = p_return_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Return record not found';
    END IF;

    -- Tenant isolation check
    IF NOT public.is_superadmin() AND (v_caller_pharmacy_id IS NULL OR v_pharmacy_id IS DISTINCT FROM v_caller_pharmacy_id) THEN
        RAISE EXCEPTION 'Access denied: Return belongs to another pharmacy';
    END IF;

    IF v_status != 'pending' THEN
        RAISE EXCEPTION 'Return is not pending approval';
    END IF;

    FOR v_item IN 
        SELECT batch_id, quantity, restored_to_stock 
        FROM public.return_items 
        WHERE return_id = p_return_id
    LOOP
        IF v_item.restored_to_stock = TRUE THEN
            UPDATE public.batches 
            SET quantity_in_stock = quantity_in_stock + v_item.quantity
            WHERE id = v_item.batch_id
              AND pharmacy_id = v_pharmacy_id;
        END IF;
    END LOOP;

    UPDATE public.returns 
    SET status = 'completed', updated_at = now() 
    WHERE id = p_return_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ==============================================================================
-- 4. PROCESS SALE ATOMIC TRANSACTION HARDENING
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.process_sale(
    p_sale_id UUID,
    p_items JSONB,
    p_subtotal NUMERIC,
    p_total_tax NUMERIC,
    p_total_amount NUMERIC,
    p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS UUID AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_pharmacy_id UUID;
    v_branch_id UUID;
    v_item JSONB;
    v_sale_item_id UUID;
    v_payment JSONB;
    v_invoice_number TEXT;
    v_customer_id UUID;
    v_prescription_id UUID;
    v_needs_prescription BOOLEAN;
    v_payment_total NUMERIC;
    v_sub_status TEXT;
    v_sub_ends TIMESTAMPTZ;
BEGIN
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Not authenticated'; 
    END IF;
    
    SELECT pharmacy_id, branch_id INTO v_pharmacy_id, v_branch_id 
    FROM public.app_users 
    WHERE id = v_user_id;

    IF NOT FOUND THEN 
        RAISE EXCEPTION 'User not found in app_users'; 
    END IF;

    -- Superadmins do not ring sales; require valid pharmacy assignment
    IF v_pharmacy_id IS NULL THEN
        RAISE EXCEPTION 'User has no pharmacy assignment';
    END IF;

    -- If branch is not set on app_user, resolve to pharmacy's main or first branch
    IF v_branch_id IS NULL THEN
        SELECT id INTO v_branch_id
        FROM public.branches
        WHERE pharmacy_id = v_pharmacy_id
        ORDER BY is_main_branch DESC, created_at ASC
        LIMIT 1;
    END IF;

    -- Validate Pharmacy Subscription Status
    SELECT subscription_status, subscription_ends_at INTO v_sub_status, v_sub_ends 
    FROM public.pharmacies 
    WHERE id = v_pharmacy_id;

    IF v_sub_status IN ('suspended', 'cancelled') THEN
        RAISE EXCEPTION 'Pharmacy subscription is suspended or cancelled. Please contact support.';
    END IF;

    IF v_sub_ends IS NOT NULL AND v_sub_ends < now() THEN
        RAISE EXCEPTION 'Pharmacy subscription has expired. Please renew to continue transactions.';
    END IF;

    v_customer_id := NULLIF(p_metadata->>'customer_id', '')::UUID;
    v_prescription_id := NULLIF(p_metadata->>'prescription_id', '')::UUID;

    -- Customer must belong to caller pharmacy
    IF v_customer_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.customers 
        WHERE id = v_customer_id AND pharmacy_id = v_pharmacy_id
    ) THEN
        RAISE EXCEPTION 'Customer does not belong to user pharmacy';
    END IF;

    -- Controlled substances & prescription drug check
    SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) i
        JOIN public.medicines m ON m.id = (i->>'medicine_id')::UUID
        WHERE m.pharmacy_id = v_pharmacy_id 
          AND (m.prescription_required OR m.controlled_schedule IS NOT NULL)
    ) INTO v_needs_prescription;

    IF v_needs_prescription AND (v_customer_id IS NULL OR v_prescription_id IS NULL) THEN
        RAISE EXCEPTION 'A verified prescription and customer are required for prescription or controlled medicines';
    END IF;

    IF v_prescription_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.prescriptions p 
        WHERE p.id = v_prescription_id 
          AND p.pharmacy_id = v_pharmacy_id 
          AND p.customer_id = v_customer_id 
          AND p.status = 'verified'
    ) THEN 
        RAISE EXCEPTION 'Prescription is not verified for this customer'; 
    END IF;

    -- Payment Amount Validation
    SELECT COALESCE(SUM((p->>'amount')::NUMERIC), 0) INTO v_payment_total
    FROM jsonb_array_elements(COALESCE(p_metadata->'payments', '[]'::JSONB)) p;

    IF v_payment_total > 0 AND abs(v_payment_total - p_total_amount) > 0.01 THEN
        RAISE EXCEPTION 'Payment total must equal the sale total';
    END IF;

    -- Generate Invoice Number: PC-YYMMDD-XXXXXX
    v_invoice_number := 'PC-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(p_sale_id::TEXT, '-', ''), 1, 6));

    -- Insert parent sale record
    INSERT INTO public.sales (
        id, pharmacy_id, invoice_number, date_time, subtotal, total_tax, total_amount, cashier_user_id, branch_id,
        customer_id, prescription_id, payment_method, discount_amount, cash_received, change_amount, notes,
        fbr_invoice_number, fbr_qr_payload
    ) VALUES (
        p_sale_id, v_pharmacy_id, v_invoice_number, now(), p_subtotal, p_total_tax, p_total_amount, v_user_id, v_branch_id,
        v_customer_id, v_prescription_id, COALESCE(p_metadata->>'payment_method', 'cash'),
        COALESCE((p_metadata->>'discount_amount')::NUMERIC, 0), NULLIF(p_metadata->>'cash_received', '')::NUMERIC,
        COALESCE((p_metadata->>'change_amount')::NUMERIC, 0), NULLIF(p_metadata->>'notes', ''),
        NULLIF(p_metadata->>'fbr_invoice_number', ''), NULLIF(p_metadata->>'fbr_qr_payload', '')
    );

    -- Deduct batch stock strictly for the user pharmacy and insert line items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        UPDATE public.batches 
        SET quantity_in_stock = quantity_in_stock - (v_item->>'quantity')::INTEGER
        WHERE id = (v_item->>'batch_id')::UUID 
          AND pharmacy_id = v_pharmacy_id
          AND quantity_in_stock >= (v_item->>'quantity')::INTEGER;

        IF NOT FOUND THEN 
            RAISE EXCEPTION 'Insufficient stock for batch %', v_item->>'batch_number'; 
        END IF;

        v_sale_item_id := gen_random_uuid();
        INSERT INTO public.sale_items (
            id, pharmacy_id, sale_id, medicine_id, batch_id, batch_number, name, quantity,
            price_at_sale, tax_rate_at_sale, tax_amount, subtotal_item, branch_id
        ) VALUES (
            v_sale_item_id, v_pharmacy_id, p_sale_id, 
            (v_item->>'medicine_id')::UUID, (v_item->>'batch_id')::UUID, 
            v_item->>'batch_number', v_item->>'name', 
            (v_item->>'quantity')::INTEGER, (v_item->>'price_at_sale')::NUMERIC, 
            (v_item->>'tax_rate_at_sale')::NUMERIC, (v_item->>'tax_amount')::NUMERIC, 
            (v_item->>'subtotal_item')::NUMERIC, v_branch_id
        );
    END LOOP;

    -- Record multi-payment split breakdown if present
    FOR v_payment IN SELECT * FROM jsonb_array_elements(COALESCE(p_metadata->'payments', '[]'::JSONB)) LOOP
        INSERT INTO public.sale_payments (pharmacy_id, sale_id, method, amount, reference)
        VALUES (v_pharmacy_id, p_sale_id, v_payment->>'method', (v_payment->>'amount')::NUMERIC, NULLIF(v_payment->>'reference', ''));
    END LOOP;

    -- Mark linked prescription as dispensed
    IF v_prescription_id IS NOT NULL THEN 
        UPDATE public.prescriptions 
        SET status = 'dispensed', updated_at = now() 
        WHERE id = v_prescription_id AND pharmacy_id = v_pharmacy_id; 
    END IF;

    RETURN p_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ==============================================================================
-- 5. PROCESS RETURN ATOMIC TRANSACTION HARDENING
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.process_return(
    p_return_id UUID,
    p_sale_id UUID,
    p_items JSONB,
    p_refund_method TEXT
) RETURNS UUID AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_pharmacy_id UUID;
    v_branch_id UUID;
    v_item JSONB;
    v_return_item_id UUID;
    v_sale_item RECORD;
    v_total_refund NUMERIC := 0;
    v_item_refund NUMERIC := 0;
    v_quarantined BOOLEAN;
    v_restored BOOLEAN;
    v_threshold NUMERIC;
    v_status TEXT := 'completed';
BEGIN
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Not authenticated'; 
    END IF;

    SELECT pharmacy_id, branch_id INTO v_pharmacy_id, v_branch_id 
    FROM public.app_users 
    WHERE id = v_user_id;

    IF NOT FOUND THEN 
        RAISE EXCEPTION 'User not found in app_users'; 
    END IF;

    -- Superadmins do not process returns; require valid pharmacy assignment
    IF v_pharmacy_id IS NULL THEN
        RAISE EXCEPTION 'User has no pharmacy assignment';
    END IF;

    -- If branch is not set on app_user, resolve to pharmacy's main or first branch
    IF v_branch_id IS NULL THEN
        SELECT id INTO v_branch_id
        FROM public.branches
        WHERE pharmacy_id = v_pharmacy_id
        ORDER BY is_main_branch DESC, created_at ASC
        LIMIT 1;
    END IF;

    -- Original sale must belong to caller pharmacy
    IF NOT EXISTS (
        SELECT 1 FROM public.sales 
        WHERE id = p_sale_id AND pharmacy_id = v_pharmacy_id
    ) THEN
        RAISE EXCEPTION 'Sale does not belong to user pharmacy';
    END IF;

    -- Calculate total refund enforcing original sale price per unit
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        SELECT * INTO v_sale_item 
        FROM public.sale_items 
        WHERE id = (v_item->>'sale_item_id')::UUID
          AND sale_id = p_sale_id
          AND pharmacy_id = v_pharmacy_id;

        IF NOT FOUND THEN 
            RAISE EXCEPTION 'Sale item not found for ID %', v_item->>'sale_item_id'; 
        END IF;

        IF (v_item->>'quantity')::INTEGER > v_sale_item.quantity THEN 
            RAISE EXCEPTION 'Cannot return more quantity than originally sold'; 
        END IF;
        
        v_item_refund := ((v_sale_item.subtotal_item / v_sale_item.quantity) * (v_item->>'quantity')::INTEGER);
        v_total_refund := v_total_refund + v_item_refund;
    END LOOP;

    -- Cash refund threshold approval check
    IF p_refund_method = 'Cash' THEN
        SELECT (value->>'threshold')::NUMERIC INTO v_threshold 
        FROM public.settings 
        WHERE key = 'refund_approval_threshold' 
          AND pharmacy_id = v_pharmacy_id
        LIMIT 1;

        IF v_threshold IS NULL THEN 
            v_threshold := 5000; 
        END IF;

        IF v_total_refund > v_threshold AND NOT public.is_admin() THEN
            v_status := 'pending';
        END IF;
    END IF;

    -- Insert return record
    INSERT INTO public.returns (
        id, pharmacy_id, sale_id, return_date, refund_method, total_refund_amount, status, processed_by_user_id, branch_id
    ) VALUES (
        p_return_id, v_pharmacy_id, p_sale_id, now(), p_refund_method, v_total_refund, v_status, v_user_id, v_branch_id
    );

    -- Insert return items and route stock
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_return_item_id := gen_random_uuid();
        v_quarantined := FALSE;
        v_restored := FALSE;
        
        IF v_item->>'reason' = 'Wrong item given' AND v_item->>'condition' = 'unopened' THEN 
            v_restored := TRUE;
        ELSIF v_item->>'reason' = 'Customer changed mind (unopened)' AND v_item->>'condition' = 'unopened' THEN 
            v_restored := TRUE;
        ELSIF v_item->>'reason' = 'Wrong prescription' THEN 
            v_quarantined := TRUE;
        ELSIF v_item->>'reason' = 'Suspected counterfeit or quality issue' THEN 
            v_quarantined := TRUE;
        ELSIF v_item->>'reason' = 'Other' THEN
            IF v_item->>'condition' = 'unopened' THEN 
                v_restored := TRUE;
            ELSE 
                v_quarantined := TRUE;
            END IF;
        ELSE 
            v_quarantined := TRUE;
        END IF;

        SELECT * INTO v_sale_item 
        FROM public.sale_items 
        WHERE id = (v_item->>'sale_item_id')::UUID
          AND sale_id = p_sale_id
          AND pharmacy_id = v_pharmacy_id;

        v_item_refund := ((v_sale_item.subtotal_item / v_sale_item.quantity) * (v_item->>'quantity')::INTEGER);

        INSERT INTO public.return_items (
            id, pharmacy_id, return_id, sale_item_id, medicine_id, batch_id, quantity, reason, condition, refund_amount, quarantined, restored_to_stock, branch_id
        ) VALUES (
            v_return_item_id, v_pharmacy_id, p_return_id, (v_item->>'sale_item_id')::UUID,
            v_sale_item.medicine_id, v_sale_item.batch_id, (v_item->>'quantity')::INTEGER,
            v_item->>'reason', v_item->>'condition', v_item_refund, v_quarantined, v_restored, v_branch_id
        );

        IF v_status = 'completed' AND v_restored = TRUE THEN
            UPDATE public.batches 
            SET quantity_in_stock = quantity_in_stock + (v_item->>'quantity')::INTEGER
            WHERE id = v_sale_item.batch_id
              AND pharmacy_id = v_pharmacy_id;
        END IF;
    END LOOP;

    RETURN p_return_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ==============================================================================
-- 6. RESTRICT DIRECT INSERTS ON SALES & RETURNS TO SUPERADMINS
-- ==============================================================================

-- Cashiers ring sales through process_sale(); direct table inserts are superadmin-only
DROP POLICY IF EXISTS "write_sales" ON public.sales;
CREATE POLICY "superadmin_insert_sales" ON public.sales
    FOR INSERT TO authenticated
    WITH CHECK (public.is_superadmin());

DROP POLICY IF EXISTS "write_sale_items" ON public.sale_items;
CREATE POLICY "superadmin_insert_sale_items" ON public.sale_items
    FOR INSERT TO authenticated
    WITH CHECK (public.is_superadmin());

DROP POLICY IF EXISTS "write_sale_payments" ON public.sale_payments;
CREATE POLICY "superadmin_insert_sale_payments" ON public.sale_payments
    FOR INSERT TO authenticated
    WITH CHECK (public.is_superadmin());

-- Returns are created through process_return(); direct table inserts are superadmin-only
DROP POLICY IF EXISTS "write_returns" ON public.returns;
CREATE POLICY "superadmin_insert_returns" ON public.returns
    FOR INSERT TO authenticated
    WITH CHECK (public.is_superadmin());

DROP POLICY IF EXISTS "write_return_items" ON public.return_items;
CREATE POLICY "superadmin_insert_return_items" ON public.return_items
    FOR INSERT TO authenticated
    WITH CHECK (public.is_superadmin());

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
