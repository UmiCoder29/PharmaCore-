-- ==============================================================================
-- PharmaCore ERP + POS — Privilege Hardening & Access Control
-- Migration: 20261025000002_harden_privileges.sql
-- ==============================================================================
-- Rollback Note:
-- To revert the hardened permissions back to baseline defaults:
--
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
-- GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO authenticated, service_role;
-- GRANT SELECT ON public.subscription_plans TO anon;
-- GRANT SELECT ON public.platform_settings TO anon;
--
-- DROP POLICY IF EXISTS "authenticated_read_platform_settings" ON public.platform_settings;
-- DROP POLICY IF EXISTS "anon_read_platform_identity" ON public.platform_settings;
-- CREATE POLICY "read_platform_settings" ON public.platform_settings FOR SELECT TO authenticated, anon USING (true);
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REVOKE BROAD PRIVILEGES ACROSS PUBLIC SCHEMA
-- ------------------------------------------------------------------------------
-- Revoke all existing permissions on tables, sequences, and routines from anon, authenticated, and PUBLIC
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, PUBLIC;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated, PUBLIC;

-- ------------------------------------------------------------------------------
-- 2. GRANT LEAST-PRIVILEGE TABLE & SEQUENCE PERMISSIONS TO AUTHENTICATED
-- ------------------------------------------------------------------------------
-- Grant only operational DML (SELECT, INSERT, UPDATE, DELETE) to authenticated.
-- Explicitly exclude TRUNCATE, REFERENCES, and TRIGGER permissions.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Grant sequence usage and select for auto-generated identifiers
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. ALTER DEFAULT PRIVILEGES FOR FUTURE OBJECTS (postgres & supabase_admin)
-- ------------------------------------------------------------------------------
-- Ensure objects created in the future by postgres inherit hardened privileges
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon, authenticated, PUBLIC;

-- ------------------------------------------------------------------------------
-- 4. FUNCTION & PROCEDURE EXECUTION PRIVILEGES
-- ------------------------------------------------------------------------------
-- Revoke execution on all routines from PUBLIC and anon
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon;

-- Grant EXECUTE to authenticated ONLY on authorized helper functions and user-facing RPCs
GRANT EXECUTE ON FUNCTION public.is_superadmin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_pharmacy_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_branch_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_all_branches() TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_sale(UUID, JSONB, NUMERIC, NUMERIC, NUMERIC, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_return(UUID, UUID, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_return(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_dashboard_stats() TO authenticated;

-- Explicitly revoke scheduled maintenance function from authenticated (system/cron only)
REVOKE EXECUTE ON FUNCTION public.update_expired_batches() FROM authenticated, anon, PUBLIC;

-- ------------------------------------------------------------------------------
-- 5. ANONYMOUS (ANON) ACCESS RESTRICTION & PLATFORM SETTINGS RLS HARDENING
-- ------------------------------------------------------------------------------
-- anon keeps SELECT only on subscription_plans (public SaaS pricing)
GRANT SELECT ON public.subscription_plans TO anon;

-- anon is granted SELECT on platform_settings, but RLS restricts rows to 'platform_identity' ONLY
GRANT SELECT ON public.platform_settings TO anon;

-- Restructure RLS policies on platform_settings to remove anonymous access to security_policy & trial_policy
DROP POLICY IF EXISTS "read_platform_settings" ON public.platform_settings;
DROP POLICY IF EXISTS "authenticated_read_platform_settings" ON public.platform_settings;
DROP POLICY IF EXISTS "anon_read_platform_identity" ON public.platform_settings;

-- Authenticated users can read all platform configuration settings
CREATE POLICY "authenticated_read_platform_settings" ON public.platform_settings 
    FOR SELECT TO authenticated 
    USING (true);

-- Anonymous users may read ONLY the public platform branding / identity row
CREATE POLICY "anon_read_platform_identity" ON public.platform_settings 
    FOR SELECT TO anon 
    USING (key = 'platform_identity');

-- ------------------------------------------------------------------------------
-- 6. RELOAD POSTGREST SCHEMA CACHE
-- ------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
