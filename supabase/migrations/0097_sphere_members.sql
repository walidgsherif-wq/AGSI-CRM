-- 0097_sphere_members.sql
-- Sphere of Interest — a curated target-stakeholder membership list
-- so metrics can be measured against ~250 chosen targets instead of
-- the ~3.6k universe. Build A: the membership model + governance.
-- Build B (separate) wires denominators to it via a toggle.
--
-- Membership is a set (company is a member exactly once). Adding
-- captures WHO added and WHAT ROLE they had at add time, so the
-- remove-own governance rule can distinguish admin/bd_head additions
-- (untouchable by managers) from bd_manager additions (removable by
-- their author).
--
-- RLS is explicit — rls_auto_enable (0093) enables RLS on new tables
-- but does not install policies. Without policies ENABLE ROW LEVEL
-- SECURITY denies everything.

CREATE TABLE sphere_members (
    company_id     uuid        PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    added_by       uuid        NULL     REFERENCES profiles(id)  ON DELETE SET NULL,
    -- Captured at add time so a later role change on the profile
    -- doesn't retroactively reclassify who can remove this row.
    added_by_role  role_t      NOT NULL,
    added_at       timestamptz NOT NULL DEFAULT now(),
    note           text        NULL
);

COMMENT ON TABLE sphere_members IS
    'Curated target-stakeholder list. One row per company at most (PK '
    'is company_id). added_by_role is captured at insert time so the '
    'remove-own governance stays stable across role changes. Cascade '
    'from companies keeps the set honest if a company is hard-deleted; '
    'ON DELETE SET NULL on added_by preserves the row + role stamp when '
    'a profile is removed.';

CREATE INDEX sphere_members_added_by_idx
    ON sphere_members (added_by);

-- ── RLS ──────────────────────────────────────────────────────────

ALTER TABLE sphere_members ENABLE ROW LEVEL SECURITY;

-- Read: everyone authenticated — the sphere is a shared team view;
-- leadership + all BD roles need to see it (leadership won't write).
CREATE POLICY sphere_members_select_all
    ON sphere_members FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- Insert: BD team. The action layer stamps added_by = auth.uid() +
-- added_by_role from the caller's current profile role; the WITH CHECK
-- pins added_by to auth.uid() so a client can't spoof authorship.
CREATE POLICY sphere_members_insert_bd
    ON sphere_members FOR INSERT
    WITH CHECK (
        auth_role() IN ('admin','bd_head','bd_manager')
        AND added_by = auth.uid()
    );

-- Delete: admin + bd_head remove anything; bd_manager only rows they
-- added themselves. The added_by_role check on the manager branch is
-- what stops a manager from unpicking an admin/head-added row even
-- when THEY happen to also be recorded as added_by (they can't be,
-- since PK is company_id + insert stamps auth.uid, but the belt-and-
-- braces keeps intent obvious).
CREATE POLICY sphere_members_delete_admin_head
    ON sphere_members FOR DELETE
    USING (auth_role() IN ('admin','bd_head'));

CREATE POLICY sphere_members_delete_manager_own
    ON sphere_members FOR DELETE
    USING (
        auth_role() = 'bd_manager'
        AND added_by = auth.uid()
        AND added_by_role = 'bd_manager'
    );

-- No UPDATE policy — memberships aren't edited. To change the note
-- or reassign authorship, remove + re-add.

COMMENT ON POLICY sphere_members_delete_manager_own ON sphere_members IS
    'bd_manager can only remove sphere entries they themselves added '
    'while they were a bd_manager. Admin/bd_head-added rows are '
    'untouchable by managers even if they hold the same company_id.';
