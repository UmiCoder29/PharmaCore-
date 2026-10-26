-- ==========================================
-- PharmaCore Cloud-First Schema Migration
-- ==========================================

-- Enable pgcrypto for UUIDs if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==========================================
-- 1. TABLES CREATION
-- ==========================================

-- 1. branches
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. app_users
CREATE TABLE app_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL CHECK (role IN ('admin', 'pharmacist')),
    branch_id UUID REFERENCES branches(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. categories
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    tax_rate NUMERIC DEFAULT 0,
    branch_id UUID REFERENCES branches(id),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. suppliers
CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    contact_phone TEXT,
    contact_email TEXT,
    branch_id UUID REFERENCES branches(id),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. medicines
CREATE TABLE medicines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    generic_name TEXT,
    barcode TEXT,
    category_id UUID REFERENCES categories(id),
    branch_id UUID REFERENCES branches(id),
    unit_name TEXT DEFAULT 'Tablet',
    packaging_name TEXT,
    units_per_packaging INTEGER DEFAULT 1,
    packaging_per_box INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. batches
CREATE TABLE batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medicine_id UUID REFERENCES medicines(id) ON DELETE CASCADE,
    batch_number TEXT NOT NULL,
    expiry_date DATE,
    supplier_id UUID REFERENCES suppliers(id),
    quantity_in_stock INTEGER DEFAULT 0,
    cost_per_unit NUMERIC DEFAULT 0,
    selling_price NUMERIC DEFAULT 0,
    date_added TIMESTAMPTZ DEFAULT now(),
    date_purchased DATE,
    is_expired BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. sales
CREATE TABLE sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date_time TIMESTAMPTZ DEFAULT now(),
    subtotal NUMERIC NOT NULL,
    total_tax NUMERIC NOT NULL,
    total_amount NUMERIC NOT NULL,
    cashier_user_id UUID REFERENCES app_users(id),
    branch_id UUID REFERENCES branches(id),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. sale_items
CREATE TABLE sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
    medicine_id UUID REFERENCES medicines(id),
    batch_id UUID REFERENCES batches(id),
    batch_number TEXT,
    name TEXT,
    quantity INTEGER DEFAULT 0,
    price_at_sale NUMERIC NOT NULL,
    tax_rate_at_sale NUMERIC NOT NULL,
    tax_amount NUMERIC NOT NULL,
    subtotal_item NUMERIC NOT NULL
);

-- 9. activity_logs
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES app_users(id),
    username TEXT,
    action TEXT NOT NULL,
    target_table TEXT,
    target_record_id UUID,
    details JSONB,
    device_name TEXT,
    branch_id UUID REFERENCES branches(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 10. settings
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    branch_id UUID REFERENCES branches(id)
);


-- ==========================================
-- 2. INDEXES
-- ==========================================
CREATE INDEX idx_medicines_barcode ON medicines(barcode);
CREATE INDEX idx_medicines_branch ON medicines(branch_id);
CREATE INDEX idx_batches_medicine ON batches(medicine_id);
CREATE INDEX idx_batches_expiry ON batches(expiry_date);
CREATE INDEX idx_batches_expired ON batches(is_expired);
CREATE INDEX idx_sales_cashier ON sales(cashier_user_id);
CREATE INDEX idx_sales_date ON sales(date_time);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_activity_user ON activity_logs(user_id);
CREATE INDEX idx_activity_date ON activity_logs(created_at);


-- ==========================================
-- 3. RLS POLICIES
-- ==========================================
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Helper to check if user is admin
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin users get FULL access to ALL tables
CREATE POLICY "admin_all_branches" ON branches TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "admin_all_app_users" ON app_users TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "admin_all_categories" ON categories TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "admin_all_suppliers" ON suppliers TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "admin_all_medicines" ON medicines TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "admin_all_batches" ON batches TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "admin_all_sales" ON sales TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "admin_all_sale_items" ON sale_items TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "admin_all_activity_logs" ON activity_logs TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "admin_all_settings" ON settings TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Pharmacist users can READ all inventory tables
CREATE POLICY "pharmacist_read_branches" ON branches FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'pharmacist'));
CREATE POLICY "pharmacist_read_categories" ON categories FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'pharmacist'));
CREATE POLICY "pharmacist_read_suppliers" ON suppliers FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'pharmacist'));
CREATE POLICY "pharmacist_read_medicines" ON medicines FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'pharmacist'));
CREATE POLICY "pharmacist_read_batches" ON batches FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'pharmacist'));
CREATE POLICY "pharmacist_read_settings" ON settings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'pharmacist'));

-- Pharmacist can READ their own app_users row
CREATE POLICY "pharmacist_read_self" ON app_users FOR SELECT TO authenticated USING (id = auth.uid());

-- Pharmacist can READ their own sales
CREATE POLICY "pharmacist_read_own_sales" ON sales FOR SELECT TO authenticated USING (cashier_user_id = auth.uid());

-- sale_items read policy (pharmacist can read items of their own sales)
CREATE POLICY "pharmacist_read_own_sale_items" ON sale_items FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM sales WHERE sales.id = sale_items.sale_id AND sales.cashier_user_id = auth.uid())
);

-- CRITICAL FIX 2: Tighten sale_items INSERT policy
CREATE POLICY "create_items" ON sale_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM sales WHERE sales.id = sale_items.sale_id AND sales.cashier_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'admin')
  );


-- ==========================================
-- 4. STORED PROCEDURES (SECURITY DEFINER)
-- ==========================================

-- CRITICAL FIX 1: process_sale
CREATE OR REPLACE FUNCTION process_sale(
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
    -- Verify caller
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Get branch
    SELECT branch_id INTO v_branch_id FROM app_users WHERE id = v_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found in app_users';
    END IF;

    -- Insert sale
    INSERT INTO sales (
        id, date_time, subtotal, total_tax, total_amount, cashier_user_id, branch_id
    ) VALUES (
        p_sale_id, now(), p_subtotal, p_total_tax, p_total_amount, v_user_id, v_branch_id
    );

    -- Loop through items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_sale_item_id := gen_random_uuid();
        
        -- Deduct stock
        UPDATE batches 
        SET quantity_in_stock = quantity_in_stock - (v_item->>'quantity')::INTEGER
        WHERE id = (v_item->>'batch_id')::UUID;

        -- Check negative stock
        IF EXISTS (SELECT 1 FROM batches WHERE id = (v_item->>'batch_id')::UUID AND quantity_in_stock < 0) THEN
            RAISE EXCEPTION 'Negative stock not allowed for batch %', v_item->>'batch_number';
        END IF;

        -- Insert sale_item
        INSERT INTO sale_items (
            id, sale_id, medicine_id, batch_id, batch_number, name, quantity,
            price_at_sale, tax_rate_at_sale, tax_amount, subtotal_item
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
            (v_item->>'subtotal_item')::NUMERIC
        );
    END LOOP;

    RETURN p_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Delete sale and restore stock
CREATE OR REPLACE FUNCTION delete_sale_restore_stock(
    p_sale_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_item RECORD;
BEGIN
    -- Verify admin
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Requires admin role';
    END IF;

    -- Restore stock
    FOR v_item IN SELECT batch_id, quantity FROM sale_items WHERE sale_id = p_sale_id
    LOOP
        UPDATE batches 
        SET quantity_in_stock = quantity_in_stock + v_item.quantity
        WHERE id = v_item.batch_id;
    END LOOP;

    -- Delete sale (sale_items cascade automatically based on schema ON DELETE CASCADE)
    DELETE FROM sales WHERE id = p_sale_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Update expired batches
CREATE OR REPLACE FUNCTION update_expired_batches()
RETURNS VOID AS $$
BEGIN
    UPDATE batches
    SET is_expired = TRUE
    WHERE expiry_date < CURRENT_DATE AND is_expired = FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
