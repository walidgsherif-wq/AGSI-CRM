-- 0062_bnc_reminder_doc_sweep_in_db_cron.sql
-- FX-019d · Final two dead HTTP crons fixed.
--
-- After 0056/0057/0059, two HTTP crons remained that POSTed to
-- never-deployed edge functions:
--
--   bnc-stale-reminder-weekly      → /bnc-stale-reminder
--   document-retention-sweep-monthly → /document-retention-sweep
--
-- Their logic is small and well-defined (per architecture/08-decisions-log.md
-- D-4 and D-5). This migration:
--
--   1. Defines eval_bnc_stale_reminder() — checks the threshold and
--      enqueues a notification for every active admin if the latest
--      BNC upload is older than the configured window.
--   2. Defines process_document_retention_sweep() — archives documents
--      past the configured retention window and emits a single summary
--      notification per admin when anything was archived.
--   3. Swaps both cron commands from net.http_post to direct in-DB
--      SELECT.
--   4. Runs each once inline so today's state is reconciled
--      immediately.
--
-- Both functions are SECURITY DEFINER with search_path locked, idempotent
-- across re-runs, and respect the app_settings .enabled toggle (admin
-- can pause either sweep without dropping the cron).
--
-- After this migration: 8 of 8 cron jobs run in-DB.

-- =====================================================================
-- 1) eval_bnc_stale_reminder()
-- =====================================================================
CREATE OR REPLACE FUNCTION eval_bnc_stale_reminder()
RETURNS TABLE(fired int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_enabled          boolean;
    v_threshold_days   int;
    v_latest_upload    date;
    v_already_fired_id uuid;
    v_inserted         int := 0;
BEGIN
    -- Block client/session callers (cron has no auth.uid()).
    IF auth.uid() IS NOT NULL AND auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    SELECT (value_json->>'enabled')::boolean, (value_json->>'threshold_days')::int
      INTO v_enabled, v_threshold_days
      FROM app_settings WHERE key = 'bnc_stale_reminder';

    IF v_enabled IS NOT TRUE THEN
        fired := 0;
        RETURN NEXT;
        RETURN;
    END IF;
    v_threshold_days := COALESCE(v_threshold_days, 45);

    SELECT MAX(file_date) INTO v_latest_upload
      FROM bnc_uploads
     WHERE status = 'completed';

    -- No uploads at all OR within threshold → no fire.
    IF v_latest_upload IS NULL OR v_latest_upload >= current_date - v_threshold_days THEN
        fired := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    -- De-dupe: don't re-fire if any admin already has a bnc_stale_reminder
    -- in their inbox from the past 7 days. (Cron runs weekly, so this
    -- prevents two-in-a-row if the cron retries inside a week.)
    SELECT id INTO v_already_fired_id
      FROM notifications
     WHERE notification_type = 'bnc_stale_reminder'
       AND created_at >= now() - interval '7 days'
     LIMIT 1;

    IF v_already_fired_id IS NOT NULL THEN
        fired := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    WITH ins AS (
        INSERT INTO notifications (
            recipient_id, notification_type, subject, body, link_url, channels
        )
        SELECT
            p.id,
            'bnc_stale_reminder'::notification_type_t,
            format('BNC upload stale — last on %s', v_latest_upload),
            format(
                'No BNC upload has landed since %s (%s days ago, threshold %s). Refresh the dataset to keep insights and market snapshots current.',
                v_latest_upload,
                (current_date - v_latest_upload),
                v_threshold_days
            ),
            '/admin/uploads',
            ARRAY['in_app']::text[]
          FROM profiles p
         WHERE p.is_active = true
           AND p.role = 'admin'
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;

    fired := v_inserted;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION eval_bnc_stale_reminder() TO authenticated;


-- =====================================================================
-- 2) process_document_retention_sweep()
-- =====================================================================
CREATE OR REPLACE FUNCTION process_document_retention_sweep()
RETURNS TABLE(archived int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_enabled        boolean;
    v_archive_years  int;
    v_cutoff         date;
    v_archived_count int := 0;
BEGIN
    IF auth.uid() IS NOT NULL AND auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    SELECT (value_json->>'enabled')::boolean, (value_json->>'archive_after_years')::int
      INTO v_enabled, v_archive_years
      FROM app_settings WHERE key = 'document_retention';

    IF v_enabled IS NOT TRUE THEN
        archived := 0;
        RETURN NEXT;
        RETURN;
    END IF;
    v_archive_years := COALESCE(v_archive_years, 7);

    v_cutoff := (current_date - make_interval(years => v_archive_years))::date;

    -- Flip is_archived on documents past the retention window.
    -- by_doc_type overrides in app_settings.document_retention.by_doc_type
    -- aren't implemented yet (per architecture/08-decisions-log.md:125-126).
    -- Today's sweep is the global default only; per-type windows are an
    -- extension point if and when needed.
    WITH upd AS (
        UPDATE documents
           SET is_archived     = true,
               archived_at     = now(),
               archived_reason = 'retention_sweep',
               updated_at      = now()
         WHERE is_archived = false
           AND signed_date IS NOT NULL
           AND signed_date < v_cutoff
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_archived_count FROM upd;

    -- Summary notification per active admin when anything was archived.
    IF v_archived_count > 0 THEN
        INSERT INTO notifications (
            recipient_id, notification_type, subject, body, link_url, channels
        )
        SELECT
            p.id,
            'document_archived'::notification_type_t,
            format('Retention sweep — %s document%s archived',
                   v_archived_count,
                   CASE WHEN v_archived_count = 1 THEN '' ELSE 's' END),
            format(
                'Auto-archived %s document%s signed before %s (%s-year retention window). Storage blobs are retained; toggle "Show archived" on any document list to review or restore.',
                v_archived_count,
                CASE WHEN v_archived_count = 1 THEN '' ELSE 's' END,
                v_cutoff,
                v_archive_years
            ),
            '/admin/settings',
            ARRAY['in_app']::text[]
          FROM profiles p
         WHERE p.is_active = true
           AND p.role = 'admin';
    END IF;

    archived := v_archived_count;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION process_document_retention_sweep() TO authenticated;


-- =====================================================================
-- 3) Cron swap
-- =====================================================================
DO $cron$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'pg_cron not installed — skipping.';
        RETURN;
    END IF;

    -- bnc-stale-reminder-weekly: Monday 08:00 Asia/Dubai = 04:00 UTC
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bnc-stale-reminder-weekly') THEN
        PERFORM cron.unschedule('bnc-stale-reminder-weekly');
    END IF;
    PERFORM cron.schedule(
        'bnc-stale-reminder-weekly',
        '0 4 * * 1',
        $body$SELECT public.eval_bnc_stale_reminder();$body$
    );

    -- document-retention-sweep-monthly: 1st @ 02:30 Asia/Dubai = 22:30 UTC on the prior day
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'document-retention-sweep-monthly') THEN
        PERFORM cron.unschedule('document-retention-sweep-monthly');
    END IF;
    PERFORM cron.schedule(
        'document-retention-sweep-monthly',
        '30 22 1 * *',
        $body$SELECT public.process_document_retention_sweep();$body$
    );
END
$cron$;


-- =====================================================================
-- 4) Inline run so today's state is reconciled immediately
-- =====================================================================
SELECT public.eval_bnc_stale_reminder();
SELECT public.process_document_retention_sweep();
