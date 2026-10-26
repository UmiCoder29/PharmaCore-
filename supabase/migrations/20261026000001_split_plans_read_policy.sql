-- Why: the old read_subscription_plans policy called is_superadmin() for anon.
-- Anon no longer has EXECUTE on that function after the privilege hardening,
-- so the public pricing read failed. Split into separate anon and authenticated policies.

DROP POLICY IF EXISTS "read_subscription_plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "anon_read_active_plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "authenticated_read_plans" ON public.subscription_plans;

CREATE POLICY "anon_read_active_plans" ON public.subscription_plans
FOR SELECT TO anon
USING (is_active = true);

CREATE POLICY "authenticated_read_plans" ON public.subscription_plans
FOR SELECT TO authenticated
USING (is_active = true OR is_superadmin());

NOTIFY pgrst, 'reload schema';
