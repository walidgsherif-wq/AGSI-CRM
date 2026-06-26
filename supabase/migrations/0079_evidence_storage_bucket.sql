-- 0079_evidence_storage_bucket.sql
-- Create the `evidence` Storage bucket as a proper migration.
--
-- Originally only documented as a manual step in supabase/APPLY-M7.md
-- ("Supabase dashboard → Storage → New bucket"). The RLS for it was
-- already declared in 0029_level_change_requests.sql, but the bucket
-- itself was never inserted into storage.buckets, so every upload
-- from the level-change form bounced with "Bucket not found".
--
-- This migration mirrors the 0049_email_attachments.sql pattern:
-- insert the bucket row idempotently, then DROP + CREATE storage.objects
-- policies inside a DO block that no-ops if the storage schema isn't
-- present (so it survives self-hosted environments where Storage
-- hasn't been initialised).
--
-- Bucket config per APPLY-M7:
--   - Private (public = false). Reads happen via signed URLs or
--     authenticated client calls; no anonymous access.
--   - 25 MB per-file cap. Generous enough for PDFs, scanned MOUs,
--     and full-res screenshots; rejects video-sized blobs.
--   - No MIME allow-list at the bucket layer — the EvidenceUploader
--     restricts the picker (images / pdf / eml / msg).
--
-- RLS (single source of truth — drops 0029's three policy names if
-- they exist so they don't co-exist with these and accidentally widen
-- access):
--   - SELECT: admin + bd_head (reviewers) OR the original uploader
--     (owner = auth.uid()) so the requester can verify their own
--     evidence. Leadership intentionally excluded per the brief.
--   - INSERT: admin + bd_head + bd_manager. bd_manager IS the most
--     common requester, so they MUST be able to upload.
--   - DELETE: admin + bd_head OR uploader. The EvidenceUploader
--     calls .remove() when the user removes a file before submitting
--     the request — without this, the user gets a confusing 401 on
--     the cleanup call (the request itself still goes through, but
--     orphan files would pile up).

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('evidence', 'evidence', false, 25 * 1024 * 1024)
ON CONFLICT (id) DO NOTHING;

DO $blk$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
        RAISE NOTICE 'storage schema not present — skipping bucket policies';
        RETURN;
    END IF;

    -- 0029's names (declared but the bucket row was missing) —
    -- drop so the single source of truth is THIS migration.
    DROP POLICY IF EXISTS evidence_ops_select   ON storage.objects;
    DROP POLICY IF EXISTS evidence_ops_insert   ON storage.objects;
    DROP POLICY IF EXISTS evidence_admin_delete ON storage.objects;

    -- This migration's own names — drop for idempotent re-run.
    DROP POLICY IF EXISTS evidence_select_review_or_owner ON storage.objects;
    DROP POLICY IF EXISTS evidence_insert_bd_roles        ON storage.objects;
    DROP POLICY IF EXISTS evidence_delete_review_or_owner ON storage.objects;

    -- SELECT: admin / bd_head review the request and see the files;
    -- the uploader sees their own files. Anonymous and leadership
    -- get nothing.
    EXECUTE $pol$
        CREATE POLICY evidence_select_review_or_owner ON storage.objects
            FOR SELECT
            USING (
                bucket_id = 'evidence'
                AND auth.uid() IS NOT NULL
                AND (
                    public.auth_role() IN ('admin','bd_head')
                    OR owner = auth.uid()
                )
            )
    $pol$;

    -- INSERT: every BD role can upload. bd_manager is the most
    -- common case — they're the ones requesting the level change.
    EXECUTE $pol$
        CREATE POLICY evidence_insert_bd_roles ON storage.objects
            FOR INSERT
            WITH CHECK (
                bucket_id = 'evidence'
                AND auth.uid() IS NOT NULL
                AND public.auth_role() IN ('admin','bd_head','bd_manager')
            )
    $pol$;

    -- DELETE: admin/bd_head can clean up; the uploader can remove
    -- their own pre-submit (this is what EvidenceUploader.remove()
    -- calls when the user clicks "Remove" before submitting).
    EXECUTE $pol$
        CREATE POLICY evidence_delete_review_or_owner ON storage.objects
            FOR DELETE
            USING (
                bucket_id = 'evidence'
                AND auth.uid() IS NOT NULL
                AND (
                    public.auth_role() IN ('admin','bd_head')
                    OR owner = auth.uid()
                )
            )
    $pol$;
END
$blk$;
