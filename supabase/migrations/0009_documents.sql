-- 0009_documents.sql
-- Signed artefacts. Prompt §3.7.
-- Driver D reads this table for announcements / site_banner_approval / case_study.

CREATE TABLE documents (
    id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid              NULL REFERENCES companies(id) ON DELETE SET NULL,
    project_id      uuid              NULL REFERENCES projects(id)  ON DELETE SET NULL,
    doc_type        document_type_t   NOT NULL,
    title           text              NOT NULL,
    storage_path    text              NOT NULL,
    signed_date     date              NULL,
    expiry_date     date              NULL,
    uploaded_by     uuid              NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    -- §16 Q5: auto-archive sweep flips is_archived=true after retention window.
    -- UI filters archived out by default; admin has "Show archived" toggle.
    -- Storage blob retained so restore is one-click.
    is_archived     boolean           NOT NULL DEFAULT false,
    archived_at     timestamptz       NULL,
    archived_reason text              NULL,  -- 'retention_sweep' or 'admin_manual'
    created_at      timestamptz       NOT NULL DEFAULT now(),
    updated_at      timestamptz       NOT NULL DEFAULT now(),
    CONSTRAINT documents_one_parent
        CHECK (company_id IS NOT NULL OR project_id IS NOT NULL),
    CONSTRAINT documents_expiry_after_signed
        CHECK (expiry_date IS NULL OR signed_date IS NULL OR expiry_date >= signed_date),
    CONSTRAINT documents_archived_has_timestamp
        CHECK ((is_archived = false) OR (archived_at IS NOT NULL))
);

CREATE INDEX documents_doc_type_signed_idx ON documents (doc_type, signed_date DESC);
CREATE INDEX documents_company_idx         ON documents (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX documents_project_idx         ON documents (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX documents_uploaded_by_idx     ON documents (uploaded_by);

-- Driver D targeting: partial covering index for the rollup query.
-- Explicit enum casts so the predicate is IMMUTABLE under PG15.
CREATE INDEX documents_driver_d_idx ON documents (uploaded_by, doc_type, signed_date)
    WHERE doc_type = 'announcement'::document_type_t
       OR doc_type = 'site_banner_approval'::document_type_t
       OR doc_type = 'case_study'::document_type_t;

-- Retention sweep: find un-archived docs older than threshold
CREATE INDEX documents_retention_sweep_idx ON documents (signed_date)
    WHERE is_archived = false AND signed_date IS NOT NULL;

-- Default UI filter: hide archived
CREATE INDEX documents_active_idx ON documents (company_id, doc_type)
    WHERE is_archived = false;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
