-- 0072_rebuild_kpi_actuals_full_wipe.sql
-- Root-cause fix for dashboard double-counting.
--
-- 0030's rebuild_kpi_actuals(target_date) deletes only the rows for
-- target_date, then re-inserts that date's counts. The dashboard
-- (src/app/(app)/dashboard/page.tsx:131-147) reads kpi_actuals_daily
-- filtered by user_id + fiscal_year only — NO snapshot_date filter —
-- then SUMs actual_value per (metric_code, fiscal_quarter). With the
-- hourly cron tick writing a fresh dated row each pass, the same FY/Q
-- counts get added over and over: by day N, the dashboard tile reads
-- N × the true count. The bug was masked while every day showed the
-- same numbers and only surfaced after the pipeline reset, when the
-- pre-reset days kept contributing to the SUM that today's empty
-- snapshot couldn't undo.
--
-- Two reasonable fixes:
--   (A) Make rebuild_kpi_actuals wipe the entire table — kpi_actuals_daily
--       becomes "current snapshot only", matching how the dashboard
--       actually consumes it.
--   (B) Filter every dashboard query by max(snapshot_date).
--
-- We're taking (A). The table has no consumer that depends on
-- historical snapshots; bei_current_view (the only other read path)
-- is refreshed in the same call. Storage shrinks too.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Same signature; only the
-- DELETE predicate changes (line 24 of 0030 became unconditional).

CREATE OR REPLACE FUNCTION rebuild_kpi_actuals(
    p_target_date date DEFAULT current_date
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total int := 0;
    v_added int;
BEGIN
    -- Full wipe (was: WHERE snapshot_date = p_target_date) — the table
    -- carries only the current snapshot, never accumulating.
    DELETE FROM kpi_actuals_daily;

    -- Driver A — L3/L4/L5 stakeholders per BDM, by FY/Q
    WITH ins AS (
        INSERT INTO kpi_actuals_daily (snapshot_date, user_id, metric_code, fiscal_year, fiscal_quarter, actual_value)
        SELECT
            p_target_date,
            lh.owner_at_time,
            CASE lh.to_level
                WHEN 'L3' THEN 'driver_a_l3'
                WHEN 'L4' THEN 'driver_a_l4'
                WHEN 'L5' THEN 'driver_a_l5'
            END,
            lh.fiscal_year,
            lh.fiscal_quarter,
            COUNT(*)
        FROM level_history lh
        WHERE lh.is_forward AND lh.is_credited
          AND lh.to_level IN ('L3'::level_t, 'L4'::level_t, 'L5'::level_t)
          AND lh.owner_at_time IS NOT NULL
        GROUP BY lh.owner_at_time, lh.to_level, lh.fiscal_year, lh.fiscal_quarter
        RETURNING 1
    )
    SELECT count(*) INTO v_added FROM ins;
    v_total := v_total + v_added;

    -- Driver B — developer subset of Driver A
    WITH ins AS (
        INSERT INTO kpi_actuals_daily (snapshot_date, user_id, metric_code, fiscal_year, fiscal_quarter, actual_value)
        SELECT
            p_target_date,
            lh.owner_at_time,
            CASE lh.to_level
                WHEN 'L3' THEN 'driver_b_dev_l3'
                WHEN 'L4' THEN 'driver_b_dev_l4'
                WHEN 'L5' THEN 'driver_b_dev_l5'
            END,
            lh.fiscal_year,
            lh.fiscal_quarter,
            COUNT(*)
        FROM level_history lh
        WHERE lh.is_forward AND lh.is_credited
          AND lh.to_level IN ('L3'::level_t, 'L4'::level_t, 'L5'::level_t)
          AND lh.company_type_at_time = 'developer'::company_type_t
          AND lh.owner_at_time IS NOT NULL
        GROUP BY lh.owner_at_time, lh.to_level, lh.fiscal_year, lh.fiscal_quarter
        RETURNING 1
    )
    SELECT count(*) INTO v_added FROM ins;
    v_total := v_total + v_added;

    -- Driver C — engagement-driven metrics. Attribution: created_by.
    WITH ins AS (
        INSERT INTO kpi_actuals_daily (snapshot_date, user_id, metric_code, fiscal_year, fiscal_quarter, actual_value)
        SELECT
            p_target_date,
            e.created_by,
            CASE e.engagement_type
                WHEN 'consultant_approval' THEN 'driver_c_consultant_approvals'
                WHEN 'spec_inclusion'      THEN 'driver_c_spec_template_inclusions'
                WHEN 'design_stage_intro'  THEN 'driver_c_design_stage_projects'
            END,
            fiscal_year_of(e.engagement_date::timestamptz),
            fiscal_quarter_of(e.engagement_date::timestamptz),
            COUNT(*)
        FROM engagements e
        WHERE e.engagement_type IN (
                'consultant_approval'::engagement_type_t,
                'spec_inclusion'::engagement_type_t,
                'design_stage_intro'::engagement_type_t
            )
          AND e.created_by IS NOT NULL
        GROUP BY
            e.created_by,
            e.engagement_type,
            fiscal_year_of(e.engagement_date::timestamptz),
            fiscal_quarter_of(e.engagement_date::timestamptz)
        RETURNING 1
    )
    SELECT count(*) INTO v_added FROM ins;
    v_total := v_total + v_added;

    -- Driver D — document-driven metrics. Attribution: uploaded_by.
    WITH ins AS (
        INSERT INTO kpi_actuals_daily (snapshot_date, user_id, metric_code, fiscal_year, fiscal_quarter, actual_value)
        SELECT
            p_target_date,
            d.uploaded_by,
            CASE d.doc_type
                WHEN 'announcement'         THEN 'driver_d_announcements'
                WHEN 'site_banner_approval' THEN 'driver_d_site_banners'
                WHEN 'case_study'           THEN 'driver_d_case_studies'
            END,
            fiscal_year_of(COALESCE(d.signed_date::timestamptz, d.created_at)),
            fiscal_quarter_of(COALESCE(d.signed_date::timestamptz, d.created_at)),
            COUNT(*)
        FROM documents d
        WHERE d.doc_type IN (
                'announcement'::document_type_t,
                'site_banner_approval'::document_type_t,
                'case_study'::document_type_t
            )
          AND d.uploaded_by IS NOT NULL
          AND d.is_archived = false
        GROUP BY
            d.uploaded_by,
            d.doc_type,
            fiscal_year_of(COALESCE(d.signed_date::timestamptz, d.created_at)),
            fiscal_quarter_of(COALESCE(d.signed_date::timestamptz, d.created_at))
        RETURNING 1
    )
    SELECT count(*) INTO v_added FROM ins;
    v_total := v_total + v_added;

    -- Team rollup rows (user_id = NULL): sum across all BDMs per metric.
    INSERT INTO kpi_actuals_daily (snapshot_date, user_id, metric_code, fiscal_year, fiscal_quarter, actual_value)
    SELECT
        p_target_date,
        NULL::uuid,
        metric_code,
        fiscal_year,
        fiscal_quarter,
        SUM(actual_value)
    FROM kpi_actuals_daily
    WHERE snapshot_date = p_target_date AND user_id IS NOT NULL
    GROUP BY metric_code, fiscal_year, fiscal_quarter;

    -- Refresh the BEI matview so dashboards reflect the new actuals.
    REFRESH MATERIALIZED VIEW CONCURRENTLY bei_current_view;

    RETURN v_total;
END;
$$;

COMMENT ON FUNCTION rebuild_kpi_actuals(date) IS
    'M8 KPI rollup. Aggregates level_history + engagements + documents '
    'into kpi_actuals_daily for the given snapshot date, then refreshes '
    'bei_current_view. Wipes the table entirely on each call — the table '
    'carries the current snapshot only (changed from per-date wipe in '
    '0072 to stop dashboard double-counting from the no-snapshot-filter '
    'SUM in src/app/(app)/dashboard/page.tsx).';
