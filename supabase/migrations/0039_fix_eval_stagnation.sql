-- 0039_fix_eval_stagnation.sql
-- Hotfix: eval_stagnation() in 0038 referenced a `company_id` column on
-- notifications, but the actual column is `related_company_id`. The
-- INSERT … RETURNING clause errored at runtime ("column company_id
-- does not exist") and the function aborted before any rows were
-- written.
--
-- Recreate eval_stagnation() with the correct RETURNING clauses. The
-- rest of the body is unchanged from 0038.

CREATE OR REPLACE FUNCTION eval_stagnation()
RETURNS TABLE(warnings_fired int, breaches_fired int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_warnings int := 0;
    v_breaches int := 0;
    v_today date := current_date;
BEGIN
    IF auth.uid() IS NOT NULL AND auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Admin only.';
    END IF;

    WITH candidate AS (
        SELECT
            c.id            AS company_id,
            c.canonical_name,
            c.owner_id,
            c.current_level,
            COALESCE(c.level_changed_at, c.created_at) AS since_at,
            r.max_days_in_level,
            r.warn_at_pct,
            r.escalate_at_pct,
            r.escalation_role,
            (v_today - COALESCE(c.level_changed_at, c.created_at)::date) AS days_in_level
          FROM companies c
          JOIN stagnation_rules r ON r.level = c.current_level AND r.is_active = true
         WHERE c.is_active = true
           AND c.is_in_kpi_universe = true
           AND c.owner_id IS NOT NULL
    ),
    breach_targets AS (
        SELECT *
          FROM candidate
         WHERE days_in_level >= max_days_in_level
           AND NOT EXISTS (
                SELECT 1 FROM notifications n
                 WHERE n.related_company_id = candidate.company_id
                   AND n.notification_type = 'stagnation_breach'
                   AND n.created_at >= candidate.since_at
           )
    ),
    inserted_breach AS (
        INSERT INTO notifications (
            recipient_id, notification_type, subject, body, link_url,
            channels, related_company_id
        )
        SELECT
            t.recipient_id,
            'stagnation_breach'::notification_type_t,
            format('Stagnation breach: %s at %s for %s days',
                   bt.canonical_name, bt.current_level, bt.days_in_level),
            format(
                'Company %s has been at %s for %s days (threshold %s). Owner: %s. Escalation role: %s.',
                bt.canonical_name, bt.current_level, bt.days_in_level,
                bt.max_days_in_level,
                COALESCE(owner_p.full_name, '(unassigned)'),
                bt.escalation_role
            ),
            '/companies/' || bt.company_id::text,
            ARRAY['in_app']::text[],
            bt.company_id
          FROM breach_targets bt
          LEFT JOIN profiles owner_p ON owner_p.id = bt.owner_id
          CROSS JOIN LATERAL (
            SELECT bt.owner_id AS recipient_id
            UNION
            SELECT p.id
              FROM profiles p
             WHERE p.is_active = true
               AND p.role::text = bt.escalation_role::text
          ) t
         WHERE t.recipient_id IS NOT NULL
        RETURNING related_company_id
    )
    SELECT COUNT(DISTINCT related_company_id) INTO v_breaches FROM inserted_breach;

    WITH candidate AS (
        SELECT
            c.id            AS company_id,
            c.canonical_name,
            c.owner_id,
            c.current_level,
            COALESCE(c.level_changed_at, c.created_at) AS since_at,
            r.max_days_in_level,
            r.warn_at_pct,
            (v_today - COALESCE(c.level_changed_at, c.created_at)::date) AS days_in_level
          FROM companies c
          JOIN stagnation_rules r ON r.level = c.current_level AND r.is_active = true
         WHERE c.is_active = true
           AND c.is_in_kpi_universe = true
           AND c.owner_id IS NOT NULL
    ),
    warn_targets AS (
        SELECT *
          FROM candidate
         WHERE days_in_level >= (max_days_in_level * warn_at_pct) / 100
           AND days_in_level < max_days_in_level
           AND NOT EXISTS (
                SELECT 1 FROM notifications n
                 WHERE n.related_company_id = candidate.company_id
                   AND n.notification_type IN (
                        'stagnation_warning'::notification_type_t,
                        'stagnation_breach'::notification_type_t
                   )
                   AND n.created_at >= candidate.since_at
           )
    ),
    inserted_warn AS (
        INSERT INTO notifications (
            recipient_id, notification_type, subject, body, link_url,
            channels, related_company_id
        )
        SELECT
            wt.owner_id,
            'stagnation_warning'::notification_type_t,
            format('Stagnation warning: %s at %s for %s days',
                   wt.canonical_name, wt.current_level, wt.days_in_level),
            format(
                'Company %s has been at %s for %s days (warning threshold %s; breach at %s).',
                wt.canonical_name, wt.current_level, wt.days_in_level,
                (wt.max_days_in_level * wt.warn_at_pct) / 100,
                wt.max_days_in_level
            ),
            '/companies/' || wt.company_id::text,
            ARRAY['in_app']::text[],
            wt.company_id
          FROM warn_targets wt
        RETURNING related_company_id
    )
    SELECT COUNT(*) INTO v_warnings FROM inserted_warn;

    warnings_fired := v_warnings;
    breaches_fired := v_breaches;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION eval_stagnation() TO authenticated;
