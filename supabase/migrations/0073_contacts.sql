-- 0073_contacts.sql
-- Multiple contacts per company with tamper-resistant protection:
-- soft-delete, audit, role-restricted destructive verbs.
--
-- Why this exists: the companies table embeds a single "key contact"
-- (key_contact_name/role/email/phone). That's a name → relationship
-- model that doesn't scale: a stakeholder typically has multiple
-- people involved (champion, decision maker, technical lead). Worse,
-- a bd_manager owning a company can wipe the key contact in one
-- click and there's no audit, no recovery, no "I'll restore that".
--
-- This migration introduces a one-to-many contacts table, copies the
-- existing key_contact_* values in as primary contacts, and layers
-- protection:
--   - soft-delete (deleted_at, deleted_by) — archive, not destroy
--   - hard purge restricted to bd_head/admin (RLS DELETE policy)
--   - restore restricted to bd_head/admin (BEFORE UPDATE trigger)
--   - every mutation writes one audit_events row (AFTER trigger,
--     SECURITY DEFINER so non-admin roles can write the audit)
--   - one primary per company invariant via a partial unique index
--     and a single-primary BEFORE trigger that demotes the others
--
-- The legacy key_contact_* columns on companies are NOT dropped here.
-- BNC ingest (src/lib/bnc/process.ts +
-- supabase/functions/bnc-upload-process/index.ts) still writes them,
-- and the inbound-email resolver (src/app/api/inbound-email/route.ts)
-- still reads key_contact_email to route email to a stakeholder.
-- The form / detail page / zod schema stop touching them in the same
-- PR as this migration. A follow-up will repoint BNC + inbound-email
-- to the contacts table and drop the columns.

-- ---------------------------------------------------------------------------
-- 1) Table
-- ---------------------------------------------------------------------------

CREATE TABLE contacts (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    full_name   text        NOT NULL,
    position    text        NULL,
    email       text        NULL,
    phone       text        NULL,
    is_primary  boolean     NOT NULL DEFAULT false,
    created_by  uuid        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NULL,
    deleted_at  timestamptz NULL,
    deleted_by  uuid        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    CONSTRAINT contacts_full_name_not_blank
        CHECK (length(trim(full_name)) > 0)
);

COMMENT ON TABLE contacts IS
    'Stakeholder contacts (one company, many people). Soft-delete via '
    'deleted_at; only bd_head/admin can purge or restore. Every '
    'mutation is audited.';

COMMENT ON COLUMN contacts.is_primary IS
    'Single primary contact per company. Enforced by the partial '
    'unique index contacts_one_primary + the single-primary BEFORE '
    'trigger that demotes any other live primary on the same company.';

-- ---------------------------------------------------------------------------
-- 2) Indexes
-- ---------------------------------------------------------------------------

-- One primary per company across LIVE rows only. Archived rows can
-- retain their is_primary flag (history), they just don't compete.
CREATE UNIQUE INDEX contacts_one_primary
    ON contacts (company_id)
    WHERE is_primary AND deleted_at IS NULL;

CREATE INDEX contacts_company_live_idx
    ON contacts (company_id)
    WHERE deleted_at IS NULL;

CREATE INDEX contacts_company_archived_idx
    ON contacts (company_id)
    WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Triggers
-- ---------------------------------------------------------------------------

-- 3a) updated_at on every UPDATE (mirrors set_updated_at in 0021).
CREATE OR REPLACE FUNCTION contacts_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER contacts_set_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION contacts_set_updated_at();

-- 3b) Single-primary invariant. When a row becomes primary (INSERT
--     primary=true, or UPDATE primary=false→true), demote every other
--     live primary on the same company.
--
-- SECURITY DEFINER: the bd_manager creating contact B for a company
-- whose existing primary contact A was created by someone else would
-- not be able to UPDATE A under their own RLS context. Demotion is a
-- data-integrity action driven by the system, not by them — runs as
-- function owner.
CREATE OR REPLACE FUNCTION contacts_enforce_single_primary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.is_primary IS NOT TRUE THEN
        RETURN NEW;
    END IF;
    IF NEW.deleted_at IS NOT NULL THEN
        -- Archiving a primary leaves is_primary as-is (history); no
        -- need to demote others.
        RETURN NEW;
    END IF;

    UPDATE contacts
       SET is_primary = false
     WHERE company_id  = NEW.company_id
       AND id         <> NEW.id
       AND is_primary  = true
       AND deleted_at IS NULL;

    RETURN NEW;
END;
$$;

CREATE TRIGGER contacts_enforce_single_primary
    BEFORE INSERT OR UPDATE OF is_primary, deleted_at ON contacts
    FOR EACH ROW EXECUTE FUNCTION contacts_enforce_single_primary();

-- 3c) Restore guard. Soft-delete is open to creator (RLS UPDATE),
--     restore is not — only admin/bd_head can flip deleted_at back to
--     NULL. Service-role / migration context (auth.uid() IS NULL) is
--     trusted.
CREATE OR REPLACE FUNCTION contacts_guard_restore()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_role text;
BEGIN
    IF OLD.deleted_at IS NULL OR NEW.deleted_at IS NOT NULL THEN
        -- Not a restore.
        RETURN NEW;
    END IF;
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT role::text INTO caller_role
      FROM profiles WHERE id = auth.uid();

    IF caller_role IN ('admin','bd_head') THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Only admin or BD head can restore an archived contact.';
END;
$$;

CREATE TRIGGER contacts_guard_restore
    BEFORE UPDATE OF deleted_at ON contacts
    FOR EACH ROW EXECUTE FUNCTION contacts_guard_restore();

-- 3d) Audit. AFTER INSERT/UPDATE/DELETE → one audit_events row per
--     mutation. SECURITY DEFINER so non-admin sessions can write the
--     audit row (audit_events has no INSERT policy for users).
CREATE OR REPLACE FUNCTION contacts_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event text;
    v_before jsonb;
    v_after  jsonb;
    v_entity uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event  := 'contact_created';
        v_before := NULL;
        v_after  := to_jsonb(NEW);
        v_entity := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
        v_event  := 'contact_purged';
        v_before := to_jsonb(OLD);
        v_after  := NULL;
        v_entity := OLD.id;
    ELSE
        v_before := to_jsonb(OLD);
        v_after  := to_jsonb(NEW);
        v_entity := NEW.id;
        IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
            v_event := 'contact_archived';
        ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
            v_event := 'contact_restored';
        ELSE
            v_event := 'contact_updated';
        END IF;
    END IF;

    INSERT INTO audit_events (
        actor_id, event_type, entity_type, entity_id,
        before_json, after_json
    ) VALUES (
        auth.uid(), v_event, 'contact', v_entity, v_before, v_after
    );

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER contacts_audit
    AFTER INSERT OR UPDATE OR DELETE ON contacts
    FOR EACH ROW EXECUTE FUNCTION contacts_audit();

-- ---------------------------------------------------------------------------
-- 4) RLS
-- ---------------------------------------------------------------------------

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;

-- SELECT: every authenticated user sees live rows. Admin/bd_head
-- additionally see archived rows (powers the "Archived contacts"
-- panel). Anon denied (auth.uid() check via auth_role()).
CREATE POLICY contacts_select_all
    ON contacts FOR SELECT
    USING (
        deleted_at IS NULL
        OR auth_role() IN ('admin','bd_head')
    );

-- INSERT: any BD role; created_by must be the caller; cannot insert
-- as already-deleted.
CREATE POLICY contacts_insert_ops
    ON contacts FOR INSERT
    WITH CHECK (
        auth_role() IN ('admin','bd_head','bd_manager')
        AND created_by = auth.uid()
        AND deleted_at IS NULL
    );

-- UPDATE: creator OR admin/bd_head. Restore is further blocked by
-- the contacts_guard_restore trigger when caller isn't admin/bd_head.
CREATE POLICY contacts_update_creator_or_head
    ON contacts FOR UPDATE
    USING (
        auth_role() IN ('admin','bd_head')
        OR created_by = auth.uid()
    )
    WITH CHECK (
        auth_role() IN ('admin','bd_head')
        OR created_by = auth.uid()
    );

-- DELETE (hard purge): admin/bd_head only. bd_manager cannot purge —
-- they can only archive via UPDATE deleted_at.
CREATE POLICY contacts_delete_head_admin
    ON contacts FOR DELETE
    USING (auth_role() IN ('admin','bd_head'));

-- Leadership: SELECT-only, served by contacts_select_all above. No
-- INSERT/UPDATE/DELETE policy needed — absence = denial under FORCE
-- RLS.

-- ---------------------------------------------------------------------------
-- 5) Backfill — one primary contact per company that has any
--    key_contact_* value. created_by left NULL; the audit trail will
--    show actor_id = NULL too (migration context, auth.uid() is null).
-- ---------------------------------------------------------------------------

INSERT INTO contacts (
    company_id, full_name, position, email, phone, is_primary, created_by
)
SELECT
    c.id,
    COALESCE(NULLIF(btrim(c.key_contact_name), ''), '(name unknown)'),
    NULLIF(btrim(c.key_contact_role),  ''),
    NULLIF(btrim(c.key_contact_email), ''),
    NULLIF(btrim(c.key_contact_phone), ''),
    true,
    NULL
  FROM companies c
 WHERE c.key_contact_name  IS NOT NULL
    OR c.key_contact_role  IS NOT NULL
    OR c.key_contact_email IS NOT NULL
    OR c.key_contact_phone IS NOT NULL;

-- Audit footprint of the backfill (one NOTICE for the manifest).
DO $$
DECLARE
    v_count int;
BEGIN
    SELECT count(*) INTO v_count
      FROM contacts
     WHERE deleted_at IS NULL;
    RAISE NOTICE '[0073] live contacts after backfill: %', v_count;
END
$$;
