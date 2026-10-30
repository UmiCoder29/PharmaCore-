-- Migration: 20261030000001_provision_pharmacy.sql
-- Description:
-- 1. Create public.provision_attempts platform table for caller rate limiting.
-- 2. Lock down public.provision_attempts (RLS on, no policies, service_role only).
-- 3. Add unique index on lower(username) on public.app_users.
-- 4. Create public.fn_provision_pharmacy RPC (SECURITY DEFINER, service_role only).
--
-- Rollback instructions:
-- DROP FUNCTION IF EXISTS public.fn_provision_pharmacy(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT);
-- DROP INDEX IF EXISTS public.idx_app_users_username_lower;
-- DROP TABLE IF EXISTS public.provision_attempts CASCADE;

-- ==============================================================================
-- 1. PLATFORM TABLE: provision_attempts (Rate Limiting & Abuse Audit)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.provision_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id UUID NOT NULL,
    outcome TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for sliding-window rate limit checks (10 provisions per hour per superadmin)
CREATE INDEX IF NOT EXISTS idx_provision_attempts_caller_created 
    ON public.provision_attempts(caller_id, created_at);

-- Enable RLS with zero user-facing policies: table is inaccessible to anon & authenticated
ALTER TABLE public.provision_attempts ENABLE ROW LEVEL SECURITY;

-- Explicit privilege lockdown: only service_role (Edge Functions / backend) may read/write
REVOKE ALL ON TABLE public.provision_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.provision_attempts TO service_role;

-- ==============================================================================
-- 2. USERNAME CASE-INSENSITIVE UNIQUE INDEX
-- ==============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username_lower 
    ON public.app_users (lower(username));

-- ==============================================================================
-- 3. PROVISIONING RPC FUNCTION (SECURITY DEFINER, SERVICE_ROLE ONLY)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_provision_pharmacy(
    p_admin_user_id UUID,
    p_pharmacy_name TEXT,
    p_city TEXT,
    p_contact_phone TEXT,
    p_contact_email TEXT,
    p_admin_username TEXT,
    p_admin_display_name TEXT,
    p_branch_name TEXT,
    p_plan_tier TEXT,
    p_caller_user_id UUID,
    p_caller_username TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pharmacy_id UUID := gen_random_uuid();
    v_branch_id UUID := gen_random_uuid();
    v_clean_name TEXT;
    v_clean_email TEXT;
    v_clean_username TEXT;
    v_clean_display_name TEXT;
    v_clean_branch_name TEXT;
    v_clean_city TEXT;
    v_base_slug TEXT;
    v_slug TEXT;
    v_attempt INTEGER;
    v_inserted BOOLEAN := FALSE;
    v_max_branches INTEGER;
    v_max_users INTEGER;
    v_sub_status TEXT;
    v_trial_ends TIMESTAMPTZ;
    v_sub_ends TIMESTAMPTZ;
BEGIN
    -- 1. Validate plan tier from subscription_plans
    SELECT max_branches, max_users 
    INTO v_max_branches, v_max_users
    FROM public.subscription_plans
    WHERE slug = trim(p_plan_tier) AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or inactive subscription plan tier: %', p_plan_tier
            USING ERRCODE = '22023'; -- invalid_parameter_value
    END IF;

    -- 2. Status mapping & subscription duration
    IF trim(p_plan_tier) = 'trial' THEN
        v_sub_status := 'trial';
        v_trial_ends := now() + INTERVAL '14 days';
        v_sub_ends := NULL;
    ELSE
        v_sub_status := 'active';
        v_trial_ends := NULL;
        v_sub_ends := now() + INTERVAL '365 days';
    END IF;

    -- 3. Check username uniqueness (case-insensitive)
    v_clean_username := lower(trim(p_admin_username));
    IF EXISTS (
        SELECT 1 FROM public.app_users 
        WHERE lower(username) = v_clean_username
    ) THEN
        RAISE EXCEPTION 'Admin username is already taken. Please choose a different username.'
            USING ERRCODE = '23505'; -- unique_violation
    END IF;

    -- 4. Clean inputs
    v_clean_name := trim(p_pharmacy_name);
    v_clean_email := lower(trim(p_contact_email));
    v_clean_city := COALESCE(NULLIF(trim(p_city), ''), 'Karachi');
    v_clean_branch_name := COALESCE(NULLIF(trim(p_branch_name), ''), 'Main Branch');
    v_clean_display_name := COALESCE(NULLIF(trim(p_admin_display_name), ''), v_clean_username);

    -- 5. Slug generation with fallback and unique collision retry
    v_base_slug := lower(trim(both '-' from regexp_replace(v_clean_name, '[^a-zA-Z0-9]+', '-', 'g')));

    -- Fallback to 'pharmacy-<random>' if name slugifies to empty (e.g. non-Latin/symbols only)
    IF v_base_slug IS NULL OR v_base_slug = '' THEN
        v_base_slug := 'pharmacy-' || substr(md5(gen_random_uuid()::TEXT), 1, 6);
    END IF;

    v_slug := v_base_slug;

    FOR v_attempt IN 1..10 LOOP
        BEGIN
            INSERT INTO public.pharmacies (
                id,
                name,
                slug,
                contact_email,
                contact_phone,
                city,
                plan_tier,
                subscription_status,
                trial_ends_at,
                subscription_ends_at,
                max_branches,
                max_users,
                is_active
            ) VALUES (
                v_pharmacy_id,
                v_clean_name,
                v_slug,
                v_clean_email,
                NULLIF(trim(p_contact_phone), ''),
                v_clean_city,
                trim(p_plan_tier),
                v_sub_status,
                v_trial_ends,
                v_sub_ends,
                v_max_branches,
                v_max_users,
                TRUE
            );
            v_inserted := TRUE;
            EXIT;
        EXCEPTION
            WHEN unique_violation THEN
                IF v_attempt < 10 THEN
                    -- Append random 4-character hex suffix and retry
                    v_slug := v_base_slug || '-' || substr(md5(gen_random_uuid()::TEXT), 1, 4);
                ELSE
                    RAISE EXCEPTION 'Could not generate unique slug for pharmacy after 10 attempts'
                        USING ERRCODE = '54000';
                END IF;
        END;
    END LOOP;

    IF NOT v_inserted THEN
        RAISE EXCEPTION 'Failed to insert pharmacy tenant'
            USING ERRCODE = '54000';
    END IF;

    -- 6. Insert initial main branch
    INSERT INTO public.branches (
        id,
        pharmacy_id,
        name,
        is_main_branch
    ) VALUES (
        v_branch_id,
        v_pharmacy_id,
        v_clean_branch_name,
        TRUE
    );

    -- 7. Insert admin user profile
    BEGIN
        INSERT INTO public.app_users (
            id,
            pharmacy_id,
            branch_id,
            username,
            display_name,
            role,
            can_view_all_branches,
            must_change_password
        ) VALUES (
            p_admin_user_id,
            v_pharmacy_id,
            v_branch_id,
            v_clean_username,
            v_clean_display_name,
            'admin',
            TRUE,
            TRUE
        );
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'Admin username is already taken. Please choose a different username.'
                USING ERRCODE = '23505';
    END;

    -- 8. Audit trail in activity_logs
    INSERT INTO public.activity_logs (
        pharmacy_id,
        user_id,
        username,
        action,
        target_table,
        target_record_id,
        branch_id,
        device_name,
        details
    ) VALUES (
        v_pharmacy_id,
        p_caller_user_id,
        p_caller_username,
        'provision_pharmacy',
        'pharmacies',
        v_pharmacy_id,
        v_branch_id,
        'supabase-edge-function',
        jsonb_build_object(
            'pharmacy_name', v_clean_name,
            'slug', v_slug,
            'plan_tier', trim(p_plan_tier),
            'admin_user_id', p_admin_user_id,
            'admin_username', v_clean_username,
            'branch_name', v_clean_branch_name
        )
    );

    RETURN jsonb_build_object(
        'pharmacy_id', v_pharmacy_id,
        'pharmacy_name', v_clean_name,
        'slug', v_slug,
        'branch_id', v_branch_id,
        'branch_name', v_clean_branch_name,
        'app_user_id', p_admin_user_id,
        'username', v_clean_username,
        'plan_tier', trim(p_plan_tier),
        'subscription_status', v_sub_status
    );
END;
$$;

-- Explicit privilege lockdown: only service_role (Edge Function) may execute this RPC
REVOKE ALL ON FUNCTION public.fn_provision_pharmacy(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_provision_pharmacy(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT
) TO service_role;
