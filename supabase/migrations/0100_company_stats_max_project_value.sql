-- 0100_company_stats_max_project_value.sql
-- Add `max_project_value` — the largest single current project value
-- for the company — to company_stats (0052, 0099).
--
-- Distinct from `project_value_involved` (which SUMS every current
-- project's value): this MAX exposes "does the stakeholder touch at
-- least one deal worth ≥ X?" as a first-class filter for the sphere
-- builder — a common curation question that the aggregate can't
-- answer (an owner of 200 tiny projects can outrank a single-huge-
-- project owner on the sum but not on the max).
--
-- Postgres constraint (learned in 0099): CREATE OR REPLACE VIEW
-- rejects mid-list inserts as "cannot change name of view column"
-- (SQLSTATE 42P16). The new column APPENDS at the tail — after
-- merged_into_company_id, which is the current last column post-
-- 0099. Every existing column keeps its original position.

CREATE OR REPLACE VIEW company_stats
WITH (security_invoker = on) AS
WITH unique_links AS (
    -- Same as 0052 / 0099: collapse multi-role (company, project)
    -- pairs so a value isn't summed twice for the same company.
    SELECT DISTINCT pc.company_id, pc.project_id
      FROM project_companies pc
     WHERE pc.is_current = true
),
agg AS (
    SELECT
        ul.company_id,
        COUNT(*)                                       AS project_count,
        SUM(COALESCE(p.value_aed, 0))::numeric         AS project_value_involved,
        -- NEW: largest single current project this company is on.
        -- COALESCE inside MAX so a NULL value_aed contributes 0 and
        -- doesn't bubble to the aggregate.
        MAX(COALESCE(p.value_aed, 0))::numeric         AS max_project_value
      FROM unique_links ul
      JOIN projects p ON p.id = ul.project_id
     GROUP BY ul.company_id
)
SELECT
    -- ── Existing columns (position + name preserved from 0099) ──
    c.id                                                              AS company_id,
    c.canonical_name,
    c.current_level                                                   AS level,
    c.owner_id,
    COALESCE(a.project_count, 0)                                      AS project_count,
    COALESCE(a.project_value_involved, 0)::numeric                    AS project_value_involved,
    (COALESCE(a.project_value_involved, 0) * get_rebar_share())::numeric AS est_steel_value,
    ces.days_since_last_engagement                                    AS days_since_last_contact,
    ces.bucket                                                        AS engagement_bucket,
    c.company_type,
    c.city,
    c.is_active,
    c.merged_into_company_id,
    -- ── NEW column appended at the tail (append-only rule) ──
    COALESCE(a.max_project_value, 0)::numeric                         AS max_project_value
  FROM companies c
  LEFT JOIN agg a                       ON a.company_id    = c.id
  LEFT JOIN company_engagement_score ces ON ces.company_id = c.id;

-- Idempotent re-grant so behaviour matches 0052 / 0099.
GRANT SELECT ON company_stats TO authenticated;

COMMENT ON VIEW company_stats IS
    'Per-company sortable/filterable stats: project_value_involved (FX-002 rule — shared projects count toward each linked company, SUM), max_project_value (0100 — MAX single-project value, for "on a project ≥ X" filters distinct from the aggregate), project_count, est_steel_value, days_since_last_contact + engagement_bucket. Widened in 0099 with company_type / city / is_active / merged_into_company_id; extended in 0100 with max_project_value (all new columns appended at the tail per the CREATE OR REPLACE VIEW rule).';
