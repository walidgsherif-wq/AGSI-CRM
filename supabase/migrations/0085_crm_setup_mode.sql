-- 0085_crm_setup_mode.sql
-- CRM Setup mode — admin-toggled bypass for the single-step level
-- rule, approval workflow, and evidence upload during initial
-- backfill. Owners can set the true current level of their own
-- stakeholders directly, provided the stakeholder still passes the
-- L2+ completeness gate (emirate + a contact with a work email).
--
-- Design decisions baked in here:
--   - Backfill rows are still fully audited (level_history row +
--     audit_events row) and set the real current_level on the
--     company. Everything downstream (coverage, pipeline, detail
--     page, ecosystem) treats them as real.
--   - The one thing backfill rows do NOT do is credit earned
--     Driver A movement. Driver A counts *earned* progression;
--     letting a fresh CRM tenant start at L4 and instantly credit
--     the BDMs would inflate the whole KPI story. The Driver A
--     aggregation in rebuild_kpi_actuals (0072 body) now filters on
--     source = 'progression'.
--   - Driver B (developer subset) is deliberately NOT filtered per
--     the brief. Composition mix is what it is.
--   - Setup mode is stored in app_settings.crm_setup_mode. Because
--     bd_manager's RLS SELECT policy on app_settings whitelists a
--     small set of keys (0022:323–332) and this new key isn't on
--     it, we ship a SECURITY DEFINER helper crm_setup_mode() that
--     any authenticated user can call — same pattern as
--     get_rebar_share() from 0052.

-- ---------------------------------------------------------------------------
-- 1) level_history.source — the backfill flag
-- ---------------------------------------------------------------------------

ALTER TABLE level_history
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'progression';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'level_history_source_check'
    ) THEN
        ALTER TABLE level_history
            ADD CONSTRAINT level_history_source_check
            CHECK (source IN ('progression','initial_backfill'));
    END IF;
END
$$;

COMMENT ON COLUMN level_history.source IS
    '''progression'' = normal earned movement (through '
    'change_company_level / approve_level_change_request). '
    '''initial_backfill'' = admin/owner set the true current level '
    'during CRM setup — real level, audited, but not credited to '
    'Driver A. See migration 0085.';

-- Partial index — every KPI aggregation walks the (source='progression')
-- subset; a partial index on top of the existing owner_fy predicate
-- keeps the Driver A rebuild small.
CREATE INDEX IF NOT EXISTS level_history_progression_owner_fy_idx
    ON level_history (owner_at_time, fiscal_year, fiscal_quarter)
    WHERE source = 'progression' AND is_forward = true AND is_credited = true;

-- ---------------------------------------------------------------------------
-- 2) app_settings — seed the toggle at OFF
-- ---------------------------------------------------------------------------

INSERT INTO app_settings (key, value_json)
VALUES ('crm_setup_mode', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN app_settings.value_json IS
    'Setting-specific JSON. crm_setup_mode holds a bare boolean literal ("true" or "false"). Read via crm_setup_mode() helper for auth-safe access.';

-- ---------------------------------------------------------------------------
-- 3) crm_setup_mode() — auth-safe boolean read
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm_setup_mode()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- Default false so the mode is never accidentally on if the row
    -- is missing. Matches the seed above.
    SELECT COALESCE(
        (SELECT value_json::text::boolean
           FROM app_settings WHERE key = 'crm_setup_mode'),
        false
    );
$$;

GRANT EXECUTE ON FUNCTION crm_setup_mode() TO authenticated;

COMMENT ON FUNCTION crm_setup_mode() IS
    'Whether CRM setup mode is currently on. Returns bare boolean. '
    'Callable by every authenticated user (bd_manager can''t read '
    'app_settings.crm_setup_mode directly because of the whitelist '
    'RLS from 0022).';

-- ---------------------------------------------------------------------------
-- 4) set_initial_level — the backfill RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_initial_level(
    p_company  uuid,
    p_to_level level_t,
    p_note     text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id     uuid := auth.uid();
    v_caller_role   role_t;
    v_from_level    level_t;
    v_company_type  company_type_t;
    v_owner         uuid;
    v_location      uuid;
    v_is_forward    boolean;
    v_history_id    uuid;
    v_now           timestamptz := now();
    v_fy            int;
    v_fq            int;
    v_needs_gate    boolean;
    v_has_contact   boolean;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    -- (a) Setup mode must be ON.
    IF NOT crm_setup_mode() THEN
        RAISE EXCEPTION 'Setup mode is off.';
    END IF;

    -- (b) Role gate + ownership gate.
    v_caller_role := auth_role();
    IF v_caller_role IS NULL
       OR v_caller_role NOT IN ('admin','bd_head','bd_manager') THEN
        RAISE EXCEPTION 'Your role cannot set initial levels.';
    END IF;

    SELECT current_level, company_type, owner_id, location_id
      INTO v_from_level, v_company_type, v_owner, v_location
      FROM companies
     WHERE id = p_company
       AND merged_into_company_id IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company % not found.', p_company;
    END IF;

    -- bd_manager: must own the company. bd_head/admin: any.
    IF v_caller_role = 'bd_manager'
       AND (v_owner IS NULL OR v_owner <> v_caller_id) THEN
        RAISE EXCEPTION 'You can only set the level for stakeholders you own.';
    END IF;

    -- (d) No downgrades via this path.
    IF p_to_level::text <= v_from_level::text THEN
        RAISE EXCEPTION
            'Backfill only moves forward. Current level is %, target %.',
            v_from_level, p_to_level;
    END IF;

    -- (c) L2+ completeness gate — reused verbatim from
    --     src/server/actions/level.ts (targetRequiresCompleteness +
    --     assertCompanyProgressReady). Enforced server-side so no
    --     UI shortcut can slip an incomplete stakeholder through.
    v_needs_gate := p_to_level::text >= 'L2';
    IF v_needs_gate THEN
        IF v_location IS NULL THEN
            RAISE EXCEPTION 'Add the stakeholder''s emirate and a contact with a work email before moving to L2 or beyond.';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM contacts
             WHERE company_id = p_company
               AND deleted_at IS NULL
               AND email IS NOT NULL
               AND length(trim(email)) > 0
        ) INTO v_has_contact;
        IF NOT v_has_contact THEN
            RAISE EXCEPTION 'Add the stakeholder''s emirate and a contact with a work email before moving to L2 or beyond.';
        END IF;
    END IF;

    v_is_forward := true;  -- guarded above; backfill only moves forward
    v_fy := fiscal_year_of(v_now);
    v_fq := fiscal_quarter_of(v_now);

    -- Insert the ledger row FIRST so the per-FY dedup trigger has the
    -- correct source when it fires. Backfill rows are still is_forward
    -- + is_credited so they walk the same audit surfaces as regular
    -- moves — the ONLY difference is source, which is what the KPI
    -- aggregation filters on below.
    INSERT INTO level_history (
        company_id, from_level, to_level, changed_by, owner_at_time,
        company_type_at_time, changed_at, fiscal_year, fiscal_quarter,
        evidence_note, evidence_file_url, is_forward, is_credited,
        source
    ) VALUES (
        p_company, v_from_level, p_to_level, v_caller_id, v_owner,
        v_company_type, v_now, v_fy, v_fq,
        NULLIF(trim(coalesce(p_note, '')), ''), NULL, v_is_forward, true,
        'initial_backfill'
    ) RETURNING id INTO v_history_id;

    -- Bypass the current_level write guard the same way
    -- change_company_level does (0021:149-154).
    PERFORM set_config('app.level_change_via_fn', 'on', true);
    UPDATE companies
       SET current_level    = p_to_level,
           level_changed_at = v_now
     WHERE id = p_company;
    PERFORM set_config('app.level_change_via_fn', 'off', true);

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id,
        before_json, after_json
    ) VALUES (
        v_caller_id,
        'level_initial_backfill',
        'company',
        p_company,
        jsonb_build_object('level', v_from_level),
        jsonb_build_object(
            'level', p_to_level,
            'history_id', v_history_id,
            'source', 'initial_backfill',
            'note', p_note
        )
    );

    RETURN v_history_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_initial_level(uuid, level_t, text) TO authenticated;

COMMENT ON FUNCTION set_initial_level(uuid, level_t, text) IS
    'Backfill the true current level of a stakeholder during initial '
    'CRM setup. Bypasses the single-step rule, approval workflow, and '
    'evidence upload; still enforces the L2+ completeness gate. '
    'Requires crm_setup_mode() = true. bd_manager may only set levels '
    'on companies they own; bd_head/admin may set any. Writes a '
    'level_history row with source = ''initial_backfill'' — that '
    'source flag is what excludes it from earned-Driver-A credit.';

-- ---------------------------------------------------------------------------
-- 5) rebuild_kpi_actuals — filter Driver A on source = 'progression'
-- ---------------------------------------------------------------------------
--
-- Rebuild verbatim from 0072 (the full-wipe body currently installed)
-- with the single change: the Driver A block gets
-- `AND lh.source = 'progression'` added to its WHERE. Every other
-- aggregation (Driver B / C / D, ecosystem) stays byte-for-byte
-- identical.
--
-- Rationale: Driver A is the earned-progression KPI. A tenant using
-- setup mode to start their portfolio at L2–L5 shouldn't have those
-- moves credited as if the BDMs earned them. Driver B is deliberately
-- unfiltered per the brief.

CREATE OR REPLACE FUNCTION rebuild_kpi_actuals(
    p_target_date date DEFAULT current_date
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total int := 0;
    v_added int;
BEGIN
    -- Full wipe (was: WHERE snapshot_date = p_target_date) — the table
    -- carries only the current snapshot, never accumulating.
    DELETE FROM kpi_actuals_daily;

    -- Driver A — L3/L4/L5 stakeholders per BDM, by FY/Q.
    -- CHANGED from 0072: added `AND lh.source = 'progression'` so
    -- initial_backfill rows do NOT credit earned Driver A movement.
    -- Everything else in this block is byte-for-byte identical to 0072.
    WITH ins AS (
        INSERT INTO kpi_actuals_daily (snapshot_date, user_id, metric_code, fiscal_year, fiscal_quarter, actual_value)
        SELECT
            p_target_date,
            lh.owner_at_time,
            CASE lh.to_level
                WHEN 'L3' THEN 'driver_a_l3'
                WHEN 'L4' THEN 'driver_a_l4'
                WHEN 'L5' THEN 'driver_a_l5'
            END,
            lh.fiscal_year,
            lh.fiscal_quarter,
            COUNT(*)
        FROM level_history lh
        WHERE lh.is_forward AND lh.is_credited
          AND lh.source = 'progression'
          AND lh.to_level IN ('L3'::level_t, 'L4'::level_t, 'L5'::level_t)
          AND lh.owner_at_time IS NOT NULL
        GROUP BY lh.owner_at_time, lh.to_level, lh.fiscal_year, lh.fiscal_quarter
        RETURNING 1
    )
    SELECT count(*) INTO v_added FROM ins;
    v_total := v_total + v_added;

    -- Driver B — developer subset of Driver A. Intentionally NOT
    -- filtered on source per the 0085 brief (composition mix reflects
    -- the portfolio as it stands, not just earned developer moves).
    WITH ins AS (
        INSERT INTO kpi_actuals_daily (snapshot_date, user_id, metric_code, fiscal_year, fiscal_quarter, actual_value)
        SELECT
            p_target_date,
            lh.owner_at_time,
            CASE lh.to_level
                WHEN 'L3' THEN 'driver_b_dev_l3'
                WHEN 'L4' THEN 'driver_b_dev_l4'
                WHEN 'L5' THEN 'driver_b_dev_l5'
            END,
            lh.fiscal_year,
            lh.fiscal_quarter,
            COUNT(*)
        FROM level_history lh
        WHERE lh.is_forward AND lh.is_credited
          AND lh.to_level IN ('L3'::level_t, 'L4'::level_t, 'L5'::level_t)
          AND lh.company_type_at_time = 'developer'::company_type_t
          AND lh.owner_at_time IS NOT NULL
        GROUP BY lh.owner_at_time, lh.to_level, lh.fiscal_year, lh.fiscal_quarter
        RETURNING 1
    )
    SELECT count(*) INTO v_added FROM ins;
    v_total := v_total + v_added;

    -- Driver C — engagement-driven metrics. Attribution: created_by.
    -- Byte-for-byte identical to 0072.
    WITH ins AS (
        INSERT INTO kpi_actuals_daily (snapshot_date, user_id, metric_code, fiscal_year, fiscal_quarter, actual_value)
        SELECT
            p_target_date,
            e.created_by,
            CASE e.engagement_type
                WHEN 'consultant_approval' THEN 'driver_c_consultant_approvals'
                WHEN 'spec_inclusion'      THEN 'driver_c_spec_template_inclusions'
                WHEN 'design_stage_intro'  THEN 'driver_c_design_stage_projects'
            END,
            fiscal_year_of(e.engagement_date::timestamptz),
            fiscal_quarter_of(e.engagement_date::timestamptz),
            COUNT(*)
        FROM engagements e
        WHERE e.engagement_type IN (
                'consultant_approval'::engagement_type_t,
                'spec_inclusion'::engagement_type_t,
                'design_stage_intro'::engagement_type_t
            )
          AND e.created_by IS NOT NULL
        GROUP BY
            e.created_by,
            e.engagement_type,
            fiscal_year_of(e.engagement_date::timestamptz),
            fiscal_quarter_of(e.engagement_date::timestamptz)
        RETURNING 1
    )
    SELECT count(*) INTO v_added FROM ins;
    v_total := v_total + v_added;

    -- Driver D — document-driven metrics. Attribution: uploaded_by.
    -- Byte-for-byte identical to 0072.
    WITH ins AS (
        INSERT INTO kpi_actuals_daily (snapshot_date, user_id, metric_code, fiscal_year, fiscal_quarter, actual_value)
        SELECT
            p_target_date,
            d.uploaded_by,
            CASE d.doc_type
                WHEN 'announcement'         THEN 'driver_d_announcements'
                WHEN 'site_banner_approval' THEN 'driver_d_site_banners'
                WHEN 'case_study'           THEN 'driver_d_case_studies'
            END,
            fiscal_year_of(COALESCE(d.signed_date::timestamptz, d.created_at)),
            fiscal_quarter_of(COALESCE(d.signed_date::timestamptz, d.created_at)),
            COUNT(*)
        FROM documents d
        WHERE d.doc_type IN (
                'announcement'::document_type_t,
                'site_banner_approval'::document_type_t,
                'case_study'::document_type_t
            )
          AND d.uploaded_by IS NOT NULL
          AND d.is_archived = false
        GROUP BY
            d.uploaded_by,
            d.doc_type,
            fiscal_year_of(COALESCE(d.signed_date::timestamptz, d.created_at)),
            fiscal_quarter_of(COALESCE(d.signed_date::timestamptz, d.created_at))
        RETURNING 1
    )
    SELECT count(*) INTO v_added FROM ins;
    v_total := v_total + v_added;

    -- Team rollup rows (user_id = NULL): sum across all BDMs per metric.
    -- Byte-for-byte identical to 0072.
    INSERT INTO kpi_actuals_daily (snapshot_date, user_id, metric_code, fiscal_year, fiscal_quarter, actual_value)
    SELECT
        p_target_date,
        NULL::uuid,
        metric_code,
        fiscal_year,
        fiscal_quarter,
        SUM(actual_value)
    FROM kpi_actuals_daily
    WHERE snapshot_date = p_target_date AND user_id IS NOT NULL
    GROUP BY metric_code, fiscal_year, fiscal_quarter;

    -- Refresh the BEI matview so dashboards reflect the new actuals.
    REFRESH MATERIALIZED VIEW CONCURRENTLY bei_current_view;

    RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION rebuild_kpi_actuals(date) TO authenticated;

COMMENT ON FUNCTION rebuild_kpi_actuals(date) IS
    'M8 KPI rollup. Aggregates level_history + engagements + documents '
    'into kpi_actuals_daily for the given snapshot date, then refreshes '
    'bei_current_view. Wipes the table entirely on each call — the table '
    'carries the current snapshot only. As of 0085, Driver A filters to '
    'level_history.source = ''progression'' so CRM-setup backfill rows '
    'do not credit earned movement; Driver B/C/D unaffected.';
