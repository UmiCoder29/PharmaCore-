-- ==============================================================================
-- PharmaCore ERP + POS — Master Multi-Tenant SaaS Database Schema
-- Compatible with Supabase & PostgreSQL (with Supabase Auth)
-- ==============================================================================
-- This script sets up the full B2B SaaS database schema:
--  1. Extensions
--  2. Core SaaS & Operational Tables
--     (pharmacies [tenants], branches, app_users, categories, suppliers,
--      medicines, batches, customers, prescriptions, sales, sale_items,
--      sale_payments, returns, return_items, activity_logs, settings)
--  3. Indexes & Constraints
--  4. Security Helper Functions (Multi-Tenant & Role Aware)
--  5. Row-Level Security (RLS) Policies (Strict Tenant Isolation)
--  6. Stored Procedures & Business Logic RPCs
--  7. Default Data Seeding & Permissions
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 2. TABLES CREATION
-- ------------------------------------------------------------------------------

-- 2.0 Pharmacies (SaaS Tenants / Organizations)
CREATE TABLE IF NOT EXISTS public.pharmacies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    contact_email TEXT,
    contact_phone TEXT,
    address TEXT,
    city TEXT,
    tax_number TEXT,
    logo_url TEXT,
    plan_tier TEXT NOT NULL DEFAULT 'trial' CHECK (plan_tier IN ('trial', 'starter', 'professional', 'enterprise')),
    subscription_status TEXT NOT NULL DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
    trial_ends_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '14 days'),
    subscription_ends_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '14 days'),
    max_branches INTEGER NOT NULL DEFAULT 1 CHECK (max_branches > 0),
    max_users INTEGER NOT NULL DEFAULT 3 CHECK (max_users > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2.1 Branches (Locations per Pharmacy)
CREATE TABLE IF NOT EXISTS public.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    is_main_branch BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2.2 App Users (linked to Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.app_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    pharmacy_id UUID REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'pharmacist')),
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    can_view_all_branches BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT app_users_pharmacy_check CHECK (
        role = 'superadmin' OR pharmacy_id IS NOT NULL
    )
);

-- 2.3 Categories
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    tax_rate NUMERIC DEFAULT 0,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2.4 Suppliers
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    contact_phone TEXT,
    contact_email TEXT,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2.5 Medicines
CREATE TABLE IF NOT EXISTS public.medicines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    generic_name TEXT,
    barcode TEXT,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    unit_name TEXT DEFAULT 'Tablet',
    packaging_name TEXT,
    units_per_packaging INTEGER DEFAULT 1,
    packaging_per_box INTEGER,
    prescription_required BOOLEAN NOT NULL DEFAULT FALSE,
    controlled_schedule TEXT,
    reorder_level INTEGER NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2.6 Batches (Inventory Stock)
CREATE TABLE IF NOT EXISTS public.batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
    batch_number TEXT NOT NULL,
    expiry_date DATE,
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    quantity_in_stock INTEGER DEFAULT 0,
    original_quantity INTEGER DEFAULT 0,
    cost_per_unit NUMERIC DEFAULT 0,
    selling_price NUMERIC DEFAULT 0,
    date_added TIMESTAMPTZ DEFAULT now(),
    date_purchased DATE,
    is_expired BOOLEAN DEFAULT FALSE,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2.7 Customers / Patients
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT,
    cnic TEXT,
    address TEXT,
    date_of_birth DATE,
    allergies TEXT,
    notes TEXT,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.8 Prescriptions
CREATE TABLE IF NOT EXISTS public.prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    prescriber_name TEXT NOT NULL,
    prescriber_registration_no TEXT,
    prescription_date DATE NOT NULL,
    attachment_reference TEXT,
    status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('pending', 'verified', 'rejected', 'dispensed')),
    verified_by_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.9 Sales (Transactions)
CREATE TABLE IF NOT EXISTS public.sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    invoice_number TEXT,
    date_time TIMESTAMPTZ DEFAULT now(),
    subtotal NUMERIC NOT NULL,
    total_tax NUMERIC NOT NULL,
    total_amount NUMERIC NOT NULL,
    cashier_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    prescription_id UUID REFERENCES public.prescriptions(id) ON DELETE SET NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer', 'credit', 'split')),
    discount_amount NUMERIC NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    cash_received NUMERIC,
    change_amount NUMERIC NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
    notes TEXT,
    fbr_invoice_number TEXT,
    fbr_qr_payload TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2.10 Sale Items
CREATE TABLE IF NOT EXISTS public.sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    medicine_id UUID REFERENCES public.medicines(id) ON DELETE SET NULL,
    batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
    batch_number TEXT,
    name TEXT,
    quantity INTEGER DEFAULT 0,
    price_at_sale NUMERIC NOT NULL,
    tax_rate_at_sale NUMERIC NOT NULL,
    tax_amount NUMERIC NOT NULL,
    subtotal_item NUMERIC NOT NULL,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL
);

-- 2.11 Sale Payments (Split / Multi-payment methods)
CREATE TABLE IF NOT EXISTS public.sale_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer', 'credit')),
    amount NUMERIC NOT NULL CHECK (amount > 0),
    reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.12 Returns / Refunds
CREATE TABLE IF NOT EXISTS public.returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    sale_id UUID REFERENCES public.sales(id) ON DELETE CASCADE,
    return_date TIMESTAMPTZ DEFAULT now(),
    refund_method TEXT NOT NULL CHECK (refund_method IN ('Cash', 'Store Credit')),
    total_refund_amount NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
    processed_by_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2.13 Return Items
CREATE TABLE IF NOT EXISTS public.return_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    return_id UUID NOT NULL REFERENCES public.returns(id) ON DELETE CASCADE,
    sale_item_id UUID REFERENCES public.sale_items(id) ON DELETE SET NULL,
    medicine_id UUID REFERENCES public.medicines(id) ON DELETE SET NULL,
    batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    reason TEXT NOT NULL,
    condition TEXT NOT NULL CHECK (condition IN ('opened', 'unopened', 'N/A')),
    refund_amount NUMERIC NOT NULL DEFAULT 0,
    quarantined BOOLEAN DEFAULT FALSE,
    restored_to_stock BOOLEAN DEFAULT FALSE,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL
);

-- 2.14 Activity Logs
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    username TEXT,
    action TEXT NOT NULL,
    target_table TEXT,
    target_record_id UUID,
    details JSONB,
    device_name TEXT,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2.15 Settings (Per Pharmacy)
CREATE TABLE IF NOT EXISTS public.settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    CONSTRAINT settings_pharmacy_key_branch_unique UNIQUE (pharmacy_id, key, branch_id)
);

-- 2.16 Subscription Inquiries & Upgrade Chat Messages
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

-- 2.17 Subscription Plans (SaaS Tier Builder)
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

-- 2.18 Platform Settings (Global Software-Wide Configuration)
CREATE TABLE IF NOT EXISTS public.platform_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    category TEXT DEFAULT 'general',
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 3. INDEXES & CONSTRAINTS
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pharmacies_slug ON public.pharmacies(slug);
CREATE INDEX IF NOT EXISTS idx_pharmacies_status ON public.pharmacies(subscription_status);
CREATE INDEX IF NOT EXISTS idx_branches_pharmacy ON public.branches(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_app_users_pharmacy ON public.app_users(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_medicines_pharmacy ON public.medicines(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_medicines_barcode ON public.medicines(barcode);
CREATE INDEX IF NOT EXISTS idx_medicines_branch ON public.medicines(branch_id);
CREATE INDEX IF NOT EXISTS idx_medicines_is_active ON public.medicines(is_active);
CREATE INDEX IF NOT EXISTS idx_batches_pharmacy ON public.batches(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_batches_medicine ON public.batches(medicine_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON public.batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_batches_expired ON public.batches(is_expired);
CREATE INDEX IF NOT EXISTS idx_batches_branch ON public.batches(branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_pharmacy ON public.sales(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_sales_cashier ON public.sales(cashier_user_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON public.sales(date_time);
CREATE INDEX IF NOT EXISTS idx_sales_branch ON public.sales(branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON public.sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_pharmacy ON public.sale_items(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_pharmacy ON public.sale_payments(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON public.sale_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_returns_pharmacy ON public.returns(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_returns_sale ON public.returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_return_items_pharmacy ON public.return_items(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_activity_pharmacy ON public.activity_logs(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_activity_user ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_pharmacy ON public.prescriptions(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_customer ON public.prescriptions(customer_id);

CREATE UNIQUE INDEX IF NOT EXISTS sales_pharmacy_invoice_unique ON public.sales(pharmacy_id, invoice_number) WHERE invoice_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customers_pharmacy_phone_unique ON public.customers(pharmacy_id, phone) WHERE phone IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 4. SECURITY & HELPER FUNCTIONS
-- ------------------------------------------------------------------------------

-- 4.1 Check if current user is SuperAdmin (Platform Owner)
CREATE OR REPLACE FUNCTION public.is_superadmin() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role = 'superadmin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4.2 Check if authenticated user is admin or superadmin
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4.3 Get current user's pharmacy ID
CREATE OR REPLACE FUNCTION public.get_user_pharmacy_id() RETURNS UUID AS $$
DECLARE
    v_pharmacy_id UUID;
BEGIN
    SELECT pharmacy_id INTO v_pharmacy_id FROM public.app_users WHERE id = auth.uid();
    RETURN v_pharmacy_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4.4 Get the branch ID of the current authenticated user
CREATE OR REPLACE FUNCTION public.get_user_branch_id() RETURNS UUID AS $$
DECLARE
    v_branch UUID;
BEGIN
    SELECT branch_id INTO v_branch FROM public.app_users WHERE id = auth.uid();
    RETURN v_branch;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4.5 Check if authenticated user can view all branches for their pharmacy
CREATE OR REPLACE FUNCTION public.can_view_all_branches() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.app_users 
        WHERE id = auth.uid() AND (can_view_all_branches = true OR role = 'superadmin')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------------------------
-- 5. ROW-LEVEL SECURITY (RLS) POLICIES — STRICT MULTI-TENANT ISOLATION
-- ------------------------------------------------------------------------------
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

-- 5.0 Pharmacies Policies
DROP POLICY IF EXISTS "pharmacies_select" ON public.pharmacies;
CREATE POLICY "pharmacies_select" ON public.pharmacies FOR SELECT TO authenticated
    USING (id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "pharmacies_admin_update" ON public.pharmacies;
CREATE POLICY "pharmacies_admin_update" ON public.pharmacies FOR UPDATE TO authenticated
    USING ((id = public.get_user_pharmacy_id() AND public.is_admin()) OR public.is_superadmin());

DROP POLICY IF EXISTS "pharmacies_superadmin_all" ON public.pharmacies;
CREATE POLICY "pharmacies_superadmin_all" ON public.pharmacies FOR ALL TO authenticated
    USING (public.is_superadmin());

-- 5.1 Branches Policies
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

-- 5.2 App Users Policies
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

-- 5.3 Categories Policies
DROP POLICY IF EXISTS "read_categories" ON public.categories;
CREATE POLICY "read_categories" ON public.categories FOR SELECT TO authenticated
    USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "admin_write_categories" ON public.categories;
CREATE POLICY "admin_write_categories" ON public.categories FOR ALL TO authenticated
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

-- 5.4 Suppliers Policies
DROP POLICY IF EXISTS "read_suppliers" ON public.suppliers;
CREATE POLICY "read_suppliers" ON public.suppliers FOR SELECT TO authenticated
    USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "admin_write_suppliers" ON public.suppliers;
CREATE POLICY "admin_write_suppliers" ON public.suppliers FOR ALL TO authenticated
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

-- 5.5 Medicines Policies
DROP POLICY IF EXISTS "read_medicines" ON public.medicines;
CREATE POLICY "read_medicines" ON public.medicines FOR SELECT TO authenticated
    USING (
        public.is_superadmin() OR
        (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches() OR branch_id IS NULL))
    );

DROP POLICY IF EXISTS "admin_write_medicines" ON public.medicines;
CREATE POLICY "admin_write_medicines" ON public.medicines FOR ALL TO authenticated
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

-- 5.6 Batches Policies
DROP POLICY IF EXISTS "read_batches" ON public.batches;
CREATE POLICY "read_batches" ON public.batches FOR SELECT TO authenticated
    USING (
        public.is_superadmin() OR
        (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches() OR branch_id IS NULL))
    );

DROP POLICY IF EXISTS "admin_write_batches" ON public.batches;
CREATE POLICY "admin_write_batches" ON public.batches FOR ALL TO authenticated
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

-- 5.7 Customers Policies
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

-- 5.8 Prescriptions Policies
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

-- 5.9 Sales Policies
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

-- 5.10 Sale Items Policies
DROP POLICY IF EXISTS "read_sale_items" ON public.sale_items;
CREATE POLICY "read_sale_items" ON public.sale_items FOR SELECT TO authenticated
    USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "write_sale_items" ON public.sale_items;
CREATE POLICY "write_sale_items" ON public.sale_items FOR INSERT TO authenticated
    WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

-- 5.11 Sale Payments Policies
DROP POLICY IF EXISTS "sale_payments_access" ON public.sale_payments;
CREATE POLICY "sale_payments_access" ON public.sale_payments FOR SELECT TO authenticated
    USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "write_sale_payments" ON public.sale_payments;
CREATE POLICY "write_sale_payments" ON public.sale_payments FOR INSERT TO authenticated
    WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

-- 5.12 Returns Policies
DROP POLICY IF EXISTS "read_returns" ON public.returns;
CREATE POLICY "read_returns" ON public.returns FOR SELECT TO authenticated
    USING (
        public.is_superadmin() OR
        (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches()))
    );

DROP POLICY IF EXISTS "write_returns" ON public.returns;
CREATE POLICY "write_returns" ON public.returns FOR INSERT TO authenticated
    WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

-- 5.13 Return Items Policies
DROP POLICY IF EXISTS "read_return_items" ON public.return_items;
CREATE POLICY "read_return_items" ON public.return_items FOR SELECT TO authenticated
    USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "write_return_items" ON public.return_items;
CREATE POLICY "write_return_items" ON public.return_items FOR INSERT TO authenticated
    WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

-- 5.14 Activity Logs Policies
DROP POLICY IF EXISTS "read_activity_logs" ON public.activity_logs;
CREATE POLICY "read_activity_logs" ON public.activity_logs FOR SELECT TO authenticated
    USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "write_activity_logs" ON public.activity_logs;
CREATE POLICY "write_activity_logs" ON public.activity_logs FOR INSERT TO authenticated
    WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

-- 5.15 Settings Policies
DROP POLICY IF EXISTS "read_settings" ON public.settings;
CREATE POLICY "read_settings" ON public.settings FOR SELECT TO authenticated
    USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "admin_write_settings" ON public.settings;
CREATE POLICY "admin_write_settings" ON public.settings FOR ALL TO authenticated
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

-- 5.16 Subscription Inquiries & Chat Policies
ALTER TABLE public.subscription_inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_subscription_inquiries" ON public.subscription_inquiries;
CREATE POLICY "read_subscription_inquiries" ON public.subscription_inquiries FOR SELECT TO authenticated
    USING (public.is_superadmin() OR pharmacy_id = public.get_user_pharmacy_id());

DROP POLICY IF EXISTS "write_subscription_inquiries" ON public.subscription_inquiries;
CREATE POLICY "write_subscription_inquiries" ON public.subscription_inquiries FOR INSERT TO authenticated
    WITH CHECK (public.is_superadmin() OR pharmacy_id = public.get_user_pharmacy_id());

DROP POLICY IF EXISTS "update_subscription_inquiries" ON public.subscription_inquiries;
CREATE POLICY "update_subscription_inquiries" ON public.subscription_inquiries FOR UPDATE TO authenticated
    USING (public.is_superadmin() OR pharmacy_id = public.get_user_pharmacy_id());

-- 5.17 Subscription Plans Policies
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_subscription_plans" ON public.subscription_plans;
CREATE POLICY "read_subscription_plans" ON public.subscription_plans FOR SELECT TO authenticated, anon
    USING (is_active = true OR public.is_superadmin());

DROP POLICY IF EXISTS "admin_write_subscription_plans" ON public.subscription_plans;
CREATE POLICY "admin_write_subscription_plans" ON public.subscription_plans FOR ALL TO authenticated
    USING (public.is_superadmin());

-- 5.18 Platform Settings Policies
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_platform_settings" ON public.platform_settings;
CREATE POLICY "read_platform_settings" ON public.platform_settings FOR SELECT TO authenticated, anon
    USING (true);

DROP POLICY IF EXISTS "admin_write_platform_settings" ON public.platform_settings;
CREATE POLICY "admin_write_platform_settings" ON public.platform_settings FOR ALL TO authenticated
    USING (public.is_superadmin());

-- ------------------------------------------------------------------------------
-- 6. STORED PROCEDURES & BUSINESS LOGIC RPCS (SECURITY DEFINER)
-- ------------------------------------------------------------------------------

-- 6.1 Process Sale (Atomic Transaction with Pharmacy Validation, Stock Deduction & Invoice Gen)
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

    -- Extract metadata if provided
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

    -- Validate split payment sum if payments array is supplied
    SELECT COALESCE(SUM((p->>'amount')::NUMERIC), 0) INTO v_payment_total
    FROM jsonb_array_elements(COALESCE(p_metadata->'payments', '[]'::JSONB)) p;

    IF v_payment_total > 0 AND abs(v_payment_total - p_total_amount) > 0.01 THEN
        RAISE EXCEPTION 'Payment total must equal the sale total';
    END IF;

    -- Generate invoice number
    v_invoice_number := 'PC-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(p_sale_id::TEXT, '-', ''), 1, 6));

    -- Insert parent sale record
    INSERT INTO public.sales (
        id, pharmacy_id, invoice_number, date_time, subtotal, total_tax, total_amount, cashier_user_id, branch_id,
        customer_id, prescription_id, payment_method, discount_amount, cash_received, change_amount, notes
    ) VALUES (
        p_sale_id, v_pharmacy_id, v_invoice_number, now(), p_subtotal, p_total_tax, p_total_amount, v_user_id, v_branch_id,
        v_customer_id, v_prescription_id, COALESCE(p_metadata->>'payment_method', 'cash'),
        COALESCE((p_metadata->>'discount_amount')::NUMERIC, 0), NULLIF(p_metadata->>'cash_received', '')::NUMERIC,
        COALESCE((p_metadata->>'change_amount')::NUMERIC, 0), NULLIF(p_metadata->>'notes', '')
    );

    -- Loop through items: deduct stock & insert line items
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

    -- Insert individual payment rows if split payments were recorded
    FOR v_payment IN SELECT * FROM jsonb_array_elements(COALESCE(p_metadata->'payments', '[]'::JSONB)) LOOP
        INSERT INTO public.sale_payments (pharmacy_id, sale_id, method, amount, reference)
        VALUES (v_pharmacy_id, p_sale_id, v_payment->>'method', (v_payment->>'amount')::NUMERIC, NULLIF(v_payment->>'reference', ''));
    END LOOP;

    -- Mark prescription as dispensed
    IF v_prescription_id IS NOT NULL THEN 
        UPDATE public.prescriptions SET status = 'dispensed', updated_at = now() WHERE id = v_prescription_id; 
    END IF;

    RETURN p_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6.2 Process Return (Atomic Return Processing with Quarantine & Restock Logic)
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
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    SELECT pharmacy_id, branch_id INTO v_pharmacy_id, v_branch_id FROM public.app_users WHERE id = v_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'User not found in app_users'; END IF;

    -- Calculate total refund amount based on original sale line items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        SELECT * INTO v_sale_item FROM public.sale_items WHERE id = (v_item->>'sale_item_id')::UUID;
        IF NOT FOUND THEN RAISE EXCEPTION 'Sale item not found for ID %', v_item->>'sale_item_id'; END IF;
        IF (v_item->>'quantity')::INTEGER > v_sale_item.quantity THEN RAISE EXCEPTION 'Cannot return more quantity than originally sold'; END IF;
        
        v_item_refund := ((v_sale_item.subtotal_item / v_sale_item.quantity) * (v_item->>'quantity')::INTEGER);
        v_total_refund := v_total_refund + v_item_refund;
    END LOOP;

    -- Cash refunds exceeding approval threshold require admin approval
    IF p_refund_method = 'Cash' THEN
        SELECT value::NUMERIC INTO v_threshold FROM public.settings 
        WHERE key = 'refund_approval_threshold' AND (v_pharmacy_id IS NULL OR pharmacy_id = v_pharmacy_id)
        LIMIT 1;
        IF NOT FOUND THEN v_threshold := 5000; END IF;
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

    -- Process individual return line items
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

        INSERT INTO public.return_items (
            id, pharmacy_id, return_id, sale_item_id, medicine_id, batch_id, quantity, reason, condition, refund_amount, quarantined, restored_to_stock, branch_id
        ) VALUES (
            v_return_item_id,
            v_pharmacy_id,
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

        -- Restore stock immediately if completed
        IF v_status = 'completed' AND v_restored = TRUE THEN
            UPDATE public.batches 
            SET quantity_in_stock = quantity_in_stock + (v_item->>'quantity')::INTEGER
            WHERE id = v_sale_item.batch_id;
        END IF;
    END LOOP;

    RETURN p_return_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6.3 Approve Return (Admin Approval for High-Value Pending Returns)
CREATE OR REPLACE FUNCTION public.approve_return(
    p_return_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_status TEXT;
    v_item RECORD;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Requires admin role';
    END IF;

    SELECT status INTO v_status FROM public.returns WHERE id = p_return_id;
    IF v_status != 'pending' THEN
        RAISE EXCEPTION 'Return is not pending approval';
    END IF;

    FOR v_item IN SELECT batch_id, quantity, restored_to_stock FROM public.return_items WHERE return_id = p_return_id
    LOOP
        IF v_item.restored_to_stock = TRUE THEN
            UPDATE public.batches 
            SET quantity_in_stock = quantity_in_stock + v_item.quantity
            WHERE id = v_item.batch_id;
        END IF;
    END LOOP;

    UPDATE public.returns SET status = 'completed', updated_at = now() WHERE id = p_return_id;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6.4 Delete Sale & Restore Stock
CREATE OR REPLACE FUNCTION public.delete_sale_restore_stock(
    p_sale_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_item RECORD;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Requires admin role';
    END IF;

    FOR v_item IN SELECT batch_id, quantity FROM public.sale_items WHERE sale_id = p_sale_id
    LOOP
        UPDATE public.batches 
        SET quantity_in_stock = quantity_in_stock + v_item.quantity
        WHERE id = v_item.batch_id;
    END LOOP;

    DELETE FROM public.sales WHERE id = p_sale_id;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6.5 Update Expired Batches Status
CREATE OR REPLACE FUNCTION public.update_expired_batches()
RETURNS VOID AS $$
BEGIN
    UPDATE public.batches
    SET is_expired = TRUE
    WHERE expiry_date < CURRENT_DATE AND is_expired = FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6.6 Supplier Dashboard Stats RPC (Pharmacy-Scoped)
CREATE OR REPLACE FUNCTION public.get_supplier_dashboard_stats()
RETURNS TABLE (
    id UUID,
    name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    branch_id UUID,
    total_spent NUMERIC,
    total_profit_generated NUMERIC,
    last_purchase_date DATE
) AS $$
DECLARE
    v_pharmacy_id UUID := public.get_user_pharmacy_id();
BEGIN
    RETURN QUERY
    SELECT 
        s.id,
        s.name,
        s.contact_phone,
        s.contact_email,
        s.branch_id,
        COALESCE(b_agg.total_spent, 0) AS total_spent,
        COALESCE(si_agg.total_profit, 0) AS total_profit_generated,
        b_agg.last_purchase_date
    FROM public.suppliers s
    LEFT JOIN (
        SELECT supplier_id, 
               SUM(original_quantity * cost_per_unit) AS total_spent,
               MAX(date_purchased) AS last_purchase_date
        FROM public.batches
        WHERE (v_pharmacy_id IS NULL OR pharmacy_id = v_pharmacy_id)
        GROUP BY supplier_id
    ) b_agg ON b_agg.supplier_id = s.id
    LEFT JOIN (
        SELECT b.supplier_id,
               SUM(si.quantity * (si.price_at_sale - b.cost_per_unit)) AS total_profit
        FROM public.sale_items si
        JOIN public.batches b ON b.id = si.batch_id
        WHERE (v_pharmacy_id IS NULL OR si.pharmacy_id = v_pharmacy_id)
        GROUP BY b.supplier_id
    ) si_agg ON si_agg.supplier_id = s.id
    WHERE (v_pharmacy_id IS NULL OR s.pharmacy_id = v_pharmacy_id OR public.is_superadmin());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6.7 Cross-Branch Aggregates RPC (Pharmacy-Scoped)
CREATE OR REPLACE FUNCTION public.get_cross_branch_aggregates(p_date DATE)
RETURNS TABLE (
    branch_id UUID,
    branch_name TEXT,
    total_sales NUMERIC,
    total_returns NUMERIC,
    stock_value NUMERIC
) AS $$
DECLARE
    v_pharmacy_id UUID := public.get_user_pharmacy_id();
BEGIN
    IF NOT public.can_view_all_branches() THEN
        RAISE EXCEPTION 'Access denied. Requires can_view_all_branches privilege.';
    END IF;

    RETURN QUERY
    SELECT 
        b.id as branch_id,
        b.name as branch_name,
        COALESCE(s.total_sales, 0) as total_sales,
        COALESCE(r.total_returns, 0) as total_returns,
        COALESCE(v.stock_value, 0) as stock_value
    FROM public.branches b
    LEFT JOIN (
        SELECT sales.branch_id, SUM(total_amount) as total_sales
        FROM public.sales
        WHERE date_time::DATE = p_date AND (v_pharmacy_id IS NULL OR pharmacy_id = v_pharmacy_id)
        GROUP BY sales.branch_id
    ) s ON s.branch_id = b.id
    LEFT JOIN (
        SELECT returns.branch_id, SUM(total_refund_amount) as total_returns
        FROM public.returns
        WHERE return_date::DATE = p_date AND status = 'completed' AND (v_pharmacy_id IS NULL OR pharmacy_id = v_pharmacy_id)
        GROUP BY returns.branch_id
    ) r ON r.branch_id = b.id
    LEFT JOIN (
        SELECT batches.branch_id, SUM(quantity_in_stock * cost_per_unit) as stock_value
        FROM public.batches
        WHERE quantity_in_stock > 0 AND is_expired = FALSE AND (v_pharmacy_id IS NULL OR pharmacy_id = v_pharmacy_id)
        GROUP BY batches.branch_id
    ) v ON v.branch_id = b.id
    WHERE (v_pharmacy_id IS NULL OR b.pharmacy_id = v_pharmacy_id OR public.is_superadmin());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------------------------
-- 7. DEFAULT SEED PLANS & PLATFORM SETTINGS
-- ------------------------------------------------------------------------------

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

-- ------------------------------------------------------------------------------
-- 8. DEFAULT PERMISSIONS
-- ------------------------------------------------------------------------------
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO postgres, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO postgres, anon, authenticated, service_role;
