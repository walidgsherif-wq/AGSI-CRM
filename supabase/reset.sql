-- Clean reset for the AGSI CRM public schema.
-- Safe on a fresh Supabase project (public is empty by default).
-- Run this ONLY if a prior apply-all.sql attempt left partial state and
-- re-running apply-all.sql produces "already exists" errors.

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- Restore the permission defaults Supabase expects on the public schema
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO anon;
GRANT ALL ON SCHEMA public TO authenticated;
GRANT ALL ON SCHEMA public TO service_role;

-- Drop our cron jobs too (they live outside public schema).
-- Safe to call: unschedule returns false if the job doesn't exist; we
-- wrap in DO with EXCEPTION to tolerate missing pg_cron.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job
         WHERE jobname IN (
            'kpi-rebuild-nightly',
            'stagnation-daily',
            'composition-warning-weekly',
            'composition-drift-weekly',
            'bnc-stale-reminder-weekly',
            'document-retention-sweep-monthly',
            'ecosystem-rebuild'
         );
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;  -- swallow, cron wasn't enabled anyway
END
$$;
