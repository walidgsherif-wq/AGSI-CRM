-- 0112_revise_target_baseline.sql
-- Phase 1b-i correction. Data only — no schema changes.
--
-- 0111's seeded targets assumed the 113 initial_backfill rows in
-- level_history represented pre-existing relationships that should
-- not count as this year's work. That was wrong — those relationships
-- were built during H1 2026. They are this year's work, which makes
-- the 0111 baseline too low. Decision + reasoning: spec §15 item 3
-- and §19.9; computation consequences for Phase 1b-ii logged there.
--
-- Structural consequence this migration also captures:
-- level_history.changed_at records when a row was ENTERED, not when
-- the relationship was built — all 113 initial_backfill rows landed
-- on 2026-07-01, 2026-08-03 and 2026-08-05. Credited quarterly,
-- Anna's year reads 0 / 0 / 9 / 0, which is a record of her
-- data-entry week rather than her year. So for FY2026 ONLY, the
-- Advance (→L3+) target becomes annual instead of quarterly. From
-- FY2027 it reverts to quarterly — metric_definitions still carries
-- cadence='quarter' on 'Advance' (unchanged); this is a one-year
-- target-cadence exception, not a cadence change.
--
-- Six operations, data only:
--   1. funnel_assumptions ratios: 6:3:1 chain → 3:2:1 chain.
--      L1→L2  0.500 → 0.667
--      L2→L3  0.333 → 0.500
--   2. Qualify (advancement/L2/quarter): 3 → 4 on all 12 rows.
--   3. Advance (advancement/L3+): DELETE 12 quarterly, INSERT 3
--      annual (one per bd_manager, period_start 2026-01-01,
--      target_value 8).
--   4. Coverage (coverage/L3+/year): Anna 13→17, Rami 9→13,
--      Fouad 14→18.
--   5. Focus areas (advancement/L3+/entity_type/year):
--        Anna developer           3 → 6
--        Rami developer           2 → 4
--        Fouad design_consultant  2 → 4
--
-- Expected row count after this migration: 93.
--   Open monthly        36  (unchanged)
--   Qualify quarterly   12  (values updated)
--   Advance annual       3  (replaces 12 quarterly)
--   Engagements monthly 36  (unchanged)
--   Coverage annual      3  (values updated)
--   Focus-area annual    3  (values updated)
--                       ──
--                       93
--
-- Unchanged:
--   - metric_definitions (all 5 rows, including Advance cadence
--     'quarter' — the FY2026 annual target is deliberate; cadence
--     stays quarterly for FY2027+).
--   - Open (advancement/L1/month, 2 per month).
--   - Engagements (engagement/month, 6 per month).
--
-- Not routed through upsert_target_with_audit / upsert_funnel_assumption_with_audit:
-- migrations run as the migration role (not an authenticated admin
-- session), so the RPCs' `IF auth.uid() IS NULL OR auth_role() <> 'admin'`
-- guard would fire. Direct UPDATE/DELETE/INSERT bypasses the audit
-- trail by design — same trade-off every migration takes against
-- audit_events. Future admin UI edits still go through the RPCs.

-- =====================================================================
-- 1) funnel_assumptions — 6:3:1 chain becomes 3:2:1 chain
-- =====================================================================

UPDATE funnel_assumptions
   SET ratio = 0.667,
       updated_at = now()
 WHERE from_level = 'L1'
   AND to_level   = 'L2'
   AND owner_id IS NULL;

UPDATE funnel_assumptions
   SET ratio = 0.500,
       updated_at = now()
 WHERE from_level = 'L2'
   AND to_level   = 'L3'
   AND owner_id IS NULL;

-- =====================================================================
-- 2) targets · Qualify (advancement / L2 / quarter): 3 → 4
-- =====================================================================

UPDATE targets
   SET target_value = 4,
       updated_at   = now()
 WHERE metric            = 'advancement'
   AND level_code        = 'L2'
   AND level_at_or_above = false
   AND entity_type   IS NULL
   AND activity_type IS NULL
   AND period_type       = 'quarter';

-- =====================================================================
-- 3) targets · Advance (advancement / L3+): swap quarterly → annual
--
--    DELETE the 12 quarterly rows seeded in 0111, then INSERT 3
--    annual rows (one per BDM) with target_value 8. ON CONFLICT on
--    the scope-unique constraint keeps the INSERT idempotent on a
--    re-run (updates to the same value if a row already exists).
-- =====================================================================

DELETE FROM targets
 WHERE metric            = 'advancement'
   AND level_code        = 'L3'
   AND level_at_or_above = true
   AND entity_type   IS NULL
   AND activity_type IS NULL
   AND period_type       = 'quarter';

INSERT INTO targets (
    metric, level_code, level_at_or_above, entity_type, activity_type,
    owner_id, period_type, period_start, target_value, is_derived
)
SELECT 'advancement', 'L3', true, NULL, NULL,
       p.id, 'year'::period_type_t, '2026-01-01'::date, 8, false
  FROM profiles p
 WHERE p.full_name IN ('Anna Mironova','Rami Judeah','Fouad Ahmed')
   AND p.is_active = true
ON CONFLICT ON CONSTRAINT targets_scope_unique DO UPDATE
   SET target_value = EXCLUDED.target_value,
       updated_at   = now();

-- =====================================================================
-- 4) targets · Coverage (coverage / L3+ / year): new year-end positions
-- =====================================================================

WITH coverage_updates AS (
    SELECT p.id AS owner_id, v.new_value
      FROM (VALUES
          ('Anna Mironova', 17),
          ('Rami Judeah',   13),
          ('Fouad Ahmed',   18)
      ) AS v(name, new_value)
      JOIN profiles p ON p.full_name = v.name AND p.is_active = true
)
UPDATE targets
   SET target_value = u.new_value,
       updated_at   = now()
  FROM coverage_updates u
 WHERE targets.owner_id          = u.owner_id
   AND targets.metric            = 'coverage'
   AND targets.level_code        = 'L3'
   AND targets.level_at_or_above = true
   AND targets.entity_type   IS NULL
   AND targets.activity_type IS NULL
   AND targets.period_type       = 'year';

-- =====================================================================
-- 5) targets · Focus areas (advancement / L3+ / entity_type / year)
-- =====================================================================

WITH focus_updates AS (
    SELECT p.id AS owner_id, v.entity_type, v.new_value
      FROM (VALUES
          ('Anna Mironova',  'developer',          6),
          ('Rami Judeah',    'developer',          4),
          ('Fouad Ahmed',    'design_consultant',  4)
      ) AS v(name, entity_type, new_value)
      JOIN profiles p ON p.full_name = v.name AND p.is_active = true
)
UPDATE targets
   SET target_value = u.new_value,
       updated_at   = now()
  FROM focus_updates u
 WHERE targets.owner_id          = u.owner_id
   AND targets.metric            = 'advancement'
   AND targets.level_code        = 'L3'
   AND targets.level_at_or_above = true
   AND targets.entity_type       = u.entity_type
   AND targets.activity_type IS NULL
   AND targets.period_type       = 'year';
