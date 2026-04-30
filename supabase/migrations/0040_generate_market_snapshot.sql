-- 0040_generate_market_snapshot.sql
-- M14 — pre-compute the §4.4 market-insights snapshot for a given BNC
-- upload. Read by /insights via market_snapshots (snapshot_date = the
-- upload's file_date).
--
-- Caller flow:
--   1. Admin clicks "Generate snapshot" on /admin/uploads/[id].
--   2. Server action calls this RPC with the upload_id.
--   3. Function deletes any existing market_snapshots rows for that
--      snapshot_date (idempotent rebuild) and writes the §4.4 metric
--      set.
--
-- Metrics written (one row per dimension_key per metric_code):
--   projects_by_stage          dimension_key = stage; metric_value_json = {count, value_aed, value_usd}
--   projects_by_city           dimension_key = city
--   projects_by_sector         dimension_key = sector
--   top_developer              dimension_key = company_id (top 20)
--   top_main_contractor        dimension_key = company_id (top 20)
--   top_consultant             dimension_key = company_id (top 20)
--   awarded_breakdown          dimension_key = 'awarded'|'not_awarded'
--   completion_pipeline        dimension_key = '12mo'|'24mo'|'36mo'
--   construction_value_avg     dimension_key = '' (single row)
--   stage_funnel               dimension_key = stage; metric_value = count
--
-- All rows scoped to "projects last seen in this upload" (i.e. still
-- visible in this snapshot's market view; dormant projects from older
-- uploads are excluded by joining via last_seen_in_upload_id).

CREATE OR REPLACE FUNCTION generate_market_snapshot(p_upload_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_upload bnc_uploads%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL OR auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admins can generate market snapshots.';
    END IF;

    SELECT * INTO v_upload FROM bnc_uploads WHERE id = p_upload_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Upload % not found.', p_upload_id;
    END IF;
    IF v_upload.status <> 'completed' THEN
        RAISE EXCEPTION 'Upload % is not completed (status: %).',
            p_upload_id, v_upload.status;
    END IF;

    -- Idempotent: wipe and rewrite for this snapshot_date.
    DELETE FROM market_snapshots WHERE snapshot_date = v_upload.file_date;

    -- 1) projects_by_stage
    INSERT INTO market_snapshots
        (upload_id, snapshot_date, metric_code, dimension_key, metric_value_json)
    SELECT
        p_upload_id, v_upload.file_date, 'projects_by_stage',
        p.stage::text,
        jsonb_build_object(
            'count', COUNT(*),
            'value_aed', COALESCE(SUM(p.value_aed), 0),
            'value_usd', COALESCE(SUM(p.value_usd), 0)
        )
      FROM projects p
     WHERE p.last_seen_in_upload_id = p_upload_id
     GROUP BY p.stage;

    -- 2) projects_by_city
    INSERT INTO market_snapshots
        (upload_id, snapshot_date, metric_code, dimension_key, metric_value_json)
    SELECT
        p_upload_id, v_upload.file_date, 'projects_by_city',
        COALESCE(p.city, '(unknown)'),
        jsonb_build_object(
            'count', COUNT(*),
            'value_aed', COALESCE(SUM(p.value_aed), 0)
        )
      FROM projects p
     WHERE p.last_seen_in_upload_id = p_upload_id
     GROUP BY p.city;

    -- 3) projects_by_sector
    INSERT INTO market_snapshots
        (upload_id, snapshot_date, metric_code, dimension_key, metric_value_json)
    SELECT
        p_upload_id, v_upload.file_date, 'projects_by_sector',
        COALESCE(p.sector, '(unknown)'),
        jsonb_build_object(
            'count', COUNT(*),
            'value_aed', COALESCE(SUM(p.value_aed), 0)
        )
      FROM projects p
     WHERE p.last_seen_in_upload_id = p_upload_id
     GROUP BY p.sector;

    -- 4) top_developer (top 20 by project count + total value)
    INSERT INTO market_snapshots
        (upload_id, snapshot_date, metric_code, dimension_key, metric_value_json)
    SELECT
        p_upload_id, v_upload.file_date, 'top_developer',
        c.id::text,
        jsonb_build_object(
            'company_name', c.canonical_name,
            'project_count', COUNT(DISTINCT pc.project_id),
            'value_aed', COALESCE(SUM(p.value_aed), 0)
        )
      FROM project_companies pc
      JOIN projects p  ON p.id  = pc.project_id
      JOIN companies c ON c.id  = pc.company_id
     WHERE p.last_seen_in_upload_id = p_upload_id
       AND pc.role = 'owner'
       AND pc.is_current = true
     GROUP BY c.id, c.canonical_name
     ORDER BY COUNT(DISTINCT pc.project_id) DESC, SUM(p.value_aed) DESC NULLS LAST
     LIMIT 20;

    -- 5) top_main_contractor
    INSERT INTO market_snapshots
        (upload_id, snapshot_date, metric_code, dimension_key, metric_value_json)
    SELECT
        p_upload_id, v_upload.file_date, 'top_main_contractor',
        c.id::text,
        jsonb_build_object(
            'company_name', c.canonical_name,
            'active_project_count', COUNT(DISTINCT pc.project_id),
            'value_aed', COALESCE(SUM(p.value_aed), 0)
        )
      FROM project_companies pc
      JOIN projects p  ON p.id  = pc.project_id
      JOIN companies c ON c.id  = pc.company_id
     WHERE p.last_seen_in_upload_id = p_upload_id
       AND pc.role = 'main_contractor'
       AND pc.is_current = true
     GROUP BY c.id, c.canonical_name
     ORDER BY COUNT(DISTINCT pc.project_id) DESC, SUM(p.value_aed) DESC NULLS LAST
     LIMIT 20;

    -- 6) top_consultant (design + MEP combined for the leaderboard)
    INSERT INTO market_snapshots
        (upload_id, snapshot_date, metric_code, dimension_key, metric_value_json)
    SELECT
        p_upload_id, v_upload.file_date, 'top_consultant',
        c.id::text,
        jsonb_build_object(
            'company_name', c.canonical_name,
            'active_project_count', COUNT(DISTINCT pc.project_id),
            'value_aed', COALESCE(SUM(p.value_aed), 0)
        )
      FROM project_companies pc
      JOIN projects p  ON p.id  = pc.project_id
      JOIN companies c ON c.id  = pc.company_id
     WHERE p.last_seen_in_upload_id = p_upload_id
       AND pc.role IN ('design_consultant', 'mep_consultant')
       AND pc.is_current = true
     GROUP BY c.id, c.canonical_name
     ORDER BY COUNT(DISTINCT pc.project_id) DESC
     LIMIT 20;

    -- 7) awarded_breakdown (any current main_contractor link = awarded)
    INSERT INTO market_snapshots
        (upload_id, snapshot_date, metric_code, dimension_key, metric_value_json)
    SELECT
        p_upload_id, v_upload.file_date, 'awarded_breakdown',
        CASE WHEN has_mc THEN 'awarded' ELSE 'not_awarded' END,
        jsonb_build_object(
            'count', COUNT(*),
            'value_aed', COALESCE(SUM(value_aed), 0)
        )
      FROM (
        SELECT
            p.id, p.value_aed,
            EXISTS (
              SELECT 1 FROM project_companies pc
               WHERE pc.project_id = p.id
                 AND pc.role = 'main_contractor'
                 AND pc.is_current = true
            ) AS has_mc
          FROM projects p
         WHERE p.last_seen_in_upload_id = p_upload_id
      ) t
     GROUP BY has_mc;

    -- 8) completion_pipeline — projects completing in next 12/24/36mo
    INSERT INTO market_snapshots
        (upload_id, snapshot_date, metric_code, dimension_key, metric_value_json)
    SELECT
        p_upload_id, v_upload.file_date, 'completion_pipeline',
        bucket,
        jsonb_build_object(
            'count', COUNT(*),
            'value_aed', COALESCE(SUM(value_aed), 0)
        )
      FROM (
        SELECT
            p.id, p.value_aed,
            CASE
                WHEN p.estimated_completion_date IS NULL THEN 'unknown'
                WHEN p.estimated_completion_date <= v_upload.file_date + interval '12 months' THEN '12mo'
                WHEN p.estimated_completion_date <= v_upload.file_date + interval '24 months' THEN '24mo'
                WHEN p.estimated_completion_date <= v_upload.file_date + interval '36 months' THEN '36mo'
                ELSE '36mo_plus'
            END AS bucket
          FROM projects p
         WHERE p.last_seen_in_upload_id = p_upload_id
           AND p.stage <> 'completed'::project_stage_t
           AND p.stage <> 'cancelled'::project_stage_t
      ) t
     GROUP BY bucket;

    -- 9) construction_value_avg — average completion_percentage and
    --    value among under_construction projects
    INSERT INTO market_snapshots
        (upload_id, snapshot_date, metric_code, dimension_key, metric_value_json)
    SELECT
        p_upload_id, v_upload.file_date, 'construction_value_avg', '',
        jsonb_build_object(
            'project_count', COUNT(*),
            'avg_completion_pct', COALESCE(AVG(p.completion_percentage), 0),
            'avg_value_aed', COALESCE(AVG(p.value_aed), 0),
            'total_value_aed', COALESCE(SUM(p.value_aed), 0)
        )
      FROM projects p
     WHERE p.last_seen_in_upload_id = p_upload_id
       AND p.stage = 'under_construction'::project_stage_t;

    -- 10) stage_funnel (count by stage in canonical pipeline order)
    INSERT INTO market_snapshots
        (upload_id, snapshot_date, metric_code, dimension_key, metric_value)
    SELECT
        p_upload_id, v_upload.file_date, 'stage_funnel',
        p.stage::text,
        COUNT(*)::numeric
      FROM projects p
     WHERE p.last_seen_in_upload_id = p_upload_id
     GROUP BY p.stage;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_market_snapshot(uuid) TO authenticated;
