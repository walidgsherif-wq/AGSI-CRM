-- 0086_setup_mode_relax_step_rule.sql
-- Correct the CRM setup-mode semantics from 0085.
--
-- 0085 shipped a direct-write RPC (set_initial_level) that let owners
-- bypass admin approval entirely — that's wrong. Approval must still
-- be required for every forward level move. What setup mode should
-- relax is the single-step rule only: during initial backfill, a
-- level-change REQUEST can jump multiple levels at once (L0 → L4)
-- instead of forcing four one-step requests. The request still goes
-- through admin approval, the L2+ completeness gate still applies,
-- and the approved history row is flagged as backfill so it does not
-- credit earned Driver A.
--
-- What this migration does:
--   1) Drops set_initial_level (the direct-write path).
--   2) Adds level_change_requests.is_backfill — stamped by the app
--      when a request is submitted under setup mode; honoured at
--      approve time so the level_history row gets source =
--      'initial_backfill'.
--   3) Replaces the level_change_requests_one_step CHECK constraint
--      with a BEFORE INSERT trigger that CAN consult session state
--      via crm_setup_mode(). Rule: single-step always allowed;
--      multi-level allowed only when setup mode is ON and the move
--      is forward.
--   4) Rewrites approve_level_change_request (verbatim from 0082) so
--      the level_history INSERT sets source based on the request's
--      is_backfill flag. Everything else in the function body —
--      including the notification auto-resolve + Approved notice — is
--      identical to 0082.
--
-- Doesn't touch:
--   - The approval requirement itself (stays for every forward move).
--   - The L2+ completeness gate (still applies inside the app-level
--     server action; unchanged here).
--   - Driver B/C, ecosystem math, merge/grouping.
--   - change_company_level (admin direct-write) — its one-step guard
--     stays; admin direct-corrections remain single-step and always
--     write source = 'progression'. Multi-level backfill goes through
--     the request flow, even for admin.

-- ---------------------------------------------------------------------------
-- 1) Retire the direct-write path
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS set_initial_level(uuid, level_t, text);

-- ---------------------------------------------------------------------------
-- 2) is_backfill marker on requests
-- ---------------------------------------------------------------------------

ALTER TABLE level_change_requests
    ADD COLUMN IF NOT EXISTS is_backfill boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN level_change_requests.is_backfill IS
    'True when the request was raised under crm_setup_mode(). '
    'Approving such a request writes level_history.source = '
    '''initial_backfill'' so it does not credit earned Driver A. '
    'Frozen at INSERT time — flipping setup mode later does not '
    'change already-raised requests.';

-- ---------------------------------------------------------------------------
-- 3) Drop the CHECK constraint, install a trigger that can read state
-- ---------------------------------------------------------------------------

ALTER TABLE level_change_requests
    DROP CONSTRAINT IF EXISTS level_change_requests_one_step;

CREATE OR REPLACE FUNCTION guard_level_change_request_step_rule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_delta int := abs(level_index(NEW.to_level) - level_index(NEW.from_level));
    v_forward boolean := level_index(NEW.to_level) > level_index(NEW.from_level);
BEGIN
    -- Single-step (or same-level, already blocked by from_level <>
    -- to_level CHECK) — always allowed.
    IF v_delta <= 1 THEN
        RETURN NEW;
    END IF;

    -- Multi-level: allowed only under setup mode AND forward direction.
    -- Backward multi-level (e.g. L4 → L1) stays blocked even during
    -- setup — reversing several levels at once is an admin correction
    -- path, not a backfill path.
    IF v_forward AND crm_setup_mode() THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'Level changes are limited to one step at a time. % → % skips levels.',
        NEW.from_level, NEW.to_level
        USING HINT = 'Turn on CRM setup mode (Admin → Settings) to allow a multi-level forward request during initial backfill, or make the change in stages.';
END;
$$;

DROP TRIGGER IF EXISTS level_change_requests_step_rule ON level_change_requests;
CREATE TRIGGER level_change_requests_step_rule
    BEFORE INSERT ON level_change_requests
    FOR EACH ROW EXECUTE FUNCTION guard_level_change_request_step_rule();

COMMENT ON FUNCTION guard_level_change_request_step_rule() IS
    'BEFORE INSERT trigger on level_change_requests. Enforces the '
    'one-step rule from 0031 unless crm_setup_mode() is ON and the '
    'move is forward — in which case a multi-level backfill request '
    'is permitted. Replaces the CHECK constraint from 0031, which '
    'couldn''t consult session state.';

-- ---------------------------------------------------------------------------
-- 4) approve_level_change_request — 0082 body + source assignment
-- ---------------------------------------------------------------------------
--
-- Byte-for-byte identical to 0082's approve function except:
--   - INSERT INTO level_history now sets `source` based on the
--     request's is_backfill flag, so an approved multi-level backfill
--     request lands as source='initial_backfill' and is excluded from
--     Driver A by 0085's rebuild filter.
-- Everything else (RLS gate, current-level snapshot check, evidence
-- packing, audit_events, notification auto-resolve, notification
-- insert) is unchanged.

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
    v_source        text;
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

    v_source := CASE WHEN v_request.is_backfill
                     THEN 'initial_backfill'
                     ELSE 'progression'
                END;

    INSERT INTO level_history (
        company_id, from_level, to_level, changed_by, owner_at_time,
        company_type_at_time, changed_at, fiscal_year, fiscal_quarter,
        evidence_note, evidence_file_url, is_forward, is_credited,
        source
    ) VALUES (
        v_request.company_id, v_request.from_level, v_request.to_level,
        v_request.requested_by, v_owner_id, v_company_type,
        v_now, v_fy, v_fq,
        v_request.evidence_note, v_evidence_url,
        v_is_forward, v_is_forward,
        v_source
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
            'requested_by', v_request.requested_by,
            'is_backfill', v_request.is_backfill
        ),
        jsonb_build_object(
            'approved_by', auth.uid(),
            'history_id', v_history_id,
            'review_note', p_review_note,
            'source', v_source
        )
    );

    -- Auto-resolve every admin's "Pending review" notification for
    -- this request the moment the decision lands (0082 behavior).
    PERFORM resolve_notifications_for_entity(
        'level_change_request', p_request_id
    );

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_company_id, entity_type, entity_id
    ) VALUES (
        v_request.requested_by,
        'level_change'::notification_type_t,
        format('Approved: %s → %s', v_request.from_level, v_request.to_level),
        format('Your level change request was approved by an admin. Credit posted on today''s ledger.'),
        '/companies/' || v_request.company_id::text || '/level-history',
        v_request.company_id,
        'level_change_request',
        p_request_id
    );

    RETURN v_history_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_level_change_request(uuid, text) TO authenticated;

COMMENT ON FUNCTION approve_level_change_request(uuid, text) IS
    'Admin-only approval of a pending level_change_request. Writes '
    'level_history with source = ''initial_backfill'' when the '
    'request was raised as backfill (setup mode on at submission), '
    'so it is excluded from earned Driver A by rebuild_kpi_actuals. '
    'Rest of the body matches 0082: current-level snapshot check, '
    'evidence packing, audit trail, notification auto-resolve, and '
    'the Approved notice back to the requester.';
