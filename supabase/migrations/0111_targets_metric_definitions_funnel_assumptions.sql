-- 0111_targets_metric_definitions_funnel_assumptions.sql
-- Phase 1b-i (schema only). Three new tables + enums + indexes + RLS
-- + audit RPCs + seed. Nothing reads these yet — the settings UI,
-- derivation and computation land in Phase 1b-ii / iii / iv.
--
-- playbook_targets and member_targets are untouched and remain the
-- source of truth for /reports/scorecard until later phases replace
-- them. kpi_actuals_daily, level_history, engagements, notifications
-- and the BEI views are untouched.
--
-- Design notes:
--   - level_code / entity_type / activity_type are TEXT, not FKs, per
--     the spec. The levels and entity_types tables land in Phase 2;
--     constrained here against the existing enums (level_t,
--     company_type_t, engagement_type_t) via CHECK — swap to FKs when
--     Phase 2 lands.
--   - `level_at_or_above BOOLEAN` carries the "L3+" semantics
--     (level_code='L3', level_at_or_above=true matches L3, L4, L5).
--     Not a separate column per metric type.
--   - UNIQUE NULLS NOT DISTINCT (PG 15+) treats NULL as a single
--     value, so two team-wide (owner_id=NULL) rows for the same
--     (metric, level_code, …, period_start) collide instead of
--     silently duplicating.
--   - Audit: matches the house pattern from 0045 — SECURITY DEFINER
--     RPCs that snapshot before/after into audit_events. No AFTER
--     triggers; targets edited via raw admin SQL in the Supabase SQL
--     editor would bypass audit, same trade-off as every other config
--     table today.
--   - funnel_assumptions holds TWO ratios, not three. L1 is the entry
--     point — stakeholders to open are chosen, not converted from a
--     pool — so no L0→L1 row exists. See the seed comment below.

-- =====================================================================
-- 1) enums
-- =====================================================================

CREATE TYPE metric_t      AS ENUM ('advancement', 'engagement', 'coverage');
CREATE TYPE period_type_t AS ENUM ('year', 'quarter', 'month');

-- =====================================================================
-- 2) metric_definitions — registry of what we can target
-- =====================================================================

CREATE TABLE metric_definitions (
    id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    metric             metric_t      NOT NULL,
    level_code         text          NULL,
    level_at_or_above  boolean       NOT NULL DEFAULT false,
    cadence            period_type_t NOT NULL,
    is_active          boolean       NOT NULL DEFAULT true,
    display_name       text          NOT NULL,
    created_at         timestamptz   NOT NULL DEFAULT now(),
    updated_at         timestamptz   NOT NULL DEFAULT now(),

    -- level_code must be a valid level_t when present. Will become a
    -- real FK against the Phase-2 `levels` table.
    CONSTRAINT metric_definitions_level_code_check
        CHECK (level_code IS NULL OR level_code = ANY (
            ARRAY['L0','L1','L2','L3','L4','L5']
        )),
    -- Advancement and coverage always carry a level_code; engagement
    -- is level-agnostic.
    CONSTRAINT metric_definitions_metric_level_shape
        CHECK (
            (metric IN ('advancement','coverage') AND level_code IS NOT NULL)
         OR (metric = 'engagement' AND level_code IS NULL AND level_at_or_above = false)
        ),
    -- One definition per (metric, level_code, level_at_or_above, cadence) tuple.
    CONSTRAINT metric_definitions_scope_unique
        UNIQUE NULLS NOT DISTINCT (metric, level_code, level_at_or_above, cadence)
);

COMMENT ON TABLE metric_definitions IS
    'Registry of metrics the Targets model can set a goal against. '
    'Edited through update_metric_definition_with_audit() for the audit trail.';

ALTER TABLE metric_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY metric_definitions_select_all
    ON metric_definitions FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY metric_definitions_write_admin
    ON metric_definitions FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

-- =====================================================================
-- 3) funnel_assumptions — progression ratios used by the derivation
-- =====================================================================

CREATE TABLE funnel_assumptions (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    from_level  text          NOT NULL,
    to_level    text          NOT NULL,
    ratio       numeric(5,3)  NOT NULL CHECK (ratio >= 0 AND ratio <= 1),
    owner_id    uuid          NULL REFERENCES profiles(id) ON DELETE CASCADE,
    updated_by  uuid          NULL REFERENCES profiles(id) ON DELETE SET NULL,
    created_at  timestamptz   NOT NULL DEFAULT now(),
    updated_at  timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT funnel_assumptions_from_level_check
        CHECK (from_level = ANY (ARRAY['L0','L1','L2','L3','L4','L5'])),
    CONSTRAINT funnel_assumptions_to_level_check
        CHECK (to_level   = ANY (ARRAY['L0','L1','L2','L3','L4','L5'])),
    CONSTRAINT funnel_assumptions_different_levels
        CHECK (from_level <> to_level),

    -- One ratio per (from, to, owner) — owner NULL = tenant default.
    CONSTRAINT funnel_assumptions_scope_unique
        UNIQUE NULLS NOT DISTINCT (from_level, to_level, owner_id)
);

COMMENT ON TABLE funnel_assumptions IS
    'Progression ratios used by the derivation engine in Phase 1b-iii. '
    'owner_id NULL = tenant-wide default; per-user rows override. Edited '
    'through upsert_funnel_assumption_with_audit().';

CREATE INDEX funnel_assumptions_owner_idx ON funnel_assumptions (owner_id);

ALTER TABLE funnel_assumptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY funnel_assumptions_select_all
    ON funnel_assumptions FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY funnel_assumptions_write_admin
    ON funnel_assumptions FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

-- =====================================================================
-- 4) targets — rows, not columns, so month/quarter/year all fit
-- =====================================================================

CREATE TABLE targets (
    id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    metric             metric_t      NOT NULL,
    level_code         text          NULL,
    level_at_or_above  boolean       NOT NULL DEFAULT false,
    entity_type        text          NULL,
    activity_type      text          NULL,
    owner_id           uuid          NULL REFERENCES profiles(id) ON DELETE CASCADE,
    period_type        period_type_t NOT NULL,
    period_start       date          NOT NULL,
    target_value       int           NOT NULL CHECK (target_value >= 0),
    is_derived         boolean       NOT NULL DEFAULT false,
    created_by         uuid          NULL REFERENCES profiles(id) ON DELETE SET NULL,
    created_at         timestamptz   NOT NULL DEFAULT now(),
    updated_at         timestamptz   NOT NULL DEFAULT now(),

    -- Enum alignment via CHECK — swap to FKs in Phase 2.
    CONSTRAINT targets_level_code_check
        CHECK (level_code IS NULL OR level_code = ANY (
            ARRAY['L0','L1','L2','L3','L4','L5']
        )),
    CONSTRAINT targets_entity_type_check
        CHECK (entity_type IS NULL OR entity_type = ANY (
            ARRAY['developer','design_consultant','main_contractor',
                  'mep_consultant','mep_contractor','authority','other','society']
        )),
    CONSTRAINT targets_activity_type_check
        CHECK (activity_type IS NULL OR activity_type = ANY (
            ARRAY['call','meeting','email','site_visit','workshop','document_sent',
                  'mou_discussion','tripartite_discussion','spec_inclusion',
                  'design_stage_intro','consultant_approval','other']
        )),
    -- Advancement + coverage must carry a level_code; engagement must not.
    CONSTRAINT targets_metric_level_shape
        CHECK (
            (metric IN ('advancement','coverage') AND level_code IS NOT NULL)
         OR (metric = 'engagement' AND level_code IS NULL AND level_at_or_above = false)
        ),
    -- activity_type only on engagement rows.
    CONSTRAINT targets_activity_only_on_engagement
        CHECK (activity_type IS NULL OR metric = 'engagement'),

    -- period_start must be the first day of its period.
    CONSTRAINT targets_period_start_month
        CHECK (period_type <> 'month'
            OR period_start = date_trunc('month', period_start)::date),
    CONSTRAINT targets_period_start_quarter
        CHECK (period_type <> 'quarter'
            OR period_start = date_trunc('quarter', period_start)::date),
    CONSTRAINT targets_period_start_year
        CHECK (period_type <> 'year'
            OR period_start = date_trunc('year', period_start)::date),

    -- The intent of "one target per scope per period" — NULLS NOT
    -- DISTINCT so team rows (owner_id NULL) and type-all rows
    -- (entity_type NULL) don't duplicate.
    CONSTRAINT targets_scope_unique
        UNIQUE NULLS NOT DISTINCT (
            metric, level_code, level_at_or_above,
            entity_type, activity_type, owner_id,
            period_type, period_start
        )
);

COMMENT ON TABLE targets IS
    'Row-per-period target store. metric + level_code + level_at_or_above '
    '+ entity_type + activity_type + owner_id + period_type + period_start '
    'uniquely identifies a target. owner_id NULL = team goal. '
    'Edited through upsert_target_with_audit() + delete_target_with_audit() '
    'for the audit trail.';

-- Common access paths — scoreboards query by (metric, owner_id, period range).
CREATE INDEX targets_owner_idx          ON targets (owner_id);
CREATE INDEX targets_metric_period_idx  ON targets (metric, period_type, period_start);
CREATE INDEX targets_period_start_idx   ON targets (period_start);

ALTER TABLE targets ENABLE ROW LEVEL SECURITY;

-- Visibility mirrors member_targets (0022:230-241):
--   - Team-wide rows (owner_id IS NULL) visible to any authenticated user.
--   - Per-user rows visible to admin / bd_head / leadership (team visibility),
--     and to the owner for their own.
CREATE POLICY targets_select_team_rows
    ON targets FOR SELECT
    USING (auth.uid() IS NOT NULL AND owner_id IS NULL);

CREATE POLICY targets_select_per_user_admin_head_leadership
    ON targets FOR SELECT
    USING (auth_role() IN ('admin','bd_head','leadership') AND owner_id IS NOT NULL);

CREATE POLICY targets_select_per_user_own
    ON targets FOR SELECT
    USING (auth_role() = 'bd_manager' AND owner_id = auth.uid());

-- Writes: admin only (per the spec; settings UI lives in Phase 1b-ii).
CREATE POLICY targets_write_admin
    ON targets FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

-- =====================================================================
-- 5) audit RPCs — follow 0045's pattern
-- =====================================================================

-- 5a) upsert_target_with_audit — insert or update by scope key
CREATE OR REPLACE FUNCTION upsert_target_with_audit(
    p_metric             metric_t,
    p_level_code         text,
    p_level_at_or_above  boolean,
    p_entity_type        text,
    p_activity_type      text,
    p_owner_id           uuid,
    p_period_type        period_type_t,
    p_period_start       date,
    p_target_value       int,
    p_is_derived         boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id      uuid;
    v_before  jsonb;
    v_after   jsonb;
BEGIN
    IF auth.uid() IS NULL OR auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    SELECT id, to_jsonb(t.*) INTO v_id, v_before
      FROM targets t
     WHERE metric             = p_metric
       AND level_code         IS NOT DISTINCT FROM p_level_code
       AND level_at_or_above  = p_level_at_or_above
       AND entity_type        IS NOT DISTINCT FROM p_entity_type
       AND activity_type      IS NOT DISTINCT FROM p_activity_type
       AND owner_id           IS NOT DISTINCT FROM p_owner_id
       AND period_type        = p_period_type
       AND period_start       = p_period_start
     FOR UPDATE;

    IF v_id IS NULL THEN
        INSERT INTO targets (
            metric, level_code, level_at_or_above,
            entity_type, activity_type, owner_id,
            period_type, period_start, target_value,
            is_derived, created_by
        ) VALUES (
            p_metric, p_level_code, p_level_at_or_above,
            p_entity_type, p_activity_type, p_owner_id,
            p_period_type, p_period_start, p_target_value,
            p_is_derived, auth.uid()
        ) RETURNING id INTO v_id;
    ELSE
        UPDATE targets
           SET target_value = p_target_value,
               is_derived   = p_is_derived,
               updated_at   = now()
         WHERE id = v_id;
    END IF;

    SELECT to_jsonb(t.*) INTO v_after FROM targets t WHERE id = v_id;

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id, before_json, after_json
    ) VALUES (
        auth.uid(), 'target_change', 'target', v_id, v_before, v_after
    );

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_target_with_audit(
    metric_t, text, boolean, text, text, uuid, period_type_t, date, int, boolean
) TO authenticated;

-- 5b) delete_target_with_audit
CREATE OR REPLACE FUNCTION delete_target_with_audit(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before jsonb;
BEGIN
    IF auth.uid() IS NULL OR auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    SELECT to_jsonb(t.*) INTO v_before FROM targets t WHERE id = p_id FOR UPDATE;
    IF v_before IS NULL THEN
        RAISE EXCEPTION 'Target % not found.', p_id;
    END IF;

    DELETE FROM targets WHERE id = p_id;

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id, before_json, after_json
    ) VALUES (
        auth.uid(), 'target_delete', 'target', p_id, v_before, NULL
    );
END;
$$;

GRANT EXECUTE ON FUNCTION delete_target_with_audit(uuid) TO authenticated;

-- 5c) update_metric_definition_with_audit
CREATE OR REPLACE FUNCTION update_metric_definition_with_audit(
    p_id            uuid,
    p_is_active     boolean,
    p_display_name  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before jsonb;
    v_after  jsonb;
BEGIN
    IF auth.uid() IS NULL OR auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    SELECT to_jsonb(m.*) INTO v_before FROM metric_definitions m WHERE id = p_id FOR UPDATE;
    IF v_before IS NULL THEN
        RAISE EXCEPTION 'Metric definition % not found.', p_id;
    END IF;

    UPDATE metric_definitions
       SET is_active    = p_is_active,
           display_name = p_display_name,
           updated_at   = now()
     WHERE id = p_id;

    SELECT to_jsonb(m.*) INTO v_after FROM metric_definitions m WHERE id = p_id;

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id, before_json, after_json
    ) VALUES (
        auth.uid(), 'metric_definition_change', 'metric_definition', p_id, v_before, v_after
    );
END;
$$;

GRANT EXECUTE ON FUNCTION update_metric_definition_with_audit(uuid, boolean, text) TO authenticated;

-- 5d) upsert_funnel_assumption_with_audit
CREATE OR REPLACE FUNCTION upsert_funnel_assumption_with_audit(
    p_from_level text,
    p_to_level   text,
    p_ratio      numeric,
    p_owner_id   uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id     uuid;
    v_before jsonb;
    v_after  jsonb;
BEGIN
    IF auth.uid() IS NULL OR auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    SELECT id, to_jsonb(f.*) INTO v_id, v_before
      FROM funnel_assumptions f
     WHERE from_level = p_from_level
       AND to_level   = p_to_level
       AND owner_id   IS NOT DISTINCT FROM p_owner_id
     FOR UPDATE;

    IF v_id IS NULL THEN
        INSERT INTO funnel_assumptions (from_level, to_level, ratio, owner_id, updated_by)
        VALUES (p_from_level, p_to_level, p_ratio, p_owner_id, auth.uid())
        RETURNING id INTO v_id;
    ELSE
        UPDATE funnel_assumptions
           SET ratio      = p_ratio,
               updated_by = auth.uid(),
               updated_at = now()
         WHERE id = v_id;
    END IF;

    SELECT to_jsonb(f.*) INTO v_after FROM funnel_assumptions f WHERE id = v_id;

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id, before_json, after_json
    ) VALUES (
        auth.uid(), 'funnel_assumption_change', 'funnel_assumption', v_id, v_before, v_after
    );

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_funnel_assumption_with_audit(text, text, numeric, uuid) TO authenticated;

-- =====================================================================
-- 6) seed — metric_definitions (5 rows)
-- =====================================================================

INSERT INTO metric_definitions (metric, level_code, level_at_or_above, cadence, is_active, display_name) VALUES
    ('advancement', 'L1', false, 'month',   true, 'Open a new stakeholder'),
    ('advancement', 'L2', false, 'quarter', true, 'Qualify'),
    ('advancement', 'L3', true,  'quarter', true, 'Advance'),
    ('engagement',  NULL, false, 'month',   true, 'Engagements logged'),
    ('coverage',    'L3', true,  'quarter', true, 'Relationships held')
ON CONFLICT ON CONSTRAINT metric_definitions_scope_unique DO NOTHING;

-- =====================================================================
-- 7) seed — funnel_assumptions (2 rows, team-wide)
--
-- Two ratios, not three. L1 is the entry point: stakeholders to
-- open are CHOSEN (BD outreach picks who to engage), not converted
-- from a pool. There is no "L0 → L1" conversion ratio to seed —
-- the ~3.5k L0 universe is not a pool each L1 is drawn from.
--
-- The 6:3:1 chain still holds past L1:
--   L1 → L2 ratio 0.500   (12 of every 24 opened stakeholders qualify)
--   L2 → L3 ratio 0.333   (4  of every 12 qualified stakeholders advance)
--   → 24 : 12 : 4 per person per year.
-- =====================================================================

INSERT INTO funnel_assumptions (from_level, to_level, ratio, owner_id) VALUES
    ('L1', 'L2', 0.500, NULL),
    ('L2', 'L3', 0.333, NULL)
ON CONFLICT ON CONSTRAINT funnel_assumptions_scope_unique DO NOTHING;

-- =====================================================================
-- 8) seed — targets for FY2026, three bd_managers.
--
-- Looked up by full_name so this migration is portable across envs
-- that lack those profiles (the INSERT ... SELECT yields zero rows
-- rather than erroring). The three names were verified against
-- prod before this migration was written — see Step 0 report.
--
-- Expected totals (asserted in the done-check against 102):
--   Open monthly              36 rows  (3 BDMs × 12 months × target 2)
--   Qualify quarterly         12 rows  (3 BDMs × 4 quarters × target 3)
--   Advance quarterly         12 rows  (3 BDMs × 4 quarters × target 1)
--   Engagements monthly       36 rows  (3 BDMs × 12 months × target 6)
--   Coverage annual            3 rows  (one per BDM; Anna 13, Rami 9, Fouad 14)
--   Focus-area annual          3 rows  (Anna developer 3, Rami developer 2,
--                                       Fouad design_consultant 2)
--                             ────
--                             102 rows
-- =====================================================================

-- Monthly Open (→L1): 36 rows at target_value 2.
INSERT INTO targets (
    metric, level_code, level_at_or_above, entity_type, activity_type,
    owner_id, period_type, period_start, target_value, is_derived
)
SELECT 'advancement', 'L1', false, NULL, NULL,
       p.id, 'month'::period_type_t, d::date, 2, false
  FROM profiles p
  CROSS JOIN generate_series('2026-01-01'::date, '2026-12-01'::date, interval '1 month') AS d
 WHERE p.full_name IN ('Anna Mironova','Rami Judeah','Fouad Ahmed')
   AND p.is_active = true
ON CONFLICT ON CONSTRAINT targets_scope_unique DO NOTHING;

-- Quarterly Qualify (→L2): 12 rows at target_value 3.
INSERT INTO targets (
    metric, level_code, level_at_or_above, entity_type, activity_type,
    owner_id, period_type, period_start, target_value, is_derived
)
SELECT 'advancement', 'L2', false, NULL, NULL,
       p.id, 'quarter'::period_type_t, d::date, 3, false
  FROM profiles p
  CROSS JOIN generate_series('2026-01-01'::date, '2026-10-01'::date, interval '3 months') AS d
 WHERE p.full_name IN ('Anna Mironova','Rami Judeah','Fouad Ahmed')
   AND p.is_active = true
ON CONFLICT ON CONSTRAINT targets_scope_unique DO NOTHING;

-- Quarterly Advance (→L3+): 12 rows at target_value 1.
INSERT INTO targets (
    metric, level_code, level_at_or_above, entity_type, activity_type,
    owner_id, period_type, period_start, target_value, is_derived
)
SELECT 'advancement', 'L3', true, NULL, NULL,
       p.id, 'quarter'::period_type_t, d::date, 1, false
  FROM profiles p
  CROSS JOIN generate_series('2026-01-01'::date, '2026-10-01'::date, interval '3 months') AS d
 WHERE p.full_name IN ('Anna Mironova','Rami Judeah','Fouad Ahmed')
   AND p.is_active = true
ON CONFLICT ON CONSTRAINT targets_scope_unique DO NOTHING;

-- Monthly Engagements: 36 rows at target_value 6.
INSERT INTO targets (
    metric, level_code, level_at_or_above, entity_type, activity_type,
    owner_id, period_type, period_start, target_value, is_derived
)
SELECT 'engagement', NULL, false, NULL, NULL,
       p.id, 'month'::period_type_t, d::date, 6, false
  FROM profiles p
  CROSS JOIN generate_series('2026-01-01'::date, '2026-12-01'::date, interval '1 month') AS d
 WHERE p.full_name IN ('Anna Mironova','Rami Judeah','Fouad Ahmed')
   AND p.is_active = true
ON CONFLICT ON CONSTRAINT targets_scope_unique DO NOTHING;

-- Annual Coverage at L3+: year-end position, 3 rows.
INSERT INTO targets (
    metric, level_code, level_at_or_above, entity_type, activity_type,
    owner_id, period_type, period_start, target_value, is_derived
)
SELECT 'coverage', 'L3', true, NULL, NULL,
       p.id, 'year'::period_type_t, '2026-01-01'::date, v.target_value, false
  FROM (VALUES
      ('Anna Mironova',  13),
      ('Rami Judeah',     9),
      ('Fouad Ahmed',    14)
  ) AS v(name, target_value)
  JOIN profiles p ON p.full_name = v.name AND p.is_active = true
ON CONFLICT ON CONSTRAINT targets_scope_unique DO NOTHING;

-- Annual focus-area sub-targets (entity_type-scoped advancement, L3+):
--   Anna:  3 developer         (of her 4 L3+)
--   Rami:  2 developer         (of his 4)
--   Fouad: 2 design_consultant (of his 4)
INSERT INTO targets (
    metric, level_code, level_at_or_above, entity_type, activity_type,
    owner_id, period_type, period_start, target_value, is_derived
)
SELECT 'advancement', 'L3', true, v.entity_type, NULL,
       p.id, 'year'::period_type_t, '2026-01-01'::date, v.target_value, false
  FROM (VALUES
      ('Anna Mironova',  'developer',         3),
      ('Rami Judeah',    'developer',         2),
      ('Fouad Ahmed',    'design_consultant', 2)
  ) AS v(name, entity_type, target_value)
  JOIN profiles p ON p.full_name = v.name AND p.is_active = true
ON CONFLICT ON CONSTRAINT targets_scope_unique DO NOTHING;
