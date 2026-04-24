-- 0006_projects.sql
-- BNC project records. Prompt §3.4.
-- BNC fields are read-only to BDMs; AGSI-internal fields (agsi_priority,
-- agsi_internal_notes) are editable.

CREATE TABLE projects (
    id                              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    bnc_reference_number            text                NULL UNIQUE,  -- source of truth for BNC resolver
    name                            text                NOT NULL,
    project_type                    text                NULL,
    stage                           project_stage_t     NOT NULL DEFAULT 'concept',
    stage_last_updated_at           timestamptz         NULL,
    value_usd                       numeric(18,2)       NULL,
    value_aed                       numeric(18,2)       NULL,
    city                            text                NULL,
    location                        text                NULL,
    sector                          text                NULL,
    industry                        text                NULL,
    estimated_completion_date       date                NULL,
    completion_percentage           numeric(5,2)        NULL
        CHECK (completion_percentage IS NULL OR completion_percentage BETWEEN 0 AND 100),
    profile_type                    text                NULL,
    est_main_contractor_award_date  date                NULL,
    main_contractor_award_value     numeric(18,2)       NULL,
    last_seen_in_upload_id          uuid                NULL, -- FK set in 0012
    last_seen_in_upload_at          timestamptz         NULL,
    is_dormant                      boolean             NOT NULL DEFAULT false,
    agsi_priority                   project_priority_t  NULL,
    agsi_internal_notes             text                NULL,
    created_at                      timestamptz         NOT NULL DEFAULT now(),
    updated_at                      timestamptz         NOT NULL DEFAULT now()
);

CREATE INDEX projects_stage_idx           ON projects (stage) WHERE is_dormant = false;
CREATE INDEX projects_city_idx            ON projects (city);
CREATE INDEX projects_sector_idx          ON projects (sector);
CREATE INDEX projects_completion_idx      ON projects (estimated_completion_date)
    WHERE is_dormant = false AND stage <> 'completed';
CREATE INDEX projects_bnc_ref_idx         ON projects (bnc_reference_number);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
