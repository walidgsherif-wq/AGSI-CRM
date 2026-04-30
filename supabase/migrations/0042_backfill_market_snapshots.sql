-- 0042_backfill_market_snapshots.sql
-- Helper to (re-)generate a market snapshot for every completed BNC
-- upload in one shot. Useful when:
--   - 0041 added new metrics that older snapshots don't have, and the
--     admin wants to refresh all of them in one click.
--   - The admin tunes app_settings (rebar threshold / share / price)
--     and wants the change to propagate across the whole history.
--
-- Idempotent — generate_market_snapshot already deletes and rewrites
-- per snapshot_date, so re-running is safe.

CREATE OR REPLACE FUNCTION backfill_all_market_snapshots()
RETURNS TABLE(snapshots_generated int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count int := 0;
    v_upload_id uuid;
BEGIN
    IF auth.uid() IS NULL OR auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admins can backfill market snapshots.';
    END IF;

    FOR v_upload_id IN
        SELECT id FROM bnc_uploads
         WHERE status = 'completed'
         ORDER BY file_date ASC
    LOOP
        PERFORM generate_market_snapshot(v_upload_id);
        v_count := v_count + 1;
    END LOOP;

    snapshots_generated := v_count;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION backfill_all_market_snapshots() TO authenticated;
