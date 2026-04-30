-- 0037_finalise_leadership_report.sql
-- M12 — Leadership Report finalise flow + notification.
--
-- Adds the `leadership_report_finalised` notification type and a
-- SECURITY DEFINER finalise_leadership_report() function that:
--   1. Flips a draft to finalised (admin only).
--   2. Stamps finalised_at + finalised_by.
--   3. INSERTs a notifications row for every active leadership-role
--      user, body templated from the report's period_label.
--
-- Archive flow uses a separate archive_leadership_report() function
-- (status finalised → archived, also admin only). No DELETE path —
-- spec §3.17 mandates audit-of-record retention.

-- 1) Add the new notification type. Idempotent with IF NOT EXISTS.
ALTER TYPE notification_type_t
    ADD VALUE IF NOT EXISTS 'leadership_report_finalised';

-- 2) finalise_leadership_report ---------------------------------------------

CREATE OR REPLACE FUNCTION finalise_leadership_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_report leadership_reports%ROWTYPE;
    v_subject text;
    v_link    text;
BEGIN
    IF auth.uid() IS NULL OR auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admins can finalise leadership reports.';
    END IF;

    SELECT * INTO v_report
      FROM leadership_reports
     WHERE id = p_report_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Report % not found.', p_report_id;
    END IF;
    IF v_report.status <> 'draft' THEN
        RAISE EXCEPTION 'Only draft reports can be finalised. Current status: %.',
            v_report.status;
    END IF;

    UPDATE leadership_reports
       SET status       = 'finalised',
           finalised_at = now(),
           finalised_by = auth.uid(),
           updated_at   = now()
     WHERE id = p_report_id;

    -- Notification fan-out to every active leadership user.
    -- The notification rows live until M13 wires the in-app + email
    -- delivery; for now they're durable inbox entries that the
    -- existing /settings/notifications surface can read once that ships.
    v_subject := format(
        'New %s report ready for review: %s',
        CASE v_report.report_type
            WHEN 'monthly_snapshot'    THEN 'monthly'
            WHEN 'quarterly_strategic' THEN 'quarterly'
            ELSE v_report.report_type::text
        END,
        v_report.period_label
    );
    v_link := '/reports/leadership/' || p_report_id::text;

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url, channels
    )
    SELECT
        p.id,
        'leadership_report_finalised'::notification_type_t,
        v_subject,
        format(
            'Period: %s → %s. Open the report to review and leave feedback.',
            v_report.period_start, v_report.period_end
        ),
        v_link,
        ARRAY['in_app']::text[]
      FROM profiles p
     WHERE p.role = 'leadership' AND p.is_active = true;
END;
$$;

GRANT EXECUTE ON FUNCTION finalise_leadership_report(uuid) TO authenticated;

-- 3) archive_leadership_report ---------------------------------------------

CREATE OR REPLACE FUNCTION archive_leadership_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status leadership_report_status_t;
BEGIN
    IF auth.uid() IS NULL OR auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admins can archive leadership reports.';
    END IF;

    SELECT status INTO v_status
      FROM leadership_reports
     WHERE id = p_report_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Report % not found.', p_report_id;
    END IF;
    IF v_status <> 'finalised' THEN
        RAISE EXCEPTION 'Only finalised reports can be archived. Current status: %.',
            v_status;
    END IF;

    UPDATE leadership_reports
       SET status     = 'archived',
           updated_at = now()
     WHERE id = p_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION archive_leadership_report(uuid) TO authenticated;
