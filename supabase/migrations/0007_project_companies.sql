-- 0007_project_companies.sql
-- Many-to-many link between projects and companies, with role context.
-- Prompt §3.5.

CREATE TABLE project_companies (
    id                      uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id              uuid                    NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
    company_id              uuid                    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    role                    project_company_role_t  NOT NULL,
    raw_name_from_bnc       text                    NULL,
    first_seen_at           timestamptz             NOT NULL DEFAULT now(),
    last_seen_in_upload_id  uuid                    NULL, -- FK set in 0012
    last_seen_in_upload_at  timestamptz             NULL,
    is_current              boolean                 NOT NULL DEFAULT true,
    created_at              timestamptz             NOT NULL DEFAULT now(),
    updated_at              timestamptz             NOT NULL DEFAULT now(),
    UNIQUE (project_id, company_id, role)
);

COMMENT ON COLUMN project_companies.raw_name_from_bnc IS
    'Exact string as it appeared in the BNC cell. Preserved for audit / manual review.';

CREATE INDEX project_companies_project_idx ON project_companies (project_id);
CREATE INDEX project_companies_company_idx ON project_companies (company_id) WHERE is_current = true;

ALTER TABLE project_companies ENABLE ROW LEVEL SECURITY;
