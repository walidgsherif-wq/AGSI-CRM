-- 0033_engagement_delete_audit.sql
-- Engagement deletes are now audit-logged. Prior to this, the server
-- action just ran a DELETE on engagements. With Postmark inbound email
-- capture (migration 0032) deletes are more consequential — they
-- discard real correspondence — so every delete must leave a trail.
--
-- The function below:
--   - Is SECURITY DEFINER so it can write to audit_events under its own
--     elevated privileges, while still using auth.uid() / auth_role()
--     to enforce caller permissions.
--   - Snapshots the engagement row + any joined engagement_emails row
--     into audit_events.before_json before deleting.
--   - Cascades the delete to engagement_emails via the FK ON DELETE
--     CASCADE on engagement_emails.engagement_id.

CREATE OR REPLACE FUNCTION delete_engagement_with_audit(
    p_engagement_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_engagement engagements%ROWTYPE;
    v_email      engagement_emails%ROWTYPE;
    v_snapshot   jsonb;
    v_role       role_t;
BEGIN
    -- Caller must be authenticated.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT * INTO v_engagement
      FROM engagements
     WHERE id = p_engagement_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Engagement % not found.', p_engagement_id;
    END IF;

    v_role := auth_role();

    -- Permission rule mirrors the prior server-action gate:
    --   - leadership: never
    --   - admin: always
    --   - bd_head, bd_manager: own only
    IF v_role = 'leadership' THEN
        RAISE EXCEPTION 'Leadership cannot delete engagements.';
    END IF;
    IF v_role <> 'admin' AND v_engagement.created_by <> auth.uid() THEN
        RAISE EXCEPTION 'You can only delete engagements you created.';
    END IF;

    -- Snapshot the engagement plus any captured email content so the
    -- audit row is fully self-describing.
    v_snapshot := to_jsonb(v_engagement);

    SELECT * INTO v_email
      FROM engagement_emails
     WHERE engagement_id = p_engagement_id
     LIMIT 1;
    IF FOUND THEN
        v_snapshot := v_snapshot || jsonb_build_object('email', to_jsonb(v_email));
    END IF;

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id, before_json, after_json
    ) VALUES (
        auth.uid(),
        'engagement_delete',
        'engagement',
        p_engagement_id,
        v_snapshot,
        NULL
    );

    DELETE FROM engagements WHERE id = p_engagement_id;
END;
$$;

COMMENT ON FUNCTION delete_engagement_with_audit(uuid) IS
    'Deletes an engagement after writing a full snapshot to audit_events. '
    'Permission: admin always; bd_head / bd_manager their own only; '
    'leadership never. CASCADE drops any engagement_emails row.';

GRANT EXECUTE ON FUNCTION delete_engagement_with_audit(uuid) TO authenticated;
