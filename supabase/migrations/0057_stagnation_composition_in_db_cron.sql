-- 0057_stagnation_composition_in_db_cron.sql
-- FX-019b · Fix the next three dead HTTP crons.
--
-- After 0056 fixed kpi-rebuild-nightly, six other cron jobs in
-- cron.job still POST to edge functions that were never deployed
-- (only bnc-upload-process exists under supabase/functions/). The
-- three with user-visible impact and an existing in-DB equivalent:
--
--   stagnation-daily             → eval_stagnation()
--   composition-warning-weekly   → eval_composition_warning()
--   composition-drift-weekly     → eval_composition_drift()
--
-- All three are SECURITY DEFINER, no-arg, defined in 0038. Same
-- pattern as 0056: unschedule the dead HTTP cron, schedule a new
-- direct-SQL cron with the same cadence, run once inline so today's
-- effect is immediate.
--
-- Out of scope (left alone):
--   bnc-stale-reminder-weekly      — needs investigation/port
--   ecosystem-rebuild              — needs investigation/port
--   document-retention-sweep-monthly — needs investigation/port

DO $cron$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'pg_cron not installed — skipping.';
        RETURN;
    END IF;

    -- stagnation-daily: 06:00 Asia/Dubai = 02:00 UTC
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stagnation-daily') THEN
        PERFORM cron.unschedule('stagnation-daily');
    END IF;
    PERFORM cron.schedule(
        'stagnation-daily',
        '0 2 * * *',
        $body$SELECT public.eval_stagnation();$body$
    );

    -- composition-warning-weekly: Mon 06:00 Asia/Dubai = Mon 02:00 UTC
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'composition-warning-weekly') THEN
        PERFORM cron.unschedule('composition-warning-weekly');
    END IF;
    PERFORM cron.schedule(
        'composition-warning-weekly',
        '0 2 * * 1',
        $body$SELECT public.eval_composition_warning();$body$
    );

    -- composition-drift-weekly: Mon 07:00 Asia/Dubai = Mon 03:00 UTC
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'composition-drift-weekly') THEN
        PERFORM cron.unschedule('composition-drift-weekly');
    END IF;
    PERFORM cron.schedule(
        'composition-drift-weekly',
        '0 3 * * 1',
        $body$SELECT public.eval_composition_drift();$body$
    );
END
$cron$;

-- NOTE: the original 0057 also ran each eval_* function inline here
-- so today's notifications would fire immediately. Those three SELECTs
-- have been removed because eval_composition_drift() — as defined in
-- 0038 — had a latent ambiguous-column bug (`RETURNS TABLE(fired int)`
-- collides with composition_drift_log.fired in a CTE WHERE clause).
-- Calling it inline raises 42702 and kills the migration on a fresh
-- replay (the drift-detector shadow rebuild). 0058 fixes the function
-- via CREATE OR REPLACE, re-runs 0057's cron schedules idempotently,
-- AND runs the three inline calls — so the only thing this deferral
-- changes is the timing on a virgin replay. In prod (where 0058 ran
-- after this file), the effective state is identical.
