-- 0043_rebar_price_history.sql
-- Track local rebar price month-by-month so:
--   - Each market snapshot can use the price effective at the time of
--     the BNC upload (not whatever the price is "today").
--   - /insights can plot the price as a trend line alongside
--     value-under-construction, value-completed, and consumption MT.
--
-- The single-value app_setting rebar_price_per_tonne_aed (seeded in
-- 0041) becomes the fallback used when no history row covers a given
-- month.

CREATE TABLE rebar_price_history (
    id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    effective_month     date         NOT NULL UNIQUE,
    price_aed_per_tonne numeric(12,2) NOT NULL CHECK (price_aed_per_tonne > 0),
    entered_by          uuid         NULL REFERENCES profiles(id) ON DELETE SET NULL,
    entered_at          timestamptz  NOT NULL DEFAULT now(),
    notes               text         NULL,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),
    -- effective_month must be the first of the month
    CONSTRAINT rebar_price_history_first_of_month
        CHECK (extract(day from effective_month) = 1)
);

CREATE INDEX rebar_price_history_month_idx
    ON rebar_price_history (effective_month DESC);

ALTER TABLE rebar_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY rebar_price_history_select_all
    ON rebar_price_history FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY rebar_price_history_write_admin
    ON rebar_price_history FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

-- =====================================================================
-- get_rebar_price_for_month(p_date date) → numeric
--
-- Returns the price effective for p_date — i.e. the most recent
-- rebar_price_history row whose effective_month <= p_date. If no row
-- exists at or before p_date, falls back to app_settings.
-- rebar_price_per_tonne_aed.
-- =====================================================================

CREATE OR REPLACE FUNCTION get_rebar_price_for_month(p_date date)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_price numeric;
BEGIN
    SELECT price_aed_per_tonne INTO v_price
      FROM rebar_price_history
     WHERE effective_month <= p_date
     ORDER BY effective_month DESC
     LIMIT 1;
    IF v_price IS NULL THEN
        SELECT (value_json->>'price')::numeric INTO v_price
          FROM app_settings WHERE key = 'rebar_price_per_tonne_aed';
    END IF;
    RETURN COALESCE(v_price, 2400);
END;
$$;

GRANT EXECUTE ON FUNCTION get_rebar_price_for_month(date) TO authenticated;

-- =====================================================================
-- Recreate generate_market_snapshot() to call get_rebar_price_for_month
-- for the snapshot's file_date instead of using a static app_settings
-- value.
-- =====================================================================

CREATE OR REPLACE FUNCTION generate_market_snapshot(p_upload_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_upload    bnc_uploads%ROWTYPE;
    v_threshold numeric;
    v_share     numeric;
    v_price     numeric;
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

    SELECT (value_json->>'pct')::numeric INTO v_threshold
      FROM app_settings WHERE key = 'rebar_consumption_window_pct';
    v_threshold := COALESCE(v_threshold, 45);

    SELECT (value_json->>'share')::numeric INTO v_share
      FROM app_settings WHERE key = 'rebar_share_of_project_value';
    v_share := COALESCE(v_share, 0.05);

    -- Price effective at the upload's file_date — pulled from the
    -- monthly history table; falls back to app_settings.
    v_price := get_rebar_price_for_month(v_upload.file_date);

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

    -- 4) top_developer
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

    -- 6) top_consultant
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

    -- 7) awarded_breakdown
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

    -- 8) completion_pipeline
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

    -- 9) construction_value_avg
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

    -- 10) stage_funnel
    INSERT INTO market_snapshots
        (upload_id, snapshot_date, metric_code, dimension_key, metric_value)
    SELECT
        p_upload_id, v_upload.file_date, 'stage_funnel',
        p.stage::text,
        COUNT(*)::numeric
      FROM projects p
     WHERE p.last_seen_in_upload_id = p_upload_id
     GROUP BY p.stage;

    -- 11) rebar_window
    INSERT INTO market_snapshots
        (upload_id, snapshot_date, metric_code, dimension_key, metric_value_json)
    WITH src AS (
        SELECT
            p.id,
            p.value_aed,
            p.completion_percentage,
            p.estimated_completion_date,
            CASE
                WHEN p.completion_percentage IS NULL THEN 'unknown'
                WHEN p.completion_percentage < v_threshold THEN 'in_window'
                ELSE 'past_window'
            END AS bucket
          FROM projects p
         WHERE p.last_seen_in_upload_id = p_upload_id
           AND p.stage = 'under_construction'::project_stage_t
    ),
    enriched AS (
        SELECT
            s.*,
            COALESCE(s.value_aed, 0) * v_share AS total_rebar_aed,
            CASE
                WHEN s.bucket <> 'in_window' THEN 0
                ELSE GREATEST(
                    0,
                    (v_threshold - s.completion_percentage) / NULLIF(v_threshold, 0)
                )
            END AS remaining_share,
            CASE
                WHEN s.estimated_completion_date IS NULL THEN NULL
                ELSE (s.estimated_completion_date - v_upload.file_date)::numeric
            END AS days_to_completion
          FROM src s
    ),
    tonnage AS (
        SELECT
            e.*,
            (COALESCE(e.value_aed, 0) * v_share * e.remaining_share) AS remaining_rebar_aed,
            CASE WHEN v_price > 0 AND e.bucket = 'in_window'
                 THEN (COALESCE(e.value_aed, 0) * v_share * e.remaining_share) / v_price
                 ELSE 0
            END AS remaining_rebar_tonnes,
            CASE
                WHEN e.bucket <> 'in_window' OR e.completion_percentage IS NULL OR e.days_to_completion IS NULL THEN NULL
                WHEN e.completion_percentage >= 100 THEN NULL
                ELSE e.days_to_completion
                     * (v_threshold - e.completion_percentage)
                     / NULLIF(100 - e.completion_percentage, 0)
            END AS days_in_window_remaining
          FROM enriched e
    ),
    rate_inputs AS (
        SELECT
            SUM(remaining_rebar_tonnes) FILTER (
                WHERE bucket = 'in_window' AND days_in_window_remaining > 0
            ) AS rated_tonnes,
            SUM(days_in_window_remaining * remaining_rebar_tonnes) FILTER (
                WHERE bucket = 'in_window' AND days_in_window_remaining > 0
            ) AS weighted_days_tonnes_product,
            COUNT(*) FILTER (
                WHERE bucket = 'in_window' AND days_in_window_remaining > 0
            ) AS rated_project_count
          FROM tonnage
    )
    SELECT
        p_upload_id, v_upload.file_date, 'rebar_window', '',
        jsonb_build_object(
            'threshold_pct',           v_threshold,
            'rebar_share',             v_share,
            'rebar_price_per_tonne',   v_price,
            'in_window', jsonb_build_object(
                'count',     COUNT(*) FILTER (WHERE bucket = 'in_window'),
                'value_aed', COALESCE(SUM(value_aed) FILTER (WHERE bucket = 'in_window'), 0),
                'remaining_rebar_aed',    COALESCE(SUM(remaining_rebar_aed), 0),
                'remaining_rebar_tonnes', COALESCE(SUM(remaining_rebar_tonnes), 0)
            ),
            'past_window', jsonb_build_object(
                'count',     COUNT(*) FILTER (WHERE bucket = 'past_window'),
                'value_aed', COALESCE(SUM(value_aed) FILTER (WHERE bucket = 'past_window'), 0)
            ),
            'unknown_completion', jsonb_build_object(
                'count',     COUNT(*) FILTER (WHERE bucket = 'unknown'),
                'value_aed', COALESCE(SUM(value_aed) FILTER (WHERE bucket = 'unknown'), 0)
            ),
            'consumption_rate', (
                SELECT jsonb_build_object(
                    'rated_project_count', COALESCE(ri.rated_project_count, 0),
                    'rated_tonnes',        COALESCE(ri.rated_tonnes, 0),
                    'monthly_tonnes',
                        CASE WHEN COALESCE(ri.rated_tonnes, 0) > 0
                                  AND COALESCE(ri.weighted_days_tonnes_product, 0) > 0
                             THEN ri.rated_tonnes
                                  / (ri.weighted_days_tonnes_product / ri.rated_tonnes)
                                  * 30
                             ELSE 0
                        END,
                    'quarterly_tonnes',
                        CASE WHEN COALESCE(ri.rated_tonnes, 0) > 0
                                  AND COALESCE(ri.weighted_days_tonnes_product, 0) > 0
                             THEN ri.rated_tonnes
                                  / (ri.weighted_days_tonnes_product / ri.rated_tonnes)
                                  * 90
                             ELSE 0
                        END,
                    'annual_tonnes',
                        CASE WHEN COALESCE(ri.rated_tonnes, 0) > 0
                                  AND COALESCE(ri.weighted_days_tonnes_product, 0) > 0
                             THEN ri.rated_tonnes
                                  / (ri.weighted_days_tonnes_product / ri.rated_tonnes)
                                  * 365
                             ELSE 0
                        END
                )
                FROM rate_inputs ri
            )
        )
      FROM tonnage;

    -- 12) top_rebar_window_projects
    INSERT INTO market_snapshots
        (upload_id, snapshot_date, metric_code, dimension_key, metric_value_json)
    SELECT
        p_upload_id, v_upload.file_date, 'top_rebar_window_projects',
        p.id::text,
        jsonb_build_object(
            'project_name', p.name,
            'city', COALESCE(p.city, '(unknown)'),
            'sector', COALESCE(p.sector, '(unknown)'),
            'completion_pct', COALESCE(p.completion_percentage, 0),
            'value_aed', COALESCE(p.value_aed, 0),
            'estimated_completion_date', p.estimated_completion_date,
            'remaining_rebar_tonnes',
                CASE WHEN v_price > 0
                     THEN COALESCE(p.value_aed, 0) * v_share
                          * GREATEST(
                              0,
                              (v_threshold - p.completion_percentage) / NULLIF(v_threshold, 0)
                            )
                          / v_price
                     ELSE 0
                END
        )
      FROM projects p
     WHERE p.last_seen_in_upload_id = p_upload_id
       AND p.stage = 'under_construction'::project_stage_t
       AND p.completion_percentage IS NOT NULL
       AND p.completion_percentage < v_threshold
     ORDER BY p.value_aed DESC NULLS LAST
     LIMIT 10;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_market_snapshot(uuid) TO authenticated;
