-- 0030_rebuild_kpi_actuals.sql
-- M8 — KPI rollup. Aggregates level_history (Driver A/B), engagements
-- (Driver C), and documents (Driver D) into the kpi_actuals_daily
-- snapshot for a given date. Idempotent: deletes the snapshot for
-- p_target_date first, then re-inserts.
--
-- Returns the total number of rows written.
--
-- Designed to be called from:
--   - Manual admin trigger (Dashboard "Rebuild KPI now")
--   - The kpi-rebuild-nightly Edge Function (cron, M8 polish)

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
    DELETE FROM kpi_actuals_daily WHERE snapshot_date = p_target_date;

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

GRANT EXECUTE ON FUNCTION rebuild_kpi_actuals(date) TO authenticated;

COMMENT ON FUNCTION rebuild_kpi_actuals(date) IS
    'M8 KPI rollup. Aggregates level_history + engagements + documents into kpi_actuals_daily for the given snapshot date, then refreshes bei_current_view.';

-- =====================================================================
-- View wrapper for BEI so RLS gates it (matview can't have RLS directly).
-- =====================================================================

CREATE OR REPLACE VIEW bei_for_caller
WITH (security_invoker = true)
AS
SELECT
    user_id,
    fiscal_year,
    fiscal_quarter,
    driver_a_pct,
    driver_b_pct,
    driver_c_pct,
    driver_d_pct,
    bei,
    bei_tier,
    last_computed_at
FROM bei_current_view;

COMMENT ON VIEW bei_for_caller IS
    'BEI per BDM, security_invoker so callers see only what their RLS on profiles allows transitively. bd_manager sees own row; admin/bd_head/leadership see all.';
