-- 0032_email_tracking.sql
-- Inbound email tracking. Webhook (POST /api/inbound-email) receives
-- parsed-email JSON from a transactional email provider (Postmark, SES,
-- SendGrid Inbound Parse, etc.). The webhook matches the sender + the
-- recipients against profiles + companies, then creates an engagement
-- + engagement_emails row.
--
-- Emails we can't auto-match (unknown sender or unknown stakeholder)
-- land in inbound_email_unmatched for admin review.

CREATE TABLE engagement_emails (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id   uuid          NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
    message_id      text          NOT NULL UNIQUE,
    from_email      text          NOT NULL,
    from_name       text          NULL,
    to_emails       text[]        NOT NULL DEFAULT ARRAY[]::text[],
    cc_emails       text[]        NOT NULL DEFAULT ARRAY[]::text[],
    subject         text          NOT NULL,
    body_text       text          NULL,
    body_html       text          NULL,
    has_attachments boolean       NOT NULL DEFAULT false,
    received_at     timestamptz   NOT NULL DEFAULT now(),
    raw_payload     jsonb         NULL,
    direction       text          NOT NULL CHECK (direction IN ('outbound','inbound')),
    created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX engagement_emails_engagement_idx ON engagement_emails (engagement_id);
CREATE INDEX engagement_emails_received_idx   ON engagement_emails (received_at DESC);

ALTER TABLE engagement_emails ENABLE ROW LEVEL SECURITY;

-- Reads: anyone authenticated (mirrors engagements RLS — same data).
CREATE POLICY engagement_emails_select_all
    ON engagement_emails FOR SELECT
    USING (auth.uid() IS NOT NULL);
-- No INSERT/UPDATE/DELETE policy → only service-role can write
-- (webhook handler runs with service-role).

CREATE TABLE inbound_email_unmatched (
    id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id               text          NOT NULL UNIQUE,
    from_email               text          NOT NULL,
    from_name                text          NULL,
    to_emails                text[]        NOT NULL DEFAULT ARRAY[]::text[],
    cc_emails                text[]        NOT NULL DEFAULT ARRAY[]::text[],
    subject                  text          NOT NULL,
    body_preview             text          NULL,
    received_at              timestamptz   NOT NULL DEFAULT now(),
    raw_payload              jsonb         NULL,
    reason                   text          NOT NULL,
    status                   text          NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','resolved','discarded')),
    resolved_engagement_id   uuid          NULL REFERENCES engagements(id) ON DELETE SET NULL,
    resolved_by              uuid          NULL REFERENCES profiles(id) ON DELETE SET NULL,
    resolved_at              timestamptz   NULL,
    review_note              text          NULL,
    created_at               timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX inbound_email_unmatched_pending_idx
    ON inbound_email_unmatched (received_at DESC)
    WHERE status = 'pending';

ALTER TABLE inbound_email_unmatched ENABLE ROW LEVEL SECURITY;

CREATE POLICY inbound_email_unmatched_admin_all
    ON inbound_email_unmatched FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

-- =====================================================================
-- Helper: resolve_inbound_email — admin manually associates an
-- unmatched row with a company + creates the engagement.
-- =====================================================================

CREATE OR REPLACE FUNCTION resolve_inbound_email(
    p_unmatched_id  uuid,
    p_company_id    uuid,
    p_acting_user   uuid,
    p_note          text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_unmatched   inbound_email_unmatched%ROWTYPE;
    v_engagement  uuid;
BEGIN
    IF auth_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admins can resolve inbound emails.';
    END IF;

    SELECT * INTO v_unmatched
      FROM inbound_email_unmatched
     WHERE id = p_unmatched_id AND status = 'pending'
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unmatched email % not found or already resolved.', p_unmatched_id;
    END IF;

    INSERT INTO engagements (
        company_id, engagement_type, summary, engagement_date, created_by
    ) VALUES (
        p_company_id,
        'email'::engagement_type_t,
        'Email: ' || left(v_unmatched.subject, 280),
        v_unmatched.received_at::date,
        p_acting_user
    ) RETURNING id INTO v_engagement;

    INSERT INTO engagement_emails (
        engagement_id, message_id, from_email, from_name,
        to_emails, cc_emails, subject, body_text,
        received_at, raw_payload, direction
    ) VALUES (
        v_engagement, v_unmatched.message_id, v_unmatched.from_email, v_unmatched.from_name,
        v_unmatched.to_emails, v_unmatched.cc_emails, v_unmatched.subject, v_unmatched.body_preview,
        v_unmatched.received_at, v_unmatched.raw_payload,
        CASE WHEN v_unmatched.from_email IN (
            SELECT email FROM profiles WHERE email IS NOT NULL
        ) THEN 'outbound' ELSE 'inbound' END
    );

    UPDATE inbound_email_unmatched
       SET status = 'resolved',
           resolved_engagement_id = v_engagement,
           resolved_by = auth.uid(),
           resolved_at = now(),
           review_note = p_note
     WHERE id = p_unmatched_id;

    RETURN v_engagement;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_inbound_email(uuid, uuid, uuid, text) TO authenticated;
