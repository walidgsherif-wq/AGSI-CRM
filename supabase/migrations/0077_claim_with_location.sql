-- 0077_claim_with_location.sql
-- Enforce completeness at claim time: a stakeholder cannot be claimed
-- without an emirate so it appears on the map immediately and the BD
-- team can be progressed against it.
--
-- Changes the public.claim_company signature from
--   claim_company(p_company_id uuid)
-- to
--   claim_company(p_company_id uuid, p_location_id uuid)
--
-- The old single-arg version is dropped — callers must pass an emirate.
-- The progression gate ("must also have ≥1 live contact before raising
-- a level-change request") lives in src/server/actions/level.ts so
-- it can produce a clean UI error before any RPC hop.
--
-- Idempotent: DROP + CREATE OR REPLACE.

-- Old single-arg version → removed. CASCADE not used so the migration
-- fails loudly if anything still references it (caller bug, not a
-- migration concern).
DROP FUNCTION IF EXISTS public.claim_company(uuid);

CREATE OR REPLACE FUNCTION public.claim_company(
    p_company_id  uuid,
    p_location_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_caller_role  role_t;
    v_prior_owner  uuid;
    v_location_ok  boolean;
    v_now          timestamptz := now();
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    v_caller_role := auth_role();
    IF v_caller_role IS NULL
       OR v_caller_role NOT IN ('admin','bd_head','bd_manager') THEN
        RAISE EXCEPTION 'Your role cannot claim companies.';
    END IF;

    -- Completeness gate: no claim without an emirate.
    IF p_location_id IS NULL THEN
        RAISE EXCEPTION 'Select an emirate to claim this stakeholder.';
    END IF;

    -- Validate the location_id references a live city_lookup row.
    SELECT EXISTS (
        SELECT 1 FROM city_lookup
         WHERE id = p_location_id AND is_active = true
    ) INTO v_location_ok;
    IF NOT v_location_ok THEN
        RAISE EXCEPTION 'That emirate is no longer available.';
    END IF;

    -- Lock the row so two simultaneous claims serialise.
    SELECT owner_id INTO v_prior_owner
      FROM companies
     WHERE id = p_company_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company % not found.', p_company_id;
    END IF;
    IF v_prior_owner IS NOT NULL THEN
        RAISE EXCEPTION 'Company is already owned.';
    END IF;

    -- Atomic claim. Re-asserts owner_id IS NULL so a race with a
    -- concurrent claim/transfer still surfaces as a clean error.
    UPDATE companies
       SET owner_id          = v_caller_id,
           owner_assigned_at = v_now,
           location_id       = p_location_id
     WHERE id        = p_company_id
       AND owner_id IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company is already owned.';
    END IF;

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id,
        before_json, after_json
    ) VALUES (
        v_caller_id,
        'company_claimed',
        'company',
        p_company_id,
        jsonb_build_object('owner_id', NULL),
        jsonb_build_object(
            'owner_id', v_caller_id,
            'owner_assigned_at', v_now,
            'location_id', p_location_id,
            'claimed_by_role', v_caller_role
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_company(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.claim_company(uuid, uuid) IS
    'Self-serve company claim. Sets owner_id = caller and location_id '
    'atomically when the row is currently unowned. SECURITY DEFINER '
    'bypasses the bd_manager UPDATE RLS that would otherwise pin '
    'owner_id = self. Rejects leadership and any role outside '
    'admin/bd_head/bd_manager. Requires p_location_id to be a live '
    'city_lookup row. Audit row: event_type = ''company_claimed''.';
