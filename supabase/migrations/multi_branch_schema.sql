-- ==========================================
-- PharmaCore Multi-Branch Schema Migration
-- ==========================================

-- 1. Add can_view_all_branches to app_users
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_view_all_branches BOOLEAN DEFAULT FALSE;

-- 2. Add branch_id to missing tables
ALTER TABLE batches ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

-- 3. Backfill missing branch_id from existing single branch (or default to NULL if no branch exists yet)
DO $$
DECLARE
    v_default_branch UUID;
BEGIN
    SELECT id INTO v_default_branch FROM branches ORDER BY created_at ASC LIMIT 1;
    
    IF v_default_branch IS NOT NULL THEN
        -- Backfill explicitly added tables
        UPDATE batches SET branch_id = v_default_branch WHERE branch_id IS NULL;
        UPDATE sale_items SET branch_id = v_default_branch WHERE branch_id IS NULL;
        UPDATE return_items SET branch_id = v_default_branch WHERE branch_id IS NULL;
        
        -- Backfill existing tables just in case they have nulls
        UPDATE app_users SET branch_id = v_default_branch WHERE branch_id IS NULL;
        UPDATE categories SET branch_id = v_default_branch WHERE branch_id IS NULL;
        UPDATE suppliers SET branch_id = v_default_branch WHERE branch_id IS NULL;
        UPDATE medicines SET branch_id = v_default_branch WHERE branch_id IS NULL;
        UPDATE sales SET branch_id = v_default_branch WHERE branch_id IS NULL;
        UPDATE activity_logs SET branch_id = v_default_branch WHERE branch_id IS NULL;
        UPDATE settings SET branch_id = v_default_branch WHERE branch_id IS NULL;
        UPDATE returns SET branch_id = v_default_branch WHERE branch_id IS NULL;
    END IF;
END $$;

-- 4. Make branch_id NOT NULL on operational tables
ALTER TABLE batches ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE sale_items ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE return_items ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE categories ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE suppliers ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE medicines ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE sales ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE activity_logs ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE settings ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE returns ALTER COLUMN branch_id SET NOT NULL;

-- 5. Helper Functions
CREATE OR REPLACE FUNCTION public.can_view_all_branches() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND can_view_all_branches = true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_branch_id() RETURNS UUID AS $$
DECLARE
    v_branch UUID;
BEGIN
    SELECT branch_id INTO v_branch FROM app_users WHERE id = auth.uid();
    RETURN v_branch;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Update RLS Policies
-- First, drop old policies
DROP POLICY IF EXISTS "admin_all_branches" ON branches;
DROP POLICY IF EXISTS "admin_all_app_users" ON app_users;
DROP POLICY IF EXISTS "admin_all_categories" ON categories;
DROP POLICY IF EXISTS "admin_all_suppliers" ON suppliers;
DROP POLICY IF EXISTS "admin_all_medicines" ON medicines;
DROP POLICY IF EXISTS "admin_all_batches" ON batches;
DROP POLICY IF EXISTS "admin_all_sales" ON sales;
DROP POLICY IF EXISTS "admin_all_sale_items" ON sale_items;
DROP POLICY IF EXISTS "admin_all_activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "admin_all_settings" ON settings;
DROP POLICY IF EXISTS "admin_all_returns" ON returns;
DROP POLICY IF EXISTS "admin_all_return_items" ON return_items;

DROP POLICY IF EXISTS "pharmacist_read_branches" ON branches;
DROP POLICY IF EXISTS "pharmacist_read_categories" ON categories;
DROP POLICY IF EXISTS "pharmacist_read_suppliers" ON suppliers;
DROP POLICY IF EXISTS "pharmacist_read_medicines" ON medicines;
DROP POLICY IF EXISTS "pharmacist_read_batches" ON batches;
DROP POLICY IF EXISTS "pharmacist_read_settings" ON settings;
DROP POLICY IF EXISTS "pharmacist_read_self" ON app_users;
DROP POLICY IF EXISTS "pharmacist_read_own_sales" ON sales;
DROP POLICY IF EXISTS "pharmacist_read_own_sale_items" ON sale_items;
DROP POLICY IF EXISTS "pharmacist_read_own_returns" ON returns;
DROP POLICY IF EXISTS "pharmacist_read_own_return_items" ON return_items;

DROP POLICY IF EXISTS "create_items" ON sale_items;
DROP POLICY IF EXISTS "create_returns" ON returns;
DROP POLICY IF EXISTS "create_return_items" ON return_items;

-- NEW POLICIES

-- Branches: Owners see all, others see their own.
CREATE POLICY "read_branches" ON branches FOR SELECT TO authenticated USING (
    id = get_user_branch_id() OR can_view_all_branches()
);
CREATE POLICY "admin_write_branches" ON branches FOR ALL TO authenticated USING (
    is_admin() AND id = get_user_branch_id()
);

-- App Users: Owners see all, admins see their own branch, pharmacists see themselves.
CREATE POLICY "read_app_users" ON app_users FOR SELECT TO authenticated USING (
    id = auth.uid() OR (is_admin() AND branch_id = get_user_branch_id()) OR can_view_all_branches()
);
CREATE POLICY "admin_write_app_users" ON app_users FOR ALL TO authenticated USING (
    is_admin() AND branch_id = get_user_branch_id()
);

-- General Tables (Categories, Suppliers, Medicines, Batches, Settings): Read all in branch OR cross-branch if allowed.
CREATE POLICY "read_categories" ON categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write_categories" ON categories FOR ALL TO authenticated USING (is_admin());

CREATE POLICY "read_suppliers" ON suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write_suppliers" ON suppliers FOR ALL TO authenticated USING (is_admin());

CREATE POLICY "read_medicines" ON medicines FOR SELECT TO authenticated USING (branch_id = get_user_branch_id() OR can_view_all_branches());
CREATE POLICY "admin_write_medicines" ON medicines FOR ALL TO authenticated USING (is_admin() AND branch_id = get_user_branch_id());

CREATE POLICY "read_batches" ON batches FOR SELECT TO authenticated USING (branch_id = get_user_branch_id() OR can_view_all_branches());
CREATE POLICY "admin_write_batches" ON batches FOR ALL TO authenticated USING (is_admin() AND branch_id = get_user_branch_id());

CREATE POLICY "read_settings" ON settings FOR SELECT TO authenticated USING (branch_id = get_user_branch_id() OR can_view_all_branches());
CREATE POLICY "admin_write_settings" ON settings FOR ALL TO authenticated USING (is_admin() AND branch_id = get_user_branch_id());

-- Activity Logs
CREATE POLICY "read_activity_logs" ON activity_logs FOR SELECT TO authenticated USING (branch_id = get_user_branch_id() OR can_view_all_branches());
CREATE POLICY "write_activity_logs" ON activity_logs FOR INSERT TO authenticated WITH CHECK (branch_id = get_user_branch_id());

-- Sales & Returns
CREATE POLICY "read_sales" ON sales FOR SELECT TO authenticated USING (
    branch_id = get_user_branch_id() OR can_view_all_branches()
);
CREATE POLICY "write_sales" ON sales FOR INSERT TO authenticated WITH CHECK (branch_id = get_user_branch_id());
CREATE POLICY "admin_modify_sales" ON sales FOR UPDATE TO authenticated USING (is_admin() AND branch_id = get_user_branch_id());
CREATE POLICY "admin_delete_sales" ON sales FOR DELETE TO authenticated USING (is_admin() AND branch_id = get_user_branch_id());

CREATE POLICY "read_sale_items" ON sale_items FOR SELECT TO authenticated USING (
    branch_id = get_user_branch_id() OR can_view_all_branches()
);
CREATE POLICY "write_sale_items" ON sale_items FOR INSERT TO authenticated WITH CHECK (branch_id = get_user_branch_id());

CREATE POLICY "read_returns" ON returns FOR SELECT TO authenticated USING (
    branch_id = get_user_branch_id() OR can_view_all_branches()
);
CREATE POLICY "write_returns" ON returns FOR INSERT TO authenticated WITH CHECK (branch_id = get_user_branch_id());
CREATE POLICY "admin_modify_returns" ON returns FOR UPDATE TO authenticated USING (is_admin() AND branch_id = get_user_branch_id());

CREATE POLICY "read_return_items" ON return_items FOR SELECT TO authenticated USING (
    branch_id = get_user_branch_id() OR can_view_all_branches()
);
CREATE POLICY "write_return_items" ON return_items FOR INSERT TO authenticated WITH CHECK (branch_id = get_user_branch_id());


-- ==========================================
-- 7. Update process_sale 
-- ==========================================
CREATE OR REPLACE FUNCTION public.process_sale(
    p_sale_id UUID,
    p_items JSONB,
    p_subtotal NUMERIC,
    p_total_tax NUMERIC,
    p_total_amount NUMERIC
) RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
    v_branch_id UUID;
    v_item JSONB;
    v_sale_item_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    SELECT branch_id INTO v_branch_id FROM public.app_users WHERE id = v_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'User not found in app_users'; END IF;

    -- Insert sale
    INSERT INTO sales (
        id, date_time, subtotal, total_tax, total_amount, cashier_user_id, branch_id
    ) VALUES (
        p_sale_id, now(), p_subtotal, p_total_tax, p_total_amount, v_user_id, v_branch_id
    );

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_sale_item_id := gen_random_uuid();
        
        UPDATE batches 
        SET quantity_in_stock = quantity_in_stock - (v_item->>'quantity')::INTEGER
        WHERE id = (v_item->>'batch_id')::UUID;

        IF EXISTS (SELECT 1 FROM batches WHERE id = (v_item->>'batch_id')::UUID AND quantity_in_stock < 0) THEN
            RAISE EXCEPTION 'Negative stock not allowed for batch %', v_item->>'batch_number';
        END IF;

        -- Insert sale_item using v_branch_id from the parent sale
        INSERT INTO sale_items (
            id, sale_id, medicine_id, batch_id, batch_number, name, quantity,
            price_at_sale, tax_rate_at_sale, tax_amount, subtotal_item, branch_id
        ) VALUES (
            v_sale_item_id, 
            p_sale_id, 
            (v_item->>'medicine_id')::UUID, 
            (v_item->>'batch_id')::UUID, 
            v_item->>'batch_number', 
            v_item->>'name', 
            (v_item->>'quantity')::INTEGER,
            (v_item->>'price_at_sale')::NUMERIC, 
            (v_item->>'tax_rate_at_sale')::NUMERIC, 
            (v_item->>'tax_amount')::NUMERIC, 
            (v_item->>'subtotal_item')::NUMERIC,
            v_branch_id
        );
    END LOOP;

    RETURN p_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ==========================================
-- 8. Update process_return
-- ==========================================
CREATE OR REPLACE FUNCTION public.process_return(
    p_return_id UUID,
    p_sale_id UUID,
    p_items JSONB,
    p_refund_method TEXT
) RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
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
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    SELECT branch_id INTO v_branch_id FROM public.app_users WHERE id = v_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'User not found in app_users'; END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        SELECT * INTO v_sale_item FROM public.sale_items WHERE id = (v_item->>'sale_item_id')::UUID;
        IF NOT FOUND THEN RAISE EXCEPTION 'Sale item not found for ID %', v_item->>'sale_item_id'; END IF;
        IF (v_item->>'quantity')::INTEGER > v_sale_item.quantity THEN RAISE EXCEPTION 'Cannot return more quantity than originally sold'; END IF;
        v_item_refund := ((v_sale_item.subtotal_item / v_sale_item.quantity) * (v_item->>'quantity')::INTEGER);
        v_total_refund := v_total_refund + v_item_refund;
    END LOOP;

    IF p_refund_method = 'Cash' THEN
        SELECT value::NUMERIC INTO v_threshold FROM public.settings WHERE key = 'refund_approval_threshold';
        IF NOT FOUND THEN v_threshold := 5000; END IF;
        IF v_total_refund > v_threshold AND NOT is_admin() THEN
            v_status := 'pending';
        END IF;
    END IF;

    -- Insert return record
    INSERT INTO public.returns (
        id, sale_id, return_date, refund_method, total_refund_amount, status, processed_by_user_id, branch_id
    ) VALUES (
        p_return_id, p_sale_id, now(), p_refund_method, v_total_refund, v_status, v_user_id, v_branch_id
    );

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_return_item_id := gen_random_uuid();
        v_quarantined := FALSE;
        v_restored := FALSE;
        
        IF v_item->>'reason' = 'Wrong item given' AND v_item->>'condition' = 'unopened' THEN v_restored := TRUE;
        ELSIF v_item->>'reason' = 'Customer changed mind (unopened)' AND v_item->>'condition' = 'unopened' THEN v_restored := TRUE;
        ELSIF v_item->>'reason' = 'Wrong prescription' THEN v_quarantined := TRUE;
        ELSIF v_item->>'reason' = 'Suspected counterfeit or quality issue' THEN v_quarantined := TRUE;
        ELSIF v_item->>'reason' = 'Other' THEN
            IF v_item->>'condition' = 'unopened' THEN v_restored := TRUE;
            ELSE v_quarantined := TRUE;
            END IF;
        ELSE
            v_quarantined := TRUE;
        END IF;

        SELECT * INTO v_sale_item FROM public.sale_items WHERE id = (v_item->>'sale_item_id')::UUID;
        v_item_refund := ((v_sale_item.subtotal_item / v_sale_item.quantity) * (v_item->>'quantity')::INTEGER);

        -- Insert return item using v_branch_id from the parent return
        INSERT INTO public.return_items (
            id, return_id, sale_item_id, medicine_id, batch_id, quantity, reason, condition, refund_amount, quarantined, restored_to_stock, branch_id
        ) VALUES (
            v_return_item_id, 
            p_return_id, 
            (v_item->>'sale_item_id')::UUID,
            v_sale_item.medicine_id,
            v_sale_item.batch_id,
            (v_item->>'quantity')::INTEGER,
            v_item->>'reason',
            v_item->>'condition',
            v_item_refund,
            v_quarantined,
            v_restored,
            v_branch_id
        );

        IF v_status = 'completed' AND v_restored = TRUE THEN
            UPDATE public.batches 
            SET quantity_in_stock = quantity_in_stock + (v_item->>'quantity')::INTEGER
            WHERE id = v_sale_item.batch_id;
        END IF;
    END LOOP;

    RETURN p_return_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ==========================================
-- 9. Cross-Branch Aggregate Function
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_cross_branch_aggregates(p_date DATE)
RETURNS TABLE (
    branch_id UUID,
    branch_name TEXT,
    total_sales NUMERIC,
    total_returns NUMERIC,
    stock_value NUMERIC
) AS $$
BEGIN
    IF NOT can_view_all_branches() THEN
        RAISE EXCEPTION 'Access denied. Requires can_view_all_branches privilege.';
    END IF;

    RETURN QUERY
    SELECT 
        b.id as branch_id,
        b.name as branch_name,
        COALESCE(s.total_sales, 0) as total_sales,
        COALESCE(r.total_returns, 0) as total_returns,
        COALESCE(v.stock_value, 0) as stock_value
    FROM branches b
    LEFT JOIN (
        SELECT sales.branch_id, SUM(total_amount) as total_sales
        FROM sales
        WHERE date_time::DATE = p_date
        GROUP BY sales.branch_id
    ) s ON s.branch_id = b.id
    LEFT JOIN (
        SELECT returns.branch_id, SUM(total_refund_amount) as total_returns
        FROM returns
        WHERE return_date::DATE = p_date AND status = 'completed'
        GROUP BY returns.branch_id
    ) r ON r.branch_id = b.id
    LEFT JOIN (
        SELECT batches.branch_id, SUM(quantity_in_stock * cost_per_unit) as stock_value
        FROM batches
        WHERE quantity_in_stock > 0 AND is_expired = FALSE
        GROUP BY batches.branch_id
    ) v ON v.branch_id = b.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
