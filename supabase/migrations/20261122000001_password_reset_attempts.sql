-- ==============================================================================
-- PharmaCore Password Reset Rate Limiting & Audit Migration
-- File: supabase/migrations/20261122000001_password_reset_attempts.sql
-- ==============================================================================

-- 1. Create public.password_reset_attempts table
CREATE TABLE IF NOT EXISTS public.password_reset_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id UUID NOT NULL,
    target_id UUID,
    outcome TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for sliding-window rate limit checks (10 attempts per hour per caller)
CREATE INDEX IF NOT EXISTS idx_password_reset_attempts_caller_created
    ON public.password_reset_attempts(caller_id, created_at);

-- Enable RLS with zero user-facing policies: table is inaccessible to anon & authenticated
ALTER TABLE public.password_reset_attempts ENABLE ROW LEVEL SECURITY;

-- Explicit privilege lockdown: only service_role (Edge Functions / backend) may read/write
REVOKE ALL ON TABLE public.password_reset_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.password_reset_attempts TO service_role;
