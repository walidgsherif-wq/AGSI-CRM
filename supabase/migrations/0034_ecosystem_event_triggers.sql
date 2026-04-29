-- 0034_ecosystem_event_triggers.sql
-- Wire the ecosystem awareness engine.
--
-- Schema for ecosystem_events / ecosystem_point_scale / ecosystem_awareness_current
-- has been in place since 0018, and insert_ecosystem_event() / the soft-delete
-- cascade triggers have been in place since 0021. What was missing: nothing
-- *fired* events. This migration adds:
--
--   1. AFTER INSERT triggers on level_history / engagements / documents that
--      call insert_ecosystem_event() on the rows the spec scores (§3.16):
--        - level_history: forward + credited transitions
--        - engagements:   call/meeting/email/site_visit/workshop/document_sent
--                         + spec_inclusion (separate category)
--        - documents:     announcement / site_banner_approval / case_study
--   2. rebuild_ecosystem_awareness() — recomputes today's row in
--      ecosystem_awareness_current. Runs on demand (admin button) or via
--      the existing pg_cron schedule registered in 0021.
--   3. backfill_ecosystem_events() — one-time replay of historical
--      level_history / engagements / documents rows so the dashboard isn't
--      empty on first launch. Idempotent via dedup_key UNIQUE constraint.
--
-- bd_manager remains fully blocked from reading ecosystem_* tables (RLS
-- already enforced in 0022). The functions themselves are SECURITY DEFINER
-- but include role checks that prevent bd_manager invocation.

-- =====================================================================
-- 1) Real-time AFTER INSERT triggers
-- =====================================================================

CREATE OR REPLACE FUNCTION fire_ecosystem_event_on_level_history()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_subtype text;
BEGIN
    IF NEW.is_forward = true AND NEW.is_credited = true THEN
        v_subtype := format('%s_to_%s', NEW.from_level::text, NEW.to_level::text);
        PERFORM insert_ecosystem_event(
            NEW.company_id,
            NEW.changed_at,
            'level_up',
            v_subtype,
            'level_history',
            NEW.id
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS level_history_fire_ecosystem ON level_history;
CREATE TRIGGER level_history_fire_ecosystem
    AFTER INSERT ON level_history
    FOR EACH ROW EXECUTE FUNCTION fire_ecosystem_event_on_level_history();


CREATE OR REPLACE FUNCTION fire_ecosystem_event_on_engagement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_category text;
    v_subtype  text;
BEGIN
    -- Match §3.16 default point scale. Engagement types not on the list
    -- (mou_discussion / tripartite_discussion / design_stage_intro /
    -- consultant_approval / other) do NOT fire — they're either captured
    -- via the resulting level_up event, or are intentionally excluded.
    IF NEW.engagement_type IN (
        'call', 'meeting', 'email', 'site_visit', 'workshop', 'document_sent'
    ) THEN
        v_category := 'engagement';
        v_subtype  := NEW.engagement_type::text;
    ELSIF NEW.engagement_type = 'spec_inclusion' THEN
        v_category := 'spec_inclusion';
        v_subtype  := 'spec_inclusion';
    ELSE
        RETURN NEW;
    END IF;

    PERFORM insert_ecosystem_event(
        NEW.company_id,
        NEW.engagement_date::timestamptz,
        v_category,
        v_subtype,
        'engagements',
        NEW.id
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engagements_fire_ecosystem ON engagements;
CREATE TRIGGER engagements_fire_ecosystem
    AFTER INSERT ON engagements
    FOR EACH ROW EXECUTE FUNCTION fire_ecosystem_event_on_engagement();


CREATE OR REPLACE FUNCTION fire_ecosystem_event_on_document()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.doc_type IN (
        'announcement'::document_type_t,
        'site_banner_approval'::document_type_t,
        'case_study'::document_type_t
    )
       AND NEW.company_id IS NOT NULL
       AND NEW.is_archived = false
    THEN
        PERFORM insert_ecosystem_event(
            NEW.company_id,
            COALESCE(NEW.signed_date::timestamptz, NEW.created_at),
            'document',
            NEW.doc_type::text,
            'documents',
            NEW.id
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_fire_ecosystem ON documents;
CREATE TRIGGER documents_fire_ecosystem
    AFTER INSERT ON documents
    FOR EACH ROW EXECUTE FUNCTION fire_ecosystem_event_on_document();


-- =====================================================================
-- 2) rebuild_ecosystem_awareness() — recompute today's snapshot
-- =====================================================================
--
-- Computes ecosystem_awareness_current row for current_date.
-- - lifetime_score = SUM(points) over non-void events
-- - active_score   = SUM(points) over non-void events in last N days
--                    (N = ecosystem_decay_window_days, default 90)
-- - theoretical_max = kpi_universe_sizes.total × 100  (per §3.16)
-- - by_company_type / by_level / by_city: jsonb breakdowns
--
-- ON CONFLICT (snapshot_date) DO UPDATE so calling this multiple times
-- a day just refreshes the row.

CREATE OR REPLACE FUNCTION rebuild_ecosystem_awareness()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_decay_days     int;
    v_total_universe int;
    v_lifetime       numeric;
    v_active         numeric;
    v_max            numeric;
    v_by_type        jsonb;
    v_by_level       jsonb;
    v_by_city        jsonb;
    v_today          date := current_date;
BEGIN
    -- bd_manager can never trigger this. cron context (auth.uid() IS NULL)
    -- bypasses the role gate.
    IF auth.uid() IS NOT NULL AND auth_role() = 'bd_manager' THEN
        RAISE EXCEPTION 'Forbidden — bd_manager cannot trigger ecosystem rebuild.';
    END IF;

    SELECT (value_json->>'days')::int INTO v_decay_days
      FROM app_settings WHERE key = 'ecosystem_decay_window_days';
    v_decay_days := COALESCE(v_decay_days, 90);

    SELECT (value_json->>'total')::int INTO v_total_universe
      FROM app_settings WHERE key = 'kpi_universe_sizes';
    v_total_universe := COALESCE(v_total_universe, 789);
    v_max := v_total_universe * 100;  -- §3.16: theoretical ceiling

    SELECT COALESCE(SUM(points), 0) INTO v_lifetime
      FROM ecosystem_events
     WHERE is_void = false;

    SELECT COALESCE(SUM(points), 0) INTO v_active
      FROM ecosystem_events
     WHERE is_void = false
       AND occurred_at >= now() - make_interval(days => v_decay_days);

    SELECT COALESCE(jsonb_object_agg(t.k, jsonb_build_object('lifetime', t.lifetime, 'active', t.active)), '{}'::jsonb)
      INTO v_by_type
      FROM (
        SELECT company_type_at_time::text AS k,
               SUM(points) AS lifetime,
               SUM(CASE WHEN occurred_at >= now() - make_interval(days => v_decay_days)
                        THEN points ELSE 0 END) AS active
          FROM ecosystem_events
         WHERE is_void = false
         GROUP BY company_type_at_time
      ) t;

    SELECT COALESCE(jsonb_object_agg(t.k, jsonb_build_object('lifetime', t.lifetime, 'active', t.active)), '{}'::jsonb)
      INTO v_by_level
      FROM (
        SELECT company_level_at_time::text AS k,
               SUM(points) AS lifetime,
               SUM(CASE WHEN occurred_at >= now() - make_interval(days => v_decay_days)
                        THEN points ELSE 0 END) AS active
          FROM ecosystem_events
         WHERE is_void = false
         GROUP BY company_level_at_time
      ) t;

    -- by_city: top 20 cities by lifetime points
    SELECT COALESCE(jsonb_object_agg(t.city, jsonb_build_object('lifetime', t.lifetime, 'active', t.active)), '{}'::jsonb)
      INTO v_by_city
      FROM (
        SELECT COALESCE(c.city, '(unknown)') AS city,
               SUM(e.points) AS lifetime,
               SUM(CASE WHEN e.occurred_at >= now() - make_interval(days => v_decay_days)
                        THEN e.points ELSE 0 END) AS active
          FROM ecosystem_events e
          LEFT JOIN companies c ON c.id = e.company_id
         WHERE e.is_void = false
         GROUP BY c.city
         ORDER BY SUM(e.points) DESC
         LIMIT 20
      ) t;

    INSERT INTO ecosystem_awareness_current (
        snapshot_date, lifetime_score, active_score, theoretical_max,
        lifetime_pct, active_pct, by_company_type, by_level, by_city, computed_at
    ) VALUES (
        v_today, v_lifetime, v_active, v_max,
        CASE WHEN v_max > 0 THEN ROUND(v_lifetime / v_max * 100, 4) ELSE 0 END,
        CASE WHEN v_max > 0 THEN ROUND(v_active   / v_max * 100, 4) ELSE 0 END,
        v_by_type, v_by_level, v_by_city, now()
    )
    ON CONFLICT (snapshot_date) DO UPDATE SET
        lifetime_score   = EXCLUDED.lifetime_score,
        active_score     = EXCLUDED.active_score,
        theoretical_max  = EXCLUDED.theoretical_max,
        lifetime_pct     = EXCLUDED.lifetime_pct,
        active_pct       = EXCLUDED.active_pct,
        by_company_type  = EXCLUDED.by_company_type,
        by_level         = EXCLUDED.by_level,
        by_city          = EXCLUDED.by_city,
        computed_at      = EXCLUDED.computed_at;
END;
$$;

GRANT EXECUTE ON FUNCTION rebuild_ecosystem_awareness() TO authenticated;


-- =====================================================================
-- 3) backfill_ecosystem_events() — one-time replay of historical rows
-- =====================================================================
--
-- Runs once after this migration is applied so the dashboard isn't empty.
-- Idempotent: ecosystem_events.dedup_key is UNIQUE; ON CONFLICT DO NOTHING
-- means rerunning the function is safe.
--
-- Bypasses insert_ecosystem_event() because that function uses the *current*
-- company state (level/type/dormant) and applies a 7-day dedup window meant
-- for real-time inserts. Backfill needs:
--   - level_history rows: snapshot fields are already on the row.
--   - engagements/documents: company state is best-effort current state.
--
-- Returns one row per category with the count of newly-inserted events so
-- the admin can see what landed.

CREATE OR REPLACE FUNCTION backfill_ecosystem_events()
RETURNS TABLE(category text, inserted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count bigint;
BEGIN
    IF auth.uid() IS NOT NULL AND auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Forbidden — admin only.';
    END IF;

    -- 3a) level_history → level_up events
    WITH inserted AS (
        INSERT INTO ecosystem_events (
            occurred_at, company_id, event_category, event_subtype, points,
            source_table, source_id, company_type_at_time, company_level_at_time,
            is_dormant_at_time, dedup_key
        )
        SELECT
            lh.changed_at,
            lh.company_id,
            'level_up',
            format('%s_to_%s', lh.from_level::text, lh.to_level::text),
            s.points_current,
            'level_history',
            lh.id,
            lh.company_type_at_time,
            lh.to_level,
            false,
            format('%s|%s_to_%s|%s',
                   lh.company_id, lh.from_level::text, lh.to_level::text,
                   date_trunc('day', lh.changed_at))
        FROM level_history lh
        JOIN ecosystem_point_scale s
          ON s.event_category = 'level_up'
         AND s.event_subtype  = format('%s_to_%s', lh.from_level::text, lh.to_level::text)
        WHERE lh.is_forward = true AND lh.is_credited = true
        ON CONFLICT (dedup_key) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM inserted;
    category := 'level_up'; inserted := v_count; RETURN NEXT;

    -- 3b) engagements (call/meeting/email/site_visit/workshop/document_sent)
    WITH inserted AS (
        INSERT INTO ecosystem_events (
            occurred_at, company_id, event_category, event_subtype, points,
            source_table, source_id, company_type_at_time, company_level_at_time,
            is_dormant_at_time, dedup_key
        )
        SELECT
            e.engagement_date::timestamptz,
            e.company_id,
            'engagement',
            e.engagement_type::text,
            s.points_current,
            'engagements',
            e.id,
            c.company_type,
            c.current_level,
            (c.has_active_projects = false AND c.current_level = 'L0'),
            format('%s|%s|%s',
                   e.company_id, e.engagement_type::text,
                   date_trunc('day', e.engagement_date::timestamptz))
        FROM engagements e
        JOIN companies c ON c.id = e.company_id
        JOIN ecosystem_point_scale s
          ON s.event_category = 'engagement'
         AND s.event_subtype  = e.engagement_type::text
        WHERE e.engagement_type IN ('call','meeting','email','site_visit','workshop','document_sent')
        ON CONFLICT (dedup_key) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM inserted;
    category := 'engagement'; inserted := v_count; RETURN NEXT;

    -- 3c) spec_inclusion engagements
    WITH inserted AS (
        INSERT INTO ecosystem_events (
            occurred_at, company_id, event_category, event_subtype, points,
            source_table, source_id, company_type_at_time, company_level_at_time,
            is_dormant_at_time, dedup_key
        )
        SELECT
            e.engagement_date::timestamptz,
            e.company_id,
            'spec_inclusion',
            'spec_inclusion',
            s.points_current,
            'engagements',
            e.id,
            c.company_type,
            c.current_level,
            (c.has_active_projects = false AND c.current_level = 'L0'),
            format('%s|spec_inclusion|%s',
                   e.company_id, date_trunc('day', e.engagement_date::timestamptz))
        FROM engagements e
        JOIN companies c ON c.id = e.company_id
        JOIN ecosystem_point_scale s
          ON s.event_category = 'spec_inclusion'
         AND s.event_subtype  = 'spec_inclusion'
        WHERE e.engagement_type = 'spec_inclusion'
        ON CONFLICT (dedup_key) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM inserted;
    category := 'spec_inclusion'; inserted := v_count; RETURN NEXT;

    -- 3d) documents (announcement/site_banner_approval/case_study)
    WITH inserted AS (
        INSERT INTO ecosystem_events (
            occurred_at, company_id, event_category, event_subtype, points,
            source_table, source_id, company_type_at_time, company_level_at_time,
            is_dormant_at_time, dedup_key
        )
        SELECT
            COALESCE(d.signed_date::timestamptz, d.created_at),
            d.company_id,
            'document',
            d.doc_type::text,
            s.points_current,
            'documents',
            d.id,
            c.company_type,
            c.current_level,
            (c.has_active_projects = false AND c.current_level = 'L0'),
            format('%s|%s|%s',
                   d.company_id, d.doc_type::text,
                   date_trunc('day', COALESCE(d.signed_date::timestamptz, d.created_at)))
        FROM documents d
        JOIN companies c ON c.id = d.company_id
        JOIN ecosystem_point_scale s
          ON s.event_category = 'document'
         AND s.event_subtype  = d.doc_type::text
        WHERE d.doc_type IN ('announcement','site_banner_approval','case_study')
          AND d.is_archived = false
          AND d.company_id IS NOT NULL
        ON CONFLICT (dedup_key) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM inserted;
    category := 'document'; inserted := v_count; RETURN NEXT;

    -- After backfill, recompute today's snapshot.
    PERFORM rebuild_ecosystem_awareness();
END;
$$;

GRANT EXECUTE ON FUNCTION backfill_ecosystem_events() TO authenticated;
