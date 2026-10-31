-- Migration: 20261031000001_clear_own_password_flag.sql
-- Description:
-- Adds public.fn_clear_own_must_change_password() to allow authenticated users
-- (including pharmacists whose role lacks direct UPDATE on app_users) to clear
-- their own must_change_password flag upon first login.
--
-- Security properties:
-- 1. SECURITY DEFINER with fixed search_path = public.
-- 2. Scoped strictly to auth.uid() — cannot update any other user's record.
-- 3. Updates ONLY must_change_password = false; preserves role, pharmacy_id, branch_id.
-- 4. Returns true if exactly 1 row was updated, false otherwise.
-- 5. Executable only by authenticated role (revoked from PUBLIC and anon).
--
-- Rollback instructions:
-- DROP FUNCTION IF EXISTS public.fn_clear_own_must_change_password();

CREATE OR REPLACE FUNCTION public.fn_clear_own_must_change_password()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows_affected integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN false;
    END IF;

    UPDATE public.app_users
    SET must_change_password = false
    WHERE id = auth.uid();

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    RETURN (v_rows_affected = 1);
END;
$$;

-- Lock down execution privileges:
-- Deny public and anon, grant execute strictly to authenticated users.
REVOKE ALL ON FUNCTION public.fn_clear_own_must_change_password() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_clear_own_must_change_password() TO authenticated;
