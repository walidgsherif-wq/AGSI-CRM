-- 0025_bnc_match_rpc.sql
-- M5 — fuzzy company-name matching for the BNC ingest pipeline.
-- Uses pg_trgm similarity over companies.canonical_name + aliases.
-- Threshold tiers (per architecture/05-bnc-upload-sequence.md Stage C):
--   sim >= 0.85          → auto-accept (UPSERT project_companies)
--   0.75 <= sim < 0.85   → admin queue (company_match_queue)
--   sim <  0.75          → INSERT new company (source='bnc_upload')
-- The RPC returns the single best candidate above the requested threshold;
-- the JS caller decides which tier applies.

CREATE OR REPLACE FUNCTION find_company_by_fuzzy_name(
    p_token     text,
    p_threshold numeric DEFAULT 0.75
) RETURNS TABLE (
    company_id        uuid,
    canonical_name    text,
    similarity_score  numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH scored AS (
        SELECT
            c.id   AS company_id,
            c.canonical_name,
            GREATEST(
                similarity(c.canonical_name, p_token),
                similarity(agsi_aliases_to_text(c.aliases), p_token)
            ) AS sim
        FROM companies c
        WHERE
            -- pg_trgm uses set_limit() but our threshold is per-call; rely on
            -- post-filter rather than the % operator so callers can pass any
            -- threshold without re-tuning the session.
            similarity(c.canonical_name, p_token) >= p_threshold
            OR similarity(agsi_aliases_to_text(c.aliases), p_token) >= p_threshold
    )
    SELECT company_id, canonical_name, sim
      FROM scored
     ORDER BY sim DESC
     LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION find_company_by_fuzzy_name(text, numeric) TO authenticated;

COMMENT ON FUNCTION find_company_by_fuzzy_name(text, numeric) IS
    'BNC ingest: returns the single best fuzzy match above threshold, or empty row.';

-- ---------------------------------------------------------------------------
-- Storage bucket policies for bnc-uploads bucket.
-- The bucket itself is created via the Supabase Dashboard (or config.toml on
-- self-host); these policies live in storage.objects and gate read/write to
-- admin only. Wrapped in a guarded DO block so the migration succeeds even
-- if the bucket doesn't exist yet — admin can flip these on after creating
-- the bucket via Dashboard.
-- ---------------------------------------------------------------------------

DO $bnc_storage$
BEGIN
    -- Skip if storage schema not present (pure-DB self-host without storage)
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
        RAISE NOTICE 'storage schema not present — skipping bucket policies';
        RETURN;
    END IF;

    -- Drop any prior version so this migration is re-runnable.
    DROP POLICY IF EXISTS bnc_uploads_admin_select ON storage.objects;
    DROP POLICY IF EXISTS bnc_uploads_admin_insert ON storage.objects;
    DROP POLICY IF EXISTS bnc_uploads_admin_delete ON storage.objects;

    EXECUTE $pol$
        CREATE POLICY bnc_uploads_admin_select ON storage.objects
            FOR SELECT
            USING (bucket_id = 'bnc-uploads' AND public.auth_role() = 'admin')
    $pol$;

    EXECUTE $pol$
        CREATE POLICY bnc_uploads_admin_insert ON storage.objects
            FOR INSERT
            WITH CHECK (bucket_id = 'bnc-uploads' AND public.auth_role() = 'admin')
    $pol$;

    EXECUTE $pol$
        CREATE POLICY bnc_uploads_admin_delete ON storage.objects
            FOR DELETE
            USING (bucket_id = 'bnc-uploads' AND public.auth_role() = 'admin')
    $pol$;
END
$bnc_storage$;
