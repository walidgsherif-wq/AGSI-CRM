-- 0108_bei_two_driver_composite.sql
-- Reweight the Bonus Eligibility Index to Drivers A (0.70) and B (0.30)
-- only. Drivers C and D remain OUTPUT columns of the matview — the
-- dashboard, performance-review page, and leadership-report snapshot
-- all keep the four pcts visible — but no longer contribute to the
-- composite `bei` or its `bei_tier` banding.
--
-- Rationale. Drivers C (consultant_approvals) and D (ecosystem
-- engagement / documents) are not instrumented end-to-end: metric
-- codes and playbook_targets rows exist (0010, 0038), but
-- kpi_actuals_daily never populates their actuals, so the old
-- 20/15 weightings were quietly dragging every BDM's composite down
-- to ~0.65x what Drivers A/B alone would say. That mis-ranks
-- performance and feeds downstream stagnation / coverage logic off
-- the wrong tier.
--
-- Scope — exactly what changes:
--   - The per-driver AVG() * weight terms in `bei` and in each tier
--     cutoff. Weights become 0.70 (A) / 0.30 (B); C and D terms are
--     dropped from the composite.
--   - Tier-band thresholds (0.50 / 0.75 / 0.95 / 1.05) are preserved —
--     the composite is still a 0..1.2-scaled pct so the bands still
--     map to below_threshold / approaching / on_target / full / stretch.
--
-- Preserved:
--   - Per-driver cap at 1.20 (LEAST(..., 1.20)).
--   - Column list, column order, column names, column types.
--   - UNIQUE INDEX bei_current_view_pk (required for CONCURRENTLY
--     refresh in rebuild_kpi_actuals + bei-recompute Edge Function).
--   - SECURITY INVOKER wrapper bei_for_caller (dropped and recreated
--     verbatim because MATERIALIZED VIEW cannot be swapped under a
--     dependent view — see dependency note below).
--
-- Config source. Weights are hardcoded in the view body, not read
-- from app_settings.bei_weightings. Making them config-driven would
-- require either a per-row sub-SELECT from app_settings or a wrapper
-- SQL function called per row — new machinery for a formula that
-- only changes when leadership redefines the composite, which is
-- already a code-review-gated event. Tenant debt: if a second tenant
-- ever needs different weights, the weights move to a per-org
-- settings table and the view becomes per-tenant; not before.
--
-- Dependency note. bei_for_caller (0030:167) is a plain
-- SECURITY INVOKER view that re-selects all 10 columns from
-- bei_current_view. Since the column list is unchanged, we DROP the
-- wrapper, DROP the matview, CREATE the matview with the new body,
-- recreate the unique index, then recreate the wrapper verbatim.
-- Downstream readers (dashboard, performance-review page,
-- generate_leadership_report RPC) require no code change — the
-- select-list they request is identical.

DROP VIEW IF EXISTS bei_for_caller;
DROP MATERIALIZED VIEW IF EXISTS bei_current_view;

CREATE MATERIALIZED VIEW bei_current_view AS
WITH driver_pct AS (
    SELECT
        p.id AS user_id,
        t.fiscal_year,
        t.fiscal_quarter,
        LEAST(
            CASE WHEN t.target_value = 0 THEN 0
                 ELSE t.actual_value / t.target_value
            END,
            1.20
        ) AS pct,
        pt.driver
      FROM profiles p
      JOIN LATERAL (
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
            ON pbt.metric_code = k.metric_code
           AND pbt.fiscal_year = k.fiscal_year
          LEFT JOIN member_targets mt
            ON mt.user_id = p.id
           AND mt.metric_code = k.metric_code
           AND mt.fiscal_year = k.fiscal_year
         WHERE k.user_id = p.id
           AND k.snapshot_date = (
                SELECT MAX(k2.snapshot_date)
                  FROM kpi_actuals_daily k2
                 WHERE k2.user_id = p.id
                   AND k2.metric_code = k.metric_code
           )
      ) t ON true
      JOIN playbook_targets pt
        ON pt.metric_code = t.metric_code
       AND pt.fiscal_year = t.fiscal_year
     WHERE (p.role = ANY (ARRAY['bd_manager'::role_t, 'bd_head'::role_t]))
       AND p.is_active = true
)
SELECT
    user_id,
    fiscal_year,
    fiscal_quarter,
    AVG(pct) FILTER (WHERE driver = 'A') AS driver_a_pct,
    AVG(pct) FILTER (WHERE driver = 'B') AS driver_b_pct,
    AVG(pct) FILTER (WHERE driver = 'C') AS driver_c_pct,  -- visibility only; not weighted (0108)
    AVG(pct) FILTER (WHERE driver = 'D') AS driver_d_pct,  -- visibility only; not weighted (0108)
    COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.70 +
    COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.30 AS bei,
    CASE
        WHEN (
            COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.70 +
            COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.30
        ) < 0.50 THEN 'below_threshold'
        WHEN (
            COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.70 +
            COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.30
        ) < 0.75 THEN 'approaching'
        WHEN (
            COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.70 +
            COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.30
        ) < 0.95 THEN 'on_target'
        WHEN (
            COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.70 +
            COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.30
        ) < 1.05 THEN 'full'
        ELSE 'stretch'
    END AS bei_tier,
    now() AS last_computed_at
  FROM driver_pct
 GROUP BY user_id, fiscal_year, fiscal_quarter;

CREATE UNIQUE INDEX bei_current_view_pk
    ON bei_current_view (user_id, fiscal_year, fiscal_quarter);

COMMENT ON MATERIALIZED VIEW bei_current_view IS
    'BEI per BDM per quarter. 2026-10 (0108): composite reweighted to 0.70 Driver A + 0.30 Driver B. driver_c_pct and driver_d_pct remain as output columns for visibility but are not weighted into bei until the Driver C / Driver D data pipelines are instrumented. Refreshed by bei-recompute Edge Function after kpi_actuals_daily rebuild.';

CREATE VIEW bei_for_caller
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
