-- ==============================================================================
-- PharmaCore ERP + POS — SaaS Multi-Tenant Migration Script
-- Run this script in the Supabase SQL Editor to upgrade your database to SaaS.
-- ==============================================================================

BEGIN;

-- 1. Create Pharmacies Table (SaaS Tenants)
CREATE TABLE IF NOT EXISTS public.pharmacies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    contact_email TEXT,
    contact_phone TEXT,
    address TEXT,
    city TEXT DEFAULT 'Karachi',
    tax_number TEXT,
    logo_url TEXT,
    plan_tier TEXT NOT NULL DEFAULT 'professional' CHECK (plan_tier IN ('trial', 'starter', 'professional', 'enterprise')),
    subscription_status TEXT NOT NULL DEFAULT 'active' CHECK (subscription_status IN ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
    trial_ends_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '14 days'),
    subscription_ends_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '365 days'),
    max_branches INTEGER NOT NULL DEFAULT 5 CHECK (max_branches > 0),
    max_users INTEGER NOT NULL DEFAULT 15 CHECK (max_users > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create Sale Payments table if missing
CREATE TABLE IF NOT EXISTS public.sale_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer', 'credit')),
    amount NUMERIC NOT NULL CHECK (amount > 0),
    reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.1 Create Subscription Inquiries & Chat Messages table if missing
CREATE TABLE IF NOT EXISTS public.subscription_inquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    sender_name TEXT NOT NULL,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('superadmin', 'admin', 'pharmacist')),
    message TEXT NOT NULL,
    inquiry_type TEXT NOT NULL DEFAULT 'upgrade' CHECK (inquiry_type IN ('upgrade', 'billing', 'branch_limit', 'user_limit', 'custom_feature', 'general')),
    requested_plan TEXT,
    is_read_by_superadmin BOOLEAN DEFAULT FALSE,
    is_read_by_pharmacy BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2.2 Create Subscription Plans table if missing
CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    price_monthly NUMERIC NOT NULL DEFAULT 0,
    price_annual NUMERIC DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'PKR',
    max_branches INTEGER NOT NULL DEFAULT 1,
    max_users INTEGER NOT NULL DEFAULT 3,
    features JSONB DEFAULT '[]'::JSONB,
    badge TEXT,
    is_public BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2.3 Create Platform Settings table if missing
CREATE TABLE IF NOT EXISTS public.platform_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    category TEXT DEFAULT 'general',
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed Default Subscription Plans
INSERT INTO public.subscription_plans (id, name, slug, description, price_monthly, price_annual, currency, max_branches, max_users, features, badge, is_public, is_active, sort_order)
VALUES
    ('10000000-0000-0000-0000-000000000001', '14-Day Free Trial', 'trial', 'Full feature access for newly registered pharmacies to test before purchasing.', 0, 0, 'PKR', 1, 3, '["1 Store Branch", "Up to 3 Staff Logins", "Full POS & Barcode Scanning", "Batch & Expiry Tracking", "Thermal Receipt Printing"]'::JSONB, 'Trial', true, true, 0),
    ('10000000-0000-0000-0000-000000000002', 'Starter Plan', 'starter', 'Designed for single-counter independent retail pharmacy stores.', 3000, 30000, 'PKR', 1, 3, '["1 Store Branch", "Up to 3 Staff Accounts", "Fast POS Register", "Batch Expiry & Low Stock Alerts", "Local Offline Mode & Cloud Sync", "Customer Ledger"]'::JSONB, 'Single Store', true, true, 1),
    ('10000000-0000-0000-0000-000000000003', 'Professional Plan', 'professional', 'For busy pharmacies and growing multi-branch store networks.', 8000, 80000, 'PKR', 5, 15, '["Up to 5 Branch Locations", "Up to 15 Staff Accounts", "Cross-Branch Stock Transfers", "Supplier Profitability & Analytics", "FBR Digital POS Invoicing", "Priority Support"]'::JSONB, 'Most Popular', true, true, 2),
    ('10000000-0000-0000-0000-000000000004', 'Enterprise Tier', 'enterprise', 'For hospital networks, chain pharmacies, and wholesale distributor networks.', 20000, 200000, 'PKR', 50, 100, '["Unlimited Branch Locations", "Unlimited Staff Accounts", "Custom ERP & Accounting APIs", "99.9% Uptime Guarantee", "Dedicated Account Manager", "Custom Role Permissions"]'::JSONB, 'Enterprise', true, true, 3)
ON CONFLICT (slug) DO NOTHING;

-- Seed Default Platform Core Settings
INSERT INTO public.platform_settings (key, value, category, description)
VALUES
    ('platform_identity', '{"platformName": "PharmaCore Cloud ERP", "tagline": "Modern Pharmacy SaaS & POS Suite", "supportEmail": "support@pharmacore.pk", "supportPhone": "+92 300 1234567", "companyName": "PharmaCore Technologies Pvt Ltd", "version": "2.4.0"}'::JSONB, 'general', 'Platform branding and contact information displayed across client dashboards.'),
    ('trial_policy', '{"defaultDurationDays": 14, "defaultMaxBranches": 1, "defaultMaxUsers": 3, "allowPublicRegistration": true, "requireCardForTrial": false, "autoLockExpired": true}'::JSONB, 'trial', 'Rules and quotas applied when new pharmacies sign up for free trials.'),
    ('billing_instructions', '{"bankName": "Meezan Bank Ltd", "accountTitle": "PharmaCore Technologies", "accountNumber": "02010108765432", "iban": "PK36MEZN0002010108765432", "jazzcashNumber": "03001234567", "easypaisaNumber": "03001234567", "paymentInstructions": "Please send screenshot of transfer on WhatsApp to +92 300 1234567 with your Pharmacy Name for instant activation."}'::JSONB, 'billing', 'Bank transfer and mobile wallet instructions provided to pharmacy owners for subscription payment.'),
    ('broadcast_announcement', '{"enabled": false, "type": "info", "message": "PharmaCore Cloud update scheduled for Sunday 2:00 AM PKT.", "dismissible": true}'::JSONB, 'broadcast', 'Global system notification banner broadcasted to all connected pharmacy counters.'),
    ('security_policy', '{"minPasswordLength": 8, "sessionTimeoutMinutes": 480, "enforceStrongPassword": true, "maxFailedLoginAttempts": 5}'::JSONB, 'security', 'System-wide security and login policy.')
ON CONFLICT (key) DO NOTHING;

-- 3. Insert Default Primary Pharmacy Tenant for existing data migration
DO $$
DECLARE
    v_default_pharm_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
    INSERT INTO public.pharmacies (
        id, name, slug, contact_email, contact_phone, city, plan_tier, subscription_status, max_branches, max_users
    ) VALUES (
        v_default_pharm_id,
        'PharmaCore Flagship Pharmacy',
        'pharmacore-main',
        'admin@pharmacore.local',
        '+92 21 35876543',
        'Karachi',
        'professional',
        'active',
        5,
        15
    ) ON CONFLICT (id) DO NOTHING;
END $$;

-- 4. Add pharmacy_id column to existing tables and populate with default tenant
DO $$
DECLARE
    v_default_pharm_id UUID := '11111111-1111-1111-1111-111111111111';
    v_tables TEXT[] := ARRAY[
        'branches', 'app_users', 'categories', 'suppliers', 'medicines',
        'batches', 'customers', 'prescriptions', 'sales', 'sale_items',
        'sale_payments', 'returns', 'return_items', 'activity_logs', 'settings'
    ];
    t TEXT;
BEGIN
    FOREACH t IN ARRAY v_tables LOOP
        -- Check if column exists
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = t AND column_name = 'pharmacy_id'
        ) THEN
            EXECUTE format('ALTER TABLE public.%I ADD COLUMN pharmacy_id UUID REFERENCES public.pharmacies(id) ON DELETE CASCADE;', t);
            EXECUTE format('UPDATE public.%I SET pharmacy_id = %L WHERE pharmacy_id IS NULL;', t, v_default_pharm_id);
        END IF;
    END LOOP;
END $$;

-- 5. Update app_users constraints to allow 'superadmin' role
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE public.app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('superadmin', 'admin', 'pharmacist'));

ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_branch_id_check;
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_pharmacy_check;
ALTER TABLE public.app_users ADD CONSTRAINT app_users_pharmacy_check CHECK (role = 'superadmin' OR pharmacy_id IS NOT NULL);

-- 6. Add is_main_branch, address, phone to branches if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'is_main_branch') THEN
        ALTER TABLE public.branches ADD COLUMN is_main_branch BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'address') THEN
        ALTER TABLE public.branches ADD COLUMN address TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'phone') THEN
        ALTER TABLE public.branches ADD COLUMN phone TEXT;
    END IF;
END $$;

-- 7. Add discount_amount, cash_received, change_amount to sales if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'payment_method') THEN
        ALTER TABLE public.sales ADD COLUMN payment_method TEXT DEFAULT 'cash';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'discount_amount') THEN
        ALTER TABLE public.sales ADD COLUMN discount_amount NUMERIC DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'cash_received') THEN
        ALTER TABLE public.sales ADD COLUMN cash_received NUMERIC;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'change_amount') THEN
        ALTER TABLE public.sales ADD COLUMN change_amount NUMERIC DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'invoice_number') THEN
        ALTER TABLE public.sales ADD COLUMN invoice_number TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'notes') THEN
        ALTER TABLE public.sales ADD COLUMN notes TEXT;
    END IF;
END $$;

-- 8. Create Indexes
CREATE INDEX IF NOT EXISTS idx_pharmacies_slug ON public.pharmacies(slug);
CREATE INDEX IF NOT EXISTS idx_pharmacies_status ON public.pharmacies(subscription_status);
CREATE INDEX IF NOT EXISTS idx_branches_pharmacy ON public.branches(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_app_users_pharmacy ON public.app_users(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_medicines_pharmacy ON public.medicines(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_batches_pharmacy ON public.batches(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_sales_pharmacy ON public.sales(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_pharmacy ON public.sale_items(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_customers_pharmacy ON public.customers(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_activity_pharmacy ON public.activity_logs(pharmacy_id);

-- 9. Create Helper Functions
CREATE OR REPLACE FUNCTION public.is_superadmin() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role = 'superadmin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_pharmacy_id() RETURNS UUID AS $$
DECLARE
    v_pharmacy_id UUID;
BEGIN
    SELECT pharmacy_id INTO v_pharmacy_id FROM public.app_users WHERE id = auth.uid();
    RETURN v_pharmacy_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_branch_id() RETURNS UUID AS $$
DECLARE
    v_branch UUID;
BEGIN
    SELECT branch_id INTO v_branch FROM public.app_users WHERE id = auth.uid();
    RETURN v_branch;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.can_view_all_branches() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.app_users 
        WHERE id = auth.uid() AND (can_view_all_branches = true OR role = 'superadmin')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Enable RLS on all tables
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- 11. Multi-Tenant RLS Policies
DROP POLICY IF EXISTS "pharmacies_select" ON public.pharmacies;
CREATE POLICY "pharmacies_select" ON public.pharmacies FOR SELECT TO authenticated
    USING (id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "pharmacies_admin_update" ON public.pharmacies;
CREATE POLICY "pharmacies_admin_update" ON public.pharmacies FOR UPDATE TO authenticated
    USING ((id = public.get_user_pharmacy_id() AND public.is_admin()) OR public.is_superadmin());

DROP POLICY IF EXISTS "pharmacies_superadmin_all" ON public.pharmacies;
CREATE POLICY "pharmacies_superadmin_all" ON public.pharmacies FOR ALL TO authenticated
    USING (public.is_superadmin());

DROP POLICY IF EXISTS "read_branches" ON public.branches;
CREATE POLICY "read_branches" ON public.branches FOR SELECT TO authenticated
    USING (
        public.is_superadmin() OR 
        (pharmacy_id = public.get_user_pharmacy_id() AND (id = public.get_user_branch_id() OR public.can_view_all_branches()))
    );

DROP POLICY IF EXISTS "admin_write_branches" ON public.branches;
CREATE POLICY "admin_write_branches" ON public.branches FOR ALL TO authenticated
    USING (
        public.is_superadmin() OR 
        (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin())
    );

DROP POLICY IF EXISTS "read_app_users" ON public.app_users;
CREATE POLICY "read_app_users" ON public.app_users FOR SELECT TO authenticated
    USING (
        public.is_superadmin() OR
        id = auth.uid() OR
        (pharmacy_id = public.get_user_pharmacy_id() AND (public.is_admin() OR branch_id = public.get_user_branch_id() OR public.can_view_all_branches()))
    );

DROP POLICY IF EXISTS "admin_write_app_users" ON public.app_users;
CREATE POLICY "admin_write_app_users" ON public.app_users FOR ALL TO authenticated
    USING (
        public.is_superadmin() OR
        (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin())
    );

DROP POLICY IF EXISTS "read_categories" ON public.categories;
CREATE POLICY "read_categories" ON public.categories FOR SELECT TO authenticated
    USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "admin_write_categories" ON public.categories;
CREATE POLICY "admin_write_categories" ON public.categories FOR ALL TO authenticated
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "read_suppliers" ON public.suppliers;
CREATE POLICY "read_suppliers" ON public.suppliers FOR SELECT TO authenticated
    USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "admin_write_suppliers" ON public.suppliers;
CREATE POLICY "admin_write_suppliers" ON public.suppliers FOR ALL TO authenticated
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "read_medicines" ON public.medicines;
CREATE POLICY "read_medicines" ON public.medicines FOR SELECT TO authenticated
    USING (
        public.is_superadmin() OR
        (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches() OR branch_id IS NULL))
    );

DROP POLICY IF EXISTS "admin_write_medicines" ON public.medicines;
CREATE POLICY "admin_write_medicines" ON public.medicines FOR ALL TO authenticated
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "read_batches" ON public.batches;
CREATE POLICY "read_batches" ON public.batches FOR SELECT TO authenticated
    USING (
        public.is_superadmin() OR
        (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches() OR branch_id IS NULL))
    );

DROP POLICY IF EXISTS "admin_write_batches" ON public.batches;
CREATE POLICY "admin_write_batches" ON public.batches FOR ALL TO authenticated
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "customers_access" ON public.customers;
CREATE POLICY "customers_access" ON public.customers FOR ALL TO authenticated
    USING (
        public.is_superadmin() OR
        (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches() OR public.is_admin()))
    )
    WITH CHECK (
        public.is_superadmin() OR
        (pharmacy_id = public.get_user_pharmacy_id())
    );

DROP POLICY IF EXISTS "prescriptions_access" ON public.prescriptions;
CREATE POLICY "prescriptions_access" ON public.prescriptions FOR ALL TO authenticated
    USING (
        public.is_superadmin() OR
        (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches() OR public.is_admin()))
    )
    WITH CHECK (
        public.is_superadmin() OR
        (pharmacy_id = public.get_user_pharmacy_id())
    );

DROP POLICY IF EXISTS "read_sales" ON public.sales;
CREATE POLICY "read_sales" ON public.sales FOR SELECT TO authenticated
    USING (
        public.is_superadmin() OR
        (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches()))
    );

DROP POLICY IF EXISTS "write_sales" ON public.sales;
CREATE POLICY "write_sales" ON public.sales FOR INSERT TO authenticated
    WITH CHECK (
        public.is_superadmin() OR
        (pharmacy_id = public.get_user_pharmacy_id())
    );

DROP POLICY IF EXISTS "admin_modify_sales" ON public.sales;
CREATE POLICY "admin_modify_sales" ON public.sales FOR UPDATE TO authenticated
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "admin_delete_sales" ON public.sales;
CREATE POLICY "admin_delete_sales" ON public.sales FOR DELETE TO authenticated
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "read_sale_items" ON public.sale_items;
CREATE POLICY "read_sale_items" ON public.sale_items FOR SELECT TO authenticated
    USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "write_sale_items" ON public.sale_items;
CREATE POLICY "write_sale_items" ON public.sale_items FOR INSERT TO authenticated
    WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "read_returns" ON public.returns;
CREATE POLICY "read_returns" ON public.returns FOR SELECT TO authenticated
    USING (
        public.is_superadmin() OR
        (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches()))
    );

DROP POLICY IF EXISTS "write_returns" ON public.returns;
CREATE POLICY "write_returns" ON public.returns FOR INSERT TO authenticated
    WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "read_return_items" ON public.return_items;
CREATE POLICY "read_return_items" ON public.return_items FOR SELECT TO authenticated
    USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "write_return_items" ON public.return_items;
CREATE POLICY "write_return_items" ON public.return_items FOR INSERT TO authenticated
    WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "read_activity_logs" ON public.activity_logs;
CREATE POLICY "read_activity_logs" ON public.activity_logs FOR SELECT TO authenticated
    USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "write_activity_logs" ON public.activity_logs;
CREATE POLICY "write_activity_logs" ON public.activity_logs FOR INSERT TO authenticated
    WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "read_settings" ON public.settings;
CREATE POLICY "read_settings" ON public.settings FOR SELECT TO authenticated
    USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "admin_write_settings" ON public.settings;
CREATE POLICY "admin_write_settings" ON public.settings FOR ALL TO authenticated
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

-- 12. Update Atomic Stored Procedures
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
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    
    SELECT pharmacy_id, branch_id INTO v_pharmacy_id, v_branch_id FROM public.app_users WHERE id = v_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'User not found in app_users'; END IF;

    -- Verify Subscription Status
    IF v_pharmacy_id IS NOT NULL THEN
        SELECT subscription_status, subscription_ends_at INTO v_sub_status, v_sub_ends FROM public.pharmacies WHERE id = v_pharmacy_id;
        IF v_sub_status IN ('suspended', 'cancelled') THEN
            RAISE EXCEPTION 'Pharmacy subscription is suspended or cancelled. Please contact support.';
        END IF;
        IF v_sub_ends IS NOT NULL AND v_sub_ends < now() THEN
            RAISE EXCEPTION 'Pharmacy subscription has expired. Please renew to continue transactions.';
        END IF;
    END IF;

    v_customer_id := NULLIF(p_metadata->>'customer_id', '')::UUID;
    v_prescription_id := NULLIF(p_metadata->>'prescription_id', '')::UUID;

    -- Check prescription requirements
    SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) i
        JOIN public.medicines m ON m.id = (i->>'medicine_id')::UUID
        WHERE m.prescription_required OR m.controlled_schedule IS NOT NULL
    ) INTO v_needs_prescription;

    IF v_needs_prescription AND (v_customer_id IS NULL OR v_prescription_id IS NULL) THEN
        RAISE EXCEPTION 'A verified prescription and customer are required for prescription or controlled medicines';
    END IF;

    IF v_prescription_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.prescriptions p 
        WHERE p.id = v_prescription_id AND p.customer_id = v_customer_id AND p.status = 'verified'
    ) THEN 
        RAISE EXCEPTION 'Prescription is not verified for this customer'; 
    END IF;

    -- Validate payment total
    SELECT COALESCE(SUM((p->>'amount')::NUMERIC), 0) INTO v_payment_total
    FROM jsonb_array_elements(COALESCE(p_metadata->'payments', '[]'::JSONB)) p;

    IF v_payment_total > 0 AND abs(v_payment_total - p_total_amount) > 0.01 THEN
        RAISE EXCEPTION 'Payment total must equal the sale total';
    END IF;

    v_invoice_number := 'PC-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(p_sale_id::TEXT, '-', ''), 1, 6));

    INSERT INTO public.sales (
        id, pharmacy_id, invoice_number, date_time, subtotal, total_tax, total_amount, cashier_user_id, branch_id,
        customer_id, prescription_id, payment_method, discount_amount, cash_received, change_amount, notes
    ) VALUES (
        p_sale_id, v_pharmacy_id, v_invoice_number, now(), p_subtotal, p_total_tax, p_total_amount, v_user_id, v_branch_id,
        v_customer_id, v_prescription_id, COALESCE(p_metadata->>'payment_method', 'cash'),
        COALESCE((p_metadata->>'discount_amount')::NUMERIC, 0), NULLIF(p_metadata->>'cash_received', '')::NUMERIC,
        COALESCE((p_metadata->>'change_amount')::NUMERIC, 0), NULLIF(p_metadata->>'notes', '')
    );

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        UPDATE public.batches 
        SET quantity_in_stock = quantity_in_stock - (v_item->>'quantity')::INTEGER
        WHERE id = (v_item->>'batch_id')::UUID 
          AND (v_pharmacy_id IS NULL OR pharmacy_id = v_pharmacy_id)
          AND quantity_in_stock >= (v_item->>'quantity')::INTEGER;

        IF NOT FOUND THEN 
            RAISE EXCEPTION 'Insufficient stock for batch %', v_item->>'batch_number'; 
        END IF;

        v_sale_item_id := gen_random_uuid();
        INSERT INTO public.sale_items (
            id, pharmacy_id, sale_id, medicine_id, batch_id, batch_number, name, quantity,
            price_at_sale, tax_rate_at_sale, tax_amount, subtotal_item, branch_id
        ) VALUES (
            v_sale_item_id,
            v_pharmacy_id,
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

    FOR v_payment IN SELECT * FROM jsonb_array_elements(COALESCE(p_metadata->'payments', '[]'::JSONB)) LOOP
        INSERT INTO public.sale_payments (pharmacy_id, sale_id, method, amount, reference)
        VALUES (v_pharmacy_id, p_sale_id, v_payment->>'method', (v_payment->>'amount')::NUMERIC, NULLIF(v_payment->>'reference', ''));
    END LOOP;

    IF v_prescription_id IS NOT NULL THEN 
        UPDATE public.prescriptions SET status = 'dispensed', updated_at = now() WHERE id = v_prescription_id; 
    END IF;

    RETURN p_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 13. Grant Permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO postgres, anon, authenticated, service_role;

COMMIT;
