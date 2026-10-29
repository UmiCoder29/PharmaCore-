-- Migration: 20261028000001_platform_sales_revenue.sql
-- Description: Aggregate platform sales revenue function for SaaS SuperAdmin Dashboard.
-- Rollback: DROP FUNCTION IF EXISTS public.get_platform_sales_revenue();
--
-- Security hardening rules applied:
-- 1. SECURITY INVOKER: Runs with the caller's privileges. When called by a superadmin,
--    the RLS policy 'read_sales' on public.sales permits reading all tenant sales.
-- 2. Fixed search_path = public to protect against search path injection attacks.
-- 3. Execution revoked from PUBLIC and anon roles.
-- 4. Granted exclusively to authenticated role.
-- Note: Do NOT apply this migration to any database until explicitly requested.

CREATE OR REPLACE FUNCTION public.get_platform_sales_revenue()
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(total_amount), 0)::NUMERIC FROM public.sales;
$$;

-- Revoke all permissions from PUBLIC and anon
REVOKE ALL ON FUNCTION public.get_platform_sales_revenue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_platform_sales_revenue() FROM anon;

-- Grant execution to authenticated users only
GRANT EXECUTE ON FUNCTION public.get_platform_sales_revenue() TO authenticated;
