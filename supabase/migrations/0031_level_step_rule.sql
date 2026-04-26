-- 0031_level_step_rule.sql
-- M9 polish — enforce single-step level moves. A BD can take a stakeholder
-- L0 → L1 (and back), L1 → L2 (and back), etc., but never skip a level
-- (no L0 → L3, no L1 → L4, etc.). Each step has its own evidence and is
-- meaningful work in its own right.
--
-- Enforced at three layers:
--   1. Helper function level_index(level_t) for clean arithmetic.
--   2. CHECK constraint on level_change_requests.
--   3. Validation inside change_company_level() and
--      approve_level_change_request() so direct admin changes also obey.

CREATE OR REPLACE FUNCTION level_index(p_level level_t)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_level
        WHEN 'L0' THEN 0
        WHEN 'L1' THEN 1
        WHEN 'L2' THEN 2
        WHEN 'L3' THEN 3
        WHEN 'L4' THEN 4
        WHEN 'L5' THEN 5
    END;
$$;

COMMENT ON FUNCTION level_index(level_t) IS
    'Numeric distance helper for level_t. Used by the one-step-only rule.';

-- Block skip-level requests at write time.
ALTER TABLE level_change_requests
    ADD CONSTRAINT level_change_requests_one_step
    CHECK (abs(level_index(to_level) - level_index(from_level)) <= 1);

-- =====================================================================
-- change_company_level — add the one-step guard. Re-create with same
-- signature; everything below the validation is unchanged from 0021.
-- =====================================================================

CREATE OR REPLACE FUNCTION change_company_level(
    p_company_id        uuid,
    p_to_level          level_t,
    p_evidence_note     text DEFAULT NULL,
    p_evidence_file_url text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_from_level        level_t;
    v_company_type      company_type_t;
    v_owner             uuid;
    v_is_forward        boolean;
    v_history_id        uuid;
    v_now               timestamptz := now();
    v_fy                int;
    v_fq                int;
BEGIN
    SELECT current_level, company_type, owner_id
      INTO v_from_level, v_company_type, v_owner
    FROM companies
    WHERE id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company % not found', p_company_id;
    END IF;
    IF v_from_level = p_to_level THEN
        RAISE EXCEPTION 'Company % already at %', p_company_id, p_to_level;
    END IF;

    -- One-step guard
    IF abs(level_index(p_to_level) - level_index(v_from_level)) > 1 THEN
        RAISE EXCEPTION
            'Level changes are limited to one step at a time. % → % skips levels.',
            v_from_level, p_to_level
            USING HINT = 'Make the change in stages: each step needs its own evidence and audit trail.';
    END IF;

    v_is_forward := p_to_level::text > v_from_level::text;
    v_fy := fiscal_year_of(v_now);
    v_fq := fiscal_quarter_of(v_now);

    INSERT INTO level_history (
        company_id, from_level, to_level, changed_by, owner_at_time,
        company_type_at_time, changed_at, fiscal_year, fiscal_quarter,
        evidence_note, evidence_file_url, is_forward, is_credited
    ) VALUES (
        p_company_id, v_from_level, p_to_level, auth.uid(), v_owner,
        v_company_type, v_now, v_fy, v_fq,
        p_evidence_note, p_evidence_file_url, v_is_forward, v_is_forward
    ) RETURNING id INTO v_history_id;

    PERFORM set_config('app.level_change_via_fn', 'on', true);
    UPDATE companies
       SET current_level = p_to_level,
           level_changed_at = v_now
     WHERE id = p_company_id;
    PERFORM set_config('app.level_change_via_fn', 'off', true);

    INSERT INTO audit_events (actor_id, event_type, entity_type, entity_id, before_json, after_json)
    VALUES (
        auth.uid(), 'level_change', 'company', p_company_id,
        jsonb_build_object('level', v_from_level),
        jsonb_build_object('level', p_to_level, 'history_id', v_history_id, 'is_forward', v_is_forward)
    );

    RETURN v_history_id;
END;
$$;

GRANT EXECUTE ON FUNCTION change_company_level(uuid, level_t, text, text) TO authenticated;

-- =====================================================================
-- approve_level_change_request — same one-step guard. The CHECK
-- constraint on the requests table prevents bad rows from existing,
-- but we double-check here too in case a constraint is dropped or
-- bypassed via service-role.
-- =====================================================================

CREATE OR REPLACE FUNCTION approve_level_change_request(
    p_request_id    uuid,
    p_review_note   text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_request       level_change_requests%ROWTYPE;
    v_history_id    uuid;
    v_now           timestamptz := now();
    v_fy            int;
    v_fq            int;
    v_is_forward    boolean;
    v_owner_id      uuid;
    v_company_type  company_type_t;
    v_current_level level_t;
    v_evidence_url  text;
BEGIN
    IF auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admins can approve level change requests.';
    END IF;

    SELECT * INTO v_request
      FROM level_change_requests
     WHERE id = p_request_id AND status = 'pending'
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request % not found or not pending.', p_request_id;
    END IF;

    -- Defence-in-depth check matching the table CHECK constraint
    IF abs(level_index(v_request.to_level) - level_index(v_request.from_level)) > 1 THEN
        RAISE EXCEPTION
            'Request % skips levels (% → %). Reject it and resubmit one step at a time.',
            p_request_id, v_request.from_level, v_request.to_level;
    END IF;

    SELECT current_level, owner_id, company_type
      INTO v_current_level, v_owner_id, v_company_type
      FROM companies
     WHERE id = v_request.company_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company % no longer exists.', v_request.company_id;
    END IF;

    IF v_current_level <> v_request.from_level THEN
        RAISE EXCEPTION
          'Company is now at % (request was from %). Ask the requester to resubmit.',
          v_current_level, v_request.from_level;
    END IF;

    v_is_forward := v_request.to_level::text > v_request.from_level::text;
    v_fy := fiscal_year_of(v_now);
    v_fq := fiscal_quarter_of(v_now);

    v_evidence_url := array_to_string(v_request.evidence_file_paths, ',');
    IF v_evidence_url = '' THEN v_evidence_url := NULL; END IF;

    INSERT INTO level_history (
        company_id, from_level, to_level, changed_by, owner_at_time,
        company_type_at_time, changed_at, fiscal_year, fiscal_quarter,
        evidence_note, evidence_file_url, is_forward, is_credited
    ) VALUES (
        v_request.company_id, v_request.from_level, v_request.to_level,
        v_request.requested_by, v_owner_id, v_company_type,
        v_now, v_fy, v_fq,
        v_request.evidence_note, v_evidence_url,
        v_is_forward, v_is_forward
    ) RETURNING id INTO v_history_id;

    PERFORM set_config('app.level_change_via_fn', 'on', true);
    UPDATE companies
       SET current_level = v_request.to_level,
           level_changed_at = v_now
     WHERE id = v_request.company_id;
    PERFORM set_config('app.level_change_via_fn', 'off', true);

    UPDATE level_change_requests
       SET status = 'approved'::level_request_status_t,
           reviewed_by = auth.uid(),
           reviewed_at = v_now,
           review_note = p_review_note,
           resulting_history_id = v_history_id
     WHERE id = p_request_id;

    INSERT INTO audit_events (actor_id, event_type, entity_type, entity_id, before_json, after_json)
    VALUES (
        auth.uid(), 'level_change_approval', 'level_change_request', p_request_id,
        jsonb_build_object(
            'from', v_request.from_level,
            'to', v_request.to_level,
            'requested_by', v_request.requested_by
        ),
        jsonb_build_object(
            'approved_by', auth.uid(),
            'history_id', v_history_id,
            'review_note', p_review_note
        )
    );

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url, related_company_id
    ) VALUES (
        v_request.requested_by,
        'level_change'::notification_type_t,
        format('Approved: %s → %s', v_request.from_level, v_request.to_level),
        'Your level change request was approved by an admin. Credit posted on today''s ledger.',
        '/companies/' || v_request.company_id::text || '/level-history',
        v_request.company_id
    );

    RETURN v_history_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_level_change_request(uuid, text) TO authenticated;
