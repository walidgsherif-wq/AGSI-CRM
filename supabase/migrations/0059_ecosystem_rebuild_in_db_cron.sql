-- 0059_ecosystem_rebuild_in_db_cron.sql
-- FX-019c · Fix the ecosystem-rebuild cron — it also 404s.
--
-- The ecosystem-rebuild cron (0021) POSTs to a non-existent edge
-- function, so ecosystem_awareness_current has been frozen at its
-- last manual rebuild. The dashboard EcosystemPanel and the
-- /insights/ecosystem screen both read from this table — they're
-- showing stale scores.
--
-- Same pattern as 0056/0057/0058: swap the dead HTTP cron for a
-- direct in-DB call. rebuild_ecosystem_awareness() is defined in
-- 0034:140-260, SECURITY DEFINER, no-arg, returns void.

DO $cron$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'pg_cron not installed — skipping.';
        RETURN;
    END IF;

    -- Preserve the original schedule: 15 22 * * * (UTC) = 02:15 Asia/Dubai
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ecosystem-rebuild') THEN
        PERFORM cron.unschedule('ecosystem-rebuild');
    END IF;
    PERFORM cron.schedule(
        'ecosystem-rebuild',
        '15 22 * * *',
        $body$SELECT public.rebuild_ecosystem_awareness();$body$
    );
END
$cron$;

-- Run once inline so dashboard + /insights/ecosystem reflect today's
-- data immediately rather than waiting for the next 22:15 UTC tick.
SELECT public.rebuild_ecosystem_awareness();
