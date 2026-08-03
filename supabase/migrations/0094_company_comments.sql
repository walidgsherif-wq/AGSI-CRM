-- 0094_company_comments.sql
-- Per-stakeholder discussion thread + @-mention notifications.
--
-- Two tables:
--   company_comments         — the thread rows (soft-delete via
--                              deleted_at, edited_at for edits).
--   company_comment_mentions — explicit (comment_id, mentioned_id)
--                              rows. Source of truth for the
--                              notification fan-out and for @-highlight
--                              rendering; the composer resolves tokens
--                              client-side and passes ids in, no
--                              server-side re-parsing.
--
-- Access model (whole BD team collaborates):
--   SELECT — admin / bd_head / bd_manager. Excludes leadership,
--            same convention as notes (0022:174).
--   INSERT / UPDATE / DELETE — routed through SECURITY DEFINER RPCs
--            below. This keeps the notification fan-out atomic with
--            the comment insert, and it's the only way to write
--            notifications at all (no INSERT policy on that table).
--
-- RLS is explicit because rls_auto_enable (0093) only enables RLS —
-- it does NOT install policies. Without policies, ENABLE ROW LEVEL
-- SECURITY denies everything to the anon/authenticated roles.

-- ── Tables ────────────────────────────────────────────────────────

CREATE TABLE company_comments (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    -- author_id is nulled if the profile is removed so the thread
    -- doesn't get holes; the UI shows "(deleted user)" for orphaned
    -- rows. Same pattern as notifications.recipient_id NO — actually
    -- that one cascades. Here we prefer preserving history.
    author_id   uuid        NULL     REFERENCES profiles(id) ON DELETE SET NULL,
    body        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    edited_at   timestamptz NULL,
    deleted_at  timestamptz NULL,
    CONSTRAINT company_comments_body_nonblank
        CHECK (btrim(body) <> '')
);

COMMENT ON TABLE company_comments IS
    'Discussion thread rows per company. Soft-deleted rows stay in the '
    'table (deleted_at set) so the UI can render a "removed" tombstone '
    'without losing the timeline. Edits stamp edited_at; the MVP does '
    'not re-notify mentions on edit.';

CREATE INDEX company_comments_company_created_idx
    ON company_comments (company_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX company_comments_author_idx
    ON company_comments (author_id)
    WHERE deleted_at IS NULL;

CREATE TABLE company_comment_mentions (
    comment_id            uuid NOT NULL REFERENCES company_comments(id) ON DELETE CASCADE,
    mentioned_profile_id  uuid NOT NULL REFERENCES profiles(id)         ON DELETE CASCADE,
    created_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (comment_id, mentioned_profile_id)
);

COMMENT ON TABLE company_comment_mentions IS
    'Explicit (comment, mentioned profile) pairs. Source of truth for '
    'both the notification fan-out and the @-highlight rendering — the '
    'client never re-parses the body to find mentions. Cascades on '
    'either side so orphans cannot exist.';

CREATE INDEX company_comment_mentions_profile_idx
    ON company_comment_mentions (mentioned_profile_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────
-- rls_auto_enable would flip these on for us since they're created
-- in public, but be explicit — the check is idempotent and clearer.

ALTER TABLE company_comments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_comment_mentions ENABLE ROW LEVEL SECURITY;

-- Reads: entire BD team (admin/bd_head/bd_manager). Matches notes.
CREATE POLICY company_comments_select_ops
    ON company_comments FOR SELECT
    USING (auth_role() IN ('admin','bd_head','bd_manager'));

-- No direct INSERT / UPDATE / DELETE from clients — everything routes
-- through the RPCs below so the notification fan-out stays atomic.
-- Definer functions bypass RLS, but leaving no INSERT policy also
-- means a curious client can't sidestep the fan-out by inserting
-- a bare row through PostgREST.

CREATE POLICY company_comment_mentions_select_ops
    ON company_comment_mentions FOR SELECT
    USING (auth_role() IN ('admin','bd_head','bd_manager'));

-- ── post_company_comment(company_id, body, mentioned_ids[]) ──────
-- Atomic: comment insert → mention rows → one notification per unique
-- mentioned profile (self-mention skipped, deactivated / non-existent
-- profiles silently dropped, duplicates collapsed). Returns the new
-- comment id so the client can optimistically highlight it.

CREATE OR REPLACE FUNCTION post_company_comment(
    p_company_id     uuid,
    p_body           text,
    p_mentioned_ids  uuid[] DEFAULT ARRAY[]::uuid[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_author_id    uuid := auth.uid();
    v_author_name  text;
    v_company_name text;
    v_comment_id   uuid;
    v_body_trimmed text := btrim(coalesce(p_body, ''));
    v_preview      text;
BEGIN
    IF v_author_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;
    IF auth_role() NOT IN ('admin','bd_head','bd_manager') THEN
        RAISE EXCEPTION 'Only BD team members can post comments.';
    END IF;
    IF v_body_trimmed = '' THEN
        RAISE EXCEPTION 'Comment body cannot be empty.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id) THEN
        RAISE EXCEPTION 'Company % not found.', p_company_id;
    END IF;

    SELECT full_name INTO v_author_name  FROM profiles  WHERE id = v_author_id;
    SELECT canonical_name INTO v_company_name FROM companies WHERE id = p_company_id;

    INSERT INTO company_comments (company_id, author_id, body)
    VALUES (p_company_id, v_author_id, v_body_trimmed)
    RETURNING id INTO v_comment_id;

    -- Resolve the mention list once: unique, active, non-author,
    -- restricted to the BD-team roles (leadership can't be mentioned
    -- because they can't see comments anyway).
    WITH raw AS (
        SELECT DISTINCT unnest(coalesce(p_mentioned_ids, ARRAY[]::uuid[])) AS profile_id
    ),
    resolved AS (
        SELECT p.id
          FROM raw r
          JOIN profiles p ON p.id = r.profile_id
         WHERE p.is_active = true
           AND p.role IN ('admin','bd_head','bd_manager')
           AND p.id <> v_author_id
    )
    INSERT INTO company_comment_mentions (comment_id, mentioned_profile_id)
    SELECT v_comment_id, id FROM resolved
    ON CONFLICT DO NOTHING;

    -- Fan out one notification per resolved mention. Reading back
    -- from company_comment_mentions after the insert dedupes cleanly
    -- and stays aligned with what will actually render as highlighted
    -- in the UI.
    v_preview := substring(v_body_trimmed FROM 1 FOR 200);

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_company_id, entity_type, entity_id
    )
    SELECT
        m.mentioned_profile_id,
        'mention'::notification_type_t,
        format(
            '%s mentioned you on %s',
            coalesce(v_author_name, 'Someone'),
            coalesce(v_company_name, 'a company')
        ),
        v_preview,
        format('/companies/%s/discussion?comment=%s', p_company_id, v_comment_id),
        p_company_id,
        'company_comment',
        v_comment_id
      FROM company_comment_mentions m
     WHERE m.comment_id = v_comment_id;

    RETURN v_comment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION post_company_comment(uuid, text, uuid[]) TO authenticated;

COMMENT ON FUNCTION post_company_comment(uuid, text, uuid[]) IS
    'Atomic: inserts a company_comments row, resolves + de-dups the '
    'p_mentioned_ids array against active BD-team profiles (skips '
    'the author), inserts one company_comment_mentions row per '
    'survivor, then fans out one ''mention'' notification per '
    'survivor. Returns the new comment id. bd_manager/bd_head/admin '
    'only; leadership blocked.';

-- ── edit_company_comment(id, new_body) ───────────────────────────
-- Author or admin. Updates body + edited_at. MVP does NOT re-emit
-- notifications for mentions added by the edit — flagged for later
-- once we have a mention-diff surface.

CREATE OR REPLACE FUNCTION edit_company_comment(
    p_comment_id uuid,
    p_new_body   text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller       uuid := auth.uid();
    v_author       uuid;
    v_deleted_at   timestamptz;
    v_body_trimmed text := btrim(coalesce(p_new_body, ''));
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;
    IF v_body_trimmed = '' THEN
        RAISE EXCEPTION 'Comment body cannot be empty.';
    END IF;

    SELECT author_id, deleted_at
      INTO v_author, v_deleted_at
      FROM company_comments
     WHERE id = p_comment_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Comment % not found.', p_comment_id;
    END IF;
    IF v_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot edit a deleted comment.';
    END IF;
    IF auth_role() <> 'admin' AND v_author IS DISTINCT FROM v_caller THEN
        RAISE EXCEPTION 'Only the author or an admin can edit this comment.';
    END IF;

    UPDATE company_comments
       SET body = v_body_trimmed,
           edited_at = now()
     WHERE id = p_comment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION edit_company_comment(uuid, text) TO authenticated;

-- ── delete_company_comment(id) — soft delete ─────────────────────
-- Author or admin. Sets deleted_at; keeps the row + mention rows for
-- audit. Auto-resolves any outstanding mention notifications for the
-- comment (matches the resolve-by-entity pattern from 0082:145).

CREATE OR REPLACE FUNCTION delete_company_comment(
    p_comment_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller     uuid := auth.uid();
    v_author     uuid;
    v_deleted_at timestamptz;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    SELECT author_id, deleted_at
      INTO v_author, v_deleted_at
      FROM company_comments
     WHERE id = p_comment_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Comment % not found.', p_comment_id;
    END IF;
    IF v_deleted_at IS NOT NULL THEN
        RETURN;
    END IF;
    IF auth_role() <> 'admin' AND v_author IS DISTINCT FROM v_caller THEN
        RAISE EXCEPTION 'Only the author or an admin can delete this comment.';
    END IF;

    UPDATE company_comments
       SET deleted_at = now()
     WHERE id = p_comment_id;

    -- Auto-resolve any live mention notifications for this comment
    -- so recipients don't get a deep-link to a tombstone.
    UPDATE notifications
       SET is_read = true
     WHERE entity_type = 'company_comment'
       AND entity_id   = p_comment_id
       AND is_read     = false;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_company_comment(uuid) TO authenticated;
