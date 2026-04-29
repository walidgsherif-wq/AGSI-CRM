-- 0035_ecosystem_summary_helpers.sql
-- Read-side helpers for the leadership /insights/ecosystem panel.
-- §3.16 spec calls out two ranked lists:
--   - "Top contributors to ecosystem growth this quarter" — companies that
--     earned the most active-window points.
--   - "Cooling accounts" — companies with high lifetime score but zero
--     active score (i.e., touched historically but gone silent).
--
-- Both are aggregate joins that don't fit PostgREST's REST shape cleanly.
-- Wrapping them in SECURITY DEFINER functions keeps the leadership UI
-- thin and lets RLS still enforce the `bd_manager` block: the function
-- explicitly raises if invoked under that role.

CREATE OR REPLACE FUNCTION ecosystem_top_contributors(
    p_window_days int DEFAULT 90,
    p_limit int DEFAULT 10
) RETURNS TABLE (
    company_id     uuid,
    canonical_name text,
    company_type   text,
    current_level  text,
    active_points  numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND auth_role() = 'bd_manager' THEN
        RAISE EXCEPTION 'Forbidden — bd_manager cannot read ecosystem data.';
    END IF;

    RETURN QUERY
    SELECT
        c.id,
        c.canonical_name,
        c.company_type::text,
        c.current_level::text,
        SUM(e.points)::numeric AS active_points
      FROM ecosystem_events e
      JOIN companies c ON c.id = e.company_id
     WHERE e.is_void = false
       AND e.occurred_at >= now() - make_interval(days => p_window_days)
     GROUP BY c.id, c.canonical_name, c.company_type, c.current_level
     ORDER BY SUM(e.points) DESC
     LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION ecosystem_top_contributors(int, int) TO authenticated;


CREATE OR REPLACE FUNCTION ecosystem_cooling_accounts(
    p_window_days int DEFAULT 90,
    p_limit int DEFAULT 10
) RETURNS TABLE (
    company_id      uuid,
    canonical_name  text,
    company_type    text,
    current_level   text,
    lifetime_points numeric,
    last_event_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND auth_role() = 'bd_manager' THEN
        RAISE EXCEPTION 'Forbidden — bd_manager cannot read ecosystem data.';
    END IF;

    RETURN QUERY
    WITH per_company AS (
        SELECT
            e.company_id,
            SUM(e.points) AS lifetime,
            SUM(CASE
                  WHEN e.occurred_at >= now() - make_interval(days => p_window_days)
                  THEN e.points ELSE 0
                END) AS active,
            MAX(e.occurred_at) AS last_event_at
          FROM ecosystem_events e
         WHERE e.is_void = false
         GROUP BY e.company_id
    )
    SELECT
        c.id,
        c.canonical_name,
        c.company_type::text,
        c.current_level::text,
        p.lifetime::numeric,
        p.last_event_at
      FROM per_company p
      JOIN companies c ON c.id = p.company_id
     WHERE p.lifetime > 0 AND p.active = 0
     ORDER BY p.lifetime DESC
     LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION ecosystem_cooling_accounts(int, int) TO authenticated;
