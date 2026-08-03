-- 0101_metrics_sphere_scope.sql
-- Build B — sphere-of-interest metric scoping.
--
-- Extends the two RPC-backed dashboard metrics (temperature + market-
-- value engagement) with an optional p_sphere_only flag. When set,
-- the company universe is intersected with sphere_members (0097) so
-- both numerator and denominator reflect the curated target list.
-- Default false — every existing caller keeps its current behaviour
-- until the app layer starts passing the flag.
--
-- SDK-driven actions (coverage, segment_penetration) don't need a
-- migration — they filter companies directly and can intersect with
-- sphere_members client-side.
--
-- Both function overloads coexist via DEFAULT — a caller sending
-- (measure) still resolves. Idempotent — safe re-run.

-- ── 1) get_engagement_temperature ────────────────────────────────
-- Byte-identical to 0089 through the two subtype/type constants;
-- adds v_sphere_only + a scoping clause on the `scoped` CTE (used
-- by both breadth + companies-mode grid) and on the events-mode
-- grid's join. When p_sphere_only = false, the WHERE degenerates
-- to TRUE so the plan is identical to the unfiltered path.
--
-- The old (text-only) overload from 0089 is dropped first — leaving
-- both overloads in place would make get_engagement_temperature
-- ('companies') ambiguous under Postgres's DEFAULT-resolution rule.

DROP FUNCTION IF EXISTS get_engagement_temperature(text);

CREATE OR REPLACE FUNCTION get_engagement_temperature(
    p_measure      text,
    p_sphere_only  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now         timestamptz := now();
    v_subtypes    text[] := ARRAY[
        'call','meeting','email','site_visit','workshop','document_sent',
        'L0_to_L1','L1_to_L2','L2_to_L3','L3_to_L4','L4_to_L5'
    ];
    v_types       text[] := ARRAY[
        'developer','design_consultant','main_contractor',
        'mep_consultant','mep_contractor','authority','society'
    ];
    v_breadth     jsonb;
    v_grid        jsonb;
BEGIN
    IF auth_role() = 'bd_manager' THEN
        RAISE EXCEPTION 'forbidden';
    END IF;
    IF p_measure NOT IN ('companies','events') THEN
        RAISE EXCEPTION 'unknown measure: %', p_measure;
    END IF;

    -- Breadth
    WITH latest AS (
        SELECT company_id, MAX(occurred_at) AS last_at
          FROM ecosystem_events
         WHERE is_void = false
           AND event_subtype = ANY (v_subtypes)
         GROUP BY company_id
    ),
    scoped AS (
        SELECT c.id, l.last_at
          FROM companies c
          LEFT JOIN latest l ON l.company_id = c.id
         WHERE c.is_active = true
           AND c.merged_into_company_id IS NULL
           AND c.company_type::text = ANY (v_types)
           AND (
                NOT p_sphere_only
                OR EXISTS (SELECT 1 FROM sphere_members sm WHERE sm.company_id = c.id)
           )
    )
    SELECT jsonb_build_object(
        'total',     COUNT(*),
        'engaged',   COUNT(*) FILTER (WHERE last_at IS NOT NULL),
        'active',    COUNT(*) FILTER (WHERE last_at >= v_now - interval '90 days'),
        'cooling',   COUNT(*) FILTER (
            WHERE last_at >= v_now - interval '180 days'
              AND last_at <  v_now - interval '90 days'
        ),
        'untouched', COUNT(*) FILTER (WHERE last_at IS NULL)
    )
    INTO v_breadth
    FROM scoped;

    -- Grid
    IF p_measure = 'companies' THEN
        WITH latest AS (
            SELECT company_id, MAX(occurred_at) AS last_at
              FROM ecosystem_events
             WHERE is_void = false
               AND event_subtype = ANY (v_subtypes)
             GROUP BY company_id
        ),
        scoped AS (
            SELECT c.company_type::text AS company_type, l.last_at
              FROM companies c
              LEFT JOIN latest l ON l.company_id = c.id
             WHERE c.is_active = true
               AND c.merged_into_company_id IS NULL
               AND c.company_type::text = ANY (v_types)
               AND (
                    NOT p_sphere_only
                    OR EXISTS (SELECT 1 FROM sphere_members sm WHERE sm.company_id = c.id)
               )
        ),
        bucketed AS (
            SELECT
                company_type,
                CASE
                    WHEN last_at IS NULL           THEN 'cold_or_none'
                    WHEN last_at >= v_now - interval '30 days'  THEN 'hot'
                    WHEN last_at >= v_now - interval '90 days'  THEN 'warm'
                    WHEN last_at >= v_now - interval '180 days' THEN 'cooling'
                    ELSE 'cold_or_none'
                END AS band,
                COUNT(*)::int AS cnt
              FROM scoped
             GROUP BY company_type, 2
        )
        SELECT jsonb_agg(
            jsonb_build_object(
                'company_type', company_type,
                'band',         band,
                'cnt',          cnt
            )
        )
        INTO v_grid
        FROM bucketed;
    ELSE
        WITH bucketed AS (
            SELECT
                c.company_type::text AS company_type,
                CASE
                    WHEN e.occurred_at >= v_now - interval '30 days'  THEN 'hot'
                    WHEN e.occurred_at >= v_now - interval '90 days'  THEN 'warm'
                    WHEN e.occurred_at >= v_now - interval '180 days' THEN 'cooling'
                    ELSE 'older'
                END AS band,
                COUNT(*)::int AS cnt
              FROM ecosystem_events e
              JOIN companies c ON c.id = e.company_id
             WHERE e.is_void = false
               AND e.event_subtype = ANY (v_subtypes)
               AND c.is_active = true
               AND c.merged_into_company_id IS NULL
               AND c.company_type::text = ANY (v_types)
               AND (
                    NOT p_sphere_only
                    OR EXISTS (SELECT 1 FROM sphere_members sm WHERE sm.company_id = c.id)
               )
             GROUP BY c.company_type, 2
        )
        SELECT jsonb_agg(
            jsonb_build_object(
                'company_type', company_type,
                'band',         band,
                'cnt',          cnt
            )
        )
        INTO v_grid
        FROM bucketed;
    END IF;

    RETURN jsonb_build_object(
        'breadth', v_breadth,
        'grid',    COALESCE(v_grid, '[]'::jsonb)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_engagement_temperature(text, boolean) TO authenticated;

COMMENT ON FUNCTION get_engagement_temperature(text, boolean) IS
    'Engagement-temperature board. p_sphere_only=true intersects the '
    'company universe with sphere_members (0097) so both numerator '
    'and denominator reflect the curated target list; default false '
    'preserves prior full-universe behaviour.';

-- ── 2) get_market_value_engagement ───────────────────────────────
-- Sphere gate scopes the ENGAGED / STAKEHOLDER company set (the
-- brief: "sphere scopes the stakeholder set — a project counts as
-- engaged/reachable only through sphere-member stakeholders").
-- The project universe (live/winnable + value_known_projects) is
-- unchanged so the total market value denominator stays stable —
-- what shifts is which companies count as "engaged" and which
-- projects therefore land in the engaged / whitespace / Pareto /
-- top_unengaged views.

-- Same overload-collision reason as temperature above.
DROP FUNCTION IF EXISTS get_market_value_engagement();

CREATE OR REPLACE FUNCTION get_market_value_engagement(
    p_sphere_only  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now       timestamptz := now();
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
        SELECT p.id, p.name, p.value_aed,
               p.stage::text AS stage, p.city, p.sector
          FROM projects p
         WHERE p.stage NOT IN ('completed'::project_stage_t, 'cancelled'::project_stage_t)
           AND p.is_dormant = false
    ),
    value_known_projects AS (
        SELECT * FROM live_projects WHERE value_aed IS NOT NULL
    ),
    engaged_companies AS (
        SELECT DISTINCT c.id, c.canonical_name, c.company_type::text AS company_type
          FROM companies c
          JOIN ecosystem_events e ON e.company_id = c.id
         WHERE c.is_active = true
           AND c.merged_into_company_id IS NULL
           AND c.company_type::text = ANY (v_types)
           AND e.is_void = false
           AND e.event_subtype = ANY (v_subtypes)
           AND (
                NOT p_sphere_only
                OR EXISTS (SELECT 1 FROM sphere_members sm WHERE sm.company_id = c.id)
           )
    ),
    project_engagement AS (
        SELECT
            vkp.id, vkp.name, vkp.value_aed, vkp.stage, vkp.city, vkp.sector,
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
        SELECT pc.project_id, MAX(e.occurred_at) AS last_at
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
        SELECT pe.id, pe.value_aed,
            CASE
                WHEN ple.last_at >= v_now - interval '30 days'  THEN 'hot'
                WHEN ple.last_at >= v_now - interval '90 days'  THEN 'warm'
                WHEN ple.last_at >= v_now - interval '180 days' THEN 'cooling'
                ELSE 'older'
            END AS band
          FROM project_engagement pe
          JOIN project_last_event ple ON ple.project_id = pe.id
         WHERE pe.has_engaged = true
    ),
    company_associated AS (
        SELECT
            c.id, c.canonical_name,
            c.company_type::text AS company_type,
            SUM(DISTINCT vkp.value_aed) AS associated_value,
            EXISTS (SELECT 1 FROM engaged_companies ec WHERE ec.id = c.id) AS is_engaged
          FROM companies c
          JOIN project_companies pc
            ON pc.company_id = c.id AND pc.is_current = true
          JOIN value_known_projects vkp ON vkp.id = pc.project_id
         WHERE c.is_active = true
           AND c.merged_into_company_id IS NULL
           AND c.company_type::text = ANY (v_types)
           AND (
                NOT p_sphere_only
                OR EXISTS (SELECT 1 FROM sphere_members sm WHERE sm.company_id = c.id)
           )
         GROUP BY c.id, c.canonical_name, c.company_type
    ),
    company_ranked AS (
        SELECT *,
            ROW_NUMBER() OVER (
                ORDER BY associated_value DESC NULLS LAST, canonical_name
            ) AS rn
        FROM company_associated
    ),
    pareto AS (
        SELECT x.top_n,
            (SELECT COALESCE(SUM(vkp.value_aed), 0)
               FROM value_known_projects vkp
              WHERE vkp.id IN (
                  SELECT DISTINCT pc.project_id
                    FROM project_companies pc
                    JOIN company_ranked cr ON cr.id = pc.company_id
                   WHERE pc.is_current = true AND cr.rn <= x.top_n
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
                jsonb_build_object('band', band, 'value', band_value, 'project_count', band_count)
            )
             FROM (
                 SELECT band, SUM(value_aed) AS band_value, COUNT(*) AS band_count
                   FROM project_temperature GROUP BY band
             ) t),
            '[]'::jsonb
        ),
        'whitespace', COALESCE(
            (SELECT jsonb_agg(
                jsonb_build_object(
                    'id', id, 'name', name, 'value_aed', value_aed,
                    'stage', stage, 'city', city, 'sector', sector
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
                    'top_n', top_n, 'cum_value', cum_value,
                    'engaged_count', engaged_count, 'target_count', target_count
                )
                ORDER BY top_n
            )
             FROM pareto),
            '[]'::jsonb
        ),
        'top_unengaged', COALESCE(
            (SELECT jsonb_agg(
                jsonb_build_object(
                    'id', id, 'canonical_name', canonical_name,
                    'company_type', company_type,
                    'associated_value', associated_value, 'rn', rn
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

GRANT EXECUTE ON FUNCTION get_market_value_engagement(boolean) TO authenticated;

COMMENT ON FUNCTION get_market_value_engagement(boolean) IS
    'Value-weighted engagement analytics. p_sphere_only=true scopes '
    'the engaged/stakeholder company set to sphere_members (0097) — '
    'the project universe (total_market_value denominator) is '
    'unchanged; what shifts is which companies count as engaged and '
    'therefore which projects surface as engaged / whitespace / in '
    'the Pareto / on the top_unengaged priority list.';
