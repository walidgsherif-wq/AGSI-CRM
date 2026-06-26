-- 0082_notifications_source_and_dismiss.sql
-- Notifications: source reference + manual dismiss + auto-resolve.
--
-- Why:
--   The bell counts "unread" notifications, but once an approval action
--   has been decided the notification is just clutter. There's no way
--   for a recipient to clear an old notification, and there's no link
--   from a notification back to the underlying request — so we can't
--   auto-mark resolved either.
--
-- This migration:
--   1) Adds `entity_type` + `entity_id` to `notifications` so an
--      approval notification carries a stable ref to the request it
--      represents. Generic on purpose (level_change_request,
--      company_group_request, and any future request types).
--   2) Adds `dismissed_at timestamptz NULL` for manual clear. The
--      bell + inbox treat `dismissed_at IS NOT NULL` as hidden by
--      default (still readable via an explicit filter on /notifications
--      if we add one later).
--   3) Updates the two existing "notify admins on new pending request"
--      triggers (level_change, company_group_request) to populate the
--      new entity_type/entity_id.
--   4) Updates approve/reject RPCs for both flows to auto-mark every
--      still-unread "Pending review" notification for that request as
--      read at the moment the request leaves the pending state.
--   5) Backfills entity_type/entity_id on existing pending-review
--      notifications by subject-parsing within related_company_id —
--      same logic the /notifications inbox already uses today.

-- ---------------------------------------------------------------------------
-- 1) Schema
-- ---------------------------------------------------------------------------

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS entity_type    text         NULL,
    ADD COLUMN IF NOT EXISTS entity_id      uuid         NULL,
    ADD COLUMN IF NOT EXISTS dismissed_at   timestamptz  NULL;

COMMENT ON COLUMN notifications.entity_type IS
    'Stable ref to the source row a notification represents. Examples: '
    '''level_change_request'', ''company_group_request''. Used to '
    'auto-resolve (is_read=true) the moment the underlying action is '
    'decided. NULL for notifications that have no decidable source '
    '(stagnation warnings, mentions, uploads, etc).';

COMMENT ON COLUMN notifications.entity_id IS
    'UUID of the row referenced by entity_type. No FK — entity_type is '
    'free-form, and we want auto-resolve to keep working even if the '
    'source row is later hard-deleted.';

COMMENT ON COLUMN notifications.dismissed_at IS
    'Set by the recipient via the bell or inbox to clear the notification '
    'from the default views. Independent from is_read: marking dismissed '
    'also marks read, but read alone does not dismiss.';

-- Auto-resolve lookups hit this index.
CREATE INDEX IF NOT EXISTS notifications_entity_unread_idx
    ON notifications (entity_type, entity_id)
    WHERE is_read = false;

-- Default views hide dismissed; this keeps the dropdown query fast.
CREATE INDEX IF NOT EXISTS notifications_recipient_live_idx
    ON notifications (recipient_id, created_at DESC)
    WHERE dismissed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2) Update notify-admins triggers to populate the new source ref
-- ---------------------------------------------------------------------------

-- Level-change request (mirrors 0029).
CREATE OR REPLACE FUNCTION notify_admins_on_level_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_company_id, entity_type, entity_id
    )
    SELECT
        p.id,
        'level_change'::notification_type_t,
        format('Pending review: %s → %s', NEW.from_level, NEW.to_level),
        format(
            'A level change is awaiting your review. Evidence: %s',
            substring(NEW.evidence_note FROM 1 FOR 200)
        ),
        '/admin/level-requests',
        NEW.company_id,
        'level_change_request',
        NEW.id
      FROM profiles p
     WHERE p.role = 'admin' AND p.is_active = true;
    RETURN NEW;
END;
$$;

-- Company-group request (mirrors 0081).
CREATE OR REPLACE FUNCTION notify_admins_on_group_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_parent_name text;
    v_child_count int := cardinality(NEW.child_company_ids);
BEGIN
    SELECT canonical_name INTO v_parent_name
      FROM companies WHERE id = NEW.parent_company_id;

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_company_id, entity_type, entity_id
    )
    SELECT
        p.id,
        'company_group_request'::notification_type_t,
        format(
            'Group request: %s child%s under %s',
            v_child_count,
            CASE WHEN v_child_count = 1 THEN '' ELSE 'ren' END,
            coalesce(v_parent_name, '(unnamed)')
        ),
        format(
            'A grouping request is awaiting your review. Reason: %s',
            coalesce(substring(NEW.reason FROM 1 FOR 200), '(no reason given)')
        ),
        '/admin/group-requests',
        NEW.parent_company_id,
        'company_group_request',
        NEW.id
      FROM profiles p
     WHERE p.role = 'admin' AND p.is_active = true;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Auto-resolve helper + wire into the four terminal RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION resolve_notifications_for_entity(
    p_entity_type text,
    p_entity_id   uuid
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count int;
BEGIN
    UPDATE notifications
       SET is_read = true
     WHERE entity_type = p_entity_type
       AND entity_id   = p_entity_id
       AND is_read = false;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Level-change approve (0029): mark all reviewers' "Pending review"
-- notifications resolved when the request is decided.
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

    -- Auto-resolve every admin's "Pending review" notification for
    -- this request the moment the decision lands.
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

-- Level-change reject (0029).
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

    PERFORM resolve_notifications_for_entity(
        'level_change_request', p_request_id
    );

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_company_id, entity_type, entity_id
    ) VALUES (
        v_request.requested_by,
        'level_change'::notification_type_t,
        format('Rejected: %s → %s', v_request.from_level, v_request.to_level),
        format('Your level change request was rejected. Reason: %s', p_review_note),
        '/companies/' || v_request.company_id::text || '/level-history',
        v_request.company_id,
        'level_change_request',
        p_request_id
    );
END;
$$;

-- Company-group approve (0081).
CREATE OR REPLACE FUNCTION approve_company_group_request(
    p_request_id  uuid,
    p_review_note text DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_request    company_group_requests%ROWTYPE;
    v_now        timestamptz := now();
    v_updated    int := 0;
    v_parent_nm  text;
BEGIN
    IF auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admins can approve grouping requests.';
    END IF;

    SELECT * INTO v_request
      FROM company_group_requests
     WHERE id = p_request_id AND status = 'pending'
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request % not found or not pending.', p_request_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_request.parent_company_id) THEN
        RAISE EXCEPTION 'Parent company no longer exists.';
    END IF;

    UPDATE companies
       SET parent_company_id = v_request.parent_company_id
     WHERE id = ANY (v_request.child_company_ids)
       AND id <> v_request.parent_company_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    UPDATE company_group_requests
       SET status      = 'approved'::company_group_request_status_t,
           decided_by  = auth.uid(),
           decided_at  = v_now,
           review_note = p_review_note
     WHERE id = p_request_id;

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id,
        before_json, after_json
    ) VALUES (
        auth.uid(),
        'company_group_approved',
        'company',
        v_request.parent_company_id,
        jsonb_build_object('request_id', p_request_id),
        jsonb_build_object(
            'children', to_jsonb(v_request.child_company_ids),
            'updated_count', v_updated,
            'review_note', p_review_note
        )
    );

    PERFORM resolve_notifications_for_entity(
        'company_group_request', p_request_id
    );

    SELECT canonical_name INTO v_parent_nm
      FROM companies WHERE id = v_request.parent_company_id;

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_company_id, entity_type, entity_id
    ) VALUES (
        v_request.requested_by,
        'company_group_request'::notification_type_t,
        format('Approved: grouping under %s', coalesce(v_parent_nm, '(unnamed)')),
        format(
            '%s compan%s now grouped under %s.',
            v_updated,
            CASE WHEN v_updated = 1 THEN 'y' ELSE 'ies' END,
            coalesce(v_parent_nm, '(unnamed)')
        ),
        '/companies/' || v_request.parent_company_id::text,
        v_request.parent_company_id,
        'company_group_request',
        p_request_id
    );

    RETURN v_updated;
END;
$$;

-- Company-group reject (0081).
CREATE OR REPLACE FUNCTION reject_company_group_request(
    p_request_id  uuid,
    p_review_note text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_request   company_group_requests%ROWTYPE;
    v_parent_nm text;
BEGIN
    IF auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admins can reject grouping requests.';
    END IF;
    IF p_review_note IS NULL OR length(trim(p_review_note)) = 0 THEN
        RAISE EXCEPTION 'A review note is required when rejecting.';
    END IF;

    SELECT * INTO v_request
      FROM company_group_requests
     WHERE id = p_request_id AND status = 'pending'
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request % not found or not pending.', p_request_id;
    END IF;

    UPDATE company_group_requests
       SET status      = 'rejected'::company_group_request_status_t,
           decided_by  = auth.uid(),
           decided_at  = now(),
           review_note = p_review_note
     WHERE id = p_request_id;

    PERFORM resolve_notifications_for_entity(
        'company_group_request', p_request_id
    );

    SELECT canonical_name INTO v_parent_nm
      FROM companies WHERE id = v_request.parent_company_id;

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_company_id, entity_type, entity_id
    ) VALUES (
        v_request.requested_by,
        'company_group_request'::notification_type_t,
        format('Rejected: grouping under %s', coalesce(v_parent_nm, '(unnamed)')),
        format('Your grouping request was rejected. Reason: %s', p_review_note),
        '/companies/' || v_request.parent_company_id::text,
        v_request.parent_company_id,
        'company_group_request',
        p_request_id
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Backfill entity_type/entity_id for existing notifications
-- ---------------------------------------------------------------------------

-- Level-change: subject is one of "Pending review: L1 → L2", "Approved: L1 → L2",
-- "Rejected: L1 → L2". Match by (related_company_id, status, from, to)
-- against level_change_requests; freshest match wins.
DO $$
DECLARE
    v_count int;
BEGIN
    WITH parsed AS (
        SELECT
            n.id AS notification_id,
            n.related_company_id,
            CASE
                WHEN n.subject LIKE 'Pending review:%' THEN 'pending'
                WHEN n.subject LIKE 'Approved:%'       THEN 'approved'
                WHEN n.subject LIKE 'Rejected:%'       THEN 'rejected'
            END::level_request_status_t AS req_status,
            substring(n.subject FROM '\s(L[0-5])\s*→') AS from_level,
            substring(n.subject FROM '→\s*(L[0-5])')   AS to_level
        FROM notifications n
        WHERE n.notification_type = 'level_change'
          AND n.entity_id IS NULL
          AND n.related_company_id IS NOT NULL
    ),
    matched AS (
        SELECT DISTINCT ON (p.notification_id)
            p.notification_id,
            r.id AS request_id
        FROM parsed p
        JOIN level_change_requests r
          ON r.company_id = p.related_company_id
         AND r.status     = p.req_status
         AND r.from_level::text = p.from_level
         AND r.to_level::text   = p.to_level
        ORDER BY p.notification_id, r.created_at DESC
    )
    UPDATE notifications n
       SET entity_type = 'level_change_request',
           entity_id   = m.request_id
      FROM matched m
     WHERE n.id = m.notification_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Backfilled entity refs for % level_change notifications', v_count;
END
$$;

-- Company-group: subjects are "Group request:", "Approved: grouping under …",
-- "Rejected: grouping under …". Match by (parent_company_id, decision status)
-- against company_group_requests; freshest match wins.
DO $$
DECLARE
    v_count int;
BEGIN
    WITH parsed AS (
        SELECT
            n.id AS notification_id,
            n.related_company_id AS parent_id,
            CASE
                WHEN n.subject LIKE 'Group request:%' THEN 'pending'
                WHEN n.subject LIKE 'Approved:%'      THEN 'approved'
                WHEN n.subject LIKE 'Rejected:%'      THEN 'rejected'
            END::company_group_request_status_t AS req_status
        FROM notifications n
        WHERE n.notification_type = 'company_group_request'
          AND n.entity_id IS NULL
          AND n.related_company_id IS NOT NULL
    ),
    matched AS (
        SELECT DISTINCT ON (p.notification_id)
            p.notification_id,
            r.id AS request_id
        FROM parsed p
        JOIN company_group_requests r
          ON r.parent_company_id = p.parent_id
         AND r.status            = p.req_status
        ORDER BY p.notification_id, r.created_at DESC
    )
    UPDATE notifications n
       SET entity_type = 'company_group_request',
           entity_id   = m.request_id
      FROM matched m
     WHERE n.id = m.notification_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Backfilled entity refs for % company_group_request notifications', v_count;
END
$$;

-- One last sweep: any notification whose entity_type now points at a
-- non-pending request should already be is_read=true. Catch anything
-- the historic flows missed.
UPDATE notifications n
   SET is_read = true
  WHERE n.entity_type = 'level_change_request'
    AND n.is_read = false
    AND EXISTS (
        SELECT 1 FROM level_change_requests r
         WHERE r.id = n.entity_id AND r.status <> 'pending'
    );

UPDATE notifications n
   SET is_read = true
  WHERE n.entity_type = 'company_group_request'
    AND n.is_read = false
    AND EXISTS (
        SELECT 1 FROM company_group_requests r
         WHERE r.id = n.entity_id AND r.status <> 'pending'
    );
