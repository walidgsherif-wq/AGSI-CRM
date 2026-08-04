-- 0104_send_claim_notifications_rpc.sql
-- Fan-out RPC for the claim-notification path. Follows the same
-- shape as send_task_assigned_notification (0051) and the various
-- 'mention' inserts (0094 / 0098) — SECURITY DEFINER because the
-- notifications RLS forbids client-side INSERT (0022) and we want
-- the write to happen without RLS bypass creeping into caller
-- code. Best-effort by design: the callsite in claimCompany
-- catches and logs on failure so a broken notification never
-- rolls back a successful claim.
--
-- The 'claim' enum value was added in 0103 — separate migration so
-- the reference here executes in its own transaction (Postgres
-- ADD VALUE + same-tx-usage restriction).

CREATE OR REPLACE FUNCTION send_claim_notifications(
    p_company_id  uuid,
    p_actor_id    uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_name text;
    v_actor_name   text;
    v_subject      text;
    v_body         text;
    v_link         text;
BEGIN
    -- Verify company exists — a stale caller shouldn't produce
    -- orphan notifications with a NULL related_company_id.
    SELECT canonical_name INTO v_company_name
      FROM companies WHERE id = p_company_id;
    IF v_company_name IS NULL THEN
        RAISE EXCEPTION 'Company % not found.', p_company_id;
    END IF;

    SELECT full_name INTO v_actor_name
      FROM profiles WHERE id = p_actor_id;

    v_subject := format(
        '%s claimed %s',
        coalesce(v_actor_name, 'A member'),
        v_company_name
    );
    v_body := format(
        '%s has taken ownership of %s. Open the stakeholder to review.',
        coalesce(v_actor_name, 'A member'),
        v_company_name
    );
    v_link := format('/companies/%s', p_company_id);

    -- Fan out to every active admin / bd_head, excluding the actor
    -- (in case a leader claimed the company themselves — the actor
    -- doesn't need a notification about their own action).
    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_company_id, entity_type, entity_id
    )
    SELECT
        p.id,
        'claim'::notification_type_t,
        v_subject,
        v_body,
        v_link,
        p_company_id,
        'company',
        p_company_id
      FROM profiles p
     WHERE p.role IN ('admin','bd_head')
       AND p.is_active = true
       AND p.id <> p_actor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION send_claim_notifications(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION send_claim_notifications(uuid, uuid) IS
    'Fan-out one ''claim'' notification per active admin / bd_head '
    '(excluding the actor) when a member claims a stakeholder. Called '
    'best-effort from the claimCompany action right after the '
    'claim_company RPC succeeds; a failure here is logged by the '
    'caller and never rolls back the claim itself.';
