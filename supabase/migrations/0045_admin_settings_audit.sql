-- 0045_admin_settings_audit.sql
-- Admin-settings UI helpers. Three SECURITY DEFINER fns that update
-- the source-of-truth tables and simultaneously write a row to
-- audit_events. Per §3.14, every config change should be auditable.
--
-- Each fn:
--   - asserts auth_role() = 'admin'
--   - reads the current value (before)
--   - updates the row
--   - inserts the audit_events entry with before_json + after_json
--
-- These wrap simple writes the admin client could do on its own
-- (RLS already permits admin write on these tables) — the wrapper
-- exists purely to attach audit metadata in one transaction.

-- =====================================================================
-- 1) update_app_setting_with_audit
-- =====================================================================

CREATE OR REPLACE FUNCTION update_app_setting_with_audit(
    p_key text,
    p_value_json jsonb
) RETURNS void
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

    SELECT value_json INTO v_before
      FROM app_settings WHERE key = p_key
      FOR UPDATE;

    IF v_before IS NULL THEN
        INSERT INTO app_settings (key, value_json, updated_by, updated_at)
        VALUES (p_key, p_value_json, auth.uid(), now());
    ELSE
        UPDATE app_settings
           SET value_json = p_value_json,
               updated_by = auth.uid(),
               updated_at = now()
         WHERE key = p_key;
    END IF;

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id, before_json, after_json
    ) VALUES (
        auth.uid(),
        'app_setting_change',
        'app_setting',
        NULL,
        jsonb_build_object('key', p_key, 'value', v_before),
        jsonb_build_object('key', p_key, 'value', p_value_json)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION update_app_setting_with_audit(text, jsonb) TO authenticated;


-- =====================================================================
-- 2) update_stagnation_rule_with_audit
-- =====================================================================

CREATE OR REPLACE FUNCTION update_stagnation_rule_with_audit(
    p_level             level_t,
    p_max_days          int,
    p_warn_at_pct       int,
    p_escalate_at_pct   int,
    p_escalation_role   stagnation_escalation_role_t,
    p_is_active         boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before stagnation_rules%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL OR auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    SELECT * INTO v_before FROM stagnation_rules WHERE level = p_level FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No stagnation_rules row for level %', p_level;
    END IF;

    UPDATE stagnation_rules
       SET max_days_in_level = p_max_days,
           warn_at_pct       = p_warn_at_pct,
           escalate_at_pct   = p_escalate_at_pct,
           escalation_role   = p_escalation_role,
           is_active         = p_is_active,
           updated_at        = now()
     WHERE level = p_level;

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id, before_json, after_json
    ) VALUES (
        auth.uid(),
        'stagnation_rule_change',
        'stagnation_rule',
        v_before.id,
        to_jsonb(v_before),
        jsonb_build_object(
            'level', p_level,
            'max_days_in_level', p_max_days,
            'warn_at_pct', p_warn_at_pct,
            'escalate_at_pct', p_escalate_at_pct,
            'escalation_role', p_escalation_role,
            'is_active', p_is_active
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION update_stagnation_rule_with_audit(
    level_t, int, int, int, stagnation_escalation_role_t, boolean
) TO authenticated;


-- =====================================================================
-- 3) update_ecosystem_point_with_audit
-- =====================================================================

CREATE OR REPLACE FUNCTION update_ecosystem_point_with_audit(
    p_event_category text,
    p_event_subtype  text,
    p_points_current numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before ecosystem_point_scale%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL OR auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    SELECT * INTO v_before FROM ecosystem_point_scale
     WHERE event_category = p_event_category
       AND event_subtype  = p_event_subtype
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No ecosystem_point_scale row for (%, %)',
            p_event_category, p_event_subtype;
    END IF;

    UPDATE ecosystem_point_scale
       SET points_current = p_points_current,
           last_edited_by = auth.uid(),
           last_edited_at = now()
     WHERE event_category = p_event_category
       AND event_subtype  = p_event_subtype;

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id, before_json, after_json
    ) VALUES (
        auth.uid(),
        'ecosystem_point_change',
        'ecosystem_point_scale',
        v_before.id,
        jsonb_build_object(
            'event_category', p_event_category,
            'event_subtype',  p_event_subtype,
            'points_current', v_before.points_current
        ),
        jsonb_build_object(
            'event_category', p_event_category,
            'event_subtype',  p_event_subtype,
            'points_current', p_points_current
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION update_ecosystem_point_with_audit(text, text, numeric)
    TO authenticated;
