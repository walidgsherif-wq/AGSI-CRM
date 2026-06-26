-- 0076_unclaim_company.sql
-- Inverse of claim_company (0071). Lets the current owner — or any
-- admin/bd_head — release a stakeholder back to unclaimed, with an
-- intentionality safeguard (required reason) and full notification +
-- audit trail.
--
-- What this does NOT touch:
--   - engagements / contacts / notes / documents (they don't reference
--     owner_id; releasing leaves the work intact)
--   - companies.current_level / level_changed_at / level_history (level
--     mutation goes through change_company_level only)
--   - companies.is_key_stakeholder / is_active / source / anything else
--
-- Mirrors the claim_company pattern from 0071:
--   SECURITY DEFINER + SET search_path = public, role gate via
--   auth_role(), FOR UPDATE lock, single guarded UPDATE serving as the
--   race guard, one audit_events row, GRANT EXECUTE TO authenticated.

-- ---------------------------------------------------------------------------
-- 1) New notification_type enum value. IF NOT EXISTS so re-runs are safe;
--    plpgsql function bodies are lazy-parsed so the literal below resolves
--    fine within the same migration (mirrors the 0051 pattern).
-- ---------------------------------------------------------------------------

ALTER TYPE notification_type_t ADD VALUE IF NOT EXISTS 'company_unclaimed';

-- ---------------------------------------------------------------------------
-- 2) unclaim_company(p_company_id, p_reason)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.unclaim_company(
    p_company_id uuid,
    p_reason     text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_caller_role  role_t;
    v_prior_owner  uuid;
    v_company_name text;
    v_actor_name   text;
    v_reason       text;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    v_caller_role := auth_role();
    IF v_caller_role IS NULL
       OR v_caller_role NOT IN ('admin','bd_head','bd_manager') THEN
        RAISE EXCEPTION 'Your role cannot release companies.';
    END IF;

    v_reason := btrim(coalesce(p_reason, ''));
    IF v_reason = '' THEN
        RAISE EXCEPTION 'A reason is required to release a stakeholder.';
    END IF;

    SELECT owner_id, canonical_name
      INTO v_prior_owner, v_company_name
      FROM companies
     WHERE id = p_company_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company % not found.', p_company_id;
    END IF;

    IF v_prior_owner IS NULL THEN
        RAISE EXCEPTION 'Company is not currently claimed.';
    END IF;

    -- Authorisation: current owner OR admin/bd_head.
    IF v_caller_role NOT IN ('admin','bd_head')
       AND v_prior_owner <> v_caller_id THEN
        RAISE EXCEPTION 'You can only release a stakeholder you own.';
    END IF;

    -- Atomic release. Re-asserts owner_id IS NOT NULL in the WHERE clause
    -- so a race with a concurrent transfer/unclaim still surfaces as a
    -- clean "not currently claimed" error.
    UPDATE companies
       SET owner_id          = NULL,
           owner_assigned_at = NULL
     WHERE id        = p_company_id
       AND owner_id IS NOT NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company is not currently claimed.';
    END IF;

    -- Audit. Capture prior owner + reason; the standard
    --   actor_id / event_type / entity_type / entity_id /
    --   before_json / after_json
    -- shape from 0028/0071.
    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id,
        before_json, after_json
    ) VALUES (
        v_caller_id,
        'company_unclaimed',
        'company',
        p_company_id,
        jsonb_build_object('owner_id', v_prior_owner),
        jsonb_build_object(
            'owner_id', NULL,
            'reason', v_reason,
            'released_by_role', v_caller_role
        )
    );

    -- Notify oversight roles (admin + bd_head), but never the actor.
    SELECT full_name INTO v_actor_name
      FROM profiles WHERE id = v_caller_id;

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_company_id
    )
    SELECT
        p.id,
        'company_unclaimed'::notification_type_t,
        format('Released: %s', coalesce(v_company_name, '(unnamed)')),
        format(
            '%s released this stakeholder back to unclaimed. Reason: %s',
            coalesce(v_actor_name, 'Someone'),
            v_reason
        ),
        '/companies/' || p_company_id::text,
        p_company_id
      FROM profiles p
     WHERE p.is_active = true
       AND p.role IN ('admin','bd_head')
       AND p.id <> v_caller_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unclaim_company(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.unclaim_company(uuid, text) IS
    'Release a stakeholder back to unclaimed. SECURITY DEFINER; '
    'authorised for the current owner OR admin/bd_head; requires a '
    'non-empty reason. Writes audit_events row (event_type = '
    '''company_unclaimed'') and notifies admin/bd_head (except the '
    'actor). Does not touch engagements, contacts, notes, or '
    'current_level — ownership only.';
