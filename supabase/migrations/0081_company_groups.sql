-- 0081_company_groups.sql
-- Company grouping (holding structure). Distinct companies linked
-- under a parent holding company. NON-DESTRUCTIVE:
--   - children are NOT hidden, collapsed, or removed from lists,
--     search, stats, counts, or coverage.
--   - children remain searchable by their own name; the UI annotates
--     "part of {parent}" rather than hiding the row.
--   - the parent is itself a normal company row.
--
-- Mirrors the level-change request → admin-approve pattern (0029/0031):
--   any BD role inserts a company_group_request, admin reviews via
--   approve/reject SECURITY DEFINER RPCs that touch parent_company_id
--   atomically and notify the requester.

-- ---------------------------------------------------------------------------
-- 1) companies.parent_company_id + cycle guard
-- ---------------------------------------------------------------------------

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS parent_company_id uuid NULL
        REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS companies_parent_idx
    ON companies (parent_company_id)
    WHERE parent_company_id IS NOT NULL;

COMMENT ON COLUMN companies.parent_company_id IS
    'NULL for top-level companies. When non-null, this company sits '
    'under that parent holding company. Grouping is associative only — '
    'it never hides the child from lists, search, KPI counts, or '
    'coverage. Cycles are blocked by guard_company_parent_no_cycle.';

-- Self-reference + direct cycle guard. A 1-level cycle check covers
-- the realistic shapes (a holding company doesn't sit under one of
-- its own subsidiaries). Deeper cycles are not enforced here —
-- preventing them would need a recursive walk on every UPDATE; if it
-- ever matters, a CTE check can be added.
CREATE OR REPLACE FUNCTION guard_company_parent_no_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parents_parent uuid;
BEGIN
    IF NEW.parent_company_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.parent_company_id = NEW.id THEN
        RAISE EXCEPTION 'A company cannot be its own parent.';
    END IF;
    SELECT parent_company_id INTO v_parents_parent
      FROM companies WHERE id = NEW.parent_company_id;
    IF v_parents_parent = NEW.id THEN
        RAISE EXCEPTION
            'Direct cycle blocked — % is already a child of %.',
            NEW.parent_company_id, NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_parent_no_cycle ON companies;
CREATE TRIGGER companies_parent_no_cycle
    BEFORE INSERT OR UPDATE OF parent_company_id ON companies
    FOR EACH ROW EXECUTE FUNCTION guard_company_parent_no_cycle();

-- ---------------------------------------------------------------------------
-- 2) company_group_requests — request/approve workflow
-- ---------------------------------------------------------------------------

CREATE TYPE company_group_request_status_t AS ENUM (
    'pending',
    'approved',
    'rejected'
);

CREATE TABLE company_group_requests (
    id                  uuid                            PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_company_id   uuid                            NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    child_company_ids   uuid[]                          NOT NULL,
    requested_by        uuid                            NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    requested_at        timestamptz                     NOT NULL DEFAULT now(),
    reason              text                            NULL,
    status              company_group_request_status_t  NOT NULL DEFAULT 'pending',
    decided_by          uuid                            NULL REFERENCES profiles(id) ON DELETE SET NULL,
    decided_at          timestamptz                     NULL,
    review_note         text                            NULL,
    created_at          timestamptz                     NOT NULL DEFAULT now(),
    CONSTRAINT company_group_requests_children_nonempty
        CHECK (cardinality(child_company_ids) > 0),
    CONSTRAINT company_group_requests_parent_not_child
        CHECK (NOT (parent_company_id = ANY (child_company_ids)))
);

CREATE INDEX company_group_requests_pending_idx
    ON company_group_requests (created_at DESC)
    WHERE status = 'pending';
CREATE INDEX company_group_requests_parent_idx
    ON company_group_requests (parent_company_id, created_at DESC);

ALTER TABLE company_group_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_group_requests_select_all
    ON company_group_requests FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY company_group_requests_insert_bd
    ON company_group_requests FOR INSERT
    WITH CHECK (
        auth_role() IN ('admin','bd_head','bd_manager')
        AND requested_by = auth.uid()
    );

-- Update path: admin reviews via the SECURITY DEFINER RPCs below; the
-- requester can cancel via UPDATE while pending (kept tight: only
-- status flips, not the substance).
CREATE POLICY company_group_requests_update_admin
    ON company_group_requests FOR UPDATE
    USING (auth_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 3) Notify admins on a new pending group request (mirrors 0029)
-- ---------------------------------------------------------------------------

ALTER TYPE notification_type_t ADD VALUE IF NOT EXISTS 'company_group_request';

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
        related_company_id
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
        NEW.parent_company_id
      FROM profiles p
     WHERE p.role = 'admin' AND p.is_active = true;
    RETURN NEW;
END;
$$;

CREATE TRIGGER company_group_requests_notify_admins
    AFTER INSERT ON company_group_requests
    FOR EACH ROW EXECUTE FUNCTION notify_admins_on_group_request();

-- ---------------------------------------------------------------------------
-- 4) approve_company_group_request — admin RPC
-- ---------------------------------------------------------------------------

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

    -- Verify the parent + children still exist (defensive — they're
    -- normal company rows that could have been deleted).
    IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_request.parent_company_id) THEN
        RAISE EXCEPTION 'Parent company no longer exists.';
    END IF;

    -- Atomic UPDATE — every child gets parent_company_id set in one
    -- statement. The companies_parent_no_cycle trigger guards each row.
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

    SELECT canonical_name INTO v_parent_nm
      FROM companies WHERE id = v_request.parent_company_id;

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_company_id
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
        v_request.parent_company_id
    );

    RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_company_group_request(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) reject_company_group_request — admin RPC
-- ---------------------------------------------------------------------------

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

    SELECT canonical_name INTO v_parent_nm
      FROM companies WHERE id = v_request.parent_company_id;

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_company_id
    ) VALUES (
        v_request.requested_by,
        'company_group_request'::notification_type_t,
        format('Rejected: grouping under %s', coalesce(v_parent_nm, '(unnamed)')),
        format('Your grouping request was rejected. Reason: %s', p_review_note),
        '/companies/' || v_request.parent_company_id::text,
        v_request.parent_company_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION reject_company_group_request(uuid, text) TO authenticated;
