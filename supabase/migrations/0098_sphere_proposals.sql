-- 0098_sphere_proposals.sql
-- Sphere-of-Interest governance amendment: managers propose, admins
-- approve. Mirrors the level_change_requests → approve/reject pattern
-- (0029 + 0082) so the inbox can render inline review actions the
-- same way it does for level changes.
--
-- What this migration ships:
--   1) sphere_proposal_status_t + sphere_proposal_reason_t enums.
--   2) sphere_proposals table + partial-unique-in-flight index.
--   3) RLS: manager sees own; admin/bd_head see all + decide.
--   4) notification_type_t.sphere_proposal enum value.
--   5) propose_for_sphere() RPC — anti-nag dedup, capable of auto-
--      firing from engagement/claim hooks without ever raising when
--      the company is already covered.
--   6) approve/reject RPCs — resolve outstanding notifications on
--      decision (verbatim pattern from 0082).
--   7) After-insert trigger fans out one 'sphere_proposal' notification
--      per active admin/bd_head reviewer.
--
-- No change to sphere_members itself; the addToSphere / removeFrom
-- Sphere policies stay as 0097 defined them. The application-layer
-- change (managers can no longer call addToSphere) ships in the
-- action file, not the policy — admins invoking approve_sphere_
-- proposal are still the ones inserting into sphere_members.

-- ── 1) Enums ──────────────────────────────────────────────────────

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'sphere_proposal_status_t'
    ) THEN
        CREATE TYPE sphere_proposal_status_t AS ENUM (
            'pending', 'approved', 'rejected'
        );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'sphere_proposal_reason_t'
    ) THEN
        CREATE TYPE sphere_proposal_reason_t AS ENUM (
            'engaged_off_sphere',
            'claimed_off_sphere',
            'manual'
        );
    END IF;
END $$;

ALTER TYPE notification_type_t ADD VALUE IF NOT EXISTS 'sphere_proposal';

-- ── 2) Table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sphere_proposals (
    id             uuid                       PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id     uuid                       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    proposed_by    uuid                       NULL     REFERENCES profiles(id)  ON DELETE SET NULL,
    -- Captured at insert time so a later role change on the proposer
    -- doesn't reclassify who could see this row.
    proposed_by_role role_t                   NOT NULL,
    reason         sphere_proposal_reason_t   NOT NULL,
    note           text                       NULL,
    status         sphere_proposal_status_t   NOT NULL DEFAULT 'pending',
    decided_by     uuid                       NULL     REFERENCES profiles(id)  ON DELETE SET NULL,
    decided_at     timestamptz                NULL,
    review_note    text                       NULL,
    created_at     timestamptz                NOT NULL DEFAULT now()
);

COMMENT ON TABLE sphere_proposals IS
    'Manager-raised proposals to add a company to the sphere of '
    'interest (0097). Admin/bd_head review + decide. Dedup rules '
    '(anti-nag): propose_for_sphere() refuses to create a new pending '
    'row for a company that is already in sphere_members, already has '
    'a pending proposal, or has a prior rejected proposal — matches '
    'the "rejected suppresses re-nagging" rule in the amendment brief.';

-- Only ONE pending proposal per company at a time — dedup enforced
-- at the DB level so a race between two hooks (a manager engaging AND
-- claiming in the same second) can't insert two rows.
CREATE UNIQUE INDEX IF NOT EXISTS sphere_proposals_one_pending_per_company
    ON sphere_proposals (company_id)
 WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS sphere_proposals_proposed_by_idx
    ON sphere_proposals (proposed_by, created_at DESC);

CREATE INDEX IF NOT EXISTS sphere_proposals_pending_idx
    ON sphere_proposals (created_at DESC)
 WHERE status = 'pending';

-- ── 3) RLS ────────────────────────────────────────────────────────

ALTER TABLE sphere_proposals ENABLE ROW LEVEL SECURITY;

-- Read: admin + bd_head see everything (they need it to decide);
-- bd_manager sees only their own proposals (for a "my proposals" view
-- later); leadership never sees this table.
CREATE POLICY sphere_proposals_select_admin_head
    ON sphere_proposals FOR SELECT
    USING (auth_role() IN ('admin','bd_head'));

CREATE POLICY sphere_proposals_select_own
    ON sphere_proposals FOR SELECT
    USING (auth_role() = 'bd_manager' AND proposed_by = auth.uid());

-- Writes are routed through the SECURITY DEFINER RPCs below — no
-- direct INSERT/UPDATE/DELETE from clients so the dedup and role
-- checks live in one place.

-- ── 5) propose_for_sphere ────────────────────────────────────────
-- Returns the new proposal id, or NULL if the request was deduped
-- (company already covered / already pending / already rejected).
-- No exceptions on dedup — auto-triggers call this after every
-- engagement/claim; raising would rollback the caller.

CREATE OR REPLACE FUNCTION propose_for_sphere(
    p_company_id uuid,
    p_reason     sphere_proposal_reason_t,
    p_note       text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller   uuid := auth.uid();
    v_role     role_t;
    v_id       uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;
    v_role := auth_role();
    IF v_role NOT IN ('admin','bd_head','bd_manager') THEN
        RAISE EXCEPTION 'Only BD team members can propose sphere additions.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id) THEN
        RAISE EXCEPTION 'Company % not found.', p_company_id;
    END IF;

    -- Already a member → no proposal.
    IF EXISTS (SELECT 1 FROM sphere_members WHERE company_id = p_company_id) THEN
        RETURN NULL;
    END IF;

    -- Any prior proposal for this company that would suppress a new
    -- one: pending (currently in flight) OR rejected (anti-nag). If
    -- an approved row exists the sphere_members membership check
    -- above already handled it — but include it in the suppression
    -- as belt-and-braces.
    IF EXISTS (
        SELECT 1 FROM sphere_proposals
         WHERE company_id = p_company_id
           AND status IN ('pending','rejected','approved')
    ) THEN
        RETURN NULL;
    END IF;

    INSERT INTO sphere_proposals (
        company_id, proposed_by, proposed_by_role, reason, note
    ) VALUES (
        p_company_id, v_caller, v_role, p_reason, NULLIF(btrim(coalesce(p_note,'')), '')
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION propose_for_sphere(uuid, sphere_proposal_reason_t, text) TO authenticated;

COMMENT ON FUNCTION propose_for_sphere(uuid, sphere_proposal_reason_t, text) IS
    'Create a pending sphere_proposals row for the caller. Returns the '
    'new id, or NULL when deduped (company already a member / has a '
    'pending or rejected proposal). Safe to call from auto-triggers — '
    'never raises on dedup so a downstream engagement/claim never '
    'rolls back on the proposal being redundant.';

-- ── 6) approve_sphere_proposal ────────────────────────────────────

CREATE OR REPLACE FUNCTION approve_sphere_proposal(
    p_proposal_id  uuid,
    p_review_note  text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller   uuid := auth.uid();
    v_role     role_t;
    v_proposal sphere_proposals%ROWTYPE;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;
    v_role := auth_role();
    IF v_role NOT IN ('admin','bd_head') THEN
        RAISE EXCEPTION 'Only admin or bd_head can decide sphere proposals.';
    END IF;

    SELECT * INTO v_proposal
      FROM sphere_proposals
     WHERE id = p_proposal_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proposal % not found.', p_proposal_id;
    END IF;
    IF v_proposal.status <> 'pending' THEN
        RAISE EXCEPTION 'Proposal % is % — only pending proposals can be decided.',
            p_proposal_id, v_proposal.status;
    END IF;

    -- Insert the membership row. ON CONFLICT DO NOTHING covers the
    -- race where an admin adds the company via the builder in the
    -- same second — approval still marks the proposal decided.
    INSERT INTO sphere_members (company_id, added_by, added_by_role, note)
    VALUES (
        v_proposal.company_id,
        v_caller,
        v_role,
        NULLIF(btrim(coalesce(p_review_note,'')), '')
    )
    ON CONFLICT (company_id) DO NOTHING;

    UPDATE sphere_proposals
       SET status = 'approved',
           decided_by = v_caller,
           decided_at = now(),
           review_note = NULLIF(btrim(coalesce(p_review_note,'')), '')
     WHERE id = p_proposal_id;

    -- Clear any outstanding "review this proposal" notifications for
    -- other reviewers so the badge decrements without waiting on a poll.
    PERFORM resolve_notifications_for_entity('sphere_proposal', p_proposal_id);

    RETURN v_proposal.company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_sphere_proposal(uuid, text) TO authenticated;

-- ── 7) reject_sphere_proposal ─────────────────────────────────────

CREATE OR REPLACE FUNCTION reject_sphere_proposal(
    p_proposal_id  uuid,
    p_review_note  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_role   role_t;
    v_note   text := NULLIF(btrim(coalesce(p_review_note, '')), '');
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;
    v_role := auth_role();
    IF v_role NOT IN ('admin','bd_head') THEN
        RAISE EXCEPTION 'Only admin or bd_head can decide sphere proposals.';
    END IF;
    IF v_note IS NULL THEN
        RAISE EXCEPTION 'A reason is required when rejecting.';
    END IF;

    UPDATE sphere_proposals
       SET status = 'rejected',
           decided_by = v_caller,
           decided_at = now(),
           review_note = v_note
     WHERE id = p_proposal_id AND status = 'pending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proposal % not found or not pending.', p_proposal_id;
    END IF;

    PERFORM resolve_notifications_for_entity('sphere_proposal', p_proposal_id);
END;
$$;

GRANT EXECUTE ON FUNCTION reject_sphere_proposal(uuid, text) TO authenticated;

-- ── 8) Fan-out trigger ────────────────────────────────────────────
-- One 'sphere_proposal' notification per active admin/bd_head at the
-- moment the proposal is created. Mirror of notify_admins_on_group_
-- request (0081).

CREATE OR REPLACE FUNCTION notify_reviewers_on_sphere_proposal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_name text;
    v_proposer     text;
    v_reason_txt   text;
    v_subject      text;
BEGIN
    SELECT canonical_name INTO v_company_name FROM companies WHERE id = NEW.company_id;
    SELECT full_name      INTO v_proposer     FROM profiles  WHERE id = NEW.proposed_by;

    v_reason_txt := CASE NEW.reason
        WHEN 'engaged_off_sphere' THEN 'is engaging'
        WHEN 'claimed_off_sphere' THEN 'just claimed'
        ELSE 'proposes'
    END;

    v_subject := format(
        '%s %s %s (not in your sphere) — add to targets?',
        coalesce(v_proposer, 'A BD manager'),
        v_reason_txt,
        coalesce(v_company_name, 'a stakeholder')
    );

    INSERT INTO notifications (
        recipient_id, notification_type, subject, body, link_url,
        related_company_id, entity_type, entity_id
    )
    SELECT
        p.id,
        'sphere_proposal'::notification_type_t,
        v_subject,
        coalesce(NEW.note, ''),
        '/notifications?type=sphere_proposal',
        NEW.company_id,
        'sphere_proposal',
        NEW.id
      FROM profiles p
     WHERE p.role IN ('admin','bd_head')
       AND p.is_active = true;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sphere_proposals_notify_reviewers ON sphere_proposals;
CREATE TRIGGER sphere_proposals_notify_reviewers
    AFTER INSERT ON sphere_proposals
    FOR EACH ROW EXECUTE FUNCTION notify_reviewers_on_sphere_proposal();
