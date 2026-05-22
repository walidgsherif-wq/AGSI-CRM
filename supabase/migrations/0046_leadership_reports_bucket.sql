-- 0046_leadership_reports_bucket.sql
-- v1.1 #3 — persist finalised leadership-report PDFs to Supabase Storage.
--
-- The leadership_reports table already has a pdf_storage_path column
-- (defined in 0019), but until now nothing wrote to it. Finalising a
-- report now renders the @react-pdf/renderer document server-side and
-- uploads the bytes to this private bucket, then sets pdf_storage_path
-- on the row. The /api/reports/leadership/[id]/pdf route 302s to a
-- short-lived signed URL when pdf_storage_path is set, so download
-- links stay stable.
--
-- Bucket policy mirrors the leadership_reports table RLS:
--   admin       — read + write (only role that can finalise/upload)
--   bd_head     — read
--   leadership  — read
--   bd_manager  — no access (matches table-level RLS)
--
-- Rows live forever (immutable, frozen at finalise). The retry path
-- in src/server/actions/leadership-reports.ts uses { upsert: true }
-- so admins can regenerate when a transient render/upload failure
-- left pdf_storage_path NULL.

-- 1) Bucket (private, 50 MB hard cap, PDFs only).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'leadership-reports', 'leadership-reports', false,
    50 * 1024 * 1024,
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- 2) RLS policies on storage.objects scoped to this bucket.
DO $blk$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
        RAISE NOTICE 'storage schema not present — skipping bucket policies';
        RETURN;
    END IF;

    DROP POLICY IF EXISTS leadership_reports_select       ON storage.objects;
    DROP POLICY IF EXISTS leadership_reports_admin_insert ON storage.objects;
    DROP POLICY IF EXISTS leadership_reports_admin_update ON storage.objects;
    DROP POLICY IF EXISTS leadership_reports_admin_delete ON storage.objects;

    EXECUTE $pol$
        CREATE POLICY leadership_reports_select ON storage.objects
            FOR SELECT
            USING (bucket_id = 'leadership-reports'
                   AND public.auth_role() IN ('admin','bd_head','leadership'))
    $pol$;

    EXECUTE $pol$
        CREATE POLICY leadership_reports_admin_insert ON storage.objects
            FOR INSERT
            WITH CHECK (bucket_id = 'leadership-reports'
                        AND public.auth_role() = 'admin')
    $pol$;

    EXECUTE $pol$
        CREATE POLICY leadership_reports_admin_update ON storage.objects
            FOR UPDATE
            USING (bucket_id = 'leadership-reports'
                   AND public.auth_role() = 'admin')
    $pol$;

    EXECUTE $pol$
        CREATE POLICY leadership_reports_admin_delete ON storage.objects
            FOR DELETE
            USING (bucket_id = 'leadership-reports'
                   AND public.auth_role() = 'admin')
    $pol$;
END
$blk$;
