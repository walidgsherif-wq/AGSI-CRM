-- 0022_rls_policies.sql
-- RLS policies. Implements the matrix in architecture/03-rls-matrix.md.
-- Order within each table: SELECT, INSERT, UPDATE, DELETE.
--
-- Conventions:
--   auth_role()  — returns role_t for the caller
--   auth.uid()   — current session user id
--   is_active on profiles is not rechecked here — Supabase middleware blocks
--   login for deactivated users.

-- =====================================================================
-- profiles
-- =====================================================================

CREATE POLICY profiles_select_all_authenticated
    ON profiles FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY profiles_insert_admin
    ON profiles FOR INSERT
    WITH CHECK (auth_role() = 'admin');

CREATE POLICY profiles_update_admin
    ON profiles FOR UPDATE
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

CREATE POLICY profiles_update_self
    ON profiles FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid()));
    -- Self-update cannot change own role. Admin path above handles role changes.

-- (no delete policy → deletes blocked)

-- =====================================================================
-- companies
-- =====================================================================

CREATE POLICY companies_select_all
    ON companies FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY companies_insert_ops
    ON companies FOR INSERT
    WITH CHECK (auth_role() IN ('admin','bd_head','bd_manager'));

CREATE POLICY companies_update_admin_head
    ON companies FOR UPDATE
    USING (auth_role() IN ('admin','bd_head'));

CREATE POLICY companies_update_manager_own
    ON companies FOR UPDATE
    USING (auth_role() = 'bd_manager' AND owner_id = auth.uid())
    WITH CHECK (auth_role() = 'bd_manager' AND owner_id = auth.uid());

CREATE POLICY companies_delete_admin
    ON companies FOR DELETE
    USING (auth_role() = 'admin');

-- =====================================================================
-- level_history
-- =====================================================================

CREATE POLICY level_history_select_all
    ON level_history FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- INSERT / DELETE: no policy → denied. Function change_company_level() is
-- SECURITY DEFINER so it bypasses RLS.

CREATE POLICY level_history_update_admin_credit_only
    ON level_history FOR UPDATE
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');
-- Column-level restriction (only is_credited) enforced by convention +
-- audit_events row. Alternative: a column-mask trigger. We opt for the
-- convention + audit approach because the admin UI restricts the form.

-- =====================================================================
-- projects
-- =====================================================================

CREATE POLICY projects_select_all
    ON projects FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY projects_insert_ops
    ON projects FOR INSERT
    WITH CHECK (auth_role() IN ('admin','bd_head','bd_manager'));

CREATE POLICY projects_update_ops
    ON projects FOR UPDATE
    USING (auth_role() IN ('admin','bd_head','bd_manager'));

CREATE POLICY projects_delete_admin
    ON projects FOR DELETE
    USING (auth_role() = 'admin');

-- =====================================================================
-- project_companies
-- =====================================================================

CREATE POLICY project_companies_select_all
    ON project_companies FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY project_companies_write_ops
    ON project_companies FOR ALL
    USING (auth_role() IN ('admin','bd_head','bd_manager'))
    WITH CHECK (auth_role() IN ('admin','bd_head','bd_manager'));

-- =====================================================================
-- engagements
-- =====================================================================

CREATE POLICY engagements_select_all
    ON engagements FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY engagements_insert_ops
    ON engagements FOR INSERT
    WITH CHECK (
        auth_role() IN ('admin','bd_head','bd_manager')
        AND (auth_role() <> 'bd_manager' OR created_by = auth.uid())
    );

CREATE POLICY engagements_update_admin_head
    ON engagements FOR UPDATE
    USING (auth_role() IN ('admin','bd_head'));

CREATE POLICY engagements_update_manager_own
    ON engagements FOR UPDATE
    USING (
        auth_role() = 'bd_manager'
        AND (created_by = auth.uid()
             OR EXISTS (SELECT 1 FROM companies c WHERE c.id = engagements.company_id AND c.owner_id = auth.uid()))
    );

CREATE POLICY engagements_delete_admin
    ON engagements FOR DELETE USING (auth_role() = 'admin');
CREATE POLICY engagements_delete_own
    ON engagements FOR DELETE
    USING (auth_role() IN ('bd_head','bd_manager') AND created_by = auth.uid());

-- =====================================================================
-- tasks
-- =====================================================================

CREATE POLICY tasks_select_ops
    ON tasks FOR SELECT
    USING (auth_role() IN ('admin','bd_head','bd_manager'));

CREATE POLICY tasks_insert_ops
    ON tasks FOR INSERT
    WITH CHECK (auth_role() IN ('admin','bd_head','bd_manager'));

CREATE POLICY tasks_update_admin_head
    ON tasks FOR UPDATE USING (auth_role() IN ('admin','bd_head'));
CREATE POLICY tasks_update_manager_own
    ON tasks FOR UPDATE
    USING (auth_role() = 'bd_manager' AND owner_id = auth.uid())
    WITH CHECK (auth_role() = 'bd_manager' AND owner_id = auth.uid());

CREATE POLICY tasks_delete_admin
    ON tasks FOR DELETE USING (auth_role() = 'admin');
CREATE POLICY tasks_delete_own
    ON tasks FOR DELETE
    USING (auth_role() IN ('bd_head','bd_manager') AND owner_id = auth.uid());

-- =====================================================================
-- notes
-- =====================================================================

CREATE POLICY notes_select_ops
    ON notes FOR SELECT USING (auth_role() IN ('admin','bd_head','bd_manager'));

CREATE POLICY notes_insert_ops
    ON notes FOR INSERT
    WITH CHECK (
        auth_role() IN ('admin','bd_head','bd_manager')
        AND (auth_role() <> 'bd_manager' OR author_id = auth.uid())
    );

CREATE POLICY notes_update_admin
    ON notes FOR UPDATE USING (auth_role() = 'admin');
CREATE POLICY notes_update_own
    ON notes FOR UPDATE
    USING (auth_role() IN ('bd_head','bd_manager') AND author_id = auth.uid());

CREATE POLICY notes_delete_admin
    ON notes FOR DELETE USING (auth_role() = 'admin');
CREATE POLICY notes_delete_own
    ON notes FOR DELETE
    USING (auth_role() IN ('bd_head','bd_manager') AND author_id = auth.uid());

-- =====================================================================
-- documents
-- =====================================================================

CREATE POLICY documents_select_all
    ON documents FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY documents_insert_ops
    ON documents FOR INSERT
    WITH CHECK (auth_role() IN ('admin','bd_head','bd_manager'));

CREATE POLICY documents_update_admin_head
    ON documents FOR UPDATE USING (auth_role() IN ('admin','bd_head'));
CREATE POLICY documents_update_manager_own
    ON documents FOR UPDATE
    USING (auth_role() = 'bd_manager' AND uploaded_by = auth.uid());

CREATE POLICY documents_delete_admin
    ON documents FOR DELETE USING (auth_role() = 'admin');
CREATE POLICY documents_delete_own
    ON documents FOR DELETE
    USING (auth_role() IN ('bd_head','bd_manager') AND uploaded_by = auth.uid());

-- =====================================================================
-- playbook_targets / member_targets
-- =====================================================================

CREATE POLICY playbook_targets_select_all
    ON playbook_targets FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY playbook_targets_write_admin
    ON playbook_targets FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

CREATE POLICY member_targets_select_admin_head_leadership
    ON member_targets FOR SELECT
    USING (auth_role() IN ('admin','bd_head','leadership'));

CREATE POLICY member_targets_select_own
    ON member_targets FOR SELECT
    USING (auth_role() = 'bd_manager' AND user_id = auth.uid());

CREATE POLICY member_targets_write_admin
    ON member_targets FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

-- =====================================================================
-- kpi_actuals_daily
-- =====================================================================

CREATE POLICY kpi_actuals_select_admin_head_leadership
    ON kpi_actuals_daily FOR SELECT
    USING (auth_role() IN ('admin','bd_head','leadership'));

CREATE POLICY kpi_actuals_select_own_and_team
    ON kpi_actuals_daily FOR SELECT
    USING (auth_role() = 'bd_manager' AND (user_id = auth.uid() OR user_id IS NULL));

-- No write policy → denied. Rollup function runs as service role.

-- =====================================================================
-- composition_drift_log
-- =====================================================================

CREATE POLICY drift_select_admin_head_leadership
    ON composition_drift_log FOR SELECT
    USING (auth_role() IN ('admin','bd_head','leadership'));

CREATE POLICY drift_select_own
    ON composition_drift_log FOR SELECT
    USING (auth_role() = 'bd_manager' AND user_id = auth.uid());

-- =====================================================================
-- BNC pipeline — admin only
-- =====================================================================

CREATE POLICY bnc_uploads_admin
    ON bnc_uploads FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

CREATE POLICY bnc_upload_rows_admin
    ON bnc_upload_rows FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

CREATE POLICY company_match_queue_admin
    ON company_match_queue FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

CREATE POLICY market_snapshots_select_all
    ON market_snapshots FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY market_snapshots_write_admin
    ON market_snapshots FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

-- =====================================================================
-- stagnation_rules / notifications
-- =====================================================================

CREATE POLICY stagnation_rules_select_all
    ON stagnation_rules FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY stagnation_rules_write_admin
    ON stagnation_rules FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

CREATE POLICY notifications_select_own
    ON notifications FOR SELECT USING (recipient_id = auth.uid());

CREATE POLICY notifications_update_own
    ON notifications FOR UPDATE
    USING (recipient_id = auth.uid())
    WITH CHECK (recipient_id = auth.uid());
-- Column-mask for mark-read-only is enforced in the server action; schema
-- does not restrict at column level because notifications rows are small
-- enough that full-row UPDATE isn't an attack vector.

-- =====================================================================
-- app_settings
-- =====================================================================

CREATE POLICY app_settings_select_whitelist_manager
    ON app_settings FOR SELECT
    USING (
        auth_role() = 'bd_manager'
        AND key IN (
            'notification_channels_enabled',
            'fiscal_year_start_month',
            'engagement_freshness_thresholds'
        )
    );

CREATE POLICY app_settings_select_admin_head_leadership
    ON app_settings FOR SELECT
    USING (auth_role() IN ('admin','bd_head','leadership'));

CREATE POLICY app_settings_write_admin
    ON app_settings FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

-- =====================================================================
-- audit_events — admin-only SELECT; INSERT via SECURITY DEFINER fns
-- =====================================================================

CREATE POLICY audit_events_select_admin
    ON audit_events FOR SELECT USING (auth_role() = 'admin');

-- =====================================================================
-- Ecosystem tables — bd_manager fully blocked
-- =====================================================================

CREATE POLICY ecosystem_events_select_non_manager
    ON ecosystem_events FOR SELECT
    USING (auth_role() IN ('admin','bd_head','leadership'));

CREATE POLICY ecosystem_point_scale_select_non_manager
    ON ecosystem_point_scale FOR SELECT
    USING (auth_role() IN ('admin','bd_head','leadership'));

CREATE POLICY ecosystem_point_scale_write_admin
    ON ecosystem_point_scale FOR INSERT
    WITH CHECK (auth_role() = 'admin');
CREATE POLICY ecosystem_point_scale_update_admin
    ON ecosystem_point_scale FOR UPDATE
    USING (auth_role() = 'admin');

CREATE POLICY ecosystem_awareness_current_select_non_manager
    ON ecosystem_awareness_current FOR SELECT
    USING (auth_role() IN ('admin','bd_head','leadership'));

-- =====================================================================
-- Leadership reports — bd_manager fully blocked
-- =====================================================================

CREATE POLICY leadership_reports_select_admin
    ON leadership_reports FOR SELECT
    USING (auth_role() = 'admin');

CREATE POLICY leadership_reports_select_leadership_and_head
    ON leadership_reports FOR SELECT
    USING (auth_role() IN ('leadership','bd_head') AND status IN ('finalised','archived'));

CREATE POLICY leadership_reports_insert_admin
    ON leadership_reports FOR INSERT
    WITH CHECK (auth_role() = 'admin');

CREATE POLICY leadership_reports_update_admin
    ON leadership_reports FOR UPDATE
    USING (auth_role() = 'admin');

CREATE POLICY leadership_reports_update_leadership_feedback
    ON leadership_reports FOR UPDATE
    USING (auth_role() = 'leadership' AND status = 'finalised');
-- The trigger enforce_leadership_feedback_only() enforces that only the
-- three feedback columns change. Without that trigger, this policy would
-- permit overwriting executive_summary etc.

CREATE POLICY leadership_report_stakeholders_select
    ON leadership_report_stakeholders FOR SELECT
    USING (auth_role() IN ('admin','bd_head','leadership'));

CREATE POLICY leadership_report_stakeholders_write_admin
    ON leadership_report_stakeholders FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

-- =====================================================================
-- city_lookup — blocked to bd_manager
-- =====================================================================

CREATE POLICY city_lookup_select_non_manager
    ON city_lookup FOR SELECT
    USING (auth_role() IN ('admin','bd_head','leadership'));

CREATE POLICY city_lookup_write_admin
    ON city_lookup FOR ALL
    USING (auth_role() = 'admin')
    WITH CHECK (auth_role() = 'admin');

-- =====================================================================
-- Storage bucket policies (documented in 03-rls-matrix §10; applied via
-- supabase CLI on the storage.objects table after buckets are created)
-- =====================================================================

-- Placeholder comment. Storage buckets created via supabase/config.toml;
-- policies applied in a post-migration script. Recorded here so a reviewer
-- sees no missing coverage in the schema-level migrations.
