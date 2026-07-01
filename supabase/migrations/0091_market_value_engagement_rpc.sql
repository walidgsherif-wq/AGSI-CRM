-- 0091_market_value_engagement_rpc.sql
-- Value-weighted engagement analytics. Replaces the "48 of 3,613
-- stakeholders (1.3%)" framing with "engaged with players on X% of
-- market value." All value math resolves at the distinct-project
-- level so a project shared by a developer + a consultant contributes
-- its value_aed exactly once.
--
-- Reads projects + project_companies + companies + ecosystem_events
-- only. No schema change.
--
-- Universe:
--   Live/winnable projects = projects WHERE stage NOT IN
--     ('completed','cancelled') AND is_dormant = false.
--   Value-known live projects = above WHERE value_aed IS NOT NULL.
--     All value math uses this set. value_known_pct exposes how
--     much of the live pipeline we can even value.
--
-- Engaged company definition (VERBATIM from the temperature board,
-- 0089):
--   ecosystem_events with is_void=false AND event_subtype IN
--     (outreach subtypes + level_up subtypes).
--   Company must be is_active=true AND merged_into_company_id IS NULL
--     AND company_type IN (7 spoke types).
-- This reconciles the "engaged" count with the temperature board's 48.
--
-- Returns jsonb with:
--   headline    — reach %, engaged / unengaged / total value, value
--                 known count.
--   cold_split  — engaged value bucketed by project temperature
--                 (each project in one band, computed as MAX of its
--                 engaged linked companies' last qualifying events).
--   whitespace  — top 15 value-known live projects with zero engaged
--                 linked company, sorted by value_aed desc.
--   pareto      — cumulative distinct-project reach at top-10 / 25 /
--                 50 / 100 stakeholders (walking the union, NOT
--                 summing per-stakeholder values — shared projects
--                 must count once).
--   top_unengaged — top 10 unengaged stakeholders by associated
--                 value (the priority-target list).

CREATE OR REPLACE FUNCTION get_market_value_engagement()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now       timestamptz := now();
    -- Whitelist held once, matches 0089's temperature-board scope.
    v_subtypes  text[] := ARRAY[
        'call','meeting','email','site_visit','workshop','document_sent',
        'L0_to_L1','L1_to_L2','L2_to_L3','L3_to_L4','L4_to_L5'
    ];
    v_types     text[] := ARRAY[
        'developer','design_consultant','main_contractor',
        'mep_consultant','mep_contractor','authority','society'
    ];
    v_out jsonb;
BEGIN
    IF auth_role() = 'bd_manager' THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    WITH live_projects AS (
        SELECT
            p.id,
            p.name,
            p.value_aed,
            p.stage::text AS stage,
            p.city,
            p.sector
        FROM projects p
        WHERE p.stage NOT IN ('completed'::project_stage_t, 'cancelled'::project_stage_t)
          AND p.is_dormant = false
    ),
    value_known_projects AS (
        SELECT * FROM live_projects WHERE value_aed IS NOT NULL
    ),
    engaged_companies AS (
        -- Verbatim from the temperature board (0089).
        SELECT DISTINCT c.id, c.canonical_name, c.company_type::text AS company_type
          FROM companies c
          JOIN ecosystem_events e ON e.company_id = c.id
         WHERE c.is_active = true
           AND c.merged_into_company_id IS NULL
           AND c.company_type::text = ANY (v_types)
           AND e.is_void = false
           AND e.event_subtype = ANY (v_subtypes)
    ),
    project_engagement AS (
        -- One row per value-known live project + has_engaged flag.
        SELECT
            vkp.id,
            vkp.name,
            vkp.value_aed,
            vkp.stage,
            vkp.city,
            vkp.sector,
            EXISTS (
                SELECT 1
                  FROM project_companies pc
                  JOIN engaged_companies ec ON ec.id = pc.company_id
                 WHERE pc.project_id = vkp.id
                   AND pc.is_current = true
            ) AS has_engaged
        FROM value_known_projects vkp
    ),
    project_last_event AS (
        -- Per project, the most-recent qualifying event across its
        -- engaged linked companies. Feeds cold_split.
        SELECT
            pc.project_id,
            MAX(e.occurred_at) AS last_at
          FROM project_companies pc
          JOIN engaged_companies ec ON ec.id = pc.company_id
          JOIN ecosystem_events e
            ON e.company_id = pc.company_id
           AND e.is_void = false
           AND e.event_subtype = ANY (v_subtypes)
         WHERE pc.is_current = true
         GROUP BY pc.project_id
    ),
    project_temperature AS (
        SELECT
            pe.id,
            pe.value_aed,
            CASE
                WHEN ple.last_at >= v_now - interval '30 days' THEN 'hot'
                WHEN ple.last_at >= v_now - interval '90 days' THEN 'warm'
                WHEN ple.last_at >= v_now - interval '180 days' THEN 'cooling'
                ELSE 'older'
            END AS band
          FROM project_engagement pe
          JOIN project_last_event ple ON ple.project_id = pe.id
         WHERE pe.has_engaged = true
    ),
    -- ── Per-stakeholder Pareto: rank companies by associated distinct
    --    value-known live project value.
    company_associated AS (
        SELECT
            c.id,
            c.canonical_name,
            c.company_type::text AS company_type,
            -- Sum over distinct project ids to avoid double-count when
            -- the same (company, project) appears under multiple roles.
            SUM(DISTINCT vkp.value_aed) AS associated_value,
            EXISTS (
                SELECT 1 FROM engaged_companies ec WHERE ec.id = c.id
            ) AS is_engaged
          FROM companies c
          JOIN project_companies pc
            ON pc.company_id = c.id AND pc.is_current = true
          JOIN value_known_projects vkp ON vkp.id = pc.project_id
         WHERE c.is_active = true
           AND c.merged_into_company_id IS NULL
           AND c.company_type::text = ANY (v_types)
         GROUP BY c.id, c.canonical_name, c.company_type
    ),
    -- CAVEAT: SUM(DISTINCT vkp.value_aed) collapses same-value projects
    -- to one contribution. For ranking / target ordering it's a good
    -- approximation and it's monotonic. Ties are broken by name for
    -- determinism.
    company_ranked AS (
        SELECT
            *,
            ROW_NUMBER() OVER (
                ORDER BY associated_value DESC NULLS LAST, canonical_name
            ) AS rn
        FROM company_associated
    ),
    -- ── Cumulative reach: for each checkpoint, walk the DISTINCT
    --    project ids the top-N companies collectively touch and sum
    --    those projects' value_aed. Shared projects count once.
    pareto AS (
        SELECT
            x.top_n,
            (SELECT COALESCE(SUM(vkp.value_aed), 0)
               FROM value_known_projects vkp
              WHERE vkp.id IN (
                  SELECT DISTINCT pc.project_id
                    FROM project_companies pc
                    JOIN company_ranked cr ON cr.id = pc.company_id
                   WHERE pc.is_current = true
                     AND cr.rn <= x.top_n
              )
            ) AS cum_value,
            (SELECT COUNT(*)::int FROM company_ranked cr
              WHERE cr.rn <= x.top_n AND cr.is_engaged = true) AS engaged_count,
            (SELECT COUNT(*)::int FROM company_ranked cr
              WHERE cr.rn <= x.top_n AND cr.is_engaged = false) AS target_count
          FROM (VALUES (10), (25), (50), (100)) AS x(top_n)
    ),
    headline_totals AS (
        SELECT
            COALESCE((SELECT SUM(value_aed) FROM value_known_projects), 0)                  AS total_market_value,
            COALESCE((SELECT SUM(value_aed) FROM project_engagement WHERE has_engaged), 0)  AS engaged_value,
            (SELECT COUNT(*) FROM live_projects)                                            AS live_project_count,
            (SELECT COUNT(*) FROM value_known_projects)                                     AS value_known_count,
            (SELECT COUNT(*) FROM project_engagement WHERE has_engaged)                     AS engaged_project_count,
            (SELECT COUNT(*) FROM engaged_companies)                                        AS engaged_company_count
    )
    SELECT jsonb_build_object(
        'headline', (
            SELECT jsonb_build_object(
                'total_market_value',    total_market_value,
                'engaged_value',         engaged_value,
                'unengaged_value',       total_market_value - engaged_value,
                'live_project_count',    live_project_count,
                'value_known_count',     value_known_count,
                'engaged_project_count', engaged_project_count,
                'engaged_company_count', engaged_company_count
            )
            FROM headline_totals
        ),
        'cold_split', COALESCE(
            (SELECT jsonb_agg(
                jsonb_build_object(
                    'band', band,
                    'value', band_value,
                    'project_count', band_count
                )
            )
             FROM (
                 SELECT band, SUM(value_aed) AS band_value, COUNT(*) AS band_count
                   FROM project_temperature
                  GROUP BY band
             ) t),
            '[]'::jsonb
        ),
        'whitespace', COALESCE(
            (SELECT jsonb_agg(
                jsonb_build_object(
                    'id', id,
                    'name', name,
                    'value_aed', value_aed,
                    'stage', stage,
                    'city', city,
                    'sector', sector
                )
                ORDER BY value_aed DESC
            )
             FROM (
                 SELECT id, name, value_aed, stage, city, sector
                   FROM project_engagement
                  WHERE has_engaged = false
                  ORDER BY value_aed DESC
                  LIMIT 15
             ) w),
            '[]'::jsonb
        ),
        'pareto', COALESCE(
            (SELECT jsonb_agg(
                jsonb_build_object(
                    'top_n', top_n,
                    'cum_value', cum_value,
                    'engaged_count', engaged_count,
                    'target_count', target_count
                )
                ORDER BY top_n
            )
             FROM pareto),
            '[]'::jsonb
        ),
        'top_unengaged', COALESCE(
            (SELECT jsonb_agg(
                jsonb_build_object(
                    'id', id,
                    'canonical_name', canonical_name,
                    'company_type', company_type,
                    'associated_value', associated_value,
                    'rn', rn
                )
                ORDER BY rn
            )
             FROM (
                 SELECT id, canonical_name, company_type, associated_value, rn
                   FROM company_ranked
                  WHERE is_engaged = false
                  ORDER BY rn
                  LIMIT 10
             ) u),
            '[]'::jsonb
        )
    )
    INTO v_out;

    RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION get_market_value_engagement() TO authenticated;

COMMENT ON FUNCTION get_market_value_engagement() IS
    'Value-weighted engagement analytics for the dashboard. Reads '
    'projects + project_companies + companies + ecosystem_events; '
    'all value math resolves at the distinct-project level. Universe '
    '= live/winnable projects (stage NOT IN completed/cancelled, '
    'is_dormant=false); value-known = value_aed IS NOT NULL. Engaged '
    'company definition matches the temperature board (0089) so the '
    'engaged count reconciles. Returns headline reach %, cold-value '
    'split by project temperature, top-15 whitespace target list, '
    'Pareto cumulative distinct-project reach at top-10/25/50/100 '
    'stakeholders (union of projects — shared count once), and the '
    'top-10 unengaged stakeholders as priority targets.';
