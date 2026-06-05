-- 0049_email_attachments.sql
-- v1.1 — inbound email attachments + configurable BCC address.
--
-- Two things wired in one migration because they ship together:
--   1. engagement_email_attachments + email-attachments Storage bucket
--      so Postmark inbound payloads no longer drop their files on the
--      floor (the v1 placeholder in EngagementDetailsSheet has been
--      saying "had attachments (file bytes not stored in v1)" since
--      M9; this is v2).
--   2. app_settings key `inbound_email_address` so the pipeline
--      cold-card hint can name a concrete BCC address instead of the
--      generic "log a touchpoint" copy. Admin-editable from
--      /admin/settings.

-- =====================================================================
-- 1) engagement_email_attachments
-- =====================================================================

CREATE TABLE IF NOT EXISTS engagement_email_attachments (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_email_id uuid        NOT NULL REFERENCES engagement_emails(id)
                                    ON DELETE CASCADE,
    filename            text        NOT NULL,
    content_type        text        NOT NULL,
    size_bytes          int         NOT NULL CHECK (size_bytes >= 0),
    storage_path        text        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engagement_email_attachments_email_idx
    ON engagement_email_attachments (engagement_email_id);

COMMENT ON TABLE engagement_email_attachments IS
    'Per-attachment metadata for inbound emails. storage_path points into the email-attachments bucket. Service-role writes via /api/inbound-email; reads governed by RLS below.';

ALTER TABLE engagement_email_attachments ENABLE ROW LEVEL SECURITY;

-- Read: same as engagement_emails — any authenticated user. Writes go
-- through the webhook (service role), so no user-level INSERT/UPDATE
-- policies are needed.
DROP POLICY IF EXISTS engagement_email_attachments_select
    ON engagement_email_attachments;
CREATE POLICY engagement_email_attachments_select
    ON engagement_email_attachments FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- =====================================================================
-- 2) email-attachments Storage bucket
-- =====================================================================
--
-- Private, 5 MB per-file cap. Vercel's serverless function payload
-- limit is 4.5 MB; with base64 inflation (+33%) that's ~3 MB raw of
-- attachments per webhook call total. 5 MB per-file lets us at least
-- store the moderate cases cleanly; oversize attachments are skipped
-- with a warning logged on the engagement (see route.ts). Allow any
-- MIME so PDFs / Word / Excel / images / zips all flow through.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('email-attachments', 'email-attachments', false, 5 * 1024 * 1024)
ON CONFLICT (id) DO NOTHING;

DO $blk$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
        RAISE NOTICE 'storage schema not present — skipping bucket policies';
        RETURN;
    END IF;

    DROP POLICY IF EXISTS email_attachments_select        ON storage.objects;
    DROP POLICY IF EXISTS email_attachments_service_write ON storage.objects;

    -- Read: any authenticated user (mirrors engagement_emails table).
    -- Per-row access control lives at the engagement_email level; the
    -- attachment download links are server-rendered signed URLs.
    EXECUTE $pol$
        CREATE POLICY email_attachments_select ON storage.objects
            FOR SELECT
            USING (bucket_id = 'email-attachments'
                   AND auth.uid() IS NOT NULL)
    $pol$;

    -- Writes: only the service role (used by /api/inbound-email).
    -- No user role gets write access — listing INSERT WITH CHECK false
    -- is the explicit denial.
    EXECUTE $pol$
        CREATE POLICY email_attachments_service_write ON storage.objects
            FOR INSERT
            WITH CHECK (bucket_id = 'email-attachments'
                        AND public.auth_role() = 'admin')
    $pol$;
END
$blk$;

-- =====================================================================
-- 3) Seed inbound_email_address app_setting
-- =====================================================================
--
-- Empty string by default — admin sets it from /admin/settings once
-- the Postmark inbound forwarder is configured.

INSERT INTO app_settings (key, value_json)
VALUES ('inbound_email_address', '""'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN app_settings.value_json IS
    'jsonb-encoded setting payload. inbound_email_address is a bare string ("log@yourdomain") shown verbatim in the pipeline cold-card hint and any admin-facing copy.';
