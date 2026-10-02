-- 0109_disable_consultant_ratio_drift.sql
-- Stop generating `composition_drift` notifications on
-- metric_pair = 'consultant_ratio'. Driver C (consultant_approvals)
-- is not instrumented end-to-end: the metric code exists in
-- playbook_targets but kpi_actuals_daily never populates its actuals,
-- so the drift check against v_consultant_target_ratio compared a
-- real level_history-derived ratio against a target_ratio derived
-- from an un-instrumented metric, producing dead alerts.
--
-- Only `eval_composition_drift()` is modified. The developer_ratio
-- branch is retained unchanged (A and B drivers are both instrumented
-- via level_history). Preserved: all existing notifications and
-- composition_drift_log rows (no DELETE); pg_cron
-- 'composition-drift-weekly' schedule (unchanged — the weekly tick
-- still runs, but now only evaluates developer_ratio).
--
-- Re-enable path (when Driver C is instrumented): revert this
-- migration. The function body returns to the two-pair form at
-- supabase/migrations/0058_fix_eval_composition_drift_ambiguous_fired.sql
-- (lines 20-212). Nothing else needs flipping — no app_settings
-- flag, no cron change, no notifications schema change.
--
-- Diff vs 0058:
--   1. Local vars v_consultant_target_ratio and v_c_app and their
--      SELECT INTO are removed.
--   2. The `UNION ALL SELECT ..., 'consultant_ratio'::text, ...`
--      branch of the `eval` CTE is removed.
-- Everything else is byte-identical to 0058.

CREATE OR REPLACE FUNCTION eval_composition_drift()
RETURNS TABLE(fired int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fired int := 0;
    v_today date := current_date;
    v_fy int := EXTRACT(YEAR FROM v_today)::int;
    v_fq int := EXTRACT(QUARTER FROM v_today)::int;
    v_q_start date;
    v_q_end date;
    v_q_pct numeric;
    v_min_pct numeric;
    v_min_sample int;
    v_threshold numeric;
    v_cooldown_days int;
    v_dev_target_ratio numeric;
    v_dev_l3 numeric;
    v_a_l3 numeric;
BEGIN
    IF auth.uid() IS NOT NULL AND auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    SELECT (value_json->>'pct')::numeric INTO v_min_pct
      FROM app_settings WHERE key = 'composition_drift_min_quarter_pct';
    v_min_pct := COALESCE(v_min_pct, 30) / 100.0;
    SELECT (value_json->>'n')::int INTO v_min_sample
      FROM app_settings WHERE key = 'composition_drift_min_sample_size';
    v_min_sample := COALESCE(v_min_sample, 5);
    SELECT (value_json->>'ratio')::numeric INTO v_threshold
      FROM app_settings WHERE key = 'composition_drift_ratio_threshold';
    v_threshold := COALESCE(v_threshold, 0.70);
    SELECT (value_json->>'days')::int INTO v_cooldown_days
      FROM app_settings WHERE key = 'composition_drift_cooldown_days';
    v_cooldown_days := COALESCE(v_cooldown_days, 14);

    v_q_start := date_trunc('quarter', v_today)::date;
    v_q_end   := (v_q_start + interval '3 months - 1 day')::date;
    v_q_pct   := (v_today - v_q_start)::numeric / NULLIF((v_q_end - v_q_start), 0)::numeric;

    IF v_q_pct < v_min_pct THEN
        fired := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT pt.annual_target INTO v_dev_l3
      FROM playbook_targets pt
     WHERE pt.metric_code = 'driver_b_dev_l3' AND pt.fiscal_year = v_fy;
    SELECT pt.annual_target INTO v_a_l3
      FROM playbook_targets pt
     WHERE pt.metric_code = 'driver_a_l3' AND pt.fiscal_year = v_fy;

    v_dev_target_ratio := CASE WHEN v_a_l3 IS NULL OR v_a_l3 = 0
                                THEN 0
                                ELSE COALESCE(v_dev_l3, 0) / v_a_l3
                          END;

    WITH bdms AS (
        SELECT id AS user_id, full_name
          FROM profiles
         WHERE is_active = true AND role = 'bd_manager'
    ),
    bdm_l3 AS (
        SELECT
            lh.owner_at_time AS user_id,
            COUNT(*) FILTER (WHERE lh.to_level IN ('L3', 'L4', 'L5')) AS l3_plus_count,
            COUNT(*) FILTER (
                WHERE lh.to_level IN ('L3', 'L4', 'L5')
                  AND lh.company_type_at_time = 'developer'
            ) AS dev_count
          FROM level_history lh
         WHERE lh.is_forward = true AND lh.is_credited = true
           AND lh.changed_at::date BETWEEN v_q_start AND v_q_end
         GROUP BY lh.owner_at_time
    ),
    last_fired AS (
        SELECT cdl.user_id, cdl.metric_pair, MAX(cdl.cooldown_until) AS cooldown_until
          FROM composition_drift_log cdl
         WHERE cdl.fired = true               -- qualified to disambiguate from OUT param
         GROUP BY cdl.user_id, cdl.metric_pair
    ),
    eval AS (
        -- 0109: consultant_ratio UNION branch removed. Driver C (consultant
        -- approvals) is not instrumented; evaluating a BDM's actual
        -- consultant-ratio against an un-instrumented target_ratio
        -- generated dead alerts. developer_ratio branch retained unchanged.
        SELECT
            b.user_id,
            'developer_ratio'::text AS metric_pair,
            COALESCE(bl.l3_plus_count, 0) AS movements,
            CASE WHEN COALESCE(bl.l3_plus_count, 0) = 0 THEN 0
                 ELSE COALESCE(bl.dev_count, 0)::numeric / bl.l3_plus_count
            END AS actual_ratio,
            v_dev_target_ratio AS target_ratio
          FROM bdms b
          LEFT JOIN bdm_l3 bl ON bl.user_id = b.user_id
    ),
    decided AS (
        SELECT
            e.*,
            CASE WHEN e.target_ratio = 0 THEN 0
                 ELSE e.actual_ratio / e.target_ratio
            END AS drift_pct,
            (e.movements >= v_min_sample
             AND e.target_ratio > 0
             AND (e.actual_ratio / e.target_ratio) < v_threshold
             AND NOT EXISTS (
                SELECT 1 FROM last_fired lf
                 WHERE lf.user_id = e.user_id
                   AND lf.metric_pair = e.metric_pair
                   AND lf.cooldown_until > now()
             )) AS should_fire
          FROM eval e
    ),
    inserted_notifications AS (
        INSERT INTO notifications (
            recipient_id, notification_type, subject, body, link_url, channels
        )
        SELECT
            t.recipient_id,
            'composition_drift'::notification_type_t,
            format('%s drift: %s%% of target ratio', d.metric_pair,
                   round(d.drift_pct * 100, 0)),
            format(
                '%s movements logged this quarter, ratio %s vs target %s (%s%% of target). Course-correct before quarter-end.',
                d.movements,
                round(d.actual_ratio, 2),
                round(d.target_ratio, 2),
                round(d.drift_pct * 100, 0)
            ),
            '/dashboard',
            ARRAY['in_app']::text[]
          FROM decided d
          CROSS JOIN LATERAL (
            SELECT d.user_id AS recipient_id
            UNION
            SELECT p.id FROM profiles p
             WHERE p.is_active = true AND p.role IN ('bd_head','admin')
          ) t
         WHERE d.should_fire
        RETURNING 1
    ),
    inserted_log AS (
        INSERT INTO composition_drift_log (
            user_id, metric_pair, fiscal_year, fiscal_quarter,
            movements_sampled, actual_ratio, target_ratio, drift_pct,
            fired, cooldown_until
        )
        SELECT
            d.user_id, d.metric_pair, v_fy, v_fq,
            d.movements, d.actual_ratio, d.target_ratio, d.drift_pct,
            d.should_fire,
            CASE WHEN d.should_fire THEN now() + make_interval(days => v_cooldown_days)
                 ELSE NULL END
          FROM decided d
        RETURNING 1
    )
    SELECT COUNT(*) FROM inserted_notifications INTO v_fired;

    fired := v_fired;
    RETURN NEXT;
END;
$$;
