-- 0090_rebuild_kpi_actuals_qualified_delete.sql
-- "Rebuild KPI now" fails on prod with `Error: DELETE requires a
-- WHERE clause`. The safety guard is a Supabase-project-level
-- setting some deployments have enabled that rejects unqualified
-- DELETE / UPDATE. Been latent since 0072 introduced the full-wipe
-- (line 42) and carried into 0085's rewrite (line 280). The prod
-- project has evidently had the guard flipped on.
--
-- Fix: make the wipe explicit — `DELETE FROM kpi_actuals_daily
-- WHERE true`. Semantically identical to the previous body, the
-- guard is happy, and readers see the intent ("yes, all rows").
-- Everything else in the function is byte-for-byte 0085.

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
    -- Full wipe. `WHERE true` is explicit-all — same result as an
    -- unqualified DELETE but satisfies Supabase's guard against
    -- accidental bare deletes.
    DELETE FROM kpi_actuals_daily WHERE true;

    -- Driver A — L3/L4/L5 stakeholders per BDM, by FY/Q.
    -- Filters on source='progression' (0085) so initial_backfill
    -- rows do NOT credit earned Driver A movement.
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
          AND lh.source = 'progression'
          AND lh.to_level IN ('L3'::level_t, 'L4'::level_t, 'L5'::level_t)
          AND lh.owner_at_time IS NOT NULL
        GROUP BY lh.owner_at_time, lh.to_level, lh.fiscal_year, lh.fiscal_quarter
        RETURNING 1
    )
    SELECT count(*) INTO v_added FROM ins;
    v_total := v_total + v_added;

    -- Driver B — developer subset of Driver A. Deliberately NOT
    -- filtered on source per the 0085 brief.
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

    -- Driver C — engagement-driven. Byte-for-byte 0085.
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

    -- Driver D — document-driven. Byte-for-byte 0085.
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

    -- Team rollup. Byte-for-byte 0085.
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

    REFRESH MATERIALIZED VIEW CONCURRENTLY bei_current_view;

    RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION rebuild_kpi_actuals(date) TO authenticated;

COMMENT ON FUNCTION rebuild_kpi_actuals(date) IS
    'M8 KPI rollup. Aggregates level_history + engagements + documents '
    'into kpi_actuals_daily for the given snapshot date, then refreshes '
    'bei_current_view. Wipes the table entirely on each call (DELETE ... '
    'WHERE true — explicit-all form satisfying the Supabase unqualified-'
    'delete guard). Driver A filters to source=''progression'' so CRM-'
    'setup backfill rows do not credit earned movement; Driver B/C/D '
    'unaffected.';
