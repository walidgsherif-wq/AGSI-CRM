-- 0099_company_stats_view_widen.sql
-- Widen company_stats (0052) with the columns the sphere builder
-- (and any future sortable list) needs to drive its query directly
-- from the view — so ORDER BY project_value_involved / project_count
-- can run at the DB against the entire filtered set, not against a
-- name-first pre-fetch cap.
--
-- Added columns (all sourced from companies): company_type, city,
-- is_active, merged_into_company_id. Nothing else changes — the
-- aggregation, the FX-002 dedup rule, the security_invoker flag,
-- and every existing column's name / order stays exactly as before.
--
-- Postgres constraint: CREATE OR REPLACE VIEW can only APPEND
-- columns; inserting new columns mid-list is rejected as "cannot
-- change name of view column X to Y" (SQLSTATE 42P16). The new
-- fields land at the tail of the SELECT list for that reason. Any
-- consumer selecting by name is unaffected.

CREATE OR REPLACE VIEW company_stats
WITH (security_invoker = on) AS
WITH unique_links AS (
    -- Same as 0052: collapse multi-role (company, project) pairs so
    -- value_aed isn't summed twice for the same company.
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
    -- ── Existing columns (position + name preserved from 0052) ──
    c.id                                                              AS company_id,
    c.canonical_name,
    c.current_level                                                   AS level,
    c.owner_id,
    COALESCE(a.project_count, 0)                                      AS project_count,
    COALESCE(a.project_value_involved, 0)::numeric                    AS project_value_involved,
    (COALESCE(a.project_value_involved, 0) * get_rebar_share())::numeric AS est_steel_value,
    ces.days_since_last_engagement                                    AS days_since_last_contact,
    ces.bucket                                                        AS engagement_bucket,
    -- ── NEW columns (appended so CREATE OR REPLACE succeeds) ──
    c.company_type,
    c.city,
    c.is_active,
    c.merged_into_company_id
  FROM companies c
  LEFT JOIN agg a                       ON a.company_id    = c.id
  LEFT JOIN company_engagement_score ces ON ces.company_id = c.id;

-- SELECT is already granted from 0052; re-issue is idempotent and
-- keeps behaviour identical after CREATE OR REPLACE.
GRANT SELECT ON company_stats TO authenticated;

COMMENT ON VIEW company_stats IS
    'Per-company sortable/filterable stats: project_value_involved (FX-002 rule — shared projects count toward each linked company), project_count, est_steel_value, days_since_last_contact + engagement_bucket. Widened in 0099 with company_type / city / is_active / merged_into_company_id (appended at the tail per the CREATE OR REPLACE VIEW rule) so downstream queries can drive from the view directly (ORDER BY value/count at the DB rather than sorting a name-first pre-fetch cap in memory).';
