-- 0036_generate_leadership_report.sql
-- M12 — Leadership Reports engine. Per §5.6.
--
-- generate_leadership_report(p_report_id) takes an existing draft row in
-- leadership_reports and populates:
--   - payload_json (full frozen snapshot)
--   - leadership_report_stakeholders (denormalised per-stakeholder snapshot)
--
-- Caller flow:
--   1. Server action INSERTs a leadership_reports row with status='draft',
--      report_type, period_label, period_start, period_end, fiscal_year,
--      fiscal_quarter, generated_by.
--   2. Server action calls this function with the new row's id.
--   3. Function builds payload_json and writes denormalised rows.
--
-- Idempotent: deletes existing leadership_report_stakeholders for the
-- report and rewrites payload_json + rows. Safe to call repeatedly while
-- a draft is being tuned. Locked once status flips to finalised — the
-- caller must check status before invoking.

CREATE OR REPLACE FUNCTION generate_leadership_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_report           leadership_reports%ROWTYPE;
    v_payload          jsonb;
    v_headlines        jsonb;
    v_kpi_team         jsonb;
    v_kpi_per_bdm      jsonb;
    v_ecosystem        jsonb;
    v_heat_maps        jsonb;
    v_pipeline         jsonb;
    v_key_progress     jsonb;
    v_market_snap      jsonb;
    v_decay_days       int;
    v_universe_total   int;
BEGIN
    -- Permissions: admin only. Cron context has no auth.uid() and we don't
    -- want cron generating reports anyway.
    IF auth.uid() IS NULL OR auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admins can generate leadership reports.';
    END IF;

    SELECT * INTO v_report FROM leadership_reports WHERE id = p_report_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Report % not found.', p_report_id;
    END IF;
    IF v_report.status <> 'draft' THEN
        RAISE EXCEPTION 'Cannot regenerate a % report. Create a new draft.', v_report.status;
    END IF;

    -- Wipe prior denormalised rows for this report — we rewrite fresh.
    DELETE FROM leadership_report_stakeholders WHERE report_id = p_report_id;

    SELECT (value_json->>'days')::int INTO v_decay_days
      FROM app_settings WHERE key = 'ecosystem_decay_window_days';
    v_decay_days := COALESCE(v_decay_days, 90);

    SELECT (value_json->>'total')::int INTO v_universe_total
      FROM app_settings WHERE key = 'kpi_universe_sizes';
    v_universe_total := COALESCE(v_universe_total, 789);

    -- =================================================================
    -- 1) Executive headlines
    -- =================================================================
    SELECT jsonb_build_object(
        'total_active_accounts', (
            SELECT COUNT(*) FROM companies
             WHERE is_active = true AND has_active_projects = true
        ),
        'new_l3_this_period', (
            SELECT COUNT(DISTINCT company_id) FROM level_history
             WHERE to_level = 'L3'::level_t
               AND is_forward = true AND is_credited = true
               AND changed_at::date BETWEEN v_report.period_start AND v_report.period_end
        ),
        'new_l4_this_period', (
            SELECT COUNT(DISTINCT company_id) FROM level_history
             WHERE to_level = 'L4'::level_t
               AND is_forward = true AND is_credited = true
               AND changed_at::date BETWEEN v_report.period_start AND v_report.period_end
        ),
        'new_l5_this_period', (
            SELECT COUNT(DISTINCT company_id) FROM level_history
             WHERE to_level = 'L5'::level_t
               AND is_forward = true AND is_credited = true
               AND changed_at::date BETWEEN v_report.period_start AND v_report.period_end
        ),
        'mous_signed', (
            SELECT COUNT(*) FROM documents
             WHERE doc_type IN (
                'mou_developer'::document_type_t,
                'mou_consultant'::document_type_t,
                'mou_contractor'::document_type_t,
                'tripartite'::document_type_t
             )
               AND signed_date BETWEEN v_report.period_start AND v_report.period_end
        ),
        'site_banners_installed', (
            SELECT COUNT(*) FROM documents
             WHERE doc_type = 'site_banner_approval'::document_type_t
               AND signed_date BETWEEN v_report.period_start AND v_report.period_end
        ),
        'case_studies_published', (
            SELECT COUNT(*) FROM documents
             WHERE doc_type = 'case_study'::document_type_t
               AND signed_date BETWEEN v_report.period_start AND v_report.period_end
        ),
        'announcements', (
            SELECT COUNT(*) FROM documents
             WHERE doc_type = 'announcement'::document_type_t
               AND signed_date BETWEEN v_report.period_start AND v_report.period_end
        )
    ) INTO v_headlines;

    -- =================================================================
    -- 2) KPI scorecard — team rollup (latest snapshot ≤ period_end)
    -- =================================================================
    SELECT COALESCE(jsonb_object_agg(driver, total), '{}'::jsonb)
      INTO v_kpi_team
      FROM (
        SELECT pt.driver,
               jsonb_build_object(
                 'actual', COALESCE(SUM(ka.actual_value), 0),
                 'target', COALESCE(SUM(
                   CASE
                     WHEN v_report.fiscal_quarter = 1 THEN pt.q1_target
                     WHEN v_report.fiscal_quarter = 2 THEN pt.q2_target
                     WHEN v_report.fiscal_quarter = 3 THEN pt.q3_target
                     WHEN v_report.fiscal_quarter = 4 THEN pt.q4_target
                     ELSE pt.annual_target
                   END
                 ), 0)
               ) AS total
          FROM playbook_targets pt
          LEFT JOIN kpi_actuals_daily ka
            ON ka.metric_code = pt.metric_code
           AND ka.fiscal_year = pt.fiscal_year
           AND ka.user_id IS NULL  -- team rollup rows
           AND ka.snapshot_date = (
                 SELECT MAX(snapshot_date) FROM kpi_actuals_daily
                  WHERE snapshot_date <= v_report.period_end
                    AND fiscal_year = pt.fiscal_year
                    AND user_id IS NULL
                    AND metric_code = pt.metric_code
               )
         WHERE pt.fiscal_year = v_report.fiscal_year
         GROUP BY pt.driver
      ) t;

    -- =================================================================
    -- 3) KPI scorecard — per BDM at period_end
    -- =================================================================
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'user_id',         p.id,
            'name',            p.full_name,
            'role',            p.role,
            'driver_a_pct',    bei.driver_a_pct,
            'driver_b_pct',    bei.driver_b_pct,
            'driver_c_pct',    bei.driver_c_pct,
            'driver_d_pct',    bei.driver_d_pct,
            'bei',             bei.bei,
            'bei_tier',        bei.bei_tier
        )), '[]'::jsonb)
      INTO v_kpi_per_bdm
      FROM profiles p
      LEFT JOIN bei_current_view bei
        ON bei.user_id = p.id
       AND bei.fiscal_year = v_report.fiscal_year
       AND (v_report.fiscal_quarter IS NULL OR bei.fiscal_quarter = v_report.fiscal_quarter)
     WHERE p.is_active = true
       AND p.role IN ('bd_manager', 'bd_head');

    -- =================================================================
    -- 4) Ecosystem awareness snapshot at period_end + recent quarter trend
    -- =================================================================
    SELECT jsonb_build_object(
        'snapshot', (
            SELECT to_jsonb(eac.*)
              FROM ecosystem_awareness_current eac
             WHERE eac.snapshot_date <= v_report.period_end
             ORDER BY eac.snapshot_date DESC
             LIMIT 1
        ),
        'quarterly_trend', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'snapshot_date', snapshot_date,
                       'lifetime_score', lifetime_score,
                       'active_score',  active_score
                   ) ORDER BY snapshot_date)
              FROM (
                SELECT DISTINCT ON (date_trunc('month', snapshot_date))
                       snapshot_date, lifetime_score, active_score
                  FROM ecosystem_awareness_current
                 WHERE snapshot_date <= v_report.period_end
                   AND snapshot_date >= v_report.period_end - interval '12 months'
                 ORDER BY date_trunc('month', snapshot_date), snapshot_date DESC
              ) m
        ), '[]'::jsonb)
    ) INTO v_ecosystem;

    -- =================================================================
    -- 5) Heat-map frozen counts at period_end
    -- =================================================================
    SELECT jsonb_build_object(
        'level_distribution', (
            SELECT COALESCE(jsonb_object_agg(current_level::text, n), '{}'::jsonb)
              FROM (
                SELECT current_level, COUNT(*) AS n
                  FROM companies
                 WHERE is_active = true AND is_in_kpi_universe = true
                 GROUP BY current_level
              ) t
        ),
        'level_distribution_universe_total', v_universe_total,
        'engagement_freshness', (
            SELECT jsonb_build_object(
                'hot_count',     COUNT(*) FILTER (WHERE bucket = 'hot'),
                'warm_count',    COUNT(*) FILTER (WHERE bucket = 'warm'),
                'cooling_count', COUNT(*) FILTER (WHERE bucket = 'cooling'),
                'cold_count',    COUNT(*) FILTER (WHERE bucket = 'cold'),
                'never_count',   COUNT(*) FILTER (WHERE bucket = 'never')
            )
              FROM (
                SELECT
                    c.id,
                    CASE
                        WHEN MAX(e.engagement_date) IS NULL THEN 'never'
                        WHEN v_report.period_end - MAX(e.engagement_date) <= 14  THEN 'hot'
                        WHEN v_report.period_end - MAX(e.engagement_date) <= 45  THEN 'warm'
                        WHEN v_report.period_end - MAX(e.engagement_date) <= 90  THEN 'cooling'
                        ELSE 'cold'
                    END AS bucket
                  FROM companies c
                  LEFT JOIN engagements e
                    ON e.company_id = c.id
                   AND e.engagement_date <= v_report.period_end
                 WHERE c.is_active = true AND c.is_in_kpi_universe = true
                 GROUP BY c.id
              ) t
        ),
        'geographic', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'city',  city,
                       'count', n
                   ) ORDER BY n DESC), '[]'::jsonb)
              FROM (
                SELECT COALESCE(c.city, '(unknown)') AS city, COUNT(*) AS n
                  FROM companies c
                 WHERE c.is_active = true AND c.is_in_kpi_universe = true
                 GROUP BY c.city
              ) t
        )
    ) INTO v_heat_maps;

    -- =================================================================
    -- 6) Pipeline movements during the period
    -- =================================================================
    SELECT jsonb_build_object(
        'forward_moves', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'company_id',   lh.company_id,
                       'company_name', c.canonical_name,
                       'from_level',   lh.from_level,
                       'to_level',     lh.to_level,
                       'date',         lh.changed_at,
                       'owner_name',   p.full_name,
                       'is_credited',  lh.is_credited
                   ) ORDER BY lh.changed_at DESC)
              FROM level_history lh
              JOIN companies c ON c.id = lh.company_id
              LEFT JOIN profiles p ON p.id = lh.owner_at_time
             WHERE lh.is_forward = true
               AND lh.changed_at::date BETWEEN v_report.period_start AND v_report.period_end
        ), '[]'::jsonb),
        'regressions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'company_id',   lh.company_id,
                       'company_name', c.canonical_name,
                       'from_level',   lh.from_level,
                       'to_level',     lh.to_level,
                       'date',         lh.changed_at,
                       'owner_name',   p.full_name
                   ) ORDER BY lh.changed_at DESC)
              FROM level_history lh
              JOIN companies c ON c.id = lh.company_id
              LEFT JOIN profiles p ON p.id = lh.owner_at_time
             WHERE lh.is_forward = false
               AND lh.changed_at::date BETWEEN v_report.period_start AND v_report.period_end
        ), '[]'::jsonb)
    ) INTO v_pipeline;

    -- =================================================================
    -- 7) Market snapshot reference — most recent BNC upload ≤ period_end
    -- =================================================================
    SELECT jsonb_build_object(
        'source_upload_id',   bu.id,
        'source_upload_date', bu.file_date,
        'projects_by_stage', COALESCE((
            SELECT jsonb_object_agg(stage, n)
              FROM (
                SELECT p.stage::text AS stage, COUNT(*) AS n
                  FROM projects p
                 WHERE p.last_seen_in_upload_id = bu.id
                 GROUP BY p.stage
              ) t
        ), '{}'::jsonb),
        'total_market_value_aed', COALESCE((
            SELECT SUM(p.value_aed)
              FROM projects p
             WHERE p.last_seen_in_upload_id = bu.id
        ), 0)
    ) INTO v_market_snap
      FROM bnc_uploads bu
     WHERE bu.status = 'completed'
       AND bu.file_date <= v_report.period_end
     ORDER BY bu.file_date DESC
     LIMIT 1;

    IF v_market_snap IS NULL THEN
        v_market_snap := jsonb_build_object(
            'source_upload_id', NULL,
            'source_upload_date', NULL,
            'projects_by_stage', '{}'::jsonb,
            'total_market_value_aed', 0
        );
    END IF;

    -- =================================================================
    -- 8) Denormalised stakeholder rows + key-stakeholder progress array
    -- =================================================================
    -- We snapshot every key stakeholder + every company touched during the
    -- period (forward level move OR new engagement OR new document).
    INSERT INTO leadership_report_stakeholders (
        report_id, company_id, company_name_at_time,
        company_type_at_time, level_at_time, owner_at_time, owner_name_at_time,
        last_engagement_at_time, active_projects_count_at_time,
        lifetime_ecosystem_points, active_ecosystem_points,
        is_key_stakeholder, moved_this_period, flagged_stagnating
    )
    SELECT
        p_report_id,
        c.id,
        c.canonical_name,
        c.company_type,
        c.current_level,
        c.owner_id,
        owner_p.full_name,
        (SELECT MAX(engagement_date) FROM engagements
          WHERE company_id = c.id AND engagement_date <= v_report.period_end),
        (SELECT COUNT(*) FROM project_companies pc
          WHERE pc.company_id = c.id AND pc.is_current = true)::int,
        COALESCE((SELECT SUM(points) FROM ecosystem_events
                   WHERE company_id = c.id AND is_void = false
                     AND occurred_at <= v_report.period_end), 0),
        COALESCE((SELECT SUM(points) FROM ecosystem_events
                   WHERE company_id = c.id AND is_void = false
                     AND occurred_at <= v_report.period_end
                     AND occurred_at >= v_report.period_end - make_interval(days => v_decay_days)), 0),
        COALESCE(c.is_key_stakeholder, false),
        EXISTS (
            SELECT 1 FROM level_history lh
             WHERE lh.company_id = c.id
               AND lh.is_forward = true AND lh.is_credited = true
               AND lh.changed_at::date BETWEEN v_report.period_start AND v_report.period_end
        ),
        EXISTS (
            SELECT 1 FROM notifications n
             WHERE n.related_company_id = c.id
               AND n.notification_type IN (
                   'stagnation_warning'::notification_type_t,
                   'stagnation_breach'::notification_type_t
               )
               AND n.sent_in_app_at::date BETWEEN v_report.period_start AND v_report.period_end
        )
      FROM companies c
      LEFT JOIN profiles owner_p ON owner_p.id = c.owner_id
     WHERE c.is_active = true
       AND (
            c.is_key_stakeholder = true
         OR EXISTS (
              SELECT 1 FROM level_history lh
               WHERE lh.company_id = c.id
                 AND lh.changed_at::date BETWEEN v_report.period_start AND v_report.period_end
            )
         OR EXISTS (
              SELECT 1 FROM engagements e
               WHERE e.company_id = c.id
                 AND e.engagement_date BETWEEN v_report.period_start AND v_report.period_end
            )
         OR EXISTS (
              SELECT 1 FROM documents d
               WHERE d.company_id = c.id
                 AND d.signed_date BETWEEN v_report.period_start AND v_report.period_end
            )
       );

    -- key_stakeholder_progress array — pulled from the rows we just inserted
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'company_id',      lrs.company_id,
            'company_name',    lrs.company_name_at_time,
            'company_type',    lrs.company_type_at_time,
            'current_level',   lrs.level_at_time,
            'owner_name',      lrs.owner_name_at_time,
            'last_engagement', lrs.last_engagement_at_time,
            'moved_this_period', lrs.moved_this_period,
            'flagged_stagnating', lrs.flagged_stagnating,
            'lifetime_ecosystem_points', lrs.lifetime_ecosystem_points,
            'active_ecosystem_points',   lrs.active_ecosystem_points,
            'narrative',       lrs.narrative
           ) ORDER BY lrs.company_name_at_time), '[]'::jsonb)
      INTO v_key_progress
      FROM leadership_report_stakeholders lrs
     WHERE lrs.report_id = p_report_id
       AND lrs.is_key_stakeholder = true;

    -- =================================================================
    -- 9) Assemble payload + persist
    -- =================================================================
    v_payload := jsonb_build_object(
        'report_metadata', jsonb_build_object(
            'period_label',   v_report.period_label,
            'period_start',   v_report.period_start,
            'period_end',     v_report.period_end,
            'fiscal_year',    v_report.fiscal_year,
            'fiscal_quarter', v_report.fiscal_quarter,
            'report_type',    v_report.report_type,
            'generated_at',   now(),
            'universe_total', v_universe_total
        ),
        'executive_headlines', v_headlines,
        'kpi_scorecard', jsonb_build_object(
            'team_rollup', v_kpi_team,
            'per_bdm',     v_kpi_per_bdm
        ),
        'ecosystem_awareness',     v_ecosystem,
        'heat_maps_frozen_state',  v_heat_maps,
        'pipeline_movements',      v_pipeline,
        'key_stakeholder_progress', v_key_progress,
        'market_snapshot_reference', v_market_snap
    );

    UPDATE leadership_reports
       SET payload_json = v_payload,
           updated_at   = now()
     WHERE id = p_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_leadership_report(uuid) TO authenticated;
