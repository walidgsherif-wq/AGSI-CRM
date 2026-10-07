-- 0110_add_reports_scorecard_feature.sql
-- Phase 1a (dashboard restructure): seed the `reports_scorecard`
-- feature key in the DB registry so it mirrors the entry added to
-- src/lib/auth/features.ts in the same commit.
--
-- Why this migration exists even though the TS route guard already
-- falls back to code defaults when the DB row is missing
-- (src/lib/auth/features.ts:getFeatureAccess — no `features` table
-- read on the fallback path, so runtime access works regardless):
--
--   1. The DB-side has_feature(p_feature) in 0047:117-139 COALESCEs
--      the role-default subselect to `false` when the key is absent
--      from `features`. No RLS policy currently references
--      has_feature('reports_scorecard'), so this is dormant, but
--      any future RLS added for the Driver scorecard would silently
--      fail-closed without this seed row.
--
--   2. set_feature_access_with_audit() (0047:147-186) raises
--      'Unknown feature key: %' when it can't find the row. That
--      blocks the admin UI from ever granting or revoking the
--      scorecard key for a specific user without this seed.
--
--   3. The FEATURES const in src/lib/auth/features.ts carries a
--      comment saying "this list must stay in sync with the seed".
--      Shipping the TS key without the seed drifts the two.
--
-- Values match the TS FeatureDef entry byte-for-byte. sort_order 45
-- slots between reports (40) and pipeline (50), reflecting the
-- Reports grouping without displacing the Pipeline nav rank.
--
-- Pure data row — no DDL, no RLS change, no function change.
-- Idempotent via ON CONFLICT (key) DO UPDATE, matching 0047:62-66.

INSERT INTO features (key, label, description, default_roles, sort_order) VALUES
    ('reports_scorecard',
     'Driver scorecard',
     'The /reports/scorecard sub-route — per-member Driver A–D vs target cards (relocated from the dashboard in Phase 1a). Separate from `reports` because that gate currently excludes bd_manager to protect snapshotted BEI in leadership reports; the scorecard needs to stay reachable to bd_managers so they can see their own driver progress.',
     ARRAY['admin','leadership','bd_head','bd_manager']::role_t[], 45)
ON CONFLICT (key) DO UPDATE SET
    label         = EXCLUDED.label,
    description   = EXCLUDED.description,
    default_roles = EXCLUDED.default_roles,
    sort_order    = EXCLUDED.sort_order;
