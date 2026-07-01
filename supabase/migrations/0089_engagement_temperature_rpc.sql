-- 0089_engagement_temperature_rpc.sql
-- Engagement-temperature board for the dashboard hero. Reads
-- ecosystem_events (already the correct capture surface for
-- outreach + level-up events) and returns:
--
--   - breadth: four always-company-based tiles (engaged / active /
--     cooling / untouched) against a 7-type universe denominator
--     (developer, design_consultant, main_contractor, mep_consultant,
--     mep_contractor, authority, society, all is_active=true and
--     not merged).
--   - grid: 7 stakeholder types × 4 recency bands. Cell value is
--     controlled by p_measure:
--       'companies' → each company placed in exactly one band by
--                     its most-recent qualifying event; the 4th
--                     band ("Cold / none") includes untouched
--                     companies (LEFT JOIN).
--       'events'    → each event bucketed by its own occurred_at;
--                     a company can contribute to several bands.
--                     4th band ("Older (>180d)") — no "none"
--                     bucket exists in event space.
--
-- Subtype whitelist is defined once as a TEXT[] constant so widening
-- (e.g. add spec_inclusion later) is a one-line change. `is_void`
-- events are always excluded.
--
-- Read-side only. No changes to ecosystem_events, its triggers, the
-- point-scale table, or the weighted ecosystem_awareness_current
-- rollup — those still power /insights/ecosystem.

CREATE OR REPLACE FUNCTION get_engagement_temperature(
    p_measure text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now         timestamptz := now();
    -- Outreach subtypes + level-up subtypes. Excludes document +
    -- spec_inclusion by design (per the brief's scope).
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

    -- ── Breadth (always company-based) ──────────────────────────────
    -- One company per row; latest qualifying event determines which
    -- tile it counts toward. Untouched = never had a qualifying event.

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

    -- ── Grid ────────────────────────────────────────────────────────
    -- Companies mode: each row = one company, bucketed by its latest.
    -- Events mode:    each row = one event, bucketed by occurred_at.

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
        ),
        bucketed AS (
            SELECT
                company_type,
                CASE
                    WHEN last_at IS NULL
                        THEN 'cold_or_none'
                    WHEN last_at >= v_now - interval '30 days'
                        THEN 'hot'
                    WHEN last_at >= v_now - interval '90 days'
                        THEN 'warm'
                    WHEN last_at >= v_now - interval '180 days'
                        THEN 'cooling'
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
                    WHEN e.occurred_at >= v_now - interval '30 days'
                        THEN 'hot'
                    WHEN e.occurred_at >= v_now - interval '90 days'
                        THEN 'warm'
                    WHEN e.occurred_at >= v_now - interval '180 days'
                        THEN 'cooling'
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

GRANT EXECUTE ON FUNCTION get_engagement_temperature(text) TO authenticated;

COMMENT ON FUNCTION get_engagement_temperature(text) IS
    'Feeds the dashboard engagement-temperature board. Reads '
    'ecosystem_events with the outreach + level_up subtype whitelist, '
    'is_void=false, joins companies filtered on is_active + '
    'not-merged + 7 stakeholder types. Returns { breadth, grid } as '
    'jsonb. Companies mode places each of the 7-type universe in '
    'exactly one band via LEFT JOIN on the latest event (cold_or_none '
    'includes untouched); events mode buckets each event by its own '
    'occurred_at (a company can contribute to multiple bands). '
    'Breadth tiles are always company-based.';
