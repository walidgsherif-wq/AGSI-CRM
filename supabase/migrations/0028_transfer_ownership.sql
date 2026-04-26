-- 0028_transfer_ownership.sql
-- M7 — implements §16 D-8 ownership transfer with credit-history reattribution.
-- Admin-only RPC. Updates companies.owner_id + owner_assigned_at; optionally
-- rewrites level_history.owner_at_time so KPI scoring re-attributes to the
-- new owner on the next nightly KPI rebuild.
--
-- Returns: number of level_history rows whose owner_at_time was changed.

CREATE OR REPLACE FUNCTION transfer_company_ownership(
    p_company_id        uuid,
    p_new_owner_id      uuid,
    p_transfer_credit   boolean DEFAULT true
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_role role_t;
    v_old_owner   uuid;
    v_changed     int := 0;
    v_now         timestamptz := now();
BEGIN
    -- AuthZ: admin only
    v_caller_role := auth_role();
    IF v_caller_role IS NULL OR v_caller_role <> 'admin' THEN
        RAISE EXCEPTION 'Only admins can transfer company ownership.'
            USING HINT = 'auth_role() must be ''admin''.';
    END IF;

    -- Validate new owner
    IF NOT EXISTS (
        SELECT 1 FROM profiles
         WHERE id = p_new_owner_id AND is_active = true
    ) THEN
        RAISE EXCEPTION 'New owner % is not an active profile.', p_new_owner_id;
    END IF;

    -- Lock + read prior owner
    SELECT owner_id INTO v_old_owner
      FROM companies
     WHERE id = p_company_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company % not found.', p_company_id;
    END IF;

    IF v_old_owner IS NOT DISTINCT FROM p_new_owner_id THEN
        RAISE EXCEPTION 'Company % is already owned by %.', p_company_id, p_new_owner_id;
    END IF;

    -- Reattribute history credit if requested
    IF p_transfer_credit THEN
        UPDATE level_history
           SET owner_at_time = p_new_owner_id
         WHERE company_id = p_company_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
    END IF;

    -- Update the company row
    UPDATE companies
       SET owner_id = p_new_owner_id,
           owner_assigned_at = v_now
     WHERE id = p_company_id;

    -- Audit (one row per affected owner; null-safe)
    INSERT INTO audit_events (actor_id, event_type, entity_type, entity_id, before_json, after_json)
    VALUES (
        auth.uid(),
        'ownership_transfer',
        'company',
        p_company_id,
        jsonb_build_object(
            'old_owner_id', v_old_owner,
            'new_owner_id', p_new_owner_id
        ),
        jsonb_build_object(
            'transfer_credit', p_transfer_credit,
            'history_rows_reattributed', v_changed
        )
    );

    -- Notify both owners (in-app)
    IF v_old_owner IS NOT NULL THEN
        INSERT INTO notifications (
            recipient_id, notification_type, subject, body, link_url
        ) VALUES (
            v_old_owner,
            'ownership_transferred'::notification_type_t,
            'Company ownership transferred',
            CASE WHEN p_transfer_credit
                THEN format('%s history rows transferred to the new owner; your scoreboard will refresh on the next nightly rebuild.', v_changed)
                ELSE 'Ownership transferred. Your historical credit was preserved (per-transfer override).'
            END,
            '/companies/' || p_company_id::text
        );
    END IF;

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url
    ) VALUES (
        p_new_owner_id,
        'ownership_transferred'::notification_type_t,
        'You inherited a company',
        CASE WHEN p_transfer_credit
            THEN format('You inherited %s historical credits with this company.', v_changed)
            ELSE 'You now own this company. Historical credit was retained by the prior owner.'
        END,
        '/companies/' || p_company_id::text
    );

    RETURN v_changed;
END;
$$;

GRANT EXECUTE ON FUNCTION transfer_company_ownership(uuid, uuid, boolean) TO authenticated;

COMMENT ON FUNCTION transfer_company_ownership(uuid, uuid, boolean) IS
    'Admin-only ownership transfer with optional credit-history reattribution. §16 D-8.';
