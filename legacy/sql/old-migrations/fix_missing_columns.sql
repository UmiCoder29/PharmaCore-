-- ==============================================================================
-- PharmaCore Database Schema Update / Fix
-- Run this SQL in your Supabase SQL Editor:
-- Supabase Dashboard -> SQL Editor -> New query -> Paste & Run
-- ==============================================================================

-- 1. Medicines Table: Add missing columns
ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS prescription_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS controlled_schedule TEXT,
  ADD COLUMN IF NOT EXISTS reorder_level INTEGER NOT NULL DEFAULT 10;

-- 2. Customers Table: Add missing columns
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS allergies TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 3. Sales Table: Add missing columns for FBR compliance
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS fbr_invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS fbr_qr_payload TEXT;

-- 4. Ensure SaaS & Platform tables exist
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

CREATE TABLE IF NOT EXISTS public.platform_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    category TEXT DEFAULT 'general',
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
