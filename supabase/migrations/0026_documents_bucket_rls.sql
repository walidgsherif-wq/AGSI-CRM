-- 0026_documents_bucket_rls.sql
-- M6 — storage RLS for the `documents` bucket. The bucket itself is created
-- via the Supabase Dashboard (or config.toml on self-host).
--
-- Read/write policies mirror the table-level RLS in 0022 for `documents`:
--   ops trio (admin / bd_head / bd_manager) can upload + read
--   admin can delete; bd_head/bd_manager can delete only files they uploaded
--
-- The path convention used by the upload form is:
--   <company_id>/<timestamp>-<filename>
-- but the policies don't enforce that — the row in the documents table is
-- the source of truth for ownership.

DO $docs_storage$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
        RAISE NOTICE 'storage schema not present — skipping bucket policies';
        RETURN;
    END IF;

    DROP POLICY IF EXISTS documents_ops_select ON storage.objects;
    DROP POLICY IF EXISTS documents_ops_insert ON storage.objects;
    DROP POLICY IF EXISTS documents_admin_delete ON storage.objects;
    DROP POLICY IF EXISTS documents_owner_delete ON storage.objects;

    EXECUTE $pol$
        CREATE POLICY documents_ops_select ON storage.objects
            FOR SELECT
            USING (bucket_id = 'documents'
                   AND public.auth_role() IN ('admin','bd_head','bd_manager','leadership'))
    $pol$;

    EXECUTE $pol$
        CREATE POLICY documents_ops_insert ON storage.objects
            FOR INSERT
            WITH CHECK (bucket_id = 'documents'
                        AND public.auth_role() IN ('admin','bd_head','bd_manager'))
    $pol$;

    EXECUTE $pol$
        CREATE POLICY documents_admin_delete ON storage.objects
            FOR DELETE
            USING (bucket_id = 'documents' AND public.auth_role() = 'admin')
    $pol$;

    EXECUTE $pol$
        CREATE POLICY documents_owner_delete ON storage.objects
            FOR DELETE
            USING (bucket_id = 'documents'
                   AND public.auth_role() IN ('bd_head','bd_manager')
                   AND owner = auth.uid())
    $pol$;
END
$docs_storage$;
