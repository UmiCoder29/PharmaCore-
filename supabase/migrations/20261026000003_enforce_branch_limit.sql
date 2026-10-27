-- Migration: 20261026000003_enforce_branch_limit.sql
-- Description:
-- 1. Enforce pharmacy max_branches limit on public.branches via trigger fn_enforce_branch_limit.
-- 2. Restrict public.activity_logs SELECT to admins and superadmins (pharmacist read revoked).
--
-- Rollback instructions:
-- DROP TRIGGER IF EXISTS trg_enforce_branch_limit ON public.branches;
-- DROP FUNCTION IF EXISTS public.fn_enforce_branch_limit();
-- DROP POLICY IF EXISTS "read_activity_logs" ON public.activity_logs;
-- CREATE POLICY "read_activity_logs" ON public.activity_logs 
--     FOR SELECT TO authenticated 
--     USING (pharmacy_id = public.get_user_pharmacy_id() OR public.is_superadmin());
-- NOTIFY pgrst, 'reload schema';

-- ==============================================================================
-- 1. BRANCH LIMIT ENFORCEMENT TRIGGER
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_enforce_branch_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_max_branches INTEGER;
    v_branch_count INTEGER;
BEGIN
    -- Allow direct SQL (migration scripts/psql), service role, and superadmins
    -- Never use current_user inside SECURITY DEFINER as it evaluates to the function owner
    IF auth.uid() IS NULL 
       OR public.is_superadmin() 
       OR auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- On UPDATE, only enforce if pharmacy_id changed (branches has no is_active column)
    IF TG_OP = 'UPDATE' AND NOT (NEW.pharmacy_id IS DISTINCT FROM OLD.pharmacy_id) THEN
        RETURN NEW;
    END IF;

    -- Lock the pharmacy row to prevent concurrent race conditions
    SELECT max_branches INTO v_max_branches
    FROM public.pharmacies
    WHERE id = NEW.pharmacy_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pharmacy not found';
    END IF;

    -- Count active branches for this pharmacy
    -- (public.branches has no is_active column; count other branch rows for NEW.pharmacy_id)
    IF TG_OP = 'INSERT' THEN
        SELECT count(*) INTO v_branch_count
        FROM public.branches
        WHERE pharmacy_id = NEW.pharmacy_id;
    ELSE
        SELECT count(*) INTO v_branch_count
        FROM public.branches
        WHERE pharmacy_id = NEW.pharmacy_id
          AND id <> NEW.id;
    END IF;

    IF v_max_branches IS NOT NULL AND v_branch_count >= v_max_branches THEN
        RAISE EXCEPTION 'Branch limit reached for this plan';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_branch_limit ON public.branches;
CREATE TRIGGER trg_enforce_branch_limit
    BEFORE INSERT OR UPDATE ON public.branches
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_enforce_branch_limit();

-- Revoke execute on trigger function from untrusted roles
REVOKE EXECUTE ON FUNCTION public.fn_enforce_branch_limit() FROM PUBLIC, anon, authenticated;

-- ==============================================================================
-- 2. RESTRICT ACTIVITY_LOGS READ POLICY TO ADMINS & SUPERADMINS
-- ==============================================================================

DROP POLICY IF EXISTS "read_activity_logs" ON public.activity_logs;
CREATE POLICY "read_activity_logs" ON public.activity_logs 
    FOR SELECT TO authenticated 
    USING (public.is_superadmin() OR (pharmacy_id = public.get_user_pharmacy_id() AND public.is_admin()));

-- Notify PostgREST to reload schema and policies
NOTIFY pgrst, 'reload schema';
