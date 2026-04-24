-- 0017_bei_matview.sql
-- Bonus Eligibility Index. Prompt §3.15 + §5.4.
-- Pure performance index. No currency. Per-driver pct capped at 120%.

CREATE MATERIALIZED VIEW bei_current_view AS
WITH driver_pct AS (
    SELECT
        p.id                             AS user_id,
        t.fiscal_year,
        t.fiscal_quarter,
        LEAST(
            CASE WHEN t.target_value = 0 THEN 0
                 ELSE t.actual_value / t.target_value
            END,
            1.20
        )::numeric                       AS pct,
        pt.driver
    FROM profiles p
    JOIN LATERAL (
        -- Per-user × per-metric × per-quarter latest snapshot
        SELECT
            k.metric_code,
            k.fiscal_year,
            k.fiscal_quarter,
            k.actual_value,
            CASE k.fiscal_quarter
                WHEN 1 THEN COALESCE(mt.q1_target, pbt.q1_target)
                WHEN 2 THEN COALESCE(mt.q2_target, pbt.q2_target)
                WHEN 3 THEN COALESCE(mt.q3_target, pbt.q3_target)
                WHEN 4 THEN COALESCE(mt.q4_target, pbt.q4_target)
            END AS target_value
        FROM kpi_actuals_daily k
        JOIN playbook_targets pbt
            ON pbt.metric_code = k.metric_code AND pbt.fiscal_year = k.fiscal_year
        LEFT JOIN member_targets mt
            ON mt.user_id = p.id
             AND mt.metric_code = k.metric_code
             AND mt.fiscal_year = k.fiscal_year
        WHERE k.user_id = p.id
          AND k.snapshot_date = (SELECT MAX(snapshot_date) FROM kpi_actuals_daily k2
                                 WHERE k2.user_id = p.id AND k2.metric_code = k.metric_code)
    ) t ON true
    JOIN playbook_targets pt
       ON pt.metric_code = t.metric_code AND pt.fiscal_year = t.fiscal_year
    WHERE p.role IN ('bd_manager','bd_head')
      AND p.is_active = true
)
SELECT
    user_id,
    fiscal_year,
    fiscal_quarter,
    AVG(pct) FILTER (WHERE driver = 'A') AS driver_a_pct,
    AVG(pct) FILTER (WHERE driver = 'B') AS driver_b_pct,
    AVG(pct) FILTER (WHERE driver = 'C') AS driver_c_pct,
    AVG(pct) FILTER (WHERE driver = 'D') AS driver_d_pct,
    (
      COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.45 +
      COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.20 +
      COALESCE(AVG(pct) FILTER (WHERE driver = 'C'), 0) * 0.20 +
      COALESCE(AVG(pct) FILTER (WHERE driver = 'D'), 0) * 0.15
    )::numeric AS bei,
    CASE
      WHEN (
        COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.45 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'C'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'D'), 0) * 0.15
      ) < 0.50 THEN 'below_threshold'
      WHEN (
        COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.45 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'C'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'D'), 0) * 0.15
      ) < 0.75 THEN 'approaching'
      WHEN (
        COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.45 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'C'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'D'), 0) * 0.15
      ) < 0.95 THEN 'on_target'
      WHEN (
        COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.45 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'C'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'D'), 0) * 0.15
      ) < 1.05 THEN 'full'
      ELSE 'stretch'
    END AS bei_tier,
    now() AS last_computed_at
FROM driver_pct
GROUP BY user_id, fiscal_year, fiscal_quarter;

CREATE UNIQUE INDEX bei_current_view_pk ON bei_current_view (user_id, fiscal_year, fiscal_quarter);

COMMENT ON MATERIALIZED VIEW bei_current_view IS
    'BEI per BDM per quarter. Refreshed by bei-recompute Edge Function after kpi_actuals_daily rebuild.';

-- Matview can't have RLS; access gated via a view wrapper defined in 0022
-- (we SELECT from bei_current_view through a SECURITY INVOKER view).
