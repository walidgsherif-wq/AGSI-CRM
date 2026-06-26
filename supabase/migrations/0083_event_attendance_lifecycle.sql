-- 0083_event_attendance_lifecycle.sql
-- Extends 0080's event_attendance table with a planned/attended
-- lifecycle and badge-photo proof for confirmed attendance.
--
-- Why:
--   The base build was attend-then-log: every row was a past event the
--   member had attended. There was no way to declare an upcoming event
--   ("I'm going to AAB next month"), and no concept of evidence —
--   "attended" was self-asserted. This migration adds:
--     1) status ∈ {planned, attended} with attended as the default so
--        the 0080 rows already in the table stay correct.
--     2) proof_path — a single badge-photo upload, optional. When set
--        on an attended row the UI shows a "Verified" badge.
--     3) confirmed_at — when the row transitioned to attended (NULL
--        for planned, now() for attended).
--   Plus a private event-proofs storage bucket mirroring the 0079
--   evidence-bucket pattern.
--
-- Doesn't touch:
--   - RLS on event_attendance (the 0080 policies — owner-or-admin
--     for writes, transparent reads — already cover plan/confirm/edit
--     flows).
--   - company linking, KPI/pipeline/ecosystem, the merge/grouping/
--     notification builds.

-- ---------------------------------------------------------------------------
-- 1) Lifecycle + proof columns
-- ---------------------------------------------------------------------------

ALTER TABLE event_attendance
    ADD COLUMN IF NOT EXISTS status        text         NOT NULL DEFAULT 'attended',
    ADD COLUMN IF NOT EXISTS proof_path    text         NULL,
    ADD COLUMN IF NOT EXISTS confirmed_at  timestamptz  NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'event_attendance_status_check'
    ) THEN
        ALTER TABLE event_attendance
            ADD CONSTRAINT event_attendance_status_check
            CHECK (status IN ('planned','attended'));
    END IF;
END
$$;

COMMENT ON COLUMN event_attendance.status IS
    'planned = member declared they will attend; attended = they did. '
    'Default attended so pre-0083 rows (which were always logged after '
    'the fact) stay correct without a backfill.';

COMMENT ON COLUMN event_attendance.proof_path IS
    'Storage path (event-proofs bucket) of a single badge photo or '
    'similar artifact. Optional. When non-null on an attended row, the '
    'UI flags the row Verified.';

COMMENT ON COLUMN event_attendance.confirmed_at IS
    'When the row transitioned to attended. NULL while status=planned.';

-- A planned row that was just inserted hasn't been confirmed yet, and
-- an attended row that's been confirmed must carry a timestamp. Past
-- rows (created before this migration) get confirmed_at = created_at
-- so the audit story still works.
UPDATE event_attendance
   SET confirmed_at = created_at
 WHERE status = 'attended' AND confirmed_at IS NULL;

-- Fast lookups for the "upcoming" surfaces on the dashboard + /events.
CREATE INDEX IF NOT EXISTS event_attendance_planned_idx
    ON event_attendance (event_date)
    WHERE status = 'planned';

-- ---------------------------------------------------------------------------
-- 2) event-proofs storage bucket
-- ---------------------------------------------------------------------------
--
-- Mirrors 0079_evidence_storage_bucket: insert the bucket row
-- idempotently, then DROP + CREATE storage.objects policies inside a
-- DO block that no-ops on environments without the storage schema.
--
-- Bucket config:
--   - Private (public = false). Reads via signed URLs.
--   - 10 MB per-file cap. Badge photos are small; this rejects
--     mistaken video uploads.
--   - No MIME allow-list at the bucket layer — the uploader
--     restricts the picker to images/*.
--
-- RLS (single source of truth):
--   - INSERT: any authenticated user. Storage stamps owner = auth.uid()
--     automatically, which is what SELECT/DELETE key off.
--   - SELECT: the uploader (owner = auth.uid()) OR admin OR leadership.
--     Leadership needs read so the rollup's "view proof" works.
--   - DELETE: the uploader OR admin.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('event-proofs', 'event-proofs', false, 10 * 1024 * 1024)
ON CONFLICT (id) DO NOTHING;

DO $blk$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
        RAISE NOTICE 'storage schema not present — skipping bucket policies';
        RETURN;
    END IF;

    DROP POLICY IF EXISTS event_proofs_select_owner_or_review ON storage.objects;
    DROP POLICY IF EXISTS event_proofs_insert_auth            ON storage.objects;
    DROP POLICY IF EXISTS event_proofs_delete_owner_or_admin  ON storage.objects;

    EXECUTE $pol$
        CREATE POLICY event_proofs_select_owner_or_review ON storage.objects
            FOR SELECT
            USING (
                bucket_id = 'event-proofs'
                AND auth.uid() IS NOT NULL
                AND (
                    owner = auth.uid()
                    OR public.auth_role() IN ('admin','leadership')
                )
            )
    $pol$;

    EXECUTE $pol$
        CREATE POLICY event_proofs_insert_auth ON storage.objects
            FOR INSERT
            WITH CHECK (
                bucket_id = 'event-proofs'
                AND auth.uid() IS NOT NULL
            )
    $pol$;

    EXECUTE $pol$
        CREATE POLICY event_proofs_delete_owner_or_admin ON storage.objects
            FOR DELETE
            USING (
                bucket_id = 'event-proofs'
                AND auth.uid() IS NOT NULL
                AND (
                    owner = auth.uid()
                    OR public.auth_role() = 'admin'
                )
            )
    $pol$;
END
$blk$;
