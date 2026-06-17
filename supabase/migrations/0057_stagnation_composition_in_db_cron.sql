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

-- Run once inline so today's notifications fire immediately instead
-- of waiting for the next scheduled tick. Safe — each eval_* function
-- is idempotent at the (subject, period) grain via its own
-- de-duplication checks (see 0038).
SELECT public.eval_stagnation();
SELECT public.eval_composition_warning();
SELECT public.eval_composition_drift();
