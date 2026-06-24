-- 0071_claim_company.sql
-- Self-serve company claim. After the pipeline reset most companies
-- will be owner_id IS NULL at L0; BD members need to assign themselves
-- to the ones they actually work, without going through an admin.
--
-- bd_manager RLS (companies_update_manager_own, 0022:52-55) pins
-- USING + WITH CHECK to owner_id = auth.uid(), which by definition
-- forbids claiming an unowned row from a non-owner. We do NOT widen
-- that policy. The claim path runs in a SECURITY DEFINER function
-- that bypasses RLS and applies its own gate:
--   - leadership rejected
--   - any other authenticated app role allowed
--   - target must currently be unowned (atomic single UPDATE serves
--     as the race guard — the loser sees 0 rows and gets a clean
--     "already owned" error)
--
-- Mirrors the transfer_company_ownership pattern from 0028:
--   SECURITY DEFINER + SET search_path = public, auth_role() gate,
--   FOR UPDATE lock, one audit_events row, GRANT EXECUTE TO
--   authenticated.

CREATE OR REPLACE FUNCTION public.claim_company(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_caller_role  role_t;
    v_prior_owner  uuid;
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

    -- Lock the row so two simultaneous claims serialise; the second
    -- one sees the row already owned and the WHERE clause filters it
    -- out → 0 rows → clean error below.
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

    UPDATE companies
       SET owner_id           = v_caller_id,
           owner_assigned_at  = v_now
     WHERE id        = p_company_id
       AND owner_id IS NULL;
    -- Belt-and-braces — the FOR UPDATE above already serialised, but
    -- repeating the IS NULL predicate in the UPDATE WHERE means the
    -- function is still safe if someone calls it outside a fresh
    -- transaction.

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
            'claimed_by_role', v_caller_role
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_company(uuid) TO authenticated;

COMMENT ON FUNCTION public.claim_company(uuid) IS
    'Self-serve company claim. Sets owner_id = caller atomically when '
    'the row is currently unowned. SECURITY DEFINER bypasses the '
    'bd_manager UPDATE RLS that would otherwise pin owner_id = self. '
    'Rejects leadership and any role outside admin/bd_head/bd_manager. '
    'One audit_events row per successful claim (event_type = '
    '''company_claimed'').';
