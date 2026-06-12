-- 0054_rls_writes_h1_fix.sql
-- H1-fix · Scope structural writes to owner+head;
--         open additive logging (attributed);
--         leave reads transparent.
--
-- Reads stay transparent: this migration touches ZERO SELECT
-- policies. All roles continue to see all rows on companies,
-- engagements, tasks, notes, projects, project_companies,
-- documents.
--
-- Writes split into two patterns:
--   "additive logging"     — engagements/notes/documents INSERT:
--                            any BD role on any company, but the row
--                            MUST be attributed to the caller (anti-
--                            spoof via WITH CHECK on created_by /
--                            author_id / uploaded_by). Server-side
--                            stamping in src/server/actions already
--                            sets these to user.id, so this is a
--                            data-layer reinforcement of an existing
--                            invariant.
--   "structural mutation"  — projects.value_aed, project_companies
--                            links, mutations to engagements/notes/
--                            documents: bd_manager only on resources
--                            they own (own row OR own the linked
--                            company, per resource); bd_head & admin
--                            always; leadership never.
--
-- Spec-aligned bd_head step-in: wherever the prior policy let
-- bd_head UPDATE all but DELETE-own (engagements / tasks / notes),
-- DELETE is widened to all. bd_head is the sanctioned editor; the
-- DELETE/UPDATE split was an unintentional inconsistency.
--
-- Untouched:
--   - any SELECT / read policy
--   - tasks INSERT/UPDATE policies (already correctly scoped by
--     FX-014b / migration 0051)
--   - companies write policies (already correctly scoped)
--   - server actions beyond the existing created_by stamping (no
--     code change needed; stamping already in place)

-- =====================================================================
-- 1) projects — bd_manager UPDATE only on projects they own ≥1 linked
-- company for. DELETE: widen to bd_head.
-- =====================================================================

DROP POLICY IF EXISTS projects_update_ops        ON projects;
DROP POLICY IF EXISTS projects_update_admin_head ON projects;
DROP POLICY IF EXISTS projects_update_manager_owned ON projects;
DROP POLICY IF EXISTS projects_delete_admin      ON projects;
DROP POLICY IF EXISTS projects_delete_admin_head ON projects;

CREATE POLICY projects_update_admin_head
    ON projects FOR UPDATE
    USING (auth_role() IN ('admin','bd_head'))
    WITH CHECK (auth_role() IN ('admin','bd_head'));

CREATE POLICY projects_update_manager_owned
    ON projects FOR UPDATE
    USING (
        auth_role() = 'bd_manager'
        AND EXISTS (
            SELECT 1 FROM project_companies pc
            JOIN companies c ON c.id = pc.company_id
            WHERE pc.project_id = projects.id
              AND c.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        auth_role() = 'bd_manager'
        AND EXISTS (
            SELECT 1 FROM project_companies pc
            JOIN companies c ON c.id = pc.company_id
            WHERE pc.project_id = projects.id
              AND c.owner_id = auth.uid()
        )
    );

CREATE POLICY projects_delete_admin_head
    ON projects FOR DELETE
    USING (auth_role() IN ('admin','bd_head'));

-- INSERT (project shell): leave open to BD roles. The audit notes
-- this is unscoped today; the spec keeps it that way ("INSERT — leave
-- open to BD roles"). Policy below is identical to the original; we
-- DROP/CREATE so re-runs are idempotent.
DROP POLICY IF EXISTS projects_insert_ops ON projects;
CREATE POLICY projects_insert_ops
    ON projects FOR INSERT
    WITH CHECK (auth_role() IN ('admin','bd_head','bd_manager'));

-- =====================================================================
-- 2) project_companies — bd_manager INSERT/UPDATE/DELETE only when
-- the company_id is owned by auth.uid(). bd_head/admin: all.
-- =====================================================================

DROP POLICY IF EXISTS project_companies_write_ops          ON project_companies;
DROP POLICY IF EXISTS project_companies_write_admin_head   ON project_companies;
DROP POLICY IF EXISTS project_companies_write_manager_owned ON project_companies;

CREATE POLICY project_companies_write_admin_head
    ON project_companies FOR ALL
    USING (auth_role() IN ('admin','bd_head'))
    WITH CHECK (auth_role() IN ('admin','bd_head'));

CREATE POLICY project_companies_write_manager_owned
    ON project_companies FOR ALL
    USING (
        auth_role() = 'bd_manager'
        AND EXISTS (
            SELECT 1 FROM companies c
            WHERE c.id = project_companies.company_id
              AND c.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        auth_role() = 'bd_manager'
        AND EXISTS (
            SELECT 1 FROM companies c
            WHERE c.id = project_companies.company_id
              AND c.owner_id = auth.uid()
        )
    );

-- =====================================================================
-- 3) engagements — INSERT open + attributed; UPDATE/DELETE own +
-- bd_head/admin. bd_head DELETE widened from own-only to all.
-- =====================================================================

DROP POLICY IF EXISTS engagements_insert_ops        ON engagements;
DROP POLICY IF EXISTS engagements_update_admin_head ON engagements;
DROP POLICY IF EXISTS engagements_update_manager_own ON engagements;
DROP POLICY IF EXISTS engagements_delete_admin      ON engagements;
DROP POLICY IF EXISTS engagements_delete_admin_head ON engagements;
DROP POLICY IF EXISTS engagements_delete_own        ON engagements;
DROP POLICY IF EXISTS engagements_delete_manager_own ON engagements;

CREATE POLICY engagements_insert_ops
    ON engagements FOR INSERT
    WITH CHECK (
        auth_role() IN ('admin','bd_head','bd_manager')
        AND created_by = auth.uid()
    );

CREATE POLICY engagements_update_admin_head
    ON engagements FOR UPDATE
    USING (auth_role() IN ('admin','bd_head'))
    WITH CHECK (auth_role() IN ('admin','bd_head'));

CREATE POLICY engagements_update_manager_own
    ON engagements FOR UPDATE
    USING (auth_role() = 'bd_manager' AND created_by = auth.uid())
    WITH CHECK (auth_role() = 'bd_manager' AND created_by = auth.uid());

CREATE POLICY engagements_delete_admin_head
    ON engagements FOR DELETE
    USING (auth_role() IN ('admin','bd_head'));

CREATE POLICY engagements_delete_manager_own
    ON engagements FOR DELETE
    USING (auth_role() = 'bd_manager' AND created_by = auth.uid());

-- =====================================================================
-- 4) notes — INSERT open + attributed; UPDATE/DELETE own +
-- bd_head/admin. bd_head UPDATE/DELETE widened from own-only to all.
-- =====================================================================

DROP POLICY IF EXISTS notes_insert_ops        ON notes;
DROP POLICY IF EXISTS notes_update_admin      ON notes;
DROP POLICY IF EXISTS notes_update_admin_head ON notes;
DROP POLICY IF EXISTS notes_update_own        ON notes;
DROP POLICY IF EXISTS notes_update_manager_own ON notes;
DROP POLICY IF EXISTS notes_delete_admin      ON notes;
DROP POLICY IF EXISTS notes_delete_admin_head ON notes;
DROP POLICY IF EXISTS notes_delete_own        ON notes;
DROP POLICY IF EXISTS notes_delete_manager_own ON notes;

CREATE POLICY notes_insert_ops
    ON notes FOR INSERT
    WITH CHECK (
        auth_role() IN ('admin','bd_head','bd_manager')
        AND author_id = auth.uid()
    );

CREATE POLICY notes_update_admin_head
    ON notes FOR UPDATE
    USING (auth_role() IN ('admin','bd_head'))
    WITH CHECK (auth_role() IN ('admin','bd_head'));

CREATE POLICY notes_update_manager_own
    ON notes FOR UPDATE
    USING (auth_role() = 'bd_manager' AND author_id = auth.uid())
    WITH CHECK (auth_role() = 'bd_manager' AND author_id = auth.uid());

CREATE POLICY notes_delete_admin_head
    ON notes FOR DELETE
    USING (auth_role() IN ('admin','bd_head'));

CREATE POLICY notes_delete_manager_own
    ON notes FOR DELETE
    USING (auth_role() = 'bd_manager' AND author_id = auth.uid());

-- =====================================================================
-- 5) documents — INSERT open + attributed (uploaded_by); UPDATE/
-- DELETE owner-of-the-company + bd_head/admin. Note: differs from
-- engagements/notes — the spec scopes mutation to the company owner,
-- not to the uploader. Documents are shared artifacts; engagements
-- and notes are personal log entries. Orphan documents (no
-- company_id) fall to bd_head/admin only.
-- =====================================================================

DROP POLICY IF EXISTS documents_insert_ops          ON documents;
DROP POLICY IF EXISTS documents_update_admin_head   ON documents;
DROP POLICY IF EXISTS documents_update_manager_own  ON documents;
DROP POLICY IF EXISTS documents_update_manager_owned ON documents;
DROP POLICY IF EXISTS documents_delete_admin        ON documents;
DROP POLICY IF EXISTS documents_delete_admin_head   ON documents;
DROP POLICY IF EXISTS documents_delete_own          ON documents;
DROP POLICY IF EXISTS documents_delete_manager_owned ON documents;

CREATE POLICY documents_insert_ops
    ON documents FOR INSERT
    WITH CHECK (
        auth_role() IN ('admin','bd_head','bd_manager')
        AND uploaded_by = auth.uid()
    );

CREATE POLICY documents_update_admin_head
    ON documents FOR UPDATE
    USING (auth_role() IN ('admin','bd_head'))
    WITH CHECK (auth_role() IN ('admin','bd_head'));

CREATE POLICY documents_update_manager_owned
    ON documents FOR UPDATE
    USING (
        auth_role() = 'bd_manager'
        AND documents.company_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM companies c
            WHERE c.id = documents.company_id
              AND c.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        auth_role() = 'bd_manager'
        AND documents.company_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM companies c
            WHERE c.id = documents.company_id
              AND c.owner_id = auth.uid()
        )
    );

CREATE POLICY documents_delete_admin_head
    ON documents FOR DELETE
    USING (auth_role() IN ('admin','bd_head'));

CREATE POLICY documents_delete_manager_owned
    ON documents FOR DELETE
    USING (
        auth_role() = 'bd_manager'
        AND documents.company_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM companies c
            WHERE c.id = documents.company_id
              AND c.owner_id = auth.uid()
        )
    );

-- =====================================================================
-- 6) tasks — DELETE widened: bd_head can now DELETE any task
-- (matches the existing UPDATE-all policy). bd_manager DELETE-own
-- is preserved. INSERT/UPDATE policies were correctly scoped by
-- FX-014b / migration 0051 — untouched.
-- =====================================================================

DROP POLICY IF EXISTS tasks_delete_admin        ON tasks;
DROP POLICY IF EXISTS tasks_delete_admin_head   ON tasks;
DROP POLICY IF EXISTS tasks_delete_own          ON tasks;
DROP POLICY IF EXISTS tasks_delete_manager_own  ON tasks;

CREATE POLICY tasks_delete_admin_head
    ON tasks FOR DELETE
    USING (auth_role() IN ('admin','bd_head'));

CREATE POLICY tasks_delete_manager_own
    ON tasks FOR DELETE
    USING (auth_role() = 'bd_manager' AND owner_id = auth.uid());
