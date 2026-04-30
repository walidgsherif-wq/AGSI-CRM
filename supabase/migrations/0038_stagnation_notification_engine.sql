-- 0038_stagnation_notification_engine.sql
-- M13 — three SECURITY DEFINER eval functions that fire notifications.
-- §3.11 / §3.12 / §3.12b / §6.1 / §5.3 / §5.3b.
--
-- Wiring: cron schedules already registered in 0021 (stagnation-daily,
-- composition-warning-weekly, composition-drift-weekly) point at Edge
-- Functions. v1 of M13 doesn't ship those Edge Functions — admin
-- triggers the eval manually from /admin/notifications-eval. Cron can
-- be wired later as thin Edge Function wrappers calling the same RPCs.
--
-- All three functions are admin-only (cron context with NULL auth.uid()
-- bypasses the role gate; manual triggers go through the role gate).

-- =====================================================================
-- 1) eval_stagnation()
-- =====================================================================
-- For every active company in the KPI universe with an owner, computes
-- days-in-current-level. Fires:
--   - stagnation_warning at warn_at_pct% of max_days_in_level
--   - stagnation_breach  at 100% (max_days_in_level)
-- Both deduped per company per level-entry: don't re-fire while the
-- company sits at the same level — only when it moves do new firings
-- become possible.

CREATE OR REPLACE FUNCTION eval_stagnation()
RETURNS TABLE(warnings_fired int, breaches_fired int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_warnings int := 0;
    v_breaches int := 0;
    v_today date := current_date;
BEGIN
    IF auth.uid() IS NOT NULL AND auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    -- Companies past the breach threshold for their current level.
    -- Skip those that already received a breach since they entered
    -- the current level.
    WITH candidate AS (
        SELECT
            c.id            AS company_id,
            c.canonical_name,
            c.owner_id,
            c.current_level,
            COALESCE(c.level_changed_at, c.created_at) AS since_at,
            r.max_days_in_level,
            r.warn_at_pct,
            r.escalate_at_pct,
            r.escalation_role,
            (v_today - COALESCE(c.level_changed_at, c.created_at)::date) AS days_in_level
          FROM companies c
          JOIN stagnation_rules r ON r.level = c.current_level AND r.is_active = true
         WHERE c.is_active = true
           AND c.is_in_kpi_universe = true
           AND c.owner_id IS NOT NULL
    ),
    breach_targets AS (
        SELECT *
          FROM candidate
         WHERE days_in_level >= max_days_in_level
           AND NOT EXISTS (
                SELECT 1 FROM notifications n
                 WHERE n.related_company_id = candidate.company_id
                   AND n.notification_type = 'stagnation_breach'
                   AND n.created_at >= candidate.since_at
           )
    ),
    inserted_breach AS (
        INSERT INTO notifications (
            recipient_id, notification_type, subject, body, link_url,
            channels, related_company_id
        )
        SELECT
            t.recipient_id,
            'stagnation_breach'::notification_type_t,
            format('Stagnation breach: %s at %s for %s days',
                   bt.canonical_name, bt.current_level, bt.days_in_level),
            format(
                'Company %s has been at %s for %s days (threshold %s). Owner: %s. Escalation role: %s.',
                bt.canonical_name, bt.current_level, bt.days_in_level,
                bt.max_days_in_level,
                COALESCE(owner_p.full_name, '(unassigned)'),
                bt.escalation_role
            ),
            '/companies/' || bt.company_id::text,
            ARRAY['in_app']::text[],
            bt.company_id
          FROM breach_targets bt
          LEFT JOIN profiles owner_p ON owner_p.id = bt.owner_id
          CROSS JOIN LATERAL (
            -- Recipients: owner first; plus every active user in
            -- escalation_role.
            SELECT bt.owner_id AS recipient_id
            UNION
            SELECT p.id
              FROM profiles p
             WHERE p.is_active = true
               AND p.role::text = bt.escalation_role::text
          ) t
         WHERE t.recipient_id IS NOT NULL
        RETURNING company_id
    )
    SELECT COUNT(DISTINCT company_id) INTO v_breaches FROM inserted_breach;

    -- Warning candidates: in the warn band but below breach, and no
    -- warning OR breach already fired since they entered this level.
    WITH candidate AS (
        SELECT
            c.id            AS company_id,
            c.canonical_name,
            c.owner_id,
            c.current_level,
            COALESCE(c.level_changed_at, c.created_at) AS since_at,
            r.max_days_in_level,
            r.warn_at_pct,
            (v_today - COALESCE(c.level_changed_at, c.created_at)::date) AS days_in_level
          FROM companies c
          JOIN stagnation_rules r ON r.level = c.current_level AND r.is_active = true
         WHERE c.is_active = true
           AND c.is_in_kpi_universe = true
           AND c.owner_id IS NOT NULL
    ),
    warn_targets AS (
        SELECT *
          FROM candidate
         WHERE days_in_level >= (max_days_in_level * warn_at_pct) / 100
           AND days_in_level < max_days_in_level
           AND NOT EXISTS (
                SELECT 1 FROM notifications n
                 WHERE n.related_company_id = candidate.company_id
                   AND n.notification_type IN (
                        'stagnation_warning'::notification_type_t,
                        'stagnation_breach'::notification_type_t
                   )
                   AND n.created_at >= candidate.since_at
           )
    ),
    inserted_warn AS (
        INSERT INTO notifications (
            recipient_id, notification_type, subject, body, link_url,
            channels, related_company_id
        )
        SELECT
            wt.owner_id,
            'stagnation_warning'::notification_type_t,
            format('Stagnation warning: %s at %s for %s days',
                   wt.canonical_name, wt.current_level, wt.days_in_level),
            format(
                'Company %s has been at %s for %s days (warning threshold %s; breach at %s).',
                wt.canonical_name, wt.current_level, wt.days_in_level,
                (wt.max_days_in_level * wt.warn_at_pct) / 100,
                wt.max_days_in_level
            ),
            '/companies/' || wt.company_id::text,
            ARRAY['in_app']::text[],
            wt.company_id
          FROM warn_targets wt
        RETURNING company_id
    )
    SELECT COUNT(*) INTO v_warnings FROM inserted_warn;

    warnings_fired := v_warnings;
    breaches_fired := v_breaches;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION eval_stagnation() TO authenticated;


-- =====================================================================
-- 2) eval_composition_warning()
-- =====================================================================
-- Per BDM: when on track for a Driver A headline target but missing
-- the matching Driver B / Driver C composition sub-target, fire a
-- composition_warning to BDM + BD Head. Per §3.12.
--
-- Composition pairs (headline → composition):
--   driver_a_l3 → driver_b_dev_l3
--   driver_a_l4 → driver_b_dev_l4
--   driver_a_l5 → driver_b_dev_l5
--   driver_a_l3 → driver_c_consultant_approvals
--
-- Thresholds from app_settings.composition_warning_thresholds:
--   headline_pct (default 80)
--   composition_pct (default 60)
--
-- Dedup: don't re-fire the same (user, headline, composition) pair
-- within the current fiscal quarter once it has fired.

CREATE OR REPLACE FUNCTION eval_composition_warning()
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
    v_headline_pct numeric;
    v_composition_pct numeric;
BEGIN
    IF auth.uid() IS NOT NULL AND auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    SELECT (value_json->>'headline_pct')::numeric, (value_json->>'composition_pct')::numeric
      INTO v_headline_pct, v_composition_pct
      FROM app_settings WHERE key = 'composition_warning_thresholds';
    v_headline_pct    := COALESCE(v_headline_pct, 80) / 100.0;
    v_composition_pct := COALESCE(v_composition_pct, 60) / 100.0;

    WITH pairs AS (
        SELECT * FROM (VALUES
            ('driver_a_l3', 'driver_b_dev_l3'),
            ('driver_a_l4', 'driver_b_dev_l4'),
            ('driver_a_l5', 'driver_b_dev_l5'),
            ('driver_a_l3', 'driver_c_consultant_approvals')
        ) AS p(headline_code, composition_code)
    ),
    bdms AS (
        SELECT id AS user_id, full_name
          FROM profiles
         WHERE is_active = true AND role = 'bd_manager'
    ),
    targets AS (
        -- Per-user target per metric for the current quarter (member
        -- override → playbook fallback).
        SELECT
            b.user_id,
            pt.metric_code,
            COALESCE(
              CASE v_fq
                WHEN 1 THEN mt.q1_target
                WHEN 2 THEN mt.q2_target
                WHEN 3 THEN mt.q3_target
                WHEN 4 THEN mt.q4_target
              END,
              CASE v_fq
                WHEN 1 THEN pt.q1_target
                WHEN 2 THEN pt.q2_target
                WHEN 3 THEN pt.q3_target
                WHEN 4 THEN pt.q4_target
              END
            ) AS target_value
          FROM bdms b
         CROSS JOIN playbook_targets pt
          LEFT JOIN member_targets mt
            ON mt.user_id = b.user_id
           AND mt.metric_code = pt.metric_code
           AND mt.fiscal_year = pt.fiscal_year
         WHERE pt.fiscal_year = v_fy
    ),
    actuals AS (
        SELECT
            ka.user_id,
            ka.metric_code,
            ka.actual_value
          FROM kpi_actuals_daily ka
         WHERE ka.fiscal_year = v_fy
           AND ka.fiscal_quarter = v_fq
           AND ka.user_id IS NOT NULL
           AND ka.snapshot_date = (
                 SELECT MAX(snapshot_date) FROM kpi_actuals_daily
                  WHERE fiscal_year = v_fy AND fiscal_quarter = v_fq
                    AND user_id = ka.user_id
                    AND metric_code = ka.metric_code
               )
    ),
    candidates AS (
        SELECT
            b.user_id,
            b.full_name,
            p.headline_code,
            p.composition_code,
            COALESCE(ah.actual_value, 0)  AS headline_actual,
            COALESCE(th.target_value, 0)  AS headline_target,
            COALESCE(ac.actual_value, 0)  AS composition_actual,
            COALESCE(tc.target_value, 0)  AS composition_target
          FROM bdms b
         CROSS JOIN pairs p
          LEFT JOIN actuals ah ON ah.user_id = b.user_id AND ah.metric_code = p.headline_code
          LEFT JOIN actuals ac ON ac.user_id = b.user_id AND ac.metric_code = p.composition_code
          LEFT JOIN targets th ON th.user_id = b.user_id AND th.metric_code = p.headline_code
          LEFT JOIN targets tc ON tc.user_id = b.user_id AND tc.metric_code = p.composition_code
    ),
    triggers AS (
        SELECT *
          FROM candidates
         WHERE headline_target > 0 AND composition_target > 0
           AND headline_actual    >= v_headline_pct    * headline_target
           AND composition_actual <  v_composition_pct * composition_target
           AND NOT EXISTS (
                -- Already fired this quarter for this user + composition pair.
                SELECT 1 FROM notifications n
                 WHERE n.recipient_id = candidates.user_id
                   AND n.notification_type = 'composition_warning'
                   AND n.created_at >= date_trunc('quarter', v_today)
                   AND n.body LIKE '%' || candidates.composition_code || '%'
           )
    ),
    inserted AS (
        INSERT INTO notifications (
            recipient_id, notification_type, subject, body, link_url, channels
        )
        SELECT
            t.recipient_id,
            'composition_warning'::notification_type_t,
            format(
                'Composition gap: %s on %s but behind on %s',
                tr.full_name, tr.headline_code, tr.composition_code
            ),
            format(
                'On track for %s (%s/%s = %s%%) but behind on %s (%s/%s = %s%%). Threshold: %s%% headline / %s%% composition. Pair: %s.',
                tr.headline_code,
                tr.headline_actual, tr.headline_target,
                round(tr.headline_actual / tr.headline_target * 100, 0),
                tr.composition_code,
                tr.composition_actual, tr.composition_target,
                round(tr.composition_actual / tr.composition_target * 100, 0),
                round(v_headline_pct * 100, 0),
                round(v_composition_pct * 100, 0),
                tr.composition_code
            ),
            '/dashboard',
            ARRAY['in_app']::text[]
          FROM triggers tr
          CROSS JOIN LATERAL (
            -- Fan-out: BDM + every active BD Head + every active admin.
            SELECT tr.user_id AS recipient_id
            UNION
            SELECT p.id FROM profiles p
             WHERE p.is_active = true AND p.role IN ('bd_head', 'admin')
          ) t
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_fired FROM inserted;

    fired := v_fired;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION eval_composition_warning() TO authenticated;


-- =====================================================================
-- 3) eval_composition_drift()
-- =====================================================================
-- Per §3.12b / §5.3b — mid-quarter early warning for BDMs whose
-- developer-ratio (or consultant-ratio) is trending off target.
--
-- Conditions (all must be true):
--   1. Quarter is ≥ X% complete (composition_drift_min_quarter_pct,
--      default 30%).
--   2. BDM has logged ≥ N L3+ movements in the quarter
--      (composition_drift_min_sample_size, default 5).
--   3. actual_ratio < threshold * target_ratio (default 0.70).
--   4. No drift fire for this BDM + metric_pair in the last
--      composition_drift_cooldown_days (default 14).
-- Writes a composition_drift_log row regardless (fired or not) so the
-- performance-review surface has a full audit trail.

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
    v_consultant_target_ratio numeric;
    v_dev_l3 numeric;
    v_a_l3 numeric;
    v_c_app numeric;
BEGIN
    IF auth.uid() IS NOT NULL AND auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    -- Settings
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

    -- Quarter window + completion
    v_q_start := date_trunc('quarter', v_today)::date;
    v_q_end   := (v_q_start + interval '3 months - 1 day')::date;
    v_q_pct   := (v_today - v_q_start)::numeric / NULLIF((v_q_end - v_q_start), 0)::numeric;

    IF v_q_pct < v_min_pct THEN
        fired := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Target ratios from playbook for the current FY
    SELECT pt.annual_target INTO v_dev_l3
      FROM playbook_targets pt
     WHERE pt.metric_code = 'driver_b_dev_l3' AND pt.fiscal_year = v_fy;
    SELECT pt.annual_target INTO v_a_l3
      FROM playbook_targets pt
     WHERE pt.metric_code = 'driver_a_l3' AND pt.fiscal_year = v_fy;
    SELECT pt.annual_target INTO v_c_app
      FROM playbook_targets pt
     WHERE pt.metric_code = 'driver_c_consultant_approvals' AND pt.fiscal_year = v_fy;

    v_dev_target_ratio := CASE WHEN v_a_l3 IS NULL OR v_a_l3 = 0
                                THEN 0
                                ELSE COALESCE(v_dev_l3, 0) / v_a_l3
                          END;
    v_consultant_target_ratio := CASE WHEN v_a_l3 IS NULL OR v_a_l3 = 0
                                       THEN 0
                                       ELSE COALESCE(v_c_app, 0) / v_a_l3
                                 END;

    -- Per-BDM evaluation
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
    -- Most recent fire for cooldown check
    last_fired AS (
        SELECT user_id, metric_pair, MAX(cooldown_until) AS cooldown_until
          FROM composition_drift_log
         WHERE fired = true
         GROUP BY user_id, metric_pair
    ),
    eval AS (
        -- developer_ratio metric_pair
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
        UNION ALL
        SELECT
            b.user_id,
            'consultant_ratio'::text,
            COALESCE(bl.l3_plus_count, 0),
            -- Consultant ratio uses consultant_approvals over total L3+,
            -- but we don't readily have per-quarter consultant_approvals
            -- here without re-querying engagements. Approximate: use the
            -- ratio of bdm's *consultant-typed* L3 moves to total L3 moves.
            CASE WHEN COALESCE(bl.l3_plus_count, 0) = 0 THEN 0
                 ELSE (
                    SELECT COUNT(*)::numeric
                      FROM level_history lh
                     WHERE lh.owner_at_time = b.user_id
                       AND lh.is_forward = true AND lh.is_credited = true
                       AND lh.changed_at::date BETWEEN v_q_start AND v_q_end
                       AND lh.to_level IN ('L3', 'L4', 'L5')
                       AND lh.company_type_at_time = 'design_consultant'
                 ) / bl.l3_plus_count
            END,
            v_consultant_target_ratio
          FROM bdms b
          LEFT JOIN bdm_l3 bl ON bl.user_id = b.user_id
    ),
    decided AS (
        SELECT
            e.*,
            CASE WHEN e.target_ratio = 0 THEN 0
                 ELSE e.actual_ratio / e.target_ratio
            END AS drift_pct,
            -- gate
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

GRANT EXECUTE ON FUNCTION eval_composition_drift() TO authenticated;
