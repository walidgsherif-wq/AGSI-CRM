-- 0096_task_from_comment_and_owner_notify.sql
-- Two additions for the discussion feature (#157):
--
--   1) tasks.comment_id — mirror of tasks.engagement_id (0078) so a
--      task created from a comment carries a typed link back to
--      its source. NULLable + ON DELETE SET NULL: task survives a
--      soft-deleted comment, link just clears.
--
--   2) Rebuild post_company_comment() to notify a stakeholder's
--      owner of every comment (mention or not), while preserving
--      accurate subject text — "mentioned you" only when they were
--      actually @-mentioned; "commented on" for owner-notifications
--      without a mention. Dedup: an owner already in the mention
--      set gets ONE mention notification (with "mentioned you"),
--      never two.
--
-- Both changes are idempotent — safe re-run.

-- ── 1) tasks.comment_id (mirror 0078 exactly) ─────────────────────

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS comment_id uuid NULL
        REFERENCES company_comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tasks_comment_idx
    ON tasks (comment_id)
    WHERE comment_id IS NOT NULL;

COMMENT ON COLUMN tasks.comment_id IS
    'Source comment when this task was created from a discussion '
    'comment (e.g. via the comment row''s "Create task" action). '
    'NULL for tasks created from any other entry point. ON DELETE '
    'SET NULL so a task survives a comment removal with the link '
    'cleared. Mirrors tasks.engagement_id (0078).';

-- ── 2) post_company_comment() — add owner fan-out ─────────────────
-- Byte-identical to 0094 through the mention insert; the delta is:
--   * SELECT ... , owner_id INTO ..., v_owner_id
--   * INSERT INTO notifications ... FROM company_comment_mentions
--     (the existing mention fan-out; subject says "mentioned you")
--   * NEW: separate INSERT for the owner ONLY when owner_id IS NOT
--     NULL AND owner_id <> author AND owner_id NOT IN mention set.
--     Subject says "commented on {company}" — never claims a mention
--     that didn't happen.
--
-- Consumers (badge, action queue, realtime) receive the owner
-- notification identically to a mention because it reuses the
-- notification_type 'mention' — no enum widening.

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
    v_owner_id     uuid;
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

    -- Load the company row once (name + owner). Also functions as
    -- the existence check we used to do with a separate EXISTS.
    SELECT canonical_name, owner_id
      INTO v_company_name, v_owner_id
      FROM companies
     WHERE id = p_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company % not found.', p_company_id;
    END IF;

    SELECT full_name INTO v_author_name FROM profiles WHERE id = v_author_id;

    INSERT INTO company_comments (company_id, author_id, body)
    VALUES (p_company_id, v_author_id, v_body_trimmed)
    RETURNING id INTO v_comment_id;

    -- Resolve the mention list once: unique, active, non-author,
    -- restricted to BD-team roles (leadership can't be mentioned
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

    v_preview := substring(v_body_trimmed FROM 1 FOR 200);

    -- Mention fan-out — "mentioned you" subject.
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

    -- Owner fan-out — "commented on" subject. Only when the owner
    -- is set, isn't the author, and wasn't in the mention set (they
    -- already got a mention notification, don't send a second).
    IF v_owner_id IS NOT NULL
       AND v_owner_id <> v_author_id
       AND NOT EXISTS (
           SELECT 1 FROM company_comment_mentions
            WHERE comment_id = v_comment_id
              AND mentioned_profile_id = v_owner_id
       )
    THEN
        -- Owner may not even be a BD-team profile (edge case: role
        -- changed after ownership was assigned). Notifications RLS is
        -- recipient-scoped, not role-scoped, so this still delivers —
        -- but we guard against a null recipient just in case.
        INSERT INTO notifications (
            recipient_id, notification_type, subject, body, link_url,
            related_company_id, entity_type, entity_id
        )
        VALUES (
            v_owner_id,
            'mention'::notification_type_t,
            format(
                '%s commented on %s',
                coalesce(v_author_name, 'Someone'),
                coalesce(v_company_name, 'a company')
            ),
            v_preview,
            format('/companies/%s/discussion?comment=%s', p_company_id, v_comment_id),
            p_company_id,
            'company_comment',
            v_comment_id
        );
    END IF;

    RETURN v_comment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION post_company_comment(uuid, text, uuid[]) TO authenticated;

COMMENT ON FUNCTION post_company_comment(uuid, text, uuid[]) IS
    'Atomic: inserts a company_comments row, resolves + de-dups the '
    'p_mentioned_ids against active BD-team profiles (skips the '
    'author), inserts one company_comment_mentions row per survivor, '
    'fans out one ''mention'' notification per survivor (subject: '
    '"mentioned you"), AND — if the company has an owner who is '
    'neither the author nor already in the mention set — fans out '
    'one more ''mention'' notification to the owner (subject: '
    '"commented on"). Owner never gets two notifications for one '
    'comment. Returns the new comment id.';
