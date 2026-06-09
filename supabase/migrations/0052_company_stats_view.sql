-- 0052_company_stats_view.sql
-- v1.1 (FX-024a) — per-company aggregates exposed as a queryable
-- view so the Companies list can later sort/filter on project value,
-- project count, est. steel value, recency, level, owner. Foundation
-- for FX-024b (sortable list UI) and FX-024c.
--
-- Plain VIEW, NOT a materialised table or trigger-maintained column
-- (spec). We accept the recompute-on-read cost: existing indexes on
-- project_companies (project_id, company_id) + companies (id) keep
-- the aggregate cheap, and the result set is bounded by the active
-- company count.
--
-- Per-stakeholder rule mirrors FX-002: a project shared by two
-- companies counts toward EACH (no fractional split). Deduped by
-- project_id per company so a company linked to the same project via
-- multiple roles (owner + developer, etc.) still only counts that
-- project's value once.
--
-- security_invoker = on so company / project / project_companies
-- visibility flows through the caller's RLS — if RLS is later
-- tightened (e.g. per-region scoping), the view reflects it
-- automatically. The rebar-share read is wrapped in a SECURITY
-- DEFINER helper because app_settings RLS (0022) only whitelists
-- 3 keys for bd_manager and `rebar_share_of_project_value` isn't
-- among them; without the helper, bd_manager would see
-- est_steel_value = 0 across the board.
--
-- The engagement-freshness join consumes company_engagement_score
-- (FX-001 / migration 0050) — that view runs definer-side by default,
-- which is fine: it exposes only aggregate days/bucket per company,
-- not per-engagement detail.

-- =====================================================================
-- 1) get_rebar_share() — single-row read of the configured share
-- =====================================================================

CREATE OR REPLACE FUNCTION get_rebar_share()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- Default matches the seed in 0041 (0.05 = 5%) so the view stays
    -- coherent even if the setting row is deleted.
    SELECT COALESCE(
        (SELECT (value_json->>'share')::numeric
           FROM app_settings WHERE key = 'rebar_share_of_project_value'),
        0.05
    );
$$;

GRANT EXECUTE ON FUNCTION get_rebar_share() TO authenticated;

COMMENT ON FUNCTION get_rebar_share() IS
    'Per-project value share treated as steel (default 0.05). SECURITY DEFINER so bd_manager (locked out of most app_settings keys) can read the configured rate via company_stats.';

-- =====================================================================
-- 2) company_stats view
-- =====================================================================

CREATE OR REPLACE VIEW company_stats
WITH (security_invoker = on) AS
WITH unique_links AS (
    -- Multi-role on the same (company, project) collapses to one row
    -- so value_aed isn't summed twice for the same company.
    SELECT DISTINCT pc.company_id, pc.project_id
      FROM project_companies pc
     WHERE pc.is_current = true
),
agg AS (
    SELECT
        ul.company_id,
        COUNT(*)                                 AS project_count,
        SUM(COALESCE(p.value_aed, 0))::numeric   AS project_value_involved
      FROM unique_links ul
      JOIN projects p ON p.id = ul.project_id
     GROUP BY ul.company_id
)
SELECT
    c.id                                                              AS company_id,
    c.canonical_name,
    c.current_level                                                   AS level,
    c.owner_id,
    COALESCE(a.project_count, 0)                                      AS project_count,
    COALESCE(a.project_value_involved, 0)::numeric                    AS project_value_involved,
    (COALESCE(a.project_value_involved, 0) * get_rebar_share())::numeric AS est_steel_value,
    ces.days_since_last_engagement                                    AS days_since_last_contact,
    ces.bucket                                                        AS engagement_bucket
  FROM companies c
  LEFT JOIN agg a                       ON a.company_id    = c.id
  LEFT JOIN company_engagement_score ces ON ces.company_id = c.id;

GRANT SELECT ON company_stats TO authenticated;

COMMENT ON VIEW company_stats IS
    'Per-company sortable/filterable stats: project_value_involved (FX-002 rule — shared projects count toward each linked company), project_count, est_steel_value, days_since_last_contact + engagement_bucket (from company_engagement_score), level, owner. Foundation for the sortable Companies list (FX-024b).';
