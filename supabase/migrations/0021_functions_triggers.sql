-- 0021_functions_triggers.sql
-- All functions, triggers, and scheduled jobs.
-- This is where business-rule integrity is enforced: level-history ledger,
-- updated_at maintenance, leadership-feedback column-mask, ecosystem event
-- dedup, cron scheduling.

-- 1) Utility: auth_role() --------------------------------------------------

CREATE OR REPLACE FUNCTION auth_role()
RETURNS role_t
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION auth_role() IS
    'Resolves the current authenticated user to their application role. Used across RLS policies.';

-- 2) updated_at maintenance ------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'profiles','companies','projects','project_companies','engagements',
        'tasks','notes','documents','playbook_targets','member_targets',
        'bnc_uploads','stagnation_rules','leadership_reports'
    ]) LOOP
        EXECUTE format(
            'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
            t, t
        );
    END LOOP;
END$$;

-- 3) Fiscal helpers --------------------------------------------------------

CREATE OR REPLACE FUNCTION fiscal_year_of(ts timestamptz)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
    -- Respects app_settings.fiscal_year_start_month; default Jan (month=1) so
    -- calendar year == fiscal year. If start_month is shifted, we subtract
    -- accordingly.
    WITH cfg AS (
        SELECT COALESCE((value_json->>'month')::int, 1) AS start_month
        FROM app_settings WHERE key = 'fiscal_year_start_month'
    )
    SELECT CASE
        WHEN EXTRACT(MONTH FROM ts AT TIME ZONE 'Asia/Dubai') >= (SELECT start_month FROM cfg)
             THEN EXTRACT(YEAR FROM ts AT TIME ZONE 'Asia/Dubai')::int
        ELSE EXTRACT(YEAR FROM ts AT TIME ZONE 'Asia/Dubai')::int - 1
    END;
$$;

CREATE OR REPLACE FUNCTION fiscal_quarter_of(ts timestamptz)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
    WITH cfg AS (
        SELECT COALESCE((value_json->>'month')::int, 1) AS start_month
        FROM app_settings WHERE key = 'fiscal_year_start_month'
    ),
    offset_month AS (
        SELECT ((EXTRACT(MONTH FROM ts AT TIME ZONE 'Asia/Dubai')::int - (SELECT start_month FROM cfg) + 12) % 12) AS m
    )
    SELECT ((SELECT m FROM offset_month) / 3) + 1;
$$;

-- 4) companies.current_level guard ----------------------------------------
-- Direct writes to current_level are rejected unless the session flag
-- `app.level_change_via_fn` is set. Set by change_company_level() only.

CREATE OR REPLACE FUNCTION enforce_level_write_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.current_level IS DISTINCT FROM NEW.current_level) THEN
        IF current_setting('app.level_change_via_fn', true) IS NULL
           OR current_setting('app.level_change_via_fn', true) <> 'on' THEN
            RAISE EXCEPTION
              'companies.current_level may only be written via change_company_level(). Offender: user %, company %',
              auth.uid(), NEW.id
              USING HINT = 'Call public.change_company_level(company_id, to_level, evidence) instead of direct UPDATE.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER companies_level_guard
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION enforce_level_write_guard();

-- 5) change_company_level() — the only path for level movement -------------

CREATE OR REPLACE FUNCTION change_company_level(
    p_company_id        uuid,
    p_to_level          level_t,
    p_evidence_note     text DEFAULT NULL,
    p_evidence_file_url text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_from_level        level_t;
    v_company_type      company_type_t;
    v_owner             uuid;
    v_is_forward        boolean;
    v_history_id        uuid;
    v_now               timestamptz := now();
    v_fy                int;
    v_fq                int;
BEGIN
    -- Lock the row
    SELECT current_level, company_type, owner_id
      INTO v_from_level, v_company_type, v_owner
    FROM companies
    WHERE id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company % not found', p_company_id;
    END IF;
    IF v_from_level = p_to_level THEN
        RAISE EXCEPTION 'Company % already at %', p_company_id, p_to_level;
    END IF;

    v_is_forward := p_to_level::text > v_from_level::text;  -- L0 < L1 < ... < L5
    v_fy := fiscal_year_of(v_now);
    v_fq := fiscal_quarter_of(v_now);

    INSERT INTO level_history (
        company_id, from_level, to_level, changed_by, owner_at_time,
        company_type_at_time, changed_at, fiscal_year, fiscal_quarter,
        evidence_note, evidence_file_url, is_forward, is_credited
    ) VALUES (
        p_company_id, v_from_level, p_to_level, auth.uid(), v_owner,
        v_company_type, v_now, v_fy, v_fq,
        p_evidence_note, p_evidence_file_url, v_is_forward, v_is_forward
    ) RETURNING id INTO v_history_id;

    -- Update the cache on companies via the guarded trigger
    PERFORM set_config('app.level_change_via_fn', 'on', true);
    UPDATE companies
       SET current_level = p_to_level,
           level_changed_at = v_now
     WHERE id = p_company_id;
    PERFORM set_config('app.level_change_via_fn', 'off', true);

    -- Audit
    INSERT INTO audit_events (actor_id, event_type, entity_type, entity_id, before_json, after_json)
    VALUES (
        auth.uid(), 'level_change', 'company', p_company_id,
        jsonb_build_object('level', v_from_level),
        jsonb_build_object('level', p_to_level, 'history_id', v_history_id, 'is_forward', v_is_forward)
    );

    RETURN v_history_id;
END;
$$;

GRANT EXECUTE ON FUNCTION change_company_level(uuid, level_t, text, text)
    TO authenticated;

-- 6) Level-history: per-FY dedup ------------------------------------------
-- After a forward-crediting row is inserted, check if this company already
-- got credit for this level in this FY. If so, demote the new row.

CREATE OR REPLACE FUNCTION enforce_level_history_per_fy_dedup()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_prior_count int;
BEGIN
    IF NEW.is_forward AND NEW.is_credited THEN
        SELECT count(*) INTO v_prior_count
        FROM level_history
        WHERE company_id = NEW.company_id
          AND to_level   = NEW.to_level
          AND fiscal_year = NEW.fiscal_year
          AND is_forward AND is_credited
          AND id <> NEW.id;
        IF v_prior_count > 0 THEN
            UPDATE level_history SET is_credited = false WHERE id = NEW.id;
            INSERT INTO audit_events (actor_id, event_type, entity_type, entity_id, after_json)
            VALUES (NEW.changed_by, 'credit_auto_dedup', 'level_history', NEW.id,
                    jsonb_build_object('reason', 'duplicate_level_in_fy'));
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER level_history_per_fy_dedup
    AFTER INSERT ON level_history
    FOR EACH ROW EXECUTE FUNCTION enforce_level_history_per_fy_dedup();

-- 7) Leadership feedback column-mask -------------------------------------

CREATE OR REPLACE FUNCTION enforce_leadership_feedback_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF auth_role() = 'leadership' THEN
        -- Only these three columns may change
        IF ROW(
            NEW.id, NEW.report_type, NEW.period_label, NEW.period_start, NEW.period_end,
            NEW.fiscal_year, NEW.fiscal_quarter, NEW.generated_by, NEW.generated_at,
            NEW.status, NEW.finalised_at, NEW.finalised_by, NEW.payload_json,
            NEW.executive_summary, NEW.pdf_storage_path, NEW.created_at
        ) IS DISTINCT FROM ROW(
            OLD.id, OLD.report_type, OLD.period_label, OLD.period_start, OLD.period_end,
            OLD.fiscal_year, OLD.fiscal_quarter, OLD.generated_by, OLD.generated_at,
            OLD.status, OLD.finalised_at, OLD.finalised_by, OLD.payload_json,
            OLD.executive_summary, OLD.pdf_storage_path, OLD.created_at
        ) THEN
            RAISE EXCEPTION 'leadership may only update feedback columns';
        END IF;

        IF NEW.status <> 'finalised' THEN
            RAISE EXCEPTION 'leadership feedback only on finalised reports';
        END IF;

        NEW.leadership_feedback_by := auth.uid();
        NEW.leadership_feedback_at := now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER leadership_reports_feedback_guard
    BEFORE UPDATE ON leadership_reports
    FOR EACH ROW EXECUTE FUNCTION enforce_leadership_feedback_only();

-- 8) Ecosystem event insertion + soft-delete cascade ----------------------

CREATE OR REPLACE FUNCTION insert_ecosystem_event(
    p_company_id     uuid,
    p_occurred_at    timestamptz,
    p_category       text,
    p_subtype        text,
    p_source_table   text,
    p_source_id      uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_points        numeric;
    v_dedup_key     text;
    v_company_type  company_type_t;
    v_level         level_t;
    v_dormant       boolean;
    v_multiplier    numeric := 1.0;
    v_event_id      uuid;
    v_recent_exists boolean;
    v_dedup_days    int;
    v_inactive_mult numeric;
BEGIN
    SELECT (value_json->>'days')::int INTO v_dedup_days
      FROM app_settings WHERE key = 'ecosystem_dedup_window_days';
    v_dedup_days := COALESCE(v_dedup_days, 7);

    SELECT (value_json->>'mult')::numeric INTO v_inactive_mult
      FROM app_settings WHERE key = 'ecosystem_inactive_company_multiplier';
    v_inactive_mult := COALESCE(v_inactive_mult, 0.5);

    SELECT points_current INTO v_points
      FROM ecosystem_point_scale
     WHERE event_category = p_category AND event_subtype = p_subtype;
    IF v_points IS NULL THEN
        RAISE EXCEPTION 'No ecosystem_point_scale row for (%, %)', p_category, p_subtype;
    END IF;

    SELECT company_type, current_level,
           (has_active_projects = false AND current_level = 'L0')
      INTO v_company_type, v_level, v_dormant
      FROM companies WHERE id = p_company_id;

    IF v_dormant THEN v_multiplier := v_inactive_mult; END IF;

    -- 7-day (configurable) dedup: suppress if an event with same company+subtype
    -- exists within the window
    SELECT EXISTS (
        SELECT 1 FROM ecosystem_events
        WHERE company_id = p_company_id
          AND event_subtype = p_subtype
          AND is_void = false
          AND occurred_at >= p_occurred_at - make_interval(days => v_dedup_days)
          AND occurred_at <= p_occurred_at + make_interval(days => v_dedup_days)
    ) INTO v_recent_exists;
    IF v_recent_exists THEN RETURN NULL; END IF;

    v_dedup_key := format('%s|%s|%s', p_company_id, p_subtype, date_trunc('day', p_occurred_at));

    INSERT INTO ecosystem_events (
        occurred_at, company_id, event_category, event_subtype, points,
        source_table, source_id, company_type_at_time, company_level_at_time,
        is_dormant_at_time, dedup_key
    ) VALUES (
        p_occurred_at, p_company_id, p_category, p_subtype, v_points * v_multiplier,
        p_source_table, p_source_id, v_company_type, v_level,
        v_dormant, v_dedup_key
    )
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_ecosystem_event(uuid, timestamptz, text, text, text, uuid)
    TO authenticated;

-- Soft-delete cascade: when an engagement/document/level_history row is
-- deleted, void the matching ecosystem_events rows.
CREATE OR REPLACE FUNCTION void_ecosystem_events_for_source()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE ecosystem_events
       SET is_void = true
     WHERE source_table = TG_TABLE_NAME
       AND source_id = OLD.id;
    RETURN OLD;
END;
$$;

CREATE TRIGGER engagements_void_ecosystem
    AFTER DELETE ON engagements
    FOR EACH ROW EXECUTE FUNCTION void_ecosystem_events_for_source();

CREATE TRIGGER documents_void_ecosystem
    AFTER DELETE ON documents
    FOR EACH ROW EXECUTE FUNCTION void_ecosystem_events_for_source();

-- 9) Cron schedules --------------------------------------------------------
-- Scheduled Edge Functions. Times in UTC; comments give Asia/Dubai.
-- Registered via pg_cron. Actual function bodies live in supabase/functions/*.

-- Cron registration is wrapped in a guard: if the pg_cron extension is not
-- enabled (Supabase requires explicit enablement via Dashboard → Database →
-- Extensions), the migration still succeeds and the schedules are skipped.
-- Re-run this migration, or enable the extension and re-run just this block,
-- to activate scheduling later.
DO $cron$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'pg_cron not installed — skipping cron.schedule registration. Enable pg_cron in Supabase Dashboard and re-run.';
        RETURN;
    END IF;

    -- Nightly KPI rebuild: 02:00 Asia/Dubai = 22:00 UTC
    PERFORM cron.schedule(
        'kpi-rebuild-nightly',
        '0 22 * * *',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/kpi-rebuild-nightly',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );

    -- Stagnation daily: 06:00 Asia/Dubai = 02:00 UTC
    PERFORM cron.schedule(
        'stagnation-daily',
        '0 2 * * *',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/stagnation-daily',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );

    -- Composition warning: Mon 06:00 Asia/Dubai = Mon 02:00 UTC
    PERFORM cron.schedule(
        'composition-warning-weekly',
        '0 2 * * 1',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/composition-warning-weekly',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );

    -- Composition drift: Mon 07:00 Asia/Dubai = Mon 03:00 UTC
    PERFORM cron.schedule(
        'composition-drift-weekly',
        '0 3 * * 1',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/composition-drift-weekly',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );

    -- Email digest: DISABLED for v1 (§16 Q3 — email deferred; in-app only).
    -- Re-enable by uncommenting below and flipping app_settings.notification_channels_enabled.
    --   PERFORM cron.schedule('email-digest-daily', '0 3 * * *', ...);

    -- BNC stale reminder: Mon 08:00 Asia/Dubai = 04:00 UTC
    PERFORM cron.schedule(
        'bnc-stale-reminder-weekly',
        '0 4 * * 1',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/bnc-stale-reminder',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );

    -- Document retention sweep: 1st of month 02:30 Asia/Dubai = 22:30 UTC prior day
    PERFORM cron.schedule(
        'document-retention-sweep-monthly',
        '30 22 1 * *',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/document-retention-sweep',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );

    -- Ecosystem rebuild: 02:15 Asia/Dubai = 22:15 UTC (safety rebuild after KPI)
    PERFORM cron.schedule(
        'ecosystem-rebuild',
        '15 22 * * *',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/ecosystem-rebuild',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );
END
$cron$;
