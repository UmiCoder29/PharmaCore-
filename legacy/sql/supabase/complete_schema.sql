-- ==============================================================================
-- PharmaCore ERP + POS — Master Multi-Tenant SaaS Database Schema & Seed Data
-- ==============================================================================
-- 1 Super Admin | 5 Pharmacies (SaaS Tenants) | SESSI Tender Medicine Dataset
-- Suppliers: M/s. AMDANI MEDICINE COMPANY & M/s. AORTA ENTERPRISES (47 Items)
-- ==============================================================================
-- INSTRUCTIONS:
-- 1. Open your Supabase Dashboard (or PostgreSQL client: DBeaver / pgAdmin / psql)
-- 2. Navigate to SQL Editor -> New Query
-- 3. Copy and paste the entire contents of this file, then click RUN.
-- ==============================================================================

BEGIN;

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
    city TEXT DEFAULT 'Karachi',
    tax_number TEXT,
    logo_url TEXT,
    plan_tier TEXT NOT NULL DEFAULT 'trial' CHECK (plan_tier IN ('trial', 'starter', 'professional', 'enterprise')),
    subscription_status TEXT NOT NULL DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
    trial_ends_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '14 days'),
    subscription_ends_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '365 days'),
    max_branches INTEGER NOT NULL DEFAULT 5 CHECK (max_branches > 0),
    max_users INTEGER NOT NULL DEFAULT 15 CHECK (max_users > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2.1 Branches (Locations / Store Outlets per Pharmacy)
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
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
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

-- 2.4 Suppliers (Vendors & Distributors)
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

-- 2.5 Medicines (Drug Catalog)
CREATE TABLE IF NOT EXISTS public.medicines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    generic_name TEXT,
    barcode TEXT,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    unit_name TEXT DEFAULT 'Tablet',
    packaging_name TEXT DEFAULT 'Strip',
    units_per_packaging INTEGER DEFAULT 10,
    packaging_per_box INTEGER DEFAULT 20,
    prescription_required BOOLEAN NOT NULL DEFAULT FALSE,
    controlled_schedule TEXT,
    reorder_level INTEGER NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2.6 Batches (Inventory Stock per Batch)
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

-- 2.9 Sales (Transactions & POS Invoices)
CREATE TABLE IF NOT EXISTS public.sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    invoice_number TEXT,
    date_time TIMESTAMPTZ DEFAULT now(),
    subtotal NUMERIC NOT NULL,
    total_tax NUMERIC NOT NULL DEFAULT 0,
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

-- 2.10 Sale Items (Line items per sale)
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
    tax_rate_at_sale NUMERIC NOT NULL DEFAULT 0,
    tax_amount NUMERIC NOT NULL DEFAULT 0,
    subtotal_item NUMERIC NOT NULL,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL
);

-- 2.11 Sale Payments (Split / Multi-Payment Allocations)
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

-- 2.14 Activity Logs (Audit Trail)
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

-- 2.15 Settings (Per Pharmacy Configuration)
CREATE TABLE IF NOT EXISTS public.settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT settings_pharmacy_key_branch_unique UNIQUE (pharmacy_id, key, branch_id)
);

-- 2.16 Subscription Inquiries (Tenant Upgrade Requests & In-App Support Chat)
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

-- 2.17 Subscription Plans (SaaS Pricing & Limits)
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

-- ------------------------------------------------------------------------------
-- 5. ROW-LEVEL SECURITY (RLS) POLICIES
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
ALTER TABLE public.subscription_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pharmacies_select" ON public.pharmacies;
CREATE POLICY "pharmacies_select" ON public.pharmacies FOR SELECT TO authenticated USING (id = public.get_user_pharmacy_id() OR public.is_superadmin());
DROP POLICY IF EXISTS "pharmacies_admin_update" ON public.pharmacies;
CREATE POLICY "pharmacies_admin_update" ON public.pharmacies FOR UPDATE TO authenticated USING ((id = public.get_user_pharmacy_id() AND public.is_admin()) OR public.is_superadmin());
DROP POLICY IF EXISTS "pharmacies_superadmin_all" ON public.pharmacies;
CREATE POLICY "pharmacies_superadmin_all" ON public.pharmacies FOR ALL TO authenticated USING (public.is_superadmin());

DROP POLICY IF EXISTS "read_branches" ON public.branches;
CREATE POLICY "read_branches" ON public.branches FOR SELECT TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND (id = public.get_user_branch_id() OR public.can_view_all_branches())));
DROP POLICY IF EXISTS "admin_write_branches" ON public.branches;
CREATE POLICY "admin_write_branches" ON public.branches FOR ALL TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "read_app_users" ON public.app_users;
CREATE POLICY "read_app_users" ON public.app_users FOR SELECT TO authenticated USING (public.is_superadmin() OR id = auth.uid() OR (pharmacy_id = public.get_user_pharmacy_id() AND (public.is_admin() OR branch_id = public.get_user_branch_id() OR public.can_view_all_branches())));
DROP POLICY IF EXISTS "admin_write_app_users" ON public.app_users;
CREATE POLICY "admin_write_app_users" ON public.app_users FOR ALL TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "read_categories" ON public.categories;
CREATE POLICY "read_categories" ON public.categories FOR SELECT TO authenticated USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());
DROP POLICY IF EXISTS "admin_write_categories" ON public.categories;
CREATE POLICY "admin_write_categories" ON public.categories FOR ALL TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "read_suppliers" ON public.suppliers;
CREATE POLICY "read_suppliers" ON public.suppliers FOR SELECT TO authenticated USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());
DROP POLICY IF EXISTS "admin_write_suppliers" ON public.suppliers;
CREATE POLICY "admin_write_suppliers" ON public.suppliers FOR ALL TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "read_medicines" ON public.medicines;
CREATE POLICY "read_medicines" ON public.medicines FOR SELECT TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches() OR branch_id IS NULL)));
DROP POLICY IF EXISTS "admin_write_medicines" ON public.medicines;
CREATE POLICY "admin_write_medicines" ON public.medicines FOR ALL TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "read_batches" ON public.batches;
CREATE POLICY "read_batches" ON public.batches FOR SELECT TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches() OR branch_id IS NULL)));
DROP POLICY IF EXISTS "admin_write_batches" ON public.batches;
CREATE POLICY "admin_write_batches" ON public.batches FOR ALL TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "customers_access" ON public.customers;
CREATE POLICY "customers_access" ON public.customers FOR ALL TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches() OR public.is_admin()))) WITH CHECK (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id()));

DROP POLICY IF EXISTS "prescriptions_access" ON public.prescriptions;
CREATE POLICY "prescriptions_access" ON public.prescriptions FOR ALL TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches() OR public.is_admin()))) WITH CHECK (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id()));

DROP POLICY IF EXISTS "read_sales" ON public.sales;
CREATE POLICY "read_sales" ON public.sales FOR SELECT TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches())));
DROP POLICY IF EXISTS "write_sales" ON public.sales;
CREATE POLICY "write_sales" ON public.sales FOR INSERT TO authenticated WITH CHECK (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id()));
DROP POLICY IF EXISTS "admin_modify_sales" ON public.sales;
CREATE POLICY "admin_modify_sales" ON public.sales FOR UPDATE TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));
DROP POLICY IF EXISTS "admin_delete_sales" ON public.sales;
CREATE POLICY "admin_delete_sales" ON public.sales FOR DELETE TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "read_sale_items" ON public.sale_items;
CREATE POLICY "read_sale_items" ON public.sale_items FOR SELECT TO authenticated USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());
DROP POLICY IF EXISTS "write_sale_items" ON public.sale_items;
CREATE POLICY "write_sale_items" ON public.sale_items FOR INSERT TO authenticated WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "sale_payments_access" ON public.sale_payments;
CREATE POLICY "sale_payments_access" ON public.sale_payments FOR SELECT TO authenticated USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());
DROP POLICY IF EXISTS "write_sale_payments" ON public.sale_payments;
CREATE POLICY "write_sale_payments" ON public.sale_payments FOR INSERT TO authenticated WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "read_returns" ON public.returns;
CREATE POLICY "read_returns" ON public.returns FOR SELECT TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND (branch_id = public.get_user_branch_id() OR public.can_view_all_branches())));
DROP POLICY IF EXISTS "write_returns" ON public.returns;
CREATE POLICY "write_returns" ON public.returns FOR INSERT TO authenticated WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "read_return_items" ON public.return_items;
CREATE POLICY "read_return_items" ON public.return_items FOR SELECT TO authenticated USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());
DROP POLICY IF EXISTS "write_return_items" ON public.return_items;
CREATE POLICY "write_return_items" ON public.return_items FOR INSERT TO authenticated WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "read_activity_logs" ON public.activity_logs;
CREATE POLICY "read_activity_logs" ON public.activity_logs FOR SELECT TO authenticated USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());
DROP POLICY IF EXISTS "write_activity_logs" ON public.activity_logs;
CREATE POLICY "write_activity_logs" ON public.activity_logs FOR INSERT TO authenticated WITH CHECK (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "read_settings" ON public.settings;
CREATE POLICY "read_settings" ON public.settings FOR SELECT TO authenticated USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());
DROP POLICY IF EXISTS "admin_write_settings" ON public.settings;
CREATE POLICY "admin_write_settings" ON public.settings FOR ALL TO authenticated USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

DROP POLICY IF EXISTS "read_subscription_inquiries" ON public.subscription_inquiries;
CREATE POLICY "read_subscription_inquiries" ON public.subscription_inquiries FOR SELECT TO authenticated USING (public.is_superadmin() OR pharmacy_id = public.get_user_pharmacy_id());
DROP POLICY IF EXISTS "write_subscription_inquiries" ON public.subscription_inquiries;
CREATE POLICY "write_subscription_inquiries" ON public.subscription_inquiries FOR INSERT TO authenticated WITH CHECK (public.is_superadmin() OR pharmacy_id = public.get_user_pharmacy_id());
DROP POLICY IF EXISTS "update_subscription_inquiries" ON public.subscription_inquiries;
CREATE POLICY "update_subscription_inquiries" ON public.subscription_inquiries FOR UPDATE TO authenticated USING (public.is_superadmin() OR pharmacy_id = public.get_user_pharmacy_id());

DROP POLICY IF EXISTS "read_subscription_plans" ON public.subscription_plans;
CREATE POLICY "read_subscription_plans" ON public.subscription_plans FOR SELECT TO authenticated, anon USING (is_active = true OR public.is_superadmin());
DROP POLICY IF EXISTS "admin_write_subscription_plans" ON public.subscription_plans;
CREATE POLICY "admin_write_subscription_plans" ON public.subscription_plans FOR ALL TO authenticated USING (public.is_superadmin());

DROP POLICY IF EXISTS "read_platform_settings" ON public.platform_settings;
CREATE POLICY "read_platform_settings" ON public.platform_settings FOR SELECT TO authenticated, anon USING (true);
DROP POLICY IF EXISTS "admin_write_platform_settings" ON public.platform_settings;
CREATE POLICY "admin_write_platform_settings" ON public.platform_settings FOR ALL TO authenticated USING (public.is_superadmin());

-- ------------------------------------------------------------------------------
-- 6. STORED PROCEDURES & BUSINESS LOGIC RPCS (SECURITY DEFINER)
-- ------------------------------------------------------------------------------

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

    SELECT COALESCE(SUM((p->>'amount')::NUMERIC), 0) INTO v_payment_total
    FROM jsonb_array_elements(COALESCE(p_metadata->'payments', '[]'::JSONB)) p;

    IF v_payment_total > 0 AND abs(v_payment_total - p_total_amount) > 0.01 THEN
        RAISE EXCEPTION 'Payment total must equal the sale total';
    END IF;

    v_invoice_number := 'PC-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(p_sale_id::TEXT, '-', ''), 1, 6));

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
            v_sale_item_id, v_pharmacy_id, p_sale_id, 
            (v_item->>'medicine_id')::UUID, (v_item->>'batch_id')::UUID, 
            v_item->>'batch_number', v_item->>'name', 
            (v_item->>'quantity')::INTEGER, (v_item->>'price_at_sale')::NUMERIC, 
            (v_item->>'tax_rate_at_sale')::NUMERIC, (v_item->>'tax_amount')::NUMERIC, 
            (v_item->>'subtotal_item')::NUMERIC, v_branch_id
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

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        SELECT * INTO v_sale_item FROM public.sale_items WHERE id = (v_item->>'sale_item_id')::UUID;
        IF NOT FOUND THEN RAISE EXCEPTION 'Sale item not found for ID %', v_item->>'sale_item_id'; END IF;
        IF (v_item->>'quantity')::INTEGER > v_sale_item.quantity THEN RAISE EXCEPTION 'Cannot return more quantity than originally sold'; END IF;
        
        v_item_refund := ((v_sale_item.subtotal_item / v_sale_item.quantity) * (v_item->>'quantity')::INTEGER);
        v_total_refund := v_total_refund + v_item_refund;
    END LOOP;

    IF p_refund_method = 'Cash' THEN
        SELECT value::NUMERIC INTO v_threshold FROM public.settings 
        WHERE key = 'refund_approval_threshold' AND (v_pharmacy_id IS NULL OR pharmacy_id = v_pharmacy_id)
        LIMIT 1;
        IF NOT FOUND THEN v_threshold := 5000; END IF;
        IF v_total_refund > v_threshold AND NOT public.is_admin() THEN
            v_status := 'pending';
        END IF;
    END IF;

    INSERT INTO public.returns (
        id, pharmacy_id, sale_id, return_date, refund_method, total_refund_amount, status, processed_by_user_id, branch_id
    ) VALUES (
        p_return_id, v_pharmacy_id, p_sale_id, now(), p_refund_method, v_total_refund, v_status, v_user_id, v_branch_id
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
            WHERE id = v_sale_item.batch_id;
        END IF;
    END LOOP;

    RETURN p_return_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.update_expired_batches()
RETURNS VOID AS $$
BEGIN
    UPDATE public.batches
    SET is_expired = TRUE
    WHERE expiry_date < CURRENT_DATE AND is_expired = FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
        s.id, s.name, s.contact_phone, s.contact_email, s.branch_id,
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

-- ------------------------------------------------------------------------------
-- 7. CLEAN & PURGE PREVIOUS OPERATIONAL DATA
-- ------------------------------------------------------------------------------
TRUNCATE TABLE 
    public.return_items, 
    public.returns, 
    public.sale_payments, 
    public.sale_items, 
    public.sales, 
    public.prescriptions, 
    public.customers, 
    public.batches, 
    public.medicines, 
    public.suppliers, 
    public.categories, 
    public.activity_logs, 
    public.settings, 
    public.subscription_inquiries, 
    public.branches, 
    public.app_users, 
    public.pharmacies CASCADE;

-- ------------------------------------------------------------------------------
-- 8. SEED DATA SETUP (VALID RFC4122 HEX UUIDS)
-- ------------------------------------------------------------------------------

-- 8.1 Subscription Plans
INSERT INTO public.subscription_plans (id, name, slug, description, price_monthly, price_annual, currency, max_branches, max_users, features, badge, is_public, is_active, sort_order)
VALUES
    ('10000000-0000-0000-0000-000000000001', '14-Day Free Trial', 'trial', 'Full feature access for newly registered pharmacies.', 0, 0, 'PKR', 1, 3, '["1 Store Branch", "Up to 3 Staff Logins", "Full POS & Barcode Scanning", "Batch & Expiry Tracking", "Thermal Receipt Printing"]'::JSONB, 'Trial', true, true, 0),
    ('10000000-0000-0000-0000-000000000002', 'Starter Plan', 'starter', 'Designed for single-counter independent retail pharmacy stores.', 3000, 30000, 'PKR', 1, 3, '["1 Store Branch", "Up to 3 Staff Accounts", "Fast POS Register", "Batch Expiry & Low Stock Alerts", "Local Offline Mode & Cloud Sync", "Customer Ledger"]'::JSONB, 'Single Store', true, true, 1),
    ('10000000-0000-0000-0000-000000000003', 'Professional Plan', 'professional', 'For busy pharmacies and growing multi-branch store networks.', 8000, 80000, 'PKR', 5, 15, '["Up to 5 Branch Locations", "Up to 15 Staff Accounts", "Cross-Branch Stock Transfers", "Supplier Profitability & Analytics", "FBR Digital POS Invoicing", "Priority Support"]'::JSONB, 'Most Popular', true, true, 2),
    ('10000000-0000-0000-0000-000000000004', 'Enterprise Tier', 'enterprise', 'For hospital networks, chain pharmacies, and wholesale distributor networks.', 20000, 200000, 'PKR', 50, 100, '["Unlimited Branch Locations", "Unlimited Staff Accounts", "Custom ERP & Accounting APIs", "99.9% Uptime Guarantee", "Dedicated Account Manager", "Custom Role Permissions"]'::JSONB, 'Enterprise', true, true, 3)
ON CONFLICT (slug) DO UPDATE SET
    price_monthly = EXCLUDED.price_monthly,
    price_annual = EXCLUDED.price_annual,
    max_branches = EXCLUDED.max_branches,
    max_users = EXCLUDED.max_users,
    features = EXCLUDED.features;

-- 8.2 Platform Core Settings
INSERT INTO public.platform_settings (key, value, category, description)
VALUES
    ('platform_identity', '{"platformName": "PharmaCore Cloud ERP", "tagline": "Modern Pharmacy SaaS & POS Suite", "supportEmail": "support@pharmacore.pk", "supportPhone": "+92 300 1234567", "companyName": "PharmaCore Technologies Pvt Ltd", "version": "2.4.0"}'::JSONB, 'general', 'Platform branding and contact information displayed across client dashboards.'),
    ('trial_policy', '{"defaultDurationDays": 14, "defaultMaxBranches": 1, "defaultMaxUsers": 3, "allowPublicRegistration": true, "requireCardForTrial": false, "autoLockExpired": true}'::JSONB, 'trial', 'Rules and quotas applied when new pharmacies sign up for free trials.'),
    ('billing_instructions', '{"bankName": "Meezan Bank Ltd", "accountTitle": "PharmaCore Technologies", "accountNumber": "02010108765432", "iban": "PK36MEZN0002010108765432", "jazzcashNumber": "03001234567", "easypaisaNumber": "03001234567", "paymentInstructions": "Please send screenshot of transfer on WhatsApp to +92 300 1234567 with your Pharmacy Name for instant activation."}'::JSONB, 'billing', 'Bank transfer and mobile wallet instructions provided to pharmacy owners for subscription payment.'),
    ('broadcast_announcement', '{"enabled": false, "type": "info", "message": "PharmaCore Cloud update scheduled for Sunday 2:00 AM PKT.", "dismissible": true}'::JSONB, 'broadcast', 'Global system notification banner broadcasted to all connected pharmacy counters.'),
    ('security_policy', '{"minPasswordLength": 8, "sessionTimeoutMinutes": 480, "enforceStrongPassword": true, "maxFailedLoginAttempts": 5}'::JSONB, 'security', 'System-wide security and login policy.')
ON CONFLICT (key) DO NOTHING;

-- 8.3 AUTH USERS (Supabase auth.users for SuperAdmin & Pharmacy Accounts)
-- Default passwords removed. Users are initialized with a randomized temporary hash and forced password change on first login.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud, encrypted_password)
VALUES 
    ('9549c77d-9502-47e1-aea2-83b0a8d3dbf7', 'superadmin@pharmacore.pk', '{"provider":"email","providers":["email"]}'::JSONB, '{"email_verified":true,"role":"superadmin","username":"superadmin","must_change_password":true}'::JSONB, now(), now(), 'authenticated', 'authenticated', crypt(gen_random_uuid()::text, gen_salt('bf'))),
    ('8f6aa64f-192e-4fd7-acc6-8584ce383a40', 'admin@pharmacore.local', '{"provider":"email","providers":["email"]}'::JSONB, '{"email_verified":true,"role":"admin","username":"admin","must_change_password":true}'::JSONB, now(), now(), 'authenticated', 'authenticated', crypt(gen_random_uuid()::text, gen_salt('bf'))),
    ('6fc4acc7-189c-49ee-b093-9478627544f1', 'pharmacist@pharmacore.local', '{"provider":"email","providers":["email"]}'::JSONB, '{"email_verified":true,"role":"pharmacist","username":"pharmacist","must_change_password":true}'::JSONB, now(), now(), 'authenticated', 'authenticated', crypt(gen_random_uuid()::text, gen_salt('bf'))),
    ('4c3fdfbf-3ecc-4a1b-97f1-427727c03d06', 'alshifa@pharmacore.pk', '{"provider":"email","providers":["email"]}'::JSONB, '{"email_verified":true,"role":"admin","username":"alshifa_admin","must_change_password":true}'::JSONB, now(), now(), 'authenticated', 'authenticated', crypt(gen_random_uuid()::text, gen_salt('bf'))),
    ('89937abf-39bf-495f-8552-9809300fa2c0', 'medix@pharmacore.pk', '{"provider":"email","providers":["email"]}'::JSONB, '{"email_verified":true,"role":"admin","username":"medix_admin","must_change_password":true}'::JSONB, now(), now(), 'authenticated', 'authenticated', crypt(gen_random_uuid()::text, gen_salt('bf'))),
    ('c8f5f5f6-cb4d-446f-b8e5-837dc5d34be0', 'khyber@pharmacore.pk', '{"provider":"email","providers":["email"]}'::JSONB, '{"email_verified":true,"role":"admin","username":"khyber_admin","must_change_password":true}'::JSONB, now(), now(), 'authenticated', 'authenticated', crypt(gen_random_uuid()::text, gen_salt('bf'))),
    ('51d752f0-2815-46de-976c-cdba2b25d66b', 'bolan@pharmacore.pk', '{"provider":"email","providers":["email"]}'::JSONB, '{"email_verified":true,"role":"admin","username":"bolan_admin","must_change_password":true}'::JSONB, now(), now(), 'authenticated', 'authenticated', crypt(gen_random_uuid()::text, gen_salt('bf')))
ON CONFLICT (id) DO NOTHING;

-- 8.4 SEED 5 PHARMACIES (SaaS Tenants)
INSERT INTO public.pharmacies (id, name, slug, contact_email, contact_phone, address, city, tax_number, plan_tier, subscription_status, trial_ends_at, subscription_ends_at, max_branches, max_users, is_active)
VALUES 
    ('11111111-1111-1111-1111-111111111111', 'SESSI Central Medical Store (Karachi)', 'sessi-central', 'sessi.central@pharmacore.pk', '+92-21-9924-8111', 'Rashid Minhas Road, Gulshan-e-Iqbal', 'Karachi', 'NTN-0891234-1', 'enterprise', 'active', now() + INTERVAL '365 days', now() + INTERVAL '365 days', 10, 30, TRUE),
    ('22222222-2222-2222-2222-222222222222', 'Al-Shifa Community Pharmacy', 'al-shifa-pharmacy', 'alshifa@pharmacore.pk', '+92-42-3578-8899', 'MM Alam Road, Gulberg III', 'Lahore', 'NTN-1782394-2', 'professional', 'active', now() + INTERVAL '365 days', now() + INTERVAL '365 days', 5, 15, TRUE),
    ('33333333-3333-3333-3333-333333333333', 'Medix Care Pharmacy & Clinic', 'medix-care', 'medix@pharmacore.pk', '+92-51-265-7788', 'Jinnah Super Market, Sector F-7 Markaz', 'Islamabad', 'NTN-2839481-3', 'professional', 'active', now() + INTERVAL '365 days', now() + INTERVAL '365 days', 5, 15, TRUE),
    ('44444444-4444-4444-4444-444444444444', 'Khyber Prime Dispensary', 'khyber-prime', 'khyber@pharmacore.pk', '+92-91-584-1234', 'University Road, Opp. Islamia College', 'Peshawar', 'NTN-3948572-4', 'starter', 'active', now() + INTERVAL '365 days', now() + INTERVAL '365 days', 2, 5, TRUE),
    ('55555555-5555-5555-5555-555555555555', 'Bolan Healthcare Pharmacy', 'bolan-healthcare', 'bolan@pharmacore.pk', '+92-81-282-4567', 'Jinnah Road, Near Civil Hospital', 'Quetta', 'NTN-4859601-5', 'starter', 'active', now() + INTERVAL '365 days', now() + INTERVAL '365 days', 2, 5, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 8.5 SEED BRANCHES
INSERT INTO public.branches (id, pharmacy_id, name, address, phone, is_main_branch)
VALUES 
    -- Pharmacy 1 Branches
    ('aa5f5120-0b9e-4831-8cad-528b5a5095b6', '11111111-1111-1111-1111-111111111111', 'SESSI Main Depot (Saddar)', 'Main Saddar Boulevard, Shahrah-e-Iraq, Karachi', '+92-21-3567-8901', TRUE),
    ('f227b52f-7bde-46f7-ada3-a0f1eced2a52', '11111111-1111-1111-1111-111111111111', 'SESSI Landhi Industrial Dispensary', 'Landhi Industrial Area, Karachi', '+92-21-3501-2345', FALSE),
    ('42c6e69b-a16f-4841-933b-9e6efdd118b2', '11111111-1111-1111-1111-111111111111', 'SESSI SITE Hospital Counter', 'SITE Area, Metroville, Karachi', '+92-21-3256-7890', FALSE),
    -- Pharmacy 2 Branches
    ('20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Al-Shifa Main (Gulberg III)', 'MM Alam Road, Gulberg III, Lahore', '+92-42-3578-8899', TRUE),
    ('20000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Al-Shifa Johar Town Branch', 'Shaukat Khanum Chowk, Johar Town, Lahore', '+92-42-3595-1122', FALSE),
    -- Pharmacy 3 Branches
    ('30000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Medix Care F-7 Branch', 'Sector F-7 Markaz, Islamabad', '+92-51-265-7788', TRUE),
    ('30000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'Medix Care Rawalpindi Outpost', 'The Mall, Saddar, Rawalpindi', '+92-51-556-9900', FALSE),
    -- Pharmacy 4 Branches
    ('40000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'Khyber Prime Main Store', 'University Road, Peshawar', '+92-91-584-1234', TRUE),
    -- Pharmacy 5 Branches
    ('50000000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'Bolan Healthcare Main Store', 'Jinnah Road, Quetta', '+92-81-282-4567', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 8.6 SEED APP USERS (1 SuperAdmin + 5 Pharmacy Accounts)
INSERT INTO public.app_users (id, pharmacy_id, username, display_name, role, branch_id, can_view_all_branches, must_change_password)
VALUES 
    -- SaaS Super Administrator
    ('9549c77d-9502-47e1-aea2-83b0a8d3dbf7', NULL, 'superadmin', 'SaaS Super Administrator', 'superadmin', NULL, TRUE, TRUE),
    -- Pharmacy 1 Users (SESSI)
    ('8f6aa64f-192e-4fd7-acc6-8584ce383a40', '11111111-1111-1111-1111-111111111111', 'admin', 'SESSI Chief Pharmacist', 'admin', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', TRUE, TRUE),
    ('6fc4acc7-189c-49ee-b093-9478627544f1', '11111111-1111-1111-1111-111111111111', 'pharmacist', 'Dispenser Staff (Saddar Counter)', 'pharmacist', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', FALSE, TRUE),
    -- Pharmacy 2 Admin (Al-Shifa)
    ('4c3fdfbf-3ecc-4a1b-97f1-427727c03d06', '22222222-2222-2222-2222-222222222222', 'alshifa_admin', 'Al-Shifa Store Manager', 'admin', '20000000-0000-0000-0000-000000000001', TRUE, TRUE),
    -- Pharmacy 3 Admin (Medix Care)
    ('89937abf-39bf-495f-8552-9809300fa2c0', '33333333-3333-3333-3333-333333333333', 'medix_admin', 'Medix Care Incharge', 'admin', '30000000-0000-0000-0000-000000000001', TRUE, TRUE),
    -- Pharmacy 4 Admin (Khyber Prime)
    ('c8f5f5f6-cb4d-446f-b8e5-837dc5d34be0', '44444444-4444-4444-4444-444444444444', 'khyber_admin', 'Khyber Prime Administrator', 'admin', '40000000-0000-0000-0000-000000000001', TRUE, TRUE),
    -- Pharmacy 5 Admin (Bolan Healthcare)
    ('51d752f0-2815-46de-976c-cdba2b25d66b', '55555555-5555-5555-5555-555555555555', 'bolan_admin', 'Bolan Healthcare Lead', 'admin', '50000000-0000-0000-0000-000000000001', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 8.7 SEED CATEGORIES FOR PHARMACIES
INSERT INTO public.categories (id, pharmacy_id, name, description, tax_rate, branch_id)
VALUES 
    ('c0000001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Analgesics & Antipyretics', 'Pain relief, fever & anti-inflammatory medicines', 0, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('c0000001-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Antibiotics & Anti-Infectives', 'Oral & injectable antibiotics, antimicrobials', 0, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('c0000001-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Gastroenterology & Antacids', 'Anti-ulcerants, antacids, gastric suspensions', 0, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('c0000001-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Anesthesia & Surgical', 'General and local anesthetics, neuromuscular blockers', 0, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('c0000001-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Psychotropics & Sedatives', 'Controlled schedule sedatives and tranquilizers', 0, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('c0000001-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Ophthalmology (Eye & Ear)', 'Antibiotic & steroid ophthalmic and otic drops', 0, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('c0000001-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Vitamins & Haematinics', 'Multivitamins, B-complex, iron and minerals', 0, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('c0000001-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Cough, Cold & Respiratory', 'Bronchodilators, expectorants and cough syrups', 0, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('c0000001-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Dermatology & Topicals', 'Antiseptics, topical antibiotic powders & creams', 0, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6')
ON CONFLICT (id) DO NOTHING;

-- 8.8 SEED VENDORS (M/s. AMDANI MEDICINE COMPANY & M/s. AORTA ENTERPRISES)
INSERT INTO public.suppliers (id, pharmacy_id, name, contact_phone, contact_email, branch_id)
VALUES 
    -- SESSI Vendors
    ('a0000001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'M/s. AMDANI MEDICINE COMPANY', '+92-21-3262-1100', 'orders@amdani-med.com', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('a0000001-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'M/s. AORTA ENTERPRISES', '+92-21-3438-5522', 'sales@aorta-enterprises.com', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    -- Other Pharmacy Vendors
    ('a0000002-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'M/s. AMDANI MEDICINE COMPANY (Punjab Depot)', '+92-42-3741-2233', 'lahore@amdani-med.com', '20000000-0000-0000-0000-000000000001'),
    ('a0000003-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'M/s. AORTA ENTERPRISES (North Hub)', '+92-51-227-4455', 'islamabad@aorta-enterprises.com', '30000000-0000-0000-0000-000000000001'),
    ('a0000004-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'M/s. AMDANI MEDICINE COMPANY (KPK Branch)', '+92-91-527-6677', 'peshawar@amdani-med.com', '40000000-0000-0000-0000-000000000001'),
    ('a0000005-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'M/s. AMDANI MEDICINE COMPANY (Balochistan Depot)', '+92-81-283-8899', 'quetta@amdani-med.com', '50000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- 8.9 SEED 47 MEDICINES (SESSI Price List from Document 1.webp)
INSERT INTO public.medicines (id, pharmacy_id, name, generic_name, barcode, category_id, branch_id, unit_name, packaging_name, units_per_packaging, packaging_per_box, prescription_required, controlled_schedule, reorder_level, is_active)
VALUES 
    -- Vendor: M/s. AMDANI MEDICINE COMPANY (Items 1 to 43)
    ('d0000001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Inj. Neostigmine 0.5 mg/1ml', 'Neostigmine 2.5mg (Elite)', '896200001001', 'c0000001-0000-0000-0000-000000000004', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Ampoule', 'Box (5 Amps)', 5, 20, TRUE, 'Schedule B', 20, TRUE),
    ('d0000001-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Inj. Suxamethonium Chloride 100mg', 'Suxamethonium Chloride 100mg (Elite)', '896200001002', 'c0000001-0000-0000-0000-000000000004', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Ampoule', 'Box (10 Amps)', 10, 10, TRUE, 'Schedule B', 15, TRUE),
    ('d0000001-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Lignocaine 2% Inj. 10ml', 'Lignocaine 2% (Elite)', '896200001003', 'c0000001-0000-0000-0000-000000000004', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Ampoule', 'Box (50 Amps)', 50, 10, TRUE, 'Schedule B', 25, TRUE),
    ('d0000001-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Tab. Aspirin 300mg', 'Aspirin 300mg (Semos ardin)', '896200001004', 'c0000001-0000-0000-0000-000000000001', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Tablet', 'Jar (1000s)', 1000, 1, FALSE, NULL, 50, TRUE),
    ('d0000001-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Inj. Diclofenac Sodium 75mg', 'Diclofenac Sodium (Elite amros)', '896200001005', 'c0000001-0000-0000-0000-000000000001', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Ampoule', 'Box (100 Amps)', 100, 10, TRUE, NULL, 30, TRUE),
    ('d0000001-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Tab. Diclofenac Sodium 50mg', 'Diclofenac Sodium 50mg (Ardin)', '896200001006', 'c0000001-0000-0000-0000-000000000001', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Tablet', 'Strip (20s)', 20, 25, FALSE, NULL, 40, TRUE),
    ('d0000001-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Tab. Diclofenac Potassium 50mg', 'Diclofenac Potassium 50mg (Friends)', '896200001007', 'c0000001-0000-0000-0000-000000000001', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Tablet', 'Strip (20s)', 20, 25, FALSE, NULL, 40, TRUE),
    ('d0000001-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Syp. Mefenamic Acid 60ml', 'Mefenamic Acid (Epoch, swiss)', '896200001008', 'c0000001-0000-0000-0000-000000000001', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Bottle (60ml)', 1, 50, FALSE, NULL, 30, TRUE),
    ('d0000001-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Tab. Mefenamic Acid 250mg', 'Mefenamic Acid (Eross ardin)', '896200001009', 'c0000001-0000-0000-0000-000000000001', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Tablet', 'Jar (1000s)', 1000, 1, FALSE, NULL, 50, TRUE),
    ('d0000001-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'Paracetamol Paediatric Drops 15ml', 'Paracetamol Drops (Ahson)', '896200001010', 'c0000001-0000-0000-0000-000000000001', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Dropper (15ml)', 1, 50, FALSE, NULL, 30, TRUE),
    ('d0000001-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'Syp. Paracetamol 60ml', 'Paracetamol Syrup 120mg/5ml (Zanctok)', '896200001011', 'c0000001-0000-0000-0000-000000000001', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Bottle (60ml)', 1, 50, FALSE, NULL, 40, TRUE),
    ('d0000001-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'Tab. Paracetamol 500mg', 'Paracetamol 500mg (Eros, Semos)', '896200001012', 'c0000001-0000-0000-0000-000000000001', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Tablet', 'Jar (1000s)', 1000, 1, FALSE, NULL, 100, TRUE),
    ('d0000001-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'Cap. Piroxicam 10mg', 'Piroxicam 10mg (Davis)', '896200001013', 'c0000001-0000-0000-0000-000000000001', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Capsule', 'Strip (20s)', 20, 20, TRUE, NULL, 25, TRUE),
    ('d0000001-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'Tab. Aluminium + Magnesium', 'Aluminium + Magnesium (Swiss)', '896200001014', 'c0000001-0000-0000-0000-000000000003', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Tablet', 'Box (50x10s)', 10, 50, FALSE, NULL, 30, TRUE),
    ('d0000001-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'Susp. Aluminium + Simethicone 120ml', 'Aluminium + Magnesium (Zanctok)', '896200001015', 'c0000001-0000-0000-0000-000000000003', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Bottle (120ml)', 1, 40, FALSE, NULL, 25, TRUE),
    ('d0000001-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', 'Inj. Ranitidine 50mg/2ml', 'Ranitidine (Elite)', '896200001016', 'c0000001-0000-0000-0000-000000000003', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Ampoule', 'Box (5 Amps)', 5, 20, TRUE, NULL, 30, TRUE),
    ('d0000001-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'Syp. Furazolidone 120ml', 'Furazolidone (Zanctokswiss)', '896200001017', 'c0000001-0000-0000-0000-000000000003', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Bottle (120ml)', 1, 40, TRUE, 'Schedule B', 20, TRUE),
    ('d0000001-0000-0000-0000-000000000018', '11111111-1111-1111-1111-111111111111', 'Tab. Furazolidone 100mg', 'Furazolidone 100mg (Ahson/Adamjee)', '896200001018', 'c0000001-0000-0000-0000-000000000003', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Tablet', 'Box (20x10s)', 10, 20, TRUE, 'Schedule B', 25, TRUE),
    ('d0000001-0000-0000-0000-000000000019', '11111111-1111-1111-1111-111111111111', 'Kaolin Pectin Suspension 60ml', 'Kaolin Pectin (Zanctok)', '896200001019', 'c0000001-0000-0000-0000-000000000003', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Bottle (60ml)', 1, 50, FALSE, NULL, 20, TRUE),
    ('d0000001-0000-0000-0000-000000000020', '11111111-1111-1111-1111-111111111111', 'Inj. Ceftriaxone 250mg', 'Ceftriaxone 250mg (Uni-tec)', '896200001020', 'c0000001-0000-0000-0000-000000000002', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Vial', 'Vial Box', 1, 50, TRUE, 'Schedule B', 30, TRUE),
    ('d0000001-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', 'Cap. Doxycycline 100mg', 'Doxycycline 100mg (Swiss)', '896200001021', 'c0000001-0000-0000-0000-000000000002', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Capsule', 'Box (10x10s)', 10, 10, TRUE, 'Schedule B', 30, TRUE),
    ('d0000001-0000-0000-0000-000000000022', '11111111-1111-1111-1111-111111111111', 'Syp. Erythromycin 60ml', 'Erythromycin (Swiss)', '896200001022', 'c0000001-0000-0000-0000-000000000002', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Bottle (60ml)', 1, 40, TRUE, 'Schedule B', 25, TRUE),
    ('d0000001-0000-0000-0000-000000000023', '11111111-1111-1111-1111-111111111111', 'Cap. Lincomycin 500mg', 'Lincomycin 500mg (Swiss)', '896200001023', 'c0000001-0000-0000-0000-000000000002', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Capsule', 'Strip (12s)', 12, 20, TRUE, 'Schedule B', 20, TRUE),
    ('d0000001-0000-0000-0000-000000000024', '11111111-1111-1111-1111-111111111111', 'Syp. Lincomycin 60ml', 'Lincomycin (Swiss/Adamjee)', '896200001024', 'c0000001-0000-0000-0000-000000000002', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Bottle (60ml)', 1, 40, TRUE, 'Schedule B', 20, TRUE),
    ('d0000001-0000-0000-0000-000000000025', '11111111-1111-1111-1111-111111111111', 'Inj. Diazepam 10mg/2ml', 'Diazepam 10mg (SJ&G)', '896200001025', 'c0000001-0000-0000-0000-000000000005', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Ampoule', 'Box (25 Amps)', 25, 10, TRUE, 'Schedule G', 20, TRUE),
    ('d0000001-0000-0000-0000-000000000026', '11111111-1111-1111-1111-111111111111', 'Tab. Diazepam 5mg', 'Diazepam 5mg (Amros/loka)', '896200001026', 'c0000001-0000-0000-0000-000000000005', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Tablet', 'Jar (1000s)', 1000, 1, TRUE, 'Schedule G', 50, TRUE),
    ('d0000001-0000-0000-0000-000000000027', '11111111-1111-1111-1111-111111111111', 'Tab. Chloroquine Phosphate 250mg', 'Chloroquine 250mg (Unexco/ Epoch)', '896200001027', 'c0000001-0000-0000-0000-000000000002', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Tablet', 'Jar (1000s)', 1000, 1, TRUE, 'Schedule B', 40, TRUE),
    ('d0000001-0000-0000-0000-000000000028', '11111111-1111-1111-1111-111111111111', 'Syp. Rifampicin 60ml', 'Rifampicin (Ahson/Adamjee)', '896200001028', 'c0000001-0000-0000-0000-000000000002', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Bottle (60ml)', 1, 40, TRUE, 'Schedule B', 20, TRUE),
    ('d0000001-0000-0000-0000-000000000029', '11111111-1111-1111-1111-111111111111', 'Inj. Vitamin K (Phytomenadione)', 'Vit-K Inj. (Elite)', '896200001029', 'c0000001-0000-0000-0000-000000000007', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Ampoule', 'Box (100 Amps)', 100, 5, TRUE, NULL, 25, TRUE),
    ('d0000001-0000-0000-0000-000000000030', '11111111-1111-1111-1111-111111111111', 'Inj. Dexamethasone 4mg/ml', 'Dexamethasone 4mg (Unitek/SJ&G)', '896200001030', 'c0000001-0000-0000-0000-000000000004', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Ampoule', 'Box (25 Amps)', 25, 20, TRUE, 'Schedule B', 30, TRUE),
    ('d0000001-0000-0000-0000-000000000031', '11111111-1111-1111-1111-111111111111', 'Ammonium Chloride Syrup 60ml', 'Ammonium Chloride (Zanctok)', '896200001031', 'c0000001-0000-0000-0000-000000000008', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Bottle (60ml)', 1, 50, FALSE, NULL, 30, TRUE),
    ('d0000001-0000-0000-0000-000000000032', '11111111-1111-1111-1111-111111111111', 'Inj. Frusemide 20mg/2ml', 'Frusemide (Elite, swiss)', '896200001032', 'c0000001-0000-0000-0000-000000000004', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Ampoule', 'Box (50 Amps)', 50, 10, TRUE, 'Schedule B', 25, TRUE),
    ('d0000001-0000-0000-0000-000000000033', '11111111-1111-1111-1111-111111111111', 'Sodium Acid Citrate Liquid 120ml', 'Sodium Acid Citrate (Zanctok)', '896200001033', 'c0000001-0000-0000-0000-000000000003', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Bottle (120ml)', 1, 40, FALSE, NULL, 20, TRUE),
    ('d0000001-0000-0000-0000-000000000034', '11111111-1111-1111-1111-111111111111', 'Tab. Ferrous Sulphate 200mg', 'Ferrous Sulphate (Dosaco/Alfalah)', '896200001034', 'c0000001-0000-0000-0000-000000000007', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Tablet', 'Jar (1000s)', 1000, 1, FALSE, NULL, 50, TRUE),
    ('d0000001-0000-0000-0000-000000000035', '11111111-1111-1111-1111-111111111111', 'Chloramphenicol Eye Drops 0.5% 10ml', 'Chloramphenicol (Amros, mbl)', '896200001035', 'c0000001-0000-0000-0000-000000000006', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Dropper (10ml)', 1, 50, TRUE, 'Schedule B', 30, TRUE),
    ('d0000001-0000-0000-0000-000000000036', '11111111-1111-1111-1111-111111111111', 'Gentamycin Eye & Ear Drops 10ml', 'Gentamycin (Amros)', '896200001036', 'c0000001-0000-0000-0000-000000000006', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Dropper (10ml)', 1, 50, TRUE, 'Schedule B', 30, TRUE),
    ('d0000001-0000-0000-0000-000000000037', '11111111-1111-1111-1111-111111111111', 'Betamisol-N Eye/Ear Drops 7.5ml', 'Betamethasone + Neomycin (Ahson, Eros)', '896200001037', 'c0000001-0000-0000-0000-000000000006', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Dropper (7.5ml)', 1, 50, TRUE, 'Schedule B', 30, TRUE),
    ('d0000001-0000-0000-0000-000000000038', '11111111-1111-1111-1111-111111111111', 'Inj. B-Complex 2ml', 'B-Complex Inj. (Elite)', '896200001038', 'c0000001-0000-0000-0000-000000000007', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Ampoule', 'Box (25 Amps)', 25, 20, TRUE, NULL, 30, TRUE),
    ('d0000001-0000-0000-0000-000000000039', '11111111-1111-1111-1111-111111111111', 'Syp. B-Complex 60ml', 'B-Complex Syrup (Zanctok)', '896200001039', 'c0000001-0000-0000-0000-000000000007', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Bottle (60ml)', 1, 50, FALSE, NULL, 40, TRUE),
    ('d0000001-0000-0000-0000-000000000040', '11111111-1111-1111-1111-111111111111', 'Tab. B-Complex', 'B-Complex Tablets (Soma, kp1)', '896200001040', 'c0000001-0000-0000-0000-000000000007', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Tablet', 'Jar (1000s)', 1000, 1, FALSE, NULL, 60, TRUE),
    ('d0000001-0000-0000-0000-000000000041', '11111111-1111-1111-1111-111111111111', 'Tab. Multivitamins', 'Multivitamins (K p 1, Regent/ALB)', '896200001041', 'c0000001-0000-0000-0000-000000000007', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Tablet', 'Jar (1000s)', 1000, 1, FALSE, NULL, 60, TRUE),
    ('d0000001-0000-0000-0000-000000000042', '11111111-1111-1111-1111-111111111111', 'Gentamycin Cream 0.1% 10g', 'Gentamycin (Ahson, swiss)', '896200001042', 'c0000001-0000-0000-0000-000000000009', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Tube', 'Tube (10g)', 1, 50, FALSE, NULL, 30, TRUE),
    ('d0000001-0000-0000-0000-000000000043', '11111111-1111-1111-1111-111111111111', 'Neomycin Bacitracin Dusting Powder 10g', 'Neomycin Bacitracin (Swiss, ahson)', '896200001043', 'c0000001-0000-0000-0000-000000000009', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Bottle (10g)', 1, 50, FALSE, NULL, 30, TRUE),

    -- Vendor: M/s. AORTA ENTERPRISES (Items 44 to 47)
    ('d0000001-0000-0000-0000-000000000044', '11111111-1111-1111-1111-111111111111', 'Cosmofer / Iron Sucrose Inj. 2ml', 'Iron Sucrose (Nuecon)', '896200002001', 'c0000001-0000-0000-0000-000000000007', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Ampoule', 'Box (20s)', 20, 5, TRUE, 'Schedule B', 15, TRUE),
    ('d0000001-0000-0000-0000-000000000045', '11111111-1111-1111-1111-111111111111', 'Ophth Dex Eye Drops 5ml', 'Dexamethasone Eye Drops (Opth)', '896200002002', 'c0000001-0000-0000-0000-000000000006', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Dropper (5ml)', 1, 50, TRUE, 'Schedule B', 25, TRUE),
    ('d0000001-0000-0000-0000-000000000046', '11111111-1111-1111-1111-111111111111', 'Ophth Diclofen Eye Drops 5ml', 'Flurbiprofen / Diclofenac (Opth)', '896200002003', 'c0000001-0000-0000-0000-000000000006', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Dropper (5ml)', 1, 50, TRUE, 'Schedule B', 25, TRUE),
    ('d0000001-0000-0000-0000-000000000047', '11111111-1111-1111-1111-111111111111', 'Ophth Levo Eye Drops 5ml', 'Levobunolol 0.5% (Opth)', '896200002004', 'c0000001-0000-0000-0000-000000000006', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6', 'Bottle', 'Dropper (5ml)', 1, 50, TRUE, 'Schedule B', 20, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 8.10 SEED STOCK INVENTORY BATCHES (Derived from SESSI Quoted Rates + Standard Healthcare Markup)
INSERT INTO public.batches (id, pharmacy_id, medicine_id, batch_number, expiry_date, supplier_id, quantity_in_stock, original_quantity, cost_per_unit, selling_price, date_added, date_purchased, is_expired, branch_id)
VALUES 
    -- AMDANI Items
    ('e0000001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000001', 'AMD-07-101A', '2028-06-30', 'a0000001-0000-0000-0000-000000000001', 250, 250, 5.00, 7.50, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000002', 'AMD-07-102A', '2028-05-15', 'a0000001-0000-0000-0000-000000000001', 150, 150, 18.00, 25.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000003', 'AMD-07-103A', '2028-09-20', 'a0000001-0000-0000-0000-000000000001', 500, 500, 9.00, 14.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000004', 'AMD-07-104A', '2028-11-30', 'a0000001-0000-0000-0000-000000000001', 5000, 5000, 0.14, 0.25, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000005', 'AMD-07-105A', '2028-04-10', 'a0000001-0000-0000-0000-000000000001', 600, 600, 1.70, 3.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000006', 'AMD-07-106A', '2028-08-25', 'a0000001-0000-0000-0000-000000000001', 800, 800, 0.25, 0.50, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000007', 'AMD-07-107A', '2028-10-15', 'a0000001-0000-0000-0000-000000000001', 600, 600, 0.45, 0.80, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000008', 'AMD-07-108A', '2028-07-20', 'a0000001-0000-0000-0000-000000000001', 120, 120, 7.25, 12.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000009', 'AMD-07-109A', '2028-12-30', 'a0000001-0000-0000-0000-000000000001', 4000, 4000, 0.15, 0.30, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000010', 'AMD-07-110A', '2028-09-10', 'a0000001-0000-0000-0000-000000000001', 100, 100, 11.00, 18.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000011', 'AMD-07-111A', '2028-06-25', 'a0000001-0000-0000-0000-000000000001', 200, 200, 5.60, 10.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000012', 'AMD-07-112A', '2028-11-20', 'a0000001-0000-0000-0000-000000000001', 8000, 8000, 0.21, 0.40, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000013', 'AMD-07-113A', '2028-08-15', 'a0000001-0000-0000-0000-000000000001', 400, 400, 0.65, 1.20, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000014', 'AMD-07-114A', '2028-05-30', 'a0000001-0000-0000-0000-000000000001', 1500, 1500, 0.30, 0.60, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000015', 'AMD-07-115A', '2028-04-18', 'a0000001-0000-0000-0000-000000000001', 180, 180, 9.00, 16.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000016', 'AMD-07-116A', '2028-07-12', 'a0000001-0000-0000-0000-000000000001', 200, 200, 6.00, 10.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000017', 'AMD-07-117A', '2028-09-05', 'a0000001-0000-0000-0000-000000000001', 150, 150, 11.00, 18.50, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000018', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000018', 'AMD-07-118A', '2028-10-25', 'a0000001-0000-0000-0000-000000000001', 1000, 1000, 0.21, 0.45, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000019', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000019', 'AMD-07-119A', '2028-03-30', 'a0000001-0000-0000-0000-000000000001', 160, 160, 6.50, 12.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000020', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000020', 'AMD-07-120A', '2028-11-15', 'a0000001-0000-0000-0000-000000000001', 350, 350, 24.00, 38.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000021', 'AMD-07-121A', '2028-08-10', 'a0000001-0000-0000-0000-000000000001', 600, 600, 0.75, 1.40, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000022', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000022', 'AMD-07-122A', '2028-06-18', 'a0000001-0000-0000-0000-000000000001', 120, 120, 17.50, 28.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000023', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000023', 'AMD-07-123A', '2028-07-22', 'a0000001-0000-0000-0000-000000000001', 240, 240, 4.33, 7.50, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000024', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000024', 'AMD-07-124A', '2028-05-14', 'a0000001-0000-0000-0000-000000000001', 110, 110, 28.00, 45.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000025', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000025', 'AMD-07-125A', '2028-09-09', 'a0000001-0000-0000-0000-000000000001', 125, 125, 4.00, 8.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000026', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000026', 'AMD-07-126A', '2028-10-10', 'a0000001-0000-0000-0000-000000000001', 3000, 3000, 0.125, 0.30, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000027', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000027', 'AMD-07-127A', '2028-12-15', 'a0000001-0000-0000-0000-000000000001', 2000, 2000, 0.325, 0.65, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000028', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000028', 'AMD-07-128A', '2028-06-30', 'a0000001-0000-0000-0000-000000000001', 100, 100, 22.00, 36.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000029', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000029', 'AMD-07-129A', '2028-08-20', 'a0000001-0000-0000-0000-000000000001', 300, 300, 2.80, 5.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000030', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000030', 'AMD-07-130A', '2028-05-18', 'a0000001-0000-0000-0000-000000000001', 250, 250, 2.00, 4.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000031', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000031', 'AMD-07-131A', '2028-04-12', 'a0000001-0000-0000-0000-000000000001', 140, 140, 4.75, 9.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000032', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000032', 'AMD-07-132A', '2028-07-07', 'a0000001-0000-0000-0000-000000000001', 250, 250, 3.00, 6.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000033', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000033', 'AMD-07-133A', '2028-03-25', 'a0000001-0000-0000-0000-000000000001', 150, 150, 8.00, 15.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000034', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000034', 'AMD-07-134A', '2028-11-10', 'a0000001-0000-0000-0000-000000000001', 3000, 3000, 0.125, 0.25, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000035', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000035', 'AMD-07-135A', '2028-06-05', 'a0000001-0000-0000-0000-000000000001', 120, 120, 4.45, 9.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000036', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000036', 'AMD-07-136A', '2028-09-19', 'a0000001-0000-0000-0000-000000000001', 130, 130, 5.50, 11.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000037', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000037', 'AMD-07-137A', '2028-08-11', 'a0000001-0000-0000-0000-000000000001', 140, 140, 13.00, 22.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000038', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000038', 'AMD-07-138A', '2028-10-02', 'a0000001-0000-0000-0000-000000000001', 250, 250, 2.00, 4.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000039', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000039', 'AMD-07-139A', '2028-05-28', 'a0000001-0000-0000-0000-000000000001', 200, 200, 5.00, 10.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000040', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000040', 'AMD-07-140A', '2028-11-04', 'a0000001-0000-0000-0000-000000000001', 5000, 5000, 0.05, 0.15, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000041', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000041', 'AMD-07-141A', '2028-12-01', 'a0000001-0000-0000-0000-000000000001', 4000, 4000, 0.13, 0.30, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000042', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000042', 'AMD-07-142A', '2028-06-12', 'a0000001-0000-0000-0000-000000000001', 150, 150, 7.00, 14.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000043', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000043', 'AMD-07-143A', '2028-07-19', 'a0000001-0000-0000-0000-000000000001', 160, 160, 9.00, 17.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),

    -- AORTA Items
    ('e0000001-0000-0000-0000-000000000044', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000044', 'AOR-07-201A', '2028-09-14', 'a0000001-0000-0000-0000-000000000002', 120, 120, 39.83, 65.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000045', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000045', 'AOR-07-202A', '2028-08-05', 'a0000001-0000-0000-0000-000000000002', 150, 150, 24.20, 42.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000046', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000046', 'AOR-07-203A', '2028-10-18', 'a0000001-0000-0000-0000-000000000002', 140, 140, 51.26, 85.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('e0000001-0000-0000-0000-000000000047', '11111111-1111-1111-1111-111111111111', 'd0000001-0000-0000-0000-000000000047', 'AOR-07-204A', '2028-07-29', 'a0000001-0000-0000-0000-000000000002', 100, 100, 63.00, 105.00, now(), '2026-08-01', FALSE, 'aa5f5120-0b9e-4831-8cad-528b5a5095b6')
ON CONFLICT (id) DO NOTHING;

-- 8.11 SEED SAMPLE CUSTOMERS (Patients for SESSI & other pharmacies)
INSERT INTO public.customers (id, pharmacy_id, full_name, phone, cnic, address, date_of_birth, allergies, notes, branch_id)
VALUES 
    ('f0000001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Muhammad Tariq Khan', '0300-8245192', '42101-1827391-1', 'Clifton Block 5, Karachi', '1985-06-12', 'Penicillin', 'SESSI Cardholder #SK-9082', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('f0000001-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Fatima Zahra', '0321-9482103', '42201-9281729-2', 'Gulshan-e-Iqbal Block 13-D, Karachi', '1992-03-24', NULL, 'SESSI Cardholder #SK-4412', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('f0000001-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Abdul Rehman Sheikh', '0333-2819401', '35202-8172938-5', 'Korangi Industrial Area, Karachi', '1978-11-05', 'Sulfa drugs', 'Diabetic & Hypertensive', 'aa5f5120-0b9e-4831-8cad-528b5a5095b6'),
    ('f0000001-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'Ayesha Malik', '0345-5192830', '37405-1928374-4', 'Gulberg III, Lahore', '1995-09-18', NULL, 'Regular OPD Patient', '20000000-0000-0000-0000-000000000001'),
    ('f0000001-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333', 'Zubair Ahmed Khan', '0312-7382910', '42301-7261829-3', 'F-7 Markaz, Islamabad', '1982-01-30', 'Aspirin', 'Cardiac Patient', '30000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- 8.12 SEED SAMPLE VERIFIED PRESCRIPTION
INSERT INTO public.prescriptions (id, pharmacy_id, customer_id, prescriber_name, prescriber_registration_no, prescription_date, attachment_reference, status, verified_by_user_id, verified_at, branch_id)
VALUES 
    ('f1000001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'f0000001-0000-0000-0000-000000000001', 'Dr. Farhan Qureshi (MBBS, FCPS)', 'PMDC-48291-S', CURRENT_DATE, 'RX-SESSI-2026-001.pdf', 'verified', '8f6aa64f-192e-4fd7-acc6-8584ce383a40', now(), 'aa5f5120-0b9e-4831-8cad-528b5a5095b6')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 9. PERMISSIONS & POSTGREST SCHEMA CACHE RELOAD
-- ------------------------------------------------------------------------------
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO postgres, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO postgres, anon, authenticated, service_role;

-- Reload Supabase PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
