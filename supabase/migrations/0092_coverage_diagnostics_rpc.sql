-- 0092_coverage_diagnostics_rpc.sql
-- Step-0 diagnostic RPC for the "Coverage by stakeholder type" and
-- "Segment penetration" panels reading 0-of-0 despite live data in
-- the Pipeline board. Returns the exact count breakdown the dashboard
-- actions rely on, so we can pinpoint which filter (is_active,
-- merged_into_company_id, or company_type IN SPOKE_TYPES) is
-- eliminating the rows.
--
-- Read-only. No schema change. Safe to run repeatedly.

CREATE OR REPLACE FUNCTION get_coverage_diagnostics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_types  text[] := ARRAY[
        'developer','design_consultant','main_contractor',
        'mep_consultant','mep_contractor','authority','society'
    ];
    v_total                       bigint;
    v_active_true                 bigint;
    v_active_not_true             bigint;
    v_merged_null                 bigint;
    v_merged_not_null             bigint;
    v_all_three_filters           bigint;
    v_by_type                     jsonb;
    v_by_type_survivors           jsonb;
    v_owner_null_in_universe      bigint;
    v_owner_not_null_in_universe  bigint;
BEGIN
    IF auth_role() NOT IN ('admin','bd_head','leadership') THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    SELECT COUNT(*) INTO v_total FROM companies;

    SELECT COUNT(*) INTO v_active_true
      FROM companies WHERE is_active = true;

    SELECT COUNT(*) INTO v_active_not_true
      FROM companies WHERE is_active IS DISTINCT FROM true;

    SELECT COUNT(*) INTO v_merged_null
      FROM companies WHERE merged_into_company_id IS NULL;

    SELECT COUNT(*) INTO v_merged_not_null
      FROM companies WHERE merged_into_company_id IS NOT NULL;

    -- The exact set the dashboard actions ask for.
    SELECT COUNT(*) INTO v_all_three_filters
      FROM companies
     WHERE is_active = true
       AND merged_into_company_id IS NULL
       AND company_type::text = ANY (v_types);

    SELECT COUNT(*) FILTER (WHERE owner_id IS NULL),
           COUNT(*) FILTER (WHERE owner_id IS NOT NULL)
      INTO v_owner_null_in_universe, v_owner_not_null_in_universe
      FROM companies
     WHERE is_active = true
       AND merged_into_company_id IS NULL
       AND company_type::text = ANY (v_types);

    SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
      INTO v_by_type
      FROM (
        SELECT company_type::text AS k, COUNT(*)::bigint AS v
          FROM companies
         GROUP BY company_type
      ) t;

    SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
      INTO v_by_type_survivors
      FROM (
        SELECT company_type::text AS k, COUNT(*)::bigint AS v
          FROM companies
         WHERE is_active = true
           AND merged_into_company_id IS NULL
           AND company_type::text = ANY (v_types)
         GROUP BY company_type
      ) t;

    RETURN jsonb_build_object(
        'total',                       v_total,
        'is_active_true',              v_active_true,
        'is_active_not_true',          v_active_not_true,
        'merged_null',                 v_merged_null,
        'merged_not_null',             v_merged_not_null,
        'all_three_filters',           v_all_three_filters,
        'owner_null_in_universe',      v_owner_null_in_universe,
        'owner_not_null_in_universe',  v_owner_not_null_in_universe,
        'by_type',                     v_by_type,
        'by_type_survivors',           v_by_type_survivors,
        'spoke_types',                 to_jsonb(v_types)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_coverage_diagnostics() TO authenticated;

COMMENT ON FUNCTION get_coverage_diagnostics() IS
    'Step-0 diagnostic for the dashboard coverage + segment '
    'penetration panels showing 0-of-0. Returns raw company counts '
    'broken down by each filter the actions apply (is_active, '
    'merged_into_company_id, company_type IN SPOKE_TYPES), plus '
    'per-type totals and the count surviving all three filters. '
    'Read-only; safe to call from an admin diagnostic route.';
