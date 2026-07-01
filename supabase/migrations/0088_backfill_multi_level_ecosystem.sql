-- 0088_backfill_multi_level_ecosystem.sql
-- Approving a multi-level setup-mode request (0086) landed a
-- level_history row with a skip-level subtype (e.g. L1_to_L3). The
-- ecosystem event trigger (0034) then called insert_ecosystem_event
-- (0021), which raised "No ecosystem_point_scale row for (level_up,
-- L1_to_L3)" because that subtype was never seeded. The exception
-- bubbled up through approve_level_change_request and rolled the
-- entire approval back.
--
-- Right semantic (per the follow-up brief): backfill isn't fake
-- work — the stakeholder really did climb through each level, and
-- leadership needs to see that footprint in the ecosystem awareness
-- rollup. So an L1→L3 backfill should award ecosystem points for
-- L1_to_L2 AND L2_to_L3, exactly as if it had been done as two
-- consecutive single-step moves. Driver A "earned" credit still
-- stays excluded for backfill (0085's rebuild_kpi_actuals filter on
-- source='progression') — leadership-visible footprint and the BDM's
-- personal ledger are two different things.
--
-- Applies to every is_forward + is_credited row: single-step is the
-- trivial one-iteration case, multi-level expands into the intermediate
-- subtypes. The same rule the pipeline visually implies ("the card
-- crossed these levels") now shows up in the ecosystem numbers.
--
-- Two touch points:
--   1) level_from_index(int) — small inverse helper (paired with
--      0031's level_index).
--   2) fire_ecosystem_event_on_level_history — real-time AFTER
--      INSERT trigger. Rewritten as a loop over intermediate steps.
--   3) backfill_ecosystem_events — admin rebuild path (0034).
--      Rewritten with a LATERAL generate_series expansion; each
--      level_history row emits one INSERT per intermediate step.

-- ---------------------------------------------------------------------------
-- 1) level_from_index inverse helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION level_from_index(p_idx int)
RETURNS level_t
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_idx
        WHEN 0 THEN 'L0'::level_t
        WHEN 1 THEN 'L1'::level_t
        WHEN 2 THEN 'L2'::level_t
        WHEN 3 THEN 'L3'::level_t
        WHEN 4 THEN 'L4'::level_t
        WHEN 5 THEN 'L5'::level_t
    END;
$$;

COMMENT ON FUNCTION level_from_index(int) IS
    'Inverse of level_index(level_t). Used by the ecosystem event '
    'pipeline (0088) to walk the intermediate single-step subtypes of '
    'a multi-level forward move.';

-- ---------------------------------------------------------------------------
-- 2) fire_ecosystem_event_on_level_history — real-time path
-- ---------------------------------------------------------------------------
--
-- Loops from (from_level + 1) up to to_level, firing a
-- level_up event with subtype L{i-1}_to_L{i} for each single-step
-- crossed. Single-step forward moves (delta=1) execute the loop body
-- once — identical to pre-0088 behaviour. Multi-level moves emit
-- multiple events so the ecosystem awareness rollup includes every
-- rung of the ladder.
--
-- insert_ecosystem_event's own 7-day dedup (0021:287-295) still
-- applies per-subtype, so no double-counting inside the rolling
-- window.

CREATE OR REPLACE FUNCTION fire_ecosystem_event_on_level_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_step_to_idx int;
    v_from_lvl    level_t;
    v_to_lvl      level_t;
    v_subtype     text;
BEGIN
    IF NEW.is_forward <> true OR NEW.is_credited <> true THEN
        RETURN NEW;
    END IF;

    FOR v_step_to_idx IN
        (level_index(NEW.from_level) + 1)..level_index(NEW.to_level)
    LOOP
        v_from_lvl := level_from_index(v_step_to_idx - 1);
        v_to_lvl   := level_from_index(v_step_to_idx);
        v_subtype  := format('%s_to_%s', v_from_lvl::text, v_to_lvl::text);
        PERFORM insert_ecosystem_event(
            NEW.company_id,
            NEW.changed_at,
            'level_up',
            v_subtype,
            'level_history',
            NEW.id
        );
    END LOOP;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) backfill_ecosystem_events — admin rebuild path
-- ---------------------------------------------------------------------------
--
-- The level_history subquery now LATERAL-expands each is_forward +
-- is_credited row into 1..(delta) intermediate rows via
-- generate_series, then joins ecosystem_point_scale on the resulting
-- single-step subtype. Single-step level_history rows produce one
-- ecosystem row each (same as before); multi-level rows produce
-- delta rows. The dedup_key includes the intermediate subtype so
-- multiple rows from the same level_history don't collide.
--
-- Engagement + document paths are byte-for-byte identical to 0034.

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

    -- 3a) level_history → level_up events (one per intermediate step).
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
            steps.subtype,
            s.points_current,
            'level_history',
            lh.id,
            lh.company_type_at_time,
            -- Row-time level snapshot on this specific rung; the
            -- last rung's step_to matches lh.to_level exactly.
            steps.step_to_level,
            false,
            format('%s|%s|%s',
                   lh.company_id, steps.subtype,
                   date_trunc('day', lh.changed_at))
        FROM level_history lh
        CROSS JOIN LATERAL (
            SELECT
                generate_series(
                    level_index(lh.from_level) + 1,
                    level_index(lh.to_level)
                ) AS step_to_idx
        ) g
        CROSS JOIN LATERAL (
            SELECT
                level_from_index(g.step_to_idx)     AS step_to_level,
                level_from_index(g.step_to_idx - 1) AS step_from_level,
                format(
                    '%s_to_%s',
                    level_from_index(g.step_to_idx - 1)::text,
                    level_from_index(g.step_to_idx)::text
                ) AS subtype
        ) steps
        JOIN ecosystem_point_scale s
          ON s.event_category = 'level_up'
         AND s.event_subtype  = steps.subtype
        WHERE lh.is_forward = true
          AND lh.is_credited = true
        ON CONFLICT (dedup_key) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM inserted;
    category := 'level_up'; inserted := v_count; RETURN NEXT;

    -- 3b) engagements → engagement / spec_inclusion events. Verbatim
    -- from 0034 (no level_history dependency).
    WITH inserted AS (
        INSERT INTO ecosystem_events (
            occurred_at, company_id, event_category, event_subtype, points,
            source_table, source_id, company_type_at_time, company_level_at_time,
            is_dormant_at_time, dedup_key
        )
        SELECT
            e.engagement_date::timestamptz,
            e.company_id,
            CASE
                WHEN e.engagement_type IN ('call','meeting','email','site_visit','workshop','document_sent')
                    THEN 'engagement'
                WHEN e.engagement_type = 'spec_inclusion'
                    THEN 'spec_inclusion'
            END,
            CASE
                WHEN e.engagement_type IN ('call','meeting','email','site_visit','workshop','document_sent')
                    THEN e.engagement_type::text
                WHEN e.engagement_type = 'spec_inclusion'
                    THEN 'spec_inclusion'
            END,
            s.points_current,
            'engagements',
            e.id,
            c.company_type,
            c.current_level,
            (c.has_active_projects = false AND c.current_level = 'L0'),
            format('%s|%s|%s',
                   e.company_id,
                   e.engagement_type,
                   date_trunc('day', e.engagement_date::timestamptz))
        FROM engagements e
        JOIN companies c ON c.id = e.company_id
        JOIN ecosystem_point_scale s
          ON s.event_category = CASE
                WHEN e.engagement_type IN ('call','meeting','email','site_visit','workshop','document_sent')
                    THEN 'engagement'
                WHEN e.engagement_type = 'spec_inclusion'
                    THEN 'spec_inclusion'
             END
         AND s.event_subtype = CASE
                WHEN e.engagement_type IN ('call','meeting','email','site_visit','workshop','document_sent')
                    THEN e.engagement_type::text
                WHEN e.engagement_type = 'spec_inclusion'
                    THEN 'spec_inclusion'
             END
        WHERE e.engagement_type IN (
            'call','meeting','email','site_visit','workshop','document_sent','spec_inclusion'
        )
        ON CONFLICT (dedup_key) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM inserted;
    category := 'engagement_and_spec'; inserted := v_count; RETURN NEXT;

    -- 3c) documents → document events. Verbatim from 0034.
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
                   d.company_id,
                   d.doc_type,
                   date_trunc('day', COALESCE(d.signed_date::timestamptz, d.created_at)))
        FROM documents d
        JOIN companies c ON c.id = d.company_id
        JOIN ecosystem_point_scale s
          ON s.event_category = 'document'
         AND s.event_subtype  = d.doc_type::text
        WHERE d.company_id IS NOT NULL
          AND d.is_archived = false
        ON CONFLICT (dedup_key) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM inserted;
    category := 'document'; inserted := v_count; RETURN NEXT;

    RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION backfill_ecosystem_events() TO authenticated;

COMMENT ON FUNCTION backfill_ecosystem_events() IS
    'Admin rebuild path for ecosystem_events. As of 0088, the '
    'level_history subquery LATERAL-expands each is_forward + '
    'is_credited row into one row per intermediate single-step '
    'subtype — so a multi-level backfill (e.g. L1→L3) contributes '
    'both L1_to_L2 and L2_to_L3 to the ecosystem awareness rollup, '
    'matching the stakeholder''s actual footprint. Driver A credit '
    'is a separate concern and still filters on source=''progression'' '
    'in rebuild_kpi_actuals (0085).';
