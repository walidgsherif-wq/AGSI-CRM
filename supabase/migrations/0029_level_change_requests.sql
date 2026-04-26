-- 0029_level_change_requests.sql
-- M7 polish — level change approval workflow with file evidence.
-- BD managers / BD heads submit requests; admin reviews. Direct
-- change_company_level() is still available to admins (e.g. when
-- correcting a level themselves) but BD users go through the queue.
--
-- Evidence files live in the existing `evidence` storage bucket
-- (declared in supabase/config.toml). Each file path is stored on
-- the request row so the admin reviewer can download all of them.

CREATE TYPE level_request_status_t AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled'
);

CREATE TABLE level_change_requests (
    id                      uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              uuid                        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    from_level              level_t                     NOT NULL,
    to_level                level_t                     NOT NULL,
    requested_by            uuid                        NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    requested_at            timestamptz                 NOT NULL DEFAULT now(),
    evidence_note           text                        NOT NULL,
    evidence_file_paths     text[]                      NOT NULL DEFAULT ARRAY[]::text[],
    status                  level_request_status_t      NOT NULL DEFAULT 'pending',
    reviewed_by             uuid                        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    reviewed_at             timestamptz                 NULL,
    review_note             text                        NULL,
    resulting_history_id    uuid                        NULL REFERENCES level_history(id) ON DELETE SET NULL,
    created_at              timestamptz                 NOT NULL DEFAULT now(),
    CONSTRAINT level_change_requests_not_same
        CHECK (from_level <> to_level),
    CONSTRAINT level_change_requests_evidence_required
        CHECK (length(trim(evidence_note)) > 0)
);

CREATE INDEX level_change_requests_pending_idx
    ON level_change_requests (created_at DESC)
    WHERE status = 'pending'::level_request_status_t;
CREATE INDEX level_change_requests_company_idx
    ON level_change_requests (company_id, created_at DESC);
CREATE INDEX level_change_requests_requester_idx
    ON level_change_requests (requested_by, created_at DESC);

ALTER TABLE level_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY level_change_requests_select_all
    ON level_change_requests FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY level_change_requests_insert_ops
    ON level_change_requests FOR INSERT
    WITH CHECK (
        auth_role() IN ('admin','bd_head','bd_manager')
        AND requested_by = auth.uid()
    );

CREATE POLICY level_change_requests_cancel_own
    ON level_change_requests FOR UPDATE
    USING (
        auth_role() IN ('bd_head','bd_manager')
        AND requested_by = auth.uid()
        AND status = 'pending'
    );

CREATE POLICY level_change_requests_review_admin
    ON level_change_requests FOR UPDATE
    USING (auth_role() = 'admin');

-- =====================================================================
-- approve_level_change_request — admin runs this to commit a pending
-- request. Inserts level_history with the ORIGINAL REQUESTER as
-- changed_by (so credit attribution stays correct), updates
-- companies.current_level via the level_change_via_fn flag, marks the
-- request approved, fires a notification to the requester.
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

    -- Lock + read company state
    SELECT current_level, owner_id, company_type
      INTO v_current_level, v_owner_id, v_company_type
      FROM companies
     WHERE id = v_request.company_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company % no longer exists.', v_request.company_id;
    END IF;

    -- The from_level on the request was a snapshot at submission time;
    -- if the company has moved since, abort cleanly so the admin can ask
    -- the requester to resubmit with fresh context.
    IF v_current_level <> v_request.from_level THEN
        RAISE EXCEPTION
          'Company is now at % (request was from %). Ask the requester to resubmit.',
          v_current_level, v_request.from_level;
    END IF;

    v_is_forward := v_request.to_level::text > v_request.from_level::text;
    v_fy := fiscal_year_of(v_now);
    v_fq := fiscal_quarter_of(v_now);

    -- Pack evidence file paths into the existing evidence_file_url text
    -- column (comma-separated). Multi-file is rare enough that this
    -- avoids a schema change to level_history.
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

    -- Update the cached current_level via the guard-bypass flag
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
        format('Your level change request was approved by an admin. Credit posted on today''s ledger.'),
        '/companies/' || v_request.company_id::text || '/level-history',
        v_request.company_id
    );

    RETURN v_history_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_level_change_request(uuid, text) TO authenticated;

-- =====================================================================
-- reject_level_change_request — admin marks the request rejected with
-- a required reason; notifies the requester.
-- =====================================================================

CREATE OR REPLACE FUNCTION reject_level_change_request(
    p_request_id  uuid,
    p_review_note text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_request level_change_requests%ROWTYPE;
BEGIN
    IF auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admins can reject level change requests.';
    END IF;
    IF p_review_note IS NULL OR length(trim(p_review_note)) = 0 THEN
        RAISE EXCEPTION 'A review note is required when rejecting.';
    END IF;

    SELECT * INTO v_request
      FROM level_change_requests
     WHERE id = p_request_id AND status = 'pending'
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request % not found or not pending.', p_request_id;
    END IF;

    UPDATE level_change_requests
       SET status = 'rejected'::level_request_status_t,
           reviewed_by = auth.uid(),
           reviewed_at = now(),
           review_note = p_review_note
     WHERE id = p_request_id;

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url, related_company_id
    ) VALUES (
        v_request.requested_by,
        'level_change'::notification_type_t,
        format('Rejected: %s → %s', v_request.from_level, v_request.to_level),
        format('Your level change request was rejected. Reason: %s', p_review_note),
        '/companies/' || v_request.company_id::text || '/level-history',
        v_request.company_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION reject_level_change_request(uuid, text) TO authenticated;

-- =====================================================================
-- Storage RLS for the `evidence` bucket. Bucket is declared in
-- supabase/config.toml; if you self-host or use Supabase Cloud, make
-- sure to create the bucket via Dashboard before relying on these.
-- =====================================================================

DO $evidence_storage$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
        RAISE NOTICE 'storage schema not present — skipping bucket policies';
        RETURN;
    END IF;

    DROP POLICY IF EXISTS evidence_ops_select ON storage.objects;
    DROP POLICY IF EXISTS evidence_ops_insert ON storage.objects;
    DROP POLICY IF EXISTS evidence_admin_delete ON storage.objects;

    EXECUTE $pol$
        CREATE POLICY evidence_ops_select ON storage.objects
            FOR SELECT
            USING (bucket_id = 'evidence'
                   AND public.auth_role() IN ('admin','bd_head','bd_manager','leadership'))
    $pol$;

    EXECUTE $pol$
        CREATE POLICY evidence_ops_insert ON storage.objects
            FOR INSERT
            WITH CHECK (bucket_id = 'evidence'
                        AND public.auth_role() IN ('admin','bd_head','bd_manager'))
    $pol$;

    EXECUTE $pol$
        CREATE POLICY evidence_admin_delete ON storage.objects
            FOR DELETE
            USING (bucket_id = 'evidence' AND public.auth_role() = 'admin')
    $pol$;
END
$evidence_storage$;

-- =====================================================================
-- Trigger: notify all admins when a new pending request is created
-- =====================================================================

CREATE OR REPLACE FUNCTION notify_admins_on_level_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url, related_company_id
    )
    SELECT
        p.id,
        'level_change'::notification_type_t,
        format('Pending review: %s → %s', NEW.from_level, NEW.to_level),
        format(
            'A level change is awaiting your review. Evidence: %s',
            substring(NEW.evidence_note from 1 for 200)
        ),
        '/admin/level-requests',
        NEW.company_id
      FROM profiles p
     WHERE p.role = 'admin' AND p.is_active = true;
    RETURN NEW;
END;
$$;

CREATE TRIGGER level_change_requests_notify_admins
    AFTER INSERT ON level_change_requests
    FOR EACH ROW EXECUTE FUNCTION notify_admins_on_level_request();
