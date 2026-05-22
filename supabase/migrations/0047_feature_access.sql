-- 0047_feature_access.sql
-- v1.1 — per-user feature access overrides on top of the four fixed
-- roles. Lets an admin grant or revoke specific features for an
-- individual person from /admin/users without inventing new roles.
--
-- Model:
--   features        — registry of gateable features + their default
--                     role set (mirrors the hard-coded role gating that
--                     existed before this migration, so applying it
--                     changes NOTHING until an override is set).
--   feature_access  — per-user overrides. A row means "for this user,
--                     this feature is explicitly allowed/denied",
--                     winning over the role default.
--
-- Effective access (non-admin):
--   override.allowed              if a feature_access row exists
--   else role = ANY(default_roles)
--
-- Admins ALWAYS pass (super-user; can't lock themselves out). This is
-- baked into has_feature() so /admin/* and every gated surface stay
-- reachable for admins regardless of overrides.
--
-- Enforcement layers (all three):
--   route   — requireFeature() in src/lib/auth/features.ts
--   nav     — Sidebar filters links by the effective set
--   data    — RLS SELECT policies below call has_feature()

-- =====================================================================
-- 1) features registry
-- =====================================================================

CREATE TABLE features (
    key           text       PRIMARY KEY,
    label         text       NOT NULL,
    description   text       NOT NULL DEFAULT '',
    default_roles role_t[]   NOT NULL,
    sort_order    int        NOT NULL DEFAULT 0
);

COMMENT ON TABLE features IS
    'Registry of gateable app features. default_roles encodes the pre-override role gating.';

INSERT INTO features (key, label, description, default_roles, sort_order) VALUES
    ('insights',           'Market insights',
     'The /insights market dashboard (BNC snapshot metrics).',
     ARRAY['admin','leadership','bd_head','bd_manager']::role_t[], 10),
    ('insights_maps',      'Insight maps',
     'Geographic / level-distribution / engagement-freshness maps.',
     ARRAY['admin','leadership','bd_head']::role_t[], 20),
    ('insights_ecosystem', 'Ecosystem awareness',
     'The ecosystem awareness engine views + event scoring.',
     ARRAY['admin','leadership','bd_head']::role_t[], 30),
    ('reports',            'Leadership reports',
     'Finalised/archived leadership reports + PDF download.',
     ARRAY['admin','leadership','bd_head']::role_t[], 40),
    ('pipeline',           'Pipeline board',
     'The /pipeline kanban of accounts by level.',
     ARRAY['admin','bd_head','bd_manager']::role_t[], 50),
    ('tasks',              'Tasks',
     'The /tasks list + task management.',
     ARRAY['admin','bd_head','bd_manager']::role_t[], 60);

ALTER TABLE features ENABLE ROW LEVEL SECURITY;

-- Registry is readable by any authenticated user (needed to compute
-- defaults app-side); only admin may change it.
CREATE POLICY features_select_all
    ON features FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY features_write_admin
    ON features FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

-- =====================================================================
-- 2) feature_access overrides
-- =====================================================================

CREATE TABLE feature_access (
    user_id      uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    feature_key  text        NOT NULL REFERENCES features(key) ON DELETE CASCADE,
    allowed      boolean     NOT NULL,
    updated_by   uuid        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, feature_key)
);

CREATE INDEX feature_access_user_idx ON feature_access (user_id);

ALTER TABLE feature_access ENABLE ROW LEVEL SECURITY;

-- A user can read their own overrides (so the app can compute their
-- effective access without elevated privileges). Admin can read all.
CREATE POLICY feature_access_select_self_or_admin
    ON feature_access FOR SELECT
    USING (user_id = auth.uid() OR auth_role() = 'admin');

-- Writes go through SECURITY DEFINER fns below (for audit), but we also
-- allow admin direct write for completeness / migrations.
CREATE POLICY feature_access_write_admin
    ON feature_access FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

-- =====================================================================
-- 3) has_feature() — the single source of truth for effective access
-- =====================================================================

CREATE OR REPLACE FUNCTION has_feature(p_feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        -- Admins always pass.
        public.auth_role() = 'admin'
        OR COALESCE(
            -- Explicit per-user override wins.
            (SELECT fa.allowed
               FROM feature_access fa
              WHERE fa.user_id = auth.uid()
                AND fa.feature_key = p_feature),
            -- Else the role default from the registry.
            (SELECT public.auth_role() = ANY(f.default_roles)
               FROM features f
              WHERE f.key = p_feature),
            false
        );
$$;

GRANT EXECUTE ON FUNCTION has_feature(text) TO authenticated;

-- =====================================================================
-- 4) audit-logged set / clear
-- =====================================================================

CREATE OR REPLACE FUNCTION set_feature_access_with_audit(
    p_user_id uuid,
    p_feature text,
    p_allowed boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before boolean;
BEGIN
    IF auth.uid() IS NULL OR auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM features WHERE key = p_feature) THEN
        RAISE EXCEPTION 'Unknown feature key: %', p_feature;
    END IF;

    SELECT allowed INTO v_before
      FROM feature_access
     WHERE user_id = p_user_id AND feature_key = p_feature
     FOR UPDATE;

    INSERT INTO feature_access (user_id, feature_key, allowed, updated_by, updated_at)
    VALUES (p_user_id, p_feature, p_allowed, auth.uid(), now())
    ON CONFLICT (user_id, feature_key)
    DO UPDATE SET allowed = EXCLUDED.allowed,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = EXCLUDED.updated_at;

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id, before_json, after_json
    ) VALUES (
        auth.uid(), 'feature_access_change', 'feature_access', p_user_id,
        jsonb_build_object('feature', p_feature, 'allowed', v_before),
        jsonb_build_object('feature', p_feature, 'allowed', p_allowed)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION set_feature_access_with_audit(uuid, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION clear_feature_access_with_audit(
    p_user_id uuid,
    p_feature text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before boolean;
BEGIN
    IF auth.uid() IS NULL OR auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    SELECT allowed INTO v_before
      FROM feature_access
     WHERE user_id = p_user_id AND feature_key = p_feature
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN; -- nothing to clear; revert-to-default is a no-op
    END IF;

    DELETE FROM feature_access
     WHERE user_id = p_user_id AND feature_key = p_feature;

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id, before_json, after_json
    ) VALUES (
        auth.uid(), 'feature_access_change', 'feature_access', p_user_id,
        jsonb_build_object('feature', p_feature, 'allowed', v_before),
        jsonb_build_object('feature', p_feature, 'allowed', null, 'cleared', true)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION clear_feature_access_with_audit(uuid, text) TO authenticated;

-- =====================================================================
-- 5) Re-wire existing SELECT policies through has_feature().
--    Default role sets are identical to the prior hard-coded checks,
--    so behaviour is unchanged until an override is set. Admin bypass
--    is inside has_feature(), so the admin-only policies are untouched.
-- =====================================================================

-- insights → market_snapshots
DROP POLICY IF EXISTS market_snapshots_select_all ON market_snapshots;
CREATE POLICY market_snapshots_select_feature
    ON market_snapshots FOR SELECT
    USING (auth.uid() IS NOT NULL AND public.has_feature('insights'));

-- insights_ecosystem → ecosystem_events / point_scale / awareness_current
DROP POLICY IF EXISTS ecosystem_events_select_non_manager ON ecosystem_events;
CREATE POLICY ecosystem_events_select_feature
    ON ecosystem_events FOR SELECT
    USING (public.has_feature('insights_ecosystem'));

DROP POLICY IF EXISTS ecosystem_point_scale_select_non_manager ON ecosystem_point_scale;
CREATE POLICY ecosystem_point_scale_select_feature
    ON ecosystem_point_scale FOR SELECT
    USING (public.has_feature('insights_ecosystem'));

DROP POLICY IF EXISTS ecosystem_awareness_current_select_non_manager ON ecosystem_awareness_current;
CREATE POLICY ecosystem_awareness_current_select_feature
    ON ecosystem_awareness_current FOR SELECT
    USING (public.has_feature('insights_ecosystem'));

-- reports → leadership_reports (non-admin path) + stakeholders
DROP POLICY IF EXISTS leadership_reports_select_leadership_and_head ON leadership_reports;
CREATE POLICY leadership_reports_select_leadership_and_head
    ON leadership_reports FOR SELECT
    USING (
        auth_role() IN ('leadership','bd_head')
        AND public.has_feature('reports')
        AND status IN ('finalised','archived')
    );

DROP POLICY IF EXISTS leadership_report_stakeholders_select ON leadership_report_stakeholders;
CREATE POLICY leadership_report_stakeholders_select
    ON leadership_report_stakeholders FOR SELECT
    USING (
        auth_role() = 'admin'
        OR (auth_role() IN ('bd_head','leadership') AND public.has_feature('reports'))
    );

-- tasks → tasks (non-admin path keeps the ops-role baseline)
DROP POLICY IF EXISTS tasks_select_ops ON tasks;
CREATE POLICY tasks_select_ops
    ON tasks FOR SELECT
    USING (
        auth_role() = 'admin'
        OR (auth_role() IN ('bd_head','bd_manager') AND public.has_feature('tasks'))
    );
