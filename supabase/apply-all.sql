-- AGSI CRM — combined M2 migration bundle
-- Generated 2026-04-24T16:39:20+00:00
-- From supabase/migrations/0001..0023 + seed.sql
-- Paste into the Supabase SQL Editor and click Run.


-- ============================================================
-- 0001_extensions.sql
-- ============================================================
-- 0001_extensions.sql
-- Postgres extensions needed across the schema.
-- pgcrypto: gen_random_uuid() for all PKs
-- pg_trgm:  fuzzy similarity() for BNC company resolver (§4.3)
-- citext:   case-insensitive unique on profiles.email
-- pg_cron:  scheduled Edge Function invocation (nightly rebuild, weekly drift, etc)
-- pg_net:   HTTP client for cron jobs to invoke Edge Functions

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- pg_cron and pg_net are Supabase-managed — they must be enabled via
-- Dashboard → Database → Extensions BEFORE this migration runs. If they are
-- missing, the cron schedules in 0021 are skipped (wrapped in a guard).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================
-- 0002_enums.sql
-- ============================================================
-- 0002_enums.sql
-- Every enum used by the schema. Collected in one file so the catalogue is
-- reviewable in a single read. Ordering: identity → stakeholder → pipeline →
-- KPI → ops.

-- Identity ---------------------------------------------------------------

CREATE TYPE role_t AS ENUM ('admin', 'leadership', 'bd_head', 'bd_manager');

-- Stakeholder ------------------------------------------------------------

CREATE TYPE company_type_t AS ENUM (
    'developer',
    'design_consultant',
    'main_contractor',
    'mep_consultant',
    'mep_contractor',
    'authority',
    'other'
);

CREATE TYPE company_source_t AS ENUM ('bnc_upload', 'manual', 'merged');

CREATE TYPE level_t AS ENUM ('L0', 'L1', 'L2', 'L3', 'L4', 'L5');

-- Pipeline ---------------------------------------------------------------

CREATE TYPE project_stage_t AS ENUM (
    'concept',
    'design',
    'tender',
    'tender_submission',
    'tender_evaluation',
    'under_construction',
    'completed',
    'on_hold',
    'cancelled'
);

CREATE TYPE project_priority_t AS ENUM ('tier_1', 'tier_2', 'tier_3', 'watchlist');

CREATE TYPE project_company_role_t AS ENUM (
    'owner',
    'design_consultant',
    'main_contractor',
    'mep_consultant',
    'mep_contractor',
    'other'
);

-- Engagement / work ------------------------------------------------------

CREATE TYPE engagement_type_t AS ENUM (
    'call',
    'meeting',
    'email',
    'site_visit',
    'workshop',
    'document_sent',
    'mou_discussion',
    'tripartite_discussion',
    'spec_inclusion',
    'design_stage_intro',
    'consultant_approval',
    'other'
);

CREATE TYPE task_priority_t AS ENUM ('low', 'med', 'high', 'urgent');
CREATE TYPE task_status_t   AS ENUM ('open', 'in_progress', 'done', 'cancelled');
CREATE TYPE task_source_t   AS ENUM ('manual', 'stagnation_alert', 'system');

CREATE TYPE document_type_t AS ENUM (
    'mou_developer',
    'mou_consultant',
    'mou_contractor',
    'tripartite',
    'epd',
    'case_study',
    'site_banner_approval',
    'announcement',
    'spec_template',
    'other'
);

-- KPI --------------------------------------------------------------------

CREATE TYPE driver_t AS ENUM ('A', 'B', 'C', 'D');

CREATE TYPE target_override_t AS ENUM ('playbook_default', 'custom');

-- BNC pipeline -----------------------------------------------------------

CREATE TYPE bnc_upload_status_t AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TYPE match_queue_status_t AS ENUM ('pending', 'approved', 'rejected', 'merged');

-- Ops --------------------------------------------------------------------

CREATE TYPE notification_type_t AS ENUM (
    'stagnation_warning',
    'stagnation_breach',
    'task_due',
    'task_overdue',
    'level_change',
    'upload_complete',
    'upload_failed',
    'unmatched_company',
    'composition_warning',
    'composition_drift',
    'bnc_stale_reminder',            -- §16 Q4: admin reminder when no BNC upload in N days
    'document_archived',             -- §16 Q5: document auto-archive sweep
    'ownership_transferred',         -- §16 Q8: credit history moved to new owner
    'mention'
);

CREATE TYPE stagnation_escalation_role_t AS ENUM ('bd_head', 'admin');

CREATE TYPE leadership_report_type_t AS ENUM ('monthly_snapshot', 'quarterly_strategic');
CREATE TYPE leadership_report_status_t AS ENUM ('draft', 'finalised', 'archived');

-- ============================================================
-- 0003_profiles.sql
-- ============================================================
-- 0003_profiles.sql
-- User profiles. 1:1 with auth.users. Role gate at application boundary.

CREATE TABLE profiles (
    id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name   text        NOT NULL,
    email       citext      NOT NULL UNIQUE,
    role        role_t      NOT NULL DEFAULT 'bd_manager',
    phone_e164  text        NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    invited_by  uuid        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    invited_at  timestamptz NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profiles_phone_e164_ck
        CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$')
);

COMMENT ON TABLE profiles IS
    'Application-level identity. Supabase auth.users is auth only; this table is the profile of record.';

-- Row-level security (policies in 0022)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0004_companies.sql
-- ============================================================
-- 0004_companies.sql
-- Canonical stakeholder master. Prompt §3.2.
-- Single-owner enforced at data level (owner_id uniqueness not enforced — a
-- profile owns many companies; a company has at most one owner, enforced by
-- column NOT being a link table).
-- current_level is the CACHED value of the latest level_history row; writes
-- go through change_company_level() only (trigger in 0021).

CREATE TABLE companies (
    id                          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name              text            NOT NULL,
    aliases                     text[]          NOT NULL DEFAULT ARRAY[]::text[],
    company_type                company_type_t  NOT NULL,
    country                     text            NOT NULL DEFAULT 'United Arab Emirates',
    city                        text            NULL,
    phone                       text            NULL,
    email                       text            NULL,
    website                     text            NULL,
    key_contact_name            text            NULL,
    key_contact_role            text            NULL,
    key_contact_email           text            NULL,
    key_contact_phone           text            NULL,
    notes_internal              text            NULL,
    -- derived flag, recomputed by trigger + BNC pipeline
    is_in_kpi_universe          boolean         NOT NULL
        GENERATED ALWAYS AS (company_type IN ('developer','design_consultant','main_contractor')) STORED,
    current_level               level_t         NOT NULL DEFAULT 'L0',
    level_changed_at            timestamptz     NULL,
    has_active_projects         boolean         NOT NULL DEFAULT false,
    last_seen_in_upload_id      uuid            NULL, -- FK added in 0012 after bnc_uploads exists
    last_seen_in_upload_at      timestamptz     NULL,
    owner_id                    uuid            NULL REFERENCES profiles(id) ON DELETE SET NULL,
    owner_assigned_at           timestamptz     NULL,
    source                      company_source_t NOT NULL DEFAULT 'manual',
    is_active                   boolean         NOT NULL DEFAULT true,
    is_key_stakeholder          boolean         NOT NULL DEFAULT false,
    created_at                  timestamptz     NOT NULL DEFAULT now(),
    updated_at                  timestamptz     NOT NULL DEFAULT now(),
    CONSTRAINT companies_canonical_name_not_blank
        CHECK (length(trim(canonical_name)) > 0)
);

COMMENT ON COLUMN companies.is_in_kpi_universe IS
    'Auto-derived: developers + design_consultants + main_contractors count toward Drivers A/B/C.';
COMMENT ON COLUMN companies.current_level IS
    'Cached from latest level_history row. Direct writes rejected — use change_company_level().';
COMMENT ON COLUMN companies.is_key_stakeholder IS
    'Admin-marked. Surfaces prominently in leadership reports (§3.17).';

-- Unique canonical name (case-insensitive) to prevent accidental duplicates
-- from manual-entry flow. BNC pipeline uses fuzzy match before insert, so this
-- only fires on same-string duplicates.
CREATE UNIQUE INDEX companies_canonical_name_ci_uq
    ON companies (lower(canonical_name));

-- Fuzzy-match index for BNC resolver (§4.3)
CREATE INDEX companies_canonical_name_trgm
    ON companies USING gin (canonical_name gin_trgm_ops);

-- The polymorphic array_to_string(anyarray, text) is marked STABLE by
-- Postgres 15 on the Supabase platform, which disqualifies it from use in
-- an index expression. Wrap it in a concretely-typed IMMUTABLE function
-- so the GIN trgm index on aliases can be built. text[] → text conversion
-- has no hidden time-zone / locale dependency so this is truthfully
-- IMMUTABLE.
CREATE OR REPLACE FUNCTION agsi_aliases_to_text(a text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$ SELECT coalesce(array_to_string(a, ' '), '') $$;

CREATE INDEX companies_aliases_trgm
    ON companies USING gin (agsi_aliases_to_text(aliases) gin_trgm_ops);

CREATE INDEX companies_owner_id_idx    ON companies (owner_id) WHERE is_active = true;
CREATE INDEX companies_current_level_idx ON companies (current_level) WHERE is_active = true;
CREATE INDEX companies_company_type_idx ON companies (company_type);
CREATE INDEX companies_has_active_projects_idx ON companies (has_active_projects) WHERE has_active_projects = true;
CREATE INDEX companies_is_key_stakeholder_idx ON companies (is_key_stakeholder) WHERE is_key_stakeholder = true;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0005_level_history.sql
-- ============================================================
-- 0005_level_history.sql
-- The immutable scoring ledger. Prompt §3.3 — "non-negotiable."
-- Every level change writes one row. is_forward + is_credited gate whether
-- the row counts toward Driver A/B/C.

CREATE TABLE level_history (
    id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              uuid         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    from_level              level_t      NOT NULL,
    to_level                level_t      NOT NULL,
    changed_by              uuid         NULL REFERENCES profiles(id) ON DELETE SET NULL,
    owner_at_time           uuid         NULL REFERENCES profiles(id) ON DELETE SET NULL,
    company_type_at_time    company_type_t NOT NULL,
    changed_at              timestamptz  NOT NULL DEFAULT now(),
    fiscal_year             int          NOT NULL,
    fiscal_quarter          int          NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
    evidence_note           text         NULL,
    evidence_file_url       text         NULL,
    is_forward              boolean      NOT NULL,
    is_credited             boolean      NOT NULL DEFAULT true,
    created_at              timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT level_history_not_same
        CHECK (from_level <> to_level)
);

COMMENT ON TABLE level_history IS
    'Immutable ledger. INSERT only via change_company_level(). is_credited may be toggled by admin only.';
COMMENT ON COLUMN level_history.owner_at_time IS
    'Snapshot of companies.owner_id at transition time. Scoring credit attributes here, never to current owner.';
COMMENT ON COLUMN level_history.company_type_at_time IS
    'Snapshot of companies.company_type at transition time. Driver B composition uses this.';

CREATE INDEX level_history_company_idx     ON level_history (company_id, changed_at DESC);
CREATE INDEX level_history_owner_fy_idx    ON level_history (owner_at_time, fiscal_year, fiscal_quarter)
    WHERE is_forward = true AND is_credited = true;
CREATE INDEX level_history_to_level_idx    ON level_history (to_level, fiscal_year, fiscal_quarter)
    WHERE is_forward = true AND is_credited = true;
CREATE INDEX level_history_type_idx        ON level_history (company_type_at_time, fiscal_year, fiscal_quarter)
    WHERE is_forward = true AND is_credited = true;

ALTER TABLE level_history ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0006_projects.sql
-- ============================================================
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

-- ============================================================
-- 0007_project_companies.sql
-- ============================================================
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

-- ============================================================
-- 0008_engagements_tasks_notes.sql
-- ============================================================
-- 0008_engagements_tasks_notes.sql
-- Operational activity. Prompt §3.6.
-- Engagements are evidence for Driver C; tasks/notes are workflow support.

CREATE TABLE engagements (
    id                          uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id                  uuid                NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    project_id                  uuid                NULL     REFERENCES projects(id)  ON DELETE SET NULL,
    engagement_type             engagement_type_t   NOT NULL,
    summary                     text                NOT NULL,
    engagement_date             date                NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Dubai')::date,
    created_by                  uuid                NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    triggered_level_change_id   uuid                NULL     REFERENCES level_history(id) ON DELETE SET NULL,
    created_at                  timestamptz         NOT NULL DEFAULT now(),
    updated_at                  timestamptz         NOT NULL DEFAULT now()
);

CREATE INDEX engagements_company_date_idx ON engagements (company_id, engagement_date DESC);
CREATE INDEX engagements_type_date_idx    ON engagements (engagement_type, engagement_date);
CREATE INDEX engagements_created_by_idx   ON engagements (created_by);
CREATE INDEX engagements_project_idx      ON engagements (project_id) WHERE project_id IS NOT NULL;

ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;

-- Tasks ----------------------------------------------------------------

CREATE TABLE tasks (
    id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid              NULL REFERENCES companies(id) ON DELETE CASCADE,
    project_id      uuid              NULL REFERENCES projects(id)  ON DELETE CASCADE,
    title           text              NOT NULL,
    description     text              NULL,
    owner_id        uuid              NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    due_date        date              NULL,
    priority        task_priority_t   NOT NULL DEFAULT 'med',
    status          task_status_t     NOT NULL DEFAULT 'open',
    completed_at    timestamptz       NULL,
    source          task_source_t     NOT NULL DEFAULT 'manual',
    created_at      timestamptz       NOT NULL DEFAULT now(),
    updated_at      timestamptz       NOT NULL DEFAULT now(),
    CONSTRAINT tasks_completed_when_done
        CHECK ((status = 'done' AND completed_at IS NOT NULL) OR status <> 'done')
);

CREATE INDEX tasks_owner_status_idx ON tasks (owner_id, status) WHERE status IN ('open','in_progress');
CREATE INDEX tasks_due_date_idx     ON tasks (due_date) WHERE status IN ('open','in_progress');
CREATE INDEX tasks_company_idx     ON tasks (company_id) WHERE company_id IS NOT NULL;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Notes ----------------------------------------------------------------

CREATE TABLE notes (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  uuid        NULL REFERENCES companies(id) ON DELETE CASCADE,
    project_id  uuid        NULL REFERENCES projects(id)  ON DELETE CASCADE,
    body        text        NOT NULL,
    author_id   uuid        NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    is_pinned   boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notes_one_parent
        CHECK (company_id IS NOT NULL OR project_id IS NOT NULL)
);

CREATE INDEX notes_company_idx ON notes (company_id, created_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX notes_project_idx ON notes (project_id, created_at DESC) WHERE project_id IS NOT NULL;

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0009_documents.sql
-- ============================================================
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
CREATE INDEX documents_driver_d_idx ON documents (uploaded_by, doc_type, signed_date)
    WHERE doc_type IN ('announcement','site_banner_approval','case_study');

-- Retention sweep: find un-archived docs older than threshold
CREATE INDEX documents_retention_sweep_idx ON documents (signed_date)
    WHERE is_archived = false AND signed_date IS NOT NULL;

-- Default UI filter: hide archived
CREATE INDEX documents_active_idx ON documents (company_id, doc_type)
    WHERE is_archived = false;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0010_targets.sql
-- ============================================================
-- 0010_targets.sql
-- Playbook per-member targets + member-specific overrides.
-- Prompt §3.8. Driver A is the HEADLINE per-member target; B and C are
-- composition sub-targets INSIDE A, not additive.

CREATE TABLE playbook_targets (
    id              uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
    driver          driver_t  NOT NULL,
    metric_code     text      NOT NULL,
    metric_label    text      NOT NULL,
    -- If non-null: this metric is a composition of another metric inside the
    -- same driver family (e.g. driver_b_dev_l3 is a composition of driver_a_l3).
    is_composition_of text    NULL,
    q1_target       numeric   NOT NULL DEFAULT 0,
    q2_target       numeric   NOT NULL DEFAULT 0,
    q3_target       numeric   NOT NULL DEFAULT 0,
    q4_target       numeric   NOT NULL DEFAULT 0,
    annual_target   numeric   NOT NULL DEFAULT 0,
    fiscal_year     int       NOT NULL,
    weighting_pct   numeric   NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (metric_code, fiscal_year)
);

COMMENT ON TABLE playbook_targets IS
    'Per-member locked targets from the playbook, per fiscal year. Team targets are derived (sum of members).';
COMMENT ON COLUMN playbook_targets.weighting_pct IS
    'Overall RAG weighting. A=45, B=20, C=20, D=15. Sum must equal 100 per FY (enforced by seed + app settings).';

CREATE INDEX playbook_targets_driver_idx ON playbook_targets (driver, fiscal_year);

ALTER TABLE playbook_targets ENABLE ROW LEVEL SECURITY;

-- Member overrides ---------------------------------------------------------

CREATE TABLE member_targets (
    id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid              NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    metric_code     text              NOT NULL,
    fiscal_year     int               NOT NULL,
    q1_target       numeric           NOT NULL DEFAULT 0,
    q2_target       numeric           NOT NULL DEFAULT 0,
    q3_target       numeric           NOT NULL DEFAULT 0,
    q4_target       numeric           NOT NULL DEFAULT 0,
    annual_target   numeric           NOT NULL DEFAULT 0,
    override_mode   target_override_t NOT NULL DEFAULT 'playbook_default',
    last_edited_by  uuid              NULL REFERENCES profiles(id) ON DELETE SET NULL,
    last_edited_at  timestamptz       NULL,
    created_at      timestamptz       NOT NULL DEFAULT now(),
    updated_at      timestamptz       NOT NULL DEFAULT now(),
    UNIQUE (user_id, metric_code, fiscal_year),
    CONSTRAINT member_targets_metric_fk
        FOREIGN KEY (metric_code, fiscal_year)
        REFERENCES playbook_targets (metric_code, fiscal_year)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

COMMENT ON TABLE member_targets IS
    'Per-BDM target overrides. If no row for a (user, metric, FY), fallback is the playbook target.';

CREATE INDEX member_targets_user_fy_idx ON member_targets (user_id, fiscal_year);

ALTER TABLE member_targets ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0011_kpi_actuals.sql
-- ============================================================
-- 0011_kpi_actuals.sql
-- Nightly rollup output. Prompt §3.9.
-- user_id NULL => team rollup row. Deduped at the company level.

CREATE TABLE kpi_actuals_daily (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date   date        NOT NULL,
    user_id         uuid        NULL REFERENCES profiles(id) ON DELETE CASCADE,
    metric_code     text        NOT NULL,
    fiscal_year     int         NOT NULL,
    fiscal_quarter  int         NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
    actual_value    numeric     NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- NULL user_id collapses into a distinct unique row for team; the partial
    -- indexes below give the effect of UNIQUE(snapshot_date, user_id, metric_code)
    -- with NULL treated as equal to NULL.
    CONSTRAINT kpi_actuals_daily_unique_per_user
        EXCLUDE USING btree
        (snapshot_date WITH =, user_id WITH =, metric_code WITH =)
        WHERE (user_id IS NOT NULL)
);

-- Team rows (user_id IS NULL) need a separate uniqueness constraint because
-- NULL != NULL in btree constraints by default.
CREATE UNIQUE INDEX kpi_actuals_team_uq
    ON kpi_actuals_daily (snapshot_date, metric_code)
    WHERE user_id IS NULL;

CREATE INDEX kpi_actuals_user_period_idx
    ON kpi_actuals_daily (user_id, fiscal_year, fiscal_quarter, metric_code);

CREATE INDEX kpi_actuals_snapshot_idx
    ON kpi_actuals_daily (snapshot_date);

ALTER TABLE kpi_actuals_daily ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0012_bnc_uploads.sql
-- ============================================================
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

-- ============================================================
-- 0013_market_snapshots.sql
-- ============================================================
-- 0013_market_snapshots.sql
-- Pre-computed market insights. Prompt §4.4.
-- Every row = one metric for a given snapshot_date. Insights queries filter
-- by snapshot_date (defaults to MAX(snapshot_date)).

CREATE TABLE market_snapshots (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id           uuid        NOT NULL REFERENCES bnc_uploads(id) ON DELETE CASCADE,
    snapshot_date       date        NOT NULL,
    metric_code         text        NOT NULL,
    dimension_key       text        NOT NULL DEFAULT '',
    metric_value        numeric     NULL,
    metric_value_json   jsonb       NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE market_snapshots IS
    'One row per (snapshot_date, metric_code, dimension_key). Read by /insights.';

CREATE INDEX market_snapshots_lookup_idx
    ON market_snapshots (snapshot_date DESC, metric_code, dimension_key);

CREATE INDEX market_snapshots_upload_idx
    ON market_snapshots (upload_id);

ALTER TABLE market_snapshots ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0014_stagnation_notifications.sql
-- ============================================================
-- 0014_stagnation_notifications.sql
-- Stagnation thresholds and the notification inbox. Prompt §3.11 + §6.

CREATE TABLE stagnation_rules (
    id                  uuid                            PRIMARY KEY DEFAULT gen_random_uuid(),
    level               level_t                         NOT NULL UNIQUE,
    max_days_in_level   int                             NOT NULL CHECK (max_days_in_level > 0),
    warn_at_pct         int                             NOT NULL DEFAULT 80 CHECK (warn_at_pct BETWEEN 1 AND 100),
    escalate_at_pct     int                             NOT NULL DEFAULT 100 CHECK (escalate_at_pct BETWEEN 1 AND 200),
    escalation_role     stagnation_escalation_role_t    NOT NULL DEFAULT 'bd_head',
    is_active           boolean                         NOT NULL DEFAULT true,
    created_at          timestamptz                     NOT NULL DEFAULT now(),
    updated_at          timestamptz                     NOT NULL DEFAULT now(),
    CONSTRAINT stagnation_rules_escalate_gte_warn
        CHECK (escalate_at_pct >= warn_at_pct)
);

ALTER TABLE stagnation_rules ENABLE ROW LEVEL SECURITY;

-- Notifications inbox ------------------------------------------------------

CREATE TABLE notifications (
    id                      uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id            uuid                NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    notification_type       notification_type_t NOT NULL,
    subject                 text                NOT NULL,
    body                    text                NOT NULL,
    link_url                text                NULL,
    channels                text[]              NOT NULL DEFAULT ARRAY['in_app']::text[],
    is_read                 boolean             NOT NULL DEFAULT false,
    sent_in_app_at          timestamptz         NULL,
    sent_email_at           timestamptz         NULL,
    sent_whatsapp_at        timestamptz         NULL,
    related_company_id      uuid                NULL REFERENCES companies(id) ON DELETE SET NULL,
    related_task_id         uuid                NULL REFERENCES tasks(id) ON DELETE SET NULL,
    created_at              timestamptz         NOT NULL DEFAULT now()
);

CREATE INDEX notifications_recipient_unread_idx
    ON notifications (recipient_id, created_at DESC)
    WHERE is_read = false;

CREATE INDEX notifications_recipient_idx
    ON notifications (recipient_id, created_at DESC);

CREATE INDEX notifications_type_idx
    ON notifications (notification_type, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0015_composition_drift.sql
-- ============================================================
-- 0015_composition_drift.sql
-- Composition-drift audit log. Prompt §3.12b + §5.3b.
-- Every evaluation writes a row (fired=true OR fired=false) so the
-- performance-review surface has a complete history.

CREATE TABLE composition_drift_log (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    metric_pair        text        NOT NULL CHECK (metric_pair IN ('developer_ratio','consultant_ratio')),
    fiscal_year        int         NOT NULL,
    fiscal_quarter     int         NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
    evaluated_at       timestamptz NOT NULL DEFAULT now(),
    movements_sampled  int         NOT NULL,
    actual_ratio       numeric     NOT NULL,
    target_ratio       numeric     NOT NULL,
    drift_pct          numeric     NOT NULL,
    fired              boolean     NOT NULL,
    notification_id    uuid        NULL REFERENCES notifications(id) ON DELETE SET NULL,
    cooldown_until     timestamptz NULL,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX composition_drift_user_period_idx
    ON composition_drift_log (user_id, fiscal_year, fiscal_quarter);

CREATE INDEX composition_drift_cooldown_idx
    ON composition_drift_log (user_id, metric_pair, cooldown_until DESC)
    WHERE fired = true;

ALTER TABLE composition_drift_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0016_app_settings_audit.sql
-- ============================================================
-- 0016_app_settings_audit.sql
-- Key-value config + immutable audit trail.

CREATE TABLE app_settings (
    key         text        PRIMARY KEY,
    value_json  jsonb       NOT NULL,
    updated_by  uuid        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_settings IS
    'Runtime-tunable configuration. Seeded in seed.sql; edited by admin via /admin/settings.';

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Audit --------------------------------------------------------------------

CREATE TABLE audit_events (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id     uuid        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    event_type   text        NOT NULL,
    entity_type  text        NOT NULL,
    entity_id    uuid        NULL,
    before_json  jsonb       NULL,
    after_json   jsonb       NULL,
    occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_actor_idx    ON audit_events (actor_id, occurred_at DESC);
CREATE INDEX audit_events_entity_idx   ON audit_events (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_events_type_idx     ON audit_events (event_type, occurred_at DESC);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0017_bei_matview.sql
-- ============================================================
-- 0017_bei_matview.sql
-- Bonus Eligibility Index. Prompt §3.15 + §5.4.
-- Pure performance index. No currency. Per-driver pct capped at 120%.

CREATE MATERIALIZED VIEW bei_current_view AS
WITH driver_pct AS (
    SELECT
        p.id                             AS user_id,
        t.fiscal_year,
        t.fiscal_quarter,
        LEAST(
            CASE WHEN t.target_value = 0 THEN 0
                 ELSE t.actual_value / t.target_value
            END,
            1.20
        )::numeric                       AS pct,
        pt.driver
    FROM profiles p
    JOIN LATERAL (
        -- Per-user × per-metric × per-quarter latest snapshot
        SELECT
            k.metric_code,
            k.fiscal_year,
            k.fiscal_quarter,
            k.actual_value,
            CASE k.fiscal_quarter
                WHEN 1 THEN COALESCE(mt.q1_target, pbt.q1_target)
                WHEN 2 THEN COALESCE(mt.q2_target, pbt.q2_target)
                WHEN 3 THEN COALESCE(mt.q3_target, pbt.q3_target)
                WHEN 4 THEN COALESCE(mt.q4_target, pbt.q4_target)
            END AS target_value
        FROM kpi_actuals_daily k
        JOIN playbook_targets pbt
            ON pbt.metric_code = k.metric_code AND pbt.fiscal_year = k.fiscal_year
        LEFT JOIN member_targets mt
            ON mt.user_id = p.id
             AND mt.metric_code = k.metric_code
             AND mt.fiscal_year = k.fiscal_year
        WHERE k.user_id = p.id
          AND k.snapshot_date = (SELECT MAX(snapshot_date) FROM kpi_actuals_daily k2
                                 WHERE k2.user_id = p.id AND k2.metric_code = k.metric_code)
    ) t ON true
    JOIN playbook_targets pt
       ON pt.metric_code = t.metric_code AND pt.fiscal_year = t.fiscal_year
    WHERE p.role IN ('bd_manager','bd_head')
      AND p.is_active = true
)
SELECT
    user_id,
    fiscal_year,
    fiscal_quarter,
    AVG(pct) FILTER (WHERE driver = 'A') AS driver_a_pct,
    AVG(pct) FILTER (WHERE driver = 'B') AS driver_b_pct,
    AVG(pct) FILTER (WHERE driver = 'C') AS driver_c_pct,
    AVG(pct) FILTER (WHERE driver = 'D') AS driver_d_pct,
    (
      COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.45 +
      COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.20 +
      COALESCE(AVG(pct) FILTER (WHERE driver = 'C'), 0) * 0.20 +
      COALESCE(AVG(pct) FILTER (WHERE driver = 'D'), 0) * 0.15
    )::numeric AS bei,
    CASE
      WHEN (
        COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.45 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'C'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'D'), 0) * 0.15
      ) < 0.50 THEN 'below_threshold'
      WHEN (
        COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.45 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'C'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'D'), 0) * 0.15
      ) < 0.75 THEN 'approaching'
      WHEN (
        COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.45 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'C'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'D'), 0) * 0.15
      ) < 0.95 THEN 'on_target'
      WHEN (
        COALESCE(AVG(pct) FILTER (WHERE driver = 'A'), 0) * 0.45 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'B'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'C'), 0) * 0.20 +
        COALESCE(AVG(pct) FILTER (WHERE driver = 'D'), 0) * 0.15
      ) < 1.05 THEN 'full'
      ELSE 'stretch'
    END AS bei_tier,
    now() AS last_computed_at
FROM driver_pct
GROUP BY user_id, fiscal_year, fiscal_quarter;

CREATE UNIQUE INDEX bei_current_view_pk ON bei_current_view (user_id, fiscal_year, fiscal_quarter);

COMMENT ON MATERIALIZED VIEW bei_current_view IS
    'BEI per BDM per quarter. Refreshed by bei-recompute Edge Function after kpi_actuals_daily rebuild.';

-- Matview can't have RLS; access gated via a view wrapper defined in 0022
-- (we SELECT from bei_current_view through a SECURITY INVOKER view).

-- ============================================================
-- 0018_ecosystem.sql
-- ============================================================
-- 0018_ecosystem.sql
-- Ecosystem Awareness (leadership-only). Prompt §3.16 + §5.5.
-- Hybrid lifetime + active (90-day decay) model. RLS blocks bd_manager entirely.

CREATE TABLE ecosystem_point_scale (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_category      text        NOT NULL,
    event_subtype       text        NOT NULL,
    points_default      numeric     NOT NULL,
    points_current      numeric     NOT NULL,
    last_edited_by      uuid        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    last_edited_at      timestamptz NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (event_category, event_subtype)
);

ALTER TABLE ecosystem_point_scale ENABLE ROW LEVEL SECURITY;

-- Event ledger -------------------------------------------------------------

CREATE TABLE ecosystem_events (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at             timestamptz     NOT NULL,
    recorded_at             timestamptz     NOT NULL DEFAULT now(),
    company_id              uuid            NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    event_category          text            NOT NULL,
    event_subtype           text            NOT NULL,
    points                  numeric         NOT NULL,
    source_table            text            NOT NULL,
    source_id               uuid            NOT NULL,
    company_type_at_time    company_type_t  NOT NULL,
    company_level_at_time   level_t         NOT NULL,
    is_dormant_at_time      boolean         NOT NULL DEFAULT false,
    is_void                 boolean         NOT NULL DEFAULT false,  -- soft-delete when source deleted
    dedup_key               text            NOT NULL,
    created_at              timestamptz     NOT NULL DEFAULT now(),
    UNIQUE (dedup_key)
);

COMMENT ON COLUMN ecosystem_events.dedup_key IS
    'Composite key: (company_id, event_subtype, date_trunc(day, occurred_at)). Enforces 7-day dedup via app logic plus daily-level uniqueness here.';
COMMENT ON COLUMN ecosystem_events.is_void IS
    'Set true when the underlying source row is deleted. Row retained for audit; excluded from score aggregates.';

CREATE INDEX ecosystem_events_occurred_idx   ON ecosystem_events (occurred_at DESC) WHERE is_void = false;
CREATE INDEX ecosystem_events_company_idx    ON ecosystem_events (company_id, occurred_at DESC) WHERE is_void = false;
CREATE INDEX ecosystem_events_active_idx     ON ecosystem_events (occurred_at DESC) WHERE is_void = false;
CREATE INDEX ecosystem_events_category_idx   ON ecosystem_events (event_category, event_subtype) WHERE is_void = false;

ALTER TABLE ecosystem_events ENABLE ROW LEVEL SECURITY;

-- Rolled-up daily snapshot -------------------------------------------------

CREATE TABLE ecosystem_awareness_current (
    snapshot_date       date        PRIMARY KEY,
    lifetime_score      numeric     NOT NULL,
    active_score        numeric     NOT NULL,
    theoretical_max     numeric     NOT NULL,
    lifetime_pct        numeric     NOT NULL,
    active_pct          numeric     NOT NULL,
    by_company_type     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    by_level            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    by_city             jsonb       NOT NULL DEFAULT '{}'::jsonb,
    computed_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ecosystem_awareness_current_date_idx
    ON ecosystem_awareness_current (snapshot_date DESC);

ALTER TABLE ecosystem_awareness_current ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0019_leadership_reports.sql
-- ============================================================
-- 0019_leadership_reports.sql
-- Frozen snapshot reports. Prompt §3.17 + §5.6.
-- Reports are immutable once finalised. Leadership can only write the
-- feedback text field (enforced by trigger in 0021).

CREATE TABLE leadership_reports (
    id                        uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type               leadership_report_type_t    NOT NULL,
    period_label              text                        NOT NULL,
    period_start              date                        NOT NULL,
    period_end                date                        NOT NULL,
    fiscal_year               int                         NOT NULL,
    fiscal_quarter            int                         NULL CHECK (fiscal_quarter IS NULL OR fiscal_quarter BETWEEN 1 AND 4),
    generated_by              uuid                        NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    generated_at              timestamptz                 NOT NULL DEFAULT now(),
    status                    leadership_report_status_t  NOT NULL DEFAULT 'draft',
    finalised_at              timestamptz                 NULL,
    finalised_by              uuid                        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    payload_json              jsonb                       NOT NULL DEFAULT '{}'::jsonb,
    executive_summary         text                        NULL,
    leadership_feedback_text  text                        NULL,
    leadership_feedback_by    uuid                        NULL REFERENCES profiles(id) ON DELETE SET NULL,
    leadership_feedback_at    timestamptz                 NULL,
    pdf_storage_path          text                        NULL,
    created_at                timestamptz                 NOT NULL DEFAULT now(),
    updated_at                timestamptz                 NOT NULL DEFAULT now(),
    CONSTRAINT leadership_reports_period_ordered
        CHECK (period_end >= period_start),
    CONSTRAINT leadership_reports_quarterly_needs_q
        CHECK (report_type <> 'quarterly_strategic' OR fiscal_quarter IS NOT NULL)
);

COMMENT ON TABLE leadership_reports IS
    'Frozen, point-in-time reports. No DELETE — archived status instead. Leadership may update only feedback columns (trigger-enforced).';

CREATE INDEX leadership_reports_status_idx ON leadership_reports (status, period_end DESC);
CREATE INDEX leadership_reports_type_idx   ON leadership_reports (report_type, fiscal_year, fiscal_quarter);

ALTER TABLE leadership_reports ENABLE ROW LEVEL SECURITY;

-- Denormalised per-stakeholder snapshot ------------------------------------

CREATE TABLE leadership_report_stakeholders (
    id                              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id                       uuid            NOT NULL REFERENCES leadership_reports(id) ON DELETE CASCADE,
    company_id                      uuid            NULL REFERENCES companies(id) ON DELETE SET NULL,
    company_name_at_time            text            NOT NULL,
    company_type_at_time            company_type_t  NOT NULL,
    level_at_time                   level_t         NOT NULL,
    owner_at_time                   uuid            NULL REFERENCES profiles(id) ON DELETE SET NULL,
    owner_name_at_time              text            NULL,
    last_engagement_at_time         date            NULL,
    active_projects_count_at_time   int             NOT NULL DEFAULT 0,
    lifetime_ecosystem_points       numeric         NOT NULL DEFAULT 0,
    active_ecosystem_points         numeric         NOT NULL DEFAULT 0,
    is_key_stakeholder              boolean         NOT NULL DEFAULT false,
    moved_this_period               boolean         NOT NULL DEFAULT false,
    flagged_stagnating              boolean         NOT NULL DEFAULT false,
    narrative                       text            NULL,  -- admin-editable in draft stage
    created_at                      timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX leadership_report_stakeholders_report_idx
    ON leadership_report_stakeholders (report_id);
CREATE INDEX leadership_report_stakeholders_key_idx
    ON leadership_report_stakeholders (report_id)
    WHERE is_key_stakeholder = true;

ALTER TABLE leadership_report_stakeholders ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0020_city_lookup.sql
-- ============================================================
-- 0020_city_lookup.sql
-- Heat-map geography. Prompt §7.5.1.
-- Seeded with UAE emirates + major cities + common Dubai sub-zones in seed.sql.

CREATE TABLE city_lookup (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    city_name   text        NOT NULL UNIQUE,
    emirate     text        NOT NULL,
    latitude    numeric(9,6) NOT NULL,
    longitude   numeric(9,6) NOT NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX city_lookup_emirate_idx ON city_lookup (emirate) WHERE is_active = true;

ALTER TABLE city_lookup ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 0021_functions_triggers.sql
-- ============================================================
-- 0021_functions_triggers.sql
-- All functions, triggers, and scheduled jobs.
-- This is where business-rule integrity is enforced: level-history ledger,
-- updated_at maintenance, leadership-feedback column-mask, ecosystem event
-- dedup, cron scheduling.

-- 1) Utility: auth_role() --------------------------------------------------

CREATE OR REPLACE FUNCTION auth_role()
RETURNS role_t
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION auth_role() IS
    'Resolves the current authenticated user to their application role. Used across RLS policies.';

-- 2) updated_at maintenance ------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'profiles','companies','projects','project_companies','engagements',
        'tasks','notes','documents','playbook_targets','member_targets',
        'bnc_uploads','stagnation_rules','leadership_reports'
    ]) LOOP
        EXECUTE format(
            'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
            t, t
        );
    END LOOP;
END$$;

-- 3) Fiscal helpers --------------------------------------------------------

CREATE OR REPLACE FUNCTION fiscal_year_of(ts timestamptz)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
    -- Respects app_settings.fiscal_year_start_month; default Jan (month=1) so
    -- calendar year == fiscal year. If start_month is shifted, we subtract
    -- accordingly.
    WITH cfg AS (
        SELECT COALESCE((value_json->>'month')::int, 1) AS start_month
        FROM app_settings WHERE key = 'fiscal_year_start_month'
    )
    SELECT CASE
        WHEN EXTRACT(MONTH FROM ts AT TIME ZONE 'Asia/Dubai') >= (SELECT start_month FROM cfg)
             THEN EXTRACT(YEAR FROM ts AT TIME ZONE 'Asia/Dubai')::int
        ELSE EXTRACT(YEAR FROM ts AT TIME ZONE 'Asia/Dubai')::int - 1
    END;
$$;

CREATE OR REPLACE FUNCTION fiscal_quarter_of(ts timestamptz)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
    WITH cfg AS (
        SELECT COALESCE((value_json->>'month')::int, 1) AS start_month
        FROM app_settings WHERE key = 'fiscal_year_start_month'
    ),
    offset_month AS (
        SELECT ((EXTRACT(MONTH FROM ts AT TIME ZONE 'Asia/Dubai')::int - (SELECT start_month FROM cfg) + 12) % 12) AS m
    )
    SELECT ((SELECT m FROM offset_month) / 3) + 1;
$$;

-- 4) companies.current_level guard ----------------------------------------
-- Direct writes to current_level are rejected unless the session flag
-- `app.level_change_via_fn` is set. Set by change_company_level() only.

CREATE OR REPLACE FUNCTION enforce_level_write_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.current_level IS DISTINCT FROM NEW.current_level) THEN
        IF current_setting('app.level_change_via_fn', true) IS NULL
           OR current_setting('app.level_change_via_fn', true) <> 'on' THEN
            RAISE EXCEPTION
              'companies.current_level may only be written via change_company_level(). Offender: user %, company %',
              auth.uid(), NEW.id
              USING HINT = 'Call public.change_company_level(company_id, to_level, evidence) instead of direct UPDATE.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER companies_level_guard
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION enforce_level_write_guard();

-- 5) change_company_level() — the only path for level movement -------------

CREATE OR REPLACE FUNCTION change_company_level(
    p_company_id        uuid,
    p_to_level          level_t,
    p_evidence_note     text DEFAULT NULL,
    p_evidence_file_url text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_from_level        level_t;
    v_company_type      company_type_t;
    v_owner             uuid;
    v_is_forward        boolean;
    v_history_id        uuid;
    v_now               timestamptz := now();
    v_fy                int;
    v_fq                int;
BEGIN
    -- Lock the row
    SELECT current_level, company_type, owner_id
      INTO v_from_level, v_company_type, v_owner
    FROM companies
    WHERE id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company % not found', p_company_id;
    END IF;
    IF v_from_level = p_to_level THEN
        RAISE EXCEPTION 'Company % already at %', p_company_id, p_to_level;
    END IF;

    v_is_forward := p_to_level::text > v_from_level::text;  -- L0 < L1 < ... < L5
    v_fy := fiscal_year_of(v_now);
    v_fq := fiscal_quarter_of(v_now);

    INSERT INTO level_history (
        company_id, from_level, to_level, changed_by, owner_at_time,
        company_type_at_time, changed_at, fiscal_year, fiscal_quarter,
        evidence_note, evidence_file_url, is_forward, is_credited
    ) VALUES (
        p_company_id, v_from_level, p_to_level, auth.uid(), v_owner,
        v_company_type, v_now, v_fy, v_fq,
        p_evidence_note, p_evidence_file_url, v_is_forward, v_is_forward
    ) RETURNING id INTO v_history_id;

    -- Update the cache on companies via the guarded trigger
    PERFORM set_config('app.level_change_via_fn', 'on', true);
    UPDATE companies
       SET current_level = p_to_level,
           level_changed_at = v_now
     WHERE id = p_company_id;
    PERFORM set_config('app.level_change_via_fn', 'off', true);

    -- Audit
    INSERT INTO audit_events (actor_id, event_type, entity_type, entity_id, before_json, after_json)
    VALUES (
        auth.uid(), 'level_change', 'company', p_company_id,
        jsonb_build_object('level', v_from_level),
        jsonb_build_object('level', p_to_level, 'history_id', v_history_id, 'is_forward', v_is_forward)
    );

    RETURN v_history_id;
END;
$$;

GRANT EXECUTE ON FUNCTION change_company_level(uuid, level_t, text, text)
    TO authenticated;

-- 6) Level-history: per-FY dedup ------------------------------------------
-- After a forward-crediting row is inserted, check if this company already
-- got credit for this level in this FY. If so, demote the new row.

CREATE OR REPLACE FUNCTION enforce_level_history_per_fy_dedup()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_prior_count int;
BEGIN
    IF NEW.is_forward AND NEW.is_credited THEN
        SELECT count(*) INTO v_prior_count
        FROM level_history
        WHERE company_id = NEW.company_id
          AND to_level   = NEW.to_level
          AND fiscal_year = NEW.fiscal_year
          AND is_forward AND is_credited
          AND id <> NEW.id;
        IF v_prior_count > 0 THEN
            UPDATE level_history SET is_credited = false WHERE id = NEW.id;
            INSERT INTO audit_events (actor_id, event_type, entity_type, entity_id, after_json)
            VALUES (NEW.changed_by, 'credit_auto_dedup', 'level_history', NEW.id,
                    jsonb_build_object('reason', 'duplicate_level_in_fy'));
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER level_history_per_fy_dedup
    AFTER INSERT ON level_history
    FOR EACH ROW EXECUTE FUNCTION enforce_level_history_per_fy_dedup();

-- 7) Leadership feedback column-mask -------------------------------------

CREATE OR REPLACE FUNCTION enforce_leadership_feedback_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF auth_role() = 'leadership' THEN
        -- Only these three columns may change
        IF ROW(
            NEW.id, NEW.report_type, NEW.period_label, NEW.period_start, NEW.period_end,
            NEW.fiscal_year, NEW.fiscal_quarter, NEW.generated_by, NEW.generated_at,
            NEW.status, NEW.finalised_at, NEW.finalised_by, NEW.payload_json,
            NEW.executive_summary, NEW.pdf_storage_path, NEW.created_at
        ) IS DISTINCT FROM ROW(
            OLD.id, OLD.report_type, OLD.period_label, OLD.period_start, OLD.period_end,
            OLD.fiscal_year, OLD.fiscal_quarter, OLD.generated_by, OLD.generated_at,
            OLD.status, OLD.finalised_at, OLD.finalised_by, OLD.payload_json,
            OLD.executive_summary, OLD.pdf_storage_path, OLD.created_at
        ) THEN
            RAISE EXCEPTION 'leadership may only update feedback columns';
        END IF;

        IF NEW.status <> 'finalised' THEN
            RAISE EXCEPTION 'leadership feedback only on finalised reports';
        END IF;

        NEW.leadership_feedback_by := auth.uid();
        NEW.leadership_feedback_at := now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER leadership_reports_feedback_guard
    BEFORE UPDATE ON leadership_reports
    FOR EACH ROW EXECUTE FUNCTION enforce_leadership_feedback_only();

-- 8) Ecosystem event insertion + soft-delete cascade ----------------------

CREATE OR REPLACE FUNCTION insert_ecosystem_event(
    p_company_id     uuid,
    p_occurred_at    timestamptz,
    p_category       text,
    p_subtype        text,
    p_source_table   text,
    p_source_id      uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_points        numeric;
    v_dedup_key     text;
    v_company_type  company_type_t;
    v_level         level_t;
    v_dormant       boolean;
    v_multiplier    numeric := 1.0;
    v_event_id      uuid;
    v_recent_exists boolean;
    v_dedup_days    int;
    v_inactive_mult numeric;
BEGIN
    SELECT (value_json->>'days')::int INTO v_dedup_days
      FROM app_settings WHERE key = 'ecosystem_dedup_window_days';
    v_dedup_days := COALESCE(v_dedup_days, 7);

    SELECT (value_json->>'mult')::numeric INTO v_inactive_mult
      FROM app_settings WHERE key = 'ecosystem_inactive_company_multiplier';
    v_inactive_mult := COALESCE(v_inactive_mult, 0.5);

    SELECT points_current INTO v_points
      FROM ecosystem_point_scale
     WHERE event_category = p_category AND event_subtype = p_subtype;
    IF v_points IS NULL THEN
        RAISE EXCEPTION 'No ecosystem_point_scale row for (%, %)', p_category, p_subtype;
    END IF;

    SELECT company_type, current_level,
           (has_active_projects = false AND current_level = 'L0')
      INTO v_company_type, v_level, v_dormant
      FROM companies WHERE id = p_company_id;

    IF v_dormant THEN v_multiplier := v_inactive_mult; END IF;

    -- 7-day (configurable) dedup: suppress if an event with same company+subtype
    -- exists within the window
    SELECT EXISTS (
        SELECT 1 FROM ecosystem_events
        WHERE company_id = p_company_id
          AND event_subtype = p_subtype
          AND is_void = false
          AND occurred_at >= p_occurred_at - make_interval(days => v_dedup_days)
          AND occurred_at <= p_occurred_at + make_interval(days => v_dedup_days)
    ) INTO v_recent_exists;
    IF v_recent_exists THEN RETURN NULL; END IF;

    v_dedup_key := format('%s|%s|%s', p_company_id, p_subtype, date_trunc('day', p_occurred_at));

    INSERT INTO ecosystem_events (
        occurred_at, company_id, event_category, event_subtype, points,
        source_table, source_id, company_type_at_time, company_level_at_time,
        is_dormant_at_time, dedup_key
    ) VALUES (
        p_occurred_at, p_company_id, p_category, p_subtype, v_points * v_multiplier,
        p_source_table, p_source_id, v_company_type, v_level,
        v_dormant, v_dedup_key
    )
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_ecosystem_event(uuid, timestamptz, text, text, text, uuid)
    TO authenticated;

-- Soft-delete cascade: when an engagement/document/level_history row is
-- deleted, void the matching ecosystem_events rows.
CREATE OR REPLACE FUNCTION void_ecosystem_events_for_source()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE ecosystem_events
       SET is_void = true
     WHERE source_table = TG_TABLE_NAME
       AND source_id = OLD.id;
    RETURN OLD;
END;
$$;

CREATE TRIGGER engagements_void_ecosystem
    AFTER DELETE ON engagements
    FOR EACH ROW EXECUTE FUNCTION void_ecosystem_events_for_source();

CREATE TRIGGER documents_void_ecosystem
    AFTER DELETE ON documents
    FOR EACH ROW EXECUTE FUNCTION void_ecosystem_events_for_source();

-- 9) Cron schedules --------------------------------------------------------
-- Scheduled Edge Functions. Times in UTC; comments give Asia/Dubai.
-- Registered via pg_cron. Actual function bodies live in supabase/functions/*.

-- Cron registration is wrapped in a guard: if the pg_cron extension is not
-- enabled (Supabase requires explicit enablement via Dashboard → Database →
-- Extensions), the migration still succeeds and the schedules are skipped.
-- Re-run this migration, or enable the extension and re-run just this block,
-- to activate scheduling later.
DO $cron$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'pg_cron not installed — skipping cron.schedule registration. Enable pg_cron in Supabase Dashboard and re-run.';
        RETURN;
    END IF;

    -- Nightly KPI rebuild: 02:00 Asia/Dubai = 22:00 UTC
    PERFORM cron.schedule(
        'kpi-rebuild-nightly',
        '0 22 * * *',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/kpi-rebuild-nightly',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );

    -- Stagnation daily: 06:00 Asia/Dubai = 02:00 UTC
    PERFORM cron.schedule(
        'stagnation-daily',
        '0 2 * * *',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/stagnation-daily',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );

    -- Composition warning: Mon 06:00 Asia/Dubai = Mon 02:00 UTC
    PERFORM cron.schedule(
        'composition-warning-weekly',
        '0 2 * * 1',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/composition-warning-weekly',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );

    -- Composition drift: Mon 07:00 Asia/Dubai = Mon 03:00 UTC
    PERFORM cron.schedule(
        'composition-drift-weekly',
        '0 3 * * 1',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/composition-drift-weekly',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );

    -- Email digest: DISABLED for v1 (§16 Q3 — email deferred; in-app only).
    -- Re-enable by uncommenting below and flipping app_settings.notification_channels_enabled.
    --   PERFORM cron.schedule('email-digest-daily', '0 3 * * *', ...);

    -- BNC stale reminder: Mon 08:00 Asia/Dubai = 04:00 UTC
    PERFORM cron.schedule(
        'bnc-stale-reminder-weekly',
        '0 4 * * 1',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/bnc-stale-reminder',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );

    -- Document retention sweep: 1st of month 02:30 Asia/Dubai = 22:30 UTC prior day
    PERFORM cron.schedule(
        'document-retention-sweep-monthly',
        '30 22 1 * *',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/document-retention-sweep',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );

    -- Ecosystem rebuild: 02:15 Asia/Dubai = 22:15 UTC (safety rebuild after KPI)
    PERFORM cron.schedule(
        'ecosystem-rebuild',
        '15 22 * * *',
        $body$SELECT net.http_post(
            url := current_setting('app.edge_functions_url') || '/ecosystem-rebuild',
            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_functions_key'))
        );$body$
    );
END
$cron$;

-- ============================================================
-- 0022_rls_policies.sql
-- ============================================================
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

-- ============================================================
-- 0023_indexes.sql
-- ============================================================
-- 0023_indexes.sql
-- Cross-table / composite indexes that don't fit naturally in the owning
-- migration. Mostly dashboard-performance and report-generation support.

-- Driver A rollup: count distinct companies per (owner_at_time, to_level, FY, FQ)
-- Already covered by level_history_owner_fy_idx; this adds a covering index
-- variant for the JOIN back to companies for names on the performance-review page.
CREATE INDEX level_history_owner_quarter_level_idx
    ON level_history (owner_at_time, fiscal_year, fiscal_quarter, to_level, company_id)
    WHERE is_forward = true AND is_credited = true;

-- Engagement-freshness heat map: last engagement per company
-- A partial sort index is cheaper than a full sort on every load.
CREATE INDEX engagements_company_latest_idx
    ON engagements (company_id, engagement_date DESC);

-- Key-stakeholder shortcut for leadership dashboards
CREATE INDEX companies_key_stakeholder_level_idx
    ON companies (current_level, canonical_name)
    WHERE is_key_stakeholder = true AND is_active = true;

-- Notifications: unread per recipient (hot path for the bell icon)
-- Already have notifications_recipient_unread_idx; add a type filter for the
-- /settings/notifications page.
CREATE INDEX notifications_recipient_type_idx
    ON notifications (recipient_id, notification_type, created_at DESC);

-- Market snapshots: "compare two snapshots" picker
CREATE INDEX market_snapshots_by_metric_date_idx
    ON market_snapshots (metric_code, snapshot_date DESC);

-- Ecosystem quarterly trend: fast aggregate per quarter.
-- Cast to timestamp-without-tz via AT TIME ZONE so date_trunc is IMMUTABLE
-- (required for use in an index expression). Storage is UTC so 'UTC' is
-- the correct pin — quarters align with calendar quarters in app-display tz.
CREATE INDEX ecosystem_events_quarter_idx
    ON ecosystem_events (date_trunc('quarter', occurred_at AT TIME ZONE 'UTC'), company_type_at_time)
    WHERE is_void = false;

-- ============================================================
-- seed.sql
-- ============================================================
-- seed.sql
-- §17.4 — seed script. Idempotent: safe to re-run.
-- Values sourced from prompt §8 and the playbook references cited there.
-- Apply after all 0001..0023 migrations.
-- FY is derived from current calendar year (Asia/Dubai tz).

DO $$
DECLARE v_fy int;
BEGIN
    v_fy := EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Dubai')::int;
    PERFORM set_config('seed.fy', v_fy::text, false);
END$$;

-- =====================================================================
-- 1) app_settings
-- =====================================================================

INSERT INTO app_settings (key, value_json) VALUES
    ('fiscal_year_start_month',               '{"month": 1}'::jsonb),                                      -- §16 Q1: Jan–Dec confirmed
    ('working_week',                          '{"days": ["Mon","Tue","Wed","Thu","Fri"], "weekend": ["Sat","Sun"]}'::jsonb),  -- §16 Q2: Mon–Fri
    ('kpi_universe_sizes',                    '{"developers": 110, "consultants": 360, "main_contractors": 300, "enabling_contractors": 19, "total": 789}'::jsonb),
    -- §16 Q3: email deferred; in-app is the only active channel for v1
    ('notification_channels_enabled',         '{"in_app": true, "email": false, "whatsapp": false}'::jsonb),
    ('dormancy_policy',                       '{"consecutive_missed_uploads": 2}'::jsonb),
    ('composition_warning_thresholds',        '{"headline_pct": 80, "composition_pct": 60}'::jsonb),
    ('composition_drift_min_quarter_pct',     '{"pct": 30}'::jsonb),
    ('composition_drift_min_sample_size',     '{"n": 5}'::jsonb),
    ('composition_drift_ratio_threshold',     '{"ratio": 0.70}'::jsonb),
    ('composition_drift_cooldown_days',       '{"days": 14}'::jsonb),
    ('ecosystem_decay_window_days',           '{"days": 90}'::jsonb),
    ('ecosystem_inactive_company_multiplier', '{"mult": 0.5}'::jsonb),
    ('ecosystem_dedup_window_days',           '{"days": 7}'::jsonb),
    ('bei_weightings',                        '{"A": 45, "B": 20, "C": 20, "D": 15}'::jsonb),
    ('engagement_freshness_thresholds',       '{"hot_days": 14, "warm_days": 45, "cooling_days": 90}'::jsonb),
    -- §16 Q4: BNC-stale admin reminder enabled; fires when no BNC upload in N days
    ('bnc_stale_reminder',                    '{"enabled": true, "threshold_days": 45}'::jsonb),
    -- §16 Q5: document retention / auto-archive.
    -- Single default for v1. Admin can override per doc_type later; sweep keeps
    -- rows, flips is_archived=true, hides from default UI, retains storage blob.
    ('document_retention',                    '{"enabled": true, "archive_after_years": 7, "by_doc_type": {}}'::jsonb),
    -- §16 Q6: L4 MOU approval workflow — single-admin tick for v1, dual-approver deferred
    ('l4_mou_workflow',                       '{"mode": "single_admin_tick"}'::jsonb),
    -- §16 Q8: ownership-transfer credit policy — new owner receives the credit history
    ('ownership_transfer_credit_policy',      '{"mode": "new_owner", "scope": "all_history"}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json;

-- =====================================================================
-- 2) stagnation_rules (§8 item 2 from prompt; playbook §4, §8.2)
-- =====================================================================

INSERT INTO stagnation_rules (level, max_days_in_level, warn_at_pct, escalate_at_pct, escalation_role) VALUES
    ('L0', 10, 80,  100, 'bd_head'),
    ('L1', 30, 50,  100, 'bd_head'),   -- warn at day 15 (50% of 30), escalate at day 30
    ('L2', 30, 33,  100, 'bd_head'),   -- warn at day 10 (~33% of 30), escalate at day 30
    ('L3', 45, 80,  100, 'bd_head'),
    ('L4', 60, 80,  100, 'admin'),
    ('L5', 10, 80,  100, 'admin')
ON CONFLICT (level) DO UPDATE SET
    max_days_in_level = EXCLUDED.max_days_in_level,
    warn_at_pct       = EXCLUDED.warn_at_pct,
    escalate_at_pct   = EXCLUDED.escalate_at_pct,
    escalation_role   = EXCLUDED.escalation_role;

-- =====================================================================
-- 3) playbook_targets (§3.8 canonical metric codes)
--    Per-BDM annual targets. Quarterly distribution: equal split except
--    where the playbook explicitly stages them; we default to equal thirds
--    and let admin adjust via /admin/targets.
-- =====================================================================

INSERT INTO playbook_targets
    (driver, metric_code, metric_label, is_composition_of,
     q1_target, q2_target, q3_target, q4_target, annual_target,
     fiscal_year, weighting_pct)
VALUES
    -- Driver A (headline)
    ('A','driver_a_l3','L3 stakeholders (all types)',                 NULL,
        9, 9, 9, 8, 35,   current_setting('seed.fy')::int, 45),
    ('A','driver_a_l4','L4 stakeholders (all types)',                 NULL,
        2, 2, 2, 2,  8,   current_setting('seed.fy')::int, 45),
    ('A','driver_a_l5','L5 stakeholders (all types)',                 NULL,
        1, 1, 1, 0,  3,   current_setting('seed.fy')::int, 45),
    -- Driver B (developer composition of A)
    ('B','driver_b_dev_l3','Developer L3 (of driver_a_l3)',           'driver_a_l3',
        5, 5, 5, 5, 20,   current_setting('seed.fy')::int, 20),
    ('B','driver_b_dev_l4','Developer L4 (of driver_a_l4)',           'driver_a_l4',
        2, 2, 1, 1,  6,   current_setting('seed.fy')::int, 20),
    ('B','driver_b_dev_l5','Developer L5 (of driver_a_l5)',           'driver_a_l5',
        1, 1, 1, 0,  3,   current_setting('seed.fy')::int, 20),
    -- Driver C (consultant influence)
    ('C','driver_c_consultant_approvals','Consultant approvals (L3)', 'driver_a_l3',
        3, 3, 2, 2, 10,   current_setting('seed.fy')::int, 20),
    ('C','driver_c_spec_template_inclusions','Spec template inclusions', NULL,
        1, 2, 1, 1,  5,   current_setting('seed.fy')::int, 20),
    ('C','driver_c_design_stage_projects','Design-stage projects intro', NULL,
        4, 4, 4, 3, 15,   current_setting('seed.fy')::int, 20),
    -- Driver D (visibility outputs)
    ('D','driver_d_announcements','Public announcements',             NULL,
        1, 2, 2, 1,  6,   current_setting('seed.fy')::int, 15),
    ('D','driver_d_site_banners','Site banners installed',            NULL,
        1, 1, 1, 1,  4,   current_setting('seed.fy')::int, 15),
    ('D','driver_d_case_studies','Case studies published',            NULL,
        1, 1, 1, 1,  4,   current_setting('seed.fy')::int, 15)
ON CONFLICT (metric_code, fiscal_year) DO UPDATE SET
    metric_label      = EXCLUDED.metric_label,
    is_composition_of = EXCLUDED.is_composition_of,
    q1_target         = EXCLUDED.q1_target,
    q2_target         = EXCLUDED.q2_target,
    q3_target         = EXCLUDED.q3_target,
    q4_target         = EXCLUDED.q4_target,
    annual_target     = EXCLUDED.annual_target,
    weighting_pct     = EXCLUDED.weighting_pct;

-- =====================================================================
-- 4) ecosystem_point_scale (§3.16)
-- =====================================================================

INSERT INTO ecosystem_point_scale (event_category, event_subtype, points_default, points_current) VALUES
    ('level_up',      'L0_to_L1',            1,  1),
    ('level_up',      'L1_to_L2',            3,  3),
    ('level_up',      'L2_to_L3',            8,  8),
    ('level_up',      'L3_to_L4',           20, 20),
    ('level_up',      'L4_to_L5',           50, 50),
    ('engagement',    'call',                1,  1),
    ('engagement',    'meeting',             1,  1),
    ('engagement',    'site_visit',          1,  1),
    ('engagement',    'workshop',            1,  1),
    ('engagement',    'email',               1,  1),
    ('engagement',    'document_sent',       2,  2),
    ('document',      'announcement',       10, 10),
    ('document',      'site_banner_approval',15, 15),
    ('document',      'case_study',         10, 10),
    ('spec_inclusion','spec_inclusion',     15, 15)
ON CONFLICT (event_category, event_subtype) DO UPDATE SET
    points_default = EXCLUDED.points_default;
-- Note: points_current is preserved on re-seed so admin tuning isn't clobbered.

-- =====================================================================
-- 5) city_lookup (§7.5.1) — seed UAE emirates + major cities + common zones.
--    Coordinates rounded; refine as real geo data arrives.
-- =====================================================================

INSERT INTO city_lookup (city_name, emirate, latitude, longitude) VALUES
    ('Abu Dhabi',        'Abu Dhabi',         24.453884, 54.377344),
    ('Al Ain',           'Abu Dhabi',         24.207536, 55.744660),
    ('Ruwais',           'Abu Dhabi',         24.087960, 52.725080),
    ('Dubai',            'Dubai',             25.204849, 55.270783),
    ('Downtown Dubai',   'Dubai',             25.195200, 55.274380),
    ('Business Bay',     'Dubai',             25.185280, 55.265850),
    ('Jumeirah',         'Dubai',             25.204600, 55.243000),
    ('Dubai Marina',     'Dubai',             25.080600, 55.140100),
    ('JVC',              'Dubai',             25.059200, 55.210000),
    ('DIFC',             'Dubai',             25.213200, 55.279500),
    ('Sharjah',          'Sharjah',           25.346255, 55.420937),
    ('Ajman',            'Ajman',             25.405216, 55.513641),
    ('Umm Al Quwain',    'Umm Al Quwain',     25.550000, 55.555000),
    ('Ras Al Khaimah',   'Ras Al Khaimah',    25.789295, 55.942478),
    ('Fujairah',         'Fujairah',          25.128484, 56.326330)
ON CONFLICT (city_name) DO NOTHING;

-- =====================================================================
-- 6) First admin — deferred
-- =====================================================================
--
-- The first admin is created at deploy time via the INITIAL_ADMIN_EMAIL env
-- var + a one-shot Supabase admin-invite script (not a migration). Here as
-- a reminder:
--   1. supabase auth users invite <INITIAL_ADMIN_EMAIL>
--   2. After the user signs in, UPSERT into profiles with role='admin'.
--
-- Seeding a hard-coded admin here would bypass the invite flow and leave a
-- dangling auth.users row across environments.
