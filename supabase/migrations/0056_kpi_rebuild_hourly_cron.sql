-- 0056_kpi_rebuild_hourly_cron.sql
-- FX-019 · Fix the KPI rebuild — it never runs.
--
-- 0021 registered a cron job 'kpi-rebuild-nightly' that POSTs to an Edge
-- Function 'kpi-rebuild-nightly' which was never deployed. The HTTP
-- request 404s silently and kpi_actuals_daily only refreshes when an
-- admin clicks the "Rebuild KPI now" button.
--
-- This migration:
--   1. Unschedules the dead 'kpi-rebuild-nightly' HTTP job.
--   2. Schedules 'kpi-rebuild-hourly' to call rebuild_kpi_actuals
--      directly in-DB at the top of every hour. No edge function, no
--      net.http_post, no auth round-trip.
--   3. Runs rebuild_kpi_actuals(current_date) once, now, so actuals
--      are fresh immediately rather than at the next tick.
--
-- The rebuild_kpi_actuals function is SECURITY DEFINER (0030:17) so
-- cron's job-runner role can execute it; it deletes + re-inserts the
-- snapshot for the given date and REFRESH MATERIALIZED VIEW
-- CONCURRENTLY bei_current_view (0030:152). The manual "Rebuild KPI
-- now" button (src/server/actions/kpi.ts → RebuildButton.tsx) stays in
-- place as an instant override; DataFreshnessBadge will read
-- fresh-within-the-hour.

DO $cron$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'pg_cron not installed — skipping. Enable pg_cron in Supabase Dashboard and re-run.';
        RETURN;
    END IF;

    -- (1) Unschedule the dead HTTP job. cron.unschedule throws if the
    -- job name doesn't exist, so guard.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'kpi-rebuild-nightly') THEN
        PERFORM cron.unschedule('kpi-rebuild-nightly');
    END IF;

    -- (2) Schedule the new in-DB hourly rebuild. Unschedule any prior
    -- registration of the same name first so this migration is
    -- idempotent across re-runs.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'kpi-rebuild-hourly') THEN
        PERFORM cron.unschedule('kpi-rebuild-hourly');
    END IF;

    PERFORM cron.schedule(
        'kpi-rebuild-hourly',
        '0 * * * *',
        $body$SELECT public.rebuild_kpi_actuals(current_date);$body$
    );
END
$cron$;

-- (3) Run once immediately so today's snapshot exists before the next
-- cron tick. Safe to call inline — rebuild_kpi_actuals is idempotent
-- for the target date.
SELECT public.rebuild_kpi_actuals(current_date);
