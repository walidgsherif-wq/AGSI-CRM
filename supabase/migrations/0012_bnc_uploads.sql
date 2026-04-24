-- 0012_bnc_uploads.sql
-- BNC ingest tables. Prompt §3.10 + §4.
-- Backfills FKs on companies / projects / project_companies that pointed at
-- bnc_uploads.id before this migration existed.

CREATE TABLE bnc_uploads (
    id                      uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
    filename                text                    NOT NULL,
    storage_path            text                    NOT NULL,
    uploaded_by             uuid                    NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    uploaded_at             timestamptz             NOT NULL DEFAULT now(),
    file_date               date                    NULL,
    row_count               int                     NOT NULL DEFAULT 0,
    status                  bnc_upload_status_t     NOT NULL DEFAULT 'pending',
    error_log               text                    NULL,
    new_projects            int                     NOT NULL DEFAULT 0,
    updated_projects        int                     NOT NULL DEFAULT 0,
    dormant_projects        int                     NOT NULL DEFAULT 0,
    new_companies           int                     NOT NULL DEFAULT 0,
    matched_companies       int                     NOT NULL DEFAULT 0,
    unmatched_companies     int                     NOT NULL DEFAULT 0,
    created_at              timestamptz             NOT NULL DEFAULT now(),
    updated_at              timestamptz             NOT NULL DEFAULT now()
);

CREATE INDEX bnc_uploads_file_date_idx ON bnc_uploads (file_date);
CREATE INDEX bnc_uploads_status_idx    ON bnc_uploads (status) WHERE status IN ('pending','processing');

ALTER TABLE bnc_uploads ENABLE ROW LEVEL SECURITY;

-- Backfill FKs from earlier tables -----------------------------------------

ALTER TABLE companies
    ADD CONSTRAINT companies_last_seen_upload_fk
    FOREIGN KEY (last_seen_in_upload_id) REFERENCES bnc_uploads(id) ON DELETE SET NULL;

ALTER TABLE projects
    ADD CONSTRAINT projects_last_seen_upload_fk
    FOREIGN KEY (last_seen_in_upload_id) REFERENCES bnc_uploads(id) ON DELETE SET NULL;

ALTER TABLE project_companies
    ADD CONSTRAINT project_companies_last_seen_upload_fk
    FOREIGN KEY (last_seen_in_upload_id) REFERENCES bnc_uploads(id) ON DELETE SET NULL;

-- Raw row cache ------------------------------------------------------------

CREATE TABLE bnc_upload_rows (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id             uuid        NOT NULL REFERENCES bnc_uploads(id) ON DELETE CASCADE,
    row_index             int         NOT NULL,
    raw_data              jsonb       NOT NULL,
    project_ref           text        NULL,
    resolved_project_id   uuid        NULL REFERENCES projects(id) ON DELETE SET NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (upload_id, row_index)
);

CREATE INDEX bnc_upload_rows_upload_idx    ON bnc_upload_rows (upload_id);
CREATE INDEX bnc_upload_rows_project_idx   ON bnc_upload_rows (resolved_project_id) WHERE resolved_project_id IS NOT NULL;

ALTER TABLE bnc_upload_rows ENABLE ROW LEVEL SECURITY;

-- Match queue --------------------------------------------------------------

CREATE TABLE company_match_queue (
    id                    uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id             uuid                    NOT NULL REFERENCES bnc_uploads(id) ON DELETE CASCADE,
    raw_name              text                    NOT NULL,
    suggested_company_id  uuid                    NULL REFERENCES companies(id) ON DELETE SET NULL,
    similarity_score      numeric                 NULL,
    status                match_queue_status_t    NOT NULL DEFAULT 'pending',
    resolved_by           uuid                    NULL REFERENCES profiles(id) ON DELETE SET NULL,
    resolved_at           timestamptz             NULL,
    created_at            timestamptz             NOT NULL DEFAULT now()
);

CREATE INDEX company_match_queue_upload_idx ON company_match_queue (upload_id, status);
CREATE INDEX company_match_queue_pending_idx ON company_match_queue (status) WHERE status = 'pending';

ALTER TABLE company_match_queue ENABLE ROW LEVEL SECURITY;
