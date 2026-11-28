-- ==============================================================================
-- PharmaCore Staff User Creation, Rate Limiting & Database User Quota Enforcement
-- File: supabase/migrations/20261127000001_create_staff_user.sql
-- ==============================================================================

-- 1. Platform table for rate limiting staff user creation attempts (10/hour/caller)
CREATE TABLE IF NOT EXISTS public.staff_creation_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id UUID NOT NULL,
    target_username TEXT,
    outcome TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_creation_attempts_caller_created
    ON public.staff_creation_attempts(caller_id, created_at);

ALTER TABLE public.staff_creation_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.staff_creation_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.staff_creation_attempts TO service_role;

-- 2. Database trigger enforcing pharmacies.max_users on public.app_users
-- Closes direct REST API INSERT/UPDATE quota bypasses while allowing NULL pharmacy_id (superadmin)
-- and preserving non-pharmacy-changing UPDATEs.
CREATE OR REPLACE FUNCTION public.fn_enforce_user_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_max_users INTEGER;
    v_user_count INTEGER;
BEGIN
    IF NEW.pharmacy_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND NOT (NEW.pharmacy_id IS DISTINCT FROM OLD.pharmacy_id) THEN
        RETURN NEW;
    END IF;

    -- Lock parent pharmacy row to serialize concurrent insertions
    SELECT max_users INTO v_max_users
    FROM public.pharmacies
    WHERE id = NEW.pharmacy_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pharmacy not found'
            USING ERRCODE = 'P0002';
    END IF;

    -- Count existing users in the pharmacy without counting the row being inserted/moved
    SELECT COUNT(*) INTO v_user_count
    FROM public.app_users
    WHERE pharmacy_id = NEW.pharmacy_id
      AND id <> NEW.id;

    IF v_max_users IS NOT NULL AND v_user_count >= v_max_users THEN
        RAISE EXCEPTION 'User limit reached for this plan'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_user_limit ON public.app_users;
CREATE TRIGGER trg_enforce_user_limit
    BEFORE INSERT OR UPDATE ON public.app_users
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_enforce_user_limit();

REVOKE ALL ON FUNCTION public.fn_enforce_user_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_enforce_user_limit() TO service_role;

-- 3. Transactional RPC to create a pharmacist staff profile, enforce max_users, and write audit log
CREATE OR REPLACE FUNCTION public.fn_create_staff_user(
    p_new_user_id UUID,
    p_pharmacy_id UUID,
    p_branch_id UUID,
    p_username TEXT,
    p_display_name TEXT,
    p_caller_user_id UUID,
    p_caller_username TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean_username TEXT;
    v_clean_display_name TEXT;
    v_max_users INTEGER;
    v_is_active BOOLEAN;
    v_sub_status TEXT;
    v_user_count INTEGER;
BEGIN
    v_clean_username := lower(trim(COALESCE(p_username, '')));
    IF v_clean_username !~ '^[a-z0-9_]{3,50}$' THEN
        RAISE EXCEPTION 'Username must be 3 to 50 lowercase letters, numbers, or underscores.'
            USING ERRCODE = '22023';
    END IF;

    v_clean_display_name := trim(COALESCE(p_display_name, ''));
    IF length(v_clean_display_name) < 2 OR length(v_clean_display_name) > 100 THEN
        RAISE EXCEPTION 'Display name must be between 2 and 100 characters.'
            USING ERRCODE = '22023';
    END IF;

    -- Lock pharmacy row and check active/subscription state
    SELECT max_users, is_active, subscription_status
    INTO v_max_users, v_is_active, v_sub_status
    FROM public.pharmacies
    WHERE id = p_pharmacy_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pharmacy not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_is_active OR v_sub_status IN ('suspended', 'cancelled') THEN
        RAISE EXCEPTION 'Pharmacy subscription is suspended or inactive.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Verify branch belongs to caller's pharmacy
    IF NOT EXISTS (
        SELECT 1 FROM public.branches
        WHERE id = p_branch_id AND pharmacy_id = p_pharmacy_id
    ) THEN
        RAISE EXCEPTION 'Invalid or unavailable branch assignment.'
            USING ERRCODE = '22023';
    END IF;

    -- Enforce pharmacy user quota under lock
    SELECT COUNT(*) INTO v_user_count
    FROM public.app_users
    WHERE pharmacy_id = p_pharmacy_id;

    IF v_max_users IS NOT NULL AND v_user_count >= v_max_users THEN
        RAISE EXCEPTION 'User limit reached for this plan.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Enforce platform-wide case-insensitive username uniqueness
    IF EXISTS (
        SELECT 1 FROM public.app_users
        WHERE lower(username) = v_clean_username
    ) THEN
        RAISE EXCEPTION 'Username is already taken. Please choose a different username.'
            USING ERRCODE = '23505';
    END IF;

    -- Insert pharmacist record (hardcoded role = 'pharmacist', must_change_password = TRUE)
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
            p_new_user_id,
            p_pharmacy_id,
            p_branch_id,
            v_clean_username,
            v_clean_display_name,
            'pharmacist',
            FALSE,
            TRUE
        );
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'Username is already taken. Please choose a different username.'
                USING ERRCODE = '23505';
    END;

    -- Write activity_logs audit entry (never logs password or tokens)
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
        p_pharmacy_id,
        p_caller_user_id,
        p_caller_username,
        'create_staff_user',
        'app_users',
        p_new_user_id,
        p_branch_id,
        'supabase-edge-function',
        jsonb_build_object(
            'new_user_id', p_new_user_id,
            'new_username', v_clean_username,
            'role', 'pharmacist',
            'branch_id', p_branch_id
        )
    );

    RETURN jsonb_build_object(
        'id', p_new_user_id,
        'username', v_clean_username,
        'display_name', v_clean_display_name,
        'role', 'pharmacist',
        'pharmacy_id', p_pharmacy_id,
        'branch_id', p_branch_id,
        'must_change_password', TRUE
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_staff_user(
    UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_create_staff_user(
    UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT
) TO service_role;
