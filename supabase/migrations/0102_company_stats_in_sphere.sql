-- 0102_company_stats_in_sphere.sql
-- Append an `in_sphere` boolean to company_stats so the sphere
-- builder (and any future sortable list) can filter by membership
-- at the DB — replacing the previous "load member ids into JS and
-- pass them to PostgREST via .in()" pattern that silently truncates
-- past ~500 ids (the 660-member bug the user hit).
--
-- Postgres constraint (learned in 0099): CREATE OR REPLACE VIEW
-- rejects mid-list inserts as "cannot change name of view column"
-- (SQLSTATE 42P16). The new column APPENDS at the tail — after
-- max_project_value (the current last column post-0100). Every
-- existing column keeps its original position.
--
-- security_invoker = on stays intact: the sphere_members SELECT
-- policy from 0097 already lets any authenticated user read the
-- membership set, so the boolean surfaces correctly for everyone.

CREATE OR REPLACE VIEW company_stats
WITH (security_invoker = on) AS
WITH unique_links AS (
    SELECT DISTINCT pc.company_id, pc.project_id
      FROM project_companies pc
     WHERE pc.is_current = true
),
agg AS (
    SELECT
        ul.company_id,
        COUNT(*)                                       AS project_count,
        SUM(COALESCE(p.value_aed, 0))::numeric         AS project_value_involved,
        MAX(COALESCE(p.value_aed, 0))::numeric         AS max_project_value
      FROM unique_links ul
      JOIN projects p ON p.id = ul.project_id
     GROUP BY ul.company_id
)
SELECT
    -- ── Existing columns (position + name preserved from 0100) ──
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
    COALESCE(a.max_project_value, 0)::numeric                         AS max_project_value,
    -- ── NEW column appended at the tail (append-only rule) ──
    -- Boolean membership check via EXISTS. Cheap: sphere_members
    -- is a few hundred rows with a PK index on company_id.
    EXISTS (
        SELECT 1 FROM sphere_members sm WHERE sm.company_id = c.id
    )                                                                 AS in_sphere
  FROM companies c
  LEFT JOIN agg a                       ON a.company_id    = c.id
  LEFT JOIN company_engagement_score ces ON ces.company_id = c.id;

GRANT SELECT ON company_stats TO authenticated;

COMMENT ON VIEW company_stats IS
    'Per-company sortable/filterable stats: project_value_involved (SUM, FX-002-deduped), max_project_value (MAX, 0100), project_count, est_steel_value, days_since_last_contact + engagement_bucket, plus in_sphere (0102 — boolean membership check against sphere_members). All added columns are appended at the tail per the CREATE OR REPLACE VIEW rule so consumers by name stay unaffected.';
